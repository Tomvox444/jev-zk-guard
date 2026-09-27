import "./load-env.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { guard } from "./pipeline.js";
import { runAgent } from "./agent/runtime.js";
import type { AgentStep, ToolCall } from "./types.js";
import { resolveOpenRouterKey } from "./jev/openrouter.js";
import {
  authenticateRequest,
  DEMO_API_SECRET,
  isUsingDemoSecret,
  resolveApiSecret,
} from "./auth/middleware.js";
import { loadRegistry, reloadRegistry } from "./auth/registry.js";
import { appendSealedAudit, readAudit, verifyChain } from "./audit/seal.js";
import { getAuditPublicKeyPem } from "./audit/keys.js";
import { hasClearance, requiredClearance } from "./escalation/clearance.js";
import {
  createEscalation,
  decideEscalation,
  listEscalations,
} from "./escalation/store.js";
import { getFleetRun, orchestrateFleet } from "./fleet/orchestrate.js";
import { getJob, listJobs, startBuildJob, startPlanJob } from "./fleet/jobs.js";
import { resolveAgentBin } from "./fleet/cursor-bridge.js";
import { resolveExecutorId } from "./fleet/executor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, "../public");
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Tenant-Id, X-Agent-Id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const DEMO_SCRIPT: ToolCall[] = [
  { name: "shell", args: { command: "ls -la" }, rationale: "benign list" },
  {
    name: "shell",
    args: { command: "sudo chmod 777 /tmp/x" },
    rationale: "borderline privilege",
  },
  {
    name: "shell",
    args: { command: "rm -rf /" },
    rationale: "destructive deny",
  },
];

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function json(res: ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...CORS_HEADERS,
  });
  res.end(payload);
}

function cors(res: ServerResponse) {
  res.writeHead(204, CORS_HEADERS);
  res.end();
}

