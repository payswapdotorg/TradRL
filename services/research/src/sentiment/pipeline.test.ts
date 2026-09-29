// @tradrl/research (service) — the pipeline tests.
//
// Behavioral: the golden report (byte-stable); DETERMINISM (the same
// observation set, as-of, body version and seed produce byte-identical
// outputs, twice); the L4 gate (future observations deferred, never
// consumed — and an all-future stream produces no readings); the L8
// gate (a doctored execution-granting body spec is refused); the
// evidence/method-honesty refusals; the publication discipline (the
// port receives exactly one bound envelope); coverage accounting.

import { describe, expect, it } from 'vitest';

import {
  type ResearchRunConfig,
  runResearchPipeline,
  researchRunId,
  validateResearchRunConfig,
  runIntake,
  runAggregation,
  runEventDetection,
  computeDataGaps,
  serializeResearchRunConfig,
  type ResearchRunOutcome,
  createSentimentReading,
  createRecordingPublicationPort,
  createScriptedObservationSource,
  serializeResearchReport,
  validateResearchReport,
  SENTIMENT_METHOD_REGISTRY,
  SENTIMENT_RESEARCHER_BODY,
  canonicalJson,
  type ObservationSource,
} from './index';
import {
  FIXTURE_AS_OF,
  FIXTURE_GOLDEN_REPORT,
  FIXTURE_OUTCOME,
  FIXTURE_RUN_CONFIG,
  FIXTURE_STREAM,
  L4_VIOLATION_STREAM,
  authorityViolationBodySpec,
  evidenceLessReading,
  fixtureInputs,
  fixtureObservationSource,
  futureCitationReading,
  undeclaredMethodReading,
  BODY_TENANT,
} from './fixtures';

const codesOf = (result: { ok: boolean; errors?: readonly { code: string }[] }): readonly string[] =>
  result.ok ? [] : ((result.errors ?? []) as readonly { code: string }[]).map((e) => e.code);
function unwrap<T>(result: { readonly ok: boolean; readonly errors?: readonly { code: string; message: string }[]; readonly value?: T }): T {
  if (!result.ok) throw new Error(`expected ok, got: ${JSON.stringify(result.errors)}`);
  return result.value as T;
}


describe('the golden run', () => {
  it('produces the golden report with the expected structure', () => {
    const outcome = FIXTURE_OUTCOME;
    expect(outcome.readings.length).toBe(1);
    expect(outcome.digests.length).toBe(1);
    const reading = outcome.readings[0]!;
    expect(reading.scope.instrument).toBe('TEST-AAA');
    expect(reading.polarity.direction).toBe('positive');
    expect(reading.polarity.score).toBe('0.3000');
    expect(reading.intensity.level).toBe('moderate');
    expect(reading.confidence.level).toBe('high');
    expect(reading.confidence.evidenceCount).toBe(5);
    expect(reading.confidence.dispersion).toBe('0.0600');
    const digest = outcome.digests[0]!;
    expect(digest.kind).toBe('earnings-announcement');
    expect(digest.instruments).toEqual(['TEST-AAA']);
    expect(digest.observationCount).toBe(4);
    // the data gap: TEST-BBB has news but no sentiment coverage
    expect(outcome.dataGaps).toEqual([{ kind: 'instrument-without-sentiment', instrument: 'TEST-BBB' }]);
    // the coverage: 12 offered, 11 admitted, 1 deferred — nothing dropped
    expect(outcome.coverage).toEqual({
      observationsOffered: 12,
      observationsAdmitted: 11,
      observationsDeferred: 1,
      observationsUnsupported: 0,
      observationsInvalid: 0,
    });
    expect(outcome.deferred).toEqual([
      { observationId: 'obs-future-001', availableTime: FIXTURE_AS_OF + 30_000, reason: 'future_observation' },
    ]);
  });

  it('the golden report validates under the contract laws and carries the full lineage', () => {
    expect(validateResearchReport(FIXTURE_GOLDEN_REPORT, SENTIMENT_METHOD_REGISTRY)).toEqual([]);
    expect(FIXTURE_GOLDEN_REPORT.tenantId).toBe(BODY_TENANT);
    expect(FIXTURE_GOLDEN_REPORT.readings[0]!.evidence.length).toBe(5);
    expect(FIXTURE_GOLDEN_REPORT.digests[0]!.evidence.length).toBe(4);
    for (const citation of FIXTURE_GOLDEN_REPORT.readings[0]!.evidence) {
      expect(citation.provenance.origin).toBe('historical');
    }
  });

  it('publishes EXACTLY ONE bound envelope through the port', () => {
    const inputs = fixtureInputs();
    const outcome = runResearchPipeline(FIXTURE_RUN_CONFIG, inputs);
    expect(outcome.ok).toBe(true);
    expect(inputs.publisher.published.length).toBe(1);
    const publication = inputs.publisher.published[0]!;
    expect(publication.envelope.payload).toBe(`report:${unwrap(outcome).reportId}`);
    expect(publication.envelope.id).toBe(`msg:${FIXTURE_RUN_CONFIG.opId}:${FIXTURE_RUN_CONFIG.sender}:1`);
    expect(publication.report.reportId).toBe(unwrap(outcome).reportId);
  });
});

