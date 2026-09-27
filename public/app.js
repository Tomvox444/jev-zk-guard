const healthEl = document.getElementById("health");
const healthText = document.getElementById("health-text");
const footerMode = document.getElementById("footer-mode");
const cmdInput = document.getElementById("cmd");
const rationaleInput = document.getElementById("rationale");
const guardOut = document.getElementById("guard-out");
const escalationSteps = document.getElementById("escalation-steps");
const secretInput = document.getElementById("api-secret");
const tenantInput = document.getElementById("tenant-id");
const agentInput = document.getElementById("agent-id");
const stages = [...document.querySelectorAll(".stage")];

const LS = {
  secret: "jzg_api_secret",
  tenant: "jzg_tenant",
  agent: "jzg_agent",
};

function loadCreds() {
  secretInput.value = localStorage.getItem(LS.secret) || "jzg_demo_secret";
  tenantInput.value = localStorage.getItem(LS.tenant) || "dev";
  agentInput.value = localStorage.getItem(LS.agent) || "cursor-junior";
}

function saveCreds() {
  localStorage.setItem(LS.secret, secretInput.value);
  localStorage.setItem(LS.tenant, tenantInput.value);
  localStorage.setItem(LS.agent, agentInput.value);
}

for (const el of [secretInput, tenantInput, agentInput]) {
  el.addEventListener("change", saveCreds);
  el.addEventListener("blur", saveCreds);
}

function authHeaders() {
  saveCreds();
  return {
    "content-type": "application/json",
    authorization: `Bearer ${secretInput.value}`,
    "x-tenant-id": tenantInput.value,
    "x-agent-id": agentInput.value,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function animatePipeline(active) {
  for (const s of stages) s.classList.remove("active");
  for (const name of active) {
    const el = stages.find((s) => s.dataset.stage === name);
    if (el) el.classList.add("active");
    await sleep(100);
  }
}

async function refreshHealth() {
  try {
    const res = await fetch("/health");
    const data = await res.json();
    healthEl.classList.add("ok");
    healthText.textContent = `online · jev=${data.jev} · escalation=${data.escalation ? "on" : "off"}`;
    footerMode.textContent = `backend: ${data.jev} · auth=${data.auth}`;
  } catch {
    healthEl.classList.remove("ok");
    healthText.textContent = "offline";
  }
}

function renderVerdict(data) {
  const v = data.verdict;
  const j = v.judgment;
  const esc = data.escalation;
  guardOut.hidden = false;
  guardOut.innerHTML = `
    <div class="verdict-top">
      <span class="pill ${data.decision}">${data.decision}</span>
      <span class="pill ${data.zk_level}">${data.zk_level}</span>
      <span class="pill ${data.allowed ? "allow" : "deny"}">${data.allowed ? "allowed" : "blocked"}</span>
      <span class="pill L1">${data.agent?.id} · ${data.agent?.clearance ?? "?"}</span>
      <span class="pill L2">need ${data.requiredClearance}</span>
    </div>
    ${
      esc
        ? `<div class="mono" style="margin-bottom:0.5rem">escalation ticket=${esc.ticketId.slice(0, 8)}… → ${esc.escalatesTo ?? "senior"}</div>`
        : ""
    }
    <div class="scores">
      <div class="score"><span>dangerous</span><strong>${j.dangerous.toFixed(2)}</strong></div>
      <div class="score"><span>exfil</span><strong>${j.exfil.toFixed(2)}</strong></div>
      <div class="score"><span>offPolicy</span><strong>${j.offPolicy.toFixed(2)}</strong></div>
      <div class="score"><span>benign</span><strong>${j.benign.toFixed(2)}</strong></div>
    </div>
    <div class="mono">commitment=${v.zk.commitment.slice(0, 24)}…</div>
  `;
}

async function runGuard() {
  const btn = document.getElementById("btn-guard");
  btn.disabled = true;
  await animatePipeline(["agent", "jev", "policy", "zk", "sim"]);
  try {
    const res = await fetch("/v1/guard", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        command: cmdInput.value,
        rationale: rationaleInput.value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || "guard failed");
    renderVerdict(data);
    if (data.escalation) await refreshInbox();
  } catch (err) {
    guardOut.hidden = false;
    guardOut.textContent = String(err.message || err);
  } finally {
    btn.disabled = false;
  }
}

async function refreshInbox() {
  escalationSteps.innerHTML = "";
  try {
    const res = await fetch("/v1/escalations?status=open", {
      headers: authHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || "inbox failed");
    if (!data.tickets?.length) {
      escalationSteps.innerHTML = `<li class="mono">No open tickets (switch to Lead L3 to decide)</li>`;
      return;
    }
    for (const t of data.tickets) {
      const li = document.createElement("li");
      li.innerHTML = `
        <div class="step-cmd"><strong>${t.decision}</strong> / ${t.zk_level} · ${t.command}</div>
        <div class="verdict-top">
          <span class="pill ${t.decision}">${t.decision}</span>
          <span class="pill L1">from ${t.juniorAgentId}</span>
          <span class="pill L2">need ${t.requiredClearance}</span>
        </div>
        <div class="mono">${t.ts} · ${t.id.slice(0, 8)}…</div>
        <div class="actions" style="margin-top:0.5rem">
          <button type="button" class="primary decide" data-id="${t.id}" data-decision="approve">Approve</button>
          <button type="button" class="ghost decide" data-id="${t.id}" data-decision="deny">Deny</button>
        </div>
      `;
      escalationSteps.appendChild(li);
    }
    for (const btn of escalationSteps.querySelectorAll(".decide")) {
      btn.addEventListener("click", () =>
        decide(btn.dataset.id, btn.dataset.decision),
      );
    }
  } catch (err) {
    escalationSteps.innerHTML = `<li>${String(err.message || err)}</li>`;
  }
}

async function decide(id, decision) {
  try {
    const res = await fetch(`/v1/escalations/${id}/decide`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        decision,
        note: decision === "deny" ? "blocked by lead" : "approved by lead",
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || "decide failed");
    await refreshInbox();
    guardOut.hidden = false;
    guardOut.innerHTML = `<div class="mono">Lead ${decision}d ticket ${id.slice(0, 8)}… · signature=${(data.ticket?.signature || "").slice(0, 16)}…</div>`;
  } catch (err) {
    alert(String(err.message || err));
  }
}

document.getElementById("btn-guard").addEventListener("click", runGuard);
document.getElementById("btn-inbox").addEventListener("click", refreshInbox);
for (const btn of document.querySelectorAll(".scenario")) {
  btn.addEventListener("click", (e) => {
    cmdInput.value = e.currentTarget.dataset.cmd;
  });
}
for (const btn of document.querySelectorAll(".role-preset")) {
  btn.addEventListener("click", () => {
    tenantInput.value = btn.dataset.tenant;
    agentInput.value = btn.dataset.agent;
    saveCreds();
  });
}

loadCreds();
refreshHealth();
setInterval(refreshHealth, 15000);
