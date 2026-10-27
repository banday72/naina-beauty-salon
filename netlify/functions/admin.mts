/// <reference types="node" />
import type { Config } from "@netlify/functions";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { desc, eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { bookings, coupons, customers, payments, services, staff } from "../../db/schema.js";

type AdminClaims = { email?: string; app_metadata?: { roles?: string[] } };

async function requireAdmin(req: Request): Promise<AdminClaims> {
  const authorization = req.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) throw new Error("Authentication required");
  const token = authorization.slice(7);
  const origin = new URL(req.url).origin;
  const jwks = createRemoteJWKSet(new URL("/.netlify/identity/.well-known/jwks.json", origin));
  const result = await jwtVerify(token, jwks);
  const claims = result.payload as AdminClaims;
  const allowedEmails = (process.env.ADMIN_EMAILS || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
  const roles = claims.app_metadata?.roles || [];
  if (!roles.some((role) => ["admin", "owner"].includes(role)) &&
      (!claims.email || !allowedEmails.includes(claims.email.toLowerCase()))) {
    throw new Error("Owner access required");
  }
  return claims;
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed";
  const status = message.includes("required") || message.includes("access") ? 403 : 400;
  return Response.json({ error: message }, { status });
}

export default async (req: Request) => {
  try {
    await requireAdmin(req);
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
      return Response.json({
        bookings: bookingRows,
        services: serviceRows,
        staff: staffRows,
        customers: customerRows,
        payments: paymentRows,
        summary: { revenue, paid, pendingBookings: bookingRows.filter((booking) => booking.status === "pending").length },
      });
    }

    const body = await req.json();
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
