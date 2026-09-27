import {
  bucketScores,
  commitValue,
  fiatShamirChallenge,
  isValidPath,
  policyStateGraph,
  policyWitnessPath,
  randomBlinding,
  sha256Hex,
} from "./graph.js";
import type { JevJudgment, PolicyResult, ProposedCommand, ZkProof } from "../types.js";

type L2ProofBlob = {
  /** Commitments to each vertex in the secret path (order preserved). */
  vertexCommitments: string[];
  /** Fiat–Shamir challenge bit(s) as 0|1|2 for which edge openings to reveal. */
  challenge: number;
  /** Opened consecutive edge for the challenged index. */
  openedEdge: {
    index: number;
    u: number;
    v: number;
    blindU: string;
    blindV: string;
  };
  /** Public accept/reject sink claimed. */
  sink: number;
  pathLength: number;
};

/**
 * Σ-style policy-path proof (Fiat–Shamir):
 * commit the secret path; challenge picks one edge to open;
 * verifier checks edge exists in the public policy graph and commitments match.
 * Does not publish full path or raw Jev scores.
 */
export function proveL2(
  cmd: ProposedCommand,
  judgment: JevJudgment,
  policy: PolicyResult,
): ZkProof {
  const commandHash = sha256Hex(cmd.command);
  const graph = policyStateGraph();
  const bucket = bucketScores(judgment.dangerous, judgment.exfil, judgment.offPolicy);
  const path = policyWitnessPath(bucket, policy.decision);

  const blinds = path.map(() => randomBlinding());
  const vertexCommitments = path.map((v, i) =>
    commitValue(String(v), blinds[i]!),
  );

  const transcript = sha256Hex(
    JSON.stringify({
      commandHash,
      decision: policy.decision,
      thresholds: policy.thresholds,
      vertexCommitments,
      graph: graph.adj,
    }),
  );
  const challenge = fiatShamirChallenge(transcript, path.length - 1);
  const index = challenge;
  const u = path[index]!;
  const v = path[index + 1]!;

  const proof: L2ProofBlob = {
    vertexCommitments,
    challenge,
    openedEdge: {
      index,
      u,
      v,
      blindU: blinds[index]!,
      blindV: blinds[index + 1]!,
    },
    sink: path[path.length - 1]!,
    pathLength: path.length,
  };

  const commitment = sha256Hex(
    JSON.stringify({ commandHash, vertexCommitments, decision: policy.decision }),
  );

  const zk: ZkProof = {
    level: "L2",
    scheme: "sigma-policy-path",
    commitment,
    publicInputs: {
      commandHash,
      decision: policy.decision,
      thresholds: policy.thresholds,
      level: "L2",
    },
    proof,
    verified: false,
  };
  zk.verified = verifyL2(zk, cmd, judgment, policy);
  return zk;
}

export function verifyL2(
  zk: ZkProof,
  cmd: ProposedCommand,
  _judgment: JevJudgment,
  policy: PolicyResult,
): boolean {
  if (zk.level !== "L2" || zk.scheme !== "sigma-policy-path") return false;
  if (policy.decision !== "review") return false;

  const proof = zk.proof as L2ProofBlob;
  const graph = policyStateGraph();
  const commandHash = sha256Hex(cmd.command);
  if (zk.publicInputs.commandHash !== commandHash) return false;

  const { vertexCommitments, openedEdge, challenge, sink, pathLength } = proof;
  if (pathLength < 2 || vertexCommitments.length !== pathLength) return false;
  if (challenge !== openedEdge.index) return false;
  if (openedEdge.index < 0 || openedEdge.index >= pathLength - 1) return false;

  // Recompute Fiat–Shamir
  const transcript = sha256Hex(
    JSON.stringify({
      commandHash,
      decision: policy.decision,
      thresholds: policy.thresholds,
      vertexCommitments,
      graph: graph.adj,
    }),
  );
  if (fiatShamirChallenge(transcript, pathLength - 1) !== challenge) return false;

  // Opened commitments match
  if (commitValue(String(openedEdge.u), openedEdge.blindU) !== vertexCommitments[openedEdge.index]) {
    return false;
  }
  if (
    commitValue(String(openedEdge.v), openedEdge.blindV) !==
    vertexCommitments[openedEdge.index + 1]
  ) {
    return false;
  }

  // Edge must exist; path fragment valid
  if (!isValidPath(graph, [openedEdge.u, openedEdge.v])) return false;

  // Sink must be accept (4) for review
  if (sink !== 4) return false;

  // First commitment should open to start(0) — we don't open it unless challenged;
  // enforce publicly that a review path ends at accept.
  const expectedCommitment = sha256Hex(
    JSON.stringify({ commandHash, vertexCommitments, decision: policy.decision }),
  );
  return zk.commitment === expectedCommitment;
}
