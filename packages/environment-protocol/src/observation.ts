/**
 * @tradrl/environment-protocol — the observation envelope and the L4
 * visibility boundary it carries.
 *
 * An Observation is the ONLY thing an environment ever hands an agent: the
 * environment mediates ALL observation delivery (T005's core law). The
 * envelope is opaque about semantics — market ticks, fills, news digests,
 * feature vectors and action results all ride the same shape — but it is
 * explicit about WHEN the payload may legitimately be seen:
 *
 *     An observation is visible at instant `at` iff
 *     `observation.available_time <= at`    (INCLUSIVE — L4).
 *
 * The boundary makes no exception for origin: `simulated` and `generated`
 * observations are withheld exactly like `historical` ones, and DERIVED
 * observations (non-empty `derived_from`) obey the same law as primitive
 * ones. `isObservationVisible` is the predicate; `visibleObservationsAt` is
 * the filter. This is the structural twin of time-engine's `isVisibleAt` /
 * `observableAt` over the mirrored `TimestampMs` — the firewall logic is
 * identical because the law is identical.
 *
 * Validation is TIMELESS (mirroring market-protocol's envelope contract): a
 * future-dated `available_time` is a VALID observation — an embargoed
 * release the environment must withhold until its instant. Withholding is
 * the boundary's job, never the validator's.
 */

import { deepFreeze, isRecord } from './primitives';
import { invalidField, invalidType, missingField, ok, type EnvError, type EnvResult } from './errors';
import { isTimestampMs, type TimestampMs } from './timestamp';
import type { InstrumentId, ObservationId, VenueId } from './ids';
import { isJsonValue, type JsonValue } from './json';
import {
  isObservationProvenance,
  validateObservationProvenance,
  type ObservationProvenance,
} from './provenance';

/**
 * The observation envelope (spec/DOMAIN-MODEL.md: Trajectory's "ordered
 * observations"; the environment-side twin of market-protocol's MarketEvent
 * availability discipline).
 */
export interface Observation {
  /** Opaque unique identifier within the episode. */
  readonly observation_id: ObservationId;
  /**
   * The earliest instant an agent may legitimately observe this payload.
   * THE information-boundary input (L4) — the ONLY timestamp the visibility
   * predicate consults. May be in the future (embargoed); validation never
   * compares it against "now".
   */
  readonly available_time: TimestampMs;
  /** Venue the observation is about, or `null` for non-venue observations (macro, environment-level signals). */
  readonly venue: VenueId | null;
  /** Instrument the observation is about, or `null` for non-instrument observations. */
  readonly instrument: InstrumentId | null;
  /** The opaque payload. JSON-safe by contract; semantics owned by the world (T009/T010) and consumers. */
  readonly payload: JsonValue;
  /** Provenance summary: origin trichotomy, producing source, lineage (see provenance.ts). */
  readonly provenance: ObservationProvenance;
}

/**
 * The minimal structural contract for anything the environment's boundary
 * can police (structural twin of time-engine's `Observable`).
 */
export interface Available {
  readonly available_time: TimestampMs;
}

/**
 * The boundary predicate itself (L4, inclusive): is `observation`
 * legitimately observable at instant `at`? An observation becomes visible
 * EXACTLY at its `available_time`, never one millisecond earlier.
 */
export function isObservationVisible<T extends Available>(observation: T, at: TimestampMs): boolean {
  return observation.available_time <= at;
}

/**
 * All members of `observations` that are observable at instant `at`
 * (preserves input order). Structural twin of time-engine's `observableAt`.
 */
export function visibleObservationsAt<T extends Available>(observations: readonly T[], at: TimestampMs): T[] {
  return observations.filter((observation) => isObservationVisible(observation, at));
}

/**
 * The withheld subset — the complement of {@link visibleObservationsAt}.
 * Useful for asserting no leak occurred at a given instant.
 */
export function withheldObservationsAt<T extends Available>(observations: readonly T[], at: TimestampMs): T[] {
  return observations.filter((observation) => !isObservationVisible(observation, at));
}

/** Runtime type guard for a structurally valid observation envelope. */
export function isObservation(value: unknown): value is Observation {
  if (!isRecord(value)) return false;
  if (typeof value.observation_id !== 'string' || value.observation_id.length === 0) return false;
  if (!isTimestampMs(value.available_time)) return false;
  if (value.venue !== null && !(typeof value.venue === 'string' && value.venue.length > 0)) return false;
  if (value.instrument !== null && !(typeof value.instrument === 'string' && value.instrument.length > 0)) return false;
  if (!isJsonValue(value.payload)) return false;
  if (!isObservationProvenance(value.provenance)) return false;
  return true;
}

/**
 * Collect-all validation of an untrusted observation envelope. Every
 * violation is reported with a dotted path; on success the value is
 * returned narrowed, deeply frozen. Unknown/extra fields are TOLERATED —
 * the contract is a forward-compatible floor (mirrors market-protocol).
 */
export function validateObservation(value: unknown, path = 'observation'): EnvResult<Observation> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: EnvError[] = [];

  if (value.observation_id === undefined) {
    errors.push(missingField(`${path}.observation_id`));
  } else if (typeof value.observation_id !== 'string' || value.observation_id.length === 0) {
    errors.push(invalidField(`${path}.observation_id`, 'must be a non-empty string'));
  }

  if (value.available_time === undefined) {
    errors.push(missingField(`${path}.available_time`));
  } else if (!isTimestampMs(value.available_time)) {
    errors.push(
      invalidField(`${path}.available_time`, 'must be an integer epoch-ms number within the representable range'),
    );
  }

  if (value.venue === undefined) {
    errors.push(missingField(`${path}.venue`));
  } else if (value.venue !== null && !(typeof value.venue === 'string' && value.venue.length > 0)) {
    errors.push(invalidField(`${path}.venue`, 'must be a non-empty string or null'));
  }

  if (value.instrument === undefined) {
    errors.push(missingField(`${path}.instrument`));
  } else if (value.instrument !== null && !(typeof value.instrument === 'string' && value.instrument.length > 0)) {
    errors.push(invalidField(`${path}.instrument`, 'must be a non-empty string or null'));
  }

  if (value.payload === undefined) {
    errors.push(missingField(`${path}.payload`));
  } else if (!isJsonValue(value.payload)) {
    errors.push(invalidField(`${path}.payload`, 'must be a JSON value (finite numbers only, no undefined/functions)'));
  }

  let provenance: ObservationProvenance | undefined;
  if (value.provenance === undefined) {
    errors.push(missingField(`${path}.provenance`));
  } else {
    const provenanceResult = validateObservationProvenance(value.provenance, String(value.observation_id ?? ''), `${path}.provenance`);
    if (provenanceResult.ok) {
      provenance = provenanceResult.value;
    } else {
      errors.push(...provenanceResult.errors);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return ok(
    deepFreeze({
      observation_id: value.observation_id as ObservationId,
      available_time: value.available_time as TimestampMs,
      venue: value.venue as VenueId | null,
      instrument: value.instrument as InstrumentId | null,
      payload: value.payload as JsonValue,
      provenance: provenance as ObservationProvenance,
    }),
  );
}
