/**
 * @tradrl/adapter-oms-ems — documented raw message schemas (the guard layer).
 *
 * PUBLIC DOCUMENTED SHAPES ONLY (Work Order law: "Public documented shapes
 * only: raw message field names come from the provider's PUBLIC API
 * documentation as documented field-name schemas"). The field names and
 * value domains below are the documented PUBLIC API vocabulary of a
 * headless OMS/EMS gateway's order-session interface (a publicly
 * documented camelCase JSON API; no proprietary or licensed payloads are
 * consumed or copied — spec/ADAPTERS.md Licensing — and every fixture
 * value in the tests is synthetic):
 *
 *   - Routing instruction (channel "routingInstruction", OUTBOUND — the
 *     documented ROUTE_ORDER instruction): `{ action: "ROUTE_ORDER",
 *     venue, clientOrderId, side, orderType, quantity, limitPrice?,
 *     stopPrice?, timeInForce, expireAt?, updatedAt }` with the documented
 *     domains side "buy"|"sell", orderType "market"|"limit"|"stop"|
 *     "stop_limit", timeInForce "day"|"gtc"|"ioc"|"fok"|"gtt"; quantity
 *     and prices are decimal strings; expireAt/updatedAt are the
 *     documented ISO-8601 UTC form.
 *   - Order-state record (channel "orderState", INBOUND — the documented
 *     ORDER_STATE record): `{ recordType: "ORDER_STATE", orderId,
 *     clOrdId, sequence, status, venue, orderQty, filledQty, leavesQty,
 *     avgPx, lastQty?, lastPx?, updatedAt }` with the documented status
 *     domain NEW | PARTIALLY_FILLED | FILLED | CANCELED | REJECTED |
 *     EXPIRED, per-order strictly-advancing sequence, decimal-string
 *     quantity fields, and updatedAt in the documented ISO-8601 UTC form.
 *
 * Every guard is hand-rolled and total; no `any`. The guard layer's
 * dispositions (exactly the T037/T038 discipline):
 *
 *   - an extra field the schema does not document  -> typed MappingError
 *     `unmapped_raw_field` (the anti-silent-drop law — never a silent drop);
 *   - a documented field of the wrong shape        -> typed protocol error
 *     `malformed_payload`;
 *   - a documented recordType/action discriminator with an
 *     undocumented value                          -> typed protocol error
 *     `unknown_message_type`;
 *   - a documented time field that does not convert -> typed protocol
 *     error `invalid_time_field`.
 *
 * DERIVATION (deterministic, provider layer — L2): the guard translates
 * the documented order-state record into the representation the mapping
 * table declares — the canonical escape-hatch form `{ data: {...},
 * updatedAtMs }` whose `data` keys are CANONICAL vocabulary (order_id,
 * client_order_id, status, order_qty, filled_qty, leaves_qty, avg_px,
 * last_qty, last_px, venue — never the documented raw names), so no
 * provider field name can leak into an emitted canonical event (L2/L13
 * trip-wired in neutrality.test.ts). The documented fields that do not
 * survive into `data` (recordType, sequence, updatedAt's documented
 * ISO form) are consumed by this guard's schema checks and its
 * per-order sequencing law — accounted for HERE, never silently dropped.
 */

import { failure, mappingError, success, type AdapterError, type SdkResult } from './contract/errors';
import { isNonEmptyString, isPositiveSafeInteger, isRecord } from './contract/fields';
import { isUnsignedDecimal } from './contract/decimals';
import { isTimestampMs } from './contract/timestamp';
import type { JsonObject, JsonValue } from './contract/json';
import { omsEmsProtocolError } from './protocol';
import { isoUtcToMs } from './time';

/**
 * The documented raw field names across the consumed messages — the
 * provider vocabulary. It lives ONLY in the adapter's declaration layers
 * (schemas, mapping tables, descriptors); the inverse-neutrality
 * trip-wire test asserts none of these names ever appears as a field of
 * an emitted CANONICAL event (L2: "a canonical event carrying a
 * provider-specific field name is a violation").
 */
