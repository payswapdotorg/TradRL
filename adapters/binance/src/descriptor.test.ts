/**
 * @tradrl/adapter-binance — the source descriptor's declaration tests.
 *
 * Behavioral: capability-card totality, immutability (deepFreeze), the
 * declared-capability helpers' verdicts, and the negative paths of the
 * collect-all validator.
 */

import { describe, expect, it } from 'vitest';

import {
  BINANCE_SOURCE_DESCRIPTOR,
  BINANCE_PROVIDER_ID,
  BINANCE_VENUE,
  BINANCE_ADAPTER,
  BINANCE_CHANNELS,
  BINANCE_EVENT_TYPES,
  validateSourceDescriptor,
  isSourceDescriptor,
  isDeclaredChannel,
  isDeclaredInstrument,
  isDeclaredEventType,
  declaredInstruments,
  isLatencyClass,
  type SourceDescriptor,
} from './index';

describe('BINANCE_SOURCE_DESCRIPTOR declaration', () => {
  it('is a valid, frozen source descriptor', () => {
    expect(isSourceDescriptor(BINANCE_SOURCE_DESCRIPTOR)).toBe(true);
    expect(Object.isFrozen(BINANCE_SOURCE_DESCRIPTOR)).toBe(true);
    expect(Object.isFrozen(BINANCE_SOURCE_DESCRIPTOR.capabilities)).toBe(true);
    expect(() => {
      (BINANCE_SOURCE_DESCRIPTOR as unknown as Record<string, unknown>).provider = 'mutation';
    }).toThrow();
  });

  it('carries the exchange name in the opaque provider id (L2 inverse: HERE and only here)', () => {
    expect(BINANCE_SOURCE_DESCRIPTOR.provider).toBe(BINANCE_PROVIDER_ID);
    expect(BINANCE_SOURCE_DESCRIPTOR.provider).toBe('binance');
    expect(BINANCE_SOURCE_DESCRIPTOR.category).toBe('market-data');
    expect(BINANCE_SOURCE_DESCRIPTOR.capabilities.latency_class).toBe('realtime');
    expect(isLatencyClass(BINANCE_SOURCE_DESCRIPTOR.capabilities.latency_class)).toBe(true);
  });

  it('declares exactly the documented spot stream channels', () => {
    expect([...BINANCE_SOURCE_DESCRIPTOR.capabilities.channels]).toEqual([
      'depth',
      'depthDiff',
      'bookTicker',
      'trade',
    ]);
    expect([...BINANCE_CHANNELS]).toEqual([...BINANCE_SOURCE_DESCRIPTOR.capabilities.channels]);
  });

  it('declares exactly the emittable canonical event types', () => {
    expect([...BINANCE_SOURCE_DESCRIPTOR.capabilities.event_types]).toEqual([
      'trade',
      'quote',
      'book_snapshot',
      'book_delta',
    ]);
    expect([...BINANCE_EVENT_TYPES]).toEqual([...BINANCE_SOURCE_DESCRIPTOR.capabilities.event_types]);
  });

  it('declares crypto symbol universes with canonical instrument ids', () => {
    const universes = BINANCE_SOURCE_DESCRIPTOR.capabilities.symbol_universes;
    expect(universes.length).toBe(2);
    expect(universes[0].universe_id).toBe('spot-major');
    expect(universes[0].asset_class).toBe('crypto');
    expect([...universes[0].instruments]).toEqual(['BTC-USDT', 'ETH-USDT']);
    expect([...declaredInstruments(BINANCE_SOURCE_DESCRIPTOR)]).toContain('SOL-USDT');
  });

  it('declared-capability helpers give the right verdicts (the envelope is enforced)', () => {
    expect(isDeclaredChannel(BINANCE_SOURCE_DESCRIPTOR, 'trade')).toBe(true);
    expect(isDeclaredChannel(BINANCE_SOURCE_DESCRIPTOR, 'kline')).toBe(false);
    expect(isDeclaredInstrument(BINANCE_SOURCE_DESCRIPTOR, 'BTC-USDT', 'crypto')).toBe(true);
    expect(isDeclaredInstrument(BINANCE_SOURCE_DESCRIPTOR, 'BTC-USD', 'crypto')).toBe(false);
    expect(isDeclaredInstrument(BINANCE_SOURCE_DESCRIPTOR, 'BTC-USDT', 'equity')).toBe(false);
    expect(isDeclaredEventType(BINANCE_SOURCE_DESCRIPTOR, 'trade')).toBe(true);
    expect(isDeclaredEventType(BINANCE_SOURCE_DESCRIPTOR, 'news')).toBe(false);
  });

  it('the adapter identity is the lineage producer (L9)', () => {
    expect(BINANCE_ADAPTER.id).toBe('adapter-binance');
    expect(BINANCE_ADAPTER.version).toBe('0.0.0');
    expect(BINANCE_VENUE).toBe('BINANCE');
  });
});

describe('validateSourceDescriptor negative paths (collect-all)', () => {
  it('rejects a non-object', () => {
    const result = validateSourceDescriptor(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
  });

  it('collects every violation at once (missing provider, bad category, bad capabilities)', () => {
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

  it('rejects duplicate channels, empty instruments and non-canonical event types', () => {
    const result = validateSourceDescriptor({
      provider: 'x',
      category: 'market-data',
      capabilities: {
        channels: ['trade', 'trade'],
        symbol_universes: [{ universe_id: 'u', asset_class: 'crypto', instruments: [] }],
        event_types: ['trade', 'press-release'],
        latency_class: 'instantaneous',
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const messages = result.errors.map((error) => error.message).join('; ');
      expect(messages).toContain('duplicate channel name');
      expect(messages).toContain('must not be empty');
      expect(messages).toContain('is not a canonical event type');
      expect(messages).toContain('latency_class');
    }
  });

  it('round-trips a full valid declaration (validated and frozen)', () => {
    const result = validateSourceDescriptor({
      provider: 'binance',
      category: 'market-data',
      capabilities: {
        channels: ['depth', 'depthDiff', 'bookTicker', 'trade'],
        symbol_universes: [
          { universe_id: 'spot-major', asset_class: 'crypto', instruments: ['BTC-USDT', 'ETH-USDT'] },
        ],
        event_types: ['trade', 'quote', 'book_snapshot', 'book_delta'],
        latency_class: 'realtime',
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const value: SourceDescriptor = result.value;
      expect(Object.isFrozen(value)).toBe(true);
      expect(value.provider).toBe('binance');
    }
  });
});
