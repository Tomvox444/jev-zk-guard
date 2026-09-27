#!/usr/bin/env node
/**
 * Compile circom + Groth16 setup. Produces artifacts under circuits/build/
 * that the runtime prover/verifier load. Run once (or after circuit changes).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, existsSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const circom = join(root, "bin/circom");
const build = join(root, "circuits/build");
const snarkjs = join(root, "node_modules/.bin/snarkjs");

function run(cmd, args, opts = {}) {
  console.log(">", cmd, args.join(" "));
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", ...opts });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

mkdirSync(build, { recursive: true });
mkdirSync(join(root, "bin"), { recursive: true });

if (!existsSync(circom)) {
  console.error("Missing bin/circom — download circom-linux-amd64 v2.1.9 into bin/circom");
  process.exit(1);
}

run(circom, [
  "circuits/policy.circom",
  "--r1cs",
  "--wasm",
  "--sym",
  "-o",
  "circuits/build",
]);

const ptau = join(build, "pot12_final.ptau");
if (!existsSync(ptau)) {
  run(snarkjs, ["powersoftau", "new", "bn128", "12", join(build, "pot12_0000.ptau"), "-v"]);
  run(snarkjs, [
    "powersoftau",
    "contribute",
    join(build, "pot12_0000.ptau"),
    join(build, "pot12_0001.ptau"),
    "--name=jev-setup",
    "-v",
    "-e=jev-zk-guard-entropy",
  ]);
  run(snarkjs, [
    "powersoftau",
    "prepare",
    "phase2",
    join(build, "pot12_0001.ptau"),
    ptau,
    "-v",
  ]);
}

run(snarkjs, [
  "groth16",
  "setup",
  join(build, "policy.r1cs"),
  ptau,
  join(build, "policy_0000.zkey"),
]);
run(snarkjs, [
  "zkey",
  "contribute",
  join(build, "policy_0000.zkey"),
  join(build, "policy_final.zkey"),
  "--name=jev-prover",
  "-v",
  "-e=jev-zkey-entropy",
]);
run(snarkjs, [
  "zkey",
  "export",
  "verificationkey",
  join(build, "policy_final.zkey"),
  join(build, "verification_key.json"),
]);

// wasm path: circuits/build/policy_js/policy.wasm
const wasm = join(build, "policy_js/policy.wasm");
if (!existsSync(wasm)) {
  console.error("Expected wasm at", wasm);
  process.exit(1);
}

console.log("\nZK setup OK:");
console.log("  wasm:", wasm);
console.log("  zkey:", join(build, "policy_final.zkey"));
console.log("  vkey:", join(build, "verification_key.json"));
