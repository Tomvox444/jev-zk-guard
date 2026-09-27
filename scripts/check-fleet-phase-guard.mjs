import { analyzeWithStub } from "../src/jev.ts";
import { evaluatePolicy } from "../src/policy.ts";
import { guard } from "../src/pipeline.ts";

const cmds = [
  "fleet-phase:lead-finalize:finalize",
  "fleet-phase:reviewer:t2",
  "fleet-phase:hands:t3",
];

for (const command of cmds) {
  const j = analyzeWithStub({ id: "t", command, rationale: "test" });
  const p = evaluatePolicy(j);
  if (p.decision !== "allow") {
    throw new Error(`stub expected allow for ${command}, got ${p.decision}`);
  }
  console.log("stub ok", command);
}

for (const command of cmds) {
  const v = await guard({ id: "t", command, rationale: "build lead finalize" });
  if (v.policy.decision === "deny") {
    throw new Error(`guard deny for ${command}`);
  }
  console.log("guard ok", command, v.policy.decision, v.judgment.model);
}

console.log("FLEET_PHASE_GUARD_OK");
