import type { Metadata } from "next";
import { IconHistory } from "@tabler/icons-react";
import { requireUser } from "@/lib/auth";
import { collections } from "@/lib/db";
import { dateTime } from "@/lib/format";
import { Badge, Card, EmptyState, PageHeader, Td, Th } from "@/components/ui";

export const metadata: Metadata = { title: "History" };

const LABEL: Record<string, string> = {
  login: "Sign in",
  logout: "Sign out",
  "login-code": "Sign-in code",
};

export default async function HistoryPage() {
  await requireUser();
  const { auditLog } = await collections();
  const rows = await auditLog.find().sort({ at: -1 }).limit(200).toArray();
  return (
    <>
      <PageHeader title="History" sub="Everything done through Shipyard, newest first" />
      <Card flush>
        {rows.length === 0 ? (
          <EmptyState icon={<IconHistory size={28} aria-hidden />} title="No activity yet">
            Sign-ins and actions will appear here.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-subtle/60">
                <tr>
                  <Th>When</Th>
                  <Th>Action</Th>
                  <Th>Result</Th>
                  <Th>By</Th>
                  <Th>From</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r._id!.toString()}>
                    <Td className="whitespace-nowrap text-muted">{dateTime(r.at)}</Td>
                    <Td>
                      <div className="font-medium">{LABEL[r.action] ?? r.action}{r.target ? ` · ${r.target}` : ""}</div>
                      {r.detail && <div className="text-xs text-faint">{r.detail}</div>}
                    </Td>
                    <Td>
                      <Badge tone={r.result === "ok" ? "ok" : r.result === "refused" ? "warn" : "bad"}>
                        {r.result === "ok" ? "Done" : r.result === "refused" ? "Refused" : "Failed"}
                      </Badge>
                    </Td>
                    <Td className="max-w-48 truncate text-muted">{r.actor}</Td>
                    <Td className="text-muted tabular-nums">{r.ip ?? "-"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
