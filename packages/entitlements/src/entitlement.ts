// @tradrl/entitlements — the ENTITLEMENT GRANT: the typed record of
// what a tenant is allowed to consume (Work Order T047).
//
// THE LAWS THIS MODULE SERVES:
// - R41 (spec/REQUIREMENTS.md "Usage accounting/entitlements"): an
//   entitlement is a typed ALLOWANCE, not a boolean — it names its
//   KIND (the closed vocabulary), its SCOPE (tenant + optional project
//   — L12), its TERMS (exact canonical decimals; never floats), its
//   commercial provenance (`sourceRef` — where the allowance came
//   from: a plan, a purchase, an operator grant) and its L4 validity
//   window (`effectiveFrom` .. `effectiveUntil`, explicit instants).
// - The kind law (closed vocabulary, one terms union member each):
//     - `spend-allowance` — money the tenant may spend in the
//       marketplace (currency + exact decimal amount; drawn down by
//       the ledger's consumption records);
//     - `api-quota` — how many requests of which route families the
//       tenant may make per rolling window (the R41 enforcement
//       dimension; MANDATORILY tenant-wide — the T041 usage facts
//       carry no project dimension, so a project-scoped quota could
//       never match them);
//     - `artifact-license` — the local-use right over ONE delivered
//       artifact (the marketplace settlement mints these; a licensed
//       artifact may be imported and composed locally — L18).
// - The versioning law (L3 discipline): grants are IMMUTABLE; a
//   changed allowance MINTS a new version that supersedes the prior
//   one (version + 1, chained id). The ledger retains the full
//   supersede history.
// - The window law (L4): `effectiveUntil` (when present) is STRICTLY
//   after `effectiveFrom`; `effectiveFrom` never predates `issuedAt`
//   (a grant never applies before it exists).
// - Determinism: content-addressed `eg:` ids over the grant's identity
//   content; clone-then-freeze (the minted record never aliases the
//   caller's draft — the untrusted-input purity law).

import { deepCloneJson, deepFreeze, isArrayOf, isCanonicalUnsignedDecimal, isMemberOf, isNonEmptyString, isNonNegativeInteger, isPositiveInteger, isRecord, isTimestampMs } from './primitives';
import type { JsonValue, TimestampMs } from './primitives';
import type { EntitlementError, EntitlementResult } from './errors';
import { fail, failures, invalidField, invalidType, missingField, ok } from './errors';
import type { ArtifactRef, EntitlementGrantId, ProjectId, TenantId } from './ids';
import { isArtifactRef, isEntitlementGrantId, isProjectId, isTenantId } from './ids';
import { deriveEntitlementGrantId } from './ids';
import type { RouteFamilyMirror } from './usage';
import { isRouteFamilyMirror, ROUTE_FAMILIES_MIRROR } from './usage';

// ---------------------------------------------------------------------------
// The closed kind vocabulary
// ---------------------------------------------------------------------------

/**
 * The closed entitlement-kind vocabulary — the three ways a tenant is
 * allowed to consume: money (marketplace spend), requests (API usage)
 * and rights (artifact licenses). A fourth member would be an
 * architecture change, not a data point.
 */
export const ENTITLEMENT_KINDS = ['spend-allowance', 'api-quota', 'artifact-license'] as const;

/** One entitlement kind. */
export type EntitlementKind = (typeof ENTITLEMENT_KINDS)[number];

/** Guard: `EntitlementKind`. */
export function isEntitlementKind(v: unknown): v is EntitlementKind {
  return isMemberOf(ENTITLEMENT_KINDS, v);
}

// ---------------------------------------------------------------------------
// The terms unions (one member per kind — exact, closed)
// ---------------------------------------------------------------------------

/**
 * `spend-allowance` terms: the currency (an identifier — the
 * marketplace's commercial vocabulary owns the referent, e.g.
 * `usd-cents`) and the EXACT decimal amount the tenant may spend
 * (canonical unsigned decimal string; drawn down to the cent by the
 * ledger's consumption records, never below zero).
 */
export interface SpendAllowanceTerms {
  readonly kind: 'spend-allowance';
  /** The spend currency (identifier pattern — one commercial vocabulary per program). */
  readonly currency: string;
  /** The allowance amount (canonical unsigned decimal — exact, never a float). */
  readonly amount: string;
}

