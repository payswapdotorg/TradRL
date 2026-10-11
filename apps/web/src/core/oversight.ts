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
//   H-7 (FW-40-A, Round H — L3's find): the desk LIST itself is the
//   view-instant projection too — a desk's card renders only when the
//   desk EXISTED at the view instant (its own launch instant, the
//   project record's createdAt; the pre-fix list rendered a desk's full
//   card — name, bounds, "organization status active" — 3+ minutes
//   BEFORE its launch while the counts beside it honestly stayed 0).
//   A desk launched after the view instant is withheld (never rendered
//   at a pre-launch view) and the panel names what is withheld (L4 —
//   the same projection discipline every count rides).
//
// FW-44-A (Round L register L-1 — S1's find): the READ-ABSENCE FOLD.
//   A read-absence window's present-but-EMPTY bundle (every route
//   answered nothing — app/oversight-plane.ts's catch arms) used to
//   fold as POSITIVE zeros ("fills 0", "net 0") and the roll-up summed
//   the gap as knowns — the fabricated-sum class. THE LAW: a zero is
//   a POSITIVE claim only a CONFIRMED read may make; an all-empty
//   bundle is the honest absence (confirmedDeskReadOf below), and the
//   org pill's "not compiled" is the durable record's own claim (a
//   null organizationRef — the row's orgCompiled), never the absence
//   of a status answer.
//
// This module is PURE: identical (state, viewAt) -> identical rows.
// No DOM, no clock, no transport.

import type { GatewaySubmissionRecord, OrgStatusSnapshot, OutcomeRecord, ProjectRecord, RiskUtilizationEntryBlocked, RiskUtilizationRead } from '../api/contracts';
import { blotterTotalsOf } from './blotter';
import { sumExactDecimals } from './decimals';
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
 *
 * FW-44-A (L-1): the bundle's content is its CONFIRMATION — the
 * all-empty shape the plane composes when every route answers nothing
 * is NOT a read on record (confirmedDeskReadOf folds it to the honest
 * absence; its empty arrays never fold as positive zeros).
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
  /** The desk's read bundle (null when no CONFIRMED read is on record — the pre-read absence OR the all-empty unconfirmed bundle, FW-44-A: never a positive zero). */
  readonly read: OversightDeskRead | null;
  /** FW-44-A (L-1): the durable record's own compile claim (a non-null organizationRef) — "not compiled" is THIS fact, never the absence of a status answer; a compiled desk with no snapshot renders UNKNOWN. */
  readonly orgCompiled: boolean;
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
  /**
   * FW-43-A (Round K register §3.2 — the product list's #2, M1 + L1's
   * #1 YES-gate item): the desk's COCKPIT numbers — the per-desk
   * net-exposure and the simulated P&L basis the cards render and the
   * cross-desk aggregate rolls up. Every field is an HONEST NULLABLE:
   * a desk without a read bundle on record folds every field to null
   * (never a fabricated 0 — the console has not read that desk's
   * blotter), and the breach field is null when the bundle carries no
   * standing read (the blotter fields stay known — per-field honesty).
   */
  readonly cockpit: OversightDeskCockpit;
}

/**
 * FW-43-A: one desk's cockpit numbers — the honest nullable view of
 * what the desk's own records can derive AT THE VIEW INSTANT.
 *   net exposure — the gross booked notional of the open positions
 *   (the fill-derived book's own composition, core/blotter.ts's
 *   exact-decimal notional total over the L4-projected fills — the
 *   same data the standing rows ride); every fill on record is an open
 *   position on the records this console holds (no position store
 *   exists on any backing).
 *   The simulated P&L basis — the booked notional + the fee total +
 *   the refusal count (the numbers the fills themselves carry). NO
 *   market P&L is ever fabricated: no mark-to-market exists on any
 *   backing, so the render composes and labels these derived figures
 *   as the SIMULATED world's book value, never a P&L the records
 *   cannot derive.
 */
