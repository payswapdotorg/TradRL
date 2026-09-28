/**
 * @tradrl/data-ingestion — the synthetic news adapter (example, pure fixture).
 *
 * A DETERMINISTIC, NETWORK-FREE provider adapter standing in for a news
 * wire: two discovered batches of raw news records exercising the L4
 * information boundary and the data plane's rejection paths:
 *
 *   - an ordinary item (available shortly after publication),
 *   - an EMBARGOED item (available long after publication — ingest accepts
 *     future-dated availability; withholding is the firewall's job),
 *   - a record with a MISSING headline (normalization error -> DLQ),
 *   - a CONTRADICTORY item whose vendor timestamps claim observability
 *     BEFORE occurrence (honest pass-through: the normalizer does not
 *     silently clamp; the pipeline's quartet validation rejects it -> DLQ),
 *   - a vendor SEQUENCE BUG fixture (two items carrying the same
 *     sequence; the pipeline's within-batch pre-check dead-letters the
 *     duplicate -> DLQ).
 *
 * Vendor specifics (this raw shape) live ONLY here (L13/L14).
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

/** A raw news record (the fixture vendor shape). */
export interface SyntheticNewsRecord {
  readonly news_id: string;
  /** Headline — deliberately missing on the broken fixture. */
  readonly headline?: string;
  /** Editorial source label (e.g. "synthetic-wire"). */
  readonly source_label: string;
  /** Related instrument symbols (non-empty strings). */
  readonly symbols: readonly string[];
  /** Publication time (event_time, epoch ms). */
  readonly published_ts: number;
  /** Vendor-claimed availability (epoch ms) — passed through HONESTLY, never clamped. */
  readonly available_ts: number;
  /** Canonical article URL (optional). */
  readonly url?: string;
  /** Vendor sequence override — a fixture knob simulating a vendor sequence bug. */
  readonly sequence?: number;
}

const DESCRIPTOR: AdapterDescriptor = {
  id: 'synthetic-news-adapter',
  version: '1.0.0',
  provider: 'synthetic',
};

const VENUE = 'SYNTH';
const INSTRUMENT = 'BTC-USDT';
const ASSET_CLASS = 'crypto' as const;
const PROVIDER = 'synthetic';
const SOURCE_LABEL = 'synthetic-wire';
const ADVISORY_INGEST_OFFSET = 25;

/** Deterministic batch ids. */
const BATCHES: readonly FetchBatch[] = [
  { batch_id: 'news-batch-001', description: 'ordinary, embargoed and headline-less items' },
  { batch_id: 'news-batch-002', description: 'a contradictory-timestamp item, a clean item and a vendor sequence bug' },
];

/** The deterministic raw stream per batch (unknown batches yield nothing). */
function rawsForBatch(batchId: string): readonly SyntheticNewsRecord[] {
  if (batchId === 'news-batch-001') {
    return [
      {
        news_id: 'n1',
        headline: 'Synthetic wire: ordinary market update',
        source_label: SOURCE_LABEL,
        symbols: [INSTRUMENT],
        published_ts: 5_000_000,
        available_ts: 5_001_000,
        url: 'https://synthetic.example/n1',
      },
      {
        // Embargoed: ingested long before it may legitimately be observed.
        news_id: 'n2',
        headline: 'Synthetic wire: embargoed regulatory decision',
        source_label: SOURCE_LABEL,
        symbols: [INSTRUMENT],
        published_ts: 5_000_500,
        available_ts: 5_000_500 + 3_600_000,
      },
      {
        // Headline-less: normalization must fail with a typed error.
        news_id: 'n3',
        source_label: SOURCE_LABEL,
        symbols: [INSTRUMENT],
        published_ts: 5_001_000,
        available_ts: 5_002_000,
      },
    ];
  }
  if (batchId === 'news-batch-002') {
    return [
      {
        // Contradictory: the vendor claims observability BEFORE occurrence.
        // The normalizer passes the claim through honestly — the pipeline's
        // quartet validation rejects it (timestamp_order) into the DLQ.
        news_id: 'n4',
        headline: 'Synthetic wire: contradictory clock fixture',
        source_label: SOURCE_LABEL,
        symbols: [INSTRUMENT],
        published_ts: 6_000_000,
        available_ts: 6_000_000 - 5_000,
      },
      {
        news_id: 'n5',
        headline: 'Synthetic wire: clean follow-up',
        source_label: SOURCE_LABEL,
        symbols: [INSTRUMENT],
        published_ts: 6_000_100,
        available_ts: 6_001_000,
      },
      {
        // Vendor sequence bug: same sequence as n5 — the pipeline's
        // within-batch pre-check dead-letters this duplicate.
        news_id: 'n6',
        headline: 'Synthetic wire: sequence-bug fixture',
        source_label: SOURCE_LABEL,
        symbols: [INSTRUMENT],
        published_ts: 6_000_200,
        available_ts: 6_002_000,
        sequence: 4, // matches n5's counter-assigned sequence (n1=1, n2=2, n4=3, n5=4)
      },
    ];
  }
  return [];
}

