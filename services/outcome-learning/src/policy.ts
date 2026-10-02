/**
 * @tradrl/outcome-learning — the POLICIES: the three versioned,
 * validated, frozen policy records the lane's stages consume.
 *
 * - `ReconciliationPolicy` — the PnL materiality band pinned onto
 *   every learned outcome (the tolerance the class derivation and the
 *   within-tolerance verdict run against — L4/L9: the band is a
 *   POINT-IN-TIME policy fact carried BY the record, never an ambient
 *   default).
 * - `PostMortemDraftPolicy` — which outcome classes warrant a draft,
 *   the confidence the drafter assigns each typed hypothesis class
 *   when its typed evidence is present, and the mark-move threshold
 *   beyond which a market_move hypothesis is emitted.
 * - `RetentionPolicy` — the visibility windows (outcome and
 *   post-mortem) the query surface applies over injected instants.
 *   Retention NEVER deletes: the logs are append-only; the policy only
 *   bounds the QUERYABLE horizon (plus the L4 law: a record stamped
 *   after the query instant is invisible — the future is never
 *   returned).
 *
 * Every policy is validated (collect-first, typed errors) and deeply
 * frozen. Draft confidences are the DRAFTER's declared heuristics —
 * fixed decimals in the policy, never ambient randomness, never
 * per-record inventions; downstream refinement (T035, human review
 * through T034) supersedes drafts by APPEND, never by rewrite.
 */

import { deepFreeze, fail, ok, type OutcomesResult } from './imports';
import type { OutcomeClass } from './imports';
import { isOutcomeClass, isUnitIntervalDecimal, isCanonicalUnsignedDecimal } from './imports';

// ---------------------------------------------------------------------------
// The reconciliation policy
// ---------------------------------------------------------------------------

/** The reconciliation policy: the PnL materiality band. */
export interface ReconciliationPolicy {
  /** The PnL materiality band, canonical unsigned decimal (|realized - expected| <= band => as_expected). */
  readonly pnlTolerance: string;
}

/** Validate a reconciliation policy (typed errors; deeply frozen on success). */
export function validateReconciliationPolicy(v: unknown): OutcomesResult<ReconciliationPolicy> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail('invalid_type', 'the reconciliation policy must be an object { pnlTolerance }');
  const candidate = v as { pnlTolerance?: unknown };
  if (typeof candidate.pnlTolerance === 'number') {
    return fail('decimal_imprecision', 'pnlTolerance carries a JS number — tolerances are canonical decimal STRINGs', 'pnlTolerance');
  }
  if (typeof candidate.pnlTolerance !== 'string' || !isCanonicalUnsignedDecimal(candidate.pnlTolerance)) {
    return fail('invalid_field', 'pnlTolerance must be a canonical unsigned decimal string (the materiality band)', 'pnlTolerance');
  }
  return ok(deepFreeze({ pnlTolerance: candidate.pnlTolerance }));
}

// ---------------------------------------------------------------------------
// The post-mortem draft policy
// ---------------------------------------------------------------------------

/** The per-class draft confidences (unit-interval decimals — the drafter's declared heuristics). */
export interface DraftConfidences {
  readonly decision: string;
  readonly marketMove: string;
  readonly modelError: string;
  readonly dataLag: string;
}

/** The post-mortem draft policy: the warranted classes, the confidences, the mark-move threshold. */
export interface PostMortemDraftPolicy {
  /** Which outcome classes warrant a post-mortem draft (members of the closed vocabulary). */
  readonly warrantedClasses: readonly OutcomeClass[];
  /** The confidence assigned to each hypothesis class when its typed evidence is present. */
  readonly confidences: DraftConfidences;
  /** The mark-move threshold: a move strictly beyond this (either direction) emits the market_move hypothesis. */
  readonly marketMoveThreshold: string;
}

/**
 * Validate a post-mortem draft policy: every warranted class must be a
 * member of the closed vocabulary (the typed `unknown_outcome_class`
 * on a foreign string); every confidence must be a canonical
 * unit-interval decimal; the threshold a canonical unsigned decimal.
 */
