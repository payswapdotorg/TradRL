/**
 * @tradrl/rl-protocol — the trial emission (L11).
 *
 * The bridge's collected evidence lands in the EXPERIMENTS lane's canonical
 * record shape — `@tradrl/experiments`' `TrialRecord` (T011), re-declared
 * here as a field-for-field structural mirror (status vocabulary, invariants
 * and all) so an emitted trial satisfies the REAL package's guards (proven
 * by src/interop.test.ts) without importing it.
 *
 * L11 (search integrity: "optimization history is retained to expose
 * selection effects") shapes the whole module:
 *
 *   - A {@link TrainerTrial} = the trial record + the L9 lineage block; the
 *     pair is what the bridge hands the experiments lane (arm, trajectory
 *     ref, lineage, outcome — the work order's emission contract).
 *   - The {@link TrialLog} is APPEND-ONLY with UNIQUE trial ids: appending a
 *     duplicate trial id or rewriting a recorded trial is a typed
 *     `trial_rewrite` error (the bridge mints one terminal record per
 *     trial; lifecycle progressions belong to the experiments lane's own
 *     log law). Hiding is impossible — there is no removal or update API
 *     anywhere (structurally tested).
 *   - Failures are RECORDS, not exceptions: a failed trial carries its
 *     `failure_reason` in the record itself (the experiments-lane law: an
 *     unexplained failure is not auditable).
 */

import { deepFreeze, isJsonObject, isNonEmptyString, isRecord } from './primitives';
import type { JsonObject } from './primitives';
import { fail, invalidField, invalidType, missingField, ok, type RLError, type RLResult } from './errors';
import { isTimestampMs, type TimestampMs } from './timestamp';
import type { ArmId, TrajectoryId, TrialId } from './ids';
import { isArmId, isTrajectoryId, isTrialId } from './ids';
import type { TrainingRunLineage } from './run';
import { isTrainingRunLineage, validateTrainingRunLineage } from './run';

// ---------------------------------------------------------------------------
// The trial record (exact mirror of @tradrl/experiments' trial.ts)
// ---------------------------------------------------------------------------

/** The closed trial status vocabulary — mirror of experiments' `TrialStatus`. */
export type TrialStatus = 'planned' | 'running' | 'succeeded' | 'failed' | 'rejected';

/** Runtime-checkable list of trial statuses. */
export const TRIAL_STATUSES: readonly TrialStatus[] = ['planned', 'running', 'succeeded', 'failed', 'rejected'];

/** The terminal statuses (no further progression is legal). */
export const TERMINAL_TRIAL_STATUSES: readonly TrialStatus[] = ['succeeded', 'failed', 'rejected'];

/** Runtime guard for a trial status. */
export function isTrialStatus(value: unknown): value is TrialStatus {
  return typeof value === 'string' && (TRIAL_STATUSES as readonly string[]).includes(value);
}

/**
 * One trial of an experiment — EXACT mirror of experiments' `TrialRecord`
 * (status invariants included: `succeeded` requires trajectory AND outcome;
 * `failed`/`rejected` require `failure_reason`; `planned` carries nothing).
 */
export interface TrialRecord {
  readonly trial_id: TrialId;
  /** The comparison arm this trial executes. */
  readonly arm: ArmId;
  readonly status: TrialStatus;
  /** The trajectory this trial produced (REQUIRED for `succeeded`). */
  readonly trajectory: TrajectoryId | null;
  /** Opaque outcome summary (REQUIRED for `succeeded`; produced by evaluation, never fabricated here — L7). */
  readonly outcome: JsonObject | null;
  readonly started_at: TimestampMs | null;
  readonly ended_at: TimestampMs | null;
  /** REQUIRED for `failed` and `rejected` — an unexplained failure is not auditable. */
  readonly failure_reason: string | null;
}

