import { createHmac, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClearanceLevel } from "../auth/registry.js";
import type { PolicyDecision, ZkLevel } from "../types.js";
import { resolveApiSecret } from "../auth/middleware.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_DIR =
  process.env.ESCALATION_DIR ?? join(__dirname, "../../data/escalations");

export type EscalationStatus = "open" | "approved" | "denied";

export type EscalationTicket = {
  id: string;
  ts: string;
  tenantId: string;
  juniorAgentId: string;
  escalatesTo?: string;
  command: string;
  rationale?: string;
  decision: PolicyDecision;
  zk_level: ZkLevel;
  commitment: string;
  requiredClearance: ClearanceLevel;
  juniorClearance: ClearanceLevel;
  judgment: {
    dangerous: number;
    exfil: number;
    offPolicy: number;
    benign: number;
    model: string;
  };
  status: EscalationStatus;
  seniorAgentId?: string;
  note?: string;
  signature?: string;
  decidedAt?: string;
};

type TenantFile = { tickets: EscalationTicket[] };

function storePath(tenantId: string): string {
  const safe = tenantId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return join(STORE_DIR, `${safe}.json`);
}

async function loadTenant(tenantId: string): Promise<TenantFile> {
  try {
    const raw = await readFile(storePath(tenantId), "utf8");
    const parsed = JSON.parse(raw) as TenantFile;
    return { tickets: Array.isArray(parsed.tickets) ? parsed.tickets : [] };
  } catch {
    return { tickets: [] };
  }
}

async function saveTenant(tenantId: string, data: TenantFile): Promise<void> {
  await mkdir(STORE_DIR, { recursive: true });
  await writeFile(storePath(tenantId), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function signDecision(
  ticketId: string,
  seniorAgentId: string,
  decision: "approve" | "deny",
): string {
  return createHmac("sha256", resolveApiSecret())
    .update(`${ticketId}:${seniorAgentId}:${decision}`)
    .digest("hex");
}

export async function createEscalation(
  partial: Omit<EscalationTicket, "id" | "ts" | "status">,
): Promise<EscalationTicket> {
  const file = await loadTenant(partial.tenantId);
  const ticket: EscalationTicket = {
    ...partial,
    id: randomUUID(),
    ts: new Date().toISOString(),
    status: "open",
  };
  file.tickets.push(ticket);
  await saveTenant(partial.tenantId, file);
  return ticket;
}

export async function listEscalations(
  tenantId: string,
  opts: { status?: EscalationStatus | "all" } = {},
): Promise<EscalationTicket[]> {
  const file = await loadTenant(tenantId);
  const status = opts.status ?? "open";
  const filtered =
    status === "all"
      ? file.tickets
      : file.tickets.filter((t) => t.status === status);
  return filtered.slice().reverse();
}

export async function getEscalation(
  tenantId: string,
  id: string,
): Promise<EscalationTicket | undefined> {
  const file = await loadTenant(tenantId);
  return file.tickets.find((t) => t.id === id);
}

export async function decideEscalation(
  tenantId: string,
  id: string,
  seniorAgentId: string,
  decision: "approve" | "deny",
  note?: string,
): Promise<
  { ok: true; ticket: EscalationTicket } | { ok: false; error: string }
> {
  const file = await loadTenant(tenantId);
  const idx = file.tickets.findIndex((t) => t.id === id);
  if (idx < 0) return { ok: false, error: "ticket_not_found" };
  const ticket = file.tickets[idx]!;
  if (ticket.status !== "open") return { ok: false, error: "ticket_not_open" };

  ticket.status = decision === "approve" ? "approved" : "denied";
  ticket.seniorAgentId = seniorAgentId;
  ticket.note = note;
  ticket.decidedAt = new Date().toISOString();
  ticket.signature = signDecision(ticket.id, seniorAgentId, decision);
  file.tickets[idx] = ticket;
  await saveTenant(tenantId, file);
  return { ok: true, ticket };
}
