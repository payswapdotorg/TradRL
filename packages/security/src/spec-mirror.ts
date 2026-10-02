// @tradrl/security — the environment-spec structural mirror (T005).
//
// STRUCTURAL MIRROR of @tradrl/environment-protocol (T005) — re-declared
// by STRUCTURE, never imported (D-003/D-004): the SAME clock/profile/spec
// shapes, the SAME guard laws, the SAME canonical serialization and the
// SAME deterministic episode-id derivation. A REAL T005
// `EnvironmentSpec` IS this package's mirror spec — mutually assignable
// with NO casts — and a spec's REAL `deriveEpisodeId` output equals this
// mirror's derivation byte-for-byte. src/interop.test.ts and
// tests/security/interop.test.ts are the drift trip wires.
//
// WHY THIS LANE MIRRORS THE SPEC (the T044 Work Order: "untrusted
// workload isolation policy (T005 episode admission requires an isolation
// descriptor)"): spec/SECURITY.md Untrusted workloads — VERBATIM:
// "User-provided executable or research workloads are untrusted and
// require isolation." An {@link EnvironmentSpec} fully determines one run
// of one untrusted research workload (T005's law), so the isolation
// descriptor binds the spec's derived episode id — the admission record
// (see isolation.ts) proves "THIS workload runs under THIS descriptor".
// The mirror keeps the join keyless (no package edge; the frozen lockfile
// forbids it) while the trip wires keep it honest.
//
// The canonical form and digest law mirror T005's spec.ts law-for-law:
// equal specs always produce byte-identical canonical JSON and equal
// episode ids (`ep-<fnv1a32(canonicalSpecJson(spec))>`), regardless of
// field order at construction.

import { deepFreeze, isFiniteNumber, isNonEmptyString, isRecord, canonicalJson, fnv1a32Hex, type JsonValue, type TimestampMs } from './primitives';
import type { EnvironmentId, EpisodeId, InstrumentId, LatencyPolicyId, FeePolicyId, Seed, VenueId, WorldId } from './ids';
import { isEnvironmentId, isInstrumentId, isLatencyPolicyId, isFeePolicyId, isSeed, isVenueId, isWorldId } from './ids';

// ---------------------------------------------------------------------------
// Clock mirror (canonical owner: @tradrl/time-engine via T005)
// ---------------------------------------------------------------------------

/** The three distinct world-fidelity modes (L5). Mirror of T005/time-engine. */
export type FidelityMode = 'exact_replay' | 'reactive_replay' | 'generative';

/** Runtime-checkable list of fidelity modes. */
export const FIDELITY_MODES: readonly FidelityMode[] = ['exact_replay', 'reactive_replay', 'generative'];

/**
 * The information policy governing what the episode's `now` admits (L4).
 * Single policy — the boundary is the law, not a dial. Mirror of
 * T005/time-engine.
 */
export type InformationPolicy = 'point-in-time';

/** The clock configuration of an environment profile — structural mirror of T005's `ClockConfig` (time-engine's SimulationClock). */
export interface ClockConfig {
  /** Initial/current simulated instant. Monotonic within an episode; never past `asOf`. */
  readonly now: TimestampMs;
  /** Historical anchor: the latest instant this episode's information set covers. */
  readonly asOf: TimestampMs;
  /** Positive finite playback-speed multiplier. 1 = real time. */
  readonly playbackSpeed: number;
  /** Whether automatic progression is suspended. */
  readonly paused: boolean;
  /** World fidelity mode — one of the three distinct L5 modes. */
  readonly fidelity: FidelityMode;
  /** Information policy in force. */
  readonly informationPolicy: InformationPolicy;
}

/** Guard: `FidelityMode`. */
export function isFidelityMode(value: unknown): value is FidelityMode {
  return typeof value === 'string' && (FIDELITY_MODES as readonly string[]).includes(value);
}

/** Guard: `InformationPolicy`. */
export function isInformationPolicy(value: unknown): value is InformationPolicy {
  return value === 'point-in-time';
}

/** Guard: `ClockConfig` (T005's law: now <= asOf, positive playbackSpeed, single policy). */
export function isClockConfig(value: unknown): value is ClockConfig {
  if (!isRecord(value)) return false;
  if (typeof value.now !== 'number' || !Number.isSafeInteger(value.now) || value.now < 0) return false;
  if (typeof value.asOf !== 'number' || !Number.isSafeInteger(value.asOf) || value.asOf < 0) return false;
  if (value.now > value.asOf) return false;
  if (!isFiniteNumber(value.playbackSpeed) || value.playbackSpeed <= 0) return false;
  if (typeof value.paused !== 'boolean') return false;
  if (!isFidelityMode(value.fidelity)) return false;
  if (value.informationPolicy !== 'point-in-time') return false;
  return true;
}

