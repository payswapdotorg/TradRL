// @tradrl/web-console — THE OVERSIGHT PANEL RENDER (FW-37-B, Round F
// register F-2 — the consolidated multi-desk oversight surface).
//
// THE SURFACE (every multi-desk persona's #1 ask): ONE view of every
// desk this session owns — per-desk cards in the product's own card
// language (card-title + factRows), each carrying the desk's status,
// its capital/risk budgets + standing utilization (the FW-31-A/FW-34-B
// read), its blotter counts, its latest decisions and its active
// breaches AT THE VIEW INSTANT — with the per-row SIMULATED tag (the
// E-8 row-disclosure law) and the demo desk's own DEMO chip.
//
// THE LAWS THIS PANEL RIDES (the fold owns them — core/oversight.ts):
//   L4 — every count is the view-instant projection of the desk's own
//   records; the standing bounds keep the Risk section's current-
//   instant law (their own asOf names the serve, never a faked
//   point-in-time meter). H-7 (FW-40-A, Round H — L3's find): the
//   desk LIST is the view-instant projection too — a desk launched
//   after the view instant does not exist at it, so its card never
//   renders at a pre-launch view (the pre-fix panel rendered the
//   desk's full card — bounds + "organization status active" — 3+
//   minutes before its launch); the withholding note names what is
//   held back, the same law the breach-withholding note rides.
//   L12 — the desk list is the session-own listing; other sessions'
//   desks never enter (the fold's own gate, the switcher/palette's
//   own law since this wave).
//   The honesty law — no fabricated numbers anywhere: a desk without
//   a read on record renders its honest absence; "open positions" is
//   never invented (no position store exists on any backing) — the
//   row carries the blotter's own counts, the same vocabulary the
//   Execution section rides.
//
// This module is PURE VNode data (render/model.ts composes it inside
// the wall-clock render guard): same (state, viewAt, view) ->
// identical serialized bytes.

import { desksLaunchedAfterViewOf, oversightAggregateOf, oversightRowsOf, oversightScopeNoteOf, type OversightAggregateRow, type OversightDeskRow } from '../core/oversight';
import type { StandingRow } from '../core/standing';
import type { WorkspaceState } from '../core/workspace';
import type { ShellView } from './shell';
import { accountPanelOf } from './account';
import { emptyState, loadingState, statusPill } from './components';
import { formatInstantUtc } from '../core/format';
import { formatNumberGrouped } from './numbers';
import { v, type VNode } from './vtree';

/** One fact row (the panel's own copy of the card language's fact row — the value is text or a nested affordance the a11y laws can focus). */
function oversightFactRow(label: string, value: string | VNode): VNode {
  return v('div', { class: 'fact' }, [
    v('span', { class: 'fact-label' }, [label]),
    v('span', { class: 'fact-value' }, [typeof value === 'string' ? value : value]),
  ]);
}

/** The cockpit's honest-unknown sentences (the shared vocabulary — the card and the aggregate name the same absences the same way). */
const NO_READ_ON_RECORD = 'unknown — no read on record for this desk yet';
const NO_STANDING_READ_ON_RECORD = 'unknown — no standing read on record';

/**
 * FW-38-B (G-3): the org-status pill's tone — the boundary's own
 * vocabulary mapped to the shell's tones, DEFENSIVELY: a status the
 * console does not know by name (the parallel wave's 'entry-blocked',
 * or any future value) renders as itself with the warn tone, never
 * re-decided, never swallowed.
 */
function orgStatusToneOf(orgStatus: string): 'live' | 'idle' | 'warn' {
  if (orgStatus === 'active') return 'live';
  if (orgStatus === 'forming') return 'idle';
  return 'warn'; // suspended / terminated / entry-blocked / an unknown value — the blocked/abnormal family
}

/** One bound's fact rows — the fill-derived standing book vs the bound, the last gate observation LABELED (and withheld before its observed instant — G-5), the boundary's own non-observation number when the fills cannot produce one. */
function standingFactRowsOf(row: StandingRow): VNode[] {
  const facts: VNode[] = [
    oversightFactRow(`${row.metric} (bound)`, row.boundMax.length === 0 ? 'no max-side bound declared' : formatNumberGrouped(Number(row.boundMax))),
    oversightFactRow(`${row.metric} (standing — fill-derived book)`, row.standing === null
      ? 'unknown — no fill-derived number on file'
      : `${formatNumberGrouped(row.standing)} · ${row.standingStatus} (the desk\'s own fills at this view instant, never a gate observation)`),
  ];
  if (row.observation !== null) {
    facts.push(oversightFactRow(`${row.metric} (last gate observation)`, row.observation.withheldAtView
      ? `withheld — observed at ${row.observation.observedAtText}, after this view instant (L4; never rendered before its observed instant)`
      : `${row.observation.value === null ? 'unknown — no defensible number on file' : formatNumberGrouped(row.observation.value)} · ${row.observation.status} — the refused candidate's projection (what the gate last refused), never the standing book`));
  }
  if (row.served !== null) {
    facts.push(oversightFactRow(`${row.metric} (served read)`, `${formatNumberGrouped(row.served.value)} · ${row.served.status} (the boundary's own ${row.standing === null ? 'non-fill-derived' : 'fill-derived'} computation on file)`));
  }
  return facts;
}

