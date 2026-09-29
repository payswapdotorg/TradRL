/**
 * @tradrl/market-world (generative service) — branded identities and the
 * timestamp mirror (work order T028).
 *
 * Every id is an opaque non-empty string at runtime; branding is a
 * compile-time-only tag (D-003/D-004). The brand tags MIRROR the canonical
 * owners exactly, so values cross lanes without casts where the shapes are
 * structurally shared:
 *
 *   - `TimestampMs`       — mirror of @tradrl/time-engine (brand 'TradRL.TimestampMs').
 *   - `TenantId`/`ProjectId` — mirror of @tradrl/domain-core (brands 'TenantId'/'ProjectId').
 *   - `EpisodeId`/`ObservationId`/`ActionId`/`AgentInstanceId`/`VenueId`/
 *     `InstrumentId`/`Seed` — mirror of @tradrl/environment-protocol +
 *     exchange-sim (identical brand strings).
 *   - `RunId`/`ReceiptId`/`ProcessRef`/`CohortId`/`GeneratedEventId` — this
 *     lane's own identities (opaque strings, honestly scoped).
 *
 * The interop trip-wire tests assert brand-tag parity against the real
 * packages on this branch.
 */

import { fnv1a32Hex, isNonEmptyString } from './primitives';
import type { Brand } from './primitives';

// ---------------------------------------------------------------------------
// The timestamp mirror (canonical owner: @tradrl/time-engine)
// ---------------------------------------------------------------------------

/** A validated epoch-millisecond timestamp (mirror of time-engine's brand). */
export type TimestampMs = Brand<number, 'TradRL.TimestampMs'>;

/** The smallest instant the model admits (mirror of time-engine). */
export const MIN_TIMESTAMP_MS = 0;

/** The largest instant the model admits (mirror of time-engine). */
export const MAX_TIMESTAMP_MS = 8_640_000_000_000_000;

/** Runtime guard for a TimestampMs instant. */
export function isTimestampMs(value: unknown): value is TimestampMs {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= MIN_TIMESTAMP_MS && value <= MAX_TIMESTAMP_MS;
}

// ---------------------------------------------------------------------------
// Cross-lane branded ids (brand strings mirror the canonical owners)
// ---------------------------------------------------------------------------

/** Tenant identity — L12 (tenant isolation). Mirror of domain-core. */
export type TenantId = Brand<string, 'TenantId'>;

/** Project continuity root — L15. Mirror of domain-core. */
export type ProjectId = Brand<string, 'ProjectId'>;

/** An agent instance acting as an endogenous participant. Mirror of environment-protocol (brand 'AgentInstanceId'). */
export type AgentInstanceId = Brand<string, 'AgentInstanceId'>;

/** An episode identity (mirrors environment-protocol's derivation domain; brand 'EpisodeId'). */
export type EpisodeId = Brand<string, 'EpisodeId'>;

/** An observation identity. Mirror of environment-protocol (brand 'ObservationId'). */
export type ObservationId = Brand<string, 'ObservationId'>;

/** An action identity. Mirror of environment-protocol (brand 'ActionId'). */
export type ActionId = Brand<string, 'ActionId'>;

/** A venue identity. Mirror of environment-protocol/exchange-sim (brand 'VenueId'). */
export type VenueId = Brand<string, 'VenueId'>;

/** An instrument identity. Mirror of environment-protocol/exchange-sim (brand 'InstrumentId'). */
export type InstrumentId = Brand<string, 'InstrumentId'>;

/** An opaque deterministic seed. Mirror of environment-protocol/exchange-sim (brand 'EnvironmentSeed'). */
export type Seed = Brand<string, 'EnvironmentSeed'>;

/** A venue-side order identity (engine-minted). Mirror of exchange-sim (brand 'ExchangeOrderId'). */
export type ExchangeOrderId = Brand<string, 'ExchangeOrderId'>;

/** A venue-side fill identity (engine-minted). Mirror of exchange-sim (brand 'FillId'). */
export type FillId = Brand<string, 'FillId'>;

// ---------------------------------------------------------------------------
// This lane's own identities (opaque strings, honestly scoped)
// ---------------------------------------------------------------------------

/** A generative run identity: `run-<fnv1a32(config_hash)>` (deterministic). */
export type RunId = Brand<string, 'TradRL.GenerativeRunId'>;

