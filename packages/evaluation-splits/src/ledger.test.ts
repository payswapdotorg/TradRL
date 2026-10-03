/**
 * @tradrl/evaluation-splits — the plan LEDGER laws (Work Order T032, L11).
 *
 * Laws under test:
 * - the ledger is append-only: entries grow ONLY through appendPlan; the
 *   original ledger is never mutated (a new ledger is returned);
 * - `duplicate_plan` — one plan id, one entry (no rewrites);
 * - `invalid_ledger` — a recording instant that rewinds the log (L4);
 * - `chain_mismatch` — a mutated plan, a REORDERED log, and a HIDDEN
 *   (truncated) entry all break the recomputed head;
 * - `plan_mismatch` propagates from append when an untrusted plan's
 *   content and address disagree.
 */

import { describe, expect, it } from 'vitest';

import { appendPlan, createPlanLedger, materializeSplitPlan, requireTimestampMs, verifyPlanLedger } from './index';
import type { DataRef, DatasetSegment, Mutable, SplitPlan, SplitPlanLedger, TimestampMs } from './index';

const T0 = 1_700_000_000_000;
const DAY = 86_400_000;
const BINDING = { tenant: 'tenant-led', project: 'project-led' } as const;

/** Trusted-literal constructors (the sibling test pattern). */
const dataRef = (id: string): DataRef => id as DataRef;
const at = (ms: number): TimestampMs => requireTimestampMs(ms);

function axis(): { segments: DatasetSegment[] } {
  const segments: DatasetSegment[] = [];
  for (let index = 0; index < 7; index++) {
    const start = at(T0 + index * DAY);
    segments.push({ ref: dataRef(`dataset-${index}`), start, end: at(start + DAY), regime: index % 2 === 0 ? 'trend' : 'range' });
  }
  return { segments };
}

function plan(ref: string): SplitPlan {
  const result = materializeSplitPlan(axis(), {
    policy_ref: ref,
    window: 'anchored',
    min_train_segments: 2,
    step_segments: 1,
    train_span_segments: null,
    gap_ms: '0',
    embargo_ms: '0',
    regime_filter: null,
    holdout: null,
  });
  if (!result.ok) throw new Error('fixture must materialize');
  return result.value;
}

function build(): SplitPlanLedger {
  let ledger = createPlanLedger(BINDING);
  if (!ledger.ok) throw new Error('fixture must create');
  const first = appendPlan(ledger.value, { plan: plan('split.a'), recorded_at: T0 });
  if (!first.ok) throw new Error('fixture must append');
  const second = appendPlan(first.value, { plan: plan('split.b'), recorded_at: T0 + DAY });
  if (!second.ok) throw new Error('fixture must append');
  return second.value;
}

describe('append-only construction', () => {
  it('appends grow the ledger without mutating the original', () => {
    const open = createPlanLedger(BINDING);
    expect(open.ok).toBe(true);
    if (!open.ok) return;
    const appended = appendPlan(open.value, { plan: plan('split.a'), recorded_at: T0 });
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;
    expect(open.value.entries.length).toBe(0);
    expect(appended.value.entries.length).toBe(1);
    expect(appended.value.chain_head).not.toBe(open.value.chain_head);
  });

  it('fails duplicate_plan when the same plan id is appended twice', () => {
    const open = createPlanLedger(BINDING);
    expect(open.ok).toBe(true);
    if (!open.ok) return;
    const appended = appendPlan(open.value, { plan: plan('split.a'), recorded_at: T0 });
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;
    const again = appendPlan(appended.value, { plan: plan('split.a'), recorded_at: T0 + 1 });
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.errors[0]?.code).toBe('duplicate_plan');
    expect(again.errors[0]?.message).toContain('append-only');
  });

  it('fails invalid_ledger when the instant rewinds the log (L4)', () => {
    const ledger = build();
    const rewound = appendPlan(ledger, { plan: plan('split.c'), recorded_at: T0 - 1 });
    expect(rewound.ok).toBe(false);
    if (rewound.ok) return;
    expect(rewound.errors[0]?.code).toBe('invalid_ledger');
    expect(rewound.errors[0]?.message).toContain('precedes');
  });

  it('fails plan_mismatch when an untrusted appended plan lies about its address', () => {
    const open = createPlanLedger(BINDING);
    expect(open.ok).toBe(true);
    if (!open.ok) return;
    const honest = plan('split.a');
    const liar = { ...honest, plan_id: 'splan:0000000000000000' };
    const appended = appendPlan(open.value, { plan: liar, recorded_at: T0 });
    expect(appended.ok).toBe(false);
    if (appended.ok) return;
    expect(appended.errors[0]?.code).toBe('plan_mismatch');
  });
});

