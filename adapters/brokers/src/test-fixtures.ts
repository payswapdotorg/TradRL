// @tradrl/adapter-brokers — shared test fixtures (internal test support;
// NOT exported from the package index — the contract surface stays clean).
//
// The fixtures mirror the discipline of the sibling packages' test
// suites: hand-assembled records that are VALID by construction (the
// unwrap helper fails loudly if a fixture drifts from the contract),
// with override-based variants for the negative paths. Every value is
// SYNTHETIC (opaque TEST-* identifiers, synthetic decimals) — no
// account-specific data, no credentials, no licensed content.

import type { ApprovedDecisionMirror, ExecutionLineageMirror, OrderIntentMirror, RefusalDecisionMirror } from './decision-mirror';

/** The fixture clock base (explicit literals — no ambient clock). */
export const T0 = 1_717_459_200_000;

/** The fixture clock base in the documented UTCTimestamp form. */
export const FIX_T0 = '20240604-00:00:00.000';

/** The fixture clock base in the execution lane's RFC 3339 form. */
export const RFC_T0 = '2024-06-04T00:00:00.000Z';

/** Unwrap a fixture result or fail loudly (fixtures are valid by construction). */
export function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (result.ok) return result.value;
  throw new Error(`fixture must be valid: ${result.error.message}`);
}

/** The fixture execution lineage (L9 — mirrors T019's fixture lineage). */
export function fixtureLineage(): ExecutionLineageMirror {
  return {
    intentRef: 'si:fixture0001',
    strategy: { specId: 'spec-fixture', version: 1 },
    goal: { goalId: 'goal-fixture', version: 1 },
    policy: { policyId: 'xpol:fixture01', version: 1 },
    venues: ['BROKER-FIX'],
    seed: 't039-seed',
    tenant: 'tenant-alpha',
    project: 'project-one',
  };
}

/** A valid APPROVE decision fixture (mirrors T019's decision output shape), overridable per test. */
export function fixtureApproveDecision(overrides: Record<string, unknown> = {}): ApprovedDecisionMirror {
  const base = {
    kind: 'approve',
    decisionId: 'xd:fixture01',
    intentRef: 'si:fixture0001',
    policy: { policyId: 'xpol:fixture01', version: 1 },
    checkOrder: [
      'kill_switch',
      'identity',
      'authorization',
      'limits',
      'venue_permissions',
      'rate_limits',
      'credentials',
    ],
    checks: [
      { dimension: 'kill_switch', ordinal: 1, outcome: 'pass' },
      { dimension: 'identity', ordinal: 2, outcome: 'pass' },
      { dimension: 'authorization', ordinal: 3, outcome: 'pass' },
      { dimension: 'limits', ordinal: 4, outcome: 'pass' },
      { dimension: 'venue_permissions', ordinal: 5, outcome: 'pass' },
      { dimension: 'rate_limits', ordinal: 6, outcome: 'pass' },
      { dimension: 'credentials', ordinal: 7, outcome: 'pass' },
    ],
    lineage: fixtureLineage(),
    asOf: T0,
  } as unknown as ApprovedDecisionMirror;
  return { ...base, ...overrides } as unknown as ApprovedDecisionMirror;
}

/** A valid REFUSAL decision fixture (the L8 negative path), overridable per test. */
export function fixtureRefusalDecision(overrides: Record<string, unknown> = {}): RefusalDecisionMirror {
  const base = {
    kind: 'refuse',
    decisionId: 'xd:fixture02',
    intentRef: 'si:fixture0001',
    policy: { policyId: 'xpol:fixture01', version: 1 },
    checkOrder: [
      'kill_switch',
      'identity',
      'authorization',
      'limits',
      'venue_permissions',
      'rate_limits',
      'credentials',
    ],
    checks: [
      { dimension: 'kill_switch', ordinal: 1, outcome: 'pass' },
      { dimension: 'identity', ordinal: 2, outcome: 'pass' },
      { dimension: 'limits', ordinal: 4, outcome: 'fail' },
    ],
    failure: {
      dimension: 'limits',
      ordinal: 4,
      reason: {
        dimension: 'limits',
        limit: 'order_size',
        instrumentClass: 'crypto',
        cap: '1',
        observed: '5',
        excess: '4',
      },
    },
    lineage: fixtureLineage(),
    asOf: T0,
  } as unknown as RefusalDecisionMirror;
  return { ...base, ...overrides } as unknown as RefusalDecisionMirror;
}

/** A valid limit-buy order intent fixture (the mirrored OrderIntent shape), overridable per test. */
export function fixtureIntent(overrides: Record<string, unknown> = {}): OrderIntentMirror {
  const base = {
    clientOrderId: 't039-fx-1',
    instrumentId: 'BTC-USDT',
    venueId: 'BROKER-FIX',
    side: 'buy',
    kind: 'limit',
    quantity: '0.5',
    price: '50000.00',
    timeInForce: 'gtc',
    createdAt: RFC_T0,
  } as unknown as OrderIntentMirror;
  return { ...base, ...overrides } as unknown as OrderIntentMirror;
}

/** A standing (armed) kill-switch fixture state. */
export function fixtureStandingSwitch(): { state: 'standing' } {
  return { state: 'standing' };
}

/** A thrown kill-switch fixture state. */
export function fixtureThrownSwitch(): { state: 'thrown' } {
  return { state: 'thrown' };
}

/** One documented ExecutionReport payload fixture (synthetic values), overridable per test. */
export function fixtureExecutionReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base = {
    MsgType: '8',
    OrderID: 'TEST-ORDER-1',
    ClOrdID: 't039-fx-1',
    ExecID: 'TEST-EXEC-1',
    ExecType: '0',
    OrdStatus: '0',
    Side: '1',
    Symbol: 'BTC-USDT',
    OrderQty: '0.5',
    LastQty: '0',
    LastPx: '0',
    CumQty: '0',
    LeavesQty: '0.5',
    AvgPx: '0',
    TransactTime: FIX_T0,
  };
  return { ...base, ...overrides };
}

/** A partial-fill ExecutionReport fixture (trade number one of two). */
export function fixturePartialFill(): Record<string, unknown> {
  return fixtureExecutionReport({
    ExecID: 'TEST-EXEC-2',
    ExecType: '1',
    OrdStatus: '1',
    LastQty: '0.2',
    LastPx: '50000.00',
    CumQty: '0.2',
    LeavesQty: '0.3',
    AvgPx: '50000.00',
  });
}

/** The fill ExecutionReport fixture (trade number two of two). */
export function fixtureFill(): Record<string, unknown> {
  return fixtureExecutionReport({
    ExecID: 'TEST-EXEC-3',
    ExecType: '2',
    OrdStatus: '2',
    LastQty: '0.3',
    LastPx: '50100.00',
    CumQty: '0.5',
    LeavesQty: '0',
    AvgPx: '50060.00',
  });
}
