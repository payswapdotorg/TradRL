// @tradrl/web-console — THE EXECUTION BLOTTER'S AGGREGATE TOTALS
// (FW-34-B, Round C register §3.7 — L4's finding: "no aggregate blotter
// totals (filled notional/fees) — 'what team works my book' is
// unanswerable in-product").
//
// THE LAW: the totals are a PURE FOLD over the L4-PROJECTED submissions
// the Execution section renders (the caller passes exactly the
// point-in-time view — at a past view instant the totals reflect what
// was knowable then, the same law every section rides). Fills are the
// routed submissions that carry fill economics; the notional and fee
// totals are EXACT DECIMAL SUMS of the served strings
// (core/decimals.ts's sumExactDecimals — never float arithmetic, never
// a re-formatted number). Refusals count their own row: the blotter's
// honest shape includes what the gateway STOPPED (the honesty law — a
// refusal is a decision, not an absence).
//
// Spec anchors: L9 (exact decimals), L20 (the console renders the
// gateway's verdicts, it never re-decides them), L4 (point-in-time).

import { sumExactDecimals } from './decimals';
import type { GatewaySubmissionRecord } from '../api/contracts';

/** The execution blotter's aggregate totals (one pure fold of the projected submissions). */
export interface BlotterTotals {
  /** The routed submissions that carry fill economics (the fills the blotter's rows show). */
  readonly fills: number;
  /** The routed submissions still awaiting their fill record (routed, no fill economics yet). */
  readonly routedUnfilled: number;
  /** The gateway's refusals (each one a stopped decision — counted, never hidden). */
  readonly refusals: number;
  /** The exact-decimal notional total across the fills ('0' when none). */
  readonly notionalTotal: string;
  /** The exact-decimal fee total across the fills ('0' when none). */
  readonly feeTotal: string;
}

/**
 * The aggregate totals of the blotter's projected submissions. Fills
 * contribute their notional + fee (exact decimal sums); a routed row
 * without fill economics counts as routed-unfilled (never a fabricated
 * fill); a refusal counts as a refusal. The fold never throws on the
 * served shapes — an exact-decimal grammar violation in a served record
 * would be the boundary's own defect and surfaces as the typed error
 * the decimal discipline owns (never a silently wrong total).
 */
export function blotterTotalsOf(submissions: readonly GatewaySubmissionRecord[]): BlotterTotals {
  let fills = 0;
  let routedUnfilled = 0;
  let refusals = 0;
  const notionals: string[] = [];
  const fees: string[] = [];
  for (const submission of submissions) {
    if (submission.kind === 'refused') {
      refusals += 1;
      continue;
    }
    const fill = submission.fill;
    if (fill === undefined) {
      routedUnfilled += 1;
      continue;
    }
    fills += 1;
    notionals.push(fill.notional);
    fees.push(fill.fee);
  }
  return {
    fills,
    routedUnfilled,
    refusals,
    notionalTotal: sumExactDecimals(notionals),
    feeTotal: sumExactDecimals(fees),
  };
}

/** The totals' own one-line disclosure (rendered with the card — what counts, stated). */
export function blotterTotalsNoteOf(totals: BlotterTotals): string {
  return `Totals at this view instant: ${totals.fills} fill${totals.fills === 1 ? '' : 's'} (notional ${totals.notionalTotal}, fees ${totals.feeTotal})${totals.routedUnfilled > 0 ? `, ${totals.routedUnfilled} routed without a fill record yet` : ''}${totals.refusals > 0 ? `, ${totals.refusals} refusal${totals.refusals === 1 ? '' : 's'} the gateway stopped` : ''} — every number is an exact-decimal sum of the rows below.`;
}
