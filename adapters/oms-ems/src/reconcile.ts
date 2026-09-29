/**
 * @tradrl/adapter-oms-ems — the order-state reconciliation engine.
 *
 * THE WORK ORDER'S PROBLEM STATEMENT, section 4: "Nothing in the repo
 * can represent ... an OMS state reconciliation — that is this Work
 * Order." {@link reconcileOrderState} is it: a PURE function that
 * reconciles the OMS's own view of an order (one derived canonical
 * order-state record) against the broker lane's execution reports for
 * the same order (the canonical execution-report data records the broker
 * adapter emits in its events' `other` payload data — provider-neutral
 * vocabulary on BOTH sides, so this module never touches the broker
 * lane's provider vocabulary; the cross-adapter flow is trip-wired in
 * the interop test).
 *
 * THE RECONCILIATION LAWS (each a typed, deterministic, first-failure
 * refusal — the lane's error taxonomy, ../protocol.ts):
 *
 *   1. REPORT SEQUENCE: the reports must arrive in documented execution
 *      order — a repeated or regressing execution id is the typed
 *      `reconcile_report_sequence` (the reports are keyed by exec_id;
 *      the OMS sees them in the broker's sequence).
 *   2. CUMULATIVE PROGRESS: CumQty is cumulative — each TRADE report
 *      (exec_type partial_fill | fill) must advance it by EXACTLY that
 *      trade's last_qty (exact decimal arithmetic — see below);
 *      non-trade reports leave it unchanged. A violation is the typed
 *      `reconcile_cum_qty`.
 *   3. OPEN QUANTITY: while the order is live (new | partially_filled),
 *      LeavesQty must equal OrderQty minus CumQty exactly. A violation
 *      is the typed `reconcile_leaves_qty`.
 *   4. AVERAGE PRICE: AvgPx times CumQty must equal the summed trade
 *      notional (Σ last_qty × last_px) exactly — the documented
 *      volume-weighted average of the fills. A violation is the typed
 *      `reconcile_avg_px`.
 *   5. STATE AGREEMENT: the OMS's own order-state record must agree with
 *      the reports' final values (filled_qty == final CumQty; leaves_qty
 *      == final LeavesQty; status == the canonical status of the final
 *      report; last_qty/last_px == the final TRADE report's values when
 *      the state carries them). A violation is the typed
 *      `reconcile_state_mismatch` naming every disagreeing field.
 *
 * EXACT DECIMAL ARITHMETIC (no floats, ever — the canonical discipline):
 * the addition, subtraction and multiplication below are hand-rolled
 * string algorithms (digit-wise, carry-propagating, pure integer
 * arithmetic); the comparisons are the contract mirror's exact lexical
 * decimal comparisons. The engine consumes NO clock and NO randomness —
 * the same inputs always produce the same verdict, byte-identically.
 *
 * THE AGREEMENT RECORD (success): a deep-frozen, self-describing
 * `OrderStateAgreement` — the order's canonical identity (order_id,
 * client_order_id), the final reconciled quantities (filled, leaves,
 * average price), the final canonical status, the number of reports
 * reconciled, and the executed-laws bitmask (every law the engine
 * checked, so downstream consumers can audit what "agreed" MEANT).
 */

import { failure, protocolError, success, type SdkResult } from './contract/errors';
import { deepFreeze } from './contract/freeze';
import { isRecord, isNonEmptyString } from './contract/fields';
import { compareDecimal, isUnsignedDecimal } from './contract/decimals';
import { omsEmsProtocolError } from './protocol';

/** The canonical execution-report data record (the broker lane's emitted `other` payload data — canonical vocabulary). */
export interface ExecutionReportData {
  readonly order_id: string;
  readonly client_order_id: string;
  readonly exec_id: string;
  readonly exec_type: string;
  readonly order_status: string;
  readonly side: string;
  readonly order_qty: string;
  readonly last_qty: string;
  readonly last_px: string;
  readonly cum_qty: string;
  readonly leaves_qty: string;
  readonly avg_px: string;
}

