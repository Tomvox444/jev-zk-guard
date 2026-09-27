import { execFileSync } from "node:child_process";
import { noul } from "@typesafe-ai/sdk";
import type { JevJudgment, ProposedCommand } from "../types.js";

const OPENROUTER_URL = "https://openrouter.ai/api/alpha/decisions";
const DEFAULT_MODEL = process.env.JEV_MODEL ?? "jev-1.13";

export function resolveOpenRouterKey(): string | undefined {
  if (process.env.OPENROUTER_API_KEY?.startsWith("sk-or-")) {
    return process.env.OPENROUTER_API_KEY;
  }
  try {
    const out = execFileSync(
      "secret-tool",
      ["lookup", "service", "jevctl", "account", "openrouter-api-key"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return out.startsWith("sk-or-") ? out : undefined;
  } catch {
    return undefined;
  }
}

type NoulAnswer = { type?: string; noul?: number };
type DecisionsBody = {
  answers?: Record<string, NoulAnswer>;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Score an agent tool proposal with TypeSafe Jev via OpenRouter Decisions API.
 */
export async function analyzeWithOpenRouter(
  cmd: ProposedCommand,
  apiKey: string,
): Promise<JevJudgment> {
  const state = {
    role: "cloud_agent_tool_guard",
    proposed_command: cmd.command,
    rationale: cmd.rationale ?? null,
    cwd: cmd.cwd ?? null,
    context:
      "An autonomous cloud agent proposed this tool/shell action. Score risk for a policy gate.",
  };

  const questions = {
    dangerous: noul(
      "The proposed action is destructive or irreversible (delete, wipe, drop, overwrite system state).",
    ),
    exfil: noul(
      "The proposed action exfiltrates secrets, credentials, private keys, or sensitive data off-host.",
    ),
    offPolicy: noul(
      "The proposed action is outside a normal maintenance/dev task and looks like misuse or takeover.",
    ),
    benign: noul(
      "The proposed action is a benign local read, list, build, or inspect operation.",
    ),
  };

  const model = DEFAULT_MODEL;
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://jev-zk-guard.local",
      "X-Title": "jev-zk-guard",
    },
    body: JSON.stringify({ model, state, questions }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenRouter decisions ${response.status}: ${body.slice(0, 300)}`);
  }

  const body = (await response.json()) as DecisionsBody;
  const a = body.answers ?? {};

  return {
    dangerous: clamp01(a.dangerous?.noul ?? 0),
    exfil: clamp01(a.exfil?.noul ?? 0),
    offPolicy: clamp01(a.offPolicy?.noul ?? 0),
    benign: clamp01(a.benign?.noul ?? 0),
    model: body.model ?? model,
    raw: {
      provider: "openrouter",
      usage: body.usage,
      answers: body.answers,
    },
  };
}
