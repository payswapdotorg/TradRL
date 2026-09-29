/**
 * @tradrl/adapter-equities — the source descriptor's declaration tests.
 *
 * Behavioral: capability-card totality, immutability (deepFreeze), the
 * declared-capability helpers' verdicts, and the negative paths of the
 * collect-all validator.
 */

import { describe, expect, it } from 'vitest';

import {
  EQUITIES_SOURCE_DESCRIPTOR,
  EQUITIES_PROVIDER_ID,
  EQUITIES_VENUE,
  EQUITIES_ADAPTER,
  EQUITIES_CHANNELS,
  EQUITIES_EVENT_TYPES,
  validateSourceDescriptor,
  isSourceDescriptor,
  isDeclaredChannel,
  isDeclaredInstrument,
  isDeclaredEventType,
  declaredInstruments,
  isLatencyClass,
  type SourceDescriptor,
} from './index';

describe('EQUITIES_SOURCE_DESCRIPTOR declaration', () => {
  it('is a valid, frozen source descriptor', () => {
    expect(isSourceDescriptor(EQUITIES_SOURCE_DESCRIPTOR)).toBe(true);
    expect(Object.isFrozen(EQUITIES_SOURCE_DESCRIPTOR)).toBe(true);
    expect(Object.isFrozen(EQUITIES_SOURCE_DESCRIPTOR.capabilities)).toBe(true);
    expect(() => {
      (EQUITIES_SOURCE_DESCRIPTOR as unknown as Record<string, unknown>).provider = 'mutation';
    }).toThrow();
  });

  it('carries the licensed feed name in the opaque provider id (L2 inverse: HERE and only here)', () => {
    expect(EQUITIES_SOURCE_DESCRIPTOR.provider).toBe(EQUITIES_PROVIDER_ID);
    expect(EQUITIES_SOURCE_DESCRIPTOR.provider).toBe('licensed-index-a');
    expect(EQUITIES_SOURCE_DESCRIPTOR.category).toBe('market-data');
    expect(EQUITIES_SOURCE_DESCRIPTOR.capabilities.latency_class).toBe('near-realtime');
    expect(isLatencyClass(EQUITIES_SOURCE_DESCRIPTOR.capabilities.latency_class)).toBe(true);
  });

  it('declares exactly the documented feed record channels', () => {
    expect([...EQUITIES_SOURCE_DESCRIPTOR.capabilities.channels]).toEqual([
      'indexLevel',
      'constituentWeights',
      'corporateActions',
    ]);
    expect([...EQUITIES_CHANNELS]).toEqual([...EQUITIES_SOURCE_DESCRIPTOR.capabilities.channels]);
  });

  it('declares exactly the emittable canonical event types', () => {
    expect([...EQUITIES_SOURCE_DESCRIPTOR.capabilities.event_types]).toEqual(['fundamental', 'other']);
    expect([...EQUITIES_EVENT_TYPES]).toEqual([...EQUITIES_SOURCE_DESCRIPTOR.capabilities.event_types]);
  });

  it('declares index and equity symbol universes with canonical synthetic instrument ids', () => {
    const universes = EQUITIES_SOURCE_DESCRIPTOR.capabilities.symbol_universes;
    expect(universes.length).toBe(2);
    expect(universes[0].universe_id).toBe('index-series');
    expect(universes[0].asset_class).toBe('index');
    expect([...universes[0].instruments]).toEqual(['TEST-LARGECAP', 'TEST-MIDCAP']);
    expect(universes[1].asset_class).toBe('equity');
    expect([...declaredInstruments(EQUITIES_SOURCE_DESCRIPTOR)]).toContain('TEST-AAA');
    expect([...declaredInstruments(EQUITIES_SOURCE_DESCRIPTOR)]).toContain('TEST-BBB');
  });

  it('declared-capability helpers give the right verdicts (the envelope is enforced)', () => {
    expect(isDeclaredChannel(EQUITIES_SOURCE_DESCRIPTOR, 'indexLevel')).toBe(true);
    expect(isDeclaredChannel(EQUITIES_SOURCE_DESCRIPTOR, 'indexLevels')).toBe(false);
    expect(isDeclaredInstrument(EQUITIES_SOURCE_DESCRIPTOR, 'TEST-LARGECAP', 'index')).toBe(true);
    expect(isDeclaredInstrument(EQUITIES_SOURCE_DESCRIPTOR, 'TEST-LARGECAP', 'equity')).toBe(false);
    expect(isDeclaredInstrument(EQUITIES_SOURCE_DESCRIPTOR, 'TEST-AAA', 'equity')).toBe(true);
    expect(isDeclaredInstrument(EQUITIES_SOURCE_DESCRIPTOR, 'SPX', 'index')).toBe(false);
    expect(isDeclaredEventType(EQUITIES_SOURCE_DESCRIPTOR, 'fundamental')).toBe(true);
    expect(isDeclaredEventType(EQUITIES_SOURCE_DESCRIPTOR, 'other')).toBe(true);
    expect(isDeclaredEventType(EQUITIES_SOURCE_DESCRIPTOR, 'trade')).toBe(false);
  });

  it('the adapter identity is the lineage producer (L9)', () => {
    expect(EQUITIES_ADAPTER.id).toBe('adapter-equities');
    expect(EQUITIES_ADAPTER.version).toBe('0.0.0');
    expect(EQUITIES_VENUE).toBe('LICENSED-INDEX-A');
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
        channels: ['indexLevel', 'indexLevel'],
        symbol_universes: [{ universe_id: 'u', asset_class: 'index', instruments: [] }],
        event_types: ['fundamental', 'press-release'],
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
      provider: 'licensed-index-a',
      category: 'market-data',
      capabilities: {
        channels: ['indexLevel', 'constituentWeights', 'corporateActions'],
        symbol_universes: [
          { universe_id: 'index-series', asset_class: 'index', instruments: ['TEST-LARGECAP'] },
        ],
        event_types: ['fundamental', 'other'],
        latency_class: 'near-realtime',
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const value: SourceDescriptor = result.value;
      expect(Object.isFrozen(value)).toBe(true);
      expect(value.provider).toBe('licensed-index-a');
    }
  });
});
