// @tradrl/api-service — the boundary's branded identity spaces.
//
// Id discipline (mirrors @tradrl/control-domain/src/ids.ts): every id
// is an opaque non-empty string at runtime; branding is a compile-time
// nominal tag so distinct identity spaces are not interchangeable.
// The FORMAT of an id is decided by the OWNING lane; this boundary
// only requires the opaque-string law — with the prefix disciplines
// listed per id where the owning lane declared one.
//
// Cross-lane ownership map (who owns the referent):
// - TenantId / ProjectId / GoalRef / ConstraintSetRef / OrganizationRef
//   -> T007's control-domain identity space (one program-wide tenant
//      identity space, L12 — the mirrors in mirrors.ts are mutually
//      assignable with the REAL branded types; interop.test.ts).
// - Everything else is THIS boundary's own identity space:
//   'dev:' developer credentials, 'int:' internal service
//   credentials, 'req:' request ids, 'job:' job ids, 'usu:' usage
//   records, 'aau:' API audit records, 'idem:' idempotency keys,
//   'cur:' pagination cursor tokens, 'ost:' organization status
//   snapshots.

import { Brand, isDigest, isNonEmptyString, isPositiveSafeInteger } from './primitives';

// ---------------------------------------------------------------------------
// The cross-lane opaque ids (T007 identity space — brand tags match)
// ---------------------------------------------------------------------------

/** Tenant (customer firm) identity. Shared program-wide identity space (L12). */
export type TenantId = Brand<string, 'TenantId'>;

/** Project identity (the control plane's ProjectId — same brand tag, mutually assignable). */
export type ProjectId = Brand<string, 'ProjectId'>;

/** Opaque reference to a goal record (referent contract owned by T002/T007). */
export type GoalRef = Brand<string, 'GoalRef'>;

/** Opaque reference to a constraint-set record (referent contract owned by T002/T007). */
export type ConstraintSetRef = Brand<string, 'ConstraintSetRef'>;

/** Opaque reference to a compiled organization (referent owned by T016). */
export type OrganizationRef = Brand<string, 'OrganizationRef'>;

/** Versioned pointer to a goal statement: identity is `(goalId, version)`. */
export interface GoalVersionRef {
  readonly goalId: GoalRef;
  /** Integer >= 1; monotonically increasing per goalId. */
  readonly version: number;
}

/** Versioned pointer to a constraint set: identity is `(id, version)`. */
export interface ConstraintSetVersionRef {
  readonly id: ConstraintSetRef;
  /** Integer >= 1; monotonically increasing per id. */
  readonly version: number;
}

// Guards: opaque strings (the runtime check is shared).
export const isTenantId = (v: unknown): v is TenantId => isNonEmptyString(v);
export const isProjectId = (v: unknown): v is ProjectId => isNonEmptyString(v);
export const isGoalRef = (v: unknown): v is GoalRef => isNonEmptyString(v);
export const isConstraintSetRef = (v: unknown): v is ConstraintSetRef => isNonEmptyString(v);
export const isOrganizationRef = (v: unknown): v is OrganizationRef => isNonEmptyString(v);

// ---------------------------------------------------------------------------
// The boundary's own identity spaces (prefix disciplines)
// ---------------------------------------------------------------------------

/** Developer credential identity: `dev:` + 8-hex digest (minted by the registry). */
export type DeveloperCredentialId = Brand<string, 'DeveloperCredentialId'>;

/** Internal service credential identity: `int:` + 8-hex digest. */
export type InternalCredentialId = Brand<string, 'InternalCredentialId'>;

/** One served request's identity: `req:` + 8-hex digest (content-addressed). */
export type RequestId = Brand<string, 'RequestId'>;

/** Async job identity (the platform's job shape — `job:` prefix). */
export type JobId = Brand<string, 'JobId'>;

/** Usage-record identity: `usu:` + 8-hex digest (content-addressed, L9). */
export type UsageRecordId = Brand<string, 'UsageRecordId'>;

/** API audit-record identity: `aau:` + 8-hex digest (chain-bound content address). */
export type ApiAuditRecordId = Brand<string, 'ApiAuditRecordId'>;

/** Organization status snapshot identity: `ost:` + 8-hex digest. */
export type OrgStatusSnapshotId = Brand<string, 'OrgStatusSnapshotId'>;

/** Guard: a developer credential id. */
export function isDeveloperCredentialId(v: unknown): v is DeveloperCredentialId {
  return typeof v === 'string' && /^dev:[0-9a-f]{8}$/.test(v);
}

