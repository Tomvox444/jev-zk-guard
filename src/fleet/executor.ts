import { writeFile, readFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { resolveAgentBin, runCursorAgent } from "./cursor-bridge.js";
import type { FleetRole } from "../auth/registry.js";

export type ExecutorResult = {
  ok: boolean;
  text: string;
  code?: number | null;
};

export type ExecutorOpts = {
  prompt: string;
  workspace: string;
  onChunk?: (chunk: string) => void;
  timeoutMs?: number;
  /** Optional metadata for stub/noop adapters */
  role?: FleetRole | "lead-finalize";
  taskId?: string;
  title?: string;
};

export interface FleetExecutor {
  id: string;
  plan(opts: ExecutorOpts): Promise<ExecutorResult>;
  build(opts: ExecutorOpts): Promise<ExecutorResult>;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Demo adapter: local Cursor Agent CLI. */
export const cursorExecutor: FleetExecutor = {
  id: "cursor",
  async plan(opts) {
    const result = await runCursorAgent({
      prompt: opts.prompt,
      cwd: opts.workspace,
      mode: "plan",
      force: false,
      timeoutMs: opts.timeoutMs ?? 8 * 60_000,
      onChunk: (c) => opts.onChunk?.(c),
    });
    return {
      ok: result.ok,
      text: result.stdout || result.stderr,
      code: result.code,
    };
  },
  async build(opts) {
    const result = await runCursorAgent({
      prompt: opts.prompt,
      cwd: opts.workspace,
      mode: "agent",
      force: true,
      timeoutMs: opts.timeoutMs ?? 8 * 60_000,
      onChunk: (c) => opts.onChunk?.(c),
    });
    return {
      ok: result.ok,
      text: result.stdout || result.stderr,
      code: result.code,
    };
  },
};

async function ensureNoopIndex(workspace: string) {
  const indexPath = join(workspace, "index.html");
  try {
    await readFile(indexPath, "utf8");
  } catch {
    const stub = [
      `<!DOCTYPE html>`,
      `<html><head><meta charset="utf-8"/><title>Fleet noop build</title>`,
      `<link rel="stylesheet" href="styles.css"/></head>`,
      `<body><header><h1>Fleet build</h1></header><main id="sections"></main>`,
      `<script src="app.js"></script></body></html>`,
      ``,
    ].join("\n");
    await writeFile(indexPath, stub, "utf8");
    await writeFile(
      join(workspace, "styles.css"),
      `body{font-family:system-ui;margin:2rem;background:#0b1c2c;color:#e8f0ea}section{margin:1.5rem 0;padding:1rem;border:1px solid #2a3f4f;border-radius:8px}`,
      "utf8",
    );
    await writeFile(join(workspace, "app.js"), `console.log("fleet noop");\n`, "utf8");
  }
}

/** Smoke / offline: writes per-task artifacts so multi-phase fleet is visible. */
export const noopExecutor: FleetExecutor = {
  id: "noop",
  async plan(opts) {
    const lines = [
      "[noop] planning…\n",
      "[noop] drafting step list\n",
      "[noop] plan ready\n",
    ];
    for (const line of lines) {
      opts.onChunk?.(line);
      await sleep(80);
    }
    const stub = `# Stub plan (noop executor)\n\nPrompt was received. No external agent ran.\n`;
    await writeFile(join(opts.workspace, "EXECUTOR_PLAN.md"), stub, "utf8");
    return { ok: true, text: stub, code: 0 };
  },
  async build(opts) {
    const role = opts.role ?? "hands";
    const taskId = opts.taskId ?? "task";
    const title = opts.title ?? "task";
    opts.onChunk?.(`[noop] ${role} starting ${taskId}\n`);
    await sleep(100);
    await mkdir(opts.workspace, { recursive: true });

    if (role === "lead-finalize") {
      opts.onChunk?.(`[noop] lead finalize polish\n`);
      await ensureNoopIndex(opts.workspace);
      // Merge task notes into index (safe after parallel hands — no concurrent writers).
      const files = (await readdir(opts.workspace)).filter((f) =>
        /^task-.+\.md$/.test(f),
      );
      let sections = "";
      for (const f of files.sort()) {
        const body = await readFile(join(opts.workspace, f), "utf8");
        const heading = body.split("\n")[0]?.replace(/^#\s*/, "") || f;
        const m = /^task-(.+)-(hands|reviewer|lead)\.md$/.exec(f);
        const tid = m?.[1] ?? f;
        const r = m?.[2] ?? "hands";
        sections += `\n<section data-task="${tid}" data-role="${r}"><h2>${heading}</h2><p>Merged from ${f} (noop finalize).</p></section>\n`;
      }
      if (sections) {
        let html = await readFile(join(opts.workspace, "index.html"), "utf8");
        if (html.includes('id="sections"')) {
          html = html.replace('id="sections">', `id="sections">${sections}`);
        } else {
          html = html.replace("</main>", `${sections}</main>`);
          if (!html.includes("</main>")) html += sections;
        }
        await writeFile(join(opts.workspace, "index.html"), html, "utf8");
      }
      await writeFile(
        join(opts.workspace, "README.md"),
        `# Fleet noop workspace\n\nOpen index.html in a browser.\n\nFinalized by lead-finalize.\n`,
        "utf8",
      );
      opts.onChunk?.(`[noop] wrote README.md + merged ${files.length} tasks\n`);
      return { ok: true, text: "noop finalize done", code: 0 };
    }

    // Parallel-safe: only distinct task-*.md files (finalize owns index.html).
    const notePath = join(opts.workspace, `task-${taskId}-${role}.md`);
    await writeFile(
      notePath,
      `# ${title}\n\nRole: ${role}\n\nNoop implemented this assignment.\n`,
      "utf8",
    );
    opts.onChunk?.(`[noop] wrote ${notePath}\n`);
    opts.onChunk?.(`[noop] ${role} finished ${taskId}\n`);
    return { ok: true, text: `noop ${role} ${taskId}`, code: 0 };
  },
};

export function getExecutor(): FleetExecutor {
  const id = (process.env.FLEET_EXECUTOR ?? "cursor").toLowerCase();
  if (id === "noop" || id === "stub") return noopExecutor;
  if (id === "cursor") {
    if (!resolveAgentBin() && process.env.FLEET_EXECUTOR_REQUIRE !== "1") {
      return noopExecutor;
    }
    return cursorExecutor;
  }
  return cursorExecutor;
}

export function resolveExecutorId(): string {
  return getExecutor().id;
}
