/**
 * @tradrl/learning (service) — the reference reward models (L7).
 *
 * Pure, deterministic, versioned reward models over the MIRRORED
 * trajectory-step data — the discipline the protocol's RewardModel
 * contract demands. Each model declares its inputs EXACTLY, derives finite
 * scalars deterministically, and every claim reports the inputs it used.
 * NOTHING here interprets a value as PnL or emits an acceptance verdict:
 * rewards are DATA; evaluation (T012) decides (L7 — "raw PnL is
 * insufficient", rewards are never the sole criterion).
 *
 * The rogue model is a TEST instrument: it declares one input but reports a
 * claim derived from another — the `undeclared_reward_input` trip wire's
 * target (the declaration is the boundary).
 */

import type {
  RewardClaim,
  RewardModel,
  RewardModelRef,
  RewardScope,
  TimestampMs,
} from '../../../../packages/rl-protocol/src/index';

/** Round to 6 decimals — keeps JSON byte-comparisons stable. */
function rounded(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * The observation-cost model: `-0.001` per observation DELIVERED in the
 * step (an information-cost prior). Declared inputs: observations + clock
 * (the instants the claims pertain to).
 */
export function createObservationCostRewardModel(): RewardModel {
  const modelRef = 'reward-model:obs-count@1' as RewardModelRef;
  return {
    model_ref: modelRef,
    declared_inputs: ['observations', 'clock'],
    transform: (scope: RewardScope): readonly RewardClaim[] => {
      const clock = scope.clock;
      if (clock === undefined) throw new Error('obs-count model: the scope must carry the declared clock');
      const observations = scope.observations ?? [];
      return [
        {
          at: clock.now,
          available_time: clock.now,
          value: rounded(-observations.length * 0.001),
          metric: 'observation-cost',
          detail: { delivered: observations.length },
          input_keys: ['observations', 'clock'],
        },
      ];
    },
    metadata: { owner: '@tradrl/learning', law: 'L7 (rewards are data)', version: 1 },
  };
}

/**
 * The action-engagement model: `+0.01` per ACCEPTED action in the step
 * (an engagement prior — never a performance verdict). Declared inputs:
 * actions + clock.
 */
export function createActionEngagementRewardModel(): RewardModel {
  return {
    model_ref: 'reward-model:act-count@1' as RewardModelRef,
    declared_inputs: ['actions', 'clock'],
    transform: (scope: RewardScope): readonly RewardClaim[] => {
      const clock = scope.clock;
      if (clock === undefined) throw new Error('act-count model: the scope must carry the declared clock');
      const actions = scope.actions ?? [];
      return [
        {
          at: clock.now,
          available_time: clock.now,
          value: rounded(actions.length * 0.01),
          metric: 'action-engagement',
          detail: { accepted: actions.length },
          input_keys: ['actions', 'clock'],
        },
      ];
    },
    metadata: { owner: '@tradrl/learning', law: 'L7 (rewards are data)', version: 1 },
  };
}

/**
 * The ROGUE model (test instrument): declares ONLY `observations` but its
 * claim reports an `actions` derivation — attachRewardSignals must fail
 * with `undeclared_reward_input` (the L7/L9 input-declaration boundary).
 */
export function createRogueRewardModel(): RewardModel {
  return {
    model_ref: 'reward-model:rogue@1' as RewardModelRef,
    declared_inputs: ['observations'],
    transform: (scope: RewardScope): readonly RewardClaim[] => {
      const clock = scope.clock;
      const now = (clock?.now ?? 0) as TimestampMs;
      return [
        {
          at: now,
          available_time: now,
          value: 0,
          metric: 'rogue',
          detail: null,
          // The violation: 'actions' was never declared by this model.
          input_keys: ['observations', 'actions'],
        },
      ];
    },
    metadata: { owner: '@tradrl/learning', purpose: 'undeclared_reward_input trip wire' },
  };
}