/** Guard: an internal service credential id. */
export function isInternalCredentialId(v: unknown): v is InternalCredentialId {
  return typeof v === 'string' && /^int:[0-9a-f]{8}$/.test(v);
}

/** Guard: a request id. */
export function isRequestId(v: unknown): v is RequestId {
  return typeof v === 'string' && /^req:[0-9a-f]{8}$/.test(v);
}

/** Guard: a job id (the platform's `job:` prefix discipline). */
export function isJobId(v: unknown): v is JobId {
  return typeof v === 'string' && /^job:[0-9a-f]{8}$/.test(v);
}

/** Guard: a usage-record id. */
export function isUsageRecordId(v: unknown): v is UsageRecordId {
  return typeof v === 'string' && /^usu:[0-9a-f]{8}$/.test(v);
}

/** Guard: an API audit-record id. */
export function isApiAuditRecordId(v: unknown): v is ApiAuditRecordId {
  return typeof v === 'string' && /^aau:[0-9a-f]{8}$/.test(v);
}

/** Guard: an organization status snapshot id. */
export function isOrgStatusSnapshotId(v: unknown): v is OrgStatusSnapshotId {
  return typeof v === 'string' && /^ost:[0-9a-f]{8}$/.test(v);
}

// ---------------------------------------------------------------------------
// Minting (content-addressed; the only construction sites)
// ---------------------------------------------------------------------------

/** Mint a request id from its content digest. */
export function mintRequestId(digest: string): RequestId {
  return `req:${digest}` as RequestId;
}

/** Mint a job id from its content digest. */
export function mintJobId(digest: string): JobId {
  return `job:${digest}` as JobId;
}

/** Mint a usage-record id from its content digest. */
export function mintUsageRecordId(digest: string): UsageRecordId {
  return `usu:${digest}` as UsageRecordId;
}

/** Mint an API audit-record id from its chain-bound content digest. */
export function mintApiAuditRecordId(digest: string): ApiAuditRecordId {
  return `aau:${digest}` as ApiAuditRecordId;
}

/** Mint a developer credential id. */
export function mintDeveloperCredentialId(digest: string): DeveloperCredentialId {
  return `dev:${digest}` as DeveloperCredentialId;
}

/** Mint an internal credential id. */
export function mintInternalCredentialId(digest: string): InternalCredentialId {
  return `int:${digest}` as InternalCredentialId;
}

/** Mint an organization status snapshot id. */
export function mintOrgStatusSnapshotId(digest: string): OrgStatusSnapshotId {
  return `ost:${digest}` as OrgStatusSnapshotId;
}

// ---------------------------------------------------------------------------
// Idempotency keys
// ---------------------------------------------------------------------------

/**
 * An idempotency key: an opaque non-empty string supplied by the
 * caller on consequential routes (execution requests, job
 * submissions). The boundary derives dedupe identity from
 * `(credentialId, route, key)` and pins the replayed body's digest —
 * the same key with a DIFFERENT body is the typed
 * `idempotency_conflict`. The SDK's helpers mint `idem:`-prefixed
 * keys; any opaque string is accepted here.
 */
export type IdempotencyKey = Brand<string, 'IdempotencyKey'>;

/** Guard: an idempotency key (opaque non-empty string, <= 256 chars — a wire-header law). */
export function isIdempotencyKey(v: unknown): v is IdempotencyKey {
  return typeof v === 'string' && v.length > 0 && v.length <= 256;
}

// ---------------------------------------------------------------------------
// Pagination cursors
// ---------------------------------------------------------------------------

/**
 * An opaque pagination cursor: `cur:` + 8-hex digest. Minted ONLY by
 * the service's pagination index over (route family, offset);
 * resolved by the same index — a cursor from anywhere else is the
 * typed validation failure at the listing routes.
 */
export type CursorToken = Brand<string, 'CursorToken'>;

/** Guard: a cursor token. */
export function isCursorToken(v: unknown): v is CursorToken {
  return typeof v === 'string' && /^cur:[0-9a-f]{8}$/.test(v);
}

/** Mint a cursor token over its digest (the pagination index's construction law). */
export function mintCursorToken(digest: string): CursorToken {
  return `cur:${digest}` as CursorToken;
}

/** `true` when `v` is a bare 8-hex digest (cursor payload discipline). */
export function isBareDigest(v: unknown): v is string {
  return isDigest(v);
}

/** Guard: a versioned-pointer draft's `version` field (integer >= 1). */
export function isVersionNumber(v: unknown): v is number {
  return isPositiveSafeInteger(v);
}
