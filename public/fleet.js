const healthEl = document.getElementById("health");
const healthText = document.getElementById("health-text");
const secretInput = document.getElementById("api-secret");
const tenantInput = document.getElementById("tenant-id");
const agentInput = document.getElementById("agent-id");
const chatLog = document.getElementById("chat-log");
const timeline = document.getElementById("timeline");
const agentGraph = document.getElementById("agent-graph");
const execMeta = document.getElementById("exec-meta");
const execTranscript = document.getElementById("exec-transcript");
const form = document.getElementById("chat-form");
const input = document.getElementById("chat-input");
const btnSend = document.getElementById("btn-send");
const btnPlan = document.getElementById("btn-plan");
const btnBuild = document.getElementById("btn-build");
const jobStatus = document.getElementById("job-status");

const LS = { secret: "jzg_api_secret", tenant: "jzg_tenant", agent: "jzg_fleet_agent" };

/** @type {{ runId?: string, planJobId?: string, buildJobId?: string, planPath?: string, workspacePath?: string, goal?: string, steps?: any[] }} */
let session = {};
let pollTimer = null;
let graphPlayTimer = null;
let lastAnnouncedLog = "";

function loadCreds() {
  secretInput.value = localStorage.getItem(LS.secret) || "jzg_demo_secret";
  tenantInput.value = localStorage.getItem(LS.tenant) || "dev";
  agentInput.value = localStorage.getItem(LS.agent) || "fleet-console";
}
function saveCreds() {
  localStorage.setItem(LS.secret, secretInput.value);
  localStorage.setItem(LS.tenant, tenantInput.value);
  localStorage.setItem(LS.agent, agentInput.value);
}
for (const el of [secretInput, tenantInput, agentInput]) {
  el.addEventListener("change", saveCreds);
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

function setBusy(busy) {
  btnSend.disabled = busy;
  btnPlan.disabled = busy;
  btnBuild.disabled = busy || !session.runId;
}

function addBubble(role, text) {
  const div = document.createElement("div");
  div.className = `bubble ${role}`;
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function setJobHint(text) {
  jobStatus.textContent = text;
}

function shortPath(p) {
  if (!p) return "";
  const parts = p.split("/");
  return parts.slice(-3).join("/");
}

function firstLine(text) {
  return String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean) || "";
}

function renderTimelineCompact(steps, activeIdx) {
  timeline.innerHTML = "";
  steps.forEach((s, i) => {
    const li = document.createElement("li");
    if (i === activeIdx) li.classList.add("active");
    if (i < activeIdx) li.classList.add("done");
    const c = s.complexity
      ? ` · ${s.complexity.bucket} ${s.complexity.complexity.toFixed(2)}`
      : "";
    li.innerHTML = `<span class="step-cmd"><strong>${s.phase}</strong> · ${s.agentId}${c}</span> <span class="pill L1">${s.title}</span>`;
    timeline.appendChild(li);
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {any[]} steps
 * @param {number} activeIdx
 * @param {{ agentId?: string, role?: string, title?: string, detail?: string } | null} liveSpeak
 */
function paintGraph(steps, activeIdx, liveSpeak = null) {
  if (!steps.length && !liveSpeak) {
    agentGraph.innerHTML = `<p class="graph-empty mono">Send a goal to see the fleet graph.</p>`;
    return;
  }

  const order = [];
  const byId = new Map();
  for (const s of steps) {
    if (!byId.has(s.agentId)) {
      byId.set(s.agentId, { agentId: s.agentId, role: s.role });
      order.push(s.agentId);
    }
  }

  const speakId = liveSpeak?.agentId;
  if (speakId && !byId.has(speakId)) {
    byId.set(speakId, {
      agentId: speakId,
      role: liveSpeak.role === "lead-finalize" ? "lead" : liveSpeak.role || "executor",
    });
    order.push(speakId);
  }

  const speaking = liveSpeak
    ? {
        agentId: speakId,
        title: liveSpeak.title,
        detail: liveSpeak.detail,
      }
    : activeIdx >= 0 && activeIdx < steps.length
      ? steps[activeIdx]
      : null;

  const spokenIds = new Set(
    liveSpeak
      ? order.filter((id) => id !== speakId || true)
      : steps.slice(0, activeIdx + 1).map((s) => s.agentId),
  );
  // During live build: mark other agents as past, speaker active
  if (liveSpeak && speakId) {
    for (const id of order) {
      if (id !== speakId) spokenIds.add(id);
    }
  }

  const nodesHtml = order
    .map((id, i) => {
      const n = byId.get(id);
      const isSpeak = speaking && speaking.agentId === id;
      const past = spokenIds.has(id) && !isSpeak;
      const roleClass =
        n.role === "lead-finalize" ? "lead" : n.role || "lead";
      const cls = [
        "agent-node",
        `role-${roleClass}`,
        isSpeak ? "speaking" : "",
        past ? "past" : "",
        !spokenIds.has(id) && !isSpeak ? "pending" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const bubble =
        isSpeak
          ? `<div class="speech-bubble">${escapeHtml(speaking.title || "")}<small>${escapeHtml(String(speaking.detail || "").slice(0, 160))}</small></div>`
          : "";
      return `
        <div class="agent-col">
          <div class="${cls}" data-agent="${escapeHtml(id)}">
            <span class="agent-role">${escapeHtml(roleClass)}</span>
            <span class="agent-id">${escapeHtml(id)}</span>
          </div>
          ${bubble}
        </div>
        ${i < order.length - 1 ? '<span class="agent-edge" aria-hidden="true"></span>' : ""}`;
    })
    .join("");

  agentGraph.innerHTML = `<div class="agent-row">${nodesHtml}</div>`;
}

function playGraph(steps) {
  session.steps = steps;
  if (graphPlayTimer) clearInterval(graphPlayTimer);
  if (!steps.length) {
    paintGraph([], -1);
    renderTimelineCompact([], -1);
    return;
  }
  let i = 0;
  paintGraph(steps, 0);
  renderTimelineCompact(steps, 0);
  graphPlayTimer = setInterval(() => {
    i += 1;
    if (i >= steps.length) {
      clearInterval(graphPlayTimer);
      graphPlayTimer = null;
      paintGraph(steps, steps.length - 1);
      renderTimelineCompact(steps, steps.length - 1);
      return;
    }
    paintGraph(steps, i);
    renderTimelineCompact(steps, i);
  }, 550);
}

function announceJobProgress(job) {
  const logs = job.log || [];
  const last = logs[logs.length - 1] || "";
  if (!last || last === lastAnnouncedLog) return;
  lastAnnouncedLog = last;
  if (last.startsWith("… building") || last.startsWith("created ")) return;
  const who = job.currentRole
    ? `${job.currentRole}/${job.currentAgentId || "?"}`
    : job.executorId || "exec";
  addBubble("fleet", `[${who}] ${last}`);
}

function showExecutorOnGraph(job) {
  const steps = session.steps || [];
  const last = (job.log || []).slice(-1)[0] || "working…";
  const agentId = job.currentAgentId || "executor";
  const role = job.currentRole || "executor";
  const phaseTitle =
    job.phases?.find((p) => p.status === "running")?.title ||
    (job.status === "done" ? "Fleet build finished" : `${job.kind} · ${role}`);
  paintGraph(steps, steps.length - 1, {
    agentId,
    role,
    title: phaseTitle,
    detail: last,
  });
}

function updateTranscript(job) {
  if (!job) {
    execMeta.textContent = "No job yet — Build plan / Build project";
    execTranscript.textContent = "";
    return;
  }
  const ws = job.workspacePath ? shortPath(job.workspacePath) : "—";
  const who = job.currentAgentId
    ? `${job.currentRole || "?"}/${job.currentAgentId}`
    : job.executorId || "?";
  const phaseBits = (job.phases || [])
    .map((p) => `${p.role[0]}:${p.status[0]}`)
    .join(" ");
  execMeta.textContent = `${job.kind} · ${job.status} · ${who} · ${ws}${phaseBits ? ` · ${phaseBits}` : ""}`;
  const logs = (job.log || []).join("\n");
  const out = job.output || "";
  const body = out ? `${logs}\n---\n${out.slice(-12000)}` : logs;
  execTranscript.textContent = body;
  execTranscript.scrollTop = execTranscript.scrollHeight;
}

async function pollJob(jobId, label) {
  if (pollTimer) clearInterval(pollTimer);
  lastAnnouncedLog = "";
  const tick = async () => {
    try {
      const res = await fetch(`/v1/fleet/jobs/${jobId}`, { headers: authHeaders() });
      const job = await res.json();
      if (!res.ok) throw new Error(job.error || "job poll failed");
      updateTranscript(job);
      announceJobProgress(job);
      if (job.kind === "build" || (job.kind === "plan" && job.status === "running")) {
        showExecutorOnGraph(job);
      }
      const tail = (job.log || []).slice(-1)[0] || "";
      const ws = job.workspacePath ? ` → ${shortPath(job.workspacePath)}` : "";
      setJobHint(`${label}: ${job.status}${tail ? ` — ${tail}` : ""}${ws}`);

      if (job.kind === "plan" && job.planPath) {
        session.planPath = job.planPath;
        if (job.workspacePath) session.workspacePath = job.workspacePath;
        btnBuild.disabled = false;
        if (job.status === "running") {
          setBusy(false);
          setJobHint(
            `Fleet plan ready — Build project OK. Executor still enriching…${ws}`,
          );
        }
      }

      if (job.status === "done" || job.status === "error") {
        clearInterval(pollTimer);
        pollTimer = null;
        setBusy(false);
        if (job.planPath) session.planPath = job.planPath;
        if (job.workspacePath) session.workspacePath = job.workspacePath;
        if (job.kind === "build") {
          showExecutorOnGraph(job);
        }
        if (job.status === "done") {
          const where = job.workspacePath
            ? `\n\nWorkspace: ${job.workspacePath}`
            : "";
          addBubble(
            "fleet",
            job.kind === "plan"
              ? `Fleet plan ready — you can Build project.${job.planPath ? ` (${shortPath(job.planPath)})` : ""}${where}`
              : `Build done.${where}`,
          );
          if (job.kind === "plan") btnBuild.disabled = false;
        } else {
          addBubble("fleet", `Job error: ${job.error || "unknown"}`);
        }
      }
    } catch (err) {
      clearInterval(pollTimer);
      pollTimer = null;
      setBusy(false);
      setJobHint(String(err.message || err));
    }
  };
  await tick();
  pollTimer = setInterval(tick, 1000);
}

async function refreshHealth() {
  try {
    const res = await fetch("/health");
    const data = await res.json();
    healthEl.classList.add("ok");
    const exec = data.executor ? `exec=${data.executor}` : "exec=?";
    const cursor = data.cursorAgent ? "cursor=on" : "cursor=off";
    healthText.textContent = `online · fleet · ${exec} · ${cursor}`;
  } catch {
    healthEl.classList.remove("ok");
    healthText.textContent = "offline";
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const message = input.value.trim();
  if (!message) return;
  addBubble("user", message);
  input.value = "";
  setBusy(true);
  timeline.innerHTML = `<li class="mono">Orchestrating…</li>`;
  agentGraph.innerHTML = `<p class="graph-empty mono">Orchestrating…</p>`;
  try {
    const res = await fetch("/v1/fleet/chat", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ message }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || data.error || "fleet failed");
    session = { runId: data.runId, goal: message, steps: data.steps || [] };
    addBubble("fleet", data.reply);
    playGraph(data.steps || []);
    setJobHint(`Run ${data.runId.slice(0, 8)}… — Build plan → isolated workspace.`);
    btnBuild.disabled = true;
  } catch (err) {
    addBubble("fleet", String(err.message || err));
    timeline.innerHTML = "";
    agentGraph.innerHTML = `<p class="graph-empty mono">Send a goal to see the fleet graph.</p>`;
  } finally {
    setBusy(false);
    input.focus();
  }
});

btnPlan.addEventListener("click", async () => {
  const typed = input.value.trim();
  const goal = typed || session.goal || "";
  if (!goal) {
    addBubble("fleet", "Type a goal first, then Build plan.");
    return;
  }
  if (typed) {
    addBubble("user", `[plan] ${typed}`);
    input.value = "";
  } else {
    addBubble("user", `[plan] ${goal}`);
  }
  setBusy(true);
  setJobHint("Starting plan job…");
  updateTranscript({
    kind: "plan",
    status: "queued",
    executorId: "…",
    log: ["starting plan…"],
    output: "",
  });
  try {
    const res = await fetch("/v1/fleet/plan", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ message: goal }),
    });
    const data = await res.json();
    if (!res.ok) {
      const err = data.message || data.error || "plan failed";
      if (err === "not_found" || res.status === 404) {
        throw new Error(
          "API /v1/fleet/plan missing — restart the guard server: npm run serve",
        );
      }
      throw new Error(err);
    }
    session = {
      runId: data.runId,
      planJobId: data.jobId,
      goal,
      workspacePath: data.workspacePath,
      steps: data.steps || [],
    };
    addBubble("fleet", data.reply);
    playGraph(data.steps || []);
    if (data.workspacePath) {
      session.workspacePath = data.workspacePath;
      session.planPath = session.planPath || `${data.workspacePath}/PLAN.md`;
      btnBuild.disabled = false;
      setJobHint(
        `Fleet approved · PLAN.md in ${shortPath(data.workspacePath)} — Build project OK (executor may still enrich).`,
      );
    }
    await pollJob(data.jobId, "Plan");
  } catch (err) {
    addBubble("fleet", String(err.message || err));
    setBusy(false);
  }
});

btnBuild.addEventListener("click", async () => {
  if (!session.runId) {
    addBubble("fleet", "Build a plan first.");
    return;
  }
  setBusy(true);
  setJobHint(
    session.workspacePath
      ? `Starting build in ${shortPath(session.workspacePath)}…`
      : "Starting build…",
  );
  addBubble("user", "[build] Implement the lead plan in the isolated workspace");
  showExecutorOnGraph({
    kind: "build",
    status: "running",
    currentAgentId: "fleet",
    currentRole: "lead",
    log: ["fleet build starting…"],
    phases: [],
  });
  updateTranscript({
    kind: "build",
    status: "queued",
    executorId: "…",
    workspacePath: session.workspacePath,
    log: ["starting build…"],
    output: "",
  });
  try {
    const res = await fetch("/v1/fleet/build", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        runId: session.runId,
        planPath: session.planPath,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      const err = data.message || data.error || "build failed";
      if (err === "not_found" || res.status === 404) {
        throw new Error(
          "API /v1/fleet/build missing — restart the guard server: npm run serve",
        );
      }
      throw new Error(err);
    }
    session.buildJobId = data.jobId;
    if (data.workspacePath) session.workspacePath = data.workspacePath;
    await pollJob(data.jobId, "Build");
  } catch (err) {
    addBubble("fleet", String(err.message || err));
    setBusy(false);
  }
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

loadCreds();
refreshHealth();
updateTranscript(null);
input.focus();
setInterval(refreshHealth, 15000);
