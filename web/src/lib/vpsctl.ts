import "server-only";
import { spawn } from "node:child_process";
import { env } from "./env";

const VPSCTL = "/usr/local/sbin/vpsctl";
const SAFE_ARG = /^[A-Za-z0-9._/-]{1,100}$/;

export class VpsctlError extends Error {}

function shQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

function command(args: string[]): [string, string[]] {
  for (const arg of args) {
    if (!SAFE_ARG.test(arg)) throw new VpsctlError(`unsafe argument: ${arg}`);
  }
  if (env.vpsctlMode() === "ssh") {
    return [
      "ssh",
      [
        "-p", env.sshPort(),
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=10",
        "-o", "ServerAliveInterval=30",
        env.sshHost(),
        ["sudo", "-n", VPSCTL, ...args].map(shQuote).join(" "),
      ],
    ];
  }
  return ["sudo", ["-n", VPSCTL, ...args]];
}

type RunOptions = { input?: string; onLog?: (line: string) => void; timeoutMs?: number };

export function vpsctl<T>(args: string[], opts: RunOptions = {}): Promise<T> {
  const { input, onLog, timeoutMs = 30_000 } = opts;
  const [file, argv] = command(args);
  return new Promise<T>((resolve, reject) => {
    const child = spawn(file, argv, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderrBuf = "";
    let stderrTail = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new VpsctlError("timed out waiting for the server"));
    }, timeoutMs);

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderrBuf += d.toString();
      const lines = stderrBuf.split("\n");
      stderrBuf = lines.pop() ?? "";
      for (const line of lines) {
        onLog?.(line);
        stderrTail = (stderrTail + "\n" + line).slice(-2000);
      }
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new VpsctlError(err.message));
    });
    child.on("close", () => {
      clearTimeout(timer);
      if (stderrBuf) onLog?.(stderrBuf);
      const last = stdout.trim().split("\n").pop() ?? "";
      let parsed: { ok: boolean; data?: T; error?: string };
      try {
        parsed = JSON.parse(last);
      } catch {
        return reject(new VpsctlError(stderrTail.trim().split("\n").pop() || "the server helper returned no result"));
      }
      if (!parsed.ok) return reject(new VpsctlError(parsed.error || "the server helper refused the request"));
      resolve(parsed.data as T);
    });

    child.stdin.end(input ?? "");
  });
}
