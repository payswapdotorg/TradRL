/**
 * @tradrl/environment-protocol — typed errors and results.
 *
 * Contract packages never throw on untrusted input: validation collects ALL
 * violations and reports them as typed errors (the collect-all discipline of
 * `@tradrl/market-protocol`), while state transitions fail with a precise
 * single cause. Both flow through the same {@link EnvResult} shape: a
 * failure carries a non-empty `errors` array.
 */

/** Machine-readable failure codes for environment-protocol operations. */
export type EnvErrorCode =
  /** The root value is not an object where an object is required. */
  | 'invalid_type'
  /** A required field is absent. */
  | 'missing_field'
  /** A field is present but violates the contract (empty string, bad timestamp, non-JSON payload, ...). */
  | 'invalid_field'
  /** A timestamp is outside the representable range or not an integer epoch-ms number. */
  | 'invalid_timestamp'
  /** The `EnvironmentSpec` (or a nested profile/world reference) is malformed. */
  | 'invalid_spec'
  /** The profile's fidelity mode disagrees with its clock's fidelity mode. */
  | 'fidelity_mismatch'
  /** The spec's information policy disagrees with the clock's information policy. */
  | 'policy_mismatch'
  /** An observation envelope is malformed. */
  | 'invalid_observation'
  /** An observation id is already present in the episode (ids are unique per episode). */
  | 'duplicate_observation'
  /** An action envelope is malformed. */
  | 'invalid_action'
  /** The action's `client_sequence` is not strictly greater than the actor's last accepted sequence. */
  | 'stale_sequence'
  /** The action's `submitted_at` is after the episode's current `now` (no time travel on the action side). */
  | 'action_from_future'
  /** A reward signal is malformed. */
  | 'invalid_reward'
  /** A reward id is already present in the episode. */
  | 'duplicate_reward'
  /** A reward signal names a different episode than the one it is emitted into. */
  | 'reward_episode_mismatch'
  /** A reward signal's `available_time` precedes its `at` instant. */
  | 'reward_time_order'
  /** An observation query is dated after the episode's current `now`. */
  | 'observation_beyond_now'
  /** The episode was advanced backwards (time within an episode is monotonic). */
  | 'clock_regression'
  /** The episode was advanced beyond its `asOf` information anchor. */
  | 'beyond_as_of'
  /** The operation requires a running episode; this episode is finished. */
  | 'episode_finished'
  /** The episode id is not known to the mediating store/environment. */
  | 'unknown_episode'
  /** The termination reason is malformed (unknown code or empty detail). */
  | 'invalid_termination'
  /** A value does not structurally satisfy the `Environment` interface. */
  | 'invalid_environment';

/** A single typed failure, located by a dotted field path (empty for whole-object errors). */
export interface EnvError {
  readonly code: EnvErrorCode;
  /** Dotted path from the validated root, e.g. `profile.clock.asOf`. Empty for transition-level errors. */
  readonly path: string;
  readonly message: string;
}

/** Operation outcome: either a value or a non-empty list of every violation found. */
export type EnvResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly EnvError[] };

/** Construct a single-error failure. */
export function fail<T = never>(code: EnvErrorCode, message: string, path = ''): EnvResult<T> {
  return { ok: false, errors: [{ code, message, path }] };
}

/** Construct a multi-error failure (validators collect every violation). */
export function failures<T = never>(errors: readonly EnvError[]): EnvResult<T> {
  if (errors.length === 0) {
    return { ok: false, errors: [{ code: 'invalid_type', message: 'unspecified failure', path: '' }] };
  }
  return { ok: false, errors };
}

/** Construct a success result. */
export function ok<T>(value: T): EnvResult<T> {
  return { ok: true, value };
}

/** A required field is absent (field-level error constructor shared by validators). */
export function missingField(path: string): EnvError {
  return { code: 'missing_field', path, message: `required field "${path}" is missing` };
}

/** A field is present but invalid (field-level error constructor shared by validators). */
export function invalidField(path: string, message: string): EnvError {
  return { code: 'invalid_field', path, message: `field "${path}": ${message}` };
}

/** The root value is not an object (whole-object error constructor). */
export function invalidType(message: string): EnvError {
  return { code: 'invalid_type', path: '', message };
}
