import { noul } from "@typesafe-ai/sdk";
import { resolveOpenRouterKey } from "./openrouter.js";

const OPENROUTER_URL = "https://openrouter.ai/api/alpha/decisions";
const DEFAULT_MODEL = process.env.JEV_MODEL ?? "jev-1.13";

export type ComplexityBucket = "low" | "medium" | "high";

export type ComplexityScore = {
  complexity: number;
  bucket: ComplexityBucket;
  model: string;
  factors: {
    multi_step: number;
    needs_design: number;
    ambiguous: number;
    cross_cutting: number;
  };
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function bucketComplexity(score: number): ComplexityBucket {
  if (score >= 0.7) return "high";
  if (score >= 0.35) return "medium";
  return "low";
}

const DESIGN_RE =
  /design|visual|hero\s*layout|hero\b|layout|landing|brand|typography|atmosphere|startup\s*ui|\bui\b|look\s*and\s*feel|aesthetic|illustration|imagery/i;
const COPY_RE =
  /copy|texte|text\b|content|wording|product\s*story|use[\s-]?cases?|cta|docs|readme|typo|rename|headline\s*copy|marketing\s*copy/i;
const ARCH_RE =
  /refactor|migrate|architect|redesign|distributed|schema|auth|security|rewrite|from scratch|multi-tenant|orchestr/i;

/** Offline heuristic when Jev unavailable. Design/landing → high; pure copy → low. */
export function scoreComplexityStub(goal: string, task: string): ComplexityScore {
  const taskL = task.toLowerCase();
  const goalL = goal.toLowerCase();
  const isDesign = DESIGN_RE.test(task) || (DESIGN_RE.test(goal) && /hero|layout|visual|design|brand/.test(taskL));
  const isCopy =
    COPY_RE.test(task) &&
    !/layout|visual\s*design|design\s*system|hero\s*layout/.test(taskL);
  const isArch = ARCH_RE.test(taskL);

  let score = 0.18;
  if (/and|,|;/.test(task)) score += 0.08;
  if (/health|endpoint|test|docs|readme|typo|rename|implement:/.test(taskL)) score += 0.05;

  if (isDesign) {
    score = Math.max(score, 0.78);
  } else if (isCopy) {
    score = Math.min(score, 0.28);
  } else if (isArch) {
    score += 0.5;
  } else if (/refactor|auth|migrate|architect/.test(goalL) && /refactor|auth|migrate|architect/.test(taskL)) {
    score += 0.45;
  } else if (/refactor|auth|migrate/.test(goalL)) {
    score += 0.1;
  }
  if (/rewrite|from scratch|multi-tenant|orchestr/.test(taskL) && !isCopy) score += 0.25;
  score = clamp01(score);

  const factors = {
    multi_step: /and|,/.test(task) || isDesign ? 0.55 : 0.2,
    needs_design: isDesign ? 0.92 : isArch ? 0.8 : isCopy ? 0.15 : 0.25,
    ambiguous: /somehow|maybe|improve|clean/.test(taskL) ? 0.55 : 0.2,
    cross_cutting: isDesign
      ? 0.65
      : /auth|security|migrate|shared|platform/.test(taskL)
        ? 0.75
        : 0.15,
  };
  const mean =
    (factors.multi_step + factors.needs_design + factors.ambiguous + factors.cross_cutting) / 4;
  let complexity = clamp01(0.65 * score + 0.35 * mean);
  if (isDesign) complexity = Math.max(complexity, 0.72);
  if (isCopy && !isDesign) complexity = Math.min(complexity, 0.32);

  return {
    complexity,
    bucket: bucketComplexity(complexity),
    model: "stub-complexity",
    factors,
  };
}

type NoulAnswer = { noul?: number };

async function scoreComplexityOpenRouter(
  goal: string,
  task: string,
  apiKey: string,
): Promise<ComplexityScore> {
  const state = {
    role: "fleet_task_complexity",
    goal,
    task,
    context: [
      "Score how hard this task is for agent routing (NOT security risk).",
      "For marketing/landing pages: visual design, brand system, hero layout, typography, atmosphere = HIGH complexity (needs Lead).",
      "Pure copywriting / product story text / use-case blurbs / CTA wording = LOW complexity (Hands).",
      "Integration, polish, linking sections = MEDIUM (Reviewer).",
    ].join(" "),
  };
  const questions = {
    multi_step: noul("This task requires multiple dependent steps or files to change."),
    needs_design: noul(
      "This task needs visual design or architecture decisions (hero/layout/brand count as high design need).",
    ),
    ambiguous: noul("The task statement is ambiguous or underspecified."),
    cross_cutting: noul(
      "The task cuts across many modules, auth, data, platform — or sets the global visual system of a landing page.",
    ),
  };
  const model = DEFAULT_MODEL;
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://jev-zk-guard.local",
      "X-Title": "jev-zk-guard-complexity",
    },
    body: JSON.stringify({ model, state, questions }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenRouter complexity ${response.status}: ${body.slice(0, 200)}`);
  }
  const body = (await response.json()) as {
    answers?: Record<string, NoulAnswer>;
    model?: string;
  };
  const a = body.answers ?? {};
  const factors = {
    multi_step: clamp01(a.multi_step?.noul ?? 0),
    needs_design: clamp01(a.needs_design?.noul ?? 0),
    ambiguous: clamp01(a.ambiguous?.noul ?? 0),
    cross_cutting: clamp01(a.cross_cutting?.noul ?? 0),
  };
  let complexity = clamp01(
    (factors.multi_step + factors.needs_design + factors.ambiguous + factors.cross_cutting) / 4,
  );
  // Soft post-bias aligned with stub when titles are explicit
  if (DESIGN_RE.test(task)) complexity = Math.max(complexity, 0.7);
  if (COPY_RE.test(task) && !DESIGN_RE.test(task)) complexity = Math.min(complexity, 0.34);

  return {
    complexity,
    bucket: bucketComplexity(complexity),
    model: body.model ?? model,
    factors,
  };
}

export async function scoreComplexity(goal: string, task: string): Promise<ComplexityScore> {
  if (process.env.JEV_STUB === "1") return scoreComplexityStub(goal, task);
  const key = resolveOpenRouterKey();
  if (!key) return scoreComplexityStub(goal, task);
  try {
    return await scoreComplexityOpenRouter(goal, task, key);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[complexity] OpenRouter failed (${msg}) — stub`);
    return scoreComplexityStub(goal, task);
  }
}
