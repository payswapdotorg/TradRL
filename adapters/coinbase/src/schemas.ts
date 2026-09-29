/**
 * @tradrl/adapter-coinbase — documented raw payload schemas (the guard layer).
 *
 * PUBLIC DOCUMENTED SHAPES ONLY (Work Order T037 law: "Public documented
 * shapes only: raw message field names come from the exchanges' PUBLIC API
 * documentation"). The field names and forms below are the documented
 * Coinbase Exchange WebSocket channel payloads this adapter consumes:
 *
 *   - level2_batch (book snapshots): the documented snapshot message
 *     `{ type: "snapshot", product_id, bids, asks }` — bids/asks are
 *     arrays of two-element `[price, size]` string arrays.
 *   - ticker: `{ type: "ticker", trade_id, sequence, time, product_id,
 *     price, last_size, best_bid, best_bid_size, best_ask,
 *     best_ask_size, open_24h, volume_24h, low_24h, high_24h,
 *     volume_30d }` — `time` is an ISO-8601 UTC string; `sequence` is the
 *     documented per-product message sequence.
 *   - matches (trade prints): the documented `match` message
 *     `{ type: "match", trade_id, sequence, maker_order_id,
 *     taker_order_id, time, product_id, size, price, side }` — `side` is
 *     the taker (aggressor) order side: "buy" | "sell".
 *
 * NO licensed or proprietary payloads are consumed or copied
 * (spec/ADAPTERS.md Licensing). Every guard is hand-rolled and total; no
 * `any`. The guard layer's dispositions:
 *
 *   - an extra field the schema does not document  -> typed MappingError
 *     `unmapped_raw_field` (the anti-silent-drop law — never a silent drop);
 *   - a documented field of the wrong shape        -> typed protocol error
 *     `malformed_payload`;
 *   - a documented message type with an undocumented value -> typed
 *     protocol error `unknown_message_type` (e.g. an l2update arriving on
 *     the snapshot-only level2_batch channel).
 *
 * NORMALIZATION (deterministic, provider layer — L2): level arrays become
 * level records `{price, size}`; documented ISO-8601 `time` strings are
 * converted to epoch milliseconds by the hand-rolled deterministic parser
 * (./iso.ts — `Date.parse` is forbidden: implementation-defined for
 * microsecond fractions). Raw field NAMES are preserved wherever the
 * value survives.
 */

import { failure, mappingError, success, type SdkResult } from './contract/errors';
import { isNonEmptyString, isPositiveSafeInteger, isRecord } from './contract/fields';
import { isUnsignedDecimal, isSignedDecimal } from './contract/decimals';
import type { JsonObject, JsonValue } from './contract/json';
import { coinbaseProtocolError } from './protocol';
import { isoToTimestampMs } from './iso';

/** The raw channel names of the Coinbase Exchange streams this adapter consumes. */
export const COINBASE_CHANNELS: readonly string[] = ['level2_batch', 'ticker', 'match'];

/**
 * The documented raw field names across the consumed channels — the
 * provider vocabulary. It lives ONLY in the adapter's declaration layers
 * (schemas, mapping tables, descriptors); the inverse-neutrality
 * trip-wire test asserts none of the provider-ONLY names ever appears as
 * a field of an emitted CANONICAL event (L2: "a canonical event carrying
 * a provider-specific field name is a violation"). Names that the
 * canonical contracts share ("bids", "asks", "price", "size", "side",
 * "trade_id", "time") are annotated as shared and excluded from the
 * banned set by the test.
 */
export const COINBASE_RAW_FIELD_NAMES: readonly string[] = [
  'type',
  'product_id',
  'bids',
  'asks',
  'trade_id',
  'sequence',
  'time',
  'price',
  'last_size',
  'best_bid',
  'best_bid_size',
  'best_ask',
  'best_ask_size',
  'open_24h',
  'volume_24h',
  'low_24h',
  'high_24h',
  'volume_30d',
  'size',
  'side',
  'maker_order_id',
  'taker_order_id',
];

/** One normalized level record (the mapping table's declared level form). */
export interface NormalizedLevel {
  readonly price: string;
  readonly size: string;
}

function malformed(channel: string, detail: string): SdkResult<never> {
  return failure(coinbaseProtocolError('malformed_payload', `channel "${channel}": ${detail}`));
}

function unknownMessageType(channel: string, documented: readonly string[], actual: string): SdkResult<never> {
  return failure(
    coinbaseProtocolError(
      'unknown_message_type',
      `channel "${channel}": message type "${actual}" is not one of the documented types (${documented.join(' | ')}) — the adapter refuses undocumented message shapes`,
    ),
  );
}

