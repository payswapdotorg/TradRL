/**
 * @tradrl/outcome-learning — the QUERY SURFACE: what T034's Firm Brain
 * reads (Work Order T033: "the query surface T034's Firm Brain will
 * read (by tenant/project/decision)").
 *
 * THE L12 LAW (isolation): every query DECLARES its tenant/project
 * scope; records of any other scope are NEVER returned (filtered out
 * — the learning repository is a multi-scope ledger whose reads are
 * strictly scoped; a foreign record cannot leak through any filter
 * combination).
 *
 * THE L4 LAW (point-in-time): every query carries its injected
 * instant `at` and its retention policy; only records within the
 * visibility window `[at - windowMs, at]` are returned — a record
 * stamped after the query instant is invisible (the future is never
 * returned), and history beyond the window is out of retention
 * (still in the append-only log — retention never deletes).
 *
 * THE PROJECTIONS:
 *   - `queryOutcomeRecords` — the learned outcomes, by ordinal;
 *   - `queryPostMortems` — the post-mortems, LATEST-PER-OUTCOME by
 *     default (the supersession projection: the raw log retains every
 *     draft; the Firm Brain reads the freshest), or the raw history
 *     when `latestPerOutcome` is false;
 *   - `queryLearningHooks` — the evaluation hooks T035 consumes,
 *     compiled per (windowed outcome, its latest windowed
 *     post-mortem) — pure derivation, deterministic.
 */

import {
  compileOutcomeLearningHook,
  fail,
  ok,
  type AttributionClass,
  type OutcomesResult,
  type OutcomeClass,
  type OutcomeLearningHook,
  type OutcomeRecord,
  type PostMortemRecord,
  type TimestampMs,
} from './imports';
import { isAttributionClass, isOutcomeClass } from './imports';
import type { RetentionPolicy } from './policy';
import { retentionWindow, withinRetentionWindow } from './retention';
import type { OutcomeLearningState } from './state';

// ---------------------------------------------------------------------------
// The query shapes
// ---------------------------------------------------------------------------

/** The outcome-record query: the declared scope + the optional filters. */
export interface OutcomeQuery {
  readonly tenant: string;
  readonly project: string;
  /** Filter by the T019 decision ref (the Firm Brain's by-decision read). */
  readonly decisionRef?: string;
  /** Filter by the T018 intent ref. */
  readonly intentRef?: string;
  /** Filter by the outcome class (a member of the closed vocabulary). */
  readonly outcomeClass?: string;
  /** Filter by the T030 shadow session ref. */
  readonly sessionRef?: string;
  /** Filter by the learned outcome record ref (`out:`). */
  readonly outcomeRecordRef?: string;
}

/** The post-mortem query: the declared scope + the optional filters. */
export interface PostMortemQuery {
  readonly tenant: string;
  readonly project: string;
  readonly decisionRef?: string;
  readonly outcomeRecordRef?: string;
  /** Filter by an attribution class carried by at least one hypothesis. */
  readonly attributionClass?: string;
}

/** The query options: the injected instant + the retention policy + the projections' switches. */
export interface QueryOptions {
  readonly at: TimestampMs;
  readonly retention: RetentionPolicy;
  /** Post-mortems: collapse to the latest per outcome (default true — the Firm Brain reads the freshest). */
  readonly latestPerOutcome?: boolean;
}

// ---------------------------------------------------------------------------
// The outcome-record query
// ---------------------------------------------------------------------------

/**
 * Query the learned outcomes (by tenant/project + the optional
 * decision/intent/class/session/record filters), within the retention
 * window at the injected instant, in ordinal order. L12: foreign-scope
 * records are never returned; L4: future-stamped records are
 * invisible.
 */
export function queryOutcomeRecords(state: OutcomeLearningState, query: OutcomeQuery, options: QueryOptions): OutcomesResult<readonly OutcomeRecord[]> {
  const scopeError = validateScope(query);
  if (scopeError !== null) return scopeError;
  let outcomeClass: OutcomeClass | undefined;
  if (query.outcomeClass !== undefined) {
    if (!isOutcomeClass(query.outcomeClass)) {
      return fail('unknown_outcome_class', `${JSON.stringify(query.outcomeClass)} is not an outcome class — the vocabulary is closed`, 'outcomeClass');
    }
    outcomeClass = query.outcomeClass;
  }
  if (typeof options.at !== 'number' || !Number.isSafeInteger(options.at) || options.at < 0) {
    return fail('invalid_field', 'the query carries its injected instant (at)', 'at');
  }
  const window = retentionWindow(options.retention, 'outcomes', options.at);
  const results: OutcomeRecord[] = [];
  for (const record of state.outcomeLog.records) {
    if (record.tenant !== query.tenant || record.project !== query.project) continue; // L12
    if (!withinRetentionWindow(record.asOf, window)) continue; // the age side + the L4 side
    if (query.decisionRef !== undefined && record.decision.decisionRef !== query.decisionRef) continue;
    if (query.intentRef !== undefined && record.decision.intentRef !== query.intentRef) continue;
    if (outcomeClass !== undefined && record.outcomeClass !== outcomeClass) continue;
    if (query.sessionRef !== undefined && record.lineage.shadow.sessionId !== query.sessionRef) continue;
    if (query.outcomeRecordRef !== undefined && record.outcomeId !== query.outcomeRecordRef) continue;
    results.push(record);
  }
  return ok(results);
}

