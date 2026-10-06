// @tradrl/example-e2e-trading — STAGE 6: THE FOUR RESEARCH LANES.
//
// Point-in-time research over the reactive world's admitted observations
// (L4: only events whose available_time <= the decision instant are
// visible). Each lane mirrors its REAL body's derivation law and cites
// the REAL method registries' method ids/versions, so the interop test
// can push these reports through the real validators:
//   - sentiment  (T021): mean/dispersion aggregation, threshold-derived
//     polarity, intensity bands, evidence-count confidence.
//   - regime     (T022): window statistics -> closed-taxonomy labels.
//   - fundamental(T023): stance from declared thresholds.
//   - cross-market(T023): 60s co-movement windows, directional agreement.
// Derived ids follow the bodies' law: '<prefix>-' + 16-hex digest of the
// canonical form WITHOUT the id field.

import {
  add, compare, decimalDispersionHalfEven, decimalMeanHalfEven, divideRoundHalfEven,
  signedSubtract, subtract,
} from './decimals';
import { canonicalJson, deepFreeze, stableDigest16Json, type JsonValue } from './primitives';
import type { MarketEventMirror } from './mirrors/market';
import type {
  CorporateActionDigestMirror, CrossMarketRelationshipMirror, FundamentalAssessmentMirror,
} from './mirrors/research';
import type {
  CitationMirror, CrossMarketReportMirror, EventDigestMirror, FundamentalReportMirror,
  IntakeCoverageMirror, RegimeChangeMirror, RegimeReportMirror, ResearchIntakeMirror,
  SentimentReportMirror,
} from './mirrors/research';
import type { ReactiveWorld } from './world';

const OUTPUT_SCALE = 4;

// Method citations (the REAL bodies' registries).
const M = {
  sentimentAggregation: { methodId: 'method/sentiment/aggregation', methodVersion: '1.0.0' },
  sentimentEventDetection: { methodId: 'method/sentiment/event-detection', methodVersion: '1.0.0' },
  sentimentConfidence: { methodId: 'method/sentiment/confidence', methodVersion: '1.0.0' },
  sentimentReport: { methodId: 'method/sentiment/report-composition', methodVersion: '1.0.0' },
  regimeClassification: { methodId: 'method/regime/classification', methodVersion: '1.0.0' },
  regimeChange: { methodId: 'method/regime/change-detection', methodVersion: '1.0.0' },
  regimeConfidence: { methodId: 'method/regime/confidence', methodVersion: '1.0.0' },
  regimeReport: { methodId: 'method/regime/report-composition', methodVersion: '1.0.0' },
  fundamentalValuation: { methodId: 'method/fundamental/valuation', methodVersion: '1.0.0' },
  fundamentalMacro: { methodId: 'method/fundamental/macro-surprise', methodVersion: '1.0.0' },
  fundamentalConfidence: { methodId: 'method/fundamental/confidence', methodVersion: '1.0.0' },
  fundamentalReport: { methodId: 'method/fundamental/report-composition', methodVersion: '1.0.0' },
  crossCoMovement: { methodId: 'method/crossmarket/co-movement', methodVersion: '1.0.0' },
  crossConfidence: { methodId: 'method/crossmarket/confidence', methodVersion: '1.0.0' },
  crossReport: { methodId: 'method/crossmarket/report-composition', methodVersion: '1.0.0' },
} as const;

const EMPTY_COVERAGE: IntakeCoverageMirror = {
  observationsOffered: 0, observationsAdmitted: 0, observationsDeferred: 0,
  observationsUnsupported: 0, observationsInvalid: 0,
};

function coverageOf(offered: number, admitted: number): IntakeCoverageMirror {
  return { ...EMPTY_COVERAGE, observationsOffered: offered, observationsAdmitted: admitted };
}

function citationOf(event: MarketEventMirror): CitationMirror {
  return { observationId: event.event_id, availableTime: event.available_time, provenance: event.provenance };
}

function deriveId(prefix: string, content: Record<string, unknown>, idField: string): string {
  const material: Record<string, unknown> = { ...content };
  delete material[idField];
  return `${prefix}-${stableDigest16Json(material as JsonValue)}`;
}

