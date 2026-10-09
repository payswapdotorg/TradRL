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

/** The budget rows' fact pairs of a desk (capital + risk first, the fold's own order; every other bound after, verbatim). */
function budgetFactRowsOf(row: OversightDeskRow): VNode[] {
  if (row.budgets.length === 0) {
    return [oversightFactRow('budgets on record', row.read === null ? 'no read on record for this desk yet' : 'none declared in this desk\'s standing read')];
  }
  return row.budgets.map((budget) => [
    oversightFactRow(`${budget.metric} (bound)`, budget.boundMax.length === 0 ? 'no max-side bound declared' : formatNumberGrouped(Number(budget.boundMax))),
    oversightFactRow(`${budget.metric} (standing)`, budget.current === null ? 'unknown — no defensible number on file' : `${formatNumberGrouped(budget.current)} · ${budget.status}`),
  ]).flat();
}

/** ONE DESK CARD — the oversight row, in the product's own card language. */
function oversightDeskCard(row: OversightDeskRow, viewAt: number, simulated: boolean): VNode {
  const statusTone = row.status === 'active' ? 'live' : row.status === 'paused' || row.status === 'draft' ? 'idle' : 'warn';
  return v('div', { class: `card oversight-desk${row.demo ? ' oversight-desk-demo' : ''}`, 'data-oversight-desk': row.projectId }, [
    v('div', { class: 'card-title' }, [row.name]),
    statusPill(statusTone, row.status, 'check-pill'),
    ...(row.demo ? [v('span', { class: 'badge badge-simulated', 'data-demo-tag': 'true', title: 'the shared demo project — every session\'s teaching desk' }, ['DEMO'])] : []),
    // FW-36-B (E-8, part 1) law at the oversight surface: EVERY desk row
    // carries the visible SIMULATED tag on the demo adapter — a copied
    // row ("fills 12 · breaches 1") never reads as a production desk.
    ...(simulated ? [v('span', { class: 'badge badge-simulated', 'data-simulated-tag': 'true', title: 'this row is simulated demo data — the console runs on the demo adapter' }, ['SIMULATED'])] : []),
    oversightFactRow('project', row.projectId),
    oversightFactRow('execution mode', row.executionMode),
    ...budgetFactRowsOf(row),
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
      : [v('p', { class: 'hint' }, [`Standing read as of ${row.asOf} — the current instant, not projected to the view instant (point-in-time risk is not computable from the records on file).`])]),
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
