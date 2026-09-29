// @tradrl/research (service) — the resumable run-state tests.
//
// Behavioral: serialize -> parse -> resume, chain-verified; tamper
// trip-wires (rewritten step, removed step, forged run id, wrong
// schema); a published run is immutable; duplicate re-offered
// observation ids are refused.

import { describe, expect, it } from 'vitest';

import {
  type SentimentRunState,
  advanceSentimentRunState,
  completeSentimentRunState,
  createSentimentRunState,
  intakeSentimentRunState,
  parseSentimentRunState,
  resumeSentimentRunState,
  serializeSentimentRunState,
  validateSentimentRunState,
  SENTIMENT_RUN_STATE_SCHEMA,
  createRecordingPublicationPort,
  createScriptedObservationSource,
  canonicalJson,
  type ObservationSource,
  type TenantId,
  type TimestampMs,
} from './index';
import {
  FIXTURE_RUN_CONFIG,
  FIXTURE_STREAM,
  fixtureInputs,
  authorityViolationBodySpec,
} from './fixtures';
import { fixtureNewsObservation, fixtureSentimentObservation } from '../../../../bodies/sentiment-researcher/src/fixtures';

const codesOf = (result: { ok: boolean; errors?: readonly { code: string }[] }): readonly string[] =>
  result.ok ? [] : ((result.errors ?? []) as readonly { code: string }[]).map((e) => e.code);
function unwrap<T>(result: { readonly ok: boolean; readonly errors?: readonly { code: string; message: string }[]; readonly value?: T }): T {
  if (!result.ok) throw new Error(`expected ok, got: ${JSON.stringify(result.errors)}`);
  return result.value as T;
}


const ms = (value: number): TimestampMs => value as TimestampMs;
const AT0 = FIXTURE_RUN_CONFIG.asOf as number;

describe('run-state lifecycle', () => {
  it('creates the genesis state with a derived run id', () => {
    const state = createSentimentRunState(FIXTURE_RUN_CONFIG);
    expect(state.schemaVersion).toBe(SENTIMENT_RUN_STATE_SCHEMA);
    expect(state.chainHead).toBe('genesis');
    expect(state.steps.length).toBe(0);
    expect(state.runId).toMatch(/^research-run-[0-9a-f]{16}$/);
    expect(() => createSentimentRunState({ ...FIXTURE_RUN_CONFIG, tenantId: '' as TenantId })).toThrow(TypeError);
  });

  it('advance runs the pipeline and appends the six chained steps', () => {
    const state = createSentimentRunState(FIXTURE_RUN_CONFIG);
    const inputs = fixtureInputs();
    const advanced = advanceSentimentRunState(state, inputs);
    expect(advanced.ok).toBe(true);
    const next = unwrap(advanced).state;
    expect(next.steps.length).toBe(6);
    expect(next.steps.map((s) => s.stage)).toEqual([
      'intake',
      'l4-gate',
      'aggregate',
      'detect-events',
      'compose',
      'publish',
    ]);
    expect(next.chainHead).toBe(next.steps[5]!.chainDigest);
    expect(next.publishedReportIds.length).toBe(1);
    expect(unwrap(advanced).outcome).not.toBeNull();
    expect(inputs.publisher.published.length).toBe(1);
  });

  it('serialize -> parse round-trips byte-identically (chain verified)', () => {
    const state = createSentimentRunState(FIXTURE_RUN_CONFIG);
    const advanced = advanceSentimentRunState(state, fixtureInputs());
    const bytes = serializeSentimentRunState(unwrap(advanced).state);
    const parsed = parseSentimentRunState(bytes);
    expect(parsed.ok).toBe(true);
    expect(serializeSentimentRunState(unwrap(parsed))).toBe(bytes);
    expect(unwrap(parsed).chainHead).toBe(unwrap(advanced).state.chainHead);
  });
});

describe('THE CHAIN TRIP-WIRES (L9)', () => {
  const advancedState = (): SentimentRunState =>
    unwrap(advanceSentimentRunState(createSentimentRunState(FIXTURE_RUN_CONFIG), fixtureInputs())).state;

  it('a rewritten step note fails the chain (chain_mismatch)', () => {
    const tampered = JSON.parse(JSON.stringify(advancedState()));
    (tampered.steps[2] as { note: string }).note = 'readings=999';
    expect(codesOf(parseSentimentRunState(canonicalJson(tampered)))).toContain('chain_mismatch');
  });

  it('a REMOVED step fails the chain (hidden steps are rewrites)', () => {
    const tampered = JSON.parse(JSON.stringify(advancedState()));
    (tampered.steps as unknown[]).pop();
    expect(codesOf(parseSentimentRunState(canonicalJson(tampered)))).toContain('chain_mismatch');
  });

  it('a forged run id fails (run_config_mismatch)', () => {
    const tampered = JSON.parse(JSON.stringify(advancedState()));
    (tampered as { runId: string }).runId = 'research-run-0000000000000000';
    const codes = codesOf(parseSentimentRunState(canonicalJson(tampered)));
    expect(codes).toContain('run_config_mismatch');
  });

  it('a wrong schema version fails (schema_version_mismatch)', () => {
    const tampered = JSON.parse(JSON.stringify(advancedState()));
    (tampered as { schemaVersion: number }).schemaVersion = 99;
    expect(codesOf(parseSentimentRunState(canonicalJson(tampered)))).toContain('schema_version_mismatch');
  });

  it('non-JSON bytes are typed refusal, never a throw', () => {
    expect(codesOf(parseSentimentRunState('not json'))).toContain('invalid_type');
    expect(codesOf(parseSentimentRunState('42'))).toContain('invalid_type');
  });

  it('validateSentimentRunState refuses garbage', () => {
    for (const garbage of [null, 42, 'x', {}, { schemaVersion: 1, config: null, steps: [], chainHead: 'genesis' }]) {
      expect(validateSentimentRunState(garbage).length).toBeGreaterThan(0);
    }
  });
});

