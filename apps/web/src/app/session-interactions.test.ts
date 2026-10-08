// THE SESSION-ISOLATION INTERACTION PINS (FW-MI-A, defects MI-D1 + MI-D8).
//
// THE HOLE THIS FILE CLOSES (the wave-1 evidence, 9/9 professionals —
// the #1 trust blocker): the deployed console is anonymous (one shared
// credential), and every browser session on the origin saw EVERY
// session's launched projects — Northline's M1 saw "a rival fund's
// desks" in his switcher + palette; Alder's S5 REJECTED over her audit
// export embedding other firms' desks ("other desks' names inside my
// audit export is precisely the liability I refuse"); Meridian's L3
// switched into a colleague's desk by id. And L4's MI-D8: "palette+
// switcher project list capped at 10 — after reload MY two desks became
// UNREACHABLE".
//
// WHAT THIS FILE PINS — the CLIENT half of the fix, end to end through
// the REAL entry (bootFromShell: the localStorage seam resolves the
// stable session id, the client carries it as the
// `x-tradrl-console-session` header on every request):
//   - the session header rides EVERY request, and the id is STABLE
//     across boots (the same browser = the same session);
//   - the console renders EXACTLY the session view the host serves
//     (the switcher, the palette's PROJECT group and the EXPORT's
//     projectDirectory — S5's ask: no foreign desks in the audit file);
//   - MI-D8: a 26-project directory renders ALL 26 switcher options
//     (no silent cap), the switcher FILTER narrows them by fuzzy name
//     + id with a live count line, the palette finds desks BY NAME and
//     BY ID FRAGMENT (L4's exact searches: 'EQ Vol', 'Futures Roll',
//     the id fragment), and a committed switch reaches the chosen desk;
//   - the stored-scope restore adopts ONLY ids the session view serves
//     (a stale foreign scope is cleared, never adopted).
//
// The SERVER half (the host's session filtering + the durable ownership
// stamp) is pinned in deploy/vercel/session-scope.test.ts +
// deploy/vercel/durable.test.ts — this file pins that the client FAITHFULLY
// renders the session view the host serves, never re-widening it.

import { describe, expect, it, vi } from 'vitest';
import type { ApiTransport } from '../api/transport';
import type { ConsoleHandle } from './console';
import { bootFromShell, CONSOLE_ROOT_ID } from '../index';
import { verifyWorkspaceExport } from '../core/workspace';
import type * as ConsoleModule from './console';

const T0 = 1_700_000_000_000;
const DEMO_PROJECT_ID = 'prj-demo-console';
const TENANT = 'tenant-demo';

// ---------------------------------------------------------------------------
// THE FAKE DOCUMENT (the minimal bootFromShell + mount surface — the same
// shape as boot-seam.test.ts's rig).
// ---------------------------------------------------------------------------

/** A text node. */
class FakeText {
  readonly nodeType = 3 as const;
  parent: FakeElement | null = null;
  constructor(readonly text: string) {}
}

