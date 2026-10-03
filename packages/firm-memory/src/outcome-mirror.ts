/**
 * @tradrl/firm-memory — THE T033 QUERY-SURFACE MIRRORS: the structural
 * mirrors of the outcome-learning lane's public record surface
 * (packages/outcomes: OutcomeRecord, PostMortemRecord, the attribution
 * contracts, the evidence refs; the shadow lineage block T033 mirrors
 * from T030) — THIS LANE'S INPUT, consumed mirror-only, never imported
 * (D-003/D-004).
 *
 * THE IMPORT LAW (the Work Order): "ingest from T033's query surface
 * via structural mirrors (post-mortem drafts + attribution classes +
 * outcome records) … never imports of other workspace packages." The
 * mirrors below are field-for-field identical to T033's public shapes;
 * the service's interop test drives the REAL golden session through
 * the REAL T033 ingestion + draft generation + query surface and feeds
 * the results through these mirrors — the drift trip wire.
 *
 * THE GUARD DISCIPLINE (the T033 precedent, mirrored): these guards
 * check STRUCTURAL presence + the decimal grammar + the prefix
 * disciplines (out:/pmr:/shs:/xd:/si:); the COHERENCE laws (class
 * coherence, subject binding, L4, the chains) were enforced at T033's
 * own mint and are re-asserted by the service's ingestion laws against
 * THESE mirrors' fields. A foreign shape is the typed `invalid_type`/
 * `invalid_field` at the ingestion gate — never silently coerced.
 */

import {
  isCanonicalSignedDecimal,
  isCanonicalUnsignedDecimal,
  isDigest,
  isNonEmptyString,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
  isRecord,
  isTimestampMs,
  isUnitIntervalDecimal,
  type TimestampMs,
} from './primitives';
import { isOutcomeClassMirror } from './vocabulary';

// ---------------------------------------------------------------------------
// The closed T033 vocabularies, mirrored (guards; the typed-error sites live at the mirrors' consumers)
// ---------------------------------------------------------------------------

/** The four attribution classes (T033's closed vocabulary, mirrored). */
export const ATTRIBUTION_CLASS_MIRRORS = ['decision', 'market_move', 'model_error', 'data_lag'] as const;

/** One attribution class (mirrored). */
export type AttributionClassMirror = (typeof ATTRIBUTION_CLASS_MIRRORS)[number];

/** Guard: an attribution class (mirrored). */
export function isAttributionClassMirror(v: unknown): v is AttributionClassMirror {
  return typeof v === 'string' && (ATTRIBUTION_CLASS_MIRRORS as readonly string[]).includes(v);
}

/** The decision dimensions (T033's decision payload, mirrored). */
export const DECISION_DIMENSION_MIRRORS = ['timing', 'sizing', 'selection', 'price', 'risk_calibration', 'unresolved'] as const;

/** One decision dimension (mirrored). */
export type DecisionDimensionMirror = (typeof DECISION_DIMENSION_MIRRORS)[number];

/** Guard: a decision dimension (mirrored). */
export function isDecisionDimensionMirror(v: unknown): v is DecisionDimensionMirror {
  return typeof v === 'string' && (DECISION_DIMENSION_MIRRORS as readonly string[]).includes(v);
}

/** The model-error kinds (T033's model-error payload, mirrored). */
export const MODEL_ERROR_KIND_MIRRORS = ['projection_bias', 'calibration_stale', 'regime_miss', 'feature_gap', 'unresolved'] as const;

/** One model-error kind (mirrored). */
export type ModelErrorKindMirror = (typeof MODEL_ERROR_KIND_MIRRORS)[number];

/** Guard: a model-error kind (mirrored). */
export function isModelErrorKindMirror(v: unknown): v is ModelErrorKindMirror {
  return typeof v === 'string' && (MODEL_ERROR_KIND_MIRRORS as readonly string[]).includes(v);
}

/** The market-move directions (T033's market-move payload, mirrored — position-relative). */
export type MarketMoveDirectionMirror = 'adverse' | 'favorable' | 'flat';

