import { randomUUID } from "node:crypto";
import { writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { FleetRole } from "../auth/registry.js";
import { listFleetAgents } from "../auth/registry.js";
import { guard } from "../pipeline.js";
import type { FleetAssignment, FleetRun } from "./orchestrate.js";
import { briefToMarkdown } from "./lead-plan.js";
import { getExecutor } from "./executor.js";
import { ensureWorkspace, workspacePathForRun } from "./workspace.js";
import {
  buildPhasesFromRun,
  leadFinalizePrompt,
  partitionAssignments,
  roleTaskPrompt,
  type BuildPhase,
} from "./build-fleet.js";

export type FleetJob = {
  id: string;
  kind: "plan" | "build";
  status: "queued" | "running" | "done" | "error";
  runId: string;
  goal: string;
  createdAt: string;
  updatedAt: string;
  workspacePath?: string;
  planPath?: string;
  executorId?: string;
  currentAgentId?: string;
  currentRole?: FleetRole | "lead-finalize";
  phase?: "task" | "finalize";
  phases?: BuildPhase[];
  /** Unified executor stdout / notes (plan or build). */
  output?: string;
  error?: string;
  log: string[];
};

const jobs = new Map<string, FleetJob>();
const OUTPUT_CAP = 100_000;
const LOG_CAP = 200;

export function getJob(id: string): FleetJob | undefined {
  return jobs.get(id);
}

export function listJobs(): FleetJob[] {
  return [...jobs.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function touch(job: FleetJob, patch: Partial<FleetJob>) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  jobs.set(job.id, job);
}

function updatePhase(
  job: FleetJob,
  phaseId: string,
  status: BuildPhase["status"],
) {
  const phases = (job.phases ?? []).map((p) =>
    p.id === phaseId ? { ...p, status } : p,
  );
  touch(job, { phases });
}

/** Throttled live append for executor streams. */
function makeChunkSink(job: FleetJob) {
  let lastLogAt = 0;
  let pending = "";
  return (chunk: string) => {
    const next = ((job.output ?? "") + chunk).slice(-OUTPUT_CAP);
    job.output = next;
    job.updatedAt = new Date().toISOString();
    pending += chunk;
    const now = Date.now();
    if (now - lastLogAt < 200 && !pending.includes("\n")) {
      jobs.set(job.id, job);
      return;
    }
    lastLogAt = now;
    const line = pending.replace(/\s+/g, " ").trim().slice(0, 160);
    pending = "";
    if (line) {
      job.log = [...job.log, line].slice(-LOG_CAP);
    }
    jobs.set(job.id, job);
  };
}

export function formatLeadPlanMarkdown(run: FleetRun): string {
  const lines = [
    `# Fleet Lead Plan`,
    ``,
    `**Goal:** ${run.goal}`,
    `**Run:** ${run.id}`,
    `**Tenant:** ${run.tenantId}`,
    ``,
    `> Lead planner emits operative briefs. Build agents execute briefs — they do not re-scope the goal.`,
    ``,
    `## Assignments (build order)`,
    ``,
  ];
  for (const a of run.assignments) {
    lines.push(
      `- **${a.taskId}** [${a.role}/${a.agentId}] ${a.title} · ${a.complexity.bucket} ${a.complexity.complexity.toFixed(2)}`,
    );
  }
  lines.push(``);
  lines.push(`## Task briefs`);
  lines.push(``);
  for (const a of run.assignments) {
    lines.push(`### ${a.taskId} — ${a.role}/${a.agentId}: ${a.title}`);
    lines.push(``);
    lines.push(briefToMarkdown(a.brief));
    lines.push(``);
  }
  if (run.finalizeBrief) {
    lines.push(`### finalize — lead`);
    lines.push(``);
    lines.push(briefToMarkdown(run.finalizeBrief));
    lines.push(``);
  }
  lines.push(`## Timeline`);
  lines.push(``);
  for (const s of run.steps) {
    const c = s.complexity
      ? ` · ${s.complexity.bucket} ${s.complexity.complexity.toFixed(2)}`
      : "";
    lines.push(`### [${s.phase}] ${s.agentId}/${s.role}${c}`);
    lines.push(s.title);
    lines.push(``);
    lines.push(s.detail);
    lines.push(``);
  }
  lines.push(`## Lead reply`);
  lines.push(``);
  lines.push(run.reply);
  lines.push(``);
  lines.push(`## Implementation instructions`);
  lines.push(``);
  lines.push(`Build order: high (Lead) → medium (Reviewer) → low Hands in parallel (max 2), then Lead finalize.`);
  lines.push(`Each phase is gated by Jev guard (\`fleet-phase:…\`).`);
  lines.push(`Each agent executes **only** its Lead brief (objective / deliverables / doNot / acceptance).`);
  lines.push(`Implement **only inside this workspace directory**.`);
  lines.push(`Do not modify the Jev-ZK Guard control-plane repository.`);
  lines.push(``);
  return lines.join("\n");
}

export async function startPlanJob(opts: {
  run: FleetRun;
  useExecutorPlan?: boolean;
}): Promise<FleetJob> {
  const executor = getExecutor();
  const wsPath = workspacePathForRun(opts.run.id);
  const job: FleetJob = {
    id: randomUUID(),
    kind: "plan",
    status: "queued",
    runId: opts.run.id,
    goal: opts.run.goal,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    workspacePath: wsPath,
    planPath: join(wsPath, "PLAN.md"),
    executorId: executor.id,
    log: ["plan job created"],
  };
  jobs.set(job.id, job);

  void (async () => {
    touch(job, { status: "running" });
    try {
      const ws = await ensureWorkspace(opts.run);
      const md = formatLeadPlanMarkdown(opts.run);
      await writeFile(ws.planPath, md, "utf8");
      touch(job, {
        workspacePath: ws.path,
        planPath: ws.planPath,
        status: "done",
        log: [
          ...job.log,
          "workspace ready",
          `wrote ${ws.planPath}`,
          "fleet plan ready — build allowed",
          "plan job done",
        ],
      });

      // Optional executor enrichment — must NOT block fleet "plan ready" / Build project.
      const usePlan = opts.useExecutorPlan !== false;
      if (usePlan) {
        touch(job, {
          log: [...job.log, `executor enriching (${executor.id}) — non-blocking`],
        });
        const prompt = `You are the Lead agent. Produce a concrete implementation plan for this goal.

Goal: ${opts.run.goal}

Workspace (only place you may write later): ${ws.path}

Fleet routing already decided (follow assignees):
${md}

Write a clear step-by-step plan with files to create inside the workspace. Do not edit files yet beyond planning output.`;
        const onChunk = makeChunkSink(job);
        try {
          const result = await executor.plan({
            prompt,
            workspace: ws.path,
            onChunk,
          });
          const note = result.ok
            ? `${executor.id} enrich finished`
            : `${executor.id} enrich skipped/failed: ${result.text.slice(0, 240)}`;
          touch(job, {
            output: (job.output || result.text || "").slice(-OUTPUT_CAP) || undefined,
            log: [...job.log, note],
          });
          if (result.text) {
            await writeFile(join(ws.path, "EXECUTOR_PLAN.md"), result.text, "utf8");
          }
        } catch (enrichErr) {
          touch(job, {
            log: [
              ...job.log,
              `enrich error: ${enrichErr instanceof Error ? enrichErr.message : String(enrichErr)}`,
            ],
          });
        }
      }
    } catch (err) {
      touch(job, {
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();

  return job;
}

export async function startBuildJob(opts: {
  run: FleetRun;
  planPath?: string;
}): Promise<FleetJob> {
  const executor = getExecutor();
  const wsPath = workspacePathForRun(opts.run.id);
  const phases = buildPhasesFromRun(opts.run);
  const agents = listFleetAgents(opts.run.tenantId);
  const job: FleetJob = {
    id: randomUUID(),
    kind: "build",
    status: "queued",
    runId: opts.run.id,
    goal: opts.run.goal,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    workspacePath: wsPath,
    executorId: executor.id,
    planPath: opts.planPath ?? join(wsPath, "PLAN.md"),
    phases,
    log: ["build job created", `fleet phases: ${phases.length}`],
  };
  jobs.set(job.id, job);

  const policyFor = (agentId: string) =>
    agents.find((a) => a.agentId === agentId)?.policyProfile ?? "default";

  const runGuard = async (
    assignment: { role: string; taskId: string; title: string; agentId: string },
  ): Promise<boolean> => {
    const verdict = await guard(
      {
        id: randomUUID(),
        command: `fleet-phase:${assignment.role}:${assignment.taskId}`,
        rationale: `build ${assignment.role} ${assignment.title}`,
      },
      { policyProfile: policyFor(assignment.agentId) },
    );
    // Demo safety: hard-stop only on deny. "review" logs and continues (escalate path).
    const denied =
      verdict.policy.decision === "deny" || !verdict.seal.verified;
    const decision = verdict.policy.decision;
    touch(job, {
      log: [
        ...job.log,
        denied
          ? `guard blocked · ${assignment.role}/${assignment.taskId} (${decision})`
          : decision === "review"
            ? `guard review · ${assignment.role}/${assignment.taskId} (continuing)`
            : `guard ok · ${assignment.role}/${assignment.taskId}`,
      ],
    });
    return !denied;
  };

  const runAssignment = async (
    assignment: FleetAssignment,
    workspace: string,
    planPath: string,
  ): Promise<boolean> => {
    updatePhase(job, assignment.taskId, "running");
    touch(job, {
      currentAgentId: assignment.agentId,
      currentRole: assignment.role,
      phase: "task",
      log: [
        ...job.log,
        `▶ ${assignment.role}/${assignment.agentId}: ${assignment.title}`,
      ],
    });

    const allowed = await runGuard(assignment);
    if (!allowed) {
      updatePhase(job, assignment.taskId, "error");
      touch(job, {
        status: "error",
        error: `Jev guard blocked phase ${assignment.taskId}`,
        log: [...job.log, `✗ guard stop · ${assignment.taskId}`],
      });
      return false;
    }

    const onChunk = makeChunkSink(job);
    const prefixChunk = (c: string) => onChunk(`[${assignment.taskId}] ${c}`);
    const result = await executor.build({
      prompt: roleTaskPrompt({
        run: opts.run,
        assignment,
        workspace,
        planPath,
      }),
      workspace,
      onChunk: prefixChunk,
      timeoutMs: 8 * 60_000,
      role: assignment.role,
      taskId: assignment.taskId,
      title: assignment.title,
    });

    if (!result.ok) {
      updatePhase(job, assignment.taskId, "error");
      touch(job, {
        status: "error",
        error:
          result.text ||
          `${assignment.role} failed on ${assignment.taskId}`,
        log: [
          ...job.log,
          `✗ ${assignment.role}/${assignment.agentId} failed`,
        ],
      });
      return false;
    }

    updatePhase(job, assignment.taskId, "done");
    touch(job, {
      log: [
        ...job.log,
        `✓ ${assignment.role}/${assignment.agentId} done: ${assignment.taskId}`,
      ],
    });
    return true;
  };

  void (async () => {
    touch(job, { status: "running" });
    let watch: ReturnType<typeof setInterval> | undefined;
    try {
      const ws = await ensureWorkspace(opts.run);
      const planPath = opts.planPath ?? ws.planPath;
      if (opts.run.assignments.length) {
        await writeFile(planPath, formatLeadPlanMarkdown(opts.run), "utf8").catch(
          () => undefined,
        );
      }
      const parts = partitionAssignments(opts.run.assignments);
      touch(job, {
        workspacePath: ws.path,
        planPath,
        log: [
          ...job.log,
          "workspace ready",
          `fleet build order: high=${parts.high.length} med=${parts.medium.length} low=${parts.low.length} (+finalize)`,
        ],
      });

      const seenFiles = new Set(await readdir(ws.path).catch(() => [] as string[]));
      watch = setInterval(() => {
        void (async () => {
          try {
            const files = await readdir(ws.path);
            for (const f of files.filter((x) => !seenFiles.has(x))) {
              seenFiles.add(f);
              touch(job, { log: [...job.log, `created ${f}`] });
            }
          } catch {
            /* ignore */
          }
        })();
      }, 2000);

      // 1) high sequential (design / lead)
      for (const a of parts.high) {
        const ok = await runAssignment(a, ws.path, planPath);
        if (!ok) {
          if (watch) clearInterval(watch);
          return;
        }
      }

      // 2) medium sequential
      for (const a of parts.medium) {
        const ok = await runAssignment(a, ws.path, planPath);
        if (!ok) {
          if (watch) clearInterval(watch);
          return;
        }
      }

      // 3) low in parallel batches of 2
      const low = parts.low;
      for (let i = 0; i < low.length; i += 2) {
        const batch = low.slice(i, i + 2);
        touch(job, {
          log: [
            ...job.log,
            `∥ parallel hands batch: ${batch.map((b) => b.taskId).join(", ")}`,
          ],
        });
        const results = await Promise.all(
          batch.map((a) => runAssignment(a, ws.path, planPath)),
        );
        if (results.some((r) => !r)) {
          if (watch) clearInterval(watch);
          return;
        }
      }

      // 4) Lead finalize + guard
      const finalizeId = "finalize";
      const leadPhase = phases.find((p) => p.id === finalizeId);
      const leadAgentId = leadPhase?.agentId ?? "cursor-lead";
      updatePhase(job, finalizeId, "running");
      touch(job, {
        currentAgentId: leadAgentId,
        currentRole: "lead-finalize",
        phase: "finalize",
        log: [...job.log, `▶ lead finalize`],
      });

      const finGuard = await runGuard({
        role: "lead-finalize",
        taskId: "finalize",
        title: "Lead finalize",
        agentId: leadAgentId,
      });
      if (!finGuard) {
        updatePhase(job, finalizeId, "error");
        touch(job, {
          status: "error",
          error: "Jev guard blocked lead finalize",
        });
        if (watch) clearInterval(watch);
        return;
      }

      const fin = await executor.build({
        prompt: leadFinalizePrompt({
          run: opts.run,
          workspace: ws.path,
          planPath,
        }),
        workspace: ws.path,
        onChunk: makeChunkSink(job),
        timeoutMs: 8 * 60_000,
        role: "lead-finalize",
        taskId: "finalize",
        title: "Lead finalize",
      });

      if (!fin.ok) {
        updatePhase(job, finalizeId, "error");
        touch(job, {
          status: "error",
          error: fin.text || "lead finalize failed",
          log: [...job.log, "✗ lead finalize failed"],
        });
        if (watch) clearInterval(watch);
        return;
      }

      updatePhase(job, finalizeId, "done");
      if (watch) clearInterval(watch);
      touch(job, {
        status: "done",
        currentAgentId: leadAgentId,
        currentRole: "lead-finalize",
        output: (job.output || "").slice(-OUTPUT_CAP),
        log: [...job.log, "✓ lead finalize done", "fleet build finished"],
      });
    } catch (err) {
      if (watch) clearInterval(watch);
      touch(job, {
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();

  return job;
}