/** The events visible in the window (L4 inclusive at the decision instant). */
export function visibleEvents(world: ReactiveWorld, from: number, to: number): readonly MarketEventMirror[] {
  return world.observations
    .filter((observation) => observation.available_time >= from && observation.available_time <= to)
    .map((observation) => observation.payload as MarketEventMirror)
    .sort((a, b) =>
      a.available_time === b.available_time ? (a.event_id < b.event_id ? -1 : 1) : a.available_time - b.available_time,
    );
}

export interface ResearchRunConfig {
  readonly asOf: number;
  readonly windowFrom: number;
  readonly tenant: string;
  readonly project: string;
  readonly seed: string;
}

// ---------------------------------------------------------------------------
// Sentiment lane
// ---------------------------------------------------------------------------

const SENTIMENT_POLARITY_PRECEDENCE = ['positive', 'negative', 'mixed', 'neutral'] as const;

export function runSentimentResearch(world: ReactiveWorld, config: ResearchRunConfig): SentimentReportMirror {
  const events = visibleEvents(world, config.windowFrom, config.asOf);
  const sentimentEvents = events.filter(
    (event): event is Extract<MarketEventMirror, { event_type: 'news' | 'social_signal' }> =>
      event.event_type === 'news' || event.event_type === 'social_signal',
  );
  const groups = new Map<string, typeof sentimentEvents>();
  for (const event of sentimentEvents) {
    const key = `${event.instrument}|${event.venue}`;
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [event]);
    else bucket.push(event);
  }

  const readings = [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, bucket]) => {
      const [instrument, venue] = key.split('|') as [string, string];
      const scores = bucket.map((event) => (event.event_type === 'news' ? event.payload.sentiment_score : event.payload.sentiment_score));
      const mean = decimalMeanHalfEven(scores, OUTPUT_SCALE)!;
      const dispersion = decimalDispersionHalfEven(scores, OUTPUT_SCALE);
      // Polarity — the validator law: neutral scores MUST be exactly zero.
      let direction: 'positive' | 'negative' | 'mixed' | 'neutral';
      let recordedScore: string;
      if (compare(mean, '0.05') >= 0) {
        direction = 'positive';
        recordedScore = mean;
      } else if (compare(mean, '-0.05') <= 0) {
        direction = 'negative';
        recordedScore = mean;
      } else if (dispersion !== null && compare(dispersion, '0.2') > 0) {
        direction = 'mixed';
        recordedScore = mean;
      } else {
        direction = 'neutral';
        recordedScore = '0';
      }
      const magnitude = mean.startsWith('-') ? mean.slice(1) : mean;
      const level: 'high' | 'moderate' | 'low' = compare(magnitude, '0.5') >= 0 ? 'high' : compare(magnitude, '0.2') >= 0 ? 'moderate' : 'low';
      const count = bucket.length;
      const confidenceLevel: 'high' | 'moderate' | 'low' =
        count >= 3 && dispersion !== null && compare(dispersion, '0.2') <= 0
          ? 'high'
          : count >= 2 && dispersion !== null && compare(dispersion, '0.5') <= 0
            ? 'moderate'
            : 'low';
      const content = {
        scope: { instrument, venue },
        polarity: { ...M.sentimentAggregation, direction, score: recordedScore },
        intensity: { ...M.sentimentAggregation, level, score: magnitude },
        confidence: { ...M.sentimentConfidence, level: confidenceLevel, evidenceCount: count, dispersion },
        evidence: bucket.map(citationOf),
        asOf: config.asOf,
        bodyVersion: 'sentiment-researcher@1.0.0',
        tenantId: config.tenant,
        projectId: config.project,
        seed: config.seed,
      };
      return deepFreeze({ ...content, readingId: deriveId('sr', content, 'readingId') });
    });

  // Event digests: one per event kind over the window.
  const kinds = [...new Set(sentimentEvents.map((event) => event.event_type))].sort();
  const digests: EventDigestMirror[] = kinds.map((kind) => {
    const bucket = sentimentEvents.filter((event) => event.event_type === kind);
    const content = {
      kind,
      instruments: [...new Set(bucket.map((event) => event.instrument))].sort(),
      venues: [...new Set(bucket.map((event) => event.venue))].sort(),
      window: { from: config.windowFrom, to: config.asOf },
      observationCount: bucket.length,
      evidence: bucket.map(citationOf),
      asOf: config.asOf,
      ...M.sentimentEventDetection,
      bodyVersion: 'sentiment-researcher@1.0.0',
      tenantId: config.tenant,
      projectId: config.project,
      seed: config.seed,
    };
    return deepFreeze({ ...content, digestId: deriveId('ed', content, 'digestId') });
  });

  // Summary — the bodies' composition law.
  const counts = new Map<string, number>();
  for (const reading of readings) counts.set(reading.polarity.direction, (counts.get(reading.polarity.direction) ?? 0) + 1);
  let dominant: string = 'no-reading';
  let bestCount = -1;
  for (const direction of SENTIMENT_POLARITY_PRECEDENCE) {
    const count = counts.get(direction) ?? 0;
    if (count > bestCount) {
      dominant = direction;
      bestCount = count;
    }
  }
  const instruments = new Set<string>([...readings.map((r) => r.scope.instrument), ...digests.flatMap((d) => d.instruments)]);
  const summary = {
    readingCount: readings.length,
    digestCount: digests.length,
    instrumentCount: instruments.size,
    dominantPolarity: dominant,
    meanPolarityScore: decimalMeanHalfEven(readings.map((reading) => reading.polarity.score), OUTPUT_SCALE),
    coverage: coverageOf(events.length, sentimentEvents.length),
    dataGaps: readings.length === 0 ? [{ kind: 'no-sentiment-observations', instrument: '*' }] : [],
  };
  const content = {
    asOf: config.asOf,
    bodyVersion: 'sentiment-researcher@1.0.0',
    ...M.sentimentReport,
    tenantId: config.tenant,
    projectId: config.project,
    seed: config.seed,
    readings,
    digests,
    summary,
  };
  return deepFreeze({ ...content, reportId: deriveId('rr', content, 'reportId') });
}

