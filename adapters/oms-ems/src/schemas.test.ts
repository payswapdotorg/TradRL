/**
 * @tradrl/adapter-oms-ems — documented raw payload schema tests.
 *
 * Behavioral: the documented ORDER_STATE and ROUTE_ORDER guards — valid
 * documented records, the anti-silent-drop law (unknown fields are typed
 * MappingErrors), malformed documented fields, unknown message types,
 * the documented conditional-field matrix, the lastQty/lastPx pairing
 * law, and the derived canonical escape-hatch form (canonical vocabulary
 * keys only).
 */

import { describe, expect, it } from 'vitest';

import {
  guardOrderStatePayload,
  guardRoutingInstructionPayload,
  deriveOrderStatePayload,
  isNormalizedOrderState,
  OMS_EMS_RAW_FIELD_NAMES,
  CANONICAL_ORDER_STATUSES,
  STATUS_MAP,
  omsEmsProtocolCodeOf,
  isMappingError,
  type JsonObject,
} from './index';
import { fixtureOrderState, fixturePartiallyFilledState, fixtureFilledState } from './test-fixtures';

const asJson = (value: Record<string, unknown>): JsonObject => value as JsonObject;

describe('guardOrderStatePayload (channel "orderState")', () => {
  it('accepts the documented shapes and normalizes the documented time', () => {
    const expectedTimes: readonly number[] = [1_717_459_200_000, 1_717_459_200_500, 1_717_459_201_000];
    const fixtures = [fixtureOrderState(), fixturePartiallyFilledState(), fixtureFilledState()];
    fixtures.forEach((fixture, index) => {
      const result = guardOrderStatePayload(asJson(fixture));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(isNormalizedOrderState(result.value)).toBe(true);
        expect(result.value.updatedAtMs).toBe(expectedTimes[index]);
        expect(result.value.filledQty).toBe(fixture.filledQty as string);
        expect(result.value.status).toBe(fixture.status as keyof typeof STATUS_MAP);
      }
    });
  });

  it('an extra field the schema does not document is a typed MappingError (anti-silent-drop)', () => {
    const result = guardOrderStatePayload(asJson({ ...fixtureOrderState(), vendor_extra: 'surprise' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(isMappingError(result.error)).toBe(true);
      expect(result.error.code).toBe('unmapped_raw_field');
      expect(result.error.message).toContain('vendor_extra');
    }
  });

  it('a missing documented field is a typed malformed_payload error', () => {
    const missing = { ...fixtureOrderState() };
    delete (missing as Record<string, unknown>).orderId;
    const result = guardOrderStatePayload(asJson(missing));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(omsEmsProtocolCodeOf(result.error)).toBe('malformed_payload');
      expect(result.error.message).toContain('orderId');
    }
  });

  it('an undocumented recordType discriminator is a typed unknown_message_type error', () => {
    const result = guardOrderStatePayload(asJson(fixtureOrderState({ recordType: 'BALANCE' })));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(omsEmsProtocolCodeOf(result.error)).toBe('unknown_message_type');
  });

  it('documented status codes outside the declared domain are typed malformed_payload errors', () => {
    const result = guardOrderStatePayload(asJson(fixtureOrderState({ status: 'PENDING' })));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(omsEmsProtocolCodeOf(result.error)).toBe('malformed_payload');
  });

  it('the sequence must be a positive integer (the documented per-order monotonic sequence)', () => {
    for (const bad of [0, -1, 1.5, '1', null]) {
      const result = guardOrderStatePayload(asJson(fixtureOrderState({ sequence: bad })));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(omsEmsProtocolCodeOf(result.error)).toBe('malformed_payload');
    }
  });

  it('the lastQty/lastPx pairing law (both or neither)', () => {
    const onlyQty = guardOrderStatePayload(asJson(fixtureOrderState({ lastQty: '0.2' })));
    expect(onlyQty.ok).toBe(false);
    if (!onlyQty.ok) expect(onlyQty.error.message).toContain('together');
    const both = guardOrderStatePayload(asJson(fixtureOrderState({ lastQty: '0.2', lastPx: '50000.00' })));
    expect(both.ok).toBe(true);
  });

  it('a malformed documented time is a typed invalid_time_field error', () => {
    const result = guardOrderStatePayload(asJson(fixtureOrderState({ updatedAt: '20240604-00:00:00.000' })));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(omsEmsProtocolCodeOf(result.error)).toBe('invalid_time_field');
  });

  it('documented decimal fields must be decimal strings (never numbers)', () => {
    const result = guardOrderStatePayload(asJson(fixtureOrderState({ filledQty: 0 })));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(omsEmsProtocolCodeOf(result.error)).toBe('malformed_payload');
      expect(result.error.message).toContain('filledQty');
    }
  });
});

