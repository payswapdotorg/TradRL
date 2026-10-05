// @tradrl/entitlements — the T041 USAGE MIRRORS + the R41 ENFORCEMENT.
//
// THE LAWS THIS MODULE SERVES:
// - R41 (spec/REQUIREMENTS.md "Usage accounting/entitlements"): the
//   public/private API boundary (Work Order T041) RECORDS usage —
//   "per-tenant per-route usage records emitted on every request (R41
//   hooks — the fact surface T047's entitlements later enforces;
//   record only, no enforcement)". THIS lane is that enforcement: the
//   usage-record mirror (field-for-field with services/api's
//   `UsageRecord`) plus the route-family vocabulary mirror, and the
//   pure allowance fold that decides whether ONE MORE request is
//   within the tenant's covering api-quota grants.
// - L4 (point-in-time): the decision is taken AT an explicit instant
//   against the usage that lies within the quota window ending at
//   that instant — never a wall clock, never future usage.
// - L12: usage facts are tenant-scoped; a quota decision for one
//   tenant never counts another tenant's usage.
// - L20 (safety is code): the verdict is a typed record —
//   `{ allowed: true }` or `{ allowed: false, code: 'usage_denied' }`
//   with the exact numbers that grounded it — never a prompt, never a
//   stringly-typed refusal.
// - Determinism: identical grants + usage + candidate produce the
//   identical verdict (byte-stable under canonical serialization).
//
// D-003/D-004: this module MIRRORS the T041 shapes; it imports none of
// them. src/interop.test.ts loads the REAL services/api metering +
// contracts and pins every mirror member-for-member, plus drives the
// REAL `UsageLedger` end-to-end through this lane's enforcement fold.

import { isNonEmptyString, isNonNegativeInteger, isRecord, isTimestampMs } from './primitives';
import { isMemberOf } from './primitives';
import { isTenantId } from './ids';

// ---------------------------------------------------------------------------
// The T041 route-family vocabulary (the quota scope dimension)
// ---------------------------------------------------------------------------

/**
 * The public route families — mirror of services/api's
 * `PUBLIC_ROUTE_FAMILIES` (the authz dimension of the boundary's route
 * table; the quota scope names members of THIS vocabulary).
 */
export const PUBLIC_ROUTE_FAMILIES_MIRROR = [
  'meta:read',
  'projects:read',
  'projects:write',
  'knowledge:read',
  'outcomes:read',
  'jobs:read',
  'jobs:write',
  'execution:write',
  'organizations:read',
] as const;

/** One public route family (mirror). */
export type PublicRouteFamilyMirror = (typeof PUBLIC_ROUTE_FAMILIES_MIRROR)[number];

/**
 * The private route families — mirror of services/api's
 * `PRIVATE_ROUTE_FAMILIES` (the internal services' permission
 * vocabulary).
 */
export const PRIVATE_ROUTE_FAMILIES_MIRROR = [
  'internal:organizations:write',
  'internal:jobs:write',
  'internal:usage:read',
] as const;

/** One private route family (mirror). */
export type PrivateRouteFamilyMirror = (typeof PRIVATE_ROUTE_FAMILIES_MIRROR)[number];

/** One route family of either plane (mirror). */
export type RouteFamilyMirror = PublicRouteFamilyMirror | PrivateRouteFamilyMirror;

/** The whole route-family vocabulary (public + private, canonical order — the mirror of `RouteFamily`). */
export const ROUTE_FAMILIES_MIRROR: readonly RouteFamilyMirror[] = Object.freeze([
  ...PUBLIC_ROUTE_FAMILIES_MIRROR,
  ...PRIVATE_ROUTE_FAMILIES_MIRROR,
]);

/** Guard: one public route family (mirror). */
export function isPublicRouteFamilyMirror(v: unknown): v is PublicRouteFamilyMirror {
  return isMemberOf(PUBLIC_ROUTE_FAMILIES_MIRROR, v);
}