// ---------------------------------------------------------------------------
// Regime lane
// ---------------------------------------------------------------------------

const REGIME_TAXONOMY = ['trending-up', 'trending-down', 'ranging', 'volatile', 'quiet'] as const;

function classifyRegimeWindow(netMoveRatio: string, meanAbsChangeRatio: string): string {
  const netMagnitude = netMoveRatio.startsWith('-') ? netMoveRatio.slice(1) : netMoveRatio;
  if (compare(netMagnitude, '0.03') >= 0) return compare(netMoveRatio, '0') >= 0 ? 'trending-up' : 'trending-down';
  if (compare(meanAbsChangeRatio, '0.01') >= 0) return 'volatile';
  if (compare(meanAbsChangeRatio, '0.001') <= 0) return 'quiet';
  return 'ranging';
}

export function runRegimeResearch(world: ReactiveWorld, config: ResearchRunConfig): RegimeReportMirror {
  const events = visibleEvents(world, config.windowFrom, config.asOf);
  const tradeEvents = events.filter((event): event is Extract<MarketEventMirror, { event_type: 'trade' }> => event.event_type === 'trade');
  const groups = new Map<string, typeof tradeEvents>();
  for (const event of tradeEvents) {
    const key = `${event.instrument}|${event.venue}`;
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [event]);
    else bucket.push(event);
  }

  const classifications = [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, bucket]) => {
      const [instrument, venue] = key.split('|') as [string, string];
      const prices = bucket.map((event) => event.payload.price);
      const first = prices[0]!;
      const last = prices[prices.length - 1]!;
      const netMove = signedSubtract(last, first);
      const netMoveRatio = divideRoundHalfEven(netMove, first, OUTPUT_SCALE);
      const absoluteChanges: string[] = [];
      for (let index = 1; index < prices.length; index++) {
        const change = signedSubtract(prices[index]!, prices[index - 1]!);
        absoluteChanges.push(change.startsWith('-') ? change.slice(1) : change);
      }
      const meanAbsChange = decimalMeanHalfEven(absoluteChanges, OUTPUT_SCALE) ?? '0';
      const meanAbsChangeRatio = divideRoundHalfEven(meanAbsChange, first, OUTPUT_SCALE);
      const label = classifyRegimeWindow(netMoveRatio, meanAbsChangeRatio);
      type RegimeLabel = (typeof REGIME_TAXONOMY)[number];
      const typedLabel: RegimeLabel = label as RegimeLabel;
      const dispersionPrices = decimalDispersionHalfEven(prices, OUTPUT_SCALE);
      const dispersionRatio = dispersionPrices === null ? null : divideRoundHalfEven(dispersionPrices, first, OUTPUT_SCALE);
      const evidenceCount = bucket.length;
      const confidenceLevel: 'high' | 'moderate' | 'low' =
        evidenceCount >= 5 && dispersionRatio !== null && compare(dispersionRatio, '0.2') <= 0
          ? 'high'
          : evidenceCount >= 3 && dispersionRatio !== null && compare(dispersionRatio, '0.5') <= 0
            ? 'moderate'
            : 'low';
      const content = {
        scope: { instrument, venue },
        label: typedLabel,
        netMoveRatio,
        meanAbsChangeRatio,
        window: { from: config.windowFrom, to: config.asOf },
        observationCount: evidenceCount,
        evidence: bucket.map(citationOf),
        confidence: { ...M.regimeConfidence, level: confidenceLevel, evidenceCount, dispersion: dispersionRatio },
        asOf: config.asOf,
        ...M.regimeClassification,
        bodyVersion: 'regime-researcher@1.0.0',
        tenantId: config.tenant,
        projectId: config.project,
        seed: config.seed,
      };
      return deepFreeze({ ...content, classificationId: deriveId('rc', content, 'classificationId') });
    });

  const changes: RegimeChangeMirror[] = []; // window-uniform classification: no intra-window label transition
  const counts = new Map<string, number>();
  for (const classification of classifications) counts.set(classification.label, (counts.get(classification.label) ?? 0) + 1);
  let dominant: string = 'no-classification';
  let bestCount = -1;
  for (const label of REGIME_TAXONOMY) {
    const count = counts.get(label) ?? 0;
    if (count > bestCount) {
      dominant = label;
      bestCount = count;
    }
  }
  const summary = {
    classificationCount: classifications.length,
    changeCount: changes.length,
    instrumentCount: new Set(classifications.map((c) => c.scope.instrument)).size,
    windowCount: classifications.length,
    dominantRegime: dominant,
    meanNetMoveRatio: decimalMeanHalfEven(classifications.map((c) => c.netMoveRatio), OUTPUT_SCALE),
    coverage: coverageOf(events.length, tradeEvents.length),
    dataGaps: classifications.length === 0 ? [{ kind: 'no-market-observations', instrument: '*' }] : [],
  };
  const content = {
    asOf: config.asOf,
    bodyVersion: 'regime-researcher@1.0.0',
    ...M.regimeReport,
    tenantId: config.tenant,
    projectId: config.project,
    seed: config.seed,
    classifications,
    changes,
    summary,
  };
  return deepFreeze({ ...content, reportId: deriveId('rr', content, 'reportId') });
}

