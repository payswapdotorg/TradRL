/**
 * @tradrl/experiments — the experiment record: design + append-only search
 * history + honest finalization.
 *
 * ARCHITECTURE-LOCK L11 (search integrity): "optimization history is
 * retained to expose selection effects." The {@link ExperimentRecord} is the
 * embodiment: `trials` is an append-only log where EVERY trial — successes,
 * failures AND rejections — stays forever. The ONLY mutation API is
 * {@link appendTrial}; there is no update, removal or reordering API
 * anywhere in this package (structurally tested), and appending to a
 * FINALIZED experiment is rejected (`experiment_finalized`).
 *
 * A trial's lifecycle progresses by appending a LATER record under the same
 * `trial_id` with a strictly forward status (`planned -> running ->
 * succeeded|failed`, `planned -> succeeded|failed|rejected`) — the earlier
 * records stay in the log; nothing is rewritten. Projections
 * ({@link experimentSummary}, finalization) always collapse to the LATEST
 * record per `trial_id` while the raw log preserves the full history
 * (`log_entries`), so in-search performance and progression are both
 * reconstructible (spec/EVALUATION-PROTOCOL.md: "Retain search histories and
 * distinguish in-search performance from holdout performance").
 *
 * ARCHITECTURE-LOCK L15 (project continuity) + L9 (reproducible lineage) +
 * L12 (tenant isolation): the record binds tenant, project, goal and
 * criteria refs (opaque), and the design binds environment, bodies,
 * substrates, datasets and evaluator version (see design.ts).
 *
 * Finalization ({@link finalizeExperimentRecord}) is once-only and produces
 * an {@link ExperimentResult} whose `limitations` are COMPUTED from the
 * record state — never caller-supplied — so an experiment cannot graduate
 * with silently unreported holes: non-terminal trials, arms without a
 * succeeded trial, or zero succeeded trials all surface as explicit,
 * machine-derived limitations ("honest limitations").
 */

import { deepFreeze, isRecord } from './primitives';
import type { JsonObject } from './primitives';
import { fail, invalidField, invalidType, missingField, ok, type ExpError, type ExpResult } from './errors';
import { isTimestampMs, type TimestampMs } from './timestamp';
import type { ArmId, CriteriaRef, ExperimentId, GoalId, ProjectId, TenantId, TrialId, TrajectoryId } from './ids';
import { isCriteriaRef, isExperimentId, isGoalId, isProjectId, isTenantId } from './ids';
import type { ArmDescriptor, ArmRole, ExperimentDesign } from './design';
import { findArm, isExperimentDesign, validateExperimentDesign } from './design';
import type { TrialRecord, TrialStatus } from './trial';
import { TERMINAL_TRIAL_STATUSES, isTrialRecord, trialProgresses, validateTrialRecord } from './trial';

/** Counts by trial status (latest record per trial id). */
export interface TrialCounts {
  readonly planned: number;
  readonly running: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly rejected: number;
  readonly total: number;
}

/** Per-arm coverage (latest record per trial id). */
export interface ArmCoverage {
  readonly arm: ArmId;
  readonly role: ArmRole;
  readonly succeeded: number;
  readonly failed: number;
  readonly rejected: number;
  readonly non_terminal: number;
  readonly total: number;
}

/** The immutable finalization stamp carried by a closed experiment record. */
export interface ExperimentFinalization {
  readonly finalized_at: TimestampMs;
  /** The caller's opaque aggregate outcome (never interpreted here). */
  readonly outcome: JsonObject | null;
}

/**
 * The experiment record: lineage (tenant/project/goal/criteria — L15/L12) +
 * design (L9) + the append-only trial log (L11) + finalization (null while
 * open).
 */
export interface ExperimentRecord {
  readonly experiment_id: ExperimentId;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly goal: GoalId;
  /** The experiment's success criteria (non-empty — L15 continuity). */
  readonly criteria: readonly CriteriaRef[];
  readonly design: ExperimentDesign;
  readonly trials: readonly TrialRecord[];
  readonly finalization: ExperimentFinalization | null;
}

/**
 * The terminal product of finalization: status counts over the trial log,
 * the caller's opaque outcome, and the COMPUTED honest limitations.
 */
