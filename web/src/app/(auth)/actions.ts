"use server";

import { redirect } from "next/navigation";
import { collections } from "@/lib/db";
import { newLoginCode, safeEqual, sha256 } from "@/lib/crypto";
import { clientInfo, createSession, currentUser, destroySession, loginBlocked, recordAttempt } from "@/lib/auth";
import { sendLoginCode } from "@/lib/mail";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";

export type LoginState = { step: "email" | "code"; email?: string; error?: string; notice?: string; sentAt?: number };

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_GAP_MS = 60 * 1000;
const MAX_CODES_PER_HOUR = 5;
const MAX_CODE_TRIES = 5;

export async function requestCode(prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") || "").trim().toLowerCase();
  const { ip } = await clientInfo();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { step: "email", email, error: "Enter a valid email address." };
  if (await loginBlocked(ip)) return { step: "email", email, error: "Too many failed attempts. Wait 15 minutes and try again." };

  const codeStep: LoginState = { step: "code", email, sentAt: Date.now() };

  if (!safeEqual(email, env.adminEmail())) {
    await recordAttempt(ip, false);
    await audit({ actor: email, action: "login-code", result: "refused", detail: "email not allowed", ip });
    return { step: "email", email, error: "This email can't sign in to Shipyard." };
  }

  const { loginCodes } = await collections();
  const now = Date.now();
  const latest = await loginCodes.findOne({ email }, { sort: { createdAt: -1 } });
  if (latest && now - latest.createdAt.getTime() < RESEND_GAP_MS) {
    return { ...codeStep, sentAt: latest.createdAt.getTime(), notice: "A code was already sent less than a minute ago. Check your inbox and spam folder." };
  }
  const recent = await loginCodes.countDocuments({ email, createdAt: { $gte: new Date(now - 60 * 60 * 1000) } });
  if (recent >= MAX_CODES_PER_HOUR) return { step: "email", email, error: "Too many codes requested. Try again in an hour." };

  const code = newLoginCode();
  await loginCodes.deleteMany({ email });
  await loginCodes.insertOne({
    email,
    codeHash: sha256(`${email}:${code}`),
    ip,
    attempts: 0,
    createdAt: new Date(now),
    expiresAt: new Date(now + CODE_TTL_MS),
  });
  try {
    await sendLoginCode(email, code, ip);
  } catch (e) {
    await loginCodes.deleteMany({ email });
    await audit({ actor: email, action: "login-code", result: "failed", detail: `email not sent: ${(e as Error).message.slice(0, 120)}`, ip });
    return { step: "email", email, error: "The email could not be sent. Check the SMTP settings and try again." };
  }
  await audit({ actor: email, action: "login-code", result: "ok", detail: "code emailed", ip });
  return codeStep;
}

export async function verifyCode(prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") || "").trim().toLowerCase();
  const code = String(form.get("code") || "").replace(/\s/g, "");
  const { ip } = await clientInfo();
  if (await loginBlocked(ip)) return { step: "code", email, error: "Too many failed attempts. Wait 15 minutes and try again." };
  if (!/^\d{6}$/.test(code)) return { step: "code", email, error: "Enter the 6-digit code from the email." };

  const { loginCodes, users } = await collections();
  const entry = await loginCodes.findOne({ email }, { sort: { createdAt: -1 } });
  const valid =
    entry &&
    entry.expiresAt.getTime() > Date.now() &&
    entry.attempts < MAX_CODE_TRIES &&
    safeEqual(entry.codeHash, sha256(`${email}:${code}`));

  if (!valid) {
    if (entry) await loginCodes.updateOne({ _id: entry._id }, { $inc: { attempts: 1 } });
    await recordAttempt(ip, false);
    await audit({ actor: email || "anonymous", action: "login", result: "failed", detail: "wrong or expired code", ip });
    const usedUp = entry && entry.attempts + 1 >= MAX_CODE_TRIES;
    return {
      step: "code",
      email,
      error: usedUp ? "Too many wrong tries for this code. Request a new code." : "The code is wrong or has expired.",
    };
  }

  await loginCodes.deleteMany({ email });
  const user = await users.findOneAndUpdate(
    { email },
    { $setOnInsert: { email, createdAt: new Date() }, $set: { lastLoginAt: new Date() } },
    { upsert: true, returnDocument: "after" },
  );
  await recordAttempt(ip, true);
  await createSession(user!);
  await audit({ actor: email, action: "login", result: "ok", ip });
  redirect("/");
}

export async function logout(): Promise<void> {
  const user = await currentUser();
  const { ip } = await clientInfo();
  await destroySession();
  if (user) await audit({ actor: user.email, action: "logout", result: "ok", ip });
  redirect("/login");
}
