// @tradrl/research (service) — the cross-market research pipeline.
//
// Work Order T023, section 5 (the reference pipeline):
//   "cross-market — inject a multi-source observation port, run the
//    declared procedures (intake -> L4 gate -> analyze relationships by
//    declared methods -> compose relationship records/reports), publish
//    through an agent-os envelope mirror port"
//
// The pipeline IS the body's declared `research-cycle` procedure, run as
// a pure protocol implementation: the cognitive substrate executes
// bodies at runtime (outside this package); here we prove the procedure
// is a deterministic, law-abiding computation.
//
// Laws held (each with its typed refusal):
//   - L8: the pipeline REFUSES to run a body spec that grants any
//     execution authority (validateCrossMarketResearcherBody first).
//   - L4: the L4 gate defers — never consumes — observations whose
//     available_time exceeds the run's as-of instant.
//   - L9: every output is built through the contract factories (evidence
//     completeness, BOTH-LEGS coverage and derived ids enforced there);
//     the run state carries a step-digest chain.
//   - L12: tenant/project flow from the run config into every record.
//   - Method honesty: the co-movement, lead-lag and spread-divergence
//     analyses all read their parameters from the declared method
//     records — window widths, minimum moves, direction thresholds — no
//     implicit constants. A correlation-style measure is ALWAYS a
//     declared-method + window record, never a naked statistic.
//   - Publication discipline: outputs leave ONLY through the injected
//     envelope-mirror port, as a bound (envelope, report) pair.
//   - Determinism: same (observation set, as-of, body version, seed) ->
//     byte-identical outputs. Observation order is canonicalized; leg
//     pair enumeration is canonical; source pull order cannot leak into
//     output bytes.

import {
  type AgentInstanceId,
  type BodyVersionRef,
  type CoMovementParameters,
  type CoverageAccounting,
  type CrossMarketDataGap,
  type CrossMarketError,
  type CrossMarketConfidence,
  type CrossMarketMethodRegistry,
  type CrossMarketObservation,
  type CrossMarketObservationSource,
  type CrossMarketPublication,
  type CrossMarketPublicationPort,
  type CrossMarketRelationship,
  type CrossMarketResult,
  type CrossMarketResearcherBodySpec,
  type DeferredObservation,
  type FundamentalDatumObservation,
  type LeadLagParameters,
  type MarketLeg,
  type MarketPair,
  type ProjectId,
  type QuoteObservation,
  type SpreadDivergenceParameters,
  type TenantId,
  type TimestampMs,
  type TopicName,
  type TradeObservation,
  type UnsupportedObservation,
  CROSS_MARKET_RESEARCHER_BODY,
  buildCrossMarketPublication,
  canonicalJson,
  canonicalObservationOrder,
  classifyPulledRecord,
  compareDecimal,
  composeCrossMarketSummary,
  createCrossMarketRelationship,
  createCrossMarketResearchReport,
  decimalAbs,
  decimalRatio,
  decimalSub,
  deepFreeze,
  findCrossMarketMethod,
  gateObservations,
  invalidField,
  isCrossMarketObservationSource,
  isNonEmptyString,
  isTimestampMs,
  marketLegKey,
  stableDigestJson,
  validateCrossMarketPublication,
  validateCrossMarketResearcherBody,
} from './imports';

// ---------------------------------------------------------------------------
// The run configuration (every instant explicit — no ambient clock)
// ---------------------------------------------------------------------------

/** The full configuration of one cross-market research run (the lineage binding). */
export interface CrossMarketRunConfig {
  /** The L4 instant the run computes as of. */
  readonly asOf: TimestampMs;
  readonly bodyVersion: BodyVersionRef;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  /** The seed this run carries (lineage material — L9). */
  readonly seed: string;
  /** The publishing instance (an agent-os AgentInstanceId). */
  readonly sender: AgentInstanceId;
  /** The organization topic the report is published to. */
  readonly topic: TopicName;
  /** The kernel operation id causing the publication. */
  readonly opId: string;
  /** The per-sender publication sequence (>= 1). */
  readonly publicationSequence: number;
  /** The explicit publication instant. */
  readonly publishedAt: TimestampMs;
}

/** The injected inputs: multi-source observation ports + the publication port. */
export interface CrossMarketPipelineInputs {
  readonly sources: readonly CrossMarketObservationSource[];
  readonly publisher: CrossMarketPublicationPort;
}

