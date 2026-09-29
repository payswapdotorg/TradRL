// @tradrl/research (service) — the deterministic fixture set.
//
// Work Order T021, section 5 (fixtures): "scripted observation streams
// (news items with quartets, sentiment scores with provenance), a golden
// research report (byte-stable), L4 violation fixtures,
// authority-violation fixtures, evidence-less output fixtures."
//
// The golden report is the BYTE-STABLE pipeline output for the golden
// scripted stream + config: the determinism test runs the pipeline twice
// and asserts deep-equality and identical canonical bytes.

import {
  type AgentInstanceId,
  type ObservationSource,
  type ProjectId,
  type ResearchObservation,
  type SentimentResearcherBodySpec,
  type TenantId,
  type TimestampMs,
  type TopicName,
  createRecordingPublicationPort,
  createScriptedObservationSource,
  deepFreeze,
} from './imports';
import { type ResearchRunConfig, runResearchPipeline } from './pipeline';
import {
  FIXTURE_AS_OF as BODY_AS_OF,
  FIXTURE_AT0 as BODY_AT0,
  FIXTURE_BODY_VERSION,
  FIXTURE_PROVENANCE,
  FIXTURE_READING,
  FIXTURE_REGISTRY,
  FIXTURE_SEED,
  FIXTURE_SENDER as BODY_SENDER,
  FIXTURE_TENANT as BODY_TENANT,
  FIXTURE_TOPIC as BODY_TOPIC,
  evidenceLessReadingDraft,
  executionGrantedBodySpec,
  futureCitationReadingDraft,
  undeclaredMethodReadingDraft,
  fixtureNewsObservation,
  fixtureSentimentObservation,
} from '../../../../bodies/sentiment-researcher/src/fixtures';

/** The service fixture epoch anchor. */
export const FIXTURE_AT0: TimestampMs = BODY_AT0;

/** The service fixture as-of instant. */
export const FIXTURE_AS_OF: TimestampMs = BODY_AS_OF;

/** The golden run config (every instant explicit — no ambient clock). */
export const FIXTURE_RUN_CONFIG: ResearchRunConfig = deepFreeze({
  asOf: FIXTURE_AS_OF,
  bodyVersion: FIXTURE_BODY_VERSION,
  tenantId: BODY_TENANT as TenantId,
  projectId: 'project-sentiment' as ProjectId,
  seed: FIXTURE_SEED,
  sender: BODY_SENDER as AgentInstanceId,
  topic: BODY_TOPIC as TopicName,
  opId: 'op-research-0001',
  publicationSequence: 1,
  publishedAt: FIXTURE_AS_OF,
} as ResearchRunConfig);

/**
 * THE GOLDEN SCRIPTED STREAM: five tightly-clustered positive sentiment
 * scores for TEST-AAA (mean 0.30, dispersion 0.06), four earnings-tagged
 * news items for TEST-AAA (one clustering window), two news items for
 * TEST-BBB (below the declared minimum of three — a data gap, not a
 * digest), and ONE FUTURE observation (available after the as-of
 * instant — the L4 violation fixture).
 */
export const FIXTURE_STREAM: readonly ResearchObservation[] = deepFreeze([
  fixtureSentimentObservation({ eventId: 'obs-sent-001', at: FIXTURE_AT0, instrument: 'TEST-AAA', score: '0.3100', sequence: 1 }),
  fixtureSentimentObservation({ eventId: 'obs-sent-002', at: ms(FIXTURE_AT0 + 1_000), instrument: 'TEST-AAA', score: '0.2900', sequence: 2 }),
  fixtureSentimentObservation({ eventId: 'obs-sent-003', at: ms(FIXTURE_AT0 + 2_000), instrument: 'TEST-AAA', score: '0.3300', sequence: 3 }),
  fixtureSentimentObservation({ eventId: 'obs-sent-004', at: ms(FIXTURE_AT0 + 3_000), instrument: 'TEST-AAA', score: '0.2700', sequence: 4 }),
  fixtureSentimentObservation({ eventId: 'obs-sent-005', at: ms(FIXTURE_AT0 + 4_000), instrument: 'TEST-AAA', score: '0.3000', sequence: 5 }),
  fixtureNewsObservation({ eventId: 'obs-news-001', at: FIXTURE_AT0, instrument: 'TEST-AAA', headline: 'TEST-AAA earnings beat expectations', tags: ['earnings'] }),
  fixtureNewsObservation({ eventId: 'obs-news-002', at: ms(FIXTURE_AT0 + 1_000), instrument: 'TEST-AAA', headline: 'TEST-AAA earnings call scheduled', tags: ['earnings'] }),
  fixtureNewsObservation({ eventId: 'obs-news-003', at: ms(FIXTURE_AT0 + 2_000), instrument: 'TEST-AAA', headline: 'TEST-AAA earnings guidance raised', tags: ['earnings', 'guidance'] }),
  fixtureNewsObservation({ eventId: 'obs-news-004', at: ms(FIXTURE_AT0 + 3_000), instrument: 'TEST-AAA', headline: 'TEST-AAA earnings coverage continues', tags: ['earnings'] }),
  fixtureNewsObservation({ eventId: 'obs-news-101', at: FIXTURE_AT0, instrument: 'TEST-BBB', headline: 'TEST-BBB product teardown review', tags: ['product'] }),
  fixtureNewsObservation({ eventId: 'obs-news-102', at: ms(FIXTURE_AT0 + 1_000), instrument: 'TEST-BBB', headline: 'TEST-BBB product supply notes', tags: ['product', 'supply'] }),
  // THE L4 VIOLATION FIXTURE: available AFTER the as-of instant — the
  // pipeline must DEFER it, never consume it.
  fixtureSentimentObservation({ eventId: 'obs-future-001', at: ms(FIXTURE_AS_OF + 30_000), instrument: 'TEST-AAA', score: '0.9000', sequence: 6 }),
]);

