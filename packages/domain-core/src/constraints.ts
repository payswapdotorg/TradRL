// @tradrl/domain-core — ConstraintSet: versioned, executable constraints.
//
// A constraint is DATA + a predicate kind — never a prompt string. Constraint
// sets are evaluated against a provider-neutral evaluation context whose four
// maps correspond to the phases of the trading loop:
//   observations (what was seen), state (current world/account state),
//   actions (what is about to be / was done), outcomes (what resulted).
//
// Laws honored here (spec/ARCHITECTURE-LOCK.md):
// - L7 constraint-aware evaluation: constraints are first-class, countable
//   and attributable (severity split), so raw PnL is never the sole criterion.
// - L8/L20 execution authority in code: evaluation is fail-closed — errors
//   and invalid input make `pass` false; nothing silently succeeds.
// - R1: constraints may originate from structured authoring OR be compiled
//   from natural language; the compiled executable form is what lives here
//   (provenance records the origin, it is never executed).

import {
  isFiniteNumber,
  isIdentifierPath,
  isNonEmptyString,
  isRecord,
  isTimestamp,
  Timestamp,
} from './primitives';
import { ConstraintSetId, isConstraintSetId } from './ids';

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Phase of the trading loop a constraint applies to. */
export type ConstraintDomain = 'observation' | 'state' | 'action' | 'outcome';

export const CONSTRAINT_DOMAINS: readonly ConstraintDomain[] = [
  'observation',
  'state',
  'action',
  'outcome',
] as const;

/** Scalar value observable in an evaluation context. */
export type ConstraintValue = number | string | boolean;

/**
 * Executable predicate. Discriminated by `kind`.
 * - `limit.*` kinds are numeric bound checks (the "limits" of the domain
 *   model): subject value must satisfy the bound comparison.
 * - `equals` / `notEquals` require the observed value to have the SAME
 *   runtime type as the declared value (a type mismatch is an error, not a
 *   satisfied check).
 * - `oneOf` checks membership of a string subject in a closed set.
 * - `flag` checks a boolean subject.
 */
export type Predicate =
  | { readonly kind: 'limit.max'; readonly bound: number }
  | { readonly kind: 'limit.min'; readonly bound: number }
  | { readonly kind: 'limit.range'; readonly min: number; readonly max: number }
  | { readonly kind: 'equals'; readonly value: ConstraintValue }
  | { readonly kind: 'notEquals'; readonly value: ConstraintValue }
  | { readonly kind: 'oneOf'; readonly values: readonly string[] }
  | { readonly kind: 'flag'; readonly expected: boolean };

export const PREDICATE_KINDS: readonly Predicate['kind'][] = [
  'limit.max',
  'limit.min',
  'limit.range',
  'equals',
  'notEquals',
  'oneOf',
  'flag',
] as const;

/** How a violation of this constraint is aggregated. */
export type ConstraintSeverity = 'advisory' | 'blocking';

export const CONSTRAINT_SEVERITIES: readonly ConstraintSeverity[] = ['advisory', 'blocking'] as const;

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

// Naming convention for subjects: dot-separated identifier paths, e.g.
// "portfolio.unrealizedPnl" (validated by isIdentifierPath in primitives).

/**
 * A single executable constraint.
 * `subject` is a key into the map selected by `domain` of the evaluation
 * context. `description` is for humans and is NEVER interpreted.
 */
export interface Constraint {
  readonly id: string;
  readonly domain: ConstraintDomain;
  readonly subject: string;
  readonly predicate: Predicate;
  readonly severity: ConstraintSeverity;
  readonly description?: string;
}

/** Where a constraint set came from (R1 allows natural-language origin). */
export interface ConstraintSetProvenance {
  readonly origin: 'authored' | 'compiled';
  /** Original source text (typically natural language) when origin is "compiled". */
  readonly sourceText?: string;
  /** Opaque reference to the compiler artifact/version that produced this set. */
  readonly compilerRef?: string;
}

/** Versioned pointer to a constraint set: identity is (id, version). */
export interface ConstraintSetRef {
  readonly id: ConstraintSetId;
  readonly version: number;
}

/**
 * A versioned collection of executable constraints.
 * Invariants: version >= 1 and monotonically increasing per id; records are
 * immutable once published (a change is a new version, optionally linked via
 * `supersedes`); constraint ids are unique within the set.
 */
