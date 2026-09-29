// @tradrl/research (service) — the cross-market lane's deterministic fixture set.
//
// Work Order T023, section 5 (fixtures): "scripted equities/alt-data
// observation windows (with quartets + provenance), golden fundamental +
// cross-market reports (byte-stable), L4 violation fixtures,
// authority-violation fixtures (both bodies), evidence-less output
// fixtures." (the cross-market lane's half).
//
// The golden report is the BYTE-STABLE pipeline output for the golden
// scripted stream + config: the determinism test runs the pipeline twice
// and asserts deep-equality and identical canonical bytes. The golden
// stream is the body package's golden observation set (three market
// legs over four epoch-aligned windows, plus the one future observation
// the L4 gate must defer).

import {
  type AgentInstanceId,
  type CrossMarketObservationSource,
  type ProjectId,
  type CrossMarketResearcherBodySpec,
  type TenantId,
  type TimestampMs,
  type TopicName,
  createCrossMarketRecordingPort,
  createScriptedCrossMarketSource,
  deepFreeze,
  fixtureTradeObservation,
} from './imports';
import { type CrossMarketRunConfig, runCrossMarketPipeline } from './pipeline';
import {
  FIXTURE_AS_OF as BODY_AS_OF,
  FIXTURE_AT0 as BODY_AT0,
  FIXTURE_BODY_VERSION,
  FIXTURE_CHAIN_OBSERVATIONS,
  FIXTURE_AAA_OBSERVATIONS,
  FIXTURE_LARGECAP_OBSERVATIONS,
  FIXTURE_REGISTRY,
  FIXTURE_SEED,
  FIXTURE_SENDER as BODY_SENDER,
  FIXTURE_TENANT as BODY_TENANT,
  FIXTURE_TOPIC as BODY_TOPIC,
  evidenceLessRelationshipDraft,
  executionGrantedBodySpec,
  futureCitationRelationshipDraft,
  undeclaredMethodRelationshipDraft,
} from '../../../../bodies/cross-market-researcher/src/fixtures';

/** The service fixture epoch anchor. */
export const CROSS_MARKET_AT0: TimestampMs = BODY_AT0;

/** The service fixture as-of instant. */
export const CROSS_MARKET_AS_OF: TimestampMs = BODY_AS_OF;

/** The golden run config (every instant explicit — no ambient clock). */
export const CROSS_MARKET_RUN_CONFIG: CrossMarketRunConfig = deepFreeze({
  asOf: CROSS_MARKET_AS_OF,
  bodyVersion: FIXTURE_BODY_VERSION,
  tenantId: BODY_TENANT as TenantId,
  projectId: 'project-crossmarket' as ProjectId,
  seed: FIXTURE_SEED,
  sender: BODY_SENDER as AgentInstanceId,
  topic: BODY_TOPIC as TopicName,
  opId: 'op-crossmarket-0001',
  publicationSequence: 1,
  publishedAt: CROSS_MARKET_AS_OF,
} as CrossMarketRunConfig);

function ms(value: number): TimestampMs {
  return value as TimestampMs;
}

/**
 * THE GOLDEN SCRIPTED STREAM: the body package's three golden legs
 * (TEST-CHAIN-A flat crypto trades, TEST-LARGECAP rising index levels,
 * TEST-AAA rising equity trades) plus ONE FUTURE observation (available
 * after the as-of instant — the L4 violation fixture the gate must
 * defer, never consume).
 */
export const CROSS_MARKET_STREAM = deepFreeze([
  ...FIXTURE_CHAIN_OBSERVATIONS,
  ...FIXTURE_LARGECAP_OBSERVATIONS,
  ...FIXTURE_AAA_OBSERVATIONS,
  // THE L4 VIOLATION FIXTURE: available AFTER the as-of instant — the
  // pipeline must DEFER it, never consume it.
  fixtureTradeObservation({ eventId: 'obs-cm-future-001', at: ms(CROSS_MARKET_AS_OF + 60_000), instrument: 'TEST-AAA', venue: 'TESTEX', assetClass: 'equity', price: '99.0000', sequence: 5 }),
] as const);

/** The golden observation source over the golden stream. */
export function crossMarketFixtureSource(): CrossMarketObservationSource {
  return createScriptedCrossMarketSource(
    { id: 'crossmarket-fixture-source', version: '1.0.0', provider: 'research-fixtures' },
    CROSS_MARKET_STREAM as never,
  );
}

