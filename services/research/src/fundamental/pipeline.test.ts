// @tradrl/research (service) — the fundamental pipeline tests.
//
// Behavioral: the golden run (structure, lineage, one bound publication),
// DETERMINISM (the acceptance law — byte-identical reports across
// independent runs, pull-order independence), THE L4 GATE (all-future
// streams, mid-stream deferral), THE L8 GATE (doctored body specs refused
// before any observation is pulled), the evidence/method-honesty
// refusals, config validation, and stage-level purity.

import { describe, expect, it } from 'vitest';

import {
  type FundamentalRunConfig,
  fundamentalRunId,
  FUNDAMENTAL_AS_OF,
  FUNDAMENTAL_AT0,
  FUNDAMENTAL_GOLDEN_REPORT,
  FUNDAMENTAL_OUTCOME,
  FUNDAMENTAL_RUN_CONFIG,
  FUNDAMENTAL_STREAM,
  fundamentalAuthorityViolationBodySpec,
  fundamentalEvidenceLessAssessment,
  fundamentalFixtureInputs,
  fundamentalFixtureSource,
  fundamentalFutureCitationAssessment,
  fundamentalL4ViolationSource,
  runCorporateActionDigestion,
  runFundamentalAssessment,
  runFundamentalIntake,
  runFundamentalPipeline,
  serializeFundamentalRunConfig,
  fundamentalUndeclaredMethodAssessment,
  validateFundamentalRunConfig,
} from './index';
// the contract surface lives in the body package (the service-root
// collision law): tests import it through the body package's own surface.
import {
  FUNDAMENTAL_METHOD_REGISTRY,
  createFundamentalAssessment,
  createScriptedObservationSource,
  fixtureActionObservation,
  fixtureFundamentalObservation,
  fixtureMacroObservation,
  serializeFundamentalResearchReport,
  validateFundamentalResearchReport,
  type FundamentalObservation,
  type TimestampMs,
} from '../../../../bodies/fundamental-researcher/src/index';

const codesOf = (result: { ok: boolean; errors?: readonly { code: string }[] }): readonly string[] =>
  result.ok ? [] : ((result.errors ?? []) as readonly { code: string }[]).map((e) => e.code);

function unwrap<T>(result: { readonly ok: boolean; readonly errors?: readonly { code: string; message: string }[]; readonly value?: T }): T {
  if (!result.ok) throw new Error(`expected ok, got: ${JSON.stringify(result.errors)}`);
  return result.value as T;
}

describe('the golden run', () => {
  it('produces the golden report with the expected structure', () => {
    const outcome = FUNDAMENTAL_OUTCOME;
    // the three assessments: extended valuation, above-consensus macro, rising health
    expect(outcome.assessments.length).toBe(3);
    const byKind = new Map(outcome.assessments.map((a) => [a.assessmentKind, a]));
    expect(byKind.get('valuation-level')?.stance.score).toBe('0.0242');
    expect(byKind.get('valuation-level')?.stance.direction).toBe('positive');
    expect(byKind.get('valuation-level')?.confidence.level).toBe('high');
    expect(byKind.get('macro-surprise')?.stance.score).toBe('0.0390');
    expect(byKind.get('macro-surprise')?.confidence.level).toBe('moderate');
    expect(byKind.get('health-indicator')?.stance.score).toBe('0.0800');
    expect(byKind.get('health-indicator')?.stance.direction).toBe('positive');
    // the two corporate-action digests with their declared implications
    expect(outcome.actionDigests.length).toBe(2);
    expect(outcome.actionDigests.map((d) => [d.action, d.implication])).toEqual([
      ['split', 'neutral'],
      ['cash_dividend', 'positive'],
    ]);
    // the unassessed-series data gap
    expect(outcome.dataGaps).toEqual([{ kind: 'unassessed-series', instrument: 'TEST-MIDCAP', series: 'MISC_METRIC' }]);
    // the L4 accounting: 15 offered, 14 admitted, 1 deferred — nothing dropped
    expect(outcome.coverage).toEqual({
      observationsOffered: 15,
      observationsAdmitted: 14,
      observationsDeferred: 1,
      observationsUnsupported: 0,
      observationsInvalid: 0,
    });
  });

  it('the golden report validates under the contract laws and carries the full lineage', () => {
    expect(validateFundamentalResearchReport(FUNDAMENTAL_GOLDEN_REPORT, FUNDAMENTAL_METHOD_REGISTRY)).toEqual([]);
    const byKind = new Map(FUNDAMENTAL_GOLDEN_REPORT.assessments.map((a) => [a.assessmentKind, a]));
    for (const assessment of FUNDAMENTAL_GOLDEN_REPORT.assessments) {
      expect(assessment.evidence.length).toBeGreaterThan(0);
    }
    expect(byKind.get('valuation-level')?.evidence.length).toBe(5);
    expect(byKind.get('macro-surprise')?.evidence.length).toBe(2);
    expect(byKind.get('health-indicator')?.evidence.length).toBe(4);
    expect(FUNDAMENTAL_GOLDEN_REPORT.summary.meanStanceScore).toBe('0.0477');
  });

  it('publishes EXACTLY ONE bound envelope through the port', () => {
    const inputs = fundamentalFixtureInputs();
    const outcome = runFundamentalPipeline(FUNDAMENTAL_RUN_CONFIG, inputs);
    expect(outcome.ok).toBe(true);
    const value = unwrap(outcome);
    expect(inputs.publisher.published.length).toBe(1);
    expect(inputs.publisher.published[0]!.envelope.payload).toBe(`report:${value.reportId}`);
    expect(value.reportId).toBe(FUNDAMENTAL_GOLDEN_REPORT.reportId);
  });
});

