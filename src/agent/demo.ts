import { formatAgentRun, runAgent } from "./runtime.js";
import type { ToolCall } from "../types.js";

/**
 * Jury demo script: L1 allow → L2 review block → L3 deny + Hamiltonian proof.
 * stopOnDeny=false so all three levels show in one run.
 */
const script: ToolCall[] = [
  {
    name: "shell",
    args: { command: "ls -la" },
    rationale: "list workspace (benign)",
  },
  {
    name: "shell",
    args: { command: "sudo chmod 777 /tmp/x" },
    rationale: "borderline privilege change",
  },
  {
    name: "shell",
    args: { command: "rm -rf /" },
    rationale: "destructive — must be denied with L3 proof",
  },
];

const run = await runAgent({
  goal: "Demonstrate Jev-ZK guard regulating an agent tool loop (L1/L2/L3)",
  script,
  stopOnDeny: false,
});

console.log(formatAgentRun(run));
console.log("--- json ---");
console.log(
  JSON.stringify(
    {
      goal: run.goal,
      stoppedReason: run.stoppedReason,
      steps: run.steps.map((s) => ({
        call: s.call,
        ok: s.result.ok,
        output: s.result.output,
        policy: s.result.verdict.policy.decision,
        zk: {
          level: s.result.verdict.zk.level,
          scheme: s.result.verdict.zk.scheme,
          verified: s.result.verdict.zk.verified,
          commitment: s.result.verdict.zk.commitment,
        },
        judgment: s.result.verdict.judgment,
      })),
    },
    null,
    2,
  ),
);
