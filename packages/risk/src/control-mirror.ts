// @tradrl/risk — the control-plane structural mirrors: the CONSTRAINT
// SET (the compilation source).
//
// STRUCTURAL MIRROR of @tradrl/control-domain (T007 — constraints.ts and
// the predicate vocabulary of goal.ts) — re-declared by STRUCTURE, never
// imported (D-003/D-004): `ConstraintSetStatement`, `ConstraintStatement`
// and `CriterionPredicate` are field-for-field identical (same names,
// same brands, same optionality, same unique-id law), so a REAL
// control-domain `ConstraintSetStatement` IS a
// {@link ConstraintSetMirror} (mutually assignable, zero casts; proven
// by src/interop.test.ts against the REAL package on this branch).
//
// WHY THIS MIRROR EXISTS (the Work Order's scope: "RiskPolicy ...
// compiled FROM control-domain ConstraintSet mirrors (constraint ->
// limit records — pure function)"; spec/DOMAIN-MODEL.md ConstraintSet:
// "Versioned executable predicates and limits over observations, state,
// actions and outcomes"; invariant 5 — user risk constraints are
// executable acceptance criteria, and the risk policies COMPILE from
// them (mirrors)): the user's risk constraints are the AUTHORITY this
// engine's limits derive from. The compiler (compile.ts) is the pure
// function that maps risk-bearing constraint statements onto this
// lane's limit records; THIS module only re-declares the shapes it
// reads.
//
// Spec anchors: spec/DOMAIN-MODEL.md (Goal, ConstraintSet),
// spec/ARCHITECTURE-LOCK.md L7 (constraints are first-class, countable,
// attributable), L12 (tenant scope).

import { isFiniteNumber, isMemberOf, isNonEmptyString, isPositiveSafeInteger, isRecord, isTimestampMs, type TimestampMs } from './primitives';
import type { ConstraintSetRef, TenantId } from './ids';
import { isConstraintSetRef, isTenantId } from './ids';

// ---------------------------------------------------------------------------
// The predicate vocabulary (structural mirror of control-domain's goal.ts)
// ---------------------------------------------------------------------------

/** Scalar value observable in an evaluation metric space. Mirror. */
export type CriterionValueMirror = number | string | boolean;

/**
 * Executable predicate over a criterion metric or constraint subject.
 * Mirror of control-domain's `CriterionPredicate` (itself the
 * domain-core mirror). Discriminated by `kind` — the SAME closed
 * vocabulary.
 */
export type CriterionPredicateMirror =
  | { readonly kind: 'limit.max'; readonly bound: number }
  | { readonly kind: 'limit.min'; readonly bound: number }
  | { readonly kind: 'limit.range'; readonly min: number; readonly max: number }
  | { readonly kind: 'equals'; readonly value: CriterionValueMirror }
  | { readonly kind: 'notEquals'; readonly value: CriterionValueMirror }
  | { readonly kind: 'oneOf'; readonly values: readonly string[] }
  | { readonly kind: 'flag'; readonly expected: boolean };

/** The closed predicate-kind vocabulary (mirror). */
export const CRITERION_PREDICATE_KINDS_MIRROR: readonly CriterionPredicateMirror['kind'][] = [
  'limit.max',
  'limit.min',
  'limit.range',
  'equals',
  'notEquals',
  'oneOf',
  'flag',
] as const;

/** Guard: `CriterionValueMirror`. */
export function isCriterionValueMirror(v: unknown): v is CriterionValueMirror {
  if (typeof v === 'boolean') return true;
  if (typeof v === 'string') return isNonEmptyString(v);
  return isFiniteNumber(v);
}