/** Runtime guard for a structurally valid, invariant-abiding trial record. */
export function isTrialRecord(value: unknown): value is TrialRecord {
  if (!isRecord(value)) return false;
  if (!isTrialId(value.trial_id)) return false;
  if (!isArmId(value.arm)) return false;
  if (!isTrialStatus(value.status)) return false;
  if (value.trajectory !== null && !isTrajectoryId(value.trajectory)) return false;
  if (value.outcome !== null && !isJsonObject(value.outcome)) return false;
  if (value.started_at !== null && !isTimestampMs(value.started_at)) return false;
  if (value.ended_at !== null && !isTimestampMs(value.ended_at)) return false;
  if (value.failure_reason !== null && !isNonEmptyString(value.failure_reason)) return false;

  switch (value.status) {
    case 'planned':
      return value.started_at === null && value.ended_at === null && value.failure_reason === null;
    case 'running':
      return value.started_at !== null && value.ended_at === null && value.failure_reason === null;
    case 'succeeded':
      return (
        value.started_at !== null &&
        value.ended_at !== null &&
        value.ended_at >= value.started_at &&
        value.failure_reason === null &&
        value.trajectory !== null &&
        value.outcome !== null
      );
    case 'failed':
      return (
        value.ended_at !== null &&
        value.failure_reason !== null &&
        (value.started_at === null || value.ended_at >= value.started_at)
      );
    case 'rejected':
      return value.ended_at !== null && value.failure_reason !== null && value.started_at === null && value.trajectory === null;
  }
  return false;
}

/**
 * Collect-all validation of an untrusted trial record — mirror of
 * experiments' `validateTrialRecord` (every status invariant enforced and
 * reported with a dotted path). On success the value is returned narrowed,
 * deeply frozen.
 */
