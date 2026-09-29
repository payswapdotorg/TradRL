/**
 * Behavioral tests for the market observation mirrors: the envelope
 * guards (L4 availability quartet, provenance origin law), the
 * observation window's ordering and information-boundary laws, and the
 * deterministic mark derivation.
 */

import { describe, expect, it } from 'vitest';

import {
  isMarketEventMirror,
  isObservationWindow,
  markPriceOf,
  type MarketEventMirror,
  type ObservationWindow,
} from './index';

const T0 = 1_700_000_000_000;
const BTC = 'BTC-USD' as never;
const VENUE = 'SIM' as never;

function trade(eventId: string, price: string, sequence: number, time: number, availableDelta = 0): MarketEventMirror {
  return {
    event_id: eventId,
    venue: VENUE,
    instrument: BTC,
    asset_class: 'crypto',
    event_type: 'trade',
    event_time: time as never,
    source_time: null,
    available_time: (time + availableDelta) as never,
    ingestion_time: time as never,
    sequence,
    provider: 'sim',
    provenance: { origin: 'simulated', adapter: null, derived_from: [], transform: null },
    payload: { price, size: '1', side: 'buy', trade_id: `t-${eventId}` },
  };
}

function quote(eventId: string, bid: string, ask: string, sequence: number, time: number): MarketEventMirror {
  return {
    event_id: eventId,
    venue: VENUE,
    instrument: BTC,
    asset_class: 'crypto',
    event_type: 'quote',
    event_time: time as never,
    source_time: null,
    available_time: time as never,
    ingestion_time: time as never,
    sequence,
    provider: 'sim',
    provenance: { origin: 'simulated', adapter: null, derived_from: [], transform: null },
    payload: { bid_price: bid, bid_size: '1', ask_price: ask, ask_size: '1' },
  };
}

function window(events: readonly MarketEventMirror[], asOf = T0): ObservationWindow {
  return {
    window_id: 'win-1',
    events,
    asOf: asOf as never,
    starts_at: (T0 - 5000) as never,
    ends_at: (asOf + 1) as never,
  };
}

describe('the market event mirror guards', () => {
  it('accepts a well-formed trade event', () => {
    expect(isMarketEventMirror(trade('e1', '50000', 1, T0))).toBe(true);
  });

  it('rejects an event whose availability precedes its event time (L4)', () => {
    const early = { ...trade('e1', '50000', 1, T0), available_time: (T0 - 1) as never };
    expect(isMarketEventMirror(early)).toBe(false);
  });

  it('rejects a historical event without an adapter (no orphan history)', () => {
    const orphan = {
      ...trade('e1', '50000', 1, T0),
      provenance: { origin: 'historical', adapter: null, derived_from: [], transform: null },
    };
    expect(isMarketEventMirror(orphan)).toBe(false);
  });

  it('rejects a derivation without a transform', () => {
    const derived = {
      ...trade('e1', '50000', 1, T0),
      provenance: { origin: 'simulated', adapter: null, derived_from: ['e0'], transform: null },
    };
    expect(isMarketEventMirror(derived)).toBe(false);
  });

  it('rejects a non-positive payload price', () => {
    const zero = { ...trade('e1', '0', 1, T0) };
    expect(isMarketEventMirror(zero)).toBe(false);
  });
});

describe('the observation window laws', () => {
  it('accepts a well-formed ordered window', () => {
    const events = [trade('e1', '50000', 1, T0 - 1000), trade('e2', '50100', 2, T0 - 500)];
    expect(isObservationWindow(window(events))).toBe(true);
  });

  it('rejects an out-of-order event list', () => {
    const events = [trade('e1', '50000', 1, T0 - 500), trade('e2', '50100', 2, T0 - 1000)];
    expect(isObservationWindow(window(events))).toBe(false);
  });

  it('rejects a duplicate event id', () => {
    const events = [trade('e1', '50000', 1, T0 - 1000), trade('e1', '50100', 2, T0 - 500)];
    expect(isObservationWindow(window(events))).toBe(false);
  });

  it('rejects an event NOT YET available at the decision instant (the L4 firewall)', () => {
    // The event happened at T0-100 but only becomes available AFTER asOf.
    const future = trade('e-late', '50000', 1, T0 - 100, 5000);
    expect(isObservationWindow(window([future], T0))).toBe(false);
    // Same event, decision instant after availability: legal.
    expect(isObservationWindow(window([future], T0 + 5000))).toBe(true);
  });

  it('rejects events outside the declared bounds', () => {
    const events = [trade('e1', '50000', 1, T0 - 10_000)];
    expect(isObservationWindow(window(events))).toBe(false);
  });
});

describe('mark derivation (deterministic, from the declared window only)', () => {
  it('the LAST trade in window order is the mark', () => {
    const events = [trade('e1', '50000', 1, T0 - 1000), trade('e2', '50100', 2, T0 - 500)];
    const mark = markPriceOf(window(events), BTC, 8);
    expect(mark).toEqual({ price: '50100', source: 'last_trade' });
  });

  it('falls back to the mid quote ((bid+ask)/2 at the declared precision) when no trade exists', () => {
    const events = [quote('q1', '49990', '50010', 1, T0 - 500)];
    const mark = markPriceOf(window(events), BTC, 8);
    expect(mark).toEqual({ price: '50000', source: 'mid_quote' });
  });

  it('returns null for an unobserved instrument (the caller converts to observation_gap)', () => {
    expect(markPriceOf(window([]), BTC, 8)).toBeNull();
  });

  it('prefers the last trade even when a later quote exists', () => {
    const events = [trade('e1', '50000', 1, T0 - 1000), quote('q1', '49000', '49100', 2, T0 - 500)];
    const mark = markPriceOf(window(events), BTC, 8);
    expect(mark?.source).toBe('last_trade');
  });
});