/**
 * Create the synthetic news adapter. The per-instance sequence counter
 * makes the stream strictly increasing; the `sequence` raw-field override
 * is the deliberate vendor-bug fixture. Fresh instances + the same call
 * order are deterministic.
 */
export function createSyntheticNewsAdapter(): ProviderAdapter<SyntheticNewsRecord> {
  let newsSequence = 0;

  return {
    descriptor: DESCRIPTOR,
    discover(): DiscoveryReport {
      return { batches: [...BATCHES] };
    },
    fetch(batch: FetchBatch): FetchResult<SyntheticNewsRecord> {
      return { records: [...rawsForBatch(batch.batch_id)] };
    },
    normalize(raw: SyntheticNewsRecord): NormalizeResult {
      const errors: Array<{ code: string; raw_id: string; message: string }> = [];
      if (!isNonEmptyString(raw.news_id)) {
        errors.push({ code: 'invalid_news_id', raw_id: '', message: 'news_id must be a non-empty string' });
      }
      if (raw.headline === undefined || !isNonEmptyString(raw.headline)) {
        errors.push({ code: 'missing_headline', raw_id: raw.news_id, message: 'a news item must carry a non-empty headline' });
      }
      if (!isNonEmptyString(raw.source_label)) {
        errors.push({ code: 'invalid_source', raw_id: raw.news_id, message: 'source_label must be a non-empty string' });
      }
      if (
        !Array.isArray(raw.symbols) ||
        raw.symbols.length === 0 ||
        !raw.symbols.every((symbol) => isNonEmptyString(symbol))
      ) {
        errors.push({ code: 'invalid_symbols', raw_id: raw.news_id, message: 'symbols must be a non-empty array of non-empty strings' });
      }
      if (!isTimestampMs(raw.published_ts) || !isTimestampMs(raw.available_ts)) {
        errors.push({
          code: 'invalid_timestamp',
          raw_id: raw.news_id,
          message: 'published_ts/available_ts must be valid epoch-millisecond timestamps',
        });
      }
      if (raw.url !== undefined && !/^https?:\/\//.test(raw.url)) {
        errors.push({ code: 'invalid_url', raw_id: raw.news_id, message: 'url must be an http(s) URL when present' });
      }
      if (errors.length > 0) return { events: [], errors };

      // NOTE: no clamping of the vendor's availability claim — the honest
      // pass-through lets the plane's quartet validation reject clock
      // contradictions with a typed reason instead of silently rewriting
      // the information boundary (L4).
      const sequence = raw.sequence !== undefined ? raw.sequence : (newsSequence += 1);
      if (raw.sequence === undefined) newsSequence = sequence;

      const event: CanonicalEvent = {
        event_id: `news-${raw.news_id}`,
        venue: VENUE,
        instrument: raw.symbols[0] ?? INSTRUMENT,
        asset_class: ASSET_CLASS,
        event_type: 'news',
        event_time: raw.published_ts as TimestampMs,
        // The wire provides a single timestamp — no separate source claim.
        source_time: null,
        available_time: raw.available_ts as TimestampMs,
        ingestion_time: (raw.available_ts + ADVISORY_INGEST_OFFSET) as TimestampMs,
        sequence,
        provider: PROVIDER,
        provenance: {
          origin: 'historical',
          adapter: { id: DESCRIPTOR.id, version: DESCRIPTOR.version },
          derived_from: [],
          transform: null,
        },
        payload: {
          headline: raw.headline as string,
          symbols: [...raw.symbols],
          source: raw.source_label,
          ...(raw.url !== undefined ? { url: raw.url } : {}),
        },
      };
      return { events: [event], errors: [] };
    },
  };
}
