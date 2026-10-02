/**
 * @tradrl/outcomes — the OUTCOME RECORD: the learning lane's primary
 * contract — ONE DECISION linked to its REALIZED CONSEQUENCES with the
 * full L9/L15 lineage (Work Order T033: "the OutcomeRecord (links a
 * decision/intervention to its realized consequences with full lineage
 * refs: trajectory, experiment, shadow session, decision stream
 * position)").
 *
 * THE LINKAGE (L15: goal -> research -> decision -> execution ->
 * outcome share lineage): the record binds the T019 decision ref, the
 * T018 intent ref, the T030 shadow outcome stream position (session +
 * ordinal + the shadow record's content-addressed id), the T011
 * trajectory and experiment/trial bindings (when the decision ran
 * inside one), and the decision's 1-based position in the decision
 * stream — every link an opaque ref to the owning lane's record.
 *
 * THE THREE BLOCKS:
 *   - `expectation` — what was expected: the expected execution
 *     quantity (the order's own quantity, or '0' for a refusal), the
 *     declared realized-PnL expectation (NULL when no model projected
 *     one — a number is never invented), the pinned materiality band,
 *     and the expectation's provenance (the shadow stream's own facts,
 *     or a declared projection with its declarer's opaque ref).
 *   - `realization` — what happened: the filled quantity (NULL when
 *     the caller supplied no fill facts; '0' for refusals/expiries by
 *     T030's own disposition semantics), the realized PnL, the fee and
 *     notional totals, and the unrealized mark context — every money
 *     field VERBATIM from the shadow record (byte-preserving).
 *   - `deviation` — the reconciliation: the quantity shortfall
 *     (expected - filled; NULL when unmeasurable), the realized gap
 *     (realized - expected; NULL iff unbenchmarked), and the
 *     within-tolerance verdict (NULL iff the gap is).
 *
 * THE LAWS ENFORCED AT THE MINT ({@link mintOutcomeRecord}):
 *   - exact decimals everywhere — a JS number on a money path is the
 *     typed `decimal_imprecision`;
 *   - the class coherence law — the stored `outcomeClass` must equal
 *     `classifyOutcome` over the record's own numbers (a disagreement
 *     is `invalid_state`; an unknown class string is
 *     `unknown_outcome_class`);
 *   - the L12 scope law — the record's tenant/project must equal the
 *     shadow lineage's (byte-preserving + isolation);
 *   - the L4 law — the record's `asOf` cannot precede the shadow
 *     evidence's `shadowAsOf` (learning from the future is the typed
 *     `l4_boundary_violation`).
 */

import { classifyOutcome, isOutcomeClass, requireOutcomeClass, type OutcomeClass } from './classification';
import { fail, ok, type OutcomesResult } from './errors';
import { validateEvidenceList, type EvidenceRef } from './evidence';
import { mintOutcomeRecordId, type DecisionRef, type ExperimentRef, type IntentRef, type ProjectRef, type TenantRef, type TrajectoryRef, type TrialRef } from './ids';
import {
  canonicalJson,
  deepFreeze,
  fnv1a32Hex,
  isCanonicalSignedDecimal,
  isCanonicalUnsignedDecimal,
  isNonEmptyString,
  isPositiveSafeInteger,
  isRecord,
  isTimestampMs,
  type JsonValue,
  type TimestampMs,
} from './primitives';
import {
  isShadowDispositionMirror,
  isShadowLineageMirror,
  type ShadowDispositionMirror,
  type ShadowLineageMirror,
} from './shadow-stream-mirror';

// ---------------------------------------------------------------------------
// The expectation block
// ---------------------------------------------------------------------------

/** What was expected (see module header; every money field a canonical decimal STRING, every unknown an honest NULL — a number is never invented). */
export interface OutcomeExpectation {
  /** The quantity the decision expected to execute ('0' for refusals — nothing was submitted; NULL when the caller supplied no order facts). */
  readonly expectedQuantity: string | null;
  /** The realized-PnL expectation at decision time (SIGNED; NULL = unbenchmarked — never invented). */
  readonly expectedRealized: string | null;
  /** The pinned materiality band (the reconciliation policy's value at record time — L4/L9). */
  readonly tolerance: string;
  /** The declaring model's opaque ref (NULL iff expectedRealized is NULL — the expectation's provenance). */
  readonly declaredBy: string | null;
}

