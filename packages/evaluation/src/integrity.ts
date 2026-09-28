/**
 * @tradrl/evaluation — search-integrity reporting over the full trial log.
 *
 * Spec anchors: spec/EVALUATION-PROTOCOL.md ("Selection integrity: Retain
 * search histories and distinguish in-search performance from holdout
 * performance"), spec/ARCHITECTURE.md "Evaluation" ("Preserve search
 * history"), ARCHITECTURE-LOCK L11 ("Search integrity: optimization
 * history is retained to expose selection effects"), spec/DOMAIN-MODEL.md
 * (Experiment).
 *
 * THE LAW THIS MODULE ENFORCES: evaluation reads the FULL experiment trial
 * log — including failures and rejections — and quantifies the best-of-N
 * selection effect. "Never accept the best backtest found during search as
 * sufficient evidence" is implemented structurally:
 *
 * - The input is the RAW append-only log (every entry, progressions
 *   included) mirrored from T011 experiments' `TrialRecord`
 *   ({@link TrialLogEntry}); the report counts from the LATEST record per
 *   trial id while retaining the raw entry count — in-search progression
 *   stays reconstructible.
 * - HIDING TRIALS IS A TYPED ERROR: the per-trial statistics must cover
 *   EVERY distinct trial id of the log (`hidden_trials`) and may name no
 *   trial outside it (`unknown_statistic`). A caller that drops the failed
 *   trials from its statistics array to make the search look cleaner gets
 *   a typed rejection, not a rosier report.
 * - The best-of-N effect is QUANTIFIED, never hidden: against the caller's
 *   declared selection (which trial the search reported as its best), the
 *   report states the selected trial's statistic (the reported number),
 *   the BLIND-SELECTION EXPECTATION (the mean statistic over all candidate
 *   trials — what a blind pick would expect), and the selection inflation
 *   (reported minus expectation). `selectedIsBest` additionally flags
 *   whether the "selection" is even the argmax of the candidates — a
 *   selection that is NOT the best is itself an integrity signal.
 */

import { deepFreeze, isFiniteNumber, isJsonObject, isNonEmptyString, isRecord, isTimestampMs, stableDigestJson, type JsonObject, type JsonValue, type TimestampMs } from './primitives';
import {
  isArmId,
  isExperimentId,
  isTrialId,
  isTrajectoryId,
  type ArmId,
  type ExperimentId,
  type TrialId,
  type TrajectoryId,
} from './ids';
import { invalidField, invalidType, fail, missingField, ok, type EvalError, type EvalResult } from './errors';

// ---------------------------------------------------------------------------
// Trial log mirror — T011 experiments TrialRecord (DO NOT DIVERGE)
// ---------------------------------------------------------------------------

/** Trial status — STRUCTURAL MIRROR of T011 experiments' `TrialStatus`. */
export type TrialStatusMirror = 'planned' | 'running' | 'succeeded' | 'failed' | 'rejected';

/** Runtime-checkable list of trial statuses (mirror of T011's vocabulary). */
export const TRIAL_STATUSES_MIRROR: readonly TrialStatusMirror[] = ['planned', 'running', 'succeeded', 'failed', 'rejected'] as const;

/** Guard: a trial status (mirror of T011's vocabulary). */
export function isTrialStatusMirror(v: unknown): v is TrialStatusMirror {
  return typeof v === 'string' && (TRIAL_STATUSES_MIRROR as readonly string[]).includes(v);
}

/**
 * One trial log entry — STRUCTURAL MIRROR of T011 experiments'
 * `TrialRecord`, with the full status-invariant law mirrored from the
 * reference (a success without evidence is inexpressible; an unexplained
 * failure is not an auditable record; a rejected trial never ran).
 */
export interface TrialLogEntry {
  readonly trial_id: TrialId;
  readonly arm: ArmId;
  readonly status: TrialStatusMirror;
  readonly trajectory: TrajectoryId | null;
  readonly outcome: JsonObject | null;
  readonly started_at: TimestampMs | null;
  readonly ended_at: TimestampMs | null;
  readonly failure_reason: string | null;
}