/** The full outcome of one cross-market research run. */
export interface CrossMarketRunOutcome {
  readonly reportId: string;
  readonly publication: CrossMarketPublication;
  readonly coverage: CoverageAccounting;
  readonly deferred: readonly DeferredObservation[];
  readonly unsupported: readonly UnsupportedObservation[];
  readonly relationships: readonly CrossMarketRelationship[];
  readonly dataGaps: readonly CrossMarketDataGap[];
}

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

/** COLLECT-ALL validation of a run config (typed, never throws). */
export function validateCrossMarketRunConfig(config: unknown): readonly CrossMarketError[] {
  const errors: CrossMarketError[] = [];
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return [invalidField('config', 'must be a cross-market run config object')];
  }
  const c = config as Record<string, unknown>;
  if (!isTimestampMs(c.asOf)) errors.push(invalidField('asOf', 'must be a valid epoch-millisecond instant'));
  if (typeof c.bodyVersion !== 'string' || !c.bodyVersion.includes('@')) {
    errors.push(invalidField('bodyVersion', 'must be a canonical body-version reference'));
  }
  if (!isNonEmptyString(c.tenantId)) errors.push(invalidField('tenantId', 'must be a non-empty tenant id (L12)'));
  if (!isNonEmptyString(c.projectId)) errors.push(invalidField('projectId', 'must be a non-empty project id (L12)'));
  if (!isNonEmptyString(c.seed)) errors.push(invalidField('seed', 'must be a non-empty seed string'));
  if (!isNonEmptyString(c.sender)) errors.push(invalidField('sender', 'must be a non-empty agent instance id'));
  if (!isNonEmptyString(c.topic)) errors.push(invalidField('topic', 'must be a non-empty organization topic'));
  if (!isNonEmptyString(c.opId)) errors.push(invalidField('opId', 'must be a non-empty kernel operation id'));
  if (typeof c.publicationSequence !== 'number' || !Number.isInteger(c.publicationSequence) || (c.publicationSequence as number) < 1) {
    errors.push(invalidField('publicationSequence', 'must be an integer >= 1'));
  }
  if (!isTimestampMs(c.publishedAt)) errors.push(invalidField('publishedAt', 'must be a valid epoch-millisecond instant'));
  return errors;
}

/** Derives the cross-market run id: `crossmarket-run-<digest of the config>`. */
export function crossMarketRunId(config: CrossMarketRunConfig): string {
  return `crossmarket-run-${stableDigestJson(config as never)}`;
}

// ---------------------------------------------------------------------------
// The intake stage (pull -> classify -> gate -> account)
// ---------------------------------------------------------------------------

/** The intake snapshot: every offered observation is accounted for. */
export interface CrossMarketIntakeSnapshot {
  readonly admitted: readonly CrossMarketObservation[];
  readonly deferred: readonly DeferredObservation[];
  readonly unsupported: readonly UnsupportedObservation[];
  readonly coverage: CoverageAccounting;
}

