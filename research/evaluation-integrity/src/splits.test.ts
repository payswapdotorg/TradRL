/**
 * @tradrl/evaluation-integrity — split construction and registry tests.
 *
 * Laws under test (splits.ts / axis.ts):
 * - the axis mirror law (ordering, non-overlap, unique refs — T012 mirror);
 * - anchored walk-forward windows (prefix trains, window_exhaustion);
 * - PURGED/EMBARGOED construction (train segments ending within the
 *   embargo horizon of the test are purged; a starved window fails
 *   embargo_overlap; the purged count is reported);
 * - blind holdout masks (degenerate_mask both directions; the embargo gap
 *   law between visible and blind);
 * - kind honesty (a purged design with zero embargo / a walk-forward with
 *   an embargo are rejected);
 * - the registry: append-only, one policy = one construction
 *   (duplicate_split), ordered instants, content-addressed ids;
 * - the embargo authority: unknown_split_policy for unregistered policies.
 */

import { describe, expect, it } from 'vitest';

import {
  constructBlindHoldout,
  constructSplits,
  constructWalkForward,
  createSplitRegistry,
  embargoOfPolicy,
  policySegmentRefs,
  registerSplit,
  splitDefinitionId,
  splitRegistryId,
  validateDatasetAxis,
  validateSplitDefinition,
} from './index';
import type { DataRef, DatasetAxis, SplitDefinition, SplitPolicyRef, TimestampMs } from './index';
import { requireTimestampMs } from './index';

const T0 = 1_700_000_000_000;
const DAY = 86_400_000;

/** Trusted-literal id constructors (test-local, the T012 test pattern). */
const dataRef = (id: string): DataRef => id as DataRef;
const splitPolicyRef = (id: string): SplitPolicyRef => id as SplitPolicyRef;
const at = (ms: number): TimestampMs => requireTimestampMs(ms);

/** Six daily segments with one two-day gap after the third. */
function axis(): DatasetAxis {
  return {
    segments: [
      { ref: dataRef('seg-1'), start: at(T0), end: at(T0 + DAY), regime: 'calm' },
      { ref: dataRef('seg-2'), start: at(T0 + DAY), end: at(T0 + 2 * DAY), regime: 'calm' },
      { ref: dataRef('seg-3'), start: at(T0 + 2 * DAY), end: at(T0 + 3 * DAY), regime: 'calm' },
      { ref: dataRef('seg-4'), start: at(T0 + 5 * DAY), end: at(T0 + 6 * DAY), regime: 'trend' },
      { ref: dataRef('seg-5'), start: at(T0 + 6 * DAY), end: at(T0 + 7 * DAY), regime: 'trend' },
      { ref: dataRef('seg-6'), start: at(T0 + 7 * DAY), end: at(T0 + 8 * DAY), regime: 'crisis' },
    ],
  };
}

function definition(overrides: Record<string, unknown> = {}): SplitDefinition {
  const content = {
    kind: 'walk-forward' as const,
    policy_ref: splitPolicyRef('split.wf-1'),
    axis: axis(),
    min_train_segments: 2,
    step_segments: 1,
    embargo_ms: 0,
    holdout_count: 1,
    ...overrides,
  };
  const result = validateSplitDefinition(content);
  if (!result.ok) throw new Error(`fixture must validate: ${JSON.stringify(result.errors)}`);
  return result.value;
}

describe('the axis mirror (T012 law)', () => {
  it('accepts an ordered non-overlapping axis', () => {
    expect(validateDatasetAxis(axis()).ok).toBe(true);
  });

  it('rejects overlap, disorder, duplicate refs and empty windows', () => {
    expect(validateDatasetAxis({ segments: [...axis().segments.slice(0, 2), { ref: 'seg-x', start: T0 + DAY, end: T0 + 2 * DAY, regime: 'r' }] }).ok).toBe(false);
    expect(validateDatasetAxis({ segments: [...axis().segments].reverse() }).ok).toBe(false);
    expect(validateDatasetAxis({ segments: [...axis().segments, { ref: 'seg-1', start: T0 + 8 * DAY, end: T0 + 9 * DAY, regime: 'r' }] }).ok).toBe(false);
    expect(validateDatasetAxis({ segments: [{ ref: 's', start: T0, end: T0, regime: 'r' }] }).ok).toBe(false);
    expect(validateDatasetAxis({ segments: [] }).ok).toBe(false);
    expect(validateDatasetAxis({ segments: [{ ref: 's', start: T0, end: T0 + DAY, regime: '' }] }).ok).toBe(false);
  });
});

