// @tradrl/research (service) — the regime lane's deterministic fixture set.
//
// Work Order T022, section 5 (fixtures): "scripted market-event windows
// (quotes/trades with quartets + provenance), a golden regime report
// (byte-stable), regime-change fixtures, L4 violation fixtures,
// authority-violation fixtures, evidence-less output fixtures."
//
// The golden report is the BYTE-STABLE pipeline output for the golden
// scripted stream + config: the determinism test runs the pipeline twice
// and asserts deep-equality and identical canonical bytes. The golden
// stream is the body package's golden observation set (the ranging ->
// trending-up story over TEST-AAA's two declared windows, the TEST-BBB
// data gap, and the one future observation).

import {
  type AgentInstanceId,
  type MarketObservation,
  type MarketObservationSource,
  type ProjectId,
  type RegimeResearcherBodySpec,
  type TenantId,
  type TimestampMs,
  type TopicName,
  createRegimeRecordingPort,
  createScriptedMarketSource,
  deepFreeze,
} from './imports';
import { type RegimeRunConfig, runRegimePipeline } from './pipeline';
import {
  FIXTURE_AS_OF as BODY_AS_OF,
  FIXTURE_AT0 as BODY_AT0,
  FIXTURE_BODY_VERSION,
  FIXTURE_OBSERVATIONS,
  FIXTURE_PROVENANCE,
  FIXTURE_REGISTRY,
  FIXTURE_REPORT,
  FIXTURE_SEED,
  FIXTURE_SENDER as BODY_SENDER,
  FIXTURE_TENANT as BODY_TENANT,
  FIXTURE_TOPIC as BODY_TOPIC,
  evidenceLessClassificationDraft,
  executionGrantedBodySpec,
  fixtureBookSnapshotObservation,
  fixtureQuoteObservation,
  fixtureTradeObservation,
  futureCitationClassificationDraft,
  magicLabelClassificationDraft,
  undeclaredMethodClassificationDraft,
} from '../../../../bodies/regime-researcher/src/fixtures';

/** The service fixture epoch anchor. */
export const REGIME_AT0: TimestampMs = BODY_AT0;

/** The service fixture as-of instant. */
export const REGIME_AS_OF: TimestampMs = BODY_AS_OF;

/** The golden run config (every instant explicit — no ambient clock). */
export const REGIME_RUN_CONFIG: RegimeRunConfig = deepFreeze({
  asOf: REGIME_AS_OF,
  bodyVersion: FIXTURE_BODY_VERSION,
  tenantId: BODY_TENANT as TenantId,
  projectId: 'project-regime' as ProjectId,
  seed: FIXTURE_SEED,
  sender: BODY_SENDER as AgentInstanceId,
  topic: BODY_TOPIC as TopicName,
  opId: 'op-regime-0001',
  publicationSequence: 1,
  publishedAt: REGIME_AS_OF,
} as RegimeRunConfig);

/**
 * THE GOLDEN SCRIPTED STREAM: the body package's golden observation set
 * (window W0 of TEST-AAA ranging 100.00 -> 100.60; window W1 trending
 * 100.60 -> 104.80; TEST-BBB below the declared minimum of four; one
 * FUTURE observation available after the as-of instant — the L4 violation
 * fixture).
 */
export const REGIME_STREAM: readonly MarketObservation[] = deepFreeze([...FIXTURE_OBSERVATIONS]);

/** The golden observation source over the golden stream. */
export function regimeFixtureSource(): MarketObservationSource {
  return createScriptedMarketSource(
    { id: 'regime-fixture-source', version: '1.0.0', provider: 'market-replay' },
    REGIME_STREAM,
  );
}

/** The golden inputs: the scripted source + a fresh recording port. */
export function regimeFixtureInputs(): { readonly sources: readonly MarketObservationSource[]; readonly publisher: ReturnType<typeof createRegimeRecordingPort> } {
  return { sources: [regimeFixtureSource()], publisher: createRegimeRecordingPort() };
}

