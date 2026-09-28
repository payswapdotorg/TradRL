/**
 * @tradrl/exchange-sim — the latency model (deterministic injected delay).
 *
 * L6 FIDELITY DECLARATION — `LATENCY_FIDELITY` is a first-class export; a
 * dedicated test asserts it exists:
 *
 * MODELED:
 *   - a deterministic delay injected between an exchange outcome's event
 *     instant and its availability instant: `available_time = event_time +
 *     delay`. The delay is a PURE function of (latency config, seed,
 *     domain, ordinal) — counter-keyed hashing, no mutable RNG state, no
 *     Math.random, no Date.now, so the same inputs always produce the same
 *     delay (L9).
 *   - two shapes: `fixed` (one constant delay) and `uniform` (a delay
 *     drawn deterministically from [min_ms, max_ms]).
 *
 * DECLARED LIMITATIONS:
 *   - the delay is INFORMATION latency (when an outcome may be observed),
 *     not MATCHING latency: orders are matched instantaneously at their
 *     arrival instant — venue processing/queueing time before a match is
 *     not modeled;
 *   - per-order delays are drawn from the 'order' domain, per-fill trade
 *     reports from the 'fill' domain (decorrelated by domain name); no
 *     cross-order correlation structure, no heavy-tailed distributions;
 *   - latency applies to ORDER OUTCOMES (acks, rejects, fills, cancels,
 *     expirations) only — the market-data view (quotes/book) is assumed
 *     observable at its event instant (no feed latency modeled).
 */

import { deepFreeze, isRecord } from './primitives';
import { invalidField, invalidType, missingField, ok, type ExchangeError, type ExchangeResult } from './errors';

// ---------------------------------------------------------------------------
// The fidelity declaration (L6 — asserted to exist by tests)
// ---------------------------------------------------------------------------

/** The explicit L6 fidelity declaration of the latency model. */
export const LATENCY_FIDELITY = deepFreeze({
  modeled: [
    'deterministic injected delay between an outcome event instant and its availability instant (available_time = event_time + delay)',
    'delay is a pure function of (config, seed, domain, ordinal) — counter-keyed hashing, no mutable RNG state',
    'fixed and uniform (min/max) delay shapes',
  ],
  declared_limitations: [
    'information latency only — matching itself is instantaneous at the arrival instant (no venue processing/queueing time before a match)',
    "per-order draws come from the 'order' domain, per-fill trade reports from the 'fill' domain; no cross-order correlation, no heavy tails",
    'order-outcome latency only — the market-data view (quotes/book snapshots) carries no feed latency',
  ],
} as const);

// ---------------------------------------------------------------------------
// The configuration
// ---------------------------------------------------------------------------

/** The delay shape: one constant delay, or a deterministic uniform draw in [min_ms, max_ms]. */
export type LatencyConfig =
  | { readonly kind: 'fixed'; readonly fixed_ms: number }
  | { readonly kind: 'uniform'; readonly min_ms: number; readonly max_ms: number };

/** Runtime guard for a structurally valid latency config. */
export function isLatencyConfig(value: unknown): value is LatencyConfig {
  if (!isRecord(value)) return false;
  if (value.kind === 'fixed') {
    return typeof value.fixed_ms === 'number' && Number.isSafeInteger(value.fixed_ms) && value.fixed_ms >= 0;
  }
  if (value.kind === 'uniform') {
    return (
      typeof value.min_ms === 'number' &&
      Number.isSafeInteger(value.min_ms) &&
      value.min_ms >= 0 &&
      typeof value.max_ms === 'number' &&
      Number.isSafeInteger(value.max_ms) &&
      value.max_ms >= value.min_ms
    );
  }
  return false;
}

/**
 * Collect-all validation of an untrusted latency config. On success the
 * value is returned narrowed, deeply frozen.
 */
export function validateLatencyConfig(value: unknown, path = 'latency'): ExchangeResult<LatencyConfig> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: ExchangeError[] = [];

  if (value.kind === undefined) {
    errors.push(missingField(`${path}.kind`));
  } else if (value.kind !== 'fixed' && value.kind !== 'uniform') {
    errors.push(invalidField(`${path}.kind`, "must be 'fixed' or 'uniform'"));
  } else if (value.kind === 'fixed') {
    if (value.fixed_ms === undefined) {
      errors.push(missingField(`${path}.fixed_ms`));
    } else if (typeof value.fixed_ms !== 'number' || !Number.isSafeInteger(value.fixed_ms) || value.fixed_ms < 0) {
      errors.push(invalidField(`${path}.fixed_ms`, 'must be a non-negative safe integer of milliseconds'));
    }
  } else {
    if (value.min_ms === undefined) {
      errors.push(missingField(`${path}.min_ms`));
    } else if (typeof value.min_ms !== 'number' || !Number.isSafeInteger(value.min_ms) || value.min_ms < 0) {
      errors.push(invalidField(`${path}.min_ms`, 'must be a non-negative safe integer of milliseconds'));
    }
    if (value.max_ms === undefined) {
      errors.push(missingField(`${path}.max_ms`));
    } else if (typeof value.max_ms !== 'number' || !Number.isSafeInteger(value.max_ms) || value.max_ms < 0) {
      errors.push(invalidField(`${path}.max_ms`, 'must be a non-negative safe integer of milliseconds'));
    }
    if (
      errors.length === 0 &&
      typeof value.min_ms === 'number' &&
      typeof value.max_ms === 'number' &&
      value.max_ms < value.min_ms
    ) {
      errors.push(invalidField(`${path}.max_ms`, `must be >= min_ms (${String(value.min_ms)})`));
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return ok(
    deepFreeze(
      value.kind === 'fixed'
        ? { kind: 'fixed', fixed_ms: value.fixed_ms as number }
        : { kind: 'uniform', min_ms: value.min_ms as number, max_ms: value.max_ms as number },
    ),
  );
}

// ---------------------------------------------------------------------------
// The deterministic delay derivation
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit hash of a string (the canonical TradRL derivation, mirrored). */
function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * The splitmix32 finalizer over a 32-bit key — a well-distributed
 * deterministic avalanche used as the counter-keyed draw. Pure: same key,
 * same 32-bit output, on every platform.
 */
function splitmix32(key: number): number {
  let state = key >>> 0;
  state = (state + 0x9e3779b9) >>> 0;
  let mixed = state;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x21f0aaad);
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x735a2d97);
  mixed = (mixed ^ (mixed >>> 15)) >>> 0;
  return mixed;
}

/**
 * The deterministic delay (in whole milliseconds) of one outcome.
 * Pure function of the config, the seed, the outcome domain and the
 * ordinal: `delay = f(config, seed, domain, ordinal)`. Fixed configs
 * return their constant; uniform configs draw deterministically from
 * [min_ms, max_ms] via a counter-keyed hash (draw domain and ordinal into
 * the key, so no mutable state and no cross-domain correlation).
 */
export function latencyDelayMs(config: LatencyConfig, seed: string, domain: string, ordinal: number): number {
  if (config.kind === 'fixed') return config.fixed_ms;
  const span = config.max_ms - config.min_ms;
  if (span === 0) return config.min_ms;
  const key = fnv1a32(`${seed}:${domain}:${ordinal}`);
  const draw = splitmix32(key) / 0x1_0000_0000; // [0, 1)
  return config.min_ms + Math.floor(draw * (span + 1));
}
