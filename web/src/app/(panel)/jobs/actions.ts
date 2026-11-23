"use server";

import { revalidatePath } from "next/cache";
import { clientInfo, requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { cancelQueuedJob, retryJob } from "@/lib/jobs";

type Result = { jobId?: string; error?: string; ok?: boolean };

export async function cancelJob(id: string): Promise<Result> {
  const user = await requireUser();
  const { ip } = await clientInfo();
  const ok = await cancelQueuedJob(id, user.email);
  await audit({ actor: user.email, action: "job-cancel", target: id, result: ok ? "ok" : "refused", ip });
  revalidatePath("/jobs");
  return ok ? { ok: true } : { error: "This job already started, so it can't be cancelled." };
}

export async function retryFailedJob(id: string): Promise<Result> {
  const user = await requireUser();
  const { ip } = await clientInfo();
  try {
    const jobId = await retryJob(id, user.email);
    await audit({ actor: user.email, action: "job-retry", target: id, result: "ok", ip });
    return { jobId };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
