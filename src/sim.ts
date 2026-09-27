import type { PolicyResult, ProposedCommand, SimResult } from "./types.js";

/** Never runs the real command — demo-safe. */
export function simulateExecution(
  cmd: ProposedCommand,
  policy: PolicyResult,
  attestOk: boolean,
): SimResult {
  if (!attestOk) {
    return { ran: false, stdout: "", note: "blocked: zk/audit verify failed" };
  }
  if (policy.decision === "deny") {
    return { ran: false, stdout: "", note: "blocked: policy deny" };
  }
  if (policy.decision === "review") {
    return { ran: false, stdout: "", note: "held for human review" };
  }
  return {
    ran: true,
    stdout: `[sim] would run: ${cmd.command}`,
    note: "simulated only — no real exec",
  };
}
