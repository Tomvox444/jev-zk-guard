import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIT_DIR = process.env.AUDIT_DIR ?? join(__dirname, "../../data/audit");
const KEY_PATH = join(AUDIT_DIR, "signing.json");

export type AuditKeyPair = {
  keyId: string;
  publicKeyPem: string;
  privateKeyPem: string;
  createdAt: string;
};

function keyIdFromPublicPem(pem: string): string {
  return createHash("sha256").update(pem).digest("hex").slice(0, 16);
}

export function loadOrCreateAuditKeys(): AuditKeyPair {
  mkdirSync(AUDIT_DIR, { recursive: true });
  if (existsSync(KEY_PATH)) {
    const raw = JSON.parse(readFileSync(KEY_PATH, "utf8")) as AuditKeyPair;
    if (raw.privateKeyPem && raw.publicKeyPem && raw.keyId) return raw;
  }
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const pair: AuditKeyPair = {
    keyId: keyIdFromPublicPem(publicKeyPem),
    publicKeyPem,
    privateKeyPem,
    createdAt: new Date().toISOString(),
  };
  writeFileSync(KEY_PATH, `${JSON.stringify(pair, null, 2)}\n`, { mode: 0o600 });
  return pair;
}

export function getAuditPublicKeyPem(): string {
  return loadOrCreateAuditKeys().publicKeyPem;
}

export function signEntryHash(entryHash: string): { signature: string; keyId: string } {
  const keys = loadOrCreateAuditKeys();
  const key = createPrivateKey(keys.privateKeyPem);
  const signature = sign(null, Buffer.from(entryHash, "hex"), key).toString("base64");
  return { signature, keyId: keys.keyId };
}

export function verifyEntryHash(
  entryHash: string,
  signature: string,
  publicKeyPem?: string,
): boolean {
  try {
    const pem = publicKeyPem ?? loadOrCreateAuditKeys().publicKeyPem;
    const key = createPublicKey(pem);
    return verify(null, Buffer.from(entryHash, "hex"), key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}
