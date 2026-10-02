// @tradrl/security — branded identity references.
//
// Id discipline (mirroring @tradrl/execution-authority/src/ids.ts — T040,
// which mirrors @tradrl/execution-policy/src/ids.ts — T019):
// - Every id is an opaque non-empty string at runtime; branding is a
//   compile-time nominal tag so distinct identity spaces are not
//   interchangeable.
// - Ids OWNED by this package (T044) are listed first: the credential
//   ENVELOPE identity (the referent of T019/T040's 'cred:' refs — T044 owns
//   the secret's envelope, id+version), the workload isolation descriptor
//   identity, the security-audit record identity, the tenant registration
//   identity, the usage-event identity, the episode admission identity and
//   the tenant export bundle identity.
// - The OPAQUE cross-lane mirrors below reserve their owners' EXACT guard
//   laws (prefix-for-prefix, law-for-law) so a value minted by the owner
//   package is accepted here VERBATIM and vice versa — the interop trip
//   wire (src/interop.test.ts + tests/security/interop.test.ts) proves it:
//   TenantId/ProjectId/StrategySpecId mirror @tradrl/control-domain (T007)
//   via T019/T040's reservations; VenueId/InstrumentId mirror
//   @tradrl/domain-core (T002); CredentialRef ('cred:') and
//   AuthorityScopeRef ('grant:') mirror T019's reservations into T040's
//   grant lane — the 'cred:' prefix is deliberately SHARED with the
//   credential envelope identity because T044 OWNS the referent (a
//   GrantCredentialBinding.credentialRef can bind a T044 envelope id
//   verbatim); AuthorityGrantId ('xag:') and GatewayAuditRecordId ('xga:')
//   mirror T040's owned spaces (composition refs only — the referent
//   records stay in the execution-authority lane); EnvironmentId/
//   EpisodeId/Seed/WorldId mirror @tradrl/environment-protocol (T005).

import { Brand, isDigest, isNonEmptyString, isPositiveSafeInteger, isRecord } from './primitives';

// --- Ids owned by security (T044) ---------------------------------------------

/**
 * Identity of one credential ENVELOPE: `cred:` + digest. The referent of
 * the 'cred:'-prefixed refs T019's ExecutionPolicy and T040's
 * GrantCredentialBinding carry. Identity is `(envelopeId, version)`;
 * rotations are NEW VERSIONS under the SAME id (the supersedes pointer
 * carries the chain). The id is content-addressed at registration (v1).
 */
export type CredentialEnvelopeId = Brand<string, 'CredentialEnvelopeId'>;

/** Identity of one workload isolation descriptor: `iso:` + digest (content-addressed). */
export type IsolationDescriptorId = Brand<string, 'IsolationDescriptorId'>;

/** Identity of one security-audit record in the append-only trail: `xsa:` + digest. */
export type SecurityAuditRecordId = Brand<string, 'SecurityAuditRecordId'>;

/** Identity of one tenant registration in the isolation registry: `treg:` + digest. */
export type TenantRegistrationId = Brand<string, 'TenantRegistrationId'>;

/** Identity of one usage-accounting event: `usg:` + digest. */
export type UsageEventId = Brand<string, 'UsageEventId'>;

/** Identity of one episode admission record: `eadm:` + digest (content-addressed). */
export type EpisodeAdmissionId = Brand<string, 'EpisodeAdmissionId'>;

/** Identity of one tenant export bundle: `xexp:` + digest (content-addressed). */
export type ExportBundleId = Brand<string, 'ExportBundleId'>;

// --- Opaque cross-lane references (referents owned by other lanes) -----------

/** Tenant scope — the isolation root (L12). Mirror of T040's TenantId reservation (control-domain owns the referent). */
export type TenantId = Brand<string, 'TenantId'>;

/** Project continuity root (L15). Mirror of T040's ProjectId reservation. */
export type ProjectId = Brand<string, 'ProjectId'>;

/** Strategy spec identity (T018 owns the referent). Mirror of T040's StrategySpecId reservation. */
export type StrategySpecId = Brand<string, 'StrategySpecId'>;

/** Venue reference (T002/T004 market lanes). Mirror of T040's VenueId reservation. */
export type VenueId = Brand<string, 'VenueId'>;

/** Instrument reference (T002 market lanes). Mirror of T005's InstrumentId reservation. */
export type InstrumentId = Brand<string, 'InstrumentId'>;

/**
 * Opaque reference to a credential record ('cred:'-prefixed). Mirror of
 * T019/T040's CredentialRef — prefix law identical; the ENVELOPE this
 * package owns is the referent.
 */
export type CredentialRef = Brand<string, 'CredentialRef'>;

