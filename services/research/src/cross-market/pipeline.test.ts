// @tradrl/research (service) — the cross-market pipeline tests.
//
// Behavioral: the golden run (structure, lineage, one bound publication),
// DETERMINISM (the acceptance law — byte-identical reports across
// independent runs, pull-order independence), THE L4 GATE (all-future
// streams, mid-stream deferral), THE L8 GATE (doctored body specs refused
// before any observation is pulled), the evidence/method-honesty
// refusals, config validation, and stage-level purity (leg formation,
// pair enumeration, the declared window model).

import { describe, expect, it } from 'vitest';

import {
  type CrossMarketRunConfig,
  crossMarketRunId,
  CROSS_MARKET_AS_OF,
  CROSS_MARKET_AT0,
  CROSS_MARKET_GOLDEN_REPORT,
  CROSS_MARKET_OUTCOME,
  CROSS_MARKET_RUN_CONFIG,
  CROSS_MARKET_STREAM,
  crossMarketAuthorityViolationBodySpec,
  crossMarketEvidenceLessRelationship,
  crossMarketFixtureInputs,
  crossMarketFixtureSource,
  crossMarketFutureCitationRelationship,
  crossMarketL4ViolationSource,
  runCrossMarketIntake,
  runCrossMarketPipeline,
  runRelationshipAnalysis,
  serializeCrossMarketRunConfig,
  crossMarketUndeclaredMethodRelationship,
  validateCrossMarketRunConfig,
} from './index';
// the contract surface lives in the body package (the service-root
// collision law): tests import it through the body package's own surface.
import {
  CROSS_MARKET_METHOD_REGISTRY,
  createCrossMarketRelationship,
  createScriptedCrossMarketSource,
  fixtureFundamentalObservation,
  fixtureTradeObservation,
  marketLegKey,
  serializeCrossMarketResearchReport,
  validateCrossMarketResearchReport,
  type CrossMarketObservation,
  type TimestampMs,
} from '../../../../bodies/cross-market-researcher/src/index';

const codesOf = (result: { ok: boolean; errors?: readonly { code: string }[] }): readonly string[] =>
  result.ok ? [] : ((result.errors ?? []) as readonly { code: string }[]).map((e) => e.code);

function unwrap<T>(result: { readonly ok: boolean; readonly errors?: readonly { code: string; message: string }[]; readonly value?: T }): T {
  if (!result.ok) throw new Error(`expected ok, got: ${JSON.stringify(result.errors)}`);
  return result.value as T;
}

describe('the golden run', () => {
  it('produces the golden report with the expected structure', () => {
    const outcome = CROSS_MARKET_OUTCOME;
    // five relationships over the three canonical pairs
    expect(outcome.relationships.length).toBe(5);
    const measures = outcome.relationships.map(
      (r) => `${marketLegKey(r.pair.left)}>${marketLegKey(r.pair.right)}|${r.relationKind}|${r.measure.direction}|${r.measure.score}`,
    );
    expect(measures).toEqual([
      'CHAINX|TEST-CHAIN-A|crypto|trade>LICENSED-INDEX-A|TEST-LARGECAP|index|INDEX_LEVEL|spread-divergence|narrowing|-0.0300',
      'CHAINX|TEST-CHAIN-A|crypto|trade>TESTEX|TEST-AAA|equity|trade|spread-divergence|narrowing|-0.0600',
      'LICENSED-INDEX-A|TEST-LARGECAP|index|INDEX_LEVEL>TESTEX|TEST-AAA|equity|trade|co-movement|positive|1.0000',
      'LICENSED-INDEX-A|TEST-LARGECAP|index|INDEX_LEVEL>TESTEX|TEST-AAA|equity|trade|lead-lag|no-lead|0.0000',
      'LICENSED-INDEX-A|TEST-LARGECAP|index|INDEX_LEVEL>TESTEX|TEST-AAA|equity|trade|spread-divergence|narrowing|-0.0300',
    ]);
    // both legs carry four observations each (the leg-coverage law)
    for (const relationship of outcome.relationships) {
      expect(relationship.evidence.filter((c) => c.leg === 'left').length).toBe(4);
      expect(relationship.evidence.filter((c) => c.leg === 'right').length).toBe(4);
      expect(relationship.confidence.level).toBe('high');
    }
    // the four data gaps (the flat leg's pairs, both relation gaps each)
    expect(outcome.dataGaps.map((gap) => gap.kind).sort()).toEqual([
      'insufficient-compared-windows',
      'insufficient-compared-windows',
      'insufficient-decisive-windows',
      'insufficient-decisive-windows',
    ]);
    // the L4 accounting: 13 offered, 12 admitted, 1 deferred — nothing dropped
    expect(outcome.coverage).toEqual({
      observationsOffered: 13,
      observationsAdmitted: 12,
      observationsDeferred: 1,
      observationsUnsupported: 0,
      observationsInvalid: 0,
    });
  });

  it('the golden report validates under the contract laws and carries the full lineage', () => {
    expect(validateCrossMarketResearchReport(CROSS_MARKET_GOLDEN_REPORT, CROSS_MARKET_METHOD_REGISTRY)).toEqual([]);
    expect(CROSS_MARKET_GOLDEN_REPORT.summary.meanMeasureScore).toBe('0.1760');
    expect(CROSS_MARKET_GOLDEN_REPORT.summary.dominantRelationKind).toBe('spread-divergence');
    expect(CROSS_MARKET_GOLDEN_REPORT.summary.pairCount).toBe(3);
    expect(CROSS_MARKET_GOLDEN_REPORT.summary.instrumentCount).toBe(3);
  });

  it('publishes EXACTLY ONE bound envelope through the port', () => {
    const inputs = crossMarketFixtureInputs();
    const outcome = runCrossMarketPipeline(CROSS_MARKET_RUN_CONFIG, inputs);
    expect(outcome.ok).toBe(true);
    const value = unwrap(outcome);
    expect(inputs.publisher.published.length).toBe(1);
    expect(inputs.publisher.published[0]!.envelope.payload).toBe(`report:${value.reportId}`);
    expect(value.reportId).toBe(CROSS_MARKET_GOLDEN_REPORT.reportId);
  });
});

