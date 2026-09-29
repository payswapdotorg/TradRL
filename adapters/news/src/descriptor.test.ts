/**
 * @tradrl/adapter-news — the source descriptor's declaration tests.
 *
 * Behavioral: capability-card totality, immutability (deepFreeze), the
 * declared-capability helpers' verdicts, and the negative paths of the
 * collect-all validator.
 */

import { describe, expect, it } from 'vitest';

import {
  NEWS_SOURCE_DESCRIPTOR,
  NEWS_PROVIDER_ID,
  NEWS_VENUE,
  NEWS_ADAPTER,
  NEWS_CHANNELS,
  NEWS_EVENT_TYPES,
  validateSourceDescriptor,
  isSourceDescriptor,
  isDeclaredChannel,
  isDeclaredInstrument,
  isDeclaredEventType,
  declaredInstruments,
  isLatencyClass,
  type SourceDescriptor,
} from './index';

describe('NEWS_SOURCE_DESCRIPTOR declaration', () => {
  it('is a valid, frozen source descriptor', () => {
    expect(isSourceDescriptor(NEWS_SOURCE_DESCRIPTOR)).toBe(true);
    expect(Object.isFrozen(NEWS_SOURCE_DESCRIPTOR)).toBe(true);
    expect(Object.isFrozen(NEWS_SOURCE_DESCRIPTOR.capabilities)).toBe(true);
    expect(() => {
      (NEWS_SOURCE_DESCRIPTOR as unknown as Record<string, unknown>).provider = 'mutation';
    }).toThrow();
  });

  it('carries the licensed wire name in the opaque provider id (L2 inverse: HERE and only here)', () => {
    expect(NEWS_SOURCE_DESCRIPTOR.provider).toBe(NEWS_PROVIDER_ID);
    expect(NEWS_SOURCE_DESCRIPTOR.provider).toBe('news-wire-a');
    expect(NEWS_SOURCE_DESCRIPTOR.category).toBe('market-data');
    expect(NEWS_SOURCE_DESCRIPTOR.capabilities.latency_class).toBe('near-realtime');
    expect(isLatencyClass(NEWS_SOURCE_DESCRIPTOR.capabilities.latency_class)).toBe(true);
  });

  it('declares exactly the documented wire channels', () => {
    expect([...NEWS_SOURCE_DESCRIPTOR.capabilities.channels]).toEqual(['publicHeadlines', 'licensedWire']);
    expect([...NEWS_CHANNELS]).toEqual([...NEWS_SOURCE_DESCRIPTOR.capabilities.channels]);
  });

  it('declares exactly the emittable canonical event types (news — not book/trade shapes)', () => {
    expect([...NEWS_SOURCE_DESCRIPTOR.capabilities.event_types]).toEqual(['news']);
    expect([...NEWS_EVENT_TYPES]).toEqual([...NEWS_SOURCE_DESCRIPTOR.capabilities.event_types]);
  });

  it('declares an equity symbol universe with canonical synthetic ticker ids', () => {
    const universes = NEWS_SOURCE_DESCRIPTOR.capabilities.symbol_universes;
    expect(universes.length).toBe(1);
    expect(universes[0].universe_id).toBe('equity-majors');
    expect(universes[0].asset_class).toBe('equity');
    expect([...universes[0].instruments]).toEqual(['TEST-AAA', 'TEST-BBB']);
    expect([...declaredInstruments(NEWS_SOURCE_DESCRIPTOR)]).toEqual(['TEST-AAA', 'TEST-BBB']);
  });

  it('declared-capability helpers give the right verdicts (the envelope is enforced)', () => {
    expect(isDeclaredChannel(NEWS_SOURCE_DESCRIPTOR, 'licensedWire')).toBe(true);
    expect(isDeclaredChannel(NEWS_SOURCE_DESCRIPTOR, 'breakingWire')).toBe(false);
    expect(isDeclaredInstrument(NEWS_SOURCE_DESCRIPTOR, 'TEST-AAA', 'equity')).toBe(true);
    expect(isDeclaredInstrument(NEWS_SOURCE_DESCRIPTOR, 'TEST-AAA', 'index')).toBe(false);
    expect(isDeclaredInstrument(NEWS_SOURCE_DESCRIPTOR, 'AAPL', 'equity')).toBe(false);
    expect(isDeclaredEventType(NEWS_SOURCE_DESCRIPTOR, 'news')).toBe(true);
    expect(isDeclaredEventType(NEWS_SOURCE_DESCRIPTOR, 'social_signal')).toBe(false);
  });

  it('the adapter identity is the lineage producer (L9)', () => {
    expect(NEWS_ADAPTER.id).toBe('adapter-news');
    expect(NEWS_ADAPTER.version).toBe('0.0.0');
    expect(NEWS_VENUE).toBe('NEWS-WIRE-A');
  });
});

describe('validateSourceDescriptor negative paths (collect-all)', () => {
  it('rejects a non-object', () => {
    const result = validateSourceDescriptor('news');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
  });

  it('collects every violation at once (missing provider, bad category, bad capabilities)', () => {
    const result = validateSourceDescriptor({
      category: 'newspaper',
      capabilities: { channels: [], symbol_universes: [], event_types: [] },
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
        channels: ['licensedWire', 'licensedWire'],
        symbol_universes: [{ universe_id: 'u', asset_class: 'equity', instruments: [] }],
        event_types: ['news', 'gossip'],
        latency_class: 'asynchronous',
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
      provider: 'news-wire-a',
      category: 'market-data',
      capabilities: {
        channels: ['publicHeadlines', 'licensedWire'],
        symbol_universes: [
          { universe_id: 'equity-majors', asset_class: 'equity', instruments: ['TEST-AAA'] },
        ],
        event_types: ['news'],
        latency_class: 'near-realtime',
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const value: SourceDescriptor = result.value;
      expect(Object.isFrozen(value)).toBe(true);
      expect(value.provider).toBe('news-wire-a');
    }
  });
});
