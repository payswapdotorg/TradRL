/**
 * @tradrl/environment-protocol — the environment spec and its canonical form.
 *
 * An {@link EnvironmentSpec} FULLY determines an environment instance
 * (L9: reproducible lineage): the profile (fidelity, clock config, seed,
 * scope, policy refs) plus the world reference plus the information policy.
 * Given the same spec and the same actor inputs, the observation/action
 * stream is deterministic — this is the property T009 (replay worlds),
 * T013 (RL) and T014 (distributed episode generation) build on.
 *
 * Determinism needs a canonical form: {@link canonicalSpecJson} serializes a
 * validated spec with recursively sorted object keys, so equal specs always
 * produce byte-identical canonical JSON regardless of field order at
 * construction. {@link deriveEpisodeId} folds that canonical form into a
 * stable episode id (FNV-1a 32-bit): the same spec always yields the same
 * episode id, and any seed change yields a different one.
 */

import { deepFreeze, isNonEmptyString, isRecord } from './primitives';
import { invalidField, invalidType, missingField, ok, type EnvError, type EnvResult } from './errors';
import type { EpisodeId, WorldId } from './ids';
import { isWorldId } from './ids';
import { isInformationPolicy, type InformationPolicy } from './clock';
import { isEnvironmentProfile, validateEnvironmentProfile, type EnvironmentProfile } from './profile';
import type { JsonValue } from './json';

/**
 * Reference to the MarketWorld an environment spec binds to. `world_id` is
 * an opaque id (world registry/dataset identity, owned by T009/T010);
 * `kind` is an opaque implementation hint (e.g. 'stub', 'replay',
 * 'exchange-sim') — the world taxonomy belongs to the world lanes, so this
 * package deliberately declares NO enum here.
 */
export interface WorldRef {
  readonly world_id: WorldId;
  readonly kind: string;
}

/** The fully-determining environment specification (see module header). */
export interface EnvironmentSpec {
  readonly profile: EnvironmentProfile;
  readonly world: WorldRef;
  readonly information_policy: InformationPolicy;
}

/** Runtime type guard for a world reference. */
export function isWorldRef(value: unknown): value is WorldRef {
  if (!isRecord(value)) return false;
  return isWorldId(value.world_id) && isNonEmptyString(value.kind);
}

/** Runtime type guard for a structurally valid environment spec. */
export function isEnvironmentSpec(value: unknown): value is EnvironmentSpec {
  if (!isRecord(value)) return false;
  if (!isEnvironmentProfile(value.profile)) return false;
  if (!isWorldRef(value.world)) return false;
  if (!isInformationPolicy(value.information_policy)) return false;
  const profile = value.profile as Record<string, unknown>;
  const clock = isRecord(profile.clock) ? (profile.clock as Record<string, unknown>) : null;
  if (!clock || clock.informationPolicy !== value.information_policy) return false;
  return true;
}

/**
 * Collect-all validation of an untrusted environment spec. Enforces the
 * policy coherence rule (`spec.information_policy === profile.clock.
 * informationPolicy`). On success the value is returned narrowed, deeply
 * frozen.
 */
export function validateEnvironmentSpec(value: unknown, path = 'spec'): EnvResult<EnvironmentSpec> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: EnvError[] = [];

  let profile: EnvironmentProfile | undefined;
  if (value.profile === undefined) {
    errors.push(missingField(`${path}.profile`));
  } else {
    const profileResult = validateEnvironmentProfile(value.profile, `${path}.profile`);
    if (profileResult.ok) {
      profile = profileResult.value;
    } else {
      errors.push(...profileResult.errors);
    }
  }

  let world: WorldRef | undefined;
  if (value.world === undefined) {
    errors.push(missingField(`${path}.world`));
  } else if (!isWorldRef(value.world)) {
    if (!isRecord(value.world)) {
      errors.push(invalidField(`${path}.world`, 'must be an object with world_id and kind'));
    } else if (!isNonEmptyString((value.world as Record<string, unknown>).world_id)) {
      errors.push(invalidField(`${path}.world.world_id`, 'must be a non-empty string'));
    } else {
      errors.push(invalidField(`${path}.world.kind`, 'must be a non-empty string'));
    }
  } else {
    world = value.world;
  }

  if (value.information_policy === undefined) {
    errors.push(missingField(`${path}.information_policy`));
  } else if (!isInformationPolicy(value.information_policy)) {
    errors.push(invalidField(`${path}.information_policy`, "must be 'point-in-time'"));
  }

  // Policy coherence: the spec's policy IS the clock's policy.
  if (
    errors.length === 0 &&
    profile !== undefined &&
    isInformationPolicy(value.information_policy) &&
    value.information_policy !== profile.clock.informationPolicy
  ) {
    errors.push({
      code: 'policy_mismatch',
      path: `${path}.information_policy`,
      message: `spec.information_policy (${String(value.information_policy)}) must equal profile.clock.informationPolicy (${profile.clock.informationPolicy})`,
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  return ok(
    deepFreeze({
      profile: profile as EnvironmentProfile,
      world: deepFreeze({ world_id: (world as WorldRef).world_id, kind: (world as WorldRef).kind }),
      information_policy: value.information_policy as InformationPolicy,
    }),
  );
}

// ---------------------------------------------------------------------------
// Canonical serialization and deterministic episode ids
// ---------------------------------------------------------------------------

/**
 * Canonical JSON serialization of any JSON value: object keys recursively
 * sorted (code-unit order), arrays in order, strings via `JSON.stringify`,
 * finite numbers via `String`. Equal JSON values always serialize
 * byte-identically.
 */
export function canonicalJson(value: JsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return String(value); // finite by the JSON model
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map((element) => canonicalJson(element)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

/**
 * Canonical JSON of a validated environment spec. Field order at
 * construction is irrelevant: equal specs produce identical bytes. This is
 * the lineage anchor for L9 (T011 trajectories bind it; T014 workers hash
 * it into shard keys).
 */
export function canonicalSpecJson(spec: EnvironmentSpec): string {
  // A validated spec is structurally a JsonValue (every field is a JSON
  // primitive, a branded string, or a nested record/array of such), so the
  // canonical serializer accepts it without conversion.
  const canonical: JsonValue = spec;
  return canonicalJson(canonical);
}

/** FNV-1a 32-bit hash of a string, as zero-padded lowercase hex. */
function fnv1a32Hex(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Derive the episode id of a spec deterministically:
 * `ep-<fnv1a32(canonicalSpecJson(spec))>`. The same spec always yields the
 * same episode id (same run shape, L9); changing the seed (or any other
 * field) yields a different id. 32 bits are sufficient for reference-grade
 * collision resistance within a laboratory's episode population; consumers
 * needing stronger guarantees may mint their own ids — but then they, not
 * the protocol, own the determinism argument.
 */
export function deriveEpisodeId(spec: EnvironmentSpec): EpisodeId {
  return `ep-${fnv1a32Hex(canonicalSpecJson(spec))}` as EpisodeId;
}
