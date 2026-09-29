/**
 * @tradrl/rl-protocol — the EpisodeDriver: the deterministic five-operation
 * episode loop over the environment-protocol step shapes (mirrors).
 *
 *     start -> observe (L4 gate) -> act (submit — intent, never
 *     authority, L8) -> advance -> finish
 *
 * The driver is a PURE REDUCER over an immutable {@link DriverState}: every
 * operation validates its inputs, drives the injected
 * {@link EnvironmentPort} through exactly one of the five world operations,
 * guards the world's answer against the mirrors, and returns a NEW deeply
 * frozen state (the original is untouched — L3/L9 discipline). There is no
 * ambient clock and no hidden randomness anywhere: action ids are minted
 * from the episode id plus a monotonic counter, step/causality ids from the
 * driver seed plus the episode id plus the step ordinal. Same (environment
 * script, seed) -> byte-identical step log, run twice (determinism tests,
 * deep-equal + serialized-bytes-equal).
 *
 * Step formation (the T011 atomic record, mirrored): a step OPENS at the
 * first observe/act of a driving instant and CLOSES at the following
 * advance (or at finish) — the closed step carries the observation refs
 * DELIVERED while it was open (the visible delta, first-delivery only), the
 * actions ACCEPTED and REJECTED in order (the full request history is
 * experience — L11's spirit: nothing is pruned), the reward signals the
 * WORLD emitted during the step (the world channel only — bridge rewards
 * attach post-hoc, L7), and the clock sample the step closed under.
 *
 * Law enforcement summary:
 *   - L4: `observe` polices the DECLARED information boundary — the query
 *     instant may not exceed the episode's `now` (`observation_beyond_now`)
 *     and every delivered observation must satisfy the INCLUSIVE boundary
 *     `available_time <= at` (`l4_boundary_violation` — a rogue world
 *     handing future-dated observations is a typed error, not a leak).
 *   - L8: `act` submits REQUESTS through the port; the driver never grants
 *     and never models authority — rejections are RECORDS.
 *   - Monotonic anchored time: `advance` refuses regressions
 *     (`clock_regression`) and advances past `asOf` (`beyond_as_of`).
 *   - Lifecycle totality: use-after-finish on observe/act/advance and
 *     double-finish are typed `driver_finished` errors; operations before
 *     start are `driver_not_started`; the step budget bounds RECORDED steps
 *     (`budget_exhausted` — the caller then finishes with `step_limit`).
 */

import { canonicalJson, deepFreeze, fnv1a32Hex, isJsonValue, isPositiveSafeInteger, isRecord } from './primitives';
import type { JsonValue } from './primitives';
import { fail, ok, type RLResult } from './errors';
import { isTimestampMs, type TimestampMs } from './timestamp';
import type { ActionId, AgentInstanceId, CausalityId, EpisodeId, Seed, StepId } from './ids';
import { isAgentInstanceId } from './ids';
import type {
  ClockConfig,
  EnvironmentPort,
  EnvironmentResult,
  EpisodeFinishView,
  EpisodeResultView,
  EpisodeView,
  ObservationView,
  RewardSignalEnvelope,
  TerminationReason,
} from './env-mirror';
import {
  environmentFailure,
  isEnvironmentPort,
  isEpisodeFinishView,
  isEpisodeView,
  isObservationView,
  isTerminationReason,
  validateEnvironmentSpec,
} from './env-mirror';
import type {
  ActionRecord,
  ClockSample,
  ObservationRef,
  RejectionError,
  RejectionRecord,
  RewardSignalRecord,
  TrajectoryStep,
} from './traj-mirror';
import { isTrajectoryStep, validateTrajectoryStep } from './traj-mirror';

// ---------------------------------------------------------------------------
// The policy proposal (the driver's `act` input — the POLICY port that
// produces proposals is trainer.ts's injected port)
// ---------------------------------------------------------------------------

/**
 * One action proposal, as handed to {@link driverAct}: an opaque label plus
 * an opaque JSON payload. The DRIVER mints the action envelope
 * (`payload = { kind, body }` — the documented environment-runner convention
 * world implementers decode) and the ENVIRONMENT decides; nothing here
 * grants execution authority (L8).
 */
