// THE EXECUTED-BOOT INTERACTION TEST CLASS (T051 follow-up W-10b).
//
// THE HOLE THIS FILE CLOSES (the Lead's J1 finding): every existing
// console test renders the PURE model or pins the PURE state machine —
// NONE OF THEM EVER EXECUTED THE MOUNTED CONSOLE. The delegated click
// wiring in app/console.ts's mount() (the document-level listener, the
// closest('[data-target]') / closest('[data-action]') vocabulary) ran
// in exactly one place: the live browser. When T051 broke it (the
// shell root began carrying data-target — every click in the console
// was intercepted as a navigation to the active target and returned
// before ANY [data-action] branch could run), the entire suite stayed
// green. This defect class was invisible by construction.
//
// THE HARNESS: the app layer is DOM-free until mount() — bootConsole
// takes injected seams and mount() needs only createElement /
// createTextNode / addEventListener (+ optional querySelectorAll). A
// ~100-line fake document implements exactly that surface, plus the
// closest() walk the delegated handler performs. The tests then boot
// the REAL console, mount it, and FIRE DELEGATED EVENTS at the
// document — the same events the browser dispatches — asserting the
// re-projected tree after each interaction.
//
// THE J1 CONTRACT (UX-DESIGN.md §4.13, pinned here end to end):
//   - the wizard renders EXACTLY ONCE (the T051 double render — an
//     in-place copy inside .shell-content AND the §4.13 overlay — is
//     gone; the overlay is the single copy);
//   - Continue advances 1 -> 2 -> 3, "Get started" completes, lands on
//     Home and persists (localStorage `tradrl_onboarded`);
//   - returning users skip straight to Home;
//   - Skip works from every step; the "?" affordance re-opens the
//     wizard from Settings.
//
// Plus the OTHER delegated action flows the dead click layer was
// blocking (the Lead's J-catalog follow-ups): navigation, theme
// light/dark (+ persistence), drawer open/close, notices-read-all,
// export-workspace, the primary flow's launch-step-* /
// confirm-arm-launch / confirm-launch branches (the draft is seeded
// through the handle's sanctioned dispatch path), and the palette's
// click affordance + Esc close.
//
// THE REAL-LOADER PIN: the final test loads the app module through the
// REAL no-build loader (loadModuleGraph over the files on disk, data:
// URL imports — the browser's boot path) and executes the SAME
// interaction through the STRIPPED module, so the loader can never
// again diverge from what the vitest (esbuild) path proves.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ApiTransport } from '../api/transport';
import type { ConsoleHandle } from './console';
import { bootConsole } from './console';
import type { LaunchDraft } from '../core/launch';
import type { JobRecord } from '../api/contracts';
import { loadModuleGraph, type LoaderBindings } from '../loader/strip-types';

const HERE = dirname(fileURLToPath(import.meta.url));
const APPS_WEB = resolve(HERE, '../..');
const T0 = 1_700_000_000_000;

// ---------------------------------------------------------------------------
// THE FAKE DOCUMENT (the minimal MountDocument surface + the Element
// surface the projector and the delegated handler need — nothing more).
// ---------------------------------------------------------------------------

/** A text node (the projector's only other product). */
class FakeText {
  readonly nodeType = 3 as const;
  constructor(readonly text: string) {}
}

/** The fake element: attributes, a child list, a parent chain, closest(). */
class FakeElement {
  readonly nodeType = 1 as const;
  /** UPPERCASE like the DOM (the delegated handler's tagName guard reads it). */
  readonly tagName: string;
  readonly childNodes: (FakeElement | FakeText)[] = [];
  parent: FakeElement | null = null;
  readonly attributes: Record<string, string> = {};
  focusCount = 0;
  clickCount = 0;

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

  /** The classList subset the host styling uses (mount adds 'tradrl-host'). */
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

  /** The delegated handler's only traversal: [data-...] attribute selectors, self-first up the parent chain. */
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

  /** Whitespace-exact class membership (the a11y-tree assertions depend on it). */
  hasClass(name: string): boolean {
    return (this.attributes['class'] ?? '').split(' ').includes(name);
  }
}

