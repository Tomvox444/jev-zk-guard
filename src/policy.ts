import type { JevJudgment, PolicyResult } from "./types.js";
import type { PolicyProfileName } from "./auth/registry.js";

const PROFILES: Record<
  PolicyProfileName,
  PolicyResult["thresholds"]
> = {
  default: {
    dangerousMax: 0.7,
    exfilMax: 0.5,
    offPolicyMax: 0.6,
    benignMin: 0.4,
  },
  strict: {
    dangerousMax: 0.45,
    exfilMax: 0.3,
    offPolicyMax: 0.4,
    benignMin: 0.55,
  },
};

/** Deterministic gates on Jev probabilities. */
export function evaluatePolicy(
  j: JevJudgment,
  profile: PolicyProfileName = "default",
): PolicyResult {
  const thresholds = { ...PROFILES[profile] };
  const reasons: string[] = [];

  if (j.dangerous >= thresholds.dangerousMax) {
    reasons.push(`dangerous ${j.dangerous.toFixed(2)} >= ${thresholds.dangerousMax}`);
  }
  if (j.exfil >= thresholds.exfilMax) {
    reasons.push(`exfil ${j.exfil.toFixed(2)} >= ${thresholds.exfilMax}`);
  }
  if (j.offPolicy >= thresholds.offPolicyMax) {
    reasons.push(`offPolicy ${j.offPolicy.toFixed(2)} >= ${thresholds.offPolicyMax}`);
  }
  if (j.benign < thresholds.benignMin) {
    reasons.push(`benign ${j.benign.toFixed(2)} < ${thresholds.benignMin}`);
  }

  let decision: PolicyResult["decision"] = "allow";
  if (reasons.length > 0) {
    decision =
      j.dangerous >= thresholds.dangerousMax || j.exfil >= thresholds.exfilMax
        ? "deny"
        : "review";
  }

  return { decision, reasons, thresholds };
}