describe('guardRoutingInstructionPayload (channel "routingInstruction")', () => {
  const validInstruction = {
    action: 'ROUTE_ORDER',
    venue: 'BROKER-FIX',
    clientOrderId: 't039-fx-1',
    side: 'buy',
    orderType: 'limit',
    quantity: '0.5',
    limitPrice: '50000.00',
    timeInForce: 'gtc',
    updatedAt: '2024-06-04T00:00:00.000Z',
  };

  it('accepts the documented limit instruction and preserves every documented field', () => {
    const result = guardRoutingInstructionPayload(asJson(validInstruction));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.orderType).toBe('limit');
      expect(result.value.limitPrice).toBe('50000.00');
      expect(result.value.timeInForce).toBe('gtc');
    }
  });

  it('accepts the documented market instruction (neither limitPrice nor stopPrice)', () => {
    const result = guardRoutingInstructionPayload(asJson({ ...validInstruction, orderType: 'market', limitPrice: undefined, timeInForce: 'day' }));
    expect(result.ok).toBe(true);
  });

  it('enforces the documented conditional-field matrix with typed errors', () => {
    const badMarket = guardRoutingInstructionPayload(asJson({ ...validInstruction, orderType: 'market' }));
    expect(badMarket.ok).toBe(false);
    if (!badMarket.ok) expect(omsEmsProtocolCodeOf(badMarket.error)).toBe('malformed_payload');
    const noPrice = { ...validInstruction };
    delete (noPrice as Record<string, unknown>).limitPrice;
    const badLimit = guardRoutingInstructionPayload(asJson(noPrice));
    expect(badLimit.ok).toBe(false);
    const goodStopLimit = guardRoutingInstructionPayload(asJson({ ...validInstruction, orderType: 'stop_limit', stopPrice: '49000.00' }));
    expect(goodStopLimit.ok).toBe(true);
  });

  it('gtt requires expireAt; other documented TIF values reject it', () => {
    const gtt = guardRoutingInstructionPayload(asJson({ ...validInstruction, timeInForce: 'gtt' }));
    expect(gtt.ok).toBe(false);
    if (!gtt.ok) expect(gtt.error.message).toContain('expireAt');
    const gttWithExpiry = guardRoutingInstructionPayload(asJson({ ...validInstruction, timeInForce: 'gtt', expireAt: '2025-06-04T00:00:00.000Z' }));
    expect(gttWithExpiry.ok).toBe(true);
    const dayWithExpiry = guardRoutingInstructionPayload(asJson({ ...validInstruction, timeInForce: 'day', expireAt: '2025-06-04T00:00:00.000Z' }));
    expect(dayWithExpiry.ok).toBe(false);
  });

  it('an extra field the schema does not document is a typed MappingError', () => {
    const result = guardRoutingInstructionPayload(asJson({ ...validInstruction, tenant: 'nope' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unmapped_raw_field');
  });

  it('an undocumented action is a typed unknown_message_type error', () => {
    const result = guardRoutingInstructionPayload(asJson({ ...validInstruction, action: 'CANCEL_ORDER' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(omsEmsProtocolCodeOf(result.error)).toBe('unknown_message_type');
  });
});

describe('deriveOrderStatePayload (the canonical escape-hatch derivation)', () => {
  it('derives canonical vocabulary keys only — never the documented raw names', () => {
    const guarded = guardOrderStatePayload(asJson(fixturePartiallyFilledState()));
    expect(guarded.ok).toBe(true);
    if (!guarded.ok) throw new Error('fixture must guard');
    const derived = deriveOrderStatePayload(guarded.value);
    const data = derived.data as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual([
      'avg_px',
      'client_order_id',
      'filled_qty',
      'last_px',
      'last_qty',
      'leaves_qty',
      'order_id',
      'order_qty',
      'status',
      'venue',
    ]);
    expect(data.status).toBe('partially_filled');
    expect(data.filled_qty).toBe('0.2');
    expect(derived.updatedAtMs).toBe(1_717_459_200_500);
  });

  it('the documented raw vocabulary is exported for the neutrality trip-wire', () => {
    expect(OMS_EMS_RAW_FIELD_NAMES).toContain('orderId');
    expect(OMS_EMS_RAW_FIELD_NAMES).toContain('filledQty');
    expect(OMS_EMS_RAW_FIELD_NAMES.length).toBeGreaterThan(15);
    expect(CANONICAL_ORDER_STATUSES).toContain('partially_filled');
    expect(Object.keys(STATUS_MAP).length).toBe(6);
  });
});
