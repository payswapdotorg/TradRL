/**
 * @tradrl/adapter-brokers — documented raw message schemas (the guard layer).
 *
 * PUBLIC DOCUMENTED SHAPES ONLY (Work Order law: "Public documented shapes
 * only: raw message field names come from the provider's PUBLIC API
 * documentation as documented field-name schemas"). The field names and
 * value domains below are the documented PUBLIC FIX dictionary vocabulary
 * for the two message kinds this adapter consumes (the FIX specification
 * is a public, open standard; no proprietary or licensed payloads are
 * consumed or copied — spec/ADAPTERS.md Licensing):
 *
 *   - NewOrderSingle (channel "newOrderSingle", OUTBOUND — the documented
 *     order-entry message): `{ MsgType: "D", ClOrdID, Symbol, Side,
 *     TransactTime, OrdType, OrderQty, Price?, StopPx?, TimeInForce,
 *     ExpireTime? }` with
 *     the documented value domains Side "1"=Buy/"2"=Sell, OrdType
 *     "1"=Market/"2"=Limit/"3"=Stop/"4"=Stop-limit, TimeInForce
 *     "0"=Day/"1"=GTC/"3"=IOC/"4"=FOK/"6"=GTD; quantities and prices are
 *     decimal strings; TransactTime/ExpireTime are the documented
 *     UTCTimestamp form (YYYYMMDD-HH:MM:SS[.sss], UTC).
 *   - ExecutionReport (channel "executionReport", INBOUND — the documented
 *     execution reporting message): `{ MsgType: "8", OrderID, ClOrdID,
 *     ExecID, ExecType, OrdStatus, Side, Symbol, OrderQty, LastQty,
 *     LastPx, CumQty, LeavesQty, AvgPx, TransactTime }` with the
 *     documented value domains ExecType/OrdStatus drawn from the documented
 *     status codes (see the tables below), Side "1"/"2", decimal-string
 *     quantity/price fields, and TransactTime in UTCTimestamp form.
 *
 * NO licensed or proprietary payloads are consumed or copied. Every guard
 * is hand-rolled and total; no `any`. The guard layer's dispositions
 * (exactly the T037/T038 discipline):
 *
 *   - an extra field the schema does not document  -> typed MappingError
 *     `unmapped_raw_field` (the anti-silent-drop law — never a silent drop);
 *   - a documented field of the wrong shape        -> typed protocol error
 *     `malformed_payload`;
 *   - a documented MsgType discriminator with an
 *     undocumented value                          -> typed protocol error
 *     `unknown_message_type`;
 *   - a documented time field that does not convert -> typed protocol
 *     error `invalid_time_field`.
 *
 * DERIVATION (deterministic, provider layer — L2): the guard translates
 * the documented ExecutionReport into the representation the mapping
 * table declares — the canonical escape-hatch form `{ data: {...}, transactTimeMs }`
 * whose `data` keys are CANONICAL vocabulary (order_id, client_order_id,
 * exec_id, exec_type, order_status, side, order_qty, last_qty, last_px,
 * cum_qty, leaves_qty, avg_px — never the documented raw names), so no
 * provider field name can leak into an emitted canonical event (L2/L13
 * trip-wired in neutrality.test.ts). The documented raw fields that do
 * not survive into `data` (MsgType, Symbol) are consumed by this guard's
 * schema checks — accounted for HERE, never silently dropped.
 */

import { failure, mappingError, success, type AdapterError, type SdkResult } from './contract/errors';
import { isNonEmptyString, isRecord } from './contract/fields';
import { isTimestampMs } from './contract/timestamp';
import { isUnsignedDecimal } from './contract/decimals';
import type { JsonObject, JsonValue } from './contract/json';
import { brokerProtocolError } from './protocol';
import { fixUtcTimestampToMs } from './time';

/**
 * The documented raw field names across the consumed messages — the
 * provider vocabulary. It lives ONLY in the adapter's declaration layers
 * (schemas, mapping tables, descriptors); the inverse-neutrality
 * trip-wire test asserts none of these names ever appears as a field of
 * an emitted CANONICAL event (L2: "a canonical event carrying a
 * provider-specific field name is a violation").
 */
