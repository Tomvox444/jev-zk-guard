/**
 * Lead planner — source of truth for per-agent build briefs.
 * Build executors consume these briefs; they must not re-invent scope.
 */

export type TaskBrief = {
  /** One sentence mission */
  objective: string;
  /** Concrete files / sections to produce */
  deliverables: string[];
  /** Soft requirements from the user goal */
  constraints: string[];
  /** Explicit out-of-scope */
  doNot: string[];
  /** Verifiable checklist */
  acceptance: string[];
  /** What the next teammate must find when this task is done */
  handoff: string;
};

export type PlannedTask = {
  id: string;
  title: string;
  kind: "implement" | "verify" | "lead";
  brief: TaskBrief;
};

export type GoalConstraints = {
  brand?: string;
  ctas: string[];
  useCases: string[];
  antiPatterns: string[];
  notes: string[];
};

const LANDING_RE = /landing|website|web\s*page|\bhero\b|startup\s*page/i;

/** Pull brand, CTAs, use-cases, and anti-patterns from free-form goal text. */
export function extractGoalConstraints(goal: string): GoalConstraints {
  const ctas: string[] = [];
  const useCases: string[] = [];
  const antiPatterns: string[] = [];
  const notes: string[] = [];

  const brandQuoted =
    /(?:brand|product|for)\s*[:—-]?\s*[“"]([^”"]+)[”"]/i.exec(goal) ??
    /[“"]([A-Z][A-Za-z0-9]{1,24})[”"]\s*[—–-]/i.exec(goal);
  let brand = brandQuoted?.[1]?.trim();
  if (!brand) {
    const forName = /\bfor\s+[“"]?([A-Z][A-Za-z0-9]+)[”"]?/i.exec(goal);
    brand = forName?.[1];
  }

  const ctaMatches = goal.matchAll(/[“"]([^”"]{3,40})[”"]/g);
  for (const m of ctaMatches) {
    const t = m[1]?.trim();
    if (t && /start|see how|guard|get started|try|join|book/i.test(t)) ctas.push(t);
  }

  if (/cursor junior/i.test(goal)) useCases.push("Cursor junior agents");
  if (/CI cloud/i.test(goal)) useCases.push("CI cloud agents");
  if (/multi-tenant|hackathon/i.test(goal)) {
    useCases.push("Multi-tenant hackathon demos");
  }

  if (/no purple|not purple|avoid purple/i.test(goal)) {
    antiPatterns.push("No purple-on-white / purple-indigo SaaS gradient theme");
  }
  if (/cream|terracotta|broadsheet/i.test(goal)) {
    antiPatterns.push("No cream background + terracotta broadsheet look");
  }
  if (/Inter|Roboto|Arial|system-ui/i.test(goal)) {
    antiPatterns.push("No Inter / Roboto / Arial / system-ui as display face");
  }
  if (/no (fake )?metrics|no (fake )?logos|do not invent/i.test(goal)) {
    antiPatterns.push("No fake metrics, logos, pricing, or invented customers");
  }
  if (/industrial|not crypto/i.test(goal)) {
    notes.push("Tone: precise, industrial-quiet — not crypto-hype");
  }
  if (/full-?bleed|edge-to-edge/i.test(goal)) {
    notes.push("Hero must be full-bleed / edge-to-edge visual plane");
  }
  if (/motion|animat/i.test(goal)) {
    notes.push("Include 2–3 intentional motion cues (not noise)");
  }

  return {
    brand,
    ctas: [...new Set(ctas)],
    useCases: [...new Set(useCases)],
    antiPatterns: [...new Set(antiPatterns)],
    notes: [...new Set(notes)],
  };
}

function sharedConstraints(c: GoalConstraints): string[] {
  const out: string[] = [];
  if (c.brand) out.push(`Brand / product name: ${c.brand}`);
  out.push(...c.notes);
  out.push(...c.antiPatterns);
  if (c.ctas.length) out.push(`Use these CTA labels when relevant: ${c.ctas.join("; ")}`);
  if (c.useCases.length) {
    out.push(`Use cases must be exactly: ${c.useCases.join("; ")}`);
  }
  out.push("Work only inside the fleet workspace; do not touch the guard control-plane repo");
  return out;
}

function formatBriefBlock(brief: TaskBrief): string {
  const bullet = (items: string[]) =>
    items.length ? items.map((x) => `  - ${x}`).join("\n") : "  - (none)";
  return [
    `Objective: ${brief.objective}`,
    `Deliverables:\n${bullet(brief.deliverables)}`,
    `Constraints:\n${bullet(brief.constraints)}`,
    `Do NOT:\n${bullet(brief.doNot)}`,
    `Acceptance:\n${bullet(brief.acceptance)}`,
    `Handoff: ${brief.handoff}`,
  ].join("\n");
}

export function briefToMarkdown(brief: TaskBrief): string {
  return formatBriefBlock(brief);
}

export function leadFinalizeBrief(goal: string): TaskBrief {
  const c = extractGoalConstraints(goal);
  return {
    objective:
      "Integrate teammate work into one coherent, loadable page — polish only, no redesign.",
    deliverables: [
      "index.html loads without broken links/scripts",
      "README.md with how to open the site",
      "Consistent tokens / type / spacing across sections",
    ],
    constraints: [
      ...sharedConstraints(c),
      "Prefer merge and polish over rewrite",
    ],
    doNot: [
      "Do not redesign the hero or invent a new visual system if branding already exists",
      "Do not replace copy wholesale unless it is broken or off-brief",
      "Do not add fake logos, metrics, or pricing",
    ],
    acceptance: [
      "index.html opens and shows all required sections in order",
      "Primary/secondary CTAs still match the plan labels when specified",
      "No obvious style collisions between sections",
      "README explains how to open the page",
    ],
    handoff: "Workspace is demo-ready for a founder walkthrough.",
  };
}

function landingPlan(goal: string, c: GoalConstraints): PlannedTask[] {
  const brand = c.brand ?? "the product";
  const shared = sharedConstraints(c);
  const ctaPrimary = c.ctas[0] ?? "Start guarding";
  const ctaSecondary = c.ctas[1] ?? "See how it works";
  const uses =
    c.useCases.length >= 3
      ? c.useCases
      : [
          "Cursor junior agents",
          "CI cloud agents",
          "Multi-tenant hackathon demos",
        ];

  return [
    {
      id: "t1",
      title: "Visual design system + hero layout",
      kind: "implement",
      brief: {
        objective: `Establish the visual system and a brand-first full-bleed hero for ${brand}.`,
        deliverables: [
          "index.html shell with hero region only (placeholders OK for later sections)",
          "styles.css with CSS variables (colors, type, spacing)",
          "Optional main.js / script.js for hero motion only",
          `Brand name "${brand}" as the dominant hero signal (prefer h1), one headline, one support line, two CTAs`,
        ],
        constraints: [
          ...shared,
          "Hero: one composition — brand, one headline, one support sentence, one CTA group, one dominant visual idea",
          "No stats, badges, cards, or secondary marketing in the hero",
          `Primary CTA label: "${ctaPrimary}"; secondary: "${ctaSecondary}"`,
        ],
        doNot: [
          "Do not write product-story, how-it-works, use-cases, or final CTA section copy",
          "Do not add a card grid or inset hero media",
          "Do not use purple SaaS gradients or cream+terracotta broadsheet aesthetics",
        ],
        acceptance: [
          `Removing the nav (if any) still leaves "${brand}" unmistakable in the first viewport`,
          "Hero is full-bleed; display font is not Inter/Roboto/Arial/system-ui",
          "CSS variables define the palette and type scale for teammates to reuse",
        ],
        handoff:
          "Teammates must reuse existing CSS variables and hero structure; do not invent a second design system.",
      },
    },
    {
      id: "t2",
      title: "Product story copy",
      kind: "implement",
      brief: {
        objective: `Write the product-story section for technical founders explaining what ${brand} does.`,
        deliverables: [
          "A #story (or equivalent) section in index.html with 2–3 short paragraphs",
          "Reuse existing CSS tokens / section patterns from the design system",
        ],
        constraints: [
          ...shared,
          "Tone: technical founder, precise, no fluff marketing clichés",
          "Stay under the design system already in styles.css",
        ],
        doNot: [
          "Do not change hero layout, brand sizing, palette, or display typography",
          "Do not rewrite how-it-works or use-cases sections",
          "Do not add new global CSS themes",
        ],
        acceptance: [
          "Story section exists and reads as founder-facing product explanation",
          "Hero visual system unchanged",
        ],
        handoff: "Story section is in place; later tasks add pipeline + use cases below it.",
      },
    },
    {
      id: "t3",
      title: "How-it-works and use-cases copy",
      kind: "implement",
      brief: {
        objective:
          "Add How-it-works (propose → Jev scores → policy + ZK attest) and exactly three use cases.",
        deliverables: [
          "How-it-works section with three steps: Propose; Jev scores; Policy + ZK attest",
          `Use-cases section with exactly: ${uses.join("; ")}`,
        ],
        constraints: [
          ...shared,
          "Reuse existing section styles / tokens; keep one visual language",
          "Copy must match the product (agent propose → score → attest), not generic SaaS steps",
        ],
        doNot: [
          "Do not redesign the hero or change CSS variables / brand type",
          "Do not invent extra use cases or drop any of the three required ones",
          "Do not add fake logos or metrics",
        ],
        acceptance: [
          "Three how-it-works steps match propose → Jev → policy+ZK",
          "Exactly three named use cases as specified",
          "Hero and story sections still intact",
        ],
        handoff: "Page flow is hero → story → how → use cases; CTA section comes next.",
      },
    },
    {
      id: "t4",
      title: "CTA and polish content",
      kind: "implement",
      brief: {
        objective: "Ship the final CTA section and light content polish — no new visual system.",
        deliverables: [
          "Final CTA section with decisive short copy (no newsletter form)",
          `CTA control using label "${ctaPrimary}" (or plan-specified primary)`,
          "Minor copy consistency fixes only if needed",
        ],
        constraints: [
          ...shared,
          "Decisive, short CTA — not a lead-gen form",
        ],
        doNot: [
          "Do not invent a new color palette or display font",
          "Do not rebuild the hero",
          "Do not add newsletter / email capture forms",
        ],
        acceptance: [
          "Final CTA section present and clickable",
          "No new theme drift vs design tokens",
        ],
        handoff: "Page is content-complete for Lead finalize (links, README, consistency).",
      },
    },
  ];
}

function genericBrief(title: string, goal: string, c: GoalConstraints): TaskBrief {
  return {
    objective: `Complete: ${title}`,
    deliverables: [
      `Working implementation for: ${title}`,
      "Notes or README touch only if needed for the next teammate",
    ],
    constraints: [...sharedConstraints(c), `Stay aligned with overall goal: ${goal.slice(0, 200)}`],
    doNot: [
      "Do not expand scope beyond this task title",
      "Do not refactor unrelated modules",
    ],
    acceptance: [
      "Task title is observably done in the workspace",
      "No unrelated drive-by changes",
    ],
    handoff: "Next assignee can continue without reversing this work.",
  };
}

/**
 * Lead scripted planner: split goal into tasks WITH operative briefs.
 */
export function leadPlan(goal: string): PlannedTask[] {
  const cleaned = goal.replace(/\s+/g, " ").trim();
  const c = extractGoalConstraints(cleaned);

  if (LANDING_RE.test(cleaned)) {
    return landingPlan(cleaned, c);
  }

  const parts = cleaned
    .split(/\band\b|,|;|\bthen\b/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 3);

  const titles =
    parts.length >= 2
      ? parts.slice(0, 4)
      : [
          `Implement: ${cleaned.slice(0, 80)}`,
          `Add tests/docs for: ${cleaned.slice(0, 60)}`,
        ];

  return titles.map((title, i) => {
    const t = title.charAt(0).toUpperCase() + title.slice(1);
    return {
      id: `t${i + 1}`,
      title: t,
      kind: "implement" as const,
      brief: genericBrief(t, cleaned, c),
    };
  });
}

/** Summarize briefs for the Lead plan step (fleet graph). */
export function summarizeLeadPlan(tasks: PlannedTask[]): string {
  return tasks
    .map((t) => {
      const dont = t.brief.doNot[0] ?? "";
      return `- **${t.id}** ${t.title}\n  objective: ${t.brief.objective}\n  doNot: ${dont}`;
    })
    .join("\n");
}