/** Guard: a market-move direction (mirrored). */
export function isMarketMoveDirectionMirror(v: unknown): v is MarketMoveDirectionMirror {
  return v === 'adverse' || v === 'favorable' || v === 'flat';
}

/** The disposition vocabulary (T030's closed four-member set, mirrored through T033). */
export type ShadowDispositionMirror = 'filled' | 'refused' | 'partial' | 'expired';

/** Guard: a disposition (mirrored). */
export function isShadowDispositionMirror(v: unknown): v is ShadowDispositionMirror {
  return v === 'filled' || v === 'refused' || v === 'partial' || v === 'expired';
}

// ---------------------------------------------------------------------------
// The evidence references (T033's EvidenceRef, mirrored)
// ---------------------------------------------------------------------------

/** The closed evidence-kind vocabulary (T033's, mirrored). */
export const EVIDENCE_KIND_MIRRORS = [
  'shadow_outcome',
  'shadow_fill',
  'shadow_refusal',
  'shadow_session',
  'decision',
  'intent',
  'trajectory',
  'experiment',
  'trial',
  'book_snapshot',
  'mark_fact',
] as const;

/** One evidence kind (mirrored). */
export type EvidenceKindMirror = (typeof EVIDENCE_KIND_MIRRORS)[number];

/** Guard: an evidence kind (mirrored). */
export function isEvidenceKindMirror(v: unknown): v is EvidenceKindMirror {
  return typeof v === 'string' && (EVIDENCE_KIND_MIRRORS as readonly string[]).includes(v);
}

/** One evidence reference (T033's { kind, ref }, mirrored; the prefix discipline per kind). */
export interface EvidenceRefMirror {
  readonly kind: EvidenceKindMirror;
  readonly ref: string;
}

/** The prefix discipline per kind (T033's table, mirrored; null = opaque non-empty). */
const EVIDENCE_KIND_PREFIXES: Readonly<Record<EvidenceKindMirror, string | null>> = {
  shadow_outcome: 'swo:',
  shadow_fill: 'swf-',
  shadow_refusal: 'swr:',
  shadow_session: 'shs:',
  decision: 'xd:',
  intent: 'si:',
  trajectory: null,
  experiment: null,
  trial: null,
  book_snapshot: null, // the ingestion batch's 8-hex digest
  mark_fact: null, // the mark-fact composite key (opaque)
};

/** Guard: an evidence reference (the closed kind + the owning lane's id grammar, mirrored). */
export function isEvidenceRefMirror(v: unknown): v is EvidenceRefMirror {
  if (!isRecord(v)) return false;
  if (!isEvidenceKindMirror(v.kind)) return false;
  if (!isNonEmptyString(v.ref)) return false;
  const prefix = EVIDENCE_KIND_PREFIXES[v.kind];
  if (prefix !== null && !(v.ref as string).startsWith(prefix)) return false;
  if (v.kind === 'book_snapshot' && !isDigest(v.ref)) return false;
  return true;
}

/** Guard: an evidence reference list. */
export function isEvidenceRefList(v: unknown): v is readonly EvidenceRefMirror[] {
  return Array.isArray(v) && v.every((x) => isEvidenceRefMirror(x));
}

// ---------------------------------------------------------------------------
// The shadow lineage block (T030's ShadowLineage, mirrored through T033's OutcomeLineage.shadow)
// ---------------------------------------------------------------------------

/**
 * The shadow lane's L9 lineage block — T030's block VERBATIM as T033's
 * OutcomeLineage carries it (byte-preserving physics lineage: the
 * session ref, the mode-honesty fidelity pair, both policy versions,
 * the three config digests, the run binding, the cursor, the seed, the
 * tenant/project scopes — L12).
 */
export interface ShadowLineageBlockMirror {
  readonly sessionId: string;
  readonly fidelity: { readonly mode: 'shadow'; readonly fill_origin: 'simulated' };
  readonly executionPolicy: { readonly policyId: string; readonly version: number };
  readonly riskPolicy: { readonly policyId: string; readonly version: number };
  readonly configDigests: { readonly worldConfigHash: string; readonly engineConfigHash: string; readonly dataset: string };
  readonly run: { readonly runId: string; readonly episodeId: string };
  readonly cursor: { readonly cursorId: string; readonly position: number };
  readonly seed: string;
  readonly tenant: string;
  readonly project: string;
}

