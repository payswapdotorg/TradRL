/**
 * @tradrl/evaluation-integrity — the SELECTION-EFFECT AUDIT over the search
 * DAG (Work Order T031 — the platform layer above T012's in-package
 * search-integrity reporting).
 *
 * Spec anchors: spec/EVALUATION-PROTOCOL.md lines 22-24 ("Retain search
 * histories and DISTINGUISH IN-SEARCH PERFORMANCE FROM HOLDOUT
 * PERFORMANCE. Use walk-forward and purged/embargoed designs where
 * appropriate."), spec/ARCHITECTURE.md "Evaluation" ("Preserve search
 * history"), ARCHITECTURE-LOCK L11 ("Search integrity: optimization
 * history is retained to EXPOSE SELECTION EFFECTS"), R20, L9 (the audit id
 * is derived from everything it judged), L12 (scope-matched inputs).
 *
 * WHAT THE AUDIT QUANTIFIES (all in EXACT DECIMALS — no float is ever
 * constructed; the numbers that quantify overfitting do not themselves
 * float):
 * - `reportedStatistic` — the selected trial's IN-SEARCH statistic (the
 *   number the search reported as its best backtest).
 * - `blindSelectionExpectation` — the exact mean of the in-search
 *   statistics over ALL candidate trials (what a BLIND pick would expect —
 *   the honest baseline the reported number must be judged against;
 *   mirrors T012's `BestOfNEffect.blindSelectionExpectation` semantics).
 * - `selectionInflation` — reported minus expectation: the quantified
 *   best-of-N selection effect (mirrors T012's semantics, exact).
 * - `selectedIsBest` — whether the selection is even the argmax of the
 *   candidates (a selection that is NOT the best is itself an integrity
 *   signal — mirrors T012).
 * - `holdoutStatistic` — the holdout evaluation of the SELECTED
 *   CONFIGURATION's snapshot: the honest out-of-search number.
 * - `holdoutDegradation` — reported minus holdout: how much the number
 *   drops outside the search it was selected in — the backtest-overfitting
 *   drop, computed, never hidden.
 * - the search DAG's shape (max depth; the selected trial's depth) — the
 *   selection effect's context.
 *
 * WHAT THE AUDIT REFUSES (the typed laws, each negative-tested):
 * - `chain_mismatch` — the search record does not verify (an unverified
 *   search supports no audit).
 * - `hidden_trials` — the in-search statistics do not cover EVERY
 *   in-search trial of the record (the PLATFORM mirror of T012's law: the
 *   caller that drops its worst attempts gets a typed rejection, never a
 *   rosier audit).
 * - `unknown_statistic` / `unknown_trial` — fabricated coverage.
 * - `scale_mismatch` — statistics outside the audit's declared exact-decimal
 *   scale.
 * - `synthetic_holdout` / `leakage_without_embargo` — every holdout
 *   evaluation runs the leakage law (window vs every in-search
 *   optimization window, embargo resolved from the registry authority or
 *   the declared separation).
 * - `selected_without_holdout` — the selected configuration carries no
 *   holdout evaluation: a best-of-N report without the holdout number that
 *   judges it will not be compiled (fail-closed — the audit refuses to
 *   invent what was not measured).
 * - `selection_not_in_search` — the selection names a non-candidate.
 * - `quarantine_*` — the unseen-data laws (quarantine.ts) over every
 *   in-search trial.
 * - `selection_mismatch` — when the caller supplies T012's experiment-lane
 *   integrity report (the mirror of `SearchIntegrityReport`), the report's
 *   own selection must agree with the selection being audited: the
 *   experiment lane and the platform layer cannot report different bests.
 */

import { deepFreeze, isRecord, stableDigestJson } from './primitives';
import type { JsonObject } from './primitives';
import { isExperimentId, isTrialId } from './ids';
import type { ExperimentId, TrialId } from './ids';
import { fail, invalidField, invalidType, missingField, ok, type IntegrityError, type IntegrityResult } from './errors';
import {
  compareDecimals,
  isDecimalAtScale,
  isSignedDecimal,
  maxDecimal,
  meanDecimals,
  subtractDecimals,
} from './decimals';
import type { DecimalString } from './decimals';
import { verifySearchLineage } from './search-mirror';
import type { SearchRecordMirror } from './search-mirror';
import { checkQuarantine } from './quarantine';
import { checkHoldoutWindowSeparation, isEmbargoSource, isDataOriginMirror } from './leakage';
import type { EmbargoSource } from './leakage';

