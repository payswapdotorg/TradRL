/**
 * @tradrl/environment-runner — the deterministic EpisodeRunner.
 *
 * Drives ANY `Environment` (the protocol interface T009/T010 implement)
 * through a complete episode given a pluggable PURE {@link Policy}:
 *
 *     start -> [ observe -> policy -> submit -> advance ]* -> finish
 *
 * and records the full step trace (observations delivered, actions accepted,
 * rejections, rewards, clock moves per step) as an {@link EpisodeTrace} —
 * a deeply frozen, JSON-serializable value.
 *
 * Determinism (L9): given the same EnvironmentSpec (including the seed),
 * the same policy, and the same options, two runs over fresh environment
 * instances produce byte-identical traces. The runner itself contributes
 * only deterministic values: action ids are minted from the episode id and
 * a monotonic counter, `submitted_at` is the step's `now`, and termination
 * details are derived from the recorded run. All nondeterminism belongs to
 * the environment — and the environment is seeded by the spec.
 *
 * Termination: the episode ends with `completed` when the clock reaches
 * `asOf`, or `step_limit` when the step budget is exhausted first. The
 * environment may itself finish an episode `terminal` before either —
 * the runner surfaces whatever result the environment produced.
 */

import {
  deepFreeze,
  fail,
  isAgentInstanceId,
  isPositiveSafeInteger,
  ok,
  requireTimestampMs,
  validateEnvironmentSpec,
} from '../../../packages/environment-protocol/src/index';
import type {
  Action,
  ActionId,
  AgentInstanceId,
  EnvResult,
  Environment,
  EnvironmentSpec,
  EpisodeState,
  Observation,
} from '../../../packages/environment-protocol/src/index';
import { isPolicyProposal, type Policy, type PolicyProposal } from './policy';
import { makeEpisodeTrace, makeStepRecord, type EpisodeTrace, type Rejection, type StepRecord } from './trace';

/**
 * Options for one run. `actor` is the agent instance the runner submits as;
 * `step_ms` is the clock advance per step (clamped to `asOf`); `max_steps`
 * is the step budget (a safety limit, not a world property).
 */
export interface RunOptions {
  readonly actor: AgentInstanceId;
  readonly step_ms: number;
  readonly max_steps: number;
}

/** Runtime guard for run options. */
export function isRunOptions(value: unknown): value is RunOptions {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    isAgentInstanceId(candidate.actor) &&
    isPositiveSafeInteger(candidate.step_ms) &&
    isPositiveSafeInteger(candidate.max_steps)
  );
}

function validateOptions(options: RunOptions): EnvResult<true> {
  if (!isAgentInstanceId(options.actor)) {
    return fail('invalid_field', 'options.actor must be a non-empty agent instance id', 'options.actor');
  }
  if (!isPositiveSafeInteger(options.step_ms)) {
    return fail('invalid_field', 'options.step_ms must be a positive safe integer of epoch milliseconds', 'options.step_ms');
  }
  if (!isPositiveSafeInteger(options.max_steps)) {
    return fail('invalid_field', 'options.max_steps must be a positive safe integer', 'options.max_steps');
  }
  return ok(true);
}

/**
 * Drive `environment` through one episode of `spec` under `policy`.
 *
 * The spec is validated defensively before the run begins (the environment
 * validates again at `start` — defense in depth). Any environment failure
 * (a rejected observation emission, an observe/advance failure) aborts the
 * run and returns the typed errors; policy failures likewise. Rejected
 * ACTION SUBMISSIONS do not abort the run — they are recorded as
 * {@link Rejection}s and the episode continues (a rejected request is a
 * legitimate episode event, not a runner error).
 */
