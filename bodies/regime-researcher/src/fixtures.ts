// @tradrl/body-regime-researcher — the deterministic fixture set.
//
// Owning Work Order: T022. Every fixture is DETERMINISTIC (no clocks, no
// randomness — literal instants and literal ids), and every fixture is
// re-validated by the real guards in the tests. The golden records are
// built through the real factories so their derived ids are honest.
//
// The golden stream tells one story end to end: TEST-AAA ranges over its
// first declared window (prices wobbling 100.00 -> 100.60), then TRENDS
// UP over the next (100.60 -> 104.80) — one regime change, ranging ->
// trending-up; TEST-BBB offers only two observations (below the declared
// minimum of four — a data gap, not a classification); and ONE FUTURE
// observation arrives after the as-of instant (the L4 violation fixture).
//
// The violation fixtures exist for the NEGATIVE paths: an evidence-less
// classification, a future-citation classification, an undeclared-method
// classification, a magic label, a label inconsistent with its own
// statistics, a tampered record, a body spec edited to grant execution
// authority, a body spec citing a model identity as evaluation evidence —
// each must FAIL validation with its typed code (the acceptance
// criteria).
//
// (Type note: fixture literals are authored as plain records and cast to
// the branded contract types once — the brands are compile-time only.)

import { type TimestampMs, deepFreeze } from './primitives';
import { type BodyVersionRef, type EvaluationCriteriaRef, type RegimeMethodId, type RegimeMethodVersionRef, type ProjectId, type TenantId, type TopicName, type ToolRef } from './ids';
import {
  type QuoteObservation,
  type TradeObservation,
  type BookSnapshotObservation,
  type MarketObservation,
  type ObservationProvenance,
} from './observations';
import { type MarketObservationCitation } from './classification';
import { type RegimeClassification, createRegimeClassification } from './classification';
import { type RegimeChange, createRegimeChange } from './change';
import { type RegimeResearchReport, createRegimeResearchReport, type IntakeCoverage, type RegimeDataGap } from './report';
import {
  REGIME_RESEARCHER_BODY,
  type RegimeResearcherBodySpec,
} from './body';
import {
  type RegimeMethodRegistry,
  REGIME_METHOD_REGISTRY,
  REGIME_CLASSIFICATION_METHOD,
  REGIME_CHANGE_DETECTION_METHOD,
  REGIME_CONFIDENCE_METHOD,
  REGIME_REPORT_COMPOSITION_METHOD,
} from './methods';

// ---------------------------------------------------------------------------
// The fixture world (literal instants — no ambient clock anywhere)
// ---------------------------------------------------------------------------

/** The fixture epoch anchor (2024-06-03T16:00:00Z — matches the adapter suites). */
export const FIXTURE_AT0: TimestampMs = 1_717_423_200_000 as TimestampMs;

/** The fixture as-of instant: one minute after the anchor. */
export const FIXTURE_AS_OF: TimestampMs = (1_717_423_200_000 + 60_000) as TimestampMs;

/** The fixture tenant (L12). */
export const FIXTURE_TENANT: TenantId = 'tenant-research' as TenantId;

/** The fixture project (L12). */
export const FIXTURE_PROJECT: ProjectId = 'project-regime' as ProjectId;

/** The fixture run seed (lineage material — L9). */
export const FIXTURE_SEED = 'seed/regime/fixture-1';

/** The fixture body-version reference. */
export const FIXTURE_BODY_VERSION: BodyVersionRef = 'regime-researcher@1.0.0' as BodyVersionRef;

/** The fixture publishing instance (an agent-os AgentInstanceId shape). */
export const FIXTURE_SENDER = 'agent-instance-regime-0001';

/** The fixture publication topic (an organization topic — never kernel.*). */
export const FIXTURE_TOPIC = 'research.regime';

/** Casts a literal epoch-millisecond number to `TimestampMs` (fixture discipline). */
const ms = (value: number): TimestampMs => value as TimestampMs;

