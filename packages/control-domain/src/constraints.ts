// @tradrl/control-domain — ConstraintSetStatement: mirror of the
// constraint-set contract.
//
// STRUCTURAL MIRROR of @tradrl/domain-core/src/constraints.ts (T002) — the
// CONSTRAINT core (domains, subjects, predicates, severities, unique ids,
// versioned identity) is re-declared by STRUCTURE, never imported. The
// domain-core package owns the executable predicate ENGINE
// (`evaluateConstraintSet`); the control plane WRAPS its semantics: it
// validates constraints with the mirrored guards and compiles them into
// the AcceptanceCriteria artifact that the evaluation lane (T012) executes.
//
// Deliberately minimal mirror (documented interpretation): evolution
// metadata (`supersedes`, `provenance`) stays in domain-core's authoritative
// contract — the control plane never evolves sets, it PINS versions via
// `(id, version)` refs. The tenant scope is added here because L12 makes
// constraints tenant-scoped in the control plane, and compilation REJECTS
// goal/constraint-set pairs from different tenants.
//
// Spec anchors: spec/DOMAIN-MODEL.md (ConstraintSet), R1, L7 (constraints
// are first-class, countable, attributable), L12 (tenant scope).

import {
  isIdentifierPath,
  isNonEmptyString,
  isPositiveInteger,
  isRecord,
} from './primitives';
import { ConstraintSetRef, TenantId, isConstraintSetRef, isTenantId } from './ids';
import { TimestampMs, isTimestampMs } from './timestamp';
import { CriterionPredicate, isCriterionPredicate } from './goal';

// ---------------------------------------------------------------------------
// Vocabulary (structural mirrors of domain-core's closed vocabularies)
// ---------------------------------------------------------------------------

/** Phase of the trading loop a constraint applies to. Mirror of domain-core. */
export type ConstraintDomain = 'observation' | 'state' | 'action' | 'outcome';

export const CONSTRAINT_DOMAINS: readonly ConstraintDomain[] = [
  'observation',
  'state',
  'action',
  'outcome',
] as const;

/** How a violation of this constraint is aggregated. Mirror of domain-core. */
export type ConstraintSeverity = 'advisory' | 'blocking';

export const CONSTRAINT_SEVERITIES: readonly ConstraintSeverity[] = [
  'advisory',
  'blocking',
] as const;

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

/**
 * A single executable constraint (mirror of domain-core's `Constraint`).
 * `subject` is a key into the map selected by `domain` of the evaluation
 * context — the same identifier-path address space as criterion metrics,
 * which is what makes the compiler's gating rule (acceptance.ts) total and
 * deterministic.
 */
export interface ConstraintStatement {
  /** Unique within the set. */
  readonly id: string;
  readonly domain: ConstraintDomain;
  readonly subject: string;
  readonly predicate: CriterionPredicate;
  readonly severity: ConstraintSeverity;
  /** Human explanation. NEVER interpreted. */
  readonly description?: string;
}

/**
 * A versioned collection of executable constraints, tenant-scoped.
 * Identity is `(id, version)`; records are immutable once published —
 * a change is a new version. May be EMPTY (a vacuous set) mirroring
 * domain-core's semantics: an empty set satisfies NOTHING (fail-closed),
 * it never passes vacuously.
 */
export interface ConstraintSetStatement {
  readonly id: ConstraintSetRef;
  /** Integer >= 1; monotonically increasing per id. */
  readonly version: number;
  /** Owning tenant (L12). Must match the goal's tenant to compile. */
  readonly tenantId: TenantId;
  readonly name?: string;
  readonly constraints: readonly ConstraintStatement[];
  readonly createdAt: TimestampMs;
}

// ---------------------------------------------------------------------------
// Guards (total, hand-rolled, never throw)
// ---------------------------------------------------------------------------

export function isConstraintDomain(v: unknown): v is ConstraintDomain {
  return isNonEmptyString(v) && (CONSTRAINT_DOMAINS as readonly string[]).includes(v);
}

export function isConstraintSeverity(v: unknown): v is ConstraintSeverity {
  return isNonEmptyString(v) && (CONSTRAINT_SEVERITIES as readonly string[]).includes(v);
}

export function isConstraintStatement(v: unknown): v is ConstraintStatement {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.id)) return false;
  if (!isConstraintDomain(v.domain)) return false;
  if (!isIdentifierPath(v.subject)) return false;
  if (!isCriterionPredicate(v.predicate)) return false;
  if (!isConstraintSeverity(v.severity)) return false;
  if (v.description !== undefined && !isNonEmptyString(v.description)) return false;
  return true;
}

export function isConstraintSetStatement(v: unknown): v is ConstraintSetStatement {
  if (!isRecord(v)) return false;
  if (!isConstraintSetRef(v.id)) return false;
  if (!isPositiveInteger(v.version)) return false;
  if (!isTenantId(v.tenantId)) return false;
  if (v.name !== undefined && !isNonEmptyString(v.name)) return false;
  if (!Array.isArray(v.constraints)) return false;
  const seen = new Set<string>();
  for (const c of v.constraints) {
    if (!isConstraintStatement(c)) return false;
    const constraint = c as ConstraintStatement;
    if (seen.has(constraint.id)) return false; // ids unique within the set
    seen.add(constraint.id);
  }
  if (!isTimestampMs(v.createdAt)) return false;
  return true;
}
