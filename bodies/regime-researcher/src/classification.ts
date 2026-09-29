// @tradrl/body-regime-researcher — the evidence-backed regime classification.
//
// Owning Work Order: T022, section 5: "RegimeClassification — the
// evidence-backed output: instrument/venue scope, regime label (from the
// method's CLOSED taxonomy), confidence (declared method), evidence refs
// (observation window ids + their provenance lineage), as-of (the L4
// instant), body version, method version, tenant/project."
//
// LAWS HELD (violations = typed errors, tested negatively):
// - L4 (point-in-time): every cited observation's `available_time` must
//   be <= the classification's `asOf` — a classification citing future
//   data is the `future_evidence` typed error.
// - L9 (lineage): evidence is NEVER empty (`evidence_missing`), citation
//   ids are unique (`duplicate_observation_ref`), and every citation
//   carries the observation's provenance block (the T008 mirror).
// - Method honesty: the record cites a declared classification method
//   (id + version, kind 'regime-classification'); the label must be a
//   member of that method's CLOSED taxonomy AND must equal the method's
//   declared decision function over the carried statistics — a regime
//   that is an undeclared magic label, or a declared label inconsistent
//   with its own evidence statistics, is the `regime_label_mismatch`
//   typed error. Confidence cites a declared confidence method of the
//   right kind; a dispersion of fewer than two observations is `null`,
//   never a fabricated zero.
// - L12: TenantId + ProjectId are required.
// - Determinism: `classificationId` is DERIVED (`rc-<stableDigest>` over
//   the canonical form of everything else) — never random; validation
//   recomputes it and refuses tampered ids (`digest_mismatch`).
// - Immutability: created records are deeply frozen (runtime half of L3
//   discipline for authored records).

import {
  type TimestampMs,
  canonicalJson,
  deepFreeze,
  isNonEmptyString,
  isNonNegativeInteger,
  isRecord,
  isTimestampMs,
  stableDigest,
  type JsonValue,
} from './primitives';
import {
  type RegimeMethodId,
  type RegimeMethodVersionRef,
  type BodyVersionRef,
  type ProjectId,
  type RegimeClassificationId,
  type TenantId,
  isBodyVersionRef,
  isRegimeMethodId,
  isRegimeMethodVersionRef,
  isProjectId,
  isTenantId,
} from './ids';
import {
  type RegimeMethodRegistry,
  type RegimeClassificationParameters,
  resolveRegimeMethodCitation,
  findRegimeMethod,
} from './methods';
import {
  type MarketObservation,
  type QuoteObservation,
  type TradeObservation,
  type BookSnapshotObservation,
  type ObservationProvenance,
  isObservationProvenance,
  validateObservationProvenance,
} from './observations';
import { compareDecimal, decimalAbs, decimalDispersion, decimalMean, decimalRatio, decimalSub, isUnsignedDecimal, type RoundingMode } from './decimals';
import { type RegimeError, type RegimeResult, type RegimeValidation, invalidField, invalidType, validationOf } from './errors';

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

/**
 * The confidence levels — mirror of @tradrl/evaluation's
 * `VerdictConfidence` ('low' | 'moderate' | 'high'): a CATEGORY, never a
 * naked score. Confidence is a declared-method record, never a guess.
 */
export const CONFIDENCE_LEVELS = ['low', 'moderate', 'high'] as const;

/** A confidence level (category, not a score). */
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

/** Guard: a confidence level. */
export const isConfidenceLevel = (v: unknown): v is ConfidenceLevel =>
  typeof v === 'string' && (CONFIDENCE_LEVELS as readonly string[]).includes(v);

// ---------------------------------------------------------------------------
// The declared decision function (the classification method's semantics)
// ---------------------------------------------------------------------------

/** The window statistics the declared method computes and carries. */
export interface RegimeWindowStats {
  /** (last - first) / first — the signed net-move ratio. */
  readonly netMoveRatio: string;
  /** mean(|p_i - p_(i-1)|) / first — the unsigned mean absolute change ratio. */
  readonly meanAbsChangeRatio: string;
}

/**
 * THE DECLARED DECISION FUNCTION (v1: `decisionOrder:
 * 'trend-then-volatility'`): the label a window's statistics derive under
 * the method's declared parameters. Pure and total; the pipeline computes
 * with it and validation re-derives with it — one function, one law, so
 * a carried label can never disagree with the method that supposedly
 * produced it (`regime_label_mismatch`).
 */
