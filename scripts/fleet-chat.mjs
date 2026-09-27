#!/usr/bin/env node
/**
 * CLI: route a goal through local fleet orchestrator.
 * Usage: node scripts/fleet-chat.mjs "Add healthcheck and refactor auth"
 *    or: npm run fleet -- "..."
 *
 * Env: JEV_GUARD_URL, GUARD_API_SECRET, JEV_TENANT_ID, JEV_AGENT_ID
 */
const goal = process.argv.slice(2).join(" ").trim();
if (!goal) {
  console.error('Usage: npm run fleet -- "your goal"');
  process.exit(1);
}

const base = (process.env.JEV_GUARD_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const secret = process.env.GUARD_API_SECRET ?? "jzg_demo_secret";
const tenant = process.env.JEV_TENANT_ID ?? "dev";
const agent = process.env.JEV_AGENT_ID ?? "fleet-console";

const res = await fetch(`${base}/v1/fleet/chat`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${secret}`,
    "x-tenant-id": tenant,
    "x-agent-id": agent,
  },
  body: JSON.stringify({ message: goal }),
  signal: AbortSignal.timeout(120_000),
});

const data = await res.json();
if (!res.ok) {
  console.error(JSON.stringify(data, null, 2));
  process.exit(1);
}

// Human summary for the agent
const lines = [
  `runId: ${data.runId}`,
  `approved: ${data.approved}`,
  "",
  "## Timeline",
];
for (const s of data.steps ?? []) {
  const c = s.complexity
    ? ` [${s.complexity.bucket} ${Number(s.complexity.complexity).toFixed(2)}]`
    : "";
  lines.push(`- [${s.phase}] ${s.agentId}/${s.role}${c}: ${s.title}`);
  if (s.detail) {
    const d = String(s.detail).split("\n")[0];
    lines.push(`  ${d}`);
  }
}
lines.push("", "## Lead reply", data.reply ?? "");
console.log(lines.join("\n"));
console.log("\n--- json ---");
console.log(JSON.stringify(data, null, 2));
