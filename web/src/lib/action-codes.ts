import "server-only";
import { collections } from "./db";
import { newLoginCode, safeEqual, sha256 } from "./crypto";
import { sendActionCode } from "./mail";

const TTL_MS = 10 * 60 * 1000;
const MAX_TRIES = 5;

export async function requestActionCode(email: string, purpose: string, what: string, ip: string): Promise<{ error?: string }> {
  const { loginCodes } = await collections();
  const key = `action:${purpose}`;
  const latest = await loginCodes.findOne({ email: key }, { sort: { createdAt: -1 } });
  if (latest && Date.now() - latest.createdAt.getTime() < 45_000) return { error: "A code was sent less than a minute ago. Check your email." };
  const code = newLoginCode();
  await loginCodes.deleteMany({ email: key });
  await loginCodes.insertOne({
    email: key,
    codeHash: sha256(`${key}:${code}`),
    ip,
    attempts: 0,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + TTL_MS),
  });
  try {
    await sendActionCode(email, code, what, ip);
  } catch (e) {
    await loginCodes.deleteMany({ email: key });
    return { error: `The email could not be sent: ${(e as Error).message.slice(0, 120)}` };
  }
  return {};
}

export async function verifyActionCode(purpose: string, code: string): Promise<boolean> {
  const { loginCodes } = await collections();
  const key = `action:${purpose}`;
  const entry = await loginCodes.findOne({ email: key }, { sort: { createdAt: -1 } });
  const ok =
    !!entry &&
    /^\d{6}$/.test(code) &&
    entry.expiresAt.getTime() > Date.now() &&
    entry.attempts < MAX_TRIES &&
    safeEqual(entry.codeHash, sha256(`${key}:${code}`));
  if (!ok) {
    if (entry) await loginCodes.updateOne({ _id: entry._id }, { $inc: { attempts: 1 } });
    return false;
  }
  await loginCodes.deleteMany({ email: key });
  return true;
}
