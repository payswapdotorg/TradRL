/**
 * Behavioral tests for @tradrl/evaluation split policies: axis validation
 * (ordering, overlap, uniqueness), and the PURE split interpreters at
 * their BOUNDARIES — window exhaustion, degenerate masks, empty regimes —
 * plus determinism and immutability (acceptance #5 of the work order).
 */

import { describe, expect, it } from 'vitest';

import {
  blindHoldoutMask,
  isDatasetAxis,
  isDatasetSegment,
  isBlindHoldoutPolicy,
  isRegimePartitionPolicy,
  isSplitPolicy,
  isWalkForwardPolicy,
  policySegmentRefs,
  regimePartition,
  validateDatasetAxis,
  validateSplitPolicy,
  walkForwardWindows,
  type BlindHoldoutPolicy,
  type DatasetAxis,
  type DatasetSegment,
  type RegimePartitionPolicy,
  type WalkForwardPolicy,
} from './index';
import { requireTimestampMs } from './primitives';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function segment(index: number, regime = 'baseline', startOffset = 0): DatasetSegment {
  const start = requireTimestampMs(1_700_000_000_000 + index * 10_000 + startOffset);
  const end = requireTimestampMs(start + 10_000);
  return { ref: `dataset.segment-${index}`, start, end, regime };
}

function axis(count: number, regimes?: readonly string[]): DatasetAxis {
  return {
    segments: Array.from({ length: count }, (_, index) => segment(index, regimes?.[index] ?? 'baseline')),
  };
}

const WALK_FORWARD: WalkForwardPolicy = { kind: 'walk-forward', policyId: 'split.wf-anchored', minTrainSegments: 2, stepSegments: 1 };
const BLIND: BlindHoldoutPolicy = { kind: 'blind-holdout', policyId: 'split.blind-2024q4', holdoutCount: 1 };
const REGIME: RegimePartitionPolicy = { kind: 'regime-partition', policyId: 'split.regime-crisis', regime: 'crisis' };

// ---------------------------------------------------------------------------
// Axis validation
// ---------------------------------------------------------------------------