/** Guard: the shadow lineage block (T030's `isShadowLineage` as T033 mirrors it, law-for-law). */
export function isShadowLineageBlockMirror(v: unknown): v is ShadowLineageBlockMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.sessionId) || !(v.sessionId as string).startsWith('shs:')) return false;
  const fidelity = v.fidelity;
  if (!isRecord(fidelity) || fidelity.mode !== 'shadow' || fidelity.fill_origin !== 'simulated') return false;
  const executionPolicy = v.executionPolicy;
  if (!isRecord(executionPolicy) || !isNonEmptyString(executionPolicy.policyId) || typeof executionPolicy.version !== 'number' || !Number.isSafeInteger(executionPolicy.version) || executionPolicy.version < 1) return false;
  const riskPolicy = v.riskPolicy;
  if (!isRecord(riskPolicy) || !isNonEmptyString(riskPolicy.policyId) || typeof riskPolicy.version !== 'number' || !Number.isSafeInteger(riskPolicy.version) || riskPolicy.version < 1) return false;
  const configDigests = v.configDigests;
  if (!isRecord(configDigests) || !isNonEmptyString(configDigests.worldConfigHash) || !isNonEmptyString(configDigests.engineConfigHash) || !isNonEmptyString(configDigests.dataset)) return false;
  const run = v.run;
  if (!isRecord(run) || !isNonEmptyString(run.runId) || !isNonEmptyString(run.episodeId)) return false;
  const cursor = v.cursor;
  if (!isRecord(cursor) || !isNonEmptyString(cursor.cursorId) || typeof cursor.position !== 'number' || !Number.isSafeInteger(cursor.position) || cursor.position < 0) return false;
  if (!isNonEmptyString(v.seed) || !isNonEmptyString(v.tenant) || !isNonEmptyString(v.project)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The attribution hypotheses (T033's AttributionHypothesis, mirrored field for field)
// ---------------------------------------------------------------------------

/** The `decision` payload (T033's, mirrored). */
export interface DecisionAttributionMirror {
  readonly dimension: DecisionDimensionMirror;
}

/** Guard: the decision payload. */
export function isDecisionAttributionMirror(v: unknown): v is DecisionAttributionMirror {
  return isRecord(v) && isDecisionDimensionMirror(v.dimension);
}

/** The `market_move` payload (T033's, mirrored — two canonical marks + the position-relative direction). */
export interface MarketMoveAttributionMirror {
  readonly markAtDecision: string;
  readonly markAtWindow: string;
  readonly direction: MarketMoveDirectionMirror;
}

/** Guard: the market-move payload. */
export function isMarketMoveAttributionMirror(v: unknown): v is MarketMoveAttributionMirror {
  if (!isRecord(v)) return false;
  if (typeof v.markAtDecision === 'number' || typeof v.markAtWindow === 'number') return false;
  if (typeof v.markAtDecision !== 'string' || !isCanonicalUnsignedDecimal(v.markAtDecision)) return false;
  if (typeof v.markAtWindow !== 'string' || !isCanonicalUnsignedDecimal(v.markAtWindow)) return false;
  return isMarketMoveDirectionMirror(v.direction);
}

/** The `model_error` payload (T033's, mirrored — projected + realized + the error kind). */
export interface ModelErrorAttributionMirror {
  readonly projected: string;
  readonly realized: string;
  readonly kind: ModelErrorKindMirror;
}

/** Guard: the model-error payload. */
export function isModelErrorAttributionMirror(v: unknown): v is ModelErrorAttributionMirror {
  if (!isRecord(v)) return false;
  if (typeof v.projected === 'number' || typeof v.realized === 'number') return false;
  if (typeof v.projected !== 'string' || !isCanonicalSignedDecimal(v.projected)) return false;
  if (typeof v.realized !== 'string' || !isCanonicalSignedDecimal(v.realized)) return false;
  return isModelErrorKindMirror(v.kind);
}

/** The `data_lag` payload (T033's, mirrored — the L4 facts with the exact lag). */
export interface DataLagAttributionMirror {
  readonly decisionAt: TimestampMs;
  readonly availableAt: TimestampMs;
  readonly lagMs: number;
}

/** Guard: the data-lag payload (availability at-or-after the decision; the lag is their exact difference). */
export function isDataLagAttributionMirror(v: unknown): v is DataLagAttributionMirror {
  if (!isRecord(v)) return false;
  if (!isTimestampMs(v.decisionAt) || !isTimestampMs(v.availableAt)) return false;
  if (typeof v.lagMs !== 'number' || !Number.isSafeInteger(v.lagMs) || v.lagMs < 0) return false;
  return (v.availableAt as number) - (v.decisionAt as number) === v.lagMs;
}

/** The typed payload union (per class — the typed union check, mirrored). */
export type AttributionDetailMirror = DecisionAttributionMirror | MarketMoveAttributionMirror | ModelErrorAttributionMirror | DataLagAttributionMirror;

/** The payload guard per class (T033's typed union check, mirrored). */
function detailMatchesClassMirror(cls: AttributionClassMirror, detail: unknown): boolean {
  switch (cls) {
    case 'decision':
      return isDecisionAttributionMirror(detail);
    case 'market_move':
      return isMarketMoveAttributionMirror(detail);
    case 'model_error':
      return isModelErrorAttributionMirror(detail);
    case 'data_lag':
      return isDataLagAttributionMirror(detail);
  }
}

/**
 * One attribution hypothesis (T033's, mirrored field for field): the
 * class, the unit-interval confidence, the class-specific TYPED
 * payload, the evidence refs, the optional note.
 */
export interface AttributionHypothesisMirror {
  readonly class: AttributionClassMirror;
  readonly confidence: string;
  readonly detail: AttributionDetailMirror;
  readonly evidence: readonly EvidenceRefMirror[];
  readonly note: string | null;
}

/** Guard: an attribution hypothesis (structural — T033's mint enforced the coherence laws). */
export function isAttributionHypothesisMirror(v: unknown): v is AttributionHypothesisMirror {
  if (!isRecord(v)) return false;
  if (!isAttributionClassMirror(v.class)) return false;
  if (typeof v.confidence === 'number') return false;
  if (typeof v.confidence !== 'string' || !isUnitIntervalDecimal(v.confidence)) return false;
  if (!detailMatchesClassMirror(v.class, v.detail)) return false;
  if (!Array.isArray(v.evidence) || !v.evidence.every((x) => isEvidenceRefMirror(x))) return false;
  if (v.note !== null && !isNonEmptyString(v.note)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The outcome record (T033's OutcomeRecord, mirrored field for field)
// ---------------------------------------------------------------------------

/** The expectation block (T033's, mirrored). */
export interface OutcomeExpectationMirror {
  readonly expectedQuantity: string | null;
  readonly expectedRealized: string | null;
  readonly tolerance: string;
  readonly declaredBy: string | null;
}

/** Guard: the expectation block. */
export function isOutcomeExpectationMirror(v: unknown): v is OutcomeExpectationMirror {
  if (!isRecord(v)) return false;
  if (typeof v.expectedQuantity === 'number' || typeof v.tolerance === 'number') return false;
  if (v.expectedQuantity !== null && !(typeof v.expectedQuantity === 'string' && isCanonicalUnsignedDecimal(v.expectedQuantity))) return false;
  if (v.expectedRealized !== null && !(typeof v.expectedRealized === 'string' && isCanonicalSignedDecimal(v.expectedRealized))) return false;
  if (typeof v.tolerance !== 'string' || !isCanonicalUnsignedDecimal(v.tolerance)) return false;
  if (v.declaredBy !== null && !isNonEmptyString(v.declaredBy)) return false;
  return true;
}

/** The realization block (T033's, mirrored). */
export interface OutcomeRealizationMirror {
  readonly filledQuantity: string | null;
  readonly realizedOutcome: string;
  readonly feeTotal: string;
  readonly notionalTotal: string;
  readonly unrealizedAtDecision: string;
}

/** Guard: the realization block. */
export function isOutcomeRealizationMirror(v: unknown): v is OutcomeRealizationMirror {
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

/** The deviation block (T033's, mirrored). */
export interface OutcomeDeviationMirror {
  readonly quantityShortfall: string | null;
  readonly realizedGap: string | null;
  readonly withinTolerance: boolean | null;
}

/** Guard: the deviation block. */
export function isOutcomeDeviationMirror(v: unknown): v is OutcomeDeviationMirror {
  if (!isRecord(v)) return false;
  if (typeof v.quantityShortfall === 'number' || typeof v.realizedGap === 'number') return false;
  if (v.quantityShortfall !== null && !(typeof v.quantityShortfall === 'string' && isCanonicalSignedDecimal(v.quantityShortfall))) return false;
  if (v.realizedGap !== null && !(typeof v.realizedGap === 'string' && isCanonicalSignedDecimal(v.realizedGap))) return false;
  if (v.withinTolerance !== null && typeof v.withinTolerance !== 'boolean') return false;
  return true;
}

/** The decision linkage (T033's, mirrored). */
export interface OutcomeDecisionLinkMirror {
  readonly decisionRef: string;
  readonly intentRef: string;
  readonly disposition: ShadowDispositionMirror;
}

/** Guard: the decision linkage (the xd:/si: prefix disciplines). */
export function isOutcomeDecisionLinkMirror(v: unknown): v is OutcomeDecisionLinkMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.decisionRef) || !(v.decisionRef as string).startsWith('xd:')) return false;
  if (!isNonEmptyString(v.intentRef) || !(v.intentRef as string).startsWith('si:')) return false;
  return isShadowDispositionMirror(v.disposition);
}

/** The T011 experiment binding (T033's, mirrored). */
export interface ExperimentBindingMirror {
  readonly experimentRef: string;
  readonly trialRef: string;
}

/** Guard: the experiment binding. */
export function isExperimentBindingMirror(v: unknown): v is ExperimentBindingMirror {
  return isRecord(v) && isNonEmptyString(v.experimentRef) && isNonEmptyString(v.trialRef);
}

/** The outcome lineage (T033's, mirrored — the full L9/L15 linkage). */
export interface OutcomeLineageMirror {
  readonly shadow: ShadowLineageBlockMirror;
  readonly shadowOutcomeRef: string;
  readonly shadowOutcomeOrdinal: number;
  readonly shadowAsOf: TimestampMs;
  readonly decisionStreamPosition: number | null;
  readonly trajectoryRef: string | null;
  readonly experiment: ExperimentBindingMirror | null;
}

/** Guard: the outcome lineage. */
export function isOutcomeLineageMirror(v: unknown): v is OutcomeLineageMirror {
  if (!isRecord(v)) return false;
  if (!isShadowLineageBlockMirror(v.shadow)) return false;
  if (!isNonEmptyString(v.shadowOutcomeRef) || !(v.shadowOutcomeRef as string).startsWith('swo:')) return false;
  if (!isPositiveSafeInteger(v.shadowOutcomeOrdinal)) return false;
  if (!isTimestampMs(v.shadowAsOf)) return false;
  if (v.decisionStreamPosition !== null && !isPositiveSafeInteger(v.decisionStreamPosition)) return false;
  if (v.trajectoryRef !== null && !isNonEmptyString(v.trajectoryRef)) return false;
  if (v.experiment !== null && !isExperimentBindingMirror(v.experiment)) return false;
  return true;
}

/**
 * One learned outcome — T033's primary contract, mirrored field for
 * field (the query surface's `queryOutcomeRecords` output; the Firm
 * Brain's ingestion input).
 */
export interface OutcomeRecordMirror {
  readonly outcomeId: string;
  readonly ordinal: number;
  readonly tenant: string;
  readonly project: string;
  readonly decision: OutcomeDecisionLinkMirror;
  readonly outcomeClass: string;
  readonly expectation: OutcomeExpectationMirror;
  readonly realization: OutcomeRealizationMirror;
  readonly deviation: OutcomeDeviationMirror;
  readonly evidence: readonly EvidenceRefMirror[];
  readonly lineage: OutcomeLineageMirror;
  readonly asOf: TimestampMs;
  readonly priorChainHead: string;
}

/** Guard: an outcome record mirror (structural; T033's mint enforced the coherence laws). */
export function isOutcomeRecordMirror(v: unknown): v is OutcomeRecordMirror {
  if (!isRecord(v)) return false;
  if (typeof v.outcomeId !== 'string' || !v.outcomeId.startsWith('out:')) return false;
  if (!isPositiveSafeInteger(v.ordinal)) return false;
  if (!isNonEmptyString(v.tenant) || !isNonEmptyString(v.project)) return false;
  if (!isOutcomeDecisionLinkMirror(v.decision)) return false;
  if (!isOutcomeClassMirror(v.outcomeClass)) return false;
  if (!isOutcomeExpectationMirror(v.expectation)) return false;
  if (!isOutcomeRealizationMirror(v.realization)) return false;
  if (!isOutcomeDeviationMirror(v.deviation)) return false;
  if (!Array.isArray(v.evidence) || !v.evidence.every((x) => isEvidenceRefMirror(x))) return false;
  if (!isOutcomeLineageMirror(v.lineage)) return false;
  if (!isTimestampMs(v.asOf)) return false;
  if (typeof v.priorChainHead !== 'string' || v.priorChainHead === '') return false;
  return true;
}

// ---------------------------------------------------------------------------
// The post-mortem record (T033's PostMortemRecord, mirrored field for field)
// ---------------------------------------------------------------------------

/** The subject block (T033's, mirrored). */
export interface PostMortemSubjectMirror {
  readonly outcomeRecordRef: string;
  readonly decisionRef: string;
  readonly intentRef: string;
  readonly outcomeClass: string;
}

/** Guard: the subject block (the out:/xd:/si: prefix disciplines + the closed class vocabulary). */
export function isPostMortemSubjectMirror(v: unknown): v is PostMortemSubjectMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.outcomeRecordRef) || !(v.outcomeRecordRef as string).startsWith('out:')) return false;
  if (!isNonEmptyString(v.decisionRef) || !(v.decisionRef as string).startsWith('xd:')) return false;
  if (!isNonEmptyString(v.intentRef) || !(v.intentRef as string).startsWith('si:')) return false;
  return isOutcomeClassMirror(v.outcomeClass);
}

