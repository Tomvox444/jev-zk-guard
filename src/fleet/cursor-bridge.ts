import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";

const AGENT_CANDIDATES = [
  process.env.CURSOR_AGENT_BIN,
  `${process.env.HOME}/.local/bin/agent`,
  `${process.env.HOME}/.local/bin/cursor-agent`,
  "agent",
].filter(Boolean) as string[];

export function resolveAgentBin(): string | undefined {
  for (const bin of AGENT_CANDIDATES) {
    try {
      if (bin.includes("/")) {
        accessSync(bin, constants.X_OK);
        return bin;
      }
      return bin; // PATH lookup at spawn time
    } catch {
      /* try next */
    }
  }
  return undefined;
}

export type CursorAgentResult = {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  bin: string;
  args: string[];
};

/**
 * Run local Cursor Agent CLI against workspace.
 * Requires `agent login` or CURSOR_API_KEY.
 */
export function runCursorAgent(opts: {
  prompt: string;
  cwd: string;
  mode?: "plan" | "ask" | "agent";
  force?: boolean;
  timeoutMs?: number;
  onChunk?: (chunk: string, stream: "stdout" | "stderr") => void;
}): Promise<CursorAgentResult> {
  const bin = resolveAgentBin();
  if (!bin) {
    return Promise.resolve({
      ok: false,
      code: null,
      stdout: "",
      stderr: "Cursor agent CLI not found. Install cursor-agent or set CURSOR_AGENT_BIN.",
      bin: "",
      args: [],
    });
  }

  const args: string[] = ["-p", "--trust", "--workspace", opts.cwd];
  if (opts.mode === "plan") args.push("--mode", "plan");
  if (opts.mode === "ask") args.push("--mode", "ask");
  if (opts.force !== false && opts.mode !== "plan" && opts.mode !== "ask") {
    args.push("--force");
  }
  if (process.env.CURSOR_API_KEY) {
    args.push("--api-key", process.env.CURSOR_API_KEY);
  }
  args.push(opts.prompt);

  const timeoutMs = opts.timeoutMs ?? 10 * 60_000;

  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: opts.cwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      stderr += `\n[timeout after ${timeoutMs}ms]`;
      opts.onChunk?.(`\n[timeout after ${timeoutMs}ms]`, "stderr");
    }, timeoutMs);

    child.stdout.on("data", (d) => {
      const chunk = String(d);
      stdout += chunk;
      opts.onChunk?.(chunk, "stdout");
    });
    child.stderr.on("data", (d) => {
      const chunk = String(d);
      stderr += chunk;
      opts.onChunk?.(chunk, "stderr");
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        code,
        stdout: stdout.slice(-80_000),
        stderr: stderr.slice(-20_000),
        bin,
        args: args.map((a) => (a === process.env.CURSOR_API_KEY ? "***" : a)),
      });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      opts.onChunk?.(err.message, "stderr");
      resolve({
        ok: false,
        code: null,
        stdout,
        stderr: err.message,
        bin,
        args,
      });
    });
  });
}
