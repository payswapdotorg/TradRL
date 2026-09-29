/**
 * @tradrl/adapter-binance — documented raw payload schemas (the guard layer).
 *
 * PUBLIC DOCUMENTED SHAPES ONLY (Work Order T037 law: "Public documented
 * shapes only: raw message field names come from the exchanges' PUBLIC API
 * documentation"). The field names and forms below are the documented
 * Binance spot stream payloads:
 *
 *   - Partial Book Depth stream (`<symbol>@depth<levels>@<speed>`, channel
 *     "depth"): `{ lastUpdateId, bids, asks }` — bids/asks are arrays of
 *     two-element `[price, quantity]` string arrays.
 *   - Order Book Depth diff stream (`<symbol>@depth@<speed>`, channel
 *     "depthDiff"): `{ e: "depthUpdate", E, s, U, u, b, a }` — b/a are
 *     two-element level arrays; U/u are the first/final update ids of the
 *     event's range.
 *   - Individual Symbol Book Ticker stream (`<symbol>@bookTicker`, channel
 *     "bookTicker"): `{ u, s, b, B, a, A }` — best bid price/qty and best
 *     ask price/qty as decimal strings; u is the update id.
 *   - Trade stream (`<symbol>@trade`, channel "trade"):
 *     `{ e: "trade", E, s, t, p, q, T, m }` — t trade id, p price, q
 *     quantity, T trade time, m "is the buyer the market maker".
 *
 * NO licensed or proprietary payloads are consumed or copied
 * (spec/ADAPTERS.md Licensing). Every guard is hand-rolled and total; no
 * `any`. The guard layer's dispositions:
 *
 *   - an extra field the schema does not document  -> typed MappingError
 *     `unmapped_raw_field` (the anti-silent-drop law — never a silent drop);
 *   - a documented field of the wrong shape        -> typed protocol error
 *     `malformed_payload`;
 *   - a documented event-type discriminator with an
 *     undocumented value                          -> typed protocol error
 *     `unknown_message_type`.
 *
 * NORMALIZATION (deterministic, provider layer — L2): the guard translates
 * the documented forms into the representation the mapping tables
 * declare: level arrays become level records `{price, size}`; the boolean
 * `m` becomes the string `'true' | 'false'` (the enum transform's declared
 * input form). Raw field NAMES are preserved wherever the value survives.
 */

import { failure, mappingError, success, type AdapterError, type SdkResult } from './contract/errors';
import { isNonEmptyString, isPositiveSafeInteger, isRecord } from './contract/fields';
import { isUnsignedDecimal, compareDecimal } from './contract/decimals';
import type { JsonObject, JsonValue } from './contract/json';
import { binanceProtocolError } from './protocol';

/** The raw channel names of the Binance spot streams this adapter consumes. */
export const BINANCE_CHANNELS: readonly string[] = ['depth', 'depthDiff', 'bookTicker', 'trade'];

/**
 * The documented raw field names across the consumed streams — the
 * provider vocabulary. It lives ONLY in the adapter's declaration layers
 * (schemas, mapping tables, descriptors); the inverse-neutrality trip-wire
 * test asserts none of these names ever appears as a field of an emitted
 * CANONICAL event (L2: "a canonical event carrying a provider-specific
 * field name is a violation").
 */
export const BINANCE_RAW_FIELD_NAMES: readonly string[] = [
  'lastUpdateId',
  'bids',
  'asks',
  'e',
  'E',
  's',
  'U',
  'u',
  'b',
  'a',
  'B',
  'A',
  't',
  'p',
  'q',
  'T',
  'm',
];

/** The documented event-type discriminators, per channel. */
const DEPTH_DIFF_EVENT_TYPE = 'depthUpdate';
const TRADE_EVENT_TYPE = 'trade';

/** One normalized level record (the mapping table's declared level form). */
export interface NormalizedLevel {
  readonly price: string;
  readonly size: string;
}

