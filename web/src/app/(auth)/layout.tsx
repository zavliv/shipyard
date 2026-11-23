import { IconLock, IconShip } from "@tabler/icons-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center px-5 py-16">
      <div className="w-full max-w-[320px]">
        <div className="mb-6 flex justify-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-fg text-invert">
            <IconShip size={26} stroke={1.75} aria-hidden />
          </span>
        </div>
        {children}
      </div>
      <p className="absolute inset-x-0 bottom-6 flex items-center justify-center gap-1.5 text-xs text-faint">
        <IconLock size={13} aria-hidden />
        Private panel · every sign-in is logged
      </p>
    </main>
  );
}
