/**
 * Run-state serialization tests: canonical bytes (determinism), the resume
 * gate (schema + structural guard + CHAIN VERIFICATION), tamper detection,
 * and resume-then-continue — a resumed run provably consumed the same
 * experience and appends onto the verified log identically to a
 * straight-through run.
 */

import { describe, expect, it } from 'vitest';

import * as rl from '../../../../packages/rl-protocol/src/index';
import { resumeTrainingRunState, serializeTrainingRunState, TRAINING_RUN_STATE_SCHEMA } from './run-state';
import { createReferenceTrainer } from './trainer';
import { createScriptedEnvironment, scriptedWorldOptions } from './fixtures';
import { createScriptedPolicy } from './policy';

const T0 = 1_700_000_000_000;
const AS_OF = T0 + 3_000;

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: unknown }): T {
  if (result.ok) return result.value;
  throw new Error(`unexpected failure: ${JSON.stringify(result.errors)}`);
}

function trainerOptions(): Record<string, unknown> {
  return {
    actor: 'agent-resume-test',
    step_ms: 400,
    runtime: '@tradrl/learning/reference-trainer@1',
    body_versions: ['body-resume@1'],
    substrates: ['substrate-resume@1'],
  };
}

function declarationLiteral(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    run_id: 'run-resume-test',
    method: 'rl',
    environment_spec: {
      profile: {
        environment_id: 'env-resume-test',
        fidelity: 'exact_replay',
        clock: { now: T0, asOf: AS_OF, playbackSpeed: 1, paused: false, fidelity: 'exact_replay', informationPolicy: 'point-in-time' },
        seed: 'seed-resume-test',
        venue_scope: [],
        instrument_scope: [],
        latency_policy: null,
        fee_policy: null,
      },
      world: { world_id: 'world-scripted', kind: 'scripted' },
      information_policy: 'point-in-time',
    },
    reward_models: [],
    step_budget: 10,
    seed: 'seed-resume-test',
    tenant: 'tenant-resume-test',
    project: 'prj-resume-test',
    ...overrides,
  };
}

function driveOneEpisode(runId: string, worldSeed: string): rl.TrainingRunState {
  const trainer = unwrap(createReferenceTrainer(trainerOptions()));
  const world = createScriptedEnvironment(scriptedWorldOptions({ seed: worldSeed, baseTime: T0, asOf: AS_OF, stepMs: 100, ticks: 8 }));
  const policy = createScriptedPolicy('policy-resume');
  let run = unwrap(trainer.prepareRun(declarationLiteral({ run_id: runId })));
  run = unwrap(trainer.driveEpisode(run, world, policy));
  return run;
}

