// @tradrl/research (service) — the regime pipeline tests.
//
// Behavioral: the golden report (byte-stable); DETERMINISM (the same
// observation set, as-of, body version and seed produce byte-identical
// outputs, twice); the L4 gate (future observations deferred, never
// consumed — and an all-future stream produces no classifications); the
// L8 gate (a doctored execution-granting body spec is refused); the
// evidence/method-honesty refusals; the publication discipline (the
// port receives exactly one bound envelope); coverage accounting.

import { describe, expect, it } from 'vitest';

import {
  type RegimeRunConfig,
  runRegimePipeline,
  regimeRunId,
  validateRegimeRunConfig,
  runRegimeIntake,
  runRegimeClassification,
  runRegimeChangeDetection,
  computeRegimeDataGaps,
  serializeRegimeRunConfig,
} from './index';
import {
  createScriptedMarketSource,
  createRegimeRecordingPort,
  createRegimeClassification,
  serializeRegimeResearchReport,
  validateRegimeResearchReport,
  REGIME_METHOD_REGISTRY,
  REGIME_RESEARCHER_BODY,
  type MarketObservationSource,
} from '../../../../bodies/regime-researcher/src/index';
import {
  REGIME_AS_OF,
  REGIME_GOLDEN_REPORT,
  REGIME_OUTCOME,
  REGIME_RUN_CONFIG,
  REGIME_STREAM,
  REGIME_L4_VIOLATION_STREAM,
  regimeAuthorityViolationSpec,
  regimeFixtureInputs,
  regimeFixtureSource,
  evidenceLessClassification,
  futureCitationClassification,
  undeclaredMethodClassification,
  magicLabelClassification,
  BODY_TENANT,
  FIXTURE_REGISTRY,
} from './fixtures';

const codesOf = (result: { ok: boolean; errors?: readonly { code: string }[] }): readonly string[] =>
  result.ok ? [] : ((result.errors ?? []) as readonly { code: string }[]).map((e) => e.code);
function unwrap<T>(result: { readonly ok: boolean; readonly errors?: readonly { code: string; message: string }[]; readonly value?: T }): T {
  if (!result.ok) throw new Error(`expected ok, got: ${JSON.stringify(result.errors)}`);
  return result.value as T;
}

describe('the golden run (the ranging -> trending-up story)', () => {
  it('produces the golden report with the expected structure', () => {
    const outcome = REGIME_OUTCOME;
    expect(outcome.classifications.length).toBe(2);
    expect(outcome.changes.length).toBe(1);
    const w0 = outcome.classifications[0]!;
    const w1 = outcome.classifications[1]!;
    expect(w0.scope.instrument).toBe('TEST-AAA');
    expect(w0.label).toBe('ranging');
    expect(w0.netMoveRatio).toBe('0.0060');
    expect(w0.confidence.level).toBe('moderate');
    expect(w1.label).toBe('trending-up');
    expect(w1.netMoveRatio).toBe('0.0417');
    const change = outcome.changes[0]!;
    expect(change.fromLabel).toBe('ranging');
    expect(change.toLabel).toBe('trending-up');
    // the data gap: TEST-BBB observed but never classified (below the minimum)
    expect(outcome.dataGaps).toEqual([{ kind: 'instrument-without-classification', instrument: 'TEST-BBB' }]);
    // the coverage: 11 offered, 10 admitted, 1 deferred — nothing dropped
    expect(outcome.coverage).toEqual({
      observationsOffered: 11,
      observationsAdmitted: 10,
      observationsDeferred: 1,
      observationsUnsupported: 0,
      observationsInvalid: 0,
    });
    expect(outcome.deferred).toEqual([
      { observationId: 'obs-future-001', availableTime: REGIME_AS_OF + 10_000, reason: 'future_observation' },
    ]);
  });

  it('the golden report validates under the contract laws and carries the full lineage', () => {
    expect(validateRegimeResearchReport(REGIME_GOLDEN_REPORT, REGIME_METHOD_REGISTRY)).toEqual([]);
    expect(REGIME_GOLDEN_REPORT.tenantId).toBe(BODY_TENANT);
    expect(REGIME_GOLDEN_REPORT.classifications[0]!.evidence.length).toBe(4);
    expect(REGIME_GOLDEN_REPORT.classifications[1]!.evidence.length).toBe(4);
    expect(REGIME_GOLDEN_REPORT.changes[0]!.evidence.length).toBe(8);
    for (const classification of REGIME_GOLDEN_REPORT.classifications) {
      for (const citation of classification.evidence) {
        expect(citation.provenance.origin).toBe('historical');
      }
    }
  });

  it('the golden report is the body package\'s golden report (one story, one identity)', () => {
    expect(REGIME_GOLDEN_REPORT.reportId).toBe(FIXTURE_REPORT_ID);
  });

  it('publishes EXACTLY ONE bound envelope through the port', () => {
    const inputs = regimeFixtureInputs();
    const outcome = runRegimePipeline(REGIME_RUN_CONFIG, inputs);
    expect(outcome.ok).toBe(true);
    expect(inputs.publisher.published.length).toBe(1);
    const publication = inputs.publisher.published[0]!;
    expect(publication.envelope.payload).toBe(`report:${unwrap(outcome).reportId}`);
    expect(publication.envelope.id).toBe(`msg:${REGIME_RUN_CONFIG.opId}:${REGIME_RUN_CONFIG.sender}:1`);
    expect(publication.report.reportId).toBe(unwrap(outcome).reportId);
  });
});