export interface PolicyProposal {
  readonly kind: string;
  readonly payload: JsonValue;
}

/** Runtime guard for a policy proposal. */
export function isPolicyProposal(value: unknown): value is PolicyProposal {
  if (!isRecord(value)) return false;
  return typeof value.kind === 'string' && value.kind.length > 0 && isJsonValue(value.payload);
}

// ---------------------------------------------------------------------------
// The driver state
// ---------------------------------------------------------------------------

/** The driver lifecycle: idle (created), running (episode bound), finished. */
export type DriverStatus = 'idle' | 'running' | 'finished';

/** The in-flight step accumulator (opens at the first observe/act, closes at advance/finish). */
export interface PendingStep {
  /** Observation refs DELIVERED while this step is open, in delivery order. */
  readonly observations: readonly ObservationRef[];
  /** Action requests ACCEPTED while open, in submission order. */
  readonly actions: readonly ActionRecord[];
  /** Action requests REJECTED while open, with the world's typed errors. */
  readonly rejections: readonly RejectionRecord[];
  /** World reward count consumed before this step opened (the step's reward window starts here). */
  readonly rewards_before: number;
}

/**
 * The immutable driver state (see module header). `steps` is the append-only
 * closed-step log — 1-based ordinals, strictly sequential; `delivered` is
 * the cumulative delivered-observation set (the legitimate information set
 * the policy conditions on); `budget` counts REMAINING recordable steps.
 */
export interface DriverState {
  readonly status: DriverStatus;
  readonly seed: Seed;
  readonly actor: AgentInstanceId;
  /** Remaining recordable steps (a closed step consumes one). */
  readonly budget: number;
  readonly episode: EpisodeId | null;
  /** The last-known episode clock (updated from every world view). */
  readonly clock: ClockConfig | null;
  readonly termination: TerminationReason | null;
  /** The immutable result of the finished episode (null until finish). */
  readonly finish_result: EpisodeResultView | null;
  /** The closed steps, ordinals strictly sequential from 1. */
  readonly steps: readonly TrajectoryStep[];
  /** The open step accumulator (null between steps). */
  readonly open: PendingStep | null;
  /** Cumulative delivered observation refs (the agent's information set). */
  readonly delivered: readonly ObservationRef[];
  /** Actions minted so far (monotonic id counter). */
  readonly minted: number;
  /** The actor's last accepted client_sequence (null before the first acceptance). */
  readonly last_sequence: number | null;
  /** World reward signals folded into closed steps so far. */
  readonly rewards_seen: number;
}

/** Runtime guard for a structurally consistent driver state. */
export function isDriverState(value: unknown): value is DriverState {
  if (!isRecord(value)) return false;
  if (value.status !== 'idle' && value.status !== 'running' && value.status !== 'finished') return false;
  if (typeof value.seed !== 'string' || value.seed.length === 0) return false;
  if (typeof value.actor !== 'string' || value.actor.length === 0) return false;
  if (typeof value.budget !== 'number' || !Number.isSafeInteger(value.budget) || value.budget < 0) return false;
  if (value.episode !== null && typeof value.episode !== 'string') return false;
  if (value.status === 'idle' && (value.episode !== null || value.clock !== null)) return false;
  if (value.status !== 'idle' && value.episode === null) return false;
  if (value.termination !== null && !isTerminationReason(value.termination)) return false;
  if (value.status === 'finished' && value.termination === null) return false;
  if (value.status !== 'finished' && value.termination !== null) return false;
  if (!Array.isArray(value.steps)) return false;
  if (!(value.steps as readonly unknown[]).every((step) => isTrajectoryStep(step))) return false;
  if (typeof value.minted !== 'number' || !Number.isSafeInteger(value.minted) || value.minted < 0) return false;
  if (value.last_sequence !== null && typeof value.last_sequence !== 'number') return false;
  if (typeof value.rewards_seen !== 'number' || !Number.isSafeInteger(value.rewards_seen) || value.rewards_seen < 0)
    return false;
  if (!Array.isArray(value.delivered)) return false;
  if (!(value.delivered as readonly unknown[]).every((ref) => isObservationView(ref))) return false;
  return true;
}

