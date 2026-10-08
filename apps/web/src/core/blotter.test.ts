// Tests for the execution blotter's aggregate totals — FW-34-B (Round C
// register §3.7, L4's finding: "no aggregate blotter totals — 'what team
// works my book' is unanswerable in-product").
//
// Laws pinned here (blotter.ts header):
//   - the totals are a PURE FOLD over the L4-PROJECTED submissions the
//     Execution section renders (the caller passes the point-in-time view);
//   - fills are the routed submissions that carry fill economics; the
//     notional/fee totals are EXACT DECIMAL SUMS of the served strings
//     (core/decimals.ts — never float arithmetic, never re-formatted);
//   - routed rows without a fill record count as routed-unfilled (never a
//     fabricated fill);
//   - refusals count their own row (a refusal is a decision, not an absence);
//   - the one-line note states what counts, in plain language.

import { describe, expect, it } from 'vitest';
import type { GatewaySubmissionRecord } from '../api/contracts';
import { blotterTotalsNoteOf, blotterTotalsOf } from './blotter';

const T0 = 1_700_000_000_000;

/** A routed submission carrying fill economics. */
function filled(notional: string, fee: string, submissionId = 'sub-1'): GatewaySubmissionRecord {
  return {
    kind: 'routed', submissionId, decisionId: `dec-${submissionId}`, auditId: `aud-${submissionId}`, requestRef: `req-${submissionId}`,
    venue: 'venue-x', adapterRef: 'ad-1', channelRef: 'ch-1', routedAt: T0,
    order: { clientOrderId: `clordid-${submissionId}`, instrument: 'binance:BTC-USDT', side: 'buy', quantity: '1', price: '1' },
    fill: { state: 'filled', quantity: '1', price: '1', notional, fee, filledAt: T0 },
  };
}

/** A routed submission with NO fill record yet (routed, awaiting economics). */
function routedUnfilled(submissionId = 'sub-r'): GatewaySubmissionRecord {
  return {
    kind: 'routed', submissionId, decisionId: `dec-${submissionId}`, auditId: `aud-${submissionId}`, requestRef: `req-${submissionId}`,
    venue: 'venue-x', adapterRef: 'ad-1', channelRef: 'ch-1', routedAt: T0,
    order: { clientOrderId: `clordid-${submissionId}`, instrument: 'binance:BTC-USDT', side: 'buy', quantity: '1', price: '1' },
  };
}

/** A refusal (the gateway's stopped decision). */
function refused(submissionId = 'sub-x'): GatewaySubmissionRecord {
  return {
    kind: 'refused', submissionId, decisionId: null, auditId: `aud-${submissionId}`,
    refusal: { stage: 'risk_limits', bound: '2', observed: '2.4', constraintId: 'k-position' },
    refusedAt: T0,
  };
}

describe('FW-34-B: the execution blotter aggregate totals (blotterTotalsOf)', () => {
  it('the empty fold is the honest zero (no rows, no totals, never a fabricated fill)', () => {
    expect(blotterTotalsOf([])).toEqual({ fills: 0, routedUnfilled: 0, refusals: 0, notionalTotal: '0', feeTotal: '0' });
  });

  it('fills sum their notional + fee EXACTLY (decimal strings, never float arithmetic)', () => {
    const totals = blotterTotalsOf([filled('1000.10', '0.025'), filled('250.25', '0.01'), filled('0.000001', '0.005')]);
    expect(totals.fills).toBe(3);
    expect(totals.routedUnfilled).toBe(0);
    expect(totals.refusals).toBe(0);
    expect(totals.notionalTotal).toBe('1250.350001'); // exact: the float 1000.1 + 250.25 + 0.000001 loses digits
    expect(totals.feeTotal).toBe('0.040');
  });

  it('routed rows WITHOUT a fill record count as routed-unfilled — never a fabricated fill, never a hidden row', () => {
    const totals = blotterTotalsOf([routedUnfilled(), filled('10.00', '0.01', 'sub-2'), routedUnfilled('sub-r2')]);
    expect(totals.fills).toBe(1);
    expect(totals.routedUnfilled).toBe(2);
    expect(totals.notionalTotal).toBe('10.00'); // only the real fill's economics
    expect(totals.feeTotal).toBe('0.01');
  });

  it('refusals count their own row (a stopped decision is a decision, not an absence)', () => {
    const totals = blotterTotalsOf([refused(), refused('sub-y'), filled('5.00', '0.01', 'sub-3')]);
    expect(totals.refusals).toBe(2);
    expect(totals.fills).toBe(1);
    expect(totals.routedUnfilled).toBe(0);
    expect(totals.notionalTotal).toBe('5.00'); // a refusal contributes NO economics
  });

  it('a served record outside the exact-decimal grammar surfaces the typed error — never a silently wrong total', () => {
    expect(() => blotterTotalsOf([filled('not-a-decimal', '0.01')])).toThrow(/is not an exact decimal string/);
  });
});

describe('FW-34-B: the totals one-line disclosure (blotterTotalsNoteOf)', () => {
  it('states what counts — the fills + exact sums, the routed-without-fill, the refusals the gateway stopped', () => {
    const mixed = blotterTotalsOf([filled('1000.10', '0.025'), filled('250.25', '0.01'), routedUnfilled(), refused()]);
    const note = blotterTotalsNoteOf(mixed);
    expect(note).toContain('2 fills');
    expect(note).toContain('notional 1250.35');
    expect(note).toContain('fees 0.035');
    expect(note).toContain('1 routed without a fill record yet');
    expect(note).toContain('1 refusal the gateway stopped');
    expect(note).toContain('exact-decimal sum'); // the honesty line — how the numbers were computed
  });

  it('the singular/plural grammar is exact (1 fill, 1 refusal — plain language, never template noise)', () => {
    expect(blotterTotalsNoteOf(blotterTotalsOf([filled('10.00', '0.01')]))).toContain('1 fill (notional 10.00, fees 0.01)');
    const refusalOnly = blotterTotalsNoteOf(blotterTotalsOf([refused()]));
    expect(refusalOnly).toContain('0 fill');
    expect(refusalOnly).toContain('1 refusal the gateway stopped');
    expect(refusalOnly).not.toContain('routed without a fill record'); // none — the clause hides itself
  });
});