/**
 * The fake document: createElement/createTextNode/addEventListener (the
 * MountDocument contract) + querySelectorAll for the focus traps, and
 * fire() — the test's stand-in for the browser's event dispatch.
 */
class FakeDocument {
  private readonly listeners = new Map<string, Array<(event: Record<string, unknown>) => void>>();
  /** Every element ever created (the export-workspace anchor is found here). */
  readonly created: FakeElement[] = [];
  readonly activeElement: FakeElement | null = null;

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

  /** Dispatch one event to every listener of its type (the browser's capture order is irrelevant: one console). */
  fire(type: string, event: { target: FakeElement | null; key?: string; ctrlKey?: boolean; metaKey?: boolean }): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event as unknown as Record<string, unknown>);
  }

  /** The focus traps' query surface: descendant selectors of .class and [data-action="value"] tokens. */
  querySelectorAll(selector: string): FakeElement[] {
    const tokens = selector.split(' ').filter((part) => part.length > 0);
    const matchesToken = (element: FakeElement, token: string): boolean => {
      if (token.startsWith('.')) return element.hasClass(token.slice(1));
      const attribute = /^\[([A-Za-z0-9_-]+)="([^"]*)"\]$/.exec(token);
      if (attribute !== null) return element.getAttribute(attribute[1]) === attribute[2];
      return element.tagName === token.toUpperCase();
    };
    const matches = (element: FakeElement, remaining: readonly string[]): boolean => {
      const [first, ...rest] = remaining;
      if (!matchesToken(element, first)) return false;
      if (rest.length === 0) return true;
      let ancestor = element.parent;
      while (ancestor !== null) {
        if (matches(ancestor, rest)) return true;
        ancestor = ancestor.parent;
      }
      return false;
    };
    const found: FakeElement[] = [];
    const walk = (element: FakeElement): void => {
      if (matches(element, tokens)) found.push(element);
      for (const child of element.children) walk(child);
    };
    for (const element of this.created) {
      if (element.parent === null) walk(element);
    }
    return found;
  }
}

// ---------------------------------------------------------------------------
// THE TREE HELPERS (assertions walk the re-projected tree).
// ---------------------------------------------------------------------------

/** Every element in the tree, depth-first (skipping unattached creations). */
function elementsOf(root: FakeElement): FakeElement[] {
  const found: FakeElement[] = [];
  const walk = (element: FakeElement): void => {
    found.push(element);
    for (const child of element.children) walk(child);
  };
  walk(root);
  return found;
}

/** The live shell root (the projected .tradrl-shell — replaced on every render). */
function shellOf(root: FakeElement): FakeElement {
  const shell = elementsOf(root).find((element) => element.hasClass('tradrl-shell'));
  if (shell === undefined) throw new Error('the mounted tree carries no .tradrl-shell');
  return shell;
}

/** The first element carrying an exact data-attribute value. */
function findByData(root: FakeElement, name: string, value: string): FakeElement | null {
  return elementsOf(root).find((element) => element.getAttribute(name) === value) ?? null;
}

/** The count of elements carrying an exact data-attribute value. */
function countByData(root: FakeElement, name: string, value: string): number {
  return elementsOf(root).filter((element) => element.getAttribute(name) === value).length;
}

/** The count of elements carrying a whitespace-exact class. */
function countByClass(root: FakeElement, name: string): number {
  return elementsOf(root).filter((element) => element.hasClass(name)).length;
}

/** The concatenated text of an element's text children. */
function textOf(element: FakeElement): string {
  return element.childNodes.filter((node): node is FakeText => node instanceof FakeText).map((node) => node.text).join('');
}

// ---------------------------------------------------------------------------
// THE RIG (the real console, booted with every seam injected).
// ---------------------------------------------------------------------------

