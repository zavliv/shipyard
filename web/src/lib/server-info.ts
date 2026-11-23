import "server-only";
import { execFile } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { env } from "./env";

let cachedIp: string | null = null;

export async function serverIp(): Promise<string> {
  if (process.env.SERVER_IP) return process.env.SERVER_IP;
  if (cachedIp) return cachedIp;
  const sshIp = env.sshHost().split("@").pop() ?? "";
  if (env.vpsctlMode() === "ssh" && /^\d+\.\d+\.\d+\.\d+$/.test(sshIp)) return (cachedIp = sshIp);
  const ip = await new Promise<string>((resolve) =>
    execFile("ip", ["-4", "route", "get", "1.1.1.1"], { timeout: 3000 }, (err, out) =>
      resolve(err ? "" : (out.match(/\bsrc\s+(\d+\.\d+\.\d+\.\d+)/)?.[1] ?? "")),
    ),
  );
  if (ip) cachedIp = ip;
  return ip || "this server's IP address";
}

export function panelUrl(path = ""): string {
  return `${(process.env.PANEL_URL || "").replace(/\/+$/, "")}${path}`;
}

export function updateRepo(): { owner: string; name: string } | null {
  const m = (process.env.UPDATE_REPO || "").match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  return m ? { owner: m[1], name: m[2] } : null;
}

export function sshPorts(): number[] {
  const ports = new Set<number>();
  const files = ["/etc/ssh/sshd_config"];
  try {
    for (const f of readdirSync("/etc/ssh/sshd_config.d")) if (f.endsWith(".conf")) files.push(`/etc/ssh/sshd_config.d/${f}`);
  } catch {}
  for (const f of files) {
    try {
      for (const m of readFileSync(f, "utf8").matchAll(/^\s*Port\s+(\d+)/gim)) ports.add(Number(m[1]));
    } catch {}
  }
  if (env.vpsctlMode() === "ssh") ports.add(Number(env.sshPort()));
  return ports.size ? [...ports] : [22];
}
