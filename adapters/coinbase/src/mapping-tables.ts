/**
 * @tradrl/adapter-coinbase — the declared mapping tables.
 *
 * Work Order T037: "its own descriptor, schemas, mapping table (Coinbase's
 * ISO timestamp fields + sequence semantics), session, entitlement, rate
 * quota, tests". One table per channel (the session binds each channel's
 * messages to exactly one table); the family is exported as
 * {@link COINBASE_MAPPING_TABLES}.
 *
 * RAW FIELD PROVENANCE, per table:
 *   - "coinbase-level2-snapshot" (channel "level2_batch" ->
 *     book_snapshot): the documented snapshot fields (bids, asks) map
 *     directly — the guard has already turned the documented level arrays
 *     into level records. The message type ("type") and product id
 *     ("product_id") are DECLARED tolerated (schema- and
 *     subscription-consumed — auditable, never silent). Source-time
 *     policy: the documented snapshot message carries NO time field, so
 *     the quartet is honestly receive-time based.
 *   - "coinbase-ticker" (channel "ticker" -> quote): the documented best
 *     bid/ask fields (best_bid, best_bid_size, best_ask, best_ask_size)
 *     map directly; the documented ISO-8601 "time" feeds event_time (the
 *     guard converts it to epoch milliseconds deterministically —
 *     ./iso.ts); availability at the receive time (clamped to >=
 *     event_time). The trade id, sequence (consumed by the session's
 *     sequence tracker), price, last_size and the 24h/30d statistics are
 *     DECLARED tolerated (documented drops — the quote contract carries
 *     only the top of book).
 *   - "coinbase-match" (channel "match" -> trade): the documented price
 *     (price), size (size), taker side (side — the documented aggressor,
 *     mapped through an explicit enum for declared provenance) and trade
 *     id (trade_id) map directly; the documented ISO-8601 "time" feeds
 *     event_time; availability at the receive time. The message type,
 *     sequence (session-consumed), maker/taker order ids and product id
 *     are DECLARED tolerated.
 *
 * Every table is validated (collect-all) and deep-frozen; the
 * unmapped-field law is enforced BOTH here (the guard's documented-schema
 * check) and in the emitter (raw accounting over the normalized payload).
 */

import { validateMappingTable, type MappingTable, type MappingTableValidation } from './contract/mapping';

/** The channel -> table binding (the session's subscription targets). */
export const COINBASE_CHANNEL_TABLE_IDS: Readonly<Record<string, string>> = {
  level2_batch: 'coinbase-level2-snapshot',
  ticker: 'coinbase-ticker',
  match: 'coinbase-match',
};

function declareTable(value: unknown): MappingTable {
  const validation: MappingTableValidation = validateMappingTable(value);
  if (!validation.ok) {
    // Our own declaration — a validation failure is a programming error.
    throw new Error(`the Coinbase mapping table declaration is invalid: ${validation.errors.map((error) => error.message).join('; ')}`);
  }
  return validation.value;
}

/** Channel "level2_batch" (documented book snapshots) -> canonical book_snapshot. */
export const COINBASE_LEVEL2_SNAPSHOT_TABLE: MappingTable = declareTable({
  table_id: 'coinbase-level2-snapshot',
  event_type: 'book_snapshot',
  fields: [
    { raw_field: 'bids', canonical_field: 'bids', transform: { kind: 'levels', price_field: 'price', size_field: 'size' } },
    { raw_field: 'asks', canonical_field: 'asks', transform: { kind: 'levels', price_field: 'price', size_field: 'size' } },
  ],
  constants: [],
  tolerated: ['type', 'product_id'],
  source_time_policy: {
    event_time_basis: 'receive-time',
    event_time_field: null,
    source_time_field: null,
    availability_basis: 'receive-time',
  },
});

/** Channel "ticker" (documented ticker) -> canonical quote. */
export const COINBASE_TICKER_TABLE: MappingTable = declareTable({
  table_id: 'coinbase-ticker',
  event_type: 'quote',
  fields: [
    { raw_field: 'best_bid', canonical_field: 'bid_price', transform: { kind: 'decimal-string' } },
    { raw_field: 'best_bid_size', canonical_field: 'bid_size', transform: { kind: 'decimal-string' } },
    { raw_field: 'best_ask', canonical_field: 'ask_price', transform: { kind: 'decimal-string' } },
    { raw_field: 'best_ask_size', canonical_field: 'ask_size', transform: { kind: 'decimal-string' } },
  ],
  constants: [],
  tolerated: [
    'type',
    'trade_id',
    'sequence', // consumed by the session's documented sequence tracker
    'product_id',
    'price',
    'last_size',
    'open_24h',
    'volume_24h',
    'low_24h',
    'high_24h',
    'volume_30d',
  ],
  source_time_policy: {
    event_time_basis: 'raw-field',
    event_time_field: 'time', // the guard's deterministic ISO->epoch conversion
    source_time_field: null,
    availability_basis: 'receive-time',
  },
});

/** Channel "match" (documented match prints) -> canonical trade. */
export const COINBASE_MATCH_TABLE: MappingTable = declareTable({
  table_id: 'coinbase-match',
  event_type: 'trade',
  fields: [
    { raw_field: 'price', canonical_field: 'price', transform: { kind: 'decimal-string' } },
    { raw_field: 'size', canonical_field: 'size', transform: { kind: 'decimal-string' } },
    {
      raw_field: 'side',
      canonical_field: 'side',
      // Documented semantics: the match message's side is the TAKER order
      // side — the aggressor — which is exactly the canonical side.
      transform: { kind: 'enum', map: { buy: 'buy', sell: 'sell' } },
    },
    { raw_field: 'trade_id', canonical_field: 'trade_id', transform: { kind: 'decimal-string' } },
  ],
  constants: [],
  tolerated: ['type', 'sequence', 'maker_order_id', 'taker_order_id', 'product_id'],
  source_time_policy: {
    event_time_basis: 'raw-field',
    event_time_field: 'time', // the guard's deterministic ISO->epoch conversion
    source_time_field: null,
    availability_basis: 'receive-time',
  },
});

/** The declared mapping table family (one per documented channel). */
export const COINBASE_MAPPING_TABLES: readonly MappingTable[] = [
  COINBASE_LEVEL2_SNAPSHOT_TABLE,
  COINBASE_TICKER_TABLE,
  COINBASE_MATCH_TABLE,
];
