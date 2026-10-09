// @tradrl/web-console — THE CONSOLIDATED MULTI-DESK OVERSIGHT FOLD
// (FW-37-B, Round F register F-2 — every multi-desk persona's #1 ask;
// the adoption blocker):
//   M1 (Head of Trading, 4 desks): "my morning review means four
//   project switches instead of one Launchpad monitor";
//   L1 (Global Head of Execution): "no surface showing both desks'
//   risk/positions/decisions together";
//   L2 (CRO, 11 pods): "my morning risk meeting cannot run
//   desk-by-desk"; L3: "no governed consolidation".
//
// THE LAW: one PURE fold over the workspace's own records — the
// session's OWN desks (core/tenant.ts's sessionOwnDesksOf: the
// session-owned rows, the unmarked honest fallback, and the shared
// demo project — NEVER another session's desks, the L12 workspace
// boundary the switcher/palette ride since this same wave), each
// enriched with the per-desk reads the app layer collects through the
// SAME frozen API routes every section rides (the standing
// risk-utilization read, the execution blotter, the decision stream).
//
//   L4 — every per-desk count is the VIEW-INSTANT projection of the
//   desk's own records (fills, refusals, decisions and breaches
//   observed BY the Time Machine's view instant render; later facts
//   do not — the same law Research/Decisions/Execution ride). The
//   standing utilization bounds keep the Risk section's own
//   current-instant law (named asOf, never a faked point-in-time
//   meter; the BREACH rows project by their observed instant).
//   L12 — the fold's desk list is the session-own listing; a foreign
//   session's desk cannot enter (it is not in the list), and every
//   decision record entering the state passed the tenant gate at
//   ingest (the reducer's own arm).
//   L20/honesty — a desk without a read on record renders its honest
//   "no read on record" facts, never a fabricated number; "open
//   positions" is NOT fabricated (no position store exists on any
//   backing — the runtime's own disclosure): the row carries the
//   blotter's own counts (fills on record / refusals the gateway
//   stopped), the same vocabulary the Execution section rides.
//
// This module is PURE: identical (state, viewAt) -> identical rows.
// No DOM, no clock, no transport.

import type { GatewaySubmissionRecord, OutcomeRecord, ProjectRecord, RiskUtilizationRead } from '../api/contracts';
import { blotterTotalsOf } from './blotter';
import { availabilityOfOutcome, availabilityOfSubmission, projectToView } from './availability';
import { parseInstantUtc } from './format';
import { DEMO_PROJECT_ID, isDemoProject, sessionOwnDesksOf } from './tenant';
import type { WorkspaceState } from './workspace';

/**
 * ONE DESK'S OVERSIGHT READ — the per-desk bundle the app layer
 * collects through the frozen routes (one standing utilization read +
 * the blotter page + the decision-stream page), dispatched into the
 * workspace state as the `oversight-read` event. The bundle is
 * per-DESK (projectId), never per-scope: the state's own scope gate
 * does not apply to it (exactly like the project directory — the
 * workspace stays ONE project's world; this is the cross-desk monitor
 * over the session's OWN desks).
 */
export interface OversightDeskRead {
  /** The desk (project) this bundle was read for. */
  readonly projectId: string;
  /** The desk's standing risk-utilization read (null when the host route answers nothing for this desk — the honest absence). */
  readonly utilization: RiskUtilizationRead | null;
  /** The desk's execution blotter rows (fills + refusals — the L4 projection happens at fold time). */
  readonly submissions: readonly GatewaySubmissionRecord[];
  /** The desk's decision-stream records (the outcomes the decision projection renders). */
  readonly decisions: readonly OutcomeRecord[];
  /** The observed instant the bundle was read at (injected — never a wall clock). */
  readonly readAt: number;
}

/** One budget/utilization pair of a desk's standing read (the bound + the honest current, verbatim). */
export interface OversightBudgetRow {
  /** The constraint's own id (traceable to the desk's mandate). */
  readonly constraintId: string;
  /** The metric the bound binds (verbatim, e.g. 'outcome.capital.budget'). */
  readonly metric: string;
  /** The bound's own max-side number as served ('' when none declared). */
  readonly boundMax: string;
  /** The standing current utilization — a number ONLY when the records on file produce a defensible one; null = honestly unknown, never fabricated. */
  readonly current: number | null;
  /** The bound's own verdict (ok / breach / unknown — the read's own, never re-decided). */
  readonly status: 'ok' | 'breach' | 'unknown';
}

