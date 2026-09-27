import type { PolicyDecision } from "../types.js";
import type { ClearanceLevel } from "../auth/registry.js";

const RANK: Record<ClearanceLevel, number> = { L1: 1, L2: 2, L3: 3 };

export function clearanceRank(level: ClearanceLevel): number {
  return RANK[level];
}

export function hasClearance(
  agent: ClearanceLevel,
  required: ClearanceLevel,
): boolean {
  return clearanceRank(agent) >= clearanceRank(required);
}

/** Map policy decision → minimum clearance needed to proceed without escalation. */
export function requiredClearance(decision: PolicyDecision): ClearanceLevel {
  if (decision === "deny") return "L3";
  if (decision === "review") return "L2";
  return "L1";
}