// ---------------------------------------------------------------------------
// T012 report mirror (the experiment lane's own integrity report — INPUT)
// ---------------------------------------------------------------------------

/**
 * The best-of-N effect — STRUCTURAL MIRROR of @tradrl/evaluation's
 * `BestOfNEffect` (T012; DO NOT DIVERGE — the interop trip-wires prove
 * mutual assignability against the real package). Numeric fields stay
 * `number` because this mirrors T012's AUTHORED shape; the platform
 * audit's OWN outputs are exact decimal strings.
 */
export interface BestOfNEffectMirror {
  readonly selectedTrialId: TrialId;
  readonly reportedStatistic: number;
  readonly blindSelectionExpectation: number;
  readonly candidates: number;
  readonly selectionInflation: number;
  readonly selectedIsBest: boolean;
}

/**
 * The search-integrity report — STRUCTURAL MIRROR of @tradrl/evaluation's
 * `SearchIntegrityReport` (T012). Supplied OPTIONALLY to the audit as
 * corroboration; the audit cross-checks its selection and retains its
 * honest counts.
 */
export interface SearchIntegrityReportMirror {
  readonly reportId: string;
  readonly experiment: ExperimentId;
  readonly trialsCounted: number;
  readonly logEntries: number;
  readonly progressions: number;
  readonly succeeded: number;
  readonly failuresRetained: number;
  readonly rejectionsRetained: number;
  readonly nonTerminal: number;
  readonly bestOfN: BestOfNEffectMirror | null;
}

/** Guard: `BestOfNEffectMirror` (the T012 structural law, mirrored). */
export function isBestOfNEffectMirror(v: unknown): v is BestOfNEffectMirror {
  if (!isRecord(v)) return false;
  if (!isTrialId(v.selectedTrialId)) return false;
  if (typeof v.reportedStatistic !== 'number' || !Number.isFinite(v.reportedStatistic)) return false;
  if (typeof v.blindSelectionExpectation !== 'number' || !Number.isFinite(v.blindSelectionExpectation)) return false;
  if (typeof v.candidates !== 'number' || !Number.isInteger(v.candidates) || v.candidates < 0) return false;
  if (typeof v.selectionInflation !== 'number' || !Number.isFinite(v.selectionInflation)) return false;
  return typeof v.selectedIsBest === 'boolean';
}

