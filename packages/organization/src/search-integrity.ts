/**
 * @tradrl/organization — the search-integrity bridge onto the evaluation
 * lane's input shape.
 *
 * THE LAW THIS MODULE SERVES: ARCHITECTURE-LOCK L11 — "Search integrity:
 * optimization history is retained to expose selection effects" — and
 * spec/EVALUATION-PROTOCOL.md ("Preserve search history"). The
 * organization compiler EMITS candidates for evaluation; it never scores
 * acceptance itself (T012 owns that). This bridge maps the candidate log
 * — with its RETAINED rejections and its full enumeration history —
 * LOSSLESSLY onto the evaluation lane's search-integrity INPUT shape
 * (`computeSearchIntegrityReport`'s experiment/statistics/selection
 * triples over the T011 `TrialLogEntry` mirror), so the best-of-N
 * selection effect of an organization search is QUANTIFIED by the
 * evaluation package exactly like any other search's.
 *
 * MIRROR DISCIPLINE (D-003/D-004): the bridge re-declares the evaluation
 * lane's `TrialLogEntry`/`TrialStatistic`/`SelectionClaim` shapes by
 * STRUCTURE (brand tags `TrialId`, `ArmId`, `TrajectoryId`,
 * `ExperimentId` match, so the records are mutually assignable — the
 * compile-time trip wire in interop.test.ts) and re-implements the
 * mirrored STATUS-INVARIANT law. The end-to-end proof (bridge output fed
 * into the REAL `computeSearchIntegrityReport`) lives in the service test
 * suite, which imports both packages.
 *
 * Determinism: the bridge takes the log plus an EXPLICIT base instant
 * (the search itself is timeless — no wall clock ever). Per-candidate
 * instants are derived deterministically: candidate `s` runs
 * `[baseInstant + s - 1, baseInstant + s)`. Rejected candidates never
 * ran: `started_at: null`, `trajectory: null`, and a canonical rendering
 * of their STRUCTURED reasons as `failure_reason` (the reasons stay
 * structured in the log; the bridge renders them deterministically for
 * the evaluation lane's string field).
 */

import {
  type ArmId,
  type ExperimentId,
  type JsonObject,
  type JsonValue,
  type TimestampMs,
  type TrajectoryId,
  type TrialId,
  canonicalJson,
  deepFreeze,
  isMemberOf,
  isNonEmptyString,
  isPositiveInteger,
  isRecord,
  isTimestampMs,
} from './primitives';
import { type OrgResult, invalidField, invalidType } from './errors';
import type { SearchLog } from './candidate';
import { isSearchLog } from './candidate';

// ---------------------------------------------------------------------------
// The evaluation-lane trial mirrors (DO NOT DIVERGE — trip wire in tests)
// ---------------------------------------------------------------------------

/** Trial status — STRUCTURAL MIRROR of the evaluation lane's `TrialStatusMirror` (T011 vocabulary). */
export type BridgeTrialStatus = 'planned' | 'running' | 'succeeded' | 'failed' | 'rejected';

/** Runtime-checkable list of trial statuses (mirror). */
export const BRIDGE_TRIAL_STATUSES: readonly BridgeTrialStatus[] = [
  'planned',
  'running',
  'succeeded',
  'failed',
  'rejected',
] as const;

/** Guard: a trial status (mirror of the evaluation vocabulary). */
export function isBridgeTrialStatus(v: unknown): v is BridgeTrialStatus {
  return isMemberOf(BRIDGE_TRIAL_STATUSES, v);
}

/**
 * One bridge trial entry — STRUCTURAL MIRROR of the evaluation lane's
 * `TrialLogEntry` (the T011 `TrialRecord` mirror), including the full
 * status-invariant law: a success without evidence is inexpressible; an
 * unexplained failure is not an auditable record; a rejected trial never
 * ran.
 */
export interface BridgeTrialEntry {
  readonly trial_id: TrialId;
  readonly arm: ArmId;
  readonly status: BridgeTrialStatus;
  readonly trajectory: TrajectoryId | null;
  readonly outcome: JsonObject | null;
  readonly started_at: TimestampMs | null;
  readonly ended_at: TimestampMs | null;
  readonly failure_reason: string | null;
}