export interface ConstraintSet {
  readonly id: ConstraintSetId;
  readonly version: number;
  readonly name?: string;
  readonly constraints: readonly Constraint[];
  /** Predecessor this set replaces. Same id requires lower version. */
  readonly supersedes?: ConstraintSetRef;
  readonly provenance?: ConstraintSetProvenance;
  readonly createdAt: Timestamp;
}

/**
 * The provider-neutral input to constraint evaluation. Each map holds the
 * values known AT THE MOMENT OF EVALUATION for that phase; a missing subject
 * key means "not applicable yet" (point-in-time evaluation, L4).
 */
export interface ConstraintEvaluationContext {
  readonly observations: Readonly<Record<string, ConstraintValue>>;
  readonly state: Readonly<Record<string, ConstraintValue>>;
  readonly actions: Readonly<Record<string, ConstraintValue>>;
  readonly outcomes: Readonly<Record<string, ConstraintValue>>;
}

// ---------------------------------------------------------------------------
// Evaluation results
// ---------------------------------------------------------------------------

export type ConstraintCheckStatus = 'satisfied' | 'violated' | 'not_applicable' | 'error';

/** Result of evaluating one constraint. */
export interface ConstraintCheck {
  readonly constraintId: string;
  readonly domain: ConstraintDomain;
  readonly subject: string;
  readonly severity: ConstraintSeverity;
  readonly status: ConstraintCheckStatus;
  /** Present when the subject was applicable (satisfied or violated). */
  readonly observed?: ConstraintValue;
  /** Present for `not_applicable` / `error` statuses. Human-readable, never executed. */
  readonly reason?: string;
}

