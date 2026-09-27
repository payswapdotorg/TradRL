import { describe, expect, it } from 'vitest';

import {
  validateMarketEvent,
  validateMarketEvents,
  isMarketEvent,
  type EventType,
  type MarketEvent,
  type MarketProtocolErrorCode,
  type TimestampMs,
} from './index';
import { requireTimestampMs } from '../../time-engine/src/index';

function ts(n: number): TimestampMs {
  return requireTimestampMs(n);
}

/** A valid historical trade event as the base fixture. */
function baseEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: 'evt-000001',
    venue: 'BINANCE',
    instrument: 'BTC-USDT',
    asset_class: 'crypto',
    event_type: 'trade',
    event_time: ts(1_700_000_000_000),
    source_time: ts(1_700_000_000_000),
    available_time: ts(1_700_000_000_050),
    ingestion_time: ts(1_700_000_000_200),
    sequence: 1,
    provider: 'binance',
    provenance: {
      origin: 'historical',
      adapter: { id: 'binance-adapter', version: '1.4.0' },
      derived_from: [],
      transform: null,
    },
    payload: { price: '43125.10', size: '0.017', side: 'buy' },
    ...overrides,
  };
}

/** A valid payload per event type, for the all-types acceptance test. */
const validPayloadByType: Record<EventType, Record<string, unknown>> = {
  trade: { price: '43125.10', size: '0.017', side: 'buy', trade_id: '9901' },
  quote: { bid_price: '43125.00', bid_size: '1.2', ask_price: '43125.20', ask_size: '0.8' },
  book_snapshot: {
    bids: [{ price: '43125.00', size: '1.2' }],
    asks: [
      { price: '43125.20', size: '0.8' },
      { price: '43125.30', size: '2.0' },
    ],
    depth: 2,
  },
  book_delta: { action: 'update', levels: [{ price: '43125.20', size: '1.1' }] },
  ohlcv: { interval: '1m', open: '100.1', high: '101.5', low: '99.9', close: '101.0', volume: '1234.56', closed: true },
  news: { headline: 'Fed holds rates', symbols: ['SPX'], source: 'reuters', url: 'https://example.com/a' },
  macro_release: { indicator: 'US_CPI_YOY', region: 'US', period: '2024-05', actual: '3.3', forecast: '3.4', prior: '3.4' },
  social_signal: { platform: 'x', metric: 'sentiment_score', value: '-0.21' },
  fundamental: { field: 'EPS_DILUTED', period: '2024-Q2', value: '1.23', unit: 'USD/share' },
  option_chain_mark: {
    underlying: 'SPX',
    expiry: ts(1_750_000_000_000),
    strike: '5500',
    right: 'call',
    mark_price: '42.10',
    implied_vol: '0.13',
    greeks: { delta: '0.51', gamma: '0.0021', vega: '5.4', theta: '-1.2' },
  },
  other: { kind: 'funding_rate', data: { rate: '0.00010000', interval: '8h' } },
};

