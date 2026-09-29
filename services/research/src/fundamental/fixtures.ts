// @tradrl/research (service) — the fundamental lane's deterministic fixture set.
//
// Work Order T023, section 5 (fixtures): "scripted equities/alt-data
// observation windows (with quartets + provenance), golden fundamental +
// cross-market reports (byte-stable), L4 violation fixtures,
// authority-violation fixtures (both bodies), evidence-less output
// fixtures." (the fundamental lane's half).
//
// The golden report is the BYTE-STABLE pipeline output for the golden
// scripted stream + config: the determinism test runs the pipeline twice
// and asserts deep-equality and identical canonical bytes. The golden
// stream is the body package's golden observation set (the extended
// index level, the above-consensus CPI releases, the rising rig count,
// the split + dividend, the unassessed series, and the one future
// observation the L4 gate must defer).

import {
  type AgentInstanceId,
  type FundamentalObservationSource,
  type ProjectId,
  type FundamentalResearcherBodySpec,
  type TenantId,
  type TimestampMs,
  type TopicName,
  createFundamentalRecordingPort,
  createScriptedObservationSource,
  deepFreeze,
  fixtureActionObservation,
  fixtureFundamentalObservation,
} from './imports';
import { type FundamentalRunConfig, runFundamentalPipeline } from './pipeline';
import {
  FIXTURE_AS_OF as BODY_AS_OF,
  FIXTURE_AT0 as BODY_AT0,
  FIXTURE_BODY_VERSION,
  FIXTURE_PROVENANCE,
  FIXTURE_REGISTRY,
  FIXTURE_SEED,
  FIXTURE_SENDER as BODY_SENDER,
  FIXTURE_TENANT as BODY_TENANT,
  FIXTURE_TOPIC as BODY_TOPIC,
  evidenceLessAssessmentDraft,
  executionGrantedBodySpec,
  fixtureMacroObservation,
  futureCitationAssessmentDraft,
  undeclaredMethodAssessmentDraft,
} from '../../../../bodies/fundamental-researcher/src/fixtures';
// (the macro fixture builder rides through imports for the stream below)

/** The service fixture epoch anchor. */
export const FUNDAMENTAL_AT0: TimestampMs = BODY_AT0;

/** The service fixture as-of instant. */
export const FUNDAMENTAL_AS_OF: TimestampMs = BODY_AS_OF;

/** The golden run config (every instant explicit — no ambient clock). */
export const FUNDAMENTAL_RUN_CONFIG: FundamentalRunConfig = deepFreeze({
  asOf: FUNDAMENTAL_AS_OF,
  bodyVersion: FIXTURE_BODY_VERSION,
  tenantId: BODY_TENANT as TenantId,
  projectId: 'project-fundamental' as ProjectId,
  seed: FIXTURE_SEED,
  sender: BODY_SENDER as AgentInstanceId,
  topic: BODY_TOPIC as TopicName,
  opId: 'op-fundamental-0001',
  publicationSequence: 1,
  publishedAt: FUNDAMENTAL_AS_OF,
} as FundamentalRunConfig);

function ms(value: number): TimestampMs {
  return value as TimestampMs;
}

/**
 * THE GOLDEN SCRIPTED STREAM: the body package's fourteen golden
 * observations (five index levels, two CPI releases, four rig counts,
 * two corporate actions, one unassessed series) plus ONE FUTURE
 * observation (available after the as-of instant — the L4 violation
 * fixture the gate must defer, never consume).
 */
