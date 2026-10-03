/**
 * @tradrl/evaluation-splits — determinism tests (the Engineering Protocol
 * law: "identical inputs -> identical bytes"; the Work Order's own law:
 * "Same axis + same policy -> byte-identical split plan").
 *
 * Laws under test:
 * - the SAME (axis, policy) pair always materializes the byte-identical
 *   canonical plan, with the identical content-addressed plan id, and the
 *   identical deep-frozen structure;
 * - a changed axis (one segment shifted) or a changed policy field changes
 *   the bytes AND the id;
 * - materialized plans are deeply frozen and survive JSON round-trips;
 * - the plan ledger's chain head is a pure function of the binding and the
 *   appended plans (same appends -> same head);
 * - no ambient clock: nothing in the package reads time (proved by
 *   construction — every instant in the ledger came from literals).
 */

import { describe, expect, it } from 'vitest';

import {
  appendPlan,
  canonicalPlanLedger,
  canonicalSplitPlan,
  computePlanChainHead,
  createPlanLedger,
  isDeeplyFrozen,
  materializeSplitPlan,
  planChainFold,
  planChainGenesis,
  requireTimestampMs,
} from './index';
import type { DataRef, DatasetSegment, ProjectId, SplitPlanLedger, TenantId, TimestampMs } from './index';

const T0 = 1_700_000_000_000;
const DAY = 86_400_000;

/** Trusted-literal constructors (the sibling test pattern). */
const dataRef = (id: string): DataRef => id as DataRef;
const at = (ms: number): TimestampMs => requireTimestampMs(ms);
const tenant = 'tenant-det' as TenantId;
const project = 'project-det' as ProjectId;

function axis(): { segments: DatasetSegment[] } {
  const segments: DatasetSegment[] = [];
  for (let index = 0; index < 8; index++) {
    const start = at(T0 + index * DAY);
    segments.push({ ref: dataRef(`dataset-${index}`), start, end: at(start + DAY), regime: ['trend', 'range', 'crisis'][index % 3] as string });
  }
  return { segments };
}

function policy(): Record<string, unknown> {
  return {
    policy_ref: 'split.wf-det',
    window: 'rolling',
    min_train_segments: 3,
    step_segments: 2,
    train_span_segments: 2,
    gap_ms: '43200000.5',
    embargo_ms: '0',
    regime_filter: { mode: 'exclude', regimes: ['crisis'] },
    holdout: { mode: 'trailing-count', count: 2 },
  };
}

describe('split-plan byte determinism', () => {
  it('the same axis + policy produce identical canonical bytes and id (repeatedly)', () => {
    const first = materializeSplitPlan(axis(), policy());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const firstBytes = canonicalSplitPlan(first.value);
    for (let round = 0; round < 5; round++) {
      const again = materializeSplitPlan(axis(), policy());
      expect(again.ok).toBe(true);
      if (!again.ok) return;
      expect(canonicalSplitPlan(again.value)).toBe(firstBytes);
      expect(again.value.plan_id).toBe(first.value.plan_id);
      expect(again.value).toEqual(first.value);
    }
  });

  it('a changed axis changes the bytes and the id', () => {
    const base = materializeSplitPlan(axis(), policy());
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const shifted = axis();
    // Relabel one reserved holdout segment — a valid axis, different content.
    (shifted.segments[6] as DatasetSegment & { regime: string }).regime = 'post-event';
    const other = materializeSplitPlan(shifted, policy());
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    expect(canonicalSplitPlan(other.value)).not.toBe(canonicalSplitPlan(base.value));
    expect(other.value.plan_id).not.toBe(base.value.plan_id);
  });

  it('a changed policy field changes the bytes and the id', () => {
    const base = materializeSplitPlan(axis(), policy());
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const other = materializeSplitPlan(axis(), { ...policy(), gap_ms: '0' });
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    expect(canonicalSplitPlan(other.value)).not.toBe(canonicalSplitPlan(base.value));
    expect(other.value.plan_id).not.toBe(base.value.plan_id);
  });

  it('a reordered axis is a different axis (different bytes)', () => {
    const base = materializeSplitPlan(axis(), policy());
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const reordered = axis();
    reordered.segments.reverse(); // now descending — invalid axis (typed failure, not silent equality)
    const other = materializeSplitPlan(reordered, policy());
    expect(other.ok).toBe(false);
    if (other.ok) return;
    expect(other.errors[0]?.code).toBe('invalid_field');
  });

  it('materialized plans are deeply frozen and survive JSON round-trips', () => {
    const result = materializeSplitPlan(axis(), policy());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isDeeplyFrozen(result.value)).toBe(true);
    const serialized = JSON.parse(JSON.stringify(result.value));
    const materializedAgain = materializeSplitPlan(JSON.parse(JSON.stringify(axis())), JSON.parse(JSON.stringify(policy())));
    expect(materializedAgain.ok).toBe(true);
    if (!materializedAgain.ok) return;
    expect(serialized).toEqual(materializedAgain.value);
  });
});

describe('ledger chain determinism', () => {
  function buildLedger(): SplitPlanLedger {
    let ledger = createPlanLedger({ tenant, project });
    if (!ledger.ok) throw new Error('fixture must create');
    let instant = T0;
    for (const planInput of [policy(), { ...policy(), policy_ref: 'split.wf-det-2', window: 'anchored' as const, train_span_segments: null }]) {
      const plan = materializeSplitPlan(axis(), planInput);
      if (!plan.ok) throw new Error('fixture must materialize');
      const appended = appendPlan(ledger.value, { plan: plan.value, recorded_at: instant });
      if (!appended.ok) throw new Error(`fixture must append: ${JSON.stringify(appended.errors)}`);
      ledger = { ok: true as const, value: appended.value };
      instant += DAY;
    }
    return ledger.value;
  }

  it('the same appends produce the identical ledger bytes and chain head', () => {
    const first = buildLedger();
    for (let round = 0; round < 3; round++) {
      expect(canonicalPlanLedger(buildLedger())).toBe(canonicalPlanLedger(first));
    }
  });

  it('the chain head is a pure fold over the genesis and the plans', () => {
    const ledger = buildLedger();
    let head = planChainGenesis({ tenant, project });
    for (const entry of ledger.entries) head = planChainFold(head, entry.plan);
    expect(head).toBe(ledger.chain_head);
    expect(computePlanChainHead({ tenant, project }, ledger.entries.map((e) => e.plan))).toBe(ledger.chain_head);
  });

  it('a different binding produces a different genesis and head', () => {
    const ledger = buildLedger();
    const other = computePlanChainHead({ tenant: 'tenant-other' as TenantId, project }, ledger.entries.map((e) => e.plan));
    expect(other).not.toBe(ledger.chain_head);
  });
});