/** Guard: `BridgeTrialEntry` (the mirrored status-invariant law, total). */
export function isBridgeTrialEntry(v: unknown): v is BridgeTrialEntry {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.trial_id)) return false;
  if (!isNonEmptyString(v.arm)) return false;
  if (!isBridgeTrialStatus(v.status)) return false;
  if (v.trajectory !== null && !isNonEmptyString(v.trajectory)) return false;
  if (v.outcome !== null) {
    if (!isRecord(v.outcome)) return false;
    if (!Object.values(v.outcome).every((element) => isJsonValueShallow(element))) return false;
  }
  if (v.started_at !== null && !isTimestampMs(v.started_at)) return false;
  if (v.ended_at !== null && !isTimestampMs(v.ended_at)) return false;
  if (v.failure_reason !== null && !isNonEmptyString(v.failure_reason)) return false;
  switch (v.status) {
    case 'planned':
      return v.started_at === null && v.ended_at === null && v.failure_reason === null;
    case 'running':
      return v.started_at !== null && v.ended_at === null && v.failure_reason === null;
    case 'succeeded':
      return (
        v.started_at !== null &&
        v.ended_at !== null &&
        v.ended_at >= v.started_at &&
        v.failure_reason === null &&
        v.trajectory !== null &&
        v.outcome !== null
      );
    case 'failed':
      return (
        v.ended_at !== null &&
        v.failure_reason !== null &&
        (v.started_at === null || v.ended_at >= v.started_at)
      );
    case 'rejected':
      return v.ended_at !== null && v.failure_reason !== null && v.started_at === null && v.trajectory === null;
  }
  return false;
}

function isJsonValueShallow(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((element) => isJsonValueShallow(element));
  if (typeof value === 'object') {
    return Object.values(value).every((element) => isJsonValueShallow(element));
  }
  return false;
}

/**
 * One bridge trial statistic — STRUCTURAL MIRROR of the evaluation lane's
 * `TrialStatistic`: the candidate's objective score, or `null` for
 * rejected candidates (the evaluation lane's documented law: failures
 * carry null — L11).
 */
export interface BridgeTrialStatistic {
  readonly trial_id: TrialId;
  readonly statistic: number | null;
}

/** Guard: `BridgeTrialStatistic`. */
export function isBridgeTrialStatistic(v: unknown): v is BridgeTrialStatistic {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.trial_id)) return false;
  if (v.statistic === null) return true;
  return typeof v.statistic === 'number' && Number.isFinite(v.statistic);
}

/**
 * The bridge selection claim — STRUCTURAL MIRROR of the evaluation lane's
 * `SelectionClaim`: which candidate the search reported as its best (the
 * proposed candidate).
 */
export interface BridgeSelectionClaim {
  readonly selectedTrialId: TrialId;
}

/** Guard: `BridgeSelectionClaim`. */
export function isBridgeSelectionClaim(v: unknown): v is BridgeSelectionClaim {
  if (!isRecord(v)) return false;
  return isNonEmptyString(v.selectedTrialId);
}

/** The bridge experiment record — mirror of the evaluation input shape. */
export interface BridgeExperiment {
  readonly experiment_id: ExperimentId;
  readonly trials: readonly BridgeTrialEntry[];
}

/** Guard: `BridgeExperiment`. */
export function isBridgeExperiment(v: unknown): v is BridgeExperiment {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.experiment_id)) return false;
  if (!Array.isArray(v.trials)) return false;
  return v.trials.every((trial) => isBridgeTrialEntry(trial));
}

/** The complete search-integrity input triple the bridge emits. */
export interface SearchIntegrityInput {
  readonly experiment: BridgeExperiment;
  readonly statistics: readonly BridgeTrialStatistic[];
  readonly selection: BridgeSelectionClaim;
}

/** Guard: `SearchIntegrityInput`. */
export function isSearchIntegrityInput(v: unknown): v is SearchIntegrityInput {
  if (!isRecord(v)) return false;
  return (
    isBridgeExperiment(v.experiment) &&
    Array.isArray(v.statistics) &&
    v.statistics.every((statistic) => isBridgeTrialStatistic(statistic)) &&
    isBridgeSelectionClaim(v.selection)
  );
}