describe('DETERMINISM (the acceptance law)', () => {
  it('same (observations, as-of, body version, seed) -> byte-identical report, twice', () => {
    const once = runCrossMarketPipeline(CROSS_MARKET_RUN_CONFIG, crossMarketFixtureInputs());
    const twice = runCrossMarketPipeline(CROSS_MARKET_RUN_CONFIG, crossMarketFixtureInputs());
    const a = unwrap(once);
    const b = unwrap(twice);
    expect(a.reportId).toBe(b.reportId);
    expect(a).toEqual(b);
    expect(serializeCrossMarketResearchReport(a.publication.report)).toBe(
      serializeCrossMarketResearchReport(b.publication.report),
    );
  });

  it('the SOURCE SPLIT cannot leak into output bytes (the multi-source discipline)', () => {
    // the same observations offered by a DIFFERENT split of sources
    const stream = CROSS_MARKET_STREAM as readonly CrossMarketObservation[];
    const single = createScriptedCrossMarketSource({ id: 'one', version: '1.0.0', provider: 'p' }, stream);
    const outcome = runCrossMarketPipeline(CROSS_MARKET_RUN_CONFIG, {
      sources: [single],
      publisher: createRecordingPort(),
    });
    expect(unwrap(outcome).reportId).toBe(CROSS_MARKET_GOLDEN_REPORT.reportId);
  });

  it('the run id and config serialization are pure functions', () => {
    expect(crossMarketRunId(CROSS_MARKET_RUN_CONFIG)).toBe(crossMarketRunId(CROSS_MARKET_RUN_CONFIG));
    expect(serializeCrossMarketRunConfig(CROSS_MARKET_RUN_CONFIG)).toBe(
      serializeCrossMarketRunConfig(CROSS_MARKET_RUN_CONFIG),
    );
  });
});

describe('THE L4 GATE (point-in-time truth)', () => {
  it('an all-future stream yields NO relationships, a declared gap, and full deferral', () => {
    const outcome = runCrossMarketPipeline(CROSS_MARKET_RUN_CONFIG, {
      sources: [crossMarketL4ViolationSource()],
      publisher: createRecordingPort(),
    });
    expect(outcome.ok).toBe(true);
    const value = unwrap(outcome);
    expect(value.relationships.length).toBe(0);
    expect(value.deferred.length).toBe(2);
    expect(value.coverage.observationsAdmitted).toBe(0);
    expect(value.dataGaps).toEqual([{ kind: 'no-observations', leftInstrument: '', rightInstrument: '' }]);
    // and the empty report still validates + publishes (the declared gap)
    expect(validateCrossMarketResearchReport(value.publication.report, CROSS_MARKET_METHOD_REGISTRY)).toEqual([]);
  });

  it('the gate defers mid-stream future observations while consuming the rest', () => {
    const intake = runCrossMarketIntake([crossMarketFixtureSource()], CROSS_MARKET_AS_OF);
    const value = unwrap(intake);
    expect(value.deferred.length).toBe(1);
    expect(value.deferred[0]?.observationId).toBe('obs-cm-future-001');
    expect(value.admitted.some((o) => o.event_id === 'obs-cm-future-001')).toBe(false);
  });
});

