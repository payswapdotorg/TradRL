// @tradrl/body-cross-market-researcher — the deterministic fixture set.
//
// Owning Work Order: T023. Every fixture is DETERMINISTIC (no clocks, no
// randomness — literal instants and literal ids), and every fixture is
// re-validated by the real guards in the tests. The golden records are
// built through the real factories so their derived ids are honest.
//
// THE GOLDEN STORY: three market legs observed over four epoch-aligned
// windows (windowMs = 60_000; w0..w3):
//   - TEST-LARGECAP index levels (reported fundamentals, rising +1/window);
//   - TEST-AAA equity trades (rising +1/window, synchronized);
//   - TEST-CHAIN-A crypto trades (flat at 200).
// The canonical pair order (leg keys sorted) yields three pairs:
//   (CHAIN-A, LARGECAP), (CHAIN-A, TESTEX-AAA), (LARGECAP, TESTEX-AAA).
// The declared methods derive FIVE relationships:
//   - pair 1 spread-divergence: left flat, right +3% -> score -0.0300 (narrowing);
//   - pair 2 spread-divergence: left flat, right +6% -> score -0.0600 (narrowing);
//   - pair 3 co-movement:      3/3 agreeing windows -> score 1.0000 (positive);
//   - pair 3 lead-lag:         1 left-lead, 1 right-lead, 1 undecided -> 0.0000 (no-lead);
//   - pair 3 spread-divergence: +3% vs +6% -> score -0.0300 (narrowing);
// and FOUR data gaps (the flat leg yields no compared windows and no
// decisive windows for pairs 1 and 2).
//
// The violation fixtures exist for the NEGATIVE paths: an evidence-less
// relationship, a one-legged relationship, a future citation, an
// undeclared method, a kind mismatch, a direction inconsistent with the
// declared decision function, a self-paired relationship, a tampered
// record, a body spec edited to grant execution authority, a body spec
// citing a model identity as evaluation evidence — each must FAIL
// validation with its typed code (the acceptance criteria).
//
// (Type note: fixture literals are authored as plain records and cast to
// the branded contract types once — the brands are compile-time only.)

import { type TimestampMs, deepFreeze } from './primitives';
import { type BodyVersionRef, type EvaluationCriteriaRef, type CrossMarketMethodId, type CrossMarketMethodVersionRef, type ProjectId, type TenantId, type TopicName, type ToolRef } from './ids';
import { type CrossMarketObservation, type TradeObservation, type FundamentalDatumObservation, type ObservationProvenance } from './observations';
import { type ObservationCitation, type MarketLeg, type CrossMarketRelationship, createCrossMarketRelationship } from './relationship';
import { type CrossMarketResearchReport, createCrossMarketResearchReport, type CoverageAccounting, type CrossMarketDataGap } from './report';
import {
  CROSS_MARKET_RESEARCHER_BODY,
  type CrossMarketResearcherBodySpec,
} from './body';
import {
  type CrossMarketMethodRegistry,
  CROSS_MARKET_METHOD_REGISTRY,
  CROSS_MARKET_CO_MOVEMENT_METHOD,
  CROSS_MARKET_LEAD_LAG_METHOD,
  CROSS_MARKET_SPREAD_DIVERGENCE_METHOD,
  CROSS_MARKET_CONFIDENCE_METHOD,
  CROSS_MARKET_REPORT_COMPOSITION_METHOD,
} from './methods';

// ---------------------------------------------------------------------------
// The fixture world (literal instants — no ambient clock anywhere)
// ---------------------------------------------------------------------------

/**
 * The fixture epoch anchor (2024-06-03T16:00:00Z — an even minute, so the
 * declared 60_000ms windows align exactly on w0).
 */
export const FIXTURE_AT0: TimestampMs = 1_717_423_200_000 as TimestampMs;

/** The declared alignment window width (matches the canonical methods). */
export const FIXTURE_WINDOW_MS = 60_000;