/**
 * Opaque reference to a control-plane authority-grant record
 * ('grant:'-prefixed). T019's ExecutionPolicy declares these; T040's
 * AuthorityGrantRecord is the referent. Mirror of T040's
 * AuthorityScopeRef — prefix law identical.
 */
export type AuthorityScopeRef = Brand<string, 'AuthorityScopeRef'>;

/** Identity of one authority grant record (T040 owns the referent): `xag:` + digest. Mirror, prefix law identical. */
export type AuthorityGrantId = Brand<string, 'AuthorityGrantId'>;

/** Identity of one gateway audit record (T040 owns the referent): `xga:` + digest. Mirror, prefix law identical. */
export type GatewayAuditRecordId = Brand<string, 'GatewayAuditRecordId'>;

// --- T005 environment-protocol mirrors (the isolated workload unit) -----------

/** Identity of an environment profile (T005 owns the referent). Mirror of T005's EnvironmentId. */
export type EnvironmentId = Brand<string, 'EnvironmentId'>;

/** Identity of one episode: one run of one environment spec (T005 owns the referent). Mirror of T005's EpisodeId. */
export type EpisodeId = Brand<string, 'EpisodeId'>;

/** The deterministic seed of an environment profile (T005). Mirror of T005's Seed. */
export type Seed = Brand<string, 'EnvironmentSeed'>;

/** MarketWorld reference (T009/T010). Mirror of T005's WorldId. */
export type WorldId = Brand<string, 'WorldId'>;

/** Latency policy reference (T010 exchange simulation lane). Mirror of T005's LatencyPolicyId. */
export type LatencyPolicyId = Brand<string, 'LatencyPolicyId'>;

/** Fee policy reference (T010 exchange simulation lane). Mirror of T005's FeePolicyId. */
export type FeePolicyId = Brand<string, 'FeePolicyId'>;

// --- Versioned pointers (lineage carriers, L9/L15) ---------------------------

/** Versioned pointer to a credential envelope: identity is `(envelopeId, version)`. Envelopes are immutable; rotations are NEW versions. */
export interface CredentialVersionRef {
  readonly envelopeId: CredentialEnvelopeId;
  /** Integer >= 1; monotonically increasing per envelopeId. */
  readonly version: number;
}

/** Versioned pointer to an authority grant (T040 mirror): identity is `(grantId, version)`. */
export interface GrantVersionRef {
  readonly grantId: AuthorityGrantId;
  /** Integer >= 1; monotonically increasing per grantId. */
  readonly version: number;
}

/** Versioned pointer to a strategy spec (T018 mirror — the acting principal's identity). */
export interface StrategyVersionRefMirror {
  readonly specId: StrategySpecId;
  /** Integer >= 1; monotonically increasing per specId. */
  readonly version: number;
}

// --- Guards -------------------------------------------------------------------
// Ids are opaque strings: the runtime check is shared. Prefix laws are
// identical to the owning packages' (the interop trip wire proves it).

export const isCredentialEnvelopeId = (v: unknown): v is CredentialEnvelopeId => isNonEmptyString(v) && v.startsWith('cred:');
export const isIsolationDescriptorId = (v: unknown): v is IsolationDescriptorId => isNonEmptyString(v) && v.startsWith('iso:');
export const isSecurityAuditRecordId = (v: unknown): v is SecurityAuditRecordId => isNonEmptyString(v) && v.startsWith('xsa:');
export const isTenantRegistrationId = (v: unknown): v is TenantRegistrationId => isNonEmptyString(v) && v.startsWith('treg:');
export const isUsageEventId = (v: unknown): v is UsageEventId => isNonEmptyString(v) && v.startsWith('usg:');
export const isEpisodeAdmissionId = (v: unknown): v is EpisodeAdmissionId => isNonEmptyString(v) && v.startsWith('eadm:');
export const isExportBundleId = (v: unknown): v is ExportBundleId => isNonEmptyString(v) && v.startsWith('xexp:');

export const isTenantId = (v: unknown): v is TenantId => isNonEmptyString(v);
export const isProjectId = (v: unknown): v is ProjectId => isNonEmptyString(v);
export const isStrategySpecId = (v: unknown): v is StrategySpecId => isNonEmptyString(v);
export const isVenueId = (v: unknown): v is VenueId => isNonEmptyString(v);
export const isInstrumentId = (v: unknown): v is InstrumentId => isNonEmptyString(v);
export const isCredentialRef = (v: unknown): v is CredentialRef => isNonEmptyString(v) && v.startsWith('cred:');
export const isAuthorityScopeRef = (v: unknown): v is AuthorityScopeRef => isNonEmptyString(v) && v.startsWith('grant:');
export const isAuthorityGrantId = (v: unknown): v is AuthorityGrantId => isNonEmptyString(v) && v.startsWith('xag:');
export const isGatewayAuditRecordId = (v: unknown): v is GatewayAuditRecordId => isNonEmptyString(v) && v.startsWith('xga:');

