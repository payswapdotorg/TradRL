/**
 * @tradrl/compute — the distributed episode generation contract package
 * (Work Order T014).
 *
 * Public API:
 *   - Errors and results — the closed typed taxonomy (`ComputeErrorCode`)
 *     including the work order's law trip-wires: `job_invalid`,
 *     `seed_overlap`, `seed_gap`, `divergence`, `lineage_gap`,
 *     `failure_hidden`, `tenant_missing`, `schedule_mismatch`,
 *     `result_out_of_range`, `run_not_complete`, `chain_mismatch`,
 *     `port_invalid`, `port_error`.
 *   - Structural primitives — the shared contract vocabulary (branding,
 *     guards, deep-freeze discipline, JSON model, canonical JSON, FNV-1a
 *     digests) and the `TimestampMs` mirror of @tradrl/time-engine.
 *   - Ids — `JobId`, `WorkerRef`, `SubmissionId`, `PolicyRef`,
 *     `ComputeRunId` (owned by T014) plus the opaque cross-lane mirrors
 *     (T005 environment identities, T011 trajectory/experiments
 *     identities, T013 rl-protocol identities, T002/T006 references).
 *   - The trial record mirror — the experiments-lane `TrialRecord`
 *     (T011) re-declared field-for-field; aggregated trials ARE
 *     experiments-lane trials.
 *   - The EpisodeJob — the unit of work: the L9/L12 lineage block
 *     (experiment ref, environment config ref, policy ref, reward-model
 *     refs, tenant, project), the seed range, the arm, the per-episode
 *     step budget, and the declared driver configuration (the T013
 *     trainer mirrors).
 *   - SeedPartitioning — the DECLARED deterministic range splitting
 *     ((job range, worker count, slot) -> subrange; total coverage, zero
 *     overlap) and the declared episode-seed derivation (every episode's
 *     seed derivable from (job id, worker slot, index) — a pure function
 *     of the ABSOLUTE ordinal, never of the worker count or arrival
 *     order).
 *   - ComputePort — the injected substrate interface (submit / collect /
 *     cancel) + guard; NO implementation ships here (no workers, no
 *     queues, no network — concrete substrates bind later).
 *   - JobResult / JobFailure — the typed outcome records: results carry
 *     the job ref + worker ref + episode digest + trial payload + lineage
 *     (L9); failures carry the closed kind taxonomy + detail + lineage,
 *     and are RETAINED records (L11).
 *   - The SchedulerContract — `planComputeSchedule`, the pure planner
 *     (deterministic, serializable, canonically ordered), the deep
 *     schedule validator and the schedule's canonical serialization +
 *     chain seed.
 *   - The AggregateProtocol — `aggregateEpisodes`, the canonical fold:
 *     results deduplicate by digest equality (mismatched digests for one
 *     (job, seed) key = typed divergence), trials fold in trial-id order
 *     into the experiment trial-log shape (T011 mirror), failures fold
 *     into the retained manifest, and a task with neither results nor a
 *     failure record is a typed `failure_hidden` error — a 1-worker run
 *     and an N-worker run over the same job set produce byte-identical
 *     aggregates.
 *
 * Zero runtime dependencies; types, schemas and pure functions only. No
 * ambient clock anywhere (`Date.now()` never appears) — every instant is
 * an explicit parameter, so every derived record is replayable and
 * byte-deterministic. Cross-lane shapes are STRUCTURAL MIRRORS
 * (D-003/D-004 — never imports); src/interop.test.ts is the drift trip
 * wire against the REAL packages present on this branch.
 */

// Errors and results
export type { ComputeErrorCode, ComputeError, ComputeResult } from './errors';
export { fail, failures, ok, missingField, invalidField, invalidType } from './errors';

// Structural primitives (deepFreeze discipline, branding, JSON model, digests)
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
  canonicalJson,
  fnv1a32Hex,
  isDigest8,
} from './primitives';