export interface OversightDeskCockpit {
  /** The open positions on record at the view instant (the fills — the blotter's own count), or null when the desk's blotter is not on record. */
  readonly openPositions: number | null;
  /** The exact-decimal gross booked notional of those open positions (the fill-derived book), or null when the desk's blotter is not on record. */
  readonly netExposure: string | null;
  /** The exact-decimal fee total across the fills, or null when the desk's blotter is not on record. */
  readonly feeTotal: string | null;
  /** The fills on record at the view instant (the bundle's own L4-projected blotter), or null when no bundle is on record. */
  readonly fills: number | null;
  /** The gateway-stopped refusals on record at the view instant, or null when no bundle is on record. */
  readonly refusals: number | null;
  /** The decisions on record at the view instant, or null when no bundle is on record. */
  readonly decisions: number | null;
  /** The active breaches OBSERVED BY the view instant, or null when the bundle (or its standing read) is not on record. */
  readonly breaches: number | null;
}

/**
 * FW-43-A: THE CROSS-DESK AGGREGATE ROW — the roll-up over every desk
 * at the view instant (the SAME L4 projection the cards ride, folded
 * from the same rows). THE HONESTY LAW (the work order's own words):
 * each field is the exact sum of the known per-desk fields, and reads
 * UNKNOWN (null) when ANY desk's own field is unknown — never a
 * fabricated sum. The blotter-derived fields need every desk's bundle
 * on record; the breach field additionally needs every desk's STANDING
 * read (a bundle without one leaves that desk's breach count unknown).
 * `desks` itself is always known — the census is the view-instant
 * listing, exactly the scope note's own count.
 */
