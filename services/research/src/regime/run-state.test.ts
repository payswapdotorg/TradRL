// @tradrl/research (service) — the regime run-state tests.
//
// Behavioral: the genesis state; the one-pass advance (the six chained
// steps); serialize -> parse -> resume (chain-verified); the chain
// tamper trip-wires; the published-run immutability; the L8 gate across
// resume; the duplicate-evidence refusal.

import { describe, expect, it } from 'vitest';

import {
  REGIME_RUN_STATE_SCHEMA,
  advanceRegimeRunState,
  completeRegimeRunState,
  createRegimeRunState,
  intakeRegimeRunState,
  parseRegimeRunState,
  resumeRegimeRunState,
  serializeRegimeRunState,
  validateRegimeRunState,
} from './index';
import {
  createRegimeRecordingPort,
  createScriptedMarketSource,
  REGIME_RESEARCHER_BODY,
} from '../../../../bodies/regime-researcher/src/index';
import {
  REGIME_GOLDEN_REPORT,
  REGIME_RUN_CONFIG,
  REGIME_STREAM,
  regimeAuthorityViolationSpec,
  regimeFixtureSource,
} from './fixtures';

const codesOf = (result: { ok: boolean; errors?: readonly { code: string }[] }): readonly string[] =>
  result.ok ? [] : ((result.errors ?? []) as readonly { code: string }[]).map((e) => e.code);
function unwrap<T>(result: { readonly ok: boolean; readonly errors?: readonly { code: string; message: string }[]; readonly value?: T }): T {
  if (!result.ok) throw new Error(`expected ok, got: ${JSON.stringify(result.errors)}`);
  return result.value as T;
}

function freshRun() {
  return createRegimeRunState(REGIME_RUN_CONFIG);
}

