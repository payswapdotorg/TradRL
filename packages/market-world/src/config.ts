/**
 * @tradrl/market-world — the WorldMode contract and the replay world config.
 *
 * L5 MODE DISCIPLINE (ARCHITECTURE-LOCK "Explicit world fidelity"):
 *
 *   - The TYPE admits all three distinct fidelity modes
 *     (`exact_replay | reactive_replay | generative`) — the contract is the
 *     shared vocabulary of the whole world lane.
 *   - THIS package implements EXACT HISTORICAL REPLAY ONLY. The runtime
 *     entry point {@link initReplayWorld} (state.ts) rejects any fidelity
 *     other than `'exact_replay'` with `unsupported_fidelity`: reactive
 *     replay (endogenous participants) is T027's territory and generative
 *     worlds are T028's. The mode is a FIRST-CLASS field on the config, the
 *     clock, and every episode spec that binds to this world — never an
 *     ambient assumption.
 *
 * The world config fully determines the replay universe together with the
 * event stream (L9): the seed (any choice the fixtures make is seeded), the
 * stream selection (which (venue, instrument) pairs this world carries), and
 * the `as_of` information anchor (the latest instant the world's recorded
 * information set covers — events with `available_time > as_of` are rejected
 * at ingestion with `event_beyond_as_of`).
 */

import { deepFreeze, isFiniteNumber, isNonEmptyString, isRecord } from './primitives';
import { invalidField, invalidType, missingField, ok, type WorldError, type WorldResult } from './errors';
import { isTimestampMs, type TimestampMs } from './timestamp';
import type { FidelityMode, InformationPolicy } from './clock';
import { isFidelityMode, isInformationPolicy } from './clock';
import type { InstrumentId, Seed, VenueId, WorldId } from './ids';
import { isInstrumentId, isSeed, isVenueId, isWorldId } from './ids';
import { canonicalJson, fnv1a32Hex } from './env-mirror';
import type { JsonValue } from './json';

/**
 * The world mode: fidelity (one of the three DISTINCT L5 modes) plus the
 * information policy in force. A first-class declaration every world
 * carries — see module header.
 */
export interface WorldMode {
  readonly fidelity: FidelityMode;
  readonly informationPolicy: InformationPolicy;
}

/** Runtime guard for a world mode. */
export function isWorldMode(value: unknown): value is WorldMode {
  if (!isRecord(value)) return false;
  return isFidelityMode(value.fidelity) && isInformationPolicy(value.informationPolicy);
}

/**
 * One selected event stream: a (venue, instrument) pair. The world accepts
 * events ONLY from selected pairs (`stream_not_selected` otherwise) — the
 * stream selection IS the world's declared data universe.
 */
export interface StreamSelection {
  readonly venue: VenueId;
  readonly instrument: InstrumentId;
}

/** Runtime guard for a stream selection. */
export function isStreamSelection(value: unknown): value is StreamSelection {
  if (!isRecord(value)) return false;
  return isVenueId(value.venue) && isInstrumentId(value.instrument);
}

/** The stream scope key of a selection: `venue|instrument`. */
export function streamSelectionKey(selection: StreamSelection): string {
  return `${selection.venue}|${selection.instrument}`;
}

/**
 * The replay world configuration. Fully determining (with the event stream)
 * of the world state timeline and observation stream (L9):
 *
 * - `world_id` — the identity episodes bind to via their spec's
 *   `world.world_id` (`world_binding_mismatch` otherwise).
 * - `fidelity` — the L5 mode; the TYPE admits all three, the exact-replay
 *   implementation admits only `'exact_replay'`.
 * - `information_policy` — `'point-in-time'` (single variant; the boundary
 *   is the law, L4).
 * - `seed` — opaque deterministic seed, hashed into the config digest.
 * - `as_of` — the information anchor: ingestion rejects
 *   `available_time > as_of`, and no episode clock may anchor beyond it.
 * - `streams` — the stream selection (at least one pair; unique pairs).
 * - `playback_speed` — optional positive finite multiplier (default 1).
 */
export interface ReplayWorldConfig {
  readonly world_id: WorldId;
  readonly fidelity: FidelityMode;
  readonly information_policy: InformationPolicy;
  readonly seed: Seed;
  readonly as_of: TimestampMs;
  readonly streams: readonly StreamSelection[];
  readonly playback_speed: number;
}

/**
 * Collect-all validation of an untrusted world config. The fidelity field is
 * validated against all three L5 modes here (the contract admits them all);
 * the exact-replay IMPLEMENTATION enforces `'exact_replay'` at
 * {@link initReplayWorld} (state.ts) — see module header for the discipline.
 */