describe('DETERMINISM (the acceptance law)', () => {
  it('same (observations, as-of, body version, seed) -> byte-identical report, twice', () => {
    const once = runRegimePipeline(REGIME_RUN_CONFIG, regimeFixtureInputs());
    const twice = runRegimePipeline(REGIME_RUN_CONFIG, regimeFixtureInputs());
    expect(once.ok).toBe(true);
    expect(twice.ok).toBe(true);
    const a = unwrap(once);
    const b = unwrap(twice);
    expect(a).toEqual(b);
    expect(serializeRegimeResearchReport(a.publication.report)).toBe(serializeRegimeResearchReport(b.publication.report));
    expect(a.reportId).toBe(b.reportId);
    expect(a.reportId).toBe(REGIME_GOLDEN_REPORT.reportId);
    expect(serializeRegimeResearchReport(REGIME_GOLDEN_REPORT)).toBe(serializeRegimeResearchReport(a.publication.report));
  });

  it('source PULL ORDER cannot leak into output bytes', () => {
    const reversed = createScriptedMarketSource(
      { id: 'regime-fixture-source', version: '1.0.0', provider: 'market-replay' },
      REGIME_STREAM.slice().reverse(),
    );
    const outcome = runRegimePipeline(REGIME_RUN_CONFIG, {
      sources: [reversed],
      publisher: createRegimeRecordingPort(),
    });
    expect(outcome.ok).toBe(true);
    expect(unwrap(outcome).reportId).toBe(REGIME_GOLDEN_REPORT.reportId);
  });

  it('the run id and config serialization are pure functions', () => {
    expect(regimeRunId(REGIME_RUN_CONFIG)).toBe(regimeRunId(JSON.parse(JSON.stringify(REGIME_RUN_CONFIG))));
    expect(serializeRegimeRunConfig(REGIME_RUN_CONFIG)).toBe(
      serializeRegimeRunConfig(JSON.parse(JSON.stringify(REGIME_RUN_CONFIG))),
    );
  });
});

describe('THE L4 GATE (point-in-time truth)', () => {
  it('an all-future stream yields NO classifications, a declared gap, and full deferral', () => {
    const source = createScriptedMarketSource(
      { id: 'l4-source', version: '1.0.0', provider: 'l4' },
      REGIME_L4_VIOLATION_STREAM,
    );
    const outcome = runRegimePipeline(REGIME_RUN_CONFIG, {
      sources: [source],
      publisher: createRegimeRecordingPort(),
    });
    expect(outcome.ok).toBe(true);
    const value = unwrap(outcome);
    expect(value.classifications.length).toBe(0);
    expect(value.changes.length).toBe(0);
    expect(value.deferred.length).toBe(5);
    expect(value.coverage.observationsAdmitted).toBe(0);
    expect(value.coverage.observationsDeferred).toBe(5);
    expect(value.dataGaps).toEqual([{ kind: 'no-market-observations', instrument: '' }]);
  });

  it('the gate defers mid-stream future observations while consuming the rest', () => {
    const intake = runRegimeIntake([regimeFixtureSource()], REGIME_RUN_CONFIG.asOf);
    expect(intake.ok).toBe(true);
    const snapshot = unwrap(intake);
    expect(snapshot.deferred.map((d) => d.observationId)).toEqual(['obs-future-001']);
    expect(snapshot.admitted.length).toBe(10);
  });
});

describe('THE L8 GATE (read-only authority — the pipeline refuses doctored specs)', () => {
  it('a body spec granting EXECUTE is refused before any observation is pulled', () => {
    const inputs = regimeFixtureInputs();
    const outcome = runRegimePipeline(REGIME_RUN_CONFIG, inputs, regimeAuthorityViolationSpec());
    expect(outcome.ok).toBe(false);
    expect(codesOf(outcome)).toContain('execution_authority_granted');
    // the refusal happened BEFORE the publication stage — the port saw nothing
    expect(inputs.publisher.published.length).toBe(0);
  });

  it('the shipped body spec runs cleanly', () => {
    expect(runRegimePipeline(REGIME_RUN_CONFIG, regimeFixtureInputs(), REGIME_RESEARCHER_BODY).ok).toBe(true);
  });
});