function unmappedField(channel: string, field: string): SdkResult<never> {
  return failure(
    mappingError(
      'unmapped_raw_field',
      `raw field "${field}" on channel "${channel}" is not accounted for by the documented schema or the mapping table — map it, tolerate it explicitly, or fix the feed; silent drops are unrepresentable`,
    ),
  );
}

/** Assert the payload's keys are exactly a subset of the documented set (extras are unmapped fields). */
function rejectUndocumentedKeys(channel: string, payload: Record<string, unknown>, documented: readonly string[]): SdkResult<never> | null {
  for (const key of Object.keys(payload).sort()) {
    if (!documented.includes(key)) {
      return unmappedField(channel, key);
    }
  }
  return null;
}

/** Require a documented field to be present. */
function requireField(channel: string, payload: Record<string, unknown>, field: string): SdkResult<never> | null {
  if (payload[field] === undefined) {
    return malformed(channel, `the documented field "${field}" is missing`);
  }
  return null;
}

/** Validate and translate one documented level array into normalized level records. */
function guardLevels(channel: string, field: string, value: unknown): SdkResult<readonly NormalizedLevel[]> {
  if (!Array.isArray(value)) {
    return malformed(channel, `field "${field}" must be an array of [price, size] string pairs`);
  }
  const levels: NormalizedLevel[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const level = value[index];
    if (!Array.isArray(level) || level.length !== 2) {
      return malformed(channel, `field "${field}"[${index}] must be a two-element [price, size] array`);
    }
    const price = level[0];
    const size = level[1];
    if (typeof price !== 'string' || !isUnsignedDecimal(price)) {
      return malformed(channel, `field "${field}"[${index}] price must be a decimal string (got ${typeof price === 'string' ? `"${price}"` : String(price)})`);
    }
    if (typeof size !== 'string' || !isUnsignedDecimal(size)) {
      return malformed(channel, `field "${field}"[${index}] size must be a decimal string (got ${typeof size === 'string' ? `"${size}"` : String(size)})`);
    }
    levels.push({ price, size });
  }
  return success(levels);
}

/** Validate a positive safe integer field (trade ids, sequences). */
function guardPositiveInteger(channel: string, field: string, value: unknown): SdkResult<number> {
  if (!isPositiveSafeInteger(value)) {
    return malformed(channel, `field "${field}" must be a positive integer (got ${String(value)})`);
  }
  return success(value);
}

/** Validate a decimal-string field (prices, sizes). */
function guardDecimalString(channel: string, field: string, value: unknown): SdkResult<string> {
  if (typeof value !== 'string' || !isUnsignedDecimal(value)) {
    return malformed(channel, `field "${field}" must be a decimal string (got ${typeof value === 'string' ? `"${value}"` : String(value)})`);
  }
  return success(value);
}

/** Validate a signed decimal-string field (24h statistics may be negative). */
function guardSignedDecimalString(channel: string, field: string, value: unknown): SdkResult<string> {
  if (typeof value !== 'string' || !isSignedDecimal(value)) {
    return malformed(channel, `field "${field}" must be a signed decimal string (got ${typeof value === 'string' ? `"${value}"` : String(value)})`);
  }
  return success(value);
}

/** Validate a documented ISO-8601 UTC time field and convert it to epoch milliseconds. */
function guardIsoTime(channel: string, field: string, value: unknown): SdkResult<number> {
  if (typeof value !== 'string' || value.length === 0) {
    return malformed(channel, `field "${field}" must be an ISO-8601 UTC timestamp string (got ${typeof value === 'string' ? `"${value}"` : String(value)})`);
  }
  const converted = isoToTimestampMs(value);
  if (!converted.ok) {
    return failure(coinbaseProtocolError('malformed_payload', `channel "${channel}": ${converted.error.message}`));
  }
  return success(converted.value);
}

// ---------------------------------------------------------------------------
// Channel schemas: documented raw payload -> validated, normalized payload.
// ---------------------------------------------------------------------------

/** The documented level2_batch snapshot payload fields. */
const LEVEL2_BATCH_FIELDS: readonly string[] = ['type', 'product_id', 'bids', 'asks'];

/** The validated, normalized level2_batch snapshot payload. */
export interface NormalizedLevel2Snapshot {
  readonly type: 'snapshot';
  readonly product_id: string;
  readonly bids: readonly NormalizedLevel[];
  readonly asks: readonly NormalizedLevel[];
}

/**
 * Channel "level2_batch" — the documented book snapshot message:
 * `{ type: "snapshot", product_id, bids, asks }` (levels are `[price,
 * size]` pairs). Normalized: level arrays become level records. An
 * l2update-style message on this channel is a typed unknown_message_type
 * (this adapter's level2_batch carries snapshots only, per the work
 * order's channel scoping).
 */