// ---------------------------------------------------------------------------
// The bridge
// ---------------------------------------------------------------------------

/** The single comparison arm an organization search runs on (mirror semantics). */
export const BRIDGE_ARM = 'organization-search' as ArmId;

/**
 * Maps a validated search log onto the evaluation lane's
 * search-integrity input shape — LOSSLESSLY:
 *
 * - every candidate (proposed, retained AND rejected — L11: failures
 *   retained) becomes one trial in enumeration order;
 * - proposed/retained candidates map to `succeeded` trials carrying the
 *   objective score as the statistic and the score record as the outcome;
 * - rejected candidates map to `rejected` trials (never ran: no start, no
 *   trajectory) whose `failure_reason` is the CANONICAL JSON rendering of
 *   their structured reasons and whose statistic is `null`;
 * - the selection claim names the log's one proposed candidate;
 * - the experiment id is the log's deterministic run id.
 *
 * `baseInstant` is an EXPLICIT parameter (the search is timeless): trial
 * `s` spans `[baseInstant + s - 1, baseInstant + s)`. The same (log,
 * baseInstant) always bridges byte-identically.
 */
export function toSearchIntegrityInput(
  log: SearchLog,
  baseInstant: TimestampMs,
): OrgResult<SearchIntegrityInput> {
  if (!isSearchLog(log)) {
    return { ok: false, errors: [invalidType('log must be a valid SearchLog')] };
  }
  if (!isTimestampMs(baseInstant)) {
    return { ok: false, errors: [invalidField('baseInstant', 'invalid TimestampMs — the bridge instant is an explicit parameter')] };
  }
  const trials: BridgeTrialEntry[] = [];
  const statistics: BridgeTrialStatistic[] = [];
  for (const candidate of log.candidates) {
    const sequence = candidate.sequence;
    if (!isPositiveInteger(sequence)) {
      return {
        ok: false,
        errors: [invalidField(`candidates[${sequence - 1}].sequence`, 'invalid sequence')],
      };
    }
    const trialId = candidate.candidateId as unknown as TrialId;
    if (candidate.disposition === 'rejected') {
      // A rejected candidate NEVER RAN: started_at null, trajectory null,
      // and the canonical rendering of its STRUCTURED reasons.
      const failureReason = canonicalJson({
        reasons: candidate.reasons as unknown as JsonValue,
      });
      trials.push({
        trial_id: trialId,
        arm: BRIDGE_ARM,
        status: 'rejected',
        trajectory: null,
        outcome: null,
        started_at: null,
        ended_at: (baseInstant + sequence) as TimestampMs,
        failure_reason: failureReason,
      });
      statistics.push({ trial_id: trialId, statistic: null });
    } else {
      // Proposed/retained candidates completed their in-search evaluation.
      const trajectory = `${log.searchRunId}:trajectory:${candidate.candidateId}` as TrajectoryId;
      const outcome: JsonObject = deepFreeze({
        objectiveScore: candidate.objective.score,
        attainment: candidate.objective.components.attainment,
        risk: candidate.objective.components.risk,
        compute: candidate.objective.components.compute,
        coordinationCost: candidate.objective.components.coordinationCost,
        latency: candidate.objective.components.latency,
        robustness: candidate.objective.components.robustness,
        redundancy: candidate.objective.components.redundancy,
      });
      trials.push({
        trial_id: trialId,
        arm: BRIDGE_ARM,
        status: 'succeeded',
        trajectory,
        outcome,
        started_at: (baseInstant + sequence - 1) as TimestampMs,
        ended_at: (baseInstant + sequence) as TimestampMs,
        failure_reason: null,
      });
      statistics.push({ trial_id: trialId, statistic: candidate.objective.score });
    }
  }
  return {
    ok: true,
    value: deepFreeze({
      experiment: {
        experiment_id: log.searchRunId as unknown as ExperimentId,
        trials,
      },
      statistics,
      selection: { selectedTrialId: log.selection.selectedCandidateId as unknown as TrialId },
    } satisfies SearchIntegrityInput),
  };
}
