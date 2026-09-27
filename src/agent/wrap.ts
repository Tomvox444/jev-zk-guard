import { randomUUID } from "node:crypto";
import { guard } from "../pipeline.js";
import type { PolicyProfileName } from "../auth/registry.js";
import type { ToolCall, ToolDef, ToolResult } from "../types.js";

/** Serialize a tool call into a string the Jev stub / policy can score. */
export function serializeToolCall(call: ToolCall): string {
  if (call.name === "shell") {
    const cmd = String(call.args.command ?? "");
    return `shell ${cmd}`.trim();
  }
  if (call.name === "read_file") {
    return `read_file ${String(call.args.path ?? "")}`.trim();
  }
  if (call.name === "http_fetch") {
    return `http_fetch ${String(call.args.url ?? "")}`.trim();
  }
  return `${call.name} ${JSON.stringify(call.args)}`;
}

export type InvokeOptions = {
  rationale?: string;
  policyProfile?: PolicyProfileName;
};

/**
 * Wrap a tool so every invocation must pass guard (Jev → Policy → Groth16 ZK)
 * before the handler runs. Handlers stay simulation-only in the demo.
 */
export function wrapTool(tool: ToolDef) {
  return {
    name: tool.name,
    description: tool.description,
    async invoke(
      args: Record<string, unknown>,
      rationaleOrOpts?: string | InvokeOptions,
    ): Promise<ToolResult> {
      const opts: InvokeOptions =
        typeof rationaleOrOpts === "string"
          ? { rationale: rationaleOrOpts }
          : rationaleOrOpts ?? {};

      const call: ToolCall = {
        name: tool.name,
        args,
        rationale: opts.rationale,
      };
      const verdict = await guard(
        {
          id: randomUUID(),
          command: serializeToolCall(call),
          rationale: opts.rationale ?? `agent tool:${tool.name}`,
        },
        { policyProfile: opts.policyProfile ?? "default" },
      );

      const allowed =
        verdict.policy.decision === "allow" && verdict.zk.verified;

      if (!allowed) {
        const reason =
          verdict.sim.note ||
          `blocked: policy=${verdict.policy.decision} zk=${verdict.zk.scheme}/${verdict.zk.level}`;
        return { ok: false, output: reason, verdict };
      }

      const simOut = verdict.sim.stdout;
      const handlerOut = await tool.run(args);
      const output = simOut ? `${simOut}\n${handlerOut}` : handlerOut;
      return { ok: true, output, verdict };
    },
  };
}

export type WrappedTool = ReturnType<typeof wrapTool>;
