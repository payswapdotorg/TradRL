/**
 * @tradrl/evaluation-splits — plan materialization laws (Work Order T032).
 *
 * The positive and negative laws of the split driver, each pinned to a
 * typed error code:
 * - anchored ladders take the expanding prefix; rolling ladders take the
 *   declared sliding span;
 * - the exact-decimal PURGE GAP removes near-boundary train material;
 * - regime filters partition the axis by regime label;
 * - trailing-count and regime-set holdout reservations remove unseen
 *   material before any window is considered;
 * - `window_exhaustion`, `embargo_violation` (starvation + holdout
 *   separation), `holdout_leakage`, `degenerate_reservation`,
 *   `empty_regime_partition`, `plan_mismatch` — every typed error the Work
 *   Order names is produced by a real input and never silently swallowed.
 */

import { describe, expect, it } from 'vitest';

import { materializeSplitPlan, requireTimestampMs, splitPlanId, verifySplitPlan } from './index';
import type { DataRef, DatasetAxis, DatasetSegment, SplitPlan, TimestampMs } from './index';

const T0 = 1_700_000_000_000;
const DAY = 86_400_000;

/** Trusted-literal constructors (the sibling test pattern). */
const dataRef = (id: string): DataRef => id as DataRef;
const at = (ms: number): TimestampMs => requireTimestampMs(ms);

/** Build a regular axis: N daily segments, cycling regime labels. */
function axis(count: number, regimes: readonly string[] = ['trend', 'range', 'crisis']): DatasetAxis {
  const segments: DatasetSegment[] = [];
  for (let index = 0; index < count; index++) {
    const start = at(T0 + index * DAY);
    segments.push({
      ref: dataRef(`dataset-${String(index).padStart(2, '0')}`),
      start,
      end: at(start + DAY),
      regime: regimes[index % regimes.length] as string,
    });
  }
  return { segments };
}

function anchoredPolicy(overrides: Record<string, unknown> = {}) {
  return {
    policy_ref: 'split.wf-a',
    window: 'anchored',
    min_train_segments: 3,
    step_segments: 1,
    train_span_segments: null,
    gap_ms: '0',
    embargo_ms: '0',
    regime_filter: null,
    holdout: null,
    ...overrides,
  };
}

