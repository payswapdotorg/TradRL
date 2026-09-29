// @tradrl/body-regime-researcher — the market-event observation intake tests.

import { describe, expect, it } from 'vitest';

import {
  ASSET_CLASSES,
  EVENT_TYPES,
  REGIME_OBSERVATION_KINDS,
  admitMarketObservation,
  canonicalMarketObservationOrder,
  classifyPulledMarketRecord,
  createScriptedMarketSource,
  gateMarketObservations,
  isBookSnapshotObservation,
  isMarketObservation,
  isMarketObservationSource,
  isQuoteObservation,
  isTradeObservation,
  validateMarketObservation,
  validateObservationProvenance,
} from './observations';
import { FIXTURE_OBSERVATIONS, FIXTURE_AS_OF, FIXTURE_AT0, fixtureQuoteObservation } from './fixtures';
import { type TimestampMs, deepFreeze } from './primitives';

const ms = (value: number): TimestampMs => value as TimestampMs;
const codesOf = (errors: readonly { code: string }[]): readonly string[] => errors.map((e) => e.code);

describe('observation guards + validation', () => {
  it('accepts every golden fixture observation (all three kinds)', () => {
    expect(FIXTURE_OBSERVATIONS.length).toBe(11);
    for (const observation of FIXTURE_OBSERVATIONS) {
      expect(isMarketObservation(observation)).toBe(true);
      expect(validateMarketObservation(observation)).toEqual([]);
    }
    expect(isQuoteObservation(FIXTURE_OBSERVATIONS[0])).toBe(true);
    expect(isTradeObservation(FIXTURE_OBSERVATIONS[1])).toBe(true);
    expect(isQuoteObservation(FIXTURE_OBSERVATIONS[2])).toBe(true);
    expect(isBookSnapshotObservation(FIXTURE_OBSERVATIONS[5])).toBe(true);
  });

  it('discriminants FIRST: a non-market event type is unknown_event_type', () => {
    const news = { ...deepFreeze(FIXTURE_OBSERVATIONS[0] as object), event_type: 'news' };
    expect(codesOf(validateMarketObservation(news))).toEqual(['unknown_event_type']);
    const ohlcv = { ...deepFreeze(FIXTURE_OBSERVATIONS[0] as object), event_type: 'ohlcv' };
    expect(codesOf(validateMarketObservation(ohlcv))).toEqual(['unknown_event_type']);
  });

  it('enforces the ONE quartet ordering: available_time >= event_time (timestamp_order)', () => {
    const broken = {
      ...(FIXTURE_OBSERVATIONS[0] as object),
      available_time: ms((FIXTURE_AT0 as number) - 1),
    } as never;
    expect(codesOf(validateMarketObservation(broken))).toContain('timestamp_order');
  });

  it('rejects a quote payload with a non-positive price (the positive-decimal discipline)', () => {
    const zero = {
      ...(FIXTURE_OBSERVATIONS[0] as object),
      payload: { bid_price: '0', bid_size: '5.0', ask_price: '100.01', ask_size: '5.0' },
    } as never;
    expect(isQuoteObservation(zero)).toBe(false);
    expect(codesOf(validateMarketObservation(zero))).toContain('invalid_field');
  });

  it('rejects a trade payload without a side', () => {
    const sideless = {
      ...(FIXTURE_OBSERVATIONS[1] as object),
      payload: { price: '100.50', size: '1.0' },
    } as never;
    expect(isTradeObservation(sideless)).toBe(false);
    expect(codesOf(validateMarketObservation(sideless))).toContain('invalid_field');
  });

  it('rejects a book snapshot with a negative-size level', () => {
    const broken = {
      ...(FIXTURE_OBSERVATIONS[5] as object),
      payload: { bids: [{ price: '101.89', size: '-5.0' }], asks: [{ price: '101.91', size: '5.0' }] },
    } as never;
    expect(isBookSnapshotObservation(broken)).toBe(false);
    expect(codesOf(validateMarketObservation(broken))).toContain('invalid_field');
  });

  it('requires an adapter for historical origin (provenance laws)', () => {
    const provenance = { origin: 'historical', adapter: null, derived_from: [], transform: null };
    expect(codesOf(validateObservationProvenance(provenance, 'obs-x'))).toContain(
      'provenance_adapter_required',
    );
    // self-reference
    const selfRef = { origin: 'historical', adapter: { id: 'a', version: '1' }, derived_from: ['obs-x'], transform: 't' };
    expect(codesOf(validateObservationProvenance(selfRef, 'obs-x'))).toContain('provenance_self_reference');
    // duplicate parents
    const dup = { origin: 'historical', adapter: { id: 'a', version: '1' }, derived_from: ['p', 'p'], transform: 't' };
    expect(codesOf(validateObservationProvenance(dup, 'obs-x'))).toContain('provenance_duplicate_parent');
    // transform iff parents (both directions)
    const noTransform = { origin: 'historical', adapter: { id: 'a', version: '1' }, derived_from: ['p'], transform: null };
    expect(codesOf(validateObservationProvenance(noTransform, 'obs-x'))).toContain('provenance_transform_required');
    const orphanTransform = { origin: 'historical', adapter: { id: 'a', version: '1' }, derived_from: [], transform: 't' };
    expect(codesOf(validateObservationProvenance(orphanTransform, 'obs-x'))).toContain(
      'provenance_transform_without_parents',
    );
  });

  it('mirrors the canonical taxonomy vocabularies', () => {
    expect([...EVENT_TYPES]).toEqual([
      'trade', 'quote', 'book_snapshot', 'book_delta', 'ohlcv',
      'news', 'macro_release', 'social_signal', 'fundamental',
      'option_chain_mark', 'other',
    ]);
    expect([...ASSET_CLASSES]).toEqual([
      'crypto', 'equity', 'index', 'future', 'option',
      'forex', 'commodity', 'macro', 'other',
    ]);
    expect([...REGIME_OBSERVATION_KINDS]).toEqual(['quote', 'trade', 'book_snapshot']);
  });
});

