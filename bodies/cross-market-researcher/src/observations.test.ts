// @tradrl/body-cross-market-researcher — the observation intake tests.
//
// Behavioral: the T037/T038 emitter-shape mirrors (quotes, trades,
// reported fundamentals), the quartet law, the provenance block
// invariants, THE L4 GATE (future observations are deferred, never
// consumed), the canonical knowledge-time order, the multi-source port
// discipline. Negative paths: unknown event types, broken quartets,
// provenance violations, non-decimal reported values.

import { describe, expect, it } from 'vitest';
import {
  CROSS_MARKET_OBSERVATION_KINDS,
  canonicalObservationOrder,
  classifyPulledRecord,
  createScriptedCrossMarketSource,
  gateObservations,
  isCrossMarketObservation,
  isCrossMarketObservationSource,
  isFundamentalDatumObservation,
  isQuoteObservation,
  isTradeObservation,
  validateCrossMarketObservation,
  validateObservationProvenance,
} from './observations';
import {
  FIXTURE_AAA_OBSERVATIONS,
  FIXTURE_CHAIN_OBSERVATIONS,
  FIXTURE_LARGECAP_OBSERVATIONS,
  FIXTURE_OBSERVATIONS,
  fixtureTradeObservation,
} from './fixtures';
import { isDeeplyFrozen } from './primitives';
import { type TimestampMs } from './primitives';

const ms = (value: number): TimestampMs => value as TimestampMs;
const AT0 = 1_717_423_200_000;

describe('the fixture observation set (T037/T038 emitter shapes)', () => {
  it('every golden observation validates against the lane mirrors', () => {
    expect(FIXTURE_OBSERVATIONS.length).toBe(12);
    for (const observation of FIXTURE_OBSERVATIONS) {
      expect(isCrossMarketObservation(observation)).toBe(true);
      expect(validateCrossMarketObservation(observation)).toEqual([]);
    }
  });

  it('the discriminants narrow correctly', () => {
    expect(FIXTURE_LARGECAP_OBSERVATIONS.every((o) => isFundamentalDatumObservation(o))).toBe(true);
    expect(FIXTURE_AAA_OBSERVATIONS.every((o) => isTradeObservation(o))).toBe(true);
    expect(FIXTURE_CHAIN_OBSERVATIONS.every((o) => isTradeObservation(o))).toBe(true);
    expect(isQuoteObservation(FIXTURE_AAA_OBSERVATIONS[0])).toBe(false);
    expect([...CROSS_MARKET_OBSERVATION_KINDS]).toEqual(['quote', 'trade', 'fundamental']);
  });

  it('the fixtures are deeply frozen', () => {
    expect(isDeeplyFrozen(FIXTURE_OBSERVATIONS)).toBe(true);
  });
});

describe('quartet + envelope validation', () => {
  it('an observation whose available_time precedes event_time is a typed timestamp_order error', () => {
    const broken = { ...FIXTURE_OBSERVATIONS[0], available_time: ms(AT0 - 1) };
    const errors = validateCrossMarketObservation(broken);
    expect(errors.map((e) => e.code)).toContain('timestamp_order');
  });

  it('a non-decimal reported value is invalid-for-this-lane (the exact-arithmetic floor)', () => {
    const broken = {
      ...FIXTURE_LARGECAP_OBSERVATIONS[0],
      payload: { ...FIXTURE_LARGECAP_OBSERVATIONS[0].payload, value: 'undisclosed' },
    };
    expect(validateCrossMarketObservation(broken).length).toBeGreaterThan(0);
  });

  it('a malformed trade payload is invalid (negative price)', () => {
    const broken = fixtureTradeObservation({ eventId: 'obs-bad-trade', at: ms(AT0), instrument: 'TEST-AAA', venue: 'TESTEX', assetClass: 'equity', price: '-50.0000' });
    expect(validateCrossMarketObservation(broken).length).toBeGreaterThan(0);
  });

  it('an unknown event type is the unknown_event_type typed error', () => {
    const errors = validateCrossMarketObservation({ event_type: 'news', payload: {} });
    expect(errors[0]?.code).toBe('unknown_event_type');
    expect(errors[0]?.message).toContain('quote, trade and fundamental');
  });
});

describe('the provenance block (T008 mirror)', () => {
  it('the fixture blocks validate under the mirrored invariants', () => {
    for (const observation of FIXTURE_OBSERVATIONS) {
      expect(validateObservationProvenance(observation.provenance, observation.event_id)).toEqual([]);
    }
  });

  it('historical observations must cite their adapter (provenance_adapter_required)', () => {
    const errors = validateObservationProvenance({ origin: 'historical', adapter: null, derived_from: [], transform: null }, 'x');
    expect(errors[0]?.code).toBe('provenance_adapter_required');
  });

  it('a derivation must declare its transform, and vice versa', () => {
    const noTransform = validateObservationProvenance({ origin: 'simulated', adapter: null, derived_from: ['parent-1'], transform: null }, 'x');
    expect(noTransform[0]?.code).toBe('provenance_transform_required');
    const noParents = validateObservationProvenance({ origin: 'simulated', adapter: null, derived_from: [], transform: 'sum' }, 'x');
    expect(noParents[0]?.code).toBe('provenance_transform_without_parents');
  });

  it('self-reference and duplicate parents are typed errors', () => {
    const self = validateObservationProvenance({ origin: 'simulated', adapter: null, derived_from: ['x'], transform: 't' }, 'x');
    expect(self[0]?.code).toBe('provenance_self_reference');
    const dup = validateObservationProvenance({ origin: 'simulated', adapter: null, derived_from: ['a', 'a'], transform: 't' }, 'x');
    expect(dup[0]?.code).toBe('provenance_duplicate_parent');
  });
});

