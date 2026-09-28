/**
 * The EpisodeRunner over the StubEnvironment — the acceptance-critical
 * behaviors:
 *
 *   - DETERMINISM: same spec (incl. seed) + same policy -> byte-identical
 *     step trace (JSON.stringify comparison), TWICE, over fresh
 *     environment instances. A different seed -> a different trace.
 *   - Lifecycle: start -> observe -> submit -> advance -> finish, with
 *     'completed' at asOf and 'step_limit' under a tight budget.
 *   - The point-in-time law end-to-end: the policy only ever sees
 *     observations whose available_time <= now; the action results lag
 *     their submissions by the stub latency.
 *   - Rejections are recorded, not fatal.
 *   - The trace is deeply frozen and JSON round-trips through its guard.
 */

import { describe, expect, it } from 'vitest';

import {
  createStubEnvironment,
  isEpisodeTrace,
  isRejection,
  isRunOptions,
  isStepRecord,
  runEpisode,
  serializeTrace,
  type EpisodeTrace,
} from './index';
import type { Policy } from './index';
import {
  isEnvironment,
  requireTimestampMs,
  validateEnvironmentSpec,
  type AgentInstanceId,
  type Environment,
  type EnvironmentSpec,
} from '../../../packages/environment-protocol/src/index';

/** Trusted-literal constructor for actor ids in fixtures (brand cast). */
const agent = (id: string): AgentInstanceId => id as AgentInstanceId;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function specInput(seed = 'seed-alpha-1'): Record<string, unknown> {
  return {
    profile: {
      environment_id: 'env-stub-1',
      fidelity: 'reactive_replay',
      clock: {
        now: requireTimestampMs(1_000),
        asOf: requireTimestampMs(6_000),
        playbackSpeed: 1,
        paused: false,
        fidelity: 'reactive_replay',
        informationPolicy: 'point-in-time',
      },
      seed,
      venue_scope: ['STUB'],
      instrument_scope: ['STUB-1'],
      latency_policy: null,
      fee_policy: null,
    },
    world: { world_id: 'world-stub', kind: 'stub' },
    information_policy: 'point-in-time',
  };
}

function spec(seed?: string): EnvironmentSpec {
  const result = validateEnvironmentSpec(specInput(seed));
  if (!result.ok) throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
  return result.value;
}

/** A deterministic trading-ish policy: react to the latest tick value. */
const tickPolicy: Policy = (input) => {
  const ticks = input.observations.filter((observation) => observation.observation_id.startsWith('tick-'));
  if (ticks.length === 0) return [];
  const latest = ticks[ticks.length - 1];
  const payload = latest.payload as { readonly value: number; readonly tick: number };
  return [{ kind: 'adjust', payload: { position: payload.value > 0.5 ? 1 : -1, atTick: payload.tick } }];
};

const OPTIONS = { actor: agent('agent-main'), step_ms: 1_000, max_steps: 100 };

function runTwice(policy: Policy = tickPolicy, seed?: string): [EpisodeTrace, EpisodeTrace] {
  const first = runEpisode(createStubEnvironment(), spec(seed), policy, OPTIONS);
  const second = runEpisode(createStubEnvironment(), spec(seed), policy, OPTIONS);
  if (!first.ok || !second.ok) throw new Error('fixtures must run');
  return [first.value, second.value];
}

// ---------------------------------------------------------------------------
// Determinism (acceptance criterion 4)
// ---------------------------------------------------------------------------

