import Link from "next/link";
import { IconCompass } from "@tabler/icons-react";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-sm text-center">
        <IconCompass size={36} className="mx-auto text-faint" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold">Page not found</h1>
        <p className="mt-1 text-sm text-muted">This page doesn&apos;t exist, or the site was renamed or removed.</p>
        <Link href="/" className="mt-5 inline-flex rounded-lg bg-fg px-3.5 py-2 text-sm font-medium text-invert hover:opacity-90">
          Back to overview
        </Link>
      </div>
    </main>
  );
}
