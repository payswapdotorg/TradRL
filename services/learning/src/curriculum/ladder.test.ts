/**
 * @tradrl/learning (service) — the curriculum ladder tests (T015).
 *
 * Behavioral law coverage:
 *   - the ladder is the CLOSED nine-stage union of spec/LEARNING-LOOP.md,
 *     VERBATIM and IN ORDER (acceptance #4);
 *   - an unknown stage string fails its guard (the closed-union negative
 *     test — `stage_unknown`, never a silent default);
 *   - the ORDER law: positions, one-rung advance targets, the top rung's
 *     null target;
 *   - the stage-9 gate predicate (controlled_live is live-gated, nothing
 *     else is);
 *   - the L6 fidelity-claim table: the honest modes per stage, and the
 *     typed `fidelity_claim_violation` for the work order's named
 *     negative (historical truth claimed from a generative world) plus
 *     the reactive-market claim;
 *   - determinism of the frozen table (deep-equal across reads).
 */

import { describe, expect, it } from 'vitest';

import {
  CURRICULUM_STAGES,
  ENTRY_STAGE,
  REQUIRED_WORLD_MODES,
  advanceTarget,
  checkFidelityHonesty,
  coerceStageKind,
  isCurriculumStageKind,
  isLiveGatedStage,
  isWorldMode,
  stagePosition,
} from './ladder';

describe('the frozen nine-stage union (spec/LEARNING-LOOP.md, verbatim)', () => {
  it('is the nine stages in ladder order', () => {
    expect([...CURRICULUM_STAGES]).toEqual([
      'synthetic_regimes',
      'historical_replay',
      'microstructure_friction',
      'reactive_market',
      'adversarial_population',
      'unseen_multi_regime',
      'rolling_time_machine',
      'shadow_trading',
      'controlled_live',
    ]);
    expect(CURRICULUM_STAGES.length).toBe(9);
  });

  it('positions stages 0..8 in order and enters at the bottom', () => {
    CURRICULUM_STAGES.forEach((stage, index) => {
      expect(stagePosition(stage)).toBe(index);
    });
    expect(ENTRY_STAGE).toBe('synthetic_regimes');
    expect(stagePosition(ENTRY_STAGE)).toBe(0);
  });

  it('advances exactly one rung at a time and stops at the top', () => {
    expect(advanceTarget('synthetic_regimes')).toBe('historical_replay');
    expect(advanceTarget('microstructure_friction')).toBe('reactive_market');
    expect(advanceTarget('shadow_trading')).toBe('controlled_live');
    expect(advanceTarget('controlled_live')).toBeNull();
  });

  it('accepts every ladder member and refuses everything else (the closed union)', () => {
    for (const stage of CURRICULUM_STAGES) {
      expect(isCurriculumStageKind(stage)).toBe(true);
      expect(coerceStageKind(stage)).toEqual({ ok: true, value: stage });
    }
    const negatives: unknown[] = [
      'simple_synthetic_regimes', // the spec's prose name, not the union's id
      'historical', // truncated
      'controlled-live', // hyphenated
      'live', // colloquial
      'adversarial-population',
      '',
      null,
      5,
      { stage: 'shadow_trading' },
      undefined,
    ];
    for (const value of negatives) {
      expect(isCurriculumStageKind(value)).toBe(false);
      const coerced = coerceStageKind(value);
      expect(coerced.ok).toBe(false);
      if (!coerced.ok) {
        expect(coerced.errors[0]?.code).toBe('stage_unknown');
      }
    }
  });
});

describe('the stage-9 gate (live execution is permitted-only, never default)', () => {
  it('gates exactly controlled_live', () => {
    expect(isLiveGatedStage('controlled_live')).toBe(true);
    for (const stage of CURRICULUM_STAGES) {
      if (stage === 'controlled_live') continue;
      expect(isLiveGatedStage(stage)).toBe(false);
    }
  });
});

