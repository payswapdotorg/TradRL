/**
 * @tradrl/market-world — typed errors and results.
 *
 * Contract packages never throw on untrusted input: validation collects ALL
 * violations and reports them as typed errors (the collect-all discipline of
 * `@tradrl/market-protocol` and `@tradrl/environment-protocol`), while state
 * transitions fail with a precise single cause. Both flow through the same
 * {@link WorldResult} shape: a failure carries a non-empty `errors` array.
 *
 * Error-shape note (deliberate, documented divergence): `WorldError` is
 * FIELD-SHAPE-identical to environment-protocol's `EnvError` and
 * market-protocol's `MarketProtocolError` (`code`/`path`/`message`), but the
 * code union is world-specific (the replay domain has failure modes —
 * `synthetic_event_rejected`, `sequence_regression`, `stream_not_selected`,
 * ... — that the episode protocol rightly does not name). Consumers switch on
 * `result.ok` identically; structural compatibility of the five-operation
 * surface is proven at runtime by environment-protocol's own `isEnvironment`
 * guard (see src/interop.test.ts).
 */

/** Machine-readable failure codes for market-world operations. */
export type WorldErrorCode =
  // --- generic envelope validation -----------------------------------------
  /** The root value is not an object/array where one is required. */
  | 'invalid_type'
  /** A required field is absent. */
  | 'missing_field'
  /** A field is present but violates the contract (empty string, bad shape, ...). */
  | 'invalid_field'
  /** A value is not a valid epoch-millisecond timestamp. */
  | 'invalid_timestamp'
  // --- world configuration --------------------------------------------------
  /** The world config is malformed (collect-all detail in `errors`). */
  | 'invalid_config'
  /** The requested fidelity mode is not implemented by the exact-replay world (L5). */
  | 'unsupported_fidelity'
  /** Two fidelity declarations disagree (spec vs profile vs clock vs config). */
  | 'fidelity_mismatch'
  /** Two information-policy declarations disagree. */
  | 'policy_mismatch'
  // --- stream ingestion (the stream IN) --------------------------------------
  /** An event envelope is malformed (collect-all detail in `errors`). */
  | 'invalid_event'
  /** An event id has already been applied to this world. */
  | 'duplicate_event'
  /** The event's (venue, instrument) is not part of the config stream selection. */
  | 'stream_not_selected'
  /** The event's `available_time` exceeds the world's `as_of` information anchor. */
  | 'event_beyond_as_of'
  /** A per-stream `sequence` equals the stream's applied high-water mark. */
  | 'duplicate_sequence'
  /** A per-stream `sequence` is lower than the stream's applied high-water mark. */
  | 'sequence_regression'
  /**
   * The event's provenance origin is not `historical`. The exact-replay world
   * accepts RECORDED HISTORY ONLY — synthetic origins are the reactive (T027)
   * and generative (T028) lanes (L5, anti-poisoning).
   */
  | 'synthetic_event_rejected'
  /** The world (or its stream source) is finished and accepts no more events. */
  | 'world_finished'
  /** The event source violates its contract (not async-iterable, non-array batch). */
  | 'invalid_source'
  // --- observation / time (the firewall) -------------------------------------
  /** An observation query is dated after the clock's current `now`. */
  | 'observation_beyond_now'
  /** The clock was moved backwards (time within a run is monotonic). */
  | 'clock_regression'
  /** The clock was advanced beyond its `asOf` information anchor. */
  | 'beyond_as_of'
  /** An episode spec's clock `asOf` exceeds the world config's `as_of` anchor. */
  | 'beyond_world_as_of'
  // --- episode protocol (structural mirror of the environment lane) ----------
  /** The environment spec is malformed (collect-all detail in `errors`). */
  | 'invalid_spec'
  /** The spec's `world.world_id` does not name this world. */
  | 'world_binding_mismatch'
  /** An episode id is already registered (an episode id is a unique run). */
  | 'duplicate_episode'
  /** The episode id is not known to this adapter/service. */
  | 'unknown_episode'
  /** The operation requires a running episode; this episode is finished. */
  | 'episode_finished'
  /** An action envelope is malformed (collect-all detail in `errors`). */
  | 'invalid_action'
  /** The action's `submitted_at` is after the episode's current `now`. */
  | 'action_from_future'
  /** The action's `client_sequence` is not strictly greater than the actor's last accepted. */
  | 'stale_sequence'
  /** An action id has already been accepted in this episode. */
  | 'duplicate_action'
  /** The termination reason is malformed (unknown code or empty detail). */
  | 'invalid_termination'
  /** The run record is only available for a finished episode. */
  | 'episode_not_finished'
  /** `start` was called before the event source was fully ingested. */
  | 'ingestion_pending'
  /** Ingestion was attempted after episodes bound to the world (the reference service closes the stream at first start). */
  | 'ingestion_closed'
  // --- serialization / resume -------------------------------------------------
  /** A serialized world/run state is malformed (collect-all detail in `errors`). */
  | 'invalid_state'
  /** A resumed stream does not match the recorded ingest chain. */
  | 'resume_stream_mismatch';

/** A single typed failure, located by a dotted field path (empty for whole-object errors). */
export interface WorldError {
  readonly code: WorldErrorCode;
  /** Dotted path from the validated root, e.g. `config.streams[2].venue`. Empty for transition-level errors. */
  readonly path: string;
  readonly message: string;
}

/** Operation outcome: either a value or a non-empty list of every violation found. */
export type WorldResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly WorldError[] };

/** Construct a single-error failure. */
export function fail<T = never>(code: WorldErrorCode, message: string, path = ''): WorldResult<T> {
  return { ok: false, errors: [{ code, message, path }] };
}

/** Construct a multi-error failure (validators collect every violation). */
export function failures<T = never>(errors: readonly WorldError[]): WorldResult<T> {
  if (errors.length === 0) {
    return { ok: false, errors: [{ code: 'invalid_type', message: 'unspecified failure', path: '' }] };
  }
  return { ok: false, errors };
}

/** Construct a success result. */
export function ok<T>(value: T): WorldResult<T> {
  return { ok: true, value };
}

/** A required field is absent (field-level error constructor shared by validators). */
export function missingField(path: string): WorldError {
  return { code: 'missing_field', path, message: `required field "${path}" is missing` };
}

/** A field is present but invalid (field-level error constructor shared by validators). */
export function invalidField(path: string, message: string): WorldError {
  return { code: 'invalid_field', path, message: `field "${path}": ${message}` };
}

/** The root value is not an object (whole-object error constructor). */
export function invalidType(message: string): WorldError {
  return { code: 'invalid_type', path: '', message };
}