/**
 * `api-quota` terms: which route families (members of the mirrored
 * T041 route vocabulary), how many requests (integer >= 0), per
 * rolling window of `windowMs` milliseconds (positive integer).
 */
export interface ApiQuotaTerms {
  readonly kind: 'api-quota';
  /** The covered route families; NON-EMPTY, unique, members of the mirrored T041 vocabulary. */
  readonly routeFamilies: readonly RouteFamilyMirror[];
  /** The maximum requests per window (integer >= 0). */
  readonly maxRequests: number;
  /** The rolling window length in ms (positive integer). */
  readonly windowMs: number;
}

/** The local-use scope of an artifact license. */
export const LICENSE_USAGE_SCOPES = ['project', 'tenant'] as const;

/** One local-use scope. */
export type LicenseUsageScope = (typeof LICENSE_USAGE_SCOPES)[number];

/** Guard: `LicenseUsageScope`. */
export function isLicenseUsageScope(v: unknown): v is LicenseUsageScope {
  return isMemberOf(LICENSE_USAGE_SCOPES, v);
}

/**
 * `artifact-license` terms: the local-use right over ONE delivered
 * artifact (`artifactRef` — the opaque reference the marketplace's
 * settlement mints and the L18 import path carries), scoped to ONE
 * project or the whole tenant.
 */
export interface ArtifactLicenseTerms {
  readonly kind: 'artifact-license';
  /** The licensed artifact (opaque ref — the marketplace settlement's referent). */
  readonly artifactRef: ArtifactRef;
  /** Where the artifact may be used: `project` (the grant's own projectId) or `tenant` (tenant-wide). */
  readonly usageScope: LicenseUsageScope;
}

/** The terms union — exactly one member per kind (the discriminator is the kind itself). */
export type EntitlementTerms = SpendAllowanceTerms | ApiQuotaTerms | ArtifactLicenseTerms;

// ---------------------------------------------------------------------------
// The entitlement grant (versioned, immutable)
// ---------------------------------------------------------------------------

/**
 * ONE entitlement grant: what a tenant is allowed to consume, under
 * which terms, from when until when, with the commercial provenance
 * and the L12 scope. Grants are content-addressed (`eg:` ids),
 * immutable and append-only — an amendment MINTS version + 1 (the
 * ledger keeps the supersede history; revocation is a ledger event,
 * never a record mutation).
 */
export interface EntitlementGrant {
  /** Grant identity (`eg:<digest>` — content-addressed over the grant content). */
  readonly grantId: EntitlementGrantId;
  /** Owning tenant (L12 — the gate every consumption must pass). */
  readonly tenantId: TenantId;
  /** Owning project, or `null` for a tenant-wide grant (L12 scope dimension). */
  readonly projectId: ProjectId | null;
  /** The allowance kind (the closed vocabulary). */
  readonly kind: EntitlementKind;
  /** The typed terms (exactly one union member, matching the kind). */
  readonly terms: EntitlementTerms;
  /** The grant's version within its supersede history (monotonic; 1 at the root). */
  readonly version: number;
  /** The grant this one supersedes, or `null` at the history root. */
  readonly supersedes: EntitlementGrantId | null;
  /** The commercial provenance — an opaque reference to where the allowance came from (a plan, a purchase, an operator grant). */
  readonly sourceRef: string;
  /** Explicit issuance instant (epoch ms — never a wall clock). */
  readonly issuedAt: TimestampMs;
  /** The instant the grant starts applying (never predates `issuedAt` — L4). */
  readonly effectiveFrom: TimestampMs;
  /** The instant the grant stops applying, or `null` for an open-ended grant. */
  readonly effectiveUntil: TimestampMs | null;
}

/** The grant draft — everything EXCEPT the derived identity. */
export interface EntitlementGrantDraft {
  readonly tenantId: string;
  readonly projectId: string | null;
  readonly kind: EntitlementKind;
  readonly terms: EntitlementTerms;
  readonly version: number;
  readonly supersedes: string | null;
  readonly sourceRef: string;
  readonly issuedAt: number;
  readonly effectiveFrom: number;
  readonly effectiveUntil: number | null;
}

/** Guard: `SpendAllowanceTerms`. */
export function isSpendAllowanceTerms(v: unknown): v is SpendAllowanceTerms {
  if (!isRecord(v)) return false;
  if (v.kind !== 'spend-allowance') return false;
  if (typeof v.currency !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(v.currency)) return false;
  if (!isCanonicalUnsignedDecimal(v.amount)) return false;
  return true;
}