function malformed(channel: string, detail: string): AdapterError {
  return binanceProtocolError('malformed_payload', `channel "${channel}": ${detail}`);
}

function unknownMessageType(channel: string, documented: readonly string[], actual: string): AdapterError {
  return binanceProtocolError(
    'unknown_message_type',
    `channel "${channel}": message type "${actual}" is not one of the documented types (${documented.join(' | ')}) — the adapter refuses undocumented message shapes`,
  );
}

function unmappedField(channel: string, field: string): AdapterError {
  return mappingError(
    'unmapped_raw_field',
    `raw field "${field}" on channel "${channel}" is not accounted for by the documented schema or the mapping table — map it, tolerate it explicitly, or fix the feed; silent drops are unrepresentable`,
  );
}

/** Assert the payload's keys are exactly a subset of the documented set (extras are unmapped fields). */
function rejectUndocumentedKeys(channel: string, payload: Record<string, unknown>, documented: readonly string[]): AdapterError | null {
  for (const key of Object.keys(payload).sort()) {
    if (!documented.includes(key)) {
      return unmappedField(channel, key);
    }
  }
  return null;
}

/** Require a documented field to be present. */
function requireField(channel: string, payload: Record<string, unknown>, field: string): AdapterError | null {
  if (payload[field] === undefined) {
    return malformed(channel, `the documented field "${field}" is missing`);
  }
  return null;
}

/** Validate and translate one documented level array into normalized level records. */
function guardLevels(channel: string, field: string, value: unknown): SdkResult<readonly NormalizedLevel[]> {
  if (!Array.isArray(value)) {
    return failure(malformed(channel, `field "${field}" must be an array of [price, quantity] string pairs`));
  }
  const levels: NormalizedLevel[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const level = value[index];
    if (!Array.isArray(level) || level.length !== 2) {
      return failure(malformed(channel, `field "${field}"[${index}] must be a two-element [price, quantity] array`));
    }
    const price = level[0];
    const size = level[1];
    if (typeof price !== 'string' || !isUnsignedDecimal(price)) {
      return failure(malformed(channel, `field "${field}"[${index}] price must be a decimal string (got ${typeof price === 'string' ? `"${price}"` : String(price)})`));
    }
    if (typeof size !== 'string' || !isUnsignedDecimal(size)) {
      return failure(malformed(channel, `field "${field}"[${index}] quantity must be a decimal string (got ${typeof size === 'string' ? `"${size}"` : String(size)})`));
    }
    levels.push({ price, size });
  }
  return success(levels);
}

/** Validate a positive safe integer field (update ids, event times, trade ids). */
function guardPositiveInteger(channel: string, field: string, value: unknown): SdkResult<number> {
  if (!isPositiveSafeInteger(value)) {
    return failure(malformed(channel, `field "${field}" must be a positive integer (got ${String(value)})`));
  }
  return success(value);
}

/** Validate a decimal-string field (prices, quantities). */
function guardDecimalString(channel: string, field: string, value: unknown): SdkResult<string> {
  if (typeof value !== 'string' || !isUnsignedDecimal(value)) {
    return failure(malformed(channel, `field "${field}" must be a decimal string (got ${typeof value === 'string' ? `"${value}"` : String(value)})`));
  }
  return success(value);
}

// ---------------------------------------------------------------------------
// Channel schemas: documented raw payload -> validated, normalized payload.
// ---------------------------------------------------------------------------

/** The documented partial-depth payload fields (channel "depth"). */
const DEPTH_FIELDS: readonly string[] = ['lastUpdateId', 'bids', 'asks'];

/**
 * Channel "depth" — the documented Partial Book Depth stream payload:
 * `{ lastUpdateId, bids, asks }` (levels are `[price, quantity]` pairs).
 * Normalized: level arrays become level records; the documented names are
 * preserved (the mapping table maps them).
 */