// ---------------------------------------------------------------------------
// Fundamental lane
// ---------------------------------------------------------------------------

const FUNDAMENTAL_STANCE_PRECEDENCE = ['positive', 'negative', 'neutral'] as const;

export function runFundamentalResearch(world: ReactiveWorld, config: ResearchRunConfig): FundamentalReportMirror {
  const events = visibleEvents(world, config.windowFrom, config.asOf);
  const fundamentalEvents = events.filter(
    (event): event is Extract<MarketEventMirror, { event_type: 'fundamental' | 'macro_release' }> =>
      event.event_type === 'fundamental' || event.event_type === 'macro_release',
  );

  const assessments: FundamentalAssessmentMirror[] = fundamentalEvents
    .map((event) => {
      const isMacro = event.event_type === 'macro_release';
      const series = isMacro ? event.payload.indicator : event.payload.series;
      const assessmentKind = isMacro ? 'macro-surprise' : event.payload.assessment_kind;
      const score = isMacro ? event.payload.surprise : event.payload.surprise_score;
      const thresholds = isMacro ? { positive: '0.005', negative: '-0.005' } : { positive: '0.02', negative: '-0.02' };
      const direction: 'positive' | 'negative' | 'neutral' = compare(score, thresholds.positive) >= 0 ? 'positive' : compare(score, thresholds.negative) <= 0 ? 'negative' : 'neutral';
      const method = isMacro ? M.fundamentalMacro : M.fundamentalValuation;
      const content = {
        scope: { instrument: event.instrument, series },
        assessmentKind,
        stance: { ...method, direction, score },
        confidence: { ...M.fundamentalConfidence, level: 'moderate' as const, evidenceCount: 1, dispersion: null },
        evidence: [citationOf(event)],
        asOf: config.asOf,
        bodyVersion: 'fundamental-researcher@1.0.0',
        tenantId: config.tenant,
        projectId: config.project,
        seed: config.seed,
      };
      return deepFreeze({ ...content, assessmentId: deriveId('fa', content, 'assessmentId') });
    })
    .sort((a, b) => (a.assessmentId < b.assessmentId ? -1 : 1));

  const actionDigests: CorporateActionDigestMirror[] = []; // no corporate-action events in the reference scenario
  const counts = new Map<string, number>();
  for (const assessment of assessments) counts.set(assessment.stance.direction, (counts.get(assessment.stance.direction) ?? 0) + 1);
  let dominant: string = 'no-assessment';
  let bestCount = -1;
  for (const direction of FUNDAMENTAL_STANCE_PRECEDENCE) {
    const count = counts.get(direction) ?? 0;
    if (count > bestCount) {
      dominant = direction;
      bestCount = count;
    }
  }
  const summary = {
    assessmentCount: assessments.length,
    actionDigestCount: actionDigests.length,
    instrumentCount: new Set(assessments.map((a) => a.scope.instrument)).size,
    dominantStance: dominant,
    meanStanceScore: decimalMeanHalfEven(assessments.map((a) => a.stance.score), OUTPUT_SCALE),
    coverage: coverageOf(events.length, fundamentalEvents.length),
    dataGaps: assessments.length === 0 ? [{ kind: 'no-fundamental-observations', instrument: '*' }] : [],
  };
  const content = {
    asOf: config.asOf,
    bodyVersion: 'fundamental-researcher@1.0.0',
    ...M.fundamentalReport,
    tenantId: config.tenant,
    projectId: config.project,
    seed: config.seed,
    assessments,
    actionDigests,
    summary,
  };
  return deepFreeze({ ...content, reportId: deriveId('frr', content, 'reportId') });
}