/** Guard: `ApiQuotaTerms`. */
export function isApiQuotaTerms(v: unknown): v is ApiQuotaTerms {
  if (!isRecord(v)) return false;
  if (v.kind !== 'api-quota') return false;
  if (!Array.isArray(v.routeFamilies) || v.routeFamilies.length === 0) return false;
  if (!v.routeFamilies.every(isRouteFamilyMirror)) return false;
  if (new Set(v.routeFamilies).size !== v.routeFamilies.length) return false;
  if (!isNonNegativeInteger(v.maxRequests)) return false;
  if (!(typeof v.windowMs === 'number' && Number.isInteger(v.windowMs) && v.windowMs > 0)) return false;
  return true;
}

/** Guard: `ArtifactLicenseTerms`. */
export function isArtifactLicenseTerms(v: unknown): v is ArtifactLicenseTerms {
  if (!isRecord(v)) return false;
  if (v.kind !== 'artifact-license') return false;
  if (!isArtifactRef(v.artifactRef)) return false;
  if (!isLicenseUsageScope(v.usageScope)) return false;
  return true;
}

/** Guard: `EntitlementTerms` (the closed union). */
export function isEntitlementTerms(v: unknown): v is EntitlementTerms {
  return isSpendAllowanceTerms(v) || isApiQuotaTerms(v) || isArtifactLicenseTerms(v);
}

/** Guard: `EntitlementGrant` — structural totality. */
export function isEntitlementGrant(v: unknown): v is EntitlementGrant {
  if (!isRecord(v)) return false;
  if (!isEntitlementGrantId(v.grantId)) return false;
  if (!isTenantId(v.tenantId)) return false;
  if (v.projectId !== null && !isProjectId(v.projectId)) return false;
  if (!isEntitlementKind(v.kind)) return false;
  if (!isEntitlementTerms(v.terms) || v.terms.kind !== v.kind) return false;
  if (!isPositiveInteger(v.version)) return false;
  if (v.supersedes !== null && !isEntitlementGrantId(v.supersedes)) return false;
  if (!isNonEmptyString(v.sourceRef)) return false;
  if (!isTimestampMs(v.issuedAt) || !isTimestampMs(v.effectiveFrom)) return false;
  if (v.effectiveUntil !== null && !isTimestampMs(v.effectiveUntil)) return false;
  // The versioning law: version 1 is the history root; every later version supersedes.
  if (v.version === 1 && v.supersedes !== null) return false;
  if (v.version > 1 && v.supersedes === null) return false;
  // The window law (L4): the window is non-empty and starts no earlier than issuance.
  if (v.effectiveFrom < v.issuedAt) return false;
  if (v.effectiveUntil !== null && v.effectiveUntil <= v.effectiveFrom) return false;
  // The scope law: api-quota grants are MANDATORILY tenant-wide (usage
  // facts carry no project dimension); project-scoped licenses name
  // their project; tenant-scoped licenses are tenant-wide.
  if (v.kind === 'api-quota' && v.projectId !== null) return false;
  if (v.kind === 'artifact-license') {
    const terms = v.terms as ArtifactLicenseTerms;
    if (terms.usageScope === 'project' && v.projectId === null) return false;
    if (terms.usageScope === 'tenant' && v.projectId !== null) return false;
  }
  return true;
}

/**
 * Collect-all validation of an untrusted entitlement grant against the
 * FULL law, minting the content-addressed identity. The money law:
 * amounts are canonical decimal STRINGS (a number, a comma decimal, a
 * leading zero or `-0` is the typed `invalid_decimal` — never coerced).
 */
