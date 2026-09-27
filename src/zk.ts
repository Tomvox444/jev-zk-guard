import type {
  JevJudgment,
  PolicyResult,
  ProposedCommand,
  ZkLevel,
  ZkProof,
} from "./types.js";
import { provePolicyCompliance, zkArtifactsReady } from "./zk/prove.js";
import { verifyPolicyCompliance } from "./zk/verify.js";
import { createHash } from "node:crypto";

/** Map policy decision → display level (severity label, same Groth16 circuit). */
export function selectLevel(_judgment: JevJudgment, policy: PolicyResult): ZkLevel {
  if (policy.decision === "deny") return "L3";
  if (policy.decision === "review") return "L2";
  return "L1";
}

/**
 * Prove with private scores, then verify with ONLY proof + public signals.
 * Verifier path never sees `judgment`.
 */
export async function attestWithZk(
  cmd: ProposedCommand,
  judgment: JevJudgment,
  policy: PolicyResult,
): Promise<ZkProof> {
  const level = selectLevel(judgment, policy);
  const commandHash = createHash("sha256").update(cmd.command, "utf8").digest("hex");

  if (!zkArtifactsReady()) {
    return {
      level,
      scheme: "groth16-policy",
      commitment: commandHash,
      publicInputs: {
        commandHash,
        decision: policy.decision,
        thresholds: policy.thresholds,
        level,
      },
      proof: { error: "artifacts_missing" },
      verified: false,
    };
  }

  // --- PROVER side (has witness) ---
  const { proof, publicSignals } = await provePolicyCompliance(
    cmd,
    judgment,
    policy,
  );

  // --- VERIFIER side (no judgment) ---
  const verified = await verifyPolicyCompliance(proof, publicSignals);

  return {
    level,
    scheme: "groth16-policy",
    commitment: createHash("sha256")
      .update(JSON.stringify({ publicSignals, pi_c: proof.pi_c }))
      .digest("hex"),
    publicInputs: {
      commandHash,
      decision: policy.decision,
      thresholds: policy.thresholds,
      level,
    },
    proof: {
      protocol: "groth16",
      curve: "bn128",
      publicSignals,
      groth16: proof,
    },
    verified,
  };
}