/** Guard: one private route family (mirror). */
export function isPrivateRouteFamilyMirror(v: unknown): v is PrivateRouteFamilyMirror {
  return isMemberOf(PRIVATE_ROUTE_FAMILIES_MIRROR, v);
}

/** Guard: one route family of either plane (mirror). */
export function isRouteFamilyMirror(v: unknown): v is RouteFamilyMirror {
  return isPublicRouteFamilyMirror(v) || isPrivateRouteFamilyMirror(v);
}

// ---------------------------------------------------------------------------
// The usage-record mirror (the R41 fact surface)
// ---------------------------------------------------------------------------

/** Usage-record identity grammar — mirror of the api boundary's `usu:` + 8-hex id shape. */
export const USAGE_ID_PATTERN_MIRROR = /^usu:[0-9a-f]{8}$/;

/**
 * One per-tenant per-route usage record — STRUCTURAL MIRROR of
 * services/api's `UsageRecord` (field-for-field; the scope/instant
 * members are PLAIN primitives, exactly like the T045 JobRecord
 * mirror — the REAL record's branded members are assignable to them,
 * so the compile-time witness in interop.test.ts holds): the R41 fact
 * surface this lane enforces. The record is an immutable FACT: it
 * never gates anything by itself; only the fold below turns facts
 * into verdicts.
 */
export interface UsageRecordMirror {
  /** Content-addressed identity: `usu:` + 8-hex digest (the api boundary's grammar). */
  readonly usageId: string;
  /** The acting tenant (the boundary's injected tenant context — L12). */
  readonly tenant: string;
  /** The acting credential's id (the WHO of the usage fact). */
  readonly credentialId: string;
  /** The route family (the per-route dimension — a member of the mirrored vocabulary). */
  readonly route: string;
  /** The request's method and path (the observable dimension — no payload data, ever). */
  readonly method: string;
  readonly path: string;
  /** The response status (success and failure both metered). */
  readonly status: number;
  /** The request's injected instant. */
  readonly at: number;
}

