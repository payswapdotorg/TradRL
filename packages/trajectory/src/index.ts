/**
 * @tradrl/trajectory — the canonical experience-stream record (T011).
 *
 * Public API:
 *   - Ids — `TrajectoryId`, `StepId`, `CausalityId` (owned), the opaque
 *     reference spaces this package mints (`EnvironmentConfigRef`,
 *     `RuntimeRef`, `DataRef`, `ToolOutcomeRef`, `EnvironmentResultRef`),
 *     and the opaque cross-lane mirrors (`EpisodeId`, `ObservationId`,
 *     `ActionId`, `RewardId`, `AgentInstanceId`, `TenantId`, `ProjectId`,
 *     `OrganizationId`, `BodyVersionRef`, `SubstrateRef`).
 *   - `TrajectoryMetadata` — the full L9 lineage block (tenant, project,
 *     episode, environment config ref, runtime ref, data refs, body versions,
 *     substrates).
 *   - `TrajectoryStep` — the atomic record: observation refs (with
 *     `available_time`), action records, rejections, reward signals, tool
 *     outcome refs, environment result ref, clock sample (now/asOf mirror),
 *     causality id.
 *   - `Trajectory` — ordered, append-only step log + metadata;
 *     `createTrajectory`, `appendTrajectoryStep`, `replayTrajectory`.
 *   - Deterministic serialization — `serializeTrajectory` (canonical JSON:
 *     same record, same bytes), `parseTrajectory`, `canonicalJson`.
 *   - Structural adapter — `trajectoryFromEpisodeTrace` +
 *     `deriveEnvironmentConfigRef` / `deriveTrajectoryId` +
 *     `TrajectoryLineageInput`, over the `Env*` mirrors of T005's shapes
 *     (env-mirror.ts).
 *   - Leakage forensics — `checkTrajectoryLeakage` (mirrored rules) and
 *     `toTrajectorySamples` (time-engine-shaped samples for the canonical
 *     `leakageCheck`).
 *
 * Zero runtime dependencies; types, schemas and pure functions only. No
 * wall-clock coupling anywhere (`Date.now()` never appears) — the trajectory
 * is a record of a SIMULATED time axis, and byte-determinism of
 * serialization is a construction law. `TimestampMs` and the clock sample
 * are structural mirrors of `@tradrl/time-engine` (canonical owner); the
 * `Env*` shapes are structural mirrors of `@tradrl/environment-protocol`
 * (T005) — see the mirror modules for the divergence laws.
 */

// Errors and results
export type { TrajErrorCode, TrajError, TrajResult } from './errors';
export { fail, failures, ok, missingField, invalidField, invalidType } from './errors';

// Structural primitives (deepFreeze discipline, branding, JSON model)
export type { Brand, Mutable, JsonValue, JsonObject } from './primitives';
export {
  isRecord,
  isNonEmptyString,
  isFiniteNumber,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
  deepFreeze,
  isDeeplyFrozen,
  isJsonValue,
  isJsonObject,
} from './primitives';

// Timestamp mirror (canonical owner: @tradrl/time-engine)
export type { TimestampMs } from './timestamp';
export { MIN_TIMESTAMP_MS, MAX_TIMESTAMP_MS, isTimestampMs, timestampMs, requireTimestampMs } from './timestamp';

