import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.PORT ?? "8787";

let pids = [];
try {
  const out = execSync(`ss -tlnp 'sport = :${PORT}'`, { encoding: "utf8" });
  for (const m of out.matchAll(/pid=(\d+)/g)) pids.push(m[1]);
} catch {
  /* empty */
}
pids = [...new Set(pids)];
for (const pid of pids) {
  try {
    process.kill(Number(pid), "SIGTERM");
    console.log("stopped", pid);
  } catch (e) {
    console.log("skip", pid, e instanceof Error ? e.message : e);
  }
}
await new Promise((r) => setTimeout(r, 800));

const child = spawn("npx", ["tsx", "src/server.ts"], {
  cwd: root,
  env: { ...process.env, PORT },
  stdio: "inherit",
  detached: true,
});
child.unref();
console.log("started pid", child.pid, "port", PORT);
