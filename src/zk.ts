import type { JevJudgment, PolicyResult, ProposedCommand, ZkLevel, ZkProof } from "./types.js";
import { proveL1 } from "./zk/l1-commitment.js";
import { proveL2 } from "./zk/l2-sigma-path.js";
import { proveL3 } from "./zk/l3-hamiltonian.js";

/** Pick proof hardness from policy decision + Jev risk scores. */
export function selectLevel(judgment: JevJudgment, policy: PolicyResult): ZkLevel {
  if (
    policy.decision === "deny" ||
    judgment.dangerous >= policy.thresholds.dangerousMax ||
    judgment.exfil >= policy.thresholds.exfilMax
  ) {
    return "L3";
  }
  if (policy.decision === "review") return "L2";
  return "L1";
}

export function proveAndVerify(
  cmd: ProposedCommand,
  judgment: JevJudgment,
  policy: PolicyResult,
): ZkProof {
  const level = selectLevel(judgment, policy);
  switch (level) {
    case "L3":
      return proveL3(cmd, judgment, policy);
    case "L2":
      return proveL2(cmd, judgment, policy);
    case "L1":
    default:
      return proveL1(cmd, judgment, policy);
  }
}