describe('chain verification (fail-closed)', () => {
  it('verifies the honest ledger', () => {
    const ledger = build();
    const verified = verifyPlanLedger(JSON.parse(JSON.stringify(ledger)));
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.chain_head).toBe(ledger.chain_head);
  });

  it('fails plan_mismatch when a stored plan field is mutated (per-entry content law)', () => {
    const ledger = build();
    const tampered = JSON.parse(JSON.stringify(ledger)) as Mutable<SplitPlanLedger> & { entries: { plan: { windows: { purged: number }[] } }[] };
    tampered.entries[0].plan.windows[0].purged = 42;
    const verified = verifyPlanLedger(tampered);
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.errors[0]?.code).toBe('plan_mismatch');
  });

  it('fails chain_mismatch when a stored plan is substituted by a different valid plan', () => {
    const ledger = build();
    const substituted = JSON.parse(JSON.stringify(ledger)) as Mutable<SplitPlanLedger>;
    const entries = substituted.entries.slice();
    const originalInstant = entries[0]?.recorded_at;
    entries[0] = { plan: plan('split.c'), recorded_at: originalInstant };
    substituted.entries = entries;
    const verified = verifyPlanLedger(substituted);
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.errors[0]?.code).toBe('chain_mismatch');
  });

  it('fails chain_mismatch when the plans are swapped between entries (order law)', () => {
    const ledger = build();
    const swapped = JSON.parse(JSON.stringify(ledger)) as Mutable<SplitPlanLedger>;
    const first = swapped.entries[0];
    const second = swapped.entries[1];
    if (first === undefined || second === undefined) throw new Error('fixture needs two entries');
    swapped.entries = [
      { plan: second.plan, recorded_at: first.recorded_at },
      { plan: first.plan, recorded_at: second.recorded_at },
    ];
    const verified = verifyPlanLedger(swapped);
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.errors[0]?.code).toBe('chain_mismatch');
  });

  it('fails chain_mismatch when an entry is hidden (truncated)', () => {
    const ledger = build();
    const truncated = JSON.parse(JSON.stringify(ledger)) as Mutable<SplitPlanLedger>;
    truncated.entries = truncated.entries.slice(0, 1);
    const verified = verifyPlanLedger(truncated);
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.errors[0]?.code).toBe('chain_mismatch');
    expect(verified.errors[0]?.message).toContain('truncated');
  });

  it('fails chain_mismatch when the ledger id is forged', () => {
    const ledger = build();
    const forged = { ...ledger, ledger_id: 'splr:0000000000000000' };
    const verified = verifyPlanLedger(forged);
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.errors[0]?.code).toBe('chain_mismatch');
    expect(verified.errors[0]?.message).toContain("binding's derived identity");
  });

  it('fails duplicate_plan when the stored log lists a plan twice', () => {
    const ledger = build();
    const doubled = JSON.parse(JSON.stringify(ledger)) as Mutable<SplitPlanLedger>;
    const last = doubled.entries[doubled.entries.length - 1];
    if (last === undefined) throw new Error('fixture needs entries');
    doubled.entries = [...doubled.entries, last];
    const verified = verifyPlanLedger(doubled);
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.errors[0]?.code).toBe('duplicate_plan');
  });
});