export function guardDepthPayload(payload: JsonObject): SdkResult<JsonObject> {
  const channel = 'depth';
  const record = payload as Record<string, unknown>;
  const extra = rejectUndocumentedKeys(channel, record, DEPTH_FIELDS);
  if (extra !== null) return failure(extra);

  for (const field of DEPTH_FIELDS) {
    const missing = requireField(channel, record, field);
    if (missing !== null) return failure(missing);
  }

  const lastUpdateId = guardPositiveInteger(channel, 'lastUpdateId', record.lastUpdateId);
  if (!lastUpdateId.ok) return lastUpdateId;
  const bids = guardLevels(channel, 'bids', record.bids);
  if (!bids.ok) return bids;
  const asks = guardLevels(channel, 'asks', record.asks);
  if (!asks.ok) return asks;

  return success({
    lastUpdateId: lastUpdateId.value,
    bids: bids.value as unknown as JsonValue,
    asks: asks.value as unknown as JsonValue,
  });
}

/** The documented depth-diff payload fields (channel "depthDiff"). */
const DEPTH_DIFF_FIELDS: readonly string[] = ['e', 'E', 's', 'U', 'u', 'b', 'a'];

/** The validated, normalized depth-diff payload (documented names, level records). */
export interface NormalizedDepthDiff {
  readonly e: 'depthUpdate';
  readonly E: number;
  readonly s: string;
  readonly U: number;
  readonly u: number;
  readonly b: readonly NormalizedLevel[];
  readonly a: readonly NormalizedLevel[];
}

/**
 * Channel "depthDiff" — the documented Order Book Depth diff stream
 * payload: `{ e: "depthUpdate", E, s, U, u, b, a }`. Normalized: level
 * arrays become level records; `U <= u` (the documented range invariant)
 * is enforced here as a shape law.
 */
export function guardDepthDiffPayload(payload: JsonObject): SdkResult<NormalizedDepthDiff> {
  const channel = 'depthDiff';
  const record = payload as Record<string, unknown>;
  const extra = rejectUndocumentedKeys(channel, record, DEPTH_DIFF_FIELDS);
  if (extra !== null) return failure(extra);

  for (const field of DEPTH_DIFF_FIELDS) {
    const missing = requireField(channel, record, field);
    if (missing !== null) return failure(missing);
  }

  if (typeof record.e !== 'string' || record.e !== DEPTH_DIFF_EVENT_TYPE) {
    return failure(unknownMessageType(channel, [DEPTH_DIFF_EVENT_TYPE], String(record.e)));
  }
  const eventTime = guardPositiveInteger(channel, 'E', record.E);
  if (!eventTime.ok) return eventTime;
  if (!isNonEmptyString(record.s)) {
    return failure(malformed(channel, 'field "s" must be a non-empty symbol string'));
  }
  const firstUpdateId = guardPositiveInteger(channel, 'U', record.U);
  if (!firstUpdateId.ok) return firstUpdateId;
  const finalUpdateId = guardPositiveInteger(channel, 'u', record.u);
  if (!finalUpdateId.ok) return finalUpdateId;
  if (firstUpdateId.value > finalUpdateId.value) {
    return failure(malformed(channel, `field "U" (${firstUpdateId.value}) exceeds "u" (${finalUpdateId.value}) — the documented update-id range is [U, u]`));
  }
  const bids = guardLevels(channel, 'b', record.b);
  if (!bids.ok) return bids;
  const asks = guardLevels(channel, 'a', record.a);
  if (!asks.ok) return asks;

  return success({
    e: DEPTH_DIFF_EVENT_TYPE,
    E: eventTime.value,
    s: record.s,
    U: firstUpdateId.value,
    u: finalUpdateId.value,
    b: bids.value,
    a: asks.value,
  });
}

/** The documented bookTicker payload fields (channel "bookTicker"). */
const BOOK_TICKER_FIELDS: readonly string[] = ['u', 's', 'b', 'B', 'a', 'A'];

