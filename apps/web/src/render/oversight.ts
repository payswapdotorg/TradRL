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
//   point-in-time meter).
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

import { oversightRowsOf, oversightScopeNoteOf, type OversightDeskRow } from '../core/oversight';
import type { StandingRow } from '../core/standing';
import type { WorkspaceState } from '../core/workspace';
import type { ShellView } from './shell';
import { emptyState, loadingState, statusPill } from './components';
import { formatInstantUtc } from '../core/format';
import { formatNumberGrouped } from './numbers';
import { v, type VNode } from './vtree';

/** One fact row (the panel's own copy of the card language's fact row). */
function oversightFactRow(label: string, value: string): VNode {
  return v('div', { class: 'fact' }, [
    v('span', { class: 'fact-label' }, [label]),
    v('span', { class: 'fact-value' }, [value]),
  ]);
}

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
  // honest "not compiled" absence, never a fabricated status; an
  // unknown status value renders verbatim (orgStatusToneOf's defensive
  // arm).
  const pill = row.orgStatus === null
    ? statusPill('idle', 'org not compiled', 'check-pill')
    : statusPill(orgStatusToneOf(row.orgStatus), row.orgStatus, 'check-pill');
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
    ...(row.orgStatus === null ? [] : [oversightFactRow('organization status', row.orgStatus)]),
    ...standingFactRowsOfDesk(row),
    oversightFactRow('fills on record (view instant)', String(row.fills)),
    oversightFactRow('refusals (gateway-stopped)', String(row.refusals)),
    oversightFactRow('decisions on record (view instant)', String(row.decisions)),
    oversightFactRow('latest decision', row.latestDecision === null ? 'none visible at this view instant' : `${row.latestDecision.decisionRef} · ${row.latestDecision.disposition}`),
    oversightFactRow('active breaches (view instant)', String(row.breachesAtView)),
    ...(row.breachesAtView !== row.breachesTotal
      ? [v('p', { class: 'hint', 'data-oversight-breach-note': row.projectId }, [`${row.breachesTotal - row.breachesAtView} standing breach${row.breachesTotal - row.breachesAtView === 1 ? '' : 'es'} observed AFTER this view instant ${formatInstantUtc(viewAt)} — not shown here (L4).`])]
      : []),
    ...(row.asOf === null
      ? [v('p', { class: 'hint' }, ['No standing utilization read is on record for this desk — nothing here is fabricated; the row serves when the host route answers this project.'])]
      : [v('p', { class: 'hint', 'data-oversight-asof': row.projectId }, [row.standingAsOf === null
          ? `No fill or refusal observation is on record at this view instant — the standing rows above derive from nothing on record. The read itself was captured at ${row.asOf} (the read-capture instant, not the data's as-of).`
          : `Standing book as of ${formatInstantUtc(row.standingAsOf)} — the data's own as-of: the newest fill or refusal observation the rows above derive from. The read itself was captured at ${row.asOf} (the read-capture instant, not the data's as-of).`])]),
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
  if (state.projectDirectory.length === 0 && state.connection === 'connecting') {
    return v('section', { class: 'panel oversight', 'data-section': 'oversight' }, [loadingState('rows')]);
  }
  if (state.projectDirectory.length === 0) {
    return v('section', { class: 'panel oversight', 'data-section': 'oversight' }, [
      emptyState({
        icon: 'layers',
        title: 'No desks readable yet.',
        sentence: 'This workspace\'s desk registry is empty or still loading — the desks this session owns appear here the moment the directory read answers.',
        action: { label: 'Refresh', action: 'refresh' },
      }),
    ]);
  }
  const rows = oversightRowsOf(state, viewAt);
  return v('section', { class: 'panel oversight', 'data-section': 'oversight' }, [
    v('p', { class: 'hint', 'data-oversight-scope': 'true' }, [oversightScopeNoteOf(state)]),
    ...rows.map((row) => oversightDeskCard(row, viewAt, view.simulated)),
    ...(rows.length === 1
      ? [v('p', { class: 'card-note', 'data-oversight-single': 'true' }, ['One desk so far — this view consolidates every desk this session owns; launch another from Home and it joins this monitor (each desk keeps its own workspace when you switch into it).'])]
      : []),
  ]);
}
