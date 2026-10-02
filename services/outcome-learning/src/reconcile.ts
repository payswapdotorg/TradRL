/**
 * @tradrl/outcome-learning — the RECONCILIATION ENGINE: the per-decision
 * expected-vs-realized reconciliation and the account-level
 * expected-vs-realized cross-check ("against the shadow book").
 *
 * THE PER-DECISION LAW (every number derived, never invented):
 *   - expectedQuantity — '0' for refusals (nothing was submitted —
 *     T030's law); the submitted order quantity when the caller
 *     supplied decision facts; NULL otherwise (the honest unknown).
 *   - filledQuantity — '0' for refusals and expiries (T030's
 *     disposition semantics: zero fills in the window); the order
 *     quantity for `filled` (the disposition IS the equality); the
 *     exact sum of the fill facts' quantities when supplied; NULL
 *     otherwise.
 *   - quantityShortfall — expected - filled whenever both are known;
 *     '0' for `filled` (the disposition semantics) and refusals; NULL
 *     otherwise.
 *   - expectedRealized — the caller's declared projection (with its
 *     declarer's opaque ref) or NULL (unbenchmarked — never invented).
 *   - realizedGap — realized - expected over exact signed decimals;
 *     NULL iff unbenchmarked.
 *   - withinTolerance — |realizedGap| <= the policy's pinned band;
 *     NULL iff the gap is.
 *
 * THE ACCOUNT CROSS-CHECK ({@link reconcileAgainstBook}): the outcome
 * stream's realized sum vs the shadow book snapshot's realizedPnl —
 * the exact `accrualDelta` (the genesis balance plus T030's declared
 * late-fill accruals: later fills from still-resting orders accrue to
 * the BOOK, not retroactively to the outcome record). The delta is
 * QUANTIFIED, never assumed away; `coherent` is true iff it is exactly
 * zero.
 */

import {
  classifyOutcome,
  signedAbs,
  signedAdd,
  signedCompare,
  signedSubtract,
  unsignedAdd,
  type OutcomesResult,
  type OutcomeClass,
  type TimestampMs,
} from './imports';
import type { DecisionFactsMirror, FillFactsMirror, ShadowOutcomeRecordMirror } from './imports';
import { isNonEmptyString } from './imports';
import type { ReconciliationPolicy } from './policy';
import { validateReconciliationPolicy } from './policy';
import type { ShadowBookSnapshotMirror } from './book-mirror';
import { mintOutcomeRecord } from './imports';
import type { EvidenceRef, OutcomeRecord } from './imports';

// ---------------------------------------------------------------------------
// The session binding + declared expectations (the caller-supplied links)
// ---------------------------------------------------------------------------

/** The T011 lineage binding: where the shadow session's decisions ran (NULL = unbound). */
export interface SessionBinding {
  readonly trajectoryRef: string | null;
  readonly experimentRef: string | null;
  readonly trialRef: string | null;
}

/** Guard: a session binding. */
export function isSessionBinding(v: unknown): v is SessionBinding {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const candidate = v as { trajectoryRef?: unknown; experimentRef?: unknown; trialRef?: unknown };
  if (candidate.trajectoryRef !== null && candidate.trajectoryRef !== undefined && typeof candidate.trajectoryRef !== 'string') return false;
  if (candidate.experimentRef !== null && candidate.experimentRef !== undefined && typeof candidate.experimentRef !== 'string') return false;
  if (candidate.trialRef !== null && candidate.trialRef !== undefined && typeof candidate.trialRef !== 'string') return false;
  return true;
}

/** One declared expectation: a model's projected realized PnL for one intent. */
export interface DeclaredExpectation {
  readonly intentRef: string;
  /** The projected realized PnL, canonical signed decimal. */
  readonly expectedRealized: string;
  /** The declaring model's opaque ref (the provenance the record carries). */
  readonly declaredBy: string;
}

/** Guard: a declared expectation. */
export function isDeclaredExpectation(v: unknown): v is DeclaredExpectation {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const candidate = v as { intentRef?: unknown; expectedRealized?: unknown; declaredBy?: unknown };
  if (!isNonEmptyString(candidate.intentRef)) return false;
  if (typeof candidate.expectedRealized === 'number') return false;
  if (typeof candidate.expectedRealized !== 'string' || !/^-?(0|[1-9]\d*)(\.\d+)?$/.test(candidate.expectedRealized)) return false;
  return isNonEmptyString(candidate.declaredBy);
}