describe('the evidence and method-honesty refusals', () => {
  it('an evidence-less classification is refused by the contract factory', () => {
    const result = createRegimeClassification(evidenceLessClassification(), REGIME_METHOD_REGISTRY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((e) => e.code)).toContain('evidence_missing');
  });

  it('a future-citation classification is refused (L4)', () => {
    const result = createRegimeClassification(futureCitationClassification(), REGIME_METHOD_REGISTRY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((e) => e.code)).toContain('future_evidence');
  });

  it('an undeclared-method classification is refused (method honesty)', () => {
    const result = createRegimeClassification(undeclaredMethodClassification(), REGIME_METHOD_REGISTRY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((e) => e.code)).toContain('undeclared_method');
  });

  it('a magic label is refused (the closed-taxonomy law)', () => {
    const result = createRegimeClassification(magicLabelClassification(), REGIME_METHOD_REGISTRY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.map((e) => e.code)).toContain('regime_label_mismatch');
  });
});

describe('config validation', () => {
  it('rejects malformed configs with typed errors', () => {
    for (const bad of [null, {}, { ...REGIME_RUN_CONFIG, tenantId: '' }, { ...REGIME_RUN_CONFIG, publicationSequence: 0 }]) {
      expect(validateRegimeRunConfig(bad).length).toBeGreaterThan(0);
    }
    expect(validateRegimeRunConfig(REGIME_RUN_CONFIG)).toEqual([]);
  });

  it('a bad config is refused by the pipeline', () => {
    const outcome = runRegimePipeline(
      { ...REGIME_RUN_CONFIG, asOf: -1 as never },
      regimeFixtureInputs(),
    );
    expect(outcome.ok).toBe(false);
  });

  it('a source that is not a port is refused', () => {
    const outcome = runRegimePipeline(REGIME_RUN_CONFIG, {
      sources: [{ nonsense: true } as unknown as MarketObservationSource],
      publisher: createRegimeRecordingPort(),
    });
    expect(outcome.ok).toBe(false);
    expect(codesOf(outcome)).toContain('invalid_field');
  });
});

describe('stage-level purity', () => {
  it('classification is order-independent and groups by (instrument, venue, window)', () => {
    const forward = runRegimeClassification(REGIME_STREAM, REGIME_METHOD_REGISTRY, REGIME_RUN_CONFIG);
    const reverse = runRegimeClassification(REGIME_STREAM.slice().reverse(), REGIME_METHOD_REGISTRY, REGIME_RUN_CONFIG);
    expect(forward.ok && reverse.ok).toBe(true);
    expect(unwrap(forward).classifications).toEqual(unwrap(reverse).classifications);
    expect(unwrap(forward).instrumentsSeen).toEqual(['TEST-AAA', 'TEST-BBB']);
    expect(unwrap(forward).instrumentsClassified).toEqual(['TEST-AAA']);
  });

  it('windows below the declared minimum produce no classification (TEST-BBB)', () => {
    const stage = runRegimeClassification(REGIME_STREAM, REGIME_METHOD_REGISTRY, REGIME_RUN_CONFIG);
    expect(unwrap(stage).classifications.every((c) => c.scope.instrument === 'TEST-AAA')).toBe(true);
  });

  it('change detection only emits genuine consecutive-window transitions', () => {
    const classification = runRegimeClassification(REGIME_STREAM, REGIME_METHOD_REGISTRY, REGIME_RUN_CONFIG);
    const detection = runRegimeChangeDetection(unwrap(classification).classifications, REGIME_METHOD_REGISTRY, REGIME_RUN_CONFIG);
    expect(detection.ok).toBe(true);
    const changes = unwrap(detection).changes;
    expect(changes.length).toBe(1);
    expect(changes[0]!.detectionInstant).toBe(changes[0]!.toWindow.to);
  });

  it('data gaps are computed from the stage outputs (enumerated kinds only)', () => {
    expect(
      computeRegimeDataGaps({ instrumentsSeen: ['X'], instrumentsClassified: [], observationsAdmitted: 3 }),
    ).toEqual([{ kind: 'instrument-without-classification', instrument: 'X' }]);
    expect(
      computeRegimeDataGaps({ instrumentsSeen: [], instrumentsClassified: [], observationsAdmitted: 0 }),
    ).toEqual([{ kind: 'no-market-observations', instrument: '' }]);
  });
});

// -- helpers -----------------------------------------------------------------

import { FIXTURE_REPORT } from '../../../../bodies/regime-researcher/src/fixtures';
const FIXTURE_REPORT_ID = FIXTURE_REPORT.reportId;
