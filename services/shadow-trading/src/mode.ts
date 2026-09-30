/**
 * @tradrl/shadow_trading — the MODE HONESTY law (L5 + R23 + the
 * evaluation protocol's "Simulation evidence and live evidence are
 * never conflated").
 *
 * THE LAW: this lane's mode declaration is the LITERAL `'shadow'` —
 * a one-member type. Paper execution against the reactive world is
 * SHADOW evidence: simulated-origin, never live, never exact replay.
 * A declaration claiming `'live'` or `'exact_replay'` (or any other
 * fidelity) fails the typed `fidelity_claim_dishonest` at
 * construction, at every record guard, and at resume — the dishonest
 * claim is INEXPRESSIBLE by construction and rejected at every layer.
 *
 * Live trading is OUT OF SCOPE of this Work Order: there is no code
 * path, no record field and no serialization form that can carry a
 * live claim out of this lane (the type has one member; the guard
 * accepts one value). Venue binding beyond the reactive world is
 * T040's lane.
 */

import { deepFreeze, isRecord } from './primitives';
import { type ShadowResult, fail } from './errors';

/** The shadow lane's mode declaration — one literal, by construction. */
export type ShadowMode = 'shadow';

/** The mode vocabulary (one member — live evidence is inexpressible here). */
export const SHADOW_MODES: readonly ShadowMode[] = ['shadow'] as const;

/** Guard: the shadow mode literal. */
export function isShadowMode(v: unknown): v is ShadowMode {
  return v === 'shadow';
}

/**
 * The typed mode-honesty gate: validate an UNTRUSTED mode declaration
 * (session configs arrive as unknown — the caller's literal may be
 * anything). The only accepted claim is `'shadow'`; `'live'` and
 * `'exact_replay'` fail with `fidelity_claim_dishonest` naming the
 * refused claim; anything else fails as an unknown mode (still
 * dishonest — there is no second honest vocabulary here).
 */
export function validateShadowMode(v: unknown): ShadowResult<ShadowMode> {
  if (isShadowMode(v)) {
    return { ok: true, value: v };
  }
  if (v === 'live') {
    return fail(
      'fidelity_claim_dishonest',
      "a shadow session cannot declare mode 'live' — live execution is T040's lane and live evidence is never produced here (L5/R23: simulation evidence and live evidence are never conflated)",
      'mode',
    );
  }
  if (v === 'exact_replay') {
    return fail(
      'fidelity_claim_dishonest',
      "a shadow session cannot declare mode 'exact_replay' — exact historical replay is T009's lane; this lane paper-trades against the reactive world (L5: replay, reactive replay and generative simulation are distinct)",
      'mode',
    );
  }
  return fail(
    'fidelity_claim_dishonest',
    `unknown mode declaration ${JSON.stringify(v)} — the shadow lane's mode vocabulary is exactly ['shadow']`,
    'mode',
  );
}

/**
 * The fill-origin honesty record: every fill this lane produces is
 * `simulated`-origin. The declaration rides the session and every
 * outcome record (T033 consumes it downstream — shadow outcomes are
 * NEVER mistaken for live evidence).
 */
export const SHADOW_FIDELITY_DECLARATION = deepFreeze({
  mode: 'shadow' as const,
  fill_origin: 'simulated' as const,
  declaration: 'paper execution of a decision stream against the reactive world (T027) with the full control stack (T019 gate, T020 risk) enforced before any submission',
  limitation: 'shadow fills are SIMULATED outcomes of a reactive-replay world — never live evidence (R23) and never exact historical replay (L5); live execution is the T040 lane',
} as const);

/** Guard: the fidelity declaration block on a record (mode + origin literals). */
export function isShadowFidelityBlock(v: unknown): boolean {
  if (!isRecord(v)) return false;
  return v.mode === 'shadow' && v.fill_origin === 'simulated';
}