describe('THE RESUME (serialize -> parse -> resume)', () => {
  it('intake-only pass, then resume over the rest — ONE publication over the merged evidence', () => {
    // pass 1: intake only (no publication — the run is not yet complete)
    const firstSource = createScriptedObservationSource(
      { id: 'resume-a', version: '1.0.0', provider: 'resume' },
      FIXTURE_STREAM.slice(0, 5),
    );
    const state = createSentimentRunState(FIXTURE_RUN_CONFIG);
    const afterIntake = intakeSentimentRunState(state, [firstSource]);
    expect(afterIntake.ok).toBe(true);
    expect(unwrap(afterIntake).steps.map((s) => s.stage)).toEqual(['intake', 'l4-gate']);
    expect(unwrap(afterIntake).publishedReportIds.length).toBe(0);

    // serialize -> parse (chain verified) -> resume over the rest
    const bytes = serializeSentimentRunState(unwrap(afterIntake));
    const secondSource: ObservationSource = createScriptedObservationSource(
      { id: 'resume-b', version: '1.0.0', provider: 'resume' },
      FIXTURE_STREAM.slice(5),
    );
    const resumed = resumeSentimentRunState(bytes, {
      sources: [secondSource],
      publisher: createRecordingPublicationPort(),
    });
    expect(resumed.ok).toBe(true);
    const finalState = unwrap(resumed).state;
    // the merged run saw the whole golden stream
    expect(finalState.coverage.observationsOffered).toBe(12);
    expect(finalState.coverage.observationsAdmitted).toBe(11);
    expect(finalState.coverage.observationsDeferred).toBe(1);
    // exactly ONE publication, over the merged evidence
    expect(finalState.publishedReportIds.length).toBe(1);
    expect(finalState.steps.map((s) => s.stage)).toEqual([
      'intake',
      'l4-gate',
      'intake',
      'l4-gate',
      'aggregate',
      'detect-events',
      'compose',
      'publish',
    ]);
    // ...and it is the SAME byte-stable golden report
    expect(unwrap(resumed).outcome.reportId).toBe(
      unwrap(advanceSentimentRunState(createSentimentRunState(FIXTURE_RUN_CONFIG), fixtureInputs())).outcome.reportId,
    );
  });

  it('re-offering an already-admitted observation id is refused (evidence ids are unique)', () => {
    const source = createScriptedObservationSource(
      { id: 'dup', version: '1.0.0', provider: 'dup' },
      FIXTURE_STREAM,
    );
    const state = createSentimentRunState(FIXTURE_RUN_CONFIG);
    const afterIntake = intakeSentimentRunState(state, [source]);
    expect(afterIntake.ok).toBe(true);
    // the same stream again -> duplicate ids (typed refusal, before any publish)
    const again = createScriptedObservationSource(
      { id: 'dup', version: '1.0.0', provider: 'dup' },
      FIXTURE_STREAM,
    );
    const secondIntake = intakeSentimentRunState(unwrap(afterIntake), [again]);
    expect(secondIntake.ok).toBe(false);
    expect(codesOf(secondIntake)).toContain('duplicate_observation_ref');
  });

  it('a published run is immutable (refuses further intake AND completion)', () => {
    const state = createSentimentRunState(FIXTURE_RUN_CONFIG);
    const pass1 = advanceSentimentRunState(state, fixtureInputs());
    const fresh = createScriptedObservationSource(
      { id: 'more', version: '1.0.0', provider: 'more' },
      [fixtureSentimentObservation({ eventId: 'obs-more-001', at: ms(AT0 - 5_000), instrument: 'TEST-DDD', score: '0.4' })],
    );
    const moreIntake = intakeSentimentRunState(unwrap(pass1).state, [fresh]);
    expect(moreIntake.ok).toBe(false);
    expect(codesOf(moreIntake)).toContain('run_config_mismatch');
    const again = completeSentimentRunState(unwrap(pass1).state, createRecordingPublicationPort());
    expect(again.ok).toBe(false);
    expect(codesOf(again)).toContain('run_config_mismatch');
  });

  it('the resume refuses a doctored body spec (the L8 gate holds across resume)', () => {
    const bytes = serializeSentimentRunState(createSentimentRunState(FIXTURE_RUN_CONFIG));
    const resumed = resumeSentimentRunState(
      bytes,
      { sources: [], publisher: createRecordingPublicationPort() },
      authorityViolationBodySpec(),
    );
    expect(resumed.ok).toBe(false);
    expect(codesOf(resumed)).toContain('execution_authority_granted');
  });

  it('empty sources publish an empty but valid report (the declared gaps)', () => {
    const state = createSentimentRunState(FIXTURE_RUN_CONFIG);
    const advanced = advanceSentimentRunState(state, { sources: [], publisher: createRecordingPublicationPort() });
    expect(advanced.ok).toBe(true);
    expect(unwrap(advanced).outcome.readings.length).toBe(0);
    expect(unwrap(advanced).outcome.dataGaps).toEqual([
      { kind: 'no-news-observations', instrument: '' },
      { kind: 'no-sentiment-observations', instrument: '' },
    ]);
  });
});