// ---------------------------------------------------------------------------
// The account reconciliation
// ---------------------------------------------------------------------------

/** The account-level reconciliation against the shadow book (see module header). */
export interface BookReconciliation {
  /** The number of outcome records in the reconciled stream. */
  readonly outcomeCount: number;
  /** Σ the stream's realizedOutcome (exact signed). */
  readonly streamRealizedSum: string;
  /** The book snapshot's realizedPnl (the account truth). */
  readonly bookRealized: string;
  /** bookRealized - streamRealizedSum (the genesis balance + the late-fill accruals — exact signed). */
  readonly accrualDelta: string;
  /** `true` iff the delta is exactly zero. */
  readonly coherent: boolean;
  /** The book snapshot's instant. */
  readonly bookAsOf: TimestampMs;
}

/** Reconcile the stream's realized sum against the book snapshot (exact decimals; the delta quantified, never assumed away). */
export function reconcileAgainstBook(records: readonly ShadowOutcomeRecordMirror[], book: ShadowBookSnapshotMirror): BookReconciliation {
  let streamRealizedSum = '0';
  for (const record of records) {
    streamRealizedSum = signedAdd(streamRealizedSum, record.realizedOutcome);
  }
  const accrualDelta = signedSubtract(book.realizedPnl, streamRealizedSum);
  return {
    outcomeCount: records.length,
    streamRealizedSum,
    bookRealized: book.realizedPnl,
    accrualDelta,
    coherent: accrualDelta === '0',
    bookAsOf: book.asOf,
  };
}

// ---------------------------------------------------------------------------
// The per-decision reconciliation
// ---------------------------------------------------------------------------

/** The reconciliation inputs for ONE shadow outcome record (everything caller-supplied is optional-with-honest-NULLs). */
export interface ReconcileOneInput {
  readonly shadow: ShadowOutcomeRecordMirror;
  /** The learning log's next ordinal (the caller threads it). */
  readonly nextOrdinal: number;
  /** The learning log's current chain head (the caller threads it). */
  readonly priorChainHead: string;
  readonly policy: ReconciliationPolicy;
  /** The decision's order facts (NULL when the caller supplied none for this intent). */
  readonly decisionFacts: DecisionFactsMirror | null;
  /** The fill facts for THIS record's fills (exact quantities + availability instants). */
  readonly fillFacts: readonly FillFactsMirror[];
  /** The declared PnL expectation for this intent (NULL when no model projected one). */
  readonly expectation: DeclaredExpectation | null;
  /** The T011 session binding. */
  readonly binding: SessionBinding;
  /** The book snapshot's digest (the evidence anchor). */
  readonly bookSnapshotDigest: string;
  /** The injected learning instant (>= the shadow record's asOf — L4). */
  readonly at: TimestampMs;
}

/**
 * Reconcile ONE shadow outcome record into a minted (unappended)
 * OutcomeRecord. The derivation laws are the module header's; the
 * mint's coherence laws (class derivation, L12 scope, L4 boundary)
 * fire inside {@link mintOutcomeRecord} — this function derives the
 * blocks and lets the mint testify.
 */