describe('serializeTrainingRunState / resumeTrainingRunState', () => {
  it('serializes to canonical bytes: equal states, identical bytes, twice', () => {
    const first = unwrap(serializeTrainingRunState(driveOneEpisode('run-det', 'world-det')));
    const second = unwrap(serializeTrainingRunState(driveOneEpisode('run-det', 'world-det')));
    expect(first).toBe(second);
    expect(first).toContain(TRAINING_RUN_STATE_SCHEMA);
  });

  it('round-trips: resume returns the deeply frozen, chain-verified state', () => {
    const run = driveOneEpisode('run-rt', 'world-rt');
    const bytes = unwrap(serializeTrainingRunState(run));
    const resumed = unwrap(resumeTrainingRunState(bytes));
    // Byte-stability across the round-trip (canonical JSON: equal records,
    // same bytes — regardless of the key order the parse produced).
    expect(unwrap(serializeTrainingRunState(resumed))).toBe(bytes);
    const parsedEnvelope = JSON.parse(bytes) as { readonly run: unknown };
    expect(JSON.parse(JSON.stringify(resumed))).toEqual(parsedEnvelope.run);
    expect(rl.isDeeplyFrozen(resumed)).toBe(true);
    expect(unwrap(rl.verifyRunChain(resumed))).toBe(true);
    expect(() => {
      (resumed as unknown as { steps_used: number }).steps_used = 99;
    }).toThrow();
  });

  it('typed failures: bad JSON, wrong schema, structurally invalid state', () => {
    const badJson = resumeTrainingRunState('{not json');
    expect(badJson.ok).toBe(false);
    if (!badJson.ok) expect(badJson.errors[0]?.code).toBe('invalid_json');

    const wrongSchema = resumeTrainingRunState(JSON.stringify({ schema: 'tradrl/other@1', run: {} }));
    expect(wrongSchema.ok).toBe(false);
    if (!wrongSchema.ok) expect(wrongSchema.errors[0]?.code).toBe('invalid_serialization');

    const invalidState = resumeTrainingRunState(JSON.stringify({ schema: TRAINING_RUN_STATE_SCHEMA, run: { nope: true } }));
    expect(invalidState.ok).toBe(false);
    if (!invalidState.ok) expect(invalidState.errors[0]?.code).toBe('invalid_serialization');

    const notAnObject = resumeTrainingRunState('42');
    expect(notAnObject.ok).toBe(false);
  });

  it('THE TAMPER GATE: rewritten step content fails chain_mismatch, never silently', () => {
    const run = driveOneEpisode('run-tamper', 'world-tamper');
    const parsed = JSON.parse(JSON.stringify(run)) as { episodes: { steps: { actions: Record<string, unknown>[] }[] }[] };
    const original = parsed.episodes[0]?.steps[0]?.actions[0] as Record<string, unknown> | undefined;
    parsed.episodes[0]?.steps[0]?.actions.push({ ...original, action_id: 'act-tamper', payload: 'rewritten' });
    const tamperedBytes = JSON.stringify({ schema: TRAINING_RUN_STATE_SCHEMA, run: parsed });
    const tampered = resumeTrainingRunState(tamperedBytes);
    expect(tampered.ok).toBe(false);
    if (!tampered.ok) {
      expect(tampered.errors[0]?.code).toBe('chain_mismatch');
      expect(tampered.errors[0]?.message).toContain('tampered');
    }
  });

  it('resume-then-continue: the resumed run appends identically to a straight-through run', () => {
    const trainer = unwrap(createReferenceTrainer(trainerOptions()));
    const policy = createScriptedPolicy('policy-continue');

    // Straight-through: drive two episodes.
    const straightWorldA = createScriptedEnvironment(scriptedWorldOptions({ seed: 'world-continue-a', baseTime: T0, asOf: AS_OF, stepMs: 100, ticks: 8 }));
    const straightWorldB = createScriptedEnvironment(scriptedWorldOptions({ seed: 'world-continue-b', baseTime: T0, asOf: AS_OF, stepMs: 100, ticks: 8 }));
    let straight = unwrap(trainer.prepareRun(declarationLiteral({ run_id: 'run-continue' })));
    straight = unwrap(trainer.driveEpisode(straight, straightWorldA, policy));
    straight = unwrap(trainer.driveEpisode(straight, straightWorldB, policy));

    // Resumed: drive episode one, serialize, resume from bytes, drive episode two.
    const worldA = createScriptedEnvironment(scriptedWorldOptions({ seed: 'world-continue-a', baseTime: T0, asOf: AS_OF, stepMs: 100, ticks: 8 }));
    let run = unwrap(trainer.prepareRun(declarationLiteral({ run_id: 'run-continue' })));
    run = unwrap(trainer.driveEpisode(run, worldA, policy));
    const bytes = unwrap(serializeTrainingRunState(run));
    const resumed = unwrap(resumeTrainingRunState(bytes));
    const worldB = createScriptedEnvironment(scriptedWorldOptions({ seed: 'world-continue-b', baseTime: T0, asOf: AS_OF, stepMs: 100, ticks: 8 }));
    const continued = unwrap(trainer.driveEpisode(resumed, worldB, policy));

    // Identical logs (canonical bytes — key order is irrelevant, content is
    // the identity): the resume artifact provably carried the same experience.
    expect(continued.step_chain).toEqual(straight.step_chain);
    expect(continued.steps_used).toBe(straight.steps_used);
    expect(continued.episodes.length).toBe(straight.episodes.length);
    expect(unwrap(rl.verifyRunChain(continued))).toBe(true);
    expect(JSON.parse(JSON.stringify(continued.episodes))).toEqual(JSON.parse(JSON.stringify(straight.episodes)));

    // And the serialized resumed+continued state equals the straight-through bytes.
    expect(unwrap(serializeTrainingRunState(continued))).toBe(unwrap(serializeTrainingRunState(straight)));
  });
});
