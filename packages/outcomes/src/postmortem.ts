/**
 * @tradrl/outcomes — the POST-MORTEM RECORD: the structured post-mortem
 * of one learned outcome (Work Order T033: "the PostMortemRecord
 * (structured post-mortem: what was expected, what happened,
 * attribution hypotheses with confidence, evidence refs — append-only,
 * chain-verified like T030's logs)").
 *
 * THE STRUCTURE (four typed blocks — never prose-only):
 *   - `subject`     — WHICH outcome is being post-mortemed: the
 *                     learning record's content-addressed ref, the
 *                     decision/intent refs, and the outcome class.
 *   - `expected`    — what was expected (the quantity, the declared
 *                     PnL expectation or its honest NULL, the pinned
 *                     tolerance).
 *   - `happened`    — what happened (the disposition, the filled
 *                     quantity or its honest NULL, the realized PnL,
 *                     the fee/notional totals — verbatim exact
 *                     decimals).
 *   - `hypotheses`  — the attribution: zero or more typed hypotheses
 *                     (decision / market_move / model_error / data_lag
 *                     — each with its typed payload, unit-interval
 *                     confidence and evidence refs), in the canonical
 *                     order (confidence descending, class ascending).
 *   - `gap`         — the reconciliation arithmetic (the quantity
 *                     shortfall, the realized gap, the
 *                     within-tolerance verdict).
 *
 * THE LIFECYCLE (the T011 trial-progression precedent): this lane
 * produces DRAFT post-mortems ({@link mintPostMortem} — the service's
 * draft generator); refinement appends a LATER record for the SAME
 * outcome under a strictly later instant (supersession by append — the
 * raw log retains every draft; the query surface collapses to the
 * latest per outcome). The append law (`postmortem_log_rewrite`) fires
 * on: a splice/reorder/truncation, a foreign chain head, or a
 * supersession whose instant is not strictly later than the record it
 * supersedes. Ratification into capability change is NOT this lane's
 * act (R27 boundary: validated learning records are PRODUCED here;
 * Body Version creation stays T035/body-forge; the Firm Brain that
 * reads these records is T034).
 *
 * THE LAWS ENFORCED AT THE MINT: exact decimals everywhere
 * (`decimal_imprecision` on a JS number); the closed attribution
 * vocabulary (`unknown_attribution_class`); coherent confidences
 * (`confidence_incoherent`); the canonical hypothesis ordering
 * (`invalid_state` on an unsorted list — determinism is a
 * construction law); the closed outcome-class vocabulary on the
 * subject (`unknown_outcome_class`); the subject's expected/happened/
 * gap blocks' structural laws.
 */

import { requireOutcomeClass, type OutcomeClass } from './classification';
import { hypothesisOrder, isAttributionHypothesis, validateAttributionHypothesis, type AttributionHypothesis } from './attribution';
import { fail, ok, type OutcomesResult } from './errors';
import { validateEvidenceList, type EvidenceRef } from './evidence';
import { mintPostMortemId, type DecisionRef, type ExperimentRef, type IntentRef, type ProjectRef, type SessionRef, type TenantRef, type TrajectoryRef, type TrialRef } from './ids';
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
import { isShadowDispositionMirror, type ShadowDispositionMirror } from './shadow-stream-mirror';

// ---------------------------------------------------------------------------
// The subject block
// ---------------------------------------------------------------------------

/** WHICH outcome is being post-mortemed. */
export interface PostMortemSubject {
  /** The learning record's content-addressed ref (`out:`). */
  readonly outcomeRecordRef: string;
  readonly decisionRef: DecisionRef;
  readonly intentRef: IntentRef;
  readonly outcomeClass: OutcomeClass;
}

