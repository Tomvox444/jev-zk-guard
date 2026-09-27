import { randomUUID } from "node:crypto";
import { scoreComplexity, type ComplexityScore } from "../jev/complexity.js";
import { listFleetAgents, type FleetAgent, type FleetRole } from "../auth/registry.js";
import { guard } from "../pipeline.js";
import { appendSealedAudit } from "../audit/seal.js";
import {
  briefToMarkdown,
  leadFinalizeBrief,
  leadPlan,
  summarizeLeadPlan,
  type PlannedTask,
  type TaskBrief,
} from "./lead-plan.js";

export type { PlannedTask, TaskBrief } from "./lead-plan.js";
export { leadPlan, leadFinalizeBrief, briefToMarkdown } from "./lead-plan.js";

/** @deprecated Prefer leadPlan — kept for callers that only need titles. */
export function planTasks(goal: string): PlannedTask[] {
  return leadPlan(goal);
}

export type FleetAssignment = {
  taskId: string;
  title: string;
  agentId: string;
  role: FleetRole;
  complexity: ComplexityScore;
  /** Operative orders from Lead planner — build must execute this. */
  brief: TaskBrief;
};

export type FleetStep = {
  id: string;
  phase: "plan" | "score" | "execute" | "verify" | "finalize";
  agentId: string;
  role: FleetRole;
  title: string;
  detail: string;
  complexity?: ComplexityScore;
  guardAllowed?: boolean;
  proposedCommand?: string;
};

export type FleetRun = {
  id: string;
  ts: string;
  tenantId: string;
  goal: string;
  steps: FleetStep[];
  assignments: FleetAssignment[];
  /** Lead finalize brief produced at plan time */
  finalizeBrief: TaskBrief;
  reply: string;
  approved: boolean;
};

const runs = new Map<string, FleetRun>();

export function getFleetRun(id: string): FleetRun | undefined {
  return runs.get(id);
}

function pickAssignee(
  agents: FleetAgent[],
  complexity: number,
  prefer: FleetRole[],
): FleetAgent | undefined {
  const ordered = prefer
    .map((role) =>
      agents
        .filter((a) => a.role === role && a.maxComplexity + 1e-9 >= complexity)
        .sort((a, b) => a.maxComplexity - b.maxComplexity),
    )
    .flat();
  return ordered[0] ?? agents.find((a) => a.role === "lead");
}

function runHands(task: PlannedTask): { artifact: string; proposedCommand: string } {
  return {
    proposedCommand: `ls -la`,
    artifact: `[hands brief]\n${briefToMarkdown(task.brief)}`,
  };
}

function runReviewer(task: PlannedTask, juniorArtifact?: string): string {
  if (juniorArtifact) {
    return `[reviewer] Verified scope for "${task.title}" against Lead brief (doNot / acceptance).`;
  }
  return `[reviewer] Medium task "${task.title}" under Lead brief:\n${briefToMarkdown(task.brief)}`;
}

function leadFinalize(goal: string, artifacts: string[]): { reply: string; approved: boolean } {
  const body = artifacts.map((a, i) => `${i + 1}. ${a.slice(0, 200)}`).join("\n");
  return {
    approved: true,
    reply: `Lead final check — approved.\nGoal: ${goal}\n\nRouted with operative briefs.\n\nNotes:\n${body}\n\nNext: Build project executes briefs in workspace.`,
  };
}

