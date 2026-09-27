/**
 * VERIFIER only — must NOT receive Jev judgment scores.
 * Checks Groth16 proof against the verification key + public signals.
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { groth16 } from "snarkjs";
import type { Groth16ProofJson } from "./prove.js";
import { ZK_VKEY } from "./paths.js";

let cachedVkey: unknown | null = null;

async function loadVkey(): Promise<unknown> {
  if (cachedVkey) return cachedVkey;
  if (!existsSync(ZK_VKEY)) {
    throw new Error("verification_key.json missing — run: node scripts/zk-setup.mjs");
  }
  cachedVkey = JSON.parse(await readFile(ZK_VKEY, "utf8"));
  return cachedVkey;
}

/**
 * Third-party verifiable: only proof + publicSignals + VK.
 * No access to private Jev scores.
 */
export async function verifyPolicyCompliance(
  proof: Groth16ProofJson,
  publicSignals: string[],
): Promise<boolean> {
  const vkey = await loadVkey();
  return groth16.verify(vkey, publicSignals, proof);
}

export type ZkVerifyPayload = {
  proof: Groth16ProofJson;
  publicSignals: string[];
};
