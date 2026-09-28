/**
 * @tradrl/environment-protocol — the mediating contract between agent
 * runtimes and MarketWorlds under a simulation clock.
 *
 * Public API:
 *   - Ids — `EnvironmentId`, `EpisodeId` (owned), `ObservationId`,
 *     `ActionId`, `RewardId`, `Seed`, plus opaque cross-lane references
 *     (`AgentInstanceId`, `VenueId`, `InstrumentId`, `WorldId`,
 *     `LatencyPolicyId`, `FeePolicyId`).
 *   - `EnvironmentProfile` — the shape a Possession references by opaque id
 *     (fidelity, clock config, seed, scope, policy refs).
 *   - `EnvironmentSpec` — fully determines an environment instance (profile
 *     + world ref + information policy); canonical form + deterministic
 *     episode ids (L9).
 *   - `Observation` — the opaque delivery envelope carrying the L4
 *     boundary (`available_time`, inclusive visibility predicate).
 *   - `Action` — the opaque request envelope (actor, submitted_at, client
 *     sequence). Requests, never authority (L8).
 *   - `RewardSignal` — optional, explicit, never fabricated.
 *   - Episode step protocol — `startEpisode`, `emitObservations`,
 *     `emitRewardSignals`, `observeEpisode`, `submitAction`,
 *     `advanceEpisode`, `finishEpisode` (pure, immutable transitions).
 *   - `EpisodeStore` — the id-keyed mediation shell (`unknown_episode`).
 *   - `Environment` — the interface T009/T010 implement and the runner
 *     drives.
 *
 * Zero runtime dependencies; types, schemas and pure functions only.
 * `TimestampMs` and `ClockConfig` are structural mirrors of
 * `@tradrl/time-engine` (canonical owner) — see src/timestamp.ts and
 * src/clock.ts for the mirror discipline.
 */

// Errors and results
export type { EnvErrorCode, EnvError, EnvResult } from './errors';
export { fail, failures, ok, missingField, invalidField, invalidType } from './errors';

// Structural primitives (deepFreeze discipline, branding)
export type { Brand } from './primitives';
export { isRecord, isNonEmptyString, isFiniteNumber, isNonNegativeSafeInteger, isPositiveSafeInteger, deepFreeze, isDeeplyFrozen } from './primitives';

// JSON value model (opaque payloads)
export type { JsonValue, JsonObject } from './json';
export { isJsonValue, isJsonObject } from './json';

// Timestamp mirror (canonical owner: @tradrl/time-engine)
export type { TimestampMs } from './timestamp';
export { MIN_TIMESTAMP_MS, MAX_TIMESTAMP_MS, isTimestampMs, timestampMs, requireTimestampMs } from './timestamp';

// Branded ids and opaque cross-lane references
export type {
  EnvironmentId,
  EpisodeId,
  ObservationId,
  ActionId,
  RewardId,
  Seed,
  AgentInstanceId,
  VenueId,
  InstrumentId,
  WorldId,
  LatencyPolicyId,
  FeePolicyId,
} from './ids';
export {
  isEnvironmentId,
  isEpisodeId,
  isObservationId,
  isActionId,
  isRewardId,
  isSeed,
  isAgentInstanceId,
  isVenueId,
  isInstrumentId,
  isWorldId,
  isLatencyPolicyId,
  isFeePolicyId,
} from './ids';

// Clock config mirror (canonical owner: @tradrl/time-engine)
export type { FidelityMode, InformationPolicy, ClockConfig } from './clock';
export { FIDELITY_MODES, isFidelityMode, isInformationPolicy, isClockConfig, createClockConfig, validateClockConfig } from './clock';

// Provenance summary (mirror of market-protocol's origin trichotomy)
export type { ObservationOrigin, ObservationProvenance } from './provenance';
export {
  OBSERVATION_ORIGINS,
  isObservationOrigin,
  isObservationProvenance,
  validateObservationProvenance,
  observationOrigin,
  isSyntheticObservation,
  isDerivedObservation,
} from './provenance';

// Observation envelope + the L4 visibility boundary
export type { Observation, Available } from './observation';
export {
  isObservation,
  validateObservation,
  isObservationVisible,
  visibleObservationsAt,
  withheldObservationsAt,
} from './observation';

// Action envelope (requests, never authority)
export type { Action } from './action';
export { isAction, validateAction } from './action';

// Reward signals (optional, explicit, never fabricated)
export type { RewardSignal } from './reward';
export { isRewardSignal, validateRewardSignal, isRewardVisible } from './reward';

// Environment profile
export type { EnvironmentProfile } from './profile';
export { isEnvironmentProfile, validateEnvironmentProfile } from './profile';

// Environment spec + canonical form
export type { EnvironmentSpec, WorldRef } from './spec';
export {
  isWorldRef,
  isEnvironmentSpec,
  validateEnvironmentSpec,
  canonicalJson,
  canonicalSpecJson,
  deriveEpisodeId,
} from './spec';

// Episode state + step protocol
export type { EpisodeStatus, TerminationCode, TerminationReason, EpisodeState, EpisodeResult, EpisodeFinish } from './episode';
export {
  EPISODE_STATUSES,
  TERMINATION_CODES,
  isEpisodeStatus,
  isTerminationCode,
  isTerminationReason,
  isEpisodeState,
  isEpisodeResult,
  isEpisodeFinish,
  startEpisode,
  emitObservations,
  emitRewardSignals,
  observeEpisode,
  submitAction,
  advanceEpisode,
  finishEpisode,
  actorHighestSequence,
  visibleRewardsAt,
} from './episode';

// Id-keyed mediation shell
export type { EpisodeStore } from './store';
export { createEpisodeStore } from './store';

// The Environment contract T009/T010 implement
export type { Environment } from './environment';
export { isEnvironment } from './environment';

/** Package identity and ownership (Work Order T005). */
export const packageInfo = {
  name: '@tradrl/environment-protocol',
  owner: 'T005',
  status: 'implemented',
} as const;
