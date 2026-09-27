import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

export const ZK_BUILD = join(root, "circuits/build");
export const ZK_WASM = join(ZK_BUILD, "policy_js/policy.wasm");
export const ZK_ZKEY = join(ZK_BUILD, "policy_final.zkey");
export const ZK_VKEY = join(ZK_BUILD, "verification_key.json");