/** The fixture as-of instant: four windows later. */
export const FIXTURE_AS_OF: TimestampMs = (1_717_423_200_000 + 240_000) as TimestampMs;

/** The fixture tenant (L12). */
export const FIXTURE_TENANT: TenantId = 'tenant-research' as TenantId;

/** The fixture project (L12). */
export const FIXTURE_PROJECT: ProjectId = 'project-crossmarket' as ProjectId;

/** The fixture run seed (lineage material — L9). */
export const FIXTURE_SEED = 'seed/crossmarket/fixture-1';

/** The fixture body-version reference. */
export const FIXTURE_BODY_VERSION: BodyVersionRef = 'cross-market-researcher@1.0.0' as BodyVersionRef;

/** The fixture publishing instance (an agent-os AgentInstanceId shape). */
export const FIXTURE_SENDER = 'agent-instance-crossmarket-0001';

/** The fixture publication topic (an organization topic — never kernel.*). */
export const FIXTURE_TOPIC = 'research.crossmarket';

/** Casts a literal epoch-millisecond number to `TimestampMs` (fixture discipline). */
const ms = (value: number): TimestampMs => value as TimestampMs;

/** The historical provenance block of the licensed index feed lane. */
export const FIXTURE_INDEX_PROVENANCE: ObservationProvenance = deepFreeze({
  origin: 'historical',
  adapter: { id: 'adapter-equities', version: '1.0.0' },
  derived_from: [],
  transform: null,
} as ObservationProvenance);

/** The historical provenance block of the venue market-data lane. */
export const FIXTURE_VENUE_PROVENANCE: ObservationProvenance = deepFreeze({
  origin: 'historical',
  adapter: { id: 'adapter-venue', version: '1.0.0' },
  derived_from: [],
  transform: null,
} as ObservationProvenance);

// ---------------------------------------------------------------------------
// Observation fixtures (quartets + provenance; T038 emitter shapes)
// ---------------------------------------------------------------------------

/** Builds a canonical reported-fundamental observation fixture. */
export function fixtureFundamentalObservation(input: {
  readonly eventId: string;
  readonly at: TimestampMs;
  readonly instrument: string;
  readonly assetClass?: 'index' | 'commodity' | 'equity';
  readonly venue?: string;
  readonly field: string;
  readonly period: string;
  readonly value: string;
  readonly sequence?: number;
}): FundamentalDatumObservation {
  return deepFreeze({
    event_id: input.eventId,
    venue: input.venue ?? 'LICENSED-INDEX-A',
    instrument: input.instrument,
    asset_class: input.assetClass ?? 'index',
    event_type: 'fundamental',
    event_time: input.at,
    source_time: input.at,
    available_time: input.at,
    ingestion_time: ms((input.at as number) + 1_000),
    sequence: input.sequence ?? 1,
    provider: 'licensed-index-a',
    provenance: FIXTURE_INDEX_PROVENANCE,
    payload: deepFreeze(
      input.field === 'INDEX_LEVEL'
        ? { field: input.field, period: input.period, value: input.value, unit: 'index-points', source: 'index-dissemination' }
        : { field: input.field, period: input.period, value: input.value },
    ),
  });
}

/** Builds a canonical trade observation fixture. */
export function fixtureTradeObservation(input: {
  readonly eventId: string;
  readonly at: TimestampMs;
  readonly instrument: string;
  readonly venue: string;
  readonly assetClass: 'equity' | 'crypto' | 'commodity' | 'forex' | 'future';
  readonly price: string;
  readonly sequence?: number;
}): TradeObservation {
  return deepFreeze({
    event_id: input.eventId,
    venue: input.venue,
    instrument: input.instrument,
    asset_class: input.assetClass,
    event_type: 'trade',
    event_time: input.at,
    source_time: input.at,
    available_time: input.at,
    ingestion_time: ms((input.at as number) + 1_000),
    sequence: input.sequence ?? 1,
    provider: 'venue-market-data-a',
    provenance: FIXTURE_VENUE_PROVENANCE,
    payload: deepFreeze({
      price: input.price,
      size: '100.0000',
      side: 'buy',
    }),
  });
}

