/**
 * @tradrl/market-world (exchange service) — the ExchangeService: the
 * reference driver of the exchange simulator (work order T010).
 *
 * LAYERING: this service composes the CONTRACT package
 * `@tradrl/exchange-sim` (imported by RELATIVE path, exactly as T009's
 * replay service imports its contract package — the frozen write surface
 * permits only the prelude's lockfile regeneration, so no workspace edge
 * is added; the Lead may convert this to `workspace:*` at the next
 * serialized lockfile change). It drives the engine over a SESSION:
 * consumers submit order/cancel intents through the five-operation
 * Environment surface (T005 shapes, mirrored in env-mirror.ts), the
 * engine processes them per its mechanical rules (L8 — the service
 * grants no authority), and every outcome is emitted as an event-shaped
 * output carrying the availability quartet (L4) — fills as `trade`
 * events, top-of-book changes as `quote` events, acks/rejects/cancels/
 * expirations as named `other` events (event.ts).
 *
 * THE INFORMATION BOUNDARY (L4, the core discipline): an emitted outcome
 * becomes an OBSERVATION whose `available_time` is the outcome's own
 * quartet availability (event_time + the latency model's deterministic
 * delay). The observation sits in the episode's `pending` set —
 * INCLUDING future-dated ones (embargoed) — and `observe(episode, at)`
 * returns only those with `available_time <= at` (INCLUSIVE). A fill is
 * therefore NEVER visible before its latency window elapses, even though
 * the engine matched it instantly (the declared latency semantics).
 *
 * QUOTE DISCIPLINE: a `quote` event is emitted whenever the top of book
 * CHANGES after a transition and BOTH sides are non-empty (an honest
 * venue emits no one-sided quote). Quotes carry `available_time ==
 * event_time`: the market-data feed has NO modeled feed latency (declared
 * limitation of the latency model — it applies to order outcomes only).
 *
 * LINEAGE (L9): {@link SessionRecord} binds the config hash, the book
 * seed hash, the full order/fill log, the clock timeline and the outcome
 * stream hash (FNV-1a over the canonical JSON of every emitted event, in
 * emission order). Two identical runs produce IDENTICAL records —
 * acceptance criterion 9, proven in tests. The record carries the
 * deterministic `session_id` (= the episode id, itself derived from the
 * spec) so trajectories (T011) can join on it.
 *
 * MULTI-EPISODE: like T009's world adapter, one service serves multiple
 * episodes — each `start(spec)` binds a FRESH engine (same config, same
 * book seed, clock from the spec) so every episode is a closed,
 * fully-auditable run.
 */

import {
  advanceEngine,
  bookSnapshotView,
  cancelOrder as engineCancel,
  configHash,
  createEngine,
  deepFreeze,
  fail,
  isOrderAck,
  isTimestampMs,
  ok,
  submitOrder as engineSubmit,
  topOfBook,
  type CancelOutcome,
  type EngineState,
  type ExchangeConfig,
  type ExchangeResult,
  type Fill,
  type OrderCancelRecord,
  type OrderReject,
  type SubmitOutcome,
  type TimestampMs,
} from '../../../../packages/exchange-sim/src/index';
import {
  canonicalJson,
  canonicalSpecJson,
  deriveEpisodeId,
  fnv1a32Hex,
  isActionMirror,
  isJsonValue,
  isTerminationReason,
  validateEnvironmentSpec,
  type ActionMirror,
  type ClockState,
  type EpisodeFinishMirror,
  type EpisodeResultMirror,
  type EpisodeStateMirror,
  type EnvironmentSpec,
  type JsonValue,
  type ObservationMirror,
  type TerminationReason,
} from './env-mirror';
import {
  orderAckEventOf,
  orderCancelEventOf,
  orderExpiredEventOf,
  orderRejectEventOf,
  quoteEventOf,
  sequenceStream,
  tradeEventOf,
  type AssetClass,
  type EventEnvelopeContext,
  type ExchangeEvent,
} from './event';

// ---------------------------------------------------------------------------
// The action payload vocabulary (what rides the T005 action envelope)
// ---------------------------------------------------------------------------