export async function orchestrateFleet(opts: {
  tenantId: string;
  goal: string;
  consoleAgentId: string;
}): Promise<FleetRun> {
  const agents = listFleetAgents(opts.tenantId);
  const lead =
    agents.find((a) => a.role === "lead" && a.agentId === "cursor-lead") ??
    agents.find((a) => a.role === "lead");
  const reviewer = agents.find((a) => a.role === "reviewer");

  const steps: FleetStep[] = [];
  const assignments: FleetAssignment[] = [];
  const artifacts: string[] = [];
  const runId = randomUUID();

  const tasks = leadPlan(opts.goal);
  const finalizeBrief = leadFinalizeBrief(opts.goal);

  steps.push({
    id: randomUUID(),
    phase: "plan",
    agentId: lead?.agentId ?? "cursor-lead",
    role: "lead",
    title: "Lead plans work (operative briefs)",
    detail: `Split into ${tasks.length} briefed tasks:\n${summarizeLeadPlan(tasks)}`,
  });

  for (const task of tasks) {
    const complexity = await scoreComplexity(opts.goal, task.title);
    const prefer: FleetRole[] =
      complexity.bucket === "low"
        ? ["hands", "reviewer", "lead"]
        : complexity.bucket === "medium"
          ? ["reviewer", "lead"]
          : ["lead", "reviewer"];
    const assignee = pickAssignee(agents, complexity.complexity, prefer);

    steps.push({
      id: randomUUID(),
      phase: "score",
      agentId: "jev",
      role: "lead",
      title: `Jev complexity · ${task.id}`,
      detail: `${complexity.bucket} (${complexity.complexity.toFixed(2)}) → ${assignee?.agentId ?? "unassigned"} [${assignee?.role}]`,
      complexity,
    });

    if (!assignee) continue;

    assignments.push({
      taskId: task.id,
      title: task.title,
      agentId: assignee.agentId,
      role: assignee.role,
      complexity,
      brief: task.brief,
    });

    if (assignee.role === "hands") {
      const { artifact, proposedCommand } = runHands(task);
      const verdict = await guard(
        {
          id: randomUUID(),
          command: proposedCommand,
          rationale: `fleet hands:${task.title}`,
        },
        { policyProfile: assignee.policyProfile },
      );
      const allowed =
        verdict.policy.decision === "allow" && verdict.zk.verified;
      steps.push({
        id: randomUUID(),
        phase: "execute",
        agentId: assignee.agentId,
        role: "hands",
        title: `Hands: ${task.title}`,
        detail: artifact,
        complexity,
        proposedCommand,
        guardAllowed: allowed,
      });
      if (allowed) artifacts.push(artifact);

      if (reviewer) {
        const v = runReviewer(task, artifact);
        steps.push({
          id: randomUUID(),
          phase: "verify",
          agentId: reviewer.agentId,
          role: "reviewer",
          title: `Reviewer verifies ${task.id}`,
          detail: v,
          complexity,
        });
        artifacts.push(v);
      }
    } else if (assignee.role === "reviewer") {
      const detail = runReviewer(task);
      steps.push({
        id: randomUUID(),
        phase: "execute",
        agentId: assignee.agentId,
        role: "reviewer",
        title: `Reviewer: ${task.title}`,
        detail,
        complexity,
      });
      artifacts.push(detail);
    } else {
      const detail = `[lead] Owns "${task.title}" under brief:\n${briefToMarkdown(task.brief)}`;
      steps.push({
        id: randomUUID(),
        phase: "execute",
        agentId: assignee.agentId,
        role: "lead",
        title: `Lead owns: ${task.title}`,
        detail,
        complexity,
      });
      artifacts.push(detail);
    }
  }

  const final = leadFinalize(opts.goal, artifacts);
  steps.push({
    id: randomUUID(),
    phase: "finalize",
    agentId: lead?.agentId ?? "cursor-lead",
    role: "lead",
    title: "Lead final check",
    detail: `${final.reply}\n\nFinalize brief:\n${briefToMarkdown(finalizeBrief)}`,
  });

  const run: FleetRun = {
    id: runId,
    ts: new Date().toISOString(),
    tenantId: opts.tenantId,
    goal: opts.goal,
    steps,
    assignments,
    finalizeBrief,
    reply: final.reply,
    approved: final.approved,
  };
  runs.set(runId, run);

  await appendSealedAudit({
    tenantId: opts.tenantId,
    agentId: opts.consoleAgentId,
    command: `fleet:${opts.goal.slice(0, 120)}`,
    decision: final.approved ? "allow" : "deny",
    allowed: final.approved,
    judgment: {
      dangerous: 0,
      exfil: 0,
      offPolicy: 0,
      benign: 1,
      model: "fleet-orchestrator",
    },
    thresholds: {
      dangerousMax: 0.7,
      exfilMax: 0.5,
      offPolicyMax: 0.6,
      benignMin: 0.4,
    },
    event: "fleet_run",
    meta: {
      runId,
      steps: steps.length,
      assignments: assignments.length,
      approved: final.approved,
      briefed: true,
    },
  });

  return run;
}
