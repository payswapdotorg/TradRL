// @tradrl/control-domain — branded identity references (T007 id discipline).
//
// Id discipline (mirroring @tradrl/domain-core/src/ids.ts):
// - Every id is an opaque non-empty string at runtime; branding is a
//   compile-time nominal tag so distinct identity spaces are not
//   interchangeable.
// - EXACT MIRRORS reuse the domain-core brand string so the identity space is
//   shared and the types stay mutually assignable:
//     * `ProjectId`  — domain-core's Project lineage root (Decision, Outcome,
//       Lesson records carry this id; the control plane materializes the
//       durable ProjectRecord for the same entity).
//     * `TenantId`   — tenant identity, isolation semantics owned by T044.
//     * `ConstraintSetId` — domain-core's versioned constraint set identity
//       (the inner id of `ConstraintSetRef`).
// - OPAQUE cross-lane references use this package's own brand names (the
//   agent-body `*Ref` pattern): `GoalRef` (goal statements are authored in the
//   control plane; agent-body already reserves a same-named opaque ref) and
//   `OrganizationRef` (organizations are compiled by T016 / recorded by T002 —
//   the control plane only holds the reference).
// - `AcceptanceCriteriaId` is OWNED by T007. It has a canonical, deterministic
//   form (see {@link acceptanceCriteriaId}) so the compiled artifact for a
//   given (goal version, constraint set version) pair always has the same id.

import { Brand, isNonEmptyString, isPositiveInteger } from './primitives';

// --- Exact mirrors of domain-core identity spaces ---------------------------

/** Project identity — exact mirror of domain-core `ProjectId`. */
export type ProjectId = Brand<string, 'ProjectId'>;

/** Tenant (customer firm) identity — exact mirror of domain-core `TenantId`. */
export type TenantId = Brand<string, 'TenantId'>;

/** Constraint set identity — exact mirror of domain-core `ConstraintSetId`. */
export type ConstraintSetId = Brand<string, 'ConstraintSetId'>;

// --- Opaque cross-lane references (own brands) -------------------------------

/** Goal statement identity (authored in the control plane; opaque string). */
export type GoalRef = Brand<string, 'GoalRef'>;

/** Organization reference (referent owned by T016/T002; opaque string). */
export type OrganizationRef = Brand<string, 'OrganizationRef'>;

// --- Owned identity: the compiled acceptance criteria ------------------------

/** Compiled acceptance criteria identity — owned by T007, canonical form below. */
export type AcceptanceCriteriaId = Brand<string, 'AcceptanceCriteriaId'>;

/** Prefix of the canonical AcceptanceCriteriaId form. */
export const ACCEPTANCE_CRITERIA_ID_PREFIX = 'ac';

// ---------------------------------------------------------------------------
// Guards (ids are opaque strings: the runtime check is shared)
// ---------------------------------------------------------------------------

export const isProjectId = (v: unknown): v is ProjectId => isNonEmptyString(v);
export const isTenantId = (v: unknown): v is TenantId => isNonEmptyString(v);
export const isConstraintSetId = (v: unknown): v is ConstraintSetId => isNonEmptyString(v);
export const isGoalRef = (v: unknown): v is GoalRef => isNonEmptyString(v);
export const isOrganizationRef = (v: unknown): v is OrganizationRef => isNonEmptyString(v);

// ---------------------------------------------------------------------------
// AcceptanceCriteriaId — canonical deterministic form
// ---------------------------------------------------------------------------

/**
 * Canonical, unambiguous, length-prefixed encoding:
 *
 *   ac:{goalIdLen}:{goalId}:{goalVersion}:{setIdLen}:{setId}:{setVersion}
 *
 * Length prefixes make the form parsable even when goal or set ids contain
 * the ':' delimiter (opaque ids are arbitrary non-empty strings). The form is
 * DETERMINISTIC: compiling the same (goal, constraint set) pair always
 * produces the same id — the compiled artifact is derived data, and its
 * identity is derived with it (no ambient counters, no randomness).
 */
