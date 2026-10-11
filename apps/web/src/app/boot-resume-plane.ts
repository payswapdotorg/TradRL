// @tradrl/web-console — THE BOOT/RESUME PLANE (FW-40-B, Round H — the
// boot/resume cluster: H-4 the stale view-instant resume trap + the
// boot-seam draft persistence, S2's draft-lost-on-reload).
//
// THE PATTERN (the app/oversight-plane.ts + app/export-flow.ts
// extraction lineage, ridden for console.ts's own 160 KiB single-file
// payload budget — the budget's own encouraged move): the plane owns
// the wave's RESUME state + cadences, the console seam keeps only the
// thin wiring —
//   - H-4 THE RESTORED-VIEW VALIDATION STATE: the boot TM restore
//     (inside the listing read) re-lands the stored view instant BEFORE
//     the adopted scope's records hydrate, so the restore's
//     record-derived floor clamp is structurally unavailable then — a
//     stored instant from another day (S3's constant
//     2025-08-22T01:53:57.640Z, identical across desks) predates every
//     project this browser later opens, and every section then honestly
//     read "No ... at this view instant" over a healthy compiled desk
//     (the dead-desk misdiagnosis that cost a persona worker three
//     blocked rows). The heal: the restored instant is held PENDING;
//     once the scope's own records are on hand (historyFloorOf's
//     'records' derivation) the validation compares it against the
//     project's own earliest record — a pre-history instant HEALS TO
//     LIVE with the TM bar's teaching line; an instant inside the
//     desk's history stands (FW-34-B's incident-restore law, unchanged).
//     The pending flag also keeps the heal from overriding the analyst:
//     the moment THEY move the machine, the restore's job is done — no
//     heal, ever.
//   - THE DRAFT PERSISTENCE (core/launch-draft-store.ts the record):
//     the restore applies EXACTLY ONCE, inside the listing read, only
//     while the wizard is UNTOUCHED (phase 'idle', no draft — a driving
//     user is never clobbered, the D-15 law); the write-through
//     persists every committed edit/step under the CURRENT scope (the
//     store records INVESTMENT — a merely opened blank wizard never
//     persists) and is PHASE-GATED to the OPEN wizard (phase 'draft' —
//     FW-42-B, Round J register J-2: the reducer keeps the draft in
//     state after a launch, so a late draft event over a concluded
//     launch must never re-persist it); THE LAUNCH'S ACCEPTANCE clears
//     the record (launch-submitted — the host took the create + the
//     research job; FW-42-B, J-2: a snapshot surviving the acceptance
//     is M2's double-launch hazard, and the later poll-beat clear could
//     be missed entirely by a mid-launch scope switch), with the
//     conclusion (launch-completed) and an explicit RESET re-clearing
//     as defense in depth (best-effort, the posture seam's law; the
//     restore's own dispatches never re-write). Full rationale:
//     core/launch-draft-store.ts.
//   - BOTH restored disclosures (the TM bar's heal note, the wizard
//     card's draft-restored hint) are HELD here pre-mount and ride the
//     shell view after (the account plane's holder+setter pattern:
//     render/shell.ts's optional ShellView fields are the carriers, the
//     console seam binds the setters at mount, and each note RETIRES on
//     the user's first own drive — the teaching line described the one
//     restore; the surface is theirs again).

import { viewAtOf as viewAtOfTimeMachine } from '../core/timemachine';
import { historyFloorOf } from '../core/workspace';
import type { WorkspaceEvent, WorkspaceState } from '../core/workspace';
import { withSpanDerivedLaunchLabel } from '../core/launch';
import type { InstantSource } from '../core/clock';
import type { TmHealNote } from '../render/shell';
import type { WorkspaceScope } from '../core/tenant';
import { clearStoredLaunchDraft, persistLaunchDraft, readStoredLaunchDraftRecord, type LaunchDraftStorage, type StoredLaunchDraft } from '../core/launch-draft-store';

/** The heal note's mount-bound view setter (null = the retired note; the account plane's setPanel pattern). */
export type RestoredViewHealSetter = (note: TmHealNote | null) => void;

/** The restored-draft hint's mount-bound view setter (null = the retired hint). */
export type DraftRestoredSetter = (savedAt: number | null) => void;

/** The seams the console provides: the live state + dispatch (never owned here), the boot scope + instant source + storage seam. */
export interface BootResumeSeams {
  /** The console's scope-storage seam (localStorage in production; undefined = the draft persistence is session-only). */
  readonly storage: LaunchDraftStorage | undefined;
  /** The boot-pinned scope (tenant + the normalized project id — the plane reads the record against it). */
  readonly scope: WorkspaceScope;
  /** The injected instant source (never a wall clock — the test seam's discipline). */
  readonly instants: InstantSource;
  /** LIVE state read — the plane never owns the workspace. */
  state(): WorkspaceState;
  /** The console's dispatch (the plane's restores/heals ride it). */
  dispatch(event: WorkspaceEvent): void;
}