/**
 * Channel "bookTicker" — the documented Individual Symbol Book Ticker
 * payload: `{ u, s, b, B, a, A }` (best bid/ask price and quantity as
 * decimal strings). No normalization is needed: every value is already in
 * the mapping table's declared form; all documented fields are passed
 * through (u and s are the mapping table's declared tolerated fields).
 */
export function guardBookTickerPayload(payload: JsonObject): SdkResult<JsonObject> {
  const channel = 'bookTicker';
  const record = payload as Record<string, unknown>;
  const extra = rejectUndocumentedKeys(channel, record, BOOK_TICKER_FIELDS);
  if (extra !== null) return failure(extra);

  for (const field of BOOK_TICKER_FIELDS) {
    const missing = requireField(channel, record, field);
    if (missing !== null) return failure(missing);
  }

  const updateId = guardPositiveInteger(channel, 'u', record.u);
  if (!updateId.ok) return updateId;
  if (!isNonEmptyString(record.s)) {
    return failure(malformed(channel, 'field "s" must be a non-empty symbol string'));
  }
  for (const field of ['b', 'B', 'a', 'A'] as const) {
    const decimal = guardDecimalString(channel, field, record[field]);
    if (!decimal.ok) return decimal;
  }
  return success({ ...record } as JsonObject);
}

/** The documented trade payload fields (channel "trade"). */
const TRADE_FIELDS: readonly string[] = ['e', 'E', 's', 't', 'p', 'q', 'T', 'm'];

/** The validated, normalized trade payload (documented names; `m` as 'true'|'false'). */
export interface NormalizedTrade {
  readonly e: 'trade';
  readonly E: number;
  readonly s: string;
  readonly t: number;
  readonly p: string;
  readonly q: string;
  readonly T: number;
  readonly m: 'true' | 'false';
}

/**
 * Channel "trade" — the documented Trade stream payload:
 * `{ e: "trade", E, s, t, p, q, T, m }`. Normalized: the boolean `m` ("is
 * the buyer the market maker") becomes the string `'true' | 'false'` —
 * the enum transform's declared input form; the mapping table's enum
 * carries the documented aggressor-side semantics (m true -> the buyer is
 * the maker -> the aggressor sold).
 */
export function guardTradePayload(payload: JsonObject): SdkResult<NormalizedTrade> {
  const channel = 'trade';
  const record = payload as Record<string, unknown>;
  const extra = rejectUndocumentedKeys(channel, record, TRADE_FIELDS);
  if (extra !== null) return failure(extra);

  for (const field of TRADE_FIELDS) {
    const missing = requireField(channel, record, field);
    if (missing !== null) return failure(missing);
  }

  if (typeof record.e !== 'string' || record.e !== TRADE_EVENT_TYPE) {
    return failure(unknownMessageType(channel, [TRADE_EVENT_TYPE], String(record.e)));
  }
  const eventTime = guardPositiveInteger(channel, 'E', record.E);
  if (!eventTime.ok) return eventTime;
  if (!isNonEmptyString(record.s)) {
    return failure(malformed(channel, 'field "s" must be a non-empty symbol string'));
  }
  const tradeId = guardPositiveInteger(channel, 't', record.t);
  if (!tradeId.ok) return tradeId;
  const price = guardDecimalString(channel, 'p', record.p);
  if (!price.ok) return price;
  const quantity = guardDecimalString(channel, 'q', record.q);
  if (!quantity.ok) return quantity;
  const tradeTime = guardPositiveInteger(channel, 'T', record.T);
  if (!tradeTime.ok) return tradeTime;
  if (typeof record.m !== 'boolean') {
    return failure(malformed(channel, `field "m" must be a boolean ("is the buyer the market maker"), got ${typeof record.m}`));
  }

  return success({
    e: TRADE_EVENT_TYPE,
    E: eventTime.value,
    s: record.s,
    t: tradeId.value,
    p: price.value,
    q: quantity.value,
    T: tradeTime.value,
    m: record.m ? 'true' : 'false',
  });
}

