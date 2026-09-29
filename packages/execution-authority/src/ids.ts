// @tradrl/execution-authority — branded identity references.
//
// Id discipline (mirroring @tradrl/execution-policy/src/ids.ts — T019):
// - Every id is an opaque non-empty string at runtime; branding is a
//   compile-time nominal tag so distinct identity spaces are not
//   interchangeable.
// - Ids OWNED by this package (T040) are listed first: the authority
//   grant identity space (grant id + the versioned pointer), the
//   gateway order-request identity, the gateway submission identity,
//   the gateway audit-record identity, and the opaque routing refs
//   over the T039 adapter descriptors (adapter ref + channel ref).
// - The OPAQUE cross-lane mirrors below reserve their owners' EXACT
//   guard laws (prefix-for-prefix, law-for-law) so a value minted by
//   the owner package is accepted here VERBATIM and vice versa —
//   src/interop.test.ts is the drift trip wire:
//   TenantId/ProjectId/StrategySpecId mirror @tradrl/control-domain
//   (T007) via T019's reservation; VenueId/InstrumentId mirror
//   @tradrl/domain-core (T002); CredentialRef ('cred:') and
//   AuthorityScopeRef ('grant:') mirror T019's reservations into the
//   control-plane grant registry and the secrets lane (T044 owns
//   values; THIS package binds venues); DecisionId ('xd:') mirrors
//   T019's decision identity; ExecutionPolicyId ('xpol:') and
//   KillSwitchId ('ksw:') mirror T019's owned spaces.

import { Brand, isDigest, isNonEmptyString, isPositiveSafeInteger, isRecord } from './primitives';

// --- Ids owned by execution-authority (T040) ----------------------------------

/** Identity of one authority grant record: identity is `(grantId, version)`; content-addressed. */
export type AuthorityGrantId = Brand<string, 'AuthorityGrantId'>;

/** Identity of one gateway order request (content-addressed — see order-request.ts minting). */
export type GatewayOrderRequestId = Brand<string, 'GatewayOrderRequestId'>;

/** Identity of one gateway submission outcome (content-addressed — minted by the gateway lane). */
export type GatewaySubmissionId = Brand<string, 'GatewaySubmissionId'>;

/** Identity of one gateway audit record in the append-only trail. */
export type GatewayAuditRecordId = Brand<string, 'GatewayAuditRecordId'>;

/**
 * Opaque reference to a provider adapter descriptor: `adapter:` +
 * descriptor id + `@` + version (e.g. `adapter:adapter-brokers@0.0.0`).
 * Mirrors the T039 descriptor identity space (`AdapterRef.id`,
 * `AdapterRef.version`) — the interop test proves the decomposition.
 */
export type AdapterDescriptorRef = Brand<string, 'AdapterDescriptorRef'>;

/**
 * Opaque reference to an outbound order-entry channel: `chan:` + the
 * channel name (e.g. `chan:newOrderSingle`). Mirrors the T039 channel
 * identities (`BROKER_ORDER_CHANNEL`, `OMS_EMS_ORDER_CHANNEL`).
 */
export type ChannelRef = Brand<string, 'ChannelRef'>;

// --- Opaque cross-lane references (referents owned by other lanes) -----------

/** Tenant scope — the isolation root (L12). Mirror of T019's TenantId reservation (control-domain owns the referent). */
export type TenantId = Brand<string, 'TenantId'>;

/** Project continuity root (L15). Mirror of T019's ProjectId reservation. */
export type ProjectId = Brand<string, 'ProjectId'>;

/** Strategy spec identity (T018 owns the referent). Mirror of T019's StrategySpecId reservation. */
export type StrategySpecId = Brand<string, 'StrategySpecId'>;

/** Instrument reference (T002 market lanes). Mirror of T019's InstrumentId reservation. */
export type InstrumentId = Brand<string, 'InstrumentId'>;

/** Venue reference (T002/T004 market lanes). Mirror of T019's VenueId reservation. */
export type VenueId = Brand<string, 'VenueId'>;

/**
 * Opaque reference to a credential record ('cred:'-prefixed). The
 * referent VALUE lives in the secrets lane (T044); this lane carries
 * ONLY the reference (the credential-opacity law; see credentials.ts).
 * Mirror of T019's CredentialRef — prefix law identical.
 */
export type CredentialRef = Brand<string, 'CredentialRef'>;

