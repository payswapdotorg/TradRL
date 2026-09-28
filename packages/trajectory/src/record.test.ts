/**
 * @tradrl/trajectory — the append-only record discipline.
 *
 * Immutability law: trajectories are deeply-frozen value objects; append is
 * copy-on-write; the original is never touched; mutation attempts throw;
 * duplicate step ids are rejected; replay is order-faithful.
 */

import { describe, expect, it } from 'vitest';

import {
  appendStep,
  createTrajectory,
  isDeeplyFrozen,
  replay,
  stepCount,
} from './index';
import { validMetadata, validStep, validTrajectory } from './fixtures';

describe('createTrajectory', () => {
  it('constructs a deeply-frozen record from a valid spec', () => {
    const trajectory = validTrajectory(2);
    expect(isDeeplyFrozen(trajectory)).toBe(true);
    expect(trajectory.steps).toHaveLength(2);
  });

  it('allows an empty step log — the log starts empty and grows by append', () => {
    const result = createTrajectory({ id: 'traj-empty', metadata: validMetadata() });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.steps).toEqual([]);
  });

  it('rejects an invalid id or an incomplete lineage block', () => {
    const badId = createTrajectory({ id: '', metadata: validMetadata() });
    expect(badId.ok).toBe(false);
    if (!badId.ok) expect(badId.error.code).toBe('invalid_id');

    const { runtimeRef, ...incomplete } = validMetadata();
    void runtimeRef;
    const badMeta = createTrajectory({ id: 'traj-1', metadata: incomplete });
    expect(badMeta.ok).toBe(false);
    if (!badMeta.ok) expect(badMeta.error.code).toBe('invalid_metadata');
  });

  it('rejects invalid initial steps and duplicate initial step ids', () => {
    const badStep = createTrajectory({
      id: 'traj-1',
      metadata: validMetadata(),
      steps: [{ ...validStep(), id: '' }],
    });
    expect(badStep.ok).toBe(false);
    if (!badStep.ok) expect(badStep.error.code).toBe('invalid_step');

    const dup = createTrajectory({
      id: 'traj-1',
      metadata: validMetadata(),
      steps: [validStep(), validStep()],
    });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error.code).toBe('duplicate_step');
  });
});

describe('appendStep (append-only, copy-on-write)', () => {
  it('returns a NEW record; the original is untouched', () => {
    const original = validTrajectory(1);
    const appended = appendStep(original, validStep(1_700_000_001_000, 99));
    expect(appended.ok).toBe(true);
    if (!appended.ok) return;
    expect(appended.value.steps).toHaveLength(2);
    expect(original.steps).toHaveLength(1); // untouched
    expect(appended.value).not.toBe(original);
    expect(isDeeplyFrozen(appended.value)).toBe(true);
  });

  it('appends at the end and only at the end (order is the record)', () => {
    const first = validStep(1_700_000_000_000, 1);
    const second = validStep(1_700_000_001_000, 2);
    const result = appendStep(validTrajectory(1), second);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.steps[0]?.id).toBe(first.id);
    expect(result.value.steps[result.value.steps.length - 1]?.id).toBe(second.id);
  });

  it('rejects a step whose id already exists', () => {
    const original = validTrajectory(1);
    const again = appendStep(original, validStep(1_700_000_009_000, 1));
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error.code).toBe('duplicate_step');
  });

  it('rejects a structurally invalid step', () => {
    const original = validTrajectory(1);
    const broken = { ...validStep(), environmentResultRef: '' };
    const result = appendStep(original, broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_step');
  });

  it('distinct append orders produce distinct records', () => {
    const a = validStep(1_700_000_000_000, 1);
    const b = validStep(1_700_000_001_000, 2);
    const abResult = appendStep(validTrajectory(0), a);
    const baResult = appendStep(validTrajectory(0), b);
    if (!abResult.ok || !baResult.ok) throw new Error('fixture append must succeed');
    const ab = appendStep(abResult.value, b);
    const ba = appendStep(baResult.value, a);
    expect(ab.ok && ba.ok).toBe(true);
    if (!ab.ok || !ba.ok) return;
    expect(ab.value.steps.map((s) => s.id)).toEqual(['step-1', 'step-2']);
    expect(ba.value.steps.map((s) => s.id)).toEqual(['step-2', 'step-1']);
  });
});

describe('immutability (deep freeze)', () => {
  it('mutating the record, its steps or its lineage throws in strict mode', () => {
    const trajectory = validTrajectory(2);
    expect(() => {
      (trajectory as { id: string }).id = 'hijacked';
    }).toThrow();
    expect(() => {
      (trajectory.steps as unknown as unknown[]).push(validStep());
    }).toThrow();
    expect(() => {
      (trajectory.metadata as { tenantRef: string }).tenantRef = 'tenant-evil';
    }).toThrow();
    expect(() => {
      (trajectory.steps[0] as { environmentResultRef: string }).environmentResultRef = 'forged';
    }).toThrow();
    expect(trajectory.id).toBe('traj-0192');
    expect(trajectory.metadata.tenantRef).toBe('tenant-acme');
  });
});

describe('replay', () => {
  it('yields the step sequence in exactly the recorded order', () => {
    const trajectory = validTrajectory(3);
    expect(replay(trajectory).map((s) => s.id)).toEqual(['step-1', 'step-2', 'step-3']);
    expect(stepCount(trajectory)).toBe(3);
  });

  it('replay of an appended record extends the sequence without reordering', () => {
    const base = validTrajectory(2);
    const extended = appendStep(base, validStep(1_700_000_002_000, 42));
    if (!extended.ok) throw new Error(extended.error.message);
    expect(replay(base).map((s) => s.id)).toEqual(['step-1', 'step-2']);
    expect(replay(extended.value).map((s) => s.id)).toEqual(['step-1', 'step-2', 'step-42']);
  });
});