function ms(value: number): TimestampMs {
  return value as TimestampMs;
}

/** The golden observation source over the golden stream. */
export function fixtureObservationSource(): ObservationSource {
  return createScriptedObservationSource(
    { id: 'research-fixture-source', version: '1.0.0', provider: 'research-fixtures' },
    FIXTURE_STREAM,
  );
}

/** The golden inputs: the scripted source + a fresh recording port. */
export function fixtureInputs(): { readonly sources: readonly ObservationSource[]; readonly publisher: ReturnType<typeof createRecordingPublicationPort> } {
  return { sources: [fixtureObservationSource()], publisher: createRecordingPublicationPort() };
}

// ---------------------------------------------------------------------------
// The golden research report (byte-stable pipeline output)
// ---------------------------------------------------------------------------

function buildGoldenReport() {
  const outcome = runResearchPipeline(FIXTURE_RUN_CONFIG, fixtureInputs());
  if (!outcome.ok) {
    throw new TypeError(
      `golden report must construct: ${outcome.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
    );
  }
  return outcome.value;
}

type GoldenOutcome = ReturnType<typeof buildGoldenReport>;

/** The golden run outcome (report id, publication, outputs, coverage). */
export const FIXTURE_OUTCOME: GoldenOutcome = deepFreeze(buildGoldenReport());

/** The golden research report (byte-stable). */
export const FIXTURE_GOLDEN_REPORT = FIXTURE_OUTCOME.publication.report;

// ---------------------------------------------------------------------------
// Violation fixtures (each MUST fail its stage with its typed code)
// ---------------------------------------------------------------------------

/** An L4-violating stream: observations available only after the as-of. */
export const L4_VIOLATION_STREAM: readonly ResearchObservation[] = deepFreeze([
  fixtureSentimentObservation({ eventId: 'obs-l4-001', at: ms(FIXTURE_AS_OF + 10_000), instrument: 'TEST-CCC', score: '0.5' }),
  fixtureSentimentObservation({ eventId: 'obs-l4-002', at: ms(FIXTURE_AS_OF + 20_000), instrument: 'TEST-CCC', score: '0.6' }),
  fixtureSentimentObservation({ eventId: 'obs-l4-003', at: ms(FIXTURE_AS_OF + 30_000), instrument: 'TEST-CCC', score: '0.7' }),
  fixtureSentimentObservation({ eventId: 'obs-l4-004', at: ms(FIXTURE_AS_OF + 40_000), instrument: 'TEST-CCC', score: '0.8' }),
  fixtureSentimentObservation({ eventId: 'obs-l4-005', at: ms(FIXTURE_AS_OF + 50_000), instrument: 'TEST-CCC', score: '0.9' }),
]);

/** The L4-violating source (everything future). */
export function l4ViolationSource(): ObservationSource {
  return createScriptedObservationSource(
    { id: 'research-l4-fixture', version: '1.0.0', provider: 'research-fixtures' },
    L4_VIOLATION_STREAM,
  );
}

/** An authority-violation body spec (EXECUTE granted — the L8 trip-wire). */
export function authorityViolationBodySpec(): SentimentResearcherBodySpec {
  return executionGrantedBodySpec();
}

/** An evidence-less reading draft (the evidence law fixture). */
export function evidenceLessReading() {
  return evidenceLessReadingDraft();
}

/** A future-citation reading draft (the L4 evidence law fixture). */
export function futureCitationReading() {
  return futureCitationReadingDraft();
}

/** An undeclared-method reading draft (the method-honesty fixture). */
export function undeclaredMethodReading() {
  return undeclaredMethodReadingDraft();
}

/** Re-exports for tests (the body-package fixture world). */
export {
  BODY_AS_OF,
  BODY_AT0,
  BODY_SENDER,
  BODY_TENANT,
  BODY_TOPIC,
  FIXTURE_PROVENANCE,
  FIXTURE_READING,
  FIXTURE_REGISTRY,
  FIXTURE_SEED,
};