// ---------------------------------------------------------------------------
// The golden research report (byte-stable pipeline output)
// ---------------------------------------------------------------------------

function buildGoldenOutcome() {
  const outcome = runRegimePipeline(REGIME_RUN_CONFIG, regimeFixtureInputs());
  if (!outcome.ok) {
    throw new TypeError(
      `golden outcome must construct: ${outcome.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
    );
  }
  return outcome.value;
}

type GoldenOutcome = ReturnType<typeof buildGoldenOutcome>;

/** The golden run outcome (report id, publication, outputs, coverage). */
export const REGIME_OUTCOME: GoldenOutcome = deepFreeze(buildGoldenOutcome());

/** The golden regime research report (byte-stable — equals the body package's golden report). */
export const REGIME_GOLDEN_REPORT = REGIME_OUTCOME.publication.report;

// ---------------------------------------------------------------------------
// Violation fixtures (each MUST fail its stage with its typed code)
// ---------------------------------------------------------------------------

/**
 * An L4-violating stream: observations available only after the as-of
 * instant (a full second window for TEST-CCC that must NEVER be consumed).
 */
export const REGIME_L4_VIOLATION_STREAM: readonly MarketObservation[] = deepFreeze([
  fixtureQuoteObservation({ eventId: 'obs-l4-001', at: ms(REGIME_AS_OF + 10_000), instrument: 'TEST-CCC', bid: '200.00', ask: '200.02' }),
  fixtureTradeObservation({ eventId: 'obs-l4-002', at: ms(REGIME_AS_OF + 11_000), instrument: 'TEST-CCC', price: '200.10' }),
  fixtureQuoteObservation({ eventId: 'obs-l4-003', at: ms(REGIME_AS_OF + 12_000), instrument: 'TEST-CCC', bid: '200.20', ask: '200.22' }),
  fixtureTradeObservation({ eventId: 'obs-l4-004', at: ms(REGIME_AS_OF + 13_000), instrument: 'TEST-CCC', price: '200.30' }),
  fixtureBookSnapshotObservation({ eventId: 'obs-l4-005', at: ms(REGIME_AS_OF + 14_000), instrument: 'TEST-CCC', bestBid: '200.39', bestAsk: '200.41' }),
]);

/** The L4-violating source (everything future). */
export function l4RegimeViolationSource(): MarketObservationSource {
  return createScriptedMarketSource(
    { id: 'regime-l4-fixture', version: '1.0.0', provider: 'market-replay' },
    REGIME_L4_VIOLATION_STREAM,
  );
}

/** An authority-violation body spec (EXECUTE granted — the L8 trip-wire). */
export function regimeAuthorityViolationSpec(): RegimeResearcherBodySpec {
  return executionGrantedBodySpec();
}

/** An evidence-less classification draft (the evidence law fixture). */
export function evidenceLessClassification() {
  return evidenceLessClassificationDraft();
}

/** A future-citation classification draft (the L4 evidence law fixture). */
export function futureCitationClassification() {
  return futureCitationClassificationDraft();
}

/** An undeclared-method classification draft (the method-honesty fixture). */
export function undeclaredMethodClassification() {
  return undeclaredMethodClassificationDraft();
}

/** A magic-label classification draft (the closed-taxonomy fixture). */
export function magicLabelClassification() {
  return magicLabelClassificationDraft();
}

function ms(value: number): TimestampMs {
  return value as TimestampMs;
}

// Re-exports for tests (the body-package fixture world).
export {
  BODY_AS_OF,
  BODY_AT0,
  BODY_SENDER,
  BODY_TENANT,
  BODY_TOPIC,
  FIXTURE_PROVENANCE,
  FIXTURE_REGISTRY,
  FIXTURE_REPORT,
  FIXTURE_SEED,
};
