/**
 * @tradrl/market-world (generative service) — the T013 TRAINER BRIDGE
 * adapter (work order T028): "A thin adapter demonstrating the T013
 * bridge consumption: the generative world satisfies the trainer's
 * EnvironmentPort shape structurally (the README's contract), including
 * the ReplayRunRecord-style lineage binding."
 *
 * THE PORT MIRROR (D-003/D-004): {@link TrainerEnvironmentPort} re-declares
 * rl-protocol's `EnvironmentPort` (T013) — the consumer view of an
 * environment: `start` returns an episode VIEW (id, clock, status,
 * termination, rewards), `observe` returns OBSERVATION VIEWS (id +
 * available_time only — the bridge can never read around the L4 boundary),
 * `submit`/`advance`/`finish` drive the world. The GenerativeWorldService
 * already satisfies the five-operation surface directly; this adapter adds
 * the bridge's two conveniences:
 *
 *   1. VIEW NARROWING — the rich episode views and observations are handed
 *      over AS the consumer views (everything beyond the view fields is
 *      structurally tolerated and never read by the bridge).
 *   2. PAYLOAD VOCABULARY — the bridge's proposals ride
 *      `{ kind, body }` payloads; the world's engine vocabulary is
 *      `{ type, intent }` / `{ type, order_id }` / `{ type, client_order_id }`.
 *      The adapter translates 1:1, losslessly (the body IS the intent).
 *
 * THE FULL-CATCH-UP ADVANCE: the raw service processes ONE boundary per
 * `advance` (the step machine); the bridge's advance semantics are
 * full-window, so the adapter loops the world's advance until the world
 * is SETTLED at the target (bounded: every iteration processes at least
 * one pending boundary, and the process cadences are finite).
 *
 * src/interop.test.ts is the trip wire: it drives a REAL generative
 * episode through the REAL rl-protocol EpisodeDriver over this adapter
 * and asserts the step log's shapes.
 */

import type { JsonValue } from './primitives';
import { fail, ok, type GenerativeResult } from './errors';
import type { TimestampMs } from './ids';
import type { ActionEnvelope, ClockState, EnvironmentSpec, TerminationReason } from './env-mirror';
import type { GenerativeObservation } from './records';
import type { GenerativeSubmission } from './service';
import type { GenerativeEpisodeFinish, GenerativeEpisodeView, GenerativeWorldService } from './service';

// ---------------------------------------------------------------------------
// The rl-protocol EnvironmentPort mirror (T013 — DO NOT DIVERGE)
// ---------------------------------------------------------------------------

/** The episode-state view the trainer consumes (mirror of T013's EpisodeView). */
export interface EpisodeViewMirror {
  readonly episode_id: string;
  readonly clock: ClockState;
  readonly status: 'running' | 'finished';
  readonly termination: TerminationReason | null;
  readonly rewards: readonly [];
}

/** The observation view the trainer consumes (mirror of T013's ObservationView — L4: id + available_time ONLY). */
export interface ObservationViewMirror {
  readonly observation_id: string;
  readonly available_time: TimestampMs;
}

/** The finish view the trainer consumes (mirror of T013's EpisodeFinishView). */
export interface EpisodeFinishViewMirror {
  readonly episode: EpisodeViewMirror;
  readonly result: {
    readonly episode_id: string;
    readonly environment_id: string;
    readonly spec: EnvironmentSpec;
    readonly termination: TerminationReason;
    readonly final_now: TimestampMs;
    readonly accepted_action_count: number;
    readonly pending_observation_count: number;
    readonly rewards: readonly [];
  };
}

/** A world error as the bridge sees it: the world lane's own code vocabulary, preserved (mirror of T013's EnvironmentError). */
export interface TrainerEnvironmentError {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

/** A world operation outcome (mirror of T013's EnvironmentResult). */
export type TrainerEnvironmentResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly TrainerEnvironmentError[] };

/**
 * The five-operation environment PORT the trainer drives — mirror of
 * rl-protocol's `EnvironmentPort` (T013). THE ADAPTER SHIPS NO WORLD: the
 * generative service is injected; this is the thin consumption seam.
 */
export interface TrainerEnvironmentPort {
  start(spec: EnvironmentSpec): TrainerEnvironmentResult<EpisodeViewMirror>;
  observe(episode: string, at: TimestampMs): TrainerEnvironmentResult<readonly ObservationViewMirror[]>;
  submit(episode: string, action: ActionEnvelope): TrainerEnvironmentResult<EpisodeViewMirror>;
  advance(episode: string, to: TimestampMs): TrainerEnvironmentResult<EpisodeViewMirror>;
  finish(episode: string, reason: unknown): TrainerEnvironmentResult<EpisodeFinishViewMirror>;
}

/** Structural runtime guard for the port surface (mirror of T013's isEnvironmentPort). */
export function isTrainerEnvironmentPort(value: unknown): value is TrainerEnvironmentPort {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.start === 'function' &&
    typeof candidate.observe === 'function' &&
    typeof candidate.submit === 'function' &&
    typeof candidate.advance === 'function' &&
    typeof candidate.finish === 'function'
  );
}

// ---------------------------------------------------------------------------
// The adapter (thin: delegation + view narrowing + payload translation)
// ---------------------------------------------------------------------------

/** The maximum catch-up iterations the adapter's advance will run (finite cadences; the bound is a safety valve). */
const MAX_CATCH_UP_STEPS = 100_000;

