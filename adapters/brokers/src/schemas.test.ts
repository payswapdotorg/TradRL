/**
 * @tradrl/adapter-brokers — documented raw payload schema tests.
 *
 * Behavioral: the documented ExecutionReport and NewOrderSingle guards —
 * valid documented payloads, the anti-silent-drop law (unknown fields
 * are typed MappingErrors), malformed documented fields, unknown message
 * types, the documented conditional-field matrix, the derived canonical
 * escape-hatch form (canonical vocabulary keys only), and the
 * normalization discipline.
 */

import { describe, expect, it } from 'vitest';

import {
  guardExecutionReportPayload,
  guardNewOrderSinglePayload,
  deriveExecutionReportPayload,
  isNormalizedExecutionReport,
  BROKER_RAW_FIELD_NAMES,
  CANONICAL_ORDER_STATUSES,
  brokerProtocolCodeOf,
  isMappingError,
  type JsonObject,
} from './index';
import { fixtureExecutionReport, fixturePartialFill, fixtureFill } from './test-fixtures';

const asJson = (value: Record<string, unknown>): JsonObject => value as JsonObject;

describe('guardExecutionReportPayload (channel "executionReport")', () => {
  it('accepts the documented shapes and normalizes the documented time', () => {
    for (const fixture of [fixtureExecutionReport(), fixturePartialFill(), fixtureFill()]) {
      const result = guardExecutionReportPayload(asJson(fixture));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(isNormalizedExecutionReport(result.value)).toBe(true);
        expect(result.value.transactTimeMs).toBe(1_717_459_200_000);
        expect(result.value.CumQty).toBe(fixture.CumQty as string);
      }
    }
  });

  it('an extra field the schema does not document is a typed MappingError (anti-silent-drop)', () => {
    const result = guardExecutionReportPayload(asJson({ ...fixtureExecutionReport(), vendor_extra: 'surprise' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isMappingError(result.error)).toBe(true);
      expect(result.error.code).toBe('unmapped_raw_field');
      expect(result.error.message).toContain('vendor_extra');
    }
  });

  it('a missing documented field is a typed malformed_payload error', () => {
    const missing = { ...fixtureExecutionReport() };
    delete (missing as Record<string, unknown>).ExecID;
    const result = guardExecutionReportPayload(asJson(missing));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(brokerProtocolCodeOf(result.error)).toBe('malformed_payload');
      expect(result.error.message).toContain('ExecID');
    }
  });

  it('an undocumented MsgType discriminator is a typed unknown_message_type error', () => {
    const result = guardExecutionReportPayload(asJson(fixtureExecutionReport({ MsgType: 'W' })));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(brokerProtocolCodeOf(result.error)).toBe('unknown_message_type');
  });

  it('documented enum codes outside the declared domains are typed malformed_payload errors', () => {
    for (const [field, value] of [['ExecType', '9'], ['OrdStatus', '1' + 'x'], ['Side', '3']] as const) {
      const result = guardExecutionReportPayload(asJson(fixtureExecutionReport({ [field]: value })));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(brokerProtocolCodeOf(result.error)).toBe('malformed_payload');
    }
  });

  it('documented decimal fields must be decimal strings (never numbers)', () => {
    const result = guardExecutionReportPayload(asJson(fixtureExecutionReport({ LastPx: 50000 })));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(brokerProtocolCodeOf(result.error)).toBe('malformed_payload');
      expect(result.error.message).toContain('LastPx');
    }
  });

  it('a malformed documented time is a typed invalid_time_field error', () => {
    const result = guardExecutionReportPayload(asJson(fixtureExecutionReport({ TransactTime: '2024-06-04T00:00:00Z' })));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(brokerProtocolCodeOf(result.error)).toBe('invalid_time_field');
  });
});

