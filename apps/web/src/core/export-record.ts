// @tradrl/web-console — THE EXPORT'S RECORD-DERIVED EVENT PREFIX
// (FW-43-B, Round K minor — L3/S2/S3/L2, four personas corroborated).
//
// THE HOLE THIS CLOSES (the Round K register's minor): the export's
// events chain was PAGE-SESSION-SCOPED — an export taken after a browser
// reload started a fresh chain and omitted the pre-reload record. L3:
// "an export taken after a browser reload starts a fresh chain and does
// not carry pre-reload history (… a compliance officer exporting after a
// refresh gets a truncated history chain; D1's launch-submitted event is
// absent from my D2 export)". L2: "D1/D2's launch-submitted absent from
// my D2 export after the F1 draft-test reload … a compliance officer
// gets a truncated launch trail after a refresh". S3: "it spans 6
// project ids (…) and omits D1's pre-reload launch events". S2 carried
// the same observation cross-browser.
//
// THE LAW (FW-43-B): the export carries the PROJECT's FULL RECORD ON
// FILE — every event the durable rows hold for the scope — not just the
// current page session's events. The console's own folded rows (what the
// boot bundle re-read from the host's routes) ARE the durable rows'
// images, so the export DERIVES one event per record on file from the
// state's own rows — stamped at EACH RECORD'S OWN INSTANT (never the
// composition clock), honestly labeled `derived: true` — and chains them
// AHEAD of the current session's own linked history:
//
//   project-loaded     the project record on file
//   goal-loaded        the goal bundle (goal + constraint set + the
//                      persisted launch world, when one is on record)
//   launch-submitted   the console launch's kickoff job (identified as
//                      the EARLIEST research job of a world-carrying
//                      scope — the launch flow submits the kickoff
//                      immediately after the create, before any other
//                      job can exist; the event's instant is the row's
//                      own submittedAt)
//   knowledge-loaded   the knowledge fold's own records
//   outcomes-loaded    the outcomes fold's own records
//   post-mortems-loaded the post-mortem fold's own records
//   submission-recorded one per execution submission row (the blotter)
//   job-updated        one per job row (the jobs fold)
//   launch-completed   the kickoff job's own completion (completedAt),
//                      when the row is complete
//   outcome-recorded   one per PROMOTED decision row (the outcome
//                      records carrying the decision→job backlink)
//   org-snapshot       one per organization-status snapshot on record
//   risk-utilization-loaded the standing risk read (its own asOf)
//   note-attached      one per ATTACHED RESEARCH NOTE row (FW-45, the
//                      E-6 MVP — the note's envelope VERBATIM, its text
//                      IN the chained record, stamped at the note's OWN
//                      attachedAt: the notes reach the chain)
//
// THE HONEST BOUNDARY, DISCLOSED (never silently truncated): session-only
// UI events of PRIOR sessions — view navigation, playback, wizard drafts,
// notice reads, connection flaps — were never records on file (no durable
// row holds them), and cannot be recovered; the durable rows ARE the
// record. The export's manifest carries recordScopeNote telling exactly
// this split, and every derived entry is labeled `derived: true` (the
// additive, deliberately NON-DIGESTED placement the simulated flag and
// the actor field established — see EXPORT_DERIVED_EVENT_RULE).
//
// THE CHAIN LAWS ARE UNCHANGED: the derived prefix chains under the same
// digest/link/head rules as the session's events — a LONGER chain under
// the same laws (the rebuild in composeWorkspaceExport owns both halves).
//
// Pure: no DOM, no clock, never a throw (a malformed row is skipped
// honestly — R46). Zero-dep: the workspace module's own types only
// (type-only imports — erased, no runtime cycle; the boot-resume-plane
// precedent).

import type { WorkspaceEvent, WorkspaceState } from './workspace';

/**
 * FW-43-B: THE PUBLISHED DERIVED-EVENT RULE, embedded verbatim in every
 * export's manifest that carries a record prefix (the
 * EXPORT_SIMULATED_FLAG_RULE / EXPORT_ACTOR_RULE precedent): what the
 * `derived: true` field means and its placement OUTSIDE every digest.
 */
