import { analyzeWithJev } from "./jev.js";
import { evaluatePolicy } from "./policy.js";
import { simulateExecution } from "./sim.js";
import type { GuardVerdict, ProposedCommand } from "./types.js";
import type { PolicyProfileName } from "./auth/registry.js";
import { proveAndVerify } from "./zk.js";

export type GuardOptions = {
  policyProfile?: PolicyProfileName;
};

/**
 * Agent proposes → Jev analyzes → Policy → ZK → Simulated execution
 */
export async function guard(
  cmd: ProposedCommand,
  opts: GuardOptions = {},
): Promise<GuardVerdict> {
  const judgment = await analyzeWithJev(cmd);
  const policy = evaluatePolicy(judgment, opts.policyProfile ?? "default");
  const zk = proveAndVerify(cmd, judgment, policy);
  const sim = simulateExecution(cmd, policy, zk.verified);
  return { command: cmd, judgment, policy, zk, sim };
}
