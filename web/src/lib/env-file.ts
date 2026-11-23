import "server-only";
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const KEY = /^[A-Z][A-Z0-9_]*$/;

export function updateEnvFile(updates: Record<string, string>, file = path.join(/* turbopackIgnore: true */ process.cwd(), ".env")): void {
  for (const [k, v] of Object.entries(updates)) {
    if (!KEY.test(k) || /[\r\n]/.test(v)) throw new Error(`Refusing to write ${k}`);
  }
  const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n") : [];
  const seen = new Set<string>();
  const out = lines.map((line) => {
    const k = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=/)?.[1];
    if (k && k in updates) {
      seen.add(k);
      return `${k}=${updates[k]}`;
    }
    return line;
  });
  while (out.length && out[out.length - 1].trim() === "") out.pop();
  for (const [k, v] of Object.entries(updates)) if (!seen.has(k)) out.push(`${k}=${v}`);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, out.join("\n").replace(/\n*$/, "\n"), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  for (const [k, v] of Object.entries(updates)) process.env[k] = v;
}