const w = (index: number): TimestampMs => ms(1_717_423_200_000 + index * FIXTURE_WINDOW_MS);

/** The TEST-LARGECAP leg: rising index levels across the four windows. */
export const FIXTURE_LARGECAP_OBSERVATIONS: readonly FundamentalDatumObservation[] = deepFreeze([
  fixtureFundamentalObservation({ eventId: 'obs-cm-lx-001', at: w(0), instrument: 'TEST-LARGECAP', field: 'INDEX_LEVEL', period: '2024-06-03', value: '100.0000', sequence: 1 }),
  fixtureFundamentalObservation({ eventId: 'obs-cm-lx-002', at: w(1), instrument: 'TEST-LARGECAP', field: 'INDEX_LEVEL', period: '2024-06-03', value: '101.0000', sequence: 2 }),
  fixtureFundamentalObservation({ eventId: 'obs-cm-lx-003', at: w(2), instrument: 'TEST-LARGECAP', field: 'INDEX_LEVEL', period: '2024-06-03', value: '102.0000', sequence: 3 }),
  fixtureFundamentalObservation({ eventId: 'obs-cm-lx-004', at: w(3), instrument: 'TEST-LARGECAP', field: 'INDEX_LEVEL', period: '2024-06-03', value: '103.0000', sequence: 4 }),
]);

/** The TEST-AAA leg: rising equity trades, synchronized with the index. */
export const FIXTURE_AAA_OBSERVATIONS: readonly TradeObservation[] = deepFreeze([
  fixtureTradeObservation({ eventId: 'obs-cm-aa-001', at: w(0), instrument: 'TEST-AAA', venue: 'TESTEX', assetClass: 'equity', price: '50.0000', sequence: 1 }),
  fixtureTradeObservation({ eventId: 'obs-cm-aa-002', at: w(1), instrument: 'TEST-AAA', venue: 'TESTEX', assetClass: 'equity', price: '51.0000', sequence: 2 }),
  fixtureTradeObservation({ eventId: 'obs-cm-aa-003', at: w(2), instrument: 'TEST-AAA', venue: 'TESTEX', assetClass: 'equity', price: '52.0000', sequence: 3 }),
  fixtureTradeObservation({ eventId: 'obs-cm-aa-004', at: w(3), instrument: 'TEST-AAA', venue: 'TESTEX', assetClass: 'equity', price: '53.0000', sequence: 4 }),
]);

/** The TEST-CHAIN-A leg: flat crypto trades. */
export const FIXTURE_CHAIN_OBSERVATIONS: readonly TradeObservation[] = deepFreeze([
  fixtureTradeObservation({ eventId: 'obs-cm-ca-001', at: w(0), instrument: 'TEST-CHAIN-A', venue: 'CHAINX', assetClass: 'crypto', price: '200.0000', sequence: 1 }),
  fixtureTradeObservation({ eventId: 'obs-cm-ca-002', at: w(1), instrument: 'TEST-CHAIN-A', venue: 'CHAINX', assetClass: 'crypto', price: '200.0000', sequence: 2 }),
  fixtureTradeObservation({ eventId: 'obs-cm-ca-003', at: w(2), instrument: 'TEST-CHAIN-A', venue: 'CHAINX', assetClass: 'crypto', price: '200.0000', sequence: 3 }),
  fixtureTradeObservation({ eventId: 'obs-cm-ca-004', at: w(3), instrument: 'TEST-CHAIN-A', venue: 'CHAINX', assetClass: 'crypto', price: '200.0000', sequence: 4 }),
]);

/** THE GOLDEN OBSERVATION SET: the three legs, twelve observations. */
export const FIXTURE_OBSERVATIONS: readonly CrossMarketObservation[] = deepFreeze([
  ...FIXTURE_CHAIN_OBSERVATIONS,
  ...FIXTURE_LARGECAP_OBSERVATIONS,
  ...FIXTURE_AAA_OBSERVATIONS,
]);

