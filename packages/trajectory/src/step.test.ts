/**
 * @tradrl/trajectory — TrajectoryStep guard totality.
 *
 * Each case breaks exactly one documented invariant of the atomic record;
 * the guard must reject it. Structural honesty: guards validate STRUCTURE
 * (a leaky availability is structurally valid — see sample.test.ts).
 */

import { describe, expect, it } from 'vitest';

import { isActionRecord, isObservationRef, isRewardSignal, isTrajectoryStep } from './index';
import type { TrajectoryStep } from './index';
import { validStep } from './fixtures';

function stepWith(patch: Partial<TrajectoryStep>): TrajectoryStep {
  return { ...validStep(), ...patch };
}

describe('ObservationRef', () => {
  it('accepts a non-empty ref plus valid availability instant', () => {
    expect(isObservationRef({ ref: 'obs-1', availableTime: 42 })).toBe(true);
  });

  it('rejects empty refs, invalid instants and malformed shapes', () => {
    expect(isObservationRef({ ref: '', availableTime: 42 })).toBe(false);
    expect(isObservationRef({ ref: 'obs-1', availableTime: 42.5 })).toBe(false);
    expect(isObservationRef({ ref: 'obs-1' })).toBe(false);
    expect(isObservationRef({ availableTime: 42 })).toBe(false);
    expect(isObservationRef('obs-1')).toBe(false);
  });
});

describe('ActionRecord', () => {
  it('accepts an actor id plus a JSON-object payload (including empty)', () => {
    expect(isActionRecord({ actorId: 'agent-1', payload: { kind: 'noop' } })).toBe(true);
    expect(isActionRecord({ actorId: 'agent-1', payload: {} })).toBe(true);
  });

  it('rejects missing actor, non-object payloads and non-JSON payload values', () => {
    expect(isActionRecord({ payload: {} })).toBe(false);
    expect(isActionRecord({ actorId: '', payload: {} })).toBe(false);
    expect(isActionRecord({ actorId: 'agent-1', payload: 'text' })).toBe(false);
    expect(isActionRecord({ actorId: 'agent-1', payload: [1] })).toBe(false);
    expect(isActionRecord({ actorId: 'agent-1', payload: { leaky: Number.NaN } })).toBe(false);
    expect(isActionRecord({ actorId: 'agent-1', payload: { deep: [Number.POSITIVE_INFINITY] } })).toBe(false);
    expect(isActionRecord({ actorId: 'agent-1', payload: { fn: 0 } })).toBe(true); // 0 is JSON-safe
    expect(isActionRecord(null)).toBe(false);
  });
});

describe('RewardSignal', () => {
  it('accepts finite values with optional dimension', () => {
    expect(isRewardSignal({ value: -1.25 })).toBe(true);
    expect(isRewardSignal({ value: 0, dimension: 'pnl' })).toBe(true);
  });

  it('rejects non-finite values and malformed dimensions', () => {
    expect(isRewardSignal({ value: Number.NaN })).toBe(false);
    expect(isRewardSignal({ value: '0.25' })).toBe(false);
    expect(isRewardSignal({ value: 0.25, dimension: '' })).toBe(false);
    expect(isRewardSignal({ value: 0.25, dimension: 42 })).toBe(false);
  });
});

describe('TrajectoryStep guard', () => {
  it('accepts the canonical fixture', () => {
    expect(isTrajectoryStep(validStep())).toBe(true);
  });

  it('accepts a step with no observations and no reward (both explicitly optional)', () => {
    const minimal = stepWith({ observations: [], reward: undefined, toolOutcomeRefs: [] });
    expect(isTrajectoryStep(minimal)).toBe(true);
  });

  it('rejects a missing or invalid step id', () => {
    expect(isTrajectoryStep(stepWith({ id: '' }))).toBe(false);
    expect(isTrajectoryStep({ ...validStep(), id: undefined })).toBe(false);
  });

  it('rejects malformed observation lists', () => {
    expect(isTrajectoryStep(stepWith({ observations: 'nope' as unknown as never }))).toBe(false);
    expect(isTrajectoryStep(stepWith({ observations: [{ ref: 'x', availableTime: -1 }] }))).toBe(false);
  });

  it('rejects duplicate observation refs within one step (corruption)', () => {
    const dup = { ref: 'obs-same', availableTime: 1 };
    expect(isTrajectoryStep(stepWith({ observations: [dup, { ...dup }] }))).toBe(false);
  });

  it('rejects a missing or invalid action', () => {
    expect(isTrajectoryStep({ ...validStep(), action: undefined })).toBe(false);
    expect(isTrajectoryStep(stepWith({ action: { actorId: 'a', payload: { x: Number.NaN } } }))).toBe(false);
  });

  it('rejects a missing or empty environment result ref', () => {
    expect(isTrajectoryStep({ ...validStep(), environmentResultRef: undefined })).toBe(false);
    expect(isTrajectoryStep(stepWith({ environmentResultRef: '  ' }))).toBe(false);
  });

  it('rejects an invalid reward only when the reward is present (explicit optionality)', () => {
    expect(isTrajectoryStep(stepWith({ reward: { value: Number.POSITIVE_INFINITY } }))).toBe(false);
    expect(isTrajectoryStep(stepWith({ reward: undefined }))).toBe(true);
  });

  it('rejects malformed or duplicate tool outcome refs', () => {
    expect(isTrajectoryStep(stepWith({ toolOutcomeRefs: ['ok', ''] }))).toBe(false);
    expect(isTrajectoryStep(stepWith({ toolOutcomeRefs: ['dup', 'dup'] }))).toBe(false);
    expect(isTrajectoryStep(stepWith({ toolOutcomeRefs: 'nope' as unknown as never }))).toBe(false);
  });

  it('rejects a missing or invalid clock sample', () => {
    expect(isTrajectoryStep({ ...validStep(), clock: undefined })).toBe(false);
    expect(isTrajectoryStep(stepWith({ clock: { now: 200, asOf: 100 } }))).toBe(false);
  });

  it('rejects a missing causality id', () => {
    expect(isTrajectoryStep({ ...validStep(), causalityId: undefined })).toBe(false);
    expect(isTrajectoryStep(stepWith({ causalityId: '' }))).toBe(false);
  });

  it('structurally ACCEPTS a leaky observation (availableTime beyond now) — forensics, not guards, judge leaks', () => {
    const leaky = stepWith({
      observations: [{ ref: 'obs-future', availableTime: 1_700_000_060_000 }],
    });
    expect(leaky.observations[0]?.availableTime).toBeGreaterThan(leaky.clock.now);
    expect(isTrajectoryStep(leaky)).toBe(true);
  });
});