/** What an actor asks the exchange to do: submit an intent, or cancel by venue/client id. */
export type ExchangeActionPayload =
  | { readonly type: 'submit_order'; readonly intent: Record<string, unknown> }
  | { readonly type: 'cancel_order'; readonly order_id: string }
  | { readonly type: 'cancel_client_order'; readonly client_order_id: string };

/** Validate an action payload shape (the engine validates the intent itself). */
function validateActionPayload(payload: JsonValue): ExchangeResult<ExchangeActionPayload> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return fail('invalid_action', 'the action payload must be an object');
  }
  const candidate = payload as Record<string, unknown>;
  if (candidate.type === 'submit_order') {
    if (typeof candidate.intent !== 'object' || candidate.intent === null || Array.isArray(candidate.intent)) {
      return fail('invalid_action', 'submit_order requires an order intent object', 'payload.intent');
    }
    return ok({ type: 'submit_order', intent: candidate.intent as Record<string, unknown> });
  }
  if (candidate.type === 'cancel_order') {
    if (typeof candidate.order_id !== 'string' || candidate.order_id.length === 0) {
      return fail('invalid_action', 'cancel_order requires a non-empty order_id', 'payload.order_id');
    }
    return ok({ type: 'cancel_order', order_id: candidate.order_id });
  }
  if (candidate.type === 'cancel_client_order') {
    if (typeof candidate.client_order_id !== 'string' || candidate.client_order_id.length === 0) {
      return fail('invalid_action', 'cancel_client_order requires a non-empty client_order_id', 'payload.client_order_id');
    }
    return ok({ type: 'cancel_client_order', client_order_id: candidate.client_order_id });
  }
  return fail('invalid_action', "the action payload type must be 'submit_order' | 'cancel_order' | 'cancel_client_order'", 'payload.type');
}

// ---------------------------------------------------------------------------
// Episode views (structurally T005's EpisodeState / EpisodeFinish)
// ---------------------------------------------------------------------------

/** The exchange observation: the delivery envelope of one emitted event (the payload IS the full event — forensic completeness). */
export interface ExchangeObservation extends ObservationMirror {
  readonly observation_id: string;
  readonly available_time: TimestampMs;
  readonly venue: string | null;
  readonly instrument: string | null;
  readonly payload: JsonValue;
  readonly provenance: { readonly origin: 'simulated'; readonly source: string; readonly derived_from: readonly string[] };
}

/** The episode view: structurally environment-protocol's EpisodeState. */
export interface ExchangeEpisodeView extends EpisodeStateMirror {
  readonly episode_id: string;
  readonly spec: EnvironmentSpec;
  readonly clock: ClockState;
  readonly status: 'running' | 'finished';
  readonly termination: TerminationReason | null;
  readonly pending: readonly ExchangeObservation[];
  readonly accepted_actions: readonly ActionMirror[];
  readonly rewards: readonly [];
}

/** The submit product: the new episode view PLUS the typed receipt (a forward-compatible extra field). */
export interface ExchangeSubmission extends ExchangeEpisodeView {
  readonly receipt: ExchangeReceipt;
}

/** The typed receipt of one processed action. */
export interface ExchangeReceipt {
  readonly receipt_id: string;
  readonly episode_id: string;
  readonly action_id: string;
  readonly actor: string;
  readonly client_sequence: number;
  readonly recorded_at: TimestampMs;
  readonly disposition: 'engine_processed';
  /** The engine's intake outcome summary (never a fill itself — fills ride observations). */
  readonly outcome: { readonly kind: 'ack' | 'reject'; readonly order_id: string; readonly status: string; readonly reject_reason: string | null };
  readonly fill_count: number;
}

/** The finish product: terminal state + immutable result (structurally EpisodeFinish). */
export interface ExchangeEpisodeFinish extends EpisodeFinishMirror {
  readonly episode: ExchangeEpisodeView;
  readonly result: ExchangeEpisodeResult;
}