export const BROKER_RAW_FIELD_NAMES: readonly string[] = [
  'MsgType',
  'ClOrdID',
  'OrderID',
  'ExecID',
  'ExecType',
  'OrdStatus',
  'Side',
  'OrdType',
  'TimeInForce',
  'OrderQty',
  'Price',
  'StopPx',
  'LastQty',
  'LastPx',
  'CumQty',
  'LeavesQty',
  'AvgPx',
  'Symbol',
  'TransactTime',
  'ExpireTime',
];

/** The documented message-type discriminators, per channel. */
const EXECUTION_REPORT_MSG_TYPE = '8';
const NEW_ORDER_SINGLE_MSG_TYPE = 'D';

/**
 * The documented ExecType codes the adapter consumes, mapped to the
 * CANONICAL execution-report type vocabulary (provider code -> canonical
 * name). Documented FIX ExecType values: 0=New, 1=Partial fill (trade),
 * 2=Fill (trade), 4=Canceled, 8=Rejected, C=Expired.
 */
const EXEC_TYPE_MAP: Readonly<Record<string, string>> = {
  '0': 'new',
  '1': 'partial_fill',
  '2': 'fill',
  '4': 'canceled',
  '8': 'rejected',
  'C': 'expired',
};

/**
 * The documented OrdStatus codes the adapter consumes, mapped to the
 * CANONICAL order-status vocabulary. Documented FIX OrdStatus values:
 * 0=New, 1=Partially filled, 2=Filled, 4=Canceled, 8=Rejected, C=Expired.
 */
const ORD_STATUS_MAP: Readonly<Record<string, string>> = {
  '0': 'new',
  '1': 'partially_filled',
  '2': 'filled',
  '4': 'canceled',
  '8': 'rejected',
  'C': 'expired',
};

/** The canonical order-status vocabulary shared with the OMS/EMS lane (drift-checked in the interop tests). */
export const CANONICAL_ORDER_STATUSES: readonly string[] = [
  'new',
  'partially_filled',
  'filled',
  'canceled',
  'rejected',
  'expired',
];

/** The documented Side codes: 1=Buy, 2=Sell. */
const SIDE_MAP: Readonly<Record<string, string>> = { '1': 'buy', '2': 'sell' };

/** The documented OrdType codes: 1=Market, 2=Limit, 3=Stop, 4=Stop-limit. */
export const ORD_TYPE_MAP: Readonly<Record<string, string>> = {
  '1': 'market',
  '2': 'limit',
  '3': 'stop',
  '4': 'stop-limit',
};

/** The documented TimeInForce codes: 0=Day, 1=GTC, 3=IOC, 4=FOK, 6=GTD. */
export const TIME_IN_FORCE_MAP: Readonly<Record<string, string>> = {
  '0': 'day',
  '1': 'gtc',
  '3': 'ioc',
  '4': 'fok',
  '6': 'gtt',
};

/** The validated, normalized execution report (documented names, converted time). */
export interface NormalizedExecutionReport {
  readonly MsgType: '8';
  readonly OrderID: string;
  readonly ClOrdID: string;
  readonly ExecID: string;
  readonly ExecType: keyof typeof EXEC_TYPE_MAP;
  readonly OrdStatus: keyof typeof ORD_STATUS_MAP;
  readonly Side: '1' | '2';
  readonly Symbol: string;
  readonly OrderQty: string;
  readonly LastQty: string;
  readonly LastPx: string;
  readonly CumQty: string;
  readonly LeavesQty: string;
  readonly AvgPx: string;
  readonly TransactTime: string;
  /** The documented TransactTime converted to epoch milliseconds (deterministic, truncated to ms). */
  readonly transactTimeMs: number;
}