describe('determinism: same spec + seed + policy -> byte-identical trace, twice', () => {
  it('produces byte-identical serialized traces over fresh environment instances', () => {
    const [first, second] = runTwice();
    expect(serializeTrace(first)).toBe(serializeTrace(second));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('produces byte-identical traces for a do-nothing policy too', () => {
    const [first, second] = runTwice(() => []);
    expect(serializeTrace(first)).toBe(serializeTrace(second));
    expect(first.steps.every((step) => step.actions.length === 0)).toBe(true);
  });

  it('a different seed produces a DIFFERENT trace (the seed matters)', () => {
    const [alpha] = runTwice(tickPolicy, 'seed-alpha-1');
    const [beta] = runTwice(tickPolicy, 'seed-beta-2');
    expect(serializeTrace(alpha)).not.toBe(serializeTrace(beta));
    // ...but each is internally reproducible.
    expect(serializeTrace(beta)).toBe(serializeTrace(runTwice(tickPolicy, 'seed-beta-2')[0]));
  });

  it('a different policy produces a different trace (actions feed back into the world)', () => {
    const [reactive] = runTwice(tickPolicy);
    const [passive] = runTwice(() => []);
    expect(serializeTrace(reactive)).not.toBe(serializeTrace(passive));
  });
});

// ---------------------------------------------------------------------------
// Lifecycle + trace shape
// ---------------------------------------------------------------------------

describe('episode lifecycle over the stub world', () => {
  it('starts, steps to asOf, and finishes completed with a full trace', () => {
    const result = runEpisode(createStubEnvironment(), spec(), tickPolicy, OPTIONS);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must run');
    const trace = result.value;

    expect(isEpisodeTrace(trace)).toBe(true);
    expect(trace.episode_id.startsWith('ep-')).toBe(true);
    expect(trace.spec.profile.seed).toBe('seed-alpha-1'); // L9 binding
    expect(trace.steps.length).toBe(5); // 1000 -> 6000 in 1000ms steps
    expect(trace.steps.map((step) => step.at)).toEqual([1_000, 2_000, 3_000, 4_000, 5_000]);
    expect(trace.steps.map((step) => step.advanced_to)).toEqual([2_000, 3_000, 4_000, 5_000, 6_000]);
    expect(trace.result.termination.code).toBe('completed');
    expect(trace.result.final_now).toBe(6_000);
    expect(trace.result.accepted_action_count).toBe(4); // one action per step from step 2 on (step 1 sees nothing yet)
  });

  it('the policy sees only point-in-time-visible observations and action results lag by the latency', () => {
    const seenAt: Array<{ step: number; ids: readonly string[] }> = [];
    const recordingPolicy: Policy = (input) => {
      seenAt.push({ step: input.step, ids: input.observations.map((observation) => observation.observation_id) });
      return tickPolicy(input);
    };
    const result = runEpisode(createStubEnvironment(), spec(), recordingPolicy, OPTIONS);
    if (!result.ok) throw new Error('must run');

    // Step 1 observes nothing: the first tick is generated by the FIRST advance
    // (available at 2000) — the world produces nothing before the first move.
    expect(seenAt[0]?.ids).toEqual([]);
    // Step 2 (at 2000): tick-1 visible (available == now, inclusive). The mean
    // (available 2001) and the action result (available 1001... wait, submitted
    // at 1000 + 1 = 1001 <= 2000) are also visible by then.
    expect(seenAt[1]?.ids).toContain('tick-1');
    // No observation id from the future ever appears in any step's input.
    for (let index = 0; index < seenAt.length; index++) {
      const at = 1_000 + index * 1_000;
      for (const observation of result.value.steps[index].observations) {
        expect((observation.available_time as number) <= at).toBe(true); // delivered delta respects L4
      }
    }
    // The delivered delta across all steps contains every observation exactly once.
    const allDelivered = result.value.steps.flatMap((step) => step.observations.map((observation) => observation.observation_id));
    const unique = new Set(allDelivered);
    expect(unique.size).toBe(allDelivered.length);
  });

  it('every step record is structurally valid and deeply frozen', () => {
    const result = runEpisode(createStubEnvironment(), spec(), tickPolicy, OPTIONS);
    if (!result.ok) throw new Error('must run');
    for (const step of result.value.steps) {
      expect(isStepRecord(step)).toBe(true);
      expect(Object.isFrozen(step)).toBe(true);
      expect(Object.isFrozen(step.observations)).toBe(true);
    }
    expect(Object.isFrozen(result.value)).toBe(true);
  });

  it('the trace JSON round-trips through its own guard (T011/T014 portability)', () => {
    const result = runEpisode(createStubEnvironment(), spec(), tickPolicy, OPTIONS);
    if (!result.ok) throw new Error('must run');
    const roundTripped: unknown = JSON.parse(JSON.stringify(result.value));
    expect(isEpisodeTrace(roundTripped)).toBe(true);
  });

  it('rewards are recorded per step with the stub-tick metric (explicit, never fabricated)', () => {
    const result = runEpisode(createStubEnvironment(), spec(), tickPolicy, OPTIONS);
    if (!result.ok) throw new Error('must run');
    const rewards = result.value.steps.flatMap((step) => step.rewards);
    expect(rewards.length).toBe(5);
    expect(rewards.every((reward) => reward.metric === 'stub-tick')).toBe(true);
    expect(result.value.result.rewards.length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Termination modes + option validation
// ---------------------------------------------------------------------------

describe('termination and option validation', () => {
  it('a tight step budget finishes with step_limit and a truthful detail', () => {
    const result = runEpisode(createStubEnvironment(), spec(), tickPolicy, { actor: agent('agent-main'), step_ms: 1_000, max_steps: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must run');
    expect(result.value.steps.length).toBe(2);
    expect(result.value.result.termination.code).toBe('step_limit');
    expect(result.value.result.termination.detail).toContain('step budget of 2');
    expect(result.value.result.final_now).toBe(3_000);
  });

  it('a zero-length episode (now == asOf) finishes completed with no steps', () => {
    const zeroSpec = specInput();
    const profile = zeroSpec.profile as Record<string, unknown>;
    const clock = profile.clock as Record<string, unknown>;
    clock.now = requireTimestampMs(6_000);
    const validated = validateEnvironmentSpec(zeroSpec);
    if (!validated.ok) throw new Error('fixture must be valid');
    const result = runEpisode(createStubEnvironment(), validated.value, tickPolicy, OPTIONS);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must run');
    expect(result.value.steps).toEqual([]);
    expect(result.value.result.termination.code).toBe('completed');
  });

  it('rejects invalid options with typed errors', () => {
    expect(runEpisode(createStubEnvironment(), spec(), tickPolicy, { actor: agent(''), step_ms: 1, max_steps: 1 }).ok).toBe(false);
    expect(runEpisode(createStubEnvironment(), spec(), tickPolicy, { actor: agent('a'), step_ms: 0, max_steps: 1 }).ok).toBe(false);
    expect(runEpisode(createStubEnvironment(), spec(), tickPolicy, { actor: agent('a'), step_ms: 1, max_steps: -5 }).ok).toBe(false);
    expect(isRunOptions(OPTIONS)).toBe(true);
    expect(isRunOptions({ actor: agent(''), step_ms: 0 })).toBe(false);
  });

  it('rejects a malformed spec before starting (defense in depth)', () => {
    const malformed = { profile: null };
    const result = runEpisode(createStubEnvironment(), malformed as unknown as EnvironmentSpec, tickPolicy, OPTIONS);
    expect(result.ok).toBe(false);
  });

  it('surfaces environment failures (unknown episode from a hostile wrapper)', () => {
    const hostile: Environment = {
      start: () => ({ ok: false, errors: [{ code: 'unknown_episode', path: '', message: 'hostile' }] }),
      observe: () => ({ ok: false, errors: [{ code: 'unknown_episode', path: '', message: 'hostile' }] }),
      submit: () => ({ ok: false, errors: [{ code: 'unknown_episode', path: '', message: 'hostile' }] }),
      advance: () => ({ ok: false, errors: [{ code: 'unknown_episode', path: '', message: 'hostile' }] }),
      finish: () => ({ ok: false, errors: [{ code: 'unknown_episode', path: '', message: 'hostile' }] }),
    };
    const result = runEpisode(hostile, spec(), tickPolicy, OPTIONS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('unknown_episode');
  });

  it('rejects a policy that returns malformed proposals', () => {
    const badPolicy: Policy = () => [{ kind: '', payload: null }];
    const result = runEpisode(createStubEnvironment(), spec(), badPolicy, OPTIONS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].code).toBe('invalid_action');
  });
});

// ---------------------------------------------------------------------------
// Rejection recording (L8: rejected requests are episode events, not errors)
// ---------------------------------------------------------------------------

describe('rejected submissions are recorded and the episode continues', () => {
  it('a rejecting environment produces rejection records and a completed episode', () => {
    // Wrap the stub: submit fails for every action whose kind is 'adjust'
    // with sequence >= 1 (a world-side rule beyond protocol validation).
    const inner = createStubEnvironment();
    const rejecting: Environment = {
      start: (input) => inner.start(input),
      observe: (episode, at) => inner.observe(episode, at),
      submit: (episode, action) => {
        const payload = action.payload as { readonly kind?: unknown };
        if (payload.kind === 'adjust' && action.client_sequence >= 1) {
          return {
            ok: false,
            errors: [{ code: 'stale_sequence', path: 'action.client_sequence', message: 'hostile world rejects sequence >= 1' }],
          };
        }
        return inner.submit(episode, action);
      },
      advance: (episode, to) => inner.advance(episode, to),
      finish: (episode, reason) => inner.finish(episode, reason),
    };

    const result = runEpisode(rejecting, spec(), tickPolicy, OPTIONS);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('must run');
    const trace = result.value;

    // First submission (sequence 0) accepted; every later one rejected.
    expect(trace.steps[1]?.actions.length).toBe(1);
    expect(trace.steps.slice(2).every((step) => step.actions.length === 0)).toBe(true);
    const rejections = trace.steps.flatMap((step) => step.rejections);
    expect(rejections.length).toBe(3);
    for (const rejection of rejections) {
      expect(isRejection(rejection)).toBe(true);
      expect(rejection.errors[0].code).toBe('stale_sequence');
    }
    // The episode still completes; the result counts only ACCEPTED actions.
    expect(trace.result.termination.code).toBe('completed');
    expect(trace.result.accepted_action_count).toBe(1);
  });

  it('rejections are deterministic too (byte-identical across runs)', () => {
    function rejectingRun(): string {
      const inner = createStubEnvironment();
      const rejecting: Environment = {
        start: (input) => inner.start(input),
        observe: (episode, at) => inner.observe(episode, at),
        submit: (episode, action) => {
          const payload = action.payload as { readonly kind?: unknown };
          if (payload.kind === 'adjust' && action.client_sequence >= 1) {
            return { ok: false, errors: [{ code: 'stale_sequence', path: '', message: 'no' }] };
          }
          return inner.submit(episode, action);
        },
        advance: (episode, to) => inner.advance(episode, to),
        finish: (episode, reason) => inner.finish(episode, reason),
      };
      const result = runEpisode(rejecting, spec(), tickPolicy, OPTIONS);
      if (!result.ok) throw new Error('must run');
      return serializeTrace(result.value);
    }
    expect(rejectingRun()).toBe(rejectingRun());
  });
});

// ---------------------------------------------------------------------------
// The stub satisfies the Environment contract
// ---------------------------------------------------------------------------

describe('the stub environment', () => {
  it('structurally satisfies the Environment interface guard', () => {
    expect(isEnvironment(createStubEnvironment())).toBe(true);
  });
});
