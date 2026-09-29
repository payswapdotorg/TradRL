/**
 * RewardModel discipline tests (L7): declaration validation, the
 * post-hoc attachment, determinism of the annotated stream, the
 * undeclared-input boundary, and THE L7 TRIP WIRES — a reward signal
 * without a declared RewardModelRef is a typed error, and every emitted
 * signal carries its ref.
 */

import { describe, expect, it } from 'vitest';

import * as rl from './index';

const T0 = 1_700_000_000_000;
const AS_OF = T0 + 1_000;

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: unknown }): T {
  if (result.ok) return result.value;
  throw new Error(`unexpected failure: ${JSON.stringify(result.errors)}`);
}

// ---------------------------------------------------------------------------
// Fixtures: a canonical-shaped trajectory (two steps, observations + actions)
// ---------------------------------------------------------------------------

function fixtureMetadata(): rl.TrajectoryMetadata {
  return {
    trajectory_id: 'traj-reward-test' as rl.TrajectoryId,
    tenant: 'tenant-reward' as rl.TenantId,
    project: 'prj-reward' as rl.ProjectId,
    episode: 'ep-reward-test' as rl.EpisodeId,
    environment_config: 'envcfg-reward-test' as rl.EnvironmentConfigRef,
    runtime: 'runtime-reward-test@1' as rl.RuntimeRef,
    data: [],
    body_versions: ['body-reward@1' as rl.BodyVersionRef],
    substrates: ['substrate-reward@1' as rl.SubstrateRef],
  };
}

function fixtureTrajectory(): rl.Trajectory {
  let record = unwrap(rl.createTrajectory(fixtureMetadata(), []));
  record = unwrap(
    rl.appendTrajectoryStep(record, {
      step: 1,
      step_id: 'st-1' as rl.StepId,
      observations: [
        { observation_id: 'obs-1' as rl.ObservationId, available_time: T0 as rl.TimestampMs },
        { observation_id: 'obs-2' as rl.ObservationId, available_time: (T0 + 100) as rl.TimestampMs },
      ],
      actions: [
        {
          action_id: 'act-1' as rl.ActionId,
          actor: 'agent-reward' as rl.AgentInstanceId,
          submitted_at: T0 as rl.TimestampMs,
          client_sequence: 0,
          payload: { kind: 'probe', body: null },
        },
      ],
      rejections: [],
      rewards: [],
      tool_outcomes: [],
      environment_result: null,
      clock: { now: T0 as rl.TimestampMs, asOf: AS_OF as rl.TimestampMs, playbackSpeed: 1, paused: false, fidelity: 'exact_replay', informationPolicy: 'point-in-time' },
      causality_id: 'cz-1' as rl.CausalityId,
    }),
  );
  record = unwrap(
    rl.appendTrajectoryStep(record, {
      step: 2,
      step_id: 'st-2' as rl.StepId,
      observations: [{ observation_id: 'obs-3' as rl.ObservationId, available_time: (T0 + 200) as rl.TimestampMs }],
      actions: [],
      rejections: [
        {
          action: {
            action_id: 'act-2' as rl.ActionId,
            actor: 'agent-reward' as rl.AgentInstanceId,
            submitted_at: (T0 + 200) as rl.TimestampMs,
            client_sequence: 1,
            payload: null,
          },
          errors: [{ code: 'stale_sequence', path: '', message: 'test rejection' }],
        },
      ],
      rewards: [],
      tool_outcomes: [],
      environment_result: null,
      clock: { now: (T0 + 200) as rl.TimestampMs, asOf: AS_OF as rl.TimestampMs, playbackSpeed: 1, paused: false, fidelity: 'exact_replay', informationPolicy: 'point-in-time' },
      causality_id: 'cz-2' as rl.CausalityId,
    }),
  );
  return record;
}

/** A pure deterministic model: -1 per delivered observation, at the step's now. */
function observationCostModel(): rl.RewardModel {
  return {
    model_ref: 'reward-model:obs-count@1' as rl.RewardModelRef,
    declared_inputs: ['observations', 'clock'],
    transform: (scope: rl.RewardScope): readonly rl.RewardClaim[] => {
      const clock = scope.clock;
      if (clock === undefined) throw new Error('scope must carry the declared clock');
      const observations = scope.observations ?? [];
      return [
        {
          at: clock.now,
          available_time: clock.now,
          value: -observations.length,
          metric: 'observation-cost',
          detail: null,
          input_keys: ['observations', 'clock'],
        },
      ];
    },
    metadata: { owner: 'test', law: 'L7' },
  };
}

// ---------------------------------------------------------------------------
// Declaration validation
// ---------------------------------------------------------------------------