/**
 * Opaque reference to a control-plane authority-grant record
 * ('grant:'-prefixed). T019's ExecutionPolicy declares these in its
 * `authorization` dimension; THIS package's AuthorityGrantRecord is the
 * REFERENT (the join key is the scope ref itself — the interop law).
 * Mirror of T019's AuthorityScopeRef — prefix law identical.
 */
export type AuthorityScopeRef = Brand<string, 'AuthorityScopeRef'>;

/** Identity of one gate decision ('xd:'-prefixed, content-addressed). Mirror of T019's DecisionId. */
export type DecisionId = Brand<string, 'DecisionId'>;

/** Identity of an execution policy record ('xpol:'-prefixed, content-addressed). Mirror of T019's ExecutionPolicyId. */
export type ExecutionPolicyId = Brand<string, 'ExecutionPolicyId'>;

/** Identity of a standing kill-switch log ('ksw:'-prefixed). Mirror of T019's KillSwitchId. */
export type KillSwitchId = Brand<string, 'KillSwitchId'>;

/** Opaque reference to the cognitive substrate that computed the gated intent (audit contents — SECURITY.md). */
export type SubstrateRef = Brand<string, 'SubstrateRef'>;

// --- Versioned pointers (lineage carriers, L9/L15) ---------------------------

/** Versioned pointer to an authority grant: identity is `(grantId, version)`. Grants are immutable; revisions are NEW versions. */
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

/** Versioned pointer to an execution policy: identity is `(policyId, version)`. Mirror of T019's PolicyVersionRef. */
export interface PolicyVersionRefMirror {
  readonly policyId: ExecutionPolicyId;
  /** Integer >= 1; monotonically increasing per policyId. */
  readonly version: number;
}

// --- Guards -------------------------------------------------------------------
// Ids are opaque strings: the runtime check is shared. Prefix laws are
// identical to the owning packages' (the interop trip wire proves it).

export const isAuthorityGrantId = (v: unknown): v is AuthorityGrantId => isNonEmptyString(v) && v.startsWith('xag:');
export const isGatewayOrderRequestId = (v: unknown): v is GatewayOrderRequestId => isNonEmptyString(v) && v.startsWith('gor:');
export const isGatewaySubmissionId = (v: unknown): v is GatewaySubmissionId => isNonEmptyString(v) && v.startsWith('xgs:');
export const isGatewayAuditRecordId = (v: unknown): v is GatewayAuditRecordId => isNonEmptyString(v) && v.startsWith('xga:');
export const isAdapterDescriptorRef = (v: unknown): v is AdapterDescriptorRef => isNonEmptyString(v) && v.startsWith('adapter:') && v.split('@').length === 2 && isNonEmptyString(v.split('@')[0]) && isNonEmptyString(v.split('@')[1]);
export const isChannelRef = (v: unknown): v is ChannelRef => isNonEmptyString(v) && v.startsWith('chan:');

export const isTenantId = (v: unknown): v is TenantId => isNonEmptyString(v);
export const isProjectId = (v: unknown): v is ProjectId => isNonEmptyString(v);
export const isStrategySpecId = (v: unknown): v is StrategySpecId => isNonEmptyString(v);
export const isInstrumentId = (v: unknown): v is InstrumentId => isNonEmptyString(v);
export const isVenueId = (v: unknown): v is VenueId => isNonEmptyString(v);
export const isCredentialRef = (v: unknown): v is CredentialRef => isNonEmptyString(v) && v.startsWith('cred:');
export const isAuthorityScopeRef = (v: unknown): v is AuthorityScopeRef => isNonEmptyString(v) && v.startsWith('grant:');
export const isDecisionId = (v: unknown): v is DecisionId => isNonEmptyString(v) && v.startsWith('xd:');
export const isExecutionPolicyId = (v: unknown): v is ExecutionPolicyId => isNonEmptyString(v) && v.startsWith('xpol:');
export const isKillSwitchId = (v: unknown): v is KillSwitchId => isNonEmptyString(v) && v.startsWith('ksw:');
export const isSubstrateRef = (v: unknown): v is SubstrateRef => isNonEmptyString(v);

export function isGrantVersionRef(v: unknown): v is GrantVersionRef {
  if (!isRecord(v)) return false;
  return isAuthorityGrantId(v.grantId) && isPositiveSafeInteger(v.version);
}