/** Runs intake over the injected multi-source ports (pull, classify, gate). */
export function runCrossMarketIntake(
  sources: readonly CrossMarketObservationSource[],
  asOf: TimestampMs,
): CrossMarketResult<CrossMarketIntakeSnapshot> {
  const errors: CrossMarketError[] = [];
  for (const source of sources) {
    if (!isCrossMarketObservationSource(source)) {
      errors.push(invalidField('sources', 'every source must be an injected observation port'));
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  const pulled: CrossMarketObservation[] = [];
  const unsupported: UnsupportedObservation[] = [];
  let invalid = 0;
  for (const source of sources) {
    for (;;) {
      const record: unknown = source.next();
      if (record === null) break;
      const classified = classifyPulledRecord(record);
      if (!classified.ok) {
        invalid += 1;
        continue;
      }
      if (classified.value.kind === 'admitted') {
        pulled.push(classified.value.observation);
      } else {
        unsupported.push(classified.value.note);
        if (classified.value.note.reason === 'invalid_observation') invalid += 1;
      }
    }
  }

  // THE L4 GATE: defer — never consume — future observations.
  const gated = gateObservations(pulled, asOf);
  return {
    ok: true,
    value: deepFreeze({
      admitted: canonicalObservationOrder(gated.admitted),
      deferred: gated.deferred,
      unsupported: deepFreeze(unsupported),
      coverage: deepFreeze({
        observationsOffered: pulled.length + unsupported.length,
        observationsAdmitted: gated.admitted.length,
        observationsDeferred: gated.deferred.length,
        observationsUnsupported: unsupported.length,
        observationsInvalid: invalid,
      }),
    }),
  };
}

// ---------------------------------------------------------------------------
// The leg model (the declared price basis over epoch-aligned windows)
// ---------------------------------------------------------------------------

/** The declared price of an observation under the declared price basis. */
function priceOf(observation: CrossMarketObservation, scale: number, rounding: 'half-even' | 'truncate'): string {
  if (observation.event_type === 'trade') {
    return (observation as TradeObservation).payload.price;
  }
  if (observation.event_type === 'quote') {
    // the mid of the top-of-book — the declared quote basis:
    // (bid + ask) / 2, computed exactly as bid + (ask - bid)/2
    // (difference + scaled-ratio arithmetic — no float ever).
    const quote = observation as QuoteObservation;
    const halfSpread = decimalRatio(
      decimalSub(quote.payload.ask_price, quote.payload.bid_price, scale, rounding),
      '2',
      scale,
      rounding,
    );
    return decimalAdd(quote.payload.bid_price, halfSpread, scale, rounding);
  }
  return (observation as FundamentalDatumObservation).payload.value;
}

/** The exact sum a + b (via difference arithmetic: a - (0 - b)). */
function decimalAdd(a: string, b: string, scale: number, rounding: 'half-even' | 'truncate'): string {
  return decimalSub(a, negated(b), scale, rounding);
}

/** The exact negation of a signed decimal string. */
function negated(value: string): string {
  return value.startsWith('-') ? value.slice(1) : `-${value}`;
}

/** One market leg's observations, canonically ordered. */
interface Leg {
  readonly leg: MarketLeg;
  readonly observations: readonly CrossMarketObservation[];
}

/** Groups observations into legs by (venue, instrument, assetClass, series). */
function legsOf(observations: readonly CrossMarketObservation[]): readonly Leg[] {
  const groups = new Map<string, { leg: MarketLeg; observations: CrossMarketObservation[] }>();
  for (const observation of canonicalObservationOrder(observations)) {
    const series =
      observation.event_type === 'fundamental'
        ? (observation as FundamentalDatumObservation).payload.field
        : observation.event_type;
    const leg: MarketLeg = {
      venue: observation.venue,
      instrument: observation.instrument,
      assetClass: observation.asset_class,
      series,
    };
    const key = marketLegKey(leg);
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, { leg, observations: [observation] });
    else bucket.observations.push(observation);
  }
  return [...groups.keys()].sort().map((key) => {
    const bucket = groups.get(key) as { leg: MarketLeg; observations: CrossMarketObservation[] };
    return { leg: bucket.leg, observations: deepFreeze(bucket.observations) } as Leg;
  });
}

/** One window's price for one leg (the LAST observation in the window; carried forward). */
function windowPriceSeries(
  leg: Leg,
  windowIndices: readonly number[],
  windowMs: number,
  scale: number,
  rounding: 'half-even' | 'truncate',
): readonly (string | null)[] {
  // last observation (canonical order) whose window index is <= i
  const byWindow = new Map<number, string>();
  for (const observation of leg.observations) {
    const index = Math.floor((observation.available_time as number) / windowMs);
    byWindow.set(index, priceOf(observation, scale, rounding));
  }
  const series: (string | null)[] = [];
  let carried: string | null = null;
  for (const index of windowIndices) {
    const price = byWindow.get(index);
    if (price !== undefined) carried = price;
    series.push(carried);
  }
  return series;
}

/** A leg's qualifying window move: sign + magnitude-ok, or null (no move). */
interface WindowMove {
  readonly sign: 1 | -1;
}

function moveOf(
  current: string | null,
  previous: string | null,
  minMove: string,
  scale: number,
  rounding: 'half-even' | 'truncate',
): WindowMove | null {
  if (current === null || previous === null) return null;
  const move = decimalSub(current, previous, scale, rounding);
  if (compareDecimal(move, '0') === 0) return null;
  const magnitude = decimalAbs(move, scale, rounding);
  const ratio = decimalRatio(magnitude, previous, scale, rounding);
  if (compareDecimal(ratio, minMove) < 0) return null;
  return { sign: compareDecimal(move, '0') > 0 ? 1 : -1 };
}

// ---------------------------------------------------------------------------
// The relationship-analysis stage (declared methods; both legs; windows)
// ---------------------------------------------------------------------------

/** The evidence citations of a pair (canonical order, leg-tagged). */
function pairEvidence(left: Leg, right: Leg): readonly { leg: 'left' | 'right'; observationId: string; availableTime: TimestampMs; provenance: never }[] {
  const citations: { leg: 'left' | 'right'; observationId: string; availableTime: TimestampMs; provenance: never }[] = [];
  for (const observation of left.observations) {
    citations.push({ leg: 'left', observationId: observation.event_id, availableTime: observation.available_time, provenance: observation.provenance as never });
  }
  for (const observation of right.observations) {
    citations.push({ leg: 'right', observationId: observation.event_id, availableTime: observation.available_time, provenance: observation.provenance as never });
  }
  citations.sort((a, b) => {
    if (a.availableTime !== b.availableTime) return a.availableTime < b.availableTime ? -1 : 1;
    return a.observationId < b.observationId ? -1 : a.observationId > b.observationId ? 1 : 0;
  });
  return deepFreeze(citations);
}

/** The confidence assessment from the declared evidence-count/leg-balance bands. */
function confidenceOf(
  registry: CrossMarketMethodRegistry,
  leftCount: number,
  rightCount: number,
): CrossMarketConfidence {
  const confidence = findCrossMarketMethod(registry, 'method/crossmarket/confidence');
  if (confidence === null) throw new Error('the confidence method must be declared');
  const parameters = confidence.parameters as {
    readonly high: { readonly minEvidence: number; readonly maxLegImbalance: number };
    readonly moderate: { readonly minEvidence: number; readonly maxLegImbalance: number };
  };
  const evidenceCount = leftCount + rightCount;
  const imbalance = Math.abs(leftCount - rightCount);
  let level: CrossMarketConfidence['level'];
  if (evidenceCount >= parameters.high.minEvidence && imbalance <= parameters.high.maxLegImbalance) {
    level = 'high';
  } else if (evidenceCount >= parameters.moderate.minEvidence && imbalance <= parameters.moderate.maxLegImbalance) {
    level = 'moderate';
  } else {
    level = 'low';
  }
  return {
    methodId: confidence.methodId,
    methodVersion: confidence.version,
    level,
    evidenceCount,
    legImbalance: imbalance,
  };
}

/**
 * THE RELATIONSHIP-ANALYSIS STAGE: runs every declared relationship
 * method over every qualifying leg pair — the co-movement agreement,
 * the lead-lag asymmetry and the spread divergence, each over declared
 * epoch-aligned windows under the declared price basis. Every threshold
 * and window width comes from the declared method records; pairs that
 * cannot support a method produce structured data gaps. Deterministic:
 * legs and pairs enumerate in canonical key order.
 */
export function runRelationshipAnalysis(
  observations: readonly CrossMarketObservation[],
  registry: CrossMarketMethodRegistry,
  config: CrossMarketRunConfig,
): CrossMarketResult<{
  readonly relationships: readonly CrossMarketRelationship[];
  readonly dataGaps: readonly CrossMarketDataGap[];
}> {
  const coMovement = findCrossMarketMethod(registry, 'method/crossmarket/co-movement');
  const leadLag = findCrossMarketMethod(registry, 'method/crossmarket/lead-lag');
  const spread = findCrossMarketMethod(registry, 'method/crossmarket/spread-divergence');
  if (coMovement === null || leadLag === null || spread === null) {
    return {
      ok: false,
      errors: [
        {
          code: 'undeclared_method',
          path: 'relationshipAnalysis',
          message: 'the co-movement/lead-lag/spread-divergence methods are not declared in the body spec registry — a cross-market measure without a declared method is a naked statistic',
        },
      ],
    };
  }
  const coParameters = coMovement.parameters as CoMovementParameters;
  const lagParameters = leadLag.parameters as LeadLagParameters;
  const spreadParameters = spread.parameters as SpreadDivergenceParameters;

  const relationships: CrossMarketRelationship[] = [];
  const gaps: CrossMarketDataGap[] = [];

  if (observations.length === 0) {
    gaps.push({ kind: 'no-observations', leftInstrument: '', rightInstrument: '' });
    return { ok: true, value: deepFreeze({ relationships: deepFreeze([]), dataGaps: deepFreeze(gaps) }) };
  }

  const legs = legsOf(observations);
  const scale = coParameters.outputScale;
  const rounding = coParameters.rounding;
  const windowMs = coParameters.windowMs; // identical on every declared method (the canonical registry)

  // canonical unordered pair enumeration (left key < right key)
  for (let i = 0; i < legs.length; i += 1) {
    for (let j = i + 1; j < legs.length; j += 1) {
      const left = legs[i] as Leg;
      const right = legs[j] as Leg;
      const pair: MarketPair = { left: left.leg, right: right.leg };

      const leftOk = left.observations.length >= coParameters.minObservationsPerLeg;
      const rightOk = right.observations.length >= coParameters.minObservationsPerLeg;
      if (!leftOk || !rightOk) {
        gaps.push({ kind: 'insufficient-leg-observations', leftInstrument: left.leg.instrument, rightInstrument: right.leg.instrument });
        continue;
      }

      // the epoch-aligned window enumeration over the pair's knowledge-time span
      const minAvailable = Math.min(
        left.observations[0]!.available_time as number,
        right.observations[0]!.available_time as number,
      );
      const maxAvailable = Math.max(
        left.observations[left.observations.length - 1]!.available_time as number,
        right.observations[right.observations.length - 1]!.available_time as number,
      );
      const firstWindow = Math.floor(minAvailable / windowMs);
      const lastWindow = Math.floor(maxAvailable / windowMs);
      const windowIndices: number[] = [];
      for (let index = firstWindow; index <= lastWindow; index += 1) windowIndices.push(index);
      const windows = deepFreeze(windowIndices);

      const leftPrices = windowPriceSeries(left, windows, windowMs, scale, rounding);
      const rightPrices = windowPriceSeries(right, windows, windowMs, scale, rounding);
      const window = {
        from: minAvailable as TimestampMs,
        to: maxAvailable as TimestampMs,
      };
      const evidence = pairEvidence(left, right);
      const confidence = confidenceOf(registry, left.observations.length, right.observations.length);

      // -- co-movement: the directional agreement of the window moves ------
      let agree = 0;
      let disagree = 0;
      for (let index = 1; index < windows.length; index += 1) {
        const leftMove = moveOf(leftPrices[index] ?? null, leftPrices[index - 1] ?? null, coParameters.minMove, scale, rounding);
        const rightMove = moveOf(rightPrices[index] ?? null, rightPrices[index - 1] ?? null, coParameters.minMove, scale, rounding);
        if (leftMove === null || rightMove === null) continue;
        if (leftMove.sign === rightMove.sign) agree += 1;
        else disagree += 1;
      }
      const compared = agree + disagree;
      if (compared >= coParameters.minComparedWindows) {
        const score = decimalRatio(
          decimalSub(String(agree), String(disagree), scale, rounding),
          String(compared),
          scale,
          rounding,
        );
        let direction: 'positive' | 'negative' | 'neutral';
        if (compareDecimal(score, coParameters.directionThresholds.positive) >= 0) direction = 'positive';
        else if (compareDecimal(score, coParameters.directionThresholds.negative) <= 0) direction = 'negative';
        else direction = 'neutral';
        const construction = createCrossMarketRelationship(
          {
            pair,
            relationKind: 'co-movement',
            measure: { methodId: coMovement.methodId, methodVersion: coMovement.version, direction, score },
            window,
            confidence,
            evidence: evidence as never,
            asOf: config.asOf,
            bodyVersion: config.bodyVersion,
            tenantId: config.tenantId,
            projectId: config.projectId,
            seed: config.seed,
          },
          registry,
        );
        if (!construction.ok) return construction;
        relationships.push(construction.value);
      } else {
        gaps.push({ kind: 'insufficient-compared-windows', leftInstrument: left.leg.instrument, rightInstrument: right.leg.instrument });
      }

      // -- lead-lag: which leg's moves are followed by the other's --------
      let leftLeads = 0;
      let rightLeads = 0;
      let decisive = 0;
      for (let index = 1; index < windows.length; index += 1) {
        const leftMove = moveOf(leftPrices[index] ?? null, leftPrices[index - 1] ?? null, lagParameters.minMove, scale, rounding);
        if (leftMove === null) continue;
        decisive += 1;
        const after = rightMoveAt(rightPrices, index + 1, lagParameters.minMove, scale, rounding);
        const before = rightMoveAt(rightPrices, index - 1, lagParameters.minMove, scale, rounding);
        const afterMatches = after !== null && after.sign === leftMove.sign;
        const beforeMatches = before !== null && before.sign === leftMove.sign;
        if (afterMatches && !beforeMatches) leftLeads += 1;
        if (beforeMatches && !afterMatches) rightLeads += 1;
      }
      if (decisive >= lagParameters.minDecisiveWindows) {
        const score = decimalRatio(
          decimalSub(String(leftLeads), String(rightLeads), scale, rounding),
          String(decisive),
          scale,
          rounding,
        );
        let direction: 'left-leads' | 'right-leads' | 'no-lead';
        if (compareDecimal(score, lagParameters.directionThresholds.leftLeads) >= 0) direction = 'left-leads';
        else if (compareDecimal(score, lagParameters.directionThresholds.rightLeads) <= 0) direction = 'right-leads';
        else direction = 'no-lead';
        const construction = createCrossMarketRelationship(
          {
            pair,
            relationKind: 'lead-lag',
            measure: { methodId: leadLag.methodId, methodVersion: leadLag.version, direction, score },
            window,
            confidence,
            evidence: evidence as never,
            asOf: config.asOf,
            bodyVersion: config.bodyVersion,
            tenantId: config.tenantId,
            projectId: config.projectId,
            seed: config.seed,
          },
          registry,
        );
        if (!construction.ok) return construction;
        relationships.push(construction.value);
      } else {
        gaps.push({ kind: 'insufficient-decisive-windows', leftInstrument: left.leg.instrument, rightInstrument: right.leg.instrument });
      }

      // -- spread divergence: the change of the normalized spread ---------
      const leftFirst = leftPrices.find((price): price is string => price !== null);
      const rightFirst = rightPrices.find((price): price is string => price !== null);
      const leftLast = [...leftPrices].reverse().find((price): price is string => price !== null);
      const rightLast = [...rightPrices].reverse().find((price): price is string => price !== null);
      if (leftFirst !== undefined && rightFirst !== undefined && leftLast !== undefined && rightLast !== undefined) {
        const leftReturn = decimalSub(decimalRatio(leftLast, leftFirst, scale, rounding), '1', scale, rounding);
        const rightReturn = decimalSub(decimalRatio(rightLast, rightFirst, scale, rounding), '1', scale, rounding);
        const score = decimalSub(leftReturn, rightReturn, scale, rounding);
        let direction: 'widening' | 'narrowing' | 'stable';
        if (compareDecimal(score, spreadParameters.directionThresholds.widening) >= 0) direction = 'widening';
        else if (compareDecimal(score, spreadParameters.directionThresholds.narrowing) <= 0) direction = 'narrowing';
        else direction = 'stable';
        const construction = createCrossMarketRelationship(
          {
            pair,
            relationKind: 'spread-divergence',
            measure: { methodId: spread.methodId, methodVersion: spread.version, direction, score },
            window,
            confidence,
            evidence: evidence as never,
            asOf: config.asOf,
            bodyVersion: config.bodyVersion,
            tenantId: config.tenantId,
            projectId: config.projectId,
            seed: config.seed,
          },
          registry,
        );
        if (!construction.ok) return construction;
        relationships.push(construction.value);
      }
    }
  }

  // deterministic relationship order: (left key, right key, relation kind)
  relationships.sort((a, b) => {
    const leftKey = marketLegKey(a.pair.left);
    const rightKey = marketLegKey(b.pair.left);
    if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
    const aRight = marketLegKey(a.pair.right);
    const bRight = marketLegKey(b.pair.right);
    if (aRight !== bRight) return aRight < bRight ? -1 : 1;
    return a.relationKind === b.relationKind ? 0 : a.relationKind < b.relationKind ? -1 : 1;
  });
  // canonical gap order: (kind, leftInstrument, rightInstrument)
  gaps.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    if (a.leftInstrument !== b.leftInstrument) return a.leftInstrument < b.leftInstrument ? -1 : 1;
    return a.rightInstrument === b.rightInstrument ? 0 : a.rightInstrument < b.rightInstrument ? -1 : 1;
  });

  return {
    ok: true,
    value: deepFreeze({
      relationships: deepFreeze(relationships),
      dataGaps: deepFreeze(gaps),
    }),
  };
}

