/**
 * @tradrl/market-world (exchange service) — typed errors and results.
 *
 * The service-level failure modes (episode protocol, world binding, action
 * interpretation) extend the contract package's engine failure modes: the
 * union below is `ExchangeErrorCode` (everything the engine can fail an
 * operation with, which flows through `submit`/`advance` unchanged) plus
 * the service's own codes (mirroring the sibling lanes' vocabularies —
 * `unknown_episode`, `episode_finished`, `stale_sequence`, ...).
 *
 * Error-shape note (the sibling-lane discipline): `ServiceError` is
 * FIELD-SHAPE-identical to `ExchangeError`, `EnvError`, `WorldError` and
 * `MarketProtocolError` (`code`/`path`/`message`); consumers switch on
 * `result.ok` identically. Validation collects ALL violations; state
 * transitions fail with a precise single cause.
 */

import type { ExchangeErrorCode, ExchangeError, ExchangeResult } from '../../../../packages/exchange-sim/src/index';

/** Machine-readable failure codes for exchange-service operations (engine codes + service codes). */
export type ExchangeServiceErrorCode =
  | ExchangeErrorCode
  // --- episode protocol (structural mirror of the environment lane) ------
  | 'invalid_spec'
  | 'world_binding_mismatch'
  | 'duplicate_episode'
  | 'unknown_episode'
  | 'episode_finished'
  | 'invalid_action'
  | 'action_from_future'
  | 'stale_sequence'
  | 'duplicate_action'
  | 'observation_beyond_now'
  | 'beyond_as_of'
  | 'invalid_termination'
  | 'episode_not_finished';

/** A single typed failure, located by a dotted field path (empty for whole-object errors). */
export interface ServiceError {
  readonly code: ExchangeServiceErrorCode;
  readonly path: string;
  readonly message: string;
}

/** Operation outcome: either a value or a non-empty list of every violation found. */
export type ServiceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly ServiceError[] };

/** Construct a single-error failure. */
export function fail<T = never>(code: ExchangeServiceErrorCode, message: string, path = ''): ServiceResult<T> {
  return { ok: false, errors: [{ code, message, path }] };
}

/** Construct a success result. */
export function ok<T>(value: T): ServiceResult<T> {
  return { ok: true, value };
}

/** Lift engine errors into the service taxonomy (field-shape-identical; codes are a subset union). */
export function liftEngineError<T>(result: ExchangeResult<T>): ServiceResult<T> {
  if (result.ok) return { ok: true, value: result.value };
  return { ok: false, errors: result.errors.map((error: ExchangeError): ServiceError => ({ code: error.code, path: error.path, message: error.message })) };
}
