import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { orchestrateFleet } from "../src/fleet/orchestrate.ts";
import { roleTaskPrompt } from "../src/fleet/build-fleet.ts";
import { startBuildJob, getJob } from "../src/fleet/jobs.ts";

process.env.JEV_STUB ??= "1";
process.env.FLEET_EXECUTOR ??= "noop";

const goal =
  'Build a landing page for "Lattice" — hero visual design, product story copy, and use-cases. No purple theme. CTAs: "Start guarding" and "See how it works".';

const run = await orchestrateFleet({
  tenantId: "dev",
  goal,
  consoleAgentId: "fleet-console",
});

console.log(
  "assignments",
  run.assignments
    .map(
      (a) =>
        `${a.role}/${a.complexity.bucket}:${a.taskId} ${a.title.slice(0, 40)}`,
    )
    .join(" | "),
);

for (const a of run.assignments) {
  if (!a.brief) throw new Error(`missing brief on ${a.taskId}`);
  if (a.brief.doNot.length < 1) {
    throw new Error(`brief.doNot empty on ${a.taskId}`);
  }
  if (a.brief.acceptance.length < 1) {
    throw new Error(`brief.acceptance empty on ${a.taskId}`);
  }
}

if (!run.finalizeBrief?.doNot?.length) {
  throw new Error("missing finalizeBrief");
}

const design = run.assignments.find(
  (a) =>
    a.complexity.bucket === "high" &&
    /design|hero|visual|brand/i.test(a.title),
);
if (!design || design.role !== "lead") {
  throw new Error(
    `expected high/lead design task, got: ${JSON.stringify(run.assignments.map((a) => a.title))}`,
  );
}

const prompt = roleTaskPrompt({
  run,
  assignment: design,
  workspace: "/tmp/ws",
  planPath: "/tmp/ws/PLAN.md",
});
if (!prompt.includes("Lead brief") || !prompt.includes(design.brief.objective)) {
  throw new Error("roleTaskPrompt missing Lead brief content");
}
if (!prompt.includes("Do NOT")) {
  throw new Error("roleTaskPrompt missing doNot section");
}
console.log("brief prompt ok for", design.taskId);

const copyHands = run.assignments.filter(
  (a) => a.complexity.bucket === "low" && a.role === "hands",
);
if (copyHands.length < 1) {
  throw new Error("expected at least one low/hands copy task");
}

const build = await startBuildJob({ run });
for (let i = 0; i < 200; i++) {
  await new Promise((r) => setTimeout(r, 80));
  const j = getJob(build.id);
  if (!j) continue;
  if (j.status === "done" || j.status === "error") {
    console.log("FINAL", j.status);
    const guards = j.log.filter((l) => /guard (ok|blocked)/.test(l));
    console.log("guards", guards.join("\n"));
    const files = await readdir(j.workspacePath);
    console.log("files", files.sort().join(", "));
    if (j.status !== "done") throw new Error(j.error || "error");
    if (!j.phases?.every((p) => p.status === "done")) {
      throw new Error("phases incomplete");
    }
    const plan = await readFile(join(j.workspacePath, "PLAN.md"), "utf8");
    if (!plan.includes("## Task briefs") || !plan.includes("Do NOT:")) {
      throw new Error("PLAN.md missing task briefs");
    }
    if (guards.filter((g) => g.includes("guard ok")).length < 2) {
      throw new Error("expected multiple guard ok lines");
    }
    if (j.log.some((l) => /guard blocked/.test(l))) {
      throw new Error("unexpected guard blocked");
    }
    if (
      copyHands.length >= 2 &&
      !j.log.some((l) => /parallel hands batch/.test(l))
    ) {
      throw new Error("expected parallel hands batch log");
    }
    if (!files.some((f) => f.startsWith("task-"))) {
      throw new Error("missing task artifacts");
    }
    console.log("FLEET_SMOKE_OK");
    process.exit(0);
  }
}
throw new Error("timeout waiting for build");