export const EXPORT_DERIVED_EVENT_RULE = 'derived field: events[] chain entries carrying \'derived\': true are RECORD-DERIVED — composed at export time from the project\'s own durable rows on file (the project record, the goal bundle with its launch world, every execution submission row, every job row, the launch trail derived from the kickoff job\'s own record, every promoted decision, the organization-status snapshots, the standing risk read, and every attached research note — each note-attached entry carries the note\'s own text VERBATIM, stamped at the note\'s own attached instant), each stamped at ITS OWN RECORD\'S instant and never at the exporting session\'s clock. They are the compliance officer\'s FULL RECORD: an export taken after a reload carries them regardless of what the current page session observed. Entries without the field are the CURRENT PAGE SESSION\'s own linked history — its reads and actions. DELIBERATELY NON-DIGESTED: the published digest rule covers exactly {seq,tenantId,projectId,payload}, so the flag rides each entry as envelope data exactly like the simulated flag — the chain and every digest verify identically with or without it, and pre-FW-43-B documents verify unchanged (the format version stays 2).';

/** One derived launch-trail row — the kickoff job's own fields (null when nothing derivable). */
interface DerivedKickoffRow {
  readonly jobId: string;
  readonly submittedAt: number;
  readonly completedAt?: number;
  readonly status: string;
}

/**
 * Identify the console launch's KICKOFF job row of a world-carrying
 * scope: the EARLIEST research job by submittedAt (ties resolve to the
 * fold's own order). The launch flow submits the kickoff immediately
 * after the create-project (apps/web console.ts), and a standalone
 * research job requires the compiled desk to exist — so the earliest
 * research job of a console-launched project IS the kickoff by
 * construction. A world-less scope (the demo desk — seeded, never
 * launched; an SDK-created project) derives NO launch trail: the honest
 * nothing, never a fabricated launch. A scope whose jobs fold carries
 * no research row derives none either.
 */
function launchTrailOf(state: WorkspaceState): DerivedKickoffRow | null {
  if (state.world === null) return null; // no launch world on record — no console launch to derive
  let kickoff: DerivedKickoffRow | null = null;
  for (const job of state.jobs) {
    if (job.kind !== 'research') continue; // the launch's kickoff is a research job (toLaunchJobSpec rides the research lane)
    if (kickoff === null || job.submittedAt < kickoff.submittedAt) {
      kickoff = { jobId: job.jobId, submittedAt: job.submittedAt, ...(job.completedAt === undefined ? {} : { completedAt: job.completedAt }), status: job.status };
    }
  }
  return kickoff;
}

/**
 * FW-43-B: DERIVE THE RECORD EVENTS of the scope — one event per record
 * on file, in the deterministic order documented in the module header,
 * each stamped at ITS OWN RECORD'S instant. Pure, never a throw: a
 * malformed row is skipped honestly (R46); an empty surface derives
 * nothing. The state's own folded rows are the ONLY input (what the
 * boot bundle re-read — the durable rows' images; never the session's
 * history, never a wall clock).
 */
