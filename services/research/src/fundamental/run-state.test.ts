// @tradrl/research (service) — the fundamental lane's resumable run-state tests.
//
// Behavioral: serialize -> parse -> resume, chain-verified; tamper
// trip-wires (rewritten step, removed step, forged run id, wrong
// schema); a published run is immutable; duplicate re-offered
// observation ids are refused.

import { describe, expect, it } from 'vitest';

import {
  type FundamentalRunState,
  advanceFundamentalRunState,
  completeFundamentalRunState,
  createFundamentalRunState,
  intakeFundamentalRunState,
  parseFundamentalRunState,
  resumeFundamentalRunState,
  serializeFundamentalRunState,
  validateFundamentalRunState,
  FUNDAMENTAL_RUN_STATE_SCHEMA,
  FUNDAMENTAL_RUN_CONFIG,
  FUNDAMENTAL_STREAM,
  fundamentalFixtureInputs,
  fundamentalAuthorityViolationBodySpec,
} from './index';
// the contract surface lives in the body package (the service-root
// collision law): tests import it through the body package's own surface.
import {
  createFundamentalRecordingPort,
  createScriptedObservationSource,
  canonicalJson,
  fixtureFundamentalObservation,
  fixtureMacroObservation,
  type FundamentalObservationSource,
  type TimestampMs,
} from '../../../../bodies/fundamental-researcher/src/index';

const codesOf = (result: { ok: boolean; errors?: readonly { code: string }[] }): readonly string[] =>
  result.ok ? [] : ((result.errors ?? []) as readonly { code: string }[]).map((e) => e.code);
function unwrap<T>(result: { readonly ok: boolean; readonly errors?: readonly { code: string; message: string }[]; readonly value?: T }): T {
  if (!result.ok) throw new Error(`expected ok, got: ${JSON.stringify(result.errors)}`);
  return result.value as T;
}


const ms = (value: number): TimestampMs => value as TimestampMs;
const AT0 = FUNDAMENTAL_RUN_CONFIG.asOf as number;

describe('run-state lifecycle', () => {
  it('creates the genesis state with a derived run id', () => {
    const state = createFundamentalRunState(FUNDAMENTAL_RUN_CONFIG);
    expect(state.schemaVersion).toBe(FUNDAMENTAL_RUN_STATE_SCHEMA);
    expect(state.chainHead).toBe('genesis');
    expect(state.steps.length).toBe(0);
    expect(state.runId).toMatch(/^fundamental-run-[0-9a-f]{16}$/);
    expect(() => createFundamentalRunState({ ...FUNDAMENTAL_RUN_CONFIG, tenantId: '' as never })).toThrow(TypeError);
  });

  it('advance runs the pipeline and appends the six chained steps', () => {
    const state = createFundamentalRunState(FUNDAMENTAL_RUN_CONFIG);
    const inputs = fundamentalFixtureInputs();
    const advanced = advanceFundamentalRunState(state, inputs);
    expect(advanced.ok).toBe(true);
    const next = unwrap(advanced).state;
    expect(next.steps.length).toBe(6);
    expect(next.steps.map((s) => s.stage)).toEqual([
      'intake',
      'l4-gate',
      'assess',
      'digest-actions',
      'compose',
      'publish',
    ]);
    expect(next.chainHead).toBe(next.steps[5]!.chainDigest);
    expect(next.publishedReportIds.length).toBe(1);
    expect(unwrap(advanced).outcome).not.toBeNull();
    expect(inputs.publisher.published.length).toBe(1);
  });

  it('serialize -> parse round-trips byte-identically (chain verified)', () => {
    const state = createFundamentalRunState(FUNDAMENTAL_RUN_CONFIG);
    const advanced = advanceFundamentalRunState(state, fundamentalFixtureInputs());
    const bytes = serializeFundamentalRunState(unwrap(advanced).state);
    const parsed = parseFundamentalRunState(bytes);
    expect(parsed.ok).toBe(true);
    expect(serializeFundamentalRunState(unwrap(parsed))).toBe(bytes);
    expect(unwrap(parsed).chainHead).toBe(unwrap(advanced).state.chainHead);
  });
});