describe('guardNewOrderSinglePayload (channel "newOrderSingle")', () => {
  const validOrder = {
    MsgType: 'D',
    ClOrdID: 't039-fx-1',
    Symbol: 'BTC-USDT',
    Side: '1',
    TransactTime: '20240604-00:00:00.000',
    OrdType: '2',
    OrderQty: '0.5',
    Price: '50000.00',
    TimeInForce: '1',
  };

  it('accepts the documented limit order and preserves every documented field', () => {
    const result = guardNewOrderSinglePayload(asJson(validOrder));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.OrdType).toBe('2');
      expect(result.value.Price).toBe('50000.00');
      expect(result.value.TimeInForce).toBe('1');
    }
  });

  it('accepts the documented market order (neither Price nor StopPx)', () => {
    const result = guardNewOrderSinglePayload(asJson({ ...validOrder, OrdType: '1', Price: undefined, TimeInForce: '0' }));
    expect(result.ok).toBe(true);
  });

  it('enforces the documented conditional-field matrix with typed errors', () => {
    // Market with a price is malformed.
    const marketWithPrice = guardNewOrderSinglePayload(asJson(validOrder)); // OrdType 2 with Price — valid baseline
    expect(marketWithPrice.ok).toBe(true);
    const badMarket = guardNewOrderSinglePayload(asJson({ ...validOrder, OrdType: '1' }));
    expect(badMarket.ok).toBe(false);
    if (!badMarket.ok) expect(brokerProtocolCodeOf(badMarket.error)).toBe('malformed_payload');
    // Limit without a price is malformed.
    const noPrice = { ...validOrder };
    delete (noPrice as Record<string, unknown>).Price;
    const badLimit = guardNewOrderSinglePayload(asJson(noPrice));
    expect(badLimit.ok).toBe(false);
    // Stop without StopPx is malformed.
    const badStop = guardNewOrderSinglePayload(asJson({ ...validOrder, OrdType: '3' }));
    expect(badStop.ok).toBe(false);
    // Stop-limit needs both.
    const badStopLimit = guardNewOrderSinglePayload(asJson({ ...validOrder, OrdType: '4', StopPx: '49000.00' }));
    expect(badStopLimit.ok).toBe(true);
  });

  it('GTD requires ExpireTime; other documented TIF codes reject it', () => {
    const gtd = guardNewOrderSinglePayload(asJson({ ...validOrder, TimeInForce: '6' }));
    expect(gtd.ok).toBe(false);
    if (!gtd.ok) expect(gtd.error.message).toContain('ExpireTime');
    const gtdWithExpiry = guardNewOrderSinglePayload(asJson({ ...validOrder, TimeInForce: '6', ExpireTime: '20250604-00:00:00.000' }));
    expect(gtdWithExpiry.ok).toBe(true);
    const dayWithExpiry = guardNewOrderSinglePayload(asJson({ ...validOrder, TimeInForce: '0', ExpireTime: '20250604-00:00:00.000' }));
    expect(dayWithExpiry.ok).toBe(false);
  });

  it('an extra field the schema does not document is a typed MappingError', () => {
    const result = guardNewOrderSinglePayload(asJson({ ...validOrder, Account: 'nope' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unmapped_raw_field');
  });

  it('an undocumented MsgType is a typed unknown_message_type error', () => {
    const result = guardNewOrderSinglePayload(asJson({ ...validOrder, MsgType: 'F' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(brokerProtocolCodeOf(result.error)).toBe('unknown_message_type');
  });
});

describe('deriveExecutionReportPayload (the canonical escape-hatch derivation)', () => {
  it('derives canonical vocabulary keys only — never the documented raw names', () => {
    const guarded = guardExecutionReportPayload(asJson(fixturePartialFill()));
    expect(guarded.ok).toBe(true);
    if (!guarded.ok) throw new Error('fixture must guard');
    const derived = deriveExecutionReportPayload(guarded.value);
    const data = derived.data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual([
      'avg_px',
      'client_order_id',
      'cum_qty',
      'exec_id',
      'exec_type',
      'last_px',
      'last_qty',
      'leaves_qty',
      'order_id',
      'order_qty',
      'order_status',
      'side',
    ]);
    expect(data.exec_type).toBe('partial_fill');
    expect(data.order_status).toBe('partially_filled');
    expect(data.side).toBe('buy');
    expect(derived.transactTimeMs).toBe(1_717_459_200_000);
  });

  it('the documented raw vocabulary is exported for the neutrality trip-wire', () => {
    expect(BROKER_RAW_FIELD_NAMES).toContain('ClOrdID');
    expect(BROKER_RAW_FIELD_NAMES).toContain('CumQty');
    expect(BROKER_RAW_FIELD_NAMES.length).toBeGreaterThan(15);
    expect(CANONICAL_ORDER_STATUSES).toContain('partially_filled');
  });
});
