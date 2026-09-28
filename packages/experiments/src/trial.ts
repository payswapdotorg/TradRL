/**
 * @tradrl/experiments — the trial record.
 *
 * A {@link TrialRecord} is ONE TRIAL of an experiment: one execution attempt
 * of one arm under the design. Its status set is the work order's closed
 * vocabulary — `planned | running | succeeded | failed | rejected` — with
 * total invariants:
 *
 *   - `planned`    — not started: `started_at`, `ended_at` null.
 *   - `running`    — started, not terminal: `started_at` set, `ended_at` null.
 *   - `succeeded`  — terminal success: `started_at`/`ended_at` set
 *                    (`ended_at >= started_at`), `trajectory` and `outcome`
 *                    REQUIRED (a success without evidence is inexpressible).
 *   - `failed`     — terminal failure: `ended_at` and `failure_reason`
 *                    REQUIRED; `started_at` may be null (failed to launch);
 *                    a partial `trajectory`/`outcome` may be present.
 *   - `rejected`   — terminal admission-time rejection: `ended_at` and
 *                    `failure_reason` REQUIRED; never ran (`started_at` and
 *                    `trajectory` null).
 *
 * `failure_reason` is REQUIRED exactly when the status is `failed` or
 * `rejected` — an unexplained failure is not an auditable record.
 *
 * There is no update API anywhere in this package: a trial's lifecycle
 * progresses by APPENDING a later record under the same `trial_id` with a
 * strictly forward status (see record.ts) — the earlier records stay in the
 * log, because the search history is the point (L11).
 */

import { deepFreeze, isJsonObject, isNonEmptyString, isRecord } from './primitives';
import type { JsonObject } from './primitives';
import { invalidField, invalidType, missingField, ok, type ExpError, type ExpResult } from './errors';
import { isTimestampMs, type TimestampMs } from './timestamp';
import type { ArmId, TrialId, TrajectoryId } from './ids';
import { isArmId, isTrialId, isTrajectoryId } from './ids';

/** The closed trial status vocabulary (see module header for invariants). */
export type TrialStatus = 'planned' | 'running' | 'succeeded' | 'failed' | 'rejected';

/** Runtime-checkable list of trial statuses. */
export const TRIAL_STATUSES: readonly TrialStatus[] = ['planned', 'running', 'succeeded', 'failed', 'rejected'];

/** The terminal statuses (no further progression is legal). */
export const TERMINAL_TRIAL_STATUSES: readonly TrialStatus[] = ['succeeded', 'failed', 'rejected'];

/** Runtime guard for a trial status. */
export function isTrialStatus(value: unknown): value is TrialStatus {
  return typeof value === 'string' && (TRIAL_STATUSES as readonly string[]).includes(value);
}

/** One trial of an experiment (see module header for the status invariants). */
export interface TrialRecord {
  readonly trial_id: TrialId;
  /** The comparison arm this trial executes. Must exist in the experiment's design. */
  readonly arm: ArmId;
  readonly status: TrialStatus;
  /** The trajectory this trial produced (REQUIRED for `succeeded`). */
  readonly trajectory: TrajectoryId | null;
  /** Opaque outcome summary produced by the evaluator (REQUIRED for `succeeded`). */
  readonly outcome: JsonObject | null;
  readonly started_at: TimestampMs | null;
  readonly ended_at: TimestampMs | null;
  /** REQUIRED for `failed` and `rejected`. */
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
 * Collect-all validation of an untrusted trial record. Every status
 * invariant from the module header is enforced and reported with a dotted
 * path. On success the value is returned narrowed, deeply frozen.
 */
export function validateTrialRecord(value: unknown, path = 'trial'): ExpResult<TrialRecord> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: ExpError[] = [];

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
        errors.push(invalidField(`${path}.outcome`, 'must carry the evaluator outcome summary for a succeeded trial'));
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

/**
 * The strict lifecycle-progression law (L11: history never rewinds). Legal
 * progressions:
 *   planned -> running | succeeded | failed | rejected
 *   running -> succeeded | failed
 * Terminal statuses progress to nothing; same-status appends are regressions.
 */
export function trialProgresses(from: TrialStatus, to: TrialStatus): boolean {
  if (from === 'planned') return to !== 'planned';
  if (from === 'running') return to === 'succeeded' || to === 'failed';
  return false;
}
