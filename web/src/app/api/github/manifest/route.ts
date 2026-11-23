import { writeFileSync, chmodSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { githubConfigured } from "@/lib/github";
import { safeEqual } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { updateEnvFile } from "@/lib/env-file";
import { vpsctl } from "@/lib/vpsctl";

export const dynamic = "force-dynamic";

type Conversion = { id: number; slug: string; pem: string; webhook_secret: string | null; owner?: { login: string } };

function fail(message: string, status = 400) {
  return new NextResponse(`${message}\n\nGo back to Settings and try Connect GitHub again.`, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if (githubConfigured()) return NextResponse.redirect(new URL("/settings", request.url));

  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const cookie = request.headers.get("cookie")?.match(/(?:^|;\s*)shipyard_gh_state=([^;]+)/)?.[1] ?? "";
  if (!state || !cookie || !safeEqual(state, cookie)) return fail("This GitHub setup link has expired or didn't start here.");
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(code)) return fail("GitHub didn't send a valid code.");

  const res = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
    method: "POST",
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "shipyard-panel" },
    cache: "no-store",
  });
  if (!res.ok) return fail(`GitHub refused to finish the setup (HTTP ${res.status}).`, 502);
  const app = (await res.json()) as Conversion;
  if (!app.id || !app.slug || !app.pem) return fail("GitHub's answer was missing the app details.", 502);

  const keyPath =
    process.env.GITHUB_APP_PRIVATE_KEY_PATH || (env.vpsctlMode() === "local" ? "/srv/panel/github-app.pem" : path.join(process.cwd(), "github-app.pem"));
  writeFileSync(keyPath, app.pem, { mode: 0o600 });
  chmodSync(keyPath, 0o600);
  updateEnvFile({
    GITHUB_APP_ID: String(app.id),
    GITHUB_APP_SLUG: app.slug,
    GITHUB_APP_PRIVATE_KEY_PATH: keyPath,
    GITHUB_WEBHOOK_SECRET: app.webhook_secret ?? "",
  });
  await audit({
    actor: user.email,
    action: "github-app-created",
    target: app.slug,
    result: "ok",
    detail: `app ${app.id}${app.owner ? ` for ${app.owner.login}` : ""}`,
  });
  if (env.vpsctlMode() === "local") setTimeout(() => void vpsctl(["shipyard-restart", "worker"]).catch(() => undefined), 500);

  const done = NextResponse.redirect(`https://github.com/apps/${app.slug}/installations/new`);
  done.cookies.set("shipyard_gh_state", "", { path: "/api/github/manifest", maxAge: 0 });
  return done;
}
