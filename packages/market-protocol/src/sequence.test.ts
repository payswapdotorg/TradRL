import { describe, expect, it } from 'vitest';

import {
  createSequenceTracker,
  sequenceKey,
  sequenceStream,
  validateSequenceMonotonicity,
  type MarketEvent,
  type TimestampMs,
} from './index';
import { requireTimestampMs } from '../../time-engine/src/index';

function ts(n: number): TimestampMs {
  return requireTimestampMs(n);
}

let counter = 0;

function tradeEvent(overrides: {
  venue?: string;
  instrument?: string;
  sequence: number;
  event_type?: MarketEvent['event_type'];
  payload?: unknown;
}): MarketEvent {
  counter += 1;
  const base = {
    event_id: `evt-${String(counter).padStart(6, '0')}`,
    venue: 'BINANCE',
    instrument: 'BTC-USDT',
    asset_class: 'crypto',
    event_type: 'trade',
    event_time: ts(1_000 + counter),
    source_time: ts(1_000 + counter),
    available_time: ts(1_050 + counter),
    ingestion_time: ts(1_200 + counter),
    sequence: overrides.sequence,
    provider: 'binance',
    provenance: { origin: 'historical', adapter: { id: 'a', version: '1' }, derived_from: [], transform: null },
    payload: { price: '100', size: '1', side: 'buy' },
    ...(overrides.venue !== undefined ? { venue: overrides.venue } : {}),
    ...(overrides.instrument !== undefined ? { instrument: overrides.instrument } : {}),
    ...(overrides.event_type !== undefined ? { event_type: overrides.event_type } : {}),
    ...(overrides.payload !== undefined ? { payload: overrides.payload } : {}),
  } as unknown as MarketEvent;
  return base;
}

describe('stream scoping', () => {
  it('scopes streams by event type, qualifying other by kind', () => {
    const trade = tradeEvent({ sequence: 1 });
    expect(sequenceStream(trade)).toBe('trade');
    expect(sequenceKey(trade)).toBe('BINANCE|BTC-USDT|trade');

    const otherA = tradeEvent({ sequence: 1, event_type: 'other', payload: { kind: 'liquidation', data: {} } });
    expect(sequenceStream(otherA)).toBe('other:liquidation');
    expect(sequenceKey(otherA)).toBe('BINANCE|BTC-USDT|other:liquidation');
  });
});

describe('validateSequenceMonotonicity', () => {
  it('accepts strictly increasing sequences per stream', () => {
    const events = [
      tradeEvent({ sequence: 1 }),
      tradeEvent({ sequence: 2 }),
      tradeEvent({ sequence: 5 }), // gaps are fine
      tradeEvent({ sequence: 6 }),
    ];
    const validation = validateSequenceMonotonicity(events);
    expect(validation.ok).toBe(true);
    expect(validation.violations).toEqual([]);
  });

  it('rejects a duplicate sequence within one stream', () => {
    const events = [tradeEvent({ sequence: 1 }), tradeEvent({ sequence: 2 }), tradeEvent({ sequence: 2 })];
    const validation = validateSequenceMonotonicity(events);
    expect(validation.ok).toBe(false);
    expect(validation.violations).toHaveLength(1);
    const violation = validation.violations[0];
    expect(violation?.kind).toBe('duplicate_sequence');
    if (violation?.kind === 'duplicate_sequence') {
      expect(violation.key).toBe('BINANCE|BTC-USDT|trade');
      expect(violation.index).toBe(2);
      expect(violation.previousIndex).toBe(1);
      expect(violation.sequence).toBe(2);
    }
  });

  it('rejects a regressed sequence within one stream', () => {
    const events = [tradeEvent({ sequence: 5 }), tradeEvent({ sequence: 6 }), tradeEvent({ sequence: 4 })];
    const validation = validateSequenceMonotonicity(events);
    expect(validation.ok).toBe(false);
    const violation = validation.violations[0];
    expect(violation?.kind).toBe('regressed_sequence');
    if (violation?.kind === 'regressed_sequence') {
      expect(violation.previousSequence).toBe(6);
      expect(violation.sequence).toBe(4);
    }
  });

  it('treats streams as INDEPENDENT across event types', () => {
    const events = [
      tradeEvent({ sequence: 1 }),
      tradeEvent({ sequence: 1, event_type: 'quote', payload: { bid_price: '1', bid_size: '1', ask_price: '1.1', ask_size: '1' } }),
      tradeEvent({ sequence: 2 }),
      tradeEvent({ sequence: 2, event_type: 'quote', payload: { bid_price: '1', bid_size: '1', ask_price: '1.1', ask_size: '1' } }),
    ];
    expect(validateSequenceMonotonicity(events).ok).toBe(true);
  });

  it('treats streams as INDEPENDENT across venues and instruments', () => {
    const events = [
      tradeEvent({ sequence: 1, venue: 'BINANCE', instrument: 'BTC-USDT' }),
      tradeEvent({ sequence: 1, venue: 'COINBASE', instrument: 'BTC-USD' }),
      tradeEvent({ sequence: 1, venue: 'BINANCE', instrument: 'ETH-USDT' }),
      tradeEvent({ sequence: 2, venue: 'BINANCE', instrument: 'BTC-USDT' }),
    ];
    expect(validateSequenceMonotonicity(events).ok).toBe(true);
  });

  it('distinguishes other-events by kind: same kind collides, different kinds do not', () => {
    const liquidation1 = tradeEvent({ sequence: 1, event_type: 'other', payload: { kind: 'liquidation', data: {} } });
    const funding1 = tradeEvent({ sequence: 1, event_type: 'other', payload: { kind: 'funding_rate', data: {} } });
    const liquidation1again = tradeEvent({ sequence: 1, event_type: 'other', payload: { kind: 'liquidation', data: {} } });

    expect(validateSequenceMonotonicity([liquidation1, funding1]).ok).toBe(true);
    const collision = validateSequenceMonotonicity([liquidation1, liquidation1again]);
    expect(collision.ok).toBe(false);
    expect(collision.violations[0]?.kind).toBe('duplicate_sequence');
  });

  it('reports every violation in a mixed batch', () => {
    const events = [
      tradeEvent({ sequence: 1 }),
      tradeEvent({ sequence: 1 }), // duplicate
      tradeEvent({ sequence: 0 }), // regressed
    ];
    const validation = validateSequenceMonotonicity(events);
    expect(validation.ok).toBe(false);
    expect(validation.violations).toHaveLength(2);
  });
});

describe('SequenceTracker', () => {
  it('issues strictly increasing sequences per key', () => {
    const tracker = createSequenceTracker();
    expect(tracker.next('BINANCE|BTC-USDT|trade')).toBe(1);
    expect(tracker.next('BINANCE|BTC-USDT|trade')).toBe(2);
    expect(tracker.next('BINANCE|ETH-USDT|trade')).toBe(1); // independent key
    expect(tracker.peek('BINANCE|BTC-USDT|trade')).toBe(2);
    expect(tracker.peek('BINANCE|ETH-USDT|trade')).toBe(1);
    expect(tracker.peek('unknown')).toBe(0);
  });

  it('folds externally-assigned sequences so issued numbers never collide', () => {
    const tracker = createSequenceTracker();
    tracker.observe('k', 41);
    expect(tracker.peek('k')).toBe(41);
    expect(tracker.next('k')).toBe(42);
    tracker.observe('k', 10); // lower than high-water mark — ignored
    expect(tracker.next('k')).toBe(43);
  });
});