export function validatePostMortemDraftPolicy(v: unknown): OutcomesResult<PostMortemDraftPolicy> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail('invalid_type', 'the post-mortem draft policy must be an object { warrantedClasses, confidences, marketMoveThreshold }');
  const candidate = v as { warrantedClasses?: unknown; confidences?: unknown; marketMoveThreshold?: unknown };
  if (!Array.isArray(candidate.warrantedClasses)) return fail('invalid_field', 'warrantedClasses must be an array of outcome classes', 'warrantedClasses');
  const warranted: OutcomeClass[] = [];
  for (let index = 0; index < candidate.warrantedClasses.length; index++) {
    const one = candidate.warrantedClasses[index];
    if (!isOutcomeClass(one)) {
      return fail('unknown_outcome_class', `warrantedClasses[${index}] ${JSON.stringify(one)} is not an outcome class — the vocabulary is closed`, `warrantedClasses[${index}]`);
    }
    warranted.push(one);
  }
  const confidences = candidate.confidences;
  if (typeof confidences !== 'object' || confidences === null) return fail('invalid_field', 'confidences must be an object { decision, marketMove, modelError, dataLag }', 'confidences');
  const pairs: readonly [unknown, string][] = [
    [(confidences as Record<string, unknown>).decision, 'confidences.decision'],
    [(confidences as Record<string, unknown>).marketMove, 'confidences.marketMove'],
    [(confidences as Record<string, unknown>).modelError, 'confidences.modelError'],
    [(confidences as Record<string, unknown>).dataLag, 'confidences.dataLag'],
  ];
  for (const [value, path] of pairs) {
    if (typeof value === 'number') return fail('decimal_imprecision', `${path} carries a JS number — confidences are canonical unit-interval decimal STRINGs`, path);
    if (typeof value !== 'string' || !isUnitIntervalDecimal(value)) {
      return fail('confidence_incoherent', `${path} ${JSON.stringify(value)} is not a canonical unit-interval decimal (0 <= c <= 1)`, path);
    }
  }
  if (typeof candidate.marketMoveThreshold === 'number') return fail('decimal_imprecision', 'marketMoveThreshold carries a JS number — thresholds are canonical decimal STRINGs', 'marketMoveThreshold');
  if (typeof candidate.marketMoveThreshold !== 'string' || !isCanonicalUnsignedDecimal(candidate.marketMoveThreshold)) {
    return fail('invalid_field', 'marketMoveThreshold must be a canonical unsigned decimal string', 'marketMoveThreshold');
  }
  return ok(deepFreeze({
    warrantedClasses: Object.freeze(warranted),
    confidences: {
      decision: (confidences as Record<string, string>).decision,
      marketMove: (confidences as Record<string, string>).marketMove,
      modelError: (confidences as Record<string, string>).modelError,
      dataLag: (confidences as Record<string, string>).dataLag,
    },
    marketMoveThreshold: candidate.marketMoveThreshold,
  }));
}

/** The default draft policy (the declared interpretation: gaps and shortfalls warrant drafts; on-target outcomes do not). */
export const DEFAULT_POST_MORTEM_DRAFT_POLICY: PostMortemDraftPolicy = deepFreeze({
  warrantedClasses: ['adverse_gap', 'favorable_gap', 'execution_shortfall', 'no_execution'],
  confidences: { decision: '0.4', marketMove: '0.5', modelError: '0.6', dataLag: '0.3' },
  marketMoveThreshold: '100',
});

// ---------------------------------------------------------------------------
// The retention policy
// ---------------------------------------------------------------------------

/** The retention policy: the visibility windows (never deletion — the logs are append-only). */
export interface RetentionPolicy {
  /** The outcome visibility window in milliseconds (>= 0). */
  readonly outcomeWindowMs: number;
  /** The post-mortem visibility window in milliseconds (>= 0). */
  readonly postMortemWindowMs: number;
}

/** Validate a retention policy (typed errors; deeply frozen on success). */
export function validateRetentionPolicy(v: unknown): OutcomesResult<RetentionPolicy> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail('invalid_type', 'the retention policy must be an object { outcomeWindowMs, postMortemWindowMs }');
  const candidate = v as { outcomeWindowMs?: unknown; postMortemWindowMs?: unknown };
  for (const [field, value] of [['outcomeWindowMs', candidate.outcomeWindowMs], ['postMortemWindowMs', candidate.postMortemWindowMs]] as const) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      return fail('invalid_field', `${field} must be a non-negative safe integer (milliseconds)`, field);
    }
  }
  return ok(deepFreeze({ outcomeWindowMs: candidate.outcomeWindowMs as number, postMortemWindowMs: candidate.postMortemWindowMs as number }));
}
