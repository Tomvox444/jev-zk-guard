import { mkdir, appendFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { JevJudgment, PolicyDecision, ZkLevel } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUDIT_DIR = process.env.AUDIT_DIR ?? join(__dirname, "../../data/audit");

export type AuditRecord = {
  ts: string;
  requestId: string;
  tenantId: string;
  agentId: string;
  command: string;
  decision: PolicyDecision;
  zk_level: ZkLevel;
  commitment: string;
  allowed: boolean;
  judgment: Pick<JevJudgment, "dangerous" | "exfil" | "offPolicy" | "benign" | "model">;
  event?: string;
  meta?: Record<string, unknown>;
};

function auditPath(tenantId: string): string {
  const safe = tenantId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return join(AUDIT_DIR, `${safe}.jsonl`);
}

export async function appendAudit(
  tenantId: string,
  partial: Omit<AuditRecord, "ts" | "requestId"> & { requestId?: string },
): Promise<AuditRecord> {
  const record: AuditRecord = {
    ts: new Date().toISOString(),
    requestId: partial.requestId ?? randomUUID(),
    tenantId: partial.tenantId,
    agentId: partial.agentId,
    command: partial.command,
    decision: partial.decision,
    zk_level: partial.zk_level,
    commitment: partial.commitment,
    allowed: partial.allowed,
    judgment: partial.judgment,
    event: partial.event,
    meta: partial.meta,
  };

  await mkdir(AUDIT_DIR, { recursive: true });
  await appendFile(auditPath(tenantId), `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

export async function readAudit(
  tenantId: string,
  limit = 20,
): Promise<AuditRecord[]> {
  try {
    const raw = await readFile(auditPath(tenantId), "utf8");
    const lines = raw.split("\n").filter(Boolean);
    const slice = lines.slice(-Math.max(1, Math.min(limit, 200)));
    return slice
      .map((line) => {
        try {
          return JSON.parse(line) as AuditRecord;
        } catch {
          return null;
        }
      })
      .filter((r): r is AuditRecord => r !== null)
      .reverse();
  } catch {
    return [];
  }
}
