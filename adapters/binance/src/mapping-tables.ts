/**
 * @tradrl/adapter-binance — the declared mapping tables.
 *
 * Work Order T037: "BINANCE_MAPPING_TABLE — every consumed raw field ->
 * canonical field with the source-time policy; unknown raw field =
 * MappingError (never silently dropped)". One table per channel (the
 * session binds each channel's messages to exactly one table); the family
 * is exported as {@link BINANCE_MAPPING_TABLES}.
 *
 * RAW FIELD PROVENANCE, per table:
 *   - "binance-depth-snapshot" (channel "depth" -> book_snapshot): the
 *     documented partial-depth fields (lastUpdateId, bids, asks) map
 *     directly — the guard has already turned the documented level arrays
 *     into level records. Source-time policy: the documented partial
 *     depth payload carries NO time field, so the quartet is honestly
 *     receive-time based (event_time = available_time = ingestion_time =
 *     the receive instant).
 *   - "binance-depth-diff" (channel "depthDiff" -> book_delta): the
 *     emitter consumes the guard's split sub-messages ({action, levels,
 *     u, E}). `u` and `E` keep their documented names (final update id,
 *     event time); `action`/`levels` are the guard's split of the
 *     documented two-sided `b`/`a` level arrays (the canonical book_delta
 *     is side-less and action-homogeneous by contract — see
 *     contracts/market/02-event-type-taxonomy.md). The remaining
 *     documented fields (e, s, U) are consumed by the guard's schema and
 *     update-id sequencing checks — accounted for THERE, never silently
 *     dropped. Source-time policy: event_time from the documented `E`;
 *     availability at the receive time (clamped to >= event_time).
 *   - "binance-book-ticker" (channel "bookTicker" -> quote): the
 *     documented best bid/ask fields (b, B, a, A) map directly; the
 *     documented update id (u) and symbol (s) are DECLARED tolerated —
 *     the quote contract has no continuity token and the stream identity
 *     is bound by the subscription. Source-time policy: the documented
 *     bookTicker payload carries NO time field — receive-time quartet,
 *     honestly.
 *   - "binance-trade" (channel "trade" -> trade): the documented price
 *     (p), quantity (q) and trade id (t) map directly; the documented
 *     boolean m ("is the buyer the market maker") is normalized by the
 *     guard to 'true'|'false' and mapped through an enum carrying the
 *     documented aggressor semantics (buyer is maker -> the aggressor
 *     sold). Source-time policy: event_time from the documented trade
 *     time (T); source_time from the documented event time (E) — the
 *     vendor-claimed generation instant; availability at the receive
 *     time. The event-type discriminator (e) and symbol (s) are declared
 *     tolerated (schema- and subscription-consumed).
 *
 * Every table is validated (collect-all) and deep-frozen; the
 * unmapped-field law is enforced BOTH here (the guard's documented-schema
 * check) and in the emitter (raw accounting over the normalized payload).
 */

import { validateMappingTable, type MappingTable, type MappingTableValidation } from './contract/mapping';

/** The channel -> table binding (the session's subscription targets). */
export const BINANCE_CHANNEL_TABLE_IDS: Readonly<Record<string, string>> = {
  depth: 'binance-depth-snapshot',
  depthDiff: 'binance-depth-diff',
  bookTicker: 'binance-book-ticker',
  trade: 'binance-trade',
};

function declareTable(value: unknown): MappingTable {
  const validation: MappingTableValidation = validateMappingTable(value);
  if (!validation.ok) {
    // Our own declaration — a validation failure is a programming error.
    throw new Error(`the Binance mapping table declaration is invalid: ${validation.errors.map((error) => error.message).join('; ')}`);
  }
  return validation.value;
}