export function validateEntitlementGrant(v: unknown, path = 'grant'): EntitlementResult<EntitlementGrant> {
  if (!isRecord(v)) {
    return { ok: false, errors: [invalidType(path, `${path} must be an object`)] };
  }
  const errors: EntitlementError[] = [];

  if (v.tenantId === undefined) errors.push({ code: 'tenant_missing', path: `${path}.tenantId`, message: 'every entitlement grant carries its owning tenant (L12)' });
  else if (!isTenantId(v.tenantId)) errors.push(invalidField(`${path}.tenantId`, 'invalid TenantId (opaque non-empty)'));
  if (v.projectId === undefined) errors.push(missingField(`${path}.projectId`));
  else if (v.projectId !== null && !isProjectId(v.projectId)) errors.push(invalidField(`${path}.projectId`, 'invalid ProjectId (or null for a tenant-wide grant)'));
  if (v.kind === undefined) errors.push(missingField(`${path}.kind`));
  else if (!isEntitlementKind(v.kind)) errors.push(invalidField(`${path}.kind`, `must be one of ${ENTITLEMENT_KINDS.join(' | ')} (the closed vocabulary)`));
  if (v.terms === undefined) errors.push(missingField(`${path}.terms`));
  else if (isRecord(v.terms)) {
    const kind = v.kind;
    const termsPath = `${path}.terms`;
    if (kind === 'spend-allowance') {
      if (v.terms.kind === undefined) errors.push(missingField(`${termsPath}.kind`));
      else if (v.terms.kind !== 'spend-allowance') errors.push(invalidField(`${termsPath}.kind`, `the discriminator must be "spend-allowance" (the grant's kind)`));
      if (v.terms.currency === undefined) errors.push(missingField(`${termsPath}.currency`));
      else if (typeof v.terms.currency !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(v.terms.currency)) {
        errors.push(invalidField(`${termsPath}.currency`, 'invalid currency (identifier pattern — one commercial vocabulary per program)'));
      }
      if (v.terms.amount === undefined) errors.push(missingField(`${termsPath}.amount`));
      else if (!isCanonicalUnsignedDecimal(v.terms.amount)) {
        errors.push({ code: 'invalid_decimal', path: `${termsPath}.amount`, message: `the amount must be a canonical unsigned decimal string (got ${JSON.stringify(v.terms.amount)}) — money is exact, never a float` });
      }
    } else if (kind === 'api-quota') {
      if (v.terms.kind === undefined) errors.push(missingField(`${termsPath}.kind`));
      else if (v.terms.kind !== 'api-quota') errors.push(invalidField(`${termsPath}.kind`, 'the discriminator must be "api-quota" (the grant\'s kind)'));
      if (v.terms.routeFamilies === undefined) errors.push(missingField(`${termsPath}.routeFamilies`));
      else if (!Array.isArray(v.terms.routeFamilies) || v.terms.routeFamilies.length === 0 || !v.terms.routeFamilies.every(isRouteFamilyMirror) || new Set(v.terms.routeFamilies).size !== v.terms.routeFamilies.length) {
        errors.push(invalidField(`${termsPath}.routeFamilies`, `must be a non-empty duplicate-free array over the mirrored T041 route-family vocabulary (${ROUTE_FAMILIES_MIRROR.join(' | ')})`));
      }
      if (v.terms.maxRequests === undefined) errors.push(missingField(`${termsPath}.maxRequests`));
      else if (!isNonNegativeInteger(v.terms.maxRequests)) errors.push(invalidField(`${termsPath}.maxRequests`, 'must be a non-negative integer (request counts are integers)'));
      if (v.terms.windowMs === undefined) errors.push(missingField(`${termsPath}.windowMs`));
      else if (!(typeof v.terms.windowMs === 'number' && Number.isInteger(v.terms.windowMs) && v.terms.windowMs > 0)) {
        errors.push(invalidField(`${termsPath}.windowMs`, 'must be a positive integer (the rolling window length in ms)'));
      }
    } else if (kind === 'artifact-license') {
      if (v.terms.kind === undefined) errors.push(missingField(`${termsPath}.kind`));
      else if (v.terms.kind !== 'artifact-license') errors.push(invalidField(`${termsPath}.kind`, 'the discriminator must be "artifact-license" (the grant\'s kind)'));
      if (v.terms.artifactRef === undefined) errors.push(missingField(`${termsPath}.artifactRef`));
      else if (!isArtifactRef(v.terms.artifactRef)) errors.push(invalidField(`${termsPath}.artifactRef`, 'invalid artifact ref (opaque non-space bounded, <= 1024 chars, no control characters)'));
      if (v.terms.usageScope === undefined) errors.push(missingField(`${termsPath}.usageScope`));
      else if (!isLicenseUsageScope(v.terms.usageScope)) errors.push(invalidField(`${termsPath}.usageScope`, `must be one of ${LICENSE_USAGE_SCOPES.join(' | ')}`));
    } else {
      errors.push(invalidField(termsPath, 'the terms failed the closed union (spend-allowance | api-quota | artifact-license — matching the grant\'s kind)'));
    }
  } else {
    errors.push(invalidField(`${path}.terms`, 'the terms must be an object (the closed union, one member per kind)'));
  }
  if (v.version === undefined) errors.push(missingField(`${path}.version`));
  else if (!isPositiveInteger(v.version)) errors.push(invalidField(`${path}.version`, 'must be a positive integer (monotonic within the supersede history)'));
  if (v.supersedes === undefined) errors.push(missingField(`${path}.supersedes`));
  else if (v.supersedes !== null && !isEntitlementGrantId(v.supersedes)) errors.push(invalidField(`${path}.supersedes`, 'invalid EntitlementGrantId (or null at the history root)'));
  if (v.sourceRef === undefined) errors.push(missingField(`${path}.sourceRef`));
  else if (!isNonEmptyString(v.sourceRef)) errors.push(invalidField(`${path}.sourceRef`, 'must be a non-empty provenance reference (where the allowance came from)'));
  if (v.issuedAt === undefined) errors.push(missingField(`${path}.issuedAt`));
  else if (!isTimestampMs(v.issuedAt)) errors.push(invalidField(`${path}.issuedAt`, 'invalid TimestampMs (explicit instant — never a wall clock)'));
  if (v.effectiveFrom === undefined) errors.push(missingField(`${path}.effectiveFrom`));
  else if (!isTimestampMs(v.effectiveFrom)) errors.push(invalidField(`${path}.effectiveFrom`, 'invalid TimestampMs (the window start)'));
  if (v.effectiveUntil === undefined) errors.push(missingField(`${path}.effectiveUntil`));
  else if (v.effectiveUntil !== null && !isTimestampMs(v.effectiveUntil)) errors.push(invalidField(`${path}.effectiveUntil`, 'invalid TimestampMs (the window end, or null for open-ended)'));

  // The versioning law.
  if (isPositiveInteger(v.version) && ((v.version === 1 && v.supersedes !== null) || (v.version > 1 && v.supersedes === null))) {
    errors.push(invalidField(`${path}.version`, `version 1 is the history root (supersedes null); version ${v.version ?? '?'} must supersede the prior grant`));
  }
  // The window law (L4).
  if (isTimestampMs(v.effectiveFrom) && isTimestampMs(v.issuedAt) && v.effectiveFrom < v.issuedAt) {
    errors.push({ code: 'l4_boundary_violation', path: `${path}.effectiveFrom`, message: `the effective-from instant (${v.effectiveFrom}) predates the issuance instant (${v.issuedAt}) — a grant never applies before it exists` });
  }
  if (v.effectiveUntil !== null && isTimestampMs(v.effectiveUntil) && isTimestampMs(v.effectiveFrom) && v.effectiveUntil <= v.effectiveFrom) {
    errors.push({ code: 'l4_boundary_violation', path: `${path}.effectiveUntil`, message: `the effective-until instant (${v.effectiveUntil}) is not after the effective-from instant (${v.effectiveFrom}) — an empty window grants nothing` });
  }
  // The scope law.
  if (v.kind === 'api-quota' && v.projectId !== null && v.projectId !== undefined) {
    errors.push(invalidField(`${path}.projectId`, 'an api-quota grant is MANDATORILY tenant-wide (projectId null) — the T041 usage facts carry no project dimension, so a project-scoped quota could never match them'));
  }
  if (v.kind === 'artifact-license' && isRecord(v.terms) && isLicenseUsageScope(v.terms.usageScope) && isTimestampMs(v.issuedAt)) {
    if (v.terms.usageScope === 'project' && (v.projectId === null || v.projectId === undefined)) {
      errors.push(invalidField(`${path}.projectId`, 'a project-scoped artifact license names its project (projectId is required)'));
    }
    if (v.terms.usageScope === 'tenant' && v.projectId !== null) {
      errors.push(invalidField(`${path}.projectId`, 'a tenant-scoped artifact license is tenant-wide (projectId must be null)'));
    }
  }

  if (errors.length > 0) return failures(errors);
  const draft = v as unknown as EntitlementGrantDraft;
  const identityContent = grantIdentityContent(draft);
  // Clone-then-freeze: the minted record NEVER aliases the caller's
  // draft (freezing untrusted input in place would be an observable
  // side effect — the pure-data law; the sibling lanes discipline the
  // same way).
  const grant: EntitlementGrant = deepFreeze(deepCloneJson({
    grantId: deriveEntitlementGrantId(identityContent),
    tenantId: draft.tenantId,
    projectId: draft.projectId,
    kind: draft.kind,
    terms: draft.terms,
    version: draft.version,
    supersedes: draft.supersedes,
    sourceRef: draft.sourceRef,
    issuedAt: draft.issuedAt,
    effectiveFrom: draft.effectiveFrom,
    effectiveUntil: draft.effectiveUntil,
  } as unknown as JsonValue) as unknown as EntitlementGrant);
  if (!isEntitlementGrant(grant)) {
    return fail('invalid_field', 'the minted grant failed its own structural guard', path);
  }
  return ok(grant);
}

