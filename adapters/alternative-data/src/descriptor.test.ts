/**
 * @tradrl/adapter-alternative-data — the source descriptor's declaration tests.
 *
 * Behavioral: capability-card totality, immutability (deepFreeze), the
 * declared-capability helpers' verdicts, and the negative paths of the
 * collect-all validator.
 */

import { describe, expect, it } from 'vitest';

import {
  ALTDATA_SOURCE_DESCRIPTOR,
  ALTDATA_PROVIDER_ID,
  ALTDATA_VENUE,
  ALTDATA_ADAPTER,
  ALTDATA_CHANNELS,
  ALTDATA_EVENT_TYPES,
  validateSourceDescriptor,
  isSourceDescriptor,
  isDeclaredChannel,
  isDeclaredInstrument,
  isDeclaredEventType,
  declaredInstruments,
  isLatencyClass,
  type SourceDescriptor,
} from './index';

describe('ALTDATA_SOURCE_DESCRIPTOR declaration', () => {
  it('is a valid, frozen source descriptor', () => {
    expect(isSourceDescriptor(ALTDATA_SOURCE_DESCRIPTOR)).toBe(true);
    expect(Object.isFrozen(ALTDATA_SOURCE_DESCRIPTOR)).toBe(true);
    expect(Object.isFrozen(ALTDATA_SOURCE_DESCRIPTOR.capabilities)).toBe(true);
    expect(() => {
      (ALTDATA_SOURCE_DESCRIPTOR as unknown as Record<string, unknown>).provider = 'mutation';
    }).toThrow();
  });

  it('carries the vendor name in the opaque provider id (L2 inverse: HERE and only here)', () => {
    expect(ALTDATA_SOURCE_DESCRIPTOR.provider).toBe(ALTDATA_PROVIDER_ID);
    expect(ALTDATA_SOURCE_DESCRIPTOR.provider).toBe('alt-vendor-a');
    expect(ALTDATA_SOURCE_DESCRIPTOR.category).toBe('market-data');
    expect(ALTDATA_SOURCE_DESCRIPTOR.capabilities.latency_class).toBe('batch'); // alternative data is released on schedules
    expect(isLatencyClass(ALTDATA_SOURCE_DESCRIPTOR.capabilities.latency_class)).toBe(true);
  });

  it('declares exactly the documented observation channels', () => {
    expect([...ALTDATA_SOURCE_DESCRIPTOR.capabilities.channels]).toEqual([
      'sentiment',
      'onChain',
      'economicSeries',
      'satelliteSeries',
    ]);
    expect([...ALTDATA_CHANNELS]).toEqual([...ALTDATA_SOURCE_DESCRIPTOR.capabilities.channels]);
  });

  it('declares exactly the emittable canonical event types', () => {
    expect([...ALTDATA_SOURCE_DESCRIPTOR.capabilities.event_types]).toEqual([
      'social_signal',
      'macro_release',
      'fundamental',
    ]);
    expect([...ALTDATA_EVENT_TYPES]).toEqual([...ALTDATA_SOURCE_DESCRIPTOR.capabilities.event_types]);
  });

  it('declares four asset-class symbol universes with canonical synthetic instrument ids', () => {
    const universes = ALTDATA_SOURCE_DESCRIPTOR.capabilities.symbol_universes;
    expect(universes.length).toBe(4);
    expect(universes[0].universe_id).toBe('equity-sentiment-symbols');
    expect(universes[0].asset_class).toBe('equity');
    expect(universes[1].asset_class).toBe('crypto');
    expect([...universes[1].instruments]).toEqual(['TEST-CHAIN-A', 'TEST-CHAIN-B']);
    expect(universes[2].asset_class).toBe('macro');
    expect(universes[3].asset_class).toBe('commodity');
    expect([...declaredInstruments(ALTDATA_SOURCE_DESCRIPTOR)]).toContain('TEST-AAA');
    expect([...declaredInstruments(ALTDATA_SOURCE_DESCRIPTOR)]).toContain('TEST-ECON-CPI');
    expect([...declaredInstruments(ALTDATA_SOURCE_DESCRIPTOR)]).toContain('TEST-SAT-OIL');
  });

  it('declared-capability helpers give the right verdicts (the envelope is enforced)', () => {
    expect(isDeclaredChannel(ALTDATA_SOURCE_DESCRIPTOR, 'onChain')).toBe(true);
    expect(isDeclaredChannel(ALTDATA_SOURCE_DESCRIPTOR, 'weather')).toBe(false);
    expect(isDeclaredInstrument(ALTDATA_SOURCE_DESCRIPTOR, 'TEST-AAA', 'equity')).toBe(true);
    expect(isDeclaredInstrument(ALTDATA_SOURCE_DESCRIPTOR, 'TEST-CHAIN-A', 'crypto')).toBe(true);
    expect(isDeclaredInstrument(ALTDATA_SOURCE_DESCRIPTOR, 'TEST-CHAIN-A', 'equity')).toBe(false);
    expect(isDeclaredInstrument(ALTDATA_SOURCE_DESCRIPTOR, 'BTC', 'crypto')).toBe(false);
    expect(isDeclaredEventType(ALTDATA_SOURCE_DESCRIPTOR, 'social_signal')).toBe(true);
    expect(isDeclaredEventType(ALTDATA_SOURCE_DESCRIPTOR, 'macro_release')).toBe(true);
    expect(isDeclaredEventType(ALTDATA_SOURCE_DESCRIPTOR, 'fundamental')).toBe(true);
    expect(isDeclaredEventType(ALTDATA_SOURCE_DESCRIPTOR, 'news')).toBe(false);
  });

  it('the adapter identity is the lineage producer (L9)', () => {
    expect(ALTDATA_ADAPTER.id).toBe('adapter-alternative-data');
    expect(ALTDATA_ADAPTER.version).toBe('0.0.0');
    expect(ALTDATA_VENUE).toBe('ALT-VENDOR-A');
  });
});

describe('validateSourceDescriptor negative paths (collect-all)', () => {
  it('rejects a non-object', () => {
    const result = validateSourceDescriptor(42);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
  });

  it('collects every violation at once (missing provider, bad category, bad capabilities)', () => {
    const result = validateSourceDescriptor({
      category: 'sentiment-ml',
      capabilities: { channels: [], symbol_universes: [], event_types: ['vibes'] },
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
        channels: ['sentiment', 'sentiment'],
        symbol_universes: [{ universe_id: 'u', asset_class: 'equity', instruments: [] }],
        event_types: ['social_signal', 'hype_index'],
        latency_class: 'eventually',
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
      provider: 'alt-vendor-a',
      category: 'market-data',
      capabilities: {
        channels: ['sentiment', 'onChain', 'economicSeries', 'satelliteSeries'],
        symbol_universes: [
          { universe_id: 'u1', asset_class: 'equity', instruments: ['TEST-AAA'] },
        ],
        event_types: ['social_signal', 'macro_release', 'fundamental'],
        latency_class: 'batch',
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const value: SourceDescriptor = result.value;
      expect(Object.isFrozen(value)).toBe(true);
      expect(value.provider).toBe('alt-vendor-a');
    }
  });
});