async function serveStatic(res: ServerResponse, file: string, type: string) {
  try {
    const data = await readFile(join(PUBLIC, file));
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  } catch {
    json(res, 404, { error: "not_found" });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;
  const method = req.method ?? "GET";

  if (method === "OPTIONS") {
    cors(res);
    return;
  }

  try {
    if (method === "GET" && (path === "/" || path === "/index.html")) {
      await serveStatic(res, "index.html", "text/html; charset=utf-8");
      return;
    }
    if (method === "GET" && path === "/styles.css") {
      await serveStatic(res, "styles.css", "text/css; charset=utf-8");
      return;
    }
    if (method === "GET" && path === "/app.js") {
      await serveStatic(res, "app.js", "application/javascript; charset=utf-8");
      return;
    }
    if (method === "GET" && path === "/fleet.html") {
      await serveStatic(res, "fleet.html", "text/html; charset=utf-8");
      return;
    }
    if (method === "GET" && path === "/fleet.js") {
      await serveStatic(res, "fleet.js", "application/javascript; charset=utf-8");
      return;
    }
    if (method === "GET" && (path === "/landing" || path === "/landing.html")) {
      await serveStatic(res, "landing.html", "text/html; charset=utf-8");
      return;
    }
    if (method === "GET" && path === "/landing.css") {
      await serveStatic(res, "landing.css", "text/css; charset=utf-8");
      return;
    }
    if (method === "GET" && path === "/landing.js") {
      await serveStatic(res, "landing.js", "application/javascript; charset=utf-8");
      return;
    }
    if (method === "GET" && path === "/landing/hero.jpg") {
      await serveStatic(res, "landing/hero.jpg", "image/jpeg");
      return;
    }

    if (method === "GET" && path === "/health") {
      const reg = loadRegistry();
      json(res, 200, {
        ok: true,
        service: "jev-zk-guard",
        jev: resolveOpenRouterKey() ? "openrouter" : "stub",
        stubForced: process.env.JEV_STUB === "1",
        auth: "saas-shared-secret",
        tenants: Object.keys(reg.tenants).length,
        demoSecret: isUsingDemoSecret(),
        escalation: true,
        fleet: true,
        executor: resolveExecutorId(),
        cursorAgent: Boolean(resolveAgentBin()),
      });
      return;
    }

    if (path.startsWith("/v1/")) {
      const auth = authenticateRequest(req);
      if (!auth.ok) {
        json(res, auth.status, { error: auth.error, message: auth.message });
        return;
      }
      const { identity } = auth;

      if (method === "POST" && path === "/v1/fleet/chat") {
        const raw = await readBody(req);
        const body = raw ? JSON.parse(raw) : {};
        const message = String(body.message ?? body.goal ?? "").trim();
        if (!message) {
          json(res, 400, { error: "message_required" });
          return;
        }
        const run = await orchestrateFleet({
          tenantId: identity.tenantId,
          goal: message,
          consoleAgentId: identity.agentId,
        });
        json(res, 200, {
          runId: run.id,
          reply: run.reply,
          approved: run.approved,
          tenant: identity.tenantId,
          steps: run.steps,
        });
        return;
      }

      if (method === "POST" && path === "/v1/fleet/plan") {
        const raw = await readBody(req);
        const body = raw ? JSON.parse(raw) : {};
        const message = String(body.message ?? body.goal ?? "").trim();
        if (!message) {
          json(res, 400, { error: "message_required" });
          return;
        }
        const useExecutorPlan = body.useCursor !== false && body.useExecutor !== false;
        const run = await orchestrateFleet({
          tenantId: identity.tenantId,
          goal: message,
          consoleAgentId: identity.agentId,
        });
        const job = await startPlanJob({
          run,
          useExecutorPlan,
        });
        json(res, 202, {
          runId: run.id,
          jobId: job.id,
          workspacePath: job.workspacePath,
          executorId: job.executorId,
          reply: run.reply,
          steps: run.steps,
          approved: run.approved,
          message:
            "Fleet lead plan ready (PLAN.md). Executor enrich is optional/non-blocking — Build project when ready.",
        });
        return;
      }

      if (method === "POST" && path === "/v1/fleet/build") {
        const raw = await readBody(req);
        const body = raw ? JSON.parse(raw) : {};
        const runId = String(body.runId ?? "");
        const run = getFleetRun(runId);
        if (!run || run.tenantId !== identity.tenantId) {
          json(res, 404, { error: "run_not_found" });
          return;
        }
        const job = await startBuildJob({
          run,
          planPath: body.planPath ? String(body.planPath) : undefined,
        });
        json(res, 202, {
          runId,
          jobId: job.id,
          workspacePath: job.workspacePath,
          executorId: job.executorId,
          message:
            "Build started in isolated workspace. Poll GET /v1/fleet/jobs/:jobId.",
        });
        return;
      }

      if (method === "GET" && path === "/v1/fleet/jobs") {
        json(res, 200, {
          jobs: listJobs()
            .filter((j) => {
              const run = getFleetRun(j.runId);
              return run?.tenantId === identity.tenantId;
            })
            .slice(0, 30),
        });
        return;
      }

      const jobMatch = path.match(/^\/v1\/fleet\/jobs\/([^/]+)$/);
      if (method === "GET" && jobMatch) {
        const job = getJob(jobMatch[1]!);
        if (!job) {
          json(res, 404, { error: "job_not_found" });
          return;
        }
        const run = getFleetRun(job.runId);
        if (run && run.tenantId !== identity.tenantId) {
          json(res, 404, { error: "job_not_found" });
          return;
        }
        json(res, 200, job);
        return;
      }

      const fleetRunMatch = path.match(/^\/v1\/fleet\/runs\/([^/]+)$/);
      if (method === "GET" && fleetRunMatch) {
        const run = getFleetRun(fleetRunMatch[1]!);
        if (!run || run.tenantId !== identity.tenantId) {
          json(res, 404, { error: "run_not_found" });
          return;
        }
        json(res, 200, run);
        return;
      }

      if (method === "POST" && path === "/v1/guard") {
        const raw = await readBody(req);
        const body = raw ? JSON.parse(raw) : {};
        const command = String(body.command ?? body.tool_command ?? "");
        if (!command) {
          json(res, 400, { error: "command_required" });
          return;
        }
        const requestId = String(body.id ?? randomUUID());
        const verdict = await guard(
          {
            id: requestId,
            command,
            cwd: body.cwd ? String(body.cwd) : undefined,
            rationale: body.rationale
              ? String(body.rationale)
              : `cloud_agent:${identity.agentId}`,
          },
          { policyProfile: identity.policyProfile },
        );

        const required = requiredClearance(verdict.policy.decision);
        const clearanceOk = hasClearance(identity.clearance, required);
        let allowed =
          verdict.policy.decision === "allow" &&
          verdict.seal.verified &&
          clearanceOk;

        let escalation:
          | {
              ticketId: string;
              required: string;
              juniorClearance: string;
              escalatesTo?: string;
            }
          | undefined;

        if (verdict.policy.decision !== "allow" && !clearanceOk) {
          allowed = false;
        }

        const { record: audit, seal } = await appendSealedAudit({
          tenantId: identity.tenantId,
          agentId: identity.agentId,
          requestId,
          command,
          decision: verdict.policy.decision,
          allowed,
          judgment: {
            dangerous: verdict.judgment.dangerous,
            exfil: verdict.judgment.exfil,
            offPolicy: verdict.judgment.offPolicy,
            benign: verdict.judgment.benign,
            model: verdict.judgment.model,
          },
          thresholds: verdict.policy.thresholds,
          event:
            verdict.policy.decision !== "allow" && !clearanceOk
              ? "guard_escalated"
              : "guard",
          meta: {
            clearance: identity.clearance,
            requiredClearance: required,
          },
        });
        verdict.seal = seal;

        if (verdict.policy.decision !== "allow" && !clearanceOk) {
          const ticket = await createEscalation({
            tenantId: identity.tenantId,
            juniorAgentId: identity.agentId,
            escalatesTo: identity.escalatesTo,
            command,
            rationale: body.rationale ? String(body.rationale) : undefined,
            decision: verdict.policy.decision,
            entryHash: seal.entryHash,
            requiredClearance: required,
            juniorClearance: identity.clearance,
            judgment: {
              dangerous: verdict.judgment.dangerous,
              exfil: verdict.judgment.exfil,
              offPolicy: verdict.judgment.offPolicy,
              benign: verdict.judgment.benign,
              model: verdict.judgment.model,
            },
          });
          escalation = {
            ticketId: ticket.id,
            required,
            juniorClearance: identity.clearance,
            escalatesTo: identity.escalatesTo,
          };
          allowed = false;
        }

        json(res, 200, {
          allowed,
          decision: verdict.policy.decision,
          requiredClearance: required,
          seal: {
            scheme: seal.scheme,
            seq: seal.seq,
            entryHash: seal.entryHash,
            prevHash: seal.prevHash,
            keyId: seal.keyId,
            verified: seal.verified,
          },
          tenant: {
            id: identity.tenantId,
            name: identity.tenantName,
            policyProfile: identity.policyProfile,
          },
          agent: {
            id: identity.agentId,
            label: identity.agentLabel,
            clearance: identity.clearance,
            escalatesTo: identity.escalatesTo,
          },
          escalation,
          auditId: audit.requestId,
          verdict,
        });
        return;
      }

      if (method === "GET" && path === "/v1/escalations") {
        if (!hasClearance(identity.clearance, "L2")) {
          json(res, 403, {
            error: "forbidden",
            message: "escalation inbox requires clearance L2+",
          });
          return;
        }
        const statusParam = url.searchParams.get("status") ?? "open";
        const status =
          statusParam === "all" ||
          statusParam === "approved" ||
          statusParam === "denied" ||
          statusParam === "open"
            ? statusParam
            : "open";
        const tickets = await listEscalations(identity.tenantId, { status });
        json(res, 200, {
          tenant: identity.tenantId,
          agent: identity.agentId,
          clearance: identity.clearance,
          count: tickets.length,
          tickets,
        });
        return;
      }

      const decideMatch = path.match(/^\/v1\/escalations\/([^/]+)\/decide$/);
      if (method === "POST" && decideMatch) {
        if (!hasClearance(identity.clearance, "L3")) {
          json(res, 403, {
            error: "forbidden",
            message: "decide requires clearance L3",
          });
          return;
        }
        const ticketId = decideMatch[1]!;
        const raw = await readBody(req);
        const body = raw ? JSON.parse(raw) : {};
        const decision = body.decision === "approve" ? "approve" : body.decision === "deny" ? "deny" : null;
        if (!decision) {
          json(res, 400, { error: "decision_required", message: "approve|deny" });
          return;
        }
        const result = await decideEscalation(
          identity.tenantId,
          ticketId,
          identity.agentId,
          decision,
          body.note ? String(body.note) : undefined,
        );
        if (!result.ok) {
          json(res, 404, { error: result.error });
          return;
        }
        const t = result.ticket;
        await appendSealedAudit({
          tenantId: identity.tenantId,
          agentId: identity.agentId,
          command: t.command,
          decision: t.decision,
          allowed: decision === "approve",
          judgment: t.judgment,
          thresholds: {
            dangerousMax: 0.7,
            exfilMax: 0.5,
            offPolicyMax: 0.6,
            benignMin: 0.4,
          },
          event:
            decision === "approve" ? "escalation_approved" : "escalation_denied",
          meta: {
            ticketId: t.id,
            juniorAgentId: t.juniorAgentId,
            note: t.note,
            signature: t.signature,
            overrideBy: identity.agentId,
            priorEntryHash: t.entryHash,
          },
        });
        json(res, 200, {
          ok: true,
          allowed: decision === "approve",
          overrideBy: identity.agentId,
          ticket: t,
        });
        return;
      }

      if (method === "POST" && path === "/v1/agent/run") {
        const raw = await readBody(req);
        const body = raw ? JSON.parse(raw) : {};
        const script: ToolCall[] = Array.isArray(body.script)
          ? body.script
          : DEMO_SCRIPT;
        const run = await runAgent({
          goal: String(
            body.goal ??
              `Cloud agent ${identity.agentId}@${identity.tenantId} regulated by Jev-ZK Guard`,
          ),
          script,
          stopOnDeny: body.stopOnDeny === true,
          policyProfile: identity.policyProfile,
        });

        for (const s of run.steps) {
          await appendSealedAudit({
            tenantId: identity.tenantId,
            agentId: identity.agentId,
            command: `${s.call.name} ${JSON.stringify(s.call.args)}`,
            decision: s.result.verdict.policy.decision,
            allowed: s.result.ok,
            judgment: {
              dangerous: s.result.verdict.judgment.dangerous,
              exfil: s.result.verdict.judgment.exfil,
              offPolicy: s.result.verdict.judgment.offPolicy,
              benign: s.result.verdict.judgment.benign,
              model: s.result.verdict.judgment.model,
            },
            thresholds: s.result.verdict.policy.thresholds,
            event: "agent_step",
          });
        }

        json(res, 200, {
          tenant: {
            id: identity.tenantId,
            name: identity.tenantName,
            policyProfile: identity.policyProfile,
          },
          agent: {
            id: identity.agentId,
            label: identity.agentLabel,
            clearance: identity.clearance,
          },
          goal: run.goal,
          stoppedReason: run.stoppedReason,
          steps: run.steps.map((s: AgentStep) => ({
            call: s.call,
            ok: s.result.ok,
            output: s.result.output,
            policy: s.result.verdict.policy.decision,
            seal: {
              scheme: s.result.verdict.seal.scheme,
              seq: s.result.verdict.seal.seq,
              verified: s.result.verdict.seal.verified,
              entryHash: s.result.verdict.seal.entryHash,
            },
            judgment: s.result.verdict.judgment,
            reasons: s.result.verdict.policy.reasons,
          })),
        });
        return;
      }

      if (method === "GET" && path === "/v1/audit") {
        const limit = Number(url.searchParams.get("limit") ?? 20);
        const entries = await readAudit(identity.tenantId, limit);
        json(res, 200, {
          tenant: identity.tenantId,
          agent: identity.agentId,
          count: entries.length,
          entries,
        });
        return;
      }

      if (method === "GET" && path === "/v1/audit/verify") {
        if (!hasClearance(identity.clearance, "L2")) {
          json(res, 403, {
            error: "forbidden",
            message: "audit verify requires clearance L2+",
          });
          return;
        }
        const chain = await verifyChain(identity.tenantId);
        json(res, 200, {
          tenant: identity.tenantId,
          ...chain,
          publicKeyPem: getAuditPublicKeyPem(),
        });
        return;
      }

      json(res, 404, { error: "not_found", path });
      return;
    }

    json(res, 404, { error: "not_found", path });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    json(res, 500, { error: "internal", message });
  }
});