/**
 * Adapt a {@link GenerativeWorldService} to the trainer's EnvironmentPort
 * mirror. THE THIN SEAM: every operation delegates to the world's own
 * five-operation surface; the only translations are (1) the view narrowing
 * (a generative episode view IS an episode view; a generative observation
 * IS an observation view — the payload stays the world's business) and
 * (2) the bridge payload vocabulary (`{ kind, body }` -> the engine's
 * `{ type, intent }` et al.).
 */
export function asTrainerEnvironment(service: GenerativeWorldService): TrainerEnvironmentPort {
  const port: TrainerEnvironmentPort = {
    start(spec: EnvironmentSpec): TrainerEnvironmentResult<EpisodeViewMirror> {
      const started = service.start(spec);
      if (!started.ok) return started;
      return ok(started.value);
    },

    observe(episode: string, at: TimestampMs): TrainerEnvironmentResult<readonly ObservationViewMirror[]> {
      const observed = service.observe(episode, at);
      if (!observed.ok) return observed;
      return ok(observed.value);
    },

    submit(episode: string, action: ActionEnvelope): TrainerEnvironmentResult<EpisodeViewMirror> {
      const translated = translateActionPayload(action);
      if (!translated.ok) return translated;
      const submitted: GenerativeResult<GenerativeSubmission> = service.submit(episode, translated.value);
      if (!submitted.ok) return submitted;
      return ok(submitted.value);
    },

    advance(episode: string, to: TimestampMs): TrainerEnvironmentResult<EpisodeViewMirror> {
      // Full catch-up: loop the step machine until the world is settled at
      // the target (each iteration processes at least one pending boundary).
      let view: GenerativeEpisodeView | null = null;
      for (let iteration = 0; iteration < MAX_CATCH_UP_STEPS; iteration++) {
        const advanced = service.advance(episode, view === null ? to : view.clock.now);
        if (!advanced.ok) return advanced;
        view = advanced.value;
        if (view.settled) return ok(view);
      }
      return fail('interleaving_violation', `the world did not settle within ${MAX_CATCH_UP_STEPS} boundary steps — the declared process cadences are incoherent with the clock (infinite catch-up is impossible by construction)`);
    },

    finish(episode: string, reason: unknown): TrainerEnvironmentResult<EpisodeFinishViewMirror> {
      const finished: GenerativeResult<GenerativeEpisodeFinish> = service.finish(episode, reason);
      if (!finished.ok) return finished;
      return ok(finished.value);
    },
  };
  return port;
}

/**
 * Translate a bridge action payload (`{ kind, body }`) onto the engine's
 * vocabulary (`{ type, intent }` / `{ type, order_id }` /
 * `{ type, client_order_id }`), 1:1 and losslessly — the body IS the
 * intent. Unknown kinds fail with the world's own `invalid_action` code
 * (the bridge sees the world's vocabulary, never a silent mapping).
 */
function translateActionPayload(action: ActionEnvelope): GenerativeResult<ActionEnvelope> {
  const payload = action.payload;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return fail('invalid_action', 'the bridge action payload must be a JSON object ({ kind, body })', 'payload');
  }
  const candidate = payload as { readonly [key: string]: JsonValue };
  const kind = candidate.kind;
  const body = candidate.body;
  if (typeof kind !== 'string' || kind.length === 0) {
    return fail('invalid_action', "the bridge action payload must carry a non-empty 'kind'", 'payload.kind');
  }
  if (body === undefined) {
    return fail('invalid_action', "the bridge action payload must carry a 'body'", 'payload.body');
  }
  let translated: JsonValue;
  if (kind === 'submit_order') {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return fail('invalid_action', "a 'submit_order' body must be the order intent object", 'payload.body');
    }
    translated = { type: 'submit_order', intent: body };
  } else if (kind === 'cancel_order') {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return fail('invalid_action', "a 'cancel_order' body must be { order_id }", 'payload.body');
    }
    const orderId = (body as { readonly [key: string]: JsonValue }).order_id;
    if (typeof orderId !== 'string' || orderId.length === 0) {
      return fail('invalid_action', "a 'cancel_order' body must carry a non-empty order_id", 'payload.body.order_id');
    }
    translated = { type: 'cancel_order', order_id: orderId };
  } else if (kind === 'cancel_client_order') {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return fail('invalid_action', "a 'cancel_client_order' body must be { client_order_id }", 'payload.body');
    }
    const clientOrderId = (body as { readonly [key: string]: JsonValue }).client_order_id;
    if (typeof clientOrderId !== 'string' || clientOrderId.length === 0) {
      return fail('invalid_action', "a 'cancel_client_order' body must carry a non-empty client_order_id", 'payload.body.client_order_id');
    }
    translated = { type: 'cancel_client_order', client_order_id: clientOrderId };
  } else {
    return fail('invalid_action', `bridge action kind '${kind}' has no engine vocabulary mapping (submit_order | cancel_order | cancel_client_order)`, 'payload.kind');
  }
  return ok({ ...action, payload: translated });
}

// ---------------------------------------------------------------------------
// TYPE-LEVEL WITNESSES (fail `pnpm typecheck` if a mirror drifts)
// ---------------------------------------------------------------------------

/** Compiles iff a generative observation is an observation VIEW (the L4 consumer shape). */
export function observationIsView(value: GenerativeObservation): ObservationViewMirror {
  return value;
}

/** Compiles iff a generative episode view is an episode view (the bridge consumer shape). */
export function episodeViewIsView(value: GenerativeEpisodeView): EpisodeViewMirror {
  return value;
}