export interface ExperimentResult {
  readonly experiment_id: ExperimentId;
  readonly finalized_at: TimestampMs;
  readonly trial_counts: TrialCounts;
  /** Number of appended log entries (>= total trials when progressions exist). */
  readonly log_entries: number;
  readonly outcome: JsonObject | null;
  /** Machine-derived honesty statements (see module header). Never empty when the record has holes. */
  readonly limitations: readonly string[];
}

/** The summary projection of a record (works on open and finalized records). */
export interface ExperimentSummary {
  readonly experiment_id: ExperimentId;
  readonly finalized: boolean;
  /** Distinct trial ids in the log. */
  readonly total_trials: number;
  /** Raw appended entries (progressions included — the full search history). */
  readonly log_entries: number;
  readonly status_counts: TrialCounts;
  readonly arm_coverage: readonly ArmCoverage[];
}

/** Runtime guard for a finalization stamp. */
export function isExperimentFinalization(value: unknown): value is ExperimentFinalization {
  if (!isRecord(value)) return false;
  if (!isTimestampMs(value.finalized_at)) return false;
  if (value.outcome !== null) {
    // Structural JSON-object check without importing the trajectory package.
    if (typeof value.outcome !== 'object' || Array.isArray(value.outcome)) return false;
    if (!Object.values(value.outcome).every((element) => isJsonValueShallow(element))) return false;
  }
  return true;
}

function isJsonValueShallow(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((element) => isJsonValueShallow(element));
  if (typeof value === 'object') return Object.values(value).every((element) => isJsonValueShallow(element));
  return false;
}

/** Runtime guard for a structurally valid experiment record (cross-step laws included). */
export function isExperimentRecord(value: unknown): value is ExperimentRecord {
  if (!isRecord(value)) return false;
  if (!isExperimentId(value.experiment_id)) return false;
  if (!isTenantId(value.tenant)) return false;
  if (!isProjectId(value.project)) return false;
  if (!isGoalId(value.goal)) return false;
  if (!Array.isArray(value.criteria) || value.criteria.length === 0) return false;
  if (!(value.criteria as readonly unknown[]).every((ref) => isCriteriaRef(ref))) return false;
  if (!isExperimentDesign(value.design)) return false;
  if (!Array.isArray(value.trials)) return false;
  if (!(value.trials as readonly unknown[]).every((trial) => isTrialRecord(trial))) return false;
  if (value.finalization !== null && !isExperimentFinalization(value.finalization)) return false;
  return true;
}

/**
 * Collect-all validation of an untrusted experiment record. Validates the
 * lineage block, the design, every trial, then the cross-trial laws: trial
 * ids may repeat only as strict progressions (same arm, trajectory only
 * ever recorded, never un-recorded), trajectories are unique across trials,
 * arms exist in the design, and a finalized record accepts no trials after
 * its finalization stamp. On success the value is returned narrowed, deeply
 * frozen.
 */
