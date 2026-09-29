/**
 * @tradrl/adapter-oms-ems — the order-state reconciliation engine tests.
 *
 * THE WORK ORDER'S SECTION-4 TESTS ("an OMS state reconciliation — that
 * is this Work Order"): every reconciliation law, positive and negative —
 * report sequencing, cumulative progression (exact decimal arithmetic),
 * open-quantity consistency, the volume-weighted average price law, and
 * the OMS-vs-broker state agreement (each disagreeing field named).
 * Plus: the input guards, the agreement record's totality and
 * immutability, and the exact-decimal arithmetic's own properties.
 */

import { describe, expect, it } from 'vitest';

import {
  reconcileOrderState,
  isExecutionReportData,
  isOrderStateData,
  RECONCILIATION_LAWS,
  omsEmsProtocolCodeOf,
  type OrderStateAgreement,
} from './index';
import {
  fixtureReportData,
  fixtureFilledStateData,
} from './test-fixtures';

describe('the input guards', () => {
  it('guards canonical execution-report data records', () => {
    for (const report of fixtureReportData()) {
      expect(isExecutionReportData(report)).toBe(true);
    }
    for (const bad of [
      {},
      { ...fixtureReportData()[0], order_id: '' },
      { ...fixtureReportData()[0], cum_qty: 0 },
      { ...fixtureReportData()[0], exec_id: null },
      'nope',
      null,
    ]) {
      expect(isExecutionReportData(bad)).toBe(false);
    }
  });

  it('guards canonical order-state data records', () => {
    expect(isOrderStateData(fixtureFilledStateData())).toBe(true);
    for (const bad of [
      {},
      { ...fixtureFilledStateData(), status: '' },
      { ...fixtureFilledStateData(), filled_qty: 0 },
      { ...fixtureFilledStateData(), last_qty: 'x' },
      null,
    ]) {
      expect(isOrderStateData(bad)).toBe(false);
    }
  });
});

