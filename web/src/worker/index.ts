import { hostname } from "node:os";
import { ObjectId } from "mongodb";
import { jobsCollection, type JobDoc, type JobStep } from "@/lib/jobs";
import { planFor, type StepContext } from "@/lib/job-defs";
import { audit } from "@/lib/audit";
import { vpsctl } from "@/lib/vpsctl";
import { monitorTick, notify } from "@/lib/monitor";
import { maintenanceTick } from "@/lib/maintenance";

const WORKER_ID = `${hostname()}:${process.pid}`;
const MAX_LOG_LINES = 4000;
let stopping = false;

function stamp(msg: string) {
  console.log(`${new Date().toISOString()} ${msg}`);
}

async function recoverInterrupted() {
  const jobs = await jobsCollection();
  const stuck = await jobs.find({ status: "running" }, { projection: { log: 0 } }).toArray();
  for (const job of stuck) {
    stamp(`recovering interrupted job ${job._id} (${job.kind} ${job.project})`);
    await jobs.updateOne(
      { _id: job._id },
      {
        $set: { status: "failed", error: "Shipyard's worker restarted while this job was running.", finishedAt: new Date(), updatedAt: new Date() },
        $push: { log: { $each: ["✖ Interrupted: the worker restarted. The live site keeps its last working version."], $slice: -MAX_LOG_LINES } },
        $inc: { logCount: 1 },
      },
    );
    if (job.kind === "create") continue;
    await vpsctl(["recover", job.project], { timeoutMs: 60_000 }).catch((e) => stamp(`recover ${job.project} failed: ${(e as Error).message}`));
  }
}

async function claimNext(): Promise<JobDoc | null> {
  const jobs = await jobsCollection();
  const busy = await jobs.distinct("project", { status: "running" });
  return jobs.findOneAndUpdate(
    { status: "queued", project: { $nin: busy } },
    { $set: { status: "running", worker: WORKER_ID, startedAt: new Date(), updatedAt: new Date() } },
    { sort: { createdAt: 1 }, returnDocument: "after" },
  );
}

async function run(job: JobDoc) {
  const jobs = await jobsCollection();
  const id = job._id as ObjectId;
  const plan = planFor(job);
  let pending: string[] = [];
  let chain: Promise<unknown> = Promise.resolve();
  const flush = () => {
    if (!pending.length) return chain;
    const lines = pending;
    pending = [];
    chain = chain.then(() =>
      jobs.updateOne(
        { _id: id },
        { $push: { log: { $each: lines, $slice: -MAX_LOG_LINES } }, $inc: { logCount: lines.length }, $set: { updatedAt: new Date() } },
      ),
    );
    return chain;
  };
  const timer = setInterval(flush, 300);
  const state: Record<string, string> = {};
  const ctx = (index: number): StepContext => ({
    log: (line) => pending.push(line.slice(0, 2000)),
    detail: (text) => {
      if (index >= 0) void jobs.updateOne({ _id: id }, { $set: { [`steps.${index}.detail`]: text.slice(0, 300) } });
    },
    state,
  });
  const setStep = (i: number, patch: Partial<JobStep>) =>
    jobs.updateOne({ _id: id }, { $set: Object.fromEntries(Object.entries(patch).map(([k, v]) => [`steps.${i}.${k}`, v])) });

  let failed: string | null = null;
  for (let i = 0; i < plan.steps.length; i++) {
    await setStep(i, { status: "running", startedAt: new Date() });
    pending.push(`▸ ${plan.steps[i].label}`);
    try {
      const result = await plan.steps[i].run(ctx(i));
      await flush();
      await setStep(i, { status: result === "skipped" ? "skipped" : "done", endedAt: new Date() });
    } catch (e) {
      failed = (e as Error).message || "Step failed";
      pending.push(`✖ ${failed}`);
      await flush();
      await setStep(i, { status: "failed", endedAt: new Date(), detail: failed.slice(0, 300) });
      for (let j = i + 1; j < plan.steps.length; j++) await setStep(j, { status: "skipped" });
      break;
    }
  }
  if (failed && plan.onFail) {
    pending.push("▸ Rolling back");
    try {
      await plan.onFail(ctx(-1));
      pending.push("Rolled back. Nothing was left on the server.");
    } catch (e) {
      pending.push(`Rollback problem: ${(e as Error).message}`);
    }
  }
  if (!failed) pending.push("✔ Finished");
  await flush();
  clearInterval(timer);
  const params = job.kind === "create" || job.kind === "app-add" ? { ...job.params, envSealed: "" } : job.params;
  await jobs.updateOne(
    { _id: id },
    { $set: { status: failed ? "failed" : "done", error: failed ?? undefined, params, finishedAt: new Date(), updatedAt: new Date() } },
  );
  if (failed) {
    await notify({
      tone: "bad",
      title: `${job.title} failed`,
      body: failed.slice(0, 300),
      href: `/jobs/${id.toHexString()}`,
    }).catch(() => undefined);
  }
  await audit({
    actor: job.actor,
    action: job.kind === "create" ? "create-site" : job.kind,
    target: job.project,
    result: failed ? "failed" : "ok",
    detail: failed ? failed.slice(0, 200) : job.title,
  });
  stamp(`job ${id} ${failed ? "failed" : "done"}`);
  if (job.kind === "shipyard-update" && !failed) {
    stamp("restarting the worker to load the new version");
    await vpsctl(["shipyard-restart", "worker"]).catch((e) => stamp(`worker restart failed: ${(e as Error).message}`));
  }
}

async function main() {
  try {
    process.loadEnvFile(".env");
  } catch {}
  stamp(`shipyard-worker ${WORKER_ID} starting`);
  await recoverInterrupted();
  let monitoring = false;
  const runMonitor = async () => {
    if (monitoring || stopping) return;
    monitoring = true;
    const started = Date.now();
    try {
      await monitorTick();
    } catch (e) {
      stamp(`monitor error: ${(e as Error).message}`);
    }
    try {
      await maintenanceTick();
    } catch (e) {
      stamp(`maintenance error: ${(e as Error).message}`);
    } finally {
      monitoring = false;
      if (Date.now() - started > 30_000) stamp(`monitor tick took ${Date.now() - started} ms`);
    }
  };
  setTimeout(runMonitor, 5_000);
  setInterval(runMonitor, 60_000);
  process.on("SIGTERM", () => (stopping = true));
  process.on("SIGINT", () => (stopping = true));
  while (!stopping) {
    let job: JobDoc | null = null;
    try {
      job = await claimNext();
    } catch (e) {
      stamp(`queue error: ${(e as Error).message}`);
    }
    if (job) {
      stamp(`job ${job._id} ${job.kind} ${job.project}`);
      await run(job).catch((e) => stamp(`job ${job?._id} crashed: ${(e as Error).message}`));
      continue;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  stamp("shipyard-worker stopped");
  process.exit(0);
}

void main();
