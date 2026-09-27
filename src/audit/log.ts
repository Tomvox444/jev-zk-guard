/** Re-exports sealed audit log (hash chain + Ed25519). */
export {
  appendSealedAudit,
  readAudit,
  verifyChain,
  type AuditRecord,
  type AuditPayload,
  type SealInput,
  type ChainVerifyResult,
} from "./seal.js";