/**
 * The identity content of a grant — everything EXCEPT the derived id
 * (the content-addressed mint input; byte-deterministic).
 */
export function grantIdentityContent(draft: EntitlementGrantDraft): Record<string, unknown> {
  return {
    tenantId: draft.tenantId,
    projectId: draft.projectId,
    kind: draft.kind,
    terms: draft.terms,
    version: draft.version,
    supersedes: draft.supersedes,
    sourceRef: draft.sourceRef,
    issuedAt: draft.issuedAt,
    effectiveFrom: draft.effectiveFrom,
    effectiveUntil: draft.effectiveUntil,
  };
}

/**
 * Constructs a deeply frozen `EntitlementGrant`, running the FULL
 * validation law first (collect-all). Throws `TypeError` on invalid
 * input. This is the ONLY sanctioned constructor for grant records.
 */
export function createEntitlementGrant(draft: unknown): EntitlementGrant {
  const result = validateEntitlementGrant(draft);
  if (!result.ok) {
    const problems = result.errors.map((e) => `(${e.code}) ${e.path}: ${e.message}`);
    throw new TypeError(`createEntitlementGrant: ${problems.join('; ')}`);
  }
  return result.value;
}

/**
 * The supersede law: mints the NEXT grant version over a prior one —
 * version + 1, supersedes = the prior id, same tenant and kind (a
 * grant's kind is its identity — changing it is a NEW grant, not an
 * amendment), the amendment instant not predating the prior issuance
 * (L4). Pure: never touches the prior record (L3 — grants are
 * immutable; amendments MINT).
 */
