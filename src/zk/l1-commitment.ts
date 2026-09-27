import {
  commitValue,
  randomBlinding,
  sha256Hex,
} from "./graph.js";
import type { JevJudgment, PolicyResult, ProposedCommand, ZkProof } from "../types.js";

export function proveL1(
  cmd: ProposedCommand,
  judgment: JevJudgment,
  policy: PolicyResult,
): ZkProof {
  const commandHash = sha256Hex(cmd.command);
  const commitment = sha256Hex(
    JSON.stringify({ commandHash, judgment, policy }),
  );
  const publicInputs = {
    commandHash,
    decision: policy.decision,
    thresholds: policy.thresholds,
    level: "L1" as const,
  };
  const blinding = randomBlinding();
  const proof = {
    binding: commitValue(commitment, blinding),
    // Opening retained for demo verify (L1 is binding, not ZK).
    opening: { commitment, blinding },
  };

  return {
    level: "L1",
    scheme: "sha256-commitment",
    commitment,
    publicInputs,
    proof,
    verified: verifyL1(
      {
        level: "L1",
        scheme: "sha256-commitment",
        commitment,
        publicInputs,
        proof,
        verified: false,
      },
      cmd,
      judgment,
      policy,
    ),
  };
}

export function verifyL1(
  zk: ZkProof,
  cmd: ProposedCommand,
  judgment: JevJudgment,
  policy: PolicyResult,
): boolean {
  if (zk.level !== "L1" || zk.scheme !== "sha256-commitment") return false;
  if (policy.decision !== "allow") return false;

  const commandHash = sha256Hex(cmd.command);
  const expected = sha256Hex(
    JSON.stringify({ commandHash, judgment, policy }),
  );
  if (zk.commitment !== expected) return false;
  if (zk.publicInputs.commandHash !== commandHash) return false;
  if (zk.publicInputs.decision !== policy.decision) return false;

  const p = zk.proof as { binding?: string; opening?: { commitment: string; blinding: string } };
  if (!p.opening || !p.binding) return false;
  if (p.opening.commitment !== zk.commitment) return false;
  return commitValue(p.opening.commitment, p.opening.blinding) === p.binding;
}