export function guardLevel2BatchPayload(payload: JsonObject): SdkResult<NormalizedLevel2Snapshot> {
  const channel = 'level2_batch';
  const record = payload as Record<string, unknown>;
  const extra = rejectUndocumentedKeys(channel, record, LEVEL2_BATCH_FIELDS);
  if (extra !== null) return extra;

  for (const field of LEVEL2_BATCH_FIELDS) {
    const missing = requireField(channel, record, field);
    if (missing !== null) return missing;
  }

  if (typeof record.type !== 'string' || record.type !== 'snapshot') {
    return unknownMessageType(channel, ['snapshot'], String(record.type));
  }
  if (!isNonEmptyString(record.product_id)) {
    return malformed(channel, 'field "product_id" must be a non-empty string');
  }
  const bids = guardLevels(channel, 'bids', record.bids);
  if (!bids.ok) return bids;
  const asks = guardLevels(channel, 'asks', record.asks);
  if (!asks.ok) return asks;

  return success({
    type: 'snapshot',
    product_id: record.product_id,
    bids: bids.value,
    asks: asks.value,
  });
}

/** The documented ticker payload fields. */
const TICKER_FIELDS: readonly string[] = [
  'type',
  'trade_id',
  'sequence',
  'time',
  'product_id',
  'price',
  'last_size',
  'best_bid',
  'best_bid_size',
  'best_ask',
  'best_ask_size',
  'open_24h',
  'volume_24h',
  'low_24h',
  'high_24h',
  'volume_30d',
];

/** The validated, normalized ticker payload (documented names; `time` as epoch ms). */
export interface NormalizedTicker {
  readonly type: 'ticker';
  readonly trade_id: number;
  readonly sequence: number;
  readonly time: number;
  readonly product_id: string;
  readonly price: string;
  readonly last_size: string;
  readonly best_bid: string;
  readonly best_bid_size: string;
  readonly best_ask: string;
  readonly best_ask_size: string;
  readonly open_24h: string;
  readonly volume_24h: string;
  readonly low_24h: string;
  readonly high_24h: string;
  readonly volume_30d: string;
}

/**
 * Channel "ticker" — the documented ticker message. Normalized: the
 * documented ISO-8601 `time` becomes epoch milliseconds (deterministic
 * conversion — ./iso.ts); every other documented field keeps its name and
 * value (the unconsumed statistics are the mapping table's declared
 * tolerated fields).
 */
export function guardTickerPayload(payload: JsonObject): SdkResult<NormalizedTicker> {
  const channel = 'ticker';
  const record = payload as Record<string, unknown>;
  const extra = rejectUndocumentedKeys(channel, record, TICKER_FIELDS);
  if (extra !== null) return extra;

  for (const field of TICKER_FIELDS) {
    const missing = requireField(channel, record, field);
    if (missing !== null) return missing;
  }

  if (typeof record.type !== 'string' || record.type !== 'ticker') {
    return unknownMessageType(channel, ['ticker'], String(record.type));
  }
  const tradeId = guardPositiveInteger(channel, 'trade_id', record.trade_id);
  if (!tradeId.ok) return tradeId;
  const sequence = guardPositiveInteger(channel, 'sequence', record.sequence);
  if (!sequence.ok) return sequence;
  const time = guardIsoTime(channel, 'time', record.time);
  if (!time.ok) return time;
  if (!isNonEmptyString(record.product_id)) {
    return malformed(channel, 'field "product_id" must be a non-empty string');
  }
  for (const field of ['price', 'last_size', 'best_bid', 'best_bid_size', 'best_ask', 'best_ask_size', 'volume_24h', 'low_24h', 'high_24h', 'volume_30d'] as const) {
    const decimal = guardDecimalString(channel, field, record[field]);
    if (!decimal.ok) return decimal;
  }
  const open24h = guardSignedDecimalString(channel, 'open_24h', record.open_24h);
  if (!open24h.ok) return open24h;

  return success({
    type: 'ticker',
    trade_id: tradeId.value,
    sequence: sequence.value,
    time: time.value,
    product_id: record.product_id,
    price: record.price as string,
    last_size: record.last_size as string,
    best_bid: record.best_bid as string,
    best_bid_size: record.best_bid_size as string,
    best_ask: record.best_ask as string,
    best_ask_size: record.best_ask_size as string,
    open_24h: open24h.value,
    volume_24h: record.volume_24h as string,
    low_24h: record.low_24h as string,
    high_24h: record.high_24h as string,
    volume_30d: record.volume_30d as string,
  });
}

/** The documented match payload fields. */
const MATCH_FIELDS: readonly string[] = [
  'type',
  'trade_id',
  'sequence',
  'maker_order_id',
  'taker_order_id',
  'time',
  'product_id',
  'size',
  'price',
  'side',
];

