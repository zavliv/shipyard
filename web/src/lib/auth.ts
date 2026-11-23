import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { collections, type UserDoc } from "./db";
import { randomToken, sha256 } from "./crypto";
import { env } from "./env";

export const SESSION_COOKIE = env.production ? "__Host-shipyard_session" : "shipyard_session";
const IDLE_MS = 30 * 60 * 1000;
const ABSOLUTE_MS = 12 * 60 * 60 * 1000;
const MAX_FAILS = 5;
const FAIL_WINDOW_MS = 15 * 60 * 1000;

export async function clientInfo() {
  const h = await headers();
  const ip = h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  return { ip, userAgent: (h.get("user-agent") || "").slice(0, 300) };
}

export async function createSession(user: UserDoc): Promise<void> {
  const { sessions } = await collections();
  const { ip, userAgent } = await clientInfo();
  const token = randomToken();
  const now = new Date();
  await sessions.insertOne({
    tokenHash: sha256(token),
    userId: user._id!,
    ip,
    userAgent,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + ABSOLUTE_MS),
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.production,
    sameSite: "strict",
    path: "/",
    maxAge: ABSOLUTE_MS / 1000,
  });
}

export const currentUser = cache(async (): Promise<UserDoc | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const { sessions, users } = await collections();
  const session = await sessions.findOne({ tokenHash: sha256(token) });
  if (!session) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() < now || session.lastSeenAt.getTime() + IDLE_MS < now) {
    await sessions.deleteOne({ _id: session._id });
    return null;
  }
  await sessions.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date() } });
  return users.findOne({ _id: session.userId });
});

export async function requireUser(): Promise<UserDoc> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    const { sessions } = await collections();
    await sessions.deleteOne({ tokenHash: sha256(token) });
  }
  store.delete(SESSION_COOKIE);
}

export async function loginBlocked(ip: string): Promise<boolean> {
  const { loginAttempts } = await collections();
  const since = new Date(Date.now() - FAIL_WINDOW_MS);
  const [fromIp, total] = await Promise.all([
    loginAttempts.countDocuments({ ip, ok: false, at: { $gte: since } }),
    loginAttempts.countDocuments({ ok: false, at: { $gte: since } }),
  ]);
  return fromIp >= MAX_FAILS || total >= MAX_FAILS * 4;
}

export async function recordAttempt(ip: string, ok: boolean): Promise<void> {
  const { loginAttempts } = await collections();
  await loginAttempts.insertOne({ ip, ok, at: new Date() });
}

export async function currentSessionHash(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? sha256(token) : null;
}