/** The standing rows' fact pairs of a desk (G-2: the fill-derived book first, capital + risk, every other bound after — the fold's own order). */
function standingFactRowsOfDesk(row: OversightDeskRow): VNode[] {
  if (row.standing.length === 0) {
    return [oversightFactRow('standing rows', row.read === null ? 'no read on record for this desk yet' : 'none declared in this desk\'s standing read')];
  }
  return row.standing.map((bound) => standingFactRowsOf(bound)).flat();
}

/** ONE DESK CARD — the oversight row, in the product's own card language. */
function oversightDeskCard(row: OversightDeskRow, viewAt: number, simulated: boolean): VNode {
  // FW-38-B (Round G register G-3 — 6+ personas): the pill renders the
  // desk's ORG operating status (compiled/active/entry-blocked/…),
  // NEVER the project-record lifecycle "draft" — the lifecycle keeps
  // its own labeled fact row below. No org snapshot on record = the
  // honest absence (FW-44-A: "not compiled" only when the record says
  // so), never a fabricated status; an unknown status value renders
  // verbatim (orgStatusToneOf's defensive arm).
  // FW-44-A (Round L register L-1): the pill's "not compiled" is the
  // DURABLE RECORD's own claim (a null organizationRef on the project
  // record) — never the absence of an answer. A desk the record shows
  // COMPILED with no status snapshot on file (the status read has not
  // answered) renders its org status UNKNOWN — the S1 window's
  // "org not compiled" on long-compiled desks, dead at the pill.
  const pill = row.orgStatus !== null
    ? statusPill(orgStatusToneOf(row.orgStatus), row.orgStatus, 'check-pill')
    : row.orgCompiled
      ? statusPill('idle', 'org status unknown', 'check-pill')
      : statusPill('idle', 'org not compiled', 'check-pill');
  // FW-38-B (G-8's UI half — L2 + M3, the dead-desk silence): when the
  // utilization read carries the desk-level ENTRY-BLOCKED status (the
  // FW-38-A runtime contract, consumed defensively — absent on any
  // backing that predates it), the card renders the cause LOUDLY, the
  // first explanation surface a desk that never enters has: "this desk
  // cannot enter: <reason>" with the named constraint beside it. The
  // teaching reason is the runtime's own entry arithmetic ("the first
  // candidate is 100% of the projected book … and 1 > 0.25, so no
  // candidate can ever be admissible until the constraint is revised")
  // — rendered verbatim, never re-written here. A silent desk with
  // entryBlocked null renders NOTHING here: no structural cause is on
  // record, and one is never fabricated.
  const entryBlockedNote = row.entryBlocked === null ? [] : [v('p', { class: 'card-note decision-rationale', 'data-entry-blocked': row.projectId }, [
    `this desk cannot enter: ${row.entryBlocked.reason}`,
    ` (${row.entryBlocked.subject} · ${row.entryBlocked.predicateKind} bound ${row.entryBlocked.bound}, ${row.entryBlocked.severity} — constraint ${row.entryBlocked.constraintId})`,
  ])];
  return v('div', { class: `card oversight-desk${row.demo ? ' oversight-desk-demo' : ''}`, 'data-oversight-desk': row.projectId }, [
    v('div', { class: 'card-title' }, [row.name]),
    pill,
    ...(row.demo ? [v('span', { class: 'badge badge-simulated', 'data-demo-tag': 'true', title: 'the shared demo project — every session\'s teaching desk' }, ['DEMO'])] : []),
    // FW-36-B (E-8, part 1) law at the oversight surface: EVERY desk row
    // carries the visible SIMULATED tag on the demo adapter — a copied
    // row ("fills 12 · breaches 1") never reads as a production desk.
    ...(simulated ? [v('span', { class: 'badge badge-simulated', 'data-simulated-tag': 'true', title: 'this row is simulated demo data — the console runs on the demo adapter' }, ['SIMULATED'])] : []),
    ...entryBlockedNote,
    oversightFactRow('project', row.projectId),
    oversightFactRow('execution mode', row.executionMode),
    oversightFactRow('project lifecycle', row.status),
    // FW-47-B (Round M register M-5 — the org-pill leak): the unknown fact
    // row distinguishes the TWO unknown causes (the fold names which one
    // this row holds): the pre-existing no-snapshot sentence, or — inside
    // the pre-snapshot window — the L4 withheld sentence naming the
    // snapshot's OWN instant (the gate observation's withheldAtView law,
    // the same shape the standing rows' withheld observation rides).
    ...(row.orgStatus === null
      ? (row.orgCompiled
        ? [oversightFactRow('organization status', row.orgStatusObservedAt === null
            ? 'unknown — this desk\'s organization is compiled on the durable record, but no status snapshot is on file (the status read has not answered)'
            : `withheld — a status snapshot is on record but observed at ${formatInstantUtc(row.orgStatusObservedAt)}, after this view instant (L4; never rendered before its observed instant)`)]
        : [])
      : [oversightFactRow('organization status', row.orgStatus)]),
    ...standingFactRowsOfDesk(row),
    // FW-43-A (M1/L1's ask): the per-desk NET-EXPOSURE column — the
    // gross booked notional of the open positions, the fill-derived
    // book's OWN composition (the same data the standing rows ride —
    // exact-decimal strings, never a formatted float). Never a
    // fabricated number: a desk without a read on record renders the
    // honest unknown.
    oversightFactRow('net exposure (gross booked notional)', row.cockpit.netExposure === null
      ? NO_READ_ON_RECORD
      : `${row.cockpit.netExposure} across ${row.cockpit.openPositions} open position(s) — the fill-derived book's own composition (the same data the standing rows ride; every fill on record is an open position on the records this console holds — no position store exists on any backing)`),
    // FW-43-A: the SIMULATED P&L column — the honest derived figures
    // ONLY (the booked notional + the fees to date + the refusal
    // count, the numbers the fills themselves carry). NEVER a market
    // P&L: no mark-to-market exists on any backing, and the render
    // says so — a true P&L is not derivable from these records.
    oversightFactRow('simulated P&L basis (booked notional + fees to date)', row.cockpit.netExposure === null
      ? NO_READ_ON_RECORD
      : `booked notional ${row.cockpit.netExposure} · fees ${row.cockpit.feeTotal} · refusals ${row.cockpit.refusals} stopped — the SIMULATED world's booked book value to date, NOT a market P&L: no mark-to-market exists on the records this console holds; booked notional, fee total and the refusal count are the honest derived figures (a true P&L is not derivable from them)`),
    // FW-43-A: the counts ride the cockpit's honest nullables — a desk
    // without a read on record renders UNKNOWN, never a fabricated 0
    // (the same numbers the aggregate rolls up, per-field honest).
    oversightFactRow('fills on record (view instant)', row.cockpit.fills === null ? NO_READ_ON_RECORD : String(row.fills)),
    oversightFactRow('refusals (gateway-stopped)', row.cockpit.refusals === null ? NO_READ_ON_RECORD : String(row.cockpit.refusals)),
    oversightFactRow('decisions on record (view instant)', row.cockpit.decisions === null ? NO_READ_ON_RECORD : String(row.cockpit.decisions)),
    oversightFactRow('latest decision', row.latestDecision === null ? 'none visible at this view instant' : `${row.latestDecision.decisionRef} · ${row.latestDecision.disposition}`),
    // FW-43-A: the breach count IS the drill-through target for
    // breaches (M1/L1, verbatim): an ACTIVE count is a real BUTTON
    // landing on THIS desk's Risk section (keyboard focusable, the
    // house a11y laws); a known 0 renders the plain number (never a
    // dead affordance); an unknown count renders the honest unknown —
    // never a fabricated 0.
    oversightFactRow('active breaches (view instant)', row.cockpit.breaches === null
      ? NO_STANDING_READ_ON_RECORD
      : row.breachesAtView > 0
        ? v('button', {
            class: 'tm-button oversight-drill',
            'data-action': 'oversight-open-desk',
            'data-oversight-open': row.projectId,
            'data-oversight-section': 'risk',
            type: 'button',
            'aria-label': `Open ${row.name} — the Risk section (drill through the ${row.breachesAtView} active breach(es) at this view instant)`,
          }, [`${row.breachesAtView} active — open Risk`])
        : String(row.breachesAtView)),
    ...(row.breachesAtView !== row.breachesTotal
      ? [v('p', { class: 'hint', 'data-oversight-breach-note': row.projectId }, [`${row.breachesTotal - row.breachesAtView} standing breach${row.breachesTotal - row.breachesAtView === 1 ? '' : 'es'} observed AFTER this view instant ${formatInstantUtc(viewAt)} — not shown here (L4).`])]
      : []),
    ...(row.asOf === null
      ? [v('p', { class: 'hint' }, ['No standing utilization read is on record for this desk — nothing here is fabricated; the row serves when the host route answers this project.'])]
      : [v('p', { class: 'hint', 'data-oversight-asof': row.projectId }, [row.standingAsOf === null
          ? `No fill or refusal observation is on record at this view instant — the standing rows above derive from nothing on record. The read itself was captured at ${row.asOf} (the read-capture instant, not the data's as-of).`
          : `Standing book as of ${formatInstantUtc(row.standingAsOf)} — the data's own as-of: the newest fill or refusal observation the rows above derive from. The read itself was captured at ${row.asOf} (the read-capture instant, not the data's as-of).`])]),
    // FW-43-A: THE DRILL-THROUGH — the per-desk Open affordance (a
    // real BUTTON, keyboard focusable per the house a11y laws; the
    // card's other rows stay inert so a nested control never swallows
    // a click). One click switches the workspace scope to THIS desk
    // and lands on its Execution blotter — the same reset+switch
    // transition the switcher rides; the beat's scope-change refetch
    // then reads this desk's whole world without a reload.
    v('button', {
      class: 'tm-button oversight-open',
      'data-action': 'oversight-open-desk',
      'data-oversight-open': row.projectId,
      'data-oversight-section': 'execution',
      type: 'button',
      'aria-label': `Open ${row.name} — switch this workspace to the desk and land on its Execution blotter`,
    }, ['Open this desk — Execution blotter']),
  ]);
}

