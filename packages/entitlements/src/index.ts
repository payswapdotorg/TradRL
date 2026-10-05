/**
 * @tradrl/entitlements — public API.
 *
 * Owning Work Order: T047 (frozen write surface:
 * packages/entitlements).
 *
 * WHAT A TENANT IS ALLOWED TO CONSUME — the typed allowance records
 * and the append-only, chain-verified ledger that accounts for them:
 *
 *   - ENTITLEMENT GRANTS: the closed kind vocabulary
 *     (spend-allowance | api-quota | artifact-license), exact
 *     canonical-decimal terms, L4 validity windows, L12 tenant/project
 *     scope, commercial provenance (`sourceRef`), and L3-style
 *     versioned amendments (a changed allowance MINTS version + 1 —
 *     grants never mutate; revocation is a terminal ledger event);
 *   - THE ENTITLEMENT LEDGER: one tenant, append-only, chain-verified
 *     (every operation appends a digest-linked log entry;
 *     `verifyEntitlementChain` recomputes the whole chain — a tampered
 *     entry, a rewritten record or a hidden operation is the typed
 *     `chain_mismatch`), with the EXHAUSTION LAW (exact decimal
 *     draw-downs; a charge that would cross the line is the typed
 *     `entitlement_exhausted` — L20: enforcement is code) and
 *     content-addressed idempotence (a retried charge never
 *     double-draws);
 *   - THE POINT-IN-TIME SNAPSHOT (L4): what was the tenant allowed at
 *     instant T — the version current at T, the terminal status at T,
 *     the exact consumption accumulated by T;
 *   - THE R41 USAGE ENFORCEMENT: the T041 usage-metering fact surface
 *     (per-tenant per-route usage records) mirrored structurally and
 *     enforced against api-quota grants — the boundary records the
 *     facts; THIS lane decides whether one more request is allowed.
 *
 * The marketplace service (services/marketplace, the other half of
 * Work Order T047) drives this ledger: verified-engagement charges
 * draw spend allowances; settlements mint artifact licenses.
 *
 * Package laws (mirroring the merged lanes):
 * - Zero runtime dependencies; pure data and pure functions only.
 * - No `any`; every exported shape has a hand-rolled total type guard.
 * - No ambient clock (`Date.now()` never appears) and no ambient
 *   randomness — every id is content-addressed (L9/determinism).
 * - Money is EXACT: canonical decimal strings + BigInt fixed-point
 *   arithmetic (never floats, never coerced).
 * - Cross-lane shapes (T041 api/sdk) are STRUCTURAL MIRRORS
 *   (D-003/D-004) — src/interop.test.ts is the drift trip wire; the
 *   runtime code imports none of them.
 */

// Errors and results
export type { EntitlementErrorCode, EntitlementError, EntitlementResult } from './errors';
export {
  ENTITLEMENT_ERROR_CODES,
  API_BOUNDARY_ERROR_FAMILY_OF,
  isEntitlementErrorCode,
  fail,
  failures,
  ok,
  missingField,
  invalidField,
  invalidType,
} from './errors';

// Structural primitives (deepFreeze discipline, JSON model, digests, exact decimals)
export type { Brand, JsonValue, JsonObject } from './primitives';
export {
  isRecord,
  isNonEmptyString,
  isFiniteNumber,
  isNonNegativeInteger,
  isPositiveInteger,
  isMemberOf,
  isArrayOf,
  deepFreeze,
  isDeeplyFrozen,
  deepCloneJson,
  isJsonValue,
  isJsonObject,
  canonicalJson,
  stableDigest,
  stableDigestJson,
  isDigest,
  fnv1a32Hex,
} from './primitives';

// TimestampMs mirror (canonical owner: @tradrl/time-engine)
export type { TimestampMs } from './primitives';
export { MIN_TIMESTAMP_MS, MAX_TIMESTAMP_MS, isTimestampMs, timestampMs } from './primitives';

// The canonical decimal grammar + the exact BigInt fixed-point kernel
export {
  UNSIGNED_DECIMAL_PATTERN,
  SIGNED_DECIMAL_PATTERN,
  isCanonicalUnsignedDecimal,
  isCanonicalSignedDecimal,
  isPositiveDecimal,
  isZeroDecimal,
  signedAdd,
  signedSubtract,
  signedNegate,
  signedAbs,
  signedCompare,
  unsignedAdd,
  unsignedSubtract,
  decimalMultiply,
} from './primitives';