/** The historical provenance block every fixture observation carries. */
export const FIXTURE_PROVENANCE: ObservationProvenance = deepFreeze({
  origin: 'historical',
  adapter: { id: 'market-adapter', version: '1.0.0' },
  derived_from: [],
  transform: null,
} as ObservationProvenance);

// ---------------------------------------------------------------------------
// Observation fixtures (quartets + provenance; canonical market shapes)
// ---------------------------------------------------------------------------

/** Builds a canonical quote observation fixture (quartet + provenance). */
export function fixtureQuoteObservation(input: {
  readonly eventId: string;
  readonly at: TimestampMs;
  readonly instrument: string;
  readonly bid: string;
  readonly ask: string;
  readonly venue?: string;
  readonly sequence?: number;
}): QuoteObservation {
  return deepFreeze({
    event_id: input.eventId,
    venue: input.venue ?? 'SIM-EXCH',
    instrument: input.instrument,
    asset_class: 'crypto',
    event_type: 'quote',
    event_time: input.at,
    source_time: input.at,
    available_time: input.at,
    ingestion_time: ms((input.at as number) + 1_000),
    sequence: input.sequence ?? 1,
    provider: 'market-replay',
    provenance: FIXTURE_PROVENANCE,
    payload: deepFreeze({
      bid_price: input.bid,
      bid_size: '5.0',
      ask_price: input.ask,
      ask_size: '5.0',
    }),
  });
}

/** Builds a canonical trade observation fixture. */
export function fixtureTradeObservation(input: {
  readonly eventId: string;
  readonly at: TimestampMs;
  readonly instrument: string;
  readonly price: string;
  readonly venue?: string;
  readonly side?: 'buy' | 'sell';
  readonly sequence?: number;
}): TradeObservation {
  return deepFreeze({
    event_id: input.eventId,
    venue: input.venue ?? 'SIM-EXCH',
    instrument: input.instrument,
    asset_class: 'crypto',
    event_type: 'trade',
    event_time: input.at,
    source_time: input.at,
    available_time: input.at,
    ingestion_time: ms((input.at as number) + 1_000),
    sequence: input.sequence ?? 1,
    provider: 'market-replay',
    provenance: FIXTURE_PROVENANCE,
    payload: deepFreeze({
      price: input.price,
      size: '1.0',
      side: input.side ?? 'buy',
    }),
  });
}

/** Builds a canonical book-snapshot observation fixture (two visible levels a side). */
export function fixtureBookSnapshotObservation(input: {
  readonly eventId: string;
  readonly at: TimestampMs;
  readonly instrument: string;
  readonly bestBid: string;
  readonly bestAsk: string;
  readonly venue?: string;
  readonly sequence?: number;
}): BookSnapshotObservation {
  const bid = Number(input.bestBid);
  const ask = Number(input.bestAsk);
  return deepFreeze({
    event_id: input.eventId,
    venue: input.venue ?? 'SIM-EXCH',
    instrument: input.instrument,
    asset_class: 'crypto',
    event_type: 'book_snapshot',
    event_time: input.at,
    source_time: input.at,
    available_time: input.at,
    ingestion_time: ms((input.at as number) + 1_000),
    sequence: input.sequence ?? 1,
    provider: 'market-replay',
    provenance: FIXTURE_PROVENANCE,
    payload: deepFreeze({
      bids: [
        { price: input.bestBid, size: '5.0' },
        { price: (bid - 0.1).toFixed(2), size: '5.0' },
      ],
      asks: [
        { price: input.bestAsk, size: '5.0' },
        { price: (ask + 0.1).toFixed(2), size: '5.0' },
      ],
    }),
  });
}

/**
 * THE GOLDEN OBSERVATION STREAM: window W0 of TEST-AAA (aligned to the
 * declared 10-second window grid) wobbles 100.00 -> 100.60 (RANGING:
 * net move 0.60%, mean absolute change 0.47%); window W1 climbs
 * 100.60 -> 104.80 (TRENDING-UP: net move 4.17% >= the declared 3%
 * trend threshold); TEST-BBB offers only two observations (below the
 * declared minimum of four); one future observation arrives after the
 * as-of instant.
 */