/**
 * FW-43-A: THE CROSS-DESK AGGREGATE ROW (the headline — M1 + L1's #1
 * YES-gate item): the roll-up over every desk at the view instant,
 * rendered ABOVE the desk cards in the same card language. THE HONESTY
 * LAW: each field is the exact sum of the SAME per-desk numbers the
 * cards below carry (L4 — the identical projection the cards ride),
 * and reads UNKNOWN when any desk's own field is unknown — never a
 * fabricated sum. Carries the visible SIMULATED tag on the demo
 * adapter (the E-8 row-disclosure law — a copied roll-up never reads
 * as a production book).
 */
function oversightAggregateCard(aggregate: OversightAggregateRow, viewAt: number, simulated: boolean): VNode {
  // The unknown-cause sentences, composed per family (named — never a
  // silent absence): the blotter fields share the missing-bundle cause;
  // the breach field needs the standing read too, so its cause names
  // whichever gaps exist.
  const missingRead = aggregate.desksWithoutRead > 0
    ? `${aggregate.desksWithoutRead} desk${aggregate.desksWithoutRead === 1 ? '' : 's'} without a read on record`
    : null;
  const missingStanding = aggregate.desksWithoutStandingRead > 0
    ? `${aggregate.desksWithoutStandingRead} desk${aggregate.desksWithoutStandingRead === 1 ? '' : 's'} without a standing read on record`
    : null;
  const blotterUnknown = missingRead === null ? null : `unknown — ${missingRead}`;
  const breachUnknown = missingRead === null && missingStanding === null ? null : `unknown — ${[missingRead, missingStanding].filter((part) => part !== null).join(' and ')}`;
  return v('div', { class: 'card oversight-aggregate', 'data-oversight-aggregate': 'true' }, [
    v('div', { class: 'card-title' }, ['The cross-desk roll-up — every desk at this view instant']),
    // E-8 (part 1) at the cockpit's headline: the roll-up carries the
    // visible SIMULATED tag on the demo adapter (the mirror law: a live
    // console renders no tag).
    ...(simulated ? [v('span', { class: 'badge badge-simulated', 'data-simulated-tag': 'true', title: 'this roll-up is simulated demo data — the console runs on the demo adapter' }, ['SIMULATED'])] : []),
    oversightFactRow('desks', String(aggregate.desks)),
    oversightFactRow('net exposure (standing book notional, all desks)', blotterUnknown === null
      ? `${aggregate.netExposureTotal}`
      : blotterUnknown),
    oversightFactRow('open positions', blotterUnknown === null ? String(aggregate.openPositions) : blotterUnknown),
    oversightFactRow('fills on record', blotterUnknown === null ? String(aggregate.fills) : blotterUnknown),
    oversightFactRow('refusals (gateway-stopped)', blotterUnknown === null ? String(aggregate.refusals) : blotterUnknown),
    oversightFactRow('decisions on record', blotterUnknown === null ? String(aggregate.decisions) : blotterUnknown),
    oversightFactRow('active breaches (view instant)', breachUnknown === null ? String(aggregate.breaches) : breachUnknown),
    v('p', { class: 'hint', 'data-oversight-aggregate-note': 'true' }, [
      `The roll-up composes the same per-desk numbers the cards below carry at this view instant ${formatInstantUtc(viewAt)} (L4 — the same projection the cards ride); each total is the exact-decimal sum of the known fields, and a field reads unknown when any desk's own field is unknown — never a fabricated sum (the breach total additionally needs every desk's standing read on record).`,
    ]),
  ]);
}