export function validateExperimentRecord(value: unknown, path = 'experiment'): ExpResult<ExperimentRecord> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: ExpError[] = [];

  if (value.experiment_id === undefined) {
    errors.push(missingField(`${path}.experiment_id`));
  } else if (!isExperimentId(value.experiment_id)) {
    errors.push(invalidField(`${path}.experiment_id`, 'must be a non-empty string'));
  }

  if (value.tenant === undefined) {
    errors.push(missingField(`${path}.tenant`));
  } else if (!isTenantId(value.tenant)) {
    errors.push(invalidField(`${path}.tenant`, 'must be a non-empty tenant id (L12)'));
  }

  if (value.project === undefined) {
    errors.push(missingField(`${path}.project`));
  } else if (!isProjectId(value.project)) {
    errors.push(invalidField(`${path}.project`, 'must be a non-empty project id (L15)'));
  }

  if (value.goal === undefined) {
    errors.push(missingField(`${path}.goal`));
  } else if (!isGoalId(value.goal)) {
    errors.push(invalidField(`${path}.goal`, 'must be a non-empty goal ref (L15)'));
  }

  if (value.criteria === undefined) {
    errors.push(missingField(`${path}.criteria`));
  } else if (!Array.isArray(value.criteria) || value.criteria.length === 0) {
    errors.push(invalidField(`${path}.criteria`, 'must be a non-empty array of criteria refs (L15)'));
  } else {
    (value.criteria as readonly unknown[]).forEach((ref, index) => {
      if (!isCriteriaRef(ref)) {
        errors.push(invalidField(`${path}.criteria[${index}]`, 'must be a non-empty criteria ref'));
      }
    });
  }

  let design: ExperimentDesign | undefined;
  if (value.design === undefined) {
    errors.push(missingField(`${path}.design`));
  } else {
    const designResult = validateExperimentDesign(value.design, `${path}.design`);
    if (designResult.ok) {
      design = designResult.value;
    } else {
      errors.push(...designResult.errors);
    }
  }

  if (value.finalization !== undefined && value.finalization !== null && !isExperimentFinalization(value.finalization)) {
    errors.push(invalidField(`${path}.finalization`, 'must be { finalized_at, outcome } with a valid TimestampMs'));
  }

  if (errors.length > 0) return { ok: false, errors };

  const trials: TrialRecord[] = [];
  if (!Array.isArray(value.trials)) {
    return { ok: false, errors: [invalidField(`${path}.trials`, 'must be an array of trial records')] };
  }
  const latest = new Map<TrialId, TrialRecord>();
  const trajectories = new Map<TrajectoryId, TrialId>();
  for (let index = 0; index < value.trials.length; index++) {
    const trialResult = validateTrialRecord(value.trials[index], `${path}.trials[${index}]`);
    if (!trialResult.ok) return trialResult;
    const trial = trialResult.value;

    if (design !== undefined && findArm(design, trial.arm) === undefined) {
      return fail('unknown_arm', `trial ${trial.trial_id} names arm "${trial.arm}" which is not in the design`, `${path}.trials[${index}].arm`);
    }

    if (trial.trajectory !== null) {
      const owner = trajectories.get(trial.trajectory);
      if (owner !== undefined && owner !== trial.trial_id) {
        return fail(
          'duplicate_trajectory',
          `trajectory "${trial.trajectory}" is already the evidence of trial ${owner}; an experience stream belongs to one trial`,
          `${path}.trials[${index}].trajectory`,
        );
      }
      trajectories.set(trial.trajectory, trial.trial_id);
    }

    const previous = latest.get(trial.trial_id);
    if (previous === undefined) {
      latest.set(trial.trial_id, trial);
    } else {
      if (previous.arm !== trial.arm) {
        return fail(
          'trial_regression',
          `trial ${trial.trial_id} changed arms ("${previous.arm}" -> "${trial.arm}"); a trial executes one arm`,
          `${path}.trials[${index}].arm`,
        );
      }
      if (!trialProgresses(previous.status, trial.status)) {
        return fail(
          'trial_regression',
          `trial ${trial.trial_id} cannot progress ${previous.status} -> ${trial.status}; lifecycle moves strictly forward and history never rewinds (L11)`,
          `${path}.trials[${index}].status`,
        );
      }
      if (previous.trajectory !== null && trial.trajectory !== previous.trajectory) {
        return fail(
          'trial_regression',
          `trial ${trial.trial_id} cannot change or un-record its trajectory evidence`,
          `${path}.trials[${index}].trajectory`,
        );
      }
      latest.set(trial.trial_id, trial);
    }
    trials.push(trial);
  }

  return ok(
    deepFreeze({
      experiment_id: value.experiment_id as ExperimentId,
      tenant: value.tenant as TenantId,
      project: value.project as ProjectId,
      goal: value.goal as GoalId,
      criteria: (value.criteria as readonly CriteriaRef[]).slice(),
      design: design as ExperimentDesign,
      trials,
      finalization: value.finalization === undefined ? null : (value.finalization as ExperimentFinalization | null),
    }),
  );
}

/**
 * Construct an open experiment record (no trials, no finalization). The
 * design and lineage block are validated; the trial log starts empty.
 * Smuggling a non-empty `trials` array through the input is rejected — the
 * ONLY way to grow the log is {@link appendTrial}.
 */
export function createExperimentRecord(value: unknown): ExpResult<ExperimentRecord> {
  const inputTrials = isRecord(value) ? value.trials : undefined;
  if (Array.isArray(inputTrials) && inputTrials.length > 0) {
    return fail('invalid_field', 'createExperimentRecord builds an OPEN record; use appendTrial to grow the log', 'trials');
  }
  const candidate = isRecord(value) ? { ...value, trials: [], finalization: null } : value;
  return validateExperimentRecord(candidate);
}

