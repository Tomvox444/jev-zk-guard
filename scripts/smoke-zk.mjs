#!/usr/bin/env node
/** Prove with witness, verify WITHOUT witness — must both succeed. */
import { provePolicyCompliance } from "../src/zk/prove.js";
import { verifyPolicyCompliance } from "../src/zk/verify.js";

const cmd = { id: "smoke", command: "ls -la" };
const judgment = {
  dangerous: 0.05,
  exfil: 0.02,
  offPolicy: 0.1,
  benign: 0.8,
  model: "smoke",
};
const policy = {
  decision: "allow",
  reasons: [],
  thresholds: {
    dangerousMax: 0.7,
    exfilMax: 0.5,
    offPolicyMax: 0.6,
    benignMin: 0.4,
  },
};

const { proof, publicSignals } = await provePolicyCompliance(
  cmd,
  judgment,
  policy,
);
console.log("proved publicSignals", publicSignals);

// Deliberately do NOT pass judgment into verify:
const ok = await verifyPolicyCompliance(proof, publicSignals);
console.log("verified_without_witness", ok);
if (!ok) process.exit(1);

// Tamper public signal → must fail
const bad = [...publicSignals];
bad[4] = "2"; // claim deny
const badOk = await verifyPolicyCompliance(proof, bad);
console.log("tampered_public_rejected", !badOk);
if (badOk) process.exit(1);
console.log("OK real Groth16 prove≠verify separation");
