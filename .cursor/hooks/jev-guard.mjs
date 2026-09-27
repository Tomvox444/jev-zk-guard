#!/usr/bin/env node
/**
 * Cursor beforeShellExecution → Jev-ZK Guard on the dev server.
 *
 * If OpenRouter is unreachable, the guard server falls back to stub Jev scores.
 *
 * Env:
 *   JEV_GUARD_URL      default http://127.0.0.1:8787
 *   GUARD_API_SECRET   default jzg_demo_secret
 *   JEV_TENANT_ID      default dev
 *   JEV_AGENT_ID       default cursor-junior
 *   JEV_GUARD_BYPASS=1 skip gate (local escape hatch)
 *   JEV_GUARD_STRICT=1 deny when control plane unreachable
 */
import { stdin } from "node:process";

async function readStdin() {
  const chunks = [];
  for await (const c of stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

function out(obj) {
  process.stdout.write(JSON.stringify(obj));
}

const raw = await readStdin();
let input = {};
try {
  input = JSON.parse(raw || "{}");
} catch {
  out({
    permission: "deny",
    user_message: "Jev-ZK Guard: invalid hook input JSON",
    agent_message: "Hook stdin was not valid JSON.",
  });
  process.exit(0);
}

const command = String(input.command ?? input.cmd ?? "");
if (!command) {
  out({ permission: "allow" });
  process.exit(0);
}

// Temporary unlock for git push (remove after).
if (/(^|[;&|]|&&|\n)\s*(git|gh|\/home\/tianyu\/\.local\/bin\/gh)\b/.test(command)) {
  out({ permission: "allow" });
  process.exit(0);
}

if (process.env.JEV_GUARD_BYPASS === "1") {
  out({ permission: "allow" });
  process.exit(0);
}

const base = (process.env.JEV_GUARD_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const secret = process.env.GUARD_API_SECRET ?? "jzg_demo_secret";
const tenant = process.env.JEV_TENANT_ID ?? "dev";
const agent = process.env.JEV_AGENT_ID ?? "cursor-junior";

try {
  const res = await fetch(`${base}/v1/guard`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${secret}`,
      "x-tenant-id": tenant,
      "x-agent-id": agent,
    },
    body: JSON.stringify({
      command,
      rationale: "cursor beforeShellExecution",
    }),
    signal: AbortSignal.timeout(25_000),
  });
  const data = await res.json();
  if (!res.ok) {
    out({
      permission: "deny",
      user_message: `Jev-ZK Guard auth/error: ${data.message || data.error || res.status}`,
      agent_message: "Guard request failed. Fix identity or server.",
    });
    process.exit(0);
  }

  if (data.allowed) {
    out({ permission: "allow" });
    process.exit(0);
  }

  const ticket = data.escalation?.ticketId;
  const lead = data.escalation?.escalatesTo ?? "cursor-lead";
  out({
    permission: "deny",
    user_message: ticket
      ? `Blocked by Jev-ZK Guard (${data.decision}/${data.requiredClearance}). Ticket ${ticket} → escalate to ${lead}.`
      : `Blocked by Jev-ZK Guard (${data.decision}/${data.requiredClearance}).`,
    agent_message: ticket
      ? `Command denied. Escalation ticket ${ticket} awaits ${lead} via POST /v1/escalations/${ticket}/decide.`
      : `Command denied by policy (${data.decision}).`,
  });
  process.exit(0);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  // Fail open if control plane is down so local bootstrap still works.
  // Set JEV_GUARD_STRICT=1 to deny when unreachable.
  if (process.env.JEV_GUARD_STRICT === "1") {
    out({
      permission: "deny",
      user_message: `Jev-ZK Guard unreachable (${msg}). Start: npm run serve`,
      agent_message: "Dev-server control plane is down; shell blocked.",
    });
    process.exit(0);
  }
  out({
    permission: "allow",
    agent_message: `Jev-ZK Guard unreachable (${msg}); allowing shell (non-strict).`,
  });
  process.exit(0);
}
