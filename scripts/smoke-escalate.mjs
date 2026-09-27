#!/usr/bin/env node
const AUTH = {
  authorization: "Bearer jzg_demo_secret",
  "x-tenant-id": "dev",
  "content-type": "application/json",
};

async function guard(agent, command) {
  const res = await fetch("http://127.0.0.1:8787/v1/guard", {
    method: "POST",
    headers: { ...AUTH, "x-agent-id": agent },
    body: JSON.stringify({ command, rationale: "smoke" }),
  });
  return { status: res.status, body: await res.json() };
}

const junior = await guard("cursor-junior", "cat ~/.ssh/id_rsa");
console.log("junior dangerous", {
  allowed: junior.body.allowed,
  decision: junior.body.decision,
  zk: junior.body.zk_level,
  required: junior.body.requiredClearance,
  ticket: junior.body.escalation?.ticketId,
  clearance: junior.body.agent?.clearance,
});

const ticketId = junior.body.escalation?.ticketId;
if (!ticketId) {
  console.error("FAIL: expected escalation ticket");
  process.exit(1);
}

const denyJunior = await fetch(
  `http://127.0.0.1:8787/v1/escalations/${ticketId}/decide`,
  {
    method: "POST",
    headers: { ...AUTH, "x-agent-id": "cursor-junior" },
    body: JSON.stringify({ decision: "approve" }),
  },
);
console.log("junior decide", denyJunior.status, await denyJunior.json());

const inbox = await fetch("http://127.0.0.1:8787/v1/escalations?status=open", {
  headers: { ...AUTH, "x-agent-id": "cursor-lead" },
});
const inboxBody = await inbox.json();
console.log("lead inbox count", inboxBody.count);

const decide = await fetch(
  `http://127.0.0.1:8787/v1/escalations/${ticketId}/decide`,
  {
    method: "POST",
    headers: { ...AUTH, "x-agent-id": "cursor-lead" },
    body: JSON.stringify({ decision: "deny", note: "secrets never leave" }),
  },
);
const decideBody = await decide.json();
console.log("lead deny", {
  ok: decideBody.ok,
  allowed: decideBody.allowed,
  status: decideBody.ticket?.status,
  sig: decideBody.ticket?.signature?.slice(0, 16),
});

const ok = await guard("cursor-junior", "ls -la");
console.log("junior ls", { allowed: ok.body.allowed, decision: ok.body.decision });

// hook unit
import { spawnSync } from "node:child_process";
const hook = "/home/tianyu/jev-zk-guard/.cursor/hooks/jev-guard.mjs";
for (const cmd of ["ls -la", "cat ~/.ssh/id_rsa"]) {
  const r = spawnSync("node", [hook], {
    input: JSON.stringify({ command: cmd }),
    encoding: "utf8",
    env: { ...process.env, JEV_GUARD_URL: "http://127.0.0.1:8787" },
  });
  console.log("hook", cmd, r.stdout.trim());
}

console.log("SMOKE_OK");
