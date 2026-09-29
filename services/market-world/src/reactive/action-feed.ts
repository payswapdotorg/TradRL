/**
 * @tradrl/market-world (reactive service) — the SCRIPTED PARTICIPANT
 * ACTION FEEDS (work order T027): the deterministic ports that supply the
 * endogenous participants' actions.
 *
 * THE LAW: "participants are scripted action feeds; no live data" — the
 * roster's ADVERSARIES (and any scripted co-participants) act through
 * deterministic pull ports, exactly as the recorded stream arrives through
 * a pure async iterator. The ports are SYNCHRONOUS by design: the
 * environment-protocol surface (and the T013 trainer bridge that drives
 * it) calls world operations synchronously, so a feed that must fire
 * DURING a clock advance cannot be awaited.
 *
 * DETERMINISM (L9): "Participant action ORDER matters and is part of the
 * deterministic function (declared interleaving with the recorded
 * stream)" — a feed's actions must be nondecreasing in `at` (validated at
 * construction for literal scripts, and at pull time for arbitrary
 * ports); the world fires them at their declared instants in the declared
 * interleaving order, and the run record logs every fired action id so a
 * resumed run re-consumes the IDENTICAL script (verified — a diverging
 * feed fails `chain_mismatch`).
 */

import { deepFreeze, isRecord } from './primitives';
import { invalidField, invalidType, ok, type ReactiveResult } from './errors';
import { isTimestampMs, type AgentInstanceId, type TimestampMs } from './ids';
import type { ActionEnvelope } from './env-mirror';
import { isActionEnvelope } from './env-mirror';

// ---------------------------------------------------------------------------
// The scripted action (one participant's declared move at an instant)
// ---------------------------------------------------------------------------

/**
 * One scripted participant action: the instant it fires plus the action
 * envelope (whose `actor` MUST be the owning participant — validated at
 * pull time; a feed may never act as someone else).
 */
export interface ScriptedAction {
  /** The instant the action fires (the world's clock must reach it first). */
  readonly at: TimestampMs;
  readonly action: ActionEnvelope;
}

/** Structural guard for a scripted action (envelope shape + envelope-actor coherence). */
export function isScriptedAction(value: unknown): value is ScriptedAction {
  if (!isRecord(value)) return false;
  if (!isTimestampMs(value.at)) return false;
  if (!isActionEnvelope(value.action)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The feed port (peek for scheduling, take when firing)
// ---------------------------------------------------------------------------

/**
 * A deterministic scripted action feed: a pure pull port.
 *
 *   - `peek()` — the next unconsumed action (unconsumed), or null when the
 *     feed is exhausted. The world peeks to compute the next action
 *     boundary instant (the interleaving scheduler).
 *   - `take()` — consume and return the next action, or null when
 *     exhausted. The world takes ONLY at the action's declared instant
 *     (the boundary processing), so the same feed consumed at the same
 *     boundaries yields the identical action stream, byte-for-byte.
 *
 * CONTRACT (fail-closed, enforced at every pull): actions must be
 * nondecreasing in `at`; `action.actor` must be the owning participant;
 * the envelope must be structurally valid. Violations are typed
 * `interleaving_violation` errors at pull time — never silent.
 */
export interface ParticipantActionFeed {
  peek(): ScriptedAction | null;
  take(): ScriptedAction | null;
}

/** Structural runtime guard for the feed port. */
export function isParticipantActionFeed(value: unknown): value is ParticipantActionFeed {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.peek === 'function' && typeof candidate.take === 'function';
}

// ---------------------------------------------------------------------------
// The literal-script feed constructor (the fixture discipline)
// ---------------------------------------------------------------------------

/**
 * Build a feed from a literal action script. The script must be
 * nondecreasing in `at` (the deterministic order law — a script that goes
 * back in time is rejected up front with `interleaving_violation`); each
 * action's actor must equal `participant`. The returned feed is a fresh
 * cursor over the script — call again for a second, identical feed
 * (resume re-pulls and verifies against the recorded log).
 */
export function createScriptedActionFeed(participant: AgentInstanceId, script: readonly unknown[]): ReactiveResult<ParticipantActionFeed> {
  const validated: ScriptedAction[] = [];
  let previousAt: number | null = null;
  for (let index = 0; index < script.length; index++) {
    const candidate = script[index];
    if (!isScriptedAction(candidate)) {
      return {
        ok: false,
        errors: [
          invalidType(
            `feed.${participant}`,
            `script[${index}] must be { at: TimestampMs, action: ActionEnvelope }`,
          ),
        ],
      };
    }
    if (candidate.action.actor !== participant) {
      return {
        ok: false,
        errors: [
          invalidField(
            `script[${index}].action.actor`,
            `a feed owned by participant "${participant}" may not act as "${String(candidate.action.actor)}" — feeds act as their owner only`,
          ),
        ],
      };
    }
    if (previousAt !== null && (candidate.at as number) < previousAt) {
      return {
        ok: false,
        errors: [
          {
            code: 'interleaving_violation',
            path: `script[${index}].at`,
            message: `scripted actions must be nondecreasing in 'at' (instant ${String(candidate.at)} follows ${String(previousAt)}) — the declared order IS the deterministic function`,
          },
        ],
      };
    }
    previousAt = candidate.at as number;
    validated.push(candidate);
  }

  const frozen = deepFreeze([...validated]);
  let cursor = 0;
  const feed: ParticipantActionFeed = {
    peek(): ScriptedAction | null {
      return cursor < frozen.length ? (frozen[cursor] as ScriptedAction) : null;
    },
    take(): ScriptedAction | null {
      if (cursor >= frozen.length) return null;
      const next = frozen[cursor] as ScriptedAction;
      cursor += 1;
      return next;
    },
  };
  return ok(feed);
}
