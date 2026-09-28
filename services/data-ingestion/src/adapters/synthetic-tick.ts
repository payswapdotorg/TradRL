/**
 * @tradrl/data-ingestion — the synthetic tick adapter (example, pure fixture).
 *
 * A DETERMINISTIC, NETWORK-FREE provider adapter standing in for a
 * vendor trade feed: three discovered batches of raw tick records (one
 * record deliberately malformed to exercise the normalization-error
 * dead-letter path), one batch carrying a re-delivered tick id (to
 * exercise the store's duplicate-id rejection + the pipeline's bounded
 * retry), and one derived VWAP bar (to exercise lineage and the
 * derived-availability rule at commit).
 *
 * Provenance honesty (L5-adjacent): the adapter declares origin
 * `historical` with its OWN identity (`synthetic-tick-adapter@1.0.0`) in
 * every event's provenance — the adapter reference is the disclosure that
 * this feed is a deterministic fixture, so lineage stays auditable.
 *
 * Vendor specifics (this raw shape) live ONLY here — nothing else in the
 * data plane ever sees them (L13/L14).
 */

import type {
  AdapterDescriptor,
  DiscoveryReport,
  FetchBatch,
  FetchResult,
  NormalizeResult,
  ProviderAdapter,
} from '../adapter';
import type { CanonicalEvent } from '../canonical-event';
import { isNonEmptyString } from '../fields';
import { isTimestampMs, type TimestampMs } from '../timestamp';

/** A raw tick record (the fixture vendor shape). */
export interface SyntheticTickRecord {
  readonly record_type: 'tick';
  readonly tick_id: string;
  readonly symbol: string;
  /** Unsigned decimal string (deliberately malformed on the bad fixture). */
  readonly price: string;
  /** Unsigned decimal string. */
  readonly qty: string;
  readonly side: 'buy' | 'sell';
  /** When the trade happened (epoch ms). */
  readonly trade_ts: number;
  /** When the feed delivered it (epoch ms; >= trade_ts on clean fixtures). */
  readonly recv_ts: number;
}

/** A raw derived VWAP bar (produced by the fixture feed's aggregator). */
export interface SyntheticVwapRecord {
  readonly record_type: 'vwap_bar';
  readonly bar_id: string;
  readonly symbol: string;
  readonly interval: string;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly volume: string;
  /** Parent tick event ids. */
  readonly derived_from: readonly string[];
  /** Bar interval close (event_time, epoch ms). */
  readonly bar_ts: number;
  /** Earliest legitimate observation (>= every parent's availability, epoch ms). */
  readonly available_ts: number;
}

/** The adapter's raw record union. */
export type SyntheticTickRaw = SyntheticTickRecord | SyntheticVwapRecord;

const DESCRIPTOR: AdapterDescriptor = {
  id: 'synthetic-tick-adapter',
  version: '1.0.0',
  provider: 'synthetic',
};

const VENUE = 'SYNTH';
const SYMBOL = 'BTC-USDT';
const ASSET_CLASS = 'crypto' as const;
const PROVIDER = 'synthetic';
const ADVISORY_INGEST_OFFSET = 25;

/** Unsigned decimal pattern (mirror of market-protocol's decimal floor). */
const UNSIGNED_DECIMAL_RE = /^\d+(?:\.\d+)?$/;

/** Deterministic batch ids. */
const BATCHES: readonly FetchBatch[] = [
  { batch_id: 'tick-batch-001', description: 'four clean ticks' },
  { batch_id: 'tick-batch-002', description: 'three clean ticks and one malformed price' },
  { batch_id: 'tick-batch-003', description: 'three clean ticks, one re-delivered tick id and a derived vwap bar' },
];

function tick(tickId: string, price: string, qty: string, side: 'buy' | 'sell', tradeTs: number): SyntheticTickRecord {
  return {
    record_type: 'tick',
    tick_id: tickId,
    symbol: SYMBOL,
    price,
    qty,
    side,
    trade_ts: tradeTs,
    recv_ts: tradeTs + 50,
  };
}