export function classifyRegimeWindow(
  stats: RegimeWindowStats,
  parameters: RegimeClassificationParameters,
): string {
  const netMagnitude = decimalAbs(stats.netMoveRatio, parameters.outputScale, parameters.rounding);
  if (compareDecimal(netMagnitude, parameters.trendThreshold) >= 0) {
    return compareDecimal(stats.netMoveRatio, '0') >= 0 ? 'trending-up' : 'trending-down';
  }
  if (compareDecimal(stats.meanAbsChangeRatio, parameters.volatileThreshold) >= 0) {
    return 'volatile';
  }
  if (compareDecimal(stats.meanAbsChangeRatio, parameters.quietThreshold) <= 0) {
    return 'quiet';
  }
  return 'ranging';
}

/**
 * The declared PRICE EXTRACTION (v1 `priceBasis:
 * 'trade-price-or-quote-mid-or-book-best'`): the observation's price under
 * the declared basis — trades yield their print price; quotes yield the
 * mid of their bid/ask; book snapshots yield the mid of the best bid (max
 * bid price) and best ask (min ask price). Rendered at the declared
 * scale with the declared rounding. An observation that yields no price
 * (a book side is empty) returns `null` — it stays admitted evidence but
 * never joins window statistics (declared, deterministic).
 */
export function extractObservationPrice(
  observation: MarketObservation,
  scale: number,
  rounding: RoundingMode,
): string | null {
  if (observation.event_type === 'trade') {
    return (observation as TradeObservation).payload.price;
  }
  if (observation.event_type === 'quote') {
    const quote = observation as QuoteObservation;
    return decimalMean([quote.payload.bid_price, quote.payload.ask_price], scale, rounding);
  }
  const book = observation as BookSnapshotObservation;
  const bestBid = bestPriceOf(book.payload.bids, -1);
  const bestAsk = bestPriceOf(book.payload.asks, 1);
  if (bestBid === null || bestAsk === null) return null;
  return decimalMean([bestBid, bestAsk], scale, rounding);
}

