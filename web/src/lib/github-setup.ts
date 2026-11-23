import { randomBytes } from "node:crypto";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function appManifest(base: string) {
  return {
    name: `Shipyard ${randomBytes(3).toString("hex")}`,
    url: base,
    hook_attributes: { url: `${base}/api/github/webhook`, active: true },
    redirect_url: `${base}/api/github/manifest`,
    public: false,
    default_permissions: { contents: "read", metadata: "read" },
    default_events: ["push"],
  };
}

export function manifestPage(base: string, state: string, org = ""): string {
  const target = org ? `https://github.com/organizations/${org}/settings/apps/new` : "https://github.com/settings/apps/new";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Connecting to GitHub…</title></head>
<body style="font-family:system-ui;padding:40px;color:#444">
<p>Opening GitHub to create the app Shipyard uses…</p>
<form id="f" method="post" action="${esc(target)}?state=${esc(state)}">
<input type="hidden" name="manifest" value="${esc(JSON.stringify(appManifest(base)))}">
<noscript><button>Continue to GitHub</button></noscript>
</form><script>document.getElementById("f").submit()</script></body></html>`;
}
