import { createHash, randomUUID } from "node:crypto";
import { existsSync, renameSync, readFileSync } from "node:fs";
import { mkdir, appendFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AuditSeal,
  JevJudgment,
  PolicyDecision,
  PolicyResult,
} from "../types.js";
import { signEntryHash, verifyEntryHash } from "./keys.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIT_DIR = process.env.AUDIT_DIR ?? join(__dirname, "../../data/audit");

export const GENESIS_HASH = "0".repeat(64);

export type AuditPayload = {
  ts: string;
  requestId: string;
  tenantId: string;
  agentId: string;
  command: string;
  decision: PolicyDecision;
  allowed: boolean;
  judgment: Pick<JevJudgment, "dangerous" | "exfil" | "offPolicy" | "benign" | "model">;
  thresholds: PolicyResult["thresholds"];
  event?: string;
  meta?: Record<string, unknown>;
};

export type AuditRecord = AuditPayload & {
  seq: number;
  prevHash: string;
  entryHash: string;
  signature: string;
  keyId: string;
  scheme: "ed25519-hash-chain";
};

function auditPath(tenantId: string): string {
  const safe = tenantId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return join(AUDIT_DIR, `${safe}.jsonl`);
}

/** Stable JSON for hashing (sorted object keys). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) {
      out[k] = sortKeys(obj[k]);
    }
    return out;
  }
  return value;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function payloadForHash(p: AuditPayload): Record<string, unknown> {
  const base: Record<string, unknown> = {
    agentId: p.agentId,
    allowed: p.allowed,
    command: p.command,
    decision: p.decision,
    judgment: p.judgment,
    requestId: p.requestId,
    tenantId: p.tenantId,
    thresholds: p.thresholds,
    ts: p.ts,
  };
  if (p.event !== undefined) base.event = p.event;
  if (p.meta !== undefined) base.meta = p.meta;
  return base;
}

export function computeEntryHash(prevHash: string, payload: AuditPayload): string {
  return sha256Hex(`${prevHash}|${canonicalJson(payloadForHash(payload))}`);
}

async function readAllRecords(tenantId: string): Promise<AuditRecord[]> {
  try {
    const raw = await readFile(auditPath(tenantId), "utf8");
    const out: AuditRecord[] = [];
    for (const line of raw.split("\n").filter(Boolean)) {
      try {
        out.push(JSON.parse(line) as AuditRecord);
      } catch {
        /* skip corrupt */
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Archive legacy unchained JSONL so the demo starts a clean genesis chain. */
function migrateLegacyIfNeeded(tenantId: string): void {
  const path = auditPath(tenantId);
  if (!existsSync(path)) return;
  try {
    const raw = readFileSync(path, "utf8");
    const first = raw.split("\n").find(Boolean);
    if (!first) return;
    const row = JSON.parse(first) as Partial<AuditRecord>;
    if (typeof row.seq === "number" && row.prevHash && row.entryHash && row.signature) {
      return;
    }
    renameSync(path, `${path}.bak.${Date.now()}`);
  } catch {
    /* leave as-is */
  }
}

export type SealInput = {
  tenantId: string;
  agentId: string;
  command: string;
  decision: PolicyDecision;
  allowed: boolean;
  judgment: AuditPayload["judgment"];
  thresholds: PolicyResult["thresholds"];
  requestId?: string;
  event?: string;
  meta?: Record<string, unknown>;
};

/**
 * Append a hash-chained, Ed25519-signed audit entry and return the seal.
 */
export async function appendSealedAudit(input: SealInput): Promise<{
  record: AuditRecord;
  seal: AuditSeal;
}> {
  migrateLegacyIfNeeded(input.tenantId);
  await mkdir(AUDIT_DIR, { recursive: true });

  const existing = await readAllRecords(input.tenantId);
  const prev = existing.at(-1);
  const prevHash = prev?.entryHash ?? GENESIS_HASH;
  const seq = (prev?.seq ?? 0) + 1;

  const payload: AuditPayload = {
    ts: new Date().toISOString(),
    requestId: input.requestId ?? randomUUID(),
    tenantId: input.tenantId,
    agentId: input.agentId,
    command: input.command,
    decision: input.decision,
    allowed: input.allowed,
    judgment: input.judgment,
    thresholds: input.thresholds,
    event: input.event,
    meta: input.meta,
  };

  const entryHash = computeEntryHash(prevHash, payload);
  const { signature, keyId } = signEntryHash(entryHash);
  const verified = verifyEntryHash(entryHash, signature);

  const record: AuditRecord = {
    ...payload,
    seq,
    prevHash,
    entryHash,
    signature,
    keyId,
    scheme: "ed25519-hash-chain",
  };

  await appendFile(auditPath(input.tenantId), `${JSON.stringify(record)}\n`, "utf8");

  const seal: AuditSeal = {
    scheme: "ed25519-hash-chain",
    seq,
    prevHash,
    entryHash,
    signature,
    keyId,
    verified,
  };

  return { record, seal };
}

export type ChainVerifyResult = {
  ok: boolean;
  length: number;
  tip: string | null;
  keyId: string | null;
  brokenAt?: number;
  reason?: string;
};

/** Replay the tenant JSONL: hash links + Ed25519 signatures. */
export async function verifyChain(tenantId: string): Promise<ChainVerifyResult> {
  const records = await readAllRecords(tenantId);
  if (records.length === 0) {
    return { ok: true, length: 0, tip: GENESIS_HASH, keyId: null };
  }

  let expectedPrev = GENESIS_HASH;
  for (const r of records) {
    if (typeof r.seq !== "number" || !r.prevHash || !r.entryHash || !r.signature) {
      return {
        ok: false,
        length: records.length,
        tip: records.at(-1)?.entryHash ?? null,
        keyId: records.at(-1)?.keyId ?? null,
        brokenAt: r.seq,
        reason: "missing_chain_fields",
      };
    }
    if (r.prevHash !== expectedPrev) {
      return {
        ok: false,
        length: records.length,
        tip: records.at(-1)?.entryHash ?? null,
        keyId: r.keyId,
        brokenAt: r.seq,
        reason: "prev_hash_mismatch",
      };
    }
    const payload: AuditPayload = {
      ts: r.ts,
      requestId: r.requestId,
      tenantId: r.tenantId,
      agentId: r.agentId,
      command: r.command,
      decision: r.decision,
      allowed: r.allowed,
      judgment: r.judgment,
      thresholds: r.thresholds,
      event: r.event,
      meta: r.meta,
    };
    const expectedHash = computeEntryHash(r.prevHash, payload);
    if (expectedHash !== r.entryHash) {
      return {
        ok: false,
        length: records.length,
        tip: records.at(-1)?.entryHash ?? null,
        keyId: r.keyId,
        brokenAt: r.seq,
        reason: "entry_hash_mismatch",
      };
    }
    if (!verifyEntryHash(r.entryHash, r.signature)) {
      return {
        ok: false,
        length: records.length,
        tip: records.at(-1)?.entryHash ?? null,
        keyId: r.keyId,
        brokenAt: r.seq,
        reason: "bad_signature",
      };
    }
    expectedPrev = r.entryHash;
  }

  const tip = records.at(-1)!;
  return {
    ok: true,
    length: records.length,
    tip: tip.entryHash,
    keyId: tip.keyId,
  };
}

export async function readAudit(
  tenantId: string,
  limit = 20,
): Promise<AuditRecord[]> {
  const all = await readAllRecords(tenantId);
  const slice = all.slice(-Math.max(1, Math.min(limit, 200)));
  return slice.reverse();
}
