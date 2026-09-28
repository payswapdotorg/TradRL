/**
 * @tradrl/experiments — the experiment record lane (T011).
 *
 * Public API: the error/result discipline (`errors.ts`), branded ids and
 * opaque cross-lane references (`ids.ts`), shared contract primitives and
 * the `TimestampMs` mirror, the experiment `design`, the append-only `trial`
 * log and the sealed experiment `record`.
 */

export type { ExpErrorCode, ExpError, ExpResult } from './errors';
export { fail, failures, ok, missingField, invalidField, invalidType } from './errors';

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

export type { TimestampMs } from './timestamp';
export { MIN_TIMESTAMP_MS, MAX_TIMESTAMP_MS, isTimestampMs, timestampMs, requireTimestampMs } from './timestamp';

export type {
  ExperimentId,
  TrialId,
  ArmId,
  CriteriaRef,
  EvaluatorVersionRef,
  SplitPolicyRef,
  TrajectoryId,
  EnvironmentConfigRef,
  DataRef,
  GoalId,
  ProjectId,
  TenantId,
  OrganizationId,
  BodyVersionRef,
  SubstrateRef,
} from './ids';
export {
  isExperimentId,
  isTrialId,
  isArmId,
  isCriteriaRef,
  isEvaluatorVersionRef,
  isSplitPolicyRef,
  isTrajectoryId,
  isEnvironmentConfigRef,
  isDataRef,
  isGoalId,
  isProjectId,
  isTenantId,
  isOrganizationId,
  isBodyVersionRef,
  isSubstrateRef,
} from './ids';

export type { ArmRole, ArmDescriptor, ExperimentDesign } from './design';
export { ARM_ROLES, isArmRole, isArmDescriptor, isExperimentDesign, validateExperimentDesign, findArm } from './design';

export type { TrialStatus, TrialRecord } from './trial';
export { TRIAL_STATUSES, TERMINAL_TRIAL_STATUSES, isTrialStatus, isTrialRecord, validateTrialRecord, trialProgresses } from './trial';

export type {
  TrialCounts,
  ArmCoverage,
  ExperimentFinalization,
  ExperimentRecord,
  ExperimentResult,
  ExperimentSummary,
} from './record';
export {
  isExperimentFinalization,
  isExperimentRecord,
  validateExperimentRecord,
  createExperimentRecord,
  appendTrial,
  finalizeExperimentRecord,
  experimentSummary,
} from './record';

/** Package identity and ownership (Work Order T011). */
export const packageInfo = {
  name: '@tradrl/experiments',
  owner: 'T011',
  status: 'implemented',
} as const;