export function acceptanceCriteriaId(
  goalId: GoalRef,
  goalVersion: number,
  constraintSetId: ConstraintSetId,
  constraintSetVersion: number,
): AcceptanceCriteriaId {
  const problems: string[] = [];
  if (!isGoalRef(goalId)) problems.push('goalId: invalid GoalRef');
  if (!isConstraintSetId(constraintSetId)) problems.push('constraintSetId: invalid ConstraintSetId');
  if (!isPositiveInteger(goalVersion)) problems.push(`goalVersion: expected an integer >= 1, got ${goalVersion}`);
  if (!isPositiveInteger(constraintSetVersion)) {
    problems.push(`constraintSetVersion: expected an integer >= 1, got ${constraintSetVersion}`);
  }
  if (problems.length > 0) {
    throw new TypeError(`acceptanceCriteriaId: ${problems.join('; ')}`);
  }
  const id = `${ACCEPTANCE_CRITERIA_ID_PREFIX}:${goalId.length}:${goalId}:${goalVersion}:${constraintSetId.length}:${constraintSetId}:${constraintSetVersion}`;
  const parsed = parseAcceptanceCriteriaId(id);
  if (parsed === null) {
    // Unreachable when the argument guards hold; kept fail-closed (L20).
    throw new TypeError('acceptanceCriteriaId: components did not round-trip');
  }
  return id as AcceptanceCriteriaId;
}

/** Components recovered from a canonical {@link AcceptanceCriteriaId}. */
export interface AcceptanceCriteriaIdParts {
  readonly goalId: GoalRef;
  readonly goalVersion: number;
  readonly constraintSetId: ConstraintSetId;
  readonly constraintSetVersion: number;
}

/**
 * Parses a canonical {@link AcceptanceCriteriaId} back into its lineage
 * components. Returns `null` for any malformed input — this is also the
 * strictness behind {@link isAcceptanceCriteriaId} (an AcceptanceCriteriaId is
 * valid iff it is a canonical form, so lineage is always recoverable, L15).
 */
export function parseAcceptanceCriteriaId(v: unknown): AcceptanceCriteriaIdParts | null {
  if (typeof v !== 'string') return null;
  let rest: string = v;
  // Prefix.
  if (!rest.startsWith(`${ACCEPTANCE_CRITERIA_ID_PREFIX}:`)) return null;
  rest = rest.slice(ACCEPTANCE_CRITERIA_ID_PREFIX.length + 1);
  // goalId (length-prefixed).
  const goal = readLengthPrefixed(rest);
  if (goal === null) return null;
  const goalId = goal.value;
  rest = goal.rest;
  // goalVersion.
  const goalVersion = readDecimalField(rest);
  if (goalVersion === null) return null;
  rest = goalVersion.rest;
  // setId (length-prefixed).
  const set = readLengthPrefixed(rest);
  if (set === null) return null;
  const constraintSetId = set.value;
  rest = set.rest;
  // setVersion (must consume the remainder).
  const setVersion = readDecimalField(rest);
  if (setVersion === null || setVersion.rest !== '') return null;
  return {
    goalId: goalId as GoalRef,
    goalVersion: goalVersion.value,
    constraintSetId: constraintSetId as ConstraintSetId,
    constraintSetVersion: setVersion.value,
  };
}

/** Guard: a canonical AcceptanceCriteriaId (parses back to valid components). */
export function isAcceptanceCriteriaId(v: unknown): v is AcceptanceCriteriaId {
  const parts = parseAcceptanceCriteriaId(v);
  return parts !== null && isPositiveInteger(parts.goalVersion) && isPositiveInteger(parts.constraintSetVersion);
}

/**
 * Reads `{length}:{value}` from the head of `s` (skipping one leading `:`
 * separator when present). Returns the value and the remainder (with its
 * leading separator intact for the next reader).
 */
function readLengthPrefixed(s: string): { value: string; rest: string } | null {
  const body = s.startsWith(':') ? s.slice(1) : s;
  const colon = body.indexOf(':');
  if (colon <= 0) return null;
  const lengthDigits = body.slice(0, colon);
  // Canonical form: no leading zeros, at least one digit (length 0 is invalid — ids are non-empty).
  if (!/^[1-9]\d*$/.test(lengthDigits)) return null;
  const length = Number(lengthDigits);
  // Guard against absurd lengths (DoS-hardening for untrusted ids).
  if (length > 1_000_000) return null;
  const value = body.slice(colon + 1, colon + 1 + length);
  if (value.length !== length) return null;
  return { value, rest: body.slice(colon + 1 + length) };
}

/**
 * Reads a decimal field (integer >= 1, no leading zeros) up to the next `:`
 * or the end (skipping one leading `:` separator when present). Returns its
 * value and the remainder (with its leading separator intact).
 */
function readDecimalField(s: string): { value: number; rest: string } | null {
  const body = s.startsWith(':') ? s.slice(1) : s;
  const colon = body.indexOf(':');
  const digits = colon === -1 ? body : body.slice(0, colon);
  if (!/^[1-9]\d*$/.test(digits)) return null;
  return { value: Number(digits), rest: colon === -1 ? '' : body.slice(colon) };
}