describe('the successful reconciliation (all five laws pass)', () => {
  it('the new -> partial -> fill stream reconciles with the FILLED state exactly', () => {
    const result = reconcileOrderState({
      order_state: fixtureFilledStateData(),
      reports: fixtureReportData(),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const agreement: OrderStateAgreement = result.value;
      expect(agreement.order_id).toBe('TEST-ORDER-1');
      expect(agreement.client_order_id).toBe('t039-fx-1');
      expect(agreement.filled_qty).toBe('0.5');
      expect(agreement.leaves_qty).toBe('0');
      expect(agreement.avg_px).toBe('50060.00');
      expect(agreement.status).toBe('filled');
      expect(agreement.report_count).toBe(3);
      expect(agreement.executed_laws).toEqual([...RECONCILIATION_LAWS]);
      expect(Object.isFrozen(agreement)).toBe(true);
    }
  });

  it('a PARTIALLY_FILLED state reconciles against the first two reports', () => {
    const partialState = {
      ...fixtureFilledStateData(),
      status: 'partially_filled',
      filled_qty: '0.2',
      leaves_qty: '0.3',
      avg_px: '50000.00',
      last_qty: '0.2',
      last_px: '50000.00',
    };
    const result = reconcileOrderState({
      order_state: partialState,
      reports: fixtureReportData().slice(0, 2),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe('partially_filled');
      expect(result.value.filled_qty).toBe('0.2');
      expect(result.value.report_count).toBe(2);
    }
  });

  it('a state without last-trade fields reconciles too (the optional direction)', () => {
    const state = { ...fixtureFilledStateData() };
    delete (state as Record<string, unknown>).last_qty;
    delete (state as Record<string, unknown>).last_px;
    const result = reconcileOrderState({ order_state: state, reports: fixtureReportData() });
    expect(result.ok).toBe(true);
  });
});

describe('LAW 1 — report sequence (documented execution order)', () => {
  it('a repeated execution id is a typed reconcile_report_sequence error', () => {
    const reports = [...fixtureReportData(), fixtureReportData()[1]];
    const result = reconcileOrderState({ order_state: fixtureFilledStateData(), reports });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(omsEmsProtocolCodeOf(result.error)).toBe('reconcile_report_sequence');
  });
});

describe('LAW 2 — cumulative progression (exact decimal arithmetic)', () => {
  it('a trade advancing CumQty by the wrong amount is a typed reconcile_cum_qty error', () => {
    const reports = [...fixtureReportData()];
    // The first trade claims 0.25 executed but reports cum 0.2.
    const tampered = { ...(reports[1] as Record<string, unknown>), cum_qty: '0.25' };
    const result = reconcileOrderState({ order_state: fixtureFilledStateData(), reports: [reports[0], tampered, reports[2]] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(omsEmsProtocolCodeOf(result.error)).toBe('reconcile_cum_qty');
      expect(result.error.message).toContain('TEST-EXEC-2');
    }
  });

  it('a non-trade report that MOVES CumQty is a typed reconcile_cum_qty error', () => {
    const reports = [
      { ...(fixtureReportData()[0] as Record<string, unknown>), cum_qty: '0.2' },
      { ...(fixtureReportData()[1] as Record<string, unknown>) },
      { ...(fixtureReportData()[2] as Record<string, unknown>) },
    ];
    const state = { ...fixtureFilledStateData() };
    const result = reconcileOrderState({ order_state: state, reports });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(omsEmsProtocolCodeOf(result.error)).toBe('reconcile_cum_qty');
  });

  it('the arithmetic is exact for many-digit decimals (no float mediation)', () => {
    // 0.123456789 + 0.000000001 = 0.123456790 exactly.
    const base = fixtureReportData()[0] as Record<string, unknown>;
    const trade1 = {
      ...base,
      exec_id: 'E1',
      exec_type: 'partial_fill',
      order_status: 'partially_filled',
      last_qty: '0.123456789',
      last_px: '1000000000.00',
      cum_qty: '0.123456789',
      leaves_qty: '0.376543211',
      avg_px: '1000000000.00',
    };
    const trade2 = {
      ...base,
      exec_id: 'E2',
      exec_type: 'fill',
      order_status: 'filled',
      last_qty: '0.000000001',
      last_px: '1000000000.00',
      cum_qty: '0.123456790',
      leaves_qty: '0',
      avg_px: '1000000000.00',
    };
    const state = {
      order_id: 'TEST-ORDER-1',
      client_order_id: 't039-fx-1',
      status: 'filled',
      venue: 'BROKER-FIX',
      order_qty: '0.123456790',
      filled_qty: '0.123456790',
      leaves_qty: '0',
      avg_px: '1000000000.00',
      last_qty: '0.000000001',
      last_px: '1000000000.00',
    };
    const result = reconcileOrderState({ order_state: state, reports: [trade1, trade2] });
    expect(result.ok).toBe(true);
  });
});

describe('LAW 3 — open quantity (LeavesQty == OrderQty - CumQty while live)', () => {
  it('a wrong LeavesQty on a live order is a typed reconcile_leaves_qty error', () => {
    const reports = [...fixtureReportData()];
    const tampered = { ...(reports[1] as Record<string, unknown>), leaves_qty: '0.4' };
    const result = reconcileOrderState({ order_state: fixtureFilledStateData(), reports: [reports[0], tampered, reports[2]] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(omsEmsProtocolCodeOf(result.error)).toBe('reconcile_leaves_qty');
      expect(result.error.message).toContain('0.4');
    }
  });
});

describe('LAW 4 — average price (volume-weighted, exact)', () => {
  it('a misweighted AvgPx is a typed reconcile_avg_px error', () => {
    const reports = [...fixtureReportData()];
    const tampered = { ...(reports[2] as Record<string, unknown>), avg_px: '50050.00' };
    const state = { ...fixtureFilledStateData(), avg_px: '50050.00' };
    const result = reconcileOrderState({ order_state: state, reports: [reports[0], reports[1], tampered] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(omsEmsProtocolCodeOf(result.error)).toBe('reconcile_avg_px');
  });

  it('the volume-weighted law holds for uneven fills (0.2 @ 50000 + 0.3 @ 50100 -> 50060)', () => {
    const result = reconcileOrderState({ order_state: fixtureFilledStateData(), reports: fixtureReportData() });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.avg_px).toBe('50060.00');
  });
});

describe('LAW 5 — state agreement (the OMS vs the broker)', () => {
  it('a disagreeing filled_qty is a typed reconcile_state_mismatch error naming the field', () => {
    const state = { ...fixtureFilledStateData(), filled_qty: '0.4' };
    const result = reconcileOrderState({ order_state: state, reports: fixtureReportData() });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(omsEmsProtocolCodeOf(result.error)).toBe('reconcile_state_mismatch');
      expect(result.error.message).toContain('filled_qty');
    }
  });

  it('a disagreeing status is named', () => {
    const state = { ...fixtureFilledStateData(), status: 'partially_filled' };
    const result = reconcileOrderState({ order_state: state, reports: fixtureReportData() });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('status');
  });

  it('a disagreeing last_px is named', () => {
    const state = { ...fixtureFilledStateData(), last_px: '50099.00' };
    const result = reconcileOrderState({ order_state: state, reports: fixtureReportData() });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('last_px');
  });

  it('a state claiming a last trade with no trade reports is named', () => {
    const onlyNew = [fixtureReportData()[0]];
    const state = { ...fixtureFilledStateData(), status: 'new', filled_qty: '0', leaves_qty: '0.5', avg_px: '0', last_qty: '0.2', last_px: '50000.00' };
    const result = reconcileOrderState({ order_state: state, reports: onlyNew });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('no trade report');
  });

  it('reports for a DIFFERENT order are refused', () => {
    const foreign = { ...(fixtureReportData()[0] as Record<string, unknown>), order_id: 'OTHER-ORDER' };
    const result = reconcileOrderState({ order_state: fixtureFilledStateData(), reports: [foreign] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(omsEmsProtocolCodeOf(result.error)).toBe('reconcile_state_mismatch');
  });

  it('multiple disagreements are ALL named in one refusal (collect-all discipline)', () => {
    const state = { ...fixtureFilledStateData(), filled_qty: '0.4', leaves_qty: '0.2', status: 'new' };
    const result = reconcileOrderState({ order_state: state, reports: fixtureReportData() });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('filled_qty');
      expect(result.error.message).toContain('leaves_qty');
      expect(result.error.message).toContain('status');
    }
  });
});

describe('input totality (typed configuration refusals)', () => {
  it('a malformed order-state record is a typed neutral configuration error', () => {
    for (const bad of [null, {}, { order_id: 'X' }]) {
      const result = reconcileOrderState({ order_state: bad, reports: fixtureReportData() });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('invalid_configuration');
    }
  });

  it('an empty report list is a typed neutral configuration error', () => {
    const result = reconcileOrderState({ order_state: fixtureFilledStateData(), reports: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_configuration');
  });

  it('a malformed report is a typed neutral configuration error naming the index', () => {
    const result = reconcileOrderState({ order_state: fixtureFilledStateData(), reports: [fixtureReportData()[0], {}] });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('invalid_configuration');
      expect(result.error.message).toContain('index 1');
    }
  });
});

describe('determinism (pure function, no clock, no randomness)', () => {
  it('the same inputs produce byte-identical verdicts (twice)', () => {
    const first = reconcileOrderState({ order_state: fixtureFilledStateData(), reports: fixtureReportData() });
    const second = reconcileOrderState({ order_state: fixtureFilledStateData(), reports: fixtureReportData() });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    const badFirst = reconcileOrderState({ order_state: { ...fixtureFilledStateData(), filled_qty: '0.4' }, reports: fixtureReportData() });
    const badSecond = reconcileOrderState({ order_state: { ...fixtureFilledStateData(), filled_qty: '0.4' }, reports: fixtureReportData() });
    expect(JSON.stringify(badFirst)).toBe(JSON.stringify(badSecond));
  });
});