/** The right leg's qualifying move at a window index (vs the previous window). */
function rightMoveAt(
  prices: readonly (string | null)[],
  index: number,
  minMove: string,
  scale: number,
  rounding: 'half-even' | 'truncate',
): WindowMove | null {
  if (index <= 0 || index >= prices.length) return null;
  return moveOf(prices[index] ?? null, prices[index - 1] ?? null, minMove, scale, rounding);
}

// ---------------------------------------------------------------------------
// The pipeline (one run of the declared research-cycle procedure)
// ---------------------------------------------------------------------------

/**
 * Runs the full declared pipeline over the injected inputs and returns
 * the run outcome (the published report's id, the publication, the L4
 * accounting, the outputs). Pure and deterministic given (sources'
 * stream, config, body spec).
 */
export function runCrossMarketPipeline(
  config: CrossMarketRunConfig,
  inputs: CrossMarketPipelineInputs,
  bodySpec: CrossMarketResearcherBodySpec = CROSS_MARKET_RESEARCHER_BODY,
): CrossMarketResult<CrossMarketRunOutcome> {
  // THE L8 GATE: the pipeline refuses to run a body spec that grants any
  // execution authority — the read-only declaration is existential.
  const bodyErrors = validateCrossMarketResearcherBody(bodySpec);
  if (bodyErrors.length > 0) {
    return { ok: false, errors: bodyErrors.map((e) => ({ ...e, path: `bodySpec.${e.path}` })) };
  }
  const configErrors = validateCrossMarketRunConfig(config);
  if (configErrors.length > 0) return { ok: false, errors: configErrors };
  const registry: CrossMarketMethodRegistry = bodySpec.research.methodRegistry;

  // stage 1: intake + the L4 gate
  const intake = runCrossMarketIntake(inputs.sources, config.asOf);
  if (!intake.ok) return intake;

  // stage 2: analyze relationships (over the admitted, canonically ordered set)
  const analysis = runRelationshipAnalysis(intake.value.admitted, registry, config);
  if (!analysis.ok) return analysis;

  // stage 3: compose (summary re-derivation happens inside the factory)
  const composition = findCrossMarketMethod(registry, 'method/crossmarket/report-composition');
  if (composition === null) {
    return {
      ok: false,
      errors: [
        {
          code: 'undeclared_method',
          path: 'composition',
          message: 'the report-composition method is not declared in the body spec registry',
        },
      ],
    };
  }
  const summary = composeCrossMarketSummary({
    relationships: analysis.value.relationships,
    coverage: intake.value.coverage,
    dataGaps: analysis.value.dataGaps,
  });
  const report = createCrossMarketResearchReport(
    {
      asOf: config.asOf,
      bodyVersion: config.bodyVersion,
      methodId: composition.methodId,
      methodVersion: composition.version,
      tenantId: config.tenantId,
      projectId: config.projectId,
      seed: config.seed,
      relationships: analysis.value.relationships,
      summary,
    },
    registry,
  );
  if (!report.ok) return report;

  // stage 4: publish — ONLY through the injected envelope-mirror port
  const publication = buildCrossMarketPublication({
    opId: config.opId,
    topic: config.topic,
    tenantId: config.tenantId,
    sender: config.sender,
    report: report.value,
    sequence: config.publicationSequence,
    publishedAt: config.publishedAt,
  });
  if (!publication.ok) return publication;
  const publicationErrors = validateCrossMarketPublication(publication.value, registry);
  if (publicationErrors.length > 0) return { ok: false, errors: publicationErrors };
  const receipt = inputs.publisher.publish(publication.value);
  if (!receipt.ok) return receipt;

  return {
    ok: true,
    value: deepFreeze({
      reportId: report.value.reportId,
      publication: publication.value,
      coverage: intake.value.coverage,
      deferred: intake.value.deferred,
      unsupported: intake.value.unsupported,
      relationships: analysis.value.relationships,
      dataGaps: analysis.value.dataGaps,
    }),
  };
}

/** Canonical serialization of a run config (byte-deterministic, L9). */
export function serializeCrossMarketRunConfig(config: CrossMarketRunConfig): string {
  return canonicalJson(config as never);
}
