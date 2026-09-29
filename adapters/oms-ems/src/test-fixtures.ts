// @tradrl/adapter-oms-ems — shared test fixtures (internal test support;
// NOT exported from the package index — the contract surface stays clean).
//
// The fixtures mirror the discipline of the sibling packages' test
// suites: hand-assembled records that are VALID by construction (the
// unwrap helper fails loudly if a fixture drifts from the contract),
// with override-based variants for the negative paths. Every value is
// SYNTHETIC (opaque TEST-* identifiers, synthetic decimals) — no
// tenant-specific data, no credentials, no licensed content.

import type { ApprovedDecisionMirror, ExecutionLineageMirror, OrderIntentMirror, RefusalDecisionMirror } from './decision-mirror';

/** The fixture clock base (explicit literals — no ambient clock). */
export const T0 = 1_717_459_200_000;

/** The fixture clock base in the documented ISO-8601 UTC form. */
export const ISO_T0 = '2024-06-04T00:00:00.000Z';

/** The fixture clock base in the execution lane's RFC 3339 form (same instant). */
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
    venues: ['OMS-EMS'],
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
    venueId: 'OMS-EMS',
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

/** One documented ORDER_STATE record fixture (synthetic values), overridable per test. */
export function fixtureOrderState(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base = {
    recordType: 'ORDER_STATE',
    orderId: 'TEST-ORDER-1',
    clOrdId: 't039-fx-1',
    sequence: 1,
    status: 'NEW',
    venue: 'BROKER-FIX',
    orderQty: '0.5',
    filledQty: '0',
    leavesQty: '0.5',
    avgPx: '0',
    updatedAt: ISO_T0,
  };
  return { ...base, ...overrides };
}

/** The PARTIALLY_FILLED ORDER_STATE fixture (after the first partial fill). */
export function fixturePartiallyFilledState(): Record<string, unknown> {
  return fixtureOrderState({
    sequence: 2,
    status: 'PARTIALLY_FILLED',
    filledQty: '0.2',
    leavesQty: '0.3',
    avgPx: '50000.00',
    lastQty: '0.2',
    lastPx: '50000.00',
    updatedAt: '2024-06-04T00:00:00.500Z',
  });
}

/** The FILLED ORDER_STATE fixture (after the final fill). */
export function fixtureFilledState(): Record<string, unknown> {
  return fixtureOrderState({
    sequence: 3,
    status: 'FILLED',
    filledQty: '0.5',
    leavesQty: '0',
    avgPx: '50060.00',
    lastQty: '0.3',
    lastPx: '50100.00',
    updatedAt: '2024-06-04T00:00:01.000Z',
  });
}

/** The canonical execution-report data fixtures matching the broker lane's emitted data (new -> partial -> fill). */
export function fixtureReportData(): readonly Record<string, unknown>[] {
  return [
    {
      order_id: 'TEST-ORDER-1',
      client_order_id: 't039-fx-1',
      exec_id: 'TEST-EXEC-1',
      exec_type: 'new',
      order_status: 'new',
      side: 'buy',
      order_qty: '0.5',
      last_qty: '0',
      last_px: '0',
      cum_qty: '0',
      leaves_qty: '0.5',
      avg_px: '0',
    },
    {
      order_id: 'TEST-ORDER-1',
      client_order_id: 't039-fx-1',
      exec_id: 'TEST-EXEC-2',
      exec_type: 'partial_fill',
      order_status: 'partially_filled',
      side: 'buy',
      order_qty: '0.5',
      last_qty: '0.2',
      last_px: '50000.00',
      cum_qty: '0.2',
      leaves_qty: '0.3',
      avg_px: '50000.00',
    },
    {
      order_id: 'TEST-ORDER-1',
      client_order_id: 't039-fx-1',
      exec_id: 'TEST-EXEC-3',
      exec_type: 'fill',
      order_status: 'filled',
      side: 'buy',
      order_qty: '0.5',
      last_qty: '0.3',
      last_px: '50100.00',
      cum_qty: '0.5',
      leaves_qty: '0',
      avg_px: '50060.00',
    },
  ];
}

/** The canonical order-state data fixture matching the FILLED state (for reconciliation). */
export function fixtureFilledStateData(): Record<string, unknown> {
  return {
    order_id: 'TEST-ORDER-1',
    client_order_id: 't039-fx-1',
    status: 'filled',
    venue: 'BROKER-FIX',
    order_qty: '0.5',
    filled_qty: '0.5',
    leaves_qty: '0',
    avg_px: '50060.00',
    last_qty: '0.3',
    last_px: '50100.00',
  };
}
