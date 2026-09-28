// @tradrl/environment-protocol — branded identity references.
//
// Id discipline:
// - Every id is an opaque non-empty string at runtime; branding is a
//   compile-time nominal tag so distinct identity spaces are not
//   interchangeable.
// - Ids OWNED by this package (T005) are listed first: EnvironmentId,
//   EpisodeId, ObservationId, ActionId, RewardId, and the opaque Seed token.
// - OPAQUE cross-lane references follow the same rule: the referent entity
//   is owned by another Work Order (T002 trading domain, T003 agent lane,
//   T009/T010 market worlds). This package never imports those packages —
//   it only reserves the reference type here. VenueId, InstrumentId and
//   AgentInstanceId mirror the EXACT brand tags declared by
//   @tradrl/domain-core so the two declarations stay mutually assignable
//   without a package dependency (same structural-mirror law as TimestampMs).

import { Brand, isNonEmptyString } from './primitives';

// --- Ids owned by environment-protocol (T005) -------------------------------

/** Identity of an environment profile (the shape a Possession references by opaque id). */
export type EnvironmentId = Brand<string, 'EnvironmentId'>;

/** Identity of one episode: one run of one environment spec. */
export type EpisodeId = Brand<string, 'EpisodeId'>;

/** Identity of one observation within an episode (unique per episode). */
export type ObservationId = Brand<string, 'ObservationId'>;

/** Identity of one action request within an episode (unique per episode). */
export type ActionId = Brand<string, 'ActionId'>;

/** Identity of one reward signal within an episode (unique per episode). */
export type RewardId = Brand<string, 'RewardId'>;

/**
 * The deterministic seed of an environment profile. Opaque non-empty
 * string: its interpretation (hash material, key stream, ...) belongs to
 * the world implementation. The protocol only requires that it be captured
 * in the spec so lineage is reproducible (L9).
 */
export type Seed = Brand<string, 'EnvironmentSeed'>;

// --- Opaque cross-lane references (referents owned by other lanes) -----------

/**
 * Agent instance (T003 agent lane). The ACTOR of an action: environments
 * record who requested what; they never model the actor's internals.
 */
export type AgentInstanceId = Brand<string, 'AgentInstanceId'>;

/** Venue reference (T002/T004 market lanes). Mirror of domain-core's brand. */
export type VenueId = Brand<string, 'VenueId'>;

/** Instrument reference (T002/T004 market lanes). Mirror of domain-core's brand. */
export type InstrumentId = Brand<string, 'InstrumentId'>;

/**
 * MarketWorld reference (T009/T010 world lanes). Identifies the world
 * implementation/dataset an environment spec binds to.
 */
export type WorldId = Brand<string, 'WorldId'>;

/** Latency policy reference (T010 exchange simulation lane). */
export type LatencyPolicyId = Brand<string, 'LatencyPolicyId'>;

/** Fee policy reference (T010 exchange simulation lane). */
export type FeePolicyId = Brand<string, 'FeePolicyId'>;

// --- Guards ------------------------------------------------------------------
// Ids are opaque strings: the runtime check is shared. Brand discipline is
// enforced at compile time.

export const isEnvironmentId = (v: unknown): v is EnvironmentId => isNonEmptyString(v);
export const isEpisodeId = (v: unknown): v is EpisodeId => isNonEmptyString(v);
export const isObservationId = (v: unknown): v is ObservationId => isNonEmptyString(v);
export const isActionId = (v: unknown): v is ActionId => isNonEmptyString(v);
export const isRewardId = (v: unknown): v is RewardId => isNonEmptyString(v);
export const isSeed = (v: unknown): v is Seed => isNonEmptyString(v);
export const isAgentInstanceId = (v: unknown): v is AgentInstanceId => isNonEmptyString(v);
export const isVenueId = (v: unknown): v is VenueId => isNonEmptyString(v);
export const isInstrumentId = (v: unknown): v is InstrumentId => isNonEmptyString(v);
export const isWorldId = (v: unknown): v is WorldId => isNonEmptyString(v);
export const isLatencyPolicyId = (v: unknown): v is LatencyPolicyId => isNonEmptyString(v);
export const isFeePolicyId = (v: unknown): v is FeePolicyId => isNonEmptyString(v);