describe('DETERMINISM (the acceptance law)', () => {
  it('same (observations, as-of, body version, seed) -> byte-identical report, twice', () => {
    const once = runFundamentalPipeline(FUNDAMENTAL_RUN_CONFIG, fundamentalFixtureInputs());
    const twice = runFundamentalPipeline(FUNDAMENTAL_RUN_CONFIG, fundamentalFixtureInputs());
    const a = unwrap(once);
    const b = unwrap(twice);
    expect(a.reportId).toBe(b.reportId);
    expect(a).toEqual(b);
    expect(serializeFundamentalResearchReport(a.publication.report)).toBe(
      serializeFundamentalResearchReport(b.publication.report),
    );
  });

  it('source PULL ORDER cannot leak into output bytes', () => {
    // the same observations offered by TWO sources in a different split
    const stream = FUNDAMENTAL_STREAM as readonly FundamentalObservation[];
    const half = Math.floor(stream.length / 2);
    const firstHalf = createScriptedObservationSource({ id: 's1', version: '1.0.0', provider: 'p' }, stream.slice(0, half));
    const secondHalf = createScriptedObservationSource({ id: 's2', version: '1.0.0', provider: 'p' }, stream.slice(half));
    const reversed = [
      createScriptedObservationSource({ id: 's1', version: '1.0.0', provider: 'p' }, stream.slice(half)),
      createScriptedObservationSource({ id: 's2', version: '1.0.0', provider: 'p' }, stream.slice(0, half)),
    ];
    const once = runFundamentalPipeline(FUNDAMENTAL_RUN_CONFIG, {
      sources: [firstHalf, secondHalf],
      publisher: unwrap(runFundamentalPipeline(FUNDAMENTAL_RUN_CONFIG, fundamentalFixtureInputs())) && fundamentalFixtureInputs().publisher,
    });
    const twice = runFundamentalPipeline(FUNDAMENTAL_RUN_CONFIG, {
      sources: reversed,
      publisher: fundamentalFixtureInputs().publisher,
    });
    expect(unwrap(once).reportId).toBe(unwrap(twice).reportId);
    expect(unwrap(once).reportId).toBe(FUNDAMENTAL_GOLDEN_REPORT.reportId);
  });

  it('the run id and config serialization are pure functions', () => {
    const once = fundamentalRunId(FUNDAMENTAL_RUN_CONFIG);
    const twice = fundamentalRunId(FUNDAMENTAL_RUN_CONFIG);
    expect(once).toBe(twice);
    expect(serializeFundamentalRunConfig(FUNDAMENTAL_RUN_CONFIG)).toBe(
      serializeFundamentalRunConfig(FUNDAMENTAL_RUN_CONFIG),
    );
  });
});

