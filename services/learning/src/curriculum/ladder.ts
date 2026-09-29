/**
 * @tradrl/learning (service) — the curriculum ladder (T015).
 *
 * THE LAW THIS MODULE EMBODIES: spec/LEARNING-LOOP.md, "Curriculum", IS
 * THIS UNION, VERBATIM AND IN ORDER:
 *
 *   1. Simple synthetic regimes           -> 'synthetic_regimes'
 *   2. Historical replay                  -> 'historical_replay'
 *   3. Microstructure and friction        -> 'microstructure_friction'
 *   4. Reactive market                    -> 'reactive_market'
 *   5. Adversarial population             -> 'adversarial_population'
 *   6. Unseen multi-regime tests          -> 'unseen_multi_regime'
 *   7. Rolling Time Machine               -> 'rolling_time_machine'
 *   8. Shadow trading                     -> 'shadow_trading'
 *   9. Controlled live execution when permitted -> 'controlled_live'
 *
 * The ladder is CLOSED and ORDERED (Work Order T015, ladder law):
 *   - CLOSED: `CurriculumStageKind` is a frozen discriminated union; a
 *     stage string outside the nine is a typed `stage_unknown` failure
 *     (negative-tested) — never a silent default.
 *   - ORDERED: `stagePosition` / `advanceTarget` are the ONLY move
 *     arithmetic. Advancing climbs EXACTLY one rung (`ladder_violation`
 *     otherwise); regressing falls to any EARLIER rung (regression is
 *     legal and recorded — the trail lane's law, L11).
 *   - STAGE 9 IS GATED: `controlled_live` is permitted-only, never
 *     default. `isLiveGatedStage` names it; the plan and trail lanes
 *     enforce the `live_permission_missing` typed error.
 *
 * L6 FIDELITY HONESTY (spec/ARCHITECTURE.md "Market World": "Synthetic
 * worlds are stress/exploration instruments, not historical truth";
 * ARCHITECTURE-LOCK L5/L6: replay, reactive and generative modes are
 * distinct): every stage descriptor declares its world mode, and the
 * stage's NAME is a fidelity CLAIM the declaration must not contradict —
 * `requiredWorldModes` is the frozen claim table:
 *   - `synthetic_regimes` REQUIRES 'generative' (synthetic by name);
 *   - `historical_replay` and `rolling_time_machine` REQUIRE 'exact_replay'
 *     (they claim HISTORICAL TRUTH — a generative or reactive world behind
 *     them is the work order's named typed error, `fidelity_claim_violation`);
 *   - `reactive_market` and `adversarial_population` REQUIRE
 *     'reactive_replay' (their defining participants are endogenous —
 *     ARCHITECTURE.md: "reactive replay with endogenous participants";
 *     L10's adversaries are participants, not tape);
 *   - `shadow_trading` and `controlled_live` REQUIRE 'exact_replay' (the
 *     live tape observed exactly — nothing is modeled; the claim is that
 *     the world is the market itself, stage 8 shadowing it, stage 9
 *     executing in it under the permission record);
 *   - `microstructure_friction` and `unseen_multi_regime` accept any of
 *     the three modes (friction stress and blind testing are legitimate
 *     over replay, reactive or generative worlds — the descriptor declares
 *     which, honestly).
 *
 * Determinism: the table is frozen data; every function is pure.
 */

import { type CurriculumResult, deepFreeze, fail, isMemberOf } from './primitives';

// ---------------------------------------------------------------------------
// The frozen nine-stage union (LEARNING-LOOP.md, verbatim order)
// ---------------------------------------------------------------------------

/**
 * The closed curriculum-stage union — the nine rungs of
 * spec/LEARNING-LOOP.md's "Curriculum" ladder, in order. Adding a rung is
 * an explicit ladder change, never a string typo.
 */
export type CurriculumStageKind =
  | 'synthetic_regimes'
  | 'historical_replay'
  | 'microstructure_friction'
  | 'reactive_market'
  | 'adversarial_population'
  | 'unseen_multi_regime'
  | 'rolling_time_machine'
  | 'shadow_trading'
  | 'controlled_live';

/**
 * The nine stages IN LADDER ORDER (position 0 .. 8). The array order IS the
 * ladder order — the frozen program-wide schedule of the learning loop.
 */
export const CURRICULUM_STAGES: readonly CurriculumStageKind[] = deepFreeze([
  'synthetic_regimes',
  'historical_replay',
  'microstructure_friction',
  'reactive_market',
  'adversarial_population',
  'unseen_multi_regime',
  'rolling_time_machine',
  'shadow_trading',
  'controlled_live',
] as const);

/** Guard: `CurriculumStageKind` — everything outside the closed union is `stage_unknown` (never a default). */
export function isCurriculumStageKind(v: unknown): v is CurriculumStageKind {
  return isMemberOf(CURRICULUM_STAGES, v);
}

/**
 * The L6 world-mode vocabulary — STRUCTURAL MIRROR of @tradrl/rl-protocol's
 * `FidelityMode` (T013), itself the mirror of the environment lane's
 * fidelity modes (ARCHITECTURE-LOCK L5: "replay, reactive replay and
 * counterfactual/generative simulation are distinct"). The interop
 * trip-wire test asserts the union parity.
 */
export type WorldMode = 'exact_replay' | 'reactive_replay' | 'generative';

/** Runtime-checkable list of world modes (mirror of the environment lane's fidelity modes). */
export const WORLD_MODES: readonly WorldMode[] = deepFreeze(['exact_replay', 'reactive_replay', 'generative'] as const);

/** Guard: `WorldMode`. */
export function isWorldMode(v: unknown): v is WorldMode {
  return isMemberOf(WORLD_MODES, v);
}

