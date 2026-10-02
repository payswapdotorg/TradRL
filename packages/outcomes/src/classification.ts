/**
 * @tradrl/outcomes — the OUTCOME-CLASS VOCABULARY: the closed
 * classification of a decision's realized outcome (Work Order T033:
 * "outcome-class vocabulary (closed, typed-error on unknown)").
 *
 * THE VOCABULARY (seven members, closed forever — a new member is an
 * architecture change, not a string):
 *
 *   - `averted`            — the control stack refused the decision
 *                            (disposition `refused`): zero submissions,
 *                            zero fills, realized contribution zero BY
 *                            DESIGN. The learning question for an
 *                            averted outcome is whether the control
 *                            stack was right to refuse — evidence for
 *                            the risk lanes, not a PnL fact.
 *   - `no_execution`       — the approved order produced zero fills
 *                            within the decision's window (disposition
 *                            `expired`).
 *   - `execution_shortfall`— strictly part of the submitted quantity
 *                            filled (disposition `partial`).
 *   - `as_expected`        — filled in full; the realized PnL within
 *                            the pinned materiality band of the
 *                            declared expectation.
 *   - `adverse_gap`        — filled in full; realized materially BELOW
 *                            the declared expectation.
 *   - `favorable_gap`      — filled in full; realized materially ABOVE
 *                            the declared expectation (an under-
 *                            projection — still a calibration fact).
 *   - `unbenchmarked_fill` — filled in full; no declared PnL
 *                            expectation exists to reconcile against
 *                            (the honest member: the record is
 *                            evidence, but the gap analysis is vacuous
 *                            — a number is never invented to fill it).
 *
 * THE DERIVATION LAW ({@link classifyOutcome}): the class is a PURE,
 * DETERMINISTIC function of (disposition, expectation, realization).
 * The record mints enforce coherence — a record whose stored class
 * disagrees with the derivation over its own numbers is the typed
 * `outcome_class_mismatch` at the state level (invalid_state) and can
 * never enter a log; an unknown class STRING is the typed
 * `unknown_outcome_class` (the Work Order's closed-vocabulary law).
 */

import { fail, ok, type OutcomesResult } from './errors';
import { isCanonicalSignedDecimal, isCanonicalUnsignedDecimal, isZeroDecimal, signedAbs, signedCompare, signedSubtract } from './primitives';
import { isShadowDispositionMirror, type ShadowDispositionMirror } from './shadow-stream-mirror';

// ---------------------------------------------------------------------------
// The closed vocabulary
// ---------------------------------------------------------------------------

/** The closed outcome-class vocabulary (see module header; a new member is an architecture change). */
export const OUTCOME_CLASSES = [
  'averted',
  'no_execution',
  'execution_shortfall',
  'as_expected',
  'adverse_gap',
  'favorable_gap',
  'unbenchmarked_fill',
] as const;

/** One outcome class (a member of the closed vocabulary). */
export type OutcomeClass = (typeof OUTCOME_CLASSES)[number];

/** Guard: an outcome class. */
export function isOutcomeClass(v: unknown): v is OutcomeClass {
  return typeof v === 'string' && (OUTCOME_CLASSES as readonly string[]).includes(v);
}

/**
 * Require an outcome class — the closed-vocabulary enforcement site: an
 * unknown class string is the typed `unknown_outcome_class`, never a
 * silent coercion, never an invented default.
 */
export function requireOutcomeClass(v: unknown): OutcomesResult<OutcomeClass> {
  if (!isOutcomeClass(v)) {
    return fail(
      'unknown_outcome_class',
      `${JSON.stringify(v)} is not an outcome class — the vocabulary is closed: ${OUTCOME_CLASSES.join(' | ')} (an unknown class is never coerced; extend the vocabulary by architecture change, not by string)`,
    );
  }
  return ok(v);
}

// ---------------------------------------------------------------------------
// The derivation law
// ---------------------------------------------------------------------------

/** The classification inputs (the record's own numbers; see the module header for the law). */
export interface OutcomeClassificationInput {
  readonly disposition: ShadowDispositionMirror;
  /** The expected execution quantity, canonical unsigned decimal ('0' for refusals; NULL when no order facts). */
  readonly expectedQuantity: string | null;
  /** The filled quantity, canonical unsigned decimal (null when fill facts are absent). */
  readonly filledQuantity: string | null;
  /** The declared realized-PnL expectation, canonical signed decimal (null = unbenchmarked). */
  readonly expectedRealized: string | null;
  /** The realized PnL, canonical signed decimal (verbatim from the shadow record). */
  readonly realizedOutcome: string;
  /** The pinned materiality band, canonical unsigned decimal. */
  readonly tolerance: string;
}

