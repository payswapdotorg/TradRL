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
//   "no read on record" facts, never a fabricated number.
//
// FW-38-B (Round G register G-2 + G-3 + G-5 + G-12 — the truth wave):
//   G-2 — the standing rows derive from the desk's own FILLS (core/
//   standing.ts's fill-derived book at the view instant), NEVER from a
//   gate observation; the gate's projection stays visible ONLY labeled
//   as the last gate observation; the breach stamp on a standing row
//   reflects the fill-derived book vs the bound (9 scopes, the round's
//   top friction — every compliant desk with one refusal used to read
//   as a standing breach at 38-445x overstatement).
//   G-3 — the row carries the desk's ORG operating status (the bundle's
//   own org-status snapshot) beside the project lifecycle, each
//   labeled as its own entity; the status pill renders the ORG status
//   (compiled/active/…), never the project-record lifecycle "draft".
//   G-5 — a gate observation never renders before its observed instant
//   (the fold's withheldAtView — the same parseInstantUtc projection
//   the breach rows ride since FW-37-B).
//   G-12 — the row names the DATA'S OWN AS-OF (the newest fill or
//   non-withheld observation the standing rows derive from), never the
//   read-capture instant (the served asOf is named separately, labeled
//   as the capture).
//
// This module is PURE: identical (state, viewAt) -> identical rows.
// No DOM, no clock, no transport.

import type { GatewaySubmissionRecord, OrgStatusSnapshot, OutcomeRecord, ProjectRecord, RiskUtilizationEntryBlocked, RiskUtilizationRead } from '../api/contracts';
import { blotterTotalsOf } from './blotter';
import { availabilityOfOutcome, availabilityOfSubmission, projectToView } from './availability';
import { parseInstantUtc } from './format';
import { standingReadFoldOf, type StandingReadFold } from './standing';
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
  /**
   * FW-38-B (Round G register G-3): the desk's OWN organization-status
   * snapshot (read through the same frozen route the Organization
   * section rides, paired with THIS desk's project id) — the org
   * operating status the row's pill renders ('active', 'forming', …).
   * Optional + nullable: a desk with no organization ref yet (pre-
   * compile), a backing that answers nothing, and every pre-FW-38-B
   * bundle all fold to the honest "not compiled" absence — never a
   * fabricated status. A NEW status value (e.g. the parallel wave's
   * 'entry-blocked') renders verbatim — the fold treats the status as
   * the boundary's own vocabulary, never a closed enum it re-decides.
   */
  readonly orgStatus?: OrgStatusSnapshot | null;
  /** The observed instant the bundle was read at (injected — never a wall clock). */
  readonly readAt: number;
}

/** One desk's oversight row — the fold's product (the render layer's single input). */
export interface OversightDeskRow {
  readonly projectId: string;
  readonly name: string;
  /** True for the shared demo project (the teaching desk — the E-8 demo-tenant marking law). */
  readonly demo: boolean;
  /** The project record's own lifecycle status (the boundary's stamp, verbatim — a LABELED fact row, never the pill). */
  readonly status: string;
  /** FW-38-B (G-3): the desk's ORG operating status (the bundle's own snapshot: 'active'/'forming'/…, rendered verbatim — an unknown status renders as itself, never re-decided); null = no snapshot on record (the honest "not compiled"). */
  readonly orgStatus: string | null;
  /**
   * FW-38-B (G-8's UI half, consumed defensively): the desk-level
   * ENTRY-BLOCKED status the utilization read serves ADDITIVELY (the
   * FW-38-A runtime contract, PR #81) — the named blocking constraint
   * that makes every entry candidate inadmissible by construction (the
   * dead-desk silence's first explanation surface). null when the read
   * serves none OR the backing predates the field (an old origin simply
   * omits it) — never a fabricated cause, never a crash.
   */
  readonly entryBlocked: RiskUtilizationEntryBlocked | null;
  readonly executionMode: string;
  /** The desk's read bundle (null when no read is on record — the honest pre-read absence). */
  readonly read: OversightDeskRead | null;
  /** FW-38-B (G-2 + G-5): the standing rows — the fill-derived book vs each bound, with the last gate observation labeled (and withheld before its observed instant); [] when no read is on record. */
  readonly standing: readonly StandingReadFold['rows'][number][];
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
  /** The standing read's own serve instant (verbatim asOf — the READ-CAPTURE instant), or null when no read is on record. */
  readonly asOf: string | null;
  /** FW-38-B (G-12): the DATA'S OWN AS-OF — the newest fill or non-withheld observation the standing rows derive from; null when nothing derives. */
  readonly standingAsOf: number | null;
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
    // FW-38-B (G-2 + G-5 + G-12): the standing rows are the FILL-DERIVED
    // book of the desk's own L4-projected submissions at the view
    // instant — NEVER the gate's projection (the read's precedence-1
    // observation renders beside it, labeled, withheld before its own
    // observed instant); the data's own as-of names the newest record
    // the rows derive from, never the read-capture instant.
    const standing = standingReadFoldOf(read?.utilization ?? null, submissions, viewAt);
    return {
      projectId: desk.id,
      name: desk.name,
      demo: isDemoProject(desk.id),
      status: desk.lifecycle.status,
      orgStatus: read?.orgStatus?.status ?? null,
      entryBlocked: read?.utilization?.entryBlocked ?? null,
      executionMode: desk.executionMode,
      read,
      standing: standing.rows,
      fills: totals.fills,
      refusals: totals.refusals,
      decisions: decisions.length,
      latestDecision: latest === null ? null : { decisionRef: latest.decision.decisionRef, disposition: latest.decision.disposition },
      breachesAtView,
      breachesTotal: breaches.length,
      asOf: read?.utilization?.asOf ?? null,
      standingAsOf: standing.dataAsOf,
    };
  });
}

/** The fold's own one-line scope disclosure (rendered with the panel — what the surface covers, stated). */
export function oversightScopeNoteOf(state: WorkspaceState): string {
  const desks = oversightDesksOf(state.projectDirectory);
  return `One governed view of this session's own desks in workspace ${state.scope.tenantId} — ${desks.length} desk${desks.length === 1 ? '' : 's'} (the session's own launched projects plus the shared demo desk). Other sessions' desks in this workspace never appear here; every count is the view-instant projection of each desk's own records.`;
}
