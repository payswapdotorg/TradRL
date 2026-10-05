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
import type { LaunchDraft, LaunchIds } from '../core/launch';
import { LAUNCH_STEPS, toCreateProjectInput, toLaunchJobSpec, validateLaunchDraft } from '../core/launch';
import { digestOf } from '../core/digest';
import type { InstantSource, TickScheduler } from '../core/clock';
import { systemNowMs } from '../core/clock';
import type { SectionId } from '../core/sections';
import { isSectionId } from '../core/sections';
import type { WorkspaceEvent, WorkspaceState } from '../core/workspace';
import { openWorkspace, reduceWorkspace, serializeWorkspace } from '../core/workspace';
import type { WorkspaceScope } from '../core/tenant';
import type { ThemeName, ThemeStorage } from '../core/theme';
import { persistTheme } from '../core/theme';
import { isShellTarget } from '../core/nav';
import { paletteIndex, paletteOverlay, rankPalette, type PaletteEntry } from '../core/palette';
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
import { capsuleFromKnowledge, capsuleFromOutcome, capsuleFromPostMortem, capsuleFromSubmission } from '../core/evidence';
import { availabilityOfJob, availabilityOfKnowledge, availabilityOfOutcome, availabilityOfPostMortem, availabilityOfSubmission, projectToView } from '../core/availability';
import { parseSheetRef, type ShellView } from '../render/shell';
import { renderConsoleModel } from '../render/model';
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
  /** True when the console runs on a fake/demo adapter (the SIMULATED environment badge; §7 anti-deception). */
  readonly simulated?: boolean;
  /** The onboarding storage seam (localStorage `tradrl_onboarded`; returning users skip the wizard — §4.13). */
  readonly onboardingStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void };
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

/** The minimal document surface the mount needs (DOM APIs only). */
export interface MountDocument {
  createElement(tag: string): Element;
  createTextNode(text: string): Text;
  addEventListener(type: string, listener: (event: DelegatedClickEvent & Partial<DelegatedKeyEvent>) => void): void;
  /** Optional: the focusable-element query for the drawer's focus trap (the browser binding provides it). */
  querySelectorAll?(selector: string): Iterable<{ focus(): void }>;
  /** Optional: the active element (the browser binding provides it). */
  readonly activeElement?: Element | null;
}

/** The launchpad project id — the workspace's pre-launch scope placeholder. */
export const LAUNCHPAD_PROJECT_ID = '(launchpad)';