/** The expected block (T033's, mirrored). */
export interface PostMortemExpectationMirror {
  readonly expectedQuantity: string | null;
  readonly expectedRealized: string | null;
  readonly tolerance: string;
}

/** Guard: the expected block. */
export function isPostMortemExpectationMirror(v: unknown): v is PostMortemExpectationMirror {
  if (!isRecord(v)) return false;
  if (typeof v.expectedQuantity === 'number' || typeof v.tolerance === 'number') return false;
  if (v.expectedQuantity !== null && !(typeof v.expectedQuantity === 'string' && isCanonicalUnsignedDecimal(v.expectedQuantity))) return false;
  if (v.expectedRealized !== null && !(typeof v.expectedRealized === 'string' && isCanonicalSignedDecimal(v.expectedRealized))) return false;
  if (typeof v.tolerance !== 'string' || !isCanonicalUnsignedDecimal(v.tolerance)) return false;
  return true;
}

/** The happened block (T033's, mirrored). */
export interface PostMortemActualMirror {
  readonly disposition: ShadowDispositionMirror;
  readonly filledQuantity: string | null;
  readonly realizedOutcome: string;
  readonly feeTotal: string;
  readonly notionalTotal: string;
}

/** Guard: the happened block. */
export function isPostMortemActualMirror(v: unknown): v is PostMortemActualMirror {
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

/** The gap block (T033's, mirrored). */
export interface PostMortemGapMirror {
  readonly quantityShortfall: string | null;
  readonly realizedGap: string | null;
  readonly withinTolerance: boolean | null;
}

/** Guard: the gap block. */
export function isPostMortemGapMirror(v: unknown): v is PostMortemGapMirror {
  if (!isRecord(v)) return false;
  if (typeof v.quantityShortfall === 'number' || typeof v.realizedGap === 'number') return false;
  if (v.quantityShortfall !== null && !(typeof v.quantityShortfall === 'string' && isCanonicalSignedDecimal(v.quantityShortfall))) return false;
  if (v.realizedGap !== null && !(typeof v.realizedGap === 'string' && isCanonicalSignedDecimal(v.realizedGap))) return false;
  if (v.withinTolerance !== null && typeof v.withinTolerance !== 'boolean') return false;
  return true;
}

/** The post-mortem lineage (T033's, mirrored — the subject's bindings). */
export interface PostMortemLineageMirror {
  readonly tenant: string;
  readonly project: string;
  readonly shadowSessionRef: string;
  readonly shadowOutcomeRef: string;
  readonly trajectoryRef: string | null;
  readonly experiment: ExperimentBindingMirror | null;
}

/** Guard: the post-mortem lineage. */
export function isPostMortemLineageMirror(v: unknown): v is PostMortemLineageMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.tenant) || !isNonEmptyString(v.project)) return false;
  if (!isNonEmptyString(v.shadowSessionRef) || !(v.shadowSessionRef as string).startsWith('shs:')) return false;
  if (!isNonEmptyString(v.shadowOutcomeRef) || !(v.shadowOutcomeRef as string).startsWith('swo:')) return false;
  if (v.trajectoryRef !== null && !isNonEmptyString(v.trajectoryRef)) return false;
  if (v.experiment !== null && !isExperimentBindingMirror(v.experiment)) return false;
  return true;
}

