/**
 * @tradrl/audit — the platform audit service (Work Order T043): the
 * platform-wide WHO-DID-WHAT-WHEN chain.
 *
 * Public API:
 *   - `PlatformAuditRecord` / `PlatformAuditTrail` — the record
 *     (actor, action, object, at, scope, L15 lineage, chain head)
 *     and the append-only, chain-verified trail.
 *   - `startPlatformAuditTrail` / `platformAuditRecordAt` /
 *     `appendPlatformAuditRecord` / `verifyPlatformAuditChain` /
 *     `validatePlatformAuditTrail` — T040's `audit.ts` discipline,
 *     mirrored law-for-law (identity-skeleton seed, contiguous
 *     sequences, chainHead folds, content-addressed ids, duplicate
 *     object ref and tamper/truncate/reorder as the typed
 *     `audit_rewrite`, no removal/update API).
 *   - The complement refs — `GatewayAuditObjectRef` (the opaque
 *     `{ kind, auditId, tenant, project }` join key onto T040's
 *     trail; payloads never copied) and `PlatformObjectRef`.
 *   - `PLATFORM_AUDIT_ACTION_KINDS` — the closed action vocabulary.
 *   - Canonical serialization (`canonicalPlatformAuditTrailJson`)
 *     and collect-all validation.
 *
 * The contract package `@tradrl/observability` is consumed via
 * RELATIVE SOURCE IMPORTS (the services/execution-gateway precedent).
 *
 * Zero runtime dependencies. No ambient clock. No network. No
 * credential values anywhere (the opacity trip wire runs over every
 * record).
 */

// The platform audit chain
export type {
  PlatformAuditActorKind,
  PlatformAuditActor,
  PlatformAuditActionKind,
  GatewayAuditObjectRef,
  PlatformObjectRef,
  PlatformAuditObjectRef,
  PlatformAuditLineage,
  PlatformAuditRecord,
  PlatformAuditRecordContent,
  PlatformAuditRecordDraft,
  PlatformAuditTrail,
} from './platform-audit';
export {
  PLATFORM_AUDIT_ACTOR_KINDS,
  isPlatformAuditActorKind,
  isPlatformAuditActor,
  PLATFORM_AUDIT_ACTION_KINDS,
  isPlatformAuditActionKind,
  isPlatformAuditObjectRef,
  isPlatformAuditLineage,
  platformAuditContentTree,
  canonicalPlatformAuditContentJson,
  validatePlatformAuditRecord,
  isPlatformAuditRecord,
  isPlatformAuditTrail,
  startPlatformAuditTrail,
  platformAuditRecordAt,
  appendPlatformAuditRecord,
  verifyPlatformAuditChain,
  validatePlatformAuditTrail,
  platformAuditRecordTree,
  canonicalPlatformAuditTrailJson,
} from './platform-audit';

/** Service identity and ownership (governance surface). */
export const packageInfo = {
  name: '@tradrl/audit',
  owner: 'T043',
  status: 'implemented',
  concepts: [
    'PlatformAuditRecord',
    'PlatformAuditTrail',
    'GatewayAuditObjectRef',
    'PLATFORM_AUDIT_ACTION_KINDS',
  ],
} as const;
