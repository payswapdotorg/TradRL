/**
 * @tradrl/environment-protocol — the environment profile.
 *
 * The EnvironmentProfile is the shape a Possession references by opaque id
 * (spec/DOMAIN-MODEL.md: "BodyVersion + CognitiveSubstrate + adapter +
 * runtime profile + environment profile + policy bundle"). It bundles every
 * environment-side knob an episode needs:
 *
 *   - `fidelity`: the L5 world-fidelity mode — one of the three DISTINCT
 *     modes, never aliased. MUST equal `clock.fidelity` (coherence is
 *     enforced: a profile cannot claim one fidelity while its clock
 *     carries another).
 *   - `clock`: the initial `ClockConfig` (structural mirror of
 *     time-engine's SimulationClock) — now/asOf/playbackSpeed/paused/
 *     fidelity/informationPolicy.
 *   - `seed`: the opaque deterministic seed. Together with the clock
 *     config and the world reference it FULLY determines the
 *     observation/action stream given the same inputs (L9).
 *   - `venue_scope` / `instrument_scope`: the observation universe, by
 *     OPAQUE ids (cross-lane references — no venue or instrument semantics
 *     leak into this package). May be empty (news-only / macro worlds are
 *     legal); ids must be unique.
 *   - `latency_policy` / `fee_policy`: opaque references to
 *     exchange-simulation policy records owned by T010. `null` = the
 *     environment declares no such policy (e.g. pure replay worlds).
 */

import { deepFreeze, isNonEmptyString, isRecord } from './primitives';
import { invalidField, invalidType, missingField, ok, type EnvError, type EnvResult } from './errors';
import type { EnvironmentId, FeePolicyId, InstrumentId, LatencyPolicyId, Seed, VenueId } from './ids';
import { isEnvironmentId, isFeePolicyId, isInstrumentId, isLatencyPolicyId, isSeed, isVenueId } from './ids';
import { isFidelityMode, isClockConfig, validateClockConfig, type ClockConfig, type FidelityMode } from './clock';

/** The environment profile (see module header). */
export interface EnvironmentProfile {
  readonly environment_id: EnvironmentId;
  readonly fidelity: FidelityMode;
  readonly clock: ClockConfig;
  readonly seed: Seed;
  readonly venue_scope: readonly VenueId[];
  readonly instrument_scope: readonly InstrumentId[];
  readonly latency_policy: LatencyPolicyId | null;
  readonly fee_policy: FeePolicyId | null;
}

/** Runtime type guard for a structurally valid environment profile. */
export function isEnvironmentProfile(value: unknown): value is EnvironmentProfile {
  if (!isRecord(value)) return false;
  if (!isEnvironmentId(value.environment_id)) return false;
  if (!isFidelityMode(value.fidelity)) return false;
  if (!isClockConfig(value.clock)) return false;
  if (!isSeed(value.seed)) return false;
  if (!Array.isArray(value.venue_scope)) return false;
  const venueScope = value.venue_scope as readonly unknown[];
  if (!venueScope.every((venue) => isVenueId(venue))) return false;
  if (!Array.isArray(value.instrument_scope)) return false;
  const instrumentScope = value.instrument_scope as readonly unknown[];
  if (!instrumentScope.every((instrument) => isInstrumentId(instrument))) return false;
  if (value.latency_policy !== null && !isLatencyPolicyId(value.latency_policy)) return false;
  if (value.fee_policy !== null && !isFeePolicyId(value.fee_policy)) return false;
  if (value.clock.fidelity !== value.fidelity) return false;
  if (venueScope.some((venue, index) => venueScope.indexOf(venue) !== index)) return false;
  if (instrumentScope.some((instrument, index) => instrumentScope.indexOf(instrument) !== index)) return false;
  return true;
}

/**
 * Collect-all validation of an untrusted environment profile. Enforces the
 * fidelity coherence rule (`profile.fidelity === profile.clock.fidelity`)
 * and scope uniqueness. On success the value is returned narrowed, deeply
 * frozen.
 */