// ---------------------------------------------------------------------------
// Cross-market lane
// ---------------------------------------------------------------------------

const CROSSMARKET_PRECEDENCE = ['co-movement', 'lead-lag', 'spread-divergence'] as const;
const CROSS_WINDOW_MS = 60_000;

export function runCrossMarketResearch(world: ReactiveWorld, config: ResearchRunConfig): CrossMarketReportMirror {
  const events = visibleEvents(world, config.windowFrom, config.asOf);
  const tradeEvents = events.filter((event): event is Extract<MarketEventMirror, { event_type: 'trade' }> => event.event_type === 'trade');
  const instruments = [...new Set(tradeEvents.map((event) => event.instrument))].sort();
  const relationships: CrossMarketRelationshipMirror[] = [];

  if (instruments.length >= 2) {
    const [leftId, rightId] = [instruments[0]!, instruments[1]!];
    const leftVenue = tradeEvents.find((event) => event.instrument === leftId)!.venue;
    const rightVenue = tradeEvents.find((event) => event.instrument === rightId)!.venue;
    const leftPrices = tradeEvents.filter((event) => event.instrument === leftId);
    const rightPrices = tradeEvents.filter((event) => event.instrument === rightId);

    // 60s comparison windows; each window's per-leg move (last vs first).
    const windowStart = Math.floor(config.windowFrom / CROSS_WINDOW_MS) * CROSS_WINDOW_MS;
    const windows: { readonly start: number; readonly left: string | null; readonly right: string | null }[] = [];
    for (let start = windowStart; start < config.asOf; start += CROSS_WINDOW_MS) {
      const end = start + CROSS_WINDOW_MS;
      const inWindow = (list: readonly MarketEventMirror[]): { move: string } | null => {
        const bucket = list.filter((event) => event.available_time >= start && event.available_time < end);
        if (bucket.length < 2) return null;
        const trades = bucket.filter((event): event is Extract<MarketEventMirror, { event_type: 'trade' }> => event.event_type === 'trade');
        if (trades.length < 2) return null;
        const first = trades[0]!.payload.price;
        const last = trades[trades.length - 1]!.payload.price;
        const move = divideRoundHalfEven(signedSubtract(last, first), first, OUTPUT_SCALE);
        return { move };
      };
      windows.push({ start, left: inWindow(leftPrices)?.move ?? null, right: inWindow(rightPrices)?.move ?? null });
    }
    const compared = windows.filter(
      (window) =>
        window.left !== null && window.right !== null &&
        compare(window.left.startsWith('-') ? window.left.slice(1) : window.left, '0.005') >= 0 &&
        compare(window.right.startsWith('-') ? window.right.slice(1) : window.right, '0.005') >= 0,
    );
    if (compared.length >= 2) {
      let matches = 0;
      for (const window of compared) {
        const leftSign = compare(window.left!, '0') >= 0 ? 1 : -1;
        const rightSign = compare(window.right!, '0') >= 0 ? 1 : -1;
        if (leftSign === rightSign) matches += 1;
      }
      const agreement = divideRoundHalfEven(
        signedSubtract(String(matches), String(compared.length - matches)),
        String(compared.length),
        OUTPUT_SCALE,
      );
      const direction = compare(agreement, '0.2') >= 0 ? 'positive' : compare(agreement, '-0.2') <= 0 ? 'negative' : 'none';
      const evidence = [
        ...leftPrices.map((event) => ({ leg: 'left' as const, observationId: event.event_id, availableTime: event.available_time, provenance: event.provenance })),
        ...rightPrices.map((event) => ({ leg: 'right' as const, observationId: event.event_id, availableTime: event.available_time, provenance: event.provenance })),
      ];
      const content = {
        pair: {
          left: { venue: leftVenue, instrument: leftId, assetClass: 'crypto', series: 'trade-price' },
          right: { venue: rightVenue, instrument: rightId, assetClass: 'crypto', series: 'trade-price' },
        },
        relationKind: 'co-movement' as const,
        measure: { ...M.crossCoMovement, direction, score: agreement },
        window: { from: config.windowFrom, to: config.asOf },
        confidence: { ...M.crossConfidence, level: 'moderate' as const, evidenceCount: leftPrices.length + rightPrices.length, legImbalance: Math.abs(leftPrices.length - rightPrices.length) },
        evidence,
        asOf: config.asOf,
        bodyVersion: 'cross-market-researcher@1.0.0',
        tenantId: config.tenant,
        projectId: config.project,
        seed: config.seed,
      };
      relationships.push(deepFreeze({ ...content, relationshipId: deriveId('cmr', content, 'relationshipId') }));
    }
  }

  const counts = new Map<string, number>();
  for (const relationship of relationships) counts.set(relationship.relationKind, (counts.get(relationship.relationKind) ?? 0) + 1);
  let dominant: string = 'no-relationship';
  let bestCount = -1;
  for (const kind of CROSSMARKET_PRECEDENCE) {
    const count = counts.get(kind) ?? 0;
    if (count > bestCount) {
      dominant = kind;
      bestCount = count;
    }
  }
  const summary = {
    relationshipCount: relationships.length,
    pairCount: relationships.length,
    instrumentCount: new Set(relationships.flatMap((r) => [r.pair.left.instrument, r.pair.right.instrument])).size,
    dominantRelationKind: dominant,
    meanMeasureScore: decimalMeanHalfEven(relationships.map((r) => r.measure.score), OUTPUT_SCALE),
    coverage: coverageOf(events.length, tradeEvents.length),
    dataGaps: relationships.length === 0 ? [{ kind: 'no-relationship-observations', instrument: '*' }] : [],
  };
  const content = {
    asOf: config.asOf,
    bodyVersion: 'cross-market-researcher@1.0.0',
    ...M.crossReport,
    tenantId: config.tenant,
    projectId: config.project,
    seed: config.seed,
    relationships,
    summary,
  };
  return deepFreeze({ ...content, reportId: deriveId('cmrr', content, 'reportId') });
}

/** Runs all four lanes for one decision instant. */
export function runResearch(
  world: ReactiveWorld,
  config: ResearchRunConfig,
): ResearchIntakeMirror {
  return deepFreeze({
    sentiment: runSentimentResearch(world, config),
    regime: runRegimeResearch(world, config),
    fundamental: runFundamentalResearch(world, config),
    crossMarket: runCrossMarketResearch(world, config),
  });
}

export const RESEARCH_METHOD_CITATIONS = M;
