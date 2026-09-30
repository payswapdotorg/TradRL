// @tradrl/observability — branded identity references.
//
// Id discipline (mirroring @tradrl/execution-authority/src/ids.ts — T040):
// - Every id is an opaque non-empty string at runtime; branding is a
//   compile-time nominal tag so distinct identity spaces are not
//   interchangeable.
// - Ids OWNED by this package (T043) are listed first: the telemetry
//   record identity ('tel:'-prefixed, content-addressed) and the
//   platform-audit record identity ('pau:'-prefixed, content-addressed).
// - The OPAQUE cross-lane mirrors below reserve their owners' EXACT
//   guard laws (prefix-for-prefix, law-for-law) so a value minted by
//   the owner package is accepted here VERBATIM and vice versa:
//   TenantId/ProjectId mirror @tradrl/control-domain (T007) via T040's
//   reservation (the brand tags are shared program-wide — mutually
//   assignable, zero casts); GatewayAuditRecordId ('xga:') mirrors
//   T040's audit-record identity space (the complement-by-reference
//   join key of the platform audit chain).
// - src/interop.test.ts is the drift trip wire.

import { Brand, isDigest, isNonEmptyString } from './primitives';

// --- Ids owned by observability (T043) ----------------------------------------

/** Identity of one telemetry record in an append-only telemetry log. */
export type TelemetryRecordId = Brand<string, 'TelemetryRecordId'>;

/** Identity of one platform-audit record in the append-only platform audit trail. */
export type PlatformAuditRecordId = Brand<string, 'PlatformAuditRecordId'>;

// --- Opaque cross-lane references (referents owned by other lanes) -------------

/** Tenant scope — the isolation root (L12). Mirror of T040's TenantId reservation (control-domain owns the referent). */
export type TenantId = Brand<string, 'TenantId'>;

/** Project continuity root (L15). Mirror of T040's ProjectId reservation. */
export type ProjectId = Brand<string, 'ProjectId'>;

/**
 * Opaque reference to a T040 gateway audit record ('xga:'-prefixed) —
 * the complement join key. The platform audit chain references T040
 * records ONLY through this id (never by copying their payload).
 * Mirror of T040's GatewayAuditRecordId — prefix law identical.
 */
export type GatewayAuditRecordId = Brand<string, 'GatewayAuditRecordId'>;

// --- Guards -------------------------------------------------------------------
// Ids are opaque strings: the runtime check is shared. Prefix laws are
// identical to the owning packages' (the interop trip wire proves it).

export const isTelemetryRecordId = (v: unknown): v is TelemetryRecordId => isNonEmptyString(v) && v.startsWith('tel:');
export const isPlatformAuditRecordId = (v: unknown): v is PlatformAuditRecordId => isNonEmptyString(v) && v.startsWith('pau:');
export const isTenantId = (v: unknown): v is TenantId => isNonEmptyString(v);
export const isProjectId = (v: unknown): v is ProjectId => isNonEmptyString(v);
export const isGatewayAuditRecordId = (v: unknown): v is GatewayAuditRecordId => isNonEmptyString(v) && v.startsWith('xga:');

// --- Deterministic id minting (content-addressed derived identities) ----------

/** Mint a telemetry record id from the record's content digest: `tel:` + digest. Pure and deterministic (L9). */
export function mintTelemetryRecordId(digest: string): TelemetryRecordId {
  if (!isDigest(digest)) throw new Error(`mintTelemetryRecordId: invalid digest ${JSON.stringify(digest)}`);
  return `tel:${digest}` as TelemetryRecordId;
}

/** Mint a platform-audit record id from the record's content digest: `pau:` + digest. Pure and deterministic (L9). */
export function mintPlatformAuditRecordId(digest: string): PlatformAuditRecordId {
  if (!isDigest(digest)) throw new Error(`mintPlatformAuditRecordId: invalid digest ${JSON.stringify(digest)}`);
  return `pau:${digest}` as PlatformAuditRecordId;
}
