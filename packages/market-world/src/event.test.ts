/**
 * @tradrl/market-world — WorldEvent envelope mirror tests.
 *
 * Covers the mirrored validation laws: the availability quartet (only
 * `available_time >= event_time` is enforced — D-003), the `other`-payload
 * floor (kind + data), the provenance rules (origin trichotomy, adapter
 * required for historical, transform/lineage coherence, self-reference,
 * duplicate parents), the whole-envelope JSON law (the documented replay
 * divergence), and collect-all diagnostics.
 */

import { describe, expect, it } from 'vitest';

import { isWorldEvent, sequenceKeyOf, sequenceStream, validateWorldEvent } from './index';

const T0 = 1_700_000_000_000;

/** A minimal, fully valid historical trade event (untrusted input shape). */
function tradeFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: 'evt-1',
    venue: 'BINANCE',
    instrument: 'BTC-USDT',
    asset_class: 'crypto',
    event_type: 'trade',
    event_time: T0,
    source_time: T0,
    available_time: T0 + 40,
    ingestion_time: T0 + 100,
    sequence: 1,
    provider: 'binance',
    provenance: { origin: 'historical', adapter: { id: 'binance-adapter', version: '1.4.0' }, derived_from: [], transform: null },
    payload: { price: '43125.10', size: '0.017', side: 'buy' },
    ...overrides,
  };
}

describe('validateWorldEvent — the valid floor', () => {
  it('accepts a canonical historical trade and freezes it', () => {
    const result = validateWorldEvent(tradeFixture());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.event_id).toBe('evt-1');
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(isWorldEvent(tradeFixture())).toBe(true);
  });

  it('tolerates excess JSON fields (forward-compatible floor)', () => {
    const result = validateWorldEvent(tradeFixture({ vendor_extra: { depth: 3 } }));
    expect(result.ok).toBe(true);
  });

  it('accepts a future-dated available_time (validation is timeless — embargo is the boundary\'s job)', () => {
    const result = validateWorldEvent(tradeFixture({ available_time: T0 + 86_400_000 }));
    expect(result.ok).toBe(true);
  });

  it('accepts embargoed ordering: ingestion_time < available_time (deliberately unordered, D-003)', () => {
    const result = validateWorldEvent(tradeFixture({ available_time: T0 + 500, ingestion_time: T0 + 10 }));
    expect(result.ok).toBe(true);
  });

  it('accepts null source_time', () => {
    const result = validateWorldEvent(tradeFixture({ source_time: null }));
    expect(result.ok).toBe(true);
  });
});