describe('THE L4 GATE (point-in-time truth)', () => {
  it('defers — never consumes — observations available after the as-of instant', () => {
    const future = fixtureTradeObservation({ eventId: 'obs-cm-future-001', at: ms(AT0 + 300_000), instrument: 'TEST-AAA', venue: 'TESTEX', assetClass: 'equity', price: '99.0000', sequence: 5 });
    const gated = gateObservations([...FIXTURE_OBSERVATIONS, future], ms(AT0 + 240_000));
    expect(gated.admitted.length).toBe(FIXTURE_OBSERVATIONS.length);
    expect(gated.deferred.length).toBe(1);
    expect(gated.deferred[0]?.observationId).toBe('obs-cm-future-001');
    expect(gated.deferred[0]?.reason).toBe('future_observation');
    // the future observation is NOT among the admitted (L4)
    expect(gated.admitted.some((o) => o.event_id === 'obs-cm-future-001')).toBe(false);
  });

  it('admits an observation exactly at the as-of instant (the boundary)', () => {
    const gated = gateObservations(FIXTURE_OBSERVATIONS.slice(0, 1), FIXTURE_OBSERVATIONS[0]!.available_time);
    expect(gated.admitted.length).toBe(1);
    expect(gated.deferred.length).toBe(0);
  });

  it('the gate is pure: gating twice yields identical buckets', () => {
    const asOf = ms(AT0 + 240_000);
    expect(gateObservations(FIXTURE_OBSERVATIONS, asOf)).toEqual(gateObservations(FIXTURE_OBSERVATIONS, asOf));
  });
});

describe('the canonical knowledge-time order', () => {
  it('sorts by (available_time, event_id) — presentation order cannot leak', () => {
    const reversed = [...FIXTURE_OBSERVATIONS].reverse();
    expect(canonicalObservationOrder(reversed)).toEqual(canonicalObservationOrder(FIXTURE_OBSERVATIONS));
    const ordered = canonicalObservationOrder(FIXTURE_OBSERVATIONS);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1]!;
      const current = ordered[index]!;
      expect(previous.available_time <= current.available_time).toBe(true);
      if (previous.available_time === current.available_time) {
        expect(previous.event_id <= current.event_id).toBe(true);
      }
    }
  });
});

describe('the multi-source port + pulled-record classification', () => {
  it('a scripted source drains in order and then returns null', () => {
    const source = createScriptedCrossMarketSource(
      { id: 'test-source', version: '1.0.0', provider: 'test' },
      FIXTURE_OBSERVATIONS.slice(0, 3),
    );
    expect(isCrossMarketObservationSource(source)).toBe(true);
    expect(source.next()?.event_id).toBe(FIXTURE_OBSERVATIONS[0]?.event_id);
    expect(source.next()?.event_id).toBe(FIXTURE_OBSERVATIONS[1]?.event_id);
    expect(source.next()?.event_id).toBe(FIXTURE_OBSERVATIONS[2]?.event_id);
    expect(source.next()).toBeNull();
  });

  it('two sources (the multi-source discipline) drain independently', () => {
    const indexSource = createScriptedCrossMarketSource({ id: 'src-index', version: '1.0.0', provider: 'p1' }, FIXTURE_LARGECAP_OBSERVATIONS);
    const tradeSource = createScriptedCrossMarketSource({ id: 'src-trades', version: '1.0.0', provider: 'p2' }, FIXTURE_AAA_OBSERVATIONS);
    let indexCount = 0;
    let tradeCount = 0;
    while (indexSource.next() !== null) indexCount += 1;
    while (tradeSource.next() !== null) tradeCount += 1;
    expect(indexCount).toBe(4);
    expect(tradeCount).toBe(4);
  });

  it('classifies valid, invalid and unsupported records (nothing silently dropped)', () => {
    const valid = classifyPulledRecord(FIXTURE_OBSERVATIONS[0]);
    expect(valid.ok && valid.value.kind).toBe('admitted');
    // shape-valid but law-invalid (a provenance self-reference passes the
    // structural guard, fails the validation laws) -> invalid_observation
    const first = FIXTURE_OBSERVATIONS[0]!;
    const lawBreaking = {
      ...first,
      provenance: { ...first.provenance, derived_from: [first.event_id], transform: 't' },
    };
    const invalid = classifyPulledRecord(lawBreaking);
    expect(invalid.ok && invalid.value.kind === 'noted' && invalid.value.note.reason).toBe('invalid_observation');
    if (invalid.ok && invalid.value.kind === 'noted') {
      expect(invalid.value.note.detail).toBe('provenance_self_reference');
    }
    const unsupported = classifyPulledRecord({ event_type: 'news', payload: {} });
    expect(unsupported.ok && unsupported.value.kind === 'noted' && unsupported.value.note.reason).toBe('unsupported_observation_type');
    const notAnObject = classifyPulledRecord(42);
    expect(notAnObject.ok && notAnObject.value.kind === 'noted' && notAnObject.value.note.reason).toBe('invalid_observation');
  });
});
