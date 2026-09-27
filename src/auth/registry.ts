import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
export type PolicyProfileName = "default" | "strict";
/** Agent role clearance (not a crypto proof level). */
export type ClearanceLevel = "L1" | "L2" | "L3";
export type FleetRole = "hands" | "reviewer" | "lead";

export type AgentRecord = {
  active: boolean;
  label: string;
  clearance?: ClearanceLevel;
  escalatesTo?: string;
  role?: FleetRole;
  maxComplexity?: number;
};

export type TenantRecord = {
  name: string;
  active: boolean;
  policyProfile: PolicyProfileName;
  agents: Record<string, AgentRecord>;
};

export type TenantRegistryFile = {
  tenants: Record<string, TenantRecord>;
};

export type ResolvedIdentity = {
  tenantId: string;
  tenantName: string;
  agentId: string;
  agentLabel: string;
  policyProfile: PolicyProfileName;
  clearance: ClearanceLevel;
  escalatesTo?: string;
  role: FleetRole;
  maxComplexity: number;
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = join(__dirname, "../../config/tenants.json");

let cached: TenantRegistryFile | null = null;
let cachedPath: string | null = null;

export function loadRegistry(path = process.env.TENANTS_CONFIG ?? DEFAULT_PATH): TenantRegistryFile {
  if (cached && cachedPath === path) return cached;
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as TenantRegistryFile;
  if (!parsed?.tenants || typeof parsed.tenants !== "object") {
    throw new Error(`Invalid tenants registry at ${path}`);
  }
  cached = parsed;
  cachedPath = path;
  return parsed;
}

export function reloadRegistry(path?: string): TenantRegistryFile {
  cached = null;
  cachedPath = null;
  return loadRegistry(path);
}

function normalizeClearance(c?: string): ClearanceLevel {
  if (c === "L2" || c === "L3") return c;
  return "L1";
}

function normalizeRole(r?: string, clearance?: ClearanceLevel): FleetRole {
  if (r === "hands" || r === "reviewer" || r === "lead") return r;
  if (clearance === "L3") return "lead";
  if (clearance === "L2") return "reviewer";
  return "hands";
}

function defaultMaxComplexity(role: FleetRole, explicit?: number): number {
  if (typeof explicit === "number" && Number.isFinite(explicit)) return explicit;
  if (role === "lead") return 1;
  if (role === "reviewer") return 0.7;
  return 0.35;
}

export function resolveTenantAgent(
  tenantId: string,
  agentId: string,
): { ok: true; identity: ResolvedIdentity } | { ok: false; reason: string } {
  const reg = loadRegistry();
  const tenant = reg.tenants[tenantId];
  if (!tenant) return { ok: false, reason: "unknown_tenant" };
  if (!tenant.active) return { ok: false, reason: "tenant_inactive" };

  const agent = tenant.agents[agentId];
  if (!agent) return { ok: false, reason: "unknown_agent" };
  if (!agent.active) return { ok: false, reason: "agent_inactive" };

  const profile: PolicyProfileName =
    tenant.policyProfile === "strict" ? "strict" : "default";
  const clearance = normalizeClearance(agent.clearance);
  const role = normalizeRole(agent.role, clearance);

  return {
    ok: true,
    identity: {
      tenantId,
      tenantName: tenant.name,
      agentId,
      agentLabel: agent.label,
      policyProfile: profile,
      clearance,
      escalatesTo: agent.escalatesTo,
      role,
      maxComplexity: defaultMaxComplexity(role, agent.maxComplexity),
    },
  };
}

export type FleetAgent = ResolvedIdentity & { rawId: string };

/** Active agents for a tenant, with fleet role metadata. */
export function listFleetAgents(tenantId: string): FleetAgent[] {
  const reg = loadRegistry();
  const tenant = reg.tenants[tenantId];
  if (!tenant?.active) return [];
  const out: FleetAgent[] = [];
  for (const [id, agent] of Object.entries(tenant.agents)) {
    if (!agent.active) continue;
    const resolved = resolveTenantAgent(tenantId, id);
    if (!resolved.ok) continue;
    out.push({ ...resolved.identity, rawId: id });
  }
  return out;
}