/**
 * Append one trial to the log (the ONLY mutation API — L11). Rules:
 *   1. the record is not finalized (`experiment_finalized`);
 *   2. the trial is guard-valid (collect-all);
 *   3. its arm exists in the design (`unknown_arm`);
 *   4. a NEW trial id appends freely; an EXISTING one must strictly progress
 *      its lifecycle, keep its arm and keep-or-set its trajectory
 *      (`trial_regression`);
 *   5. its trajectory (when present) is not another trial's evidence
 *      (`duplicate_trajectory`).
 * Returns a NEW record; the original is untouched.
 */
export function appendTrial(record: ExperimentRecord, trial: unknown): ExpResult<ExperimentRecord> {
  if (record.finalization !== null) {
    return fail(
      'experiment_finalized',
      `experiment ${record.experiment_id} was finalized at ${record.finalization.finalized_at}; the trial log is frozen`,
    );
  }
  const trialResult = validateTrialRecord(trial);
  if (!trialResult.ok) return trialResult;
  const validTrial = trialResult.value;

  if (findArm(record.design, validTrial.arm) === undefined) {
    return fail('unknown_arm', `trial ${validTrial.trial_id} names arm "${validTrial.arm}" which is not in the design`, 'trial.arm');
  }

  for (const existing of record.trials) {
    if (existing.trajectory !== null && validTrial.trajectory === existing.trajectory && existing.trial_id !== validTrial.trial_id) {
      return fail(
        'duplicate_trajectory',
        `trajectory "${existing.trajectory}" is already the evidence of trial ${existing.trial_id}; an experience stream belongs to one trial`,
        'trial.trajectory',
      );
    }
  }

  const previous = latestRecordOf(record, validTrial.trial_id);
  if (previous !== undefined) {
    if (previous.arm !== validTrial.arm) {
      return fail('trial_regression', `trial ${validTrial.trial_id} cannot change arms ("${previous.arm}" -> "${validTrial.arm}")`, 'trial.arm');
    }
    if (!trialProgresses(previous.status, validTrial.status)) {
      return fail(
        'trial_regression',
        `trial ${validTrial.trial_id} cannot progress ${previous.status} -> ${validTrial.status}; lifecycle moves strictly forward (L11)`,
        'trial.status',
      );
    }
    if (previous.trajectory !== null && validTrial.trajectory !== previous.trajectory) {
      return fail('trial_regression', `trial ${validTrial.trial_id} cannot change or un-record its trajectory evidence`, 'trial.trajectory');
    }
  }

  return ok(deepFreeze({ ...record, trials: [...record.trials, validTrial] }));
}

/** The latest record for a trial id, or `undefined`. */
function latestRecordOf(record: ExperimentRecord, trialId: TrialId): TrialRecord | undefined {
  let latest: TrialRecord | undefined;
  for (const trial of record.trials) {
    if (trial.trial_id === trialId) latest = trial;
  }
  return latest;
}

/** Collapse the log to the latest record per trial id (order of first appearance). */
function latestTrials(record: ExperimentRecord): readonly TrialRecord[] {
  const latest = new Map<TrialId, TrialRecord>();
  const order: TrialRecord[] = [];
  for (const trial of record.trials) {
    if (!latest.has(trial.trial_id)) order.push(trial);
    latest.set(trial.trial_id, trial);
  }
  return order.map((trial) => latest.get(trial.trial_id) as TrialRecord);
}

/** Count trials by latest status. */
function countByStatus(trials: readonly TrialRecord[]): TrialCounts {
  const counts: Record<TrialStatus, number> = { planned: 0, running: 0, succeeded: 0, failed: 0, rejected: 0 };
  for (const trial of trials) counts[trial.status] += 1;
  return { ...counts, total: trials.length };
}

/**
 * The summary projection: status counts and arm coverage over the LATEST
 * record per trial id, plus the raw log-entry count. An experiment with
 * mixed succeeded/failed/rejected trials reports ALL of them — nothing is
 * dropped (acceptance #8).
 */
