import type { FleetRole } from "../auth/registry.js";
import type { FleetAssignment, FleetRun } from "./orchestrate.js";
import { briefToMarkdown, leadFinalizeBrief } from "./lead-plan.js";

export type BuildPhase = {
  id: string;
  title: string;
  agentId: string;
  role: FleetRole | "lead-finalize";
  status: "queued" | "running" | "done" | "error";
};

const WORKSPACE_RULES = `CRITICAL constraints:
- Work ONLY inside the given workspace directory.
- Do NOT modify the Jev-ZK Guard control-plane repository.
- Execute the Lead brief below — do not expand scope or re-interpret the whole goal.`;

const BUCKET_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/** high → medium → low for build execution order. */
export function orderAssignmentsForBuild(
  assignments: FleetAssignment[],
): FleetAssignment[] {
  return [...assignments].sort((a, b) => {
    const ra = BUCKET_RANK[a.complexity.bucket] ?? 1;
    const rb = BUCKET_RANK[b.complexity.bucket] ?? 1;
    if (ra !== rb) return ra - rb;
    return a.taskId.localeCompare(b.taskId);
  });
}

export function partitionAssignments(assignments: FleetAssignment[]): {
  high: FleetAssignment[];
  medium: FleetAssignment[];
  low: FleetAssignment[];
} {
  const ordered = orderAssignmentsForBuild(assignments);
  return {
    high: ordered.filter((a) => a.complexity.bucket === "high"),
    medium: ordered.filter((a) => a.complexity.bucket === "medium"),
    low: ordered.filter((a) => a.complexity.bucket === "low"),
  };
}

export function buildPhasesFromRun(run: FleetRun): BuildPhase[] {
  const ordered = orderAssignmentsForBuild(run.assignments);
  const phases: BuildPhase[] = ordered.map((a) => ({
    id: a.taskId,
    title: a.title,
    agentId: a.agentId,
    role: a.role,
    status: "queued" as const,
  }));
  const leadId =
    run.assignments.find((a) => a.role === "lead")?.agentId ??
    run.steps.find((s) => s.role === "lead")?.agentId ??
    "cursor-lead";
  phases.push({
    id: "finalize",
    title: "Lead finalize — polish & consistency",
    agentId: leadId,
    role: "lead-finalize",
    status: "queued",
  });
  return phases;
}

export function roleTaskPrompt(opts: {
  run: FleetRun;
  assignment: FleetAssignment;
  workspace: string;
  planPath: string;
}): string {
  const { run, assignment, workspace, planPath } = opts;
  const roleLine =
    assignment.role === "hands"
      ? `You are Hands. Execute the Lead brief exactly — minimal files, no drive-by work.`
      : assignment.role === "reviewer"
        ? `You are Reviewer. Execute the Lead brief with solid quality; stay inside doNot / acceptance.`
        : `You are Lead. Execute your own brief for design / architecture — brand and atmosphere are critical.`;

  return `${roleLine}

${WORKSPACE_RULES}

Workspace: ${workspace}
Plan file: ${planPath}
Task: ${assignment.taskId} — ${assignment.title}
Agent: ${assignment.agentId} [${assignment.role}] · ${assignment.complexity.bucket}

## Lead brief (source of truth)

${briefToMarkdown(assignment.brief)}

Overall goal (context only — do not expand beyond the brief):
${run.goal}

Read PLAN.md if present. When done, leave the handoff state described in the brief.`;
}

export function leadFinalizePrompt(opts: {
  run: FleetRun;
  workspace: string;
  planPath: string;
}): string {
  const brief = opts.run.finalizeBrief ?? leadFinalizeBrief(opts.run.goal);
  return `You are Lead doing final integration.

${WORKSPACE_RULES}

Workspace: ${opts.workspace}
Plan file: ${opts.planPath}

## Lead finalize brief (source of truth)

${briefToMarkdown(brief)}

Teammates already executed:
${opts.run.assignments.map((a) => `- [${a.role}/${a.agentId}] ${a.title}`).join("\n")}

Goal (context): ${opts.run.goal}`;
}