export function runEpisode(
  environment: Environment,
  spec: EnvironmentSpec,
  policy: Policy,
  options: RunOptions,
): EnvResult<EpisodeTrace> {
  const optionsOk = validateOptions(options);
  if (!optionsOk.ok) return optionsOk;
  if (typeof policy !== 'function') {
    return fail('invalid_field', 'policy must be a pure function (observations -> proposals)', 'policy');
  }
  const specResult = validateEnvironmentSpec(spec);
  if (!specResult.ok) return specResult;

  const startResult = environment.start(specResult.value);
  if (!startResult.ok) return startResult;
  let state: EpisodeState = startResult.value;

  const steps: StepRecord[] = [];
  const deliveredIds = new Set<string>();
  let minted = 0;
  let lastAcceptedSequence: number | null = null;

  // Zero-length episodes (now == asOf at start) finish immediately.
  while ((state.clock.now as number) < (state.clock.asOf as number)) {
    if (steps.length >= options.max_steps) {
      const finished = environment.finish(state.episode_id, {
        code: 'step_limit',
        detail: `step budget of ${options.max_steps} exhausted at now=${state.clock.now} (asOf=${state.clock.asOf})`,
      });
      if (!finished.ok) return finished;
      return ok(makeEpisodeTrace({ spec: specResult.value, episode_id: state.episode_id, steps, result: finished.value.result }));
    }

    const step = steps.length + 1;
    const at = state.clock.now;
    const rewardsBefore = state.rewards.length;

    // 1. Observe at `now` — the environment polices the inclusive boundary.
    const observed = environment.observe(state.episode_id, at);
    if (!observed.ok) return observed;

    // 2. Deliver the delta (observations not delivered by earlier steps).
    const delivered: Observation[] = [];
    for (const observation of observed.value) {
      if (!deliveredIds.has(observation.observation_id)) {
        deliveredIds.add(observation.observation_id);
        delivered.push(observation);
      }
    }

    // 3. Ask the policy for proposals over the full visible set.
    const input = { episode_id: state.episode_id, step, now: at, observations: observed.value };
    const proposals = policy(input);
    if (!Array.isArray(proposals) || !proposals.every((proposal) => isPolicyProposal(proposal))) {
      return fail('invalid_action', `policy returned a non-proposal at step ${step} (every item must be { kind, payload })`);
    }

    // 4. Mint deterministic action envelopes and submit them.
    const actions: Action[] = [];
    const rejections: Rejection[] = [];
    for (const proposal of proposals as readonly PolicyProposal[]) {
      minted += 1;
      const clientSequence: number = lastAcceptedSequence === null ? 0 : lastAcceptedSequence + 1;
      const action: Action = deepFreeze({
        action_id: `${state.episode_id}-a${minted}` as ActionId,
        actor: options.actor,
        submitted_at: at,
        client_sequence: clientSequence,
        payload: { kind: proposal.kind, body: proposal.payload },
      });
      const submitted = environment.submit(state.episode_id, action);
      if (submitted.ok) {
        state = submitted.value;
        lastAcceptedSequence = clientSequence;
        actions.push(action);
      } else {
        rejections.push({ action, errors: submitted.errors });
      }
    }

    // 5. Advance the clock (clamped to asOf; monotonic by protocol).
    const target = Math.min((at as number) + options.step_ms, state.clock.asOf as number);
    const advanced = environment.advance(state.episode_id, requireTimestampMs(target));
    if (!advanced.ok) return advanced;
    state = advanced.value;

    // 6. Record the step, including the rewards the world emitted during it.
    steps.push(
      makeStepRecord({
        step,
        at,
        observations: delivered,
        actions,
        rejections,
        advanced_to: requireTimestampMs(target),
        rewards: state.rewards.slice(rewardsBefore),
      }),
    );
  }

  // Natural completion: the clock reached asOf.
  const finished = environment.finish(state.episode_id, {
    code: 'completed',
    detail: `clock reached asOf=${state.clock.asOf} after ${steps.length} step${steps.length === 1 ? '' : 's'}`,
  });
  if (!finished.ok) return finished;
  return ok(makeEpisodeTrace({ spec: specResult.value, episode_id: state.episode_id, steps, result: finished.value.result }));
}