export interface OversightAggregateRow {
  /** The desks that existed at the view instant (the census — always known). */
  readonly desks: number;
  /** The exact-decimal sum of the desks' net exposures (the fill-derived books summed), or null when any desk's book is unknown. */
  readonly netExposureTotal: string | null;
  /** The sum of the desks' open positions, or null when any desk's count is unknown. */
  readonly openPositions: number | null;
  /** The sum of the desks' fills, or null when any desk's count is unknown. */
  readonly fills: number | null;
  /** The sum of the desks' gateway-stopped refusals, or null when any desk's count is unknown. */
  readonly refusals: number | null;
  /** The sum of the desks' decisions, or null when any desk's count is unknown. */
  readonly decisions: number | null;
  /** The sum of the desks' view-instant active breaches, or null when any desk's standing read is not on record. */
  readonly breaches: number | null;
  /** The desks whose bundle is not on record OR not confirmed (the all-empty read-absence shape, FW-44-A) — the blotter-field unknowns' cause, named — never a silent absence. */
  readonly desksWithoutRead: number;
  /** The bundled desks whose standing read is not on record (the breach-field unknown's cause, named). */
  readonly desksWithoutStandingRead: number;
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
 * FW-40-A (Round H register H-7 — L3's find): the desks of the
 * session-own listing that EXISTED at the view instant — each one
 * projected by its own launch instant (the project record's
 * createdAt, the same `availableAt <= viewAt` law every record rides;
 * a desk launched AT the view instant exists at it). A desk launched
 * after the view instant never renders at that view: its card is pure
 * launch-derived identity (name, lifecycle, execution mode, bounds,
 * org status), so there is nothing honest to render of it before the
 * desk exists — the counts alone were never the leak (they already
 * projected correctly).
 */
export function desksExistingAtViewOf(directory: readonly ProjectRecord[], viewAt: number): readonly ProjectRecord[] {
  return oversightDesksOf(directory).filter((desk) => desk.createdAt <= viewAt);
}

/** FW-40-A (H-7): the session-own desks whose launch instant is AFTER the view instant — never rendered at that instant; the count the panel's withholding note names (L4, named — never silent). */
export function desksLaunchedAfterViewOf(directory: readonly ProjectRecord[], viewAt: number): number {
  return oversightDesksOf(directory).filter((desk) => desk.createdAt > viewAt).length;
}

/**
 * FW-44-A (Round L register L-1 — S1's find): the fold's READ
 * CONFIRMATION gate. A bundle is a read ON RECORD only when at least
 * one route CONFIRMED something — a standing utilization read, a
 * submission, a decision, or an org-status snapshot. The all-empty
 * bundle (every route answered nothing — the plane's read-absence
 * shape) is NOT a read on record: a zero is a POSITIVE claim only a
 * CONFIRMED read may make, so the fold returns the honest absence
 * (null) and the aggregate counts the desk in desksWithoutRead —
 * never a fabricated sum over the gap. The G-4 recovery still re-reads
 * exactly these desks (it works on the raw bundles), and a confirmed
 * re-read replaces the bundle and the desk's numbers return.
 */
export function confirmedDeskReadOf(read: OversightDeskRead | null): OversightDeskRead | null {
  if (read === null) return null;
  const confirmed = read.utilization !== null
    || read.submissions.length > 0
    || read.decisions.length > 0
    || (read.orgStatus ?? null) !== null;
  return confirmed ? read : null;
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
  // H-7 (FW-40-A): the desk list is the VIEW-INSTANT projection of the
  // session-own listing by each desk's OWN launch instant — a desk
  // launched after the view instant does not exist at it and renders
  // nothing (the pre-fix list rendered its full card at a pre-launch
  // view). The per-desk counts below keep their own record-level L4
  // projection (a desk that existed may still show honestly-0 counts).
  return desksExistingAtViewOf(state.projectDirectory, viewAt).map((desk): OversightDeskRow => {
    // FW-44-A (L-1): the CONFIRMED bundle or the honest absence — an
    // all-empty bundle is not a read on record, so its [] never folds
    // as a positive zero (the S1 window's zeros + understated roll-up,
    // dead at the gate).
    const read = confirmedDeskReadOf(state.oversight.find((candidate) => candidate.projectId === desk.id) ?? null);
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
    // FW-43-A: the desk's COCKPIT numbers — the honest nullable view.
    // A desk with NO bundle on record folds every field to null (the
    // console has not read that desk's blotter — never a fabricated
    // 0); a bundle whose standing read did not answer keeps the
    // blotter fields known but folds the breach count to null (the
    // per-field honesty the aggregate rolls up). The numbers ride the
    // SAME totals the row's own counts carry (blotterTotalsOf over the
    // L4-projected submissions — exact decimals, never float).
    const cockpit: OversightDeskCockpit = read === null
      ? { openPositions: null, netExposure: null, feeTotal: null, fills: null, refusals: null, decisions: null, breaches: null }
      : {
          openPositions: totals.fills,
          netExposure: totals.notionalTotal,
          feeTotal: totals.feeTotal,
          fills: totals.fills,
          refusals: totals.refusals,
          decisions: decisions.length,
          breaches: read.utilization === null ? null : breachesAtView,
        };
    return {
      projectId: desk.id,
      name: desk.name,
      demo: isDemoProject(desk.id),
      status: desk.lifecycle.status,
      orgStatus: read?.orgStatus?.status ?? null,
      entryBlocked: read?.utilization?.entryBlocked ?? null,
      executionMode: desk.executionMode,
      orgCompiled: desk.lifecycle.organizationRef !== null,
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
      cockpit,
    };
  });
}

/** FW-43-A: one cockpit count field's picker (the erasable-subset law: function types live in named aliases, never inline at annotation depth zero). */
type CockpitCountOf = (row: OversightDeskRow) => number | null;

/**
 * FW-43-A: THE CROSS-DESK AGGREGATE — the roll-up of the SAME rows the
 * cards render, at the SAME view instant (one fold, two surfaces — the
 * F-6 law's own shape). Pure and total: an empty listing folds to a
 * zero-desk census (every field known at 0 — the honest empty book,
 * never an unknown); otherwise each field is the exact sum of the
 * known per-desk fields, or null when ANY desk's own field is unknown
 * (never a fabricated sum — the work order's own law). The notional
 * total is an EXACT-DECIMAL sum (core/decimals.ts's sumExactDecimals
 * over the desks' net-exposure strings, never float arithmetic).
 */
export function oversightAggregateOf(state: WorkspaceState, viewAt: number): OversightAggregateRow {
  const rows = oversightRowsOf(state, viewAt);
  // FW-44-A (L-1): the unconfirmed bundles are already folded to the
  // honest absence by the rows — they count here, never sum as zeros.
  const desksWithoutRead = rows.filter((row) => row.read === null).length;
  const desksWithoutStandingRead = rows.filter((row) => row.read !== null && row.read.utilization === null).length;
  // THE HONEST GRANULARITY: the blotter-derived fields are one family
  // (they all derive from the desk's bundle); the breach field needs
  // the standing read too. A family is known only when EVERY desk can
  // produce its number — one unread desk makes the roll-up unknown,
  // never a sum fabricated over the gap.
  const blotterKnown = desksWithoutRead === 0;
  const breachesKnown = desksWithoutRead === 0 && desksWithoutStandingRead === 0;
  const sumCounts = (pick: CockpitCountOf): number | null =>
    rows.reduce((total: number | null, row) => {
      const value = pick(row);
      return value === null || total === null ? null : total + value;
    }, 0);
  return {
    desks: rows.length,
    netExposureTotal: blotterKnown ? sumExactDecimals(rows.map((row) => row.cockpit.netExposure ?? '0')) : null,
    openPositions: blotterKnown ? sumCounts((row) => row.cockpit.openPositions) : null,
    fills: blotterKnown ? sumCounts((row) => row.cockpit.fills) : null,
    refusals: blotterKnown ? sumCounts((row) => row.cockpit.refusals) : null,
    decisions: blotterKnown ? sumCounts((row) => row.cockpit.decisions) : null,
    breaches: breachesKnown ? sumCounts((row) => row.cockpit.breaches) : null,
    desksWithoutRead,
    desksWithoutStandingRead,
  };
}

/**
 * The fold's own one-line scope disclosure (rendered with the panel — what the surface covers, stated). The census is the VIEW-INSTANT count (H-7): the desks that existed at the instant under review, never the listing's full total.
 *
 * FW-42-B (the Round J copy-lag — 6/6 pure testers): the listing is
 * ACCOUNT-scoped under a signed-in principal (the Round J pure test —
 * clear localStorage → reload → one sign-in listed every desk that
 * follows the account, whatever browser launched it), so the
 * authenticated note says "your desks"; an anonymous session keeps the
 * exact session-scoped sentence — honest for it (this device's storage
 * is the only thing that remembers an anonymous session's desks). The
 * L12 wall clause ("other sessions' desks never appear here") holds in
 * both postures: a desk that follows the calling account is that
 * principal's desk, never "another session's".
 */
export function oversightScopeNoteOf(state: WorkspaceState, viewAt: number, authenticated = false): string {
  const desks = desksExistingAtViewOf(state.projectDirectory, viewAt);
  const count = `${desks.length} desk${desks.length === 1 ? '' : 's'} at this view instant`;
  return authenticated
    ? `One governed view of your desks in workspace ${state.scope.tenantId} — ${count} (every desk that follows your account, whatever browser launched it, plus the shared demo desk). Other sessions' desks in this workspace never appear here; every count is the view-instant projection of each desk's own records, and a desk launched after this view instant does not exist at it.`
    : `One governed view of this session's own desks in workspace ${state.scope.tenantId} — ${count} (the session's own launched projects plus the shared demo desk). Other sessions' desks in this workspace never appear here; every count is the view-instant projection of each desk's own records, and a desk launched after this view instant does not exist at it.`;
}