/** An action receipt identity: `grc-<episode>:<action_id>` (deterministic). */
export type ReceiptId = Brand<string, 'TradRL.GenerativeReceiptId'>;

/** An opaque reference to a declared stochastic process (versioned record). */
export type ProcessRef = Brand<string, 'TradRL.GenerativeProcessRef'>;

/** An opaque reference to a declared population cohort. */
export type CohortId = Brand<string, 'TradRL.GenerativeCohortId'>;

/** A generated-event identity: `gev-<fnv1a32(event_digest_input)>` (deterministic). */
export type GeneratedEventId = Brand<string, 'TradRL.GenerativeEventId'>;

// ---------------------------------------------------------------------------
// Guards (ids are opaque non-empty strings at runtime — the mirror law)
// ---------------------------------------------------------------------------

/** Guard: TenantId. */
export const isTenantId = (v: unknown): v is TenantId => isNonEmptyString(v);
/** Guard: ProjectId. */
export const isProjectId = (v: unknown): v is ProjectId => isNonEmptyString(v);
/** Guard: AgentInstanceId. */
export const isAgentInstanceId = (v: unknown): v is AgentInstanceId => isNonEmptyString(v);
/** Guard: EpisodeId. */
export const isEpisodeId = (v: unknown): v is EpisodeId => isNonEmptyString(v);
/** Guard: ObservationId. */
export const isObservationId = (v: unknown): v is ObservationId => isNonEmptyString(v);
/** Guard: ActionId. */
export const isActionId = (v: unknown): v is ActionId => isNonEmptyString(v);
/** Guard: VenueId. */
export const isVenueId = (v: unknown): v is VenueId => isNonEmptyString(v);
/** Guard: InstrumentId. */
export const isInstrumentId = (v: unknown): v is InstrumentId => isNonEmptyString(v);
/** Guard: Seed. */
export const isSeed = (v: unknown): v is Seed => isNonEmptyString(v);
/** Guard: ExchangeOrderId. */
export const isExchangeOrderId = (v: unknown): v is ExchangeOrderId => isNonEmptyString(v);
/** Guard: FillId. */
export const isFillId = (v: unknown): v is FillId => isNonEmptyString(v);
/** Guard: RunId. */
export const isRunId = (v: unknown): v is RunId => isNonEmptyString(v);
/** Guard: ReceiptId. */
export const isReceiptId = (v: unknown): v is ReceiptId => isNonEmptyString(v);
/** Guard: ProcessRef. */
export const isProcessRef = (v: unknown): v is ProcessRef => isNonEmptyString(v);
/** Guard: CohortId. */
export const isCohortId = (v: unknown): v is CohortId => isNonEmptyString(v);
/** Guard: GeneratedEventId. */
export const isGeneratedEventId = (v: unknown): v is GeneratedEventId => isNonEmptyString(v);

// ---------------------------------------------------------------------------
// Deterministic id derivations (the FNV-1a discipline of the sibling lanes)
// ---------------------------------------------------------------------------

/**
 * Derive a generative run id: `run-<fnv1a32(config_hash)>`. THE GENERATIVE
 * DIFFERENCE (vs the replay/reactive lanes): there IS no recorded stream —
 * the config's declared processes ARE the complete data declaration (the
 * seeds, the cadences, the policies, the physics), so binding the config
 * hash binds everything the run can ever generate. The final generation
 * chain head is additionally bound into the RUN RECORD (L9).
 */
export function deriveRunId(configHashValue: string): RunId {
  return `run-${fnv1a32Hex(configHashValue)}` as RunId;
}

/** Derive an action receipt id: `grc-<episode>:<action_id>` (action ids are unique per episode). */
export function deriveReceiptId(episode: string, actionId: string): ReceiptId {
  return `grc-${episode}:${actionId}` as ReceiptId;
}

/**
 * Derive a generated-event id: `gev-<process>:<instance|world>:<step>` —
 * the identity binds the DECLARED process, the emitting instance and the
 * step, so every generated event's id is a pure function of its lineage
 * (deterministic, collision-free within a run: a process instance steps
 * once per step ordinal).
 */
export function deriveGeneratedEventId(processId: string, instance: string, step: number): GeneratedEventId {
  return `gev-${processId}:${instance}:${String(step)}` as GeneratedEventId;
}
