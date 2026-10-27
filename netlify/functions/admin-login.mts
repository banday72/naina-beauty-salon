/// <reference types="node" />
import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";

const ROOT_USERNAME = "naina-admin";
// pbkdf2-sha256, 120000 iterations. The default password is not stored here.
const ROOT_PASSWORD_HASH = "pbkdf2$88af37b89904a48ad1c05fa5d0a921af$a642ed6caacd63fec54d67a31477b177c35229eb9039056df00e220eb8d90bb5";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

type StoredUser = { username: string; hash: string; createdAt: string };

function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, expected] = stored.split("$");
  if (scheme !== "pbkdf2" || !salt || !expected) return false;
  const actual = crypto.pbkdf2Sync(password, Buffer.from(salt, "hex"), 120000, 32, "sha256").toString("hex");
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  try {
    const body = (await req.json()) as { username?: unknown; password?: unknown };
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || !password) {
      return Response.json({ error: "Username and password are required" }, { status: 400 });
    }

    let role: "root" | "user" | null = null;
    if (username === ROOT_USERNAME && verifyPassword(password, ROOT_PASSWORD_HASH)) {
      role = "root";
    } else {
      const store = getStore({ name: "admin-users", consistency: "strong" });
      const user = await store.get(`u_${username}`, { type: "json" }) as StoredUser | null;
      if (user && verifyPassword(password, user.hash)) role = "user";
    }

    if (!role) return Response.json({ error: "Invalid username or password" }, { status: 401 });

    const token = crypto.randomBytes(32).toString("hex");
    const sessions = getStore({ name: "admin-sessions", consistency: "strong" });
    await sessions.setJSON(`s_${token}`, {
      u: username,
      r: role,
      exp: Date.now() + SESSION_TTL_SECONDS * 1000,
    });
    return Response.json({ token, username, role });
  } catch {
    return Response.json({ error: "Login failed" }, { status: 500 });
  }
};

export const config: Config = { path: "/api/admin/login" };