export function validateTrialRecord(value: unknown, path = 'trial'): RLResult<TrialRecord> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: RLError[] = [];

  if (value.trial_id === undefined) {
    errors.push(missingField(`${path}.trial_id`));
  } else if (!isTrialId(value.trial_id)) {
    errors.push(invalidField(`${path}.trial_id`, 'must be a non-empty string'));
  }

  if (value.arm === undefined) {
    errors.push(missingField(`${path}.arm`));
  } else if (!isArmId(value.arm)) {
    errors.push(invalidField(`${path}.arm`, 'must be a non-empty arm id'));
  }

  if (value.status === undefined) {
    errors.push(missingField(`${path}.status`));
  } else if (!isTrialStatus(value.status)) {
    errors.push(invalidField(`${path}.status`, `must be one of ${TRIAL_STATUSES.join(' | ')}`));
  }

  if (value.trajectory === undefined) {
    errors.push(missingField(`${path}.trajectory`));
  } else if (value.trajectory !== null && !isTrajectoryId(value.trajectory)) {
    errors.push(invalidField(`${path}.trajectory`, 'must be a non-empty trajectory ref or null'));
  }

  if (value.outcome === undefined) {
    errors.push(missingField(`${path}.outcome`));
  } else if (value.outcome !== null && !isJsonObject(value.outcome)) {
    errors.push(invalidField(`${path}.outcome`, 'must be a JSON object or null'));
  }

  if (value.started_at === undefined) {
    errors.push(missingField(`${path}.started_at`));
  } else if (value.started_at !== null && !isTimestampMs(value.started_at)) {
    errors.push(invalidField(`${path}.started_at`, 'must be a valid TimestampMs or null'));
  }

  if (value.ended_at === undefined) {
    errors.push(missingField(`${path}.ended_at`));
  } else if (value.ended_at !== null && !isTimestampMs(value.ended_at)) {
    errors.push(invalidField(`${path}.ended_at`, 'must be a valid TimestampMs or null'));
  }

  if (value.failure_reason === undefined) {
    errors.push(missingField(`${path}.failure_reason`));
  } else if (value.failure_reason !== null && !isNonEmptyString(value.failure_reason)) {
    errors.push(invalidField(`${path}.failure_reason`, 'must be a non-empty reason or null'));
  }

  // Status invariants (only meaningful when the fields themselves are valid).
  if (errors.length === 0 && isTrialStatus(value.status)) {
    const status: TrialStatus = value.status;
    const started = value.started_at as TimestampMs | null;
    const ended = value.ended_at as TimestampMs | null;
    const failureReason = value.failure_reason as string | null;
    const trajectory = value.trajectory as TrajectoryId | null;
    const outcome = value.outcome as JsonObject | null;

    if (status === 'planned' && (started !== null || ended !== null || failureReason !== null)) {
      errors.push(invalidField(`${path}.status`, 'a planned trial carries no start, end or failure (got one)'));
    }
    if (status === 'running' && (started === null || ended !== null || failureReason !== null)) {
      errors.push(invalidField(`${path}.status`, 'a running trial has started_at set and no end/failure yet'));
    }
    if (status === 'succeeded') {
      if (started === null || ended === null || ended < started) {
        errors.push(invalidField(`${path}.status`, 'a succeeded trial has started_at/ended_at set with ended_at >= started_at'));
      }
      if (failureReason !== null) {
        errors.push(invalidField(`${path}.failure_reason`, 'must be null for a succeeded trial'));
      }
      if (trajectory === null) {
        errors.push(invalidField(`${path}.trajectory`, 'must reference the produced trajectory — success without evidence is inexpressible'));
      }
      if (outcome === null) {
        errors.push(invalidField(`${path}.outcome`, 'must carry the outcome summary for a succeeded trial'));
      }
    }
    if (status === 'failed') {
      if (ended === null) {
        errors.push(invalidField(`${path}.ended_at`, 'must be set for a failed trial'));
      }
      if (failureReason === null) {
        errors.push(invalidField(`${path}.failure_reason`, 'must explain the failure — an unexplained failure is not auditable'));
      }
      if (started !== null && ended !== null && ended < started) {
        errors.push(invalidField(`${path}.ended_at`, 'ended_at may not precede started_at'));
      }
    }
    if (status === 'rejected') {
      if (ended === null) {
        errors.push(invalidField(`${path}.ended_at`, 'must be set for a rejected trial'));
      }
      if (failureReason === null) {
        errors.push(invalidField(`${path}.failure_reason`, 'must state the rejection cause'));
      }
      if (started !== null) {
        errors.push(invalidField(`${path}.started_at`, 'must be null — a rejected trial never ran'));
      }
      if (trajectory !== null) {
        errors.push(invalidField(`${path}.trajectory`, 'must be null — a rejected trial produced no experience'));
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return ok(
    deepFreeze({
      trial_id: value.trial_id as TrialId,
      arm: value.arm as ArmId,
      status: value.status as TrialStatus,
      trajectory: value.trajectory as TrajectoryId | null,
      outcome: value.outcome as JsonObject | null,
      started_at: value.started_at as TimestampMs | null,
      ended_at: value.ended_at as TimestampMs | null,
      failure_reason: value.failure_reason as string | null,
    }),
  );
}

// ---------------------------------------------------------------------------
// The trainer trial (record + lineage — the emission product)
// ---------------------------------------------------------------------------

/**
 * The bridge's emission product: the experiments-lane trial record PLUS the
 * L9 lineage block (the pair the work order's emission contract names:
 * "arm, trajectory ref, lineage block, outcome"). The experiments lane
 * carries lineage at the experiment level; the bridge binds it per trial —
 * evaluation (T012) and audits (T031) resolve the trial's evidence through
 * this block.
 */
export interface TrainerTrial {
  readonly trial: TrialRecord;
  readonly lineage: TrainingRunLineage;
}

/** Runtime guard for a trainer trial. */
export function isTrainerTrial(value: unknown): value is TrainerTrial {
  if (!isRecord(value)) return false;
  return isTrialRecord(value.trial) && isTrainingRunLineage(value.lineage);
}

/** Collect-all validation of an untrusted trainer trial. */
export function validateTrainerTrial(value: unknown, path = 'trainer_trial'): RLResult<TrainerTrial> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: RLError[] = [];
  let trial: TrialRecord | undefined;
  if (value.trial === undefined) {
    errors.push(missingField(`${path}.trial`));
  } else {
    const trialResult = validateTrialRecord(value.trial, `${path}.trial`);
    if (trialResult.ok) {
      trial = trialResult.value;
    } else {
      errors.push(...trialResult.errors);
    }
  }
  if (value.lineage === undefined) {
    errors.push({ code: 'lineage_gap', path: `${path}.lineage`, message: 'the trainer trial lineage block is missing (L9)' });
  } else {
    const lineageResult = validateTrainingRunLineage(value.lineage, `${path}.lineage`);
    if (!lineageResult.ok) errors.push(...lineageResult.errors);
  }
  if (errors.length > 0) return { ok: false, errors };

  const lineageResult = validateTrainingRunLineage(value.lineage, `${path}.lineage`);
  if (!lineageResult.ok) return lineageResult;
  return ok(deepFreeze({ trial: trial as TrialRecord, lineage: lineageResult.value }));
}

// ---------------------------------------------------------------------------
// The append-only trial log (L11)
// ---------------------------------------------------------------------------

/** The append-only trainer trial log: entries in append order, frozen. */
export interface TrialLog {
  readonly entries: readonly TrainerTrial[];
}

/** Runtime guard for a trial log. */
export function isTrialLog(value: unknown): value is TrialLog {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.entries)) return false;
  if (!(value.entries as readonly unknown[]).every((entry) => isTrainerTrial(entry))) return false;
  return true;
}

