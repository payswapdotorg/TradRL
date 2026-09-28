/**
 * The StubEnvironment in isolation — the template semantics T009/T010
 * implementers rely on: seeded determinism, action results as derived
 * observations with latency, derived mean features, reward signalling, and
 * the unknown-episode path on every operation.
 */

import { describe, expect, it } from 'vitest';

import { createStubEnvironment, seededDraw, STUB_RESULT_LATENCY_MS } from './index';
import {
  isDerivedObservation,
  isEnvironment,
  isObservation,
  isRewardSignal,
  requireTimestampMs,
  validateEnvironmentSpec,
  type Action,
  type ActionId,
  type AgentInstanceId,
  type EpisodeId,
  type EnvironmentSpec,
} from '../../../packages/environment-protocol/src/index';

const agent = (id: string): AgentInstanceId => id as AgentInstanceId;

function specInput(seed = 'seed-alpha-1'): Record<string, unknown> {
  return {
    profile: {
      environment_id: 'env-stub-1',
      fidelity: 'generative',
      clock: {
        now: requireTimestampMs(1_000),
        asOf: requireTimestampMs(4_000),
        playbackSpeed: 1,
        paused: false,
        fidelity: 'generative',
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

function action(episodeId: string, sequence: number, at: number): Action {
  return {
    action_id: `${episodeId}-a${sequence + 1}` as ActionId,
    actor: agent('agent-main'),
    submitted_at: requireTimestampMs(at),
    client_sequence: sequence,
    payload: { kind: 'probe', body: { n: sequence } },
  };
}

describe('the stub environment (template semantics)', () => {
  it('satisfies the Environment contract guard', () => {
    expect(isEnvironment(createStubEnvironment())).toBe(true);
  });

  it('generates the same seeded stream for the same spec on fresh instances', () => {
    function streamOf(): string {
      const environment = createStubEnvironment();
      const started = environment.start(spec());
      if (!started.ok) throw new Error('must start');
      const id = started.value.episode_id;
      const collected: string[] = [];
      let lastNow = 1_000;
      for (let tick = 1; tick <= 3; tick++) {
        const advanced = environment.advance(id, requireTimestampMs(1_000 + tick * 1_000));
        if (!advanced.ok) throw new Error('must advance');
        const visible = environment.observe(id, requireTimestampMs(1_000 + tick * 1_000));
        if (!visible.ok) throw new Error('must observe');
        collected.push(...visible.value.map((observation) => `${observation.observation_id}:${JSON.stringify(observation.payload)}`));
        lastNow = 1_000 + tick * 1_000;
      }
      return `${collected.join('|')}|now=${lastNow}`;
    }
    expect(streamOf()).toBe(streamOf());
  });

  it('different seeds generate different streams', () => {
    function firstTickValue(seed: string): number {
      const environment = createStubEnvironment();
      const started = environment.start(spec(seed));
      if (!started.ok) throw new Error('must start');
      const advanced = environment.advance(started.value.episode_id, requireTimestampMs(2_000));
      if (!advanced.ok) throw new Error('must advance');
      const visible = environment.observe(started.value.episode_id, requireTimestampMs(2_000));
      if (!visible.ok) throw new Error('must observe');
      const tick = visible.value.find((observation) => observation.observation_id === 'tick-1');
      if (!tick) throw new Error('tick-1 must be visible');
      return (tick.payload as { readonly value: number }).value;
    }
    expect(firstTickValue('seed-alpha-1')).not.toBe(firstTickValue('seed-beta-2'));
    // And the value is exactly the seeded draw for (seed, episode, index).
    const episodeId = (() => {
      const environment = createStubEnvironment();
      const started = environment.start(spec('seed-alpha-1'));
      if (!started.ok) throw new Error('must start');
      return started.value.episode_id;
    })();
    const expected = Math.round(seededDraw(`seed-alpha-1`, `${episodeId}:tick`, 1) * 1e6) / 1e6;
    expect(firstTickValue('seed-alpha-1')).toBe(expected);
  });

  it('the first tick is available exactly at the advanced-to instant (inclusive)', () => {
    const environment = createStubEnvironment();
    const started = environment.start(spec());
    if (!started.ok) throw new Error('must start');
    const id = started.value.episode_id;
    const advanced = environment.advance(id, requireTimestampMs(2_000));
    if (!advanced.ok) throw new Error('must advance');
    // Before 2000: withheld (the clock is at 2000, so query below now works).
    expect(environment.observe(id, requireTimestampMs(1_999)).ok).toBe(true);
    const before = environment.observe(id, requireTimestampMs(1_999));
    if (before.ok) expect(before.value.map((observation) => observation.observation_id)).toEqual([]);
    const at = environment.observe(id, requireTimestampMs(2_000));
    if (at.ok) expect(at.value.map((observation) => observation.observation_id)).toEqual(['tick-1']);
  });

  it('emits a DERIVED mean observation on every second tick, one ms later than its inputs', () => {
    const environment = createStubEnvironment();
    const started = environment.start(spec());
    if (!started.ok) throw new Error('must start');
    const id = started.value.episode_id;
    for (const to of [2_000, 3_000]) {
      const advanced = environment.advance(id, requireTimestampMs(to));
      if (!advanced.ok) throw new Error('must advance');
    }
    // At 3000 the mean (available 3001) is still withheld...
    const at3k = environment.observe(id, requireTimestampMs(3_000));
    if (at3k.ok) expect(at3k.value.map((observation) => observation.observation_id)).not.toContain('mean-2');
    // ...and visible exactly at 3001 (needs one more legal advance first).
    const advanced = environment.advance(id, requireTimestampMs(3_001));
    if (!advanced.ok) throw new Error('must advance');
    const at3001 = environment.observe(id, requireTimestampMs(3_001));
    if (at3001.ok) {
      const mean = at3001.value.find((observation) => observation.observation_id === 'mean-2');
      expect(mean).toBeDefined();
      if (mean) {
        expect(isDerivedObservation(mean)).toBe(true);
        expect(mean.provenance.derived_from).toEqual(['tick-1', 'tick-2']);
        expect(mean.available_time).toBe(3_001);
      }
    }
  });

  it('turns accepted actions into RESULT observations (derived, latency-shifted)', () => {
    const environment = createStubEnvironment();
    const started = environment.start(spec());
    if (!started.ok) throw new Error('must start');
    const id = started.value.episode_id;
    const request = action(id, 0, 1_000);
    const submitted = environment.submit(id, request);
    expect(submitted.ok).toBe(true);

    // The result is derived from the action id and lags by the stub latency.
    const advanced = environment.advance(id, requireTimestampMs(2_000));
    if (!advanced.ok) throw new Error('must advance');
    const visible = environment.observe(id, requireTimestampMs(2_000));
    if (!visible.ok) throw new Error('must observe');
    const result = visible.value.find((observation) => observation.observation_id === `${request.action_id}:result`);
    expect(result).toBeDefined();
    if (result) {
      expect(isObservation(result)).toBe(true);
      expect(isDerivedObservation(result)).toBe(true);
      expect((result.available_time as number)).toBe(1_000 + STUB_RESULT_LATENCY_MS);
      expect(result.payload).toEqual({ accepted: true, kind: 'probe' });
      expect(result.provenance.derived_from).toEqual([request.action_id]);
    }
  });

  it('rejects a stale action sequence through the protocol rules', () => {
    const environment = createStubEnvironment();
    const started = environment.start(spec());
    if (!started.ok) throw new Error('must start');
    const id = started.value.episode_id;
    expect(environment.submit(id, action(id, 0, 1_000)).ok).toBe(true);
    const stale = environment.submit(id, action(id, 0, 1_000));
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.errors[0].code).toBe('stale_sequence');
  });

  it('emits one stub-tick reward per advance, visible immediately (available == at)', () => {
    const environment = createStubEnvironment();
    const started = environment.start(spec());
    if (!started.ok) throw new Error('must start');
    const id = started.value.episode_id;
    const advanced = environment.advance(id, requireTimestampMs(2_000));
    if (!advanced.ok) throw new Error('must advance');
    const reward = advanced.value.rewards[0];
    expect(isRewardSignal(reward)).toBe(true);
    if (reward) {
      expect(reward.metric).toBe('stub-tick');
      expect(reward.at).toBe(2_000);
      expect(reward.available_time).toBe(2_000);
      expect(reward.episode_id).toBe(id);
    }
  });

  it('every operation on an unknown episode fails with unknown_episode', () => {
    const environment = createStubEnvironment();
    const unknown = 'ep-nope' as EpisodeId;
    for (const result of [
      environment.observe(unknown, requireTimestampMs(1)),
      environment.submit(unknown, action('ep-nope', 0, 1)),
      environment.advance(unknown, requireTimestampMs(2)),
      environment.finish(unknown, { code: 'completed', detail: 'x' }),
    ]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0].code).toBe('unknown_episode');
    }
  });

  it('mediates several episodes independently (per-episode seeding)', () => {
    const environment = createStubEnvironment();
    const first = environment.start(spec('seed-alpha-1'));
    const second = environment.start(spec('seed-beta-2'));
    if (!first.ok || !second.ok) throw new Error('must start');
    const a = environment.advance(first.value.episode_id, requireTimestampMs(2_000));
    const b = environment.advance(second.value.episode_id, requireTimestampMs(2_000));
    if (!a.ok || !b.ok) throw new Error('must advance');
    expect((a.value.pending[0].payload as { readonly value: number }).value).not.toBe(
      (b.value.pending[0].payload as { readonly value: number }).value,
    );
  });
});