describe('THE CHAIN TRIP-WIRES (L9)', () => {
  const advancedState = (): FundamentalRunState =>
    unwrap(advanceFundamentalRunState(createFundamentalRunState(FUNDAMENTAL_RUN_CONFIG), fundamentalFixtureInputs())).state;

  it('a rewritten step note fails the chain (chain_mismatch)', () => {
    const tampered = JSON.parse(JSON.stringify(advancedState()));
    (tampered.steps[2] as { note: string }).note = 'readings=999';
    expect(codesOf(parseFundamentalRunState(canonicalJson(tampered)))).toContain('chain_mismatch');
  });

  it('a REMOVED step fails the chain (hidden steps are rewrites)', () => {
    const tampered = JSON.parse(JSON.stringify(advancedState()));
    (tampered.steps as unknown[]).pop();
    expect(codesOf(parseFundamentalRunState(canonicalJson(tampered)))).toContain('chain_mismatch');
  });

  it('a forged run id fails (run_config_mismatch)', () => {
    const tampered = JSON.parse(JSON.stringify(advancedState()));
    (tampered as { runId: string }).runId = 'research-run-0000000000000000';
    const codes = codesOf(parseFundamentalRunState(canonicalJson(tampered)));
    expect(codes).toContain('run_config_mismatch');
  });

  it('a wrong schema version fails (schema_version_mismatch)', () => {
    const tampered = JSON.parse(JSON.stringify(advancedState()));
    (tampered as { schemaVersion: number }).schemaVersion = 99;
    expect(codesOf(parseFundamentalRunState(canonicalJson(tampered)))).toContain('schema_version_mismatch');
  });

  it('non-JSON bytes are typed refusal, never a throw', () => {
    expect(codesOf(parseFundamentalRunState('not json'))).toContain('invalid_type');
    expect(codesOf(parseFundamentalRunState('42'))).toContain('invalid_type');
  });

  it('validateFundamentalRunState refuses garbage', () => {
    for (const garbage of [null, 42, 'x', {}, { schemaVersion: 1, config: null, steps: [], chainHead: 'genesis' }]) {
      expect(validateFundamentalRunState(garbage).length).toBeGreaterThan(0);
    }
  });
});