describe('the L6 fidelity-claim table', () => {
  it('declares the honest world modes per stage', () => {
    expect(REQUIRED_WORLD_MODES.synthetic_regimes).toEqual(['generative']);
    expect(REQUIRED_WORLD_MODES.historical_replay).toEqual(['exact_replay']);
    expect(REQUIRED_WORLD_MODES.reactive_market).toEqual(['reactive_replay']);
    expect(REQUIRED_WORLD_MODES.adversarial_population).toEqual(['reactive_replay']);
    expect(REQUIRED_WORLD_MODES.rolling_time_machine).toEqual(['exact_replay']);
    expect(REQUIRED_WORLD_MODES.shadow_trading).toEqual(['exact_replay']);
    expect(REQUIRED_WORLD_MODES.controlled_live).toEqual(['exact_replay']);
    // The two any-mode stages accept all three, honestly declared.
    expect(REQUIRED_WORLD_MODES.microstructure_friction).toEqual(['exact_replay', 'reactive_replay', 'generative']);
    expect(REQUIRED_WORLD_MODES.unseen_multi_regime).toEqual(['exact_replay', 'reactive_replay', 'generative']);
  });

  it('accepts the world-mode vocabulary and refuses everything else', () => {
    expect(isWorldMode('exact_replay')).toBe(true);
    expect(isWorldMode('reactive_replay')).toBe(true);
    expect(isWorldMode('generative')).toBe(true);
    expect(isWorldMode('replay')).toBe(false);
    expect(isWorldMode('synthetic')).toBe(false);
    expect(isWorldMode(null)).toBe(false);
  });

  it('refuses a stage claiming historical truth from a generative world (the named negative)', () => {
    // L6: "Synthetic worlds are stress/exploration instruments, not
    // historical truth" — historical_replay + generative is the work
    // order's named typed error.
    const result = checkFidelityHonesty('historical_replay', 'generative', 'stages.historical_replay.config.world_mode');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('fidelity_claim_violation');
      expect(result.errors[0]?.path).toBe('stages.historical_replay.config.world_mode');
      expect(result.errors[0]?.message).toContain('historical_replay');
    }
    // The reactive claim behind a replaying stage is equally dishonest.
    const reactive = checkFidelityHonesty('rolling_time_machine', 'reactive_replay', 'world_mode');
    expect(reactive.ok).toBe(false);
    if (!reactive.ok) {
      expect(reactive.errors[0]?.code).toBe('fidelity_claim_violation');
    }
    // And the reactive market cannot be a tape.
    const tape = checkFidelityHonesty('reactive_market', 'exact_replay', 'world_mode');
    expect(tape.ok).toBe(false);
    if (!tape.ok) {
      expect(tape.errors[0]?.code).toBe('fidelity_claim_violation');
    }
    // The stage-5 adversaries are endogenous participants, not tape and
    // not synthetic noise.
    expect(checkFidelityHonesty('adversarial_population', 'exact_replay', 'w').ok).toBe(false);
    expect(checkFidelityHonesty('adversarial_population', 'generative', 'w').ok).toBe(false);
    expect(checkFidelityHonesty('adversarial_population', 'reactive_replay', 'w').ok).toBe(true);
  });

  it('accepts the honest declarations (including both any-mode stages)', () => {
    expect(checkFidelityHonesty('synthetic_regimes', 'generative', 'w')).toEqual({ ok: true, value: true });
    expect(checkFidelityHonesty('historical_replay', 'exact_replay', 'w')).toEqual({ ok: true, value: true });
    expect(checkFidelityHonesty('microstructure_friction', 'generative', 'w')).toEqual({ ok: true, value: true });
    expect(checkFidelityHonesty('unseen_multi_regime', 'exact_replay', 'w')).toEqual({ ok: true, value: true });
    expect(checkFidelityHonesty('shadow_trading', 'exact_replay', 'w')).toEqual({ ok: true, value: true });
    expect(checkFidelityHonesty('controlled_live', 'exact_replay', 'w')).toEqual({ ok: true, value: true });
  });

  it('is frozen data (deep-equal across reads, immutable at runtime)', () => {
    expect(Object.isFrozen(CURRICULUM_STAGES)).toBe(true);
    expect(Object.isFrozen(REQUIRED_WORLD_MODES.synthetic_regimes)).toBe(true);
    expect(() => {
      (CURRICULUM_STAGES as unknown as string[]).push('tenth_stage' as never);
    }).toThrow();
  });
});