export function validateEnvironmentProfile(value: unknown, path = 'profile'): EnvResult<EnvironmentProfile> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: EnvError[] = [];

  if (value.environment_id === undefined) {
    errors.push(missingField(`${path}.environment_id`));
  } else if (!isNonEmptyString(value.environment_id)) {
    errors.push(invalidField(`${path}.environment_id`, 'must be a non-empty string'));
  }

  if (value.fidelity === undefined) {
    errors.push(missingField(`${path}.fidelity`));
  } else if (!isFidelityMode(value.fidelity)) {
    errors.push(invalidField(`${path}.fidelity`, `must be one of ${'exact_replay | reactive_replay | generative'}`));
  }

  let clock: ClockConfig | undefined;
  if (value.clock === undefined) {
    errors.push(missingField(`${path}.clock`));
  } else {
    const clockResult = validateClockConfig(value.clock, `${path}.clock`);
    if (clockResult.ok) {
      clock = clockResult.value;
    } else {
      errors.push(...clockResult.errors);
    }
  }

  if (value.seed === undefined) {
    errors.push(missingField(`${path}.seed`));
  } else if (!isNonEmptyString(value.seed)) {
    errors.push(invalidField(`${path}.seed`, 'must be a non-empty string'));
  }

  if (value.venue_scope === undefined) {
    errors.push(missingField(`${path}.venue_scope`));
  } else if (!Array.isArray(value.venue_scope)) {
    errors.push(invalidField(`${path}.venue_scope`, 'must be an array of venue ids'));
  } else {
    const venueScope = value.venue_scope as readonly unknown[];
    if (!venueScope.every((venue) => isNonEmptyString(venue))) {
      errors.push(invalidField(`${path}.venue_scope`, 'every venue id must be a non-empty string'));
    } else if (venueScope.some((venue, index) => venueScope.indexOf(venue) !== index)) {
      errors.push(invalidField(`${path}.venue_scope`, `duplicate venue id "${String(venueScope.find((v, i) => venueScope.indexOf(v) !== i))}" in scope`));
    }
  }

  if (value.instrument_scope === undefined) {
    errors.push(missingField(`${path}.instrument_scope`));
  } else if (!Array.isArray(value.instrument_scope)) {
    errors.push(invalidField(`${path}.instrument_scope`, 'must be an array of instrument ids'));
  } else {
    const instrumentScope = value.instrument_scope as readonly unknown[];
    if (!instrumentScope.every((instrument) => isNonEmptyString(instrument))) {
      errors.push(invalidField(`${path}.instrument_scope`, 'every instrument id must be a non-empty string'));
    } else if (instrumentScope.some((instrument, index) => instrumentScope.indexOf(instrument) !== index)) {
      errors.push(
        invalidField(
          `${path}.instrument_scope`,
          `duplicate instrument id "${String(instrumentScope.find((v, i) => instrumentScope.indexOf(v) !== i))}" in scope`,
        ),
      );
    }
  }

  if (value.latency_policy === undefined) {
    errors.push(missingField(`${path}.latency_policy`));
  } else if (value.latency_policy !== null && !isNonEmptyString(value.latency_policy)) {
    errors.push(invalidField(`${path}.latency_policy`, 'must be a non-empty string or null'));
  }

  if (value.fee_policy === undefined) {
    errors.push(missingField(`${path}.fee_policy`));
  } else if (value.fee_policy !== null && !isNonEmptyString(value.fee_policy)) {
    errors.push(invalidField(`${path}.fee_policy`, 'must be a non-empty string or null'));
  }

  // Fidelity coherence: the profile's fidelity mode IS the clock's fidelity mode.
  if (
    errors.length === 0 &&
    clock !== undefined &&
    isFidelityMode(value.fidelity) &&
    value.fidelity !== clock.fidelity
  ) {
    errors.push({
      code: 'fidelity_mismatch',
      path: `${path}.fidelity`,
      message: `profile.fidelity (${String(value.fidelity)}) must equal profile.clock.fidelity (${clock.fidelity})`,
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  return ok(
    deepFreeze({
      environment_id: value.environment_id as EnvironmentId,
      fidelity: value.fidelity as FidelityMode,
      clock: clock as ClockConfig,
      seed: value.seed as Seed,
      venue_scope: (value.venue_scope as readonly VenueId[]).slice(),
      instrument_scope: (value.instrument_scope as readonly InstrumentId[]).slice(),
      latency_policy: value.latency_policy as LatencyPolicyId | null,
      fee_policy: value.fee_policy as FeePolicyId | null,
    }),
  );
}