/** The result record (structurally EpisodeResult). */
export interface ExchangeEpisodeResult extends EpisodeResultMirror {
  readonly episode_id: string;
  readonly environment_id: string;
  readonly spec: EnvironmentSpec;
  readonly termination: TerminationReason;
  readonly final_now: TimestampMs;
  readonly accepted_action_count: number;
  readonly pending_observation_count: number;
  readonly rewards: readonly [];
}

// ---------------------------------------------------------------------------
// The session record (L9 lineage)
// ---------------------------------------------------------------------------

/** One clock transition in the timeline: an advance call, from -> to. */
export interface ClockAdvance {
  readonly from: number;
  readonly to: number;
}

/** One order's summary line in the session record. */
export interface OrderLogEntry {
  readonly order_id: string;
  readonly client_order_id: string;
  readonly status: string;
  readonly quantity: string;
  readonly filled_quantity: string;
  readonly reject_reason: string | null;
  readonly cancel_reason: string | null;
  readonly fill_ids: readonly string[];
}

/** The full lineage record of one finished exchange episode (see the module header). */
export interface SessionRecord {
  readonly schema: 'tradrl/exchange-session-record@1';
  readonly session_id: string;
  readonly world: {
    readonly world_id: string;
    readonly venue: string;
    readonly instrument: string;
    readonly asset_class: string;
    readonly config_hash: string;
    readonly seed: string;
    readonly fidelity: string;
    readonly book_seed_hash: string;
  };
  readonly episode: {
    readonly episode_id: string;
    readonly environment_id: string;
    readonly spec_hash: string;
    readonly termination: { readonly code: string; readonly detail: string };
    readonly final_now: number;
  };
  readonly order_log: readonly OrderLogEntry[];
  readonly fill_log: readonly Fill[];
  readonly counts: {
    readonly events: number;
    readonly fills: number;
    readonly orders: number;
    readonly rejects: number;
    readonly cancels: number;
    readonly expirations: number;
  };
  readonly clock_timeline: readonly ClockAdvance[];
  /** FNV-1a over the canonical JSON of every emitted event, in emission order. */
  readonly outcome_stream_hash: string;
  /** The record's own digest (over the canonical record without the digest field). */
  readonly digest: string;
}

// ---------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------

/** The exchange service: five Environment operations over exchange-sim engines. */
export interface ExchangeService {
  /** The validated, fully-determining exchange config. */
  readonly config: ExchangeConfig;
  /** The config's deterministic digest (bound into every session record). */
  readonly config_hash: string;
  /** The service's deterministic world id (`world-exchange-<configHash>`) that specs bind to. */
  readonly world_id: string;
  /** All registered episode ids, in registration order. */
  readonly episodes: readonly string[];

  /** Bind an episode spec to this exchange (validates the spec, the world binding and the fidelity coherence). */
  start(spec: unknown): ExchangeResult<ExchangeEpisodeView>;
  /** PURE point-in-time query (L4, inclusive): observations visible at `at`. */
  observe(episode: string, at: TimestampMs): ExchangeResult<readonly ExchangeObservation[]>;
  /** Submit an action (order/cancel intent) for engine processing; results come back as observations. */
  submit(episode: string, action: unknown): ExchangeResult<ExchangeSubmission>;
  /** Advance the episode clock (monotonic, `<= episode asOf`); expires gtt orders and emits their events. */
  advance(episode: string, to: TimestampMs): ExchangeResult<ExchangeEpisodeView>;
  /** Finish the episode: terminal state plus the immutable result. */
  finish(episode: string, reason: unknown): ExchangeResult<ExchangeEpisodeFinish>;
  /** The L9 lineage record of a FINISHED episode (identical runs -> identical records). */
  sessionRecord(episode: string): ExchangeResult<SessionRecord>;
  /** The current aggregated book view (a market-protocol book_snapshot payload shape). */
  bookSnapshot(episode: string): ExchangeResult<{ readonly bids: readonly { readonly price: string; readonly size: string }[]; readonly asks: readonly { readonly price: string; readonly size: string }[] }>;
  /** Every emitted event so far (the full outcome stream, in emission order). */
  events(episode: string): ExchangeResult<readonly ExchangeEvent[]>;
}

