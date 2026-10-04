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
import { toCreateProjectInput, toLaunchJobSpec, validateLaunchDraft } from '../core/launch';
import { digestOf } from '../core/digest';
import type { InstantSource, TickScheduler } from '../core/clock';
import { systemNowMs } from '../core/clock';
import type { SectionId } from '../core/sections';
import { isSectionId } from '../core/sections';
import type { WorkspaceEvent, WorkspaceState } from '../core/workspace';
import { openWorkspace, reduceWorkspace } from '../core/workspace';
import type { WorkspaceScope } from '../core/tenant';
import { renderConsoleModel } from '../render/model';
import { mountVTree } from '../render/dom';

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
  closest?(selector: string): { getAttribute(name: string): string | null } | null;
  readonly tagName: string;
}

/** The delegated-click listener's minimal event shape. */
export interface DelegatedClickEvent {
  readonly target: ClickTarget | null;
}

/** The minimal document surface the mount needs (DOM APIs only). */
export interface MountDocument {
  createElement(tag: string): Element;
  createTextNode(text: string): Text;
  addEventListener(type: string, listener: (event: DelegatedClickEvent) => void): void;
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
  const listeners: ((next: WorkspaceState) => void)[] = [];

  function dispatch(event: WorkspaceEvent): void {
    state = reduceWorkspace(state, event);
    for (const listener of [...listeners]) listener(state);
  }

  function onState(listener: (next: WorkspaceState) => void): () => void {
    listeners.push(listener);
    listener(state);
    return () => {
      const index = listeners.indexOf(listener);
      if (index !== -1) listeners.splice(index, 1);
    };
  }

  /** One read, degraded gracefully: the typed error family + route land in the state, never a crash. */
  async function read(route: string, run: () => Promise<void>): Promise<void> {
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
    const render = (): void => {
      mountVTree(document, root, renderConsoleModel(state, instants.nowMs()));
    };
    onState(render);
    // The delegated interaction layer: section nav clicks, the inbox
    // read-all button, the Time Machine controls. Every handler is a
    // pure dispatch — the state machine does the rest.
    document.addEventListener('click', (event) => {
      const section = event.target?.closest?.('[data-section]');
      if (section !== null && section !== undefined) {
        const id = section.getAttribute('data-section');
        if (id !== null && isSectionId(id) && id !== state.selectedSection) {
          dispatch({ kind: 'section-selected', at: instants.nowMs(), section: id as SectionId });
          return;
        }
      }
      const action = event.target?.closest?.('[data-action]');
      if (action !== null && action !== undefined) {
        const kind = action.getAttribute('data-action');
        if (kind === 'notices-read-all') dispatch({ kind: 'notices-read-all', at: instants.nowMs() });
        if (kind === 'view-live') dispatch({ kind: 'view-live', at: instants.nowMs() });
        if (kind === 'view-tminus') dispatch({ kind: 'view-tminus', at: instants.nowMs(), tMinusMs: 60_000 });
        if (kind === 'playback-start') dispatch({ kind: 'playback-start', at: instants.nowMs(), fromAt: state.openedAt, stepMs: 500 });
      }
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