// ---------------------------------------------------------------------------
// The world reference
// ---------------------------------------------------------------------------

/** Reference to the MarketWorld an environment spec binds to. Mirror of T005's `WorldRef`. */
export interface WorldRef {
  readonly world_id: WorldId;
  readonly kind: string;
}

/** Guard: `WorldRef`. */
export function isWorldRef(value: unknown): value is WorldRef {
  if (!isRecord(value)) return false;
  return isWorldId(value.world_id) && isNonEmptyString(value.kind);
}

// ---------------------------------------------------------------------------
// The environment profile
// ---------------------------------------------------------------------------

/** The environment profile — mirror of T005's `EnvironmentProfile` (fidelity, clock, seed, scopes, policy refs). */
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

/** Guard: `EnvironmentProfile` (T005's law: fidelity coherence + scope uniqueness). */
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

// ---------------------------------------------------------------------------
// The environment spec
// ---------------------------------------------------------------------------

/** The fully-determining environment specification — mirror of T005's `EnvironmentSpec`. */
export interface EnvironmentSpec {
  readonly profile: EnvironmentProfile;
  readonly world: WorldRef;
  readonly information_policy: InformationPolicy;
}

/** Guard: `EnvironmentSpec` (T005's law: policy coherence — spec.information_policy IS profile.clock.informationPolicy). */
export function isEnvironmentSpec(value: unknown): value is EnvironmentSpec {
  if (!isRecord(value)) return false;
  if (!isEnvironmentProfile(value.profile)) return false;
  if (!isWorldRef(value.world)) return false;
  if (!isInformationPolicy(value.information_policy)) return false;
  if (value.profile.clock.informationPolicy !== value.information_policy) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Canonical serialization and deterministic episode ids (T005's law, mirrored)
// ---------------------------------------------------------------------------

/**
 * Canonical JSON of a validated environment spec — T005's
 * `canonicalSpecJson` mirrored EXACTLY (the explicit content tree,
 * field-for-field). Equal specs produce identical bytes regardless of
 * construction order; the interop trip wire pins byte-parity with the
 * REAL T005 function.
 */
export function canonicalSpecJson(spec: EnvironmentSpec): string {
  const tree: JsonValue = {
    profile: {
      environment_id: spec.profile.environment_id,
      fidelity: spec.profile.fidelity,
      clock: {
        now: spec.profile.clock.now,
        asOf: spec.profile.clock.asOf,
        playbackSpeed: spec.profile.clock.playbackSpeed,
        paused: spec.profile.clock.paused,
        fidelity: spec.profile.clock.fidelity,
        informationPolicy: spec.profile.clock.informationPolicy,
      },
      seed: spec.profile.seed,
      venue_scope: [...spec.profile.venue_scope],
      instrument_scope: [...spec.profile.instrument_scope],
      latency_policy: spec.profile.latency_policy,
      fee_policy: spec.profile.fee_policy,
    },
    world: { world_id: spec.world.world_id, kind: spec.world.kind },
    information_policy: spec.information_policy,
  };
  return canonicalJson(tree);
}

/**
 * Derive the episode id of a spec deterministically — T005's law,
 * mirrored EXACTLY: `ep-<fnv1a32(canonicalSpecJson(spec))>`. The same
 * spec always yields the same episode id; any change yields a different
 * one. The interop trip wire pins parity with the REAL T005
 * `deriveEpisodeId`.
 */
export function deriveEpisodeId(spec: EnvironmentSpec): EpisodeId {
  return `ep-${fnv1a32Hex(canonicalSpecJson(spec))}` as EpisodeId;
}

/** Freeze a validated spec (the deep-freeze discipline; the mirror never mutates inputs). */
export function freezeSpec(spec: EnvironmentSpec): EnvironmentSpec {
  return deepFreeze({
    profile: deepFreeze({
      environment_id: spec.profile.environment_id,
      fidelity: spec.profile.fidelity,
      clock: deepFreeze({
        now: spec.profile.clock.now,
        asOf: spec.profile.clock.asOf,
        playbackSpeed: spec.profile.clock.playbackSpeed,
        paused: spec.profile.clock.paused,
        fidelity: spec.profile.clock.fidelity,
        informationPolicy: spec.profile.clock.informationPolicy,
      }),
      seed: spec.profile.seed,
      venue_scope: Object.freeze([...spec.profile.venue_scope]),
      instrument_scope: Object.freeze([...spec.profile.instrument_scope]),
      latency_policy: spec.profile.latency_policy,
      fee_policy: spec.profile.fee_policy,
    }),
    world: deepFreeze({ world_id: spec.world.world_id, kind: spec.world.kind }),
    information_policy: spec.information_policy,
  });
}
