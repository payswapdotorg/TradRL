// @tradrl/entitlements — branded identity references (the lane's id
// discipline).
//
// Id discipline (mirroring @tradrl/capability-provider and
// @tradrl/firm-memory):
// - Every id is an opaque string at runtime; branding is a compile-time
//   nominal tag so distinct identity spaces are not interchangeable.
// - Ids OWNED by this lane: `EntitlementGrantId` (`eg:`) and
//   `ConsumptionRecordId` (`cns:`) — both CONTENT-ADDRESSED
//   (`<prefix>:<16-hex stable digest>` over the canonical bytes of the
//   record's identifying content), so every id is a pure function of
//   its content: replaying the same draft mints the same id (the
//   idempotence + determinism law, L9).
// - OPAQUE cross-lane mirrors: TenantId / ProjectId (T007's control-
//   domain identity space — the brand tags re-declare the owning
//   lane's tags IDENTICALLY so references stay mutually assignable
//   without a package dependency, D-003/D-004) and the T041 usage
//   record's `usu:` grammar (the R41 fact surface's id shape).
// - This package never imports @tradrl/control-domain or
//   services/api — it only reserves the reference types and grammars
//   here; src/interop.test.ts is the drift trip wire.

import { Brand, isDigest, isNonEmptyString, stableDigestJson } from './primitives';

// ---------------------------------------------------------------------------
// Ids OWNED by the entitlements lane (T047 id spaces)
// ---------------------------------------------------------------------------

/** Identity of one entitlement grant (a versioned allowance record). */
export type EntitlementGrantId = Brand<string, 'EntitlementGrantId'>;

/** Identity of one consumption record (one draw-down on a spend allowance). */
export type ConsumptionRecordId = Brand<string, 'ConsumptionRecordId'>;

/** Identity of one grant revocation (the terminal ledger event of a chain). */
export type EntitlementRevocationId = Brand<string, 'EntitlementRevocationId'>;

// ---------------------------------------------------------------------------
// Opaque cross-lane references (T007 identity space — brand tags match)
// ---------------------------------------------------------------------------

/** Tenant id — mirror of @tradrl/skills'/@tradrl/capability-provider's `TenantId` (opaque non-empty; one program-wide identity space, L12). */
export type TenantId = Brand<string, 'TenantId'>;

/** Project id — mirror of @tradrl/skills'/@tradrl/capability-provider's `ProjectId` (opaque non-empty). */
export type ProjectId = Brand<string, 'ProjectId'>;

/** Opaque reference to a licensed artifact (the marketplace's settlement mints the referent). */
export type ArtifactRef = Brand<string, 'ArtifactRef'>;

// ---------------------------------------------------------------------------
// Identifier patterns (the runtime check shared by identifier-shaped ids)
// ---------------------------------------------------------------------------

/** Identifier pattern — mirror of the skills/capability-provider lane guard (`[A-Za-z0-9][A-Za-z0-9._:-]{0,255}`). */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

/** Opaque-ref pattern — mirror of the skills/capability-provider lane (non-space bounded, <= 1024 chars, no control characters). */
const OPAQUE_REF_PATTERN = /^[^\s](.{0,1022}[^\s])?$/u;

function isIdentifierString(v: unknown): v is string {
  return typeof v === 'string' && ID_PATTERN.test(v);
}

/**
 * The opaque-ref law — mirror of the skills lane's `isOpaqueRefString`
 * EXACTLY: non-space bounded shape, at most 1024 chars, and NO control
 * characters.
 */
function isOpaqueRefString(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v.length <= 1024 &&
    OPAQUE_REF_PATTERN.test(v) &&
    !/[\u0000-\u001f]/.test(v)
  );
}

// ---------------------------------------------------------------------------
// Guards (owned spaces)
// ---------------------------------------------------------------------------

export const isEntitlementGrantId = (v: unknown): v is EntitlementGrantId => isLedgerIdWithPrefix('eg', v);
export const isConsumptionRecordId = (v: unknown): v is ConsumptionRecordId => isLedgerIdWithPrefix('cns', v);
export const isEntitlementRevocationId = (v: unknown): v is EntitlementRevocationId => isLedgerIdWithPrefix('rev', v);

/**
 * The owned id grammar: `<prefix>:<16-hex stable digest>` — a
 * content-addressed identity in this lane's own spaces (the same
 * grammar family as @tradrl/capability-provider's exchange ids).
 */
export const ENTITLEMENT_ID_PATTERN = /^(eg|cns|rev):[0-9a-f]{16}$/;

function isLedgerIdWithPrefix(prefix: string, v: unknown): boolean {
  return typeof v === 'string' && v.startsWith(`${prefix}:`) && isDigest(v.slice(prefix.length + 1));
}

// ---------------------------------------------------------------------------
// Guards (cross-lane mirrors — same runtime checks as the owning lanes)
// ---------------------------------------------------------------------------

export const isTenantId = (v: unknown): v is TenantId => isNonEmptyString(v);
export const isProjectId = (v: unknown): v is ProjectId => isNonEmptyString(v);
export const isArtifactRef = (v: unknown): v is ArtifactRef => isOpaqueRefString(v);

// ---------------------------------------------------------------------------
// Content-addressed derivations (the ONLY id-minting path — L9/determinism)
// ---------------------------------------------------------------------------

/** Mints `eg:<digest>` — the entitlement-grant id over its canonical identifying content (replay-stable). */
export function deriveEntitlementGrantId(content: unknown): EntitlementGrantId {
  return `eg:${stableDigestJson(content)}` as EntitlementGrantId;
}

/** Mints `cns:<digest>` — the consumption-record id over its canonical identifying content (replay-stable). */
export function deriveConsumptionRecordId(content: unknown): ConsumptionRecordId {
  return `cns:${stableDigestJson(content)}` as ConsumptionRecordId;
}

/** Mints `rev:<digest>` — the grant-revocation id over its canonical identifying content (replay-stable). */
export function deriveEntitlementRevocationId(content: unknown): EntitlementRevocationId {
  return `rev:${stableDigestJson(content)}` as EntitlementRevocationId;
}

/**
 * The entitlement-ledger chain digest over one entry's canonical
 * content: `elog:<16-hex>` (a distinct grammar from the record ids — a
 * ledger head is never mistaken for a record id).
 */
export function chainHeadOf(entryContent: unknown): string {
  return `elog:${stableDigestJson(entryContent)}`;
}