/** Guard: the subject block. */
export function isPostMortemSubject(v: unknown): v is PostMortemSubject {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.outcomeRecordRef) || !(v.outcomeRecordRef as string).startsWith('out:')) return false;
  if (!isNonEmptyString(v.decisionRef) || !(v.decisionRef as string).startsWith('xd:')) return false;
  if (!isNonEmptyString(v.intentRef) || !(v.intentRef as string).startsWith('si:')) return false;
  return typeof v.outcomeClass === 'string' && (v.outcomeClass === 'averted' || v.outcomeClass === 'no_execution' || v.outcomeClass === 'execution_shortfall' || v.outcomeClass === 'as_expected' || v.outcomeClass === 'adverse_gap' || v.outcomeClass === 'favorable_gap' || v.outcomeClass === 'unbenchmarked_fill');
}

// ---------------------------------------------------------------------------
// The expected / happened / gap blocks
// ---------------------------------------------------------------------------

/** What was expected (the subject outcome record's expectation, carried by value). */
export interface PostMortemExpectation {
  readonly expectedQuantity: string;
  readonly expectedRealized: string | null;
  readonly tolerance: string;
}

/** Guard: the expected block. */
export function isPostMortemExpectation(v: unknown): v is PostMortemExpectation {
  if (!isRecord(v)) return false;
  if (typeof v.expectedQuantity === 'number' || typeof v.tolerance === 'number') return false;
  if (typeof v.expectedQuantity !== 'string' || !isCanonicalUnsignedDecimal(v.expectedQuantity)) return false;
  if (v.expectedRealized !== null && !(typeof v.expectedRealized === 'string' && isCanonicalSignedDecimal(v.expectedRealized))) return false;
  if (typeof v.tolerance !== 'string' || !isCanonicalUnsignedDecimal(v.tolerance)) return false;
  return true;
}

/** What happened (the subject outcome record's realization, carried by value — verbatim). */
export interface PostMortemActual {
  readonly disposition: ShadowDispositionMirror;
  readonly filledQuantity: string | null;
  readonly realizedOutcome: string;
  readonly feeTotal: string;
  readonly notionalTotal: string;
}

/** Guard: the happened block. */
export function isPostMortemActual(v: unknown): v is PostMortemActual {
  if (!isRecord(v)) return false;
  if (!isShadowDispositionMirror(v.disposition)) return false;
  if (typeof v.filledQuantity === 'number') return false;
  if (v.filledQuantity !== null && !(typeof v.filledQuantity === 'string' && isCanonicalUnsignedDecimal(v.filledQuantity))) return false;
  if (typeof v.realizedOutcome === 'number' || typeof v.feeTotal === 'number' || typeof v.notionalTotal === 'number') return false;
  if (typeof v.realizedOutcome !== 'string' || !isCanonicalSignedDecimal(v.realizedOutcome)) return false;
  if (typeof v.feeTotal !== 'string' || !isCanonicalUnsignedDecimal(v.feeTotal)) return false;
  if (typeof v.notionalTotal !== 'string' || !isCanonicalUnsignedDecimal(v.notionalTotal)) return false;
  return true;
}

/** The reconciliation arithmetic (the subject outcome record's deviation, carried by value). */
export interface PostMortemGap {
  readonly quantityShortfall: string | null;
  readonly realizedGap: string | null;
  readonly withinTolerance: boolean | null;
}

/** Guard: the gap block. */
export function isPostMortemGap(v: unknown): v is PostMortemGap {
  if (!isRecord(v)) return false;
  if (typeof v.quantityShortfall === 'number' || typeof v.realizedGap === 'number') return false;
  if (v.quantityShortfall !== null && !(typeof v.quantityShortfall === 'string' && isCanonicalSignedDecimal(v.quantityShortfall))) return false;
  if (v.realizedGap !== null && !(typeof v.realizedGap === 'string' && isCanonicalSignedDecimal(v.realizedGap))) return false;
  if (v.withinTolerance !== null && typeof v.withinTolerance !== 'boolean') return false;
  return true;
}

// ---------------------------------------------------------------------------
// The lineage block
// ---------------------------------------------------------------------------