/** The golden inputs: the multi-source ports + a fresh recording port. */
export function crossMarketFixtureInputs(): { readonly sources: readonly CrossMarketObservationSource[]; readonly publisher: ReturnType<typeof createCrossMarketRecordingPort> } {
  // THE MULTI-SOURCE DISCIPLINE: one port per venue/adapter lane.
  return {
    sources: [
      createScriptedCrossMarketSource({ id: 'src-chainx', version: '1.0.0', provider: 'venue-market-data-a' }, FIXTURE_CHAIN_OBSERVATIONS as never),
      createScriptedCrossMarketSource({ id: 'src-licensed-index', version: '1.0.0', provider: 'licensed-index-a' }, FIXTURE_LARGECAP_OBSERVATIONS as never),
      createScriptedCrossMarketSource({ id: 'src-testex', version: '1.0.0', provider: 'venue-market-data-a' }, [...FIXTURE_AAA_OBSERVATIONS, fixtureTradeObservation({ eventId: 'obs-cm-future-001', at: ms(CROSS_MARKET_AS_OF + 60_000), instrument: 'TEST-AAA', venue: 'TESTEX', assetClass: 'equity', price: '99.0000', sequence: 5 })] as never),
    ],
    publisher: createCrossMarketRecordingPort(),
  };
}

// ---------------------------------------------------------------------------
// The golden research report (byte-stable pipeline output)
// ---------------------------------------------------------------------------

function buildGoldenReport() {
  const outcome = runCrossMarketPipeline(CROSS_MARKET_RUN_CONFIG, crossMarketFixtureInputs());
  if (!outcome.ok) {
    throw new TypeError(
      `golden cross-market report must construct: ${outcome.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
    );
  }
  return outcome.value;
}

type GoldenOutcome = ReturnType<typeof buildGoldenReport>;

/** The golden run outcome (report id, publication, outputs, coverage). */
export const CROSS_MARKET_OUTCOME: GoldenOutcome = deepFreeze(buildGoldenReport());

/** The golden cross-market research report (byte-stable). */
export const CROSS_MARKET_GOLDEN_REPORT = CROSS_MARKET_OUTCOME.publication.report;

// ---------------------------------------------------------------------------
// Violation fixtures (each MUST fail its stage with its typed code)
// ---------------------------------------------------------------------------

/** An L4-violating stream: observations available only after the as-of. */
export const CROSS_MARKET_L4_VIOLATION_STREAM = deepFreeze([
  fixtureTradeObservation({ eventId: 'obs-l4-001', at: ms(CROSS_MARKET_AS_OF + 10_000), instrument: 'TEST-ZZZ', venue: 'TESTEX', assetClass: 'equity', price: '10.0000', sequence: 1 }),
  fixtureTradeObservation({ eventId: 'obs-l4-002', at: ms(CROSS_MARKET_AS_OF + 20_000), instrument: 'TEST-ZZZ', venue: 'TESTEX', assetClass: 'equity', price: '11.0000', sequence: 2 }),
] as const);

/** The L4-violating source (everything future). */
export function crossMarketL4ViolationSource(): CrossMarketObservationSource {
  return createScriptedCrossMarketSource(
    { id: 'crossmarket-l4-fixture', version: '1.0.0', provider: 'research-fixtures' },
    CROSS_MARKET_L4_VIOLATION_STREAM as never,
  );
}

/** An authority-violation body spec (EXECUTE granted — the L8 trip-wire). */
export function crossMarketAuthorityViolationBodySpec(): CrossMarketResearcherBodySpec {
  return executionGrantedBodySpec();
}

/** An evidence-less relationship draft (the evidence law fixture). */
export function crossMarketEvidenceLessRelationship() {
  return evidenceLessRelationshipDraft();
}

/** A future-citation relationship draft (the L4 evidence law fixture). */
export function crossMarketFutureCitationRelationship() {
  return futureCitationRelationshipDraft();
}

/** An undeclared-method relationship draft (the method-honesty fixture). */
export function crossMarketUndeclaredMethodRelationship() {
  return undeclaredMethodRelationshipDraft();
}

/** Re-exports for tests (the body-package fixture world). */
export {
  BODY_AS_OF,
  BODY_AT0,
  BODY_SENDER,
  BODY_TENANT,
  BODY_TOPIC,
  FIXTURE_REGISTRY,
  FIXTURE_SEED,
};