/** Guard: `UsageRecordMirror` (the R41 fact surface's shape). */
export function isUsageRecordMirror(v: unknown): v is UsageRecordMirror {
  if (!isRecord(v)) return false;
  if (typeof v.usageId !== 'string' || !USAGE_ID_PATTERN_MIRROR.test(v.usageId)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isNonEmptyString(v.credentialId)) return false;
  if (!isNonEmptyString(v.route)) return false;
  if (!isNonEmptyString(v.method) || !isNonEmptyString(v.path)) return false;
  if (!isNonNegativeInteger(v.status)) return false;
  if (!isTimestampMs(v.at)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The T041 SDK error-family vocabulary (the boundary projection)
// ---------------------------------------------------------------------------

/** The SDK error families — mirror of the SDK's `SDK_ERROR_FAMILIES` (the boundary projection vocabulary). */
export const SDK_ERROR_FAMILIES_MIRROR = [
  'auth',
  'permission',
  'tenant',
  'rate-limit',
  'validation',
  'conflict',
  'unavailable',
  'not-found',
  'version',
] as const;

/** One SDK error family (mirror). */
export type SdkErrorFamilyMirror = (typeof SDK_ERROR_FAMILIES_MIRROR)[number];

/** Guard: `SdkErrorFamilyMirror`. */
export function isSdkErrorFamilyMirror(v: unknown): v is SdkErrorFamilyMirror {
  return isMemberOf(SDK_ERROR_FAMILIES_MIRROR, v);
}

// ---------------------------------------------------------------------------
// The R41 enforcement fold (the pure allowance decision)
// ---------------------------------------------------------------------------

/**
 * The window count: how many of `usage` — records of ONE tenant — fall
 * in the half-open window `(at - windowMs, at]` and match `route`
 * against the given route-family scope. Pure, order-independent
 * (counting does not depend on record order), L12 by construction
 * (only `tenant`'s records are counted).
 */
export function usageWindowCount(
  usage: readonly UsageRecordMirror[],
  tenant: string,
  route: string,
  routeScope: readonly string[],
  at: number,
  windowMs: number,
): number {
  let count = 0;
  for (const record of usage) {
    if (record.tenant !== tenant) continue; // L12: another tenant's facts never count
    if (record.route !== route) continue;
    if (!routeScope.includes(record.route)) continue;
    if (record.at > at) continue; // L4: the future never counts
    if (record.at <= at - windowMs) continue; // the window's lower bound (exclusive)
    count += 1;
  }
  return count;
}

/** One covering quota grant the enforcement fold evaluates (the api-quota terms the ledger derived). */
export interface QuotaGrantView {
  /** The grant's identity (for the verdict's evidence). */
  readonly grantId: string;
  /** The route families this grant covers (members of the mirrored vocabulary). */
  readonly routeFamilies: readonly string[];
  /** The window length in ms (the rolling window ending at the decision instant). */
  readonly windowMs: number;
  /** The maximum requests allowed within the window (integer >= 0 — `0` grants nothing, it records the denial). */
  readonly maxRequests: number;
}

/**
 * The R41 ENFORCEMENT VERDICT: is ONE MORE request of route family
 * `route`, for `tenant`, at instant `at`, within at least ONE covering
 * quota grant? The fold evaluates every grant independently and
 * deterministically in the given order; the FIRST grant with headroom
 * grounds an `allowed` verdict (its numbers are the evidence); when
 * every covering grant is exhausted the verdict is the typed
 * `usage_denied` carrying the tightest covering grant's numbers (the
 * grant with the smallest remaining headroom — deterministic).
 *
 * The candidate request itself is NOT yet a usage record: the boundary
 * records the fact AFTER the response is decided (the metering law);
 * this fold answers "would recording one more fact exceed the quota?".
 */
export interface UsageQuotaVerdict {
  readonly allowed: boolean;
  /** The covering grant that grounded the verdict (absent when no grant covers the route at all). */
  readonly grantId: string | null;
  /** The usage facts already counted inside the grounding grant's window. */
  readonly counted: number;
  /** The grounding grant's maximum (absent when no covering grant exists). */
  readonly maxRequests: number | null;
  /** The denial code — exactly `usage_denied` when `allowed` is false. */
  readonly code: 'usage_denied' | null;
}

/**
 * The R41 allowance decision (pure): `allowed` iff at least one
 * covering grant has `counted < maxRequests` at the decision instant.
 * A route covered by NO grant is DENIED (closed-world: nothing is
 * consumable without an entitlement — L20 enforcement is code).
 */
export function usageQuotaDecision(
  usage: readonly UsageRecordMirror[],
  grants: readonly QuotaGrantView[],
  input: { readonly tenant: string; readonly route: string; readonly at: number },
): UsageQuotaVerdict {
  const covering = grants.filter((grant) => grant.routeFamilies.includes(input.route));
  if (covering.length === 0) {
    return { allowed: false, grantId: null, counted: 0, maxRequests: null, code: 'usage_denied' };
  }
  let tightest: { readonly view: QuotaGrantView; readonly counted: number } | undefined = undefined;
  for (const grant of covering) {
    const counted = usageWindowCount(usage, input.tenant, input.route, grant.routeFamilies, input.at, grant.windowMs);
    if (counted < grant.maxRequests) {
      return { allowed: true, grantId: grant.grantId, counted, maxRequests: grant.maxRequests, code: null };
    }
    const headroom = grant.maxRequests - counted;
    const currentHeadroom = tightest === undefined ? Number.POSITIVE_INFINITY : tightest.view.maxRequests - tightest.counted;
    if (headroom < currentHeadroom) {
      tightest = { view: grant, counted };
    }
  }
  const denied = tightest as { readonly view: QuotaGrantView; readonly counted: number };
  return { allowed: false, grantId: denied.view.grantId, counted: denied.counted, maxRequests: denied.view.maxRequests, code: 'usage_denied' };
}