/** A storage seam backed by a plain map (localStorage in production). */
class MapStorage {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

/** The scripted offline transport: every read degrades gracefully (the R46 law — never a crash). */
const offlineTransport: ApiTransport = async () => {
  throw new Error('offline: the scripted transport rejects every read');
};

/** A valid launch draft (the primary-flow fixture — passes validateLaunchDraft). */
const VALID_DRAFT: LaunchDraft = {
  name: 'Momentum scout',
  objective: 'Find and keep an edge in momentum.',
  horizon: { startsAt: T0, endsAt: T0 + 86_400_000 },
  successCriteria: [{ id: 'sc-1', metric: 'pnl.net', predicate: { kind: 'limit.min', bound: 0 }, description: 'net profit is non-negative' }],
  evaluation: { blindRef: 'eval:blind-1', walkForwardRef: 'eval:wf-1', regimeRef: 'eval:regime-1', adversarialRequired: true },
  constraints: [{ id: 'c-1', domain: 'outcome', subject: 'risk.maxDrawdown', predicate: { kind: 'limit.max', bound: 0.2 }, severity: 'blocking', description: 'the drawdown ceiling' }],
  capitalBudget: '10000.00',
  riskBudget: '250.00',
  markets: ['binance:BTC-USDT'],
  venues: ['binance'],
  dataSources: ['candles:1m'],
  executionMode: 'simulation',
  preferences: [{ key: 'rebalance', value: 'daily' }],
};

/** A failed research job (the failed_evaluation notice signal, tenant-scoped to the rig). */
const FAILED_JOB: JobRecord = {
  jobId: 'job-1',
  kind: 'research',
  tenant: 'tenant-a',
  project: 'prj-a',
  status: 'failed',
  submittedAt: T0 + 10,
};

/** One booted + mounted console on the fake document. */
interface Rig {
  readonly handle: ConsoleHandle;
  readonly doc: FakeDocument;
  readonly root: FakeElement;
  readonly storage: MapStorage;
}

/** Boot the real console with every seam injected and mount it (DOM-free until here — the architecture's law). */
async function bootRig(stored: Record<string, string> = {}): Promise<Rig> {
  const storage = new MapStorage();
  for (const [key, value] of Object.entries(stored)) storage.map.set(key, value);
  const handle = bootConsole({
    baseUrl: 'http://scripted.invalid',
    token: 'token-test',
    scope: { tenantId: 'tenant-a', projectId: 'prj-a' },
    transport: offlineTransport,
    instants: { nowMs: () => T0 + 1000 },
    theme: 'light',
    storage,
    onboardingStorage: storage,
    simulated: true,
  });
  const doc = new FakeDocument();
  const root = new FakeElement('div');
  handle.mount(root as unknown as Parameters<ConsoleHandle['mount']>[0], doc as unknown as Parameters<ConsoleHandle['mount']>[1]);
  await handle.refresh(); // settle the boot read cadence (every read degrades — deterministic)
  return { handle, doc, root, storage };
}

/** Fire a delegated click at the element (the browser's dispatch, one target). */
function click(rig: Rig, element: FakeElement): void {
  rig.doc.fire('click', { target: element });
}

/** The wizard's CTA / Skip of the CURRENT projection (the tree is rebuilt per state change — find fresh each time). */
function ctaOf(rig: Rig): FakeElement {
  const cta = findByData(rig.root, 'data-action', 'onboarding-next');
  if (cta === null) throw new Error('no onboarding CTA in the current tree');
  return cta;
}

function skipOf(rig: Rig): FakeElement {
  const skip = findByData(rig.root, 'data-action', 'onboarding-skip');
  if (skip === null) throw new Error('no onboarding Skip in the current tree');
  return skip;
}

/** Click a nav item by target id (the sidebar's delegated navigation vocabulary). */
function clickNav(rig: Rig, target: string): void {
  const item = elementsOf(rig.root).find((element) => element.getAttribute('data-target') === target && element.tagName === 'BUTTON' && element.hasClass('nav-item'));
  if (item === undefined) throw new Error(`no nav item for ${target}`);
  click(rig, item);
}

/** Flush every pending microtask (the async submit path settles before assertions). */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// J1 — the onboarding journey, end to end.
// ---------------------------------------------------------------------------

describe('executed boot: J1 — the onboarding wizard', () => {
  it('first run: the wizard renders EXACTLY ONCE (the T051 double render — an in-place copy AND the overlay — is gone)', async () => {
    const rig = await bootRig();
    expect(countByClass(rig.root, 'onboarding')).toBe(1); // the a11y tree reads the wizard once
    expect(countByData(rig.root, 'data-onboarding', 'step-1')).toBe(1);
  });

  it('Continue advances 1 -> 2 -> 3, "Get started" completes, lands on Home and persists', async () => {
    const rig = await bootRig();
    expect(findByData(rig.root, 'data-onboarding', 'step-1')).not.toBeNull();

    click(rig, ctaOf(rig)); // step 1 -> 2
    expect(findByData(rig.root, 'data-onboarding', 'step-2')).not.toBeNull();
    expect(findByData(rig.root, 'data-onboarding', 'step-1')).toBeNull();
    expect(textOf(ctaOf(rig))).toContain('Continue');

    click(rig, ctaOf(rig)); // step 2 -> 3
    expect(findByData(rig.root, 'data-onboarding', 'step-3')).not.toBeNull();
    expect(textOf(ctaOf(rig))).toContain('Get started');

    click(rig, ctaOf(rig)); // step 3 -> completed
    expect(countByClass(rig.root, 'onboarding')).toBe(0); // the overlay is gone
    expect(findByData(rig.root, 'data-onboarding', 'completed')).not.toBeNull();
    expect(findByData(rig.root, 'data-section', 'home')).not.toBeNull(); // lands on Home
    expect(rig.storage.map.get('tradrl_onboarded')).toBe('true'); // persists
  });

  it('Skip completes from EVERY step, lands on Home and persists', async () => {
    for (let step = 0; step < 3; step += 1) {
      const rig = await bootRig();
      for (let advance = 0; advance < step; advance += 1) click(rig, ctaOf(rig));
      expect(findByData(rig.root, 'data-onboarding', `step-${step + 1}`), `setup at step ${step + 1}`).not.toBeNull();
      click(rig, skipOf(rig));
      expect(countByClass(rig.root, 'onboarding'), `skip from step ${step + 1}`).toBe(0);
      expect(findByData(rig.root, 'data-section', 'home'), `skip from step ${step + 1} lands on Home`).not.toBeNull();
      expect(rig.storage.map.get('tradrl_onboarded'), `skip from step ${step + 1} persists`).toBe('true');
    }
  });

  it('returning users (tradrl_onboarded stored) skip straight to Home — no wizard at all', async () => {
    const rig = await bootRig({ tradrl_onboarded: 'true' });
    expect(countByClass(rig.root, 'onboarding')).toBe(0);
    expect(countByData(rig.root, 'data-onboarding', 'step-1')).toBe(0);
    expect(findByData(rig.root, 'data-section', 'home')).not.toBeNull();
  });

  it('the "?" affordance re-opens the wizard from Settings (and it completes again)', async () => {
    const rig = await bootRig({ tradrl_onboarded: 'true' });
    clickNav(rig, 'settings');
    expect(findByData(rig.root, 'data-settings', 'theme')).not.toBeNull();

    const reopen = findByData(rig.root, 'data-action', 'onboarding-reopen');
    if (reopen === null) throw new Error('the guided-intro affordance is missing from Settings');
    click(rig, reopen);
    expect(countByClass(rig.root, 'onboarding')).toBe(1); // exactly one wizard, again
    expect(findByData(rig.root, 'data-onboarding', 'step-1')).not.toBeNull();

    click(rig, ctaOf(rig));
    click(rig, ctaOf(rig));
    click(rig, ctaOf(rig));
    expect(countByClass(rig.root, 'onboarding')).toBe(0);
    expect(findByData(rig.root, 'data-section', 'home')).not.toBeNull(); // completion lands on Home
  });
});

// ---------------------------------------------------------------------------
// THE DELEGATED ACTION LAYER — the flows the dead click path blocked.
// ---------------------------------------------------------------------------

describe('executed boot: the delegated action layer', () => {
  it('nav clicks still navigate (the [data-target] vocabulary stays on the affordance buttons)', async () => {
    const rig = await bootRig({ tradrl_onboarded: 'true' });
    clickNav(rig, 'goal');
    expect(findByData(rig.root, 'data-section', 'goal')).not.toBeNull();
    expect(shellOf(rig.root).getAttribute('data-active-target')).toBe('goal');
    clickNav(rig, 'home');
    expect(findByData(rig.root, 'data-section', 'home')).not.toBeNull();
  });

  it('theme-light / theme-dark clicks flip the theme AND persist it', async () => {
    const rig = await bootRig({ tradrl_onboarded: 'true' });
    clickNav(rig, 'settings');
    const dark = findByData(rig.root, 'data-action', 'theme-dark');
    if (dark === null) throw new Error('no theme-dark control');
    click(rig, dark);
    expect(shellOf(rig.root).getAttribute('data-theme')).toBe('dark');
    expect(rig.storage.map.get('tradrl_theme')).toBe('dark');
    const light = findByData(rig.root, 'data-action', 'theme-light');
    if (light === null) throw new Error('no theme-light control');
    click(rig, light);
    expect(shellOf(rig.root).getAttribute('data-theme')).toBe('light');
    expect(rig.storage.map.get('tradrl_theme')).toBe('light');
  });

  it('drawer-open opens the drawer; drawer-close closes it (root data-drawer flips)', async () => {
    const rig = await bootRig({ tradrl_onboarded: 'true' });
    const menu = findByData(rig.root, 'data-action', 'drawer-open');
    if (menu === null) throw new Error('no drawer-open button');
    click(rig, menu);
    expect(shellOf(rig.root).getAttribute('data-drawer')).toBe('open');
    const backdrop = findByData(rig.root, 'data-action', 'drawer-close');
    if (backdrop === null) throw new Error('no drawer-close backdrop while open');
    click(rig, backdrop);
    expect(shellOf(rig.root).getAttribute('data-drawer')).toBe('closed');
  });

  it('notices-read-all clears the unread badge (the bell + the Inbox action)', async () => {
    const rig = await bootRig({ tradrl_onboarded: 'true' });
    rig.handle.dispatch({ kind: 'job-updated', at: T0 + 20, job: FAILED_JOB }); // folds a failed_evaluation notice
    const bellOf = (): FakeElement => {
      const bell = elementsOf(rig.root).find((element) => element.getAttribute('data-target') === 'inbox' && element.hasClass('bell'));
      if (bell === undefined) throw new Error('no bell');
      return bell;
    };
    expect(bellOf().getAttribute('aria-label')).toContain('1 unread notice'); // the badge renders on the bell
    expect(countByData(rig.root, 'data-unread', '1')).toBe(1);
    click(rig, bellOf()); // the bell IS the Inbox nav item
    const readAll = findByData(rig.root, 'data-action', 'notices-read-all');
    if (readAll === null) throw new Error('no Mark-all-read action in the Inbox');
    click(rig, readAll);
    expect(bellOf().getAttribute('aria-label')).toContain('no unread notices');
    expect(countByData(rig.root, 'data-unread', '1')).toBe(0); // the badge is gone
  });

  it('export-workspace builds the data: download anchor and clicks it', async () => {
    const rig = await bootRig({ tradrl_onboarded: 'true' });
    clickNav(rig, 'settings');
    const exportButton = findByData(rig.root, 'data-action', 'export-workspace');
    if (exportButton === null) throw new Error('no export-workspace action');
    const anchorsBefore = rig.doc.created.filter((element) => element.tagName === 'A').length;
    click(rig, exportButton);
    const anchors = rig.doc.created.filter((element) => element.tagName === 'A');
    expect(anchors.length).toBe(anchorsBefore + 1); // one anchor was created
    const anchor = anchors[anchors.length - 1] as FakeElement;
    expect(anchor.getAttribute('href')).toMatch(/^data:application\/json;charset=utf-8,/);
    expect(anchor.getAttribute('download')).toBe('tradrl-workspace-prj-a.json');
    expect(anchor.clickCount).toBe(1); // the download fired
  });

  it('the primary flow branches: launch-step-* navigates, confirm-arm-launch arms, confirm-launch submits (draft seeded via the sanctioned dispatch path)', async () => {
    const rig = await bootRig({ tradrl_onboarded: 'true' });
    rig.handle.dispatch({ kind: 'launch-draft-started', at: T0 + 30, draft: VALID_DRAFT });
    expect(findByData(rig.root, 'data-launch-step', 'goal')).not.toBeNull();

    click(rig, findByData(rig.root, 'data-action', 'launch-step-budget') as FakeElement);
    expect(findByData(rig.root, 'data-launch-step', 'budget')).not.toBeNull();

    click(rig, findByData(rig.root, 'data-action', 'launch-step-review') as FakeElement);
    expect(findByData(rig.root, 'data-launch-step', 'review')).not.toBeNull();

    const arm = findByData(rig.root, 'data-action', 'confirm-arm-launch');
    if (arm === null) throw new Error('the unarmed confirm renders no arm button');
    click(rig, arm); // arm
    expect(findByData(rig.root, 'data-action', 'confirm-cancel-launch')).not.toBeNull();
    const go = findByData(rig.root, 'data-action', 'confirm-launch');
    if (go === null) throw new Error('the armed confirm renders no confirm button');
    click(rig, go); // confirm -> submitLaunch (the offline transport fails it gracefully)
    await settle();
    expect(rig.handle.state().launch.phase).toBe('failed');
    expect(elementsOf(rig.root).some((element) => element.hasClass('error-card'))).toBe(true); // the failure renders
  });

  it('the palette opens by CLICK (the affordance) and closes on Escape', async () => {
    const rig = await bootRig({ tradrl_onboarded: 'true' });
    const affordance = findByData(rig.root, 'data-action', 'palette-open');
    if (affordance === null) throw new Error('no palette affordance in the sidebar');
    click(rig, affordance);
    const overlay = elementsOf(rig.root).find((element) => element.hasClass('palette-backdrop'));
    expect(overlay, 'the palette overlay renders on click').toBeDefined();
    expect(findByData(rig.root, 'data-palette-input', 'true')).not.toBeNull();
    rig.doc.fire('keydown', { target: null, key: 'Escape' });
    expect(elementsOf(rig.root).some((element) => element.hasClass('palette-backdrop'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// THE REAL-LOADER PIN — the same interaction executes through the
// module graph the browser actually boots (strip-types + data: URLs).
// ---------------------------------------------------------------------------

describe('executed boot: the REAL no-build loader path', () => {
  it('the stripped app module boots, mounts and advances the wizard on a delegated click (the loader path executes, not just compiles)', async () => {
    const bindings: LoaderBindings = {
      async readModule(path: string): Promise<string> {
        return readFileSync(resolve(APPS_WEB, path), 'utf8');
      },
      async createModuleUrl(code: string): Promise<string> {
        return `data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`;
      },
      async importModule(url: string): Promise<unknown> {
        return await import(url);
      },
    };
    const module = (await loadModuleGraph('./src/app/console.ts', bindings)) as { bootConsole: typeof bootConsole };
    expect(typeof module.bootConsole).toBe('function');
    const storage = new MapStorage();
    const handle = module.bootConsole({
      baseUrl: 'http://scripted.invalid',
      token: 'token-test',
      scope: { tenantId: 'tenant-a', projectId: 'prj-a' },
      transport: offlineTransport,
      instants: { nowMs: () => T0 + 1000 },
      onboardingStorage: storage,
    });
    const doc = new FakeDocument();
    const root = new FakeElement('div');
    handle.mount(root as unknown as Parameters<ConsoleHandle['mount']>[0], doc as unknown as Parameters<ConsoleHandle['mount']>[1]);
    await handle.refresh();
    expect(countByClass(root, 'onboarding')).toBe(1); // one wizard on the real loader path too
    doc.fire('click', { target: findByData(root, 'data-action', 'onboarding-next') });
    expect(findByData(root, 'data-onboarding', 'step-2')).not.toBeNull(); // the click ACTS
  });
});
