import type { ToolDef } from "../types.js";
import { wrapTool, type WrappedTool } from "./wrap.js";

const shellTool: ToolDef = {
  name: "shell",
  description: "Propose a shell command (simulated only).",
  async run(args) {
    return `[handler] shell simulated: ${String(args.command ?? "")}`;
  },
};

const readFileTool: ToolDef = {
  name: "read_file",
  description: "Propose reading a file (simulated only).",
  async run(args) {
    return `[handler] read_file simulated: ${String(args.path ?? "")}`;
  },
};

const httpFetchTool: ToolDef = {
  name: "http_fetch",
  description: "Propose an HTTP fetch (simulated only).",
  async run(args) {
    return `[handler] http_fetch simulated: ${String(args.url ?? "")}`;
  },
};

export function createDemoTools(): Record<string, WrappedTool> {
  return {
    shell: wrapTool(shellTool),
    read_file: wrapTool(readFileTool),
    http_fetch: wrapTool(httpFetchTool),
  };
}