/** Aggregate result of evaluating a whole constraint set. Never throws. */
export interface ConstraintEvaluationReport {
  readonly constraintSet: ConstraintSetRef;
  readonly evaluatedAt: Timestamp;
  readonly checks: readonly ConstraintCheck[];
  readonly satisfied: number;
  /** Total violations (advisory + blocking). */
  readonly violated: number;
  readonly notApplicable: number;
  readonly errors: number;
  readonly blockingViolations: number;
  readonly advisoryViolations: number;
  /**
   * satisfied / (satisfied + violated + errors). Zero when nothing was
   * applicable — an empty or wholly inapplicable set satisfies NOTHING
   * (fail-closed: no vacuous pass). `not_applicable` checks are excluded.
   */
  readonly satisfiedRatio: number;
  /** True iff zero blocking violations AND zero errors (advisories do not fail). */
  readonly pass: boolean;
  /** Set when the set/context/evaluatedAt failed structural validation. */
  readonly invalidReason?: string;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

export function isConstraintDomain(v: unknown): v is ConstraintDomain {
  return isNonEmptyString(v) && (CONSTRAINT_DOMAINS as readonly string[]).includes(v);
}

export function isConstraintValue(v: unknown): v is ConstraintValue {
  if (typeof v === 'boolean') return true;
  if (typeof v === 'string') return isNonEmptyString(v);
  return isFiniteNumber(v);
}

export function isPredicate(v: unknown): v is Predicate {
  if (!isRecord(v)) return false;
  switch (v.kind) {
    case 'limit.max':
    case 'limit.min':
      return isFiniteNumber(v.bound);
    case 'limit.range':
      return isFiniteNumber(v.min) && isFiniteNumber(v.max) && v.min <= v.max;
    case 'equals':
    case 'notEquals':
      return isConstraintValue(v.value);
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

export function isConstraintSeverity(v: unknown): v is ConstraintSeverity {
  return isNonEmptyString(v) && (CONSTRAINT_SEVERITIES as readonly string[]).includes(v);
}

export function isConstraintSetProvenance(v: unknown): v is ConstraintSetProvenance {
  if (!isRecord(v)) return false;
  if (v.origin !== 'authored' && v.origin !== 'compiled') return false;
  if (v.sourceText !== undefined && !isNonEmptyString(v.sourceText)) return false;
  if (v.compilerRef !== undefined && !isNonEmptyString(v.compilerRef)) return false;
  return true;
}

export function isConstraintSetRef(v: unknown): v is ConstraintSetRef {
  if (!isRecord(v)) return false;
  if (!isConstraintSetId(v.id)) return false;
  if (!isFiniteNumber(v.version) || !Number.isInteger(v.version) || v.version < 1) {
    return false;
  }
  return true;
}

export function isConstraint(v: unknown): v is Constraint {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.id)) return false;
  if (!isConstraintDomain(v.domain)) return false;
  if (!isIdentifierPath(v.subject)) return false;
  if (!isPredicate(v.predicate)) return false;
  if (!isConstraintSeverity(v.severity)) return false;
  if (v.description !== undefined && !isNonEmptyString(v.description)) return false;
  return true;
}

export function isConstraintSet(v: unknown): v is ConstraintSet {
  if (!isRecord(v)) return false;
  if (!isConstraintSetId(v.id)) return false;
  if (!isFiniteNumber(v.version) || !Number.isInteger(v.version) || v.version < 1) {
    return false;
  }
  if (v.name !== undefined && !isNonEmptyString(v.name)) return false;
  if (!Array.isArray(v.constraints)) return false;
  const seen = new Set<string>();
  for (const c of v.constraints) {
    if (!isConstraint(c)) return false;
    if (seen.has(c.id)) return false; // ids unique within the set
    seen.add(c.id);
  }
  if (v.supersedes !== undefined) {
    if (!isConstraintSetRef(v.supersedes)) return false;
    // Superseding the same id requires a strictly lower predecessor version.
    if (v.supersedes.id === v.id && v.supersedes.version >= v.version) return false;
  }
  if (v.provenance !== undefined && !isConstraintSetProvenance(v.provenance)) return false;
  if (!isTimestamp(v.createdAt)) return false;
  return true;
}

function isDomainMap(v: unknown): v is Readonly<Record<string, ConstraintValue>> {
  if (!isRecord(v)) return false;
  for (const [key, value] of Object.entries(v)) {
    if (!isIdentifierPath(key)) return false;
    if (!isConstraintValue(value)) return false;
  }
  return true;
}

export function isConstraintEvaluationContext(v: unknown): v is ConstraintEvaluationContext {
  if (!isRecord(v)) return false;
  return (
    isDomainMap(v.observations) &&
    isDomainMap(v.state) &&
    isDomainMap(v.actions) &&
    isDomainMap(v.outcomes)
  );
}

// ---------------------------------------------------------------------------
// Pure evaluator (deterministic, total, never throws)
// ---------------------------------------------------------------------------

const DOMAIN_TO_KEY: Record<ConstraintDomain, keyof ConstraintEvaluationContext> = {
  observation: 'observations',
  state: 'state',
  action: 'actions',
  outcome: 'outcomes',
};

function checkPredicate(
  predicate: Predicate,
  observed: ConstraintValue,
): { status: 'satisfied' | 'violated' | 'error'; reason?: string } {
  switch (predicate.kind) {
    case 'limit.max':
    case 'limit.min':
    case 'limit.range': {
      if (typeof observed !== 'number') {
        return { status: 'error', reason: 'numeric predicate applied to non-numeric subject' };
      }
      if (predicate.kind === 'limit.max') return { status: observed <= predicate.bound ? 'satisfied' : 'violated' };
      if (predicate.kind === 'limit.min') return { status: observed >= predicate.bound ? 'satisfied' : 'violated' };
      return { status: observed >= predicate.min && observed <= predicate.max ? 'satisfied' : 'violated' };
    }
    case 'equals': {
      if (typeof observed !== typeof predicate.value) {
        return { status: 'error', reason: 'type mismatch between subject and declared value' };
      }
      return { status: observed === predicate.value ? 'satisfied' : 'violated' };
    }
    case 'notEquals': {
      if (typeof observed !== typeof predicate.value) {
        return { status: 'error', reason: 'type mismatch between subject and declared value' };
      }
      return { status: observed !== predicate.value ? 'satisfied' : 'violated' };
    }
    case 'oneOf': {
      if (typeof observed !== 'string') {
        return { status: 'error', reason: 'oneOf predicate applied to non-string subject' };
      }
      return { status: predicate.values.includes(observed) ? 'satisfied' : 'violated' };
    }
    case 'flag': {
      if (typeof observed !== 'boolean') {
        return { status: 'error', reason: 'flag predicate applied to non-boolean subject' };
      }
      return { status: observed === predicate.expected ? 'satisfied' : 'violated' };
    }
  }
}

function countChecks(checks: readonly ConstraintCheck[]): Omit<ConstraintEvaluationReport, 'constraintSet' | 'evaluatedAt' | 'checks' | 'satisfiedRatio' | 'pass'> {
  let satisfied = 0;
  let advisoryViolations = 0;
  let blockingViolations = 0;
  let notApplicable = 0;
  let errors = 0;
  for (const check of checks) {
    if (check.status === 'satisfied') satisfied += 1;
    else if (check.status === 'violated') {
      if (check.severity === 'blocking') blockingViolations += 1;
      else advisoryViolations += 1;
    } else if (check.status === 'not_applicable') notApplicable += 1;
    else errors += 1;
  }
  return {
    satisfied,
    violated: advisoryViolations + blockingViolations,
    notApplicable,
    errors,
    blockingViolations,
    advisoryViolations,
  };
}

/**
 * Evaluate a constraint set against a context at a given instant.
 *
 * Determinism: the report depends only on the arguments (evaluatedAt is a
 * required parameter — no ambient clock), so evaluation is replayable.
 * Fail-closed: structurally invalid set, context or timestamp yields
 * `pass: false` with `invalidReason`; per-constraint runtime type conflicts
 * are reported as `error` checks which also force `pass: false`. Never
 * throws, even when callers bypass the types with garbage input.
 */
export function evaluateConstraintSet(
  set: ConstraintSet,
  context: ConstraintEvaluationContext,
  evaluatedAt: Timestamp,
): ConstraintEvaluationReport {
  // Best-effort identity extraction; a ref with version 0 marks an
  // unextractable identity (input failed validation before evaluation).
  const ref: ConstraintSetRef =
    isRecord(set) && isConstraintSetId(set.id) && isFiniteNumber(set.version)
      ? { id: set.id, version: set.version }
      : { id: 'invalid' as ConstraintSetId, version: 0 };

  if (!isTimestamp(evaluatedAt)) {
    return {
      constraintSet: ref,
      evaluatedAt: evaluatedAt as Timestamp,
      checks: [],
      satisfied: 0,
      violated: 0,
      notApplicable: 0,
      errors: 0,
      blockingViolations: 0,
      advisoryViolations: 0,
      satisfiedRatio: 0,
      pass: false,
      invalidReason: 'evaluatedAt is not a valid timestamp',
    };
  }

  if (!isConstraintSet(set)) {
    return {
      constraintSet: ref,
      evaluatedAt,
      checks: [],
      satisfied: 0,
      violated: 0,
      notApplicable: 0,
      errors: 0,
      blockingViolations: 0,
      advisoryViolations: 0,
      satisfiedRatio: 0,
      pass: false,
      invalidReason: 'constraint set failed structural validation',
    };
  }

  if (!isConstraintEvaluationContext(context)) {
    return {
      constraintSet: ref,
      evaluatedAt,
      checks: [],
      satisfied: 0,
      violated: 0,
      notApplicable: 0,
      errors: 0,
      blockingViolations: 0,
      advisoryViolations: 0,
      satisfiedRatio: 0,
      pass: false,
      invalidReason: 'evaluation context failed structural validation',
    };
  }

  const checks: ConstraintCheck[] = set.constraints.map((constraint): ConstraintCheck => {
    const domainMap = context[DOMAIN_TO_KEY[constraint.domain]];
    const hasKey = Object.prototype.hasOwnProperty.call(domainMap, constraint.subject);
    if (!hasKey) {
      return {
        constraintId: constraint.id,
        domain: constraint.domain,
        subject: constraint.subject,
        severity: constraint.severity,
        status: 'not_applicable',
        reason: `subject "${constraint.subject}" not present in "${constraint.domain}" phase at evaluation time`,
      };
    }
    const observed = domainMap[constraint.subject];
    const result = checkPredicate(constraint.predicate, observed);
    const base: ConstraintCheck = {
      constraintId: constraint.id,
      domain: constraint.domain,
      subject: constraint.subject,
      severity: constraint.severity,
      status: result.status,
    };
    if (result.status === 'error') return { ...base, observed, reason: result.reason };
    return { ...base, observed };
  });

  const counts = countChecks(checks);
  const applicable = counts.satisfied + counts.violated + counts.errors;
  const satisfiedRatio = applicable === 0 ? 0 : counts.satisfied / applicable;
  const pass = counts.blockingViolations === 0 && counts.errors === 0;

  return {
    constraintSet: ref,
    evaluatedAt,
    checks,
    ...counts,
    satisfiedRatio,
    pass,
  };
}
