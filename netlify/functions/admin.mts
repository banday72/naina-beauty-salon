/// <reference types="node" />
import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { bookings, coupons, customers, payments, services, staff } from "../../db/schema.js";

type AdminSession = { u: string; r: "root" | "user"; exp: number };
type AdminUser = { username: string; hash: string; createdAt: string };

async function requireAdmin(req: Request): Promise<AdminSession> {
  const authorization = req.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw new Error("Authentication required");
  const token = authorization.slice(7);
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Owner access required");
  const store = getStore({ name: "admin-sessions", consistency: "strong" });
  const session = await store.get(`s_${token}`, { type: "json" }) as AdminSession | null;
  if (!session || !session.u || (session.r !== "root" && session.r !== "user") || typeof session.exp !== "number" || session.exp < Date.now()) {
    throw new Error("Session expired, please log in again");
  }
  return session;
}

async function listAdminUsers(): Promise<AdminUser[]> {
  const store = getStore({ name: "admin-users", consistency: "strong" });
  const entries = await store.list({ prefix: "u_" });
  const users: AdminUser[] = [];
  for (const entry of entries.blobs) {
    const user = await store.get(entry.key, { type: "json" }) as AdminUser | null;
    if (user) users.push(user);
  }
  return users.sort((a, b) => a.username.localeCompare(b.username));
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, Buffer.from(salt, "hex"), 120000, 32, "sha256").toString("hex");
  return `pbkdf2$${salt}$${hash}`;
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed";
  const status =
    message.includes("required") || message.includes("access") || message.includes("Session expired") || message.includes("Only naina-admin")
      ? 403
      : 400;
  return Response.json({ error: message }, { status });
}

export default async (req: Request) => {
  try {
    const session = await requireAdmin(req);
    if (req.method === "GET") {
      const [bookingRows, serviceRows, staffRows, customerRows, paymentRows] = await Promise.all([
        db.select().from(bookings).orderBy(desc(bookings.date), desc(bookings.timeFrom)).limit(200),
        db.select().from(services).orderBy(services.name),
        db.select().from(staff).orderBy(staff.name),
        db.select().from(customers).orderBy(desc(customers.createdAt)).limit(500),
        db.select().from(payments).orderBy(desc(payments.createdAt)).limit(500),
      ]);
      const revenue = bookingRows
        .filter((booking) => booking.status !== "cancelled")
        .reduce((sum, booking) => sum + booking.amount, 0);
      const paid = paymentRows
        .filter((payment) => payment.status === "paid")
        .reduce((sum, payment) => sum + payment.amount, 0);
      const adminInfo = { username: session.u, role: session.r };
      if (session.r !== "root") {
        return Response.json({
          bookings: bookingRows,
          services: serviceRows,
          staff: staffRows,
          customers: customerRows,
          payments: paymentRows,
          admin: adminInfo,
          summary: { revenue, paid, pendingBookings: bookingRows.filter((booking) => booking.status === "pending").length },
        });
      }
      const adminUsers = await listAdminUsers();
      return Response.json({
        bookings: bookingRows,
        services: serviceRows,
        staff: staffRows,
        customers: customerRows,
        payments: paymentRows,
        admin: adminInfo,
        users: adminUsers.map((user) => ({ username: user.username, createdAt: user.createdAt })),
        summary: { revenue, paid, pendingBookings: bookingRows.filter((booking) => booking.status === "pending").length },
      });
    }

    const body = await req.json();
    if (req.method === "POST" && body.resource === "user") {
      if (session.r !== "root") throw new Error("Only naina-admin can add or remove users");
      const username = String(body.username || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (!/^[a-z0-9_-]{3,24}$/.test(username)) return Response.json({ error: "Username must be 3-24 letters, numbers, - or _" }, { status: 400 });
      if (password.length < 8) return Response.json({ error: "Password must be at least 8 characters" }, { status: 400 });
      if (username === "naina-admin") return Response.json({ error: "This username is reserved" }, { status: 400 });
      const store = getStore({ name: "admin-users", consistency: "strong" });
      const key = `u_${username}`;
      const existing = await store.get(key, { type: "json" });
      if (existing) return Response.json({ error: "A user with this username already exists" }, { status: 400 });
      const user: AdminUser = { username, hash: hashPassword(password), createdAt: new Date().toISOString() };
      await store.setJSON(key, user);
      return Response.json({ user: { username, createdAt: user.createdAt } }, { status: 201 });
    }
    if (req.method === "DELETE" && body.resource === "user") {
      if (session.r !== "root") throw new Error("Only naina-admin can add or remove users");
      const username = String(body.username || "").trim().toLowerCase();
      if (!username || username === "naina-admin") return Response.json({ error: "This user cannot be removed" }, { status: 400 });
      const store = getStore({ name: "admin-users", consistency: "strong" });
      await store.delete(`u_${username}`);
      return Response.json({ ok: true });
    }
    if (req.method === "PATCH" && body.resource === "booking") {
      const updates: Record<string, unknown> = {};
      if (["pending", "confirmed", "cancelled", "completed", "no_show"].includes(body.status)) updates.status = body.status;
      if (typeof body.staffId === "number" || body.staffId === null) updates.staffId = body.staffId;
      if (["unpaid", "partial", "paid"].includes(body.paymentStatus)) updates.paymentStatus = body.paymentStatus;
      if (Object.keys(updates).length === 0) return Response.json({ error: "No valid booking changes supplied" }, { status: 400 });
      await db.update(bookings).set(updates).where(eq(bookings.id, Number(body.id)));
      return Response.json({ ok: true });
    }
    if (req.method === "POST" && body.resource === "staff") {
      const inserted = await db.insert(staff).values({
        name: String(body.name || "").trim(),
        phone: body.phone ? String(body.phone).trim() : null,
        role: String(body.role || "beautician"),
      }).returning();
      return Response.json({ staff: inserted[0] }, { status: 201 });
    }
    if (req.method === "POST" && body.resource === "coupon") {
      const inserted = await db.insert(coupons).values({
        code: String(body.code || "").trim().toUpperCase(),
        discountPercent: Number(body.discountPercent),
        expiresAt: body.expiresAt ? String(body.expiresAt) : null,
      }).returning();
      return Response.json({ coupon: inserted[0] }, { status: 201 });
    }
    return new Response("Method not allowed", { status: 405 });
  } catch (error) {
    return errorResponse(error);
  }
};

export const config: Config = { path: "/api/admin" };