/** One desk's oversight row — the fold's product (the render layer's single input). */
export interface OversightDeskRow {
  readonly projectId: string;
  readonly name: string;
  /** True for the shared demo project (the teaching desk — the E-8 demo-tenant marking law). */
  readonly demo: boolean;
  /** The project record's own lifecycle status (the boundary's stamp, verbatim). */
  readonly status: string;
  readonly executionMode: string;
  /** The desk's read bundle (null when no read is on record — the honest pre-read absence). */
  readonly read: OversightDeskRead | null;
  /** The capital + risk budget rows (the standing read's own bounds, verbatim). */
  readonly budgets: readonly OversightBudgetRow[];
  /** The fills on record AT THE VIEW INSTANT (routed rows with fill economics — never a fabricated position count). */
  readonly fills: number;
  /** The refusals on record AT THE VIEW INSTANT (each one a stopped decision — counted, never hidden). */
  readonly refusals: number;
  /** The decisions on record AT THE VIEW INSTANT. */
  readonly decisions: number;
  /** The latest view-instant decision (ref + disposition), or null when none is visible. */
  readonly latestDecision: { readonly decisionRef: string; readonly disposition: string } | null;
  /** The active breaches OBSERVED BY the view instant (a refusal observed in the future of the instant never renders — the F-6 law, one fold two surfaces). */
  readonly breachesAtView: number;
  /** Every active breach the standing read carries (the unprojected total — the standing read's own count). */
  readonly breachesTotal: number;
  /** The standing read's own serve instant (verbatim asOf), or null when no read is on record. */
  readonly asOf: string | null;
}

/**
 * The session-own desks of a directory (the fold's own listing —
 * core/tenant.ts's law: the session-owned rows + the unmarked
 * fallback + the shared demo project; other sessions' desks NEVER
 * enter, the L12 workspace boundary the switcher/palette ride).
 */
export function oversightDesksOf(directory: readonly ProjectRecord[]): readonly ProjectRecord[] {
  return sessionOwnDesksOf(directory, DEMO_PROJECT_ID);
}

/**
 * The budget rows of a standing utilization read — the capital and
 * risk budget bounds first (metric-match, the boundary's own
 * vocabulary), every other bound after them in the read's own order.
 * An absent read folds to [] (the honest absence).
 */
export function oversightBudgetRowsOf(utilization: RiskUtilizationRead | null): readonly OversightBudgetRow[] {
  if (utilization === null) return [];
  const rows: OversightBudgetRow[] = utilization.bounds.map((bound) => ({
    constraintId: bound.constraintId,
    metric: bound.metric,
    boundMax: bound.boundMax === null ? '' : bound.boundMax,
    current: bound.current,
    status: bound.status,
  }));
  const isCapital = (row: OversightBudgetRow): boolean => row.metric.includes('capital') && row.metric.includes('budget');
  const isRisk = (row: OversightBudgetRow): boolean => row.metric.includes('risk') && row.metric.includes('budget');
  const capital = rows.filter(isCapital);
  const risk = rows.filter((row) => isRisk(row) && !isCapital(row));
  const rest = rows.filter((row) => !isCapital(row) && !isRisk(row));
  return [...capital, ...risk, ...rest];
}

/**
 * THE FOLD: every session-own desk's oversight row at the view
 * instant. Pure and total — a desk without a read on record folds to
 * its honest absence row (the render names it, never a fabricated
 * number); the desks follow the directory's own order; the launchpad
 * placeholder never appears (it is not a project and never a
 * directory row).
 */
export function oversightRowsOf(state: WorkspaceState, viewAt: number): readonly OversightDeskRow[] {
  return oversightDesksOf(state.projectDirectory).map((desk): OversightDeskRow => {
    const read = state.oversight.find((candidate) => candidate.projectId === desk.id) ?? null;
    // L4: the per-desk counts are the VIEW-INSTANT projections of the
    // desk's own records (a post-availability fact never renders — the
    // same law every section rides).
    const submissions = projectToView(read?.submissions ?? [], viewAt, availabilityOfSubmission);
    const decisions = projectToView(read?.decisions ?? [], viewAt, availabilityOfOutcome);
    const totals = blotterTotalsOf(submissions);
    const latest = decisions.length === 0
      ? null
      : decisions.reduce((best, outcome) => (outcome.asOf > best.asOf ? outcome : best), decisions[0]);
    const breaches = read?.utilization?.activeBreaches ?? [];
    // F-6's law inside the fold: a breach row renders at a past instant
    // only when its OWN observed instant is at or before the view — an
    // unparseable instant is UNKNOWN, and the L4-conservative choice
    // excludes it from the view-instant count (never a fabricated
    // past-ness).
    const breachesAtView = breaches.filter((breach) => {
      const observedAt = parseInstantUtc(breach.at);
      return observedAt !== null && observedAt <= viewAt;
    }).length;
    return {
      projectId: desk.id,
      name: desk.name,
      demo: isDemoProject(desk.id),
      status: desk.lifecycle.status,
      executionMode: desk.executionMode,
      read,
      budgets: oversightBudgetRowsOf(read?.utilization ?? null),
      fills: totals.fills,
      refusals: totals.refusals,
      decisions: decisions.length,
      latestDecision: latest === null ? null : { decisionRef: latest.decision.decisionRef, disposition: latest.decision.disposition },
      breachesAtView,
      breachesTotal: breaches.length,
      asOf: read?.utilization?.asOf ?? null,
    };
  });
}

/** The fold's own one-line scope disclosure (rendered with the panel — what the surface covers, stated). */
export function oversightScopeNoteOf(state: WorkspaceState): string {
  const desks = oversightDesksOf(state.projectDirectory);
  return `One governed view of this session's own desks in workspace ${state.scope.tenantId} — ${desks.length} desk${desks.length === 1 ? '' : 's'} (the session's own launched projects plus the shared demo desk). Other sessions' desks in this workspace never appear here; every count is the view-instant projection of each desk's own records.`;
}
