import type { PolicyResult, ProposedCommand, SimResult } from "./types.js";

/** Never runs the real command — demo-safe. */
export function simulateExecution(
  cmd: ProposedCommand,
  policy: PolicyResult,
  sealOk: boolean,
): SimResult {
  if (!sealOk) {
    return { ran: false, stdout: "", note: "blocked: audit seal verify failed" };
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