export const isEnvironmentId = (v: unknown): v is EnvironmentId => isNonEmptyString(v);
export const isEpisodeId = (v: unknown): v is EpisodeId => isNonEmptyString(v);
export const isSeed = (v: unknown): v is Seed => isNonEmptyString(v);
export const isWorldId = (v: unknown): v is WorldId => isNonEmptyString(v);
export const isLatencyPolicyId = (v: unknown): v is LatencyPolicyId => isNonEmptyString(v);
export const isFeePolicyId = (v: unknown): v is FeePolicyId => isNonEmptyString(v);

export function isCredentialVersionRef(v: unknown): v is CredentialVersionRef {
  if (!isRecord(v)) return false;
  return isCredentialEnvelopeId(v.envelopeId) && isPositiveSafeInteger(v.version);
}

export function isGrantVersionRef(v: unknown): v is GrantVersionRef {
  if (!isRecord(v)) return false;
  return isAuthorityGrantId(v.grantId) && isPositiveSafeInteger(v.version);
}

export function isStrategyVersionRefMirror(v: unknown): v is StrategyVersionRefMirror {
  if (!isRecord(v)) return false;
  return isStrategySpecId(v.specId) && isPositiveSafeInteger(v.version);
}

// --- Deterministic id minting (content-addressed derived identities) ----------

/** Mint a credential envelope id from the envelope's v1 content digest: `cred:` + digest. Pure and deterministic (L9). */
export function mintCredentialEnvelopeId(digest: string): CredentialEnvelopeId {
  if (!isDigest(digest)) throw new Error(`mintCredentialEnvelopeId: invalid digest ${JSON.stringify(digest)}`);
  return `cred:${digest}` as CredentialEnvelopeId;
}

/** Mint an isolation descriptor id from the descriptor's content digest: `iso:` + digest. Pure and deterministic (L9). */
export function mintIsolationDescriptorId(digest: string): IsolationDescriptorId {
  if (!isDigest(digest)) throw new Error(`mintIsolationDescriptorId: invalid digest ${JSON.stringify(digest)}`);
  return `iso:${digest}` as IsolationDescriptorId;
}

/** Mint a security-audit record id from the record's content digest: `xsa:` + digest. Pure and deterministic (L9). */
export function mintSecurityAuditRecordId(digest: string): SecurityAuditRecordId {
  if (!isDigest(digest)) throw new Error(`mintSecurityAuditRecordId: invalid digest ${JSON.stringify(digest)}`);
  return `xsa:${digest}` as SecurityAuditRecordId;
}

/** Mint a tenant registration id from the registration's content digest: `treg:` + digest. Pure and deterministic (L9). */
export function mintTenantRegistrationId(digest: string): TenantRegistrationId {
  if (!isDigest(digest)) throw new Error(`mintTenantRegistrationId: invalid digest ${JSON.stringify(digest)}`);
  return `treg:${digest}` as TenantRegistrationId;
}

/** Mint a usage-event id from the event's content digest: `usg:` + digest. Pure and deterministic (L9). */
export function mintUsageEventId(digest: string): UsageEventId {
  if (!isDigest(digest)) throw new Error(`mintUsageEventId: invalid digest ${JSON.stringify(digest)}`);
  return `usg:${digest}` as UsageEventId;
}

/** Mint an episode admission id from the admission's content digest: `eadm:` + digest. Pure and deterministic (L9). */
export function mintEpisodeAdmissionId(digest: string): EpisodeAdmissionId {
  if (!isDigest(digest)) throw new Error(`mintEpisodeAdmissionId: invalid digest ${JSON.stringify(digest)}`);
  return `eadm:${digest}` as EpisodeAdmissionId;
}

/** Mint a tenant export bundle id from the bundle's content digest: `xexp:` + digest. Pure and deterministic (L9). */
export function mintExportBundleId(digest: string): ExportBundleId {
  if (!isDigest(digest)) throw new Error(`mintExportBundleId: invalid digest ${JSON.stringify(digest)}`);
  return `xexp:${digest}` as ExportBundleId;
}

/** Mint an authority grant id from the grant's content digest: `xag:` + digest (T040 mirror). Pure and deterministic (L9). */
export function mintAuthorityGrantId(digest: string): AuthorityGrantId {
  if (!isDigest(digest)) throw new Error(`mintAuthorityGrantId: invalid digest ${JSON.stringify(digest)}`);
  return `xag:${digest}` as AuthorityGrantId;
}