/**
 * THE OVERSIGHT PANEL — the workspace-level consolidated view. Teaching
 * states per the §4.12 law: a layout-mirroring skeleton while the
 * first directory read is in flight, the honest empty state when no
 * desk is readable, and the single-desk teaching note (what a
 * one-desk workspace sees — the surface stays honest about what it is
 * for).
 */
export function oversightPanel(state: WorkspaceState, viewAt: number, view: ShellView): VNode {
  // FW-42-B (the Round J copy-lag — 6/6 pure testers): under a signed-in
  // principal the panel's copy says "your desks" (the account scope the
  // pure test proved — the desks follow the account across browsers);
  // an anonymous session keeps the exact session-scoped bytes (honest
  // for it — this device's storage is the only thing that remembers an
  // anonymous session's desks). The L12 wall clause holds in both.
  const authenticated = accountPanelOf(view).surface === 'authenticated';
  if (state.projectDirectory.length === 0 && state.connection === 'connecting') {
    return v('section', { class: 'panel oversight', 'data-section': 'oversight' }, [loadingState('rows')]);
  }
  if (state.projectDirectory.length === 0) {
    return v('section', { class: 'panel oversight', 'data-section': 'oversight' }, [
      emptyState({
        icon: 'layers',
        title: 'No desks readable yet.',
        sentence: authenticated
          ? 'This workspace\'s desk registry is empty or still loading — your desks appear here the moment the directory read answers.'
          : 'This workspace\'s desk registry is empty or still loading — the desks this session owns appear here the moment the directory read answers.',
        action: { label: 'Refresh', action: 'refresh' },
      }),
    ]);
  }
  const rows = oversightRowsOf(state, viewAt);
  // H-7 (FW-40-A — L3's find): the pre-launch desks withheld at this
  // view instant, NAMED — never a silent absence. A desk's card is pure
  // launch-derived identity, so nothing of it renders before the desk
  // exists; the census (the scope note above) counts only the desks
  // that existed at the instant under review.
  const withheldDesks = desksLaunchedAfterViewOf(state.projectDirectory, viewAt);
  return v('section', { class: 'panel oversight', 'data-section': 'oversight' }, [
    v('p', { class: 'hint', 'data-oversight-scope': 'true' }, [oversightScopeNoteOf(state, viewAt, authenticated)]),
    ...(withheldDesks > 0 ? [v('p', { class: 'hint', 'data-oversight-withheld-desks': 'true' }, [`${withheldDesks} desk${withheldDesks === 1 ? '' : 's'} launched after this view instant ${formatInstantUtc(viewAt)} — not shown here (L4; a desk card never renders before the desk's own launch instant).`])] : []),
    // FW-43-A: THE CROSS-DESK AGGREGATE ROW (the headline) — above the
    // desk cards, the roll-up of the same numbers the cards carry at
    // this view instant (honest per-field unknowns, never a fabricated
    // sum). Rendered whenever the census carries at least one desk.
    ...(rows.length > 0 ? [oversightAggregateCard(oversightAggregateOf(state, viewAt), viewAt, view.simulated)] : []),
    ...rows.map((row) => oversightDeskCard(row, viewAt, view.simulated)),
    ...(rows.length === 1
      ? [v('p', { class: 'card-note', 'data-oversight-single': 'true' }, [authenticated
        ? 'One desk so far — this view consolidates every desk that follows your account; launch another from Home and it joins this monitor (each desk keeps its own workspace when you switch into it).'
        : 'One desk so far — this view consolidates every desk this session owns; launch another from Home and it joins this monitor (each desk keeps its own workspace when you switch into it).'])]
      : []),
  ]);
}
