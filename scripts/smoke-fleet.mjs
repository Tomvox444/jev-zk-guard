const AUTH = {
  authorization: "Bearer jzg_demo_secret",
  "x-tenant-id": "dev",
  "x-agent-id": "fleet-console",
  "content-type": "application/json",
};

const res = await fetch("http://127.0.0.1:8787/v1/fleet/chat", {
  method: "POST",
  headers: AUTH,
  body: JSON.stringify({
    message: "Add a healthcheck endpoint and refactor auth",
  }),
});
const data = await res.json();
if (!res.ok) {
  console.error(data);
  process.exit(1);
}

const phases = data.steps.map((s) => s.phase);
const roles = data.steps.filter((s) => s.phase === "execute").map((s) => s.role);
console.log({
  status: res.status,
  runId: data.runId,
  approved: data.approved,
  phases,
  executeRoles: roles,
  scoreBuckets: data.steps
    .filter((s) => s.complexity)
    .map((s) => s.complexity.bucket),
  replyHead: String(data.reply).slice(0, 120),
});

const need = ["plan", "score", "execute", "finalize"];
for (const p of need) {
  if (!phases.includes(p)) {
    console.error("missing phase", p);
    process.exit(1);
  }
}
console.log("FLEET_SMOKE_OK");