export const FIXTURE_OBSERVATIONS: readonly MarketObservation[] = deepFreeze([
  // window W0 [AT0, AT0+10s): ranging — a quote, a trade, a quote, a trade
  fixtureQuoteObservation({ eventId: 'obs-mkt-001', at: FIXTURE_AT0, instrument: 'TEST-AAA', bid: '99.99', ask: '100.01', sequence: 1 }),
  fixtureTradeObservation({ eventId: 'obs-mkt-002', at: ms(1_717_423_200_000 + 1_000), instrument: 'TEST-AAA', price: '100.50', sequence: 2 }),
  fixtureQuoteObservation({ eventId: 'obs-mkt-003', at: ms(1_717_423_200_000 + 2_000), instrument: 'TEST-AAA', bid: '100.09', ask: '100.11', sequence: 3 }),
  fixtureTradeObservation({ eventId: 'obs-mkt-004', at: ms(1_717_423_200_000 + 3_000), instrument: 'TEST-AAA', price: '100.60', sequence: 4 }),
  // window W1 [AT0+10s, AT0+20s): trending-up — a trade, a book snapshot, a trade, a quote
  fixtureTradeObservation({ eventId: 'obs-mkt-005', at: ms(1_717_423_200_000 + 10_000), instrument: 'TEST-AAA', price: '100.60', sequence: 5 }),
  fixtureBookSnapshotObservation({ eventId: 'obs-mkt-006', at: ms(1_717_423_200_000 + 11_000), instrument: 'TEST-AAA', bestBid: '101.89', bestAsk: '101.91', sequence: 6 }),
  fixtureTradeObservation({ eventId: 'obs-mkt-007', at: ms(1_717_423_200_000 + 12_000), instrument: 'TEST-AAA', price: '103.30', sequence: 7 }),
  fixtureQuoteObservation({ eventId: 'obs-mkt-008', at: ms(1_717_423_200_000 + 13_000), instrument: 'TEST-AAA', bid: '104.79', ask: '104.81', sequence: 8 }),
  // TEST-BBB: below the declared minimum of four — a data gap, not a classification
  fixtureQuoteObservation({ eventId: 'obs-mkt-101', at: FIXTURE_AT0, instrument: 'TEST-BBB', bid: '50.00', ask: '50.02', sequence: 1 }),
  fixtureTradeObservation({ eventId: 'obs-mkt-102', at: ms(1_717_423_200_000 + 1_000), instrument: 'TEST-BBB', price: '50.03', side: 'sell', sequence: 2 }),
  // THE L4 VIOLATION FIXTURE: available AFTER the as-of instant.
  fixtureQuoteObservation({ eventId: 'obs-future-001', at: ms(1_717_423_200_000 + 70_000), instrument: 'TEST-AAA', bid: '120.00', ask: '120.02', sequence: 9 }),
]);

/** Citations for window W0 (the ranging evidence set). */
export const FIXTURE_W0_CITATIONS: readonly MarketObservationCitation[] = deepFreeze([
  { observationId: 'obs-mkt-001', availableTime: FIXTURE_AT0, provenance: FIXTURE_PROVENANCE },
  { observationId: 'obs-mkt-002', availableTime: ms(1_717_423_200_000 + 1_000), provenance: FIXTURE_PROVENANCE },
  { observationId: 'obs-mkt-003', availableTime: ms(1_717_423_200_000 + 2_000), provenance: FIXTURE_PROVENANCE },
  { observationId: 'obs-mkt-004', availableTime: ms(1_717_423_200_000 + 3_000), provenance: FIXTURE_PROVENANCE },
]);

/** Citations for window W1 (the trending-up evidence set). */
export const FIXTURE_W1_CITATIONS: readonly MarketObservationCitation[] = deepFreeze([
  { observationId: 'obs-mkt-005', availableTime: ms(1_717_423_200_000 + 10_000), provenance: FIXTURE_PROVENANCE },
  { observationId: 'obs-mkt-006', availableTime: ms(1_717_423_200_000 + 11_000), provenance: FIXTURE_PROVENANCE },
  { observationId: 'obs-mkt-007', availableTime: ms(1_717_423_200_000 + 12_000), provenance: FIXTURE_PROVENANCE },
  { observationId: 'obs-mkt-008', availableTime: ms(1_717_423_200_000 + 13_000), provenance: FIXTURE_PROVENANCE },
]);

