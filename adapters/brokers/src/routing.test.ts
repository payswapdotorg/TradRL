/**
 * @tradrl/adapter-brokers — the L8 order-routing translation tests.
 *
 * THE EXISTENTIAL TESTS OF THIS WORK ORDER: "An adapter call path that
 * could route an order without a valid APPROVED decision record is a
 * typed error (design + negative tests)." Every negative path is here:
 * garbage decisions, refusal decisions, malformed decisions, thrown kill
 * switches, embedded credential MATERIAL (deep in the tree, under
 * normalized key shapes), malformed intents, undocumented vocabulary —
 * plus the positive path (a valid APPROVE decision builds the documented
 * NewOrderSingle message, byte-identically, deterministically).
 */

import { describe, expect, it } from 'vitest';

import {
  buildBrokerNewOrderSingle,
  BROKER_ORDER_CHANNEL,
  brokerProtocolCodeOf,
  isOrderIntentMirror,
  isApprovedDecisionMirror,
  isRefusalDecisionMirror,
  credentialValueViolations,
  type BrokerOrderRouting,
} from './index';
import {
  fixtureApproveDecision,
  fixtureRefusalDecision,
  fixtureIntent,
  fixtureStandingSwitch,
  fixtureThrownSwitch,
} from './test-fixtures';

/** The valid routing bundle (approve + limit-buy intent + standing switch). */
function validRouting(overrides: Record<string, unknown> = {}): BrokerOrderRouting {
  return {
    decision: fixtureApproveDecision(),
    intent: fixtureIntent(),
    kill_switch: fixtureStandingSwitch(),
    ...overrides,
  } as BrokerOrderRouting;
}