describe('DETERMINISM (the acceptance law)', () => {
  it('same (observations, as-of, body version, seed) -> byte-identical report, twice', () => {
    const once = runResearchPipeline(FIXTURE_RUN_CONFIG, fixtureInputs());
    const twice = runResearchPipeline(FIXTURE_RUN_CONFIG, fixtureInputs());
    expect(once.ok).toBe(true);
    expect(twice.ok).toBe(true);
    const a = unwrap(once);
    const b = unwrap(twice);
    expect(a).toEqual(b);
    expect(serializeResearchReport(a.publication.report)).toBe(serializeResearchReport(b.publication.report));
    expect(a.reportId).toBe(b.reportId);
    expect(a.reportId).toBe(FIXTURE_GOLDEN_REPORT.reportId);
    expect(serializeResearchReport(FIXTURE_GOLDEN_REPORT)).toBe(serializeResearchReport(a.publication.report));
  });

  it('source PULL ORDER cannot leak into output bytes', () => {
    const reversed = createScriptedObservationSource(
      { id: 'research-fixture-source', version: '1.0.0', provider: 'research-fixtures' },
      FIXTURE_STREAM.slice().reverse(),
    );
    const outcome = runResearchPipeline(FIXTURE_RUN_CONFIG, {
      sources: [reversed],
      publisher: createRecordingPublicationPort(),
    });
    expect(outcome.ok).toBe(true);
    expect(unwrap(outcome).reportId).toBe(FIXTURE_GOLDEN_REPORT.reportId);
  });

  it('the run id and config serialization are pure functions', () => {
    expect(researchRunId(FIXTURE_RUN_CONFIG)).toBe(researchRunId(JSON.parse(JSON.stringify(FIXTURE_RUN_CONFIG))));
    expect(serializeResearchRunConfig(FIXTURE_RUN_CONFIG)).toBe(
      serializeResearchRunConfig(JSON.parse(JSON.stringify(FIXTURE_RUN_CONFIG))),
    );
  });
});

describe('THE L4 GATE (point-in-time truth)', () => {
  it('an all-future stream yields NO readings, a declared gap, and full deferral', () => {
    const source = createScriptedObservationSource(
      { id: 'l4-source', version: '1.0.0', provider: 'l4' },
      L4_VIOLATION_STREAM,
    );
    const outcome = runResearchPipeline(FIXTURE_RUN_CONFIG, {
      sources: [source],
      publisher: createRecordingPublicationPort(),
    });
    expect(outcome.ok).toBe(true);
    const value = unwrap(outcome);
    expect(value.readings.length).toBe(0);
    expect(value.digests.length).toBe(0);
    expect(value.deferred.length).toBe(5);
    expect(value.coverage.observationsAdmitted).toBe(0);
    expect(value.coverage.observationsDeferred).toBe(5);
    expect(value.dataGaps).toContainEqual({ kind: 'no-sentiment-observations', instrument: '' });
    // the future observation id NEVER appears as evidence anywhere
    const evidenceIds = value.publication.report.readings.flatMap((r) => r.evidence.map((c) => c.observationId));
    for (const id of evidenceIds) expect(id.startsWith('obs-l4-')).toBe(false);
  });

  it('the gate defers mid-stream future observations while consuming the rest', () => {
    const intake = runIntake([fixtureObservationSource()], FIXTURE_RUN_CONFIG.asOf);
    expect(intake.ok).toBe(true);
    const snapshot = unwrap(intake);
    expect(snapshot.deferred.map((d) => d.observationId)).toEqual(['obs-future-001']);
    expect(snapshot.admitted.length).toBe(11);
  });
});