describe('validateWorldEvent — the availability quartet', () => {
  it('rejects available_time < event_time (timestamp order, D-003)', () => {
    const result = validateWorldEvent(tradeFixture({ event_time: T0 + 41, available_time: T0 + 40 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const ordering = result.errors.find((error) => error.path === 'event.available_time');
    expect(ordering).toBeDefined();
    expect(ordering?.message).toContain('precedes event_time');
  });

  it('accepts available_time == event_time (inclusive)', () => {
    expect(validateWorldEvent(tradeFixture({ event_time: T0, available_time: T0 })).ok).toBe(true);
  });

  it('collects every missing quartet field', () => {
    const partial = tradeFixture();
    delete partial.event_time;
    delete partial.available_time;
    delete partial.ingestion_time;
    const result = validateWorldEvent(partial);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const paths = result.errors.map((error) => error.path);
    expect(paths).toContain('event.event_time');
    expect(paths).toContain('event.available_time');
    expect(paths).toContain('event.ingestion_time');
  });
});

describe('validateWorldEvent — identifiers, taxonomy, sequence', () => {
  it('rejects empty identifiers and unknown event types / asset classes', () => {
    expect(validateWorldEvent(tradeFixture({ venue: '' })).ok).toBe(false);
    expect(validateWorldEvent(tradeFixture({ event_type: 'flash_crash' })).ok).toBe(false);
    expect(validateWorldEvent(tradeFixture({ asset_class: 'nft' })).ok).toBe(false);
    expect(validateWorldEvent(tradeFixture({ sequence: -1 })).ok).toBe(false);
    expect(validateWorldEvent(tradeFixture({ sequence: 1.5 })).ok).toBe(false);
  });
});

describe('validateWorldEvent — the other-payload floor', () => {
  it('requires a non-empty kind and a JSON-object data on other events', () => {
    const base = { event_type: 'other', payload: { kind: 'vwap_1m', data: { window_ms: 60_000 } } };
    expect(validateWorldEvent(tradeFixture(base)).ok).toBe(true);
    expect(validateWorldEvent(tradeFixture({ event_type: 'other', payload: { data: {} } })).ok).toBe(false);
    expect(validateWorldEvent(tradeFixture({ event_type: 'other', payload: { kind: '', data: {} } })).ok).toBe(false);
    expect(validateWorldEvent(tradeFixture({ event_type: 'other', payload: { kind: 'vwap_1m' } })).ok).toBe(false);
    expect(validateWorldEvent(tradeFixture({ event_type: 'other', payload: 'vwap' })).ok).toBe(false);
  });
});

describe('validateWorldEvent — provenance rules (mirror of market-protocol)', () => {
  it('rejects an unknown origin', () => {
    const result = validateWorldEvent(tradeFixture({ provenance: { origin: 'rumored', adapter: null, derived_from: [], transform: null } }));
    expect(result.ok).toBe(false);
  });

  it('rejects a historical event without an adapter reference (no orphan history)', () => {
    const result = validateWorldEvent(tradeFixture({ provenance: { origin: 'historical', adapter: null, derived_from: [], transform: null } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.path === 'event.provenance.adapter')).toBe(true);
  });

  it('rejects derived lineage without a transform, and a transform without lineage', () => {
    const derivedNoTransform = { origin: 'historical', adapter: { id: 'agg', version: '1' }, derived_from: ['evt-0'], transform: null };
    const primitiveWithTransform = { origin: 'historical', adapter: { id: 'agg', version: '1' }, derived_from: [], transform: 'vwap' };
    expect(validateWorldEvent(tradeFixture({ provenance: derivedNoTransform })).ok).toBe(false);
    expect(validateWorldEvent(tradeFixture({ provenance: primitiveWithTransform })).ok).toBe(false);
  });

  it('accepts a derived historical event WITH transform and lineage (the derived-observation fixture shape)', () => {
    const derived = { origin: 'historical', adapter: { id: 'agg', version: '1' }, derived_from: ['evt-a', 'evt-b'], transform: 'vwap-1m-aggregator' };
    const result = validateWorldEvent(tradeFixture({ provenance: derived }));
    expect(result.ok).toBe(true);
  });

  it('rejects self-referencing and duplicate lineage parents', () => {
    const selfRef = { origin: 'historical', adapter: { id: 'agg', version: '1' }, derived_from: ['evt-1'], transform: 't' };
    const dup = { origin: 'historical', adapter: { id: 'agg', version: '1' }, derived_from: ['evt-a', 'evt-a'], transform: 't' };
    expect(validateWorldEvent(tradeFixture({ provenance: selfRef })).ok).toBe(false);
    expect(validateWorldEvent(tradeFixture({ provenance: dup })).ok).toBe(false);
  });

  it('accepts simulated/generated origins at the ENVELOPE level (withholding them is the world-level L5 law, not the validator\'s)', () => {
    const simulated = { origin: 'simulated', adapter: null, derived_from: [], transform: null };
    const generated = { origin: 'generated', adapter: { id: 'gen', version: '1' }, derived_from: [], transform: null };
    expect(validateWorldEvent(tradeFixture({ provenance: simulated })).ok).toBe(true);
    expect(validateWorldEvent(tradeFixture({ provenance: generated })).ok).toBe(true);
  });
});

describe('validateWorldEvent — the whole-envelope JSON law (documented replay divergence)', () => {
  it('rejects an envelope carrying a non-JSON excess field', () => {
    const poisoned = tradeFixture();
    (poisoned as Record<string, unknown>).surprise = () => 'not JSON';
    const result = validateWorldEvent(poisoned);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.message.includes('JSON value'))).toBe(true);
  });
});

describe('sequence stream keys (mirror of market-protocol discipline)', () => {
  it('scopes keys by venue|instrument|stream, with other-events qualified by kind', () => {
    const trade = validateWorldEvent(tradeFixture());
    if (!trade.ok) throw new Error('fixture');
    expect(sequenceStream(trade.value)).toBe('trade');
    expect(sequenceKeyOf(trade.value)).toBe('BINANCE|BTC-USDT|trade');

    const other = validateWorldEvent(
      tradeFixture({ event_id: 'evt-2', event_type: 'other', payload: { kind: 'vwap_1m', data: {} } }),
    );
    if (!other.ok) throw new Error('fixture');
    expect(sequenceStream(other.value)).toBe('other:vwap_1m');
    expect(sequenceKeyOf(other.value)).toBe('BINANCE|BTC-USDT|other:vwap_1m');
  });

  it('different venues/instruments never share a sequence scope', () => {
    const a = validateWorldEvent(tradeFixture({ event_id: 'a', venue: 'XNAS' }));
    const b = validateWorldEvent(tradeFixture({ event_id: 'b', instrument: 'ETH-USDT' }));
    if (!a.ok || !b.ok) throw new Error('fixture');
    expect(sequenceKeyOf(a.value)).not.toBe(sequenceKeyOf(b.value));
  });
});
