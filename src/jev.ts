import type { JevJudgment, ProposedCommand } from "./types.js";
import { analyzeWithOpenRouter, resolveOpenRouterKey } from "./jev/openrouter.js";

/** Internal fleet orchestration intents — not shell; always benign for policy. */
function isFleetPhaseIntent(command: string): boolean {
  return /^fleet-phase:/i.test(command.trim());
}

const FLEET_PHASE_BENIGN: JevJudgment = {
  dangerous: 0.02,
  exfil: 0.02,
  offPolicy: 0.05,
  benign: 0.95,
  model: "fleet-phase",
};

/** Offline heuristic scores — used when no OpenRouter key or JEV_STUB=1. */
export function analyzeWithStub(cmd: ProposedCommand): JevJudgment {
  const c = cmd.command.toLowerCase();

  // Control-plane phase gates (incl. lead-finalize / reviewer roles).
  if (isFleetPhaseIntent(cmd.command)) {
    return { ...FLEET_PHASE_BENIGN, model: "stub" };
  }

  if (
    /rm\s+-rf|drop\s+table|mkfs|dd\s+if=|curl.+\|\s*sh|wget.+\|\s*sh|kubectl\s+delete|aws\s+s3\s+cp/.test(
      c,
    ) ||
    c.includes("exfil") ||
    c.includes("/.ssh/") ||
    c.includes("id_rsa")
  ) {
    return {
      dangerous: 0.92,
      exfil: c.includes("ssh") || c.includes("id_rsa") || c.includes("exfil") ? 0.88 : 0.2,
      offPolicy: 0.7,
      benign: 0.05,
      model: "stub",
    };
  }

  // "needs review" / code-review shells — not role name "reviewer" (fleet-phase handled above).
  if (
    /chmod\s+777|sudo|docker\s+run|--privileged|curl\s+http|npm\s+publish|git\s+push\s+--force/.test(
      c,
    ) ||
    /\bcode\s*review\b|\bsecurity\s*review\b|\bneeds?\s+review\b/.test(c)
  ) {
    return {
      dangerous: 0.45,
      exfil: 0.2,
      offPolicy: 0.55,
      benign: 0.35,
      model: "stub",
    };
  }

  return {
    dangerous: 0.1,
    exfil: 0.05,
    offPolicy: 0.1,
    benign: 0.85,
    model: "stub",
  };
}

/**
 * Prefer live Jev (OpenRouter). Fall back to stub if forced or unavailable.
 * Set JEV_STUB=1 to force stub; OPENROUTER_API_KEY or jevctl keychain for live.
 */
export async function analyzeWithJev(cmd: ProposedCommand): Promise<JevJudgment> {
  // Fleet build phases are internal; do not send opaque fleet-phase:* to OpenRouter
  // (live Jev often returns borderline scores → policy "review" and false stops).
  if (isFleetPhaseIntent(cmd.command)) {
    return FLEET_PHASE_BENIGN;
  }

  if (process.env.JEV_STUB === "1") {
    return analyzeWithStub(cmd);
  }

  const key = resolveOpenRouterKey();
  if (!key) {
    console.warn("[jev] no OpenRouter key — using stub scores");
    return analyzeWithStub(cmd);
  }

  try {
    return await analyzeWithOpenRouter(cmd, key);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[jev] OpenRouter failed (${msg}) — falling back to stub`);
    return analyzeWithStub(cmd);
  }
}
