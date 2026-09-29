/**
 * @tradrl/adapter-coinbase — the source descriptor's declaration tests.
 *
 * Behavioral: capability-card totality, immutability (deepFreeze), the
 * declared-capability helpers' verdicts, and the negative paths of the
 * collect-all validator.
 */

import { describe, expect, it } from 'vitest';

import {
  COINBASE_SOURCE_DESCRIPTOR,
  COINBASE_PROVIDER_ID,
  COINBASE_VENUE,
  COINBASE_ADAPTER,
  COINBASE_EVENT_TYPES,
  validateSourceDescriptor,
  isSourceDescriptor,
  isDeclaredChannel,
  isDeclaredInstrument,
  isDeclaredEventType,
  declaredInstruments,
  type SourceDescriptor,
} from './index';

describe('COINBASE_SOURCE_DESCRIPTOR declaration', () => {
  it('is a valid, frozen source descriptor', () => {
    expect(isSourceDescriptor(COINBASE_SOURCE_DESCRIPTOR)).toBe(true);
    expect(Object.isFrozen(COINBASE_SOURCE_DESCRIPTOR)).toBe(true);
    expect(Object.isFrozen(COINBASE_SOURCE_DESCRIPTOR.capabilities)).toBe(true);
    expect(() => {
      (COINBASE_SOURCE_DESCRIPTOR as unknown as Record<string, unknown>).provider = 'mutation';
    }).toThrow();
  });

  it('carries the exchange name in the opaque provider id (L2 inverse: HERE and only here)', () => {
    expect(COINBASE_SOURCE_DESCRIPTOR.provider).toBe(COINBASE_PROVIDER_ID);
    expect(COINBASE_SOURCE_DESCRIPTOR.provider).toBe('coinbase');
    expect(COINBASE_SOURCE_DESCRIPTOR.category).toBe('market-data');
    expect(COINBASE_SOURCE_DESCRIPTOR.capabilities.latency_class).toBe('realtime');
  });

  it('declares exactly the documented channels (level2_batch, ticker, match)', () => {
    expect([...COINBASE_SOURCE_DESCRIPTOR.capabilities.channels]).toEqual(['level2_batch', 'ticker', 'match']);
  });

  it('declares exactly the emittable canonical event types', () => {
    expect([...COINBASE_SOURCE_DESCRIPTOR.capabilities.event_types]).toEqual(['trade', 'quote', 'book_snapshot']);
    expect([...COINBASE_EVENT_TYPES]).toEqual([...COINBASE_SOURCE_DESCRIPTOR.capabilities.event_types]);
  });

  it('declares crypto symbol universes with canonical product ids', () => {
    const universes = COINBASE_SOURCE_DESCRIPTOR.capabilities.symbol_universes;
    expect(universes.length).toBe(2);
    expect(universes[0].universe_id).toBe('spot-major');
    expect(universes[0].asset_class).toBe('crypto');
    expect([...universes[0].instruments]).toEqual(['BTC-USD', 'ETH-USD']);
    expect([...declaredInstruments(COINBASE_SOURCE_DESCRIPTOR)]).toContain('SOL-USD');
  });

  it('declared-capability helpers give the right verdicts (the envelope is enforced)', () => {
    expect(isDeclaredChannel(COINBASE_SOURCE_DESCRIPTOR, 'match')).toBe(true);
    expect(isDeclaredChannel(COINBASE_SOURCE_DESCRIPTOR, 'full')).toBe(false);
    expect(isDeclaredInstrument(COINBASE_SOURCE_DESCRIPTOR, 'BTC-USD', 'crypto')).toBe(true);
    expect(isDeclaredInstrument(COINBASE_SOURCE_DESCRIPTOR, 'BTC-USDT', 'crypto')).toBe(false);
    expect(isDeclaredInstrument(COINBASE_SOURCE_DESCRIPTOR, 'BTC-USD', 'equity')).toBe(false);
    expect(isDeclaredEventType(COINBASE_SOURCE_DESCRIPTOR, 'quote')).toBe(true);
    expect(isDeclaredEventType(COINBASE_SOURCE_DESCRIPTOR, 'book_delta')).toBe(false);
  });

  it('the adapter identity is the lineage producer (L9)', () => {
    expect(COINBASE_ADAPTER.id).toBe('adapter-coinbase');
    expect(COINBASE_ADAPTER.version).toBe('0.0.0');
    expect(COINBASE_VENUE).toBe('COINBASE');
  });
});

describe('validateSourceDescriptor negative paths (collect-all)', () => {
  it('rejects a non-object', () => {
    const result = validateSourceDescriptor(42);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
  });

  it('collects every violation at once', () => {
    const result = validateSourceDescriptor({
      category: 'magic-data',
      capabilities: { channels: [], symbol_universes: [], event_types: ['nope'] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.errors.map((error) => error.path).sort();
      expect(paths).toContain('provider');
      expect(paths).toContain('category');
      expect(paths.some((path) => path.startsWith('capabilities.channels'))).toBe(true);
      expect(paths.some((path) => path.startsWith('capabilities.symbol_universes'))).toBe(true);
      expect(paths.some((path) => path.startsWith('capabilities.event_types'))).toBe(true);
    }
  });

  it('rejects duplicate universes, duplicate instruments and non-canonical event types', () => {
    const result = validateSourceDescriptor({
      provider: 'x',
      category: 'market-data',
      capabilities: {
        channels: ['ticker'],
        symbol_universes: [
          { universe_id: 'u', asset_class: 'crypto', instruments: ['BTC-USD', 'BTC-USD'] },
          { universe_id: 'u', asset_class: 'crypto', instruments: ['ETH-USD'] },
        ],
        event_types: ['quote', 'bookdelta'],
        latency_class: 'instantaneous',
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const messages = result.errors.map((error) => error.message).join('; ');
      expect(messages).toContain('duplicate universe id');
      expect(messages).toContain('duplicate instrument id');
      expect(messages).toContain('is not a canonical event type');
      expect(messages).toContain('latency_class');
    }
  });

  it('round-trips a full valid declaration (validated and frozen)', () => {
    const result = validateSourceDescriptor({
      provider: 'coinbase',
      category: 'market-data',
      capabilities: {
        channels: ['level2_batch', 'ticker', 'match'],
        symbol_universes: [{ universe_id: 'spot-major', asset_class: 'crypto', instruments: ['BTC-USD'] }],
        event_types: ['trade', 'quote', 'book_snapshot'],
        latency_class: 'realtime',
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const value: SourceDescriptor = result.value;
      expect(Object.isFrozen(value)).toBe(true);
      expect(value.provider).toBe('coinbase');
    }
  });
});
