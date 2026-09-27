import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FleetRun } from "./orchestrate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

export function workspaceRoot(): string {
  return process.env.FLEET_WORKSPACE_ROOT ?? join(ROOT, "data/fleet/workspaces");
}

export function workspacePathForRun(runId: string): string {
  return join(workspaceRoot(), runId);
}

export type FleetWorkspace = {
  path: string;
  planPath: string;
  readmePath: string;
};

/**
 * Isolated sandbox per fleet run — never the guard repo root.
 */
export async function ensureWorkspace(run: FleetRun): Promise<FleetWorkspace> {
  const path = workspacePathForRun(run.id);
  await mkdir(path, { recursive: true });
  const planPath = join(path, "PLAN.md");
  const readmePath = join(path, "README.md");
  const readme = [
    `# Fleet workspace`,
    ``,
    `- **Run:** ${run.id}`,
    `- **Tenant:** ${run.tenantId}`,
    `- **Goal:** ${run.goal}`,
    `- **Created:** ${new Date().toISOString()}`,
    ``,
    `All build/plan executor work must stay inside this directory.`,
    `Do not modify the Jev-ZK Guard control-plane repo.`,
    ``,
  ].join("\n");
  await writeFile(readmePath, readme, "utf8");
  return { path, planPath, readmePath };
}