/** The deterministic raw stream per batch (unknown batches yield nothing). */
function rawsForBatch(batchId: string): readonly SyntheticTickRaw[] {
  if (batchId === 'tick-batch-001') {
    return [
      tick('001-1', '43125.10', '0.017', 'buy', 1_000_000),
      tick('001-2', '43125.20', '0.250', 'sell', 1_000_100),
      tick('001-3', '43125.05', '0.003', 'buy', 1_000_200),
      tick('001-4', '43126.00', '1.200', 'buy', 1_000_300),
    ];
  }
  if (batchId === 'tick-batch-002') {
    return [
      tick('002-1', '43200.00', '0.500', 'buy', 2_000_000),
      tick('002-2', '43201.10', '0.750', 'sell', 2_000_100),
      // Malformed-price fixture: normalization must fail with a typed error.
      tick('002-3', 'not-a-price', '0.400', 'buy', 2_000_200),
      tick('002-4', '43202.55', '0.125', 'sell', 2_000_300),
    ];
  }
  if (batchId === 'tick-batch-003') {
    const base = 3_000_000;
    const parents: readonly string[] = ['tick-003-1', 'tick-003-2', 'tick-003-3'];
    const lastParentAvailable = base + 200 + 50; // recv of the third fresh tick
    return [
      tick('003-1', '43300.00', '0.610', 'buy', base),
      tick('003-2', '43301.00', '0.220', 'sell', base + 100),
      tick('003-3', '43302.00', '0.900', 'buy', base + 200),
      // Re-delivery of batch-001's first tick: same tick_id, fresh clocks —
      // the store rejects it as a duplicate event id; the pipeline
      // dead-letters it and re-commits the survivors.
      tick('001-1', '43303.00', '0.017', 'buy', base + 300),
      // A derived VWAP bar over this batch's fresh ticks (available at the
      // last parent's availability + the aggregation delay).
      {
        record_type: 'vwap_bar',
        bar_id: 'vwap-003',
        symbol: SYMBOL,
        interval: '1m',
        open: '43300.00',
        high: '43302.00',
        low: '43300.00',
        close: '43301.50',
        volume: '1.730',
        derived_from: parents,
        bar_ts: base + 200,
        available_ts: lastParentAvailable + 60_000,
      },
    ];
  }
  return [];
}

/**
 * Create the synthetic tick adapter. Stateful per-instance sequence
 * counters make every normalized stream strictly increasing; fresh
 * instances + the same call order are deterministic.
 */