export const OMS_EMS_RAW_FIELD_NAMES: readonly string[] = [
  'action',
  'recordType',
  'venue',
  'clientOrderId',
  'orderId',
  'clOrdId',
  'sequence',
  'status',
  'side',
  'orderType',
  'quantity',
  'orderQty',
  'limitPrice',
  'stopPrice',
  'timeInForce',
  'expireAt',
  'updatedAt',
  'filledQty',
  'leavesQty',
  'avgPx',
  'lastQty',
  'lastPx',
];

/** The documented message discriminators, per channel. */
const ORDER_STATE_RECORD_TYPE = 'ORDER_STATE';
const ROUTING_ACTION = 'ROUTE_ORDER';

/**
 * The documented status codes the adapter consumes, mapped to the
 * CANONICAL order-status vocabulary (documented code -> canonical name).
 * The canonical vocabulary is shared with the broker lane (drift-checked
 * in the interop tests).
 */
export const STATUS_MAP: Readonly<Record<string, string>> = {
  NEW: 'new',
  PARTIALLY_FILLED: 'partially_filled',
  FILLED: 'filled',
  CANCELED: 'canceled',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
};

/** The canonical order-status vocabulary shared with the broker lane (drift-checked in the interop tests). */
export const CANONICAL_ORDER_STATUSES: readonly string[] = [
  'new',
  'partially_filled',
  'filled',
  'canceled',
  'rejected',
  'expired',
];

/** The documented orderType codes, mapped to the canonical order-kind vocabulary. */
export const ORDER_TYPE_MAP: Readonly<Record<string, string>> = {
  market: 'market',
  limit: 'limit',
  stop: 'stop',
  stop_limit: 'stop-limit',
};

/** The documented side domain. */
const SIDE_DOMAIN: readonly string[] = ['buy', 'sell'];

/** The documented timeInForce domain, mapped to the canonical vocabulary. */
export const TIME_IN_FORCE_MAP: Readonly<Record<string, string>> = {
  day: 'day',
  gtc: 'gtc',
  ioc: 'ioc',
  fok: 'fok',
  gtt: 'gtt',
};

/** The validated, normalized order-state record (documented names, converted time). */
export interface NormalizedOrderState {
  readonly recordType: 'ORDER_STATE';
  readonly orderId: string;
  readonly clOrdId: string;
  readonly sequence: number;
  readonly status: keyof typeof STATUS_MAP;
  readonly venue: string;
  readonly orderQty: string;
  readonly filledQty: string;
  readonly leavesQty: string;
  readonly avgPx: string;
  readonly lastQty?: string;
  readonly lastPx?: string;
  readonly updatedAt: string;
  /** The documented updatedAt converted to epoch milliseconds (deterministic, truncated to ms). */
  readonly updatedAtMs: number;
}

function malformed(channel: string, detail: string): AdapterError {
  return omsEmsProtocolError('malformed_payload', `channel "${channel}": ${detail}`);
}

