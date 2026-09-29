// @tradrl/execution-authority — the AuthorityGrantRecord: WHO may do
// WHAT (the referent of the 'grant:' refs T019's ExecutionPolicy
// declares in its authorization dimension).
//
// THE LAW (the Work Order: "AuthorityGrant: who may do what —
// tenant/principal identity refs, granted AuthorityScopeRefs (mirror
// T019's id space), venue permissions, rate budgets, validity window
// (explicit issuedAt/expiresAt instants), revocation records.
// Versioned, content-addressed."). And spec/ARCHITECTURE.md Execution —
// VERBATIM: "Consequential actions require hard controls outside
// prompts: identity, authorization, limits, venue permissions, rate
// limits, kill switch, credentials and audit."
//
// THE JOIN KEY: T019's `ExecutionPolicy.authorization[]` declares
// `{ scopeRef: AuthorityScopeRef, orderKinds }` — opaque 'grant:'-prefixed
// refs whose referents THIS package owns. The gateway resolves the
// policy's declared scope ref against the EntitlementRegistry's grant
// records; an unknown ref is the typed `unknown_grant` refusal (the
// Default-Deny law — nothing routes by default).
//
// THE VALIDITY-WINDOW LAW (declared semantics, tested at the boundary
// and off-by-one): the window is [issuedAt, expiresAt) — INCLUSIVE at
// issuance, EXCLUSIVE at expiry. At `now === issuedAt` the grant is
// valid; at `now === expiresAt - 1` it is still valid; at
// `now === expiresAt` it is EXPIRED (the boundary instant itself
// belongs to the dead side); before issuedAt it is NOT-YET-VALID. A
// grant record with `issuedAt >= expiresAt` fails validation (an empty
// or inverted window is inexpressible).
//
// THE REVOCATION LAW: revocation records are APPEND-ONLY facts on the
// grant record — a grant carrying ANY revocation record is revoked
// (there is no un-revocation; a restored principal receives a NEW
// grant version). The record names the instant, the reason and the
// opaque revoking principal.
//
// THE OPACITY LAW (SECURITY.md's boundary, enforced in code): the
// credential bindings carry opaque 'cred:'-prefixed refs ONLY; the
// guard AND the collect-all validator run the credential-value trip
// wire over the WHOLE record — a credential VALUE anywhere is the
// typed `credential_value_present` error.
//
// Versioning (L9/L11 discipline): identity is `(grantId, version)`;
// the id is content-addressed from the canonical grant content; a
// revision is a NEW VERSION under the same id (the supersedes pointer
// carries the chain). Immutable, deeply frozen, JSON-serializable.

import { deepFreeze, isNonEmptyString, isPositiveSafeInteger, isRecord, isTimestampMs, type JsonValue, type TimestampMs } from './primitives';
import { canonicalJson, fnv1a32Hex } from './primitives';
import { credentialValueViolations } from './credentials';
import type {
  AuthorityGrantId,
  AuthorityScopeRef,
  CredentialRef,
  GrantVersionRef,
  ProjectId,
  StrategyVersionRefMirror,
  TenantId,
  VenueId,
} from './ids';
import { isAuthorityScopeRef, isCredentialRef, isGrantVersionRef, isProjectId, isStrategyVersionRefMirror, isTenantId, isVenueId, mintAuthorityGrantId } from './ids';
import type { ExecutionAuthorityResult } from './errors';
import { fail, invalidField, invalidType, missingField, ok } from './errors';

// ---------------------------------------------------------------------------
// The grant's dimension records
// ---------------------------------------------------------------------------

/** One revocation record: the append-only fact that the grant died. */
export interface RevocationRecord {
  /** The revocation instant (epoch ms; explicit, never a clock read). */
  readonly revokedAt: TimestampMs;
  /** The non-empty human-audit reason for the revocation. */
  readonly reason: string;
  /** The opaque principal that revoked (a control-plane identity ref). */
  readonly revokedBy: string;
}

/** Guard: `RevocationRecord`. */
export function isRevocationRecord(v: unknown): v is RevocationRecord {
  if (!isRecord(v)) return false;
  if (!isTimestampMs(v.revokedAt)) return false;
  if (!isNonEmptyString(v.reason)) return false;
  if (!isNonEmptyString(v.revokedBy)) return false;
  return true;
}