export function isStrategyVersionRefMirror(v: unknown): v is StrategyVersionRefMirror {
  if (!isRecord(v)) return false;
  return isStrategySpecId(v.specId) && isPositiveSafeInteger(v.version);
}

export function isPolicyVersionRefMirror(v: unknown): v is PolicyVersionRefMirror {
  if (!isRecord(v)) return false;
  return isExecutionPolicyId(v.policyId) && isPositiveSafeInteger(v.version);
}

// --- Deterministic id minting (content-addressed derived identities) ----------

/** Mint the grant id from the grant's content digest: `xag:` + digest. Pure and deterministic (L9). */
export function mintAuthorityGrantId(digest: string): AuthorityGrantId {
  if (!isDigest(digest)) throw new Error(`mintAuthorityGrantId: invalid digest ${JSON.stringify(digest)}`);
  return `xag:${digest}` as AuthorityGrantId;
}

/** Mint a gateway order-request id from the request's content digest: `gor:` + digest. Pure and deterministic (L9). */
export function mintGatewayOrderRequestId(digest: string): GatewayOrderRequestId {
  if (!isDigest(digest)) throw new Error(`mintGatewayOrderRequestId: invalid digest ${JSON.stringify(digest)}`);
  return `gor:${digest}` as GatewayOrderRequestId;
}

/** Mint a gateway submission id from the submission's content digest: `xgs:` + digest. Pure and deterministic (L9). */
export function mintGatewaySubmissionId(digest: string): GatewaySubmissionId {
  if (!isDigest(digest)) throw new Error(`mintGatewaySubmissionId: invalid digest ${JSON.stringify(digest)}`);
  return `xgs:${digest}` as GatewaySubmissionId;
}

/** Mint a gateway audit-record id from the record's content digest: `xga:` + digest. Pure and deterministic (L9). */
export function mintGatewayAuditRecordId(digest: string): GatewayAuditRecordId {
  if (!isDigest(digest)) throw new Error(`mintGatewayAuditRecordId: invalid digest ${JSON.stringify(digest)}`);
  return `xga:${digest}` as GatewayAuditRecordId;
}

/**
 * Mint the opaque adapter descriptor ref over a T039 descriptor identity:
 * `adapter:` + id + `@` + version. Pure and deterministic — the interop
 * test proves `mintAdapterDescriptorRef(BROKER_ADAPTER)` routes to the
 * real brokers adapter's identity.
 */
export function mintAdapterDescriptorRef(descriptor: { readonly id: string; readonly version: string }): AdapterDescriptorRef {
  if (!isNonEmptyString(descriptor.id)) throw new Error(`mintAdapterDescriptorRef: invalid descriptor id ${JSON.stringify(descriptor.id)}`);
  if (!isNonEmptyString(descriptor.version)) throw new Error(`mintAdapterDescriptorRef: invalid descriptor version ${JSON.stringify(descriptor.version)}`);
  return `adapter:${descriptor.id}@${descriptor.version}` as AdapterDescriptorRef;
}

/**
 * Mint the opaque channel ref over a T039 channel identity:
 * `chan:` + channel name. Pure and deterministic.
 */
export function mintChannelRef(channel: string): ChannelRef {
  if (!isNonEmptyString(channel)) throw new Error(`mintChannelRef: invalid channel ${JSON.stringify(channel)}`);
  return `chan:${channel}` as ChannelRef;
}

/**
 * Decompose an adapter descriptor ref into its descriptor identity
 * `(id, version)` — the inverse of {@link mintAdapterDescriptorRef}
 * (the interop bridge back onto the T039 descriptor space).
 */
export function adapterDescriptorOf(ref: AdapterDescriptorRef): { readonly id: string; readonly version: string } {
  if (!isAdapterDescriptorRef(ref)) throw new Error(`adapterDescriptorOf: invalid adapter ref ${JSON.stringify(ref)}`);
  const [id, version] = (ref as string).slice('adapter:'.length).split('@');
  return { id, version };
}

/**
 * Decompose a channel ref into its channel name — the inverse of
 * {@link mintChannelRef} (the interop bridge back onto the T039 channel
 * space).
 */
export function channelOf(ref: ChannelRef): string {
  if (!isChannelRef(ref)) throw new Error(`channelOf: invalid channel ref ${JSON.stringify(ref)}`);
  return (ref as string).slice('chan:'.length);
}