describe('THE L4 GATE (point-in-time truth)', () => {
  it('an all-future stream yields NO assessments, declared gaps, and full deferral', () => {
    const outcome = runFundamentalPipeline(FUNDAMENTAL_RUN_CONFIG, {
      sources: [fundamentalL4ViolationSource()],
      publisher: fundamentalFixtureInputs().publisher,
    });
    expect(outcome.ok).toBe(true);
    const value = unwrap(outcome);
    expect(value.assessments.length).toBe(0);
    expect(value.actionDigests.length).toBe(0);
    expect(value.deferred.length).toBe(2);
    expect(value.coverage.observationsAdmitted).toBe(0);
    const gapKinds = value.dataGaps.map((gap) => gap.kind);
    expect(gapKinds).toContain('no-fundamental-observations');
    expect(gapKinds).toContain('no-macro-observations');
    expect(gapKinds).toContain('no-corporate-action-observations');
    // and the empty report still validates + publishes (the declared gaps)
    expect(validateFundamentalResearchReport(value.publication.report, FUNDAMENTAL_METHOD_REGISTRY)).toEqual([]);
  });

  it('the gate defers mid-stream future observations while consuming the rest', () => {
    const intake = runFundamentalIntake([fundamentalFixtureSource()], FUNDAMENTAL_AS_OF);
    const value = unwrap(intake);
    expect(value.deferred.length).toBe(1);
    expect(value.deferred[0]?.observationId).toBe('obs-future-001');
    expect(value.admitted.some((o) => o.event_id === 'obs-future-001')).toBe(false);
  });
});

describe('THE L8 GATE (read-only authority — the pipeline refuses doctored specs)', () => {
  it('a body spec granting EXECUTE is refused before any observation is pulled', () => {
    const outcome = runFundamentalPipeline(
      FUNDAMENTAL_RUN_CONFIG,
      fundamentalFixtureInputs(),
      fundamentalAuthorityViolationBodySpec(),
    );
    expect(outcome.ok).toBe(false);
    expect(codesOf(outcome)).toContain('execution_authority_granted');
  });

  it('the shipped body spec runs cleanly', () => {
    const outcome = runFundamentalPipeline(FUNDAMENTAL_RUN_CONFIG, fundamentalFixtureInputs());
    expect(outcome.ok).toBe(true);
  });
});

describe('the evidence and method-honesty refusals', () => {
  it('an evidence-less assessment is refused by the contract factory', () => {
    const refused = createFundamentalAssessment(fundamentalEvidenceLessAssessment(), FUNDAMENTAL_METHOD_REGISTRY);
    expect(refused.ok).toBe(false);
    expect(codesOf(refused)).toContain('evidence_missing');
  });

  it('a future-citation assessment is refused (L4)', () => {
    const refused = createFundamentalAssessment(fundamentalFutureCitationAssessment(), FUNDAMENTAL_METHOD_REGISTRY);
    expect(codesOf(refused)).toContain('future_evidence');
  });

  it('an undeclared-method assessment is refused (method honesty)', () => {
    const refused = createFundamentalAssessment(fundamentalUndeclaredMethodAssessment(), FUNDAMENTAL_METHOD_REGISTRY);
    expect(codesOf(refused)).toContain('undeclared_method');
  });
});

describe('config validation', () => {
  it('rejects malformed configs with typed errors', () => {
    const errors = validateFundamentalRunConfig({ asOf: 'soon', bodyVersion: 'x' });
    expect(errors.length).toBeGreaterThanOrEqual(6);
  });

  it('a bad config is refused by the pipeline', () => {
    const badConfig = { ...FUNDAMENTAL_RUN_CONFIG, publicationSequence: 0 } as unknown as FundamentalRunConfig;
    const outcome = runFundamentalPipeline(badConfig, fundamentalFixtureInputs());
    expect(outcome.ok).toBe(false);
  });
});