function unknownMessageType(channel: string, documented: readonly string[], actual: string): AdapterError {
  return omsEmsProtocolError(
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

/** Validate a non-empty string field (ids, venues). */
function guardNonEmptyString(channel: string, field: string, value: unknown): SdkResult<string> {
  if (!isNonEmptyString(value)) {
    return failure(malformed(channel, `field "${field}" must be a non-empty string (got ${typeof value === 'string' ? `"${value}"` : String(value)})`));
  }
  return success(value);
}

/** Validate an unsigned decimal-string field (quantities, prices, averages). */
function guardDecimalString(channel: string, field: string, value: unknown): SdkResult<string> {
  if (typeof value !== 'string' || !isUnsignedDecimal(value)) {
    return failure(malformed(channel, `field "${field}" must be a decimal string (got ${typeof value === 'string' ? `"${value}"` : String(value)})`));
  }
  return success(value);
}

/** Validate a documented enum-code field through its declared map. */
function guardEnumCode(channel: string, field: string, value: unknown, map: Readonly<Record<string, string>>): SdkResult<string> {
  if (typeof value !== 'string' || !(value in map)) {
    return failure(malformed(channel, `field "${field}" must be one of the documented codes (${Object.keys(map).join(' | ')})`));
  }
  return success(value);
}

/** Validate a documented ISO-8601 UTC time field, converting to epoch milliseconds. */
function guardIsoTime(channel: string, field: string, value: unknown): SdkResult<number> {
  if (typeof value !== 'string') {
    return failure(malformed(channel, `field "${field}" must be the documented ISO-8601 UTC string form`));
  }
  const converted = isoUtcToMs(value);
  if (!converted.ok) return converted;
  return success(converted.value);
}

// ---------------------------------------------------------------------------
// Channel "orderState": the documented ORDER_STATE schema.
// ---------------------------------------------------------------------------

/** The documented order-state payload fields (channel "orderState"). */
const ORDER_STATE_FIELDS: readonly string[] = [
  'recordType',
  'orderId',
  'clOrdId',
  'sequence',
  'status',
  'venue',
  'orderQty',
  'filledQty',
  'leavesQty',
  'avgPx',
  'lastQty',
  'lastPx',
  'updatedAt',
];

/**
 * Channel "orderState" — the documented ORDER_STATE payload (see the
 * module header for the field inventory and value domains). Normalized:
 * the documented updatedAt is converted to epoch milliseconds
 * (`updatedAtMs`, the mapping table's declared time field); every
 * documented field name is preserved on the normalized record;
 * recordType and sequence are consumed by this guard's schema checks
 * (and the guard transport's per-order sequencing law) and never reach
 * the emitter. lastQty/lastPx are documented-optional (present iff the
 * update carries a trade).
 */
export function guardOrderStatePayload(payload: JsonObject): SdkResult<NormalizedOrderState> {
  const channel = 'orderState';
  const record = payload as Record<string, unknown>;
  const extra = rejectUndocumentedKeys(channel, record, ORDER_STATE_FIELDS);
  if (extra !== null) return failure(extra);

  for (const field of ['recordType', 'orderId', 'clOrdId', 'sequence', 'status', 'venue', 'orderQty', 'filledQty', 'leavesQty', 'avgPx', 'updatedAt'] as const) {
    const missing = requireField(channel, record, field);
    if (missing !== null) return failure(missing);
  }

  if (typeof record.recordType !== 'string' || record.recordType !== ORDER_STATE_RECORD_TYPE) {
    return failure(unknownMessageType(channel, [ORDER_STATE_RECORD_TYPE], String(record.recordType)));
  }

  const orderId = guardNonEmptyString(channel, 'orderId', record.orderId);
  if (!orderId.ok) return orderId;
  const clOrdId = guardNonEmptyString(channel, 'clOrdId', record.clOrdId);
  if (!clOrdId.ok) return clOrdId;
  if (!isPositiveSafeInteger(record.sequence)) {
    return failure(malformed(channel, `field "sequence" must be a positive integer (got ${String(record.sequence)})`));
  }
  const status = guardEnumCode(channel, 'status', record.status, STATUS_MAP);
  if (!status.ok) return status;
  const venue = guardNonEmptyString(channel, 'venue', record.venue);
  if (!venue.ok) return venue;
  const orderQty = guardDecimalString(channel, 'orderQty', record.orderQty);
  if (!orderQty.ok) return orderQty;
  const filledQty = guardDecimalString(channel, 'filledQty', record.filledQty);
  if (!filledQty.ok) return filledQty;
  const leavesQty = guardDecimalString(channel, 'leavesQty', record.leavesQty);
  if (!leavesQty.ok) return leavesQty;
  const avgPx = guardDecimalString(channel, 'avgPx', record.avgPx);
  if (!avgPx.ok) return avgPx;

  let lastQty: string | undefined;
  if (record.lastQty !== undefined) {
    const guarded = guardDecimalString(channel, 'lastQty', record.lastQty);
    if (!guarded.ok) return guarded;
    lastQty = guarded.value;
  }
  let lastPx: string | undefined;
  if (record.lastPx !== undefined) {
    const guarded = guardDecimalString(channel, 'lastPx', record.lastPx);
    if (!guarded.ok) return guarded;
    lastPx = guarded.value;
  }
  // The documented pairing law: lastQty and lastPx ride together (a
  // trade update carries both or neither).
  if ((lastQty === undefined) !== (lastPx === undefined)) {
    return failure(malformed(channel, 'the documented fields "lastQty" and "lastPx" ride together (a trade update carries both or neither)'));
  }

  const updatedAtMs = guardIsoTime(channel, 'updatedAt', record.updatedAt);
  if (!updatedAtMs.ok) return updatedAtMs;

  return success({
    recordType: ORDER_STATE_RECORD_TYPE,
    orderId: orderId.value,
    clOrdId: clOrdId.value,
    sequence: record.sequence,
    status: status.value as keyof typeof STATUS_MAP,
    venue: venue.value,
    orderQty: orderQty.value,
    filledQty: filledQty.value,
    leavesQty: leavesQty.value,
    avgPx: avgPx.value,
    lastQty,
    lastPx,
    updatedAt: record.updatedAt as string,
    updatedAtMs: updatedAtMs.value,
  });
}

/**
 * Derive the emitter-facing escape-hatch form of one validated
 * order-state record: `{ data: {...}, updatedAtMs }`. Every key inside
 * `data` is CANONICAL vocabulary (the neutrality trip-wire bans the
 * documented raw names from the emitted events); the documented status
 * codes are translated to their canonical names; `updatedAtMs` is the
 * mapping table's declared time field. The guard-consumed documented
 * fields (recordType, sequence, updatedAt's documented ISO form) never
 * reach the emitter — accounted for HERE, never silently dropped.
 */
export function deriveOrderStatePayload(state: NormalizedOrderState): JsonObject {
  const data: Record<string, JsonValue> = {
    order_id: state.orderId,
    client_order_id: state.clOrdId,
    status: STATUS_MAP[state.status],
    venue: state.venue,
    order_qty: state.orderQty,
    filled_qty: state.filledQty,
    leaves_qty: state.leavesQty,
    avg_px: state.avgPx,
  };
  if (state.lastQty !== undefined) data.last_qty = state.lastQty;
  if (state.lastPx !== undefined) data.last_px = state.lastPx;
  return {
    data: data as unknown as JsonValue,
    updatedAtMs: state.updatedAtMs,
  };
}

// ---------------------------------------------------------------------------
// Channel "routingInstruction": the documented ROUTE_ORDER schema (the
// OUTBOUND order-entry instruction — validated here as defense in depth
// for the routing path's constructed messages).
// ---------------------------------------------------------------------------

/** The documented routing-instruction payload fields (channel "routingInstruction"). */
const ROUTING_INSTRUCTION_FIELDS: readonly string[] = [
  'action',
  'venue',
  'clientOrderId',
  'side',
  'orderType',
  'quantity',
  'limitPrice',
  'stopPrice',
  'timeInForce',
  'expireAt',
  'updatedAt',
];

/** The validated, normalized routing instruction (documented names; the conditional price matrix enforced exactly as documented). */
export interface NormalizedRoutingInstruction {
  readonly action: 'ROUTE_ORDER';
  readonly venue: string;
  readonly clientOrderId: string;
  readonly side: 'buy' | 'sell';
  readonly orderType: keyof typeof ORDER_TYPE_MAP;
  readonly quantity: string;
  readonly limitPrice?: string;
  readonly stopPrice?: string;
  readonly timeInForce: keyof typeof TIME_IN_FORCE_MAP;
  readonly expireAt?: string;
  readonly updatedAt: string;
}

/**
 * Channel "routingInstruction" — the documented ROUTE_ORDER payload (the
 * outbound order-entry instruction). Guards the documented field
 * inventory, value domains and the documented conditional-field matrix
 * (market carries neither price; limit carries limitPrice; stop carries
 * stopPrice; stop_limit carries both; gtt requires expireAt, other
 * documented TIF values reject it). This guard is the routing path's
 * defense in depth: the message {@link ../routing.ts} constructs is
 * validated through it before it is returned.
 */
export function guardRoutingInstructionPayload(payload: JsonObject): SdkResult<NormalizedRoutingInstruction> {
  const channel = 'routingInstruction';
  const record = payload as Record<string, unknown>;
  const extra = rejectUndocumentedKeys(channel, record, ROUTING_INSTRUCTION_FIELDS);
  if (extra !== null) return failure(extra);

  for (const field of ['action', 'venue', 'clientOrderId', 'side', 'orderType', 'quantity', 'timeInForce', 'updatedAt'] as const) {
    const missing = requireField(channel, record, field);
    if (missing !== null) return failure(missing);
  }

  if (typeof record.action !== 'string' || record.action !== ROUTING_ACTION) {
    return failure(unknownMessageType(channel, [ROUTING_ACTION], String(record.action)));
  }

  const venue = guardNonEmptyString(channel, 'venue', record.venue);
  if (!venue.ok) return venue;
  const clientOrderId = guardNonEmptyString(channel, 'clientOrderId', record.clientOrderId);
  if (!clientOrderId.ok) return clientOrderId;
  if (typeof record.side !== 'string' || !SIDE_DOMAIN.includes(record.side)) {
    return failure(malformed(channel, `field "side" must be one of the documented codes (${SIDE_DOMAIN.join(' | ')})`));
  }
  const orderType = guardEnumCode(channel, 'orderType', record.orderType, ORDER_TYPE_MAP);
  if (!orderType.ok) return orderType;
  const timeInForce = guardEnumCode(channel, 'timeInForce', record.timeInForce, TIME_IN_FORCE_MAP);
  if (!timeInForce.ok) return timeInForce;
  const quantity = guardDecimalString(channel, 'quantity', record.quantity);
  if (!quantity.ok) return quantity;

  const updatedAtMs = guardIsoTime(channel, 'updatedAt', record.updatedAt);
  if (!updatedAtMs.ok) return updatedAtMs;

  // The documented conditional-field matrix.
  const hasLimit = record.limitPrice !== undefined;
  const hasStop = record.stopPrice !== undefined;
  if (orderType.value === 'market' && (hasLimit || hasStop)) {
    return failure(malformed(channel, 'orderType "market" carries neither limitPrice nor stopPrice'));
  }
  if (orderType.value === 'limit' && (!hasLimit || hasStop)) {
    return failure(malformed(channel, 'orderType "limit" carries limitPrice and no stopPrice'));
  }
  if (orderType.value === 'stop' && (!hasStop || hasLimit)) {
    return failure(malformed(channel, 'orderType "stop" carries stopPrice and no limitPrice'));
  }
  if (orderType.value === 'stop_limit' && (!hasLimit || !hasStop)) {
    return failure(malformed(channel, 'orderType "stop_limit" carries both limitPrice and stopPrice'));
  }

  let limitPrice: string | undefined;
  if (record.limitPrice !== undefined) {
    const guarded = guardDecimalString(channel, 'limitPrice', record.limitPrice);
    if (!guarded.ok) return guarded;
    limitPrice = guarded.value;
  }
  let stopPrice: string | undefined;
  if (record.stopPrice !== undefined) {
    const guarded = guardDecimalString(channel, 'stopPrice', record.stopPrice);
    if (!guarded.ok) return guarded;
    stopPrice = guarded.value;
  }

  let expireAt: string | undefined;
  if (record.expireAt !== undefined) {
    const converted = guardIsoTime(channel, 'expireAt', record.expireAt);
    if (!converted.ok) return converted;
    if (timeInForce.value !== 'gtt') {
      return failure(malformed(channel, 'expireAt is documented only for timeInForce "gtt"'));
    }
    expireAt = record.expireAt as string;
  } else if (timeInForce.value === 'gtt') {
    return failure(malformed(channel, 'timeInForce "gtt" requires expireAt'));
  }

  return success({
    action: ROUTING_ACTION,
    venue: venue.value,
    clientOrderId: clientOrderId.value,
    side: record.side as 'buy' | 'sell',
    orderType: orderType.value as keyof typeof ORDER_TYPE_MAP,
    quantity: quantity.value,
    limitPrice,
    stopPrice,
    timeInForce: timeInForce.value as keyof typeof TIME_IN_FORCE_MAP,
    expireAt,
    updatedAt: record.updatedAt as string,
  });
}

/** Structural guard for the normalized order-state record (introspection). */
export function isNormalizedOrderState(value: unknown): value is NormalizedOrderState {
  return (
    isRecord(value) &&
    value.recordType === ORDER_STATE_RECORD_TYPE &&
    isNonEmptyString(value.orderId) &&
    isNonEmptyString(value.clOrdId) &&
    isPositiveSafeInteger(value.sequence) &&
    isNonEmptyString(value.status) &&
    isNonEmptyString(value.venue) &&
    isUnsignedDecimal(value.orderQty) &&
    isUnsignedDecimal(value.filledQty) &&
    isUnsignedDecimal(value.leavesQty) &&
    isUnsignedDecimal(value.avgPx) &&
    isNonEmptyString(value.updatedAt) &&
    isTimestampMs(value.updatedAtMs)
  );
}