// Ids (owned ledger spaces + opaque cross-lane mirrors)
export type {
  EntitlementGrantId,
  ConsumptionRecordId,
  EntitlementRevocationId,
  TenantId,
  ProjectId,
  ArtifactRef,
} from './ids';
export {
  ENTITLEMENT_ID_PATTERN,
  isEntitlementGrantId,
  isConsumptionRecordId,
  isEntitlementRevocationId,
  isTenantId,
  isProjectId,
  isArtifactRef,
  deriveEntitlementGrantId,
  deriveConsumptionRecordId,
  deriveEntitlementRevocationId,
  chainHeadOf,
} from './ids';

// The R41 usage mirrors + the enforcement fold
export type {
  PublicRouteFamilyMirror,
  PrivateRouteFamilyMirror,
  RouteFamilyMirror,
  UsageRecordMirror,
  SdkErrorFamilyMirror,
  QuotaGrantView,
  UsageQuotaVerdict,
} from './usage';
export {
  PUBLIC_ROUTE_FAMILIES_MIRROR,
  PRIVATE_ROUTE_FAMILIES_MIRROR,
  ROUTE_FAMILIES_MIRROR,
  USAGE_ID_PATTERN_MIRROR,
  SDK_ERROR_FAMILIES_MIRROR,
  isPublicRouteFamilyMirror,
  isPrivateRouteFamilyMirror,
  isRouteFamilyMirror,
  isUsageRecordMirror,
  isSdkErrorFamilyMirror,
  usageWindowCount,
  usageQuotaDecision,
} from './usage';

// The entitlement grant (the typed allowance record)
export type {
  EntitlementKind,
  SpendAllowanceTerms,
  ApiQuotaTerms,
  LicenseUsageScope,
  ArtifactLicenseTerms,
  EntitlementTerms,
  EntitlementGrant,
  EntitlementGrantDraft,
  GrantWindowStatus,
} from './entitlement';
export {
  ENTITLEMENT_KINDS,
  LICENSE_USAGE_SCOPES,
  isEntitlementKind,
  isLicenseUsageScope,
  isSpendAllowanceTerms,
  isApiQuotaTerms,
  isArtifactLicenseTerms,
  isEntitlementTerms,
  isEntitlementGrant,
  validateEntitlementGrant,
  grantIdentityContent,
  createEntitlementGrant,
  amendEntitlementGrant,
  grantWindowStatus,
} from './entitlement';

// The entitlement ledger (the append-only, chain-verified state machine)
export type {
  ConsumptionCause,
  EntitlementLogKind,
  EntitlementLogEntry,
  ConsumptionRecord,
  ConsumptionDraft,
  GrantRevocation,
  EntitlementLedgerState,
  EntitlementLedgerView,
  LedgerOperationResult,
  EntitlementSnapshotEntry,
  EntitlementSnapshot,
} from './ledger';
export {
  CONSUMPTION_CAUSES,
  ENTITLEMENT_LOG_KINDS,
  GENESIS_CHAIN_HEAD,
  isConsumptionCause,
  isConsumptionRecord,
  isGrantRevocation,
  createEntitlementLedger,
  verifyEntitlementChain,
  entitlementLedgerView,
  serializeEntitlementLedger,
  entitlementLedgerDigest,
  currentGrantOf,
  rootIdOf,
  issueEntitlementGrant,
  amendEntitlementGrantOn,
  revokeEntitlementGrant,
  consumeEntitlement,
  entitlementSnapshot,
  activeQuotaGrants,
  coveringSpendGrants,
} from './ledger';

/** Package identity and ownership (governance surface). */
export const packageInfo = {
  name: '@tradrl/entitlements',
  owner: 'T047',
  status: 'implemented',
  concepts: [
    'EntitlementGrant',
    'SpendAllowanceTerms',
    'ApiQuotaTerms',
    'ArtifactLicenseTerms',
    'ConsumptionRecord',
    'GrantRevocation',
    'EntitlementLedger',
    'EntitlementSnapshot',
    'UsageQuotaVerdict',
  ],
} as const;