describe('stage-level purity', () => {
  it('the assessment stage groups by (instrument, series) and is order-independent', () => {
    // the stage consumes the ADMITTED set (the L4 gate has already run)
    const admitted = (FUNDAMENTAL_STREAM as readonly FundamentalObservation[]).filter(
      (observation) => (observation.available_time as number) <= (FUNDAMENTAL_RUN_CONFIG.asOf as number),
    );
    const forward = runFundamentalAssessment(admitted, FUNDAMENTAL_METHOD_REGISTRY, FUNDAMENTAL_RUN_CONFIG);
    const backward = runFundamentalAssessment([...admitted].reverse(), FUNDAMENTAL_METHOD_REGISTRY, FUNDAMENTAL_RUN_CONFIG);
    expect(unwrap(forward).assessments).toEqual(unwrap(backward).assessments);
  });

  it('the digestion stage clusters by (window, instrument, action) — actions in different windows never merge', () => {
    // a dedicated config whose as-of covers the second 3_600_000ms window
    const lateConfig: FundamentalRunConfig = {
      ...FUNDAMENTAL_RUN_CONFIG,
      asOf: (FUNDAMENTAL_AT0 + 7_200_000) as TimestampMs,
      publishedAt: (FUNDAMENTAL_AT0 + 7_200_000) as TimestampMs,
    };
    const stream: FundamentalObservation[] = [
      fixtureActionObservation({ eventId: 'act-w0', at: FUNDAMENTAL_AT0, instrument: 'TEST-AAA', action: 'split', effectiveDate: '2024-06-10', ratio: '4:1' }),
      fixtureActionObservation({ eventId: 'act-w1', at: (FUNDAMENTAL_AT0 + 3_600_000) as TimestampMs, instrument: 'TEST-AAA', action: 'split', effectiveDate: '2024-06-11', ratio: '2:1' }),
    ];
    const digests = unwrap(runCorporateActionDigestion(stream, FUNDAMENTAL_METHOD_REGISTRY, lateConfig));
    expect(digests.length).toBe(2);
  });

  it('data gaps are computed from the stage outputs (enumerated kinds only)', () => {
    const admitted = (FUNDAMENTAL_STREAM as readonly FundamentalObservation[]).filter(
      (observation) => (observation.available_time as number) <= (FUNDAMENTAL_RUN_CONFIG.asOf as number),
    );
    const value = unwrap(runFundamentalAssessment(admitted, FUNDAMENTAL_METHOD_REGISTRY, FUNDAMENTAL_RUN_CONFIG));
    expect(value.dataGaps).toEqual([{ kind: 'unassessed-series', instrument: 'TEST-MIDCAP', series: 'MISC_METRIC' }]);
    expect(value.assessedScopes.size).toBe(3);
  });

  it('a source that is not a port is refused', () => {
    const outcome = runFundamentalIntake([{} as never], FUNDAMENTAL_AS_OF);
    expect(outcome.ok).toBe(false);
  });

  it('an unassessed macro series (no forecasts) is a gap, never a fabricated zero surprise', () => {
    const stream: FundamentalObservation[] = [
      fixtureMacroObservation({ eventId: 'obs-nofc-1', at: FUNDAMENTAL_AT0, instrument: 'TEST-ECON-NOF', period: '2024-04', actual: '1.0', sequence: 1 }),
      fixtureMacroObservation({ eventId: 'obs-nofc-2', at: (FUNDAMENTAL_AT0 + 1_000) as TimestampMs, instrument: 'TEST-ECON-NOF', period: '2024-05', actual: '1.1', sequence: 2 }),
    ];
    const value = unwrap(runFundamentalAssessment(stream, FUNDAMENTAL_METHOD_REGISTRY, FUNDAMENTAL_RUN_CONFIG));
    expect(value.assessments.length).toBe(0);
    expect(value.dataGaps).toContainEqual({ kind: 'unassessed-series', instrument: 'TEST-ECON-NOF', series: 'TEST-ECON-NOF' });
  });

  it('a valuation series below the trailing window is a gap (insufficient baseline)', () => {
    const stream: FundamentalObservation[] = [
      fixtureFundamentalObservation({ eventId: 'obs-short-1', at: FUNDAMENTAL_AT0, instrument: 'TEST-SHORT', field: 'INDEX_LEVEL', period: '2024-06-03', value: '100.0000', sequence: 1 }),
      fixtureFundamentalObservation({ eventId: 'obs-short-2', at: (FUNDAMENTAL_AT0 + 1_000) as TimestampMs, instrument: 'TEST-SHORT', field: 'INDEX_LEVEL', period: '2024-06-03', value: '101.0000', sequence: 2 }),
    ];
    const value = unwrap(runFundamentalAssessment(stream, FUNDAMENTAL_METHOD_REGISTRY, FUNDAMENTAL_RUN_CONFIG));
    expect(value.assessments.length).toBe(0);
    expect(value.dataGaps).toContainEqual({ kind: 'unassessed-series', instrument: 'TEST-SHORT', series: 'INDEX_LEVEL' });
  });
});