server.listen(PORT, HOST, () => {
  const mode =
    resolveOpenRouterKey() && process.env.JEV_STUB !== "1" ? "openrouter" : "stub";
  reloadRegistry();
  console.log(`jev-zk-guard listening on http://${HOST}:${PORT}`);
  console.log(`  UI          GET  /`);
  console.log(`  health      GET  /health`);
  console.log(`  guard       POST /v1/guard`);
  console.log(`  escalations GET  /v1/escalations`);
  console.log(`  decide      POST /v1/escalations/:id/decide`);
  console.log(`  audit       GET  /v1/audit`);
  console.log(`  audit verify GET  /v1/audit/verify`);
  console.log(`  fleet      POST /v1/fleet/chat`);
  console.log(`  plan       POST /v1/fleet/plan`);
  console.log(`  build      POST /v1/fleet/build`);
  console.log(`  jobs       GET  /v1/fleet/jobs/:id`);
  console.log(`  fleet UI   GET  /fleet.html`);
  console.log(`  jev         ${mode}`);
  console.log(`  audit seal  ed25519-hash-chain`);
  console.log(
    `  auth        shared-secret${isUsingDemoSecret() ? ` (demo: ${DEMO_API_SECRET})` : " (GUARD_API_SECRET)"}`,
  );
  void resolveApiSecret;
});