/** The boot/resume plane: the resume state + cadences behind thin console wiring. */
export interface BootResumePlane {
  /** Pre-reduce hook (the dispatch wrapper's head): retire the restored disclosures on the user's own drives. */
  beforeReduce(event: WorkspaceEvent): void;
  /** Post-reduce hook (the dispatch wrapper's tail): the draft write-through + clear. */
  afterReduce(event: WorkspaceEvent): void;
  /** The boot TM restore's arm: the landed view instant is held PENDING for the post-hydration validation. */
  landRestoredView(viewAt: number): void;
  /** Validate a pending restored instant against the CURRENT scope's own records (the bundle-finally + the beat cadences). */
  validateRestoredView(): void;
  /** Attempt the stored-draft restore against the SETTLED scope (the listing read's tail; exactly once, never over a driving user). */
  restoreStoredDraft(): void;
  /** Mount: bind the view setters + apply any disclosure that landed BEFORE mount. */
  bindView(setHealNote: RestoredViewHealSetter, setDraftRestored: DraftRestoredSetter): void;
}

/**
 * Create the boot/resume plane. The stored draft record is captured
 * ONCE, synchronously, here (the D-15 discipline) — UNGATED by design:
 * the record's scope gate applies at the RESTORE, against the SETTLED
 * scope (the listing read may first adopt the stored scope; the desk
 * that settles is the desk whose own draft restores — never another
 * desk's).
 */