/**
 * Derive the outcome class — the pure, deterministic function of the
 * record's own numbers. The exact-decimal trip wires fire here first:
 * a JS number in a money path is the typed `decimal_imprecision`; a
 * non-canonical decimal string is the typed `invalid_field`. The
 * DISPOSITION-COHERENCE laws (T030's own semantics, enforced as the
 * learning lane's defense in depth): a refusal realizes exactly zero
 * and fills nothing; an expiry fills nothing; a `filled` disposition
 * with both quantities known means they are EQUAL; a `partial`
 * disposition with both quantities known means the fill is STRICTLY
 * LESS than the order — a forged pair is the typed `invalid_state`.
 */
export function classifyOutcome(input: OutcomeClassificationInput): OutcomesResult<OutcomeClass> {
  const moneyFields: readonly [unknown, string][] = [
    [input.expectedQuantity, 'expectedQuantity'],
    [input.expectedRealized, 'expectedRealized'],
    [input.realizedOutcome, 'realizedOutcome'],
    [input.tolerance, 'tolerance'],
    [input.filledQuantity, 'filledQuantity'],
  ];
  for (const [value, path] of moneyFields) {
    if (typeof value === 'number') {
      return fail('decimal_imprecision', `the ${path} field carries a JS number (${String(value)}) — money paths are canonical decimal STRINGs (float mediation is inexpressible)`, path);
    }
  }
  if (!isShadowDispositionMirror(input.disposition)) {
    return fail('invalid_field', `the disposition ${JSON.stringify(input.disposition)} is not one of filled | refused | partial | expired`, 'disposition');
  }
  if (input.expectedQuantity !== null && !isCanonicalUnsignedDecimal(input.expectedQuantity)) {
    return fail('invalid_field', 'expectedQuantity must be a canonical unsigned decimal string or null', 'expectedQuantity');
  }
  if (input.expectedRealized !== null && !isCanonicalSignedDecimal(input.expectedRealized)) {
    return fail('invalid_field', 'expectedRealized must be a canonical signed decimal string or null', 'expectedRealized');
  }
  if (input.filledQuantity !== null && !isCanonicalUnsignedDecimal(input.filledQuantity)) {
    return fail('invalid_field', 'filledQuantity must be a canonical unsigned decimal string or null', 'filledQuantity');
  }
  if (!isCanonicalSignedDecimal(input.realizedOutcome)) {
    return fail('invalid_field', 'realizedOutcome must be a canonical signed decimal string', 'realizedOutcome');
  }
  if (!isCanonicalUnsignedDecimal(input.tolerance)) {
    return fail('invalid_field', 'tolerance must be a canonical unsigned decimal string', 'tolerance');
  }
  // Coherence: a refusal realizes exactly zero and fills nothing BY
  // T030's LAW (zero submissions, zero fills); an invented nonzero
  // would be a lie the class derivation refuses to bless.
  if (input.disposition === 'refused' && !isZeroDecimal(input.realizedOutcome)) {
    return fail('invalid_state', `a refused decision realizes exactly zero (T030's law: zero submissions, zero fills) — the record claims ${input.realizedOutcome}`, 'realizedOutcome');
  }
  if ((input.disposition === 'refused' || input.disposition === 'expired') && input.filledQuantity !== null && !isZeroDecimal(input.filledQuantity)) {
    return fail('invalid_state', `a ${input.disposition} decision fills nothing within its window (T030's disposition semantics) — the record claims ${input.filledQuantity} filled`, 'filledQuantity');
  }
  if (input.disposition === 'filled' && input.expectedQuantity !== null && input.filledQuantity !== null && signedCompare(input.filledQuantity, input.expectedQuantity) !== 0) {
    return fail('invalid_state', `a filled decision fills its whole order (T030's disposition semantics) — the record claims ${input.filledQuantity} of ${input.expectedQuantity}`, 'filledQuantity');
  }
  if (input.disposition === 'partial' && input.expectedQuantity !== null && input.filledQuantity !== null && signedCompare(input.filledQuantity, input.expectedQuantity) >= 0) {
    return fail('invalid_state', `a partial decision fills strictly less than its order (T030's disposition semantics) — the record claims ${input.filledQuantity} of ${input.expectedQuantity}`, 'filledQuantity');
  }

  switch (input.disposition) {
    case 'refused':
      return ok('averted');
    case 'expired':
      return ok('no_execution');
    case 'partial':
      return ok('execution_shortfall');
    case 'filled': {
      if (input.expectedRealized === null) return ok('unbenchmarked_fill');
      const gap = signedSubtract(input.realizedOutcome, input.expectedRealized);
      const band = signedCompare(signedAbs(gap), input.tolerance);
      if (band <= 0) return ok('as_expected');
      return ok(signedCompare(gap, '0') < 0 ? 'adverse_gap' : 'favorable_gap');
    }
  }
}
