import { analyzeWithJev } from "./jev.js";
import { evaluatePolicy } from "./policy.js";
import { simulateExecution } from "./sim.js";
import type { AuditSeal, GuardVerdict, ProposedCommand } from "./types.js";
import type { PolicyProfileName } from "./auth/registry.js";
import { GENESIS_HASH, computeEntryHash } from "./audit/seal.js";
import { signEntryHash, verifyEntryHash } from "./audit/keys.js";

export type GuardOptions = {
  policyProfile?: PolicyProfileName;
};

function ephemeralSeal(
  cmd: ProposedCommand,
  judgment: GuardVerdict["judgment"],
  policy: GuardVerdict["policy"],
): AuditSeal {
  const payload = {
    ts: new Date().toISOString(),
    requestId: cmd.id,
    tenantId: "_ephemeral",
    agentId: "_local",
    command: cmd.command,
    decision: policy.decision,
    allowed: policy.decision === "allow",
    judgment: {
      dangerous: judgment.dangerous,
      exfil: judgment.exfil,
      offPolicy: judgment.offPolicy,
      benign: judgment.benign,
      model: judgment.model,
    },
    thresholds: policy.thresholds,
  };
  const entryHash = computeEntryHash(GENESIS_HASH, payload);
  const { signature, keyId } = signEntryHash(entryHash);
  return {
    scheme: "ed25519-hash-chain",
    seq: 0,
    prevHash: GENESIS_HASH,
    entryHash,
    signature,
    keyId,
    verified: verifyEntryHash(entryHash, signature),
  };
}

/**
 * Agent proposes → Jev analyzes → Policy → Audit seal → Simulated execution.
 * HTTP handlers should call `appendSealedAudit` after clearance with the final `allowed`.
 */
export async function guard(
  cmd: ProposedCommand,
  opts: GuardOptions = {},
): Promise<GuardVerdict> {
  const judgment = await analyzeWithJev(cmd);
  const policy = evaluatePolicy(judgment, opts.policyProfile ?? "default");
  const seal = ephemeralSeal(cmd, judgment, policy);
  const sim = simulateExecution(cmd, policy, seal.verified);
  return { command: cmd, judgment, policy, seal, sim };
}
