import "server-only";
import { ObjectId, type Collection } from "mongodb";
import { collections } from "./db";

export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";
export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";
export type JobKind = "create" | "deploy" | "rollback" | "restart" | "rebuild" | "domain-add" | "domain-remove" | "delete" | "backup" | "restore" | "shipyard-update" | "app-add" | "app-remove";

export type JobStep = { key: string; label: string; status: StepStatus; startedAt?: Date; endedAt?: Date; detail?: string };

export type JobDoc = {
  _id?: ObjectId;
  kind: JobKind;
  project: string;
  title: string;
  actor: string;
  status: JobStatus;
  params: Record<string, unknown>;
  steps: JobStep[];
  log: string[];
  logCount: number;
  error?: string;
  summary?: Record<string, string>;
  worker?: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  finishedAt?: Date;
};

export const KEEP_FINISHED_DAYS = 30;
export const RETRYABLE: JobKind[] = ["deploy", "rollback", "restart", "rebuild", "backup", "domain-add", "domain-remove", "shipyard-update"];

let indexesReady: Promise<unknown> | null = null;

export async function jobsCollection(): Promise<Collection<JobDoc>> {
  const { db } = await collections();
  const jobs = db.collection<JobDoc>("jobs");
  indexesReady ??= Promise.all([
    jobs.createIndex({ project: 1, createdAt: -1 }),
    jobs.createIndex({ status: 1, createdAt: 1 }),
    jobs.createIndex({ createdAt: -1 }),
    jobs.createIndex({ finishedAt: 1 }, { expireAfterSeconds: KEEP_FINISHED_DAYS * 86400, name: "finished_ttl" }),
  ]);
  await indexesReady;
  return jobs;
}

export async function enqueueJob(init: {
  kind: JobKind;
  project: string;
  title: string;
  actor: string;
  params: Record<string, unknown>;
  steps: { key: string; label: string }[];
  summary?: Record<string, string>;
}): Promise<string> {
  const jobs = await jobsCollection();
  const now = new Date();
  const res = await jobs.insertOne({
    kind: init.kind,
    project: init.project,
    title: init.title,
    actor: init.actor,
    params: init.params,
    summary: init.summary,
    status: "queued",
    steps: init.steps.map((s) => ({ ...s, status: "pending" })),
    log: [],
    logCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  return res.insertedId.toHexString();
}

export async function getJob(id: string, withLog = true): Promise<JobDoc | null> {
  if (!ObjectId.isValid(id)) return null;
  const jobs = await jobsCollection();
  return jobs.findOne({ _id: new ObjectId(id) }, withLog ? {} : { projection: { log: 0 } });
}

export async function getJobLogSince(id: string, from: number): Promise<{ job: JobDoc; lines: string[] } | null> {
  if (!ObjectId.isValid(id)) return null;
  const jobs = await jobsCollection();
  const job = await jobs.findOne({ _id: new ObjectId(id) }, { projection: { log: 0 } });
  if (!job) return null;
  const total = job.logCount ?? 0;
  if (total <= from) return { job, lines: [] };
  const withSlice = await jobs.findOne(
    { _id: new ObjectId(id) },
    { projection: { log: { $slice: [Math.max(0, from - Math.max(0, total - 4000)), total - from] } } },
  );
  return { job, lines: withSlice?.log ?? [] };
}

export async function listJobs(project?: string, limit = 20): Promise<JobDoc[]> {
  const jobs = await jobsCollection();
  return jobs
    .find(project ? { project } : {}, { projection: { log: 0, params: 0 } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

export async function activeJobFor(project: string): Promise<JobDoc | null> {
  const jobs = await jobsCollection();
  return jobs.findOne({ project, status: { $in: ["queued", "running"] } }, { projection: { log: 0, params: 0 } });
}

export type JobFilter = { status?: "active" | "done" | "failed" | "cancelled"; project?: string; kind?: JobKind };

export async function listJobsFiltered(f: JobFilter, limit = 100): Promise<JobDoc[]> {
  const jobs = await jobsCollection();
  const q: Record<string, unknown> = {};
  if (f.status === "active") q.status = { $in: ["queued", "running"] };
  else if (f.status) q.status = f.status;
  if (f.project) q.project = f.project;
  if (f.kind) q.kind = f.kind;
  return jobs.find(q, { projection: { log: 0, params: 0 } }).sort({ createdAt: -1 }).limit(limit).toArray();
}

export async function jobCounts(): Promise<{ running: number; queued: number; failed24h: number }> {
  const jobs = await jobsCollection();
  const [running, queued, failed24h] = await Promise.all([
    jobs.countDocuments({ status: "running" }),
    jobs.countDocuments({ status: "queued" }),
    jobs.countDocuments({ status: "failed", finishedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } }),
  ]);
  return { running, queued, failed24h };
}

export async function jobProjects(): Promise<string[]> {
  const jobs = await jobsCollection();
  return ((await jobs.distinct("project")) as string[]).sort();
}

export async function cancelQueuedJob(id: string, actor: string): Promise<boolean> {
  if (!ObjectId.isValid(id)) return false;
  const jobs = await jobsCollection();
  const now = new Date();
  const res = await jobs.updateOne(
    { _id: new ObjectId(id), status: "queued" },
    {
      $set: { status: "cancelled", error: `Cancelled by ${actor}`, finishedAt: now, updatedAt: now, "steps.$[].status": "skipped" },
      $push: { log: "✖ Cancelled before it started" },
      $inc: { logCount: 1 },
    },
  );
  return res.modifiedCount === 1;
}

export async function retryJob(id: string, actor: string): Promise<string> {
  if (!ObjectId.isValid(id)) throw new Error("Job not found.");
  const jobs = await jobsCollection();
  const old = await jobs.findOne({ _id: new ObjectId(id) }, { projection: { log: 0 } });
  if (!old) throw new Error("Job not found.");
  if (old.status !== "failed") throw new Error("Only failed jobs can be retried.");
  if (!RETRYABLE.includes(old.kind)) throw new Error("This kind of job can't be retried from here.");
  const busy = await jobs.findOne({ project: old.project, kind: old.kind, status: { $in: ["queued", "running"] } });
  if (busy) throw new Error("The same job is already waiting or running for this site.");
  return enqueueJob({
    kind: old.kind,
    project: old.project,
    title: old.title,
    actor,
    params: old.params,
    steps: old.steps.map(({ key, label }) => ({ key, label })),
    summary: old.summary,
  });
}