function malformed(channel: string, detail: string): AdapterError {
  return brokerProtocolError('malformed_payload', `channel "${channel}": ${detail}`);
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

/** Validate a non-empty string field (ids, symbols). */
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

// ---------------------------------------------------------------------------
// Channel "executionReport": the documented ExecutionReport schema.
// ---------------------------------------------------------------------------

/** The documented ExecutionReport payload fields (channel "executionReport"). */
const EXECUTION_REPORT_FIELDS: readonly string[] = [
  'MsgType',
  'OrderID',
  'ClOrdID',
  'ExecID',
  'ExecType',
  'OrdStatus',
  'Side',
  'Symbol',
  'OrderQty',
  'LastQty',
  'LastPx',
  'CumQty',
  'LeavesQty',
  'AvgPx',
  'TransactTime',
];

/**
 * Channel "executionReport" — the documented ExecutionReport payload
 * (see the module header for the field inventory and value domains).
 * Normalized: the documented TransactTime is converted to epoch
 * milliseconds (`transactTimeMs`, the mapping table's declared time
 * field); every documented field name is preserved on the normalized
 * record; MsgType and Symbol are consumed by this guard's schema checks
 * and never reach the emitter.
 */
export function guardExecutionReportPayload(payload: JsonObject): SdkResult<NormalizedExecutionReport> {
  const channel = 'executionReport';
  const record = payload as Record<string, unknown>;
  const extra = rejectUndocumentedKeys(channel, record, EXECUTION_REPORT_FIELDS);
  if (extra !== null) return failure(extra);

  for (const field of EXECUTION_REPORT_FIELDS) {
    const missing = requireField(channel, record, field);
    if (missing !== null) return failure(missing);
  }

  if (typeof record.MsgType !== 'string' || record.MsgType !== EXECUTION_REPORT_MSG_TYPE) {
    return failure(
      brokerProtocolError(
        'unknown_message_type',
        `channel "${channel}": message type "${String(record.MsgType)}" is not one of the documented types (${EXECUTION_REPORT_MSG_TYPE}) — the adapter refuses undocumented message shapes`,
      ),
    );
  }

  const orderId = guardNonEmptyString(channel, 'OrderID', record.OrderID);
  if (!orderId.ok) return orderId;
  const clOrdId = guardNonEmptyString(channel, 'ClOrdID', record.ClOrdID);
  if (!clOrdId.ok) return clOrdId;
  const execId = guardNonEmptyString(channel, 'ExecID', record.ExecID);
  if (!execId.ok) return execId;
  const execType = guardEnumCode(channel, 'ExecType', record.ExecType, EXEC_TYPE_MAP);
  if (!execType.ok) return execType;
  const ordStatus = guardEnumCode(channel, 'OrdStatus', record.OrdStatus, ORD_STATUS_MAP);
  if (!ordStatus.ok) return ordStatus;
  const side = guardEnumCode(channel, 'Side', record.Side, SIDE_MAP);
  if (!side.ok) return side;
  const symbol = guardNonEmptyString(channel, 'Symbol', record.Symbol);
  if (!symbol.ok) return symbol;

  const orderQty = guardDecimalString(channel, 'OrderQty', record.OrderQty);
  if (!orderQty.ok) return orderQty;
  const lastQty = guardDecimalString(channel, 'LastQty', record.LastQty);
  if (!lastQty.ok) return lastQty;
  const lastPx = guardDecimalString(channel, 'LastPx', record.LastPx);
  if (!lastPx.ok) return lastPx;
  const cumQty = guardDecimalString(channel, 'CumQty', record.CumQty);
  if (!cumQty.ok) return cumQty;
  const leavesQty = guardDecimalString(channel, 'LeavesQty', record.LeavesQty);
  if (!leavesQty.ok) return leavesQty;
  const avgPx = guardDecimalString(channel, 'AvgPx', record.AvgPx);
  if (!avgPx.ok) return avgPx;

  if (typeof record.TransactTime !== 'string') {
    return failure(malformed(channel, `field "TransactTime" must be the documented UTCTimestamp string form`));
  }
  const transactTimeMs = fixUtcTimestampToMs(record.TransactTime);
  if (!transactTimeMs.ok) return transactTimeMs;

  return success({
    MsgType: EXECUTION_REPORT_MSG_TYPE,
    OrderID: orderId.value,
    ClOrdID: clOrdId.value,
    ExecID: execId.value,
    ExecType: execType.value as keyof typeof EXEC_TYPE_MAP,
    OrdStatus: ordStatus.value as keyof typeof ORD_STATUS_MAP,
    Side: side.value as '1' | '2',
    Symbol: symbol.value,
    OrderQty: orderQty.value,
    LastQty: lastQty.value,
    LastPx: lastPx.value,
    CumQty: cumQty.value,
    LeavesQty: leavesQty.value,
    AvgPx: avgPx.value,
    TransactTime: record.TransactTime,
    transactTimeMs: transactTimeMs.value,
  });
}

/**
 * Derive the emitter-facing escape-hatch form of one validated execution
 * report: `{ data: {...}, transactTimeMs }`. Every key inside `data` is
 * CANONICAL vocabulary (the neutrality trip-wire bans the documented raw
 * names from the emitted events); the documented codes are translated to
 * their canonical names; `transactTimeMs` is the mapping table's declared
 * time field. The guard-consumed documented fields (MsgType, Symbol,
 * TransactTime's documented form) never reach the emitter — accounted for
 * HERE, never silently dropped.
 */
export function deriveExecutionReportPayload(report: NormalizedExecutionReport): JsonObject {
  const data: Record<string, JsonValue> = {
    order_id: report.OrderID,
    client_order_id: report.ClOrdID,
    exec_id: report.ExecID,
    exec_type: EXEC_TYPE_MAP[report.ExecType],
    order_status: ORD_STATUS_MAP[report.OrdStatus],
    side: SIDE_MAP[report.Side],
    order_qty: report.OrderQty,
    last_qty: report.LastQty,
    last_px: report.LastPx,
    cum_qty: report.CumQty,
    leaves_qty: report.LeavesQty,
    avg_px: report.AvgPx,
  };
  return {
    data: data as unknown as JsonValue,
    transactTimeMs: report.transactTimeMs,
  };
}

// ---------------------------------------------------------------------------
// Channel "newOrderSingle": the documented NewOrderSingle schema (the
// OUTBOUND order-entry message — validated here as defense in depth for
// the routing path's constructed messages).
// ---------------------------------------------------------------------------

/** The documented NewOrderSingle payload fields (channel "newOrderSingle"). */
const NEW_ORDER_SINGLE_FIELDS: readonly string[] = [
  'MsgType',
  'ClOrdID',
  'Symbol',
  'Side',
  'TransactTime',
  'OrdType',
  'OrderQty',
  'Price',
  'StopPx',
  'TimeInForce',
  'ExpireTime',
];

/**
 * The validated, normalized NewOrderSingle (documented names; the
 * conditional price matrix enforced exactly as documented: OrdType 1
 * carries neither Price nor StopPx; OrdType 2 carries Price; OrdType 3
 * carries StopPx; OrdType 4 carries both; TimeInForce 6 requires
 * ExpireTime, other documented TIF codes reject it).
 */
export interface NormalizedNewOrderSingle {
  readonly MsgType: 'D';
  readonly ClOrdID: string;
  readonly Symbol: string;
  readonly Side: '1' | '2';
  readonly TransactTime: string;
  readonly OrdType: keyof typeof ORD_TYPE_MAP;
  readonly OrderQty: string;
  readonly Price?: string;
  readonly StopPx?: string;
  readonly TimeInForce: keyof typeof TIME_IN_FORCE_MAP;
  readonly ExpireTime?: string;
}

/**
 * Channel "newOrderSingle" — the documented NewOrderSingle payload (the
 * outbound order-entry message). Guards the documented field inventory,
 * value domains and the documented conditional-field matrix. This guard
 * is the routing path's defense in depth: the message
 * {@link ../routing.ts} constructs is validated through it before it is
 * returned.
 */
export function guardNewOrderSinglePayload(payload: JsonObject): SdkResult<NormalizedNewOrderSingle> {
  const channel = 'newOrderSingle';
  const record = payload as Record<string, unknown>;
  const extra = rejectUndocumentedKeys(channel, record, NEW_ORDER_SINGLE_FIELDS);
  if (extra !== null) return failure(extra);

  for (const field of ['MsgType', 'ClOrdID', 'Symbol', 'Side', 'TransactTime', 'OrdType', 'OrderQty', 'TimeInForce'] as const) {
    const missing = requireField(channel, record, field);
    if (missing !== null) return failure(missing);
  }

  if (typeof record.MsgType !== 'string' || record.MsgType !== NEW_ORDER_SINGLE_MSG_TYPE) {
    return failure(
      brokerProtocolError(
        'unknown_message_type',
        `channel "${channel}": message type "${String(record.MsgType)}" is not one of the documented types (${NEW_ORDER_SINGLE_MSG_TYPE}) — the adapter refuses undocumented message shapes`,
      ),
    );
  }

  const clOrdId = guardNonEmptyString(channel, 'ClOrdID', record.ClOrdID);
  if (!clOrdId.ok) return clOrdId;
  const symbol = guardNonEmptyString(channel, 'Symbol', record.Symbol);
  if (!symbol.ok) return symbol;
  const side = guardEnumCode(channel, 'Side', record.Side, SIDE_MAP);
  if (!side.ok) return side;
  const ordType = guardEnumCode(channel, 'OrdType', record.OrdType, ORD_TYPE_MAP);
  if (!ordType.ok) return ordType;
  const timeInForce = guardEnumCode(channel, 'TimeInForce', record.TimeInForce, TIME_IN_FORCE_MAP);
  if (!timeInForce.ok) return timeInForce;
  const orderQty = guardDecimalString(channel, 'OrderQty', record.OrderQty);
  if (!orderQty.ok) return orderQty;

  if (typeof record.TransactTime !== 'string') {
    return failure(malformed(channel, `field "TransactTime" must be the documented UTCTimestamp string form`));
  }
  const transactTime = fixUtcTimestampToMs(record.TransactTime);
  if (!transactTime.ok) return transactTime;

  // The documented conditional-field matrix (mirror of the canonical
  // order kind's price matrix, in the gateway's own codes).
  const hasPrice = record.Price !== undefined;
  const hasStop = record.StopPx !== undefined;
  if (ordType.value === '1' && (hasPrice || hasStop)) {
    return failure(malformed(channel, 'OrdType "1" (market) carries neither Price nor StopPx'));
  }
  if (ordType.value === '2' && (!hasPrice || hasStop)) {
    return failure(malformed(channel, 'OrdType "2" (limit) carries Price and no StopPx'));
  }
  if (ordType.value === '3' && (hasStop === false || hasPrice)) {
    return failure(malformed(channel, 'OrdType "3" (stop) carries StopPx and no Price'));
  }
  if (ordType.value === '4' && (!hasPrice || !hasStop)) {
    return failure(malformed(channel, 'OrdType "4" (stop-limit) carries both Price and StopPx'));
  }

  let price: string | undefined;
  if (record.Price !== undefined) {
    const guarded = guardDecimalString(channel, 'Price', record.Price);
    if (!guarded.ok) return guarded;
    price = guarded.value;
  }
  let stopPx: string | undefined;
  if (record.StopPx !== undefined) {
    const guarded = guardDecimalString(channel, 'StopPx', record.StopPx);
    if (!guarded.ok) return guarded;
    stopPx = guarded.value;
  }

  let expireTime: string | undefined;
  if (record.ExpireTime !== undefined) {
    if (typeof record.ExpireTime !== 'string') {
      return failure(malformed(channel, 'field "ExpireTime" must be the documented UTCTimestamp string form'));
    }
    const converted = fixUtcTimestampToMs(record.ExpireTime);
    if (!converted.ok) return converted;
    if (timeInForce.value !== '6') {
      return failure(malformed(channel, 'ExpireTime is documented only for TimeInForce "6" (GTD)'));
    }
    expireTime = record.ExpireTime;
  } else if (timeInForce.value === '6') {
    return failure(malformed(channel, 'TimeInForce "6" (GTD) requires ExpireTime'));
  }

  return success({
    MsgType: NEW_ORDER_SINGLE_MSG_TYPE,
    ClOrdID: clOrdId.value,
    Symbol: symbol.value,
    Side: side.value as '1' | '2',
    TransactTime: record.TransactTime,
    OrdType: ordType.value as keyof typeof ORD_TYPE_MAP,
    OrderQty: orderQty.value,
    Price: price,
    StopPx: stopPx,
    TimeInForce: timeInForce.value as keyof typeof TIME_IN_FORCE_MAP,
    ExpireTime: expireTime,
  });
}

/** Structural guard for the normalized execution report (introspection). */
export function isNormalizedExecutionReport(value: unknown): value is NormalizedExecutionReport {
  return (
    isRecord(value) &&
    value.MsgType === EXECUTION_REPORT_MSG_TYPE &&
    isNonEmptyString(value.OrderID) &&
    isNonEmptyString(value.ClOrdID) &&
    isNonEmptyString(value.ExecID) &&
    isNonEmptyString(value.ExecType) &&
    isNonEmptyString(value.OrdStatus) &&
    (value.Side === '1' || value.Side === '2') &&
    isNonEmptyString(value.Symbol) &&
    isUnsignedDecimal(value.OrderQty) &&
    isUnsignedDecimal(value.LastQty) &&
    isUnsignedDecimal(value.LastPx) &&
    isUnsignedDecimal(value.CumQty) &&
    isUnsignedDecimal(value.LeavesQty) &&
    isUnsignedDecimal(value.AvgPx) &&
    isNonEmptyString(value.TransactTime) &&
    isTimestampMs(value.transactTimeMs)
  );
}