describe('validateMarketEvent — acceptance', () => {
  it('accepts a valid historical trade event', () => {
    const result = validateMarketEvent(baseEvent());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const event: MarketEvent = result.value;
      if (event.event_type === 'trade') {
        // Discriminant narrows the payload type at compile time.
        expect(event.payload.price).toBe('43125.10');
        expect(event.payload.side).toBe('buy');
      } else {
        throw new Error('expected trade event');
      }
    }
  });

  it('accepts a valid event for EVERY canonical event type', () => {
    for (const [eventType, payload] of Object.entries(validPayloadByType) as [EventType, Record<string, unknown>][]) {
      const result = validateMarketEvent(baseEvent({ event_type: eventType, payload }));
      expect(result.ok, `event_type=${eventType}`).toBe(true);
      if (result.ok) expect(result.value.event_type).toBe(eventType);
    }
  });

  it('accepts source_time: null (source does not say when it happened)', () => {
    expect(validateMarketEvent(baseEvent({ source_time: null })).ok).toBe(true);
  });

  it('accepts available_time equal to event_time (inclusive boundary input)', () => {
    expect(validateMarketEvent(baseEvent({ available_time: ts(1_700_000_000_000) })).ok).toBe(true);
  });

  it('accepts embargoed data: ingestion_time BEFORE available_time', () => {
    // E.g. entitled feed delivers at 13:50 what becomes public at 14:00.
    const result = validateMarketEvent(
      baseEvent({ ingestion_time: ts(1_700_000_000_000), available_time: ts(1_700_000_100_000) }),
    );
    expect(result.ok).toBe(true);
  });

  it('accepts backfilled data: ingestion_time long AFTER available_time', () => {
    const result = validateMarketEvent(
      baseEvent({ available_time: ts(1_700_000_000_050), ingestion_time: ts(1_700_860_000_000) }),
    );
    expect(result.ok).toBe(true);
  });

  it('accepts a FUTURE-DATED available_time — envelope validation is timeless; withholding is the firewall\'s job', () => {
    const farFuture = ts(4_108_606_800_000); // ~2100-01-01
    const result = validateMarketEvent(baseEvent({ event_time: farFuture, source_time: farFuture, available_time: farFuture }));
    expect(result.ok).toBe(true);
    // The firewall behavior for this exact event is proven in interop.test.ts.
  });

  it('tolerates excess fields (the contract is a forward-compatible floor)', () => {
    const withExtra = baseEvent({ vendor_extra_field: { nested: true }, another: 'x' });
    expect(validateMarketEvent(withExtra).ok).toBe(true);
  });

  it('accepts a derived (lineage-carrying) event', () => {
    // Note: the fixture event's own id is evt-000001 — the lineage below must
    // not contain it (self-reference is a provenance violation by contract).
    const result = validateMarketEvent(
      baseEvent({
        event_type: 'other',
        payload: { kind: 'vwap', data: { value: '43100.55' } },
        provenance: {
          origin: 'historical',
          adapter: { id: 'feature-adapter', version: '0.2.0' },
          derived_from: ['evt-000000', 'evt-000099'],
          transform: 'vwap-1m-aggregator',
        },
      }),
    );
    expect(result.ok).toBe(true);
  });
});