describe('THE RESUME (serialize -> parse -> resume)', () => {
  it('intake-only pass, then resume over the rest — ONE publication over the merged evidence', () => {
    // pass 1: intake only (no publication — the run is not yet complete)
    const firstSource = createScriptedObservationSource(
      { id: 'resume-a', version: '1.0.0', provider: 'resume' },
      FUNDAMENTAL_STREAM.slice(0, 5),
    );
    const state = createFundamentalRunState(FUNDAMENTAL_RUN_CONFIG);
    const afterIntake = intakeFundamentalRunState(state, [firstSource]);
    expect(afterIntake.ok).toBe(true);
    expect(unwrap(afterIntake).steps.map((s) => s.stage)).toEqual(['intake', 'l4-gate']);
    expect(unwrap(afterIntake).publishedReportIds.length).toBe(0);

    // serialize -> parse (chain verified) -> resume over the rest
    const bytes = serializeFundamentalRunState(unwrap(afterIntake));
    const secondSource: FundamentalObservationSource = createScriptedObservationSource(
      { id: 'resume-b', version: '1.0.0', provider: 'resume' },
      FUNDAMENTAL_STREAM.slice(5),
    );
    const resumed = resumeFundamentalRunState(bytes, {
      sources: [secondSource],
      publisher: createFundamentalRecordingPort(),
    });
    expect(resumed.ok).toBe(true);
    const finalState = unwrap(resumed).state;
    // the merged run saw the whole golden stream
    expect(finalState.coverage.observationsOffered).toBe(15);
    expect(finalState.coverage.observationsAdmitted).toBe(14);
    expect(finalState.coverage.observationsDeferred).toBe(1);
    // exactly ONE publication, over the merged evidence
    expect(finalState.publishedReportIds.length).toBe(1);
    expect(finalState.steps.map((s) => s.stage)).toEqual([
      'intake',
      'l4-gate',
      'intake',
      'l4-gate',
      'assess',
      'digest-actions',
      'compose',
      'publish',
    ]);
    // ...and it is the SAME byte-stable golden report
    expect(unwrap(resumed).outcome.reportId).toBe(
      unwrap(advanceFundamentalRunState(createFundamentalRunState(FUNDAMENTAL_RUN_CONFIG), fundamentalFixtureInputs())).outcome.reportId,
    );
  });

  it('re-offering an already-admitted observation id is refused (evidence ids are unique)', () => {
    const source = createScriptedObservationSource(
      { id: 'dup', version: '1.0.0', provider: 'dup' },
      FUNDAMENTAL_STREAM,
    );
    const state = createFundamentalRunState(FUNDAMENTAL_RUN_CONFIG);
    const afterIntake = intakeFundamentalRunState(state, [source]);
    expect(afterIntake.ok).toBe(true);
    // the same stream again -> duplicate ids (typed refusal, before any publish)
    const again = createScriptedObservationSource(
      { id: 'dup', version: '1.0.0', provider: 'dup' },
      FUNDAMENTAL_STREAM,
    );
    const secondIntake = intakeFundamentalRunState(unwrap(afterIntake), [again]);
    expect(secondIntake.ok).toBe(false);
    expect(codesOf(secondIntake)).toContain('duplicate_observation_ref');
  });

  it('a published run is immutable (refuses further intake AND completion)', () => {
    const state = createFundamentalRunState(FUNDAMENTAL_RUN_CONFIG);
    const pass1 = advanceFundamentalRunState(state, fundamentalFixtureInputs());
    const fresh = createScriptedObservationSource(
      { id: 'more', version: '1.0.0', provider: 'more' },
      [fixtureFundamentalObservation({ eventId: 'obs-more-001', at: ms(AT0 - 5_000), instrument: 'TEST-DDD', field: 'INDEX_LEVEL', period: '2024-06-03', value: '10.0000', sequence: 1 })],
    );
    const moreIntake = intakeFundamentalRunState(unwrap(pass1).state, [fresh]);
    expect(moreIntake.ok).toBe(false);
    expect(codesOf(moreIntake)).toContain('run_config_mismatch');
    const again = completeFundamentalRunState(unwrap(pass1).state, createFundamentalRecordingPort());
    expect(again.ok).toBe(false);
    expect(codesOf(again)).toContain('run_config_mismatch');
  });

  it('the resume refuses a doctored body spec (the L8 gate holds across resume)', () => {
    const bytes = serializeFundamentalRunState(createFundamentalRunState(FUNDAMENTAL_RUN_CONFIG));
    const resumed = resumeFundamentalRunState(
      bytes,
      { sources: [], publisher: createFundamentalRecordingPort() },
      fundamentalAuthorityViolationBodySpec(),
    );
    expect(resumed.ok).toBe(false);
    expect(codesOf(resumed)).toContain('execution_authority_granted');
  });

  it('empty sources publish an empty but valid report (the declared gaps)', () => {
    const state = createFundamentalRunState(FUNDAMENTAL_RUN_CONFIG);
    const advanced = advanceFundamentalRunState(state, { sources: [], publisher: createFundamentalRecordingPort() });
    expect(advanced.ok).toBe(true);
    expect(unwrap(advanced).outcome.assessments.length).toBe(0);
    expect(unwrap(advanced).outcome.actionDigests.length).toBe(0);
    expect(unwrap(advanced).outcome.dataGaps).toEqual([
      { kind: 'no-corporate-action-observations', instrument: '', series: '' },
      { kind: 'no-fundamental-observations', instrument: '', series: '' },
      { kind: 'no-macro-observations', instrument: '', series: '' },
    ]);
  });
});