// ---------------------------------------------------------------------------
// The golden legs, pairs and citations
// ---------------------------------------------------------------------------

/** The three golden market legs (the pair formation input). */
export const FIXTURE_LEGS: readonly MarketLeg[] = deepFreeze([
  { venue: 'CHAINX', instrument: 'TEST-CHAIN-A', assetClass: 'crypto', series: 'trade' },
  { venue: 'LICENSED-INDEX-A', instrument: 'TEST-LARGECAP', assetClass: 'index', series: 'INDEX_LEVEL' },
  { venue: 'TESTEX', instrument: 'TEST-AAA', assetClass: 'equity', series: 'trade' },
]);

/**
 * Citations for one pair's evidence, in canonical (availableTime,
 * eventId) order, each tagged with its leg.
 */
export function pairCitations(
  left: MarketLeg,
  leftObservations: readonly CrossMarketObservation[],
  right: MarketLeg,
  rightObservations: readonly CrossMarketObservation[],
): readonly ObservationCitation[] {
  const citations: ObservationCitation[] = [];
  for (const observation of leftObservations) {
    citations.push({ leg: 'left', observationId: observation.event_id, availableTime: observation.available_time, provenance: observation.provenance });
  }
  for (const observation of rightObservations) {
    citations.push({ leg: 'right', observationId: observation.event_id, availableTime: observation.available_time, provenance: observation.provenance });
  }
  citations.sort((a, b) => {
    if (a.availableTime !== b.availableTime) return a.availableTime < b.availableTime ? -1 : 1;
    return a.observationId < b.observationId ? -1 : a.observationId > b.observationId ? 1 : 0;
  });
  return deepFreeze(citations);
}

/** The golden knowledge-time window (the whole observed span). */
export const FIXTURE_WINDOW = deepFreeze({ from: w(0), to: w(3) });

// ---------------------------------------------------------------------------
// Golden output fixtures (built through the real factories)
// ---------------------------------------------------------------------------

const goldenConfidence = {
  methodId: CROSS_MARKET_CONFIDENCE_METHOD.methodId,
  methodVersion: CROSS_MARKET_CONFIDENCE_METHOD.version,
  level: 'high' as const,
  evidenceCount: 8,
  legImbalance: 0,
};

