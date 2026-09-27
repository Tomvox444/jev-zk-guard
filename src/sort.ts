import { randomUUID } from "node:crypto";
import { guard } from "./pipeline.js";

const args = process.argv.slice(2);

if (args[0] === "--agent" || args[0] === "agent") {
  await import("./agent/demo.js");
} else {
  const command = args.join(" ") || "ls -la";
  const verdict = await guard({
    id: randomUUID(),
    command,
    rationale: "cli smoke",
  });
  console.log(JSON.stringify(verdict, null, 2));
}
