import "server-only";
import { collections, type AuditDoc } from "./db";

export async function audit(entry: Omit<AuditDoc, "at">): Promise<void> {
  const { auditLog } = await collections();
  await auditLog.insertOne({ ...entry, at: new Date() });
}