describe('validateMarketEvent — rejection (typed errors)', () => {
  interface RejectionCase {
    readonly name: string;
    readonly mutate: (event: Record<string, unknown>) => void;
    readonly code: MarketProtocolErrorCode;
    readonly path?: string;
  }

  const cases: RejectionCase[] = [
    {
      name: 'missing event_time',
      mutate: (e) => delete e.event_time,
      code: 'missing_field',
      path: 'event_time',
    },
    {
      name: 'missing source_time (must be explicit null, not absent)',
      mutate: (e) => delete e.source_time,
      code: 'missing_field',
      path: 'source_time',
    },
    {
      name: 'missing available_time',
      mutate: (e) => delete e.available_time,
      code: 'missing_field',
      path: 'available_time',
    },
    {
      name: 'missing ingestion_time',
      mutate: (e) => delete e.ingestion_time,
      code: 'missing_field',
      path: 'ingestion_time',
    },
    {
      name: 'fractional event_time',
      mutate: (e) => (e.event_time = 1_700_000_000.5),
      code: 'invalid_field',
      path: 'event_time',
    },
    {
      name: 'negative available_time',
      mutate: (e) => (e.available_time = -1),
      code: 'invalid_field',
      path: 'available_time',
    },
    {
      name: 'out-of-range ingestion_time (beyond ECMAScript Date range)',
      mutate: (e) => (e.ingestion_time = 9_000_000_000_000_000),
      code: 'invalid_field',
      path: 'ingestion_time',
    },
    {
      name: 'non-numeric source_time',
      mutate: (e) => (e.source_time = '2024-01-01T00:00:00Z'),
      code: 'invalid_field',
      path: 'source_time',
    },
    {
      name: 'available_time before event_time',
      mutate: (e) => (e.available_time = ts(1_699_999_999_999)),
      code: 'timestamp_order',
      path: 'available_time',
    },
    {
      name: 'unknown event type',
      mutate: (e) => (e.event_type = 'spline'),
      code: 'unknown_event_type',
      path: 'event_type',
    },
    {
      name: 'empty venue',
      mutate: (e) => (e.venue = ''),
      code: 'invalid_field',
      path: 'venue',
    },
    {
      name: 'unknown asset class',
      mutate: (e) => (e.asset_class = 'derivatives'),
      code: 'invalid_field',
      path: 'asset_class',
    },
    {
      name: 'negative sequence',
      mutate: (e) => (e.sequence = -1),
      code: 'invalid_field',
      path: 'sequence',
    },
    {
      name: 'fractional sequence',
      mutate: (e) => (e.sequence = 1.5),
      code: 'invalid_field',
      path: 'sequence',
    },
    {
      name: 'missing provenance',
      mutate: (e) => delete e.provenance,
      code: 'missing_field',
      path: 'provenance',
    },
    {
      name: 'historical event without adapter reference',
      mutate: (e) => (e.provenance = { origin: 'historical', adapter: null, derived_from: [], transform: null }),
      code: 'provenance_adapter_required',
      path: 'provenance.adapter',
    },
    {
      name: 'missing payload',
      mutate: (e) => delete e.payload,
      code: 'missing_field',
      path: 'payload',
    },
    {
      name: 'invalid payload value surfaces under a payload-prefixed path',
      mutate: (e) => (e.payload = { price: '0', size: '0.017', side: 'buy' }),
      code: 'invalid_field',
      path: 'payload.price',
    },
    {
      name: 'other payload without a kind is rejected',
      mutate: (e) => {
        e.event_type = 'other';
        e.payload = { data: { x: 1 } };
      },
      code: 'missing_field',
      path: 'payload.kind',
    },
  ];

  for (const testCase of cases) {
    it(`rejects: ${testCase.name}`, () => {
      const event = baseEvent();
      testCase.mutate(event);
      const result = validateMarketEvent(event);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const match = result.errors.find((error) => error.code === testCase.code && error.path === testCase.path);
        expect(match, `expected error ${testCase.code} at ${testCase.path}, got ${JSON.stringify(result.errors)}`).toBeDefined();
      }
    });
  }

  it('rejects non-object inputs with invalid_type', () => {
    for (const bad of [null, undefined, 42, 'event', []]) {
      const result = validateMarketEvent(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors[0]?.code).toBe('invalid_type');
      }
    }
  });

  it('collects ALL violations in one pass (not fail-fast)', () => {
    const event = baseEvent();
    delete event.available_time;
    event.venue = '';
    event.payload = { price: 'abc', size: '0.017', side: 'buy' };
    const result = validateMarketEvent(event);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map((error) => `${error.code}@${error.path}`);
      expect(codes).toContain('missing_field@available_time');
      expect(codes).toContain('invalid_field@venue');
      expect(codes).toContain('invalid_field@payload.price');
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('still validates common fields when the event type is unknown', () => {
    const event = baseEvent();
    event.event_type = 'spline';
    event.venue = '';
    const result = validateMarketEvent(event);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map((error) => error.code);
      expect(codes).toContain('unknown_event_type');
      expect(codes).toContain('invalid_field');
    }
  });
});

describe('isMarketEvent / validateMarketEvents', () => {
  it('isMarketEvent narrows unknown input', () => {
    const good: unknown = baseEvent();
    expect(isMarketEvent(good)).toBe(true);
    if (isMarketEvent(good)) {
      expect(good.event_type).toBe('trade');
    }
    expect(isMarketEvent({ nope: true })).toBe(false);
    expect(isMarketEvent(null)).toBe(false);
  });

  it('validateMarketEvents returns position-aligned results', () => {
    const bad = baseEvent();
    delete bad.available_time;
    const results = validateMarketEvents([baseEvent(), bad, baseEvent()]);
    expect(results.map((r) => r.ok)).toEqual([true, false, true]);
  });
});