describe('anchored ladders', () => {
  it('materializes the expanding-prefix ladder with dense ordinals', () => {
    const result = materializeSplitPlan(axis(6), anchoredPolicy());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { windows } = result.value;
    expect(windows.length).toBe(3); // test indices 3, 4, 5
    expect(windows.map((w) => w.index)).toEqual([0, 1, 2]);
    expect(windows[0]?.train.length).toBe(3);
    expect(windows[1]?.train.length).toBe(4);
    expect(windows[2]?.train.length).toBe(5);
    expect(windows[0]?.test.ref).toBe('dataset-03');
    expect(windows[0]?.purged).toBe(0);
  });

  it('steps the test boundary by step_segments', () => {
    const result = materializeSplitPlan(axis(8), anchoredPolicy({ step_segments: 3 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.windows.map((w) => w.test.ref)).toEqual(['dataset-03', 'dataset-06']);
  });

  it('fails window_exhaustion when no complete window exists', () => {
    const result = materializeSplitPlan(axis(3), anchoredPolicy());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('window_exhaustion');
    expect(result.errors[0]?.message).toContain('requires at least 4');
  });
});

describe('rolling ladders', () => {
  it('materializes the declared sliding span', () => {
    const result = materializeSplitPlan(
      axis(7),
      anchoredPolicy({ window: 'rolling', train_span_segments: 2 }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { windows } = result.value;
    expect(windows.length).toBe(4);
    for (const window of windows) {
      expect(window.train.length).toBe(2);
    }
    expect(windows[0]?.train.map((s) => s.ref)).toEqual(['dataset-01', 'dataset-02']);
    expect(windows[3]?.train.map((s) => s.ref)).toEqual(['dataset-04', 'dataset-05']);
  });

  it('rejects a rolling policy without a span (invalid_policy)', () => {
    const result = materializeSplitPlan(axis(7), anchoredPolicy({ window: 'rolling', train_span_segments: null }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('invalid_policy');
    expect(result.errors[0]?.message).toContain('rolling');
  });

  it('rejects an anchored policy with a span (invalid_policy)', () => {
    const result = materializeSplitPlan(axis(7), anchoredPolicy({ train_span_segments: 2 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('invalid_policy');
    expect(result.errors[0]?.message).toContain('anchored');
  });
});

describe('the exact-decimal purge gap', () => {
  it('removes train material that ends inside the gap before the test start', () => {
    // Gap of half a day: the segment ending exactly at test.start - DAY
    // survives; the one ending at test.start is purged.
    const result = materializeSplitPlan(axis(6), anchoredPolicy({ gap_ms: String(0.5 * DAY) }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const first = result.value.windows[0];
    expect(first?.train.map((s) => s.ref)).toEqual(['dataset-00', 'dataset-01']);
    expect(first?.purged).toBe(1);
  });

  it('accepts fractional-millisecond exact decimal widths', () => {
    const result = materializeSplitPlan(axis(6), anchoredPolicy({ gap_ms: '43200000.125' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Half a day + 0.125 ms: the last pre-test segment still purges.
    expect(result.value.windows[0]?.purged).toBe(1);
  });

  it('fails embargo_violation when the gap starves the train set', () => {
    const result = materializeSplitPlan(axis(6), anchoredPolicy({ gap_ms: String(4 * DAY) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('embargo_violation');
    expect(result.errors[0]?.message).toContain('starves the ENTIRE train set');
  });
});

describe('regime-segmented axes', () => {
  it('partitions the axis by regime label (include)', () => {
    const result = materializeSplitPlan(
      axis(6),
      anchoredPolicy({ regime_filter: { mode: 'include', regimes: ['trend'] }, min_train_segments: 1 }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // trend segments: 0, 3 (labels cycle [trend, range, crisis]).
    expect(result.value.windows.map((w) => w.test.ref)).toEqual(['dataset-03']);
    expect(result.value.windows[0]?.train.map((s) => s.ref)).toEqual(['dataset-00']);
  });

  it('partitions the axis by regime label (exclude)', () => {
    const result = materializeSplitPlan(
      axis(9),
      anchoredPolicy({ regime_filter: { mode: 'exclude', regimes: ['crisis'] }, min_train_segments: 2 }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Excluding crisis (indices 2, 5, 8) leaves 0,1,3,4,6,7: six segments.
    expect(result.value.windows.map((w) => w.test.ref)).toEqual(['dataset-03', 'dataset-04', 'dataset-06', 'dataset-07']);
  });

  it('fails empty_regime_partition when the filter selects nothing', () => {
    const result = materializeSplitPlan(
      axis(6),
      anchoredPolicy({ regime_filter: { mode: 'include', regimes: ['nonexistent'] } }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('empty_regime_partition');
  });
});

describe('unseen/holdout reservation', () => {
  it('reserves the trailing count and removes it from all windows', () => {
    const result = materializeSplitPlan(
      axis(8),
      anchoredPolicy({ holdout: { mode: 'trailing-count', count: 2 } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const plan = result.value;
    expect(plan.holdout?.segments.map((s) => s.ref)).toEqual(['dataset-06', 'dataset-07']);
    expect(plan.holdout?.separation_ms).toBe('0');
    expect(plan.windows.map((w) => w.test.ref)).toEqual(['dataset-03', 'dataset-04', 'dataset-05']);
    expect(plan.lineage.holdout_count).toBe(2);
  });

  it('enforces the embargo between search material and a trailing holdout (embargo_violation)', () => {
    const result = materializeSplitPlan(
      axis(8),
      anchoredPolicy({ embargo_ms: String(DAY), holdout: { mode: 'trailing-count', count: 2 } }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('embargo_violation');
    expect(result.errors[0]?.message).toContain('declared embargo');
  });

  it('accepts a trailing holdout when the embargo is satisfied (axis with a gap)', () => {
    // Axis whose last two segments sit one full day after the prefix.
    const segments: DatasetSegment[] = [];
    for (let index = 0; index < 6; index++) {
      const start = at(T0 + index * DAY);
      segments.push({ ref: dataRef(`dataset-${index}`), start, end: at(start + DAY), regime: 'trend' });
    }
    const holdoutStart = at(T0 + 7 * DAY); // one day of separation after dataset-05 ends at T0+6d
    segments.push({ ref: dataRef('dataset-h0'), start: holdoutStart, end: at(holdoutStart + DAY), regime: 'range' });
    segments.push({ ref: dataRef('dataset-h1'), start: at(holdoutStart + DAY), end: at(holdoutStart + 2 * DAY), regime: 'range' });
    const result = materializeSplitPlan(
      { segments },
      anchoredPolicy({ embargo_ms: String(DAY), holdout: { mode: 'trailing-count', count: 2 } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.holdout?.separation_ms).toBe(String(DAY));
  });

  it('fails degenerate_reservation when the trailing count reserves everything', () => {
    const result = materializeSplitPlan(
      axis(5),
      anchoredPolicy({ holdout: { mode: 'trailing-count', count: 5 } }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('degenerate_reservation');
  });

  it('reserves by regime label wherever the segments sit (categorical unseen regimes)', () => {
    const result = materializeSplitPlan(
      axis(9),
      anchoredPolicy({ holdout: { mode: 'regime-set', regimes: ['crisis'] } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const plan = result.value;
    expect(plan.holdout?.segments.map((s) => s.ref)).toEqual(['dataset-02', 'dataset-05', 'dataset-08']);
    expect(plan.holdout?.separation_ms).toBeNull();
    // The windowed material excludes every reserved segment.
    for (const window of plan.windows) {
      expect(window.test.regime).not.toBe('crisis');
      for (const trainSegment of window.train) expect(trainSegment.regime).not.toBe('crisis');
    }
  });

  it('fails degenerate_reservation when a regime set selects nothing', () => {
    const result = materializeSplitPlan(
      axis(6),
      anchoredPolicy({ holdout: { mode: 'regime-set', regimes: ['nonexistent'] } }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('degenerate_reservation');
  });
});

describe('plan verification (untrusted plans)', () => {
  it('round-trips a materialized plan through verifySplitPlan', () => {
    const materialized = materializeSplitPlan(axis(6), anchoredPolicy({ holdout: { mode: 'trailing-count', count: 1 } }));
    expect(materialized.ok).toBe(true);
    if (!materialized.ok) return;
    const verified = verifySplitPlan(JSON.parse(JSON.stringify(materialized.value)));
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.plan_id).toBe(materialized.value.plan_id);
  });

  it('fails plan_mismatch when content and address disagree', () => {
    const materialized = materializeSplitPlan(axis(6), anchoredPolicy());
    expect(materialized.ok).toBe(true);
    if (!materialized.ok) return;
    const tampered = {
      ...(materialized.value as unknown as Record<string, unknown>),
      windows: [
        { ...(materialized.value.windows[0] as unknown as Record<string, unknown>), purged: 99 },
        ...materialized.value.windows.slice(1),
      ],
    };
    const verified = verifySplitPlan(tampered);
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.errors[0]?.code).toBe('plan_mismatch');
  });

  it('fails holdout_leakage when a reserved segment is spliced into window material', () => {
    const materialized = materializeSplitPlan(
      axis(6),
      anchoredPolicy({ holdout: { mode: 'trailing-count', count: 1 } }),
    );
    expect(materialized.ok).toBe(true);
    if (!materialized.ok) return;
    const plan = materialized.value;
    const leaked = plan.holdout?.segments[0];
    expect(leaked).toBeDefined();
    if (leaked === undefined) return;
    // Splice the reserved segment into window 0's train set, then repair the
    // content address so the LEAKAGE law itself is what fails.
    const windows = plan.windows.map((window, index) =>
      index === 0 ? { ...window, train: [...window.train, leaked] } : window,
    );
    const content = { policy_ref: plan.policy_ref, kind: plan.kind, windows, holdout: plan.holdout, lineage: { ...plan.lineage, holdout_count: plan.lineage.holdout_count } } as Omit<SplitPlan, 'plan_id'>;
    const forged = { plan_id: splitPlanId(content), ...content };
    const verified = verifySplitPlan(forged);
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.errors[0]?.code).toBe('holdout_leakage');
    expect(verified.errors[0]?.message).toContain('TRAIN material');
  });
});