// ---------------------------------------------------------------------------
// Golden output fixtures (built through the real factories)
// ---------------------------------------------------------------------------

function buildGoldenW0(): RegimeClassification {
  const construction = createRegimeClassification(
    {
      scope: { instrument: 'TEST-AAA', venue: 'SIM-EXCH' },
      label: 'ranging',
      netMoveRatio: '0.0060',
      meanAbsChangeRatio: '0.0047',
      window: { from: FIXTURE_AT0, to: ms(1_717_423_200_000 + 3_000) },
      observationCount: 4,
      evidence: FIXTURE_W0_CITATIONS,
      confidence: {
        methodId: REGIME_CONFIDENCE_METHOD.methodId,
        methodVersion: REGIME_CONFIDENCE_METHOD.version,
        level: 'moderate',
        evidenceCount: 4,
        dispersion: '0.0060',
      },
      asOf: FIXTURE_AS_OF,
      methodId: REGIME_CLASSIFICATION_METHOD.methodId,
      methodVersion: REGIME_CLASSIFICATION_METHOD.version,
      bodyVersion: FIXTURE_BODY_VERSION,
      tenantId: FIXTURE_TENANT,
      projectId: FIXTURE_PROJECT,
      seed: FIXTURE_SEED,
    },
    REGIME_METHOD_REGISTRY,
  );
  if (!construction.ok) {
    throw new TypeError(`golden W0 classification must construct: ${construction.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  }
  return construction.value;
}

function buildGoldenW1(): RegimeClassification {
  const construction = createRegimeClassification(
    {
      scope: { instrument: 'TEST-AAA', venue: 'SIM-EXCH' },
      label: 'trending-up',
      netMoveRatio: '0.0417',
      meanAbsChangeRatio: '0.0139',
      window: { from: ms(1_717_423_200_000 + 10_000), to: ms(1_717_423_200_000 + 13_000) },
      observationCount: 4,
      evidence: FIXTURE_W1_CITATIONS,
      confidence: {
        methodId: REGIME_CONFIDENCE_METHOD.methodId,
        methodVersion: REGIME_CONFIDENCE_METHOD.version,
        level: 'moderate',
        evidenceCount: 4,
        dispersion: '0.0417',
      },
      asOf: FIXTURE_AS_OF,
      methodId: REGIME_CLASSIFICATION_METHOD.methodId,
      methodVersion: REGIME_CLASSIFICATION_METHOD.version,
      bodyVersion: FIXTURE_BODY_VERSION,
      tenantId: FIXTURE_TENANT,
      projectId: FIXTURE_PROJECT,
      seed: FIXTURE_SEED,
    },
    REGIME_METHOD_REGISTRY,
  );
  if (!construction.ok) {
    throw new TypeError(`golden W1 classification must construct: ${construction.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  }
  return construction.value;
}

/** The golden ranging classification (window W0 — deterministic id, frozen). */
export const FIXTURE_CLASSIFICATION_W0: RegimeClassification = buildGoldenW0();

/** The golden trending-up classification (window W1). */
export const FIXTURE_CLASSIFICATION_W1: RegimeClassification = buildGoldenW1();

function buildGoldenChange(): RegimeChange {
  const construction = createRegimeChange(
    {
      scope: { instrument: 'TEST-AAA', venue: 'SIM-EXCH' },
      fromLabel: 'ranging',
      toLabel: 'trending-up',
      fromWindow: { from: FIXTURE_AT0, to: ms(1_717_423_200_000 + 3_000) },
      toWindow: { from: ms(1_717_423_200_000 + 10_000), to: ms(1_717_423_200_000 + 13_000) },
      detectionInstant: ms(1_717_423_200_000 + 13_000),
      evidence: deepFreeze([...FIXTURE_W0_CITATIONS, ...FIXTURE_W1_CITATIONS]),
      asOf: FIXTURE_AS_OF,
      methodId: REGIME_CHANGE_DETECTION_METHOD.methodId,
      methodVersion: REGIME_CHANGE_DETECTION_METHOD.version,
      bodyVersion: FIXTURE_BODY_VERSION,
      tenantId: FIXTURE_TENANT,
      projectId: FIXTURE_PROJECT,
      seed: FIXTURE_SEED,
    },
    REGIME_METHOD_REGISTRY,
  );
  if (!construction.ok) {
    throw new TypeError(`golden change must construct: ${construction.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  }
  return construction.value;
}

/** The golden regime change (ranging -> trending-up — deterministic id, frozen). */
export const FIXTURE_CHANGE: RegimeChange = buildGoldenChange();

/** The golden coverage accounting: eleven offered, ten admitted, one deferred. */
export const FIXTURE_COVERAGE: IntakeCoverage = deepFreeze({
  observationsOffered: 11,
  observationsAdmitted: 10,
  observationsDeferred: 1,
  observationsUnsupported: 0,
  observationsInvalid: 0,
});

/** The golden data gaps (one instrument observed but never classified). */
export const FIXTURE_DATA_GAPS: readonly RegimeDataGap[] = deepFreeze([
  { kind: 'instrument-without-classification', instrument: 'TEST-BBB' },
] as readonly RegimeDataGap[]);

function buildGoldenReport(): RegimeResearchReport {
  const construction = createRegimeResearchReport(
    {
      asOf: FIXTURE_AS_OF,
      bodyVersion: FIXTURE_BODY_VERSION,
      methodId: REGIME_REPORT_COMPOSITION_METHOD.methodId,
      methodVersion: REGIME_REPORT_COMPOSITION_METHOD.version,
      tenantId: FIXTURE_TENANT,
      projectId: FIXTURE_PROJECT,
      seed: FIXTURE_SEED,
      classifications: [FIXTURE_CLASSIFICATION_W0, FIXTURE_CLASSIFICATION_W1],
      changes: [FIXTURE_CHANGE],
      summary: {
        classificationCount: 2,
        changeCount: 1,
        instrumentCount: 1,
        windowCount: 2,
        dominantRegime: 'trending-up',
        meanNetMoveRatio: '0.0238',
        coverage: FIXTURE_COVERAGE,
        dataGaps: FIXTURE_DATA_GAPS,
      },
    },
    REGIME_METHOD_REGISTRY,
  );
  if (!construction.ok) {
    throw new TypeError(`golden report must construct: ${construction.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  }
  return construction.value;
}

/** The golden regime research report (deterministic id, deeply frozen). */
export const FIXTURE_REPORT: RegimeResearchReport = buildGoldenReport();

// ---------------------------------------------------------------------------
// Violation fixtures (the negative paths — each MUST fail validation)
// ---------------------------------------------------------------------------

/** A classification draft with NO evidence (the evidence law). */
export function evidenceLessClassificationDraft(): Omit<RegimeClassification, 'classificationId'> {
  return {
    ...FIXTURE_CLASSIFICATION_W0,
    evidence: [],
  };
}

/** A classification draft citing an observation available AFTER the as-of instant (the L4 law). */
export function futureCitationClassificationDraft(): Omit<RegimeClassification, 'classificationId'> {
  return {
    ...FIXTURE_CLASSIFICATION_W0,
    evidence: [
      ...FIXTURE_W0_CITATIONS,
      { observationId: 'obs-future-999', availableTime: ms(1_717_423_200_000 + 70_000), provenance: FIXTURE_PROVENANCE },
    ],
  };
}

/** A classification draft citing an UNDECLARED method (the method-honesty law). */
export function undeclaredMethodClassificationDraft(): Omit<RegimeClassification, 'classificationId'> {
  return {
    ...FIXTURE_CLASSIFICATION_W0,
    methodId: 'method/regime/magic-label' as RegimeMethodId,
    methodVersion: '1.0.0' as RegimeMethodVersionRef,
  };
}

/** A classification draft citing the declared method at a STALE version. */
export function staleMethodVersionClassificationDraft(): Omit<RegimeClassification, 'classificationId'> {
  return {
    ...FIXTURE_CLASSIFICATION_W0,
    methodVersion: '0.9.0' as RegimeMethodVersionRef,
  };
}

/** A classification draft whose confidence cites the CLASSIFICATION method (kind mismatch). */
export function wrongKindMethodClassificationDraft(): Omit<RegimeClassification, 'classificationId'> {
  return {
    ...FIXTURE_CLASSIFICATION_W0,
    confidence: {
      ...FIXTURE_CLASSIFICATION_W0.confidence,
      methodId: REGIME_CLASSIFICATION_METHOD.methodId,
      methodVersion: REGIME_CLASSIFICATION_METHOD.version,
    },
  };
}

/** A classification draft missing tenant/project (the L12 law). */
export function tenantlessClassificationDraft(): Omit<RegimeClassification, 'classificationId'> {
  return {
    ...FIXTURE_CLASSIFICATION_W0,
    tenantId: '' as TenantId,
    projectId: '' as ProjectId,
  };
}

/** A classification draft with DUPLICATE observation citations. */
export function duplicateEvidenceClassificationDraft(): Omit<RegimeClassification, 'classificationId'> {
  return {
    ...FIXTURE_CLASSIFICATION_W0,
    evidence: [...FIXTURE_W0_CITATIONS, FIXTURE_W0_CITATIONS[0]],
  };
}

/** A classification draft carrying a MAGIC label outside every declared taxonomy. */
export function magicLabelClassificationDraft(): Omit<RegimeClassification, 'classificationId'> {
  return {
    ...FIXTURE_CLASSIFICATION_W0,
    label: 'bull-mode',
  };
}

/**
 * A classification draft carrying a DECLARED label inconsistent with its
 * own carried statistics ('quiet' over statistics that derive
 * 'ranging') — the declared-derivation law.
 */
export function inconsistentLabelClassificationDraft(): Omit<RegimeClassification, 'classificationId'> {
  return {
    ...FIXTURE_CLASSIFICATION_W0,
    label: 'quiet',
  };
}

/** A change draft whose from/to labels are identical (not a transition). */
export function identicalLabelsChangeDraft(): Omit<RegimeChange, 'changeId'> {
  return {
    ...FIXTURE_CHANGE,
    toLabel: 'ranging',
  };
}

/** A change draft whose detection instant is AFTER the as-of instant (L4). */
export function futureDetectionChangeDraft(): Omit<RegimeChange, 'changeId'> {
  return {
    ...FIXTURE_CHANGE,
    detectionInstant: ms(1_717_423_200_000 + 90_000),
  };
}

/** A change draft whose to-window precedes the from-window (window ordering). */
export function misorderedWindowsChangeDraft(): Omit<RegimeChange, 'changeId'> {
  return {
    ...FIXTURE_CHANGE,
    toWindow: { from: FIXTURE_AT0, to: ms(1_717_423_200_000 + 2_000) },
  };
}

/** A body spec edited to GRANT execution authority (the L8 trip-wire). */
export function executionGrantedBodySpec(): RegimeResearcherBodySpec {
  return {
    ...REGIME_RESEARCHER_BODY,
    bodyVersion: {
      ...REGIME_RESEARCHER_BODY.bodyVersion,
      composition: {
        ...REGIME_RESEARCHER_BODY.bodyVersion.composition,
        authorityBoundary: {
          ...REGIME_RESEARCHER_BODY.bodyVersion.composition.authorityBoundary,
          allowedActions: [...REGIME_RESEARCHER_BODY.bodyVersion.composition.authorityBoundary.allowedActions, 'EXECUTE'],
        },
      },
    },
  };
}

/** A body spec whose execution authority is NOT 'none' (the L8 trip-wire). */
export function externalGatewayBodySpec(): RegimeResearcherBodySpec {
  return {
    ...REGIME_RESEARCHER_BODY,
    bodyVersion: {
      ...REGIME_RESEARCHER_BODY.bodyVersion,
      composition: {
        ...REGIME_RESEARCHER_BODY.bodyVersion.composition,
        authorityBoundary: {
          ...REGIME_RESEARCHER_BODY.bodyVersion.composition.authorityBoundary,
          executionAuthority: 'external-gateway-only',
        },
      },
    },
  };
}

/** A body spec that does NOT explicitly prohibit EXECUTE (the L8 trip-wire). */
export function executeNotProhibitedBodySpec(): RegimeResearcherBodySpec {
  return {
    ...REGIME_RESEARCHER_BODY,
    bodyVersion: {
      ...REGIME_RESEARCHER_BODY.bodyVersion,
      composition: {
        ...REGIME_RESEARCHER_BODY.bodyVersion.composition,
        authorityBoundary: {
          ...REGIME_RESEARCHER_BODY.bodyVersion.composition.authorityBoundary,
          prohibitedActions: REGIME_RESEARCHER_BODY.bodyVersion.composition.authorityBoundary.prohibitedActions.filter(
            (action) => action !== 'EXECUTE',
          ),
        },
      },
    },
  };
}

/** A body spec whose authority-scope record was edited off the law (the L8 trip-wire). */
export function editedAuthorityScopeBodySpec(): RegimeResearcherBodySpec {
  return {
    ...REGIME_RESEARCHER_BODY,
    research: {
      ...REGIME_RESEARCHER_BODY.research,
      authorityScope: {
        scope: 'observation-research-publication',
        execution: 'external-gateway-only',
        orderPlacement: 'prohibited',
        consequentialActions: 'prohibited',
      },
    },
  } as unknown as RegimeResearcherBodySpec;
}

/** A body spec citing a MODEL IDENTITY as evaluation evidence (the L16a trip-wire). */
export function modelIdentityEvidenceBodySpec(): RegimeResearcherBodySpec {
  return {
    ...REGIME_RESEARCHER_BODY,
    research: {
      ...REGIME_RESEARCHER_BODY.research,
      evaluationCriteriaRefs: ['acme-models/reasoner-2@2026.03' as EvaluationCriteriaRef],
    },
  };
}

/** A body spec whose procedure cites a CONSEQUENTIAL tool (the L8 trip-wire). */
export function consequentialToolBodySpec(): RegimeResearcherBodySpec {
  return {
    ...REGIME_RESEARCHER_BODY,
    bodyVersion: {
      ...REGIME_RESEARCHER_BODY.bodyVersion,
      composition: {
        ...REGIME_RESEARCHER_BODY.bodyVersion.composition,
        knowledgeToolPolicy: {
          ...REGIME_RESEARCHER_BODY.bodyVersion.composition.knowledgeToolPolicy,
          allowedTools: [
            ...REGIME_RESEARCHER_BODY.bodyVersion.composition.knowledgeToolPolicy.allowedTools,
            'tools/order-entry' as ToolRef,
          ],
        },
        procedures: REGIME_RESEARCHER_BODY.bodyVersion.composition.procedures.map((procedure) => ({
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
export function nonResearchCapabilityBodySpec(): RegimeResearcherBodySpec {
  return {
    ...REGIME_RESEARCHER_BODY,
    bodyVersion: {
      ...REGIME_RESEARCHER_BODY.bodyVersion,
      composition: {
        ...REGIME_RESEARCHER_BODY.bodyVersion.composition,
        capabilities: REGIME_RESEARCHER_BODY.bodyVersion.composition.capabilities.map((capability) =>
          capability.id === 'research-publication' ? { ...capability, category: 'execution' } : capability,
        ),
      },
    },
  };
}

/** A body spec publishing to a RESERVED kernel topic. */
export function reservedTopicBodySpec(): RegimeResearcherBodySpec {
  return {
    ...REGIME_RESEARCHER_BODY,
    research: {
      ...REGIME_RESEARCHER_BODY.research,
      publicationTopic: 'kernel.approve' as TopicName,
    },
  };
}

/** A registry the golden outputs cite (re-exported for tests). */
export const FIXTURE_REGISTRY: RegimeMethodRegistry = REGIME_METHOD_REGISTRY;