/** One episode's run line (the service's private bookkeeping). */
interface EpisodeLine {
  readonly spec: EnvironmentSpec;
  readonly episodeId: string;
  engine: EngineState;
  clock: ClockState;
  status: 'running' | 'finished';
  termination: TerminationReason | null;
  events: ExchangeEvent[];
  acceptedActions: ActionMirror[];
  advances: ClockAdvance[];
  sequences: Map<string, number>;
  eventCounter: number;
  lastQuote: { readonly bid_price: string; readonly bid_size: string; readonly ask_price: string; readonly ask_size: string } | null;
}

/**
 * Create an exchange service from an untrusted config and an optional
 * book seed. The config is validated by the contract package; the seed
 * is validated against the venue's grid rules (a probe engine is built
 * once, then a FRESH engine is created per episode over the same
 * config + seed).
 */
export function createExchangeService(config: unknown, bookSeed: unknown = null): ExchangeResult<ExchangeService> {
  const engineProbe = createEngine(config, { book_seed: bookSeed, start_at: 0 });
  if (!engineProbe.ok) return engineProbe;
  const validConfig = engineProbe.value.config;
  const configHashValue = configHash(validConfig);
  // Book seed hash: canonical JSON when the seed is a JSON value (field
  // order irrelevant — L9); a stringify fallback for tolerated non-JSON
  // excess fields (deterministic; the engine validated the known fields).
  const bookSeedHash = isJsonValue(bookSeed)
    ? fnv1a32Hex(canonicalJson(bookSeed))
    : fnv1a32Hex(JSON.stringify(bookSeed ?? null));
  const worldId = `world-exchange-${configHashValue}`;

  const registry = new Map<string, EpisodeLine>();
  const order: string[] = [];

  const lookup = (episode: string): ExchangeResult<EpisodeLine> => {
    const line = registry.get(episode);
    if (line === undefined) {
      return fail('unknown_episode', `episode ${episode} is not known to this exchange service`);
    }
    return ok(line);
  };

  /** The episode view (structurally an EpisodeState): pending = every emitted observation. */
  const viewOf = (line: EpisodeLine): ExchangeEpisodeView =>
    deepFreeze({
      episode_id: line.episodeId,
      spec: line.spec,
      clock: line.clock,
      status: line.status,
      termination: line.termination,
      pending: line.events.map(observationOf),
      accepted_actions: [...line.acceptedActions],
      rewards: [],
    });

  /** A blank envelope context (identity/sequence minted per emission). */
  const blankContext = (): EventEnvelopeContext => ({
    event_id: '',
    sequence: 0,
    venue: validConfig.venue,
    instrument: validConfig.instrument,
    asset_class: validConfig.asset_class as AssetClass,
  });

  /** Mint the next event identity and per-stream sequence for an emission of `event`'s stream. */
  const envelopeContext = (line: EpisodeLine, event: Pick<ExchangeEvent, 'event_type' | 'payload'>): EventEnvelopeContext => {
    line.eventCounter += 1;
    const key = `${validConfig.venue}|${validConfig.instrument}|${sequenceStream(event)}`;
    const next = (line.sequences.get(key) ?? 0) + 1;
    line.sequences.set(key, next);
    return {
      event_id: `xev-${String(line.eventCounter).padStart(8, '0')}`,
      sequence: next,
      venue: validConfig.venue,
      instrument: validConfig.instrument,
      asset_class: validConfig.asset_class as AssetClass,
    };
  };

  /** Append an event to the line (emission order = array order). */
  const emit = (line: EpisodeLine, event: ExchangeEvent): void => {
    line.events.push(event);
  };

  /** The quote discipline: emit a quote when the top of book CHANGED and both sides are non-empty. */
  const maybeEmitQuote = (line: EpisodeLine, at: TimestampMs): void => {
    const top = topOfBook(line.engine.book);
    if (top === null) {
      line.lastQuote = null;
      return;
    }
    const changed =
      line.lastQuote === null ||
      line.lastQuote.bid_price !== top.bid_price ||
      line.lastQuote.bid_size !== top.bid_size ||
      line.lastQuote.ask_price !== top.ask_price ||
      line.lastQuote.ask_size !== top.ask_size;
    if (!changed) return;
    line.lastQuote = { bid_price: top.bid_price, bid_size: top.bid_size, ask_price: top.ask_price, ask_size: top.ask_size };
    const probe = quoteEventOf(top, at, blankContext());
    emit(line, quoteEventOf(top, at, envelopeContext(line, probe)));
  };

  /** Emit all outcomes of one engine submission (AFTER the engine state is committed). */
  const emitSubmission = (line: EpisodeLine, outcome: SubmitOutcome, at: TimestampMs): void => {
    if (isOrderAck(outcome.ack)) {
      const probe = orderAckEventOf(outcome.ack, blankContext());
      emit(line, orderAckEventOf(outcome.ack, envelopeContext(line, probe)));
    } else {
      const reject: OrderReject = outcome.ack;
      const probe = orderRejectEventOf(reject, blankContext());
      emit(line, orderRejectEventOf(reject, envelopeContext(line, probe)));
    }
    for (const fill of outcome.fills) {
      const probe = tradeEventOf(fill, blankContext());
      emit(line, tradeEventOf(fill, envelopeContext(line, probe)));
    }
    for (const cancel of outcome.cancels) {
      const probe = orderCancelEventOf(cancel, blankContext());
      emit(line, orderCancelEventOf(cancel, envelopeContext(line, probe)));
    }
    if (outcome.top_of_book_changed) {
      maybeEmitQuote(line, at);
    }
  };

  const service: ExchangeService = {
    get config(): ExchangeConfig {
      return validConfig;
    },
    get config_hash(): string {
      return configHashValue;
    },
    get world_id(): string {
      return worldId;
    },
    get episodes(): readonly string[] {
      return order.slice();
    },

    start(spec: unknown): ExchangeResult<ExchangeEpisodeView> {
      // 1. Validate the spec (mirrored collect-all).
      const specResult = validateEnvironmentSpec(spec);
      if (!specResult.ok) {
        return { ok: false, errors: specResult.errors.map((error) => ({ code: 'invalid_spec' as const, path: error.path, message: error.message })) };
      }
      const validSpec = specResult.value;

      // 2. Bind to THIS exchange world.
      if (validSpec.world.world_id !== worldId) {
        return fail('world_binding_mismatch', `spec.world.world_id "${validSpec.world.world_id}" does not name this exchange ("${worldId}")`, 'spec.world.world_id');
      }
      if (validSpec.world.kind !== 'exchange-sim') {
        return fail('world_binding_mismatch', `spec.world.kind "${validSpec.world.kind}" is not 'exchange-sim'`, 'spec.world.kind');
      }

      // 3. L5 mode discipline: the spec's fidelity must equal the config's
      //    (the engine serves reactive_replay / generative only).
      if (validSpec.profile.fidelity !== validConfig.fidelity) {
        return fail(
          'fidelity_mismatch',
          `spec.profile.fidelity '${validSpec.profile.fidelity}' disagrees with the exchange config's '${validConfig.fidelity}'`,
          'spec.profile.fidelity',
        );
      }

      // 4. Deterministic episode id and uniqueness.
      const episodeId = deriveEpisodeId(validSpec);
      if (registry.has(episodeId)) {
        return fail('duplicate_episode', `episode ${episodeId} is already registered — an episode id is a unique run; re-running a spec requires a fresh service or a distinct seed`);
      }

      // 5. Bind: a FRESH engine over the shared config + book seed, clock from the spec.
      const engineResult = createEngine(validConfig, { book_seed: bookSeed, start_at: validSpec.profile.clock.now });
      if (!engineResult.ok) return engineResult;
      const line: EpisodeLine = {
        spec: validSpec,
        episodeId,
        engine: engineResult.value,
        clock: validSpec.profile.clock,
        status: 'running',
        termination: null,
        events: [],
        acceptedActions: [],
        advances: [],
        sequences: new Map<string, number>(),
        eventCounter: 0,
        lastQuote: null,
      };
      registry.set(episodeId, line);
      order.push(episodeId);
      return ok(viewOf(line));
    },

    observe(episode: string, at: TimestampMs): ExchangeResult<readonly ExchangeObservation[]> {
      const found = lookup(episode);
      if (!found.ok) return found;
      const line = found.value;
      if (!isTimestampMs(at)) {
        return fail('invalid_timestamp', 'observe requires a valid TimestampMs instant');
      }
      if (at > line.clock.now) {
        return fail('observation_beyond_now', `cannot observe at ${at}: the episode's current now is ${line.clock.now}`);
      }
      // The INCLUSIVE L4 boundary: available_time <= at.
      return ok(line.events.map(observationOf).filter((observation) => observation.available_time <= at));
    },

    submit(episode: string, action: unknown): ExchangeResult<ExchangeSubmission> {
      const found = lookup(episode);
      if (!found.ok) return found;
      const line = found.value;
      if (line.status === 'finished') {
        return fail('episode_finished', `episode ${episode} is finished; actions are rejected`);
      }
      if (!isActionMirror(action)) {
        return fail('invalid_action', 'the action envelope must carry action_id, actor, submitted_at, client_sequence and a JSON payload');
      }
      const validAction = action;

      // Causal law (inclusive): an action may not claim submission after now.
      if (validAction.submitted_at > line.clock.now) {
        return fail('action_from_future', `action ${validAction.action_id} claims submission at ${validAction.submitted_at}, after the episode's now ${line.clock.now}`);
      }

      // Per-actor request ordering: strictly increasing client_sequence.
      let lastSequence: number | null = null;
      for (const accepted of line.acceptedActions) {
        if (accepted.actor === validAction.actor && (lastSequence === null || accepted.client_sequence > lastSequence)) {
          lastSequence = accepted.client_sequence;
        }
      }
      if (lastSequence !== null && validAction.client_sequence <= lastSequence) {
        return fail('stale_sequence', `action ${validAction.action_id} carries client_sequence ${validAction.client_sequence}, not greater than the actor's last accepted ${lastSequence}`);
      }

      // Action ids are unique per episode.
      if (line.acceptedActions.some((accepted) => accepted.action_id === validAction.action_id)) {
        return fail('duplicate_action', `action id "${validAction.action_id}" is already recorded in episode ${episode}`);
      }

      // Interpret the payload.
      const payloadResult = validateActionPayload(validAction.payload);
      if (!payloadResult.ok) return payloadResult;
      const payload = payloadResult.value;

      // The engine requires arrival >= engine.now (arrival order is
      // monotonic with the clock): a driver that advanced the episode
      // clock past the action's instant cannot retro-match. Typed
      // failure, honest and deterministic.
      if (validAction.submitted_at < line.engine.now) {
        return fail(
          'arrival_before_now',
          `action ${validAction.action_id} claims submission at ${validAction.submitted_at}, before the engine's clock ${line.engine.now} — the exchange matches in arrival order; submit at the current instant or advance later`,
        );
      }

      let outcome: SubmitOutcome | CancelOutcome;
      if (payload.type === 'submit_order') {
        const submitted = engineSubmit(line.engine, payload.intent, validAction.submitted_at);
        if (!submitted.ok) return submitted;
        outcome = submitted.value;
      } else if (payload.type === 'cancel_order') {
        const canceled = engineCancel(line.engine, { order_id: payload.order_id }, validAction.submitted_at);
        if (!canceled.ok) return canceled;
        outcome = canceled.value;
      } else {
        const canceled = engineCancel(line.engine, { client_order_id: payload.client_order_id }, validAction.submitted_at);
        if (!canceled.ok) return canceled;
        outcome = canceled.value;
      }

      // Commit the engine state FIRST, then emit (emission reads the new book).
      line.engine = outcome.state;
      if ('ack' in outcome) {
        emitSubmission(line, outcome, validAction.submitted_at);
      } else {
        const cancel: OrderCancelRecord = (outcome as CancelOutcome).cancel;
        const probe = orderCancelEventOf(cancel, blankContext());
        emit(line, orderCancelEventOf(cancel, envelopeContext(line, probe)));
        maybeEmitQuote(line, validAction.submitted_at);
      }
      line.acceptedActions.push(validAction);

      const intakeAck = 'ack' in outcome ? (outcome as SubmitOutcome).ack : null;
      const receipt: ExchangeReceipt = deepFreeze({
        receipt_id: `xrc-${episode}:${validAction.action_id}`,
        episode_id: episode,
        action_id: validAction.action_id,
        actor: validAction.actor,
        client_sequence: validAction.client_sequence,
        recorded_at: line.clock.now,
        disposition: 'engine_processed',
        outcome:
          intakeAck !== null
            ? {
                kind: isOrderAck(intakeAck) ? 'ack' : 'reject',
                order_id: intakeAck.order_id,
                status: isOrderAck(intakeAck) ? intakeAck.status : `rejected:${(intakeAck as OrderReject).reason}`,
                reject_reason: isOrderAck(intakeAck) ? null : (intakeAck as OrderReject).reason,
              }
            : {
                kind: 'ack',
                order_id: (outcome as CancelOutcome).cancel.order_id,
                status: `canceled:${(outcome as CancelOutcome).cancel.reason}`,
                reject_reason: null,
              },
        fill_count: 'fills' in outcome ? (outcome as SubmitOutcome).fills.length : 0,
      });

      return ok(deepFreeze({ ...viewOf(line), receipt }));
    },

    advance(episode: string, to: TimestampMs): ExchangeResult<ExchangeEpisodeView> {
      const found = lookup(episode);
      if (!found.ok) return found;
      const line = found.value;
      if (line.status === 'finished') {
        return fail('episode_finished', `episode ${episode} is finished; the clock is frozen`);
      }
      if (!isTimestampMs(to)) {
        return fail('invalid_timestamp', 'advance requires a valid TimestampMs target');
      }
      if (to < line.clock.now) {
        return fail('clock_regression', `the episode clock may not move backwards: now=${line.clock.now}, target=${to}`);
      }
      if (to > line.clock.asOf) {
        return fail('beyond_as_of', `the episode clock may not advance past asOf: asOf=${line.clock.asOf}, target=${to}`);
      }

      // Drive the engine (gtt expirations) and emit their events.
      const advanced = advanceEngine(line.engine, to);
      if (!advanced.ok) return advanced;
      line.engine = advanced.value.state;
      for (const expiration of advanced.value.expirations) {
        const probe = orderExpiredEventOf(expiration, blankContext());
        emit(line, orderExpiredEventOf(expiration, envelopeContext(line, probe)));
      }
      if (advanced.value.expirations.length > 0) {
        maybeEmitQuote(line, to);
      }
      const from = line.clock.now;
      line.clock = deepFreeze({ ...line.clock, now: to });
      line.advances.push({ from, to });
      return ok(viewOf(line));
    },

    finish(episode: string, reason: unknown): ExchangeResult<ExchangeEpisodeFinish> {
      const found = lookup(episode);
      if (!found.ok) return found;
      const line = found.value;
      if (line.status === 'finished') {
        return fail('episode_finished', `episode ${episode} is already finished`);
      }
      if (!isTerminationReason(reason)) {
        return fail('invalid_termination', 'the termination reason must be one of completed | terminal | step_limit | aborted with a non-empty detail');
      }
      line.status = 'finished';
      line.termination = reason;
      const view = viewOf(line);
      const result: ExchangeEpisodeResult = deepFreeze({
        episode_id: line.episodeId,
        environment_id: line.spec.profile.environment_id,
        spec: line.spec,
        termination: reason,
        final_now: line.clock.now,
        accepted_action_count: line.acceptedActions.length,
        pending_observation_count: view.pending.length,
        rewards: [],
      });
      return ok(deepFreeze({ episode: view, result }));
    },

    sessionRecord(episode: string): ExchangeResult<SessionRecord> {
      const found = lookup(episode);
      if (!found.ok) return found;
      const line = found.value;
      if (line.status !== 'finished' || line.termination === null) {
        return fail('episode_not_finished', 'the session record is only available for a finished episode');
      }
      return ok(buildSessionRecord(line, validConfig, configHashValue, bookSeedHash));
    },

    bookSnapshot(episode: string) {
      const found = lookup(episode);
      if (!found.ok) return found;
      return ok(bookSnapshotView(found.value.engine.book));
    },

    events(episode: string) {
      const found = lookup(episode);
      if (!found.ok) return found;
      return ok([...found.value.events] as readonly ExchangeEvent[]);
    },
  };

  return ok(service);
}