// ---------------------------------------------------------------------------
// Ladder arithmetic (the ORDER law's only move operations)
// ---------------------------------------------------------------------------

/**
 * The zero-based ladder position of `stage` (0 = simple synthetic regimes,
 * 8 = controlled live). The position is the ORDER law's arithmetic — plans
 * ascend positions one at a time, regressions fall strictly.
 */
export function stagePosition(stage: CurriculumStageKind): number {
  return CURRICULUM_STAGES.indexOf(stage);
}

/** The first rung of every climb — the ladder is climbed from the bottom. */
export const ENTRY_STAGE: CurriculumStageKind = 'synthetic_regimes';

/**
 * The stage ONE RUNG above `stage`, or `null` at the top of the ladder.
 * Advancing more than one rung at a time is a `ladder_violation` — the
 * ladder is ordered, and a curriculum that skips rungs has not passed them.
 */
export function advanceTarget(stage: CurriculumStageKind): CurriculumStageKind | null {
  const position = stagePosition(stage);
  if (position >= CURRICULUM_STAGES.length - 1) return null;
  return CURRICULUM_STAGES[position + 1] as CurriculumStageKind;
}

/**
 * Guarded coercion of an untrusted stage string: everything outside the
 * frozen union fails with the typed `stage_unknown` (the closed-union law —
 * the negative test's error).
 */
export function coerceStageKind(v: unknown, path = 'stage'): CurriculumResult<CurriculumStageKind> {
  if (!isCurriculumStageKind(v)) {
    return fail(
      'stage_unknown',
      `value ${JSON.stringify(v)} is not a curriculum stage — the ladder is the closed nine-stage union of spec/LEARNING-LOOP.md (${CURRICULUM_STAGES.join(' | ')})`,
      path,
    );
  }
  return { ok: true, value: v };
}

// ---------------------------------------------------------------------------
// The stage-9 gate (live execution is permitted-only, never default)
// ---------------------------------------------------------------------------

/**
 * The live-gated stages: `controlled_live` (stage 9) can be scheduled or
 * entered ONLY with the declared permission record. This predicate is the
 * single point the plan and trail lanes cite for the
 * `live_permission_missing` typed error.
 */
export function isLiveGatedStage(stage: CurriculumStageKind): boolean {
  return stage === 'controlled_live';
}

// ---------------------------------------------------------------------------
// The L6 fidelity-claim table (frozen)
// ---------------------------------------------------------------------------

/**
 * The world modes each stage kind's descriptor MAY declare — the frozen L6
 * fidelity-claim table (see module header). A descriptor declaring a mode
 * outside its stage's claim set is the typed `fidelity_claim_violation`
 * (the work order's named negative test: a stage claiming historical truth
 * from a generative world).
 */
export const REQUIRED_WORLD_MODES: Readonly<Record<CurriculumStageKind, readonly WorldMode[]>> = deepFreeze({
  // "Simple synthetic regimes" — synthetic by name (L6: synthetic worlds
  // are stress/exploration instruments, not historical truth).
  synthetic_regimes: ['generative'],
  // "Historical replay" — historical truth claimed; only exact replay can
  // back it (L5; the work order's named negative test).
  historical_replay: ['exact_replay'],
  // "Microstructure and friction" — friction stress is legitimate over any
  // world mode; the descriptor declares which, honestly.
  microstructure_friction: ['exact_replay', 'reactive_replay', 'generative'],
  // "Reactive market" — endogenous participants are the point
  // (ARCHITECTURE.md: "reactive replay with endogenous participants").
  reactive_market: ['reactive_replay'],
  // "Adversarial population" — the adversaries are endogenous participants
  // of the arena (L10); a tape cannot field them.
  adversarial_population: ['reactive_replay'],
  // "Unseen multi-regime tests" — blind testing over holdout replay or
  // synthetic unseen regimes; any mode, declared honestly.
  unseen_multi_regime: ['exact_replay', 'reactive_replay', 'generative'],
  // "Rolling Time Machine" — point-in-time historical truth (L4/L5); the
  // Time Machine replays history, it does not invent it.
  rolling_time_machine: ['exact_replay'],
  // "Shadow trading" — the live tape observed exactly; nothing is modeled.
  shadow_trading: ['exact_replay'],
  // "Controlled live execution when permitted" — the live market itself,
  // under the permission record; nothing is modeled.
  controlled_live: deepFreeze(['exact_replay'] as const),
} as const);

/**
 * `true` iff `stage`'s descriptor may honestly declare `mode` (L6). The
 * single point the version validator cites for `fidelity_claim_violation`.
 */
export function worldModeHonest(stage: CurriculumStageKind, mode: WorldMode): boolean {
  return REQUIRED_WORLD_MODES[stage].includes(mode);
}

/**
 * The guarded L6 check: a stage descriptor declaring a world mode its
 * stage kind's fidelity claim contradicts fails with the typed
 * `fidelity_claim_violation`, naming the claim set (the work order's named
 * negative test — e.g. historical_replay + generative).
 */
export function checkFidelityHonesty(stage: CurriculumStageKind, mode: WorldMode, path: string): CurriculumResult<true> {
  if (!worldModeHonest(stage, mode)) {
    return fail(
      'fidelity_claim_violation',
      `stage "${stage}" cannot declare world mode "${mode}" — its fidelity claim admits [${REQUIRED_WORLD_MODES[stage].join(' | ')}] (L6: synthetic worlds are stress/exploration instruments, not historical truth; a stage claiming historical truth from a generative world is a typed error)`,
      path,
    );
  }
  return { ok: true, value: true };
}
