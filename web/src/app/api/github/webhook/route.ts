import { createHmac, timingSafeEqual } from "node:crypto";
import { getInventory } from "@/lib/inventory";
import { jobsCollection } from "@/lib/jobs";
import { deployJob, type RecordApp } from "@/lib/sites";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

function validSignature(body: string, header: string | null): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export async function POST(request: Request) {
  const body = await request.text();
  if (body.length > 5 * 1024 * 1024) return new Response("Too large", { status: 413 });
  if (!validSignature(body, request.headers.get("x-hub-signature-256"))) {
    return new Response("Invalid signature", { status: 401 });
  }
  const event = request.headers.get("x-github-event");
  if (event === "ping") return Response.json({ ok: true, pong: true });
  if (event !== "push") return Response.json({ ok: true, ignored: event });

  const payload = JSON.parse(body) as {
    ref?: string;
    deleted?: boolean;
    repository?: { full_name?: string };
    head_commit?: { id?: string; message?: string } | null;
    pusher?: { name?: string };
  };
  const repo = payload.repository?.full_name ?? "";
  const branch = payload.ref?.startsWith("refs/heads/") ? payload.ref.slice("refs/heads/".length) : "";
  if (!repo || !branch || payload.deleted) return Response.json({ ok: true, ignored: "no branch" });

  const inv = await getInventory();
  const jobs = await jobsCollection();
  const queued: string[] = [];
  for (const rec of inv.projects) {
    if (rec.created_by !== "shipyard" || rec.status !== "active") continue;
    const apps = ((rec.apps as RecordApp[] | undefined) ?? []).filter(
      (a) => a.repo?.toLowerCase() === repo.toLowerCase() && (a.branch ?? "main") === branch && (a as { auto_deploy?: boolean }).auto_deploy,
    );
    if (!apps.length) continue;
    const waiting = await jobs.findOne({ project: rec.project, kind: "deploy", status: "queued" });
    if (waiting) continue;
    const actor = `GitHub push by ${payload.pusher?.name ?? "unknown"}`;
    await deployJob(rec.project, rec, actor);
    await audit({ actor, action: "auto-deploy", target: rec.project, result: "ok", detail: `${repo}@${branch} ${payload.head_commit?.id?.slice(0, 7) ?? ""}` });
    queued.push(rec.project);
  }
  return Response.json({ ok: true, queued });
}
