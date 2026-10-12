// apps/web/src/core/durable-classes.test.ts — THE FW-47-A CONSOLE-SIDE
// KEEP-GREEN PINS (Round M register items M-1 + M-2 + M-4 — the durable
// note/alert record family's console half).
//
// WHAT THIS FILE IS (the honest scope): the Round M defect lived at the
// SERVER's serve seam — the session-scoped durable goal read served goal +
// constraintSet + world ONLY, so the console's notes-less-read-CLEARS fold
// law wiped both record classes at every boot re-read (the cards read
// "No ... on record yet"; every post-reload export derived ZERO
// record-prefix events for the classes; the alert-fired verdict evaporated
// with them). The console's OWN fold and export derivation were ALREADY
// CORRECT: given the rows the fixed server serves, every law below holds
// on the pre-fix tree. These four pins are KEEP-GREEN by design — they
// guard the console-side invariants while the server seam changes, so a
// console-side regression can never hide behind the server fix:
//
//   (1) THE M-4 CONSISTENCY LAW: the live-session path (the note/alert
//       routes' answers dispatched as session events) and the post-reload
//       re-read path (the goal bundle serving the durable rows) derive
//       BYTE-IDENTICAL note-attached/alert-declared/alert-fired
//       record-prefix events, each stamped at ITS OWN record instant —
//       the fired verdict is session-INDEPENDENT (S3-cont/L2-cont's live
//       firings vs S1/L3's post-reload zeros, closed at the fold).
//
//   (2) THE FORWARD-ONLY FIRING LAW: the firing stamps at the OBSERVED
//       fill's own filledAt with the observed price verbatim, and a fill
//       that crossed the level BEFORE the declaration never fires (an
//       alert watches forward from its own declaration — L4).
//
//   (3) THE EXAMINER'S CITATION FOLD: every provenance ref a persisted
//       deliverable cites resolves to a note-attached/alert-declared entry
//       IN THE SAME export file, with the verbatim text/envelope — the
//       citation can never drift from the evidence (M-2's console half:
//       the export is the file the examiner reads).
//
//   (4) THE RELOAD SHAPE AT THE FOLD + THE NOTES-LESS-READ-CLEARS LAW: a
//       re-read that serves the rows keeps them (wholesale replace); a
//       re-read that serves NEITHER field clears both — the fold mirrors
//       THIS scope's read-back truth, which is exactly why the fix belongs
//       at the server's serve path, never a weakened fold.
//
// Spec anchors: L4 (each record's own instant), R43 (additive), the
// FW-45/FW-46 record-class laws, FW-43-B's record-derived prefix, the
// world read-clears law (D-8/W-28). The server-side seam is pinned in
// deploy/vercel/durable-record-classes.test.ts (the RED file).

import { describe, expect, it } from 'vitest';
import type { ConstraintSetStatement, GatewaySubmissionRecord, GoalStatement, PriceAlertRecord, ProjectRecord, ResearchNoteRecord } from '../api/contracts';
import { composeWorkspaceExport, openWorkspace, reduceWorkspace, verifyWorkspaceExport, serializeWorkspaceExport } from './workspace';
import { canonicalJson } from './digest';

const SCOPE = { tenantId: 'tenant-a', projectId: 'proj-a' } as const;
const T0 = 1_700_000_000_000;

// ---------------------------------------------------------------------------
// The fixtures (the workspace.test.ts shapes, verbatim — the host routes'
// minted records + the blotter's own row shape)
// ---------------------------------------------------------------------------

function projectRecord(): ProjectRecord {
  return {
    id: 'proj-a',
    tenantId: 'tenant-a',
    name: 'Console Test Project',
    executionMode: 'simulation',
    lifecycle: { projectId: 'proj-a', status: 'active', acceptanceCriteriaId: null, organizationRef: null },
    lineage: { projectId: 'proj-a', createdAt: T0, createdBy: 'worker', priorVersion: null, version: 1 },
    createdAt: T0,
    updatedAt: T0,
  } as unknown as ProjectRecord;
}