// ---------------------------------------------------------------------------
// Observation mapping + record assembly
// ---------------------------------------------------------------------------

/** Map an emitted event onto its delivery envelope (the payload IS the full event — forensic completeness). */
function observationOf(event: ExchangeEvent): ExchangeObservation {
  const component = event.provenance.adapter === null ? null : `${event.provenance.adapter.id}@${event.provenance.adapter.version}`;
  return deepFreeze({
    observation_id: event.event_id,
    available_time: event.available_time,
    venue: event.venue,
    instrument: event.instrument,
    payload: event as unknown as JsonValue,
    provenance: {
      origin: 'simulated' as const,
      source: component === null ? 'exchange-sim' : component,
      derived_from: [...event.provenance.derived_from],
    },
  });
}

/** Assemble the L9 session record for a finished episode. */
function buildSessionRecord(
  line: EpisodeLine,
  config: ExchangeConfig,
  configHashValue: string,
  bookSeedHash: string,
): SessionRecord {
  const orderLog: OrderLogEntry[] = line.engine.orders.map((record) => ({
    order_id: record.order_id,
    client_order_id: record.client_order_id,
    status: record.status,
    quantity: record.quantity,
    filled_quantity: record.filled_quantity,
    reject_reason: record.reject_reason,
    cancel_reason: record.cancel_reason,
    fill_ids: [...record.fill_ids],
  }));

  // The outcome stream hash: canonical JSON of every emitted event, in
  // emission order, folded once. Two identical runs -> identical hashes.
  const eventsJson = line.events.map((event) => canonicalJson(event as unknown as JsonValue)).join('\n');
  const outcomeStreamHash = fnv1a32Hex(eventsJson);

  const record: Omit<SessionRecord, 'digest'> = {
    schema: 'tradrl/exchange-session-record@1',
    session_id: line.episodeId,
    world: {
      world_id: `world-exchange-${configHashValue}`,
      venue: config.venue,
      instrument: config.instrument,
      asset_class: config.asset_class,
      config_hash: configHashValue,
      seed: config.seed,
      fidelity: config.fidelity,
      book_seed_hash: bookSeedHash,
    },
    episode: {
      episode_id: line.episodeId,
      environment_id: line.spec.profile.environment_id,
      spec_hash: fnv1a32Hex(canonicalSpecJson(line.spec)),
      termination: { code: line.termination.code, detail: line.termination.detail },
      final_now: line.clock.now,
    },
    order_log: orderLog,
    fill_log: [...line.engine.fills],
    counts: {
      events: line.events.length,
      fills: line.engine.fills.length,
      orders: line.engine.orders.length,
      rejects: line.engine.orders.filter((record) => record.status === 'rejected').length,
      cancels: line.engine.orders.filter(
        (record) =>
          record.cancel_reason === 'cancel_requested' ||
          record.cancel_reason === 'ioc_unfilled' ||
          record.cancel_reason === 'fok_unfilled' ||
          record.cancel_reason === 'market_order_unfilled_remainder',
      ).length,
      expirations: line.engine.orders.filter((record) => record.status === 'expired').length,
    },
    clock_timeline: [...line.advances],
    outcome_stream_hash: outcomeStreamHash,
  };
  const digest = fnv1a32Hex(canonicalJson(record as unknown as JsonValue));
  return deepFreeze({ ...record, digest });
}