/** Guard: `TrialLogEntry` (the T011 status invariants mirrored). */
export function isTrialLogEntry(v: unknown): v is TrialLogEntry {
  if (!isRecord(v)) return false;
  if (!isTrialId(v.trial_id)) return false;
  if (!isArmId(v.arm)) return false;
  if (!isTrialStatusMirror(v.status)) return false;
  if (v.trajectory !== null && !isTrajectoryId(v.trajectory)) return false;
  if (v.outcome !== null && !isJsonObject(v.outcome)) return false;
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

// ---------------------------------------------------------------------------
// Inputs: statistics over the log, and the selection claim
// ---------------------------------------------------------------------------

/**
 * One trial's reported statistic — the evaluator's own summary number for
 * the trial's outcome (opaque semantics; the evaluation lane only reads its
 * VALUE). `statistic` is null when the trial produced none (planned /
 * running / failed-to-launch / rejected trials legitimately carry null).
 */
export interface TrialStatistic {
  readonly trial_id: TrialId;
  readonly statistic: number | null;
}

/** Guard: `TrialStatistic`. */
export function isTrialStatistic(v: unknown): v is TrialStatistic {
  if (!isRecord(v)) return false;
  if (!isTrialId(v.trial_id)) return false;
  if (v.statistic === null) return true;
  return isFiniteNumber(v.statistic);
}

/** The search's declared selection: which trial was reported as the best. */
export interface SelectionClaim {
  readonly selectedTrialId: TrialId;
}

/** Guard: `SelectionClaim`. */
export function isSelectionClaim(v: unknown): v is SelectionClaim {
  if (!isRecord(v)) return false;
  return isTrialId(v.selectedTrialId);
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/** The quantified best-of-N selection effect (L11: computed, never hidden). */
export interface BestOfNEffect {
  /** The trial the search reported as its best. */
  readonly selectedTrialId: TrialId;
  /** The selected trial's statistic — the reported number. */
  readonly reportedStatistic: number;
  /**
   * Blind-selection expectation: the mean statistic over all candidate
   * trials (the number a BLIND pick would expect — the honest baseline the
   * reported number must be judged against).
   */
  readonly blindSelectionExpectation: number;
  /** Number of candidate trials that carried a statistic. */
  readonly candidates: number;
  /** reportedStatistic - blindSelectionExpectation: the quantified selection inflation. */
  readonly selectionInflation: number;
  /** True iff the selected trial is the argmax of the candidates' statistics. */
  readonly selectedIsBest: boolean;
}

/**
 * The search-integrity report over one experiment's FULL trial log. All
 * facts; no narrative: counts of what the log retains (including failures
 * and rejections — L11's point) and the quantified selection effect.
 */
export interface SearchIntegrityReport {
  /** Deterministic derived id (digest over experiment + log + statistics + selection). */
  readonly reportId: string;
  readonly experiment: ExperimentId;
  /** Distinct trial ids in the log (the latest-record projection size). */
  readonly trialsCounted: number;
  /** Raw appended log entries (>= trialsCounted when progressions were recorded). */
  readonly logEntries: number;
  /** Recorded lifecycle progressions (logEntries - trialsCounted — retained history). */
  readonly progressions: number;
  readonly succeeded: number;
  /** Latest-status failed trials — RETAINED and counted (L11). */
  readonly failuresRetained: number;
  /** Latest-status rejected trials — RETAINED and counted (L11). */
  readonly rejectionsRetained: number;
  /** Latest-status planned/running trials. */
  readonly nonTerminal: number;
  /** The quantified best-of-N selection effect (null only when no trial carried a statistic). */
  readonly bestOfN: BestOfNEffect | null;
}

/** Guard: `BestOfNEffect`. */
export function isBestOfNEffect(v: unknown): v is BestOfNEffect {
  if (!isRecord(v)) return false;
  if (!isTrialId(v.selectedTrialId)) return false;
  if (!isFiniteNumber(v.reportedStatistic)) return false;
  if (!isFiniteNumber(v.blindSelectionExpectation)) return false;
  if (!Number.isInteger(v.candidates) || (v.candidates as number) < 0) return false;
  if (!isFiniteNumber(v.selectionInflation)) return false;
  return typeof v.selectedIsBest === 'boolean';
}

/** Guard: `SearchIntegrityReport`. */
export function isSearchIntegrityReport(v: unknown): v is SearchIntegrityReport {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.reportId)) return false;
  if (!isExperimentId(v.experiment)) return false;
  if (!Number.isInteger(v.trialsCounted) || (v.trialsCounted as number) < 0) return false;
  if (!Number.isInteger(v.logEntries) || (v.logEntries as number) < 0) return false;
  if (!Number.isInteger(v.progressions) || (v.progressions as number) < 0) return false;
  if (!Number.isInteger(v.succeeded) || (v.succeeded as number) < 0) return false;
  if (!Number.isInteger(v.failuresRetained) || (v.failuresRetained as number) < 0) return false;
  if (!Number.isInteger(v.rejectionsRetained) || (v.rejectionsRetained as number) < 0) return false;
  if (!Number.isInteger(v.nonTerminal) || (v.nonTerminal as number) < 0) return false;
  if (v.bestOfN !== null && !isBestOfNEffect(v.bestOfN)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The computation
// ---------------------------------------------------------------------------

/**
 * Compute the search-integrity report over an experiment's FULL trial log.
 *
 * Inputs:
 * - `experiment` — `{ experiment_id, trials }` where `trials` is the RAW
 *   append-only log (every entry, progressions included — the T011 mirror
 *   shape);
 * - `statistics` — one statistic per DISTINCT trial id of the log;
 * - `selection` — the search's declared best trial.
 *
 * Typed error laws (fail-closed, L11):
 * - `invalid_trial` — a log entry fails the mirrored structural law;
 * - `hidden_trials` — the statistics do not cover every distinct trial id
 *   of the log (hiding trials is a typed error, never a cleaner report);
 * - `unknown_statistic` — a statistic names a trial the log does not contain;
 * - `selection_not_in_log` / `selected_without_statistic` — the selection
 *   claim is not backed by the log and a statistic;
 * - `no_candidates` — no trial carried a statistic, so the best-of-N effect
 *   is undefined (the report refuses to invent one).
 *
 * Determinism: a pure function of (experiment, statistics, selection); the
 * derived `reportId` is a digest over the canonical JSON of all three.
 */
export function computeSearchIntegrityReport(
  experiment: { readonly experiment_id: ExperimentId; readonly trials: readonly unknown[] },
  statistics: readonly unknown[],
  selection: unknown,
): EvalResult<SearchIntegrityReport> {
  if (!isRecord(experiment)) {
    return { ok: false, errors: [invalidType('experiment must be an object')] };
  }
  if (experiment.experiment_id === undefined) {
    return { ok: false, errors: [missingField('experiment_id')] };
  }
  if (!isExperimentId(experiment.experiment_id)) {
    return { ok: false, errors: [invalidField('experiment_id', 'must be a non-empty experiment id')] };
  }
  if (!Array.isArray(experiment.trials)) {
    return { ok: false, errors: [invalidField('trials', 'must be the raw append-only trial log')] };
  }
  const structural: EvalError[] = [];
  experiment.trials.forEach((entry, index) => {
    if (!isTrialLogEntry(entry)) {
      structural.push(invalidField(`trials[${index}]`, 'failed the mirrored TrialRecord structural law (T011 status invariants)'));
    }
  });
  if (structural.length > 0) return { ok: false, errors: structural };

  // Latest record per trial id (order of first appearance) — the projection.
  const latest = new Map<TrialId, TrialLogEntry>();
  const order: TrialLogEntry[] = [];
  for (const entry of experiment.trials) {
    const trial = entry as TrialLogEntry;
    if (!latest.has(trial.trial_id)) order.push(trial);
    latest.set(trial.trial_id, trial);
  }

  // Statistics coverage: EXACTLY one entry per distinct trial id.
  if (!Array.isArray(statistics)) {
    return { ok: false, errors: [invalidField('statistics', 'must be an array of trial statistics')] };
  }
  const statsByTrial = new Map<TrialId, TrialStatistic>();
  for (const candidate of statistics) {
    if (!isTrialStatistic(candidate)) {
      return { ok: false, errors: [invalidField('statistics', 'every entry must be { trial_id, statistic } with a finite or null statistic')] };
    }
    if (statsByTrial.has(candidate.trial_id)) {
      return fail('unknown_statistic', `duplicate statistic for trial "${candidate.trial_id}"`, 'statistics');
    }
    statsByTrial.set(candidate.trial_id, candidate);
  }
  const hidden: TrialId[] = [];
  for (const trial of order) {
    if (!statsByTrial.has(trial.trial_id)) hidden.push(trial.trial_id);
  }
  if (hidden.length > 0) {
    return fail(
      'hidden_trials',
      `statistics cover ${statsByTrial.size} of ${order.length} distinct trial(s); missing: ${hidden.map((id) => `"${id}"`).join(', ')} — hiding trials is a typed error (L11)`,
      'statistics',
    );
  }
  for (const trialId of statsByTrial.keys()) {
    if (!latest.has(trialId)) {
      return fail('unknown_statistic', `statistic names trial "${trialId}" which is not in the log`, 'statistics');
    }
  }

  // Selection claim.
  if (!isSelectionClaim(selection)) {
    return { ok: false, errors: [invalidField('selection', 'must be { selectedTrialId } naming the search-reported best trial')] };
  }
  const selected = latest.get(selection.selectedTrialId);
  if (selected === undefined) {
    return fail('selection_not_in_log', `selection names trial "${selection.selectedTrialId}" which is not in the log`, 'selection.selectedTrialId');
  }
  const selectedStatistic = statsByTrial.get(selection.selectedTrialId)?.statistic;
  if (selectedStatistic === undefined || selectedStatistic === null) {
    return fail(
      'selected_without_statistic',
      `selected trial "${selection.selectedTrialId}" carries no statistic — the selection effect cannot be quantified`,
      'selection.selectedTrialId',
    );
  }

  // Counts from the latest-record projection.
  let succeeded = 0;
  let failed = 0;
  let rejected = 0;
  let nonTerminal = 0;
  for (const trial of order) {
    const record = latest.get(trial.trial_id) as TrialLogEntry;
    if (record.status === 'succeeded') succeeded += 1;
    else if (record.status === 'failed') failed += 1;
    else if (record.status === 'rejected') rejected += 1;
    else nonTerminal += 1;
  }

  // Candidates: latest-status succeeded trials that carried a statistic.
  const candidates: { readonly trialId: TrialId; readonly statistic: number }[] = [];
  for (const trial of order) {
    const record = latest.get(trial.trial_id) as TrialLogEntry;
    if (record.status !== 'succeeded') continue;
    const statistic = statsByTrial.get(trial.trial_id)?.statistic;
    if (statistic !== undefined && statistic !== null) {
      candidates.push({ trialId: trial.trial_id, statistic });
    }
  }
  if (candidates.length === 0) {
    return fail('no_candidates', 'no succeeded trial carried a statistic — the best-of-N selection effect is undefined and will not be invented');
  }

  const blindSelectionExpectation = candidates.reduce((sum, candidate) => sum + candidate.statistic, 0) / candidates.length;
  const maxStatistic = candidates.reduce((max, candidate) => Math.max(max, candidate.statistic), candidates[0]?.statistic as number);
  const bestOfN: BestOfNEffect = {
    selectedTrialId: selection.selectedTrialId,
    reportedStatistic: selectedStatistic,
    blindSelectionExpectation,
    candidates: candidates.length,
    selectionInflation: selectedStatistic - blindSelectionExpectation,
    selectedIsBest: selectedStatistic === maxStatistic,
  };

  const reportId = `sir:${stableDigestJson({
    experiment: experiment.experiment_id,
    trials: experiment.trials as unknown as JsonValue,
    statistics: [...statistics] as unknown as JsonValue,
    selection: selection as unknown as JsonValue,
  } satisfies JsonValue)}`;

  return ok(
    deepFreeze({
      reportId,
      experiment: experiment.experiment_id,
      trialsCounted: order.length,
      logEntries: experiment.trials.length,
      progressions: experiment.trials.length - order.length,
      succeeded,
      failuresRetained: failed,
      rejectionsRetained: rejected,
      nonTerminal,
      bestOfN,
    } satisfies SearchIntegrityReport),
  );
}