export function createBootResumePlane(seams: BootResumeSeams): BootResumePlane {
  const bootStoredDraft: StoredLaunchDraft | null = seams.storage === undefined ? null : readStoredLaunchDraftRecord(seams.storage);
  let pendingRestoredView: number | null = null;
  let restoredViewHeal: TmHealNote | null = null;
  let showRestoredViewHeal: RestoredViewHealSetter | null = null;
  let healingRestoredView = false;
  let launchDraftRestoreApplied = false;
  let restoringLaunchDraft = false;
  let launchDraftRestoredAt: number | null = null;
  let showLaunchDraftRestored: DraftRestoredSetter | null = null;

  const showHeal = (note: TmHealNote | null): void => {
    restoredViewHeal = note;
    if (showRestoredViewHeal !== null) showRestoredViewHeal(note);
  };
  const showDraft = (savedAt: number | null): void => {
    launchDraftRestoredAt = savedAt;
    if (showLaunchDraftRestored !== null) showLaunchDraftRestored(savedAt);
  };

  /**
   * FW-40-B (H-4): validate the restored view instant against the
   * CURRENT scope's own records, once they are on hand — runs at the
   * end of every read bundle and every beat (the two hydration
   * cadences). No records yet: retry next cadence; the analyst drove
   * the machine: stand down; a pre-history restored instant: heal to
   * LIVE + the teaching line.
   */
  const validateRestoredView = (): void => {
    if (pendingRestoredView === null) return;
    const state = seams.state();
    const machine = state.timeMachine;
    if (machine.mode === 'live' || viewAtOfTimeMachine(machine) !== pendingRestoredView) {
      // The machine moved past the restore (the analyst drove it, or it
      // healed already) — the restore's job is done; never a second
      // opinion over the user's choice (the D-15 law).
      pendingRestoredView = null;
      return;
    }
    const history = historyFloorOf(state);
    if (history.derived !== 'records') return; // the scope's own records have not hydrated yet — the next cadence retries
    const restoredAt = pendingRestoredView;
    pendingRestoredView = null;
    if (restoredAt < history.floorAt) {
      // THE HEAL: the restored instant predates this project's own
      // earliest record — nothing could EVER render there (no section,
      // no scrubber, no step can reach below the record-derived floor).
      // Set the note BEFORE the dispatch so the onState render inside
      // the dispatch already carries the teaching line; the heal's own
      // view-live is exempt from the wrapper's note retirement.
      showHeal({ fromAt: restoredAt, earliestAt: history.floorAt });
      healingRestoredView = true;
      try {
        seams.dispatch({ kind: 'view-live', at: seams.instants.nowMs() });
      } finally {
        healingRestoredView = false;
      }
    }
    // else: the restored instant sits inside the desk's own history —
    // FW-34-B's incident-restore law holds; the analyst stands where
    // the last session left them. Nothing to do.
  };

  /** FW-40-B: does this event drive the Time Machine (retiring the heal note)? The user's own TM moves + every scope adoption (a project open re-initializes the view — the note described the PREVIOUS restore). */
  const isTimeMachineDriveEvent = (event: WorkspaceEvent): boolean => {
    if (event.kind === 'view-live' || event.kind === 'view-tminus' || event.kind === 'view-timestamp' || event.kind === 'project-adopted') return true;
    return event.kind.startsWith('playback-');
  };

  /** FW-40-B: attempt the stored-draft restore against the SETTLED scope (exactly once, never over a driving user). */
  const restoreStoredDraft = (): void => {
    if (launchDraftRestoreApplied || bootStoredDraft === null) return;
    const state = seams.state();
    if (state.launch.draft !== null || state.launch.phase !== 'idle') return; // the user is already driving the wizard — never clobber (D-15)
    if (bootStoredDraft.tenantId !== state.scope.tenantId || bootStoredDraft.projectId !== state.scope.projectId) return; // a draft authored on ANOTHER desk never restores here
    launchDraftRestoreApplied = true;
    showDraft(bootStoredDraft.savedAt); // the hint rides the view BEFORE the render the dispatch triggers
    restoringLaunchDraft = true;
    try {
      // FW-41-C (I-6): the restored draft's event carries the SPAN-DERIVED
      // horizon label — a record persisted by a pre-fix session (the seed's
      // stale 'one day' against a moved horizon end) never re-enters the
      // chain with its stale annotation (the g1 class law, the draft-event
      // half; the wizard's own validation remains the semantic teacher).
      seams.dispatch({ kind: 'launch-draft-started', at: seams.instants.nowMs(), draft: withSpanDerivedLaunchLabel(bootStoredDraft.draft) });
      if (bootStoredDraft.step !== 'goal') seams.dispatch({ kind: 'launch-step-changed', at: seams.instants.nowMs(), step: bootStoredDraft.step });
    } finally {
      restoringLaunchDraft = false;
    }
  };

  return {
    beforeReduce(event) {
      // H-4: a Time-Machine drive (the analyst's own move, or a scope
      // adoption re-initializing the view) RETIRES the heal note — the
      // heal's OWN view-live is exempt (healingRestoredView).
      if (restoredViewHeal !== null && !healingRestoredView && isTimeMachineDriveEvent(event)) showHeal(null);
      // The draft persistence: the user's own wizard drive (a committed
      // edit, a step move) RETIRES the restored hint — the restore's OWN
      // dispatches are exempt (they are the hint's product).
      if (launchDraftRestoredAt !== null && !restoringLaunchDraft && (event.kind === 'launch-draft-edited' || event.kind === 'launch-step-changed')) showDraft(null);
    },
    afterReduce(event) {
      // THE DRAFT WRITE-THROUGH + CLEAR: a committed wizard edit or step
      // move persists the draft + step under the CURRENT scope (the
      // store records INVESTMENT, never a mere open); the launch's
      // ACCEPTANCE clears the record — FW-42-B (Round J register J-2):
      // the clear must be ATOMIC with the confirm acceptance
      // ('launch-submitted': the host created the project and took the
      // research job — the draft became a desk server-side), never at a
      // later snapshot beat (the pre-fix 'launch-completed' clear rode
      // the poll cadence, which a mid-launch scope switch skips
      // entirely — M2's record survived and restored on every scope
      // open). The conclusion and an explicit reset re-clear as defense
      // in depth (best-effort, the posture seam's law; the restore's own
      // dispatches never re-write).
      if (seams.storage === undefined) return;
      if (event.kind === 'launch-submitted' || event.kind === 'launch-completed' || event.kind === 'launch-reset') {
        clearStoredLaunchDraft(seams.storage);
        return;
      }
      if (restoringLaunchDraft) return;
      if (event.kind !== 'launch-draft-edited' && event.kind !== 'launch-step-changed') return;
      const state = seams.state();
      // FW-42-B (J-2) THE RESURRECTION GUARD: the write-through serves the
      // OPEN wizard only (phase 'draft'). The reducer keeps the draft in
      // state after a launch (only 'launch-reset' clears it), so a draft
      // event landing over a launching/launched/failed launch is a stale
      // flush — never a re-persist. A draft must NEVER outlive its launch.
      if (state.launch.phase !== 'draft') return;
      if (state.launch.draft !== null) persistLaunchDraft(seams.storage, state.scope, state.launch.draft, state.launch.step, seams.instants.nowMs());
    },
    landRestoredView(viewAt) {
      pendingRestoredView = viewAt;
    },
    validateRestoredView,
    restoreStoredDraft,
    bindView(setHealNote, setDraftRestored) {
      showRestoredViewHeal = setHealNote;
      showLaunchDraftRestored = setDraftRestored;
      // A disclosure that landed BEFORE mount (the boot listing read
      // races it) is held plane-side and applies to this first view.
      if (restoredViewHeal !== null) setHealNote(restoredViewHeal);
      if (launchDraftRestoredAt !== null) setDraftRestored(launchDraftRestoredAt);
    },
  };
}