/** The post-mortem's lineage (L9/L15 — the subject's bindings, mirrored). */
export interface PostMortemLineage {
  readonly tenant: TenantRef;
  readonly project: ProjectRef;
  /** The shadow session the subject's evidence came from (`shs:`). */
  readonly shadowSessionRef: SessionRef;
  /** The shadow outcome record the subject learned from (`swo:`). */
  readonly shadowOutcomeRef: string;
  /** The T011 trajectory binding (NULL = unbound). */
  readonly trajectoryRef: TrajectoryRef | null;
  /** The T011 experiment/trial binding (NULL when not inside an experiment). */
  readonly experiment: { readonly experimentRef: ExperimentRef; readonly trialRef: TrialRef } | null;
}

/** Guard: the post-mortem lineage. */
export function isPostMortemLineage(v: unknown): v is PostMortemLineage {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.tenant) || !isNonEmptyString(v.project)) return false;
  if (!isNonEmptyString(v.shadowSessionRef) || !(v.shadowSessionRef as string).startsWith('shs:')) return false;
  if (!isNonEmptyString(v.shadowOutcomeRef) || !(v.shadowOutcomeRef as string).startsWith('swo:')) return false;
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

/**
 * One structured post-mortem — a DRAFT by construction (this lane
 * produces drafts; refinement appends a later record for the same
 * outcome; ratification is downstream — see the module header). JSON-
 * serializable, deeply frozen, evidence-grounded.
 */
export interface PostMortemRecord {
  /** Content-addressed identity: `pmr:` + digest of the canonical content. */
  readonly postMortemId: string;
  /** 1-based position in the post-mortem log's sequence (append-only). */
  readonly ordinal: number;
  readonly subject: PostMortemSubject;
  readonly expected: PostMortemExpectation;
  readonly happened: PostMortemActual;
  readonly gap: PostMortemGap;
  /** The attribution hypotheses, in the canonical order (confidence desc, class asc — enforced at the mint). */
  readonly hypotheses: readonly AttributionHypothesis[];
  readonly evidence: readonly EvidenceRef[];
  readonly lineage: PostMortemLineage;
  /** The post-mortem instant (injected; must be strictly later than any record it supersedes). */
  readonly asOf: TimestampMs;
  /** The post-mortem log's chain head BEFORE this record was folded (the chain-continuity witness). */
  readonly priorChainHead: string;
}

/** Guard: a post-mortem record (structural; the mint enforces the coherence laws). */
export function isPostMortemRecord(v: unknown): v is PostMortemRecord {
  if (!isRecord(v)) return false;
  if (typeof v.postMortemId !== 'string' || !v.postMortemId.startsWith('pmr:')) return false;
  if (!isPositiveSafeInteger(v.ordinal)) return false;
  if (!isPostMortemSubject(v.subject)) return false;
  if (!isPostMortemExpectation(v.expected)) return false;
  if (!isPostMortemActual(v.happened)) return false;
  if (!isPostMortemGap(v.gap)) return false;
  if (!Array.isArray(v.hypotheses) || !v.hypotheses.every((x) => isAttributionHypothesis(x))) return false;
  if (!Array.isArray(v.evidence) || !v.evidence.every((x) => isRecord(x) && typeof (x as { kind?: unknown }).kind === 'string' && isNonEmptyString((x as { ref?: unknown }).ref))) return false;
  if (!isPostMortemLineage(v.lineage)) return false;
  if (!isTimestampMs(v.asOf)) return false;
  if (typeof v.priorChainHead !== 'string' || v.priorChainHead === '') return false;
  return true;
}

