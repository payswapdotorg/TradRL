// @tradrl/web-console — the app orchestrator.
//
// The glue layer between the injected seams and the pure core:
//   - builds the mirrored client over the INJECTED transport adapter
//     (the browser fetch binding in production, a scripted transport
//     in tests);
//   - feeds the pure workspace state machine with events stamped at
//     INJECTED instants (never a wall-clock read in a render path);
//   - drives the read cadence (negotiation, project/knowledge/
//     outcome/post-mortem/org reads, job polling) with graceful
//     degradation on every failure (the console never crashes on an
//     unreachable API — it renders the last known world plus the
//     degradation note);
//   - composes the primary flow's launch (project create + kickoff
//     job submission + progress) through the API routes;
//   - mounts the render model into a DOM root and re-projects on
//     every state change (the model enforces the laws; this layer
//     only wires events).
//
// Spec anchors: R36, R39, R46 (graceful provider degradation), L12,
// L20, COMPETITIVE-ADOPTION.md (the console orchestrates; it never
// locks in — every read goes through the boundary).

import type { ApiTransport, FetchLike } from '../api/transport';
import { createFetchTransport } from '../api/transport';
import { createConsoleClient, type ConsoleClient } from '../api/client';
import type { ApiConsoleError } from '../api/errors';
import type { LaunchDraft, LaunchIds, StandaloneResearchInput } from '../core/launch';
import { LAUNCH_STEPS, toCreateProjectInput, toLaunchJobSpec, toLaunchWorldSpec, toStandaloneResearchSpec, validateLaunchDraft, validateStandaloneResearch, isResearchFieldName } from '../core/launch';
import { InvalidLaunchDraftError, InvalidResearchSubmissionError } from '../core/errors';
import { absorbedEdit, blankLaunchDraft, editLaunchField, isLaunchFieldName, launchFormValuesOfDraft, type LaunchFieldName } from '../core/launch-form';
import { digestOf } from '../core/digest';
import type { InstantSource, TickScheduler } from '../core/clock';
import { systemNowMs } from '../core/clock';
import type { SectionId } from '../core/sections';
import { isSectionId } from '../core/sections';
import type { WorkspaceEvent, WorkspaceState } from '../core/workspace';
import { openWorkspace, reduceWorkspace, serializeWorkspaceExport, verifyWorkspaceExportReport, type ExportVerificationReport } from '../core/workspace';
import type { WorkspaceScope } from '../core/tenant';
import { isLaunchpadScope, LAUNCHPAD_PROJECT_ID } from '../core/tenant';
import type { ThemeName, ThemeStorage } from '../core/theme';
import { persistTheme } from '../core/theme';
import { isShellTarget } from '../core/nav';
import { capsuleRefOf, paletteIndex, paletteOverlay, projectRefOf, rankPalette, type PaletteEntry } from '../core/palette';
import {
  NOTICE_READ_STORAGE_KEY,
  noticeReadKey,
  parseStoredNoticeReads,
  scopedInbox,
  serializeNoticeReads,
  storedReadNoticeIds,
} from '../core/notices';
import type { NoticeRecord, StoredNoticeReads } from '../core/notices';
import {
  advanceOnboarding,
  initialOnboarding,
  isOnboarded,
  onboardingReopenAffordance,
  persistOnboarding,
  readStoredOnboarding,
  skipOnboarding,
  type OnboardingState,
} from '../core/onboarding';
import { noticeCopyOf } from '../render/flow';
import { capsuleFromKnowledge, capsuleFromOutcome, capsuleFromPostMortem, capsuleFromSubmission, capsulesFromJobs } from '../core/evidence';
import { availabilityOfJob, availabilityOfKnowledge, availabilityOfOutcome, availabilityOfPostMortem, availabilityOfSubmission, projectToView } from '../core/availability';
import { parseSheetRef, SHELL_INTERACTION_CSS, type SheetRef, type ShellView } from '../render/shell';
import { renderConsoleModel, homeFresh } from '../render/model';
import { mountVTree } from '../render/dom';

/** One workspace-state listener (the erasable-subset law: function types live in named aliases, never inline at annotation depth zero). */
export type WorkspaceListener = (next: WorkspaceState) => void;

/** The unsubscribe handle a listener registration returns (the erasable-subset law: same — named alias). */
export type Unsubscribe = () => void;

/** One degraded-read task (the erasable-subset law: function types live in named aliases, never inline at annotation depth zero). */
export type ReadTask = () => Promise<void>;

/** The boot bundle — every seam INJECTED (transport, instants, scheduler, mounts). */
export interface ConsoleBootOptions {
  /** The API base URL (the browser transport adapter's target). */
  readonly baseUrl: string;
  /** The credential token (the host minted it at the secure boundary). */
  readonly token: string;
  /** The workspace scope: the tenant, and either a real project id or the launchpad ('' until launched). */
  readonly scope: { readonly tenantId: string; readonly projectId: string };
  /** The INJECTED transport adapter (default: the browser fetch binding). */
  readonly transport?: ApiTransport;
  /** The fetch-like binding (tests); only used when no transport is injected. */
  readonly fetchLike?: FetchLike;
  /** The INJECTED instant source (default: the system seam — boot boundary only). */
  readonly instants?: InstantSource;
  /** The INJECTED scheduler (default: the browser timer seam). */
  readonly scheduler?: TickScheduler;
  /** The beat cadence in ms (job polling + playback ticks; default 1000). */
  readonly beatMs?: number;
  /** The initial theme (charter §1: light default; the entry reads the persisted choice). */
  readonly theme?: ThemeName;
  /** The theme persistence seam (the browser's localStorage in production). */
  readonly storage?: ThemeStorage;
  /** THE SCOPE PERSISTENCE SEAM (R6b, W-22): the browser's localStorage in production. When injected, the workspace's project id persists on every scope change and a stored scope that still exists in the tenant's project directory is RESTORED at boot (a stale/deleted id falls back to the env pin, exactly the pre-W-22 behavior). */
  readonly scopeStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  /** True when the console runs on a fake/demo adapter (the SIMULATED environment badge; §7 anti-deception). */
  readonly simulated?: boolean;
  /** The onboarding storage seam (localStorage `tradrl_onboarded`; returning users skip the wizard — §4.13). */
  readonly onboardingStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void };
  /**
   * THE NOTICE READ-STATE SEAM (D-6c, W-25C): the browser's localStorage
   * in production. When injected, the inbox's read-state persists per
   * tenant/project/notice (localStorage `tradrl_notice_read`) and a
   * reload rehydrates it — the unread badge + mark-read + mark-all-read
   * survive scope-switch + reload for the same browser. Plain UI state,
   * the same browser-trust-zone class as `tradrl_theme` /
   * `tradrl_onboarded` / `tradrl_scope_project` (spec/SECURITY.md's
   * trust zones place the browser first; UX-DESIGN.md sanctions
   * localStorage for this class of state): no credentials, no notice
   * content — only tenant/project/notice-id read marks, and the map is
   * keyed by the full triple so one tenant's read-state never applies
   * to another's notices (the tenant-isolation law, carried into the
   * persisted shape).
   */
  readonly noticeReadStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void };
}

/** The live console handle. */
export interface ConsoleHandle {
  /** The current state (pure snapshot). */
  state(): WorkspaceState;
  /** Dispatch one workspace event (the only write path). */
  dispatch(event: WorkspaceEvent): void;
  /** Subscribe to state changes (the render loop re-projects per notify). */
  onState(listener: (state: WorkspaceState) => void): () => void;
  /** Issue the full read cadence once (negotiation + every section's reads + job polling). */
  refresh(): Promise<void>;
  /** Submit the primary flow's launch (project create + kickoff job; progress renders via the watch/read cadence). */
  submitLaunch(draft: LaunchDraft): Promise<void>;
  /** The scheduler's beat (job polling + playback ticks; the app schedules it, tests can call it directly). */
  beat(): Promise<void>;
  /** Mount the console into a DOM root (the static shell's #tradrl-console). */
  mount(root: Element, document: MountDocument): void;
}

/** The interaction target of a delegated click (the minimal DOM surface the app layer needs). */
export interface ClickTarget {
  closest?(selector: string): { getAttribute(name: string): string | null; readonly tagName: string } | null;
  readonly tagName: string;
}

/**
 * A captured press affordance (D-6a, W-25C — the beat-render click
 * race): the element the pointer pressed at MOUSEDOWN (the resolved
 * `[data-action]` / `BUTTON[data-target]`) plus which delegated
 * vocabulary it resolved to. The click handler replays it only when
 * the composed click itself resolved to NO affordance and the beat
 * re-projection replaced the pressed element mid-press.
 */
export interface PendingPress {
  readonly kind: 'action' | 'target';
  readonly element: { getAttribute(name: string): string | null; readonly tagName: string };
  readonly key: string;
}

/** The delegated-click listener's minimal event shape. */
export interface DelegatedClickEvent {
  readonly target: ClickTarget | null;
}

/** A delegated key event (the drawer's Esc close + focus trap). */
export interface DelegatedKeyEvent {
  readonly key: string | null;
  readonly shiftKey?: boolean;
  readonly target: ClickTarget | null;
  preventDefault?(): void;
}

/** The interaction target of a delegated launch-field event (the input/change/focusout wiring): a closest()-capable target whose live value the form reads. */
export interface FieldEventTarget extends ClickTarget {
  /** The input's live value (the DOM property — the browser binding provides it; the test harness scripts it). */
  readonly value?: string;
  /** The attribute read (the delegated vocabulary lives in data- attributes). */
  getAttribute(name: string): string | null;
}

/** A delegated launch-field event (the J3 wiring): input/change/focusout on [data-launch-field] inputs. */
export interface DelegatedFieldEvent {
  readonly target: FieldEventTarget | null;
  /** The element the focus is moving TO (focusout only; null when the focus leaves to nothing — the browser binding provides it). */
  readonly relatedTarget?: unknown;
}

/**
 * MI-D7 (S5's ask — the in-UI chain verify): the selected export file's
 * read surface — the browser's File, structurally (a name plus the
 * async text read). Named with METHOD syntax per the erasable-subset
 * law (no inline function types at depth zero).
 */
export interface SelectedExportFile {
  /** The file's name (shown in the verification result card). */
  readonly name: string;
  /** The async text read (File.text() — the modern browser surface; absent when the selection cannot be read). */
  text?(): Promise<string>;
}

/** The minimal document surface the mount needs (DOM APIs only). */
export interface MountDocument {
  createElement(tag: string): Element;
  createTextNode(text: string): Text;
  addEventListener(type: string, listener: (event: DelegatedClickEvent & Partial<DelegatedKeyEvent> & Partial<DelegatedFieldEvent>) => void): void;
  /** Optional: the focusable-element query for the drawer's focus trap + the launch form's focus restoration (the browser binding provides it). */
  querySelectorAll?(selector: string): Iterable<{ focus(): void } & Partial<{ getAttribute(name: string): string | null; setSelectionRange(start: number, end: number): void }>>;
  /** Optional: the active element (the browser binding provides it). */
  readonly activeElement?: Element | null;
  /** Optional: the document head (the browser binding provides it) — the R8 interaction supplement's injection target (W-19). */
  readonly head?: Element | null;
  /** Optional: the document's root element (the browser binding provides it). D-6d (W-25C): the html element's `data-theme` is synced to the active theme at every paint — tokens.css keys the html background on it, so a stale attribute flashes the wrong color on overscroll. */
  readonly documentElement?: Element | null;
}

/** The launchpad project id — the workspace's pre-launch scope placeholder (core/tenant.ts owns the constant; re-exported for the existing imports). */
export { LAUNCHPAD_PROJECT_ID } from '../core/tenant';

/** The persisted-scope storage key (R6b, W-22 — localStorage `tradrl_scope_project` in production). */
export const SCOPE_STORAGE_KEY = 'tradrl_scope_project';

/** Read the persisted workspace project id (null when none is stored). */
export function readStoredScopeProject(storage: { getItem(key: string): string | null }): string | null {
  const stored = storage.getItem(SCOPE_STORAGE_KEY);
  return typeof stored === 'string' && stored.length > 0 ? stored : null;
}