describe('DatasetAxis validation', () => {
  it('accepts an ordered, non-overlapping, uniquely-refed axis', () => {
    const valid = axis(4, ['bull', 'bull', 'crisis', 'baseline']);
    expect(isDatasetAxis(valid)).toBe(true);
    const result = validateDatasetAxis(valid);
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.isFrozen(result.value)).toBe(true);
  });

  it('collects every violation with dotted paths', () => {
    const result = validateDatasetAxis({
      segments: [
        { ref: '', start: 1, end: 2, regime: '' },
        { ref: 'a', start: 5, end: 5, regime: 'r' }, // zero-length window
        { ref: 'a', start: 2, end: 9, regime: 'r' }, // duplicate ref + overlap
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    const paths = result.errors.map((e) => e.path);
    expect(paths).toContain('axis.segments[0].ref');
    expect(paths).toContain('axis.segments[0].regime');
    expect(paths).toContain('axis.segments[1].end');
    expect(paths).toContain('axis.segments[2].ref');
    expect(paths).toContain('axis.segments[2].start'); // overlap with segment 1's end=5? start=2 < previousEnd 5
  });

  it('rejects empty axes, non-arrays and non-objects', () => {
    expect(validateDatasetAxis({ segments: [] }).ok).toBe(false);
    expect(validateDatasetAxis({ segments: 'x' }).ok).toBe(false);
    expect(validateDatasetAxis(null).ok).toBe(false);
    expect(isDatasetAxis({ segments: [] })).toBe(false);
    expect(isDatasetAxis(null)).toBe(false);
  });

  it('rejects out-of-range and non-integer timestamps', () => {
    expect(isDatasetSegment({ ref: 'a', start: -1, end: 1, regime: 'r' })).toBe(false);
    expect(isDatasetSegment({ ref: 'a', start: 1.5, end: 2, regime: 'r' })).toBe(false);
    expect(isDatasetSegment({ ref: 'a', start: 1, end: Number.POSITIVE_INFINITY, regime: 'r' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Policy guards
// ---------------------------------------------------------------------------

describe('split policy guards', () => {
  it('each kind validates its own fields', () => {
    expect(isWalkForwardPolicy(WALK_FORWARD)).toBe(true);
    expect(isWalkForwardPolicy({ ...WALK_FORWARD, minTrainSegments: 0 })).toBe(false);
    expect(isWalkForwardPolicy({ ...WALK_FORWARD, stepSegments: 1.5 })).toBe(false);
    expect(isBlindHoldoutPolicy(BLIND)).toBe(true);
    expect(isBlindHoldoutPolicy({ ...BLIND, holdoutCount: 0 })).toBe(false);
    expect(isRegimePartitionPolicy(REGIME)).toBe(true);
    expect(isRegimePartitionPolicy({ ...REGIME, regime: ' ' })).toBe(false);
    expect(isSplitPolicy(WALK_FORWARD)).toBe(true);
    expect(isSplitPolicy({ kind: 'random' })).toBe(false);
    expect(validateSplitPolicy({ kind: 'walk-forward', policyId: 'p' }).ok).toBe(false); // missing numeric fields
    expect(validateSplitPolicy(REGIME).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Walk-forward (anchored expanding windows)
// ---------------------------------------------------------------------------

describe('walkForwardWindows', () => {
  it('produces anchored expanding windows with the exact first train size', () => {
    const result = walkForwardWindows(axis(5), WALK_FORWARD);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must succeed');
    const windows = result.value;
    expect(windows).toHaveLength(3); // test indices 2, 3, 4
    expect(windows[0]?.train).toHaveLength(2); // first train = minTrainSegments exactly
    expect(windows[0]?.test.ref).toBe('dataset.segment-2');
    expect(windows[1]?.train).toHaveLength(3); // anchored: expanding
    expect(windows[1]?.test.ref).toBe('dataset.segment-3');
    expect(windows[2]?.train).toHaveLength(4);
    expect(windows[2]?.test.ref).toBe('dataset.segment-4');
    // Train sets are prefixes: no test segment ever appears in a train set.
    for (const window of windows) {
      expect(window.train.some((s) => s.ref === window.test.ref)).toBe(false);
    }
  });

  it('BOUNDARY: window exhaustion is a typed error, never an empty split', () => {
    const exhausted = walkForwardWindows(axis(2), WALK_FORWARD); // needs 3 for one window
    expect(exhausted.ok).toBe(false);
    if (exhausted.ok) throw new Error('must fail');
    expect(exhausted.errors[0]?.code).toBe('window_exhaustion');

    const single = walkForwardWindows(axis(1), { ...WALK_FORWARD, minTrainSegments: 1 });
    expect(single.ok).toBe(false);
    if (single.ok) throw new Error('must fail');
    expect(single.errors[0]?.code).toBe('window_exhaustion');
  });

  it('steps the test boundary by stepSegments', () => {
    const result = walkForwardWindows(axis(7), { ...WALK_FORWARD, minTrainSegments: 1, stepSegments: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must succeed');
    // Test indices: 1, 4, (7 out of range for a 7-segment axis) — two windows.
    expect(result.value.map((w) => w.test.ref)).toEqual(['dataset.segment-1', 'dataset.segment-4']);
    expect(result.value[0]?.train).toHaveLength(1);
    expect(result.value[1]?.train).toHaveLength(4);
  });

  it('is pure and deterministic (same inputs, deeply-equal outputs)', () => {
    const a = walkForwardWindows(axis(4), WALK_FORWARD);
    const b = walkForwardWindows(axis(4), WALK_FORWARD);
    expect(a).toEqual(b);
    if (a.ok && b.ok) expect(JSON.stringify(a.value)).toBe(JSON.stringify(b.value));
  });

  it('outputs are deeply frozen', () => {
    const result = walkForwardWindows(axis(4), WALK_FORWARD);
    if (!result.ok) throw new Error('must succeed');
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value[0]?.train)).toBe(true);
  });

  it('rejects invalid axis/policy inputs without throwing', () => {
    expect(walkForwardWindows(null as unknown as DatasetAxis, WALK_FORWARD).ok).toBe(false);
    expect(walkForwardWindows(axis(4), { ...WALK_FORWARD, stepSegments: 0 }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Blind holdout masks
// ---------------------------------------------------------------------------

describe('blindHoldoutMask', () => {
  it('masks the trailing suffix and leaves the visible prefix', () => {
    const result = blindHoldoutMask(axis(5), { ...BLIND, holdoutCount: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must succeed');
    expect(result.value.visible.map((s) => s.ref)).toEqual([
      'dataset.segment-0',
      'dataset.segment-1',
      'dataset.segment-2',
    ]);
    expect(result.value.blind.map((s) => s.ref)).toEqual(['dataset.segment-3', 'dataset.segment-4']);
  });

  it('BOUNDARY: masking everything is a degenerate_mask typed error', () => {
    const all = blindHoldoutMask(axis(3), { ...BLIND, holdoutCount: 3 });
    expect(all.ok).toBe(false);
    if (all.ok) throw new Error('must fail');
    expect(all.errors[0]?.code).toBe('degenerate_mask');

    const more = blindHoldoutMask(axis(3), { ...BLIND, holdoutCount: 99 });
    expect(more.ok).toBe(false);
    if (more.ok) throw new Error('must fail');
    expect(more.errors[0]?.code).toBe('degenerate_mask');
  });

  it('BOUNDARY: masking nothing is a degenerate_mask typed error (holdoutCount < 1 is unrepresentable via types; guarded at runtime)', () => {
    const none = blindHoldoutMask(axis(3), { ...BLIND, holdoutCount: 0 } as unknown as BlindHoldoutPolicy);
    expect(none.ok).toBe(false);
    if (none.ok) throw new Error('must fail');
    expect(none.errors[0]?.code).toBe('degenerate_mask');
  });

  it('a single-blind-segment mask on a two-segment axis is the tightest legal boundary', () => {
    const tightest = blindHoldoutMask(axis(2), { ...BLIND, holdoutCount: 1 });
    expect(tightest.ok).toBe(true);
    if (!tightest.ok) throw new Error('must succeed');
    expect(tightest.value.visible).toHaveLength(1);
    expect(tightest.value.blind).toHaveLength(1);
  });

  it('outputs are deeply frozen and deterministic', () => {
    const a = blindHoldoutMask(axis(4), BLIND);
    const b = blindHoldoutMask(axis(4), BLIND);
    expect(a).toEqual(b);
    if (a.ok) expect(Object.isFrozen(a.value.blind)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Regime partitions
// ---------------------------------------------------------------------------

describe('regimePartition', () => {
  it('selects the segments carrying the policy regime, in axis order', () => {
    const mixed = axis(5, ['bull', 'crisis', 'bull', 'crisis', 'crisis']);
    const result = regimePartition(mixed, REGIME);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must succeed');
    expect(result.value.regime).toBe('crisis');
    expect(result.value.segments.map((s) => s.ref)).toEqual([
      'dataset.segment-1',
      'dataset.segment-3',
      'dataset.segment-4',
    ]);
  });

  it('BOUNDARY: an empty regime is a typed error (empty_regime), never an empty split', () => {
    const missing = regimePartition(axis(3, ['bull', 'bull', 'bull']), REGIME);
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error('must fail');
    expect(missing.errors[0]?.code).toBe('empty_regime');
  });

  it('outputs are frozen; invalid inputs fail without throwing', () => {
    const result = regimePartition(axis(2, ['crisis', 'crisis']), REGIME);
    if (!result.ok) throw new Error('must succeed');
    expect(Object.isFrozen(result.value.segments)).toBe(true);
    expect(regimePartition(undefined as unknown as DatasetAxis, REGIME).ok).toBe(false);
    expect(regimePartition(axis(2, ['crisis', 'crisis']), { ...REGIME, regime: '' }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The policy projection
// ---------------------------------------------------------------------------

describe('policySegmentRefs', () => {
  it('projects walk-forward test refs, blind refs and regime refs', () => {
    const wf = policySegmentRefs(axis(4), WALK_FORWARD);
    expect(wf.ok).toBe(true);
    if (wf.ok) expect(wf.value).toEqual(['dataset.segment-2', 'dataset.segment-3', 'dataset.segment-4']);

    const blind = policySegmentRefs(axis(4), BLIND);
    expect(blind.ok).toBe(true);
    if (blind.ok) expect(blind.value).toEqual(['dataset.segment-3']);

    const regime = policySegmentRefs(axis(4, ['crisis', 'bull', 'crisis', 'bull']), REGIME);
    expect(regime.ok).toBe(true);
    if (regime.ok) expect(regime.value).toEqual(['dataset.segment-0', 'dataset.segment-2']);
  });

  it('propagates the typed boundary errors', () => {
    expect(policySegmentRefs(axis(2), WALK_FORWARD).ok).toBe(false);
    expect(policySegmentRefs(axis(1), BLIND).ok).toBe(false);
    expect(policySegmentRefs(axis(1, ['bull']), REGIME).ok).toBe(false);
  });
});
