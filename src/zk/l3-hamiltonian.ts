import {
  bindHamiltonianInstance,
  commitValue,
  fiatShamirChallenge,
  hasEdge,
  isHamiltonianPath,
  randomBlinding,
  sha256Hex,
  type Graph,
} from "./graph.js";
import type { JevJudgment, PolicyResult, ProposedCommand, ZkProof } from "../types.js";

type L3ProofBlob = {
  /** Public graph adjacency (bound to judgment via seed). */
  adj: number[][];
  n: number;
  /** Commitment to the secret Hamilton path (as JSON array). */
  pathCommitment: string;
  /** Fiat–Shamir challenge: 0 = open full path (demo soundness), 1 = open random edge check. */
  challenge: number;
  /** Response depending on challenge. */
  response:
    | {
        kind: "path";
        path: number[];
        blinding: string;
      }
    | {
        kind: "edge";
        index: number;
        u: number;
        v: number;
        pathBlinding: string;
        path: number[]; // demo: open path for edge check (educational FS round)
      };
};

/**
 * Educational Hamiltonian ZK (Fiat–Shamir).
 * Graph is publicly derived from H(command||judgment||policy); witness is a Hamilton path.
 * Not a production SNARK — demo soundness for the hackathon.
 */
export function proveL3(
  cmd: ProposedCommand,
  judgment: JevJudgment,
  policy: PolicyResult,
): ZkProof {
  const commandHash = sha256Hex(cmd.command);
  const seed = sha256Hex(
    JSON.stringify({ commandHash, judgment, policy: { decision: policy.decision, thresholds: policy.thresholds } }),
  );
  const { graph, witness } = bindHamiltonianInstance(seed);
  const pathBlinding = randomBlinding();
  const pathCommitment = commitValue(JSON.stringify(witness), pathBlinding);

  const transcript = sha256Hex(
    JSON.stringify({
      commandHash,
      decision: policy.decision,
      adj: graph.adj,
      pathCommitment,
    }),
  );
  // Two challenge types; for demo we always need verifiable Hamilton — use challenge 0 (open path)
  // half the time and edge check otherwise. Edge check still opens path in this educational version.
  const challenge = fiatShamirChallenge(transcript, 2);

  let response: L3ProofBlob["response"];
  if (challenge === 0) {
    response = { kind: "path", path: witness, blinding: pathBlinding };
  } else {
    const index = fiatShamirChallenge(transcript + ":edge", witness.length - 1);
    response = {
      kind: "edge",
      index,
      u: witness[index]!,
      v: witness[index + 1]!,
      pathBlinding,
      path: witness,
    };
  }

  const proof: L3ProofBlob = {
    adj: graph.adj,
    n: graph.n,
    pathCommitment,
    challenge,
    response,
  };

  const commitment = sha256Hex(
    JSON.stringify({ commandHash, pathCommitment, decision: policy.decision }),
  );

  const zk: ZkProof = {
    level: "L3",
    scheme: "hamiltonian-fiat-shamir",
    commitment,
    publicInputs: {
      commandHash,
      decision: policy.decision,
      thresholds: policy.thresholds,
      level: "L3",
    },
    proof,
    verified: false,
  };
  zk.verified = verifyL3(zk, cmd, judgment, policy);
  return zk;
}

export function verifyL3(
  zk: ZkProof,
  cmd: ProposedCommand,
  judgment: JevJudgment,
  policy: PolicyResult,
): boolean {
  if (zk.level !== "L3" || zk.scheme !== "hamiltonian-fiat-shamir") return false;

  const highRisk =
    policy.decision === "deny" ||
    judgment.dangerous >= policy.thresholds.dangerousMax ||
    judgment.exfil >= policy.thresholds.exfilMax;
  if (!highRisk) return false;

  const proof = zk.proof as L3ProofBlob;
  const commandHash = sha256Hex(cmd.command);
  if (zk.publicInputs.commandHash !== commandHash) return false;

  const seed = sha256Hex(
    JSON.stringify({ commandHash, judgment, policy: { decision: policy.decision, thresholds: policy.thresholds } }),
  );
  const { graph: expected } = bindHamiltonianInstance(seed);
  if (proof.n !== expected.n) return false;
  if (JSON.stringify(proof.adj) !== JSON.stringify(expected.adj)) return false;

  const graph: Graph = { n: proof.n, adj: proof.adj };
  const transcript = sha256Hex(
    JSON.stringify({
      commandHash,
      decision: policy.decision,
      adj: proof.adj,
      pathCommitment: proof.pathCommitment,
    }),
  );
  if (fiatShamirChallenge(transcript, 2) !== proof.challenge) return false;

  let path: number[];
  let blinding: string;
  if (proof.response.kind === "path") {
    if (proof.challenge !== 0) return false;
    path = proof.response.path;
    blinding = proof.response.blinding;
  } else {
    if (proof.challenge !== 1) return false;
    path = proof.response.path;
    blinding = proof.response.pathBlinding;
    const { index, u, v } = proof.response;
    if (path[index] !== u || path[index + 1] !== v) return false;
    if (!hasEdge(graph, u, v)) return false;
  }

  if (commitValue(JSON.stringify(path), blinding) !== proof.pathCommitment) return false;
  if (!isHamiltonianPath(graph, path)) return false;

  const expectedCommitment = sha256Hex(
    JSON.stringify({ commandHash, pathCommitment: proof.pathCommitment, decision: policy.decision }),
  );
  return zk.commitment === expectedCommitment;
}