function goalRecord(): GoalStatement {
  return {
    id: 'goal-1',
    version: 1,
    tenantId: 'tenant-a',
    objective: 'alpha over horizon',
    horizon: { startsAt: T0, endsAt: T0 + 86_400_000 },
    successCriteria: { criteria: [], requiredSatisfaction: 1 },
    evaluation: { blindRef: 'ev:blind', walkForwardRef: 'ev:wf', regimeRef: 'ev:regime', adversarialRequired: true },
    createdAt: T0,
  };
}

function constraintSetRecord(): ConstraintSetStatement {
  return { id: 'cs-1', version: 1, tenantId: 'tenant-a', constraints: [], createdAt: T0 };
}

/** One attached research note (the host note route's minted record — the durable row the goal re-read serves). */
function researchNote(overrides: Partial<ResearchNoteRecord> = {}): ResearchNoteRecord {
  return {
    noteId: 'note:aaaa1111',
    tenant: 'tenant-a',
    project: 'proj-a',
    attachedAt: T0 + 40,
    title: 'Factset export notes',
    text: 'fitted half-life 6.7 days; z-entry 2.1; z-exit 0.4',
    ...overrides,
  } as ResearchNoteRecord;
}

/** One declared price alert (the host alert route's minted record). */
function priceAlert(overrides: Partial<PriceAlertRecord> = {}): PriceAlertRecord {
  return {
    alertId: 'alert:aaaa1111',
    tenant: 'tenant-a',
    project: 'proj-a',
    declaredAt: T0 + 45,
    market: 'BTC-USD',
    direction: 'above',
    level: '61500',
    ...overrides,
  } as PriceAlertRecord;
}

/** One routed blotter row carrying fill economics (the firing fold's observed record). */
function filledSubmission(overrides: { readonly routedAt: number; readonly filledAt: number; readonly price: string }): GatewaySubmissionRecord {
  return {
    kind: 'routed',
    submissionId: `xgs:${overrides.routedAt}`,
    decisionId: 'xd:demo',
    auditId: 'xga:demo',
    requestRef: 'gor:demo',
    venue: 'BROKER-FIX',
    adapterRef: 'adapter:demo-broker',
    channelRef: 'chan:demo-main',
    order: {
      clientOrderId: 'ord-demo',
      instrumentId: 'BTC-USD',
      venueId: 'BROKER-FIX',
      side: 'buy',
      kind: 'limit',
      quantity: '0.75',
      price: overrides.price,
      timeInForce: 'gtc',
      createdAt: new Date(overrides.routedAt).toISOString(),
    },
    fill: { state: 'filled', quantity: '0.75', price: overrides.price, notional: '1', fee: '0.01', filledAt: overrides.filledAt },
  } as unknown as GatewaySubmissionRecord;
}

/** The export's record-derived entries of the three record-class kinds (the prefix rows this file pins). */
function recordClassPrefixOf(doc: ReturnType<typeof composeWorkspaceExport>) {
  return doc.events.filter((entry) => entry.derived === true && (entry.payload.kind === 'note-attached' || entry.payload.kind === 'alert-declared' || entry.payload.kind === 'alert-fired'));
}

// ---------------------------------------------------------------------------
// (1) THE M-4 CONSISTENCY LAW — the live session and the post-reload
//     re-read derive BYTE-IDENTICAL record-prefix events
// ---------------------------------------------------------------------------