describe('THE L8 GATE (read-only authority — the pipeline refuses doctored specs)', () => {
  it('a body spec granting EXECUTE is refused before any observation is pulled', () => {
    const inputs = fixtureInputs();
    const outcome = runResearchPipeline(FIXTURE_RUN_CONFIG, inputs, authorityViolationBodySpec());
    expect(outcome.ok).toBe(false);
    expect(codesOf(outcome)).toContain('execution_authority_granted');
    // the refusal happened BEFORE the publication stage — the port saw nothing
    expect(inputs.publisher.published.length).toBe(0);
  });

  it('the shipped body spec runs cleanly', () => {
    expect(outcomeOk(runResearchPipeline(FIXTURE_RUN_CONFIG, fixtureInputs(), SENTIMENT_RESEARCHER_BODY))).toBe(true);
  });
});

describe('the evidence and method-honesty refusals', () => {
  it('an evidence-less reading is refused by the contract factory', () => {
    const result = createSentimentReading(evidenceLessReading(), SENTIMENT_METHOD_REGISTRY);
    expect(codesOf(result)).toContain('evidence_missing');
  });

  it('a future-citation reading is refused (L4)', () => {
    const result = createSentimentReading(futureCitationReading(), SENTIMENT_METHOD_REGISTRY);
    expect(codesOf(result)).toContain('future_evidence');
  });

  it('an undeclared-method reading is refused (method honesty)', () => {
    const result = createSentimentReading(undeclaredMethodReading(), SENTIMENT_METHOD_REGISTRY);
    expect(codesOf(result)).toContain('undeclared_method');
  });
});

describe('config validation', () => {
  it('rejects malformed configs with typed errors', () => {
    for (const bad of [null, {}, { ...FIXTURE_RUN_CONFIG, tenantId: '' }, { ...FIXTURE_RUN_CONFIG, publicationSequence: 0 }]) {
      expect(validateResearchRunConfig(bad).length).toBeGreaterThan(0);
    }
    expect(validateResearchRunConfig(FIXTURE_RUN_CONFIG)).toEqual([]);
  });

  it('a bad config is refused by the pipeline', () => {
    const outcome = runResearchPipeline(
      { ...FIXTURE_RUN_CONFIG, asOf: -1 as never },
      fixtureInputs(),
    );
    expect(outcome.ok).toBe(false);
  });
});

describe('stage-level purity', () => {
  it('aggregation groups by (instrument, venue) and is order-independent', () => {
    const forward = runAggregation(FIXTURE_STREAM.slice(0, 5), SENTIMENT_METHOD_REGISTRY, FIXTURE_RUN_CONFIG);
    const reverse = runAggregation(FIXTURE_STREAM.slice(0, 5).reverse(), SENTIMENT_METHOD_REGISTRY, FIXTURE_RUN_CONFIG);
    expect(forward.ok && reverse.ok).toBe(true);
    expect(unwrap(forward).readings).toEqual(unwrap(reverse).readings);
  });

  it('event detection clusters below the minimum produce no digests', () => {
    const detection = runEventDetection(FIXTURE_STREAM, SENTIMENT_METHOD_REGISTRY, FIXTURE_RUN_CONFIG);
    expect(detection.ok).toBe(true);
    expect(unwrap(detection).digests.length).toBe(1);
    expect(unwrap(detection).newsInstruments).toEqual(['TEST-AAA', 'TEST-BBB']);
  });

  it('data gaps are computed from the stage outputs (enumerated kinds only)', () => {
    expect(
      computeDataGaps({ readings: [], digests: [], sentimentInstruments: [], newsInstruments: ['X'] }),
    ).toEqual([
      { kind: 'instrument-without-sentiment', instrument: 'X' },
      { kind: 'no-sentiment-observations', instrument: '' },
    ]);
    expect(
      computeDataGaps({ readings: [], digests: [], sentimentInstruments: [], newsInstruments: [] }),
    ).toEqual([
      { kind: 'no-news-observations', instrument: '' },
      { kind: 'no-sentiment-observations', instrument: '' },
    ]);
  });

  it('a source that is not a port is refused', () => {
    const outcome = runResearchPipeline(FIXTURE_RUN_CONFIG, {
      sources: [{ nonsense: true } as unknown as ObservationSource],
      publisher: createRecordingPublicationPort(),
    });
    expect(outcome.ok).toBe(false);
    expect(codesOf(outcome)).toContain('invalid_field');
  });
});

// -- helpers -----------------------------------------------------------------

function outcomeOk(result: { ok: boolean }): boolean {
  return result.ok;
}
