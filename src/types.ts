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
  thresholds: {
    dangerousMax: number;
    exfilMax: number;
    offPolicyMax: number;
    benignMin: number;
  };
};

/** Tamper-evident audit seal (hash chain + Ed25519) — not a ZK proof. */
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
  seal: AuditSeal;
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