describe('anchored walk-forward', () => {
  it('builds expanding prefix trains with test segments', () => {
    const windows = constructWalkForward(definition());
    expect(windows.ok).toBe(true);
    if (!windows.ok) throw new Error('must construct');
    expect(windows.value).toHaveLength(4); // test indices 2,3,4,5 over 6 segments
    expect(windows.value[0]?.train.map((s) => s.ref)).toEqual(['seg-1', 'seg-2']);
    expect(windows.value[0]?.test.ref).toBe('seg-3');
    expect(windows.value[3]?.train.map((s) => s.ref)).toEqual(['seg-1', 'seg-2', 'seg-3', 'seg-4', 'seg-5']);
    expect(windows.value.every((w) => w.purged === 0)).toBe(true);
  });

  it('steps by the declared step', () => {
    const windows = constructWalkForward(definition({ step_segments: 2 }));
    expect(windows.ok).toBe(true);
    if (!windows.ok) throw new Error('must construct');
    expect(windows.value.map((w) => w.test.ref)).toEqual(['seg-3', 'seg-5']);
  });

  it('fails window_exhaustion on a too-short axis', () => {
    const result = constructWalkForward(definition({ min_train_segments: 6 }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('window_exhaustion');
  });
});

describe('purged/embargoed construction', () => {
  it('purges train segments that end within the embargo horizon of the test', () => {
    // Embargo of 1 day: a train segment survives only when end + 1d <= test.start.
    // test=seg-3 (start T0+2d): seg-2 (end 2d) purged, seg-1 (end 1d: 1d+1d<=2d) survives.
    // test=seg-4 (start T0+5d, after the 2-day gap): the whole prefix survives.
    // test=seg-5 (start T0+6d): seg-4 (end 6d) purged. test=seg-6: seg-5 purged.
    const purged = definition({ kind: 'purged-embargoed', embargo_ms: DAY, policy_ref: 'split.pe-1' });
    const windows = constructWalkForward(purged);
    expect(windows.ok).toBe(true);
    if (!windows.ok) throw new Error('must construct');
    const w3 = windows.value.find((w) => w.test.ref === 'seg-3');
    const w4 = windows.value.find((w) => w.test.ref === 'seg-4');
    const w5 = windows.value.find((w) => w.test.ref === 'seg-5');
    const w6 = windows.value.find((w) => w.test.ref === 'seg-6');
    expect(w3?.train.map((s) => s.ref)).toEqual(['seg-1']);
    expect(w3?.purged).toBe(1); // seg-2 purged
    expect(w4?.train.map((s) => s.ref)).toEqual(['seg-1', 'seg-2', 'seg-3']);
    expect(w4?.purged).toBe(0); // the 2-day gap absorbs the 1-day embargo
    expect(w5?.train.map((s) => s.ref)).toEqual(['seg-1', 'seg-2', 'seg-3']);
    expect(w5?.purged).toBe(1); // seg-4 purged
    expect(w6?.train.map((s) => s.ref)).toEqual(['seg-1', 'seg-2', 'seg-3', 'seg-4']);
    expect(w6?.purged).toBe(1); // seg-5 purged
  });

  it('an embargo that starves a window to an empty train set fails embargo_overlap', () => {
    // Embargo of 1 day with min_train 1: for test=seg-2 (start T0+1d),
    // seg-1 ends T0+1d -> 1d+1d > 1d -> purged. Empty train -> typed error.
    const starved = definition({ kind: 'purged-embargoed', embargo_ms: DAY, min_train_segments: 1, policy_ref: 'split.pe-starved' });
    const result = constructWalkForward(starved);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('embargo_overlap');
    expect(result.errors[0]?.message).toContain('purges the ENTIRE train set');
  });

  it('kind honesty: a purged design with zero embargo is rejected', () => {
    const result = validateSplitDefinition({ kind: 'purged-embargoed', policy_ref: 'p', axis: axis(), min_train_segments: 1, step_segments: 1, embargo_ms: 0, holdout_count: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('invalid_split');
  });

  it('kind honesty: a walk-forward with an embargo is rejected', () => {
    const result = validateSplitDefinition({ kind: 'walk-forward', policy_ref: 'p', axis: axis(), min_train_segments: 1, step_segments: 1, embargo_ms: 1000, holdout_count: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('invalid_split');
  });

  it('a gap in the axis can absorb the embargo', () => {
    // The axis has a 2-day gap between seg-3 and seg-4; starting the walk at
    // test=seg-4 (min_train 3), a 2-day embargo still trains on seg-3
    // (end 3d + 2d <= start 5d) for every window.
    const windows = constructWalkForward(definition({ kind: 'purged-embargoed', embargo_ms: 2 * DAY, min_train_segments: 3, policy_ref: 'split.pe-gap' }));
    expect(windows.ok).toBe(true);
  });
});

describe('blind holdout masks', () => {
  it('masks the declared trailing count', () => {
    const result = constructBlindHoldout(definition({ kind: 'blind-holdout', holdout_count: 2, policy_ref: 'split.bh-1' }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must construct');
    expect(result.value.visible.map((s) => s.ref)).toEqual(['seg-1', 'seg-2', 'seg-3', 'seg-4']);
    expect(result.value.blind.map((s) => s.ref)).toEqual(['seg-5', 'seg-6']);
  });

  it('degenerate masks fail both directions', () => {
    const all = constructBlindHoldout(definition({ kind: 'blind-holdout', holdout_count: 6, policy_ref: 'split.bh-all' }));
    expect(all.ok).toBe(false);
    if (all.ok) throw new Error('must fail');
    expect(all.errors[0]?.code).toBe('degenerate_mask');

    const none = validateSplitDefinition({ kind: 'blind-holdout', policy_ref: 'p', axis: axis(), min_train_segments: 1, step_segments: 1, embargo_ms: 0, holdout_count: 0 });
    expect(none.ok).toBe(false);
  });

  it('the embargo gap law between visible and blind (embargo_overlap)', () => {
    // holdout_count 3: blind starts at seg-4 (T0+5d); the visible prefix
    // ends at seg-3's end (T0+3d) -> a 2-day gap (the axis gap).
    // A 3-day embargo fails; the exact 2-day embargo passes.
    const tooWide = constructBlindHoldout(definition({ kind: 'blind-holdout', holdout_count: 3, embargo_ms: 3 * DAY, policy_ref: 'split.bh-emb' }));
    expect(tooWide.ok).toBe(false);
    if (tooWide.ok) throw new Error('must fail');
    expect(tooWide.errors[0]?.code).toBe('embargo_overlap');

    const exact = constructBlindHoldout(definition({ kind: 'blind-holdout', holdout_count: 3, embargo_ms: 2 * DAY, policy_ref: 'split.bh-emb2' }));
    expect(exact.ok).toBe(true);
  });

  it('constructSplits dispatches by kind', () => {
    const wf = constructSplits(definition());
    expect(Array.isArray(wf.ok && wf.value)).toBe(true);
    const bh = constructSplits(definition({ kind: 'blind-holdout', policy_ref: 'split.bh-x' }));
    expect(bh.ok).toBe(true);
    expect(Array.isArray(bh.ok && bh.value)).toBe(false);
  });
});

describe('the registry', () => {
  it('derives content-addressed definition ids (identical content, identical address)', () => {
    const a = definition({ policy_ref: 'split.same' });
    const b = definition({ policy_ref: 'split.same' });
    expect(a.definition_id).toBe(b.definition_id);
    expect(a.definition_id.startsWith('sdef:')).toBe(true);
    const other = definition({ policy_ref: 'split.other' });
    expect(other.definition_id).not.toBe(a.definition_id);
    void splitDefinitionId;
  });

  it('a supplied id that disagrees with the content fails', () => {
    const good = definition({ policy_ref: 'split.x' });
    const result = validateSplitDefinition({ ...good, definition_id: 'sdef:ffffffffffffffff', policy_ref: 'split.x2' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('invalid_field');
  });

  function registry() {
    const created = createSplitRegistry({ tenant: 'tenant-1', project: 'project-1' });
    if (!created.ok) throw new Error('must create');
    return created.value;
  }

  it('creates an open registry with a derived id', () => {
    const r = registry();
    expect(r.registry_id).toBe(splitRegistryId('tenant-1' as never, 'project-1' as never));
    expect(r.registered).toHaveLength(0);
  });

  it('registerSplit appends and keeps the original untouched', () => {
    const r = registry();
    const withOne = registerSplit(r, { definition: definition({ policy_ref: 'split.r1' }), registered_at: T0 });
    expect(withOne.ok).toBe(true);
    if (!withOne.ok) throw new Error('must register');
    expect(r.registered).toHaveLength(0);
    expect(withOne.value.registered).toHaveLength(1);
    const withTwo = registerSplit(withOne.value, { definition: definition({ kind: 'purged-embargoed', embargo_ms: DAY, policy_ref: 'split.r2' }), registered_at: T0 + 1 });
    expect(withTwo.ok).toBe(true);
    if (!withTwo.ok) throw new Error('must register');
    expect(withTwo.value.registered).toHaveLength(2);
    expect(withTwo.value.registered[1]?.registered_at).toBe(T0 + 1);
  });

  it('one policy maps to one construction (duplicate_split)', () => {
    const r = registry();
    const withOne = registerSplit(r, { definition: definition({ policy_ref: 'split.dup' }), registered_at: T0 });
    if (!withOne.ok) throw new Error('must register');
    const again = registerSplit(withOne.value, { definition: definition({ policy_ref: 'split.dup', min_train_segments: 3 }), registered_at: T0 + 1 });
    expect(again.ok).toBe(false);
    if (again.ok) throw new Error('must fail');
    expect(again.errors[0]?.code).toBe('duplicate_split');
    expect(again.errors[0]?.message).toContain('never rewrites');
  });

  it('rejects backwards registration instants', () => {
    const r = registry();
    const withOne = registerSplit(r, { definition: definition({ policy_ref: 'split.t1' }), registered_at: T0 + 10 });
    if (!withOne.ok) throw new Error('must register');
    const backwards = registerSplit(withOne.value, { definition: definition({ policy_ref: 'split.t2' }), registered_at: T0 });
    expect(backwards.ok).toBe(false);
    if (backwards.ok) throw new Error('must fail');
    expect(backwards.errors[0]?.code).toBe('invalid_registry');
  });

  it('embargoOfPolicy resolves the authority and rejects the unknown', () => {
    const r = registry();
    const withOne = registerSplit(r, { definition: definition({ kind: 'purged-embargoed', embargo_ms: 1234, policy_ref: 'split.emb' }), registered_at: T0 });
    if (!withOne.ok) throw new Error('must register');
    const resolved = embargoOfPolicy(withOne.value, 'split.emb');
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.value).toBe(1234);
    const unknown = embargoOfPolicy(withOne.value, 'split.ghost');
    expect(unknown.ok).toBe(false);
    if (unknown.ok) throw new Error('must fail');
    expect(unknown.errors[0]?.code).toBe('unknown_split_policy');
    expect(unknown.errors[0]?.message).toContain('refuses to invent');
  });

  it('policySegmentRefs projects the construction material', () => {
    const r = registry();
    const withWf = registerSplit(r, { definition: definition({ policy_ref: 'split.proj' }), registered_at: T0 });
    if (!withWf.ok) throw new Error('must register');
    const refs = policySegmentRefs(withWf.value, 'split.proj');
    expect(refs.ok).toBe(true);
    if (refs.ok) expect(refs.value).toEqual(['seg-3', 'seg-4', 'seg-5', 'seg-6']);
    const withBh = registerSplit(withWf.value, { definition: definition({ kind: 'blind-holdout', holdout_count: 1, policy_ref: 'split.proj-bh' }), registered_at: T0 + 1 });
    if (!withBh.ok) throw new Error('must register');
    const blindRefs = policySegmentRefs(withBh.value, 'split.proj-bh');
    expect(blindRefs.ok).toBe(true);
    if (blindRefs.ok) expect(blindRefs.value).toEqual(['seg-6']);
  });
});

describe('determinism of construction', () => {
  it('the same definition constructs the deeply-equal split', () => {
    const a = constructWalkForward(definition({ kind: 'purged-embargoed', embargo_ms: DAY, policy_ref: 'split.det' }));
    const b = constructWalkForward(definition({ kind: 'purged-embargoed', embargo_ms: DAY, policy_ref: 'split.det' }));
    expect(a).toEqual(b);
  });
});