/** Guard: `SearchIntegrityReportMirror` (the T012 structural law, mirrored). */
export function isSearchIntegrityReportMirror(v: unknown): v is SearchIntegrityReportMirror {
  if (!isRecord(v)) return false;
  if (typeof v.reportId !== 'string' || v.reportId.trim().length === 0) return false;
  if (!isExperimentId(v.experiment)) return false;
  for (const field of ['trialsCounted', 'logEntries', 'progressions', 'succeeded', 'failuresRetained', 'rejectionsRetained', 'nonTerminal'] as const) {
    if (typeof v[field] !== 'number' || !Number.isInteger(v[field]) || (v[field] as number) < 0) return false;
  }
  if (v.bestOfN !== null && !isBestOfNEffectMirror(v.bestOfN)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Audit inputs
// ---------------------------------------------------------------------------

/** One in-search trial's reported statistic (exact decimal at the audit's scale). */
export interface InSearchStatistic {
  readonly trial: TrialId;
  readonly statistic: DecimalString;
}

/** One holdout evaluation: the trial evaluated, its statistic, and the data origin declaration. */
export interface HoldoutEvaluation {
  readonly trial: TrialId;
  readonly statistic: DecimalString;
  /** The origin of the evaluated data (T028/market-protocol vocabulary mirror; holdout demands 'historical'). */
  readonly origin: 'historical' | 'simulated' | 'generated';
}

/** The search's declared selection: which in-search trial was reported as the best. */
export interface SelectionClaim {
  readonly selectedTrialId: TrialId;
}

/** The honest counts retained from a corroborating T012 experiment-lane report. */
export interface ExperimentRetained {
  readonly reportId: string;
  readonly trialsCounted: number;
  readonly logEntries: number;
  readonly failuresRetained: number;
  readonly rejectionsRetained: number;
}

// ---------------------------------------------------------------------------
// The audit record
// ---------------------------------------------------------------------------

/**
 * The compiled selection-effect audit: the quantified best-of-N inflation
 * and holdout degradation (EXACT DECIMALS), the selection's integrity
 * signals, the search DAG's shape, and the retained T012 corroboration.
 * All facts; no narrative — and no verdict: the audit EXPOSES the
 * selection effect (L11); judging it against acceptance criteria is the
 * evaluator's job (L7), downstream.
 */
export interface SelectionAudit {
  /** Derived identity: `saud:<digest over the canonical audit inputs>` (L9). */
  readonly audit_id: string;
  readonly search_id: string;
  readonly experiment: ExperimentId;
  /** The trial the search reported as its best. */
  readonly selectedTrialId: TrialId;
  /** The selected trial's content-addressed config snapshot. */
  readonly selectedConfig: string;
  /** The selected trial's IN-SEARCH statistic — the reported number. */
  readonly reportedStatistic: DecimalString;
  /** The exact mean over ALL candidate trials' in-search statistics — the blind baseline. */
  readonly blindSelectionExpectation: DecimalString;
  /** reportedStatistic - blindSelectionExpectation: the quantified selection inflation. */
  readonly selectionInflation: DecimalString;
  /** True iff the selection is the argmax of the candidates' statistics. */
  readonly selectedIsBest: boolean;
  /** Number of candidate trials (all in-search trials — coverage is total or the audit fails). */
  readonly candidates: number;
  /** The holdout evaluation of the SELECTED config's snapshot — the honest number. */
  readonly holdoutStatistic: DecimalString;
  /** reportedStatistic - holdoutStatistic: the backtest-overfitting drop, computed. */
  readonly holdoutDegradation: DecimalString;
  /** The maximal depth of the search DAG. */
  readonly searchMaxDepth: number;
  /** The selected trial's depth in the search DAG. */
  readonly selectedDepth: number;
  /** Quarantined (unseen) segments the audit checked the search against. */
  readonly quarantinedSegments: number;
  /** The embargo (ms) the audit demanded between optimization and holdout windows. */
  readonly embargoMs: number | null;
  /** The honest counts retained from the corroborating T012 report (null when none was supplied). */
  readonly experimentRetained: ExperimentRetained | null;
}

// ---------------------------------------------------------------------------
// The computation
// ---------------------------------------------------------------------------

/** The audit's input bundle. */
export interface SelectionAuditInput {
  /** The (untrusted) search record — verified against its chain first. */
  readonly search: unknown;
  /** Per-in-search-trial statistics: `{ trial, statistic }` at the declared scale. */
  readonly statistics: readonly unknown[];
  /** Holdout evaluations: `{ trial, statistic, origin }` per holdout-classified trial. */
  readonly holdout: readonly unknown[];
  /** The selection claim: `{ selectedTrialId }`. */
  readonly selection: unknown;
  /** The exact-decimal scale every statistic must carry (integer in [0, 18]). */
  readonly statisticScale: number;
  /** The embargo source (registry authority or declared separation). */
  readonly embargo: unknown;
  /** The (untrusted) quarantine record — the unseen-data laws run over every in-search trial. */
  readonly quarantine: unknown;
  /** OPTIONAL T012 experiment-lane report (mirror) — cross-checked for selection agreement. */
  readonly experimentReport?: unknown;
}

/**
 * Compile the selection-effect audit. A pure function of the inputs; the
 * derived `audit_id` is a digest over the canonical inputs (L9). Every law
 * listed in the module header is enforced typed; on success the audit is
 * deeply frozen.
 */
export function compileSelectionAudit(input: unknown): IntegrityResult<SelectionAudit> {
  if (!isRecord(input)) {
    return { ok: false, errors: [invalidType('audit input must be an object')] };
  }
  if (input.search === undefined) return { ok: false, errors: [missingField('search')] };
  if (input.statisticScale === undefined) return { ok: false, errors: [missingField('statisticScale')] };
  if (typeof input.statisticScale !== 'number' || !Number.isInteger(input.statisticScale) || input.statisticScale < 0 || input.statisticScale > 18) {
    return { ok: false, errors: [invalidField('statisticScale', 'must be an integer in [0, 18] — the exact-decimal scale of every statistic')] };
  }
  const statisticScale = input.statisticScale as number;
  if (!Array.isArray(input.statistics)) {
    return { ok: false, errors: [invalidField('statistics', 'must be an array of { trial, statistic } entries')] };
  }
  if (!Array.isArray(input.holdout)) {
    return { ok: false, errors: [invalidField('holdout', 'must be an array of { trial, statistic, origin } entries')] };
  }

  // 1. The search record verifies (chain + log laws).
  const verified = verifySearchLineage(input.search);
  if (!verified.ok) return verified;
  const record = verified.value;

  // 2. The quarantine laws over every in-search trial.
  const quarantineCheck = checkQuarantine(record, input.quarantine);
  if (!quarantineCheck.ok) return quarantineCheck;

  // 3. The embargo source.
  if (!isEmbargoSource(input.embargo)) {
    return { ok: false, errors: [invalidField('embargo', "must be { source: 'registry', registry } or { source: 'declared', embargoMs >= 0 }")] };
  }
  const embargo = input.embargo as EmbargoSource;

  // 4. In-search statistics: exact coverage of every in-search trial.
  const inSearchTrials = record.entries.filter((entry) => entry.classification === 'in-search');
  const statsByTrial = new Map<TrialId, DecimalString>();
  for (let index = 0; index < input.statistics.length; index++) {
    const candidate = input.statistics[index];
    if (!isRecord(candidate)) {
      return { ok: false, errors: [invalidType(`statistics[${index}] must be an object`)] };
    }
    if (candidate.trial === undefined) return { ok: false, errors: [missingField(`statistics[${index}].trial`)] };
    if (!isTrialId(candidate.trial)) {
      return { ok: false, errors: [invalidField(`statistics[${index}].trial`, 'must be a non-empty trial id')] };
    }
    if (candidate.statistic === undefined) return { ok: false, errors: [missingField(`statistics[${index}].statistic`)] };
    if (!isSignedDecimal(candidate.statistic)) {
      return { ok: false, errors: [invalidField(`statistics[${index}].statistic`, 'must be a signed decimal string (exact decimals — no floats in the audit)')] };
    }
    if (!isDecimalAtScale(candidate.statistic, statisticScale)) {
      return fail(
        'scale_mismatch',
        `statistic "${candidate.statistic}" for trial "${candidate.trial}" is not at the audit's declared scale ${statisticScale} — exact-decimal arithmetic demands conformance`,
        `statistics[${index}].statistic`,
      );
    }
    if (statsByTrial.has(candidate.trial as TrialId)) {
      return { ok: false, errors: [invalidField(`statistics[${index}].trial`, `duplicate statistic for trial "${candidate.trial}"`)] };
    }
    statsByTrial.set(candidate.trial as TrialId, candidate.statistic as DecimalString);
  }
  const hidden = inSearchTrials.filter((entry) => !statsByTrial.has(entry.trial));
  if (hidden.length > 0) {
    return fail(
      'hidden_trials',
      `statistics cover ${statsByTrial.size} of ${inSearchTrials.length} in-search trial(s); missing: ${hidden.map((e) => `"${e.trial}"`).join(', ')} — hiding trials is a typed error (L11, platform mirror of T012's hidden_trials)`,
      'statistics',
    );
  }
  for (const trialId of statsByTrial.keys()) {
    if (!record.entries.some((entry) => entry.trial === trialId && entry.classification === 'in-search')) {
      return fail('unknown_statistic', `statistic names trial "${trialId}" which is not an in-search trial of the record`, 'statistics');
    }
  }

  // 5a. The WINDOW LAW over EVERY holdout entry of the record — a holdout
  // window overlapping optimization material is a leak in the record
  // whether or not a statistic was ever supplied for it.
  const holdoutEmbargoByTrial = new Map<TrialId, number>();
  for (const entry of record.entries) {
    if (entry.classification !== 'holdout') continue;
    const separation = checkHoldoutWindowSeparation(record, entry.trial, embargo);
    if (!separation.ok) return separation;
    holdoutEmbargoByTrial.set(entry.trial, separation.value.embargoMs);
  }

  // 5b. Supplied holdout evaluations: statistic, scale, origin and
  // classification laws (the origin law — synthetic data never serves as
  // unseen holdout evidence — mirrors T028's provenance honesty).
  const holdoutStatsByTrial = new Map<TrialId, DecimalString>();
  for (let index = 0; index < input.holdout.length; index++) {
    const candidate = input.holdout[index];
    if (!isRecord(candidate)) {
      return { ok: false, errors: [invalidType(`holdout[${index}] must be an object`)] };
    }
    if (candidate.trial === undefined || !isTrialId(candidate.trial)) {
      return { ok: false, errors: [invalidField(`holdout[${index}].trial`, 'must be a non-empty trial id')] };
    }
    const entry = record.entries.find((e) => e.trial === candidate.trial);
    if (entry === undefined) {
      return fail('unknown_trial', `holdout evaluation names trial "${candidate.trial}" which the search record does not contain`, `holdout[${index}].trial`);
    }
    if (entry.classification !== 'holdout') {
      return fail(
        'classification_mismatch',
        `holdout evaluation names trial "${candidate.trial}" which the search record classified as "${entry.classification}" — the record is the authority`,
        `holdout[${index}].trial`,
      );
    }
    if (candidate.statistic === undefined) return { ok: false, errors: [missingField(`holdout[${index}].statistic`)] };
    if (!isSignedDecimal(candidate.statistic)) {
      return { ok: false, errors: [invalidField(`holdout[${index}].statistic`, 'must be a signed decimal string')] };
    }
    if (!isDecimalAtScale(candidate.statistic, statisticScale)) {
      return fail('scale_mismatch', `holdout statistic "${candidate.statistic}" for trial "${candidate.trial}" is not at the audit's declared scale ${statisticScale}`, `holdout[${index}].statistic`);
    }
    if (holdoutStatsByTrial.has(entry.trial)) {
      return { ok: false, errors: [invalidField(`holdout[${index}].trial`, `duplicate holdout evaluation for trial "${entry.trial}"`)] };
    }
    if (candidate.origin === undefined || !isDataOriginMirror(candidate.origin)) {
      return { ok: false, errors: [invalidField(`holdout[${index}].origin`, `must be one of historical | simulated | generated`)] };
    }
    if (candidate.origin !== 'historical') {
      return fail(
        'synthetic_holdout',
        `holdout evaluation of trial "${candidate.trial}" declares origin "${candidate.origin}" — synthetic worlds are exploration instruments, not unseen historical truth (L5)`,
        `holdout[${index}].origin`,
      );
    }

    holdoutStatsByTrial.set(entry.trial, candidate.statistic as DecimalString);
  }

  // 6. The selection claim.
  const selection = input.selection;
  if (!isRecord(selection) || selection.selectedTrialId === undefined || !isTrialId(selection.selectedTrialId)) {
    return { ok: false, errors: [invalidField('selection', 'must be { selectedTrialId } naming the search-reported best trial')] };
  }
  const selectedTrialId = selection.selectedTrialId as TrialId;
  const selectedEntry = record.entries.find((entry) => entry.trial === selectedTrialId);
  if (selectedEntry === undefined || selectedEntry.classification !== 'in-search') {
    return fail(
      'selection_not_in_search',
      `selection names trial "${selectedTrialId}" which is not an in-search candidate of the record — the reported best must be one of the searched trials`,
      'selection.selectedTrialId',
    );
  }

  // 7. The selected CONFIG must be holdout-evaluated (fail-closed).
  const selectedHoldoutEntry = record.entries.find(
    (entry) => entry.classification === 'holdout' && entry.config === selectedEntry.config,
  );
  if (selectedHoldoutEntry === undefined || !holdoutStatsByTrial.has(selectedHoldoutEntry.trial)) {
    return fail(
      'selected_without_holdout',
      `selected trial "${selectedTrialId}" (config ${selectedEntry.config}) carries no holdout evaluation — a best-of-N report without the holdout number that judges it will not be compiled`,
      'selection.selectedTrialId',
    );
  }

  // 8. Optional T012 corroboration: the experiment lane's own report must agree.
  let experimentRetained: ExperimentRetained | null = null;
  if (input.experimentReport !== undefined && input.experimentReport !== null) {
    const report = input.experimentReport;
    if (!isSearchIntegrityReportMirror(report)) {
      return { ok: false, errors: [invalidField('experimentReport', 'must be a T012 SearchIntegrityReport (mirror): { reportId, experiment, counts..., bestOfN }')] };
    }
    if (report.experiment !== record.experiment) {
      return fail(
        'selection_mismatch',
        `experiment report binds experiment "${report.experiment}" but the search record binds "${record.experiment}" — the corroborating report must be about the same experiment`,
        'experimentReport.experiment',
      );
    }
    if (report.bestOfN === null) {
      return fail(
        'selection_mismatch',
        `experiment report "${report.reportId}" computed no best-of-N effect (bestOfN is null) — it cannot corroborate a selection`,
        'experimentReport.bestOfN',
      );
    }
    if (report.bestOfN.selectedTrialId !== selectedTrialId) {
      return fail(
        'selection_mismatch',
        `experiment report's selection "${report.bestOfN.selectedTrialId}" disagrees with the audited selection "${selectedTrialId}" — the experiment lane and the platform layer cannot report different bests`,
        'experimentReport.bestOfN.selectedTrialId',
      );
    }
    experimentRetained = deepFreeze({
      reportId: report.reportId,
      trialsCounted: report.trialsCounted,
      logEntries: report.logEntries,
      failuresRetained: report.failuresRetained,
      rejectionsRetained: report.rejectionsRetained,
    } satisfies ExperimentRetained);
  }

  // 9. The exact-decimal computation.
  const candidateStatistics = inSearchTrials.map((entry) => statsByTrial.get(entry.trial) as DecimalString);
  const reportedStatistic = statsByTrial.get(selectedTrialId) as DecimalString;
  const blindSelectionExpectation = meanDecimals(candidateStatistics, statisticScale);
  const selectionInflation = subtractDecimals(reportedStatistic, blindSelectionExpectation);
  const maxStatistic = candidateStatistics.reduce((max, statistic) => maxDecimal(max, statistic), candidateStatistics[0] as DecimalString);
  const selectedIsBest = compareDecimals(reportedStatistic, maxStatistic) === 0;
  const holdoutStatistic = holdoutStatsByTrial.get(selectedHoldoutEntry.trial) as DecimalString;
  const holdoutDegradation = subtractDecimals(reportedStatistic, holdoutStatistic);

  // The DAG shape: depths from the record's parent links.
  const depthByTrial = new Map<TrialId, number>();
  let searchMaxDepth = 0;
  for (const entry of record.entries) {
    let depth = 0;
    for (const parent of entry.parents) {
      depth = Math.max(depth, (depthByTrial.get(parent) ?? 0) + 1);
    }
    depthByTrial.set(entry.trial, depth);
    searchMaxDepth = Math.max(searchMaxDepth, depth);
  }
  const selectedDepth = depthByTrial.get(selectedTrialId) ?? 0;

  // 10. The derived audit identity (L9): a digest over everything judged.
  const audit_id = `saud:${stableDigestJson({
    search_id: record.search_id,
    chain_head: record.chain_head,
    statistics: [...input.statistics] as unknown as JsonObject,
    holdout: [...input.holdout] as unknown as JsonObject,
    selection: selection as unknown as JsonObject,
    statisticScale,
    embargo: (embargo.source === 'registry' ? { source: 'registry', registry_id: (embargo.registry as { registry_id: string }).registry_id } : { source: 'declared', embargoMs: embargo.embargoMs }) as unknown as JsonObject,
    quarantine: quarantineCheck.value.quarantine_id,
    experimentReport: (experimentRetained === null ? null : experimentRetained.reportId) as unknown as JsonObject,
  } satisfies JsonObject)}`;

  return ok(
    deepFreeze({
      audit_id,
      search_id: record.search_id,
      experiment: record.experiment,
      selectedTrialId,
      selectedConfig: selectedEntry.config,
      reportedStatistic,
      blindSelectionExpectation,
      selectionInflation,
      selectedIsBest,
      candidates: inSearchTrials.length,
      holdoutStatistic,
      holdoutDegradation,
      searchMaxDepth,
      selectedDepth,
      quarantinedSegments: quarantineCheck.value.quarantinedSegments,
      embargoMs: holdoutEmbargoByTrial.get(selectedHoldoutEntry.trial) ?? null,
      experimentRetained,
    } satisfies SelectionAudit),
  );
}

/** The compiled selection-effect audit's identity derivation (exported for tests). */
export function selectionAuditId(input: JsonObject): string {
  return `saud:${stableDigestJson(input)}`;
}