describe('FW-47-A: the durable record classes at the console fold (the M-4 consistency family — keep-green by design)', () => {
  it('the M-4 CONSISTENCY LAW: the live-session path and the post-reload re-read path derive BYTE-IDENTICAL note-attached/alert-declared/alert-fired record-prefix events, each stamped at ITS OWN record instant — the fired verdict is session-INDEPENDENT', () => {
    // THE LIVE SESSION (S3-cont/L2-cont's shape): the console dispatched the
    // routes' minted answers as its own session events — note-attached at
    // T0+40, alert-declared at T0+45, the fill recorded at T0+50 (the live
    // blotter), the firing observed live.
    let live = openWorkspace(SCOPE, T0);
    live = reduceWorkspace(live, { kind: 'project-loaded', at: T0 + 1, project: projectRecord() });
    live = reduceWorkspace(live, { kind: 'goal-loaded', at: T0 + 2, goal: goalRecord(), constraintSet: constraintSetRecord() });
    live = reduceWorkspace(live, { kind: 'note-attached', at: T0 + 40, note: researchNote() });
    live = reduceWorkspace(live, { kind: 'alert-declared', at: T0 + 45, alert: priceAlert() });
    live = reduceWorkspace(live, { kind: 'submission-recorded', at: T0 + 50, submission: filledSubmission({ routedAt: T0 + 50, filledAt: T0 + 60, price: '62000.00' }) });

    // THE POST-RELOAD RE-READ (S1/L3's shape, with the rows SERVED): a
    // fresh page session boots, the goal bundle re-read carries the durable
    // rows (the fixed server's serve), and the blotter re-read re-records
    // the same fill row. The session's own events differ entirely from the
    // live session's — the RECORDS are the same.
    let reloaded = openWorkspace(SCOPE, T0 + 100);
    reloaded = reduceWorkspace(reloaded, { kind: 'project-loaded', at: T0 + 101, project: projectRecord() });
    reloaded = reduceWorkspace(reloaded, { kind: 'goal-loaded', at: T0 + 102, goal: goalRecord(), constraintSet: constraintSetRecord(), notes: [researchNote()], alerts: [priceAlert()] });
    reloaded = reduceWorkspace(reloaded, { kind: 'submission-recorded', at: T0 + 110, submission: filledSubmission({ routedAt: T0 + 50, filledAt: T0 + 60, price: '62000.00' }) });

    // THE LAW: both paths' record-derived prefixes of the three kinds are
    // BYTE-IDENTICAL (canonical JSON) — the derivation is a pure function
    // of the records on file, never of the session that observed them.
    const livePrefix = recordClassPrefixOf(composeWorkspaceExport(live));
    const reloadedPrefix = recordClassPrefixOf(composeWorkspaceExport(reloaded));
    expect(livePrefix).toHaveLength(3); // note-attached + alert-declared + alert-fired
    expect(canonicalJson(reloadedPrefix as never)).toBe(canonicalJson(livePrefix as never)); // BYTE-IDENTICAL

    // ...each stamped at ITS OWN record instant — the note's attachedAt, the
    // alert's declaredAt, the OBSERVED fill's own filledAt (never either
    // session's event clock: not T0+40/T0+45 from the live session's
    // dispatches, not T0+102/T0+110 from the re-read).
    const kinds = livePrefix.map((entry) => entry.payload.kind);
    expect(kinds).toContain('note-attached');
    expect(kinds).toContain('alert-declared');
    expect(kinds).toContain('alert-fired');
    const noteEntry = livePrefix.find((entry) => entry.payload.kind === 'note-attached') as { readonly payload: { readonly at: number; readonly note: ResearchNoteRecord } };
    expect(noteEntry.payload.at).toBe(T0 + 40); // the note's OWN attachedAt
    expect(noteEntry.payload.note.text).toBe('fitted half-life 6.7 days; z-entry 2.1; z-exit 0.4'); // the verbatim text
    const declaredEntry = livePrefix.find((entry) => entry.payload.kind === 'alert-declared') as { readonly payload: { readonly at: number; readonly alert: PriceAlertRecord } };
    expect(declaredEntry.payload.at).toBe(T0 + 45); // the alert's OWN declaredAt
    expect(declaredEntry.payload.alert.level).toBe('61500'); // the verbatim envelope
    const firedEntry = livePrefix.find((entry) => entry.payload.kind === 'alert-fired') as { readonly payload: { readonly at: number; readonly firing: { readonly at: number; readonly observedPrice: string } } };
    expect(firedEntry.payload.at).toBe(T0 + 60); // the OBSERVED fill's own filledAt — never the export clock
    expect(firedEntry.payload.firing.observedPrice).toBe('62000.00'); // the observed price verbatim
    // The reloaded session's own history is a DIFFERENT set of events (its
    // reads) — only the record-derived prefix is identical (the two-half law).
    const reloadedDoc = composeWorkspaceExport(reloaded);
    expect(reloadedDoc.events.some((entry) => entry.derived !== true)).toBe(true); // the session's own history rides behind the prefix
    expect(verifyWorkspaceExport(JSON.parse(serializeWorkspaceExport(reloaded)))).toEqual({ ok: true });
  });

  it('the FORWARD-ONLY FIRING LAW: a fill that crossed the level BEFORE the declaration never fires; the firing stamps at the OBSERVED fill\'s own filledAt with the observed price verbatim — the alert watches forward from its own declaration (L4)', () => {
    let state = openWorkspace(SCOPE, T0);
    state = reduceWorkspace(state, { kind: 'project-loaded', at: T0 + 1, project: projectRecord() });
    state = reduceWorkspace(state, { kind: 'goal-loaded', at: T0 + 2, goal: goalRecord(), constraintSet: constraintSetRecord(), alerts: [priceAlert()] });
    // The observed records: a BTC-USD fill at T0+40 (crosses 61500, but
    // BEFORE the T0+45 declaration — never a firing) and one at T0+60
    // (crosses — THE firing).
    state = reduceWorkspace(state, { kind: 'submission-recorded', at: T0 + 40, submission: filledSubmission({ routedAt: T0 + 40, filledAt: T0 + 40, price: '61800.00' }) });
    state = reduceWorkspace(state, { kind: 'submission-recorded', at: T0 + 60, submission: filledSubmission({ routedAt: T0 + 60, filledAt: T0 + 60, price: '62150.50' }) });
    const doc = composeWorkspaceExport(state);
    const fired = doc.events.filter((entry) => entry.payload.kind === 'alert-fired' && entry.derived === true);
    expect(fired).toHaveLength(1); // the pre-declaration crossing fill NEVER fires
    const entry = fired[0] as { readonly payload: { readonly at: number; readonly alert: PriceAlertRecord; readonly firing: { readonly at: number; readonly observedPrice: string } } };
    expect(entry.payload.alert.alertId).toBe('alert:aaaa1111');
    expect(entry.payload.at).toBe(T0 + 60); // the OBSERVED fill's own instant — never T0+40
    expect(entry.payload.firing.observedPrice).toBe('62150.50'); // the observed price verbatim
    expect(verifyWorkspaceExport(JSON.parse(serializeWorkspaceExport(state)))).toEqual({ ok: true });
  });

  it('THE EXAMINER\'S CITATION FOLD: every provenance ref the persisted deliverable cites resolves to a note-attached/alert-declared entry IN THE SAME export file, with the verbatim text/envelope — the citation can never drift from the evidence', () => {
    // The records on file (the durable rows the re-read serves)...
    const note = researchNote();
    const secondNote = researchNote({ noteId: 'note:bbbb2222', title: 'Z-score params', text: 'z-entry 2.1, z-exit 0.4; the pair trades only inside the fitted band', attachedAt: T0 + 42 });
    const alert = priceAlert();
    let state = openWorkspace(SCOPE, T0);
    state = reduceWorkspace(state, { kind: 'project-loaded', at: T0 + 1, project: projectRecord() });
    state = reduceWorkspace(state, { kind: 'goal-loaded', at: T0 + 2, goal: goalRecord(), constraintSet: constraintSetRecord(), notes: [note, secondNote], alerts: [alert] });
    const doc = composeWorkspaceExport(state);

    // ...and the persisted deliverable's cited refs (runtime/deliverable.ts's
    // own ref shapes: noteId + title / alertId + market + direction + level).
    const citedNoteRefs = [{ noteId: note.noteId, title: note.title }, { noteId: secondNote.noteId, title: secondNote.title }];
    const citedAlertRefs = [{ alertId: alert.alertId, market: alert.market, direction: alert.direction, level: alert.level }];

    // THE EXAMINER'S FOLD over the ONE export file: every cited ref resolves
    // to a record-derived entry carrying the verbatim evidence.
    const noteEntries = doc.events.filter((entry) => entry.payload.kind === 'note-attached' && entry.derived === true) as { readonly payload: { readonly note: ResearchNoteRecord } }[];
    const alertEntries = doc.events.filter((entry) => entry.payload.kind === 'alert-declared' && entry.derived === true) as { readonly payload: { readonly alert: PriceAlertRecord } }[];
    for (const ref of citedNoteRefs) {
      const resolved = noteEntries.find((entry) => entry.payload.note.noteId === ref.noteId);
      expect(resolved, `the cited note ${ref.noteId} resolves IN THE SAME export file`).toBeDefined();
      expect(resolved?.payload.note.title).toBe(ref.title); // the ref's title matches the entry's record
      expect([note.text, secondNote.text]).toContain(resolved?.payload.note.text); // the verbatim text rides the entry
    }
    for (const ref of citedAlertRefs) {
      const resolved = alertEntries.find((entry) => entry.payload.alert.alertId === ref.alertId);
      expect(resolved, `the cited alert ${ref.alertId} resolves IN THE SAME export file`).toBeDefined();
      expect(resolved?.payload.alert.market).toBe(ref.market); // the envelope verbatim
      expect(resolved?.payload.alert.direction).toBe(ref.direction);
      expect(resolved?.payload.alert.level).toBe(ref.level);
    }
    // The fold is honest in the other direction too: a ref naming a row that
    // is NOT on file (a stale citation — the residue's shape) does NOT
    // resolve — the examiner can always measure the drift, never be fooled
    // by a fabricated entry.
    expect(noteEntries.some((entry) => entry.payload.note.noteId === 'note:deadbeef')).toBe(false);
    expect(verifyWorkspaceExport(JSON.parse(serializeWorkspaceExport(state)))).toEqual({ ok: true });
  });

  it('THE RELOAD SHAPE AT THE FOLD + THE NOTES-LESS-READ-CLEARS LAW: a re-read that serves the rows keeps them (wholesale replace); a re-read that serves NEITHER field clears both — the fold mirrors THIS scope\'s read-back truth, which is why the fix belongs at the server\'s serve path, never a weakened fold', () => {
    let state = openWorkspace(SCOPE, T0);
    state = reduceWorkspace(state, { kind: 'project-loaded', at: T0 + 1, project: projectRecord() });
    state = reduceWorkspace(state, { kind: 'goal-loaded', at: T0 + 2, goal: goalRecord(), constraintSet: constraintSetRecord(), notes: [researchNote()], alerts: [priceAlert()] });
    expect(state.notes).toHaveLength(1);
    expect(state.alerts).toHaveLength(1);
    // A re-read that serves BOTH classes keeps them (the wholesale replace —
    // the same rows serve again).
    state = reduceWorkspace(state, { kind: 'goal-loaded', at: T0 + 3, goal: goalRecord(), constraintSet: constraintSetRecord(), notes: [researchNote()], alerts: [priceAlert()] });
    expect(state.notes).toHaveLength(1);
    expect(state.alerts).toHaveLength(1);
    // A re-read that serves NEITHER field clears both — the `world` law,
    // verbatim (the fold NEVER carries a stale record across a read that
    // does not serve it: the state mirrors the read-back truth).
    state = reduceWorkspace(state, { kind: 'goal-loaded', at: T0 + 4, goal: goalRecord(), constraintSet: constraintSetRecord() });
    expect(state.notes).toEqual([]);
    expect(state.alerts).toEqual([]);
    // ...and the export derives ZERO class events from the cleared state —
    // the honest fold. THIS is the law that made the pre-fix server seam
    // fatal (a serve that omits the rows erases the classes at every boot
    // re-read) and it is kept EXACTLY as it is: the fix serves the rows,
    // the fold never fabricates.
    const doc = composeWorkspaceExport(state);
    expect(doc.events.some((entry) => entry.payload.kind === 'note-attached' || entry.payload.kind === 'alert-declared' || entry.payload.kind === 'alert-fired')).toBe(false);
  });
});