/** One per-venue rate budget the grant carries (the operational budget; the gateway threads the window). */
export interface GrantRateBudget {
  readonly venue: VenueId;
  /** The budget's window length in milliseconds (>= 1). */
  readonly windowMs: number;
  /** Maximum orders routed to the venue within one window (>= 0; 0 = venue paused by budget). */
  readonly maxOrders: number;
}

/** Guard: `GrantRateBudget`. */
export function isGrantRateBudget(v: unknown): v is GrantRateBudget {
  if (!isRecord(v)) return false;
  if (!isVenueId(v.venue)) return false;
  if (typeof v.windowMs !== 'number' || !Number.isSafeInteger(v.windowMs) || v.windowMs < 1) return false;
  if (typeof v.maxOrders !== 'number' || !Number.isSafeInteger(v.maxOrders) || v.maxOrders < 0) return false;
  return true;
}

/** One opaque credential binding the grant carries: the (venue, 'cred:' ref) pair the grant permits. */
export interface GrantCredentialBinding {
  readonly venue: VenueId;
  /** Opaque reference to the credential record ('cred:'-prefixed) — NEVER a value (the trip wire enforces opacity). */
  readonly credentialRef: CredentialRef;
}

/** Guard: `GrantCredentialBinding`. */
export function isGrantCredentialBinding(v: unknown): v is GrantCredentialBinding {
  if (!isRecord(v)) return false;
  if (!isVenueId(v.venue)) return false;
  if (!isCredentialRef(v.credentialRef)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The grant record
// ---------------------------------------------------------------------------

/**
 * The versioned, content-addressed authority grant: WHO (tenant,
 * project, principal) may do WHAT (order kinds) WHERE (venues) HOW
 * FAST (rate budgets) WITH WHAT BINDING (opaque credential refs) and
 * UNTIL WHEN (the explicit validity window) — plus the append-only
 * revocation log. The `scopeRef` is the 'grant:'-prefixed join key
 * T019's ExecutionPolicy declares; this record is its referent.
 */
export interface AuthorityGrantRecord {
  /** Content-addressed identity: `xag:` + digest of the canonical content. */
  readonly grantId: AuthorityGrantId;
  /** Integer >= 1; monotonically increasing per grantId (revisions are NEW versions). */
  readonly version: number;
  /** The version this grant supersedes (null iff version 1 — the version chain). */
  readonly supersedes: GrantVersionRef | null;
  /** WHO — the tenant scope (L12; must match the policy's and the intent's scope). */
  readonly tenant: TenantId;
  /** WHO — the project scope (L12/L15). */
  readonly project: ProjectId;
  /** WHO — the acting principal (the strategy version mirror — T018's identity space). */
  readonly principal: StrategyVersionRefMirror;
  /** THE JOIN KEY — the opaque 'grant:'-prefixed scope ref T019's policy declares in its authorization dimension. */
  readonly scopeRef: AuthorityScopeRef;
  /** WHAT — the order kinds this grant permits (non-empty, unique). */
  readonly orderKinds: readonly string[];
  /** WHERE — the venues this grant permits routing to (unique). */
  readonly venues: readonly VenueId[];
  /** HOW FAST — the per-venue rate budgets (one per venue, unique). */
  readonly rateBudgets: readonly GrantRateBudget[];
  /** WITH WHAT BINDING — the opaque per-venue credential refs (unique per venue). */
  readonly credentials: readonly GrantCredentialBinding[];
  /** UNTIL WHEN — the explicit validity window: [issuedAt, expiresAt) (inclusive at issue, EXCLUSIVE at expiry). */
  readonly validity: {
    readonly issuedAt: TimestampMs;
    readonly expiresAt: TimestampMs;
  };
  /** The append-only revocation log (non-empty => the grant is revoked). */
  readonly revocations: readonly RevocationRecord[];
  /** The declaration instant (epoch ms; no ambient clock). */
  readonly asOf: TimestampMs;
}

/** Guard: `AuthorityGrantRecord` (structural; the totality laws live in `validateAuthorityGrant`). */
export function isAuthorityGrantRecord(v: unknown): v is AuthorityGrantRecord {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.grantId) || !(v.grantId as string).startsWith('xag:')) return false;
  if (!isPositiveSafeInteger(v.version)) return false;
  if (v.supersedes !== null && !isGrantVersionRef(v.supersedes)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  if (!isStrategyVersionRefMirror(v.principal)) return false;
  if (!isAuthorityScopeRef(v.scopeRef)) return false;
  if (!Array.isArray(v.orderKinds) || v.orderKinds.length === 0 || !v.orderKinds.every((x) => isNonEmptyString(x))) return false;
  if (new Set(v.orderKinds).size !== v.orderKinds.length) return false;
  if (!Array.isArray(v.venues) || !v.venues.every((x) => isVenueId(x))) return false;
  if (new Set(v.venues).size !== v.venues.length) return false;
  if (!Array.isArray(v.rateBudgets) || !v.rateBudgets.every((x) => isGrantRateBudget(x))) return false;
  if (new Set(v.rateBudgets.map((x) => x.venue)).size !== v.rateBudgets.length) return false;
  if (!Array.isArray(v.credentials) || !v.credentials.every((x) => isGrantCredentialBinding(x))) return false;
  if (new Set(v.credentials.map((x) => x.venue)).size !== v.credentials.length) return false;
  const validity = v.validity;
  if (
    !isRecord(validity) ||
    !isTimestampMs(validity.issuedAt) ||
    !isTimestampMs(validity.expiresAt) ||
    validity.issuedAt >= validity.expiresAt
  ) {
    return false;
  }
  if (!Array.isArray(v.revocations) || !v.revocations.every((x) => isRevocationRecord(x))) return false;
  if (!isTimestampMs(v.asOf)) return false;
  // The opacity trip wire (the guard half — SECURITY.md's boundary in code).
  if (credentialValueViolations(v).length > 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Content addressing (L9)
// ---------------------------------------------------------------------------

/**
 * The canonical JSON tree of a grant's CONTENT (everything except the
 * content-addressed `grantId`). The explicit-tree discipline: JSON
 * shape is proven by construction, never cast. Equal contents always
 * serialize byte-identically.
 */
export function grantContentTree(grant: Omit<AuthorityGrantRecord, 'grantId'>): JsonValue {
  return {
    version: grant.version,
    supersedes: grant.supersedes === null ? null : { grantId: grant.supersedes.grantId, version: grant.supersedes.version },
    tenant: grant.tenant,
    project: grant.project,
    principal: { specId: grant.principal.specId, version: grant.principal.version },
    scopeRef: grant.scopeRef,
    orderKinds: [...grant.orderKinds],
    venues: [...grant.venues],
    rateBudgets: grant.rateBudgets.map((budget) => ({ venue: budget.venue, windowMs: budget.windowMs, maxOrders: budget.maxOrders })),
    credentials: grant.credentials.map((binding) => ({ venue: binding.venue, credentialRef: binding.credentialRef })),
    validity: { issuedAt: grant.validity.issuedAt, expiresAt: grant.validity.expiresAt },
    revocations: grant.revocations.map((record) => ({ revokedAt: record.revokedAt, reason: record.reason, revokedBy: record.revokedBy })),
    asOf: grant.asOf,
  };
}

/** The L9 anchor: the canonical JSON of a validated grant's content. */
export function canonicalGrantJson(grant: AuthorityGrantRecord): string {
  return canonicalJson(grantContentTree(grant));
}

// ---------------------------------------------------------------------------
// Validation (collect-all; the totality laws)
// ---------------------------------------------------------------------------

/**
 * Collect-all validation of an untrusted authority grant: the
 * structural guard plus the opacity trip wire plus the window law
 * (issuedAt < expiresAt) plus the version-chain law (supersedes, when
 * present, must name a strictly earlier version). On success the grant
 * is returned narrowed, deeply frozen, with its content-addressed id
 * RE-DERIVED and cross-checked (a record claiming an id that does not
 * match its content fails with `invalid_field` — a forged id is a
 * malformed envelope).
 */
export function validateAuthorityGrant(value: unknown, path = 'grant'): ExecutionAuthorityResult<AuthorityGrantRecord> {
  if (!isRecord(value)) {
    return fail('invalid_type', `${path} must be an object`);
  }
  const errors: ReturnType<typeof invalidField>[] = [];
  if (value.grantId === undefined) errors.push(missingField(`${path}.grantId`));
  else if (!isNonEmptyString(value.grantId) || !(value.grantId as string).startsWith('xag:')) {
    errors.push(invalidField(`${path}.grantId`, 'must be an opaque xag:-prefixed grant id'));
  }
  if (value.version === undefined) errors.push(missingField(`${path}.version`));
  else if (!isPositiveSafeInteger(value.version)) errors.push(invalidField(`${path}.version`, 'must be an integer >= 1'));
  if (value.supersedes !== null && value.supersedes !== undefined && !isGrantVersionRef(value.supersedes)) {
    errors.push(invalidField(`${path}.supersedes`, 'must be null or { grantId, version } with version >= 1'));
  }
  if (value.tenant === undefined) errors.push(missingField(`${path}.tenant`));
  else if (!isTenantId(value.tenant)) errors.push(invalidField(`${path}.tenant`, 'must be a non-empty tenant scope (L12)'));
  if (value.project === undefined) errors.push(missingField(`${path}.project`));
  else if (!isProjectId(value.project)) errors.push(invalidField(`${path}.project`, 'must be a non-empty project scope (L12/L15)'));
  if (value.principal === undefined) errors.push(missingField(`${path}.principal`));
  else if (!isStrategyVersionRefMirror(value.principal)) errors.push(invalidField(`${path}.principal`, 'must be { specId, version >= 1 } — the acting strategy version'));
  if (value.scopeRef === undefined) errors.push(missingField(`${path}.scopeRef`));
  else if (!isAuthorityScopeRef(value.scopeRef)) errors.push(invalidField(`${path}.scopeRef`, "must be an opaque 'grant:'-prefixed scope ref (T019's authorization join key)"));
  if (value.orderKinds === undefined) errors.push(missingField(`${path}.orderKinds`));
  else if (!Array.isArray(value.orderKinds) || value.orderKinds.length === 0 || !value.orderKinds.every((x) => isNonEmptyString(x)) || new Set(value.orderKinds).size !== value.orderKinds.length) {
    errors.push(invalidField(`${path}.orderKinds`, 'must be a non-empty list of unique order kinds'));
  }
  if (value.venues === undefined) errors.push(missingField(`${path}.venues`));
  else if (!Array.isArray(value.venues) || !value.venues.every((x) => isVenueId(x)) || new Set(value.venues).size !== value.venues.length) {
    errors.push(invalidField(`${path}.venues`, 'must be a list of unique venue refs'));
  }
  if (value.rateBudgets === undefined) errors.push(missingField(`${path}.rateBudgets`));
  else if (!Array.isArray(value.rateBudgets) || !value.rateBudgets.every((x) => isGrantRateBudget(x)) || new Set((value.rateBudgets as readonly { venue: unknown }[]).map((x) => x.venue)).size !== (value.rateBudgets as unknown[]).length) {
    errors.push(invalidField(`${path}.rateBudgets`, 'must be a list of per-venue rate budgets (one per venue, windowMs >= 1, maxOrders >= 0)'));
  }
  if (value.credentials === undefined) errors.push(missingField(`${path}.credentials`));
  else if (!Array.isArray(value.credentials) || !value.credentials.every((x) => isGrantCredentialBinding(x)) || new Set((value.credentials as readonly { venue: unknown }[]).map((x) => x.venue)).size !== (value.credentials as unknown[]).length) {
    errors.push(invalidField(`${path}.credentials`, "must be a list of per-venue opaque 'cred:'-prefixed credential bindings (one per venue)"));
  }
  const validity: unknown = value.validity;
  if (validity === undefined) errors.push(missingField(`${path}.validity`));
  else {
    const validityRecord = validity as Record<string, unknown>;
    const issuedAt: unknown = validityRecord.issuedAt;
    const expiresAt: unknown = validityRecord.expiresAt;
    if (!isRecord(validity) || !isTimestampMs(issuedAt) || !isTimestampMs(expiresAt) || (issuedAt as number) >= (expiresAt as number)) {
      errors.push(invalidField(`${path}.validity`, 'must be { issuedAt, expiresAt } epoch-ms instants with issuedAt < expiresAt (the window [issuedAt, expiresAt) — inclusive at issue, EXCLUSIVE at expiry)'));
    }
  }
  if (value.revocations === undefined) errors.push(missingField(`${path}.revocations`));
  else if (!Array.isArray(value.revocations) || !value.revocations.every((x) => isRevocationRecord(x))) {
    errors.push(invalidField(`${path}.revocations`, 'must be a list of revocation records { revokedAt, reason, revokedBy }'));
  }
  if (value.asOf === undefined) errors.push(missingField(`${path}.asOf`));
  else if (!isTimestampMs(value.asOf)) errors.push(invalidField(`${path}.asOf`, 'must be an epoch-ms instant (no ambient clock)'));

  // THE OPACITY TRIP WIRE (SECURITY.md's boundary, enforced in code): the
  // scan runs over the WHOLE untrusted tree — a credential VALUE anywhere
  // is the typed credential_value_present error, reported FIRST.
  const violations = credentialValueViolations(value);
  if (violations.length > 0) {
    return fail(
      'credential_value_present',
      `${path} embeds credential MATERIAL under credential-shaped key(s) ${violations.join(', ')} — this lane carries opaque 'cred:'-prefixed refs only, never values (spec/SECURITY.md: "Never commit provider credentials. Inject them through secure runtime boundaries.")`,
    );
  }

  if (errors.length > 0) return { ok: false, errors };

  // The version-chain law: supersedes must name a strictly earlier version.
  const supersedes = value.supersedes as GrantVersionRef | null;
  if (supersedes !== null && supersedes.version >= (value.version as number)) {
    return fail('invalid_field', `${path}.supersedes.version must be strictly less than ${path}.version (the version chain is monotone)`, `${path}.supersedes.version`);
  }

  const grant = value as unknown as AuthorityGrantRecord;
  // The content-address law: the id must match the content (a forged id is a malformed envelope).
  const expectedId = mintAuthorityGrantId(fnv1a32Hex(canonicalJson(grantContentTree(grant))));
  if (grant.grantId !== expectedId) {
    return fail('invalid_field', `${path}.grantId does not match the grant's content (expected ${expectedId}) — the id is content-addressed, a mismatch is a forged id`, `${path}.grantId`);
  }
  return ok(deepFreeze(grant));
}

/**
 * Mint a NEW authority grant from untrusted declaration content: the
 * grantId is content-addressed from the canonical content (the caller
 * does not supply it). Pure and deterministic — the same declared
 * content always yields the byte-identical grant (L9).
 */
export function mintAuthorityGrant(declaration: Omit<AuthorityGrantRecord, 'grantId'>): ExecutionAuthorityResult<AuthorityGrantRecord> {
  const violations = credentialValueViolations(declaration);
  if (violations.length > 0) {
    return fail(
      'credential_value_present',
      `the grant declaration embeds credential MATERIAL under credential-shaped key(s) ${violations.join(', ')} — this lane carries opaque 'cred:'-prefixed refs only, never values`,
    );
  }
  const grantId = mintAuthorityGrantId(fnv1a32Hex(canonicalJson(grantContentTree(declaration))));
  return validateAuthorityGrant({ ...declaration, grantId });
}

// ---------------------------------------------------------------------------
// The validity-window predicate (the declared [issuedAt, expiresAt) law)
// ---------------------------------------------------------------------------

/** The grant-status refusal — the typed record the window/revocation laws produce (a record, never an exception). */
export type GrantStatusRefusal =
  | { readonly kind: 'grant_not_yet_valid'; readonly grantId: string; readonly issuedAt: TimestampMs; readonly now: TimestampMs }
  | { readonly kind: 'grant_expired'; readonly grantId: string; readonly expiresAt: TimestampMs; readonly now: TimestampMs }
  | { readonly kind: 'grant_revoked'; readonly grantId: string; readonly revokedAt: TimestampMs; readonly reason: string };

/**
 * The validity-window + revocation predicate. DECLARED SEMANTICS: the
 * window is [issuedAt, expiresAt) — inclusive at issuance, EXCLUSIVE
 * at expiry (`now === expiresAt` is EXPIRED; `now === expiresAt - 1`
 * is valid; `now === issuedAt` is valid; `now === issuedAt - 1` is
 * not-yet-valid). A grant carrying ANY revocation record is revoked.
 * Returns the typed refusal record or null (valid).
 */
export function grantStatus(grant: AuthorityGrantRecord, now: TimestampMs): GrantStatusRefusal | null {
  const firstRevocation = grant.revocations.length === 0 ? null : (grant.revocations[0] as RevocationRecord);
  // Revocation dominates: a revoked grant is dead regardless of the window.
  if (firstRevocation !== null) {
    return { kind: 'grant_revoked', grantId: grant.grantId, revokedAt: firstRevocation.revokedAt, reason: firstRevocation.reason };
  }
  if (now < grant.validity.issuedAt) {
    return { kind: 'grant_not_yet_valid', grantId: grant.grantId, issuedAt: grant.validity.issuedAt, now };
  }
  if (now >= grant.validity.expiresAt) {
    return { kind: 'grant_expired', grantId: grant.grantId, expiresAt: grant.validity.expiresAt, now };
  }
  return null;
}