function buildRelationship(draft: {
  readonly pair: { readonly left: MarketLeg; readonly right: MarketLeg };
  readonly relationKind: 'co-movement' | 'lead-lag' | 'spread-divergence';
  readonly method: 'co-movement' | 'lead-lag' | 'spread-divergence';
  readonly direction: string;
  readonly score: string;
  readonly evidence: readonly ObservationCitation[];
}): CrossMarketRelationship {
  const methodOf = {
    'co-movement': CROSS_MARKET_CO_MOVEMENT_METHOD,
    'lead-lag': CROSS_MARKET_LEAD_LAG_METHOD,
    'spread-divergence': CROSS_MARKET_SPREAD_DIVERGENCE_METHOD,
  } as const;
  const method = methodOf[draft.method];
  const construction = createCrossMarketRelationship(
    {
      pair: draft.pair,
      relationKind: draft.relationKind,
      measure: {
        methodId: method.methodId,
        methodVersion: method.version,
        direction: draft.direction as never,
        score: draft.score,
      },
      window: FIXTURE_WINDOW,
      confidence: goldenConfidence,
      evidence: draft.evidence,
      asOf: FIXTURE_AS_OF,
      bodyVersion: FIXTURE_BODY_VERSION,
      tenantId: FIXTURE_TENANT,
      projectId: FIXTURE_PROJECT,
      seed: FIXTURE_SEED,
    },
    CROSS_MARKET_METHOD_REGISTRY,
  );
  if (!construction.ok) {
    throw new TypeError(`golden relationship must construct: ${construction.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  }
  return construction.value;
}

const CHAIN_LEG = FIXTURE_LEGS[0] as MarketLeg;
const LARGECAP_LEG = FIXTURE_LEGS[1] as MarketLeg;
const AAA_LEG = FIXTURE_LEGS[2] as MarketLeg;

const pair1Evidence = pairCitations(CHAIN_LEG, FIXTURE_CHAIN_OBSERVATIONS, LARGECAP_LEG, FIXTURE_LARGECAP_OBSERVATIONS);
const pair2Evidence = pairCitations(CHAIN_LEG, FIXTURE_CHAIN_OBSERVATIONS, AAA_LEG, FIXTURE_AAA_OBSERVATIONS);
const pair3Evidence = pairCitations(LARGECAP_LEG, FIXTURE_LARGECAP_OBSERVATIONS, AAA_LEG, FIXTURE_AAA_OBSERVATIONS);

/**
 * THE GOLDEN RELATIONSHIPS (five, in canonical (leftKey, rightKey,
 * relationKind) order).
 */
export const FIXTURE_RELATIONSHIPS: readonly CrossMarketRelationship[] = deepFreeze([
  buildRelationship({ pair: { left: CHAIN_LEG, right: LARGECAP_LEG }, relationKind: 'spread-divergence', method: 'spread-divergence', direction: 'narrowing', score: '-0.0300', evidence: pair1Evidence }),
  buildRelationship({ pair: { left: CHAIN_LEG, right: AAA_LEG }, relationKind: 'spread-divergence', method: 'spread-divergence', direction: 'narrowing', score: '-0.0600', evidence: pair2Evidence }),
  buildRelationship({ pair: { left: LARGECAP_LEG, right: AAA_LEG }, relationKind: 'co-movement', method: 'co-movement', direction: 'positive', score: '1.0000', evidence: pair3Evidence }),
  buildRelationship({ pair: { left: LARGECAP_LEG, right: AAA_LEG }, relationKind: 'lead-lag', method: 'lead-lag', direction: 'no-lead', score: '0.0000', evidence: pair3Evidence }),
  buildRelationship({ pair: { left: LARGECAP_LEG, right: AAA_LEG }, relationKind: 'spread-divergence', method: 'spread-divergence', direction: 'narrowing', score: '-0.0300', evidence: pair3Evidence }),
]);

/** The golden coverage accounting: twelve offered, twelve admitted, nothing dropped. */
export const FIXTURE_COVERAGE: CoverageAccounting = deepFreeze({
  observationsOffered: 12,
  observationsAdmitted: 12,
  observationsDeferred: 0,
  observationsUnsupported: 0,
  observationsInvalid: 0,
});

/** The golden data gaps (the flat leg's pairs, both relation gaps each). */
export const FIXTURE_DATA_GAPS: readonly CrossMarketDataGap[] = deepFreeze([
  { kind: 'insufficient-compared-windows', leftInstrument: 'TEST-CHAIN-A', rightInstrument: 'TEST-LARGECAP' },
  { kind: 'insufficient-compared-windows', leftInstrument: 'TEST-CHAIN-A', rightInstrument: 'TEST-AAA' },
  { kind: 'insufficient-decisive-windows', leftInstrument: 'TEST-CHAIN-A', rightInstrument: 'TEST-LARGECAP' },
  { kind: 'insufficient-decisive-windows', leftInstrument: 'TEST-CHAIN-A', rightInstrument: 'TEST-AAA' },
] as readonly CrossMarketDataGap[]);

function buildGoldenReport(): CrossMarketResearchReport {
  const construction = createCrossMarketResearchReport(
    {
      asOf: FIXTURE_AS_OF,
      bodyVersion: FIXTURE_BODY_VERSION,
      methodId: CROSS_MARKET_REPORT_COMPOSITION_METHOD.methodId,
      methodVersion: CROSS_MARKET_REPORT_COMPOSITION_METHOD.version,
      tenantId: FIXTURE_TENANT,
      projectId: FIXTURE_PROJECT,
      seed: FIXTURE_SEED,
      relationships: FIXTURE_RELATIONSHIPS,
      summary: {
        relationshipCount: 5,
        pairCount: 3,
        instrumentCount: 3,
        dominantRelationKind: 'spread-divergence',
        meanMeasureScore: '0.1760',
        coverage: FIXTURE_COVERAGE,
        dataGaps: FIXTURE_DATA_GAPS,
      },
    },
    CROSS_MARKET_METHOD_REGISTRY,
  );
  if (!construction.ok) {
    throw new TypeError(`golden report must construct: ${construction.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  }
  return construction.value;
}

/** The golden cross-market research report (deterministic id, deeply frozen). */
export const FIXTURE_REPORT: CrossMarketResearchReport = buildGoldenReport();

// ---------------------------------------------------------------------------
// Violation fixtures (the negative paths — each MUST fail validation)
// ---------------------------------------------------------------------------

/** A relationship draft with NO evidence (the evidence law). */
export function evidenceLessRelationshipDraft(): Omit<CrossMarketRelationship, 'relationshipId'> {
  return {
    ...FIXTURE_RELATIONSHIPS[2],
    evidence: [],
  };
}

/** A relationship draft whose evidence covers only ONE leg (the leg-coverage law). */
export function oneLeggedRelationshipDraft(): Omit<CrossMarketRelationship, 'relationshipId'> {
  return {
    ...FIXTURE_RELATIONSHIPS[2],
    evidence: (FIXTURE_RELATIONSHIPS[2] as { evidence: readonly ObservationCitation[] }).evidence.map((citation) =>
      citation.leg === 'right' ? { ...citation, leg: 'left' as const } : citation,
    ),
  };
}

/** A relationship draft citing an observation available AFTER the as-of instant (the L4 law). */
export function futureCitationRelationshipDraft(): Omit<CrossMarketRelationship, 'relationshipId'> {
  return {
    ...FIXTURE_RELATIONSHIPS[2],
    evidence: [
      ...(FIXTURE_RELATIONSHIPS[2] as { evidence: readonly ObservationCitation[] }).evidence,
      { leg: 'right', observationId: 'obs-cm-future-999', availableTime: ms(1_717_423_200_000 + 300_000), provenance: FIXTURE_VENUE_PROVENANCE },
    ],
  };
}

/** A relationship draft citing an UNDECLARED method (the method-honesty law). */
export function undeclaredMethodRelationshipDraft(): Omit<CrossMarketRelationship, 'relationshipId'> {
  return {
    ...FIXTURE_RELATIONSHIPS[2],
    measure: {
      methodId: 'method/crossmarket/magic-statistic' as CrossMarketMethodId,
      methodVersion: '1.0.0' as CrossMarketMethodVersionRef,
      direction: 'positive',
      score: '0.9000',
    },
  };
}

/** A relationship draft citing the declared method at a STALE version. */
export function staleMethodVersionRelationshipDraft(): Omit<CrossMarketRelationship, 'relationshipId'> {
  return {
    ...FIXTURE_RELATIONSHIPS[2],
    measure: {
      ...FIXTURE_RELATIONSHIPS[2].measure,
      methodVersion: '0.9.0' as CrossMarketMethodVersionRef,
    },
  };
}

/** A relationship draft whose relation kind disagrees with the cited method's declared kind. */
export function kindMismatchRelationshipDraft(): Omit<CrossMarketRelationship, 'relationshipId'> {
  return {
    ...FIXTURE_RELATIONSHIPS[2],
    relationKind: 'lead-lag',
  };
}

/** A relationship draft whose direction belongs to a different relation kind. */
export function directionSubsetMismatchDraft(): Omit<CrossMarketRelationship, 'relationshipId'> {
  return {
    ...FIXTURE_RELATIONSHIPS[2],
    measure: {
      ...FIXTURE_RELATIONSHIPS[2].measure,
      direction: 'left-leads',
    },
  };
}

/** A relationship draft whose direction contradicts the declared decision function. */
export function directionMeasureMismatchDraft(): Omit<CrossMarketRelationship, 'relationshipId'> {
  return {
    ...FIXTURE_RELATIONSHIPS[2],
    measure: {
      ...FIXTURE_RELATIONSHIPS[2].measure,
      direction: 'negative',
    },
  };
}

/** A relationship draft whose confidence cites the CO-MOVEMENT method (kind mismatch). */
export function wrongKindConfidenceDraft(): Omit<CrossMarketRelationship, 'relationshipId'> {
  return {
    ...FIXTURE_RELATIONSHIPS[2],
    confidence: {
      ...FIXTURE_RELATIONSHIPS[2].confidence,
      methodId: CROSS_MARKET_CO_MOVEMENT_METHOD.methodId,
      methodVersion: CROSS_MARKET_CO_MOVEMENT_METHOD.version,
    },
  };
}

/** A relationship draft relating a series to ITSELF (the pair law). */
export function selfPairedRelationshipDraft(): Omit<CrossMarketRelationship, 'relationshipId'> {
  return {
    ...FIXTURE_RELATIONSHIPS[2],
    pair: { left: LARGECAP_LEG, right: LARGECAP_LEG },
  };
}

/** A relationship draft missing tenant/project (the L12 law). */
export function tenantlessRelationshipDraft(): Omit<CrossMarketRelationship, 'relationshipId'> {
  return {
    ...FIXTURE_RELATIONSHIPS[2],
    tenantId: '' as TenantId,
    projectId: '' as ProjectId,
  };
}

/** A relationship draft with DUPLICATE observation citations. */
export function duplicateEvidenceRelationshipDraft(): Omit<CrossMarketRelationship, 'relationshipId'> {
  const evidence = (FIXTURE_RELATIONSHIPS[2] as { evidence: readonly ObservationCitation[] }).evidence;
  return {
    ...FIXTURE_RELATIONSHIPS[2],
    evidence: [...evidence, evidence[0] as ObservationCitation],
  };
}

/** A body spec edited to GRANT execution authority (the L8 trip-wire). */
export function executionGrantedBodySpec(): CrossMarketResearcherBodySpec {
  return {
    ...CROSS_MARKET_RESEARCHER_BODY,
    bodyVersion: {
      ...CROSS_MARKET_RESEARCHER_BODY.bodyVersion,
      composition: {
        ...CROSS_MARKET_RESEARCHER_BODY.bodyVersion.composition,
        authorityBoundary: {
          ...CROSS_MARKET_RESEARCHER_BODY.bodyVersion.composition.authorityBoundary,
          allowedActions: [...CROSS_MARKET_RESEARCHER_BODY.bodyVersion.composition.authorityBoundary.allowedActions, 'EXECUTE'],
        },
      },
    },
  };
}

/** A body spec whose execution authority is NOT 'none' (the L8 trip-wire). */
export function externalGatewayBodySpec(): CrossMarketResearcherBodySpec {
  return {
    ...CROSS_MARKET_RESEARCHER_BODY,
    bodyVersion: {
      ...CROSS_MARKET_RESEARCHER_BODY.bodyVersion,
      composition: {
        ...CROSS_MARKET_RESEARCHER_BODY.bodyVersion.composition,
        authorityBoundary: {
          ...CROSS_MARKET_RESEARCHER_BODY.bodyVersion.composition.authorityBoundary,
          executionAuthority: 'external-gateway-only',
        },
      },
    },
  };
}

/** A body spec that does NOT explicitly prohibit EXECUTE (the L8 trip-wire). */
export function executeNotProhibitedBodySpec(): CrossMarketResearcherBodySpec {
  return {
    ...CROSS_MARKET_RESEARCHER_BODY,
    bodyVersion: {
      ...CROSS_MARKET_RESEARCHER_BODY.bodyVersion,
      composition: {
        ...CROSS_MARKET_RESEARCHER_BODY.bodyVersion.composition,
        authorityBoundary: {
          ...CROSS_MARKET_RESEARCHER_BODY.bodyVersion.composition.authorityBoundary,
          prohibitedActions: CROSS_MARKET_RESEARCHER_BODY.bodyVersion.composition.authorityBoundary.prohibitedActions.filter(
            (action) => action !== 'EXECUTE',
          ),
        },
      },
    },
  };
}

/** A body spec whose authority-scope record was edited off the law (the L8 trip-wire). */
export function editedAuthorityScopeBodySpec(): CrossMarketResearcherBodySpec {
  return {
    ...CROSS_MARKET_RESEARCHER_BODY,
    research: {
      ...CROSS_MARKET_RESEARCHER_BODY.research,
      authorityScope: {
        scope: 'observation-research-publication',
        execution: 'external-gateway-only',
        orderPlacement: 'prohibited',
        consequentialActions: 'prohibited',
      },
    },
  } as unknown as CrossMarketResearcherBodySpec;
}

/** A body spec citing a MODEL IDENTITY as evaluation evidence (the L16a trip-wire). */
export function modelIdentityEvidenceBodySpec(): CrossMarketResearcherBodySpec {
  return {
    ...CROSS_MARKET_RESEARCHER_BODY,
    research: {
      ...CROSS_MARKET_RESEARCHER_BODY.research,
      evaluationCriteriaRefs: ['acme-models/reasoner-2@2026.03' as EvaluationCriteriaRef],
    },
  };
}

/** A body spec whose procedure cites a CONSEQUENTIAL tool (the L8 trip-wire). */
export function consequentialToolBodySpec(): CrossMarketResearcherBodySpec {
  return {
    ...CROSS_MARKET_RESEARCHER_BODY,
    bodyVersion: {
      ...CROSS_MARKET_RESEARCHER_BODY.bodyVersion,
      composition: {
        ...CROSS_MARKET_RESEARCHER_BODY.bodyVersion.composition,
        knowledgeToolPolicy: {
          ...CROSS_MARKET_RESEARCHER_BODY.bodyVersion.composition.knowledgeToolPolicy,
          allowedTools: [
            ...CROSS_MARKET_RESEARCHER_BODY.bodyVersion.composition.knowledgeToolPolicy.allowedTools,
            'tools/order-entry' as ToolRef,
          ],
        },
        procedures: CROSS_MARKET_RESEARCHER_BODY.bodyVersion.composition.procedures.map((procedure) => ({
          ...procedure,
          steps: procedure.steps.map((step) =>
            step.id === 'publish'
              ? { ...step, toolRefs: [...step.toolRefs, 'tools/order-entry' as ToolRef] }
              : step,
          ),
        })),
      },
    },
  };
}

/** A body spec with a NON-RESEARCH capability category (the L8 declaration). */
export function nonResearchCapabilityBodySpec(): CrossMarketResearcherBodySpec {
  return {
    ...CROSS_MARKET_RESEARCHER_BODY,
    bodyVersion: {
      ...CROSS_MARKET_RESEARCHER_BODY.bodyVersion,
      composition: {
        ...CROSS_MARKET_RESEARCHER_BODY.bodyVersion.composition,
        capabilities: CROSS_MARKET_RESEARCHER_BODY.bodyVersion.composition.capabilities.map((capability) =>
          capability.id === 'research-publication' ? { ...capability, category: 'execution' } : capability,
        ),
      },
    },
  };
}

/** A body spec publishing to a RESERVED kernel topic. */
export function reservedTopicBodySpec(): CrossMarketResearcherBodySpec {
  return {
    ...CROSS_MARKET_RESEARCHER_BODY,
    research: {
      ...CROSS_MARKET_RESEARCHER_BODY.research,
      publicationTopic: 'kernel.approve' as TopicName,
    },
  };
}

/** A registry the golden outputs cite (re-exported for tests). */
export const FIXTURE_REGISTRY: CrossMarketMethodRegistry = CROSS_MARKET_METHOD_REGISTRY;
