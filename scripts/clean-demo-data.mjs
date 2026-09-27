#!/usr/bin/env node
/**
 * Wipe local demo artifacts: fleet workspaces/plans, audit logs, escalations.
 * Run: node scripts/clean-demo-data.mjs
 */
import { readdir, unlink, writeFile, lstat, rmdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

async function emptyDir(dir) {
  let names;
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const p = join(dir, name);
    const st = await lstat(p);
    if (st.isDirectory()) {
      await emptyDir(p);
      await rmdir(p);
    } else {
      await unlink(p);
    }
  }
}

await emptyDir(join(root, "fleet", "workspaces"));
await emptyDir(join(root, "fleet", "plans"));
await writeFile(join(root, "audit", "dev.jsonl"), "");
await writeFile(join(root, "audit", "acme.jsonl"), "");
await writeFile(join(root, "escalations", "dev.json"), "[]\n");
await writeFile(join(root, "escalations", "acme.json"), "[]\n");

const ws = await readdir(join(root, "fleet", "workspaces"));
const plans = await readdir(join(root, "fleet", "plans"));
console.log(`cleaned: workspaces=${ws.length} plans=${plans.length}`);