describe('THE L8 EXISTENTIAL CHECK — routing without a valid APPROVED decision is a typed error', () => {
  it('garbage decisions are refused with the typed decision_not_approved error', () => {
    for (const decision of [null, undefined, 42, 'approve', {}, { kind: 'approve' }]) {
      const result = buildBrokerNewOrderSingle(validRouting({ decision }));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(brokerProtocolCodeOf(result.error)).toBe('decision_not_approved');
        expect(result.error.message).toContain('L8');
      }
    }
  });

  it('a REFUSAL decision is refused (a refusal is a record, never authority)', () => {
    const refusal = fixtureRefusalDecision();
    expect(isRefusalDecisionMirror(refusal)).toBe(true);
    const result = buildBrokerNewOrderSingle(validRouting({ decision: refusal }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(brokerProtocolCodeOf(result.error)).toBe('decision_not_approved');
      expect(result.error.message).toContain('REFUSAL');
    }
  });

  it('a decision failing the mirror guard is refused (tampered checks, lineage, policy)', () => {
    for (const tamper of [
      { checks: [{ dimension: 'limits', ordinal: 4, outcome: 'fail' }] }, // an "approve" carrying a failed check
      { lineage: null },
      { decisionId: 'not-xd-prefixed' },
      { policy: { policyId: '', version: 1 } },
      { asOf: -1 },
      { checkOrder: ['not_a_check'] },
    ]) {
      const decision = fixtureApproveDecision(tamper);
      expect(isApprovedDecisionMirror(decision)).toBe(false);
      const result = buildBrokerNewOrderSingle(validRouting({ decision }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(brokerProtocolCodeOf(result.error)).toBe('decision_not_approved');
    }
  });

  it('there is NO code path around the check: the routing signature takes the decision as data', () => {
    // The builder has exactly one entry point and validates the decision
    // BEFORE any field is translated — verified behaviorally: even a
    // PERFECT intent + standing switch never yields a message when the
    // decision is bad.
    const result = buildBrokerNewOrderSingle({
      decision: { kind: 'nope' },
      intent: fixtureIntent(),
      kill_switch: fixtureStandingSwitch(),
    });
    expect(result.ok).toBe(false);
  });
});

describe('kill-switch honoring (the injected standing fact)', () => {
  it('a THROWN switch refuses the routing with the typed kill_switch_thrown error', () => {
    const result = buildBrokerNewOrderSingle(validRouting({ kill_switch: fixtureThrownSwitch() }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(brokerProtocolCodeOf(result.error)).toBe('kill_switch_thrown');
      expect(result.error.message).toContain('never re-derived');
    }
  });

  it('a malformed switch state is a typed neutral configuration error', () => {
    for (const bad of [null, {}, { state: 'disarmed' }, { state: 1 }]) {
      const result = buildBrokerNewOrderSingle(validRouting({ kill_switch: bad }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('invalid_configuration');
    }
  });
});

describe('credential opacity (T019\'s law — opaque refs only, never values)', () => {
  it('credential MATERIAL anywhere in the routing bundle is refused, FIRST', () => {
    const result = buildBrokerNewOrderSingle(validRouting({ api_key: 'SK-12345' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(brokerProtocolCodeOf(result.error)).toBe('credential_value_present');
      expect(result.error.message).toContain('api_key');
    }
  });

  it('credential MATERIAL nested deep in the tree is caught (normalized key shapes included)', () => {
    for (const [key, deep] of [
      ['apiKey', { intent: { notes: 'ok' }, meta: { apiKey: 'SK-1' } }],
      ['passphrase', { kill_switch: { state: 'standing' }, nested: { list: [{ passphrase: 'x' }] } }],
      ['secret', { decision: fixtureApproveDecision(), extra: { secret: 's' } }],
    ] as const) {
      const bundle = validRouting(deep as Record<string, unknown>);
      const violations = credentialValueViolations(bundle);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations.join(',')).toContain(key);
      const result = buildBrokerNewOrderSingle(bundle);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(brokerProtocolCodeOf(result.error)).toBe('credential_value_present');
    }
  });

  it('the opacity scan runs even before a THROWN switch would refuse (contamination first)', () => {
    const result = buildBrokerNewOrderSingle(validRouting({ kill_switch: fixtureThrownSwitch(), token: 't' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(brokerProtocolCodeOf(result.error)).toBe('credential_value_present');
  });

  it('an OPAQUE cred: ref rides cleanly (the positive direction)', () => {
    const result = buildBrokerNewOrderSingle(validRouting({ credential_ref: 'cred:broker-main@1' }));
    expect(result.ok).toBe(true);
  });

  it('a non-cred: credential ref is a typed neutral configuration error', () => {
    const result = buildBrokerNewOrderSingle(validRouting({ credential_ref: 'SK-12345' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_configuration');
  });
});

describe('the order intent mirror guard (fail-closed)', () => {
  it('malformed intents are refused with typed neutral configuration errors', () => {
    for (const tamper of [
      { quantity: '0' },
      { quantity: '-1' },
      { quantity: 0.5 },
      { side: 'BUY' },
      { kind: 'limit', price: undefined },
      { kind: 'market', price: '50000.00' },
      { createdAt: '2024-06-04' },
      { clientOrderId: '' },
      { timeInForce: 'gtt' }, // gtt requires expiresAt
    ]) {
      const intent = fixtureIntent(tamper);
      expect(isOrderIntentMirror(intent)).toBe(false);
      const result = buildBrokerNewOrderSingle(validRouting({ intent }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('invalid_configuration');
    }
  });

  it('registered extension kinds without a documented code are refused (never silently dropped)', () => {
    const intent = fixtureIntent({ kind: 'iceberg', price: '50000.00' });
    expect(isOrderIntentMirror(intent)).toBe(true); // the mirror accepts extensions...
    const result = buildBrokerNewOrderSingle(validRouting({ intent }));
    expect(result.ok).toBe(false); // ...but the gateway's documented domain does not
    if (!result.ok) expect(result.error.message).toContain('OrdType');
  });
});

describe('the translation itself (the positive path)', () => {
  it('a valid APPROVE decision builds the documented NewOrderSingle message', () => {
    const result = buildBrokerNewOrderSingle(validRouting());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.channel).toBe(BROKER_ORDER_CHANNEL);
      expect(result.value.channel).toBe('newOrderSingle');
      expect(result.value.payload.MsgType).toBe('D');
      expect(result.value.payload.ClOrdID).toBe('t039-fx-1');
      expect(result.value.payload.Symbol).toBe('BTC-USDT');
      expect(result.value.payload.Side).toBe('1');
      expect(result.value.payload.OrdType).toBe('2');
      expect(result.value.payload.OrderQty).toBe('0.5');
      expect(result.value.payload.Price).toBe('50000.00');
      expect(result.value.payload.TimeInForce).toBe('1');
      expect(result.value.payload.TransactTime).toBe('20240604-00:00:00.000');
      expect(result.value.payload.StopPx).toBeUndefined();
      expect(result.value.payload.ExpireTime).toBeUndefined();
    }
  });

  it('the canonical vocabulary maps onto the documented code domains exactly', () => {
    const cases: readonly [Record<string, unknown>, Record<string, unknown>][] = [
      [{ side: 'sell' }, { Side: '2' }],
      [{ kind: 'market', price: undefined }, { OrdType: '1', Price: undefined }],
      [{ kind: 'stop', price: undefined, stopPrice: '49000.00' }, { OrdType: '3', Price: undefined, StopPx: '49000.00' }],
      [{ kind: 'stop-limit', stopPrice: '49000.00' }, { OrdType: '4', StopPx: '49000.00' }],
      [{ timeInForce: 'day' }, { TimeInForce: '0' }],
      [{ timeInForce: 'ioc' }, { TimeInForce: '3' }],
      [{ timeInForce: 'fok' }, { TimeInForce: '4' }],
    ];
    for (const [intentOverride, expected] of cases) {
      const result = buildBrokerNewOrderSingle(validRouting({ intent: fixtureIntent(intentOverride) }));
      expect(result.ok).toBe(true);
      if (result.ok) {
        for (const [field, value] of Object.entries(expected)) {
          expect((result.value.payload as Record<string, unknown>)[field]).toEqual(value);
        }
      }
    }
  });

  it('gtt orders carry the documented ExpireTime (converted from the RFC 3339 expiry)', () => {
    const result = buildBrokerNewOrderSingle(validRouting({ intent: fixtureIntent({ timeInForce: 'gtt', expiresAt: '2025-06-04T00:00:00.000Z' }) }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.payload.ExpireTime).toBe('20250604-00:00:00.000');
  });

  it('the built message is deep-frozen with a FIXED key order (byte-determinism)', () => {
    const first = buildBrokerNewOrderSingle(validRouting());
    const second = buildBrokerNewOrderSingle(validRouting());
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    if (first.ok) {
      expect(Object.isFrozen(first.value.payload)).toBe(true);
      expect(Object.keys(first.value.payload)).toEqual([
        'MsgType',
        'ClOrdID',
        'Symbol',
        'Side',
        'TransactTime',
        'OrdType',
        'OrderQty',
        'Price',
        'TimeInForce',
      ]);
      expect(() => {
        (first.value.payload as Record<string, unknown>).OrderQty = '1';
      }).toThrow();
    }
  });

  it('the decision\'s identity rides NOWHERE in the message (the broker has no use for it)', () => {
    const result = buildBrokerNewOrderSingle(validRouting());
    expect(result.ok).toBe(true);
    if (result.ok) {
      const serialized = JSON.stringify(result.value.payload);
      expect(serialized).not.toContain('decisionId');
      expect(serialized).not.toContain('xd:');
      expect(serialized).not.toContain('policyId');
      expect(serialized).not.toContain('tenant');
    }
  });

  it('a non-UTC RFC 3339 creation instant converts exactly', () => {
    const result = buildBrokerNewOrderSingle(validRouting({ intent: fixtureIntent({ createdAt: '2024-06-04T02:00:00.000+02:00' }) }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.payload.TransactTime).toBe('20240604-00:00:00.000');
  });
});