describe('RewardModel declaration validation', () => {
  it('accepts a well-formed model', () => {
    const result = rl.validateRewardModel(observationCostModel());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.model_ref).toBe('reward-model:obs-count@1');
      expect(result.value.declared_inputs).toEqual(['observations', 'clock']);
      expect(typeof result.value.transform).toBe('function');
    }
  });

  it('rejects malformed declarations with typed errors', () => {
    const base = observationCostModel();
    for (const [label, broken] of [
      ['missing ref', { ...base, model_ref: '' }],
      ['empty inputs', { ...base, declared_inputs: [] }],
      ['unknown input key', { ...base, declared_inputs: ['payloads'] }],
      ['duplicate inputs', { ...base, declared_inputs: ['observations', 'observations'] }],
      ['non-function transform', { ...base, transform: 'not-a-function' }],
      ['non-JSON metadata', { ...base, metadata: { bad: () => 1 } }],
    ] as const) {
      const result = rl.validateRewardModel(broken);
      expect(result.ok, label).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// The L7 trip wires
// ---------------------------------------------------------------------------

describe('L7 trip wires (rewards are never fabricated)', () => {
  it('a reward signal WITHOUT a declared RewardModelRef is a typed error', () => {
    const orphan = {
      reward_id: 'rw-orphan',
      at: T0,
      available_time: T0,
      value: -1,
      metric: 'observation-cost',
      source: 'reward-model:reward-model:obs-count@1',
      detail: null,
      // model_ref deliberately ABSENT — the fabricated-reward shape.
    };
    expect(rl.isRewardModelSignal(orphan)).toBe(false);
    const result = rl.validateRewardModelSignal(orphan);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('reward_model_mismatch');
      expect(result.errors[0]?.message).toContain('L7');
    }

    // And the empty-string ref is equally rejected.
    const emptyRef = { ...orphan, model_ref: '' };
    const emptyResult = rl.validateRewardModelSignal(emptyRef);
    expect(emptyResult.ok).toBe(false);
    if (!emptyResult.ok) expect(emptyResult.errors[0]?.code).toBe('reward_model_mismatch');
  });

  it('a WORLD-channel record does not satisfy the model-signal guard (channels never mix)', () => {
    const worldSignal: rl.RewardSignalRecord = {
      reward_id: 'rw-world' as rl.RewardId,
      at: T0 as rl.TimestampMs,
      available_time: T0 as rl.TimestampMs,
      value: 0.5,
      metric: 'fake-tick',
      source: 'fake-world',
      detail: null,
    };
    expect(rl.isRewardSignalRecord(worldSignal)).toBe(true);
    expect(rl.isRewardModelSignal(worldSignal)).toBe(false);
  });

  it('every emitted signal carries its ref and the model channel never touches the world channel', () => {
    const annotated = unwrap(rl.attachRewardSignals(fixtureTrajectory(), [observationCostModel()]));
    expect(rl.everySignalCarriesModelRef(annotated)).toBe(true);
    expect(annotated.applied_models).toEqual(['reward-model:obs-count@1']);
    for (const step of annotated.steps) {
      expect(step.rewards.length).toBe(0); // the world channel stays empty
      expect(step.model_rewards.length).toBe(1);
      expect(step.model_rewards[0]?.model_ref).toBe('reward-model:obs-count@1');
      expect(step.model_rewards[0]?.source).toBe('reward-model:reward-model:obs-count@1');
      expect(step.model_rewards[0]?.reward_id.startsWith('rm-')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The attachment
// ---------------------------------------------------------------------------

describe('attachRewardSignals (post-hoc annotation)', () => {
  it('annotates every step in recorded order with deterministic ids', () => {
    const annotated = unwrap(rl.attachRewardSignals(fixtureTrajectory(), [observationCostModel()]));
    expect(annotated.steps.length).toBe(2);
    expect(annotated.steps[0]?.model_rewards[0]?.value).toBe(-2); // two observations
    expect(annotated.steps[1]?.model_rewards[0]?.value).toBe(-1); // one observation
    const ids = annotated.steps.flatMap((step) => step.model_rewards.map((reward) => reward.reward_id));
    expect(new Set(ids).size).toBe(ids.length); // unique across the stream
    expect(rl.isDeeplyFrozen(annotated.steps)).toBe(true);
  });

  it('same trajectory + same models: byte-identical annotated stream, run twice (L9)', () => {
    const first = unwrap(rl.attachRewardSignals(fixtureTrajectory(), [observationCostModel()]));
    const second = unwrap(rl.attachRewardSignals(fixtureTrajectory(), [observationCostModel()]));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(rl.canonicalJson(JSON.parse(JSON.stringify(first)) as rl.JsonValue)).toBe(
      rl.canonicalJson(JSON.parse(JSON.stringify(second)) as rl.JsonValue),
    );
  });

  it('rejects an invalid trajectory, invalid models, and duplicate model refs', () => {
    const invalidTrajectory = rl.attachRewardSignals({ metadata: null, steps: [] }, [observationCostModel()]);
    expect(invalidTrajectory.ok).toBe(false);

    const invalidModel = rl.attachRewardSignals(fixtureTrajectory(), [{ ...observationCostModel(), declared_inputs: [] }]);
    expect(invalidModel.ok).toBe(false);

    const duplicate = rl.attachRewardSignals(fixtureTrajectory(), [observationCostModel(), observationCostModel()]);
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.errors[0]?.code).toBe('invalid_reward_model');
  });

  it('THE DECLARATION BOUNDARY: a claim reporting an undeclared input is a typed undeclared_reward_input', () => {
    const rogue: rl.RewardModel = {
      // Declares ONLY observations...
      model_ref: 'reward-model:rogue@1' as rl.RewardModelRef,
      declared_inputs: ['observations'],
      transform: (scope: rl.RewardScope): readonly rl.RewardClaim[] => [
        {
          // ...but the claim reports it derived from actions too.
          at: (T0 + 1) as rl.TimestampMs,
          available_time: (T0 + 1) as rl.TimestampMs,
          value: 0,
          metric: 'rogue',
          detail: null,
          input_keys: ['observations', 'actions'],
        },
      ],
      metadata: {},
    };
    const result = rl.attachRewardSignals(fixtureTrajectory(), [rogue]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('undeclared_reward_input');
      expect(result.errors[0]?.message).toContain('"actions"');
    }
  });

  it('a throwing or shape-invalid transform is a typed invalid_reward_model', () => {
    const throwing: rl.RewardModel = {
      model_ref: 'reward-model:throws@1' as rl.RewardModelRef,
      declared_inputs: ['observations'],
      transform: (): readonly rl.RewardClaim[] => {
        throw new Error('impure world');
      },
      metadata: {},
    };
    const threw = rl.attachRewardSignals(fixtureTrajectory(), [throwing]);
    expect(threw.ok).toBe(false);
    if (!threw.ok) expect(threw.errors[0]?.code).toBe('invalid_reward_model');

    const nonArray: rl.RewardModel = {
      model_ref: 'reward-model:nonarray@1' as rl.RewardModelRef,
      declared_inputs: ['observations'],
      transform: (): readonly rl.RewardClaim[] => ({ bad: true }) as unknown as readonly rl.RewardClaim[],
      metadata: {},
    };
    const notAnArray = rl.attachRewardSignals(fixtureTrajectory(), [nonArray]);
    expect(notAnArray.ok).toBe(false);
    if (!notAnArray.ok) expect(notAnArray.errors[0]?.code).toBe('invalid_reward_model');
  });

  it('claim shape violations are typed invalid_reward (time order, value, metric)', () => {
    const badTimeOrder: rl.RewardModel = {
      model_ref: 'reward-model:badtime@1' as rl.RewardModelRef,
      declared_inputs: ['clock'],
      transform: (scope: rl.RewardScope): readonly rl.RewardClaim[] => [
        {
          at: (T0 + 100) as rl.TimestampMs,
          available_time: T0 as rl.TimestampMs, // available BEFORE at — the reward-side time law
          value: 0,
          metric: 'bad-time',
          detail: null,
          input_keys: ['clock'],
        },
      ],
      metadata: {},
    };
    const result = rl.attachRewardSignals(fixtureTrajectory(), [badTimeOrder]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('invalid_field');

    const badValue: rl.RewardModel = {
      model_ref: 'reward-model:badvalue@1' as rl.RewardModelRef,
      declared_inputs: ['clock'],
      transform: (scope: rl.RewardScope): readonly rl.RewardClaim[] =>
        [{ at: T0 as rl.TimestampMs, available_time: T0 as rl.TimestampMs, value: Number.NaN, metric: 'x', detail: null, input_keys: ['clock'] }],
      metadata: {},
    };
    const nan = rl.attachRewardSignals(fixtureTrajectory(), [badValue]);
    expect(nan.ok).toBe(false);
  });

  it('multiple models annotate in order and the scope carries EXACTLY the declared inputs', () => {
    const seenKeys: string[] = [];
    const probe: rl.RewardModel = {
      model_ref: 'reward-model:probe@1' as rl.RewardModelRef,
      declared_inputs: ['actions', 'clock'],
      transform: (scope: rl.RewardScope): readonly rl.RewardClaim[] => {
        seenKeys.push(...Object.keys(scope).filter((key) => key !== 'trajectory_id' && key !== 'step'));
        const clock = scope.clock as { readonly now: rl.TimestampMs };
        return [
          {
            at: clock.now,
            available_time: clock.now,
            value: (scope.actions as readonly unknown[]).length,
            metric: 'probe-actions',
            detail: null,
            input_keys: ['actions', 'clock'],
          },
        ];
      },
      metadata: {},
    };
    const annotated = unwrap(rl.attachRewardSignals(fixtureTrajectory(), [observationCostModel(), probe]));
    expect(annotated.applied_models).toEqual(['reward-model:obs-count@1', 'reward-model:probe@1']);
    // The scope keys observed by the probe: ONLY actions and clock (plus identity).
    expect(new Set(seenKeys)).toEqual(new Set(['actions', 'clock']));
    expect(annotated.steps[0]?.model_rewards[1]?.metric).toBe('probe-actions');
    expect(annotated.steps[1]?.model_rewards[1]?.value).toBe(0); // step 2 has no accepted actions
  });
});