export function amendEntitlementGrant(
  prior: EntitlementGrant,
  next: {
    readonly projectId: string | null;
    readonly terms: EntitlementTerms;
    readonly sourceRef: string;
    readonly issuedAt: number;
    readonly effectiveFrom: number;
    readonly effectiveUntil: number | null;
  },
): EntitlementResult<EntitlementGrant> {
  if (!isEntitlementGrant(prior)) return fail('invalid_type', 'the prior grant is not a valid EntitlementGrant', 'prior');
  if (next.terms.kind !== prior.kind) {
    return fail('kind_change_forbidden', `an amendment keeps the grant's kind (${prior.kind}) — a changed kind is a NEW grant, not an amendment (the kind is the allowance's identity)`, 'next.terms');
  }
  if (next.issuedAt < prior.issuedAt) {
    return fail('l4_boundary_violation', `the amendment instant (${next.issuedAt}) predates the prior grant's issuance (${prior.issuedAt}) — history never runs backwards`, 'next.issuedAt');
  }
  return validateEntitlementGrant({
    tenantId: prior.tenantId,
    projectId: next.projectId,
    kind: prior.kind,
    terms: next.terms,
    version: prior.version + 1,
    supersedes: prior.grantId,
    sourceRef: next.sourceRef,
    issuedAt: next.issuedAt,
    effectiveFrom: next.effectiveFrom,
    effectiveUntil: next.effectiveUntil,
  });
}

// ---------------------------------------------------------------------------
// The point-in-time window status (L4)
// ---------------------------------------------------------------------------

/** The grant's window status at instant `at` (revocation is a ledger event, not a window state). */
export type GrantWindowStatus = 'not-yet-effective' | 'active' | 'expired';

/**
 * The pure L4 fold: where does `at` fall in the grant's validity
 * window? `not-yet-effective` before `effectiveFrom`, `active` inside
 * `[effectiveFrom, effectiveUntil)`, `expired` from `effectiveUntil`
 * on (an open-ended grant never expires).
 */
export function grantWindowStatus(grant: EntitlementGrant, at: TimestampMs): GrantWindowStatus {
  if (at < grant.effectiveFrom) return 'not-yet-effective';
  if (grant.effectiveUntil !== null && at >= grant.effectiveUntil) return 'expired';
  return 'active';
}