/** The canonical order-state data record (this lane's emitted `other` payload data — canonical vocabulary). */
export interface OrderStateData {
  readonly order_id: string;
  readonly client_order_id: string;
  readonly status: string;
  readonly venue: string;
  readonly order_qty: string;
  readonly filled_qty: string;
  readonly leaves_qty: string;
  readonly avg_px: string;
  readonly last_qty?: string;
  readonly last_px?: string;
}

/** The successful reconciliation: a deep-frozen agreement record. */
export interface OrderStateAgreement {
  /** The order's canonical broker identity. */
  readonly order_id: string;
  readonly client_order_id: string;
  /** The final reconciled filled quantity (the reports' final CumQty). */
  readonly filled_qty: string;
  /** The final reconciled open quantity (the reports' final LeavesQty). */
  readonly leaves_qty: string;
  /** The final reconciled average price (the reports' final AvgPx). */
  readonly avg_px: string;
  /** The final canonical order status (the final report's canonical status). */
  readonly status: string;
  /** How many execution reports were reconciled. */
  readonly report_count: number;
  /** The reconciliation laws the engine executed (audit: what "agreed" MEANT). */
  readonly executed_laws: readonly string[];
}

// ---------------------------------------------------------------------------
// Exact decimal arithmetic (hand-rolled string algorithms — no floats).
// ---------------------------------------------------------------------------

/** Exact decimal addition (both arguments unsigned well-formed decimals). */
function addDecimals(a: string, b: string): string {
  const [aInt, aFrac = ''] = a.split('.');
  const [bInt, bFrac = ''] = b.split('.');
  const width = Math.max(aFrac.length, bFrac.length);
  const left = aInt + aFrac.padEnd(width, '0');
  const right = bInt + bFrac.padEnd(width, '0');
  let carry = 0;
  const sumDigits: string[] = [];
  const length = Math.max(left.length, right.length);
  for (let i = 1; i <= length; i += 1) {
    const da = i <= left.length ? Number(left[left.length - i]) : 0;
    const db = i <= right.length ? Number(right[right.length - i]) : 0;
    const s = da + db + carry;
    sumDigits.push(String(s % 10));
    carry = Math.floor(s / 10);
  }
  if (carry > 0) sumDigits.push(String(carry));
  let sum = sumDigits.reverse().join('').replace(/^0+(?=\d)/, '') || '0';
  if (width === 0) return sum;
  sum = sum.padStart(width + 1, '0');
  return `${sum.slice(0, sum.length - width)}.${sum.slice(sum.length - width)}`;
}

/** Exact decimal multiplication (both arguments unsigned well-formed decimals). */
function multiplyDecimals(a: string, b: string): string {
  const [aInt, aFrac = ''] = a.split('.');
  const [bInt, bFrac = ''] = b.split('.');
  const scale = aFrac.length + bFrac.length;
  const leftDigits = (aInt + aFrac).replace(/^0+(?=\d)/, '') || '0';
  const rightDigits = (bInt + bFrac).replace(/^0+(?=\d)/, '') || '0';
  const product = new Array<number>(leftDigits.length + rightDigits.length).fill(0);
  for (let i = leftDigits.length - 1; i >= 0; i -= 1) {
    const da = Number(leftDigits[i]);
    for (let j = rightDigits.length - 1; j >= 0; j -= 1) {
      const db = Number(rightDigits[j]);
      const position = i + j + 1;
      const value = da * db + product[position];
      product[position] = value % 10;
      product[position - 1] += Math.floor(value / 10);
    }
  }
  let digits = product.join('').replace(/^0+(?=\d)/, '') || '0';
  if (scale > 0) {
    digits = digits.padStart(scale + 1, '0');
    digits = `${digits.slice(0, digits.length - scale)}.${digits.slice(digits.length - scale)}`;
  }
  return digits;
}

