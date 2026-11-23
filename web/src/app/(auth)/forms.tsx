"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { IconAlertCircle, IconArrowRight } from "@tabler/icons-react";
import { requestCode, verifyCode, type LoginState } from "./actions";

const primary =
  "flex h-11 w-full items-center justify-center rounded-lg bg-fg px-3 text-sm font-medium text-invert hover:opacity-90 disabled:opacity-60";

function maskEmail(email = "") {
  const [user, domain] = email.split("@");
  if (!domain) return email;
  return `${user.slice(0, 1)}${"•".repeat(Math.max(2, Math.min(user.length - 1, 6)))}@${domain}`;
}

function ErrorText({ children }: { children?: string }) {
  if (!children) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-lg border border-bad/30 bg-bad-bg px-3 py-2 text-sm text-bad-fg">
      <IconAlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
      {children}
    </p>
  );
}

function CodeBoxes({ onComplete, disabled }: { onComplete: () => void; disabled: boolean }) {
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const fill = (start: number, value: string) => {
    const chars = value.replace(/\D/g, "").slice(0, 6 - start).split("");
    if (!chars.length) return;
    const next = [...digits];
    chars.forEach((c, i) => (next[start + i] = c));
    setDigits(next);
    const last = Math.min(start + chars.length, 5);
    refs.current[last]?.focus();
    if (next.every((d) => d)) setTimeout(onComplete, 0);
  };

  return (
    <div className="flex justify-between gap-2" role="group" aria-label="6-digit code">
      <input type="hidden" name="code" value={digits.join("")} />
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={d}
          autoFocus={i === 0}
          disabled={disabled}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${i + 1}`}
          maxLength={6}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) {
              const next = [...digits];
              next[i] = "";
              setDigits(next);
              return;
            }
            fill(i, v.length > 2 ? v : v.slice(-1));
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus();
            if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
            if (e.key === "ArrowRight" && i < 5) refs.current[i + 1]?.focus();
          }}
          onPaste={(e) => {
            e.preventDefault();
            fill(i, e.clipboardData.getData("text"));
          }}
          onFocus={(e) => e.target.select()}
          className="h-12 w-full min-w-0 rounded-lg border border-line bg-surface text-center text-xl font-semibold tabular-nums caret-transparent outline-none transition-[border-color,box-shadow] hover:border-line-strong focus:border-fg/40 focus:ring-4 focus:ring-fg/[0.06] disabled:opacity-60"
        />
      ))}
    </div>
  );
}

function useCountdown(sentAt?: number, gap = 60) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return sentAt ? Math.max(0, gap - Math.floor((now - sentAt) / 1000)) : 0;
}

export function LoginForm() {
  const [sent, sendAction, sending] = useActionState<LoginState, FormData>(requestCode, { step: "email" });
  const [checked, verifyAction, verifying] = useActionState<LoginState, FormData>(verifyCode, { step: "code" });
  const [editing, setEditing] = useState(false);
  const verifyForm = useRef<HTMLFormElement>(null);
  const wait = useCountdown(sent.sentAt);
  const onCode = sent.step === "code" && !editing;

  if (!onCode) {
    return (
      <form
        action={(fd) => {
          setEditing(false);
          sendAction(fd);
        }}
        className="space-y-4"
      >
        <div className="mb-6 text-center">
          <h1 className="text-[28px] font-semibold tracking-tight">Welcome back.</h1>
          <p className="mt-1.5 text-sm text-muted">Sign in with the code we email you.</p>
        </div>
        <label className="block">
          <span className="sr-only">Email</span>
          <input
            name="email"
            type="email"
            defaultValue={sent.email}
            autoComplete="email"
            placeholder="name@example.com"
            required
            autoFocus
            className="h-11 w-full rounded-lg border border-line bg-surface px-3.5 text-sm outline-none transition-[border-color,box-shadow] placeholder:text-faint hover:border-line-strong focus:border-fg/40 focus:ring-4 focus:ring-fg/[0.06]"
          />
        </label>
        <ErrorText>{sent.error}</ErrorText>
        <button type="submit" disabled={sending} className={primary}>
          {sending ? (
            "Sending code…"
          ) : (
            <span className="inline-flex items-center gap-1.5">
              Send code <IconArrowRight size={15} aria-hidden />
            </span>
          )}
        </button>
      </form>
    );
  }

  return (
    <div className="space-y-5">
      <div className="text-center">
        <h1 className="text-[28px] font-semibold tracking-tight">Check your email.</h1>
        <p className="mt-1.5 text-sm text-muted">
          Code sent to <span className="font-medium text-fg">{maskEmail(sent.email)}</span> ·{" "}
          <button type="button" onClick={() => setEditing(true)} className="font-medium text-fg underline underline-offset-2 hover:opacity-80">
            change
          </button>
          <br />
          It expires in 10 minutes.
        </p>
        {sent.notice && <p className="mt-2 text-sm text-muted">{sent.notice}</p>}
      </div>
      <form ref={verifyForm} action={verifyAction} className="space-y-4">
        <input type="hidden" name="email" value={sent.email} />
        <CodeBoxes key={`${sent.sentAt}-${checked.error ?? ""}`} onComplete={() => verifyForm.current?.requestSubmit()} disabled={verifying} />
        <ErrorText>{checked.error}</ErrorText>
        <button type="submit" disabled={verifying} className={primary}>
          {verifying ? "Checking…" : "Sign in"}
        </button>
      </form>
      <form action={sendAction} className="text-center text-sm text-muted">
        <input type="hidden" name="email" value={sent.email} />
        {wait > 0 ? (
          <span>Resend code in {wait}s</span>
        ) : (
          <>
            Didn&apos;t get it? Check spam, or{" "}
            <button type="submit" disabled={sending} className="font-medium text-fg underline-offset-2 hover:underline">
              {sending ? "sending…" : "send a new code"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
