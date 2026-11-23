import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getJob } from "@/lib/jobs";
import { dateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui";
import { JobLive } from "@/components/job-live";

export const metadata: Metadata = { title: "Job" };

export default async function JobPage({ params }: PageProps<"/jobs/[id]">) {
  await requireUser();
  const { id } = await params;
  const job = await getJob(id);
  if (!job) notFound();
  const iso = (d?: Date) => (d ? d.toISOString() : undefined);

  return (
    <>
      <PageHeader title={job.title} back={{ href: "/sites", label: "Sites" }} sub={`Started ${dateTime(job.createdAt)} by ${job.actor}`} />
      <JobLive
        key={`${job.status}-${job.logCount ?? job.log.length}`}
        initial={{
          id,
          kind: job.kind,
          project: job.project,
          status: job.status,
          error: job.error ?? null,
          steps: job.steps.map((s) => ({ ...s, startedAt: iso(s.startedAt), endedAt: iso(s.endedAt) })),
          log: job.log,
          logCount: job.logCount ?? job.log.length,
          domain: job.summary?.domain,
        }}
      />
    </>
  );
}
