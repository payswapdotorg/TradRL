/**
 * @tradrl/trajectory — the trajectory protocol.
 *
 * The canonical record format for experience in TradRL: the complete,
 * ordered, lineage-bound stream of observations, actions, environment
 * results, rewards and tool outcomes produced during an episode.
 *
 * Public API:
 *   - Identity: `TrajectoryId`, `StepId`, `CausalityId` + opaque lineage
 *     reference types (ids.ts).
 *   - Time: the `TimestampMs` structural mirror (timestamp.ts), per-step
 *     `ClockSample` + the L5 `FidelityMode` vocabulary (clock.ts).
 *   - Records: `TrajectoryStep` (step.ts), `TrajectoryMetadata` — the L9
 *     lineage block (metadata.ts), `Trajectory` with append-only,
 *     copy-on-write construction and deterministic replay (record.ts).
 *   - Serialization: canonical deterministic JSON — same record, same bytes
 *     (serialize.ts).
 *   - Forensics: time-engine-shaped sample conversion for the canonical
 *     `leakageCheck`, plus the mirrored `auditTrajectory` (sample.ts).
 *
 * Laws upheld (spec/ARCHITECTURE-LOCK.md): L4 (point-in-time observations
 * with availability instants + leakage forensics), L5 (recorded world
 * fidelity), L9 (full reproducible lineage as record property), L12
 * (tenant scoping), L15 (project continuity).
 *
 * Zero runtime dependencies; no cross-package imports; hand-rolled total
 * guards; no wall-clock coupling (`Date.now()` never appears — records are
 * reproducible by construction).
 */

// Errors and results
export type { TrajectoryErrorCode, TrajectoryError, TrajectoryResult } from './errors';
export { fail, ok } from './errors';

// Timestamp mirror (canonical owner: @tradrl/time-engine)
export type { TimestampMs } from './timestamp';
export {
  MIN_TIMESTAMP_MS,
  MAX_TIMESTAMP_MS,
  isTimestampMs,
  timestampMs,
  requireTimestampMs,
} from './timestamp';

// Ids and opaque cross-lane references
export type {
  TrajectoryId,
  StepId,
  CausalityId,
  ProjectRef,
  TenantRef,
  EpisodeRef,
  AgentInstanceRef,
  BodyVersionRef,
  SubstrateRef,
  EnvironmentConfigRef,
  RuntimeRef,
  DataRef,
} from './ids';
export {
  isTrajectoryId,
  isStepId,
  isCausalityId,
  isProjectRef,
  isTenantRef,
  isEpisodeRef,
  isAgentInstanceRef,
  isBodyVersionRef,
  isSubstrateRef,
  isEnvironmentConfigRef,
  isRuntimeRef,
  isDataRef,
} from './ids';

// Clock sample + fidelity vocabulary
export type { FidelityMode, ClockSample } from './clock';
export { FIDELITY_MODES, isFidelityMode, isClockSample } from './clock';

// Step records
export type { ObservationRef, ActionRecord, RewardSignal, TrajectoryStep } from './step';
export { isObservationRef, isActionRecord, isRewardSignal, isTrajectoryStep } from './step';

// Lineage metadata (the L9 block)
export type { TrajectoryMetadata } from './metadata';
export { isTrajectoryMetadata, LINEAGE_LIST_FIELDS, TRAJECTORY_FIDELITY_MODES } from './metadata';

// The trajectory record
export type { Trajectory, TrajectorySpec } from './record';
export { createTrajectory, appendStep, replay, stepCount } from './record';

// Deterministic serialization
export { canonicalize, serializeTrajectory, parseTrajectory } from './serialize';

// Leakage forensics + time-engine sample compatibility
export type {
  SampleClock,
  SampledObservation,
  TrajectorySampleRecord,
  FutureObservationFinding,
  ClockRegressionFinding,
  TrajectoryFinding,
  TrajectoryLeakageReport,
} from './sample';
export { isSampleClock, toTrajectorySamples, auditTrajectory } from './sample';

// Primitives (guards, JSON discipline, deep immutability)
export {
  isRecord,
  isNonEmptyString,
  isFiniteNumber,
  isArrayOf,
  isJsonObject,
  isJsonValue,
  deepFreeze,
  isDeeplyFrozen,
} from './primitives';
export type { JsonValue, Mutable } from './primitives';

/** Package identity and ownership (Work Order T011). */
export const packageInfo = {
  name: '@tradrl/trajectory',
  owner: 'T011',
  status: 'implemented',
} as const;