/** Create an empty trial log. */
export function createTrialLog(): TrialLog {
  return deepFreeze({ entries: [] });
}

/**
 * Append one trainer trial to the log — the ONLY mutation API (L11). Rules:
 *   1. the entry is guard-valid (collect-all);
 *   2. its trial id is NEW — appending a duplicate trial id is a typed
 *      `trial_rewrite` (the bridge mints one terminal record per trial;
 *      rewriting or re-recording a recorded trial is law-violating, never
 *      an update);
 *   3. its trajectory (when present) is no other entry's evidence
 *      (`duplicate_trajectory` — an experience stream belongs to one
 *      trial).
 * Returns a NEW log; the original is untouched. There is no removal,
 * update or reordering entry point anywhere in this module.
 */
export function appendTrainerTrial(log: TrialLog, entry: unknown): RLResult<TrialLog> {
  if (!isTrialLog(log)) {
    return fail('invalid_type', 'appendTrainerTrial requires a valid trial log');
  }
  const entryResult = validateTrainerTrial(entry);
  if (!entryResult.ok) return entryResult;
  const validEntry = entryResult.value;

  if (log.entries.some((existing) => existing.trial.trial_id === validEntry.trial.trial_id)) {
    return fail(
      'trial_rewrite',
      `trial id "${validEntry.trial.trial_id}" is already recorded in the log — the trainer's trial log is append-only with unique ids (L11: hiding or rewriting a trial is a typed error)`,
      'trial.trial_id',
    );
  }
  if (validEntry.trial.trajectory !== null) {
    for (const existing of log.entries) {
      if (existing.trial.trajectory !== null && existing.trial.trajectory === validEntry.trial.trajectory) {
        return fail(
          'duplicate_trajectory',
          `trajectory "${validEntry.trial.trajectory}" is already trial ${existing.trial.trial_id}'s evidence; an experience stream belongs to one trial`,
          'trial.trajectory',
        );
      }
    }
  }
  return ok(deepFreeze({ entries: [...log.entries, validEntry] }));
}

/** The log's raw entries in append order (the audit-side identity — nothing is projected away, L11). */
export function trialLogEntries(log: TrialLog): readonly TrainerTrial[] {
  return log.entries;
}