/**
 * One structured post-mortem — T033's record, mirrored field for field
 * (the query surface's `queryPostMortems` output — latest-per-outcome
 * by default; the Firm Brain's PRIMARY ingestion source).
 */
export interface PostMortemRecordMirror {
  readonly postMortemId: string;
  readonly ordinal: number;
  readonly subject: PostMortemSubjectMirror;
  readonly expected: PostMortemExpectationMirror;
  readonly happened: PostMortemActualMirror;
  readonly gap: PostMortemGapMirror;
  readonly hypotheses: readonly AttributionHypothesisMirror[];
  readonly evidence: readonly EvidenceRefMirror[];
  readonly lineage: PostMortemLineageMirror;
  readonly asOf: TimestampMs;
  readonly priorChainHead: string;
}

/** Guard: a post-mortem record mirror (structural; T033's mint enforced the coherence laws). */
export function isPostMortemRecordMirror(v: unknown): v is PostMortemRecordMirror {
  if (!isRecord(v)) return false;
  if (typeof v.postMortemId !== 'string' || !v.postMortemId.startsWith('pmr:')) return false;
  if (!isPositiveSafeInteger(v.ordinal)) return false;
  if (!isPostMortemSubjectMirror(v.subject)) return false;
  if (!isPostMortemExpectationMirror(v.expected)) return false;
  if (!isPostMortemActualMirror(v.happened)) return false;
  if (!isPostMortemGapMirror(v.gap)) return false;
  if (!Array.isArray(v.hypotheses) || !v.hypotheses.every((x) => isAttributionHypothesisMirror(x))) return false;
  if (!Array.isArray(v.evidence) || !v.evidence.every((x) => isEvidenceRefMirror(x))) return false;
  if (!isPostMortemLineageMirror(v.lineage)) return false;
  if (!isTimestampMs(v.asOf)) return false;
  if (typeof v.priorChainHead !== 'string' || v.priorChainHead === '') return false;
  return true;
}

/** Guard: an ordinal-position sanity check reused by the ingestion gate (the raw 1-based positions are T033's, not ours). */
export function isNonNegativeOrdinal(v: unknown): v is number {
  return isNonNegativeSafeInteger(v);
}