describe('THE L4 GATE (point-in-time truth)', () => {
  it('admits observations available at or before the as-of instant', () => {
    const observation = FIXTURE_OBSERVATIONS[0];
    if (!isMarketObservation(observation)) throw new Error('fixture must be an observation');
    expect(admitMarketObservation(observation, observation.available_time)).toBe(true);
    expect(admitMarketObservation(observation, ms((observation.available_time as number) - 1))).toBe(false);
  });

  it('DEFERS (never drops) an observation available after the as-of instant', () => {
    const gated = gateMarketObservations(FIXTURE_OBSERVATIONS as never, FIXTURE_AS_OF);
    expect(gated.admitted.length).toBe(10);
    expect(gated.deferred).toEqual([
      { observationId: 'obs-future-001', availableTime: ms(1_717_423_200_000 + 70_000), reason: 'future_observation' },
    ]);
  });

  it('the boundary instant itself is admitted (<=, not <)', () => {
    const at = FIXTURE_AS_OF;
    const observation = fixtureQuoteObservation({ eventId: 'obs-boundary', at, instrument: 'TEST-AAA', bid: '1.00', ask: '1.02' });
    const gated = gateMarketObservations([observation], FIXTURE_AS_OF);
    expect(gated.admitted.length).toBe(1);
    expect(gated.deferred.length).toBe(0);
  });

  it('orders by (available_time, event_id) and is presentation-order independent', () => {
    const forward = canonicalMarketObservationOrder(FIXTURE_OBSERVATIONS as never);
    const reversed = canonicalMarketObservationOrder((FIXTURE_OBSERVATIONS as readonly unknown[]).slice().reverse() as never);
    expect(forward.map((o) => o.event_id)).toEqual(reversed.map((o) => o.event_id));
    expect(forward.map((o) => o.event_id)).toEqual([
      'obs-mkt-001', 'obs-mkt-101', 'obs-mkt-002', 'obs-mkt-102',
      'obs-mkt-003', 'obs-mkt-004', 'obs-mkt-005', 'obs-mkt-006',
      'obs-mkt-007', 'obs-mkt-008', 'obs-future-001',
    ]);
  });
});

describe('the observation source port', () => {
  it('drains a scripted source deterministically', () => {
    const source = createScriptedMarketSource(
      { id: 'fixture-source', version: '1.0.0', provider: 'market-replay' },
      FIXTURE_OBSERVATIONS as never,
    );
    expect(isMarketObservationSource(source)).toBe(true);
    const drained = [];
    for (;;) {
      const next = source.next();
      if (next === null) break;
      drained.push(next);
    }
    expect(drained.length).toBe(11);
    expect(source.next()).toBeNull(); // stays drained
  });

  it('classifies pulled records: admitted / unsupported / invalid', () => {
    const admitted = classifyPulledMarketRecord(FIXTURE_OBSERVATIONS[0]);
    expect(admitted.ok && admitted.value.kind).toBe('admitted');
    const news = classifyPulledMarketRecord({ event_type: 'news', event_id: 'x' });
    expect(news.ok && news.value.kind === 'noted' && news.value.note.reason).toBe('unsupported_observation_type');
    // full shape, broken quartet: shape-guard passes, deep validation fails
    const source = FIXTURE_OBSERVATIONS[0];
    const invalid = classifyPulledMarketRecord({
      ...source,
      available_time: ms((source.event_time as number) - 1),
    });
    expect(invalid.ok && invalid.value.kind === 'noted' && invalid.value.note.reason).toBe('invalid_observation');
    const garbage = classifyPulledMarketRecord(42);
    expect(garbage.ok && garbage.value.kind === 'noted' && garbage.value.note.reason).toBe('invalid_observation');
  });

  it('a non-source object fails the structural guard', () => {
    expect(isMarketObservationSource({})).toBe(false);
    expect(isMarketObservationSource({ descriptor: { id: 'a', version: '1', provider: 'p' } })).toBe(false);
  });
});