/** Guard: the expectation block. */
export function isOutcomeExpectation(v: unknown): v is OutcomeExpectation {
  if (!isRecord(v)) return false;
  if (typeof v.expectedQuantity === 'number' || typeof v.tolerance === 'number') return false;
  if (v.expectedQuantity !== null && !(typeof v.expectedQuantity === 'string' && isCanonicalUnsignedDecimal(v.expectedQuantity))) return false;
  if (v.expectedRealized !== null && !(typeof v.expectedRealized === 'string' && isCanonicalSignedDecimal(v.expectedRealized))) return false;
  if (typeof v.tolerance !== 'string' || !isCanonicalUnsignedDecimal(v.tolerance)) return false;
  if (v.declaredBy !== null && !isNonEmptyString(v.declaredBy)) return false;
  // The provenance law: a declared expectation names its declarer; an unbenchmarked one names none.
  if (v.expectedRealized === null && v.declaredBy !== null) return false;
  if (v.expectedRealized !== null && v.declaredBy === null) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The realization block
// ---------------------------------------------------------------------------

/** What happened (every money field VERBATIM from the shadow record — byte-preserving law). */
export interface OutcomeRealization {
  /** The quantity actually filled ('0' for refusals and expiries by T030's disposition semantics; NULL when fill facts absent). */
  readonly filledQuantity: string | null;
  /** The realized PnL crystallized by the decision's fills (SIGNED, verbatim). */
  readonly realizedOutcome: string;
  /** The decision's total taker fee (verbatim). */
  readonly feeTotal: string;
  /** The decision's total executed notional (verbatim). */
  readonly notionalTotal: string;
  /** The book's unrealized PnL at the decision instant (SIGNED, verbatim — the mark context). */
  readonly unrealizedAtDecision: string;
}

/** Guard: the realization block. */
export function isOutcomeRealization(v: unknown): v is OutcomeRealization {
  if (!isRecord(v)) return false;
  if (typeof v.filledQuantity === 'number') return false;
  if (v.filledQuantity !== null && !(typeof v.filledQuantity === 'string' && isCanonicalUnsignedDecimal(v.filledQuantity))) return false;
  if (typeof v.realizedOutcome === 'number') return false;
  if (typeof v.realizedOutcome !== 'string' || !isCanonicalSignedDecimal(v.realizedOutcome)) return false;
  if (typeof v.feeTotal === 'number' || typeof v.notionalTotal === 'number' || typeof v.unrealizedAtDecision === 'number') return false;
  if (typeof v.feeTotal !== 'string' || !isCanonicalUnsignedDecimal(v.feeTotal)) return false;
  if (typeof v.notionalTotal !== 'string' || !isCanonicalUnsignedDecimal(v.notionalTotal)) return false;
  if (typeof v.unrealizedAtDecision !== 'string' || !isCanonicalSignedDecimal(v.unrealizedAtDecision)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The deviation block
// ---------------------------------------------------------------------------

/** The reconciliation (the exact arithmetic; NULL is the honest "unmeasurable"). */
export interface OutcomeDeviation {
  /** expectedQuantity - filledQuantity (>= 0 semantically; NULL when the filled quantity is unknown). */
  readonly quantityShortfall: string | null;
  /** realizedOutcome - expectedRealized (SIGNED; NULL iff unbenchmarked). */
  readonly realizedGap: string | null;
  /** |realizedGap| <= tolerance (NULL iff the gap is). */
  readonly withinTolerance: boolean | null;
}

/** Guard: the deviation block. */
export function isOutcomeDeviation(v: unknown): v is OutcomeDeviation {
  if (!isRecord(v)) return false;
  if (typeof v.quantityShortfall === 'number' || typeof v.realizedGap === 'number') return false;
  if (v.quantityShortfall !== null && !(typeof v.quantityShortfall === 'string' && isCanonicalSignedDecimal(v.quantityShortfall))) return false;
  if (v.realizedGap !== null && !(typeof v.realizedGap === 'string' && isCanonicalSignedDecimal(v.realizedGap))) return false;
  if (v.withinTolerance !== null && typeof v.withinTolerance !== 'boolean') return false;
  return true;
}

// ---------------------------------------------------------------------------
// The lineage block (L9/L15 — the full linkage)
// ---------------------------------------------------------------------------

/** The full lineage of one learned outcome (L9 reproducible + L15 continuity). */
export interface OutcomeLineage {
  /** T030's lineage block VERBATIM (byte-preserving physics lineage — the mirror guard re-checks every field). */
  readonly shadow: ShadowLineageMirror;
  /** The shadow outcome record this record learned from (content-addressed `swo:` ref). */
  readonly shadowOutcomeRef: string;
  /** The outcome's 1-based ordinal in the session's outcome log. */
  readonly shadowOutcomeOrdinal: number;
  /** The shadow evidence's instant (the L4 anchor: this record's asOf may not precede it). */
  readonly shadowAsOf: TimestampMs;
  /** The decision's 1-based position in the decision stream (NULL when the caller supplied no facts). */
  readonly decisionStreamPosition: number | null;
  /** The T011 trajectory this decision's experience belongs to (NULL = unbound). */
  readonly trajectoryRef: TrajectoryRef | null;
  /** The T011 experiment/trial binding (NULL when the decision did not run inside an experiment). */
  readonly experiment: { readonly experimentRef: ExperimentRef; readonly trialRef: TrialRef } | null;
}

/** Guard: the lineage block. */
export function isOutcomeLineage(v: unknown): v is OutcomeLineage {
  if (!isRecord(v)) return false;
  if (!isShadowLineageMirror(v.shadow)) return false;
  if (!isNonEmptyString(v.shadowOutcomeRef) || !(v.shadowOutcomeRef as string).startsWith('swo:')) return false;
  if (!isPositiveSafeInteger(v.shadowOutcomeOrdinal)) return false;
  if (!isTimestampMs(v.shadowAsOf)) return false;
  if (v.decisionStreamPosition !== null && !isPositiveSafeInteger(v.decisionStreamPosition)) return false;
  if (v.trajectoryRef !== null && !isNonEmptyString(v.trajectoryRef)) return false;
  if (v.experiment !== null) {
    const experiment = v.experiment as { experimentRef?: unknown; trialRef?: unknown };
    if (!isRecord(experiment) || !isNonEmptyString(experiment.experimentRef) || !isNonEmptyString(experiment.trialRef)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/** The decision linkage (the T019 decision + the T018 intent + the disposition). */
export interface OutcomeDecisionLink {
  readonly decisionRef: DecisionRef;
  readonly intentRef: IntentRef;
  readonly disposition: ShadowDispositionMirror;
}

/** Guard: the decision linkage. */
export function isOutcomeDecisionLink(v: unknown): v is OutcomeDecisionLink {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.decisionRef) || !(v.decisionRef as string).startsWith('xd:')) return false;
  if (!isNonEmptyString(v.intentRef) || !(v.intentRef as string).startsWith('si:')) return false;
  return isShadowDispositionMirror(v.disposition);
}

/**
 * One learned outcome — THE PRIMARY CONTRACT (see module header). JSON-
 * serializable, deeply frozen, lineage-complete; never carries an
 * acceptance verdict (L7 — the learning record informs, evaluation and
 * the improver decide).
 */
export interface OutcomeRecord {
  /** Content-addressed identity: `out:` + digest of the canonical content. */
  readonly outcomeId: string;
  /** 1-based position in the learning log's outcome sequence (append-only). */
  readonly ordinal: number;
  /** The tenant scope (L12 — MUST equal the shadow lineage's tenant). */
  readonly tenant: TenantRef;
  /** The project scope (L12/L15 — MUST equal the shadow lineage's project). */
  readonly project: ProjectRef;
  readonly decision: OutcomeDecisionLink;
  readonly outcomeClass: OutcomeClass;
  readonly expectation: OutcomeExpectation;
  readonly realization: OutcomeRealization;
  readonly deviation: OutcomeDeviation;
  readonly evidence: readonly EvidenceRef[];
  readonly lineage: OutcomeLineage;
  /** The learning instant (injected; may not precede the shadow evidence's instant — L4). */
  readonly asOf: TimestampMs;
  /** The learning log's chain head BEFORE this record was folded (the chain-continuity witness). */
  readonly priorChainHead: string;
}

/** Guard: an outcome record (structural; the mint enforces the coherence laws). */
export function isOutcomeRecord(v: unknown): v is OutcomeRecord {
  if (!isRecord(v)) return false;
  if (typeof v.outcomeId !== 'string' || !v.outcomeId.startsWith('out:')) return false;
  if (!isPositiveSafeInteger(v.ordinal)) return false;
  if (!isNonEmptyString(v.tenant) || !isNonEmptyString(v.project)) return false;
  if (!isOutcomeDecisionLink(v.decision)) return false;
  if (!isOutcomeClass(v.outcomeClass)) return false;
  if (!isOutcomeExpectation(v.expectation)) return false;
  if (!isOutcomeRealization(v.realization)) return false;
  if (!isOutcomeDeviation(v.deviation)) return false;
  if (!Array.isArray(v.evidence) || !v.evidence.every((x) => isRecord(x) && typeof (x as { kind?: unknown }).kind === 'string' && isNonEmptyString((x as { ref?: unknown }).ref))) return false;
  if (!isOutcomeLineage(v.lineage)) return false;
  if (!isTimestampMs(v.asOf)) return false;
  if (typeof v.priorChainHead !== 'string' || v.priorChainHead === '') return false;
  return true;
}

/** The canonical content tree of an outcome record (everything except the content-addressed id). */
export function outcomeRecordContentTree(record: Omit<OutcomeRecord, 'outcomeId'>): JsonValue {
  return {
    ordinal: record.ordinal,
    tenant: record.tenant,
    project: record.project,
    decision: record.decision as unknown as JsonValue,
    outcomeClass: record.outcomeClass,
    expectation: record.expectation as unknown as JsonValue,
    realization: record.realization as unknown as JsonValue,
    deviation: record.deviation as unknown as JsonValue,
    evidence: record.evidence as unknown as JsonValue,
    lineage: record.lineage as unknown as JsonValue,
    asOf: record.asOf,
    priorChainHead: record.priorChainHead,
  };
}

/** Locate a JS number on a money path (the exact-decimal trip wire's scanner; null when clean). */
function numberOnMoneyPath(block: unknown, fields: readonly string[], path: string): { readonly path: string; readonly value: number } | null {
  if (!isRecord(block)) return null;
  for (const field of fields) {
    const value = (block as Record<string, unknown>)[field];
    if (typeof value === 'number') return { path: `${path}.${field}`, value };
  }
  return null;
}

/**
 * Mint an outcome record (content-addressed id; deeply frozen). The
 * coherence laws fire HERE, before any log append:
 *   - `unknown_outcome_class` / `invalid_state` — the class coherence
 *     law (the stored class must equal the derivation over the
 *     record's own numbers);
 *   - `tenant_mismatch` — the L12 scope law (the record's tenant/
 *     project must equal the shadow lineage's);
 *   - `l4_boundary_violation` — the learning instant cannot precede
 *     the shadow evidence's instant;
 *   - `decimal_imprecision` / `invalid_field` — the exact-decimal and
 *     structural laws (via the block guards and the classifier).
 */
export function mintOutcomeRecord(record: Omit<OutcomeRecord, 'outcomeId'>): OutcomesResult<OutcomeRecord> {
  // --- The exact-decimal trip wires (a JS number on a money path) ---------------
  const trip = numberOnMoneyPath(record.expectation, ['expectedQuantity', 'expectedRealized', 'tolerance'], 'expectation')
    ?? numberOnMoneyPath(record.realization, ['filledQuantity', 'realizedOutcome', 'feeTotal', 'notionalTotal', 'unrealizedAtDecision'], 'realization')
    ?? numberOnMoneyPath(record.deviation, ['quantityShortfall', 'realizedGap'], 'deviation');
  if (trip !== null) {
    return fail('decimal_imprecision', `the ${trip.path} field carries a JS number (${String(trip.value)}) — money paths are canonical decimal STRINGs (float mediation is inexpressible)`, trip.path);
  }
  if (!isPositiveSafeInteger(record.ordinal)) {
    return fail('invalid_field', 'the outcome record ordinal must be a positive safe integer (the 1-based log position)', 'ordinal');
  }
  if (!isNonEmptyString(record.tenant) || !isNonEmptyString(record.project)) {
    return fail('invalid_field', 'the outcome record carries its tenant and project scopes (L12)', 'tenant');
  }
  if (!isOutcomeDecisionLink(record.decision)) {
    return fail('invalid_field', 'the decision link requires the xd: decision ref, the si: intent ref and a disposition', 'decision');
  }
  if (!isOutcomeExpectation(record.expectation)) {
    return fail('invalid_field', 'the expectation block fails its guard (canonical decimals; NULL expectedRealized is legal — an invented number is not)', 'expectation');
  }
  if (!isOutcomeRealization(record.realization)) {
    return fail('invalid_field', 'the realization block fails its guard (canonical decimals, verbatim from the shadow record)', 'realization');
  }
  if (!isOutcomeDeviation(record.deviation)) {
    return fail('invalid_field', 'the deviation block fails its guard', 'deviation');
  }
  if (!isOutcomeLineage(record.lineage)) {
    return fail('lineage_gap', 'the lineage block is incomplete (the shadow binding, the stream position, the trajectory/experiment bindings)', 'lineage');
  }
  if (!isTimestampMs(record.asOf)) {
    return fail('invalid_field', 'asOf must be an epoch-ms instant (injected — no ambient clock)', 'asOf');
  }
  if (typeof record.priorChainHead !== 'string' || record.priorChainHead === '') {
    return fail('invalid_field', 'priorChainHead must be a non-empty chain head (the log supplies it)', 'priorChainHead');
  }
  const classResult = requireOutcomeClass(record.outcomeClass);
  if (!classResult.ok) return fail(classResult.errors[0].code, classResult.errors[0].message, 'outcomeClass');
  const evidenceResult = validateEvidenceList(record.evidence, 'evidence');
  if (!evidenceResult.ok) return evidenceResult;

  // --- The L12 scope law ---------------------------------------------------------
  if (record.tenant !== record.lineage.shadow.tenant || record.project !== record.lineage.shadow.project) {
    return fail(
      'tenant_mismatch',
      `the outcome record declares ${record.tenant}/${record.project} but its shadow lineage carries ${record.lineage.shadow.tenant}/${record.lineage.shadow.project} — a learning record whose scope disagrees with its evidence is inexpressible (L12; the lineage is preserved byte-for-byte, scope included)`,
      'tenant',
    );
  }

  // --- The L4 law ----------------------------------------------------------------
  if ((record.asOf as number) < (record.lineage.shadowAsOf as number)) {
    return fail(
      'l4_boundary_violation',
      `the outcome record is stamped ${String(record.asOf)} but its shadow evidence became available at ${String(record.lineage.shadowAsOf)} — learning from the future is the typed point-in-time crime (L4)`,
      'asOf',
    );
  }

  // --- The class coherence law ------------------------------------------------------
  const derived = classifyOutcome({
    disposition: record.decision.disposition,
    expectedQuantity: record.expectation.expectedQuantity,
    filledQuantity: record.realization.filledQuantity,
    expectedRealized: record.expectation.expectedRealized,
    realizedOutcome: record.realization.realizedOutcome,
    tolerance: record.expectation.tolerance,
  });
  if (!derived.ok) return derived;
  if (derived.value !== record.outcomeClass) {
    return fail(
      'invalid_state',
      `the outcome record stores class ${record.outcomeClass} but its own numbers derive ${derived.value} — the class is a pure function of the record's facts and may not disagree (the coherence law)`,
      'outcomeClass',
    );
  }

  const digest = canonicalJson(outcomeRecordContentTree(record));
  return ok(deepFreeze({ ...record, outcomeId: mintOutcomeRecordId(fnv1a32Hex(digest)) }));
}
