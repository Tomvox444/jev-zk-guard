/** Agent proposes a shell / tool command. */
export type ProposedCommand = {
  id: string;
  command: string;
  cwd?: string;
  rationale?: string;
};

/** Probabilistic judgments from Jev (System One). */
export type JevJudgment = {
  dangerous: number;
  exfil: number;
  offPolicy: number;
  benign: number;
  model: string;
  raw?: unknown;
};

export type PolicyDecision = "allow" | "deny" | "review";

export type PolicyResult = {
  decision: PolicyDecision;
  reasons: string[];
  thresholds: {
    dangerousMax: number;
    exfilMax: number;
    offPolicyMax: number;
    benignMin: number;
  };
};

export type ZkLevel = "L1" | "L2" | "L3";

/** Real Groth16 zk-SNARK over policy compliance (scores stay private). */
export type ZkScheme = "groth16-policy";

export type ZkProof = {
  level: ZkLevel;
  scheme: ZkScheme;
  commitment: string;
  publicInputs: {
    commandHash: string;
    decision: PolicyDecision;
    thresholds: PolicyResult["thresholds"];
    level: ZkLevel;
  };
  /** Ship this blob to a third party — verifier needs only proof + publicSignals + VK. */
  proof: unknown;
  verified: boolean;
};

/** Tamper-evident audit append (hash chain + Ed25519) — separate from ZK. */
export type AuditSeal = {
  scheme: "ed25519-hash-chain";
  seq: number;
  prevHash: string;
  entryHash: string;
  signature: string;
  keyId: string;
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
  seal: AuditSeal;
  sim: SimResult;
};

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