describe('genesis + advance', () => {
  it('creates the genesis state with a derived run id', () => {
    const state = freshRun();
    expect(state.schemaVersion).toBe(REGIME_RUN_STATE_SCHEMA);
    expect(state.runId).toMatch(/^regime-run-[0-9a-f]{16}$/);
    expect(state.steps).toEqual([]);
    expect(state.chainHead).toBe('genesis');
    expect(state.admitted).toEqual([]);
    expect(state.publishedReportIds).toEqual([]);
  });

  it('advance runs the pipeline and appends the six chained steps', () => {
    const completion = advanceRegimeRunState(freshRun(), {
      sources: [regimeFixtureSource()],
      publisher: createRegimeRecordingPort(),
    });
    expect(completion.ok).toBe(true);
    const { state, outcome } = unwrap(completion);
    expect(state.steps.map((s) => s.stage)).toEqual([
      'intake',
      'l4-gate',
      'classify',
      'detect-changes',
      'compose',
      'publish',
    ]);
    expect(state.steps.map((s) => s.ordinal)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(state.publishedReportIds).toEqual([outcome.reportId]);
    // the research CONTENT is the golden story (the completion re-offers only
    // the retained admitted set, so the coverage accounting legitimately
    // differs from the one-pass golden — the L4 bookkeeping of a two-phase run)
    expect(outcome.classifications).toEqual(REGIME_GOLDEN_REPORT.classifications);
    expect(outcome.changes).toEqual(REGIME_GOLDEN_REPORT.changes);
    expect(outcome.classifications[0]!.label).toBe('ranging');
    expect(outcome.classifications[1]!.label).toBe('trending-up');
    // and the completion is deterministic: two fresh runs publish the same id
    const again = advanceRegimeRunState(freshRun(), {
      sources: [regimeFixtureSource()],
      publisher: createRegimeRecordingPort(),
    });
    expect(unwrap(again).outcome.reportId).toBe(outcome.reportId);
    expect(state.admitted.length).toBe(10);
    // the chain head is the last step's digest
    expect(state.chainHead).toBe(state.steps[5]!.chainDigest);
  });
});

describe('serialize -> parse (chain-verified)', () => {
  it('round-trips byte-identically', () => {
    const completion = advanceRegimeRunState(freshRun(), {
      sources: [regimeFixtureSource()],
      publisher: createRegimeRecordingPort(),
    });
    const bytes = serializeRegimeRunState(unwrap(completion).state);
    const parsed = parseRegimeRunState(bytes);
    expect(parsed.ok).toBe(true);
    expect(serializeRegimeRunState(unwrap(parsed))).toBe(bytes);
    expect(unwrap(parsed).runId).toBe(unwrap(completion).state.runId);
  });

  it('a rewritten step note fails the chain (chain_mismatch)', () => {
    const completion = advanceRegimeRunState(freshRun(), {
      sources: [regimeFixtureSource()],
      publisher: createRegimeRecordingPort(),
    });
    const bytes = serializeRegimeRunState(unwrap(completion).state);
    const doctored = JSON.parse(bytes) as { steps: { note: string }[] };
    doctored.steps[2]!.note = 'classifications=999';
    const result = parseRegimeRunState(JSON.stringify(doctored));
    expect(result.ok).toBe(false);
    expect(codesOf(result)).toContain('chain_mismatch');
  });

  it('a REMOVED step fails the chain (hidden steps are rewrites)', () => {
    const completion = advanceRegimeRunState(freshRun(), {
      sources: [regimeFixtureSource()],
      publisher: createRegimeRecordingPort(),
    });
    const bytes = serializeRegimeRunState(unwrap(completion).state);
    const doctored = JSON.parse(bytes) as { steps: unknown[] };
    doctored.steps.pop();
    const result = parseRegimeRunState(JSON.stringify(doctored));
    expect(result.ok).toBe(false);
    expect(codesOf(result)).toContain('chain_mismatch');
  });

  it('a forged run id fails (run_config_mismatch)', () => {
    const state = freshRun();
    const bytes = serializeRegimeRunState(state);
    const doctored = JSON.parse(bytes) as { runId: string };
    doctored.runId = 'regime-run-0000000000000000';
    const result = parseRegimeRunState(JSON.stringify(doctored));
    expect(result.ok).toBe(false);
    expect(codesOf(result)).toContain('run_config_mismatch');
  });

  it('a wrong schema version fails (schema_version_mismatch)', () => {
    const bytes = serializeRegimeRunState(freshRun());
    const doctored = JSON.parse(bytes) as { schemaVersion: number };
    doctored.schemaVersion = 99;
    const result = parseRegimeRunState(JSON.stringify(doctored));
    expect(result.ok).toBe(false);
    expect(codesOf(result)).toContain('schema_version_mismatch');
  });

  it('non-JSON bytes are typed refusal, never a throw', () => {
    const result = parseRegimeRunState('not json at all');
    expect(result.ok).toBe(false);
    expect(codesOf(result)).toContain('invalid_type');
  });

  it('validateRegimeRunState refuses garbage', () => {
    for (const bad of [null, 5, 'state', {}, { schemaVersion: 1, config: {} }]) {
      expect(validateRegimeRunState(bad).length).toBeGreaterThan(0);
    }
  });
});

describe('resume (the honest two-phase protocol)', () => {
  it('intake-only pass, then resume over the rest — ONE publication over the merged evidence', () => {
    // phase one: intake half the stream
    const half = Math.floor(REGIME_STREAM.length / 2);
    const firstBatch = createScriptedMarketSource(
      { id: 'regime-resume-1', version: '1.0.0', provider: 'market-replay' },
      REGIME_STREAM.slice(0, half),
    );
    const afterIntake = intakeRegimeRunState(freshRun(), [firstBatch]);
    expect(afterIntake.ok).toBe(true);
    expect(unwrap(afterIntake).steps.map((s) => s.stage)).toEqual(['intake', 'l4-gate']);

    // serialize -> parse (the crash simulation)
    const bytes = serializeRegimeRunState(unwrap(afterIntake));
    const publisher = createRegimeRecordingPort();
    const resumed = resumeRegimeRunState(bytes, {
      sources: [
        createScriptedMarketSource(
          { id: 'regime-resume-2', version: '1.0.0', provider: 'market-replay' },
          REGIME_STREAM.slice(half),
        ),
      ],
      publisher,
    });
    expect(resumed.ok).toBe(true);
    const { state, outcome } = unwrap(resumed);
    expect(state.admitted.length).toBe(10);
    expect(state.coverage.observationsOffered).toBe(11);
    // exactly ONE publication, over the merged evidence — the golden research
    // content (classifications + changes), with the two-phase coverage
    // accounting of a resumed run
    expect(publisher.published.length).toBe(1);
    expect(outcome.classifications).toEqual(REGIME_GOLDEN_REPORT.classifications);
    expect(outcome.changes).toEqual(REGIME_GOLDEN_REPORT.changes);
    expect(state.steps.map((s) => s.stage)).toEqual([
      'intake', 'l4-gate', 'intake', 'l4-gate', 'classify', 'detect-changes', 'compose', 'publish',
    ]);
  });

  it('re-offering an already-admitted observation id is refused (evidence ids are unique)', () => {
    const first = intakeRegimeRunState(freshRun(), [regimeFixtureSource()]);
    expect(first.ok).toBe(true);
    const again = intakeRegimeRunState(unwrap(first), [regimeFixtureSource()]);
    expect(again.ok).toBe(false);
    expect(codesOf(again)).toContain('duplicate_observation_ref');
  });

  it('a published run is immutable (refuses further intake AND completion)', () => {
    const completion = advanceRegimeRunState(freshRun(), {
      sources: [regimeFixtureSource()],
      publisher: createRegimeRecordingPort(),
    });
    const published = unwrap(completion).state;
    const moreIntake = intakeRegimeRunState(published, [regimeFixtureSource()]);
    expect(moreIntake.ok).toBe(false);
    expect(codesOf(moreIntake)).toContain('run_config_mismatch');
    const again = completeRegimeRunState(published, createRegimeRecordingPort());
    expect(again.ok).toBe(false);
    expect(codesOf(again)).toContain('run_config_mismatch');
  });

  it('the resume refuses a doctored body spec (the L8 gate holds across resume)', () => {
    const bytes = serializeRegimeRunState(freshRun());
    const result = resumeRegimeRunState(
      bytes,
      { sources: [regimeFixtureSource()], publisher: createRegimeRecordingPort() },
      regimeAuthorityViolationSpec(),
    );
    expect(result.ok).toBe(false);
    expect(codesOf(result)).toContain('execution_authority_granted');
  });

  it('empty sources publish an empty but valid report (the declared gaps)', () => {
    const publisher = createRegimeRecordingPort();
    const completion = advanceRegimeRunState(freshRun(), { sources: [], publisher });
    expect(completion.ok).toBe(true);
    const { outcome } = unwrap(completion);
    expect(outcome.classifications).toEqual([]);
    expect(outcome.changes).toEqual([]);
    expect(outcome.dataGaps).toEqual([{ kind: 'no-market-observations', instrument: '' }]);
    expect(publisher.published.length).toBe(1);
  });

  it('the shipped body spec resumes cleanly (explicit default)', () => {
    const bytes = serializeRegimeRunState(freshRun());
    const result = resumeRegimeRunState(
      bytes,
      { sources: [regimeFixtureSource()], publisher: createRegimeRecordingPort() },
      REGIME_RESEARCHER_BODY,
    );
    expect(result.ok).toBe(true);
  });
});
