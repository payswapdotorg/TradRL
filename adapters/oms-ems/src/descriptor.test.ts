/**
 * @tradrl/adapter-oms-ems — the source descriptor's declaration tests.
 *
 * Behavioral: capability-card totality, immutability (deepFreeze), the
 * declared-capability helpers' verdicts, and the negative paths of the
 * collect-all validator. The category is EXECUTION (the lane's family —
 * spec/ADAPTERS.md Execution).
 */

import { describe, expect, it } from 'vitest';

import {
  OMS_EMS_SOURCE_DESCRIPTOR,
  OMS_EMS_PROVIDER_ID,
  OMS_EMS_VENUE,
  OMS_EMS_ADAPTER,
  OMS_EMS_CHANNELS,
  OMS_EMS_EVENT_TYPES,
  validateSourceDescriptor,
  isSourceDescriptor,
  isDeclaredChannel,
  isDeclaredInstrument,
  isDeclaredEventType,
  declaredInstruments,
  isLatencyClass,
  type SourceDescriptor,
} from './index';

describe('OMS_EMS_SOURCE_DESCRIPTOR declaration', () => {
  it('is a valid, frozen source descriptor', () => {
    expect(isSourceDescriptor(OMS_EMS_SOURCE_DESCRIPTOR)).toBe(true);
    expect(Object.isFrozen(OMS_EMS_SOURCE_DESCRIPTOR)).toBe(true);
    expect(Object.isFrozen(OMS_EMS_SOURCE_DESCRIPTOR.capabilities)).toBe(true);
    expect(() => {
      (OMS_EMS_SOURCE_DESCRIPTOR as unknown as Record<string, unknown>).provider = 'mutation';
    }).toThrow();
  });

  it('carries the system name in the opaque provider id (L2 inverse: HERE and only here)', () => {
    expect(OMS_EMS_SOURCE_DESCRIPTOR.provider).toBe(OMS_EMS_PROVIDER_ID);
    expect(OMS_EMS_SOURCE_DESCRIPTOR.provider).toBe('oms-ems-gateway');
    expect(OMS_EMS_SOURCE_DESCRIPTOR.category).toBe('execution');
    expect(OMS_EMS_SOURCE_DESCRIPTOR.capabilities.latency_class).toBe('realtime');
    expect(isLatencyClass(OMS_EMS_SOURCE_DESCRIPTOR.capabilities.latency_class)).toBe(true);
  });

  it('declares exactly the documented gateway channels (order entry + order state)', () => {
    expect([...OMS_EMS_SOURCE_DESCRIPTOR.capabilities.channels]).toEqual([
      'routingInstruction',
      'orderState',
    ]);
    expect([...OMS_EMS_CHANNELS]).toEqual([...OMS_EMS_SOURCE_DESCRIPTOR.capabilities.channels]);
    expect(isDeclaredChannel(OMS_EMS_SOURCE_DESCRIPTOR, 'orderState')).toBe(true);
    expect(isDeclaredChannel(OMS_EMS_SOURCE_DESCRIPTOR, 'orderState2')).toBe(false);
  });

  it('declares exactly the emittable canonical event types (the typed escape hatch)', () => {
    expect([...OMS_EMS_SOURCE_DESCRIPTOR.capabilities.event_types]).toEqual(['other']);
    expect([...OMS_EMS_EVENT_TYPES]).toEqual([...OMS_EMS_SOURCE_DESCRIPTOR.capabilities.event_types]);
    expect(isDeclaredEventType(OMS_EMS_SOURCE_DESCRIPTOR, 'other')).toBe(true);
    expect(isDeclaredEventType(OMS_EMS_SOURCE_DESCRIPTOR, 'trade')).toBe(false);
  });

  it('declares the crypto spot symbol universes (the execution lane\'s reference instruments)', () => {
    const instruments = declaredInstruments(OMS_EMS_SOURCE_DESCRIPTOR);
    expect(instruments).toContain('BTC-USDT');
    expect(instruments).toContain('ETH-USDT');
    expect(instruments).toContain('SOL-USDT');
    expect(isDeclaredInstrument(OMS_EMS_SOURCE_DESCRIPTOR, 'BTC-USDT', 'crypto')).toBe(true);
    expect(isDeclaredInstrument(OMS_EMS_SOURCE_DESCRIPTOR, 'BTC-USDT', 'equity')).toBe(false);
    expect(isDeclaredInstrument(OMS_EMS_SOURCE_DESCRIPTOR, 'DOGE-USDT', 'crypto')).toBe(false);
  });

  it('the adapter identity is the lineage producer (L9)', () => {
    expect(OMS_EMS_ADAPTER.id).toBe('adapter-oms-ems');
    expect(OMS_EMS_ADAPTER.version).toBe('0.0.0');
    expect(OMS_EMS_VENUE).toBe('OMS-EMS');
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
    const witness: SourceDescriptor = OMS_EMS_SOURCE_DESCRIPTOR;
    expect(witness.provider).toBe('oms-ems-gateway');
  });
});
