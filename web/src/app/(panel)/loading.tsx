export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="mb-6 space-y-2">
        <div className="skeleton h-6 w-40" />
        <div className="skeleton h-4 w-64" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-line bg-surface p-4">
            <div className="skeleton h-3 w-16" />
            <div className="skeleton mt-3 h-7 w-20" />
            <div className="skeleton mt-3 h-1.5 w-full" />
          </div>
        ))}
      </div>
      <div className="mt-6 overflow-hidden rounded-xl border border-line bg-surface">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-line px-4 py-4 last:border-0">
            <div className="skeleton h-4 w-48" />
            <div className="skeleton h-4 w-16" />
            <div className="skeleton ml-auto h-4 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