export function deriveRecordEventsOf(state: WorkspaceState): readonly WorkspaceEvent[] {
  const events: WorkspaceEvent[] = [];
  const scope = state.scope;

  // 1. The project record on file.
  if (state.project !== null) {
    events.push({ kind: 'project-loaded', at: state.project.updatedAt, project: state.project });
  }

  // 2. The goal bundle (goal + constraint set + the persisted launch world).
  if (state.goal !== null && state.constraintSet !== null) {
    events.push({
      kind: 'goal-loaded',
      at: state.goal.createdAt,
      goal: state.goal,
      constraintSet: state.constraintSet,
      ...(state.world === null ? {} : { world: state.world }),
    });
  }

  // 3. The launch trail — submitted (the kickoff's own submittedAt).
  const trail = launchTrailOf(state);
  if (trail !== null) {
    events.push({ kind: 'launch-submitted', at: trail.submittedAt, projectId: scope.projectId, jobId: trail.jobId });
  }

  // 4-6. The read folds' own records (knowledge, outcomes, post-mortems).
  if (state.knowledge.length > 0) {
    const at = Math.max(...state.knowledge.map((entry) => entry.record.asOf));
    if (Number.isFinite(at)) events.push({ kind: 'knowledge-loaded', at, records: [...state.knowledge] });
  }
  if (state.outcomes.length > 0) {
    const at = Math.max(...state.outcomes.map((record) => record.asOf));
    if (Number.isFinite(at)) events.push({ kind: 'outcomes-loaded', at, records: [...state.outcomes] });
  }
  if (state.postMortems.length > 0) {
    const at = Math.max(...state.postMortems.map((record) => record.asOf));
    if (Number.isFinite(at)) events.push({ kind: 'post-mortems-loaded', at, records: [...state.postMortems] });
  }

  // 7. One event per execution submission row (the blotter), fold order.
  for (const submission of state.submissions) {
    const at = submission.kind === 'refused' ? submission.refusedAt : submission.routedAt;
    if (!Number.isFinite(at)) continue; // a malformed row — skipped honestly, never a fabricated instant
    events.push({ kind: 'submission-recorded', at, submission });
  }

  // 8. One event per job row (the jobs fold), fold order.
  for (const job of state.jobs) {
    const at = job.completedAt ?? job.submittedAt;
    if (!Number.isFinite(at)) continue;
    events.push({ kind: 'job-updated', at, job });
  }

  // 9. The launch trail — completed (the kickoff row's own completedAt).
  if (trail !== null && trail.completedAt !== undefined && Number.isFinite(trail.completedAt)) {
    events.push({ kind: 'launch-completed', at: trail.completedAt });
  }

  // 10. One event per PROMOTED decision row (the decision→job backlink carriers).
  for (const outcome of state.outcomes) {
    if (outcome.promotedFromJob === undefined) continue; // not a promotion — the fold's own records ride at (5)
    if (!Number.isFinite(outcome.asOf)) continue;
    events.push({ kind: 'outcome-recorded', at: outcome.asOf, outcome });
  }

  // 11. One event per organization-status snapshot, state order.
  for (const snapshot of state.orgSnapshots) {
    if (!Number.isFinite(snapshot.at)) continue;
    events.push({ kind: 'org-snapshot', at: snapshot.at, snapshot });
  }

  // 12. The standing risk read (its own asOf — the read's own serve instant).
  if (state.riskUtilization !== null) {
    const at = Date.parse(state.riskUtilization.asOf);
    if (Number.isFinite(at)) events.push({ kind: 'risk-utilization-loaded', at, read: state.riskUtilization });
  }

  // 13. FW-45: ONE EVENT PER ATTACHED NOTE — the note's own envelope
  // VERBATIM (the titled text IN the chained record, M3's seam e
  // answered), stamped at the note's OWN attachedAt (never the export
  // clock — L4). A malformed row is skipped honestly (R46).
  for (const note of state.notes) {
    if (!Number.isFinite(note.attachedAt)) continue;
    events.push({ kind: 'note-attached', at: note.attachedAt, note });
  }

  return Object.freeze(events);
}

/**
 * FW-43-B: THE MANIFEST'S FULL-RECORD SCOPE NOTE (the chainScopeNote's
 * record-scope sibling — the D-14 precedent): tells the compliance
 * officer exactly what the chain carries. Undefined when nothing is on
 * file (the empty workspace — nothing to disclose).
 */
export function recordScopeNoteOf(recordDerivedEvents: number, sessionEvents: number): string | undefined {
  if (recordDerivedEvents === 0) return undefined;
  return [
    `THE FULL RECORD ON FILE: this export's events chain carries ${recordDerivedEvents} record-derived entries first (each labeled 'derived': true) — one per record the host's durable rows hold for this scope (the project record, the goal bundle with its launch world, every execution submission row, every job row, the launch trail derived from the kickoff job's own record, every promoted decision, the organization-status snapshots, the standing risk read, and every attached research note — its own text rides its note-attached entry verbatim), each stamped at its own record's instant.`,
    `The ${sessionEvents} entries after those are the CURRENT PAGE SESSION's own linked history — its reads and actions.`,
    'An export taken after a reload carries the record-derived prefix regardless of what the current session observed (the pre-fix export started a fresh chain at the reload and omitted the pre-reload record).',
    'The honest boundary: session-only UI events of PRIOR sessions (view navigation, playback, wizard drafts, notice reads, connection changes) were never records on file — no durable row holds them — and cannot be recovered; the durable rows are the record. Every digest and link verifies under the published rules with or without the derived labels.',
  ].join(' ');
}