/** The canonical content tree of a post-mortem record (everything except the content-addressed id). */
export function postMortemContentTree(record: Omit<PostMortemRecord, 'postMortemId'>): JsonValue {
  return {
    ordinal: record.ordinal,
    subject: record.subject as unknown as JsonValue,
    expected: record.expected as unknown as JsonValue,
    happened: record.happened as unknown as JsonValue,
    gap: record.gap as unknown as JsonValue,
    hypotheses: record.hypotheses as unknown as JsonValue,
    evidence: record.evidence as unknown as JsonValue,
    lineage: record.lineage as unknown as JsonValue,
    asOf: record.asOf,
    priorChainHead: record.priorChainHead,
  };
}

/**
 * Mint a post-mortem record (content-addressed id; deeply frozen). The
 * coherence laws fire HERE, before any log append: the closed
 * attribution vocabulary, the confidence coherence, the canonical
 * hypothesis ordering, the closed outcome-class vocabulary on the
 * subject, and the structural guards of every block.
 */
export function mintPostMortem(record: Omit<PostMortemRecord, 'postMortemId'>): OutcomesResult<PostMortemRecord> {
  if (!isPositiveSafeInteger(record.ordinal)) {
    return fail('invalid_field', 'the post-mortem ordinal must be a positive safe integer (the 1-based log position)', 'ordinal');
  }
  if (!isPostMortemSubject(record.subject)) {
    return fail('invalid_field', 'the subject block requires the out: outcome ref, the xd: decision ref, the si: intent ref and an outcome class', 'subject');
  }
  const classResult = requireOutcomeClass(record.subject.outcomeClass);
  if (!classResult.ok) return fail(classResult.errors[0].code, classResult.errors[0].message, 'subject.outcomeClass');
  if (!isPostMortemExpectation(record.expected)) {
    return fail('invalid_field', 'the expected block fails its guard (canonical decimals; NULL expectedRealized is legal)', 'expected');
  }
  if (!isPostMortemActual(record.happened)) {
    return fail('invalid_field', 'the happened block fails its guard (a disposition, canonical decimals)', 'happened');
  }
  if (!isPostMortemGap(record.gap)) {
    return fail('invalid_field', 'the gap block fails its guard', 'gap');
  }
  if (!isPostMortemLineage(record.lineage)) {
    return fail('lineage_gap', 'the post-mortem lineage block is incomplete (tenant/project scope, the shadow session and outcome refs, the trajectory/experiment bindings)', 'lineage');
  }
  if (!isTimestampMs(record.asOf)) {
    return fail('invalid_field', 'asOf must be an epoch-ms instant (injected — no ambient clock)', 'asOf');
  }
  if (typeof record.priorChainHead !== 'string' || record.priorChainHead === '') {
    return fail('invalid_field', 'priorChainHead must be a non-empty chain head (the log supplies it)', 'priorChainHead');
  }
  if (!Array.isArray(record.hypotheses)) {
    return fail('invalid_field', 'hypotheses must be an array of typed attribution hypotheses', 'hypotheses');
  }
  const hypotheses: AttributionHypothesis[] = [];
  for (let index = 0; index < record.hypotheses.length; index++) {
    const one = validateAttributionHypothesis(record.hypotheses[index], `hypotheses[${index}]`);
    if (!one.ok) return one;
    hypotheses.push(one.value);
  }
  const evidenceResult = validateEvidenceList(record.evidence, 'evidence');
  if (!evidenceResult.ok) return evidenceResult;

  // --- The canonical ordering law (determinism is a construction law) -------------
  for (let index = 1; index < hypotheses.length; index++) {
    if (hypothesisOrder(hypotheses[index - 1] as AttributionHypothesis, hypotheses[index] as AttributionHypothesis) > 0) {
      return fail(
        'invalid_state',
        `hypotheses[${index}] violates the canonical ordering (confidence descending, then class ascending) — a post-mortem's attribution order is deterministic (L9)`,
        'hypotheses',
      );
    }
  }

  return ok(deepFreeze({ ...record, hypotheses: Object.freeze(hypotheses), postMortemId: mintPostMortemId(fnv1a32Hex(canonicalJson(postMortemContentTree({ ...record, hypotheses })))) }));
}
