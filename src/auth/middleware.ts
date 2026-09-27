import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { resolveTenantAgent, type ResolvedIdentity } from "./registry.js";

export const DEMO_API_SECRET = "jzg_demo_secret";

export function resolveApiSecret(): string {
  return process.env.GUARD_API_SECRET?.trim() || DEMO_API_SECRET;
}

export function isUsingDemoSecret(): boolean {
  return !process.env.GUARD_API_SECRET?.trim();
}

function safeEqualString(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    // Still compare to reduce timing leak on length (against fixed pad).
    const pad = Buffer.alloc(ba.length);
    timingSafeEqual(ba, pad);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0];
  return v;
}

export type AuthSuccess = {
  ok: true;
  identity: ResolvedIdentity;
};

export type AuthFailure = {
  ok: false;
  status: 400 | 401 | 403;
  error: string;
  message: string;
};

export type AuthResult = AuthSuccess | AuthFailure;

/**
 * SaaS mTLS-lite: shared Bearer secret + X-Tenant-Id / X-Agent-Id registry check.
 */
export function authenticateRequest(req: IncomingMessage): AuthResult {
  const auth = header(req, "authorization");
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) {
    return {
      ok: false,
      status: 401,
      error: "unauthorized",
      message: "Missing or invalid Authorization Bearer token",
    };
  }
  const token = auth.slice(7).trim();
  if (!token || !safeEqualString(token, resolveApiSecret())) {
    return {
      ok: false,
      status: 401,
      error: "unauthorized",
      message: "Invalid API secret",
    };
  }

  const tenantId = header(req, "x-tenant-id")?.trim();
  const agentId = header(req, "x-agent-id")?.trim();
  if (!tenantId || !agentId) {
    return {
      ok: false,
      status: 400,
      error: "missing_identity",
      message: "X-Tenant-Id and X-Agent-Id headers are required",
    };
  }

  const resolved = resolveTenantAgent(tenantId, agentId);
  if (!resolved.ok) {
    return {
      ok: false,
      status: 403,
      error: "forbidden",
      message: resolved.reason,
    };
  }

  return { ok: true, identity: resolved.identity };
}
