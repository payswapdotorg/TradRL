// @tradrl/capability-provider — branded identity references (the lane's
// id discipline).
//
// Id discipline (mirroring @tradrl/skills, @tradrl/verification and the
// other contract packages):
// - Every id is an opaque string at runtime; branding is a compile-time
//   nominal tag so distinct identity spaces are not interchangeable.
// - Ids OWNED by this lane (the exchange spaces): `ProviderRef`,
//   `ProviderDeclarationId`, `CapabilityRequestId`, `ProviderQuoteId`,
//   `EngagementId`, `DeliverableId`, `ProviderVerificationReportId` —
//   all CONTENT-ADDRESSED (`<prefix>:<16-hex stable digest>` over the
//   canonical bytes of the record's identifying content), so every id is
//   a pure function of its content: replaying the same draft mints the
//   same id (the idempotence + determinism law, L9).
// - OPAQUE cross-lane mirrors (T017 skills, T041 api/sdk): the brand
//   tags re-declare the owning lanes' tags IDENTICALLY so references
//   stay mutually assignable without a package dependency (D-003/D-004;
//   src/interop.test.ts is the trip wire). This package never imports
//   @tradrl/skills or @tradrl/sdk — it only reserves the reference
//   types here.

import { Brand, canonicalJson, isDigest, isNonEmptyString, stableDigestJson } from './primitives';

// ---------------------------------------------------------------------------
// Ids OWNED by the capability-provider lane (T045 id spaces)
// ---------------------------------------------------------------------------

/** A provider's stable identity (the expert/firm/arena/vendor handle — an identifier, never a qualification). */
export type ProviderRef = Brand<string, 'ProviderRef'>;

/** Identity of one provider declaration (the versioned capability catalogue). */
export type ProviderDeclarationId = Brand<string, 'ProviderDeclarationId'>;

/** Identity of one capability request (the platform's engagement request envelope). */
export type CapabilityRequestId = Brand<string, 'CapabilityRequestId'>;

/** Identity of one provider quote (the provider's answer to a request). */
export type ProviderQuoteId = Brand<string, 'ProviderQuoteId'>;

/** Identity of one engagement (the negotiated, verification-bound contract). */
export type EngagementId = Brand<string, 'EngagementId'>;

/** Identity of one deliverable (the provider's submitted work). */
export type DeliverableId = Brand<string, 'DeliverableId'>;

/** Identity of one provider-verification report (the platform's typed verdict). */
export type ProviderVerificationReportId = Brand<string, 'ProviderVerificationReportId'>;

// ---------------------------------------------------------------------------
// Opaque cross-lane references (T017 skills language — brand tags match)
// ---------------------------------------------------------------------------

/** Capability-contract key — mirror of @tradrl/skills' `CapabilityKey` (a capability CONTRACT, never a profession label — L16a). */
export type CapabilityKey = Brand<string, 'CapabilityKey'>;

/** Tenant id — mirror of @tradrl/skills' `TenantId` (opaque non-empty). */
export type TenantId = Brand<string, 'TenantId'>;

/** Project id — mirror of @tradrl/skills' `ProjectId` (opaque non-empty). */
export type ProjectId = Brand<string, 'ProjectId'>;

/** Capability-gap id — mirror of @tradrl/skills' `CapabilityGapId` (identifier pattern). */
export type CapabilityGapId = Brand<string, 'CapabilityGapId'>;

/** Attainment-evidence ref — mirror of @tradrl/skills' `AttainmentEvidenceRef` (opaque-ref pattern). */
export type AttainmentEvidenceRef = Brand<string, 'AttainmentEvidenceRef'>;

/** Evidence-capsule ref — mirror of @tradrl/skills' `EvidenceRef` (opaque-ref pattern). */
export type EvidenceRef = Brand<string, 'EvidenceRef'>;

/** Skill-record id — mirror of @tradrl/skills' `SkillRecordId` (identifier pattern). */
export type SkillRecordId = Brand<string, 'SkillRecordId'>;

/** Skill-artifact ref — mirror of @tradrl/skills' `SkillArtifactRef` (opaque-ref pattern). */
export type SkillArtifactRef = Brand<string, 'SkillArtifactRef'>;

/** Environment-profile ref — mirror of @tradrl/skills' `EnvironmentProfileRef` (opaque). */
export type EnvironmentProfileRef = Brand<string, 'EnvironmentProfileRef'>;

/** Instrument-class ref — mirror of @tradrl/skills' `InstrumentClassRef` (opaque). */
export type InstrumentClassRef = Brand<string, 'InstrumentClassRef'>;

/** Extraction-version ref — mirror of @tradrl/skills' `ExtractionVersionRef` (non-empty opaque). */
export type ExtractionVersionRef = Brand<string, 'ExtractionVersionRef'>;

// ---------------------------------------------------------------------------
// Identifier patterns (the runtime check shared by identifier-shaped ids)
// ---------------------------------------------------------------------------

/** Identifier pattern — mirror of the skills/organization lane guard (`[A-Za-z0-9][A-Za-z0-9._:-]{0,255}`). */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

function isIdentifierString(v: unknown): v is string {
  return typeof v === 'string' && ID_PATTERN.test(v);
}

/** Opaque-ref pattern — mirror of the skills lane (non-space, <= 1024 chars). */
const OPAQUE_REF_PATTERN = /^[^\s](.{0,1022}[^\s])?$/u;

