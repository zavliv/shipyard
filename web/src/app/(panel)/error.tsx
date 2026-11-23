"use client";

import { IconPlugConnectedX, IconRefresh } from "@tabler/icons-react";

export default function PanelError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto mt-10 max-w-md rounded-xl border border-line bg-surface p-6 text-center">
      <IconPlugConnectedX size={32} className="mx-auto text-bad" aria-hidden />
      <h2 className="mt-3 font-semibold">Couldn&apos;t reach the server</h2>
      <p className="mt-1 text-sm text-muted">
        Shipyard couldn&apos;t load data from the server helper or the database. Your sites keep running. Check your connection and try again.
      </p>
      {error.digest && <p className="mt-2 font-mono text-xs text-faint">Ref {error.digest}</p>}
      <button
        onClick={reset}
        className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-fg px-3.5 py-2 text-sm font-medium text-invert hover:opacity-90"
      >
        <IconRefresh size={16} aria-hidden />
        Try again
      </button>
    </div>
  );
}
