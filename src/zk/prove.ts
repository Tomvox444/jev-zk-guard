/**
 * PROVER only — has the private Jev scores (witness).
 * Never call this from an untrusted verifier path.
 */
import { existsSync } from "node:fs";
import { groth16 } from "snarkjs";
import type { JevJudgment, PolicyResult, ProposedCommand } from "../types.js";
import { privateWitnessFrom, publicSignalsFrom } from "./inputs.js";
import { ZK_WASM, ZK_ZKEY } from "./paths.js";

export type Groth16ProofJson = {
  pi_a: string[];
  pi_b: string[][];
  pi_c: string[];
  protocol: string;
  curve: string;
};

export type ProveResult = {
  proof: Groth16ProofJson;
  /** Public signals only — safe to ship to a third-party verifier. */
  publicSignals: string[];
};

export function zkArtifactsReady(): boolean {
  return existsSync(ZK_WASM) && existsSync(ZK_ZKEY);
}

/**
 * Generate a Groth16 proof that private scores match public policy decision.
 * Witness (scores) never leaves this function's input → proof+publicSignals.
 */
export async function provePolicyCompliance(
  cmd: ProposedCommand,
  judgment: JevJudgment,
  policy: PolicyResult,
): Promise<ProveResult> {
  if (!zkArtifactsReady()) {
    throw new Error(
      "ZK artifacts missing — run: node scripts/zk-setup.mjs",
    );
  }

  const w = privateWitnessFrom(judgment);
  const pubs = publicSignalsFrom(policy, cmd.command);
  const input = {
    dangerous: w.dangerous,
    exfil: w.exfil,
    offPolicy: w.offPolicy,
    benign: w.benign,
    dangerousMax: Number(pubs[0]),
    exfilMax: Number(pubs[1]),
    offPolicyMax: Number(pubs[2]),
    benignMin: Number(pubs[3]),
    decision: Number(pubs[4]),
    cmdHash: pubs[5],
  };

  const { proof, publicSignals } = await groth16.fullProve(
    input,
    ZK_WASM,
    ZK_ZKEY,
  );

  return {
    proof: proof as Groth16ProofJson,
    publicSignals: publicSignals.map(String),
  };
}