/** Channel "depth" (documented partial book depth) -> canonical book_snapshot. */
export const BINANCE_DEPTH_SNAPSHOT_TABLE: MappingTable = declareTable({
  table_id: 'binance-depth-snapshot',
  event_type: 'book_snapshot',
  fields: [
    { raw_field: 'lastUpdateId', canonical_field: 'last_update_id', transform: { kind: 'decimal-string' } },
    { raw_field: 'bids', canonical_field: 'bids', transform: { kind: 'levels', price_field: 'price', size_field: 'size' } },
    { raw_field: 'asks', canonical_field: 'asks', transform: { kind: 'levels', price_field: 'price', size_field: 'size' } },
  ],
  constants: [],
  tolerated: [],
  source_time_policy: {
    event_time_basis: 'receive-time',
    event_time_field: null,
    source_time_field: null,
    availability_basis: 'receive-time',
  },
});

/** Channel "depthDiff" (documented order book depth diff, guard-split) -> canonical book_delta. */
export const BINANCE_DEPTH_DIFF_TABLE: MappingTable = declareTable({
  table_id: 'binance-depth-diff',
  event_type: 'book_delta',
  fields: [
    { raw_field: 'action', canonical_field: 'action', transform: { kind: 'identity' } },
    { raw_field: 'levels', canonical_field: 'levels', transform: { kind: 'levels', price_field: 'price', size_field: 'size' } },
    { raw_field: 'u', canonical_field: 'last_update_id', transform: { kind: 'decimal-string' } },
  ],
  constants: [],
  tolerated: [],
  source_time_policy: {
    event_time_basis: 'raw-field',
    event_time_field: 'E',
    source_time_field: null,
    availability_basis: 'receive-time',
  },
});

/** Channel "bookTicker" (documented individual symbol book ticker) -> canonical quote. */
export const BINANCE_BOOK_TICKER_TABLE: MappingTable = declareTable({
  table_id: 'binance-book-ticker',
  event_type: 'quote',
  fields: [
    { raw_field: 'b', canonical_field: 'bid_price', transform: { kind: 'decimal-string' } },
    { raw_field: 'B', canonical_field: 'bid_size', transform: { kind: 'decimal-string' } },
    { raw_field: 'a', canonical_field: 'ask_price', transform: { kind: 'decimal-string' } },
    { raw_field: 'A', canonical_field: 'ask_size', transform: { kind: 'decimal-string' } },
  ],
  constants: [],
  tolerated: ['u', 's'],
  source_time_policy: {
    event_time_basis: 'receive-time',
    event_time_field: null,
    source_time_field: null,
    availability_basis: 'receive-time',
  },
});

/** Channel "trade" (documented trade stream) -> canonical trade. */
export const BINANCE_TRADE_TABLE: MappingTable = declareTable({
  table_id: 'binance-trade',
  event_type: 'trade',
  fields: [
    { raw_field: 'p', canonical_field: 'price', transform: { kind: 'decimal-string' } },
    { raw_field: 'q', canonical_field: 'size', transform: { kind: 'decimal-string' } },
    { raw_field: 't', canonical_field: 'trade_id', transform: { kind: 'decimal-string' } },
    {
      raw_field: 'm',
      canonical_field: 'side',
      transform: {
        kind: 'enum',
        // Documented semantics: m true = the buyer is the market maker, so
        // the AGGRESSOR sold; m false = the buyer was the aggressor.
        map: { true: 'sell', false: 'buy' },
      },
    },
  ],
  constants: [],
  tolerated: ['e', 's'],
  source_time_policy: {
    event_time_basis: 'raw-field',
    event_time_field: 'T',
    source_time_field: 'E',
    availability_basis: 'receive-time',
  },
});

/** The declared mapping table family (one per documented channel). */
export const BINANCE_MAPPING_TABLES: readonly MappingTable[] = [
  BINANCE_DEPTH_SNAPSHOT_TABLE,
  BINANCE_DEPTH_DIFF_TABLE,
  BINANCE_BOOK_TICKER_TABLE,
  BINANCE_TRADE_TABLE,
];
