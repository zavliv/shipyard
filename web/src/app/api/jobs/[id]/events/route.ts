import { currentUser } from "@/lib/auth";
import { getJobLogSince } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await currentUser())) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const url = new URL(request.url);
  let cursor = Math.max(0, Number(url.searchParams.get("from") ?? request.headers.get("last-event-id") ?? 0) || 0);
  const encoder = new TextEncoder();
  const started = Date.now();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      request.signal.addEventListener("abort", () => (closed = true));
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(`id: ${cursor}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      let lastSteps = "";
      while (!closed && Date.now() - started < 30 * 60 * 1000) {
        const res = await getJobLogSince(id, cursor).catch(() => null);
        if (!res) {
          send("gone", {});
          break;
        }
        const { job, lines } = res;
        cursor += lines.length;
        const steps = JSON.stringify(job.steps);
        if (lines.length || steps !== lastSteps) {
          lastSteps = steps;
          send("update", { lines, steps: job.steps, status: job.status, error: job.error ?? null, cursor });
        }
        if (job.status === "done" || job.status === "failed" || job.status === "cancelled") {
          send("end", { status: job.status });
          break;
        }
        await new Promise((r) => setTimeout(r, 400));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