export function createSyntheticTickAdapter(): ProviderAdapter<SyntheticTickRaw> {
  let tickSequence = 0;
  let barSequence = 0;

  const normalizeTick = (raw: SyntheticTickRecord): NormalizeResult => {
    const errors: Array<{ code: string; raw_id: string; message: string }> = [];
    if (!isNonEmptyString(raw.tick_id)) {
      errors.push({ code: 'invalid_tick_id', raw_id: '', message: 'tick_id must be a non-empty string' });
    }
    if (!UNSIGNED_DECIMAL_RE.test(raw.price) || raw.price === '0') {
      errors.push({
        code: 'invalid_price',
        raw_id: raw.tick_id,
        message: `price "${raw.price}" is not a positive decimal string`,
      });
    }
    if (!UNSIGNED_DECIMAL_RE.test(raw.qty) || raw.qty === '0') {
      errors.push({ code: 'invalid_qty', raw_id: raw.tick_id, message: `qty "${raw.qty}" is not a positive decimal string` });
    }
    if (!isTimestampMs(raw.trade_ts) || !isTimestampMs(raw.recv_ts)) {
      errors.push({
        code: 'invalid_timestamp',
        raw_id: raw.tick_id,
        message: 'trade_ts/recv_ts must be valid epoch-millisecond timestamps',
      });
    }
    if (raw.side !== 'buy' && raw.side !== 'sell') {
      errors.push({ code: 'invalid_side', raw_id: raw.tick_id, message: 'side must be "buy" or "sell"' });
    }
    if (errors.length > 0) return { events: [], errors };

    tickSequence += 1;
    const event: CanonicalEvent = {
      event_id: `tick-${raw.tick_id}`,
      venue: VENUE,
      instrument: raw.symbol,
      asset_class: ASSET_CLASS,
      event_type: 'trade',
      event_time: raw.trade_ts as TimestampMs,
      source_time: raw.trade_ts as TimestampMs,
      available_time: raw.recv_ts as TimestampMs,
      ingestion_time: (raw.recv_ts + ADVISORY_INGEST_OFFSET) as TimestampMs,
      sequence: tickSequence,
      provider: PROVIDER,
      provenance: {
        origin: 'historical',
        adapter: { id: DESCRIPTOR.id, version: DESCRIPTOR.version },
        derived_from: [],
        transform: null,
      },
      payload: { price: raw.price, size: raw.qty, side: raw.side },
    };
    return { events: [event], errors: [] };
  };

  const normalizeVwap = (raw: SyntheticVwapRecord): NormalizeResult => {
    const errors: Array<{ code: string; raw_id: string; message: string }> = [];
    if (!isNonEmptyString(raw.bar_id)) {
      errors.push({ code: 'invalid_bar_id', raw_id: '', message: 'bar_id must be a non-empty string' });
    }
    for (const field of ['open', 'high', 'low', 'close', 'volume'] as const) {
      const value = raw[field];
      if (!UNSIGNED_DECIMAL_RE.test(value)) {
        errors.push({ code: 'invalid_decimal', raw_id: raw.bar_id, message: `${field} "${value}" is not a decimal string` });
      }
    }
    if (!Array.isArray(raw.derived_from) || raw.derived_from.length === 0 || !raw.derived_from.every(isNonEmptyString)) {
      errors.push({ code: 'invalid_lineage', raw_id: raw.bar_id, message: 'a vwap bar must list its parent tick ids' });
    }
    if (!isTimestampMs(raw.bar_ts) || !isTimestampMs(raw.available_ts)) {
      errors.push({
        code: 'invalid_timestamp',
        raw_id: raw.bar_id,
        message: 'bar_ts/available_ts must be valid epoch-millisecond timestamps',
      });
    }
    if (errors.length > 0) return { events: [], errors };

    barSequence += 1;
    const event: CanonicalEvent = {
      event_id: `vwap-${raw.bar_id}`,
      venue: VENUE,
      instrument: raw.symbol,
      asset_class: ASSET_CLASS,
      event_type: 'ohlcv',
      event_time: raw.bar_ts as TimestampMs,
      source_time: raw.bar_ts as TimestampMs,
      available_time: raw.available_ts as TimestampMs,
      ingestion_time: (raw.available_ts + ADVISORY_INGEST_OFFSET) as TimestampMs,
      sequence: barSequence,
      provider: PROVIDER,
      provenance: {
        origin: 'historical',
        adapter: { id: DESCRIPTOR.id, version: DESCRIPTOR.version },
        derived_from: [...raw.derived_from],
        transform: 'vwap-1m-aggregator',
      },
      payload: {
        interval: raw.interval,
        open: raw.open,
        high: raw.high,
        low: raw.low,
        close: raw.close,
        volume: raw.volume,
      },
    };
    return { events: [event], errors: [] };
  };

  return {
    descriptor: DESCRIPTOR,
    discover(): DiscoveryReport {
      return { batches: [...BATCHES] };
    },
    fetch(batch: FetchBatch): FetchResult<SyntheticTickRaw> {
      return { records: [...rawsForBatch(batch.batch_id)] };
    },
    normalize(raw: SyntheticTickRaw): NormalizeResult {
      return raw.record_type === 'tick' ? normalizeTick(raw) : normalizeVwap(raw);
    },
  };
}