/** True iff the level's size is exactly zero (exact decimal comparison). */
export function isZeroSize(level: NormalizedLevel): boolean {
  return compareDecimal(level.size, '0') === 0;
}

/**
 * Split a validated depth-diff into the canonical book_delta sub-messages
 * the mapping table consumes — THE HONEST BRIDGE for a documented
 * two-sided diff:
 *
 * The canonical book_delta payload is action-homogeneous by contract
 * (add/update levels must have size > 0; remove levels may be zero —
 * delete-by-price), while a documented depthUpdate carries BOTH sides with
 * mixed "set absolute quantity at price" semantics. The guard therefore
 * partitions the changed levels into:
 *
 *   - one `action: "update"` sub-message (every level with size > 0, both
 *     sides merged — the canonical book_delta is side-less by contract;
 *     the downstream book builder infers the side, exactly as the
 *     canonical example events do), and
 *   - one `action: "remove"` sub-message (every level with size 0).
 *
 * Sub-message order is FIXED (update before remove) — deterministic.
 * Each sub-message keeps the documented field names for the values that
 * survive (`u` final update id, `E` event time) and carries the guard's
 * derived pair (`action`, `levels`); the other documented fields (`e`,
 * `s`, `U`) were consumed by this guard's schema and sequencing checks and
 * never reach the emitter (they are accounted for HERE, not silently
 * dropped). A diff with no changed levels yields NO sub-messages (an
 * empty heartbeat-style update emits nothing).
 */
export function splitDepthDiff(diff: NormalizedDepthDiff): readonly JsonObject[] {
  const changed: readonly NormalizedLevel[] = [...diff.b, ...diff.a];
  const updates: NormalizedLevel[] = [];
  const removals: NormalizedLevel[] = [];
  for (const level of changed) {
    if (isZeroSize(level)) removals.push(level);
    else updates.push(level);
  }
  const subMessages: JsonObject[] = [];
  if (updates.length > 0) {
    subMessages.push({
      action: 'update',
      levels: updates as unknown as JsonValue,
      u: diff.u,
      E: diff.E,
    });
  }
  if (removals.length > 0) {
    subMessages.push({
      action: 'remove',
      levels: removals as unknown as JsonValue,
      u: diff.u,
      E: diff.E,
    });
  }
  return subMessages;
}

/**
 * Guard and normalize the payload of a message on one of the adapter's
 * documented channels. Returns the normalized payload (as the single
 * emitter-facing message for snapshot/quote/trade channels) or a typed
 * failure. Channels WITHOUT a documented schema pass through verbatim —
 * the session's routing (unknown_channel) owns unsubscribed channels.
 */
export function guardBinancePayload(channel: string, payload: JsonObject): SdkResult<JsonObject> {
  if (channel === 'depth') return guardDepthPayload(payload);
  if (channel === 'bookTicker') return guardBookTickerPayload(payload);
  if (channel === 'trade') {
    const trade = guardTradePayload(payload);
    if (!trade.ok) return trade;
    return success(trade.value as unknown as JsonObject);
  }
  if (channel === 'depthDiff') {
    const diff = guardDepthDiffPayload(payload);
    if (!diff.ok) return diff;
    return success(diff.value as unknown as JsonObject);
  }
  return success(payload);
}

/** Structural guard for the normalized depth-diff payload (introspection). */
export function isNormalizedDepthDiff(value: unknown): value is NormalizedDepthDiff {
  return (
    isRecord(value) &&
    value.e === DEPTH_DIFF_EVENT_TYPE &&
    isPositiveSafeInteger(value.E) &&
    isNonEmptyString(value.s) &&
    isPositiveSafeInteger(value.U) &&
    isPositiveSafeInteger(value.u) &&
    Array.isArray(value.b) &&
    Array.isArray(value.a)
  );
}