export const FUNDAMENTAL_STREAM: readonly ReturnType<typeof fixtureFundamentalObservation | typeof fixtureMacroObservation>[] = deepFreeze([
  fixtureFundamentalObservation({ eventId: 'obs-fund-001', at: FUNDAMENTAL_AT0, instrument: 'TEST-LARGECAP', field: 'INDEX_LEVEL', period: '2024-06-03', value: '100.0000', sequence: 1 }),
  fixtureFundamentalObservation({ eventId: 'obs-fund-002', at: ms(FUNDAMENTAL_AT0 + 1_000), instrument: 'TEST-LARGECAP', field: 'INDEX_LEVEL', period: '2024-06-03', value: '101.0000', sequence: 2 }),
  fixtureFundamentalObservation({ eventId: 'obs-fund-003', at: ms(FUNDAMENTAL_AT0 + 2_000), instrument: 'TEST-LARGECAP', field: 'INDEX_LEVEL', period: '2024-06-03', value: '100.5000', sequence: 3 }),
  fixtureFundamentalObservation({ eventId: 'obs-fund-004', at: ms(FUNDAMENTAL_AT0 + 3_000), instrument: 'TEST-LARGECAP', field: 'INDEX_LEVEL', period: '2024-06-03', value: '100.7500', sequence: 4 }),
  fixtureFundamentalObservation({ eventId: 'obs-fund-005', at: ms(FUNDAMENTAL_AT0 + 4_000), instrument: 'TEST-LARGECAP', field: 'INDEX_LEVEL', period: '2024-06-03', value: '103.0000', sequence: 5 }),
  fixtureMacroObservation({ eventId: 'obs-macro-001', at: FUNDAMENTAL_AT0, instrument: 'TEST-ECON-CPI', period: '2024-04', actual: '3.4', forecast: '3.2', prior: '3.4', sequence: 1 }),
  fixtureMacroObservation({ eventId: 'obs-macro-002', at: ms(FUNDAMENTAL_AT0 + 1_000), instrument: 'TEST-ECON-CPI', period: '2024-05', actual: '3.3', forecast: '3.25', prior: '3.4', sequence: 2 }),
  fixtureFundamentalObservation({ eventId: 'obs-health-001', at: FUNDAMENTAL_AT0, instrument: 'TEST-SAT-OIL', assetClass: 'commodity', venue: 'SAT-VENDOR', field: 'ACTIVE_RIG_COUNT', period: '2024-W22', value: '100.0000', sequence: 1 }),
  fixtureFundamentalObservation({ eventId: 'obs-health-002', at: ms(FUNDAMENTAL_AT0 + 1_000), instrument: 'TEST-SAT-OIL', assetClass: 'commodity', venue: 'SAT-VENDOR', field: 'ACTIVE_RIG_COUNT', period: '2024-W23', value: '102.0000', sequence: 2 }),
  fixtureFundamentalObservation({ eventId: 'obs-health-003', at: ms(FUNDAMENTAL_AT0 + 2_000), instrument: 'TEST-SAT-OIL', assetClass: 'commodity', venue: 'SAT-VENDOR', field: 'ACTIVE_RIG_COUNT', period: '2024-W24', value: '105.0000', sequence: 3 }),
  fixtureFundamentalObservation({ eventId: 'obs-health-004', at: ms(FUNDAMENTAL_AT0 + 3_000), instrument: 'TEST-SAT-OIL', assetClass: 'commodity', venue: 'SAT-VENDOR', field: 'ACTIVE_RIG_COUNT', period: '2024-W25', value: '108.0000', sequence: 4 }),
  fixtureFundamentalObservation({ eventId: 'obs-fund-101', at: FUNDAMENTAL_AT0, instrument: 'TEST-MIDCAP', field: 'MISC_METRIC', period: '2024-06-03', value: '12.5000', sequence: 1 }),
  // the two corporate actions (the split + the cash dividend)
  fixtureActionObservation({ eventId: 'obs-action-001', at: ms(FUNDAMENTAL_AT0 + 10_000), instrument: 'TEST-AAA', action: 'split', effectiveDate: '2024-06-10', ratio: '4:1' }),
  fixtureActionObservation({ eventId: 'obs-action-002', at: ms(FUNDAMENTAL_AT0 + 11_000), instrument: 'TEST-BBB', action: 'cash_dividend', effectiveDate: '2024-06-17', ratio: '1:4' }),
  // THE L4 VIOLATION FIXTURE: available AFTER the as-of instant — the
  // pipeline must DEFER it, never consume it.
  fixtureFundamentalObservation({ eventId: 'obs-future-001', at: ms(FUNDAMENTAL_AS_OF + 30_000), instrument: 'TEST-LARGECAP', field: 'INDEX_LEVEL', period: '2024-06-03', value: '999.0000', sequence: 6 }),
] as never);