export function reconcileOne(input: ReconcileOneInput): OutcomesResult<OutcomeRecord> {
  const policyResult = validateReconciliationPolicy(input.policy);
  if (!policyResult.ok) return policyResult;
  const shadow = input.shadow;
  const disposition = shadow.disposition;

  // --- The quantity dimension --------------------------------------------------------
  const expectedQuantity =
    disposition === 'refused' ? '0' : input.decisionFacts === null ? null : input.decisionFacts.orderQuantity;
  let filledQuantity: string | null;
  switch (disposition) {
    case 'refused':
    case 'expired':
      filledQuantity = '0'; // T030's disposition semantics: zero fills in the window
      break;
    case 'filled':
      // The disposition IS the equality: full execution. The absolute
      // number comes from the order facts when known, else the fill
      // facts' exact sum, else the honest NULL.
      filledQuantity = input.decisionFacts !== null
        ? input.decisionFacts.orderQuantity
        : input.fillFacts.length > 0
          ? input.fillFacts.reduce((total, fill) => unsignedAdd(total, fill.quantity), '0')
          : null;
      break;
    case 'partial':
      filledQuantity = input.fillFacts.length > 0
        ? input.fillFacts.reduce((total, fill) => unsignedAdd(total, fill.quantity), '0')
        : null;
      break;
  }
  let quantityShortfall: string | null;
  if (disposition === 'filled' || disposition === 'refused') {
    quantityShortfall = '0'; // derivable from the disposition semantics alone
  } else if (expectedQuantity !== null && filledQuantity !== null) {
    quantityShortfall = signedSubtract(expectedQuantity, filledQuantity);
  } else {
    quantityShortfall = null;
  }

  // --- The PnL dimension ----------------------------------------------------------------
  const expectedRealized = input.expectation === null ? null : input.expectation.expectedRealized;
  const declaredBy = input.expectation === null ? null : input.expectation.declaredBy;
  const realizedGap = expectedRealized === null ? null : signedSubtract(shadow.realizedOutcome, expectedRealized);
  const withinTolerance = realizedGap === null ? null : signedCompare(signedAbs(realizedGap), input.policy.pnlTolerance) <= 0;

  // --- The evidence list ------------------------------------------------------------------
  const evidence: EvidenceRef[] = [
    { kind: 'shadow_outcome', ref: shadow.outcomeId },
    { kind: 'shadow_session', ref: shadow.lineage.sessionId },
    { kind: 'decision', ref: shadow.decisionRef },
    { kind: 'intent', ref: shadow.intentRef },
  ];
  if (shadow.refusalRef !== null) evidence.push({ kind: 'shadow_refusal', ref: shadow.refusalRef });
  for (const fill of shadow.fills) evidence.push({ kind: 'shadow_fill', ref: fill });
  evidence.push({ kind: 'book_snapshot', ref: input.bookSnapshotDigest });
  if (input.binding.trajectoryRef !== null) evidence.push({ kind: 'trajectory', ref: input.binding.trajectoryRef });
  if (input.binding.experimentRef !== null) evidence.push({ kind: 'experiment', ref: input.binding.experimentRef });
  if (input.binding.trialRef !== null) evidence.push({ kind: 'trial', ref: input.binding.trialRef });

  return mintOutcomeRecord({
    ordinal: input.nextOrdinal,
    tenant: shadow.lineage.tenant,
    project: shadow.lineage.project,
    decision: { decisionRef: shadow.decisionRef, intentRef: shadow.intentRef, disposition },
    // The class is DERIVED (never caller-asserted): classify over the
    // record's own numbers; the mint testifies the coherence.
    outcomeClass: deriveClass(disposition, expectedQuantity, filledQuantity, expectedRealized, shadow.realizedOutcome, input.policy.pnlTolerance),
    expectation: { expectedQuantity, expectedRealized, tolerance: input.policy.pnlTolerance, declaredBy },
    realization: {
      filledQuantity,
      realizedOutcome: shadow.realizedOutcome,
      feeTotal: shadow.costs.feeTotal,
      notionalTotal: shadow.costs.notionalTotal,
      unrealizedAtDecision: shadow.unrealizedAtDecision,
    },
    deviation: { quantityShortfall, realizedGap, withinTolerance },
    evidence,
    lineage: {
      shadow: shadow.lineage,
      shadowOutcomeRef: shadow.outcomeId,
      shadowOutcomeOrdinal: shadow.ordinal,
      shadowAsOf: shadow.asOf,
      decisionStreamPosition: input.decisionFacts === null ? null : input.decisionFacts.streamPosition,
      trajectoryRef: input.binding.trajectoryRef,
      experiment: input.binding.experimentRef !== null && input.binding.trialRef !== null
        ? { experimentRef: input.binding.experimentRef, trialRef: input.binding.trialRef }
        : null,
    },
    asOf: input.at,
    priorChainHead: input.priorChainHead,
  });
}

/** The class derivation over the reconciled numbers (the contracts' classifyOutcome is THE law; a derivation failure here is a programming error — the inputs were validated above). */
function deriveClass(
  disposition: ShadowOutcomeRecordMirror['disposition'],
  expectedQuantity: string | null,
  filledQuantity: string | null,
  expectedRealized: string | null,
  realizedOutcome: string,
  tolerance: string,
): OutcomeClass {
  const derived = classifyOutcome({ disposition, expectedQuantity, filledQuantity, expectedRealized, realizedOutcome, tolerance });
  if (!derived.ok) throw new Error(`the reconciliation derived an invalid classification: ${derived.errors.map((error) => error.message).join('; ')}`);
  return derived.value;
}