/**
 * The opaque-ref law — mirror of the skills lane's `isOpaqueRefString`
 * EXACTLY: non-space bounded shape, at most 1024 chars, and NO control
 * characters (the real lane excludes `[\u0000-\u001f]`; this mirror
 * accepts nothing the real lane would reject, so a ref that survives this
 * lane's guards also survives the T017 import path's).
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

export const isProviderRef = (v: unknown): v is ProviderRef => isIdentifierString(v);
export const isProviderDeclarationId = (v: unknown): v is ProviderDeclarationId => isExchangeIdWithPrefix('pvd', v);
export const isCapabilityRequestId = (v: unknown): v is CapabilityRequestId => isExchangeIdWithPrefix('cpr', v);
export const isProviderQuoteId = (v: unknown): v is ProviderQuoteId => isExchangeIdWithPrefix('qte', v);
export const isEngagementId = (v: unknown): v is EngagementId => isExchangeIdWithPrefix('eng', v);
export const isDeliverableId = (v: unknown): v is DeliverableId => isExchangeIdWithPrefix('dlv', v);
export const isProviderVerificationReportId = (v: unknown): v is ProviderVerificationReportId => isExchangeIdWithPrefix('vrf', v);

/**
 * The owned id grammar: `<prefix>:<16-hex stable digest>` — a
 * content-addressed identity in this lane's own spaces. The colon is
 * inside the skills lane's identifier alphabet, so these ids flow into
 * T017-shaped records (e.g. `attainmentEvidenceRefs`) without
 * translation.
 */
export const EXCHANGE_ID_PATTERN = /^(pvd|cpr|qte|eng|dlv|vrf):[0-9a-f]{16}$/;

function isExchangeIdWithPrefix(prefix: string, v: unknown): boolean {
  return typeof v === 'string' && v.startsWith(`${prefix}:`) && isDigest(v.slice(prefix.length + 1));
}

// ---------------------------------------------------------------------------
// Guards (cross-lane mirrors — same runtime checks as the owning lanes)
// ---------------------------------------------------------------------------

export const isCapabilityKey = (v: unknown): v is CapabilityKey => isIdentifierString(v);
export const isTenantId = (v: unknown): v is TenantId => isNonEmptyString(v);
export const isProjectId = (v: unknown): v is ProjectId => isNonEmptyString(v);
export const isCapabilityGapId = (v: unknown): v is CapabilityGapId => isIdentifierString(v);
export const isAttainmentEvidenceRef = (v: unknown): v is AttainmentEvidenceRef => isOpaqueRefString(v);
export const isEvidenceRef = (v: unknown): v is EvidenceRef => isOpaqueRefString(v);
export const isSkillRecordId = (v: unknown): v is SkillRecordId => isIdentifierString(v);
export const isSkillArtifactRef = (v: unknown): v is SkillArtifactRef => isOpaqueRefString(v);
export const isEnvironmentProfileRef = (v: unknown): v is EnvironmentProfileRef => isOpaqueRefString(v);
export const isInstrumentClassRef = (v: unknown): v is InstrumentClassRef => isOpaqueRefString(v);
export const isExtractionVersionRef = (v: unknown): v is ExtractionVersionRef => isNonEmptyString(v);

// ---------------------------------------------------------------------------
// Content-addressed derivations (the ONLY id-minting path — L9/determinism)
// ---------------------------------------------------------------------------

/** Mints `pvd:<digest>` — the provider-declaration id over its canonical identifying content. */
export function deriveProviderDeclarationId(content: unknown): ProviderDeclarationId {
  return `pvd:${stableDigestJson(content)}` as ProviderDeclarationId;
}

/** Mints `cpr:<digest>` — the capability-request id over its canonical identifying content (replay-stable). */
export function deriveCapabilityRequestId(content: unknown): CapabilityRequestId {
  return `cpr:${stableDigestJson(content)}` as CapabilityRequestId;
}

/** Mints `qte:<digest>` — the provider-quote id over its canonical identifying content. */
export function deriveProviderQuoteId(content: unknown): ProviderQuoteId {
  return `qte:${stableDigestJson(content)}` as ProviderQuoteId;
}

/** Mints `eng:<digest>` — the engagement id over its canonical identifying content (request + quote pair). */
export function deriveEngagementId(content: unknown): EngagementId {
  return `eng:${stableDigestJson(content)}` as EngagementId;
}

/** Mints `dlv:<digest>` — the deliverable id over its canonical identifying content. */
export function deriveDeliverableId(content: unknown): DeliverableId {
  return `dlv:${stableDigestJson(content)}` as DeliverableId;
}

/** Mints `vrf:<digest>` — the verification-report id over its canonical identifying content. */
export function deriveProviderVerificationReportId(content: unknown): ProviderVerificationReportId {
  return `vrf:${stableDigestJson(content)}` as ProviderVerificationReportId;
}

/**
 * The exchange-log chain digest over one entry's canonical content:
 * `log:<16-hex>` (a distinct grammar from the record ids — a log head is
 * never mistaken for a record id).
 */
export function chainHeadOf(entryContent: unknown): string {
  return `log:${stableDigestJson(entryContent)}`;
}

/** The canonical bytes of a derivation input (exposed for tests + serialization parity). */
export function canonicalDerivationBytes(content: unknown): string {
  return canonicalJson(content);
}