/** Boot the console (every seam injected; DOM-free until mount). */
export function bootConsole(options: ConsoleBootOptions): ConsoleHandle {
  const transport = options.transport ?? createFetchTransport(options.baseUrl, options.fetchLike);
  const instants: InstantSource = options.instants ?? { nowMs: systemNowMs };
  const client: ConsoleClient = createConsoleClient({ transport, token: options.token });
  const scope: WorkspaceScope = { tenantId: options.scope.tenantId, projectId: options.scope.projectId.length > 0 ? options.scope.projectId : LAUNCHPAD_PROJECT_ID };
  const beatMs = options.beatMs ?? 1000;

  let state: WorkspaceState = openWorkspace(scope, instants.nowMs());
  const listeners: WorkspaceListener[] = [];

  function dispatch(event: WorkspaceEvent): void {
    state = reduceWorkspace(state, event);
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
    }
  }

  async function refresh(): Promise<void> {
    await read('GET /v1/meta', async () => {
      await client.negotiateVersion();
      dispatch({ kind: 'connection-changed', at: instants.nowMs(), status: 'connected' });
    });
    const projectId = state.scope.projectId;
    if (projectId === LAUNCHPAD_PROJECT_ID) return;
    await read('GET /v1/projects/:id', async () => {
      const project = await client.projects.get(projectId);
      dispatch({ kind: 'project-loaded', at: instants.nowMs(), project });
    });
    await read('POST /v1/knowledge/query', async () => {
      const page = await client.knowledge.query({ project: projectId, at: instants.nowMs() });
      dispatch({ kind: 'knowledge-loaded', at: instants.nowMs(), records: [...page.items] });
    });
    await read('POST /v1/outcomes/query', async () => {
      const page = await client.outcomes.query({ project: projectId, at: instants.nowMs() });
      dispatch({ kind: 'outcomes-loaded', at: instants.nowMs(), records: [...page.items] });
    });
    await read('POST /v1/post-mortems/query', async () => {
      const page = await client.outcomes.postMortems({ project: projectId, at: instants.nowMs(), latestPerOutcome: true });
      dispatch({ kind: 'post-mortems-loaded', at: instants.nowMs(), records: [...page.items] });
    });
    const organizationRef = state.project?.lifecycle.organizationRef ?? null;
    if (organizationRef !== null) {
      await read('GET /v1/organizations/:ref/status', async () => {
        const snapshot = await client.organizations.status(organizationRef, projectId);
        dispatch({ kind: 'org-snapshot', at: instants.nowMs(), snapshot });
      });
    }
    await pollJobs();
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
    if (state.timeMachine.mode === 'playback') {
      dispatch({ kind: 'playback-tick', at: instants.nowMs() });
    }
    await pollJobs();
  }

  async function submitLaunch(draft: LaunchDraft): Promise<void> {
    validateLaunchDraft(draft);
    dispatch({ kind: 'launch-draft-started', at: instants.nowMs(), draft });
    const at = instants.nowMs();
    const ids: LaunchIds = {
      projectId: `prj-${digestOf({ tenant: scope.tenantId, draft, at }).slice(0, 12)}`,
      goalId: `goal-${digestOf({ kind: 'goal', draft, at }).slice(0, 12)}`,
      constraintSetId: `cs-${digestOf({ kind: 'constraints', draft, at }).slice(0, 12)}`,
    };
    try {
      const project = await client.projects.create(toCreateProjectInput(draft, ids, scope.tenantId, at));
      dispatch({ kind: 'project-adopted', at: instants.nowMs(), projectId: project.id });
      dispatch({ kind: 'project-loaded', at: instants.nowMs(), project });
      const goal = toCreateProjectInput(draft, ids, scope.tenantId, at).goal;
      dispatch({ kind: 'goal-loaded', at: instants.nowMs(), goal, constraintSet: toCreateProjectInput(draft, ids, scope.tenantId, at).constraintSet });
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
      openCapsule: null,
    };
    let paletteResults: readonly PaletteEntry[] = [];
    const host = root as Element & { setAttribute(name: string, value: string): void; classList?: { add(name: string): void } };
    if (host.classList !== undefined) host.classList.add('tradrl-host');
    const render = (): void => {
      // The drawer state ALSO lands on the persistent host element so
      // the slide transition survives between renders (the projected
      // tree is rebuilt per state change; the host is not).
      host.setAttribute('data-drawer', view.drawerOpen ? 'open' : 'closed');
      mountVTree(document, root, renderConsoleModel(state, instants.nowMs(), view, paletteResults));
    };

    /** The evidence capsules for the palette (the Evidence section's own fold — mirrors render/model.ts's capsule list, unprojected). */
    const capsuleFromOutcomeList = (workspace: WorkspaceState): readonly ReturnType<typeof capsuleFromOutcome>[] => [
      ...workspace.outcomes.map((outcome) => capsuleFromOutcome(workspace.scope, outcome)),
      ...workspace.postMortems.map((postMortem) => capsuleFromPostMortem(workspace.scope, postMortem)),
      ...workspace.knowledge.map((knowledge) => capsuleFromKnowledge(workspace.scope, knowledge)),
      ...workspace.submissions.map((submission) => capsuleFromSubmission(workspace.scope, submission)),
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
      // read in a render path; the timer only clears chrome state).
      const latest = next.inbox.notices.length === 0 ? null : next.inbox.notices[next.inbox.notices.length - 1] as { readonly kind: string; readonly noticeId: string; readonly title: string; readonly at: number };
      if (latest !== null && view.toast === null && next.connection !== 'connecting') {
        const copy = noticeCopyOf(latest.kind as 'failed_evaluation');
        view = { ...view, toast: { kind: latest.kind, title: copy.title, sentence: copy.sentence } };
        render();
        if (scheduler !== undefined) {
          scheduler.schedule(5000, () => {
            view = { ...view, toast: null };
            render();
          });
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
      const target = event.target?.closest?.('[data-target]');
      if (target !== null && target !== undefined && target.tagName === 'BUTTON') {
        const id = target.getAttribute('data-target');
        if (id !== null && isShellTarget(id)) {
          if (id === 'home' || id === 'inbox' || id === 'settings') {
            view = { ...view, accountView: id, drawerOpen: false };
            render();
            return;
          }
          // A workspace section: the state machine owns selection.
          view = { ...view, accountView: 'section', drawerOpen: false };
          if (id !== state.selectedSection) {
            dispatch({ kind: 'section-selected', at: instants.nowMs(), section: id as SectionId }); // renders via onState
          } else {
            render();
          }
          return;
        }
      }
      const row = event.target?.closest?.('[data-row]');
      if (row !== null && row !== undefined) {
        const rowId = row.getAttribute('data-row');
        if (rowId !== null) {
          const sheet = parseSheetRef(rowId);
          if (sheet !== null) {
            view = { ...view, sheet };
            render();
            focusSheetStart();
          }
        }
        return;
      }
      const action = event.target?.closest?.('[data-action]');
      if (action !== null && action !== undefined) {
        const kind = action.getAttribute('data-action');
        if (kind === 'notices-read-all') dispatch({ kind: 'notices-read-all', at: instants.nowMs() });
        if (kind === 'view-live') dispatch({ kind: 'view-live', at: instants.nowMs() });
        if (kind === 'view-tminus') dispatch({ kind: 'view-tminus', at: instants.nowMs(), tMinusMs: 60_000 });
        if (kind === 'playback-start') dispatch({ kind: 'playback-start', at: instants.nowMs(), fromAt: state.openedAt, stepMs: 500 });
        // §4.8: the Time Machine mode select + playback stepping (pure dispatches —
        // the state machine owns the transitions; the L4 projection is upstream).
        if (kind === 'tm-mode-live') dispatch({ kind: 'view-live', at: instants.nowMs() });
        if (kind === 'tm-mode-t-minus') dispatch({ kind: 'view-tminus', at: instants.nowMs(), tMinusMs: 60_000 });
        if (kind === 'tm-mode-timestamp') dispatch({ kind: 'view-timestamp', at: instants.nowMs(), timestamp: state.timeMachine.anchorAt - 60_000 });
        if (kind === 'tm-mode-playback') dispatch({ kind: 'playback-start', at: instants.nowMs(), fromAt: state.openedAt, stepMs: 500 });
        if (kind === 'playback-step') dispatch({ kind: 'playback-tick', at: instants.nowMs() });
        if (kind === 'playback-step-back') dispatch({ kind: 'view-tminus', at: instants.nowMs(), tMinusMs: state.timeMachine.tMinusMs + 500 });
        if (kind === 'refresh') void refreshWithShell();
        // §4.14 the command palette
        if (kind === 'palette-open') {
          view = { ...view, palette: { query: '', selected: 0 } };
          refreshPalette();
          render();
        }
        if (kind === 'palette-close') {
          view = { ...view, palette: null };
          render();
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
        // §5 D7 the data export (a deterministic serialized record of the workspace state)
        if (kind === 'export-workspace') {
          const anchor = document.createElement('a') as Element & { click?(): void };
          const blob = `data:application/json;charset=utf-8,${encodeURIComponent(serializeWorkspace(state))}`;
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
      const key = event.key;
      // §4.14 Ctrl/Cmd+K opens (or closes) the palette from anywhere.
      const ctrlKey = (event as { readonly ctrlKey?: boolean }).ctrlKey === true;
      const metaKey = (event as { readonly metaKey?: boolean }).metaKey === true;
      if ((ctrlKey || metaKey) && typeof key === 'string' && key.toLowerCase() === 'k') {
        if (event.preventDefault !== undefined) event.preventDefault();
        view = { ...view, palette: view.palette === null ? { query: '', selected: 0 } : null };
        refreshPalette();
        render();
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
  const scheduler = options.scheduler;
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