export function experimentSummary(record: ExperimentRecord): ExperimentSummary {
  const latest = latestTrials(record);
  const statusCounts = countByStatus(latest);
  const armCoverage: ArmCoverage[] = record.design.comparison.map((arm) => {
    const armTrials = latest.filter((trial) => trial.arm === arm.arm);
    const succeeded = armTrials.filter((trial) => trial.status === 'succeeded').length;
    const failed = armTrials.filter((trial) => trial.status === 'failed').length;
    const rejected = armTrials.filter((trial) => trial.status === 'rejected').length;
    const nonTerminal = armTrials.filter((trial) => trial.status === 'planned' || trial.status === 'running').length;
    return { arm: arm.arm, role: arm.role, succeeded, failed, rejected, non_terminal: nonTerminal, total: armTrials.length };
  });
  return deepFreeze({
    experiment_id: record.experiment_id,
    finalized: record.finalization !== null,
    total_trials: latest.length,
    log_entries: record.trials.length,
    status_counts: statusCounts,
    arm_coverage: armCoverage,
  });
}

/** Compute the honest limitations of a finalization (see module header). */
function computeLimitations(latest: readonly TrialRecord[], armCoverage: readonly ArmCoverage[]): readonly string[] {
  const limitations: string[] = [];
  const nonTerminal = latest.filter((trial) => trial.status === 'planned' || trial.status === 'running');
  if (nonTerminal.length > 0) {
    limitations.push(
      `${nonTerminal.length} trial(s) were still non-terminal (planned/running) at finalization; their outcomes are absent from this result`,
    );
  }
  for (const arm of armCoverage) {
    if (arm.succeeded === 0) {
      limitations.push(`arm "${arm.arm}" (${arm.role}) produced no succeeded trial; its comparison is incomplete`);
    }
  }
  const succeeded = latest.filter((trial) => trial.status === 'succeeded').length;
  if (succeeded === 0) {
    limitations.push('no trial succeeded; the experiment is inconclusive on its own evidence');
  }
  return limitations;
}

/**
 * Finalize the experiment (once-only). Requires at least one appended trial
 * (`no_trials`) and a valid `finalized_at` TimestampMs. Produces the closed
 * record (the log is frozen from here on) and the {@link ExperimentResult}
 * with status counts, the caller's opaque outcome, and the COMPUTED honest
 * limitations.
 */
export function finalizeExperimentRecord(
  record: ExperimentRecord,
  finalization: { readonly finalized_at: TimestampMs; readonly outcome?: JsonObject | null },
): ExpResult<{ readonly record: ExperimentRecord; readonly result: ExperimentResult }> {
  if (record.finalization !== null) {
    return fail('already_finalized', `experiment ${record.experiment_id} was already finalized at ${record.finalization.finalized_at}`);
  }
  if (!isTimestampMs(finalization.finalized_at)) {
    return fail('invalid_finalization', 'finalized_at must be a valid TimestampMs', 'finalized_at');
  }
  if (finalization.outcome !== undefined && finalization.outcome !== null && !isJsonObjectShallow(finalization.outcome)) {
    return fail('invalid_finalization', 'outcome must be a JSON object or null', 'outcome');
  }
  if (record.trials.length === 0) {
    return fail('no_trials', `experiment ${record.experiment_id} cannot finalize with an empty trial log — an experiment that ran nothing is not an experiment`);
  }

  const latest = latestTrials(record);
  const trialCounts = countByStatus(latest);
  const summary = experimentSummary(record);
  const limitations = computeLimitations(latest, summary.arm_coverage);

  const closedRecord: ExperimentRecord = deepFreeze({
    ...record,
    finalization: { finalized_at: finalization.finalized_at, outcome: finalization.outcome ?? null },
  });
  const result: ExperimentResult = deepFreeze({
    experiment_id: record.experiment_id,
    finalized_at: finalization.finalized_at,
    trial_counts: trialCounts,
    log_entries: record.trials.length,
    outcome: finalization.outcome ?? null,
    limitations,
  });
  return ok({ record: closedRecord, result });
}

/** All terminal trial statuses (re-exported for consumers reasoning about finality). */
export { TERMINAL_TRIAL_STATUSES };

function isJsonObjectShallow(value: unknown): value is JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((element) => isJsonValueShallow(element));
}