describe('THE L8 GATE (read-only authority — the pipeline refuses doctored specs)', () => {
  it('a body spec granting EXECUTE is refused before any observation is pulled', () => {
    const outcome = runCrossMarketPipeline(
      CROSS_MARKET_RUN_CONFIG,
      crossMarketFixtureInputs(),
      crossMarketAuthorityViolationBodySpec(),
    );
    expect(outcome.ok).toBe(false);
    expect(codesOf(outcome)).toContain('execution_authority_granted');
  });

  it('the shipped body spec runs cleanly', () => {
    const outcome = runCrossMarketPipeline(CROSS_MARKET_RUN_CONFIG, crossMarketFixtureInputs());
    expect(outcome.ok).toBe(true);
  });
});

describe('the evidence and method-honesty refusals', () => {
  it('an evidence-less relationship is refused by the contract factory', () => {
    const refused = createCrossMarketRelationship(crossMarketEvidenceLessRelationship(), CROSS_MARKET_METHOD_REGISTRY);
    expect(refused.ok).toBe(false);
    expect(codesOf(refused)).toContain('evidence_missing');
  });

  it('a future-citation relationship is refused (L4)', () => {
    const refused = createCrossMarketRelationship(crossMarketFutureCitationRelationship(), CROSS_MARKET_METHOD_REGISTRY);
    expect(codesOf(refused)).toContain('future_evidence');
  });

  it('an undeclared-method relationship is refused (method honesty)', () => {
    const refused = createCrossMarketRelationship(crossMarketUndeclaredMethodRelationship(), CROSS_MARKET_METHOD_REGISTRY);
    expect(codesOf(refused)).toContain('undeclared_method');
  });
});

describe('config validation', () => {
  it('rejects malformed configs with typed errors', () => {
    const errors = validateCrossMarketRunConfig({ asOf: 'soon', bodyVersion: 'x' });
    expect(errors.length).toBeGreaterThanOrEqual(6);
  });

  it('a bad config is refused by the pipeline', () => {
    const badConfig = { ...CROSS_MARKET_RUN_CONFIG, publicationSequence: 0 } as unknown as CrossMarketRunConfig;
    const outcome = runCrossMarketPipeline(badConfig, crossMarketFixtureInputs());
    expect(outcome.ok).toBe(false);
  });
});