/** The golden observation source over the golden stream. */
export function fundamentalFixtureSource(): FundamentalObservationSource {
  return createScriptedObservationSource(
    { id: 'fundamental-fixture-source', version: '1.0.0', provider: 'research-fixtures' },
    FUNDAMENTAL_STREAM as never,
  );
}

/** The golden inputs: the scripted source + a fresh recording port. */
export function fundamentalFixtureInputs(): { readonly sources: readonly FundamentalObservationSource[]; readonly publisher: ReturnType<typeof createFundamentalRecordingPort> } {
  return { sources: [fundamentalFixtureSource()], publisher: createFundamentalRecordingPort() };
}

// ---------------------------------------------------------------------------
// The golden research report (byte-stable pipeline output)
// ---------------------------------------------------------------------------

function buildGoldenReport() {
  const outcome = runFundamentalPipeline(FUNDAMENTAL_RUN_CONFIG, fundamentalFixtureInputs());
  if (!outcome.ok) {
    throw new TypeError(
      `golden fundamental report must construct: ${outcome.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
    );
  }
  return outcome.value;
}

type GoldenOutcome = ReturnType<typeof buildGoldenReport>;

/** The golden run outcome (report id, publication, outputs, coverage). */
export const FUNDAMENTAL_OUTCOME: GoldenOutcome = deepFreeze(buildGoldenReport());

/** The golden fundamental research report (byte-stable). */
export const FUNDAMENTAL_GOLDEN_REPORT = FUNDAMENTAL_OUTCOME.publication.report;

// ---------------------------------------------------------------------------
// Violation fixtures (each MUST fail its stage with its typed code)
// ---------------------------------------------------------------------------

/** An L4-violating stream: observations available only after the as-of. */
export const FUNDAMENTAL_L4_VIOLATION_STREAM: readonly ReturnType<typeof fixtureFundamentalObservation>[] = deepFreeze([
  fixtureFundamentalObservation({ eventId: 'obs-l4-001', at: ms(FUNDAMENTAL_AS_OF + 10_000), instrument: 'TEST-XL', field: 'INDEX_LEVEL', period: '2024-06-03', value: '10.0000', sequence: 1 }),
  fixtureFundamentalObservation({ eventId: 'obs-l4-002', at: ms(FUNDAMENTAL_AS_OF + 20_000), instrument: 'TEST-XL', field: 'INDEX_LEVEL', period: '2024-06-03', value: '11.0000', sequence: 2 }),
] as never);

/** The L4-violating source (everything future). */
export function fundamentalL4ViolationSource(): FundamentalObservationSource {
  return createScriptedObservationSource(
    { id: 'fundamental-l4-fixture', version: '1.0.0', provider: 'research-fixtures' },
    FUNDAMENTAL_L4_VIOLATION_STREAM as never,
  );
}

/** An authority-violation body spec (EXECUTE granted — the L8 trip-wire). */
export function fundamentalAuthorityViolationBodySpec(): FundamentalResearcherBodySpec {
  return executionGrantedBodySpec();
}

/** An evidence-less assessment draft (the evidence law fixture). */
export function fundamentalEvidenceLessAssessment() {
  return evidenceLessAssessmentDraft();
}

/** A future-citation assessment draft (the L4 evidence law fixture). */
export function fundamentalFutureCitationAssessment() {
  return futureCitationAssessmentDraft();
}

/** An undeclared-method assessment draft (the method-honesty fixture). */
export function fundamentalUndeclaredMethodAssessment() {
  return undeclaredMethodAssessmentDraft();
}

/** Re-exports for tests (the body-package fixture world). */
export {
  BODY_AS_OF,
  BODY_AT0,
  BODY_SENDER,
  BODY_TENANT,
  BODY_TOPIC,
  FIXTURE_PROVENANCE,
  FIXTURE_REGISTRY,
  FIXTURE_SEED,
};