// Branded ids and opaque cross-lane references
export type {
  TrajectoryId,
  StepId,
  CausalityId,
  EnvironmentConfigRef,
  RuntimeRef,
  DataRef,
  ToolOutcomeRef,
  EnvironmentResultRef,
  EpisodeId,
  ObservationId,
  ActionId,
  RewardId,
  EnvironmentId,
  WorldId,
  VenueId,
  InstrumentId,
  Seed,
  LatencyPolicyId,
  FeePolicyId,
  AgentInstanceId,
  TenantId,
  ProjectId,
  OrganizationId,
  BodyVersionRef,
  SubstrateRef,
} from './ids';
export {
  isTrajectoryId,
  isStepId,
  isCausalityId,
  isEnvironmentConfigRef,
  isRuntimeRef,
  isDataRef,
  isToolOutcomeRef,
  isEnvironmentResultRef,
  isEpisodeId,
  isObservationId,
  isActionId,
  isRewardId,
  isEnvironmentId,
  isWorldId,
  isVenueId,
  isInstrumentId,
  isSeed,
  isLatencyPolicyId,
  isFeePolicyId,
  isAgentInstanceId,
  isTenantId,
  isProjectId,
  isOrganizationId,
  isBodyVersionRef,
  isSubstrateRef,
} from './ids';

// The atomic step record (+ clock sample mirror of time-engine's SimulationClock)
export type {
  FidelityMode,
  InformationPolicy,
  ClockSample,
  ObservationRef,
  ActionRecord,
  RejectionError,
  RejectionRecord,
  RewardSignalRecord,
  TrajectoryStep,
} from './step';
export {
  FIDELITY_MODES,
  isFidelityMode,
  isInformationPolicy,
  isClockSample,
  isObservationRef,
  isActionRecord,
  isRejectionError,
  isRejectionRecord,
  isRewardSignalRecord,
  isTrajectoryStep,
  validateTrajectoryStep,
} from './step';

// The L9 lineage block
export type { TrajectoryMetadata } from './metadata';
export { isTrajectoryMetadata, validateTrajectoryMetadata } from './metadata';

// The trajectory record (append-only discipline)
export type { Trajectory } from './trajectory';
export { isTrajectory, validateTrajectory, createTrajectory, appendTrajectoryStep, replayTrajectory } from './trajectory';

// Deterministic canonical serialization
export { canonicalJson, serializeTrajectory, parseTrajectory } from './serialize';

// Structural mirrors of T005 environment-protocol shapes
export type {
  EnvObservationOrigin,
  EnvObservationProvenance,
  EnvObservation,
  EnvAction,
  EnvRewardSignal,
  EnvFidelityMode,
  EnvInformationPolicy,
  EnvClockConfig,
  EnvProfile,
  EnvWorldRef,
  EnvSpec,
  EnvTerminationReason,
  EnvEpisodeResult,
  EnvErrorCode,
  EnvErrorRecord,
  EnvRejection,
  EnvStepRecord,
  EnvEpisodeTrace,
} from './env-mirror';
export {
  ENV_OBSERVATION_ORIGINS,
  isEnvObservationOrigin,
  isEnvObservationProvenance,
  isEnvObservation,
  isEnvAction,
  isEnvRewardSignal,
  ENV_FIDELITY_MODES,
  isEnvFidelityMode,
  isEnvClockConfig,
  isEnvProfile,
  isEnvWorldRef,
  isEnvSpec,
  isEnvTerminationReason,
  isEnvEpisodeResult,
  ENV_ERROR_CODES,
  isEnvErrorCode,
  isEnvErrorRecord,
  isEnvRejection,
  isEnvStepRecord,
  isEnvEpisodeTrace,
  validateEnvEpisodeTrace,
} from './env-mirror';

// The structural adapter (episode trace -> trajectory)
export type { TrajectoryLineageInput } from './adapter';
export {
  canonicalEnvSpecJson,
  deriveEnvironmentConfigRef,
  deriveTrajectoryId,
  trajectoryFromEpisodeTrace,
} from './adapter';

// Leakage forensics (mirror of time-engine's leakage contract)
export type { TrajectorySample, FutureObservationFinding, ClockRegressionFinding, LeakageFinding, LeakageReport } from './leakage';
export { checkTrajectoryLeakage, toTrajectorySamples } from './leakage';

/** Package identity and ownership (Work Order T011). */
export const packageInfo = {
  name: '@tradrl/trajectory',
  owner: 'T011',
  status: 'implemented',
} as const;
