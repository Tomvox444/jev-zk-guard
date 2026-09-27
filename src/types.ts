/** Agent proposes a shell / tool command. */
export type ProposedCommand = {
  id: string;
  command: string;
  cwd?: string;
  rationale?: string;
};

/** Probabilistic judgments from Jev (System One). */
export type JevJudgment = {
  /** Destructive / irreversible ops (rm -rf, drop db, …). */
  dangerous: number;
  /** Looks like exfil / credential theft. */
  exfil: number;
  /** Outside the agent's stated task. */
  offPolicy: number;
  /** Benign local read / list / build. */
  benign: number;
  model: string;
  raw?: unknown;
};

export type PolicyDecision = "allow" | "deny" | "review";

export type PolicyResult = {
  decision: PolicyDecision;
  reasons: string[];
  /** Thresholds used — kept for ZK public inputs later. */
  thresholds: {
    dangerousMax: number;
    exfilMax: number;
    offPolicyMax: number;
    benignMin: number;
  };
};

export type ZkLevel = "L1" | "L2" | "L3";

export type ZkScheme =
  | "sha256-commitment"
  | "sigma-policy-path"
  | "hamiltonian-fiat-shamir";

/** Commitment + public statement a verifier can check without re-calling Jev. */
export type ZkProof = {
  level: ZkLevel;
  scheme: ZkScheme;
  /** Hash binding of command + judgment + policy (or scheme-specific root). */
  commitment: string;
  /** What the outside world sees. */
  publicInputs: {
    commandHash: string;
    decision: PolicyDecision;
    thresholds: PolicyResult["thresholds"];
    level: ZkLevel;
  };
  /** Scheme-specific proof blob (JSON-serializable). */
  proof: unknown;
  verified: boolean;
};

export type SimResult = {
  ran: boolean;
  stdout: string;
  note: string;
};

export type GuardVerdict = {
  command: ProposedCommand;
  judgment: JevJudgment;
  policy: PolicyResult;
  zk: ZkProof;
  sim: SimResult;
};

/** Agent tool proposal (before guard). */
export type ToolCall = {
  name: string;
  args: Record<string, unknown>;
  rationale?: string;
};

export type ToolDef = {
  name: string;
  description: string;
  run: (args: Record<string, unknown>) => Promise<string>;
};

/** Result after wrapTool + guard gate. */
export type ToolResult = {
  ok: boolean;
  output: string;
  verdict: GuardVerdict;
};

export type AgentStep = {
  call: ToolCall;
  result: ToolResult;
};

export type AgentRun = {
  goal: string;
  steps: AgentStep[];
  stoppedReason?: string;
};
