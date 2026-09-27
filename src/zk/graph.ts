import { createHash, randomBytes } from "node:crypto";

export type Graph = {
  /** Vertex labels 0..n-1 */
  n: number;
  /** Undirected adjacency: adj[u] is sorted list of neighbors */
  adj: number[][];
};

export function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function sha256Buf(data: string | Buffer): Buffer {
  return createHash("sha256").update(data).digest();
}

/** Deterministic challenge in [0, mod) from Fiat–Shamir transcript. */
export function fiatShamirChallenge(transcript: string, mod: number): number {
  const h = sha256Hex(transcript);
  return Number.parseInt(h.slice(0, 8), 16) % mod;
}

export function commitValue(value: string, blinding: string): string {
  return sha256Hex(`commit:${blinding}:${value}`);
}

export function randomBlinding(): string {
  return randomBytes(16).toString("hex");
}

export function hasEdge(g: Graph, u: number, v: number): boolean {
  return g.adj[u]?.includes(v) ?? false;
}

export function isHamiltonianPath(g: Graph, path: number[]): boolean {
  if (path.length !== g.n) return false;
  const seen = new Set<number>();
  for (let i = 0; i < path.length; i++) {
    const v = path[i];
    if (v === undefined || v < 0 || v >= g.n || seen.has(v)) return false;
    seen.add(v);
    if (i > 0) {
      const prev = path[i - 1]!;
      if (!hasEdge(g, prev, v)) return false;
    }
  }
  return seen.size === g.n;
}

export function isValidPath(g: Graph, path: number[]): boolean {
  if (path.length < 2) return false;
  for (let i = 1; i < path.length; i++) {
    const u = path[i - 1]!;
    const v = path[i]!;
    if (!hasEdge(g, u, v)) return false;
  }
  return true;
}

/** Build undirected graph from edge list. */
export function fromEdges(n: number, edges: Array<[number, number]>): Graph {
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const [u, v] of edges) {
    if (u === v) continue;
    adj[u]!.push(v);
    adj[v]!.push(u);
  }
  for (const list of adj) list.sort((a, b) => a - b);
  // dedupe
  for (let i = 0; i < n; i++) {
    adj[i] = [...new Set(adj[i])];
  }
  return { n, adj };
}

/**
 * Policy-state graph for L2.
 * Nodes: start(0) → safe(1)/borderline(2)/risky(3) → accept(4) | reject(5)
 */
export function policyStateGraph(): Graph {
  return fromEdges(6, [
    [0, 1],
    [0, 2],
    [0, 3],
    [1, 4],
    [2, 4], // borderline may still accept under review
    [2, 5],
    [3, 5],
    [1, 2],
    [2, 3],
  ]);
}

export type ScoreBucket = "safe" | "borderline" | "risky";

export function bucketScores(dangerous: number, exfil: number, offPolicy: number): ScoreBucket {
  const risk = Math.max(dangerous, exfil, offPolicy);
  if (risk < 0.35) return "safe";
  if (risk < 0.7) return "borderline";
  return "risky";
}

const BUCKET_NODE: Record<ScoreBucket, number> = {
  safe: 1,
  borderline: 2,
  risky: 3,
};

/** Secret path start → bucket → accept|reject for L2. */
export function policyWitnessPath(
  bucket: ScoreBucket,
  decision: "allow" | "deny" | "review",
): number[] {
  const mid = BUCKET_NODE[bucket];
  const end = decision === "deny" ? 5 : 4;
  return [0, mid, end];
}

/**
 * Hamiltonian demo graph for L3 (~10 nodes).
 * Path 0-1-2-...-9 is always a valid Hamilton path; extra edges add noise.
 */
export function hamiltonianDemoGraph(): { graph: Graph; witness: number[] } {
  const n = 10;
  const path = Array.from({ length: n }, (_, i) => i);
  const edges: Array<[number, number]> = [];
  for (let i = 0; i < n - 1; i++) edges.push([i, i + 1]);
  // chord edges
  edges.push([0, 3], [2, 5], [4, 7], [1, 6], [3, 8], [5, 9], [0, 5], [2, 8]);
  return { graph: fromEdges(n, edges), witness: path };
}

/**
 * Bind a Hamilton witness to judgment+policy via a seeded permutation of labels.
 * Public graph is the relabeled demo graph; witness is the image of the base path.
 */
export function bindHamiltonianInstance(
  seed: string,
): { graph: Graph; witness: number[] } {
  const { graph: base, witness: basePath } = hamiltonianDemoGraph();
  const n = base.n;
  // Derive a permutation from seed
  const ranked = Array.from({ length: n }, (_, i) => ({
    i,
    k: sha256Hex(`${seed}:perm:${i}`),
  })).sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0));
  const perm = ranked.map((r) => r.i); // old -> position in sorted = new label via inverse
  // perm[j] = old vertex at rank j; we want map old->new
  const oldToNew = new Array<number>(n);
  for (let newLabel = 0; newLabel < n; newLabel++) {
    oldToNew[perm[newLabel]!] = newLabel;
  }
  const edges: Array<[number, number]> = [];
  for (let u = 0; u < n; u++) {
    for (const v of base.adj[u]!) {
      if (u < v) edges.push([oldToNew[u]!, oldToNew[v]!]);
    }
  }
  const witness = basePath.map((v) => oldToNew[v]!);
  return { graph: fromEdges(n, edges), witness };
}
