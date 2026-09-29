// @tradrl/body-sentiment-researcher — the deterministic fixture set.
//
// Owning Work Order: T021. Every fixture is DETERMINISTIC (no clocks, no
// randomness — literal instants and literal ids), and every fixture is
// re-validated by the real guards in the tests. The golden records are
// built through the real factories so their derived ids are honest.
//
// The violation fixtures exist for the NEGATIVE paths: an evidence-less
// reading, a future-citation reading, an undeclared-method reading, a
// tampered record, a body spec edited to grant execution authority, a
// body spec citing a model identity as evaluation evidence — each must
// FAIL validation with its typed code (the acceptance criteria).
//
// (Type note: fixture literals are authored as plain records and cast to
// the branded contract types once — the brands are compile-time only.)

import { type TimestampMs, deepFreeze } from './primitives';
import { type BodyVersionRef, type EvaluationCriteriaRef, type MethodId, type MethodVersionRef, type ProjectId, type TenantId, type TopicName, type ToolRef } from './ids';
import { type NewsObservation, type SentimentScoreObservation, type ResearchObservation, type ObservationProvenance } from './observations';
import { type ObservationCitation } from './reading';
import { type SentimentReading, createSentimentReading } from './reading';
import { type EventDigest, createEventDigest } from './digest';
import { type ResearchReport, createResearchReport, type CoverageAccounting, type DataGap } from './report';
import {
  SENTIMENT_RESEARCHER_BODY,
  type SentimentResearcherBodySpec,
} from './body';
import {
  type MethodRegistry,
  SENTIMENT_METHOD_REGISTRY,
  SENTIMENT_AGGREGATION_METHOD,
  SENTIMENT_EVENT_DETECTION_METHOD,
  SENTIMENT_CONFIDENCE_METHOD,
  SENTIMENT_REPORT_COMPOSITION_METHOD,
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
export const FIXTURE_PROJECT: ProjectId = 'project-sentiment' as ProjectId;

/** The fixture run seed (lineage material — L9). */
export const FIXTURE_SEED = 'seed/sentiment/fixture-1';

/** The fixture body-version reference. */
export const FIXTURE_BODY_VERSION: BodyVersionRef = 'sentiment-researcher@1.0.0' as BodyVersionRef;

/** The fixture publishing instance (an agent-os AgentInstanceId shape). */
export const FIXTURE_SENDER = 'agent-instance-sentiment-0001';

/** The fixture publication topic (an organization topic — never kernel.*). */
export const FIXTURE_TOPIC = 'research.sentiment';

/** Casts a literal epoch-millisecond number to `TimestampMs` (fixture discipline). */
const ms = (value: number): TimestampMs => value as TimestampMs;

/** The historical provenance block every fixture observation carries. */
export const FIXTURE_PROVENANCE: ObservationProvenance = deepFreeze({
  origin: 'historical',
  adapter: { id: 'news-adapter', version: '1.0.0' },
  derived_from: [],
  transform: null,
} as ObservationProvenance);

// ---------------------------------------------------------------------------
// Observation fixtures (quartets + provenance; T038 emitter shapes)
// ---------------------------------------------------------------------------

/** Builds a canonical news observation fixture (quartet + provenance). */
export function fixtureNewsObservation(input: {
  readonly eventId: string;
  readonly at: TimestampMs;
  readonly instrument: string;
  readonly venue?: string;
  readonly headline: string;
  readonly symbols?: readonly string[];
  readonly tags?: readonly string[];
}): NewsObservation {
  return deepFreeze({
    event_id: input.eventId,
    venue: input.venue ?? 'NEWSWIRE',
    instrument: input.instrument,
    asset_class: 'equity',
    event_type: 'news',
    event_time: input.at,
    source_time: input.at,
    available_time: input.at,
    ingestion_time: ms((input.at as number) + 1_000),
    sequence: 1,
    provider: 'news-wire-a',
    provenance: FIXTURE_PROVENANCE,
    payload: deepFreeze({
      headline: input.headline,
      source: 'news-wire-a',
      symbols: input.symbols ?? [input.instrument],
      tags: input.tags ?? [],
    }),
  });
}

/** Builds a canonical sentiment-score observation fixture. */
export function fixtureSentimentObservation(input: {
  readonly eventId: string;
  readonly at: TimestampMs;
  readonly instrument: string;
  readonly venue?: string;
  readonly score: string;
  readonly sequence?: number;
}): SentimentScoreObservation {
  return deepFreeze({
    event_id: input.eventId,
    venue: input.venue ?? 'SENTIMENT-VENDOR',
    instrument: input.instrument,
    asset_class: 'equity',
    event_type: 'social_signal',
    event_time: input.at,
    source_time: null,
    available_time: input.at,
    ingestion_time: ms((input.at as number) + 1_000),
    sequence: input.sequence ?? 1,
    provider: 'sentiment-vendor-a',
    provenance: deepFreeze({
      origin: 'historical',
      adapter: { id: 'altdata-adapter', version: '1.0.0' },
      derived_from: [],
      transform: null,
    } as ObservationProvenance),
    payload: deepFreeze({
      platform: 'sentiment-vendor-a',
      metric: 'sentiment_score',
      value: input.score,
    }),
  });
}

/**
 * The golden observation stream: five tightly-clustered positive
 * sentiment scores for TEST-AAA (mean 0.30, dispersion 0.06) and four
 * earnings-tagged news items for TEST-AAA in one clustering window.
 */
export const FIXTURE_OBSERVATIONS: readonly ResearchObservation[] = deepFreeze([
  fixtureSentimentObservation({ eventId: 'obs-sent-001', at: FIXTURE_AT0, instrument: 'TEST-AAA', score: '0.3100', sequence: 1 }),
  fixtureSentimentObservation({ eventId: 'obs-sent-002', at: ms(1_717_423_200_000 + 1_000), instrument: 'TEST-AAA', score: '0.2900', sequence: 2 }),
  fixtureSentimentObservation({ eventId: 'obs-sent-003', at: ms(1_717_423_200_000 + 2_000), instrument: 'TEST-AAA', score: '0.3300', sequence: 3 }),
  fixtureSentimentObservation({ eventId: 'obs-sent-004', at: ms(1_717_423_200_000 + 3_000), instrument: 'TEST-AAA', score: '0.2700', sequence: 4 }),
  fixtureSentimentObservation({ eventId: 'obs-sent-005', at: ms(1_717_423_200_000 + 4_000), instrument: 'TEST-AAA', score: '0.3000', sequence: 5 }),
  fixtureNewsObservation({ eventId: 'obs-news-001', at: FIXTURE_AT0, instrument: 'TEST-AAA', headline: 'TEST-AAA earnings beat expectations', tags: ['earnings'] }),
  fixtureNewsObservation({ eventId: 'obs-news-002', at: ms(1_717_423_200_000 + 1_000), instrument: 'TEST-AAA', headline: 'TEST-AAA earnings call scheduled', tags: ['earnings'] }),
  fixtureNewsObservation({ eventId: 'obs-news-003', at: ms(1_717_423_200_000 + 2_000), instrument: 'TEST-AAA', headline: 'TEST-AAA earnings guidance raised', tags: ['earnings', 'guidance'] }),
  fixtureNewsObservation({ eventId: 'obs-news-004', at: ms(1_717_423_200_000 + 3_000), instrument: 'TEST-AAA', headline: 'TEST-AAA earnings coverage continues', tags: ['earnings'] }),
]);

/** Citations for the five sentiment observations (the golden evidence set). */
export const FIXTURE_SENTIMENT_CITATIONS: readonly ObservationCitation[] = deepFreeze([
  { observationId: 'obs-sent-001', availableTime: FIXTURE_AT0, provenance: FIXTURE_PROVENANCE },
  { observationId: 'obs-sent-002', availableTime: ms(1_717_423_200_000 + 1_000), provenance: FIXTURE_PROVENANCE },
  { observationId: 'obs-sent-003', availableTime: ms(1_717_423_200_000 + 2_000), provenance: FIXTURE_PROVENANCE },
  { observationId: 'obs-sent-004', availableTime: ms(1_717_423_200_000 + 3_000), provenance: FIXTURE_PROVENANCE },
  { observationId: 'obs-sent-005', availableTime: ms(1_717_423_200_000 + 4_000), provenance: FIXTURE_PROVENANCE },
]);

/** Citations for the four news observations (the golden cluster evidence). */
export const FIXTURE_NEWS_CITATIONS: readonly ObservationCitation[] = deepFreeze([
  { observationId: 'obs-news-001', availableTime: FIXTURE_AT0, provenance: FIXTURE_PROVENANCE },
  { observationId: 'obs-news-002', availableTime: ms(1_717_423_200_000 + 1_000), provenance: FIXTURE_PROVENANCE },
  { observationId: 'obs-news-003', availableTime: ms(1_717_423_200_000 + 2_000), provenance: FIXTURE_PROVENANCE },
  { observationId: 'obs-news-004', availableTime: ms(1_717_423_200_000 + 3_000), provenance: FIXTURE_PROVENANCE },
]);

// ---------------------------------------------------------------------------
// Golden output fixtures (built through the real factories)
// ---------------------------------------------------------------------------

function buildGoldenReading(): SentimentReading {
  const construction = createSentimentReading(
    {
      scope: { instrument: 'TEST-AAA', venue: 'SENTIMENT-VENDOR' },
      polarity: {
        methodId: SENTIMENT_AGGREGATION_METHOD.methodId,
        methodVersion: SENTIMENT_AGGREGATION_METHOD.version,
        direction: 'positive',
        score: '0.3000',
      },
      intensity: {
        methodId: SENTIMENT_AGGREGATION_METHOD.methodId,
        methodVersion: SENTIMENT_AGGREGATION_METHOD.version,
        level: 'moderate',
        score: '0.3000',
      },
      confidence: {
        methodId: SENTIMENT_CONFIDENCE_METHOD.methodId,
        methodVersion: SENTIMENT_CONFIDENCE_METHOD.version,
        level: 'high',
        evidenceCount: 5,
        dispersion: '0.0600',
      },
      evidence: FIXTURE_SENTIMENT_CITATIONS,
      asOf: FIXTURE_AS_OF,
      bodyVersion: FIXTURE_BODY_VERSION,
      tenantId: FIXTURE_TENANT,
      projectId: FIXTURE_PROJECT,
      seed: FIXTURE_SEED,
    },
    SENTIMENT_METHOD_REGISTRY,
  );
  if (!construction.ok) {
    throw new TypeError(`golden reading must construct: ${construction.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  }
  return construction.value;
}

function buildGoldenDigest(): EventDigest {
  const construction = createEventDigest(
    {
      kind: 'earnings-announcement',
      instruments: ['TEST-AAA'],
      venues: ['NEWSWIRE'],
      window: { from: FIXTURE_AT0, to: ms(1_717_423_200_000 + 3_000) },
      observationCount: 4,
      evidence: FIXTURE_NEWS_CITATIONS,
      asOf: FIXTURE_AS_OF,
      methodId: SENTIMENT_EVENT_DETECTION_METHOD.methodId,
      methodVersion: SENTIMENT_EVENT_DETECTION_METHOD.version,
      bodyVersion: FIXTURE_BODY_VERSION,
      tenantId: FIXTURE_TENANT,
      projectId: FIXTURE_PROJECT,
      seed: FIXTURE_SEED,
    },
    SENTIMENT_METHOD_REGISTRY,
  );
  if (!construction.ok) {
    throw new TypeError(`golden digest must construct: ${construction.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  }
  return construction.value;
}

/** The golden sentiment reading (deterministic id, deeply frozen). */
export const FIXTURE_READING: SentimentReading = buildGoldenReading();

/** The golden event digest (deterministic id, deeply frozen). */
export const FIXTURE_DIGEST: EventDigest = buildGoldenDigest();

/** The golden coverage accounting: nine offered, nine admitted, nothing dropped. */
export const FIXTURE_COVERAGE: CoverageAccounting = deepFreeze({
  observationsOffered: 9,
  observationsAdmitted: 9,
  observationsDeferred: 0,
  observationsUnsupported: 0,
  observationsInvalid: 0,
});

/** The golden data gaps (one instrument without sentiment coverage). */
export const FIXTURE_DATA_GAPS: readonly DataGap[] = deepFreeze([
  { kind: 'instrument-without-sentiment', instrument: 'TEST-BBB' },
] as readonly DataGap[]);

function buildGoldenReport(): ResearchReport {
  const construction = createResearchReport(
    {
      asOf: FIXTURE_AS_OF,
      bodyVersion: FIXTURE_BODY_VERSION,
      methodId: SENTIMENT_REPORT_COMPOSITION_METHOD.methodId,
      methodVersion: SENTIMENT_REPORT_COMPOSITION_METHOD.version,
      tenantId: FIXTURE_TENANT,
      projectId: FIXTURE_PROJECT,
      seed: FIXTURE_SEED,
      readings: [FIXTURE_READING],
      digests: [FIXTURE_DIGEST],
      summary: {
        readingCount: 1,
        digestCount: 1,
        instrumentCount: 1,
        dominantPolarity: 'positive',
        meanPolarityScore: '0.3000',
        coverage: FIXTURE_COVERAGE,
        dataGaps: FIXTURE_DATA_GAPS,
      },
    },
    SENTIMENT_METHOD_REGISTRY,
  );
  if (!construction.ok) {
    throw new TypeError(`golden report must construct: ${construction.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  }
  return construction.value;
}

/** The golden research report (deterministic id, deeply frozen). */
export const FIXTURE_REPORT: ResearchReport = buildGoldenReport();

// ---------------------------------------------------------------------------
// Violation fixtures (the negative paths — each MUST fail validation)
// ---------------------------------------------------------------------------

/** A reading draft with NO evidence (the evidence law). */
export function evidenceLessReadingDraft(): Omit<SentimentReading, 'readingId'> {
  return {
    ...FIXTURE_READING,
    evidence: [],
  };
}

/** A reading draft citing an observation available AFTER the as-of instant (the L4 law). */
export function futureCitationReadingDraft(): Omit<SentimentReading, 'readingId'> {
  return {
    ...FIXTURE_READING,
    evidence: [
      ...FIXTURE_SENTIMENT_CITATIONS,
      { observationId: 'obs-future-999', availableTime: ms(1_717_423_200_000 + 70_000), provenance: FIXTURE_PROVENANCE },
    ],
  };
}

/** A reading draft citing an UNDECLARED method (the method-honesty law). */
export function undeclaredMethodReadingDraft(): Omit<SentimentReading, 'readingId'> {
  return {
    ...FIXTURE_READING,
    polarity: {
      methodId: 'method/sentiment/magic-number' as MethodId,
      methodVersion: '1.0.0' as MethodVersionRef,
      direction: 'positive',
      score: '0.9000',
    },
  };
}

/** A reading draft citing the declared method at a STALE version. */
export function staleMethodVersionReadingDraft(): Omit<SentimentReading, 'readingId'> {
  return {
    ...FIXTURE_READING,
    confidence: {
      ...FIXTURE_READING.confidence,
      methodVersion: '0.9.0' as MethodVersionRef,
    },
  };
}

/** A reading draft whose confidence cites the AGGREGATION method (kind mismatch). */
export function wrongKindMethodReadingDraft(): Omit<SentimentReading, 'readingId'> {
  return {
    ...FIXTURE_READING,
    confidence: {
      ...FIXTURE_READING.confidence,
      methodId: SENTIMENT_AGGREGATION_METHOD.methodId,
      methodVersion: SENTIMENT_AGGREGATION_METHOD.version,
    },
  };
}

/** A reading draft missing tenant/project (the L12 law). */
export function tenantlessReadingDraft(): Omit<SentimentReading, 'readingId'> {
  return {
    ...FIXTURE_READING,
    tenantId: '' as TenantId,
    projectId: '' as ProjectId,
  };
}

/** A reading draft with DUPLICATE observation citations. */
export function duplicateEvidenceReadingDraft(): Omit<SentimentReading, 'readingId'> {
  return {
    ...FIXTURE_READING,
    evidence: [...FIXTURE_SENTIMENT_CITATIONS, FIXTURE_SENTIMENT_CITATIONS[0]],
  };
}

/** A body spec edited to GRANT execution authority (the L8 trip-wire). */
export function executionGrantedBodySpec(): SentimentResearcherBodySpec {
  return {
    ...SENTIMENT_RESEARCHER_BODY,
    bodyVersion: {
      ...SENTIMENT_RESEARCHER_BODY.bodyVersion,
      composition: {
        ...SENTIMENT_RESEARCHER_BODY.bodyVersion.composition,
        authorityBoundary: {
          ...SENTIMENT_RESEARCHER_BODY.bodyVersion.composition.authorityBoundary,
          allowedActions: [...SENTIMENT_RESEARCHER_BODY.bodyVersion.composition.authorityBoundary.allowedActions, 'EXECUTE'],
        },
      },
    },
  };
}

/** A body spec whose execution authority is NOT 'none' (the L8 trip-wire). */
export function externalGatewayBodySpec(): SentimentResearcherBodySpec {
  return {
    ...SENTIMENT_RESEARCHER_BODY,
    bodyVersion: {
      ...SENTIMENT_RESEARCHER_BODY.bodyVersion,
      composition: {
        ...SENTIMENT_RESEARCHER_BODY.bodyVersion.composition,
        authorityBoundary: {
          ...SENTIMENT_RESEARCHER_BODY.bodyVersion.composition.authorityBoundary,
          executionAuthority: 'external-gateway-only',
        },
      },
    },
  };
}

/** A body spec that does NOT explicitly prohibit EXECUTE (the L8 trip-wire). */
export function executeNotProhibitedBodySpec(): SentimentResearcherBodySpec {
  return {
    ...SENTIMENT_RESEARCHER_BODY,
    bodyVersion: {
      ...SENTIMENT_RESEARCHER_BODY.bodyVersion,
      composition: {
        ...SENTIMENT_RESEARCHER_BODY.bodyVersion.composition,
        authorityBoundary: {
          ...SENTIMENT_RESEARCHER_BODY.bodyVersion.composition.authorityBoundary,
          prohibitedActions: SENTIMENT_RESEARCHER_BODY.bodyVersion.composition.authorityBoundary.prohibitedActions.filter(
            (action) => action !== 'EXECUTE',
          ),
        },
      },
    },
  };
}

/** A body spec whose authority-scope record was edited off the law (the L8 trip-wire). */
export function editedAuthorityScopeBodySpec(): SentimentResearcherBodySpec {
  return {
    ...SENTIMENT_RESEARCHER_BODY,
    research: {
      ...SENTIMENT_RESEARCHER_BODY.research,
      authorityScope: {
        scope: 'observation-research-publication',
        execution: 'external-gateway-only',
        orderPlacement: 'prohibited',
        consequentialActions: 'prohibited',
      },
    },
  } as unknown as SentimentResearcherBodySpec;
}

/** A body spec citing a MODEL IDENTITY as evaluation evidence (the L16a trip-wire). */
export function modelIdentityEvidenceBodySpec(): SentimentResearcherBodySpec {
  return {
    ...SENTIMENT_RESEARCHER_BODY,
    research: {
      ...SENTIMENT_RESEARCHER_BODY.research,
      evaluationCriteriaRefs: ['acme-models/reasoner-2@2026.03' as EvaluationCriteriaRef],
    },
  };
}

/** A body spec whose procedure cites a CONSEQUENTIAL tool (the L8 trip-wire). */
export function consequentialToolBodySpec(): SentimentResearcherBodySpec {
  return {
    ...SENTIMENT_RESEARCHER_BODY,
    bodyVersion: {
      ...SENTIMENT_RESEARCHER_BODY.bodyVersion,
      composition: {
        ...SENTIMENT_RESEARCHER_BODY.bodyVersion.composition,
        knowledgeToolPolicy: {
          ...SENTIMENT_RESEARCHER_BODY.bodyVersion.composition.knowledgeToolPolicy,
          allowedTools: [
            ...SENTIMENT_RESEARCHER_BODY.bodyVersion.composition.knowledgeToolPolicy.allowedTools,
            'tools/order-entry' as ToolRef,
          ],
        },
        procedures: SENTIMENT_RESEARCHER_BODY.bodyVersion.composition.procedures.map((procedure) => ({
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
export function nonResearchCapabilityBodySpec(): SentimentResearcherBodySpec {
  return {
    ...SENTIMENT_RESEARCHER_BODY,
    bodyVersion: {
      ...SENTIMENT_RESEARCHER_BODY.bodyVersion,
      composition: {
        ...SENTIMENT_RESEARCHER_BODY.bodyVersion.composition,
        capabilities: SENTIMENT_RESEARCHER_BODY.bodyVersion.composition.capabilities.map((capability) =>
          capability.id === 'research-publication' ? { ...capability, category: 'execution' } : capability,
        ),
      },
    },
  };
}

/** A body spec publishing to a RESERVED kernel topic. */
export function reservedTopicBodySpec(): SentimentResearcherBodySpec {
  return {
    ...SENTIMENT_RESEARCHER_BODY,
    research: {
      ...SENTIMENT_RESEARCHER_BODY.research,
      publicationTopic: 'kernel.approve' as TopicName,
    },
  };
}

/** A registry the golden outputs cite (re-exported for tests). */
export const FIXTURE_REGISTRY: MethodRegistry = SENTIMENT_METHOD_REGISTRY;
