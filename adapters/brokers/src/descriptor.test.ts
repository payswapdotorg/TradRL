/**
 * @tradrl/adapter-brokers — the source descriptor's declaration tests.
 *
 * Behavioral: capability-card totality, immutability (deepFreeze), the
 * declared-capability helpers' verdicts, and the negative paths of the
 * collect-all validator. The category is EXECUTION (the lane's family —
 * spec/ADAPTERS.md Execution).
 */

import { describe, expect, it } from 'vitest';

import {
  BROKER_SOURCE_DESCRIPTOR,
  BROKER_PROVIDER_ID,
  BROKER_VENUE,
  BROKER_ADAPTER,
  BROKER_CHANNELS,
  BROKER_EVENT_TYPES,
  validateSourceDescriptor,
  isSourceDescriptor,
  isDeclaredChannel,
  isDeclaredInstrument,
  isDeclaredEventType,
  declaredInstruments,
  isLatencyClass,
  type SourceDescriptor,
} from './index';

describe('BROKER_SOURCE_DESCRIPTOR declaration', () => {
  it('is a valid, frozen source descriptor', () => {
    expect(isSourceDescriptor(BROKER_SOURCE_DESCRIPTOR)).toBe(true);
    expect(Object.isFrozen(BROKER_SOURCE_DESCRIPTOR)).toBe(true);
    expect(Object.isFrozen(BROKER_SOURCE_DESCRIPTOR.capabilities)).toBe(true);
    expect(() => {
      (BROKER_SOURCE_DESCRIPTOR as unknown as Record<string, unknown>).provider = 'mutation';
    }).toThrow();
  });

  it('carries the broker protocol name in the opaque provider id (L2 inverse: HERE and only here)', () => {
    expect(BROKER_SOURCE_DESCRIPTOR.provider).toBe(BROKER_PROVIDER_ID);
    expect(BROKER_SOURCE_DESCRIPTOR.provider).toBe('fix-broker-gateway');
    expect(BROKER_SOURCE_DESCRIPTOR.category).toBe('execution');
    expect(BROKER_SOURCE_DESCRIPTOR.capabilities.latency_class).toBe('realtime');
    expect(isLatencyClass(BROKER_SOURCE_DESCRIPTOR.capabilities.latency_class)).toBe(true);
  });

  it('declares exactly the documented gateway channels (order entry + execution reporting)', () => {
    expect([...BROKER_SOURCE_DESCRIPTOR.capabilities.channels]).toEqual([
      'newOrderSingle',
      'executionReport',
    ]);
    expect([...BROKER_CHANNELS]).toEqual([...BROKER_SOURCE_DESCRIPTOR.capabilities.channels]);
    expect(isDeclaredChannel(BROKER_SOURCE_DESCRIPTOR, 'executionReport')).toBe(true);
    expect(isDeclaredChannel(BROKER_SOURCE_DESCRIPTOR, 'executionReport2')).toBe(false);
  });

  it('declares exactly the emittable canonical event types (the typed escape hatch)', () => {
    expect([...BROKER_SOURCE_DESCRIPTOR.capabilities.event_types]).toEqual(['other']);
    expect([...BROKER_EVENT_TYPES]).toEqual([...BROKER_SOURCE_DESCRIPTOR.capabilities.event_types]);
    expect(isDeclaredEventType(BROKER_SOURCE_DESCRIPTOR, 'other')).toBe(true);
    expect(isDeclaredEventType(BROKER_SOURCE_DESCRIPTOR, 'trade')).toBe(false);
  });

  it('declares the crypto spot symbol universes (the execution lane\'s reference instruments)', () => {
    const instruments = declaredInstruments(BROKER_SOURCE_DESCRIPTOR);
    expect(instruments).toContain('BTC-USDT');
    expect(instruments).toContain('ETH-USDT');
    expect(instruments).toContain('SOL-USDT');
    expect(isDeclaredInstrument(BROKER_SOURCE_DESCRIPTOR, 'BTC-USDT', 'crypto')).toBe(true);
    expect(isDeclaredInstrument(BROKER_SOURCE_DESCRIPTOR, 'BTC-USDT', 'equity')).toBe(false);
    expect(isDeclaredInstrument(BROKER_SOURCE_DESCRIPTOR, 'DOGE-USDT', 'crypto')).toBe(false);
  });

  it('the adapter identity is the lineage producer (L9)', () => {
    expect(BROKER_ADAPTER.id).toBe('adapter-brokers');
    expect(BROKER_ADAPTER.version).toBe('0.0.0');
    expect(BROKER_VENUE).toBe('BROKER-FIX');
  });

  it('collect-all rejects malformed descriptors (the negative paths)', () => {
    const invalid = [
      {},
      { provider: '', category: 'execution' },
      { provider: 'x', category: 'executions' },
      { provider: 'x', category: 'execution', capabilities: {} },
      {
        provider: 'x',
        category: 'execution',
        capabilities: { channels: [], symbol_universes: [], event_types: [], latency_class: 'instantaneous' },
      },
      {
        provider: 'x',
        category: 'execution',
        capabilities: {
          channels: ['a', 'a'],
          symbol_universes: [{ universe_id: 'u', asset_class: 'crypto', instruments: ['X'] }],
          event_types: ['other'],
          latency_class: 'realtime',
        },
      },
    ];
    for (const value of invalid) {
      const result = validateSourceDescriptor(value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
    }
    const valid = validateSourceDescriptor({
      provider: 'x',
      category: 'execution',
      capabilities: {
        channels: ['c'],
        symbol_universes: [{ universe_id: 'u', asset_class: 'crypto', instruments: ['X'] }],
        event_types: ['other'],
        latency_class: 'realtime',
      },
    });
    expect(valid.ok).toBe(true);
    if (valid.ok) expect(Object.isFrozen(valid.value)).toBe(true);
  });

  it('the descriptor type mirror is structurally the SDK\'s (compile-time witness)', () => {
    const witness: SourceDescriptor = BROKER_SOURCE_DESCRIPTOR;
    expect(witness.provider).toBe('fix-broker-gateway');
  });
});