/** The best level price of a side (`direction` -1 = bids (max), 1 = asks (min)). */
function bestPriceOf(levels: readonly { readonly price: string }[], direction: -1 | 1): string | null {
  let best: string | null = null;
  for (const level of levels) {
    if (best === null) {
      best = level.price;
    } else {
      const comparison = compareDecimal(level.price, best);
      if ((direction === -1 && comparison > 0) || (direction === 1 && comparison < 0)) {
        best = level.price;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Evidence lineage
// ---------------------------------------------------------------------------

/**
 * One observation citation: the observation id, the availability instant
 * it was legitimately knowable at (restated so the record itself proves
 * point-in-time honesty — L4), and the observation's provenance block
 * (the T008 mirror — full lineage travels with the output — L9).
 */
export interface MarketObservationCitation {
  readonly observationId: string;
  readonly availableTime: TimestampMs;
  readonly provenance: ObservationProvenance;
}

/** Guard: `MarketObservationCitation`. */
export function isMarketObservationCitation(v: unknown): v is MarketObservationCitation {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.observationId) &&
    isTimestampMs(v.availableTime) &&
    isObservationProvenance(v.provenance)
  );
}

/** COLLECT-ALL validation of one citation (structure + provenance laws). */
export function validateMarketObservationCitation(v: unknown, path: string): readonly RegimeError[] {
  const errors: RegimeError[] = [];
  if (!isRecord(v)) return [invalidType(path, 'an observation citation object')];
  if (!isNonEmptyString(v.observationId)) {
    errors.push(invalidField(`${path}.observationId`, 'must be a non-empty observation id'));
  }
  if (!isTimestampMs(v.availableTime)) {
    errors.push(invalidField(`${path}.availableTime`, 'must be a valid epoch-millisecond instant'));
  }
  const citedId = isNonEmptyString(v.observationId) ? (v.observationId as string) : '';
  errors.push(
    ...validateObservationProvenance(v.provenance, citedId, `${path}.provenance`),
  );
  return errors;
}

// ---------------------------------------------------------------------------
// The classification scope + window
// ---------------------------------------------------------------------------

/** The instrument/venue scope a classification covers. */
export interface RegimeScope {
  /** The instrument the classification is about (canonical instrument id). */
  readonly instrument: string;
  /** The venue scope of the classified observations. */
  readonly venue: string;
}

/** Guard: `RegimeScope`. */
export function isRegimeScope(v: unknown): v is RegimeScope {
  if (!isRecord(v)) return false;
  return isNonEmptyString(v.instrument) && isNonEmptyString(v.venue);
}

/**
 * The knowledge-time window the classification was computed over (bounds
 * are `available_time` instants of the window's observations — the
 * declared `windowBasis: 'available-time'`, never a wall clock).
 */
export interface RegimeWindow {
  readonly from: TimestampMs;
  readonly to: TimestampMs;
}

/** Guard: `RegimeWindow`. */
export function isRegimeWindow(v: unknown): v is RegimeWindow {
  if (!isRecord(v)) return false;
  return isTimestampMs(v.from) && isTimestampMs(v.to) && (v.from as number) <= (v.to as number);
}

// ---------------------------------------------------------------------------
// The declared-method confidence record
// ---------------------------------------------------------------------------

/**
 * The confidence assessment: a CATEGORY plus the two declared inputs it
 * was derived from (evidence count and the window's scale-free dispersion
 * — the price range over the first price). Never a naked guess.
 */
export interface RegimeConfidence {
  readonly methodId: RegimeMethodId;
  readonly methodVersion: RegimeMethodVersionRef;
  readonly level: ConfidenceLevel;
  /** How many price-yielding observations the window contains. */
  readonly evidenceCount: number;
  /** The window's price-range ratio (max-min)/first — or null below two prices. */
  readonly dispersion: string | null;
}

/** Guard: `RegimeConfidence`. */
export function isRegimeConfidence(v: unknown): v is RegimeConfidence {
  if (!isRecord(v)) return false;
  return (
    isRegimeMethodId(v.methodId) &&
    isRegimeMethodVersionRef(v.methodVersion) &&
    isConfidenceLevel(v.level) &&
    isNonNegativeInteger(v.evidenceCount) &&
    (v.dispersion === null || isUnsignedDecimal(v.dispersion))
  );
}

// ---------------------------------------------------------------------------
// RegimeClassification
// ---------------------------------------------------------------------------

/**
 * THE evidence-backed regime classification. Every field is lineage:
 * scope, the label from the method's closed taxonomy, the window
 * statistics (the declared method's own numbers — validation re-derives
 * the label from them), non-empty point-in-time evidence with
 * provenance, the as-of instant, the producing body version, the declared
 * confidence, tenant and project. The id is derived (`rc-<digest>`),
 * never random.
 */
export interface RegimeClassification {
  readonly classificationId: RegimeClassificationId;
  readonly scope: RegimeScope;
  /** The regime label — a member of the cited method's CLOSED taxonomy. */
  readonly label: string;
  /** (last - first) / first over the window's price series (signed decimal). */
  readonly netMoveRatio: string;
  /** mean(|p_i - p_(i-1)|) / first over the window's price series (unsigned). */
  readonly meanAbsChangeRatio: string;
  readonly window: RegimeWindow;
  /** How many price-yielding observations the window contains. */
  readonly observationCount: number;
  readonly evidence: readonly MarketObservationCitation[];
  readonly confidence: RegimeConfidence;
  /** The L4 instant this classification was computed as of. */
  readonly asOf: TimestampMs;
  readonly methodId: RegimeMethodId;
  readonly methodVersion: RegimeMethodVersionRef;
  readonly bodyVersion: BodyVersionRef;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  /** The seed the run carried (lineage material — L9). */
  readonly seed: string;
}

/** Derives the classification id: `rc-<stableDigest16>` over the canonical form. */
export function deriveRegimeClassificationId(
  classification: Omit<RegimeClassification, 'classificationId'>,
): RegimeClassificationId {
  return `rc-${stableDigest(canonicalJson(classification as unknown as JsonValue))}` as RegimeClassificationId;
}

/** Guard: `RegimeClassification` (structure only — use `validateRegimeClassification` for the laws). */
export function isRegimeClassification(v: unknown): v is RegimeClassification {
  if (!isRecord(v)) return false;
  return (
    typeof v.classificationId === 'string' &&
    v.classificationId.startsWith('rc-') &&
    isRegimeScope(v.scope) &&
    isNonEmptyString(v.label) &&
    typeof v.netMoveRatio === 'string' &&
    typeof v.meanAbsChangeRatio === 'string' &&
    isRegimeWindow(v.window) &&
    isNonNegativeInteger(v.observationCount) &&
    Array.isArray(v.evidence) &&
    (v.evidence as readonly unknown[]).every((c) => isMarketObservationCitation(c)) &&
    isRegimeConfidence(v.confidence) &&
    isTimestampMs(v.asOf) &&
    isRegimeMethodId(v.methodId) &&
    isRegimeMethodVersionRef(v.methodVersion) &&
    isBodyVersionRef(v.bodyVersion) &&
    isTenantId(v.tenantId) &&
    isProjectId(v.projectId) &&
    isNonEmptyString(v.seed)
  );
}

// ---------------------------------------------------------------------------
// Validation (collect-all — every law, every violation)
// ---------------------------------------------------------------------------

/**
 * COLLECT-ALL validation of a regime classification against every
 * research law: structure, the closed-taxonomy + declared-derivation
 * label law (method honesty), the window statistics' lexical forms,
 * evidence completeness (L9), point-in-time citations (L4), the declared
 * confidence method, tenant/project presence (L12), and the derived-id
 * law.
 */
export function validateRegimeClassification(v: unknown, registry: RegimeMethodRegistry): readonly RegimeError[] {
  const errors: RegimeError[] = [];
  if (!isRecord(v)) return [invalidType('classification', 'a regime classification object')];
  if (typeof v.classificationId !== 'string' || !v.classificationId.startsWith('rc-')) {
    errors.push(invalidField('classificationId', "must be a derived classification id ('rc-<digest>')"));
  }
  if (!isRegimeScope(v.scope)) {
    errors.push(invalidField('scope', 'must be { instrument, venue } non-empty strings'));
  }
  const asOfOk = isTimestampMs(v.asOf);
  if (!asOfOk) errors.push(invalidField('asOf', 'must be a valid epoch-millisecond instant'));
  if (!isBodyVersionRef(v.bodyVersion)) {
    errors.push(invalidField('bodyVersion', 'must be a canonical body-version reference'));
  }
  if (!isTenantId(v.tenantId)) {
    errors.push({ code: 'tenant_missing', path: 'tenantId', message: 'every research record carries a TenantId (L12)' });
  }
  if (!isProjectId(v.projectId)) {
    errors.push({ code: 'project_missing', path: 'projectId', message: 'every research record carries a ProjectId (L12)' });
  }
  if (!isNonEmptyString(v.seed)) errors.push(invalidField('seed', 'must be a non-empty seed string'));

  // method citation + THE CLOSED-TAXONOMY / DECLARED-DERIVATION LAWS
  const citationErrors = resolveRegimeMethodCitation(registry, v.methodId, v.methodVersion, 'regime-classification');
  errors.push(...citationErrors);
  const method = isRegimeMethodId(v.methodId) ? findRegimeMethod(registry, v.methodId) : null;
  const parameters =
    method !== null && method.kind === 'regime-classification'
      ? (method.parameters as RegimeClassificationParameters)
      : null;
  if (!isNonEmptyString(v.label)) {
    errors.push(invalidField('label', 'must be a regime label from the method\'s declared taxonomy'));
  } else if (parameters !== null) {
    if (!parameters.regimes.includes(v.label)) {
      // THE closed-taxonomy law: an undeclared magic label.
      errors.push({
        code: 'regime_label_mismatch',
        path: 'label',
        message: `label ${JSON.stringify(v.label)} is not declared in method ${JSON.stringify(v.methodId)}'s closed taxonomy — a regime is a declared-method output, never a free-text label`,
      });
    }
  }

  // the window statistics' lexical forms
  const netOk = typeof v.netMoveRatio === 'string' && /^-?\d+(?:\.\d+)?$/.test(v.netMoveRatio);
  if (!netOk) errors.push(invalidField('netMoveRatio', 'must be a signed decimal string'));
  const meanAbsOk = isUnsignedDecimal(v.meanAbsChangeRatio);
  if (!meanAbsOk) errors.push(invalidField('meanAbsChangeRatio', 'must be an unsigned decimal string'));
  if (!isRegimeWindow(v.window)) {
    errors.push(invalidField('window', 'must be { from, to } instants with from <= to'));
  }
  if (!isNonNegativeInteger(v.observationCount)) {
    errors.push(invalidField('observationCount', 'must be a non-negative integer'));
  }

  // THE DECLARED-DERIVATION LAW: the label must be the method's own
  // output over the carried statistics (a declared label inconsistent
  // with its own evidence statistics is a magic label all the same).
  if (parameters !== null && netOk && meanAbsOk) {
    const derived = classifyRegimeWindow(
      { netMoveRatio: v.netMoveRatio as string, meanAbsChangeRatio: v.meanAbsChangeRatio as string },
      parameters,
    );
    if (v.label !== derived) {
      errors.push({
        code: 'regime_label_mismatch',
        path: 'label',
        message: `label ${JSON.stringify(v.label)} disagrees with the declared decision function over the carried statistics (which derive ${JSON.stringify(derived)}) — the label is not the method's output`,
      });
    }
  }

  // the declared confidence method
  if (!isRecord(v.confidence)) {
    errors.push(invalidType('confidence', 'a confidence assessment object'));
  } else {
    errors.push(
      ...resolveRegimeMethodCitation(registry, v.confidence.methodId, v.confidence.methodVersion, 'confidence-estimation').map(
        (e) => ({ ...e, path: `confidence.${e.path}` }),
      ),
    );
    if (!isConfidenceLevel(v.confidence.level)) {
      errors.push(invalidField('confidence.level', `must be one of ${CONFIDENCE_LEVELS.join('|')} (a category, never a score)`));
    }
    if (!isNonNegativeInteger(v.confidence.evidenceCount)) {
      errors.push(invalidField('confidence.evidenceCount', 'must be a non-negative integer'));
    }
    if (v.confidence.dispersion !== null && !isUnsignedDecimal(v.confidence.dispersion)) {
      errors.push(invalidField('confidence.dispersion', 'must be an unsigned decimal string or null'));
    }
    if (isNonNegativeInteger(v.confidence.evidenceCount)) {
      const count = v.confidence.evidenceCount as number;
      if (count < 2 && v.confidence.dispersion !== null) {
        errors.push(invalidField('confidence.dispersion', 'dispersion of fewer than two observations is null, not a fabricated zero'));
      }
    }
  }

  // evidence lineage
  if (!Array.isArray(v.evidence)) {
    errors.push(invalidType('evidence', 'an array of observation citations'));
  } else {
    if (v.evidence.length === 0) {
      // THE evidence law: an evidence-less research output fails validation.
      errors.push({
        code: 'evidence_missing',
        path: 'evidence',
        message: 'a regime classification without observation citations is an unsupported claim',
      });
    }
    const ids: string[] = [];
    (v.evidence as readonly unknown[]).forEach((citation: unknown, index: number) => {
      errors.push(...validateMarketObservationCitation(citation, `evidence[${index}]`));
      if (isRecord(citation) && isNonEmptyString(citation.observationId)) {
        ids.push(citation.observationId as string);
      }
      if (
        isRecord(citation) &&
        isTimestampMs(citation.availableTime) &&
        asOfOk &&
        (citation.availableTime as number) > (v.asOf as number)
      ) {
        // THE L4 law: citing future data is a typed error.
        errors.push({
          code: 'future_evidence',
          path: `evidence[${index}].availableTime`,
          message: `observation ${JSON.stringify(citation.observationId)} is not knowable at the declared as-of instant`,
        });
      }
    });
    if (new Set(ids).size !== ids.length) {
      errors.push({
        code: 'duplicate_observation_ref',
        path: 'evidence',
        message: 'evidence citations must be unique observation ids',
      });
    }
    if (isNonNegativeInteger(v.observationCount) && (v.observationCount as number) !== (v.evidence as readonly unknown[]).length) {
      errors.push({
        code: 'report_composition_mismatch',
        path: 'observationCount',
        message: 'the declared observation count must equal the evidence length',
      });
    }
  }

  // derived-id law (tamper trip-wire)
  if (typeof v.classificationId === 'string' && v.classificationId.startsWith('rc-') && errors.length === 0) {
    const { classificationId: _ignored, ...material } = v as unknown as RegimeClassification;
    void _ignored;
    if (deriveRegimeClassificationId(material as Omit<RegimeClassification, 'classificationId'>) !== v.classificationId) {
      errors.push({
        code: 'digest_mismatch',
        path: 'classificationId',
        message: 'the classification id does not match its canonical content — the record was tampered with',
      });
    }
  }
  return errors;
}

/** Validation wrapper: `RegimeClassification`. */
export function validateRegimeClassificationRecord(
  v: unknown,
  registry: RegimeMethodRegistry,
): RegimeValidation<RegimeClassification> {
  const errors = validateRegimeClassification(v, registry);
  return validationOf(errors.length === 0 ? (v as RegimeClassification) : null, errors);
}

/**
 * Creates a validated, deeply-frozen regime classification. The
 * `classificationId` is DERIVED from the canonical form of the draft
 * (never accepted); the draft must satisfy every research law. Refusal is
 * typed data.
 */
export function createRegimeClassification(
  draft: Omit<RegimeClassification, 'classificationId'>,
  registry: RegimeMethodRegistry,
): RegimeResult<RegimeClassification> {
  const errors = validateRegimeClassification({ ...draft, classificationId: 'rc-pending' }, registry)
    // the placeholder id is expected to fail the prefix/digest checks only
    // when real content problems exist; strip id-specific errors here.
    .filter((error) => !(error.path === 'classificationId'));
  if (errors.length > 0) return { ok: false, errors };
  const classificationId = deriveRegimeClassificationId(draft);
  return { ok: true, value: deepFreeze({ ...draft, classificationId }) };
}

/** Canonical serialization of a classification (byte-deterministic, L9). */
export function serializeRegimeClassification(classification: RegimeClassification): string {
  return canonicalJson(classification as unknown as JsonValue);
}

// ---------------------------------------------------------------------------
// Window statistics (the declared method's pure computation — shared by
// the pipeline; re-exported for consumers that need to reproduce them)
// ---------------------------------------------------------------------------

/**
 * Computes the declared window statistics over a canonically-ordered
 * price series: netMoveRatio = (last - first) / first, and
 * meanAbsChangeRatio = mean(|p_i - p_(i-1)|) / first, both rendered at
 * the declared scale/rounding. Total for series of >= 2 prices (the
 * method's minObservations enforces this upstream); a shorter series is
 * a typed refusal, never a fabricated zero.
 */
export function computeRegimeWindowStats(
  prices: readonly string[],
  parameters: RegimeClassificationParameters,
): RegimeResult<RegimeWindowStats> {
  if (prices.length < 2) {
    return {
      ok: false,
      errors: [
        invalidField('prices', 'window statistics need at least two prices (the declared minimum is two — a change needs a pair)'),
      ],
    };
  }
  const scale = parameters.outputScale;
  const rounding = parameters.rounding;
  const first = prices[0] as string;
  const last = prices[prices.length - 1] as string;
  const netMove = decimalSub(last, first, scale, rounding);
  const netMoveRatio = decimalRatio(netMove, first, scale, rounding);
  const absoluteChanges: string[] = [];
  for (let index = 1; index < prices.length; index++) {
    const change = decimalSub(prices[index] as string, prices[index - 1] as string, scale, rounding);
    absoluteChanges.push(decimalAbs(change, scale, rounding));
  }
  const meanAbsChange = decimalMean(absoluteChanges, scale, rounding);
  const meanAbsChangeRatio = decimalRatio(meanAbsChange, first, scale, rounding);
  return {
    ok: true,
    value: deepFreeze({ netMoveRatio, meanAbsChangeRatio }),
  };
}

/**
 * Computes the declared dispersion (the confidence input): the window's
 * price range (max - min) over the first price — scale-free, rendered at
 * the declared scale. `null` below two prices (absence is null, never a
 * fabricated zero).
 */
export function computeRegimeWindowDispersion(
  prices: readonly string[],
  parameters: RegimeClassificationParameters,
): string | null {
  const dispersion = decimalDispersion(prices, parameters.outputScale, parameters.rounding);
  if (dispersion === null) return null;
  return decimalRatio(dispersion, prices[0] as string, parameters.outputScale, parameters.rounding);
}