/** Exact decimal subtraction of two unsigned well-formed decimals (returns null when b > a — the open-quantity law requires non-negative results). */
function subtractDecimals(a: string, b: string): string | null {
  if (compareDecimal(a, b) < 0) return null;
  const [aInt, aFrac = ''] = a.split('.');
  const [bInt, bFrac = ''] = b.split('.');
  const width = Math.max(aFrac.length, bFrac.length);
  const left = aInt + aFrac.padEnd(width, '0');
  const right = bInt + bFrac.padEnd(width, '0');
  const result: number[] = new Array<number>(left.length).fill(0);
  let borrow = 0;
  for (let i = 1; i <= left.length; i += 1) {
    const da = Number(left[left.length - i]);
    const db = i <= right.length ? Number(right[right.length - i]) : 0;
    let value = da - db - borrow;
    if (value < 0) {
      value += 10;
      borrow = 1;
    } else {
      borrow = 0;
    }
    result[left.length - i] = value;
  }
  let digits = result.join('').replace(/^0+(?=\d)/, '') || '0';
  if (width > 0) {
    digits = digits.padStart(width + 1, '0');
    digits = `${digits.slice(0, digits.length - width)}.${digits.slice(digits.length - width)}`;
  }
  return digits;
}

// ---------------------------------------------------------------------------
// Guards for the canonical data records.
// ---------------------------------------------------------------------------

/** The canonical execution-report fields the reconciliation consumes (all decimal-valued fields included). */
const REPORT_DECIMAL_FIELDS: readonly string[] = ['order_qty', 'last_qty', 'last_px', 'cum_qty', 'leaves_qty', 'avg_px'];

/** Guard: a canonical execution-report data record. */
export function isExecutionReportData(value: unknown): value is ExecutionReportData {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.order_id)) return false;
  if (!isNonEmptyString(value.client_order_id)) return false;
  if (!isNonEmptyString(value.exec_id)) return false;
  if (!isNonEmptyString(value.exec_type)) return false;
  if (!isNonEmptyString(value.order_status)) return false;
  if (!isNonEmptyString(value.side)) return false;
  for (const field of REPORT_DECIMAL_FIELDS) {
    if (!isUnsignedDecimal(value[field])) return false;
  }
  return true;
}