// ---------------------------------------------------------------------------
// The post-mortem query
// ---------------------------------------------------------------------------

/**
 * Query the post-mortems (by tenant/project + the optional
 * decision/record/attribution filters), within the retention window
 * at the injected instant — LATEST-PER-OUTCOME by default (the
 * supersession projection), or the raw append-only history when
 * `latestPerOutcome` is false.
 */
export function queryPostMortems(state: OutcomeLearningState, query: PostMortemQuery, options: QueryOptions): OutcomesResult<readonly PostMortemRecord[]> {
  const scopeError = validateScope(query);
  if (scopeError !== null) return scopeError;
  let attributionClass: AttributionClass | undefined;
  if (query.attributionClass !== undefined) {
    if (!isAttributionClass(query.attributionClass)) {
      return fail('unknown_attribution_class', `${JSON.stringify(query.attributionClass)} is not an attribution class — the vocabulary is closed (decision, market_move, model_error, data_lag)`, 'attributionClass');
    }
    attributionClass = query.attributionClass;
  }
  if (typeof options.at !== 'number' || !Number.isSafeInteger(options.at) || options.at < 0) {
    return fail('invalid_field', 'the query carries its injected instant (at)', 'at');
  }
  const window = retentionWindow(options.retention, 'post_mortems', options.at);
  const matching: PostMortemRecord[] = [];
  for (const record of state.postMortemLog.records) {
    if (record.lineage.tenant !== query.tenant || record.lineage.project !== query.project) continue; // L12
    if (!withinRetentionWindow(record.asOf, window)) continue; // the age side + the L4 side
    if (query.decisionRef !== undefined && record.subject.decisionRef !== query.decisionRef) continue;
    if (query.outcomeRecordRef !== undefined && record.subject.outcomeRecordRef !== query.outcomeRecordRef) continue;
    if (attributionClass !== undefined && !record.hypotheses.some((hypothesis) => hypothesis.class === attributionClass)) continue;
    matching.push(record);
  }
  if (options.latestPerOutcome === false) return ok(matching); // the raw history
  // The supersession projection: the LATEST record per subject outcome.
  const latest = new Map<string, PostMortemRecord>();
  for (const record of matching) latest.set(record.subject.outcomeRecordRef, record);
  return ok([...latest.values()]);
}

// ---------------------------------------------------------------------------
// The learning-hook query (T035's surface)
// ---------------------------------------------------------------------------

/**
 * Compile + query the evaluation hooks: one per WINDOWED learned
 * outcome in the declared scope, grounded in its LATEST windowed
 * post-mortem when one exists. Pure derivation over the state —
 * deterministic, content-addressed per (outcome, post-mortem).
 */
export function queryLearningHooks(state: OutcomeLearningState, query: OutcomeQuery, options: QueryOptions): OutcomesResult<readonly OutcomeLearningHook[]> {
  const outcomes = queryOutcomeRecords(state, query, options);
  if (!outcomes.ok) return outcomes;
  const postMortems = queryPostMortems(state, { tenant: query.tenant, project: query.project }, options);
  if (!postMortems.ok) return postMortems;
  const latestByOutcome = new Map(postMortems.value.map((record) => [record.subject.outcomeRecordRef, record]));
  const hooks: OutcomeLearningHook[] = [];
  for (const outcome of outcomes.value) {
    const hook = compileOutcomeLearningHook(outcome, latestByOutcome.get(outcome.outcomeId) ?? null);
    if (!hook.ok) return hook;
    hooks.push(hook.value);
  }
  return ok(hooks);
}

// ---------------------------------------------------------------------------
// The scope validation
// ---------------------------------------------------------------------------

/** Validate the declared scope (the L12 filter basis — a query without a scope is inexpressible). */
function validateScope(query: { tenant?: unknown; project?: unknown }): OutcomesResult<never> | null {
  if (typeof query !== 'object' || query === null) return fail('invalid_type', 'the query must be an object');
  if (typeof query.tenant !== 'string' || query.tenant === '') return fail('invalid_field', 'the query declares its tenant scope (L12 — unscoped reads are inexpressible)', 'tenant');
  if (typeof query.project !== 'string' || query.project === '') return fail('invalid_field', 'the query declares its project scope (L15 — unscoped reads are inexpressible)', 'project');
  return null;
}