export function validateWorldConfig(value: unknown, path = 'config'): WorldResult<ReplayWorldConfig> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: WorldError[] = [];

  if (value.world_id === undefined) {
    errors.push(missingField(`${path}.world_id`));
  } else if (!isNonEmptyString(value.world_id)) {
    errors.push(invalidField(`${path}.world_id`, 'must be a non-empty string'));
  }

  if (value.fidelity === undefined) {
    errors.push(missingField(`${path}.fidelity`));
  } else if (!isFidelityMode(value.fidelity)) {
    errors.push(invalidField(`${path}.fidelity`, `must be one of ${'exact_replay | reactive_replay | generative'}`));
  }

  if (value.information_policy === undefined) {
    errors.push(missingField(`${path}.information_policy`));
  } else if (!isInformationPolicy(value.information_policy)) {
    errors.push(invalidField(`${path}.information_policy`, "must be 'point-in-time'"));
  }

  if (value.seed === undefined) {
    errors.push(missingField(`${path}.seed`));
  } else if (!isNonEmptyString(value.seed)) {
    errors.push(invalidField(`${path}.seed`, 'must be a non-empty string'));
  }

  if (value.as_of === undefined) {
    errors.push(missingField(`${path}.as_of`));
  } else if (!isTimestampMs(value.as_of)) {
    errors.push(invalidField(`${path}.as_of`, 'must be a valid epoch-millisecond timestamp'));
  }

  if (value.streams === undefined) {
    errors.push(missingField(`${path}.streams`));
  } else if (!Array.isArray(value.streams)) {
    errors.push(invalidField(`${path}.streams`, 'must be an array of { venue, instrument } selections'));
  } else {
    const streams = value.streams as readonly unknown[];
    if (streams.length === 0) {
      errors.push(invalidField(`${path}.streams`, 'must select at least one (venue, instrument) stream — a world with an empty data universe replays nothing'));
    }
    const seen = new Set<string>();
    for (let index = 0; index < streams.length; index++) {
      const selection = streams[index];
      if (!isStreamSelection(selection)) {
        errors.push(invalidField(`${path}.streams[${index}]`, 'must be an object with non-empty venue and instrument strings'));
        continue;
      }
      const key = streamSelectionKey(selection);
      if (seen.has(key)) {
        errors.push(invalidField(`${path}.streams[${index}]`, `duplicate stream selection "${key}"`));
      }
      seen.add(key);
    }
  }

  const playbackSpeed = value.playback_speed === undefined ? 1 : value.playback_speed;
  if (!isFiniteNumber(playbackSpeed) || playbackSpeed <= 0) {
    errors.push(invalidField(`${path}.playback_speed`, `must be a positive finite number, got ${String(playbackSpeed)}`));
  }

  if (errors.length > 0) return { ok: false, errors };

  const streams = (value.streams as readonly unknown[]).map((selection) => {
    const typed = selection as StreamSelection;
    return deepFreeze({ venue: typed.venue, instrument: typed.instrument });
  });

  return ok(
    deepFreeze({
      world_id: value.world_id as WorldId,
      fidelity: value.fidelity as FidelityMode,
      information_policy: value.information_policy as InformationPolicy,
      seed: value.seed as Seed,
      as_of: value.as_of as TimestampMs,
      streams,
      playback_speed: playbackSpeed as number,
    }),
  );
}

/** Runtime guard for a structurally valid world config. */
export function isReplayWorldConfig(value: unknown): value is ReplayWorldConfig {
  return validateWorldConfig(value).ok;
}

/**
 * Canonical JSON of a validated world config — the config's lineage anchor:
 * equal configs produce byte-identical bytes regardless of field order at
 * construction (L9). Consumed by {@link configHash} and bound into every
 * `ReplayRunRecord`.
 */
export function canonicalConfigJson(config: ReplayWorldConfig): string {
  // Built field-by-field (no casts) so the compiler proves JSON-safety.
  const tree: JsonValue = {
    world_id: config.world_id,
    fidelity: config.fidelity,
    information_policy: config.information_policy,
    seed: config.seed,
    as_of: config.as_of,
    streams: config.streams.map((selection) => ({ venue: selection.venue, instrument: selection.instrument })),
    playback_speed: config.playback_speed,
  };
  return canonicalJson(tree);
}

/**
 * The deterministic digest of a world config: FNV-1a 32-bit of the canonical
 * config JSON, as zero-padded lowercase hex (the same construction as
 * environment-protocol's episode-id derivation). Bound into run records so
 * lineage binds the EXACT config (L9); 32 bits are reference-grade — the
 * laboratory scale is T014's concern, documented there.
 */
export function configHash(config: ReplayWorldConfig): string {
  return fnv1a32Hex(canonicalConfigJson(config));
}

/** The world mode a config declares (fidelity + information policy). */
export function worldModeOf(config: ReplayWorldConfig): WorldMode {
  return deepFreeze({ fidelity: config.fidelity, informationPolicy: config.information_policy });
}
