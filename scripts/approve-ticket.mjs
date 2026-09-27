const id = process.argv[2];
if (!id) {
  console.error("usage: node scripts/approve-ticket.mjs <ticketId>");
  process.exit(1);
}
const res = await fetch(`http://127.0.0.1:8787/v1/escalations/${id}/decide`, {
  method: "POST",
  headers: {
    authorization: "Bearer jzg_demo_secret",
    "x-tenant-id": "dev",
    "x-agent-id": "cursor-lead",
    "content-type": "application/json",
  },
  body: JSON.stringify({ decision: "approve", note: "ops" }),
});
console.log(await res.json());
