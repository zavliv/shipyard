import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { githubConfigured } from "@/lib/github";
import { panelUrl } from "@/lib/server-info";
import { env } from "@/lib/env";
import { manifestPage } from "@/lib/github-setup";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));
  if (githubConfigured()) return NextResponse.redirect(new URL("/settings", request.url));
  const base = panelUrl();
  if (!/^https:\/\//.test(base)) return new NextResponse("Set PANEL_URL (https://…) in the panel's .env first, then restart the panel.", { status: 400 });

  const org = new URL(request.url).searchParams.get("org") ?? "";
  if (org && !/^[A-Za-z0-9-]{1,39}$/.test(org)) return new NextResponse("Invalid organization name.", { status: 400 });
  const state = randomBytes(24).toString("base64url");
  const html = manifestPage(base, state, org);
  const res = new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  res.cookies.set("shipyard_gh_state", state, { httpOnly: true, secure: env.production, sameSite: "lax", path: "/api/github/manifest", maxAge: 3600 });
  return res;
}