/** Creation options: the driver seed (id minting), the step budget, the acting agent instance. */
export interface DriverOptions {
  readonly seed: Seed;
  readonly step_budget: number;
  readonly actor: AgentInstanceId;
}

/**
 * Create a fresh idle driver. `step_budget` must be a positive safe integer
 * (the run's budget slice); the actor is the agent instance every minted
 * action submits as.
 */
export function createEpisodeDriver(options: unknown): RLResult<DriverState> {
  if (!isRecord(options)) {
    return fail('invalid_type', 'driver options must be an object');
  }
  if (typeof options.seed !== 'string' || options.seed.length === 0) {
    return fail('invalid_field', 'driver options.seed must be a non-empty string (L9 — id minting derives from it)', 'seed');
  }
  if (!isAgentInstanceId(options.actor)) {
    return fail('invalid_field', 'driver options.actor must be a non-empty agent instance id', 'actor');
  }
  if (!isPositiveSafeInteger(options.step_budget)) {
    return fail('invalid_field', 'driver options.step_budget must be a positive safe integer', 'step_budget');
  }
  return ok(
    deepFreeze({
      status: 'idle',
      seed: options.seed as Seed,
      actor: options.actor as AgentInstanceId,
      budget: options.step_budget,
      episode: null,
      clock: null,
      termination: null,
      finish_result: null,
      steps: [],
      open: null,
      delivered: [],
      minted: 0,
      last_sequence: null,
      rewards_seen: 0,
    }),
  );
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** The step's clock sample, projected from the world's clock config (identical shape). */
function clockSampleOf(clock: ClockConfig): ClockSample {
  return deepFreeze({
    now: clock.now,
    asOf: clock.asOf,
    playbackSpeed: clock.playbackSpeed,
    paused: clock.paused,
    fidelity: clock.fidelity,
    informationPolicy: clock.informationPolicy,
  });
}

/** The world reward envelope projected onto the canonical record (episode binding lives in metadata). */
function rewardRecordOf(reward: RewardSignalEnvelope): RewardSignalRecord {
  return deepFreeze({
    reward_id: reward.reward_id,
    at: reward.at,
    available_time: reward.available_time,
    value: reward.value,
    metric: reward.metric,
    source: reward.source,
    detail: reward.detail,
  });
}

/** Deterministic step/causality id minting (seed + episode + ordinal). */
function mintStepId(seed: Seed, episode: EpisodeId, ordinal: number): StepId {
  return `st-${fnv1a32Hex(`${seed}|${episode}|${ordinal}`)}` as StepId;
}

function mintCausalityId(seed: Seed, episode: EpisodeId, ordinal: number): CausalityId {
  return `cz-${fnv1a32Hex(`${seed}|${episode}|${ordinal}`)}` as CausalityId;
}

/** Guard a world-returned view (defense in depth — the world validated, the driver re-checks). */
function requireView(result: EnvironmentResult<EpisodeView>): RLResult<EpisodeView> {
  if (!result.ok) return environmentFailure(result.errors);
  if (!isEpisodeView(result.value)) {
    return fail('invalid_environment', 'the environment port returned a value that does not satisfy the episode view mirror');
  }
  return ok(result.value);
}

/** Close the open step (or nothing when no step opened), consuming one budget unit. */
function closeStep(state: DriverState, clock: ClockConfig, rewards: readonly RewardSignalEnvelope[]): RLResult<DriverState> {
  const open = state.open;
  if (open === null) {
    // No step opened since the last close: nothing to record (an empty step
    // is not a step — budgets bound RECORDED experience, not no-ops).
    return ok(state);
  }
  const window = rewards.slice(open.rewards_before);
  const ordinal = state.steps.length + 1;
  const episode = state.episode as EpisodeId;
  const step: TrajectoryStep = deepFreeze({
    step: ordinal,
    step_id: mintStepId(state.seed, episode, ordinal),
    observations: [...open.observations],
    actions: [...open.actions],
    rejections: [...open.rejections],
    rewards: window.map(rewardRecordOf),
    tool_outcomes: [],
    environment_result: null,
    clock: clockSampleOf(clock),
    causality_id: mintCausalityId(state.seed, episode, ordinal),
  });
  // Total self-check: the driver only ever records canonical steps.
  const stepResult = validateTrajectoryStep(step);
  if (!stepResult.ok) return stepResult;
  return ok(
    deepFreeze({
      ...state,
      steps: [...state.steps, stepResult.value],
      open: null,
      budget: state.budget - 1,
      rewards_seen: rewards.length,
    }),
  );
}

// ---------------------------------------------------------------------------
// The five operations (pure transitions)
// ---------------------------------------------------------------------------

/**
 * START — bind an episode. Validates the spec through the mirror (defense
 * in depth: the world validates again at its own `start`), drives the port's
 * `start`, guards the returned view, and binds the driver to the episode.
 * Typed errors: `invalid_environment`, spec mirror errors (mapped),
 * `environment_error`, `driver_finished`, `duplicate_episode` (already
 * bound).
 */
export function driverStart(state: DriverState, environment: unknown, spec: unknown): RLResult<DriverState> {
  if (!isDriverState(state)) {
    return fail('invalid_type', 'driverStart requires a valid driver state');
  }
  if (!isEnvironmentPort(environment)) {
    return fail('invalid_environment', 'driverStart requires a structurally valid EnvironmentPort (five operations)');
  }
  if (state.status === 'finished') {
    return fail('driver_finished', `the driver's episode is finished (${state.termination?.code ?? 'unknown'}); create a fresh driver for the next episode`);
  }
  if (state.status === 'running') {
    return fail('duplicate_episode', `episode ${state.episode} is already bound to this driver — one driver drives one episode`);
  }
  const specResult = validateEnvironmentSpec(spec);
  if (!specResult.ok) return specResult;
  const validSpec = specResult.value;

  const started = (environment as EnvironmentPort).start(validSpec);
  if (!started.ok) return environmentFailure(started.errors);
  if (!isEpisodeView(started.value)) {
    return fail('invalid_environment', 'the environment port returned a value that does not satisfy the episode view mirror');
  }
  const view = started.value;
  return ok(
    deepFreeze({
      ...state,
      status: 'running',
      episode: view.episode_id,
      clock: view.clock,
    }),
  );
}

/**
 * OBSERVE — the point-in-time delivery query with the L4 GATE. The query
 * instant `at` may not exceed the episode's current `now`
 * (`observation_beyond_now` — the declared information boundary), and every
 * observation the port returns must satisfy the INCLUSIVE boundary
 * `available_time <= at` (`l4_boundary_violation`) — the driver never reads
 * around the envelope, and a rogue world handing future-dated observations
 * is a typed error. A world's `observe` hands the FULL visible set; the
 * driver records only FIRST-TIME deliveries (the delta discipline — legal
 * re-observation is filtered, a duplicate WITHIN one response is a world
 * bug: `duplicate_observation`). The delivered refs land in the open step
 * and in the cumulative information set.
 */
export function driverObserve(state: DriverState, environment: unknown, at: TimestampMs): RLResult<DriverState> {
  if (!isDriverState(state)) {
    return fail('invalid_type', 'driverObserve requires a valid driver state');
  }
  if (!isEnvironmentPort(environment)) {
    return fail('invalid_environment', 'driverObserve requires a structurally valid EnvironmentPort (five operations)');
  }
  if (state.status === 'idle') {
    return fail('driver_not_started', 'the driver has no episode bound — call driverStart first');
  }
  if (state.status === 'finished') {
    return fail('driver_finished', `episode ${state.episode} is finished; observations are refused (use-after-finish)`);
  }
  if (!isTimestampMs(at)) {
    return fail('invalid_timestamp', 'driverObserve requires a valid TimestampMs instant');
  }
  const clock = state.clock as ClockConfig;
  if ((at as number) > (clock.now as number)) {
    return fail(
      'observation_beyond_now',
      `cannot observe at ${at}: the episode's current now is ${clock.now} (L4 — the declared information boundary)`,
    );
  }
  if (state.open === null && state.budget === 0) {
    return fail('budget_exhausted', 'the step budget is exhausted; no new step may open — finish the episode (step_limit)');
  }

  const observed = (environment as EnvironmentPort).observe(state.episode as EpisodeId, at);
  if (!observed.ok) return environmentFailure(observed.errors);

  // The DELTA discipline (the environment-runner precedent): a world's
  // `observe` hands the FULL visible set at `at`; the driver records only
  // FIRST-TIME deliveries — re-observation is legal (the runner re-observes
  // every step), a duplicate WITHIN one response is a world bug.
  const seen = new Set<string>((state.delivered as readonly ObservationView[]).map((observation) => observation.observation_id));
  const deliveredThisCall = new Set<string>();
  const delta: ObservationRef[] = [];
  for (const observation of observed.value) {
    if (!isObservationView(observation)) {
      return fail('invalid_environment', 'the environment port returned a value that does not satisfy the observation view mirror');
    }
    // THE L4 GATE (inclusive boundary — trip-wired by the rogue-environment test).
    if ((observation.available_time as number) > (at as number)) {
      return fail(
        'l4_boundary_violation',
        `observation ${observation.observation_id} claims available_time ${observation.available_time}, after the query instant ${at} — the inclusive point-in-time boundary is law (L4)`,
      );
    }
    if (deliveredThisCall.has(observation.observation_id)) {
      return fail(
        'duplicate_observation',
        `observation id "${observation.observation_id}" appears twice in one observe response of episode ${state.episode}`,
      );
    }
    deliveredThisCall.add(observation.observation_id);
    if (seen.has(observation.observation_id)) continue;
    seen.add(observation.observation_id);
    delta.push(deepFreeze({ observation_id: observation.observation_id, available_time: observation.available_time }));
  }

  const open: PendingStep =
    state.open === null
      ? deepFreeze({ observations: [], actions: [], rejections: [], rewards_before: state.rewards_seen })
      : state.open;
  return ok(
    deepFreeze({
      ...state,
      open: deepFreeze({ ...open, observations: [...open.observations, ...delta] }),
      delivered: [...state.delivered, ...delta],
    }),
  );
}

/**
 * ACT — submit action REQUESTS (intent, never authority — L8). Each proposal
 * is minted into a deterministic action envelope (id from the episode id and
 * the monotonic mint counter, `submitted_at` = the episode's current `now`,
 * `client_sequence` = the actor's last accepted + 1, `payload = {kind,
 * body}`) and submitted through the port. ACCEPTED requests land in the open
 * step's action log; REJECTED requests land in its rejection log with the
 * world's typed errors — the full request history is experience, and a
 * rejection never aborts the drive.
 */
export function driverAct(state: DriverState, environment: unknown, proposals: readonly unknown[]): RLResult<DriverState> {
  if (!isDriverState(state)) {
    return fail('invalid_type', 'driverAct requires a valid driver state');
  }
  if (!isEnvironmentPort(environment)) {
    return fail('invalid_environment', 'driverAct requires a structurally valid EnvironmentPort (five operations)');
  }
  if (state.status === 'idle') {
    return fail('driver_not_started', 'the driver has no episode bound — call driverStart first');
  }
  if (state.status === 'finished') {
    return fail('driver_finished', `episode ${state.episode} is finished; actions are refused (use-after-finish)`);
  }
  if (state.open === null && state.budget === 0) {
    return fail('budget_exhausted', 'the step budget is exhausted; no new step may open — finish the episode (step_limit)');
  }
  if (!Array.isArray(proposals)) {
    return fail('invalid_type', 'driverAct requires an array of policy proposals');
  }

  const open: PendingStep =
    state.open === null
      ? deepFreeze({ observations: [], actions: [], rejections: [], rewards_before: state.rewards_seen })
      : state.open;
  let actions = [...open.actions];
  let rejections = [...open.rejections];
  let minted = state.minted;
  let lastSequence = state.last_sequence;
  let clock = state.clock as ClockConfig;
  let rewardsSeen = state.rewards_seen;

  for (const proposal of proposals) {
    if (!isPolicyProposal(proposal)) {
      return fail('invalid_policy', 'every proposal must be { kind: non-empty string, payload: JSON value }');
    }
    minted += 1;
    const clientSequence = lastSequence === null ? 0 : lastSequence + 1;
    const action: ActionRecord = deepFreeze({
      action_id: `${state.episode}-a${minted}` as ActionId,
      actor: state.actor,
      submitted_at: clock.now,
      client_sequence: clientSequence,
      payload: deepFreeze({ kind: proposal.kind, body: proposal.payload }) as JsonValue,
    });
    const submitted = (environment as EnvironmentPort).submit(state.episode as EpisodeId, action);
    if (submitted.ok) {
      if (!isEpisodeView(submitted.value)) {
        return fail('invalid_environment', 'the environment port returned a value that does not satisfy the episode view mirror');
      }
      actions.push(action);
      lastSequence = clientSequence;
      clock = submitted.value.clock;
      rewardsSeen = submitted.value.rewards.length;
    } else {
      const errors: RejectionError[] = submitted.errors.map((error) => ({
        code: error.code,
        path: error.path,
        message: error.message,
      }));
      if (errors.length === 0) {
        return fail('environment_error', 'the environment port rejected an action without errors (impossible by contract)');
      }
      rejections.push(deepFreeze({ action, errors }));
    }
  }

  return ok(
    deepFreeze({
      ...state,
      open: deepFreeze({ ...open, actions, rejections }),
      minted,
      last_sequence: lastSequence,
      clock,
      rewards_seen: rewardsSeen,
    }),
  );
}

/**
 * ADVANCE — move the episode clock and CLOSE the open step. The target must
 * be a valid instant, not before `now` (`clock_regression`) and not past
 * `asOf` (`beyond_as_of`); closing a step requires budget
 * (`budget_exhausted`). The closed step records the world rewards emitted
 * during its window and the post-advance clock sample. If the world reports
 * the episode FINISHED after the advance (a terminal world), the driver
 * ADOPTS the world's termination instead of calling `finish` on a dead
 * episode.
 */
export function driverAdvance(state: DriverState, environment: unknown, to: TimestampMs): RLResult<DriverState> {
  if (!isDriverState(state)) {
    return fail('invalid_type', 'driverAdvance requires a valid driver state');
  }
  if (!isEnvironmentPort(environment)) {
    return fail('invalid_environment', 'driverAdvance requires a structurally valid EnvironmentPort (five operations)');
  }
  if (state.status === 'idle') {
    return fail('driver_not_started', 'the driver has no episode bound — call driverStart first');
  }
  if (state.status === 'finished') {
    return fail('driver_finished', `episode ${state.episode} is finished; the clock is frozen (use-after-finish)`);
  }
  if (!isTimestampMs(to)) {
    return fail('invalid_timestamp', 'driverAdvance requires a valid TimestampMs target');
  }
  const clock = state.clock as ClockConfig;
  if ((to as number) < (clock.now as number)) {
    return fail('clock_regression', `the episode clock may not move backwards: now=${clock.now}, target=${to}`);
  }
  if ((to as number) > (clock.asOf as number)) {
    return fail('beyond_as_of', `the episode clock may not advance past asOf: asOf=${clock.asOf}, target=${to}`);
  }
  if (state.open !== null && state.budget === 0) {
    return fail('budget_exhausted', 'closing a step requires budget — finish the episode (step_limit)');
  }

  const advanced = (environment as EnvironmentPort).advance(state.episode as EpisodeId, to);
  const viewResult = requireView(advanced);
  if (!viewResult.ok) return viewResult;
  const view = viewResult.value;

  const closed = closeStep(state, view.clock, view.rewards);
  if (!closed.ok) return closed;

  if (view.status === 'finished') {
    // A terminal world: adopt its termination (calling `finish` on a dead
    // episode would fail; the driver is total over real worlds).
    return ok(
      deepFreeze({
        ...closed.value,
        status: 'finished',
        termination: view.termination as TerminationReason,
        clock: view.clock,
      }),
    );
  }
  return ok(deepFreeze({ ...closed.value, clock: view.clock }));
}

/**
 * FINISH — terminate the episode. The reason must be a valid
 * {@link TerminationReason} (a bare code is not an auditable termination);
 * the open step (if any) closes under the pre-finish clock, consuming one
 * budget unit; the world's immutable result record is captured for trial
 * evidence. Double-finish is a typed `driver_finished` error.
 */
export function driverFinish(state: DriverState, environment: unknown, reason: unknown): RLResult<DriverState> {
  if (!isDriverState(state)) {
    return fail('invalid_type', 'driverFinish requires a valid driver state');
  }
  if (!isEnvironmentPort(environment)) {
    return fail('invalid_environment', 'driverFinish requires a structurally valid EnvironmentPort (five operations)');
  }
  if (state.status === 'idle') {
    return fail('driver_not_started', 'the driver has no episode bound — call driverStart first');
  }
  if (state.status === 'finished') {
    return fail('driver_finished', `episode ${state.episode} is already finished (double-finish is a typed error)`);
  }
  if (!isTerminationReason(reason)) {
    return fail('invalid_termination', 'finish requires { code: completed|terminal|step_limit|aborted, detail: non-empty string }');
  }

  const clock = state.clock as ClockConfig;
  const finished = (environment as EnvironmentPort).finish(state.episode as EpisodeId, reason);
  if (!finished.ok) return environmentFailure(finished.errors);
  if (!isEpisodeFinishView(finished.value)) {
    return fail('invalid_environment', 'the environment port returned a value that does not satisfy the episode finish view mirror');
  }
  const product: EpisodeFinishView = finished.value;

  const closed = closeStep(state, clock, product.episode.rewards);
  if (!closed.ok) return closed;

  return ok(
    deepFreeze({
      ...closed.value,
      status: 'finished',
      termination: product.result.termination,
      clock: product.episode.clock,
      finish_result: product.result,
    }),
  );
}

/** The closed step log (the identity over the log — a driver's steps ARE its replay). */
export function driverSteps(state: DriverState): readonly TrajectoryStep[] {
  return state.steps;
}

/** The immutable episode result (null until finish) — trial-evidence input. */
export function driverFinishResult(state: DriverState): EpisodeResultView | null {
  return state.finish_result;
}

// ---------------------------------------------------------------------------
// Deterministic serialization of the step log (byte-determinism law)
// ---------------------------------------------------------------------------

/** JSON-tree projection of a step (compile-proven JSON safety, no casts). */
function stepTree(step: TrajectoryStep): JsonValue {
  const observations: JsonValue[] = step.observations.map((observation) => ({
    observation_id: observation.observation_id,
    available_time: observation.available_time,
  }));
  const actions: JsonValue[] = step.actions.map((action) => ({
    action_id: action.action_id,
    actor: action.actor,
    submitted_at: action.submitted_at,
    client_sequence: action.client_sequence,
    payload: action.payload,
  }));
  const rejections: JsonValue[] = step.rejections.map((rejection) => ({
    action: {
      action_id: rejection.action.action_id,
      actor: rejection.action.actor,
      submitted_at: rejection.action.submitted_at,
      client_sequence: rejection.action.client_sequence,
      payload: rejection.action.payload,
    },
    errors: rejection.errors.map((error) => ({ code: error.code, path: error.path, message: error.message })),
  }));
  const rewards: JsonValue[] = step.rewards.map((reward) => ({
    reward_id: reward.reward_id,
    at: reward.at,
    available_time: reward.available_time,
    value: reward.value,
    metric: reward.metric,
    source: reward.source,
    detail: reward.detail,
  }));
  return {
    step: step.step,
    step_id: step.step_id,
    observations,
    actions,
    rejections,
    rewards,
    tool_outcomes: [...step.tool_outcomes],
    environment_result: step.environment_result,
    clock: {
      now: step.clock.now,
      asOf: step.clock.asOf,
      playbackSpeed: step.clock.playbackSpeed,
      paused: step.clock.paused,
      fidelity: step.clock.fidelity,
      informationPolicy: step.clock.informationPolicy,
    },
    causality_id: step.causality_id,
  };
}

/**
 * Canonical JSON of a driver's closed step log — equal logs produce
 * identical bytes (the determinism proof compares these; the run-state
 * serializer chains them).
 */
export function serializeDriverSteps(state: DriverState): string {
  const tree: JsonValue = { seed: state.seed, episode: state.episode, steps: state.steps.map((step) => stepTree(step)) };
  return canonicalJson(tree);
}

/** The digest of one closed step (chained into the run state's step chain). */
export function stepDigest(step: TrajectoryStep): string {
  return fnv1a32Hex(canonicalJson(stepTree(step)));
}

/** The driver protocol's schema marker (versioned with the run-state serializer). */
export const DRIVER_PROTOCOL = 'tradrl/rl-protocol/episode-driver@1' as const;
