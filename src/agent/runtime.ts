import type { PolicyProfileName } from "../auth/registry.js";
import type { AgentRun, AgentStep, ToolCall } from "../types.js";
import { createDemoTools } from "./tools.js";
import type { WrappedTool } from "./wrap.js";

export type RunAgentOptions = {
  goal: string;
  script: ToolCall[];
  /** Stop the loop when a tool is denied (default true). Review still continues. */
  stopOnDeny?: boolean;
  tools?: Record<string, WrappedTool>;
  policyProfile?: PolicyProfileName;
};

/**
 * Scripted agent loop: each proposed tool call goes through wrapTool → guard.
 */
export async function runAgent(opts: RunAgentOptions): Promise<AgentRun> {
  const tools = opts.tools ?? createDemoTools();
  const stopOnDeny = opts.stopOnDeny ?? true;
  const steps: AgentStep[] = [];
  let stoppedReason: string | undefined;

  for (const call of opts.script) {
    const tool = tools[call.name];
    if (!tool) {
      stoppedReason = `unknown tool: ${call.name}`;
      break;
    }

    const result = await tool.invoke(call.args, {
      rationale: call.rationale,
      policyProfile: opts.policyProfile,
    });
    steps.push({ call, result });

    if (!result.ok && result.verdict.policy.decision === "deny" && stopOnDeny) {
      stoppedReason = `deny at ${call.name}: ${result.output}`;
      break;
    }
  }

  return { goal: opts.goal, steps, stoppedReason };
}

/** Compact console summary for jury demos. */
export function formatAgentRun(run: AgentRun): string {
  const lines: string[] = [`goal: ${run.goal}`, ""];
  for (let i = 0; i < run.steps.length; i++) {
    const step = run.steps[i]!;
    const v = step.result.verdict;
    lines.push(
      `step ${i + 1}: ${step.call.name} ${JSON.stringify(step.call.args)}`,
    );
    lines.push(
      `  policy=${v.policy.decision} seal=${v.seal.scheme} seq=${v.seal.seq} verified=${v.seal.verified} ok=${step.result.ok}`,
    );
    lines.push(`  output: ${step.result.output.split("\n")[0]}`);
    lines.push("");
  }
  if (run.stoppedReason) lines.push(`stopped: ${run.stoppedReason}`);
  return lines.join("\n");
}
