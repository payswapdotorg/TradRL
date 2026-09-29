/**
 * @tradrl/compute — the experiments-lane trial record structural mirror
 * (D-003/D-004).
 *
 * The aggregated evidence of distributed episode generation lands in the
 * EXPERIMENTS lane's canonical record shape — `@tradrl/experiments`'
 * `TrialRecord` (T011), itself mirrored field-for-field by
 * `@tradrl/rl-protocol` (T013). This package re-declares the IDENTICAL
 * shape (status vocabulary and invariants included) so an aggregated trial
 * satisfies the REAL package's guards (proven by src/interop.test.ts)
 * without importing it. TypeScript's structural typing keeps the mirrors
 * mutually assignable; the interop test is the drift trip wire.
 *
 * L11 (search integrity) notes for this package: a worker failure is a
 * RETAINED record in the aggregate's failure manifest, never a silent
 * drop — and a succeeded trial always binds its trajectory evidence
 * (`trajectory` REQUIRED for `succeeded`, inexpressible otherwise).
 */

import { deepFreeze, isJsonObject, isNonEmptyString, isRecord } from './primitives';
import type { JsonObject } from './primitives';
import { invalidField, invalidType, missingField, ok, type ComputeError, type ComputeResult } from './errors';
import { isTimestampMs, type TimestampMs } from './timestamp';
import type { ArmId, TrajectoryId, TrialId } from './ids';
import { isArmId, isTrajectoryId, isTrialId } from './ids';

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
export function validateTrialRecord(value: unknown, path = 'trial'): ComputeResult<TrialRecord> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: ComputeError[] = [];

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
// Canonical JSON tree (byte-determinism law)
// ---------------------------------------------------------------------------

/** JSON-tree projection of a trial record (compile-proven JSON safety, no casts). */
export function trialTree(trial: TrialRecord): JsonObject {
  return {
    trial_id: trial.trial_id,
    arm: trial.arm,
    status: trial.status,
    trajectory: trial.trajectory,
    outcome: trial.outcome,
    started_at: trial.started_at,
    ended_at: trial.ended_at,
    failure_reason: trial.failure_reason,
  };
}