/** Persist the workspace project id (the scope seam's write-through; an empty value clears it). */
export function persistScopeProject(storage: { setItem(key: string, value: string): void }, projectId: string): void {
  storage.setItem(SCOPE_STORAGE_KEY, projectId);
}

/** A head element's querySelector (the erasable-subset law: function types live in named aliases, never inline in casts). */
type HeadQuerySelectorOf = (selector: string) => Element | null;

/** Boot the console (every seam injected; DOM-free until mount). */
export function bootConsole(options: ConsoleBootOptions): ConsoleHandle {
  const transport = options.transport ?? createFetchTransport(options.baseUrl, options.fetchLike);
  const instants: InstantSource = options.instants ?? { nowMs: systemNowMs };
  const scheduler: TickScheduler | undefined = options.scheduler;
  const client: ConsoleClient = createConsoleClient({ transport, token: options.token });
  const scope: WorkspaceScope = { tenantId: options.scope.tenantId, projectId: options.scope.projectId.length > 0 ? options.scope.projectId : LAUNCHPAD_PROJECT_ID };
  const beatMs = options.beatMs ?? 1000;
  // D-15 (W-29 wave 2) — THE SESSION-SCOPE DISCIPLINE, part 1: the
  // persisted scope is captured ONCE, synchronously, at boot — BEFORE
  // any user interaction can happen and BEFORE the first read resolves.
  // The pre-fix restore read the storage LATE (inside the async projects
  // read), so a user-initiated scope change that landed between boot and
  // that resolution raced the rehydration; the captured value plus the
  // generation guard below make the restore exactly-once, boot-scoped,
  // and structurally unable to clobber a user's choice.
  const bootStoredScope = options.scopeStorage === undefined ? null : readStoredScopeProject(options.scopeStorage);
  // D-15 part 2 — THE SCOPE GENERATION: 0 until the first scope move
  // this session (a switcher choice, a palette jump, a launch adoption,
  // or the boot-restore's own adoption — every one rides dispatch). The
  // boot-restore applies ONLY at generation 0: once ANY scope move
  // happened, the restore is done forever (the user is driving; the
  // rehydration must never overwrite them — the switcher-rebind race
  // the Lead reproduced twice: "the first select change did not take",
  // the select snapping back to the boot scope).
  let scopeGeneration = 0;

  let state: WorkspaceState = openWorkspace(scope, instants.nowMs());
  const listeners: WorkspaceListener[] = [];
  // THE DURABLE READ-STATE (D-6c, W-25C): the persisted read-mark map,
  // read once at boot and held for the session — every mark-read /
  // mark-all-read updates it in place (the dispatch write-through
  // below) and the mount's rehydration pass applies it to every notice
  // the workspace folds, so the unread badge + mark-read flows survive
  // scope-switch + reload for the same browser.
  let storedNoticeReads: StoredNoticeReads = options.noticeReadStorage === undefined
    ? {}
    : parseStoredNoticeReads(options.noticeReadStorage.getItem(NOTICE_READ_STORAGE_KEY));

  function dispatch(event: WorkspaceEvent): void {
    const scopeBefore = state.scope.projectId;
    state = reduceWorkspace(state, event);
    // D-15 (W-29 wave 2): every scope move advances the generation — the
    // boot-restore's own adoption included (one-shot by construction).
    if (state.scope.projectId !== scopeBefore) scopeGeneration += 1;
    // THE SCOPE PERSISTENCE WRITE-THROUGH (R6b, W-22): the workspace
    // moved to another project (a launch adoption, a switcher choice,
    // a stored-scope restore) — persist the current project id so a
    // reload reopens THE USER'S world, not the env pin's (the 69-friction-row
    // finding: reload silently reset the scope to the demo project).
    // The launchpad placeholder never persists (there is no project yet).
    if (state.scope.projectId !== scopeBefore && state.scope.projectId !== LAUNCHPAD_PROJECT_ID && options.scopeStorage !== undefined) {
      persistScopeProject(options.scopeStorage, state.scope.projectId);
    }
    // THE READ-STATE WRITE-THROUGH (D-6c, W-25C): a mark-read /
    // mark-all-read persists the affected notices' read marks (keyed
    // tenant/project/notice — the map is scope-safe by construction).
    // D-13 (W-29): mark-all marks exactly the CURRENT scope's own notices
    // (the scoped inbox the user pressed the action on) — another desk's
    // notices keep their unread state in their own scope.
    // A storage failure degrades silently: the session keeps the reads
    // (the workspace state is already reduced), only the durability
    // across reload is lost — exactly the pre-seam behavior.
    if (options.noticeReadStorage !== undefined && (event.kind === 'notice-read' || event.kind === 'notices-read-all')) {
      const marks: readonly NoticeRecord[] = event.kind === 'notice-read'
        ? state.inbox.notices.filter((record) => record.noticeId === event.noticeId)
        : scopedInbox(state.inbox, state.scope).notices;
      const next: Record<string, 1> = { ...storedNoticeReads };
      let changed = false;
      for (const record of marks) {
        const key = noticeReadKey(record.tenantId, record.projectId, record.noticeId);
        if (next[key] !== 1) {
          next[key] = 1;
          changed = true;
        }
      }
      if (changed) {
        storedNoticeReads = next;
        try {
          options.noticeReadStorage.setItem(NOTICE_READ_STORAGE_KEY, serializeNoticeReads(next));
        } catch {
          // storage unavailable (private mode, quota): session-only read-state
        }
      }
    }
    for (const listener of [...listeners]) listener(state);
  }

  function onState(listener: WorkspaceListener): Unsubscribe {
    listeners.push(listener);
    listener(state);
    return () => {
      const index = listeners.indexOf(listener);
      if (index !== -1) listeners.splice(index, 1);
    };
  }

  /** One read, degraded gracefully: the typed error family + route land in the state, never a crash. */
  async function read(route: string, run: ReadTask): Promise<void> {
    try {
      await run();
    } catch (error) {
      const family = (error as ApiConsoleError)?.family ?? 'unavailable';
      dispatch({ kind: 'degraded-read', at: instants.nowMs(), route, family, message: (error as Error)?.message ?? String(error) });
      // THE J09 TRIAGE (the W-14c fix): a TRANSPORT-level failure (the
      // unavailable family — a blocked network, a refused connection, a
      // 503) while the workspace knows NOTHING (render/model.ts's own
      // Home freshness gate) is the API being UNREACHABLE, not a
      // degraded read: dispatch the offline state so the rose
      // UNREACHABLE connection block + Home's ErrorState ("The console
      // could not reach the API.", role=alert) with its Try again pill
      // render — the catalog's J9 surface, previously unreachable in a
      // real browser (a failed read mapped to 'degraded' unconditionally
      // and 'offline' was state-machine+test-only). A failure WITH the
      // last known world present stays DEGRADED (amber) — the proven
      // graceful path; a typed API error (the API ANSWERED) is never
      // offline — the family gate.
      if (family === 'unavailable' && homeFresh(state)) {
        dispatch({ kind: 'connection-changed', at: instants.nowMs(), status: 'offline' });
      }
    }
  }

  // THE SCOPE-CHANGE SEAM (R6a, the W-22 fix — the architectural
  // blocker's read half): the console read its world ONCE at boot, so
  // after a launch ADOPTED a new project (reduceWorkspace's
  // project-adopted arm resets every record + moves the scope) NO read
  // ever ran for the adopted scope — the launched org's compiled
  // snapshot (which the backing now serves, W-8's R4 pass) never
  // rendered, the Organization section stayed empty forever, and every
  // other section rendered the RESET (empty) world. The beat tracks the
  // last-fetched scope; when state.scope.projectId differs, it re-runs
  // the full read bundle for the adopted scope.
  let lastFetchedScope: string | null = null;

  /** Dispatch a read result ONLY while the workspace still carries the scope it was read for — a mid-flight adoption (a launch, a switch) supersedes the scope, so the stale read's dispatch is dropped (the typed assertProjectScope would refuse it; the beat's scope-change refetch re-reads everything for the adopted scope). */
  function dispatchIfCurrent(projectId: string, event: WorkspaceEvent): void {
    if (state.scope.projectId !== projectId) return;
    dispatch(event);
  }

  async function refresh(): Promise<void> {
    // The scope THIS bundle reads for, captured before the first await:
    // a mid-flight adoption (a launch, a switch) supersedes it, the
    // dispatchIfCurrent guards drop the stale dispatches, and the
    // finally marks THIS scope (not the current one) as fetched so the
    // beat still sees the difference and refetches for the adopted
    // scope (marking the CURRENT scope here would mark the adopted
    // scope as fetched without ever reading it — the R6a defect).
    const bundleScope = state.scope.projectId;
    try {
      await read('GET /v1/meta', async () => {
        await client.negotiateVersion();
        dispatch({ kind: 'connection-changed', at: instants.nowMs(), status: 'connected' });
      });
      // THE PROJECT DIRECTORY + THE STORED-SCOPE RESTORE (R6b/R6c,
      // W-22): the tenant's readable projects list once per bundle —
      // the scope switcher's data (R6c) — and the validation surface
      // for the persisted scope (R6b): when a stored project id exists
      // in the directory and differs from the booted scope, the
      // workspace ADOPTS it (the same reset+switch transition a launch
      // rides; this bundle's captured-scope reads then drop through
      // the dispatchIfCurrent guard and the beat refetches for the
      // adopted scope). A stored id that no longer exists is stale —
      // cleared and ignored, falling back to the env pin EXACTLY as
      // the pre-W-22 boot behaved (no stored scope -> no behavior
      // change at all).
      await read('GET /v1/projects', async () => {
        const records = await client.projects.listAll();
        dispatch({ kind: 'projects-listed', at: instants.nowMs(), records: [...records] });
        // THE STORED-SCOPE RESTORE (R6b/R6c, W-22) — D-15 (W-29 wave 2):
        // the persisted scope was captured ONCE at boot (bootStoredScope);
        // the restore applies ONLY while NO scope move has happened this
        // session (the generation guard — the Lead's twice-reproduced
        // switcher-rebind race: a user-initiated switch that lands during
        // or immediately after boot must NEVER be overwritten by the
        // async rehydration, and the rehydration itself must run exactly
        // once, never again on a later beat-triggered refresh). When a
        // stored project id exists in the directory and differs from the
        // booted scope, the workspace ADOPTS it (the same reset+switch
        // transition a launch rides; this bundle's captured-scope reads
        // then drop through the dispatchIfCurrent guard and the beat
        // refetches for the adopted scope). A stored id that no longer
        // exists is stale — cleared and ignored, falling back to the env
        // pin EXACTLY as the pre-W-22 boot behaved.
        const stored = bootStoredScope;
        if (stored === null) return;
        if (scopeGeneration !== 0) return; // a scope move already happened — the user (or the restore itself) is driving
        if (stored === state.scope.projectId) return;
        if (records.some((record) => record.id === stored)) {
          dispatch({ kind: 'project-adopted', at: instants.nowMs(), projectId: stored });
        } else if (options.scopeStorage !== undefined) {
          persistScopeProject(options.scopeStorage, ''); // stale (deleted upstream) — clear it and keep the env pin
        }
      });
      const projectId = bundleScope;
      if (projectId === LAUNCHPAD_PROJECT_ID) return;
      // THE BUNDLE'S OWN ORG-REF CAPTURE (D-7, W-27 — the org-status
      // pairing fix): the org-status read (below, at the bundle's end)
      // pairs the organization ref of THE BUNDLE'S OWN project record
      // with the bundle's own project id — same scope by construction.
      // The pre-W-27 code read `state.project` at the bundle's END, and a
      // mid-bundle scope move (the stored-scope restore adopting the
      // launched project, a launch adoption) could leave state.project
      // holding the ADOPTED project's record — with its compiled
      // organization ref — while this bundle's `projectId` was still the
      // pre-adoption scope: the read crossed scopes (`GET
      // /v1/organizations/<launched ref>/status?project=<demo id>` — the
      // Lead's observed 404, the boot-order race). CAPTURING the ref from
      // the FRESHLY READ record of THIS scope at read time keeps the pair
      // same-scope; a failed project read leaves the capture null and
      // skips the org read honestly (no record, no ref — the
      // dispatchIfCurrent guards still drop stale snapshots), and the
      // org-snapshot dedup keeps repeats idempotent.
      let bundleOrganizationRef: string | null = null;
      await read('GET /v1/projects/:id', async () => {
        const project = await client.projects.get(projectId);
        dispatchIfCurrent(projectId, { kind: 'project-loaded', at: instants.nowMs(), project });
        bundleOrganizationRef = project.lifecycle.organizationRef;
      });
      // THE GOAL READ (D-1, the W-23 fix — the boot seam the Lead
      // verified broken live): `goal-loaded` fired ONLY inside the
      // launch submit path (from the launch DRAFT), so after any page
      // reload or project switch state.goal/state.constraintSet stayed
      // null — the Goal section lost its "Goal statement" card and the
      // Risk section its "Constraint set" card (the R5 numeric-bounds
      // render included) for every session that didn't just launch.
      // The read rides the bundle's own cadence, so it runs at boot
      // here AND on the beat's scope-change refetch for every adopted
      // scope (a launch adoption, a switcher choice, a stored-scope
      // restore — the same refresh()). Unlike its siblings it degrades
      // SILENTLY: the route is HOST-OWNED and demo-backing-only (it
      // serves the demo project's seeded records and answers a typed
      // 404 everywhere else — every launched project included), so on
      // ANY failure (a typed 404 included) NOTHING dispatches: no
      // goal-loaded, no degraded-read note, no offline flip — the
      // state stays exactly as today, the honest pre-fix absence
      // (never a fabricated goal, never a degradation note for a route
      // the host never promised this scope).
      try {
        const bundle = await client.projects.goal(projectId);
        // D-8 (W-28): the bundle's ADDITIVE `world` (the scope's persisted
        // launch world — the backing captured it from the kickoff job's
        // spec into the goal-set record) rides the SAME event, so the
        // Market World section renders the project's OWN world after a
        // reload, a scope switch or a cold start; an absent world (the
        // demo scope, a pre-W-28 launch) clears any prior one — the
        // teaching empty state stays CORRECT for exactly those cases.
        dispatchIfCurrent(projectId, {
          kind: 'goal-loaded',
          at: instants.nowMs(),
          goal: bundle.goal,
          constraintSet: bundle.constraintSet,
          ...(bundle.world === undefined ? {} : { world: bundle.world }),
        });
      } catch {
        // the goal route is host-owned demo-backing-only — an absent
        // goal is the host's answer, not a failure of the console's
        // own reads; skip silently and keep the bundle moving.
      }
      await read('POST /v1/knowledge/query', async () => {
        const page = await client.knowledge.query({ project: projectId, at: instants.nowMs() });
        dispatchIfCurrent(projectId, { kind: 'knowledge-loaded', at: instants.nowMs(), records: [...page.items] });
      });
      await read('POST /v1/outcomes/query', async () => {
        const page = await client.outcomes.query({ project: projectId, at: instants.nowMs() });
        dispatchIfCurrent(projectId, { kind: 'outcomes-loaded', at: instants.nowMs(), records: [...page.items] });
      });
      await read('POST /v1/post-mortems/query', async () => {
        const page = await client.outcomes.postMortems({ project: projectId, at: instants.nowMs(), latestPerOutcome: true });
        dispatchIfCurrent(projectId, { kind: 'post-mortems-loaded', at: instants.nowMs(), records: [...page.items] });
      });
      // THE EXECUTION BLOTTER READ (R2, the W-22 fix — the seam the
      // Lead verified broken live): the backing serves the gateway's
      // submission records at GET /v1/execution/submissions?project=…
      // (the W-8 host route), but the console never READ them — the
      // Execution section rendered state.submissions, which only the
      // watch events populated (the console's own submissions), so the
      // seeded blotter stayed invisible forever. The read follows the
      // bundle's own pattern; each served row dispatches the existing
      // submission-recorded event, whose reducer arm merges deduped by
      // submissionId (the same dedup the watch path rides).
      await read('GET /v1/execution/submissions', async () => {
        const page = await client.execution.submissions(projectId);
        for (const submission of page.items) {
          dispatchIfCurrent(projectId, { kind: 'submission-recorded', at: instants.nowMs(), submission });
        }
      });
      // THE JOBS LIST READ (D-3, the W-25A fix — the seam the Lead
      // verified broken live): the backing serves the project's job
      // records at GET /v1/jobs?project=… (the W-25A host route — the
      // backing's API-owned job store, the SAME store the per-id GET
      // reads), but the console never READ them: state.jobs populated
      // ONLY from session-local events (job-submitted on the launch
      // kickoff, job-updated from pollJobs of jobs ALREADY in state),
      // so on boot/reload/scope-switch state.jobs reset to [] and
      // NEVER refilled — the Research section and the palette's JOB
      // group stayed empty forever ("JOB: not searchable in any
      // scope", the J8-spec goal unreachable). The read follows the
      // bundle's own pattern, one collection over the W-22 blotter
      // seam; each served row dispatches the EXISTING job-updated
      // event, whose reducer arm merges deduped by jobId (the launch
      // kickoff's own record rides the same merge — a re-refresh
      // never duplicates, and the read runs BEFORE pollJobs so the
      // served non-terminal jobs join the poll cadence immediately).
      await read('GET /v1/jobs', async () => {
        const page = await client.jobs.list(projectId);
        for (const job of page.items) {
          dispatchIfCurrent(projectId, { kind: 'job-updated', at: instants.nowMs(), job });
        }
      });
      // THE ORG-STATUS READ (D-7, W-27): at the bundle's end — its
      // pre-W-27 position (the org-snapshot notice folds AFTER the
      // outcomes read's, so the boot toast surfaces the shadow
      // degradation notice — the J06/D6 pin) — but paired with the
      // CAPTURED ref of THIS bundle's own freshly read project record
      // (never the mutable state.project — the race fix above).
      if (bundleOrganizationRef !== null) {
        const organizationRef = bundleOrganizationRef;
        await read('GET /v1/organizations/:ref/status', async () => {
          const snapshot = await client.organizations.status(organizationRef, projectId);
          dispatchIfCurrent(projectId, { kind: 'org-snapshot', at: instants.nowMs(), snapshot });
        });
      }
      await pollJobs();
    } finally {
      lastFetchedScope = bundleScope;
    }
  }

  async function pollJobs(): Promise<void> {
    for (const job of state.jobs) {
      if (job.status === 'complete' || job.status === 'failed') continue;
      await read('GET /v1/jobs/:id', async () => {
        const next = await client.jobs.get(job.jobId);
        dispatch({ kind: 'job-updated', at: instants.nowMs(), job: next });
        if (state.launch.jobId === next.jobId) {
          if (next.status === 'complete') dispatch({ kind: 'launch-completed', at: instants.nowMs() });
          if (next.status === 'failed') dispatch({ kind: 'launch-failed', at: instants.nowMs(), message: `the kickoff job ${next.jobId} failed` });
        }
      });
    }
  }

  async function beat(): Promise<void> {
    // THE LIVE VIEW INSTANT FOLLOWS THE OBSERVED NOW (the W-17a fix —
    // the v0.1.0 release blocker). W-16's release acceptance measured
    // it live: the LIVE readout stayed pinned at the BOOT instant for
    // 4+ minutes while wall-clock advanced — the console never
    // re-observed the live anchor after boot (advanceAnchor only ran
    // on the user's Time Machine clicks), so every datum that became
    // available after boot (the just-created project, the kickoff job)
    // was post-view-time and the L4 projection's typed error killed
    // the primary flow at every launch ("Launch (failed)"; no
    // POST /v1/jobs/research ever fired; submitted -> running ->
    // complete never rendered). The beat is the scheduler boundary —
    // the one seam core/clock.ts sanctions for observing the system
    // instant — so each beat re-samples now from the injected source
    // and moves the anchor forward (timemachine.ts's own law: "the app
    // observes a fresh injected instant"). In LIVE mode the view IS
    // the anchor (§4.8 "Viewing the live world…"); a T-x offset rides
    // the fresh anchor ("x before now" stays true as now advances);
    // playback's ceiling rises with it (a tick still never passes the
    // anchor — the guard below). Monotonic by construction: a beat
    // whose observed instant is not past the current anchor dispatches
    // nothing (the anchor never regresses).
    const observed = instants.nowMs();
    if (observed > state.timeMachine.anchorAt) {
      dispatch({ kind: 'anchor-advanced', at: observed });
    }
    // §4.8 controlled playback: the beat advances armed playback ONE
    // controlled step — but never past the anchor, and NEVER while
    // PAUSED (R10, W-25C: the freeze is the pure machine's own law —
    // tickPlayback no-ops on a paused state — and the beat also skips
    // the dispatch so a paused session's history chain carries no
    // no-op tick entries). A tick beyond the anchor is the pure
    // machine's typed input error (the view instant may never point
    // after "now"); the app layer guards the scheduled path so the
    // beat loop simply STOPS at the anchor instead of spraying
    // unhandled rejections every beat (the browser would console-error
    // forever once playback catches up).
    const timeMachine = state.timeMachine;
    if (timeMachine.mode === 'playback' && timeMachine.playback !== null && !timeMachine.playback.paused) {
      const nextViewAt = timeMachine.playback.fromAt + (timeMachine.playback.ticks + 1) * timeMachine.playback.stepMs;
      if (nextViewAt <= timeMachine.anchorAt) {
        dispatch({ kind: 'playback-tick', at: instants.nowMs() });
      }
    }
    // THE SCOPE-CHANGE REFETCH (R6a, the W-22 fix): the workspace's
    // scope moved since the last completed read bundle — a launch
    // adopted a project (project-adopted resets every record + moves
    // the scope), or a switch did — so the beat re-runs the FULL bundle
    // for the adopted scope: project, knowledge, outcomes, post-mortems,
    // the org-status read and job polling. Before this, the launched
    // project's world (its compiled org snapshot included — the backing
    // compiles it on its own clock, W-8's R4 pass) NEVER rendered
    // without a page reload: the console kept the boot scope's world
    // forever. The bundle degrades gracefully per-read like every other
    // cadence (the read wrapper); the finally-marked lastFetchedScope
    // keeps this from re-firing while the scope holds.
    const scopeNow = state.scope.projectId;
    if (scopeNow !== LAUNCHPAD_PROJECT_ID && scopeNow !== lastFetchedScope) {
      // The full bundle ends with its own job polling, and this beat's
      // poll ran INSIDE it — return here so a scope-change beat polls
      // exactly once (the poll cadence's per-beat contract is unchanged).
      await refresh();
      return;
    } else if (scopeNow !== LAUNCHPAD_PROJECT_ID && state.project !== null && state.project.lifecycle.organizationRef === null) {
      // THE ORG-COMPILE POLL (R6a's second half): the backing binds the
      // organization ref on its OWN clock (the demo compile pass runs on
      // a later request's tick, AFTER the adoption-time project read saw
      // organizationRef null), so the one refetch above can still miss
      // the compiled snapshot. While the CURRENT project record carries
      // no organization ref, each beat re-observes the project; the
      // moment the ref flips, the org-status read runs and the
      // Organization section renders the compiled snapshot — still
      // without any reload. Self-terminating: the moment the ref
      // exists, this branch stops (the org-snapshot dedup keeps repeats
      // idempotent). D-7 (W-27): the org-status read pairs the ref with
      // the RE-OBSERVED record of THIS scope — never the mutable
      // `state.project` (a mid-beat scope move could leave state.project
      // holding the newly adopted scope's record while `scopeNow` is
      // still this branch's scope — the same crossed-scope read as the
      // bundle's end, fixed the same way).
      await read('GET /v1/projects/:id', async () => {
        const project = await client.projects.get(scopeNow);
        dispatchIfCurrent(scopeNow, { kind: 'project-loaded', at: instants.nowMs(), project });
        const organizationRef = project.lifecycle.organizationRef;
        if (organizationRef !== null) {
          await read('GET /v1/organizations/:ref/status', async () => {
            const snapshot = await client.organizations.status(organizationRef, scopeNow);
            dispatchIfCurrent(scopeNow, { kind: 'org-snapshot', at: instants.nowMs(), snapshot });
          });
        }
      });
    }
    await pollJobs();
  }

  async function submitLaunch(draft: LaunchDraft): Promise<void> {
    // THE VALIDATION GATE (typed, before any API call): an invalid
    // draft surfaces as the launch error card — never an unhandled
    // rejection, never a wrong submission. (The review step's gate
    // keeps the confirm away from invalid drafts; this is the defense
    // in depth on the submit path itself.)
    try {
      validateLaunchDraft(draft);
    } catch (error) {
      if (error instanceof InvalidLaunchDraftError) {
        dispatch({ kind: 'launch-failed', at: instants.nowMs(), message: error.message });
        return;
      }
      throw error;
    }
    const at = instants.nowMs();
    const ids: LaunchIds = {
      projectId: `prj-${digestOf({ tenant: scope.tenantId, draft, at }).slice(0, 12)}`,
      goalId: `goal-${digestOf({ kind: 'goal', draft, at }).slice(0, 12)}`,
      constraintSetId: `cs-${digestOf({ kind: 'constraints', draft, at }).slice(0, 12)}`,
    };
    try {
      const project = await client.projects.create(toCreateProjectInput(draft, ids, scope.tenantId, at));
      // THE LAUNCH SEAM (the W-17a fix's second half): the created
      // record's availability is the boundary's stamp of the SUBMITTED
      // `at` (the deployed backing stamps createdAt/updatedAt from the
      // request's at — services/api's own law), which is strictly after
      // the boot instant and can be up to a beat ahead of the last
      // anchor re-sample. The record has ARRIVED — re-observe now from
      // the same injected source that stamped the submit, so the view
      // instant is at the record's availability by construction and
      // the adoption + render below paint the just-created project
      // immediately (no L4 trip at the Goal section's render gate, no
      // dependence on the beat cadence's timing).
      const arrived = instants.nowMs();
      if (arrived > state.timeMachine.anchorAt) {
        dispatch({ kind: 'anchor-advanced', at: arrived });
      }
      dispatch({ kind: 'project-adopted', at: instants.nowMs(), projectId: project.id });
      dispatch({ kind: 'project-loaded', at: instants.nowMs(), project });
      const goal = toCreateProjectInput(draft, ids, scope.tenantId, at).goal;
      // D-8 (W-28): the in-session bridge carries the draft's OWN world —
      // the just-launched project's world renders immediately (the beat's
      // scope-change refetch then re-reads the PERSISTED world from the
      // goal route; the two agree by construction — same draft, same
      // derivation the kickoff job's spec carried to the backing).
      dispatch({ kind: 'goal-loaded', at: instants.nowMs(), goal, constraintSet: toCreateProjectInput(draft, ids, scope.tenantId, at).constraintSet, world: toLaunchWorldSpec(draft) });
      const job = await client.jobs.submitResearch({ projectId: project.id, spec: toLaunchJobSpec(draft) });
      dispatch({ kind: 'launch-submitted', at: instants.nowMs(), projectId: project.id, jobId: job.jobId });
      dispatch({ kind: 'job-updated', at: instants.nowMs(), job });
    } catch (error) {
      dispatch({ kind: 'launch-failed', at: instants.nowMs(), message: (error as Error)?.message ?? String(error) });
    }
  }

  function mount(root: Element, document: MountDocument): void {
    // The T051 shell view — chrome state only (theme, the account
    // landing target, endpoint, simulated flag, busy/drawer states).
    // The workspace state machine stays the source of truth for every
    // section panel; the shell opens on Home (charter §3: the hero IS
    // the page) and falls back to the selected section the moment a
    // section is chosen.
    let view: ShellView = {
      theme: options.theme ?? 'light',
      accountView: 'home',
      endpoint: options.baseUrl,
      simulated: options.simulated ?? false,
      busy: false,
      drawerOpen: false,
      sheet: null,
      palette: null,
      onboarding: options.onboardingStorage === undefined ? initialOnboarding() : readStoredOnboarding(options.onboardingStorage),
      toast: null,
      confirm: null,
      touchedFields: [],
      launchEdits: {},
      researchSubmit: null,
      openCapsule: null,
      exportVerify: null,
    };
    let paletteResults: readonly PaletteEntry[] = [];
    // §4.10's once-per-notice toast guard: the id of the notice the
    // chrome last toasted (chrome state only — never workspace state).
    let lastToastedNoticeId: string | null = null;
    const host = root as Element & { setAttribute(name: string, value: string): void; classList?: { add(name: string): void } };
    if (host.classList !== undefined) host.classList.add('tradrl-host');
    // THE R8 INTERACTION SUPPLEMENT (W-19): inject the shell's nav
    // hit-area geometry laws once at mount (idempotent — a re-mount
    // finds the existing style and adds nothing). The rules live as
    // data in render/shell.ts (SHELL_INTERACTION_CSS); this layer owns
    // the DOM seam only. Degrades silently when the document carries
    // no head (the test harness) — the geometry supplement is a
    // browser affordance, never a boot dependency.
    const head = (document as MountDocument).head;
    if (head !== null && head !== undefined) {
      const existing = (head as Element & { querySelector?: HeadQuerySelectorOf }).querySelector?.('#tradrl-shell-interaction');
      if (existing === null || existing === undefined) {
        const style = document.createElement('style');
        style.setAttribute('id', 'tradrl-shell-interaction');
        (style as Element & { textContent?: string }).textContent = SHELL_INTERACTION_CSS;
        (head as Element & { appendChild(node: Node): Node }).appendChild(style);
      }
    }
    // THE LAUNCH FORM'S PENDING EDITS + THE POINTER GATE (the J3
    // wiring): field edits buffer in the view (the render merges them
    // via core/launch-form.ts, so any re-render keeps the user's
    // text) and COMMIT into the state machine on the next action —
    // never synchronously on focusout, because a re-render between
    // mousedown and mouseup replaces the clicked button and the
    // browser would drop the click (the silent-no-op class this
    // program keeps meeting). `pointerDown` marks a click in flight;
    // the click handler itself flushes before running any action.
    let pointerDown = false;
    /** Read the launch field name of an event target (null when the target is not a launch field). */
    const launchFieldOf = (target: unknown): { readonly field: LaunchFieldName; readonly value: string } | null => {
      const element = target as FieldEventTarget | null;
      if (element === null || element === undefined || typeof element.getAttribute !== 'function') return null;
      const name = element.getAttribute('data-launch-field');
      if (name === null || !isLaunchFieldName(name)) return null;
      const value = typeof element.value === 'string' ? element.value : '';
      return { field: name, value };
    };
    /**
     * D-12 (W-29 wave 2): read the standalone research form's field of an
     * event target (null when the target is not one of its inputs) — the
     * SAME delegated-vocabulary shape as launchFieldOf, on its own
     * data-research-field attribute so each form buffers into its own
     * edit map (a launch edit can never leak into the research form and
     * vice versa).
     */
    const researchFieldOf = (target: unknown): { readonly field: string; readonly value: string } | null => {
      const element = target as FieldEventTarget | null;
      if (element === null || element === undefined || typeof element.getAttribute !== 'function') return null;
      const name = element.getAttribute('data-research-field');
      if (name === null || !isResearchFieldName(name)) return null;
      const value = typeof element.value === 'string' ? element.value : '';
      return { field: name, value };
    };
    /** Read the palette query of an event target (null when the target is not the palette input; the live value rides the DOM property). */
    const paletteQueryOf = (target: unknown): string | null => {
      const element = target as FieldEventTarget | null;
      if (element === null || element === undefined || typeof element.getAttribute !== 'function') return null;
      if (element.getAttribute('data-palette-input') === null) return null;
      return typeof element.value === 'string' ? element.value : '';
    };
    /** Commit the buffered field edits into the state machine (one launch-draft-edited per flush; unabsorbed grammars stay buffered). */
    const flushLaunchEdits = (): void => {
      const entries = Object.entries(view.launchEdits);
      if (entries.length === 0) return;
      const remaining: Record<string, string> = {};
      const draft = state.launch.draft;
      if (draft === null) {
        view = { ...view, launchEdits: {} };
        return;
      }
      let next = draft;
      for (const [field, value] of entries) {
        if (!isLaunchFieldName(field)) continue;
        next = editLaunchField(next, field, value);
        if (!absorbedEdit(field, value)) remaining[field] = value; // an unparseable grammar stays pending (rendered + validated, never dropped)
      }
      if (JSON.stringify(launchFormValuesOfDraft(next)) !== JSON.stringify(launchFormValuesOfDraft(draft))) {
        dispatch({ kind: 'launch-draft-edited', at: instants.nowMs(), draft: next }); // renders via onState
      }
      if (Object.keys(remaining).length !== entries.length) view = { ...view, launchEdits: remaining };
    };
    /** Mark a launch field touched (§4.11 — inline validation renders after blur). */
    const touchLaunchField = (field: LaunchFieldName): void => {
      if (view.touchedFields.includes(field)) return;
      view = { ...view, touchedFields: [...view.touchedFields, field] };
    };
    /** The focus-restore key of an element the browser was moving focus TO (its delegated-vocabulary identity), null when it carries none. D-10 (W-29): the preference order puts the UNIQUE discriminators first (a row id, a notice id, a capsule id, a palette ref) so a restore never lands on a sibling that merely shares the action class. */
    const focusKeyOf = (element: unknown): { readonly attr: string; readonly value: string } | null => {
      const candidate = element as FieldEventTarget | null | undefined;
      if (candidate === null || candidate === undefined || typeof candidate.getAttribute !== 'function') return null;
      for (const attr of ['data-row', 'data-notice-read', 'data-capsule-open', 'data-palette-ref', 'data-launch-field', 'data-research-field', 'data-palette-input', 'data-action', 'data-target']) {
        const value = candidate.getAttribute(attr);
        if (value !== null) return { attr, value };
      }
      return null;
    };
    /** The Time Machine's scrubber event target (the §4.8 range input carrying data-action=tm-scrub), null when the target is not the scrubber. */
    const scrubTargetOf = (target: unknown): FieldEventTarget | null => {
      const element = target as FieldEventTarget | null;
      if (element === null || element === undefined || typeof element.getAttribute !== 'function') return null;
      return element.getAttribute('data-action') === 'tm-scrub' ? element : null;
    };
    /** THE PROJECT SWITCHER'S SELECT (R6c, W-22): the delegated change on [data-action=project-switch] — the committed choice's live value is the project id to adopt. */
    const switchTargetOf = (target: unknown): FieldEventTarget | null => {
      const element = target as FieldEventTarget | null;
      if (element === null || element === undefined || typeof element.getAttribute !== 'function') return null;
      return element.getAttribute('data-action') === 'project-switch' ? element : null;
    };
    /**
     * MI-D7 (S5's ask — the in-UI chain verify): THE EXPORT-VERIFY FILE
     * INPUT — the delegated change on [data-action=export-verify-file].
     * The user selected a downloaded export; the browser serves it as a
     * File-like (name + text()). Null when the target is not the input
     * or the selection is empty/not a readable file.
     */
    const verifyFileTargetOf = (target: unknown): { readonly element: FieldEventTarget; readonly file: SelectedExportFile } | null => {
      const element = target as FieldEventTarget | null;
      if (element === null || element === undefined || typeof element.getAttribute !== 'function') return null;
      if (element.getAttribute('data-action') !== 'export-verify-file') return null;
      const files = (element as FieldEventTarget & { readonly files?: readonly unknown[] }).files;
      const selected = Array.isArray(files) ? files[0] : null;
      if (selected === null || selected === undefined) return null;
      const candidate = selected as Partial<{ readonly name: unknown; readonly text: unknown }>;
      if (typeof candidate.name !== 'string') return null;
      return { element, file: candidate as SelectedExportFile };
    };
    // THE SCRUB BUFFER (the J5 wiring — the J3 pointer discipline): a
    // drag fires `input` per pointer move; those BUFFER here and never
    // dispatch, because a re-render under the pointer replaces the
    // range input mid-drag and the browser silently drops the drag.
    // The `change` event (the release / the keyboard commit) is the
    // one commit point.
    let scrubAt: number | null = null;
    /** Parse the scrubber's live value (NaN-safe: a garbage value commits nothing). */
    const scrubValueOf = (element: FieldEventTarget): number | null => {
      const parsed = Number.parseInt(typeof element.value === 'string' ? element.value : '', 10);
      return Number.isFinite(parsed) ? parsed : null;
    };
    /** Re-focus the re-projected node matching a focus key (the tree was rebuilt under a pending focus move — best effort). */
    const restoreFocusByKey = (key: { readonly attr: string; readonly value: string } | null): void => {
      if (key === null || document.querySelectorAll === undefined) return;
      for (const candidate of document.querySelectorAll(`[${key.attr}="${key.value}"]`)) {
        const element = candidate as { focus(): void };
        element.focus();
        return;
      }
    };
    /**
     * D-10 (W-29) — INTERACTIVE FOCUS SURVIVES THE BEAT RE-PROJECTION: the
     * keyboard user's focused affordance (a nav item, the bell, a notice
     * toggle, a capsule badge) is replaced by the ~1s beat re-projection,
     * which used to strand the focus on <body> — the persona finding
     * ("keyboard focus+Enter failed to activate" the Settings nav item:
     * Tab lands the focus, the beat replaces the tree, Enter hits a dead
     * document). The capture/restore mirrors the launch-field + palette
     * pair below: the focused element's delegated-vocabulary identity is
     * captured BEFORE the re-projection and the FIRST VISIBLE equivalent
     * node re-focuses after it (a display:none match — the hidden mobile
     * header's brand row — never steals the restore; elements without a
     * geometry probe, like the test harness's fakes, count as visible).
     */
    const restoreInteractiveFocusByKey = (key: { readonly attr: string; readonly value: string } | null): void => {
      if (key === null || document.querySelectorAll === undefined) return;
      let fallback: { focus(): void } | null = null;
      for (const candidate of document.querySelectorAll(`[${key.attr}="${key.value}"]`)) {
        const element = candidate as { focus(): void } & Partial<{ getClientRects(): readonly unknown[] }>;
        if (typeof element.getClientRects !== 'function' || element.getClientRects().length > 0) {
          element.focus();
          return;
        }
        if (fallback === null) fallback = element;
      }
      if (fallback !== null) fallback.focus(); // best effort — a hidden match no-ops in the browser
    };
    /** Focus the palette's input (the dialog's entry point — opening the palette and Clear search both leave typing ready; §4.14's keyboard-first journey). */
    const focusPaletteInput = (): void => {
      if (document.querySelectorAll === undefined) return;
      for (const candidate of document.querySelectorAll('[data-palette-input]')) {
        (candidate as { focus(): void }).focus();
        return;
      }
    };
    const render = (): void => {
      // The drawer state ALSO lands on the persistent host element so
      // the slide transition survives between renders (the projected
      // tree is rebuilt per state change; the host is not).
      host.setAttribute('data-drawer', view.drawerOpen ? 'open' : 'closed');
      // D-6d (W-25C) — THE HTML ELEMENT'S THEME AT PAINT: the active
      // theme is synced onto documentElement on EVERY paint. The
      // static shell's pre-paint script sets it once at load; before
      // this sync the in-app toggle updated the .tradrl-shell root but
      // left <html> at the boot value — stale after every change (the
      // overscroll background flashed the wrong color and tokens.css's
      // html[data-theme] rules never matched the live theme).
      const documentElementOfDocument = (document as MountDocument).documentElement;
      if (documentElementOfDocument !== null && documentElementOfDocument !== undefined) {
        documentElementOfDocument.setAttribute('data-theme', view.theme);
      }
      // FOCUS PRESERVATION ACROSS THE FULL RE-PROJECTION: the tree is
      // rebuilt per state change, which replaces a focused launch
      // input mid-typing (a poll beat, a notice toast) — capture the
      // focused field (+ caret) and restore it on the new node so
      // typing never breaks. The PALETTE INPUT carries the same
      // preservation (the W-14c query wiring re-renders on every
      // keystroke — without the restore, one typed letter would blur
      // the input and the next keystroke would land on a detached
      // node: the lost-second-field defect class, on the palette).
      let focusedField: string | null = null;
      let focusedSelection: { readonly start: number; readonly end: number } | null = null;
      let focusedPaletteInput = false;
      let focusedPaletteSelection: { readonly start: number; readonly end: number } | null = null;
      // D-12 (W-29 wave 2): the focused standalone-research form field — the
      // same capture/restore as the launch fields, on its own attribute
      // (typing into the research form survives the beat re-projection).
      let focusedResearchField: string | null = null;
      let focusedResearchSelection: { readonly start: number; readonly end: number } | null = null;
      // D-10 (W-29): the focused INTERACTIVE affordance's identity (nav
      // items, the bell, notice toggles, capsule badges — anything in the
      // delegated vocabulary), restored after the re-projection so a
      // keyboard user's Tab position survives the beat (focus+Enter works).
      let focusedInteractiveKey: { readonly attr: string; readonly value: string } | null = null;
      const active = document.activeElement as (FieldEventTarget & Partial<{ selectionStart: number | null; selectionEnd: number | null }>) | null | undefined;
      if (active !== null && active !== undefined && typeof active.getAttribute === 'function') {
        const name = active.getAttribute('data-launch-field');
        if (name !== null) {
          focusedField = name;
          if (typeof (active as { readonly selectionStart?: number | null }).selectionStart === 'number' && typeof (active as { readonly selectionEnd?: number | null }).selectionEnd === 'number') {
            focusedSelection = { start: (active as { readonly selectionStart: number }).selectionStart, end: (active as { readonly selectionEnd: number }).selectionEnd };
          }
        } else if (active.getAttribute('data-palette-input') !== null) {
          focusedPaletteInput = true;
          if (typeof (active as { readonly selectionStart?: number | null }).selectionStart === 'number' && typeof (active as { readonly selectionEnd?: number | null }).selectionEnd === 'number') {
            focusedPaletteSelection = { start: (active as { readonly selectionStart: number }).selectionStart, end: (active as { readonly selectionEnd: number }).selectionEnd };
          }
        } else if (active.getAttribute('data-research-field') !== null) {
          focusedResearchField = active.getAttribute('data-research-field');
          if (typeof (active as { readonly selectionStart?: number | null }).selectionStart === 'number' && typeof (active as { readonly selectionEnd?: number | null }).selectionEnd === 'number') {
            focusedResearchSelection = { start: (active as { readonly selectionStart: number }).selectionStart, end: (active as { readonly selectionEnd: number }).selectionEnd };
          }
        } else {
          focusedInteractiveKey = focusKeyOf(active);
        }
      }
      mountVTree(document, root, renderConsoleModel(state, instants.nowMs(), view, paletteResults));
      if (focusedField !== null && document.querySelectorAll !== undefined) {
        for (const candidate of document.querySelectorAll('[data-launch-field]')) {
          const element = candidate as { focus(): void; getAttribute(name: string): string | null; setSelectionRange?(start: number, end: number): void };
          if (element.getAttribute('data-launch-field') === focusedField) {
            element.focus();
            if (focusedSelection !== null && element.setSelectionRange !== undefined) element.setSelectionRange(focusedSelection.start, focusedSelection.end);
            break;
          }
        }
      }
      if (focusedPaletteInput && document.querySelectorAll !== undefined) {
        for (const candidate of document.querySelectorAll('[data-palette-input]')) {
          const element = candidate as { focus(): void; setSelectionRange?(start: number, end: number): void };
          element.focus();
          if (focusedPaletteSelection !== null && element.setSelectionRange !== undefined) element.setSelectionRange(focusedPaletteSelection.start, focusedPaletteSelection.end);
          break;
        }
      }
      // D-12 (W-29 wave 2): the research form's focused field survives the
      // re-projection (the same law as the launch fields — typing never
      // breaks across a beat).
      if (focusedResearchField !== null && document.querySelectorAll !== undefined) {
        for (const candidate of document.querySelectorAll('[data-research-field]')) {
          const element = candidate as { focus(): void; getAttribute(name: string): string | null; setSelectionRange?(start: number, end: number): void };
          if (element.getAttribute('data-research-field') === focusedResearchField) {
            element.focus();
            if (focusedResearchSelection !== null && element.setSelectionRange !== undefined) element.setSelectionRange(focusedResearchSelection.start, focusedResearchSelection.end);
            break;
          }
        }
      }
      // D-10 (W-29): the beat re-projection replaced the focused
      // interactive affordance — re-focus its equivalent node so the
      // keyboard journey (Tab into the nav, Enter to activate) survives
      // every poll beat.
      if (focusedInteractiveKey !== null) restoreInteractiveFocusByKey(focusedInteractiveKey);
    };

    /** The evidence capsules for the palette (the Evidence section's own fold — mirrors render/model.ts's capsule list, unprojected). */
    const capsuleFromOutcomeList = (workspace: WorkspaceState): readonly ReturnType<typeof capsuleFromOutcome>[] => [
      ...workspace.outcomes.map((outcome) => capsuleFromOutcome(workspace.scope, outcome)),
      ...workspace.postMortems.map((postMortem) => capsuleFromPostMortem(workspace.scope, postMortem)),
      ...workspace.knowledge.map((knowledge) => capsuleFromKnowledge(workspace.scope, knowledge)),
      ...workspace.submissions.map((submission) => capsuleFromSubmission(workspace.scope, submission)),
      // D-9 (W-28): the jobs lane, the same fold the Evidence section
      // renders — one capsule per COMPLETED job WITH a result, so the
      // palette's EVIDENCE group reaches the job-derived capsules too
      // (unprojected, mirroring the section's unprojected source list).
      ...capsulesFromJobs(workspace.scope, workspace.jobs),
    ];

    /** The evidence capsules for the palette (the Evidence section's own fold). */
    const capsulesForPalette = capsuleFromOutcomeList;

    /** The palette's live results for the current query (§4.14; D4's 100% coverage). */
    const refreshPalette = (): void => {
      if (view.palette === null) { paletteResults = []; return; }
      paletteResults = rankPalette(paletteIndex(state, capsulesForPalette), view.palette.query);
    };

    onState((next: WorkspaceState) => {
      render();
      // §4.10 D6: a NEW notice surfaces as a toast within the poll cycle; the
      // toast auto-dismisses after ~5s (the scheduler seam — never a wall-clock
      // read in a render path; the timer only clears chrome state). §4.10's own
      // words — toasts are for NEW notices — so the latest notice toasts ONCE
      // (the W-14b re-fire guard: the old layer re-toasted the latest notice on
      // EVERY state change, which once auto-dismissal worked became an
      // endless toast loop on every dispatch). D-13 (W-29): the pick is the
      // CURRENT SCOPE's latest notice — another desk's notice never toasts in
      // this desk's session (the inbox state keeps them, the surface does not).
      const scopedNow = scopedInbox(next.inbox, next.scope).notices;
      const latest = scopedNow.length === 0 ? null : scopedNow[scopedNow.length - 1] as { readonly kind: string; readonly noticeId: string; readonly title: string; readonly at: number };
      if (latest !== null && view.toast === null && next.connection !== 'connecting' && latest.noticeId !== lastToastedNoticeId) {
        const copy = noticeCopyOf(latest.kind as 'failed_evaluation');
        const shown = { kind: latest.kind, title: copy.title, sentence: copy.sentence };
        view = { ...view, toast: shown };
        lastToastedNoticeId = latest.noticeId;
        render();
        if (scheduler !== undefined) {
          scheduler.schedule(5000, () => {
            // The timer is TOKEN-CHECKED: a manual close (or a newer
            // toast replacing this one) already cleared it — the late
            // tick must not dismiss anything else.
            if (view.toast === shown) {
              view = { ...view, toast: null };
              render();
            }
          });
        }
      }
      // THE READ-STATE REHYDRATION (D-6c, W-25C): every notice the
      // workspace folds is checked against the persisted read marks —
      // a stored-read notice the session has not yet marked dispatches
      // its own notice-read (idempotent; converges in one extra pass).
      // This is what makes mark-read + mark-all-read + the unread
      // badge survive scope-switch + reload for the same browser: the
      // marks were persisted on the first session, and every later
      // session (this boot included) re-applies them as the notices
      // fold. Each re-applied mark rides the SAME write-through (already
      // stored — no write) and the SAME history chain as a fresh read.
      if (options.noticeReadStorage !== undefined) {
        const storedIds = storedReadNoticeIds(storedNoticeReads, next.inbox.notices);
        if (storedIds.length > 0) {
          for (const noticeId of storedIds) {
            if (!next.inbox.readNoticeIds.includes(noticeId)) {
              dispatch({ kind: 'notice-read', at: instants.nowMs(), noticeId });
            }
          }
        }
      }
    });

    /** Focus the drawer's first nav item (the trap's entry point). */
    const focusDrawerStart = (): void => {
      if (document.querySelectorAll === undefined) return;
      for (const focusable of document.querySelectorAll('.tradrl-shell .nav-item')) {
        focusable.focus();
        return;
      }
    };

    /** Focus the open sheet's close button (the sheet trap's entry point). */
    const focusSheetStart = (): void => {
      if (document.querySelectorAll === undefined) return;
      for (const focusable of document.querySelectorAll('.tradrl-shell .sheet [data-action="sheet-close"]')) {
        focusable.focus();
        return;
      }
    };

    /** A refresh with the busy state rendered on the Refresh action (§3). */
    const refreshWithShell = async (): Promise<void> => {
      view = { ...view, busy: true };
      render();
      try {
        await refresh();
      } finally {
        view = { ...view, busy: false };
        render();
      }
    };

    // THE LAUNCH FIELD WIRING (the J3 fix): delegated input/change/
    // focusout listeners on the document — the same delegation model
    // as clicks. Edits BUFFER in the view (launchEdits) and commit on
    // the next action (the flush) — never synchronously on focusout
    // while a click is in flight (the re-render between mousedown and
    // mouseup would drop the click), and never on a click that lands
    // on a non-action element (the re-render would steal the focus
    // the browser just moved into the next input).
    //
    // THE PENDING PRESS (D-6a, W-25C — the beat-render click race): the
    // 500ms-1s beat re-projection rebuilds the WHOLE tree; when it
    // lands between mousedown and mouseup, the browser composes the
    // click on a common ANCESTOR of the replaced pair, and
    // closest('[data-action]') from that ancestor resolves to NOTHING
    // — the user's click silently no-ops (the M-persona finding:
    // three clicks on "Next: world", nothing disabled, nothing fired;
    // the stepper tab was the only reliable path). The press intent is
    // captured HERE, at mousedown (the affordance under the pointer);
    // the click handler below replays it ONLY when the composed click
    // resolved to no affordance AND the pressed element left the
    // mounted tree (the beat replaced it mid-press). A normal click —
    // same element, still attached, or released over another
    // interactive element — resolves by itself and is never
    // double-dispatched; a press the user dragged away from (released
    // over nothing interactive, element never replaced) stays cancelled
    // exactly as the browser intended.
    let pendingPress: PendingPress | null = null;
    /** Whether an element still belongs to the mounted tree — a beat re-projection detaches the whole previous projection, so a mid-press replacement leaves the pressed element orphaned (its parent chain no longer reaches the mount root). */
    const attachedToRoot = (element: unknown): boolean => {
      let node: unknown = element;
      while (node !== null && node !== undefined) {
        if (node === root) return true;
        const parentNode = (node as { readonly parentNode?: unknown }).parentNode;
        node = parentNode !== null && parentNode !== undefined ? parentNode : (node as { readonly parent?: unknown }).parent;
      }
      return false;
    };
    document.addEventListener('mousedown', (event) => {
      pointerDown = true;
      // D-6a: capture the press intent — the nearest [data-action]
      // affordance, else the nearest BUTTON[data-target] (nav items,
      // the bell, palette items; the delegated click handler's own
      // precedence). Anything else (a press on inert chrome) presses
      // nothing and can replay nothing.
      const pressAction = event.target?.closest?.('[data-action]');
      const pressTarget = event.target?.closest?.('[data-target]');
      if (pressAction !== null && pressAction !== undefined) {
        pendingPress = { kind: 'action', element: pressAction, key: pressAction.getAttribute('data-action') ?? '' };
      } else if (pressTarget !== null && pressTarget !== undefined && pressTarget.tagName === 'BUTTON') {
        pendingPress = { kind: 'target', element: pressTarget, key: pressTarget.getAttribute('data-target') ?? '' };
      } else {
        pendingPress = null;
      }
    });
    document.addEventListener('input', (event) => {
      // §4.14 THE PALETTE QUERY (the W-14c fix — the J8 dead-input
      // defect): typing in [data-palette-input] feeds view.palette.query
      // and re-renders the ranked results through the PURE machinery
      // (core/palette.ts's fuzzyScore/rankPalette via refreshPalette —
      // never duplicated here); the selection resets to the top result
      // (the query changed the list; the old index is meaningless). The
      // render's focus preservation keeps the caret in the input across
      // the full re-projection.
      const query = paletteQueryOf(event.target);
      if (query !== null) {
        if (view.palette !== null && view.palette.query !== query) {
          view = { ...view, palette: { ...view.palette, query, selected: 0 } };
          refreshPalette();
          render();
        }
        return;
      }
      // THE SCRUBBER (the J5 wiring): a drag's input events BUFFER the
      // live position — never a dispatch, never a render (a re-projection
      // under the pointer replaces the range input and the browser
      // silently drops the drag; the J3 pointer discipline, same class).
      const scrubber = scrubTargetOf(event.target);
      if (scrubber !== null) {
        const parsed = scrubValueOf(scrubber);
        if (parsed !== null) scrubAt = parsed;
        return;
      }
      const entry = launchFieldOf(event.target);
      if (entry === null) {
        // D-12 (W-29 wave 2): THE STANDALONE RESEARCH FORM'S EDIT BUFFER —
        // the same J3 pattern as the launch edits: buffer ONLY, never a
        // dispatch, never a render (the buffer IS the live form — the
        // render merges it, so a beat re-projection never reverts the
        // user's text; the submit commits it through the frozen route).
        const researchEntry = researchFieldOf(event.target);
        if (researchEntry !== null && view.researchSubmit !== null) {
          view = { ...view, researchSubmit: { ...view.researchSubmit, edits: { ...view.researchSubmit.edits, [researchEntry.field]: researchEntry.value } } };
        }
        return;
      }
      view = { ...view, launchEdits: { ...view.launchEdits, [entry.field]: entry.value } }; // NO render — the buffer IS the live form (merged at render time)
    });
    /**
     * MI-D7 (S5's ask) — THE IN-UI CHAIN VERIFY, the async half: read the
     * selected export file, verify it with the SAME documented rules the
     * file carries (core's verifyWorkspaceExportReport — one
     * implementation, no drift), and render the counted report in the
     * Settings Data export row. Every failure is an honest report, never
     * a throw at the user: a non-JSON file, an unreadable file, a broken
     * chain — each names itself in the card. The input's selection is
     * cleared afterwards so re-selecting the SAME file re-fires the
     * change (the browser otherwise swallows it as a no-op).
     */
    const verifySelectedExport = async (element: FieldEventTarget, file: SelectedExportFile): Promise<void> => {
      const refusedReport = (reason: string): ExportVerificationReport => {
        return { ok: false, reason, format: null, formatVersion: null, entryCount: 0, digestsOk: 0, linksOk: 0, headMatch: null };
      };
      let report: ExportVerificationReport;
      if (typeof file.text !== 'function') {
        report = refusedReport('the file could not be read (this browser cannot read the selected file)');
      } else {
        try {
          const bytes = await file.text();
          try {
            report = verifyWorkspaceExportReport(JSON.parse(bytes));
          } catch (error) {
            report = refusedReport(`the file is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
          }
        } catch (error) {
          report = refusedReport(`the file could not be read (${error instanceof Error ? error.message : String(error)})`);
        }
      }
      const clearable = element as FieldEventTarget & { value?: unknown };
      if (typeof clearable.value === 'string') clearable.value = '';
      view = { ...view, exportVerify: { fileName: file.name, report } };
      render();
    };
    document.addEventListener('change', (event) => {
      // MI-D7 (S5's ask) — THE IN-UI CHAIN VERIFY: the verify input's
      // change — the user selected a downloaded export file in Settings.
      // Runs FIRST (the input is not a text field: none of the
      // launch-field branches below may claim it).
      const verifySelection = verifyFileTargetOf(event.target);
      if (verifySelection !== null) {
        void verifySelectedExport(verifySelection.element, verifySelection.file);
        return;
      }
      // THE PROJECT SWITCHER'S COMMIT (R6c, W-22): the select's change
      // event — the user's committed choice — adopts that project (the
      // same reset+switch transition a launch rides; the beat's
      // scope-change refetch then reads the adopted project's whole
      // world, and the dispatch hook persists the new scope). A
      // re-selection of the CURRENT project is a no-op.
      const switcher = switchTargetOf(event.target);
      if (switcher !== null) {
        const projectId = typeof switcher.value === 'string' ? switcher.value : '';
        if (projectId.length > 0 && projectId !== state.scope.projectId) {
          dispatch({ kind: 'project-adopted', at: instants.nowMs(), projectId }); // renders via onState
        }
        return;
      }
      // THE SCRUBBER'S COMMIT (the J5 wiring): the `change` event — the
      // drag's release, or a keyboard arrow's commit — moves the view
      // instant to the scrubbed position (an explicit instant: the
      // timestamp mode), clamped to the anchor (the view may never
      // point after it — the machine's typed law, guarded here so the
      // delegated listener can never throw at the user).
      const scrubber = scrubTargetOf(event.target);
      if (scrubber !== null) {
        const raw = scrubAt ?? scrubValueOf(scrubber);
        scrubAt = null;
        if (raw !== null) {
          const anchor = state.timeMachine.anchorAt;
          const floor = Math.min(state.openedAt, anchor);
          const clamped = Math.min(Math.max(raw, floor), anchor);
          dispatch({ kind: 'view-timestamp', at: instants.nowMs(), timestamp: clamped }); // renders via onState
        }
        return;
      }
      const entry = launchFieldOf(event.target);
      if (entry === null) {
        // D-12: the research form's select/keyboard commit buffers the
        // same way (the launch form's own change-arm law: buffer only —
        // the flush belongs to the submit click).
        const researchEntry = researchFieldOf(event.target);
        if (researchEntry !== null && view.researchSubmit !== null) {
          view = { ...view, researchSubmit: { ...view.researchSubmit, edits: { ...view.researchSubmit.edits, [researchEntry.field]: researchEntry.value } } };
        }
        return;
      }
      // Buffer ONLY — never a flush here: the browser fires `change`
      // on the field being LEFT (before focusout) whenever its value
      // changed, and an immediate flush would re-render UNDER the
      // pending focus move, stranding the destination input on a
      // detached node (the lost-second-field defect — the same class
      // the focusout guard below closes). The flush belongs to the
      // focusout (which sees where the focus is going) or to the next
      // action click; a select committed by keyboard commits at the
      // same places.
      view = { ...view, launchEdits: { ...view.launchEdits, [entry.field]: entry.value } };
    });
    document.addEventListener('focusout', (event) => {
      const entry = launchFieldOf(event.target);
      if (entry === null) return;
      view = { ...view, launchEdits: { ...view.launchEdits, [entry.field]: entry.value } };
      touchLaunchField(entry.field); // §4.11: inline validation renders after blur
      // A focus move WITHIN the form (Tab between fields, a
      // programmatic focus into the next input) must NOT re-render:
      // the full re-projection replaces the input mid-focus-move,
      // stranding the browser's pending focus on a detached node —
      // the next field would go dead and every edit typed into it
      // would land on a detached node, silently lost (the
      // lost-second-field defect, proven live in the browser proof:
      // objective/riskBudget/venues all dropped). The flush + the
      // §4.11 validation render happen when the focus LEAVES the
      // form (and on the next action — the click's own flush).
      const related = (event as Partial<{ readonly relatedTarget: unknown }>).relatedTarget;
      const relatedElement = related as FieldEventTarget | null | undefined;
      const relatedIsLaunchField = relatedElement !== null && relatedElement !== undefined && typeof relatedElement.getAttribute === 'function' && relatedElement.getAttribute('data-launch-field') !== null;
      if (!pointerDown && !relatedIsLaunchField) {
        const key = focusKeyOf(related);
        flushLaunchEdits(); // a blur out of the form commits + renders now; a click-blur defers to the click's own flush
        render();
        restoreFocusByKey(key); // the tree was rebuilt under the pending focus move
      }
    });

    // The delegated interaction layer: shell navigation (the fifteen
    // targets), the drawer, the theme controls, the refresh action,
    // the inbox read-all button and the Time Machine controls. Every
    // handler is a pure state/view update — the model does the rest.
    //
    // THE DELEGATION LAW (the W-10b fix): the navigation branch acts
    // ONLY on a [data-target] match that is an interactive BUTTON —
    // the shape of every nav affordance (nav items, brand rows, the
    // bell, palette items, empty-state actions). A non-button match
    // (an ancestor state marker, a stray container) falls through to
    // the action branches instead of swallowing the click: when T051
    // put data-target on the .tradrl-shell root, every click in the
    // console — Continue, Skip, theme, refresh, launch steps, export —
    // was intercepted here as a navigation and returned silently,
    // before any [data-action] branch could run (the J1 hard block).
    document.addEventListener('click', (event) => {
      pointerDown = false; // the click concludes the press
      let target = event.target?.closest?.('[data-target]');
      let navResolved = target !== null && target !== undefined && target.tagName === 'BUTTON' && target.getAttribute('data-target') !== null && isShellTarget(target.getAttribute('data-target') as string);
      let action = event.target?.closest?.('[data-action]');
      let actionKind = action === null || action === undefined ? null : action.getAttribute('data-action');
      const row = event.target?.closest?.('[data-row]');
      const rowId = row === null || row === undefined ? null : row.getAttribute('data-row');
      const sheetRef = rowId === null ? null : parseSheetRef(rowId);
      // THE BEAT-RACE REPLAY (D-6a, W-25C): the composed click resolved
      // to NOTHING interactive (no nav button, no action, no
      // sheet-opening row) — the beat-render replacement class — so if
      // a press is pending on an affordance the re-projection DETACHED
      // mid-press, the press intent substitutes for the dead click and
      // the handler's own branches execute it (action-keyed dispatch:
      // the SAME code path a live click takes, flush included — the
      // replayed action reads the full draft exactly like a landed
      // click). The pending press is consumed either way: a click that
      // resolves by itself (or a dead click with no stale press behind
      // it) never replays.
      const press = pendingPress;
      pendingPress = null;
      if (press !== null && !navResolved && actionKind === null && sheetRef === null && !attachedToRoot(press.element)) {
        if (press.kind === 'action') {
          action = press.element;
          actionKind = press.key;
        } else {
          target = press.element;
          navResolved = press.element.tagName === 'BUTTON' && isShellTarget(press.key);
        }
      }
      // THE FLUSH: a click that resolves to an interactive affordance
      // commits the buffered launch-field edits FIRST (the event's
      // target refs are already captured above — the re-render the
      // flush triggers cannot strand this click), so every action —
      // step navigation, review, arm, confirm — reads the FULL draft.
      if (navResolved || actionKind !== null) flushLaunchEdits();
      if (target !== null && target !== undefined && target.tagName === 'BUTTON') {
        const id = target.getAttribute('data-target');
        if (id !== null && isShellTarget(id)) {
          // §4.14: selecting a palette result (a click on a palette
          // item, the only [data-target] reachable while the modal
          // overlay is open) navigates AND closes the dialog — the
          // same behavior as Enter. THE J8 OPEN (D-3, W-25A): a JOB
          // entry's ref (`job:<jobId>`) IS the sheet grammar the
          // Research section's job rows carry — the selection ALSO
          // opens that job's detail sheet, so the palette alone
          // reaches the job's dialog (the J8-spec goal), the same
          // open path a row click takes. Non-entity entries carry no
          // parsable sheet ref and navigate exactly as before.
          let openedSheet: SheetRef | null = null;
          if (view.palette !== null) {
            const ref = target.getAttribute('data-palette-ref');
            openedSheet = ref === null ? null : parseSheetRef(ref);
            // D-16 (W-29 wave 2): EVERY ENTITY RESULT OPENS ITS ENTITY. An
            // EVIDENCE entry's capsule opens INLINE (view.openCapsule is the
            // §4.9 open key — the same one a capsule badge's click sets; a
            // JOB entry already opened its dialog, and the inconsistency
            // was S4's finding), and a cross-project JUMP entry adopts its
            // project (the same user-initiated project-adopted the
            // switcher rides — the D-15 generation guard counts it, so the
            // boot restore can never clobber a palette jump).
            const capsuleId = ref === null ? null : capsuleRefOf(ref);
            const jumpTo = ref === null ? null : projectRefOf(ref);
            view = {
              ...view,
              palette: null,
              ...(openedSheet === null ? {} : { sheet: openedSheet }),
              ...(capsuleId === null ? {} : { openCapsule: capsuleId }),
            };
            if (jumpTo !== null && jumpTo !== state.scope.projectId) {
              dispatch({ kind: 'project-adopted', at: instants.nowMs(), projectId: jumpTo }); // renders via onState (the palette is already closed)
            }
            refreshPalette();
          }
          if (id === 'home' || id === 'inbox' || id === 'settings') {
            view = { ...view, accountView: id, drawerOpen: false };
            render();
            if (openedSheet !== null) focusSheetStart();
            return;
          }
          // A workspace section: the state machine owns selection.
          view = { ...view, accountView: 'section', drawerOpen: false };
          if (id !== state.selectedSection) {
            dispatch({ kind: 'section-selected', at: instants.nowMs(), section: id as SectionId }); // renders via onState
          } else {
            render();
          }
          if (openedSheet !== null) focusSheetStart();
          return;
        }
      }
      if (row !== null && row !== undefined) {
        if (sheetRef !== null) {
          view = { ...view, sheet: sheetRef };
          render();
          focusSheetStart();
          return;
        }
        // A row that opens NO sheet (the inbox's notice rows, the
        // outcome accordion rows) FALLS THROUGH to the action branches:
        // a nested affordance — the §4.10 per-notice read toggle — wins
        // over the inert row. (The J6 wiring: previously ANY click
        // inside a data-row returned here, so a toggle button rendered
        // inside a notice row would have been silently swallowed — the
        // same dead-affordance class this program keeps meeting.)
      }
      if (action !== null && action !== undefined) {
        const kind = actionKind;
        if (kind === 'notices-read-all') dispatch({ kind: 'notices-read-all', at: instants.nowMs() });
        // §4.10 the per-notice read toggle (the J6 wiring): the
        // workspace's own notice-read event, dispatched by the row's
        // explicit affordance (read/unread state is the inbox's law).
        if (kind === 'notice-read') {
          const noticeId = action.getAttribute('data-notice-read');
          if (noticeId !== null) dispatch({ kind: 'notice-read', at: instants.nowMs(), noticeId }); // renders via onState
        }
        if (kind === 'view-live') dispatch({ kind: 'view-live', at: instants.nowMs() });
        if (kind === 'view-tminus') dispatch({ kind: 'view-tminus', at: instants.nowMs(), tMinusMs: 60_000 });
        // §4.8 + R10 (W-25C): the playback control's THREE faces — the
        // same button arms playback (from any other mode), PAUSES it
        // (while playing: the view instant FREEZES — no jump-back, no
        // advance), and RESUMES it (while paused: continue from the
        // frozen instant). Before R10 the pause face re-dispatched
        // playback-start, which re-armed at the opened instant with
        // zero ticks — the view jumped back to openedAt and the beat
        // kept ticking it forward (the J5 symptom).
        if (kind === 'playback-start' || kind === 'tm-mode-playback') {
          const timeMachine = state.timeMachine;
          if (timeMachine.mode === 'playback' && timeMachine.playback !== null && !timeMachine.playback.paused) {
            dispatch({ kind: 'playback-paused', at: instants.nowMs() }); // renders via onState
          } else if (timeMachine.mode === 'playback' && timeMachine.playback !== null && timeMachine.playback.paused) {
            dispatch({ kind: 'playback-resumed', at: instants.nowMs() }); // renders via onState
          } else {
            dispatch({ kind: 'playback-start', at: instants.nowMs(), fromAt: state.openedAt, stepMs: 500 });
          }
        }
        // §4.8: the Time Machine mode select + playback stepping (pure dispatches —
        // the state machine owns the transitions; the L4 projection is upstream).
        if (kind === 'tm-mode-live') dispatch({ kind: 'view-live', at: instants.nowMs() });
        if (kind === 'tm-mode-t-minus') dispatch({ kind: 'view-tminus', at: instants.nowMs(), tMinusMs: 60_000 });
        if (kind === 'tm-mode-timestamp') dispatch({ kind: 'view-timestamp', at: instants.nowMs(), timestamp: state.timeMachine.anchorAt - 60_000 });
        // MI-D9 — THE MANUAL STEPS. Pre-fix, BOTH controls were wired to
        // playback-tick / view-tminus(tMinusMs+500): Step while paused
        // no-op'd under the freeze law (a dead control), and Step back
        // while paused jumped the view FORWARD to (anchor - 500ms) — the
        // wall-clock end — flipping the mode playback -> t-minus with the
        // banner reading "Viewing a past instant" at 100% (the
        // 6/9-professional finding). Now: in PLAYBACK, Step back steps
        // the view BACK one controlled step and STAYS paused (a new pure
        // transition, its own append-only event), and Step while paused
        // is the user's own forward step (staying paused — the freeze
        // stops the beat's auto ticks, never the Step control). Outside
        // playback, Step back keeps its documented T-x meaning (the
        // offset grows by one step) and Step is a safe no-op (the control
        // belongs to playback — pre-fix it threw the typed "not armed"
        // error at the user).
        if (kind === 'playback-step') {
          const timeMachine = state.timeMachine;
          if (timeMachine.mode === 'playback' && timeMachine.playback !== null && timeMachine.playback.paused) {
            // the user's own step: guard the anchor exactly like the beat loop (never past "now")
            const nextViewAt = timeMachine.playback.fromAt + (timeMachine.playback.ticks + 1) * timeMachine.playback.stepMs;
            if (nextViewAt <= timeMachine.anchorAt) dispatch({ kind: 'playback-step-forward', at: instants.nowMs() });
          } else if (timeMachine.mode === 'playback' && timeMachine.playback !== null) {
            dispatch({ kind: 'playback-tick', at: instants.nowMs() }); // playing: the manual nudge stays a tick
          }
          // outside playback: no-op — the control belongs to playback
        }
        if (kind === 'playback-step-back') {
          const timeMachine = state.timeMachine;
          if (timeMachine.mode === 'playback' && timeMachine.playback !== null) {
            dispatch({ kind: 'playback-step-back', at: instants.nowMs() }); // one controlled step back, staying paused, never a mode flip
          } else {
            dispatch({ kind: 'view-tminus', at: instants.nowMs(), tMinusMs: timeMachine.tMinusMs + 500 }); // T-x: the offset grows (the tooltip's own words)
          }
        }
        if (kind === 'refresh') void refreshWithShell();
        // §4.14 the command palette
        if (kind === 'palette-open') {
          view = { ...view, palette: { query: '', selected: 0 } };
          refreshPalette();
          render();
          focusPaletteInput(); // the keyboard-first journey: Ctrl+K / the affordance -> type immediately
        }
        if (kind === 'palette-close') {
          view = { ...view, palette: null };
          render();
        }
        // §4.12/§4.14 the palette's empty-state action: Clear search
        // restores the palette's opened state (the full grouped list)
        // and hands the focus back to the input.
        if (kind === 'palette-clear') {
          if (view.palette !== null) {
            view = { ...view, palette: { ...view.palette, query: '', selected: 0 } };
            refreshPalette();
            render();
            focusPaletteInput();
          }
        }
        // §4.13 the onboarding wizard (completion persists; returning users never see it)
        if (kind === 'onboarding-next' || kind === 'onboarding-skip') {
          const current = view.onboarding ?? initialOnboarding();
          const next: OnboardingState = kind === 'onboarding-skip' ? skipOnboarding(current) : advanceOnboarding(current);
          view = { ...view, onboarding: next };
          if (isOnboarded(next) && options.onboardingStorage !== undefined) persistOnboarding(options.onboardingStorage);
          if (isOnboarded(next)) view = { ...view, accountView: 'home', onboarding: next }; // completion lands on Home
          render();
        }
        if (kind === 'onboarding-reopen') {
          view = { ...view, onboarding: initialOnboarding() };
          render();
        }
        // §5 D7 the data export — the R9 v2 chain export (W-21 seam:
        // the button now emits serializeWorkspaceExport — the real
        // sha-256 event chain, capsules, decisions and read state —
        // not the old v1 workspace dump; core owns the bytes).
        if (kind === 'export-workspace') {
          const anchor = document.createElement('a') as Element & { click?(): void };
          const blob = `data:application/json;charset=utf-8,${encodeURIComponent(serializeWorkspaceExport(state))}`;
          anchor.setAttribute('href', blob);
          anchor.setAttribute('download', `tradrl-workspace-${state.scope.projectId}.json`);
          if (typeof anchor.click === 'function') anchor.click();
        }
        // §4.10 the toast dismissal (manual close; the ~5s timer is scheduled on toast show)
        if (kind === 'toast-close') {
          view = { ...view, toast: null };
          render();
        }
        // §4.11 the primary flow: step navigation + the two-step confirm
        if (kind !== null && kind.startsWith('launch-step-')) {
          const step = kind.slice('launch-step-'.length);
          if ((LAUNCH_STEPS as readonly string[]).includes(step)) {
            dispatch({ kind: 'launch-step-changed', at: instants.nowMs(), step: step as typeof LAUNCH_STEPS[number] });
            view = { ...view, confirm: null };
          }
        }
        // THE J3 ENTRY (the missing launch-draft-started dispatcher):
        // the Goal section's empty-state CTA and the launch panel's
        // idle CTA both start the guided wizard from the seeded blank
        // draft (a re-start is refused while one is in progress — the
        // segments navigate instead; nothing wipes the user's work).
        if (kind === 'launch-start') {
          const inProgress = state.launch.draft !== null && (state.launch.phase === 'draft' || state.launch.phase === 'idle');
          if (!inProgress) {
            dispatch({ kind: 'launch-draft-started', at: instants.nowMs(), draft: blankLaunchDraft(instants.nowMs()) }); // renders via onState
            view = { ...view, confirm: null, touchedFields: [], launchEdits: {} };
          }
        }
        if (kind === 'launch-reset') {
          dispatch({ kind: 'launch-reset', at: instants.nowMs() }); // renders via onState
          view = { ...view, confirm: null, touchedFields: [], launchEdits: {}, openCapsule: view.openCapsule };
        }
        if (kind === 'confirm-arm-launch') {
          view = { ...view, confirm: 'launch' };
          render();
        }
        if (kind === 'confirm-cancel-launch') {
          view = { ...view, confirm: null };
          render();
        }
        if (kind === 'confirm-launch') {
          view = { ...view, confirm: null };
          if (state.launch.draft !== null) void submitLaunch(state.launch.draft);
        }
        // D-12 (W-29 wave 2): THE STANDALONE RESEARCH SUBMIT — the
        // Research section's own affordance (the launch flow was the
        // ONLY path before). The three actions follow the section's own
        // design language: open (the closed card's single primary
        // action), cancel (close + drop the buffered edits), and the
        // submit itself — the typed validation gate FIRST (an invalid
        // objective renders inline in the form's own card, never an
        // API call), then the frozen POST /v1/jobs/research route with
        // the CURRENT project's id (exactly what the launch's kickoff
        // job submits into — the same plumbing, the same opaque-spec
        // carrier, the same reducer merge by jobId). The returned
        // record dispatches job-updated, so the job lands in the
        // Research list immediately and the beat's poll cadence
        // advances it through the async pattern (submitted -> running
        // -> complete) like every other job.
        if (kind === 'research-submit-open') {
          if (view.researchSubmit === null) {
            view = { ...view, researchSubmit: { edits: {}, error: null } };
            render();
          }
          return;
        }
        if (kind === 'research-submit-cancel') {
          if (view.researchSubmit !== null) {
            view = { ...view, researchSubmit: null };
            render();
          }
          return;
        }
        if (kind === 'research-submit') {
          const form = view.researchSubmit;
          if (form === null) {
            render();
            return;
          }
          const input: StandaloneResearchInput = {
            objective: typeof form.edits.objective === 'string' ? form.edits.objective : '',
            notes: typeof form.edits.notes === 'string' ? form.edits.notes : '',
          };
          try {
            validateStandaloneResearch(input);
          } catch (error) {
            if (error instanceof InvalidResearchSubmissionError) {
              view = { ...view, researchSubmit: { ...form, error: error.message } };
              render();
              return;
            }
            throw error;
          }
          // The scope THIS submission targets, captured at the click: a
          // mid-flight desk switch supersedes the render but never the
          // submission's own target (the job belongs to the project the
          // user was looking at — the record carries it verbatim).
          const projectId = state.scope.projectId;
          if (isLaunchpadScope(projectId)) {
            // The affordance never renders on the launchpad; a stale
            // press landing here is refused honestly, never submitted
            // into a scope that does not exist.
            view = { ...view, researchSubmit: { ...form, error: 'There is no project yet — launch first; the wizard is the only path from the launchpad.' } };
            render();
            return;
          }
          view = { ...view, researchSubmit: { ...form, error: null } };
          render();
          void (async () => {
            try {
              const job = await client.jobs.submitResearch({ projectId, spec: toStandaloneResearchSpec(input) });
              // Only the still-current scope receives the record (the
              // reducer's cross-scope gate is the law; the other desk's
              // refetch reads the job from GET /v1/jobs?project=… when
              // the user returns to it — the W-25A seam).
              if (state.scope.projectId === projectId) {
                dispatch({ kind: 'job-updated', at: instants.nowMs(), job });
              }
              view = { ...view, researchSubmit: null }; // success closes the form
              render();
            } catch (error) {
              const message = (error as Error)?.message ?? String(error);
              // The form keeps the user's text (the edits buffer rides
              // the view, and the CURRENT form state — whatever the
              // user typed while the request was in flight — is the one
              // the error renders into).
              view = { ...view, researchSubmit: view.researchSubmit === null ? { edits: {}, error: message } : { ...view.researchSubmit, error: message } };
              render();
            }
          })();
          return;
        }
        // §4.9 capsule badges open their payload inline
        if (kind === 'capsule-open') {
          const capsuleId = action.getAttribute('data-capsule-open');
          if (capsuleId !== null) view = { ...view, openCapsule: view.openCapsule === capsuleId ? null : capsuleId };
          render();
        }
        if (kind === 'drawer-open') {
          view = { ...view, drawerOpen: true };
          render();
          focusDrawerStart();
        }
        if (kind === 'drawer-close') {
          view = { ...view, drawerOpen: false };
          render();
        }
        if (kind === 'sheet-close') {
          view = { ...view, sheet: null };
          render();
        }
        if (kind === 'theme-light' || kind === 'theme-dark') {
          const theme = kind === 'theme-dark' ? 'dark' : 'light';
          view = { ...view, theme };
          if (options.storage !== undefined) persistTheme(options.storage, theme);
          render();
        }
        return;
      }
      const section = event.target?.closest?.('[data-section]');
      if (section !== null && section !== undefined) {
        const id = section.getAttribute('data-section');
        if (id !== null && isSectionId(id) && id !== state.selectedSection) {
          view = { ...view, accountView: 'section', drawerOpen: false };
          dispatch({ kind: 'section-selected', at: instants.nowMs(), section: id }); // renders via onState
        }
      }
    });

    // The keyboard contract: Esc closes the palette, the sheet, then the drawer;
    // Ctrl/Cmd+K opens the palette and ↑ ↓ Enter navigate it (§4.14); Tab is
    // trapped inside whichever overlay is open (§4.5a / §2).
    document.addEventListener('keydown', (event) => {
      pointerDown = false; // a key press ends any pointer-press assumption
      pendingPress = null; // D-6a: and consumes any pending press — a keyboard activation is never a pointer replay
      const key = event.key;
      // §4.14 Ctrl/Cmd+K opens (or closes) the palette from anywhere.
      const ctrlKey = (event as { readonly ctrlKey?: boolean }).ctrlKey === true;
      const metaKey = (event as { readonly metaKey?: boolean }).metaKey === true;
      if ((ctrlKey || metaKey) && typeof key === 'string' && key.toLowerCase() === 'k') {
        if (event.preventDefault !== undefined) event.preventDefault();
        view = { ...view, palette: view.palette === null ? { query: '', selected: 0 } : null };
        refreshPalette();
        render();
        if (view.palette !== null) focusPaletteInput(); // the keyboard-first journey: Ctrl+K -> type immediately
        return;
      }
      if (key === 'Escape') {
        if (view.palette !== null) {
          view = { ...view, palette: null };
          render();
          return;
        }
        if (view.sheet !== null) {
          view = { ...view, sheet: null };
          render();
          return;
        }
        if (view.drawerOpen) {
          view = { ...view, drawerOpen: false };
          render();
          return;
        }
        return;
      }
      if (view.palette !== null && (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter')) {
        if (event.preventDefault !== undefined) event.preventDefault();
        const count = paletteResults.length;
        if (count === 0) return;
        const current = view.palette.selected;
        if (key === 'ArrowDown') {
          view = { ...view, palette: { ...view.palette, selected: (current + 1) % count } };
          render();
          return;
        }
        if (key === 'ArrowUp') {
          view = { ...view, palette: { ...view.palette, selected: (current - 1 + count) % count } };
          render();
          return;
        }
        // Enter: open the selected result (navigate to its target; entity refs open their own surface)
        const selected = paletteResults[current];
        if (selected !== undefined) {
          view = { ...view, palette: null };
          // THE J8 OPEN (D-3, W-25A): a JOB entry's ref (`job:<jobId>`)
          // IS the sheet grammar the Research section's job rows
          // carry — Enter navigates to Research AND opens that job's
          // detail sheet in the same action (the J8-spec goal: navigate
          // to a job via the palette alone), the same open path a row
          // click takes; the sheet focus moves to its close button
          // (the sheet trap's entry point). Non-entity entries carry
          // no parsable sheet ref and navigate exactly as before.
          const openedSheet = parseSheetRef(selected.ref);
          if (openedSheet !== null) view = { ...view, sheet: openedSheet };
          // D-16 (W-29 wave 2): an EVIDENCE entry's capsule opens INLINE
          // (the §4.9 open key — Enter behaves exactly like the JOB
          // entries' dialog open and the click path above), and a
          // cross-project JUMP entry switches the desk through the same
          // user-initiated adoption the switcher rides.
          const capsuleId = capsuleRefOf(selected.ref);
          if (capsuleId !== null) view = { ...view, openCapsule: capsuleId };
          const jumpTo = projectRefOf(selected.ref);
          if (jumpTo !== null && jumpTo !== state.scope.projectId) {
            dispatch({ kind: 'project-adopted', at: instants.nowMs(), projectId: jumpTo }); // renders via onState
          }
          if (selected.target !== null) {
            if (selected.target === 'home' || selected.target === 'inbox' || selected.target === 'settings') {
              view = { ...view, accountView: selected.target };
            } else {
              view = { ...view, accountView: 'section' };
              if (selected.target !== state.selectedSection) {
                dispatch({ kind: 'section-selected', at: instants.nowMs(), section: selected.target });
              }
            }
          }
          render();
          if (openedSheet !== null) focusSheetStart();
        }
        return;
      }
      if (key !== 'Tab' || document.querySelectorAll === undefined || event.preventDefault === undefined) return;
      const selector = view.sheet !== null
        ? '.tradrl-shell .sheet [data-action="sheet-close"]'
        : view.drawerOpen ? '.tradrl-shell .nav-item, .tradrl-shell .brand-row' : null;
      if (selector === null) return;
      const focusables = [...document.querySelectorAll(selector)];
      if (focusables.length === 0) return;
      const active = document.activeElement as unknown as { focus(): void } | null | undefined;
      let index = -1;
      for (let position = 0; position < focusables.length; position += 1) {
        if (focusables[position] === active) { index = position; break; }
      }
      const steppingBack = event.shiftKey === true;
      const next = steppingBack
        ? (index <= 0 ? focusables.length - 1 : index - 1)
        : (index === focusables.length - 1 ? 0 : index + 1);
      event.preventDefault();
      focusables[next].focus();
    });
  }

  // The boot read cadence: refresh now, then the scheduler beats.
  void refresh();
  if (scheduler !== undefined) {
    const scheduleNext = (): void => {
      scheduler.schedule(beatMs, () => {
        void beat().finally(scheduleNext);
      });
    };
    scheduleNext();
  }

  return {
    state: () => state,
    dispatch,
    onState,
    refresh,
    submitLaunch,
    beat,
    mount,
  };
}