/** Guard: `CriterionPredicateMirror` (total over the closed union). */
export function isCriterionPredicateMirror(v: unknown): v is CriterionPredicateMirror {
  if (!isRecord(v)) return false;
  switch (v.kind) {
    case 'limit.max':
    case 'limit.min':
      return isFiniteNumber(v.bound);
    case 'limit.range':
      return isFiniteNumber(v.min) && isFiniteNumber(v.max) && v.min <= v.max;
    case 'equals':
    case 'notEquals':
      return isCriterionValueMirror(v.value);
    case 'oneOf':
      return (
        Array.isArray(v.values) &&
        v.values.length > 0 &&
        v.values.every((x) => isNonEmptyString(x))
      );
    case 'flag':
      return typeof v.expected === 'boolean';
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// The constraint vocabulary (structural mirror of control-domain's constraints.ts)
// ---------------------------------------------------------------------------

/** Phase of the trading loop a constraint applies to. Mirror. */
export type ConstraintDomainMirror = 'observation' | 'state' | 'action' | 'outcome';

export const CONSTRAINT_DOMAINS_MIRROR: readonly ConstraintDomainMirror[] = [
  'observation',
  'state',
  'action',
  'outcome',
] as const;

/** How a violation of this constraint is aggregated. Mirror. */
export type ConstraintSeverityMirror = 'advisory' | 'blocking';

export const CONSTRAINT_SEVERITIES_MIRROR: readonly ConstraintSeverityMirror[] = ['advisory', 'blocking'] as const;

/** The identifier-path grammar (control-domain's primitives mirror — segments start with a letter). */
const IDENTIFIER_PATH_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)*$/;

/** Guard: a dot-separated identifier path (control-domain's discipline). Mirror. */
export function isIdentifierPath(v: unknown): v is string {
  return typeof v === 'string' && IDENTIFIER_PATH_PATTERN.test(v);
}

/** Guard: a constraint domain. Mirror. */
export function isConstraintDomainMirror(v: unknown): v is ConstraintDomainMirror {
  return isMemberOf(CONSTRAINT_DOMAINS_MIRROR, v);
}

/** Guard: a constraint severity. Mirror. */
export function isConstraintSeverityMirror(v: unknown): v is ConstraintSeverityMirror {
  return isMemberOf(CONSTRAINT_SEVERITIES_MIRROR, v);
}

// ---------------------------------------------------------------------------
// The constraint-set record (mirror)
// ---------------------------------------------------------------------------

/**
 * A single executable constraint. Mirror of control-domain's
 * `ConstraintStatement`: `subject` is a key into the map selected by
 * `domain` of the evaluation context — the same identifier-path address
 * space as criterion metrics.
 */
export interface ConstraintStatementMirror {
  /** Unique within the set. */
  readonly id: string;
  readonly domain: ConstraintDomainMirror;
  readonly subject: string;
  readonly predicate: CriterionPredicateMirror;
  readonly severity: ConstraintSeverityMirror;
  /** Human explanation. NEVER interpreted. */
  readonly description?: string;
}

/** Guard: `ConstraintStatementMirror`. Mirror. */
export function isConstraintStatementMirror(v: unknown): v is ConstraintStatementMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.id)) return false;
  if (!isConstraintDomainMirror(v.domain)) return false;
  if (!isIdentifierPath(v.subject)) return false;
  if (!isCriterionPredicateMirror(v.predicate)) return false;
  if (!isConstraintSeverityMirror(v.severity)) return false;
  if (v.description !== undefined && !isNonEmptyString(v.description)) return false;
  return true;
}

/**
 * A versioned collection of executable constraints, tenant-scoped.
 * Mirror of control-domain's `ConstraintSetStatement`: identity is
 * `(id, version)`; records are immutable once published — a change is a
 * new version. May be EMPTY (a vacuous set): an empty set satisfies
 * NOTHING (fail-closed), it never passes vacuously — and it compiles
 * to a policy with NO limits (the engine still measures).
 */
export interface ConstraintSetMirror {
  readonly id: ConstraintSetRef;
  /** Integer >= 1; monotonically increasing per id. */
  readonly version: number;
  /** Owning tenant (L12). Must match the compiling scope's tenant. */
  readonly tenantId: TenantId;
  readonly name?: string;
  readonly constraints: readonly ConstraintStatementMirror[];
  readonly createdAt: TimestampMs;
}

/** Guard: `ConstraintSetMirror` (structural; unique constraint ids included). Mirror. */
export function isConstraintSetMirror(v: unknown): v is ConstraintSetMirror {
  if (!isRecord(v)) return false;
  if (!isConstraintSetRef(v.id)) return false;
  if (!isPositiveSafeInteger(v.version)) return false;
  if (!isTenantId(v.tenantId)) return false;
  if (v.name !== undefined && !isNonEmptyString(v.name)) return false;
  if (!Array.isArray(v.constraints)) return false;
  const seen = new Set<string>();
  for (const constraint of v.constraints) {
    if (!isConstraintStatementMirror(constraint)) return false;
    const statement = constraint as ConstraintStatementMirror;
    if (seen.has(statement.id)) return false; // ids unique within the set
    seen.add(statement.id);
  }
  if (!isTimestampMs(v.createdAt)) return false;
  return true;
}

/** The versioned ref of a constraint-set mirror (the compilation lineage carrier). */
export function constraintSetVersionRefOf(set: ConstraintSetMirror): { readonly id: ConstraintSetRef; readonly version: number } {
  return { id: set.id, version: set.version };
}