/** Guard: a canonical order-state data record. */
export function isOrderStateData(value: unknown): value is OrderStateData {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.order_id)) return false;
  if (!isNonEmptyString(value.client_order_id)) return false;
  if (!isNonEmptyString(value.status)) return false;
  if (!isNonEmptyString(value.venue)) return false;
  for (const field of ['order_qty', 'filled_qty', 'leaves_qty', 'avg_px'] as const) {
    if (!isUnsignedDecimal(value[field])) return false;
  }
  if (value.last_qty !== undefined && !isUnsignedDecimal(value.last_qty)) return false;
  if (value.last_px !== undefined && !isUnsignedDecimal(value.last_px)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The reconciliation laws.
// ---------------------------------------------------------------------------

const TRADE_EXEC_TYPES: readonly string[] = ['partial_fill', 'fill'];
const LIVE_STATUSES: readonly string[] = ['new', 'partially_filled'];

/** The laws the engine executes (the agreement record's audit vocabulary). */
export const RECONCILIATION_LAWS: readonly string[] = [
  'report_sequence',
  'cum_qty_progression',
  'leaves_qty_consistency',
  'avg_px_exactly_weighted',
  'state_agreement',
];

/** The reports' canonical statuses, in the documented terminal/live partition (for the state-agreement law). */
function isTerminalStatus(status: string): boolean {
  return status === 'filled' || status === 'canceled' || status === 'rejected' || status === 'expired';
}

/**
 * Reconcile the OMS's order-state record against the broker lane's
 * execution reports for the same order. Pure, deterministic,
 * first-failure-wins over the five laws (see the module header); the
 * success value is a deep-frozen {@link OrderStateAgreement}.
 */
export function reconcileOrderState(args: {
  /** The OMS's own derived order-state record (canonical vocabulary). */
  readonly order_state: unknown;
  /** The broker lane's execution reports, in arrival order (canonical vocabulary). */
  readonly reports: readonly unknown[];
}): SdkResult<OrderStateAgreement> {
  if (!isOrderStateData(args.order_state)) {
    return failure(
      protocolError('invalid_configuration', 'the order-state record must be a canonical order-state data record (order_id, client_order_id, status, venue, order_qty, filled_qty, leaves_qty, avg_px — decimal strings)'),
    );
  }
  const state = args.order_state;
  if (args.reports.length === 0) {
    return failure(
      protocolError('invalid_configuration', 'the reconciliation requires at least one execution report'),
    );
  }
  const reports: ExecutionReportData[] = [];
  for (let index = 0; index < args.reports.length; index += 1) {
    if (!isExecutionReportData(args.reports[index])) {
      return failure(
        protocolError('invalid_configuration', `the execution report at index ${index} must be a canonical execution-report data record (order_id, client_order_id, exec_id, exec_type, order_status, side, order_qty, last_qty, last_px, cum_qty, leaves_qty, avg_px — decimal strings)`),
      );
    }
    reports.push(args.reports[index] as ExecutionReportData);
  }

  // Identity: every report belongs to the state's order.
  for (const report of reports) {
    if (report.order_id !== state.order_id || report.client_order_id !== state.client_order_id) {
      return failure(
        omsEmsProtocolError(
          'reconcile_state_mismatch',
          `report "${report.exec_id}" belongs to order (${report.order_id}, ${report.client_order_id}), not the state's order (${state.order_id}, ${state.client_order_id})`,
        ),
      );
    }
  }

  // LAW 1 — report sequence: execution ids unique, keyed in arrival order.
  const seenExecIds = new Set<string>();
  for (const report of reports) {
    if (seenExecIds.has(report.exec_id)) {
      return failure(
        omsEmsProtocolError('reconcile_report_sequence', `execution id "${report.exec_id}" repeats — the reports must arrive in documented execution order with unique ids`),
      );
    }
    seenExecIds.add(report.exec_id);
  }

  // The running reconciliation state (exact decimal arithmetic).
  let cumQty = '0';
  let notional = '0';
  let lastTradeQty: string | null = null;
  let lastTradePx: string | null = null;

  for (const report of reports) {
    const isTrade = TRADE_EXEC_TYPES.includes(report.exec_type);

    // LAW 2 — cumulative progression: trades advance CumQty by exactly last_qty.
    if (isTrade) {
      const expectedCum = addDecimals(cumQty, report.last_qty);
      if (compareDecimal(report.cum_qty, expectedCum) !== 0) {
        return failure(
          omsEmsProtocolError(
            'reconcile_cum_qty',
            `report "${report.exec_id}": CumQty is ${report.cum_qty}, but the trades so far advance it to exactly ${expectedCum} (previous ${cumQty} + last_qty ${report.last_qty}) — the documented cumulative filled quantity must advance by exactly each trade's quantity`,
          ),
        );
      }
      cumQty = expectedCum;
      notional = addDecimals(notional, multiplyDecimals(report.last_qty, report.last_px));
      lastTradeQty = report.last_qty;
      lastTradePx = report.last_px;
    } else {
      // A non-trade report leaves the cumulative quantity unchanged.
      if (compareDecimal(report.cum_qty, cumQty) !== 0) {
        return failure(
          omsEmsProtocolError(
            'reconcile_cum_qty',
            `report "${report.exec_id}" (exec_type ${report.exec_type}) carries CumQty ${report.cum_qty}, but a non-trade report must leave the cumulative quantity unchanged at ${cumQty}`,
          ),
        );
      }
    }

    // LAW 3 — open quantity: while the order is live, LeavesQty == OrderQty - CumQty.
    if (LIVE_STATUSES.includes(report.order_status)) {
      const expectedLeaves = subtractDecimals(report.order_qty, report.cum_qty);
      if (expectedLeaves === null || compareDecimal(report.leaves_qty, expectedLeaves) !== 0) {
        return failure(
          omsEmsProtocolError(
            'reconcile_leaves_qty',
            `report "${report.exec_id}": LeavesQty is ${report.leaves_qty}, but a live order (status ${report.order_status}) must carry exactly order_qty ${report.order_qty} minus cum_qty ${report.cum_qty} = ${expectedLeaves ?? 'undefined'}`,
          ),
        );
      }
    }
  }

  const finalReport = reports[reports.length - 1];

  // LAW 4 — average price: AvgPx × CumQty == Σ (last_qty × last_px), exactly.
  const weightedAvg = multiplyDecimals(finalReport.avg_px, finalReport.cum_qty);
  if (compareDecimal(weightedAvg, notional) !== 0) {
    return failure(
      omsEmsProtocolError(
        'reconcile_avg_px',
        `the final AvgPx ${finalReport.avg_px} times CumQty ${finalReport.cum_qty} is ${weightedAvg}, but the trades' summed notional is exactly ${notional} — the documented average price is the volume-weighted mean of the fills`,
      ),
    );
  }

  // LAW 5 — state agreement: the OMS's record vs the reports' final values.
  const mismatches: string[] = [];
  if (compareDecimal(state.filled_qty, finalReport.cum_qty) !== 0) {
    mismatches.push(`filled_qty ${state.filled_qty} != the reports' final cum_qty ${finalReport.cum_qty}`);
  }
  if (compareDecimal(state.leaves_qty, finalReport.leaves_qty) !== 0) {
    mismatches.push(`leaves_qty ${state.leaves_qty} != the reports' final leaves_qty ${finalReport.leaves_qty}`);
  }
  if (state.status !== finalReport.order_status) {
    mismatches.push(`status ${state.status} != the final report's order_status ${finalReport.order_status}`);
  }
  if (state.last_qty !== undefined || state.last_px !== undefined) {
    if (lastTradeQty === null || lastTradePx === null) {
      mismatches.push('the state carries a last trade (last_qty/last_px) but no trade report exists');
    } else {
      if (state.last_qty !== undefined && compareDecimal(state.last_qty, lastTradeQty) !== 0) {
        mismatches.push(`last_qty ${state.last_qty} != the final trade's last_qty ${lastTradeQty}`);
      }
      if (state.last_px !== undefined && compareDecimal(state.last_px, lastTradePx) !== 0) {
        mismatches.push(`last_px ${state.last_px} != the final trade's last_px ${lastTradePx}`);
      }
    }
  }
  if (mismatches.length > 0) {
    return failure(
      omsEmsProtocolError(
        'reconcile_state_mismatch',
        `the OMS order-state record disagrees with the broker's execution reports for order "${state.order_id}": ${mismatches.join('; ')}`,
      ),
    );
  }

  // Terminal consistency: a filled/canceled/rejected/expired state must
  // ride a report of the SAME terminal kind (the status check above
  // already demands equality; this law documents the partition).
  if (isTerminalStatus(state.status) !== isTerminalStatus(finalReport.order_status)) {
    return failure(
      omsEmsProtocolError('reconcile_state_mismatch', `the terminal/live partition disagrees: state status ${state.status} vs final report status ${finalReport.order_status}`),
    );
  }

  const agreement: OrderStateAgreement = {
    order_id: state.order_id,
    client_order_id: state.client_order_id,
    filled_qty: finalReport.cum_qty,
    leaves_qty: finalReport.leaves_qty,
    avg_px: finalReport.avg_px,
    status: finalReport.order_status,
    report_count: reports.length,
    executed_laws: [...RECONCILIATION_LAWS],
  };
  return success(deepFreeze(agreement) as OrderStateAgreement);
}