describe('stage-level purity (the declared window model)', () => {
  it('the analysis stage is order-independent (canonical legs and pairs)', () => {
    const stream = CROSS_MARKET_STREAM as readonly CrossMarketObservation[];
    const admitted = stream.filter((o) => (o.available_time as number) <= (CROSS_MARKET_RUN_CONFIG.asOf as number));
    const forward = runRelationshipAnalysis(admitted, CROSS_MARKET_METHOD_REGISTRY, CROSS_MARKET_RUN_CONFIG);
    const backward = runRelationshipAnalysis([...admitted].reverse(), CROSS_MARKET_METHOD_REGISTRY, CROSS_MARKET_RUN_CONFIG);
    expect(unwrap(forward).relationships).toEqual(unwrap(backward).relationships);
  });

  it('legs form by (venue, instrument, assetClass, series) — cross-venue same-instrument series are DISTINCT legs', () => {
    const stream: CrossMarketObservation[] = [
      ...FIXTURE_AAA_OBSERVATIONS(),
      ...FIXTURE_AAA_OBSERVATIONS_ON_OTHER_VENUE(),
    ];
    const analysis = runRelationshipAnalysis(stream, CROSS_MARKET_METHOD_REGISTRY, {
      ...CROSS_MARKET_RUN_CONFIG,
      asOf: (CROSS_MARKET_AT0 + 300_000) as TimestampMs,
      publishedAt: (CROSS_MARKET_AT0 + 300_000) as TimestampMs,
    });
    // the same TEST-AAA series on two venues: one pair, relationships computed
    const value = unwrap(analysis);
    expect(value.relationships.length).toBe(3);
    const pair = value.relationships[0]!.pair;
    expect(pair.left.instrument).toBe('TEST-AAA');
    expect(pair.right.instrument).toBe('TEST-AAA');
    expect(pair.left.venue).not.toBe(pair.right.venue);
    // synchronized identical series: full agreement, no spread change
    expect(value.relationships.find((r) => r.relationKind === 'co-movement')?.measure.score).toBe('1.0000');
    expect(value.relationships.find((r) => r.relationKind === 'spread-divergence')?.measure.score).toBe('0.0000');
  });

  it('a leg with too few observations gaps every pair it appears in', () => {
    const stream: CrossMarketObservation[] = [
      ...FIXTURE_AAA_OBSERVATIONS(),
      fixtureTradeObservation({ eventId: 'obs-thin-1', at: CROSS_MARKET_AT0, instrument: 'TEST-THIN', venue: 'THINX', assetClass: 'equity', price: '5.0000', sequence: 1 }),
    ];
    const value = unwrap(runRelationshipAnalysis(stream, CROSS_MARKET_METHOD_REGISTRY, CROSS_MARKET_RUN_CONFIG));
    expect(value.relationships.length).toBe(0);
    expect(value.dataGaps.every((gap) => gap.kind === 'insufficient-leg-observations')).toBe(true);
    expect(value.dataGaps.length).toBe(1);
    expect(value.dataGaps[0]?.rightInstrument).toBe('TEST-THIN');
  });

  it('a source that is not a port is refused', () => {
    const outcome = runCrossMarketIntake([{} as never], CROSS_MARKET_AS_OF);
    expect(outcome.ok).toBe(false);
  });
});

// --- local helpers ------------------------------------------------------------

function createRecordingPort() {
  return crossMarketFixtureInputs().publisher;
}

/** Four rising TEST-AAA trades on TESTEX (the golden leg). */
function FIXTURE_AAA_OBSERVATIONS(): CrossMarketObservation[] {
  return [
    fixtureTradeObservation({ eventId: 'obs-p-aa-001', at: CROSS_MARKET_AT0, instrument: 'TEST-AAA', venue: 'TESTEX', assetClass: 'equity', price: '50.0000', sequence: 1 }),
    fixtureTradeObservation({ eventId: 'obs-p-aa-002', at: (CROSS_MARKET_AT0 + 60_000) as TimestampMs, instrument: 'TEST-AAA', venue: 'TESTEX', assetClass: 'equity', price: '51.0000', sequence: 2 }),
    fixtureTradeObservation({ eventId: 'obs-p-aa-003', at: (CROSS_MARKET_AT0 + 120_000) as TimestampMs, instrument: 'TEST-AAA', venue: 'TESTEX', assetClass: 'equity', price: '52.0000', sequence: 3 }),
    fixtureTradeObservation({ eventId: 'obs-p-aa-004', at: (CROSS_MARKET_AT0 + 180_000) as TimestampMs, instrument: 'TEST-AAA', venue: 'TESTEX', assetClass: 'equity', price: '53.0000', sequence: 4 }),
  ];
}

/** The SAME series on ANOTHER venue (a distinct leg). */
function FIXTURE_AAA_OBSERVATIONS_ON_OTHER_VENUE(): CrossMarketObservation[] {
  return [
    fixtureTradeObservation({ eventId: 'obs-p-bb-001', at: CROSS_MARKET_AT0, instrument: 'TEST-AAA', venue: 'OTHEREX', assetClass: 'equity', price: '150.0000', sequence: 1 }),
    fixtureTradeObservation({ eventId: 'obs-p-bb-002', at: (CROSS_MARKET_AT0 + 60_000) as TimestampMs, instrument: 'TEST-AAA', venue: 'OTHEREX', assetClass: 'equity', price: '153.0000', sequence: 2 }),
    fixtureTradeObservation({ eventId: 'obs-p-bb-003', at: (CROSS_MARKET_AT0 + 120_000) as TimestampMs, instrument: 'TEST-AAA', venue: 'OTHEREX', assetClass: 'equity', price: '156.0000', sequence: 3 }),
    fixtureTradeObservation({ eventId: 'obs-p-bb-004', at: (CROSS_MARKET_AT0 + 180_000) as TimestampMs, instrument: 'TEST-AAA', venue: 'OTHEREX', assetClass: 'equity', price: '159.0000', sequence: 4 }),
  ];
}

void fixtureFundamentalObservation;
