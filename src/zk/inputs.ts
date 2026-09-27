import { createHash } from "node:crypto";
import type { JevJudgment, PolicyDecision, PolicyResult } from "../types.js";

/** Scale probability [0,1] → int [0,1000] for the circuit. */
export function scale01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1000, Math.round(n * 1000)));
}

export function decisionCode(d: PolicyDecision): number {
  if (d === "allow") return 0;
  if (d === "review") return 1;
  return 2;
}

/** Compact field element from command string (public binding). */
export function commandHashField(command: string): string {
  const hex = createHash("sha256").update(command, "utf8").digest("hex");
  // Stay well below BN254 scalar field
  return BigInt("0x" + hex.slice(0, 30)).toString();
}

export function publicSignalsFrom(
  policy: PolicyResult,
  command: string,
): string[] {
  const t = policy.thresholds;
  return [
    String(scale01(t.dangerousMax)),
    String(scale01(t.exfilMax)),
    String(scale01(t.offPolicyMax)),
    String(scale01(t.benignMin)),
    String(decisionCode(policy.decision)),
    commandHashField(command),
  ];
}

export function privateWitnessFrom(judgment: JevJudgment): {
  dangerous: number;
  exfil: number;
  offPolicy: number;
  benign: number;
} {
  return {
    dangerous: scale01(judgment.dangerous),
    exfil: scale01(judgment.exfil),
    offPolicy: scale01(judgment.offPolicy),
    benign: scale01(judgment.benign),
  };
}