/** The fake element: attributes, a child list, a parent chain, closest(). */
class FakeElement {
  readonly nodeType = 1 as const;
  readonly tagName: string;
  readonly childNodes: (FakeElement | FakeText)[] = [];
  parent: FakeElement | null = null;
  readonly attributes: Record<string, string> = {};
  focusCount = 0;
  clickCount = 0;
  value = '';

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = String(value);
  }

  getAttribute(name: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }

  appendChild<T extends FakeElement | FakeText>(node: T): T {
    node.parent = this;
    this.childNodes.push(node);
    return node;
  }

  removeChild<T extends FakeElement | FakeText>(node: T): T {
    const index = this.childNodes.indexOf(node);
    if (index !== -1) this.childNodes.splice(index, 1);
    node.parent = null;
    return node;
  }

  get firstChild(): FakeElement | FakeText | null {
    return this.childNodes[0] ?? null;
  }

  get children(): FakeElement[] {
    return this.childNodes.filter((node): node is FakeElement => node instanceof FakeElement);
  }

  get classList(): { add(name: string): void } {
    const element = this;
    return {
      add(name: string): void {
        const parts = (element.attributes['class'] ?? '').split(' ').filter((part) => part.length > 0);
        if (!parts.includes(name)) parts.push(name);
        element.attributes['class'] = parts.join(' ');
      },
    };
  }

  focus(): void {
    this.focusCount += 1;
  }

  click(): void {
    this.clickCount += 1;
  }

  closest(selector: string): FakeElement | null {
    const match = /^\[([A-Za-z0-9_-]+)\]$/.exec(selector);
    if (match === null) return null;
    let node: FakeElement | null = this;
    while (node !== null) {
      if (node.getAttribute(match[1]) !== null) return node;
      node = node.parent;
    }
    return null;
  }

  hasClass(name: string): boolean {
    return (this.attributes['class'] ?? '').split(' ').includes(name);
  }
}

/** The fake document: the MountDocument surface + getElementById + fire(). */
class FakeDocument {
  private readonly listeners = new Map<string, Array<(event: Record<string, unknown>) => void>>();
  readonly created: FakeElement[] = [];
  focused: FakeElement | null = null;

  createElement(tagName: string): FakeElement {
    const element = new FakeElement(tagName);
    this.created.push(element);
    return element;
  }

  createTextNode(text: string): FakeText {
    return new FakeText(text);
  }

  addEventListener(type: string, listener: (event: Record<string, unknown>) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  getElementById(id: string): FakeElement | null {
    return this.created.find((element) => element.getAttribute('id') === id) ?? null;
  }

  fire(type: string, event: { target: FakeElement | null; relatedTarget?: FakeElement | null; key?: string; ctrlKey?: boolean; metaKey?: boolean }): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event as unknown as Record<string, unknown>);
  }

  querySelectorAll(selector: string): FakeElement[] {
    const tokens = selector.split(' ').filter((part) => part.length > 0);
    const matchesToken = (element: FakeElement, token: string): boolean => {
      if (token.startsWith('.')) return element.hasClass(token.slice(1));
      const attribute = /^\[([A-Za-z0-9_-]+)="([^"]*)"\]$/.exec(token);
      if (attribute !== null) return element.getAttribute(attribute[1]) === attribute[2];
      return element.tagName === token.toUpperCase();
    };
    const found: FakeElement[] = [];
    const walk = (element: FakeElement): void => {
      if (tokens.every((token) => matchesToken(element, token))) found.push(element);
      for (const child of element.children) walk(child);
    };
    for (const element of this.created) {
      if (element.parent === null) walk(element);
    }
    return found;
  }
}

/** Every element in the tree, depth-first. */
function elementsOf(root: FakeElement): FakeElement[] {
  const found: FakeElement[] = [];
  const walk = (element: FakeElement): void => {
    found.push(element);
    for (const child of element.children) walk(child);
  };
  walk(root);
  return found;
}

/** The first element carrying an exact data-attribute value. */
function findByData(root: FakeElement, name: string, value: string): FakeElement | null {
  return elementsOf(root).find((element) => element.getAttribute(name) === value) ?? null;
}

/** The concatenated text of an element's text children. */
function textOf(element: FakeElement): string {
  return element.childNodes.filter((node): node is FakeText => node instanceof FakeText).map((node) => node.text).join('');
}

/** Fire a delegated click at the element. */
function click(rig: SessionRig, element: FakeElement): void {
  rig.doc.fire('click', { target: element });
}

/** Click a nav item by target id (the sidebar's delegated navigation vocabulary). */
function clickNav(rig: SessionRig, target: string): void {
  const item = elementsOf(rig.root).find((element) => element.getAttribute('data-target') === target && element.tagName === 'BUTTON' && element.hasClass('nav-item'));
  if (item === undefined) throw new Error(`no nav item for ${target}`);
  click(rig, item);
}