/** The validated, normalized match payload (documented names; `time` as epoch ms). */
export interface NormalizedMatch {
  readonly type: 'match';
  readonly trade_id: number;
  readonly sequence: number;
  readonly maker_order_id: string;
  readonly taker_order_id: string;
  readonly time: number;
  readonly product_id: string;
  readonly size: string;
  readonly price: string;
  readonly side: 'buy' | 'sell';
}

/**
 * Channel "match" — the documented match (trade print) message. The
 * documented `side` is the TAKER (aggressor) order side, which is exactly
 * the canonical trade side; the mapping table carries it through an
 * explicit enum (declared provenance, not an implicit pass-through).
 * Normalized: the documented ISO-8601 `time` becomes epoch milliseconds.
 */
export function guardMatchPayload(payload: JsonObject): SdkResult<NormalizedMatch> {
  const channel = 'match';
  const record = payload as Record<string, unknown>;
  const extra = rejectUndocumentedKeys(channel, record, MATCH_FIELDS);
  if (extra !== null) return extra;

  for (const field of MATCH_FIELDS) {
    const missing = requireField(channel, record, field);
    if (missing !== null) return missing;
  }

  if (typeof record.type !== 'string' || record.type !== 'match') {
    return unknownMessageType(channel, ['match'], String(record.type));
  }
  const tradeId = guardPositiveInteger(channel, 'trade_id', record.trade_id);
  if (!tradeId.ok) return tradeId;
  const sequence = guardPositiveInteger(channel, 'sequence', record.sequence);
  if (!sequence.ok) return sequence;
  if (!isNonEmptyString(record.maker_order_id)) {
    return malformed(channel, 'field "maker_order_id" must be a non-empty order id string');
  }
  if (!isNonEmptyString(record.taker_order_id)) {
    return malformed(channel, 'field "taker_order_id" must be a non-empty order id string');
  }
  const time = guardIsoTime(channel, 'time', record.time);
  if (!time.ok) return time;
  if (!isNonEmptyString(record.product_id)) {
    return malformed(channel, 'field "product_id" must be a non-empty string');
  }
  const size = guardDecimalString(channel, 'size', record.size);
  if (!size.ok) return size;
  const price = guardDecimalString(channel, 'price', record.price);
  if (!price.ok) return price;
  if (record.side !== 'buy' && record.side !== 'sell') {
    return malformed(channel, `field "side" must be the documented taker side "buy" or "sell" (got ${String(record.side)})`);
  }

  return success({
    type: 'match',
    trade_id: tradeId.value,
    sequence: sequence.value,
    maker_order_id: record.maker_order_id,
    taker_order_id: record.taker_order_id,
    time: time.value,
    product_id: record.product_id,
    size: size.value,
    price: price.value,
    side: record.side,
  });
}

/**
 * Guard and normalize the payload of a message on one of the adapter's
 * documented channels, returning the NORMALIZED payload (the emitter's
 * input). Channels WITHOUT a documented schema pass through verbatim —
 * the session's routing (unknown_channel) owns unsubscribed channels.
 */
export function guardCoinbasePayload(channel: string, payload: JsonObject): SdkResult<JsonObject> {
  if (channel === 'level2_batch') {
    const snapshot = guardLevel2BatchPayload(payload);
    if (!snapshot.ok) return snapshot;
    return success({
      type: snapshot.value.type,
      product_id: snapshot.value.product_id,
      bids: snapshot.value.bids as unknown as JsonValue,
      asks: snapshot.value.asks as unknown as JsonValue,
    });
  }
  if (channel === 'ticker') {
    const ticker = guardTickerPayload(payload);
    if (!ticker.ok) return ticker;
    return success(ticker.value as unknown as JsonObject);
  }
  if (channel === 'match') {
    const match = guardMatchPayload(payload);
    if (!match.ok) return match;
    return success(match.value as unknown as JsonObject);
  }
  return success(payload);
}

/** Structural guard for the normalized ticker payload (introspection). */
export function isNormalizedTicker(value: unknown): value is NormalizedTicker {
  return (
    isRecord(value) &&
    value.type === 'ticker' &&
    isPositiveSafeInteger(value.trade_id) &&
    isPositiveSafeInteger(value.sequence) &&
    isPositiveSafeInteger(value.time) &&
    isNonEmptyString(value.product_id)
  );
}

/** Structural guard for the normalized match payload (introspection). */
export function isNormalizedMatch(value: unknown): value is NormalizedMatch {
  return (
    isRecord(value) &&
    value.type === 'match' &&
    isPositiveSafeInteger(value.trade_id) &&
    isPositiveSafeInteger(value.sequence) &&
    isPositiveSafeInteger(value.time) &&
    isNonEmptyString(value.product_id) &&
    (value.side === 'buy' || value.side === 'sell')
  );
}
