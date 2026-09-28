// @tradrl/market-world — branded identity references.
//
// Id discipline:
// - Every id is an opaque non-empty string at runtime; branding is a
//   compile-time nominal tag so distinct identity spaces are not
//   interchangeable.
// - Ids OWNED by this package (T009) are listed first: WorldSnapshotRef and
//   IntentReceiptId.
// - OPAQUE cross-lane references follow the same rule: the referent entity
//   is owned by another Work Order (T005 environment lane, T002/T004 market
//   lanes). This package never imports those packages — it only reserves the
//   reference types here. The brand tags mirror the EXACT tags declared by
//   @tradrl/environment-protocol (which itself mirrors @tradrl/domain-core)
//   so the declarations stay mutually assignable without a package
//   dependency (the same structural-mirror law as TimestampMs).
//
// NOTE on event-lane identifiers: `venue`, `instrument`, `provider` and
// `event_id` inside the WorldEvent envelope are deliberately PLAIN
// (unbranded) non-empty strings, mirroring @tradrl/market-protocol's
// fields.ts — a canonical MarketEvent must be assignable to a WorldEvent
// without casts (proven in src/interop.test.ts). Branded venue/instrument
// references appear only on the CONFIG side (stream selection, episode
// scopes), where they are compared against — never constructed from — plain
// event fields.

import { Brand, isNonEmptyString } from './primitives';

// --- Ids owned by market-world (T009) ----------------------------------------

/**
 * An opaque reference to a recorded world-state snapshot. In exact replay a
 * snapshot ref is the event id of an applied `book_snapshot` event: the
 * recorded book IS the world state snapshot (the replay world never
 * synthesizes snapshots — L6).
 */
export type WorldSnapshotRef = Brand<string, 'WorldSnapshotRef'>;

/** Identity of one recorded intent receipt within an episode. */
export type IntentReceiptId = Brand<string, 'IntentReceiptId'>;

// --- Opaque cross-lane references (referents owned by other lanes) -----------

/**
 * MarketWorld reference (mirror of environment-protocol's brand). Identifies
 * the world implementation/dataset an environment spec binds to.
 */
export type WorldId = Brand<string, 'WorldId'>;

/** Environment profile reference (T005 environment lane). Mirror brand. */
export type EnvironmentId = Brand<string, 'EnvironmentId'>;

/** Episode reference (T005 environment lane). Mirror brand. */
export type EpisodeId = Brand<string, 'EpisodeId'>;

/** Observation reference (T005 environment lane). Mirror brand. */
export type ObservationId = Brand<string, 'ObservationId'>;

/** Action request reference (T005 environment lane). Mirror brand. */
export type ActionId = Brand<string, 'ActionId'>;

/** Reward signal reference (T005 environment lane). Mirror brand. */
export type RewardId = Brand<string, 'RewardId'>;

/** Agent instance reference (T003 agent lane). Mirror brand. The ACTOR of an action. */
export type AgentInstanceId = Brand<string, 'AgentInstanceId'>;

/** Venue reference (T002/T004 market lanes). Mirror brand. */
export type VenueId = Brand<string, 'VenueId'>;

/** Instrument reference (T002/T004 market lanes). Mirror brand. */
export type InstrumentId = Brand<string, 'InstrumentId'>;

/** Latency policy reference (T010 exchange simulation lane). Mirror brand. */
export type LatencyPolicyId = Brand<string, 'LatencyPolicyId'>;

/** Fee policy reference (T010 exchange simulation lane). Mirror brand. */
export type FeePolicyId = Brand<string, 'FeePolicyId'>;

/**
 * The deterministic seed of a world config / environment profile. Opaque
 * non-empty string; its interpretation belongs to the world implementation
 * (L9: captured in the config so lineage is reproducible).
 */
export type Seed = Brand<string, 'EnvironmentSeed'>;

// --- Guards ------------------------------------------------------------------
// Ids are opaque strings: the runtime check is shared. Brand discipline is
// enforced at compile time.

export const isWorldSnapshotRef = (v: unknown): v is WorldSnapshotRef => isNonEmptyString(v);
export const isIntentReceiptId = (v: unknown): v is IntentReceiptId => isNonEmptyString(v);
export const isWorldId = (v: unknown): v is WorldId => isNonEmptyString(v);
export const isEnvironmentId = (v: unknown): v is EnvironmentId => isNonEmptyString(v);
export const isEpisodeId = (v: unknown): v is EpisodeId => isNonEmptyString(v);
export const isObservationId = (v: unknown): v is ObservationId => isNonEmptyString(v);
export const isActionId = (v: unknown): v is ActionId => isNonEmptyString(v);
export const isRewardId = (v: unknown): v is RewardId => isNonEmptyString(v);
export const isAgentInstanceId = (v: unknown): v is AgentInstanceId => isNonEmptyString(v);
export const isVenueId = (v: unknown): v is VenueId => isNonEmptyString(v);
export const isInstrumentId = (v: unknown): v is InstrumentId => isNonEmptyString(v);
export const isLatencyPolicyId = (v: unknown): v is LatencyPolicyId => isNonEmptyString(v);
export const isFeePolicyId = (v: unknown): v is FeePolicyId => isNonEmptyString(v);
export const isSeed = (v: unknown): v is Seed => isNonEmptyString(v);

// --- Trusted internal constructors -------------------------------------------
// Event-lane fields are plain validated strings; converting one onto a
// branded reference goes through a checked constructor (never a cast).

/** Throwing constructor for trusted, already-validated strings. */
function requireId<T extends string>(guard: (v: unknown) => v is T, value: string, what: string): T {
  if (!guard(value)) throw new RangeError(`${what}: "${value}" is not a valid opaque id`);
  return value;
}

/** Convert a validated event id onto an {@link ObservationId}. */
export function requireObservationId(value: string): ObservationId {
  return requireId(isObservationId, value, 'requireObservationId');
}

/** Convert a validated event venue onto a {@link VenueId}. */
export function requireVenueId(value: string): VenueId {
  return requireId(isVenueId, value, 'requireVenueId');
}

/** Convert a validated event instrument onto an {@link InstrumentId}. */
export function requireInstrumentId(value: string): InstrumentId {
  return requireId(isInstrumentId, value, 'requireInstrumentId');
}
