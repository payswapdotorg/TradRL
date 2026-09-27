import { describe, expect, it } from 'vitest';

import {
  EVENT_ORIGINS,
  eventOrigin,
  isEventOrigin,
  isProvenance,
  isSyntheticEvent,
  validateMarketEvent,
  validateProvenance,
  type EventOrigin,
  type MarketProtocolError,
} from './index';

const HISTORICAL = { origin: 'historical', adapter: { id: 'binance-adapter', version: '1.4.0' }, derived_from: [], transform: null };
const SIMULATED = { origin: 'simulated', adapter: null, derived_from: [], transform: null };
const GENERATED = { origin: 'generated', adapter: { id: 'worldgen', version: '0.3.0' }, derived_from: [], transform: null };

function provenanceEvent(provenance: unknown): unknown {
  return {
    event_id: 'evt-1',
    venue: 'BINANCE',
    instrument: 'BTC-USDT',
    asset_class: 'crypto',
    event_type: 'trade',
    event_time: 1_000,
    source_time: 1_000,
    available_time: 1_050,
    ingestion_time: 1_200,
    sequence: 1,
    provider: 'binance',
    provenance,
    payload: { price: '100', size: '1', side: 'buy' },
  };
}

describe('origin taxonomy', () => {
  it('exposes exactly the three canonical origins', () => {
    expect([...EVENT_ORIGINS]).toEqual(['historical', 'simulated', 'generated']);
    for (const origin of ['historical', 'simulated', 'generated'] as EventOrigin[]) {
      expect(isEventOrigin(origin)).toBe(true);
    }
    expect(isEventOrigin('live')).toBe(false);
  });
});

describe('syntheticity — simulated and generated events are ALWAYS distinguishable from historical ones', () => {
  it('isSyntheticEvent is false only for historical origin', () => {
    for (const [provenance, expectedSynthetic] of [
      [HISTORICAL, false],
      [SIMULATED, true],
      [GENERATED, true],
    ] as const) {
      const result = validateMarketEvent(provenanceEvent(provenance));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(isSyntheticEvent(result.value)).toBe(expectedSynthetic);
        expect(eventOrigin(result.value)).toBe(provenance.origin);
      }
    }
  });

  it('a synthetic event is a synthetic event even when it carries an adapter-style producer reference', () => {
    const simulatedWithProducer = { origin: 'simulated', adapter: { id: 'market-world-reactive', version: '2.0.0' }, derived_from: [], transform: null };
    const result = validateMarketEvent(provenanceEvent(simulatedWithProducer));
    expect(result.ok).toBe(true);
    if (result.ok) expect(isSyntheticEvent(result.value)).toBe(true);
  });
});

describe('provenance validation rules', () => {
  it('historical events REQUIRE an adapter reference', () => {
    const errors = validateProvenance({ origin: 'historical', adapter: null, derived_from: [], transform: null }, 'evt-1');
    expect(errors.map((e: MarketProtocolError) => e.code)).toContain('provenance_adapter_required');
  });

  it('simulated and generated events may omit the adapter', () => {
    expect(validateProvenance(SIMULATED, 'evt-1')).toEqual([]);
    expect(validateProvenance(GENERATED, 'evt-1')).toEqual([]);
  });

  it('derived events REQUIRE a transform and a lineage chain', () => {
    const derived = {
      origin: 'historical',
      adapter: { id: 'feature-adapter', version: '0.2.0' },
      derived_from: ['evt-0', 'evt-1'],
      transform: 'vwap-1m-aggregator',
    };
    expect(validateProvenance(derived, 'evt-2')).toEqual([]);

    const noTransform = { ...derived, transform: null };
    expect(validateProvenance(noTransform, 'evt-2').map((e: MarketProtocolError) => e.code)).toContain(
      'provenance_transform_required',
    );

    const orphanTransform = { origin: 'historical', adapter: HISTORICAL.adapter, derived_from: [], transform: 'vwap' };
    expect(validateProvenance(orphanTransform, 'evt-2').map((e: MarketProtocolError) => e.code)).toContain(
      'provenance_transform_without_parents',
    );
  });

  it('an event may not appear in its own lineage', () => {
    const selfRef = { origin: 'historical', adapter: HISTORICAL.adapter, derived_from: ['evt-2'], transform: 't' };
    expect(validateProvenance(selfRef, 'evt-2').map((e: MarketProtocolError) => e.code)).toContain(
      'provenance_self_reference',
    );
  });

  it('duplicate parents are rejected (a lineage chain is a set)', () => {
    const dup = { origin: 'historical', adapter: HISTORICAL.adapter, derived_from: ['evt-0', 'evt-0'], transform: 't' };
    expect(validateProvenance(dup, 'evt-2').map((e: MarketProtocolError) => e.code)).toContain(
      'provenance_duplicate_parent',
    );
  });

  it('unknown origins and malformed adapters are rejected', () => {
    expect(validateProvenance({ origin: 'dreamed', adapter: null, derived_from: [], transform: null }, 'e').length).toBeGreaterThan(0);
    expect(
      validateProvenance({ origin: 'historical', adapter: { id: '', version: '' }, derived_from: [], transform: null }, 'e').length,
    ).toBeGreaterThan(0);
  });
});

describe('isProvenance structural guard', () => {
  it('accepts well-formed provenance and rejects malformed', () => {
    expect(isProvenance(HISTORICAL)).toBe(true);
    expect(isProvenance(SIMULATED)).toBe(true);
    expect(isProvenance({ origin: 'historical', adapter: null, derived_from: [], transform: null })).toBe(false);
    expect(isProvenance({ origin: 'unknown', adapter: null, derived_from: [], transform: null })).toBe(false);
    expect(isProvenance({ origin: 'historical', adapter: HISTORICAL.adapter, derived_from: ['a'], transform: null })).toBe(false);
    expect(isProvenance(null)).toBe(false);
  });
});