/** The map-backed localStorage (the browser's localStorage in production). */
class MapStorage {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

// ---------------------------------------------------------------------------
// THE SESSION-VIEW BACKING (the host's session-scoped listing, scripted)
// ---------------------------------------------------------------------------

/** One project record of the world (the shape the boundary serves). */
function projectOf(id: string, name: string): Record<string, unknown> {
  return {
    id, tenantId: TENANT, name, executionMode: 'simulation',
    lifecycle: { projectId: id, status: 'active', acceptanceCriteriaId: null, organizationRef: 'org:seeded' },
    lineage: { projectId: id, createdAt: T0, createdBy: 'test', priorVersion: null, version: 1, goal: { goalId: `goal-${id}`, version: 1 }, constraintSet: { id: `cs-${id}`, version: 1 } },
    createdAt: T0, updatedAt: T0,
  };
}

/** The shared world: the demo project + 25 session-owned desks (L4's own two among them) + a desk NO session may see. */
const DEMO_PROJECT = projectOf(DEMO_PROJECT_ID, 'the TradRL demo project');
const OWN_DESKS: Record<string, unknown>[] = [
  ...Array.from({ length: 25 }, (_unused, index) => projectOf(`prj-own-${String(index + 1).padStart(2, '0')}`, `Own Desk ${index + 1}`)),
];
// L4's two desks live in the session's own registry (MI-D8's exact searches)
const L4_VOL_DESK = projectOf('prj-own-07', 'EQ Vol-Arb Execution Desk');
const L4_ROLL_DESK = projectOf('prj-own-12', 'Futures Roll Program');
OWN_DESKS[6] = L4_VOL_DESK;
OWN_DESKS[11] = L4_ROLL_DESK;
const FOREIGN_DESK = projectOf('prj-foreign-01', 'G7 Rates Relative Value'); // another session's desk — NEVER in the session view

/**
 * The SESSION-VIEW transport: the host's session-scoped surface, scripted —
 * the listing serves the demo project + the session's OWN desks (exactly
 * what the FW-MI-A host serves a session header bearer); the foreign desk
 * answers the typed 404 everywhere (unknown and foreign indistinguishable).
 */
function sessionViewTransport(): { readonly transport: ApiTransport; readonly requests: { readonly method: string; readonly path: string; readonly headers: Readonly<Record<string, string>> }[] } {
  const requests: { readonly method: string; readonly path: string; readonly headers: Readonly<Record<string, string>> }[] = [];
  const view: readonly Record<string, unknown>[] = [DEMO_PROJECT, ...OWN_DESKS];
  const ok = (data: unknown) => ({ status: 200, headers: {}, body: { requestId: 'req-session', data } });
  const notFound = { status: 404, headers: {}, body: { requestId: 'req-session', error: { code: 'not_found', message: 'no route', status: 404 } } };
  const transport: ApiTransport = async (request) => {
    requests.push({ method: request.method, path: request.path, headers: request.headers });
    const key = `${request.method} ${decodeURIComponent(request.path.split('?')[0])}`;
    if (key === 'GET /v1/meta') return ok({ apiVersion: 'v1', supportedVersions: ['v1'], routeFamilies: [] });
    if (key === 'GET /v1/projects') return ok({ items: view }); // THE SESSION LISTING: demo + own, one full page — never the foreign desk
    if (key === `GET /v1/projects/${DEMO_PROJECT_ID}`) return ok(DEMO_PROJECT);
    for (const desk of OWN_DESKS) {
      if (key === `GET /v1/projects/${desk.id}`) return ok(desk);
    }
    if (key === 'GET /v1/projects/prj-foreign-01') return notFound; // the session gate's typed 404 (never a leak)
    if (key === 'POST /v1/knowledge/query' || key === 'POST /v1/post-mortems/query') return ok({ items: [] });
    if (key === 'POST /v1/outcomes/query') return ok({ items: [] });
    if (key === 'GET /v1/execution/submissions') return ok({ items: [] });
    if (key === 'GET /v1/jobs') return ok({ items: [] });
    if (key === 'GET /v1/organizations/org:seeded/status') {
      const scopeProject = decodeURIComponent(request.path.split('?project=')[1] ?? DEMO_PROJECT_ID);
      return ok({ organizationRef: 'org:seeded', tenant: TENANT, project: scopeProject, status: 'active', at: T0, instanceRefs: [] });
    }
    return notFound; // the goal route among them — the console skips silently (the host-owned route's own law)
  };
  return { transport, requests };
}

// ---------------------------------------------------------------------------
// THE RIG (the REAL entry, booted with the localStorage seam live)
// ---------------------------------------------------------------------------

/** One booted session rig. */
interface SessionRig {
  readonly handle: ConsoleHandle;
  readonly doc: FakeDocument;
  readonly root: FakeElement;
  readonly storage: MapStorage;
}

/** Flush the boot read cadence's microtask chain. */
async function drain(rounds = 200): Promise<void> {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

/** Boot the REAL entry (bootFromShell) with the localStorage seam live — the session id resolves exactly as the browser's does. */
async function bootSessionRig(storage: MapStorage, transport: ApiTransport, projectId = DEMO_PROJECT_ID): Promise<SessionRig> {
  if (!storage.map.has('tradrl_onboarded')) storage.map.set('tradrl_onboarded', 'true'); // returning users skip the wizard (the journey under test is the session, not the intro)
  const holder = globalThis as { __TRADRL_CONSOLE_BOOT__?: typeof ConsoleModule };
  if (holder.__TRADRL_CONSOLE_BOOT__ === undefined) {
    holder.__TRADRL_CONSOLE_BOOT__ = await import('./console');
  }
  vi.stubGlobal('localStorage', storage);
  try {
    const doc = new FakeDocument();
    const root = doc.createElement('div');
    root.setAttribute('id', CONSOLE_ROOT_ID);
    const handle = await bootFromShell({
      document: doc as unknown as Document,
      config: { apiOrigin: 'http://session.invalid', token: 'token-session', tenantId: TENANT, projectId, simulated: true },
      transport,
    });
    if (handle === null) throw new Error('bootFromShell failed to boot the console');
    await handle.refresh(); // settle the boot read cadence deterministically
    await drain();
    return { handle, doc, root, storage };
  } finally {
    vi.unstubAllGlobals();
  }
}

// ---------------------------------------------------------------------------
// THE PINS
// ---------------------------------------------------------------------------

describe('executed boot: FW-MI-A — the console session (the header, the stability, the faithful session view)', () => {
  it('the session header rides EVERY request the client sends, and the id is STABLE across boots (the same browser = the same session)', async () => {
    const api = sessionViewTransport();
    const storage = new MapStorage();
    const first = await bootSessionRig(storage, api.transport);
    expect(api.requests.length).toBeGreaterThan(0);
    const firstSession = first.storage.map.get('tradrl_console_session');
    if (firstSession === undefined) throw new Error('the entry persisted no session id under the documented key');
    expect(firstSession).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    for (const request of api.requests) {
      expect(request.headers['x-tradrl-console-session']).toBe(firstSession); // EVERY request — the listing, the detail, the goal read, the queries
    }

    // a second boot of the SAME browser reuses the SAME id (the own desks restore with it)
    const second = sessionViewTransport();
    const again = await bootSessionRig(storage, second.transport);
    const secondSession = again.storage.map.get('tradrl_console_session');
    expect(secondSession).toBe(firstSession);
    expect(second.requests.length).toBeGreaterThan(0);
    for (const request of second.requests) {
      expect(request.headers['x-tradrl-console-session']).toBe(firstSession);
    }
  });

  it('FW-35-B (Round D register §3.2): the DESK-MEMBERSHIP identity survives a TRUE browser restart — a fresh boot on the same durable storage re-serves the SAME session view (the own desks stay the session own, the foreign desk stays out), so a browser closed and reopened on its profile never misclassifies its desks into other-sessions', async () => {
    const storage = new MapStorage();
    // SESSION ONE: the browser launches, the session id mints, the host serves the session view
    const api = sessionViewTransport();
    const first = await bootSessionRig(storage, api.transport);
    const sessionId = first.storage.map.get('tradrl_console_session');
    if (sessionId === undefined) throw new Error('the entry persisted no session id');
    expect(first.handle.state().projectDirectory.length).toBe(26); // the demo project + 25 own desks
    expect(first.handle.state().projectDirectory.some((project) => project.id === 'prj-foreign-01')).toBe(false);

    // SESSION TWO — THE TRUE RESTART: a fresh bootFromShell on the SAME localStorage (a browser closed and reopened on its profile — nothing in-memory carries over)
    const restarted = sessionViewTransport();
    const second = await bootSessionRig(storage, restarted.transport);
    expect(second.storage.map.get('tradrl_console_session')).toBe(sessionId); // the SAME identity — the desk-membership key survived
    expect(second.handle.state().projectDirectory.length).toBe(26); // the host re-served the SAME session view — every own desk still classifies as the session own
    expect(second.handle.state().projectDirectory.some((project) => project.id === 'prj-foreign-01')).toBe(false); // the foreign desk never leaked in
    clickNav(second, 'settings');
    const switcher = findByData(second.root, 'data-action', 'project-switch');
    if (switcher === null) throw new Error('the Settings panel renders no project switcher');
    const options = elementsOf(switcher).filter((element) => element.tagName === 'OPTION');
    expect(options.length).toBe(26); // the switcher carries the whole session view — no own desk demoted behind the other-sessions disclosure
  });

  it('MI-D1: the console renders EXACTLY the session view the host serves — the switcher, the palette and the EXPORT never carry another session\'s desks (S5\'s ask)', async () => {
    const api = sessionViewTransport();
    const rig = await bootSessionRig(new MapStorage(), api.transport);
    expect(rig.handle.state().projectDirectory.length).toBe(26); // the demo project + 25 own desks — the WHOLE session view (never a foreign desk)
    expect(rig.handle.state().projectDirectory.some((project) => project.id === 'prj-foreign-01')).toBe(false); // the rival desk NEVER entered the state

    // the switcher renders EVERY session project (no silent cap — MI-D8's law)
    clickNav(rig, 'settings');
    const switcher = findByData(rig.root, 'data-action', 'project-switch');
    if (switcher === null) throw new Error('the Settings panel renders no project switcher');
    const options = elementsOf(switcher).filter((element) => element.tagName === 'OPTION');
    expect(options.length).toBe(26);
    expect(options.some((option) => (option.getAttribute('value') ?? '') === 'prj-foreign-01')).toBe(false);

    // the EXPORT embeds EXACTLY the session view — no foreign desks inside the audit file (S5: "other desks' names inside my audit export is precisely the liability I refuse")
    const exportButton = findByData(rig.root, 'data-action', 'export-workspace');
    if (exportButton === null) throw new Error('no export-workspace action');
    const anchorsBefore = rig.doc.created.filter((element) => element.tagName === 'A').length;
    click(rig, exportButton);
    const anchors = rig.doc.created.filter((element) => element.tagName === 'A');
    const anchor = anchors[anchorsBefore] as FakeElement;
    const href = anchor.getAttribute('href') ?? '';
    const prefix = 'data:application/json;charset=utf-8,';
    const document_ = JSON.parse(decodeURIComponent(href.slice(prefix.length))) as Record<string, unknown>;
    expect(verifyWorkspaceExport(document_)).toEqual({ ok: true }); // the chain still verifies end to end
    const workspace = document_.workspace as { readonly projectDirectory: readonly { readonly id: string }[] };
    expect(workspace.projectDirectory.length).toBe(26);
    expect(workspace.projectDirectory.some((project) => project.id === 'prj-foreign-01')).toBe(false); // THE ISOLATION PIN
  });

  it('MI-D8: the switcher FILTER narrows the session\'s own registry by fuzzy name + id, with the live count line — and a committed switch reaches the chosen desk', async () => {
    const api = sessionViewTransport();
    const rig = await bootSessionRig(new MapStorage(), api.transport);
    clickNav(rig, 'settings');

    // the filter input renders with the whole session registry (26 > 1)
    const filter = findByData(rig.root, 'data-project-filter', 'true');
    if (filter === null) throw new Error('the Settings panel renders no project filter input');
    expect(findByData(rig.root, 'data-action', 'project-filter-clear')).toBeNull(); // no clear affordance until there is a filter

    // L4's exact search: 'EQ Vol' — ONE enabled option (the demo scope's
    // disabled mirror option renders per the D-15 law — the filter hid the
    // current project, so the select's value still mirrors the truth), the
    // count line states the narrowing
    filter.value = 'EQ Vol';
    rig.doc.fire('input', { target: filter });
    let switcher = findByData(rig.root, 'data-action', 'project-switch') as FakeElement;
    let enabled = elementsOf(switcher).filter((element) => element.tagName === 'OPTION' && element.getAttribute('disabled') === null);
    expect(enabled.length).toBe(1);
    expect(enabled[0]?.getAttribute('value')).toBe('prj-own-07');
    expect(textOf(findByData(rig.root, 'data-project-filter-count', 'true') as FakeElement)).toBe('1 of 26 projects match “EQ Vol”.');

    // by ID FRAGMENT — L4's other unreachable-desk symptom ('6682ce17' was his desk's id fragment). The matcher is the palette's own SUBSEQUENCE scorer, so a fragment is inclusive by design (a run like 'own-12' also subsequence-matches 'prj-own-21 … desk 21'); the pin that matters is the RANK: L4's own desk is the TOP enabled option.
    const filterAgain = findByData(rig.root, 'data-project-filter', 'true') as FakeElement;
    filterAgain.value = 'own-12';
    rig.doc.fire('input', { target: filterAgain });
    switcher = findByData(rig.root, 'data-action', 'project-switch') as FakeElement;
    enabled = elementsOf(switcher).filter((element) => element.tagName === 'OPTION' && element.getAttribute('disabled') === null);
    expect(enabled.length).toBeGreaterThan(0);
    expect(enabled[0]?.getAttribute('value')).toBe('prj-own-12'); // the desk's own fragment finds it — first among the enabled options (the select keeps the registry's creation order)

    // a no-match filter NEVER blanks the row: the teaching line renders (D3's law)
    const filterNone = findByData(rig.root, 'data-project-filter', 'true') as FakeElement;
    filterNone.value = 'zzzz-no-desk';
    rig.doc.fire('input', { target: filterNone });
    expect(textOf(findByData(rig.root, 'data-project-filter-count', 'true') as FakeElement)).toContain('No project matches');

    // the clear affordance restores the whole session registry
    const clear = findByData(rig.root, 'data-action', 'project-filter-clear');
    if (clear === null) throw new Error('no clear-filter affordance while filtering');
    click(rig, clear);
    switcher = findByData(rig.root, 'data-action', 'project-switch') as FakeElement;
    expect(elementsOf(switcher).filter((element) => element.tagName === 'OPTION').length).toBe(26);
    expect(findByData(rig.root, 'data-project-filter-count', 'true')).toBeNull(); // the count line leaves with the filter

    // and a committed switch REACHES the chosen desk (L4's "own desks became UNREACHABLE" — no more)
    const select = findByData(rig.root, 'data-action', 'project-switch') as FakeElement;
    select.value = 'prj-own-12';
    rig.doc.fire('change', { target: select });
    expect(rig.handle.state().scope.projectId).toBe('prj-own-12'); // adopted
    await rig.handle.beat();
    expect(rig.handle.state().project?.id).toBe('prj-own-12'); // the desk's own world loaded — reachable end to end
    expect(rig.handle.state().degraded).toEqual([]); // honest throughout: no failed reads
  });

  it('MI-D8: the command palette finds the session\'s own desks BY NAME and BY ID FRAGMENT over the full registry (L4\'s zero-result searches)', async () => {
    const api = sessionViewTransport();
    const rig = await bootSessionRig(new MapStorage(), api.transport);

    // open the palette and type L4's exact zero-result query — the desk is the top PROJECT result
    const affordance = findByData(rig.root, 'data-action', 'palette-open');
    if (affordance === null) throw new Error('no palette affordance');
    click(rig, affordance);
    let input = findByData(rig.root, 'data-palette-input', 'true');
    if (input === null) throw new Error('the palette renders no input');
    input.value = 'EQ Vol';
    rig.doc.fire('input', { target: input });
    let projectResults = elementsOf(rig.root).filter((element) => element.getAttribute('data-palette-ref')?.startsWith('project:'));
    expect(projectResults.length).toBeGreaterThan(0);
    expect(projectResults.some((element) => element.getAttribute('data-palette-ref') === 'project:prj-own-07')).toBe(true); // by NAME

    // by ID FRAGMENT — the other half of L4's finding ('6682ce17' found nothing)
    input = findByData(rig.root, 'data-palette-input', 'true') as FakeElement;
    input.value = 'own-12';
    rig.doc.fire('input', { target: input });
    projectResults = elementsOf(rig.root).filter((element) => element.getAttribute('data-palette-ref')?.startsWith('project:'));
    expect(projectResults.some((element) => element.getAttribute('data-palette-ref') === 'project:prj-own-12')).toBe(true); // by ID

    // the FOREIGN desk never appears under any query (MI-D1 inside the palette)
    input = findByData(rig.root, 'data-palette-input', 'true') as FakeElement;
    input.value = 'G7 Rates';
    rig.doc.fire('input', { target: input });
    projectResults = elementsOf(rig.root).filter((element) => element.getAttribute('data-palette-ref')?.startsWith('project:'));
    expect(projectResults.length).toBe(0); // the rival desk is not in the session view — nothing matches
  });

  it('the stored-scope restore adopts ONLY ids the session view serves — a stale FOREIGN scope is cleared, never adopted (L3\'s switch-in by id, closed)', async () => {
    // a stored OWN scope restores: the session reopens its own desk
    const ownStorage = new MapStorage();
    ownStorage.map.set('tradrl_onboarded', 'true');
    ownStorage.map.set('tradrl_scope_project', 'prj-own-07');
    const ownRig = await bootSessionRig(ownStorage, sessionViewTransport().transport);
    expect(ownRig.handle.state().scope.projectId).toBe('prj-own-07'); // restored — the own desk is in the session view
    await ownRig.handle.beat();
    expect(ownRig.handle.state().project?.id).toBe('prj-own-07'); // and its world loaded

    // a stored FOREIGN scope is stale under the session view: cleared, the env pin holds — the foreign desk is unreachable by id
    const foreignStorage = new MapStorage();
    foreignStorage.map.set('tradrl_onboarded', 'true');
    foreignStorage.map.set('tradrl_scope_project', 'prj-foreign-01');
    const foreignRig = await bootSessionRig(foreignStorage, sessionViewTransport().transport);
    expect(foreignRig.handle.state().scope.projectId).toBe(DEMO_PROJECT_ID); // the env pin holds — no adoption of a foreign id
    expect(foreignStorage.map.get('tradrl_scope_project')).toBe(''); // the stale id is CLEARED
    expect(foreignRig.handle.state().projectDirectory.some((project) => project.id === 'prj-foreign-01')).toBe(false);
  });
});