// Timestamp mirror (canonical owner: @tradrl/time-engine)
export type { TimestampMs } from './timestamp';
export { MIN_TIMESTAMP_MS, MAX_TIMESTAMP_MS, isTimestampMs, timestampMs, requireTimestampMs } from './timestamp';

// Branded ids and opaque cross-lane references
export type {
  JobId,
  WorkerRef,
  SubmissionId,
  PolicyRef,
  ComputeRunId,
  EpisodeId,
  Seed,
  TrajectoryId,
  EnvironmentConfigRef,
  RuntimeRef,
  DataRef,
  ExperimentId,
  TrialId,
  ArmId,
  RewardModelRef,
  AgentInstanceId,
  BodyVersionRef,
  SubstrateRef,
  TenantId,
  ProjectId,
} from './ids';
export {
  isJobId,
  isWorkerRef,
  isSubmissionId,
  isPolicyRef,
  isComputeRunId,
  isEpisodeId,
  isSeed,
  isTrajectoryId,
  isEnvironmentConfigRef,
  isRuntimeRef,
  isDataRef,
  isExperimentId,
  isTrialId,
  isArmId,
  isRewardModelRef,
  isAgentInstanceId,
  isBodyVersionRef,
  isSubstrateRef,
  isTenantId,
  isProjectId,
} from './ids';

// The experiments-lane trial record mirror (T011)
export type { TrialStatus, TrialRecord } from './trial-mirror';
export {
  TRIAL_STATUSES,
  TERMINAL_TRIAL_STATUSES,
  isTrialStatus,
  isTrialRecord,
  validateTrialRecord,
  trialTree,
} from './trial-mirror';

// The EpisodeJob (the unit of work) + the driver configuration (T013 mirrors)
export type { SeedRange, JobLineage, DriverConfig, EpisodeJob } from './job';
export {
  isSeedRange,
  isNonEmptySeedRange,
  isJobLineage,
  validateJobLineage,
  isDriverConfig,
  validateDriverConfig,
  isEpisodeJob,
  validateEpisodeJob,
  lineageTree,
  driverTree,
  jobTree,
} from './job';

// The declared SeedPartitioning (the seed discipline of the determinism law)
export {
  partitionSeedRange,
  isEmptyPartition,
  episodeSeedAt,
  episodeSeedInSlot,
  deriveJobTrialId,
  deriveJobTrajectoryId,
  allPartitions,
} from './partition';

// The ComputePort (the injected substrate) + the compute task
export type { PortError, PortResult, ComputeTask, ComputePort } from './port';
export {
  isComputeTask,
  validateComputeTask,
  deriveSubmissionId,
  isComputePort,
  portFailure,
  taskTree,
} from './port';

// The outcome records (results and failures — append-only, L9/L11)
export type { FailureKind, JobResult, JobFailure, JobOutcome } from './outcome';
export {
  FAILURE_KINDS,
  isFailureKind,
  isJobResult,
  validateJobResult,
  isJobFailure,
  validateJobFailure,
  isJobOutcome,
  validateJobOutcome,
  resultTree,
  failureTree,
  canonicalOutcomeJson,
  outcomeDigest,
} from './outcome';

// The SchedulerContract (the pure planner) + the schedule
export type { ComputeSchedule, SchedulerContract } from './schedule';
export {
  isComputeSchedule,
  planComputeSchedule,
  validateComputeSchedule,
  isSchedulerContract,
  scheduleTree,
  canonicalScheduleJson,
  scheduleChainSeed,
  scheduleJobs,
} from './schedule';

// The AggregateProtocol (the canonical fold)
export type { AggregateTrial, EpisodeAggregate } from './aggregate';
export {
  isEpisodeAggregate,
  aggregateEpisodes,
  aggregateTrialTree,
  aggregateTree,
  canonicalAggregateJson,
  aggregateDigest,
  verifyAggregateDigest,
} from './aggregate';

/** Package identity and ownership (Work Order T014). */
export const packageInfo = {
  name: '@tradrl/compute',
  owner: 'T014',
  status: 'implemented',
} as const;
