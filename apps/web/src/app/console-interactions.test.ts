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
import { describe, expect, it, vi } from 'vitest';
import type { ApiTransport } from '../api/transport';
import type { InstantSource, TickScheduler } from '../core/clock';
import { formatInstantUtc } from '../core/format';
import type { ConsoleHandle } from './console';
import { bootConsole } from './console';
import { bootFromShell } from '../index';
import type { LaunchDraft } from '../core/launch';
import type { JobRecord, OutcomeRecord } from '../api/contracts';
import { viewAtOf } from '../core/workspace';
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
  parent: FakeElement | null = null;
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
  /** The input's live value (the launch-field wiring reads it — the DOM property). */
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
  /** The harness's focus tracker (the browser's focus semantics — typeField/blurField move it like the real thing). */
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

  /** Dispatch one event to every listener of its type (the browser's capture order is irrelevant: one console). */
  fire(type: string, event: { target: FakeElement | null; relatedTarget?: FakeElement | null; key?: string; ctrlKey?: boolean; metaKey?: boolean }): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event as unknown as Record<string, unknown>);
  }

  /** The shell root lookup (index.ts's findConsoleRoot — the browser boot path's own entry). */
  readonly rootsById = new Map<string, FakeElement>();
  getElementById(id: string): FakeElement | null {
    return this.rootsById.get(id) ?? null;
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

/** A SECOND failed job, later in time (a distinct notice id — the "a NEW notice toasts" signal). */
const FAILED_JOB_2: JobRecord = {
  jobId: 'job-2',
  kind: 'research',
  tenant: 'tenant-a',
  project: 'prj-a',
  status: 'failed',
  submittedAt: T0 + 40,
};

/** One scripted scheduled tick (the scheduler seam's test double). */
interface ScheduledTick {
  readonly delayMs: number;
  readonly tick: () => void;
}

/** The scripted scheduler: records schedule() calls; tests fire ticks BY HAND (deterministic beats + toast timers — no wall clock anywhere). */
class ScriptedScheduler implements TickScheduler {
  readonly pending: ScheduledTick[] = [];
  schedule(delayMs: number, tick: () => void): void {
    this.pending.push({ delayMs, tick });
  }
  /** Fire the first pending tick scheduled at exactly the given delay (the toast's 5000ms vs the beat's 1000ms). */
  fireAt(delayMs: number): boolean {
    const index = this.pending.findIndex((entry) => entry.delayMs === delayMs);
    if (index === -1) return false;
    const spliced = this.pending.splice(index, 1);
    const entry = spliced[0];
    if (entry === undefined) return false;
    entry.tick();
    return true;
  }
  /** Fire the OLDEST pending tick (the beat loop's next beat). */
  fireNext(): boolean {
    const entry = this.pending.shift();
    if (entry === undefined) return false;
    entry.tick();
    return true;
  }
}

/** One booted + mounted console on the fake document. */
interface Rig {
  readonly handle: ConsoleHandle;
  readonly doc: FakeDocument;
  readonly root: FakeElement;
  readonly storage: MapStorage;
  /** The injected scheduler (when the test passed one — the beat loop + the toast timers, fired by hand). */
  readonly scheduler: ScriptedScheduler | null;
}

/** The per-rig seam overrides (the scheduler + an instant source other than the fixed one). */
interface RigOverrides {
  readonly scheduler?: ScriptedScheduler;
  readonly instants?: InstantSource;
}

/** Boot the real console with every seam injected and mount it (DOM-free until here — the architecture's law). The project id defaults to the rig's scoped project; pass '' for the LAUNCHPAD (the shipped shell's own default — the primary flow starts there). */
async function bootRig(stored: Record<string, string> = {}, transport: ApiTransport = offlineTransport, projectId = 'prj-a', overrides: RigOverrides = {}): Promise<Rig> {
  const storage = new MapStorage();
  for (const [key, value] of Object.entries(stored)) storage.map.set(key, value);
  const scheduler = overrides.scheduler ?? null;
  const handle = bootConsole({
    baseUrl: 'http://scripted.invalid',
    token: 'token-test',
    scope: { tenantId: 'tenant-a', projectId },
    transport,
    instants: overrides.instants ?? { nowMs: () => T0 + 1000 },
    theme: 'light',
    storage,
    onboardingStorage: storage,
    simulated: true,
    ...(scheduler === null ? {} : { scheduler }),
  });
  const doc = new FakeDocument();
  const root = new FakeElement('div');
  handle.mount(root as unknown as Parameters<ConsoleHandle['mount']>[0], doc as unknown as Parameters<ConsoleHandle['mount']>[1]);
  await handle.refresh(); // settle the boot read cadence (every read degrades — deterministic)
  return { handle, doc, root, storage, scheduler };
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

/** Type into a launch field (the browser's semantics: the focus MOVES into the field first — a focusout fires on the previously focused launch field with relatedTarget = this field — then the input event; the live value rides the DOM property). */
function typeField(rig: Rig, field: string, value: string): void {
  const input = findByData(rig.root, 'data-launch-field', field);
  if (input === null) throw new Error(`no launch field ${field} in the current tree`);
  const prior = rig.doc.focused;
  if (prior !== null && prior.getAttribute('data-launch-field') !== null) {
    rig.doc.fire('focusout', { target: prior, relatedTarget: input }); // the inter-field focus move (never a re-render — the form stays live)
  }
  rig.doc.focused = input;
  input.value = value;
  rig.doc.fire('input', { target: input });
}

/** Blur a launch field (the browser's focusout with the focus leaving the form — §4.11's inline-validation trigger). */
function blurField(rig: Rig, field: string): void {
  const input = findByData(rig.root, 'data-launch-field', field);
  if (input === null) throw new Error(`no launch field ${field} in the current tree`);
  rig.doc.focused = null;
  rig.doc.fire('focusout', { target: input, relatedTarget: null });
}

/** Click the first [data-action] affordance of the current tree. */
function clickAction(rig: Rig, action: string): void {
  const element = findByData(rig.root, 'data-action', action);
  if (element === null) throw new Error(`no ${action} affordance in the current tree`);
  click(rig, element);
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
// J3 — the primary flow, END TO END (the Goal entry + the wired fields +
// the review gate + the two-step confirm + the async progress).
// ---------------------------------------------------------------------------

/** A scripted transport that serves a working launch (the demo backing's honest animation, compressed): meta + reads + project create + the kickoff job + a job that advances running -> complete per poll. */
function launchDemoTransport(): { readonly transport: ApiTransport; readonly polls: { count: number }; readonly createdProjectIds: string[] } {
  const polls = { count: 0 };
  const createdProjectIds: string[] = [];
  const jobOf = (status: 'submitted' | 'running' | 'complete', project: string): JobRecord => ({ jobId: 'job-launch-1', kind: 'research', tenant: 'tenant-a', project, status, submittedAt: T0 + 1000 });
  const projectOf = (id: string, name: string): Record<string, unknown> => ({
    id, tenantId: 'tenant-a', name, executionMode: 'simulation',
    lifecycle: { projectId: id, status: 'active', acceptanceCriteriaId: null, organizationRef: null },
    lineage: { projectId: id, createdAt: T0, createdBy: 'worker', priorVersion: null, version: 1, goal: { goalId: 'goal-1', version: 1 }, constraintSet: { id: 'cs-1', version: 1 } },
    createdAt: T0, updatedAt: T0,
  });
  const ok = (data: unknown) => ({ status: 200, headers: {}, body: { requestId: 'req-1', data } });
  const transport: ApiTransport = async (request) => {
    const key = `${request.method} ${request.path.split('?')[0]}`;
    if (key === 'GET /v1/meta') return ok({ apiVersion: 'v1', supportedVersions: ['v1'], routeFamilies: [] });
    if (key === 'GET /v1/projects/prj-a') return ok(projectOf('prj-a', 'Console Test Project'));
    if (key === 'POST /v1/knowledge/query' || key === 'POST /v1/outcomes/query' || key === 'POST /v1/post-mortems/query') return ok({ items: [] });
    if (key === 'POST /v1/projects') {
      const body = request.body as { readonly id: string; readonly name: string };
      createdProjectIds.push(body.id);
      return ok(projectOf(body.id, body.name));
    }
    if (key === 'POST /v1/jobs/research') {
      const body = request.body as { readonly projectId: string };
      return ok(jobOf('submitted', body.projectId));
    }
    if (key.startsWith('GET /v1/jobs/')) {
      polls.count += 1;
      return ok(jobOf(polls.count === 1 ? 'running' : 'complete', createdProjectIds[0] ?? 'prj-a'));
    }
    return { status: 404, headers: {}, body: { requestId: 'req-1', error: { code: 'not_found', message: 'no route', status: 404 } } };
  };
  return { transport, polls, createdProjectIds };
}

/** A scripted transport shaped like the DEPLOYED backing's clock laws (the W-17a J03 pin): the created project's availability is stamped from the REQUEST's submitted `at` (services/api's own law — the fixtures backing stamps createdAt/updatedAt from input.at, which is the client's launch instant), and the kickoff job animates per poll with server-side observed instants. The PRIOR rigs stamped the created project at T0 — forever in the PAST of the rig's instant source — which is exactly why the local J03 proofs stayed green while the live origin failed deterministically. */
function deployedClockLaunchTransport(): {
  readonly transport: ApiTransport;
  readonly polls: { count: number };
  readonly createdProjectIds: string[];
  readonly researchSubmits: string[];
  /** The submitted `at` of the create request (the created project's availability instant). */
  createAt: number | null;
} {
  const polls = { count: 0 };
  const createdProjectIds: string[] = [];
  const researchSubmits: string[] = [];
  const state: { createAt: number | null } = { createAt: null };
  const jobOf = (status: 'submitted' | 'running' | 'complete', project: string, at: number): JobRecord => ({
    jobId: 'job-launch-1', kind: 'research', tenant: 'tenant-a', project, status,
    submittedAt: at,
    ...(status === 'complete' ? { completedAt: at + 40 } : {}),
  });
  const projectOf = (id: string, name: string, at: number): Record<string, unknown> => ({
    id, tenantId: 'tenant-a', name, executionMode: 'simulation',
    lifecycle: { projectId: id, status: 'active', acceptanceCriteriaId: null, organizationRef: null },
    lineage: { projectId: id, createdAt: at, createdBy: 'worker', priorVersion: null, version: 1, goal: { goalId: 'goal-1', version: 1 }, constraintSet: { id: 'cs-1', version: 1 } },
    createdAt: at, updatedAt: at, // THE DEPLOYED LAW: availability = the submitted `at` (fixtures.ts: createdAt/updatedAt from input.at)
  });
  const ok = (data: unknown) => ({ status: 200, headers: {}, body: { requestId: 'req-1', data } });
  const transport: ApiTransport = async (request) => {
    const key = `${request.method} ${request.path.split('?')[0]}`;
    if (key === 'GET /v1/meta') return ok({ apiVersion: 'v1', supportedVersions: ['v1'], routeFamilies: [] });
    if (key === 'GET /v1/projects/prj-a') return ok(projectOf('prj-a', 'Console Test Project', T0)); // the seeded demo: stamped in the PAST (before every session's boot)
    if (key === 'POST /v1/knowledge/query' || key === 'POST /v1/outcomes/query' || key === 'POST /v1/post-mortems/query') return ok({ items: [] });
    if (key === 'POST /v1/projects') {
      const body = request.body as { readonly id: string; readonly name: string; readonly at: number };
      createdProjectIds.push(body.id);
      state.createAt = body.at;
      return ok(projectOf(body.id, body.name, body.at)); // availability = the client's launch instant (always AFTER the boot anchor)
    }
    if (key === 'POST /v1/jobs/research') {
      const body = request.body as { readonly projectId: string };
      researchSubmits.push(body.projectId);
      return ok(jobOf('submitted', body.projectId, (state.createAt ?? T0) + 15)); // the server observes its own instant at handling (a small skew after the create)
    }
    if (key.startsWith('GET /v1/jobs/')) {
      polls.count += 1;
      const base = (state.createAt ?? T0) + 15;
      return ok(polls.count === 1 ? jobOf('running', createdProjectIds[0] ?? 'prj-a', base) : jobOf('complete', createdProjectIds[0] ?? 'prj-a', base + polls.count * 25));
    }
    return { status: 404, headers: {}, body: { requestId: 'req-1', error: { code: 'not_found', message: 'no route', status: 404 } } };
  };
  return { transport, polls, createdProjectIds, researchSubmits, get createAt() { return state.createAt; } };
}

describe('executed boot: J3 — the primary flow (the launch entry + the wired form)', () => {
  it('the HOME HERO carries the primary flow\'s CTA (the discovery law: the entry is visible from Home, the natural starting point)', async () => {
    const rig = await bootRig({ tradrl_onboarded: 'true' });
    const heroCta = findByData(rig.root, 'data-action', 'launch-start'); // on Home, before any navigation
    if (heroCta === null) throw new Error('the Home hero carries no launch-start affordance');
    expect(heroCta.hasClass('hero-cta')).toBe(true);
    click(rig, heroCta);
    expect(rig.handle.state().launch.phase).toBe('draft'); // the wizard opened WITHOUT leaving Home
    expect(findByData(rig.root, 'data-launch-step', 'goal')).not.toBeNull();
    expect(findByData(rig.root, 'data-hero-launch', 'draft')).not.toBeNull(); // the hero now carries the honest resume note
    expect(findByData(rig.root, 'data-action', 'launch-start')).toBeNull(); // never a dead restart button
  });

  it('the Goal section\'s empty state STARTS the wizard (the missing launch-draft-started dispatcher, now wired)', async () => {
    const rig = await bootRig({ tradrl_onboarded: 'true' });
    clickNav(rig, 'goal');
    const entry = findByData(rig.root, 'data-action', 'launch-start');
    if (entry === null) throw new Error('the Goal empty state carries no launch-start affordance');
    click(rig, entry);
    expect(rig.handle.state().launch.phase).toBe('draft');       // the state machine accepted the draft
    expect(rig.handle.state().launch.draft).not.toBeNull();
    expect(findByData(rig.root, 'data-launch-step', 'goal')).not.toBeNull(); // the wizard renders
    expect(findByData(rig.root, 'data-launch-field', 'name')).not.toBeNull();
    expect(findByData(rig.root, 'data-launch-field', 'objective')).not.toBeNull();
    // a second start is REFUSED while one is in progress (nothing wipes the user's work)
    const restart = findByData(rig.root, 'data-action', 'launch-start');
    if (restart !== null) click(rig, restart);
    expect(rig.handle.state().launch.draft).not.toBeNull();
  });

  it('the FULL form path: type -> flush on the next action -> validate on blur -> review gate -> arm/cancel/arm -> confirm -> the offline submit degrades gracefully', async () => {
    const rig = await bootRig({ tradrl_onboarded: 'true' });
    clickNav(rig, 'goal');
    clickAction(rig, 'launch-start');

    // goal step: typing buffers; the next action's flush commits into the state machine
    typeField(rig, 'name', 'Momentum scout');
    typeField(rig, 'objective', 'Find and keep an edge in momentum.');
    expect(rig.handle.state().launch.draft?.name).toBe(''); // not yet flushed (the buffer is the live form)
    clickAction(rig, 'launch-step-budget');
    expect(rig.handle.state().launch.draft?.name).toBe('Momentum scout'); // the flush committed
    expect(rig.handle.state().launch.draft?.objective).toBe('Find and keep an edge in momentum.');

    // budget step: a bad decimal validates destructively ON BLUR (§4.11), the fix passes
    typeField(rig, 'capitalBudget', '10.5.0');
    blurField(rig, 'capitalBudget');
    expect(countByClass(rig.root, 'field-error')).toBe(1);
    expect(elementsOf(rig.root).some((element) => element.hasClass('field-error') && textOf(element) === 'Enter an exact non-negative decimal.')).toBe(true);
    typeField(rig, 'capitalBudget', '10000.00');
    typeField(rig, 'riskBudget', '250.00');
    blurField(rig, 'capitalBudget');
    expect(countByClass(rig.root, 'field-error')).toBe(0); // silent when valid

    // markets step: csv lists parse at the flush
    clickAction(rig, 'launch-step-markets');
    typeField(rig, 'markets', 'binance:BTC-USDT, kraken:ETH-USDT');
    typeField(rig, 'venues', 'binance');
    typeField(rig, 'dataSources', 'candles:1m');

    // world step: horizon + the execution-mode select + the optional grammars
    clickAction(rig, 'launch-step-world');
    typeField(rig, 'horizonStartsAt', String(T0));
    typeField(rig, 'horizonEndsAt', String(T0 + 86_400_000));
    typeField(rig, 'executionMode', 'shadow');
    typeField(rig, 'preferences', 'rebalance=daily');
    typeField(rig, 'constraints', 'c-1:outcome:risk.maxDrawdown:limit.max:0.2');

    // review: the flush commits everything; the valid draft renders the summary + the arm
    clickAction(rig, 'launch-step-review');
    const draft = rig.handle.state().launch.draft;
    if (draft === null) throw new Error('the draft vanished at review');
    expect(draft.markets).toEqual(['binance:BTC-USDT', 'kraken:ETH-USDT']);
    expect(draft.executionMode).toBe('shadow');
    expect(draft.preferences).toEqual([{ key: 'rebalance', value: 'daily' }]);
    expect(draft.constraints.length).toBe(1);
    expect(findByData(rig.root, 'data-review', 'launch')).not.toBeNull();
    clickAction(rig, 'confirm-arm-launch'); // arm
    expect(findByData(rig.root, 'data-action', 'confirm-cancel-launch')).not.toBeNull();
    clickAction(rig, 'confirm-cancel-launch'); // cancel disarms — the arm button returns (the two-step confirm, §4.11)
    expect(findByData(rig.root, 'data-action', 'confirm-arm-launch')).not.toBeNull();
    clickAction(rig, 'confirm-arm-launch');
    clickAction(rig, 'confirm-launch'); // confirm -> submitLaunch through the real composition
    await settle();
    // the offline transport rejects the composed create: the launch
    // degrades GRACEFULLY (never a crash, never an unhandled rejection)
    // — the error card + the Start over affordance render.
    expect(rig.handle.state().launch.phase).toBe('failed');
    expect(rig.handle.state().launch.error).toContain('offline');
    expect(elementsOf(rig.root).some((element) => element.hasClass('error-card'))).toBe(true);
    clickAction(rig, 'launch-reset'); // Start over -> the idle entry returns
    expect(rig.handle.state().launch.phase).toBe('idle');
    expect(rig.handle.state().launch.draft).toBeNull();
    expect(findByData(rig.root, 'data-launch-idle', 'true')).not.toBeNull();
    expect(findByData(rig.root, 'data-action', 'launch-start')).not.toBeNull();
  });

  it('an inter-field focus move never re-renders (the lost-second-field defect, proven live in a real browser): every typed edit survives', async () => {
    const rig = await bootRig({ tradrl_onboarded: 'true' });
    clickNav(rig, 'goal');
    clickAction(rig, 'launch-start');
    // THE DEFECT (found by the real-browser proof): typing into the
    // SECOND field of a step moves the browser's focus into it — a
    // focusout fires on the first field. A flush+re-render on that
    // move re-projects the tree UNDER the pending focus: the browser
    // strands its focus on a detached node and every keystroke into
    // the new field lands on a dead node, silently lost (objective /
    // riskBudget / venues all dropped). The fix: a focus move whose
    // relatedTarget is another launch field NEVER re-renders.
    const objectiveNode = findByData(rig.root, 'data-launch-field', 'objective');
    if (objectiveNode === null) throw new Error('the objective field is missing before typing');
    typeField(rig, 'name', 'Momentum scout'); // focuses name
    typeField(rig, 'objective', 'Find and keep an edge.'); // the inter-field move: focusout(name, relatedTarget: objective)
    expect(elementsOf(rig.root)).toContain(objectiveNode); // the SAME live node — no re-projection under the focus move
    expect(rig.handle.state().launch.draft?.name).toBe(''); // nothing flushed yet — the buffer is the live form
    // a blur OUT of the form (relatedTarget null) still commits + renders (§4.11):
    typeField(rig, 'name', 'Momentum scout 2');
    blurField(rig, 'name');
    expect(rig.handle.state().launch.draft?.name).toBe('Momentum scout 2');
    clickAction(rig, 'launch-step-review');
    expect(rig.handle.state().launch.draft?.name).toBe('Momentum scout 2'); // BOTH edits carried
    expect(rig.handle.state().launch.draft?.objective).toBe('Find and keep an edge.');
  });

  it('the async progress renders submitted -> running -> complete through the poll cadence (the launchpad boots the primary flow, the demo backing animates it)', async () => {
    const demo = launchDemoTransport();
    // the LAUNCHPAD scope (the shipped shell's own default): no project
    // loaded — the created project is ADOPTED by the launch (the one
    // scope transition the console knows).
    const rig = await bootRig({ tradrl_onboarded: 'true' }, demo.transport, '');
    clickNav(rig, 'goal');
    clickAction(rig, 'launch-start');
    typeField(rig, 'name', 'Momentum scout');
    typeField(rig, 'objective', 'Find and keep an edge in momentum.');
    clickAction(rig, 'launch-step-budget');
    typeField(rig, 'capitalBudget', '10000.00');
    typeField(rig, 'riskBudget', '250.00');
    clickAction(rig, 'launch-step-markets');
    typeField(rig, 'markets', 'binance:BTC-USDT');
    typeField(rig, 'venues', 'binance');
    typeField(rig, 'dataSources', 'candles:1m');
    clickAction(rig, 'launch-step-review');
    clickAction(rig, 'confirm-arm-launch');
    clickAction(rig, 'confirm-launch');
    await settle();
    expect(findByData(rig.root, 'data-launch-phase', 'submitted')).not.toBeNull();
    expect(demo.createdProjectIds.length).toBe(1); // the composed create hit the boundary once
    expect(rig.handle.state().scope.projectId).toBe(demo.createdProjectIds[0]); // the workspace ADOPTED the created project

    await rig.handle.beat(); // poll 1 -> running
    expect(findByData(rig.root, 'data-launch-phase', 'running')).not.toBeNull();
    await rig.handle.beat(); // poll 2 -> complete
    expect(rig.handle.state().launch.phase).toBe('launched');
    expect(findByData(rig.root, 'data-launch-phase', 'complete')).not.toBeNull();
    // the goal panel now carries the loaded project + the goal statement (the launch's own cards)
    expect(elementsOf(rig.root).some((element) => textOf(element) === 'Momentum scout')).toBe(true);
    expect(elementsOf(rig.root).some((element) => textOf(element) === 'Goal statement')).toBe(true);
  });

  it('J03 on the DEPLOYED configuration: the shell boots scoped to a REAL project (the seeded demo), the launch ADOPTS the created project (superseding it) and the progress animates submitted -> running -> complete', async () => {
    // THE LIVE RED (W-12a's catalog finding, J03): the deployed shell
    // boots scoped to prj-demo-console (TRADRL_CONSOLE_PROJECT_ID) and
    // the boot read cadence LOADS that project — the launch's
    // POST /v1/projects 201 then tried to adopt the CREATED project and
    // the workspace refused ("the workspace already adopted project …"),
    // so the journey died at the error card and the async progress
    // NEVER rendered. The fix's law: the launch bridge adopts the
    // created project wherever the workspace was (supersede semantics —
    // the prior project's records leave the sections, the chain keeps
    // everything).
    const demo = launchDemoTransport();
    // prj-a plays the seeded demo project (the deployed shell's project scope).
    const rig = await bootRig({ tradrl_onboarded: 'true' }, demo.transport, 'prj-a');
    expect(rig.handle.state().project?.id).toBe('prj-a'); // the demo project's world loaded at boot (the deployed reality)

    clickNav(rig, 'goal');
    clickAction(rig, 'launch-start');
    typeField(rig, 'name', 'Momentum scout');
    typeField(rig, 'objective', 'Find and keep an edge in momentum.');
    clickAction(rig, 'launch-step-budget');
    typeField(rig, 'capitalBudget', '10000.00');
    typeField(rig, 'riskBudget', '250.00');
    clickAction(rig, 'launch-step-markets');
    typeField(rig, 'markets', 'binance:BTC-USDT');
    typeField(rig, 'venues', 'binance');
    typeField(rig, 'dataSources', 'candles:1m');
    clickAction(rig, 'launch-step-review');
    clickAction(rig, 'confirm-arm-launch');
    clickAction(rig, 'confirm-launch');
    await settle();

    // NO error card: the create succeeded server-side and the adoption superseded the demo project
    expect(rig.handle.state().launch.phase).toBe('launching');
    expect(rig.handle.state().launch.error).toBeNull();
    expect(demo.createdProjectIds.length).toBe(1); // POST /v1/projects created the project (201)
    expect(rig.handle.state().scope.projectId).toBe(demo.createdProjectIds[0]); // the launch ADOPTED it
    expect(rig.handle.state().project?.id).toBe(demo.createdProjectIds[0]);     // the created project IS the workspace's world now
    expect(findByData(rig.root, 'data-launch-phase', 'submitted')).not.toBeNull(); // the progress surface renders
    expect(elementsOf(rig.root).some((element) => element.hasClass('error-card'))).toBe(false);

    await rig.handle.beat(); // poll 1 -> running
    expect(findByData(rig.root, 'data-launch-phase', 'running')).not.toBeNull();
    await rig.handle.beat(); // poll 2 -> complete
    expect(rig.handle.state().launch.phase).toBe('launched');
    expect(findByData(rig.root, 'data-launch-phase', 'complete')).not.toBeNull();
    // the goal panel carries the launched goal; the kickoff job is the workspace's tracked job
    expect(elementsOf(rig.root).some((element) => textOf(element) === 'Momentum scout')).toBe(true);
    expect(rig.handle.state().jobs).toHaveLength(1);
    expect(rig.handle.state().jobs[0]?.status).toBe('complete');
    // the honest terminal render: the Launch (launched) card + the complete progress; never an error card
    expect(elementsOf(rig.root).some((element) => textOf(element) === 'Launch (launched)')).toBe(true);
    expect(elementsOf(rig.root).some((element) => element.hasClass('error-card'))).toBe(false);
    // the workspace STAYS on the adopted project (the launch happened; the demo project's world is superseded)
    expect(rig.handle.state().scope.projectId).toBe(demo.createdProjectIds[0]);
  });

  it('the REVIEW GATE blocks an invalid draft: the problems render, the arm button stays away (executed)', async () => {
    const rig = await bootRig({ tradrl_onboarded: 'true' });
    clickNav(rig, 'goal');
    clickAction(rig, 'launch-start');
    typeField(rig, 'name', 'Momentum scout');
    typeField(rig, 'objective', 'Find and keep an edge.');
    clickAction(rig, 'launch-step-review'); // budgets + lists never filled -> invalid
    expect(findByData(rig.root, 'data-review-problems', '5')).not.toBeNull(); // capital + risk budgets + the three lists (name/objective/horizon/mode are valid)
    expect(findByData(rig.root, 'data-action', 'confirm-arm-launch')).toBeNull(); // never the arm button
  });
});

// ---------------------------------------------------------------------------
// J03's VIEW-INSTANT/AVAILABILITY SEAM (the W-17a fix — the v0.1.0 release
// blocker). The W-16 release acceptance measured the live defect: the LIVE
// view instant is PINNED at the boot instant (the readout stayed at the boot
// time for 4+ minutes while wall-clock advanced), while the created
// project's availability is stamped at the launch's submitted `at` — always
// after boot — so the Goal section's L4 render gate threw the typed
// AvailabilityViolationError at every launch ("Launch (failed)"; no
// POST /v1/jobs/research ever fired; submitted -> running -> complete never
// rendered). The prior rigs could never catch it: their transports stamped
// the created project at T0 (eternally in the past of the pinned anchor)
// and their fixed instant sources never moved between boot and launch. The
// pins below run the DEPLOYED clock shape: an instant source that advances
// like the real clock, and a backing that stamps availability from the
// submitted `at`.
// ---------------------------------------------------------------------------

describe('executed boot: J03 — the view-instant/availability seam (the W-17a fix)', () => {
  it('the LIVE view instant follows the observed now on the BEAT cadence (the W-16 live finding: the readout pinned at boot for 4+ minutes while wall-clock advanced)', async () => {
    const scheduler = new ScriptedScheduler();
    let nowMs = T0;
    const instants: InstantSource = { nowMs: () => (nowMs += 50) }; // the deployed reality: the clock advances between every observation
    const rig = await bootRig({ tradrl_onboarded: 'true' }, offlineTransport, 'prj-a', { scheduler, instants });
    const bootAnchor = rig.handle.state().timeMachine.anchorAt;
    expect(bootAnchor).toBeGreaterThan(T0); // the rig's premise: the anchor was observed AFTER boot reads

    // 4 minutes of wall-clock pass with NO user Time Machine interaction
    // (the W-16 observation window) — then the beats fire.
    nowMs = T0 + 240_000;
    for (let beat = 0; beat < 3; beat += 1) {
      expect(scheduler.fireNext(), `beat ${beat + 1} was scheduled`).toBe(true);
      await settle();
    }

    // THE LIVE VIEW INSTANT TRACKS NOW: the anchor followed the observed
    // instant (LIVE mode renders the world as of NOW — the design's own
    // law, core/timemachine.ts advanceAnchor: "the app observes a fresh
    // injected instant"). RED pre-fix: the anchor stays at bootAnchor.
    const viewAt = viewAtOf(rig.handle.state());
    expect(viewAt).toBeGreaterThan(bootAnchor);
    expect(viewAt).toBeGreaterThanOrEqual(T0 + 240_000);
    // and the mono readout renders the tracked instant (not the boot instant)
    const readout = elementsOf(rig.root).find((element) => element.hasClass('tm-readout'));
    if (readout === undefined) throw new Error('the mono readout is missing');
    expect(textOf(readout)).toBe(formatInstantUtc(viewAt));
  });

  it('the FULL deployed-shape journey: boot scoped to the demo project, minutes pass, launch -> the created project RENDERS (no L4 typed error), the kickoff job fires and submitted -> running -> complete animates', async () => {
    // THE VERBATIM LIVE RED (W-16's release acceptance, J03): the guided
    // spec, review, arm and confirm all work; POST /v1/projects returns
    // 201; the adoption supersedes — and then every launch terminated
    // "Launch (failed)" with "the datum prj-… (available at <launch at>)
    // cannot be rendered at view time <boot instant> — rendering a fact
    // before its availability instant is a typed error (L4)". The pinned
    // anchor made the just-created project eternally post-view-time.
    const demo = deployedClockLaunchTransport();
    const scheduler = new ScriptedScheduler();
    let nowMs = T0;
    const instants: InstantSource = { nowMs: () => (nowMs += 50) };
    const rig = await bootRig({ tradrl_onboarded: 'true' }, demo.transport, 'prj-a', { scheduler, instants });
    expect(rig.handle.state().project?.id).toBe('prj-a'); // the demo project's world loaded at boot (the deployed reality)

    // the user takes minutes on the guided spec (the W-16 repro: fresh
    // load -> wait -> the wizard) — the clock runs far past every
    // availability instant the launch will stamp.
    nowMs = T0 + 240_000;

    clickNav(rig, 'goal'); // the W-16 journey's section — the render that threw live (its card carries the created project)
    clickAction(rig, 'launch-start');
    typeField(rig, 'name', 'Momentum scout');
    typeField(rig, 'objective', 'Find and keep an edge in momentum.');
    clickAction(rig, 'launch-step-budget');
    typeField(rig, 'capitalBudget', '10000.00');
    typeField(rig, 'riskBudget', '250.00');
    clickAction(rig, 'launch-step-markets');
    typeField(rig, 'markets', 'binance:BTC-USDT');
    typeField(rig, 'venues', 'binance');
    typeField(rig, 'dataSources', 'candles:1m');
    clickAction(rig, 'launch-step-review');
    clickAction(rig, 'confirm-arm-launch');
    clickAction(rig, 'confirm-launch');
    await settle();

    // NO L4 typed error: the launch seam re-observed now at the created
    // record's arrival, so the view instant allows rendering the
    // just-created project. RED pre-fix: phase 'failed', the error carries
    // the verbatim live AvailabilityViolationError, and NO kickoff job was
    // ever submitted (the submit path aborted at the render throw).
    expect(rig.handle.state().launch.phase).toBe('launching');
    expect(rig.handle.state().launch.error).toBeNull();
    expect(demo.createdProjectIds.length).toBe(1);                     // POST /v1/projects created the project (201)
    expect(rig.handle.state().scope.projectId).toBe(demo.createdProjectIds[0]); // the launch ADOPTED it (superseding the demo)
    expect(demo.researchSubmits).toEqual([demo.createdProjectIds[0]]); // the kickoff job FIRED (the live finding: it never did)
    expect(findByData(rig.root, 'data-launch-phase', 'submitted')).not.toBeNull(); // the progress surface renders
    expect(elementsOf(rig.root).some((element) => element.hasClass('error-card'))).toBe(false);
    // the Goal section renders the just-created project AT THE LIVE VIEW INSTANT (the L4 gate passes)
    expect(rig.handle.state().project?.id).toBe(demo.createdProjectIds[0]);
    expect(elementsOf(rig.root).some((element) => textOf(element) === 'Momentum scout')).toBe(true);

    // the beats animate the async progress to completion (the launch's
    // own submitted -> running -> complete)
    expect(scheduler.fireNext()).toBe(true); // beat 1 -> poll 1 -> running
    await settle();
    expect(findByData(rig.root, 'data-launch-phase', 'running')).not.toBeNull();
    expect(scheduler.fireNext()).toBe(true); // beat 2 -> poll 2 -> complete
    await settle();
    expect(rig.handle.state().launch.phase).toBe('launched');
    expect(findByData(rig.root, 'data-launch-phase', 'complete')).not.toBeNull();
    expect(elementsOf(rig.root).some((element) => textOf(element) === 'Launch (launched)')).toBe(true);
    expect(elementsOf(rig.root).some((element) => element.hasClass('error-card'))).toBe(false);
    // the anchor kept tracking now through the beats (the view instant never froze again)
    expect(viewAtOf(rig.handle.state())).toBeGreaterThan(T0 + 240_000);
  });
});

// ---------------------------------------------------------------------------
// THE BROWSER BOOT PATH — the shipped shell's own entry (bootFromShell)
// executes end to end: the shell config (the deployed shape — a REAL
// project scope), the parked boot module (the inline bootstrap's
// window.__TRADRL_CONSOLE_BOOT__ seam), localStorage, and THE BEAT
// CADENCE the browser timer seam must arm (the live J03 finding's
// second half: without a scheduler the progress card freezes at
// 'submitted' forever — submitted -> running -> complete NEVER renders).
// ---------------------------------------------------------------------------

describe('executed boot: the BROWSER boot path (bootFromShell arms the beat cadence)', () => {
  it('the shipped entry boots scoped to the demo project, launches, and the SCHEDULER-DRIVEN poll cadence animates submitted -> running -> complete (no manual beat anywhere)', async () => {
    vi.useFakeTimers();
    // THE SHELL'S OWN SEAM: park the real app module where the inline
    // bootstrap parks it (the browser cannot resolve the TS entry
    // itself — the holder is the boot path), stub localStorage (the
    // persisted onboarding), and boot through the shipped entry.
    const app = await import('./console');
    const holder = globalThis as { __TRADRL_CONSOLE_BOOT__?: unknown };
    const parked: unknown = app;
    holder.__TRADRL_CONSOLE_BOOT__ = parked;
    const storage = new MapStorage();
    storage.map.set('tradrl_onboarded', 'true');
    const globals = globalThis as { localStorage?: unknown };
    const hadLocalStorage = Object.prototype.hasOwnProperty.call(globals, 'localStorage');
    const priorLocalStorage = globals.localStorage;
    globals.localStorage = storage;
    const demo = launchDemoTransport();
    const doc = new FakeDocument();
    const root = new FakeElement('div');
    doc.rootsById.set('tradrl-console', root);
    try {
      const handle = await bootFromShell({
        document: doc as unknown as Document,
        config: { token: 'token-test', tenantId: 'tenant-a', projectId: 'prj-a' }, // the DEPLOYED shape: scoped to the seeded project
        transport: demo.transport,
      });
      expect(handle).not.toBeNull();
      await vi.advanceTimersByTimeAsync(0); // settle the boot read cadence's microtasks
      expect(handle?.state().project?.id).toBe('prj-a'); // the demo project's world loaded (the deployed reality)

      // the full primary flow through the delegated layer (the browser's own events)
      // (scheduler: null — this rig booted through the REAL bootFromShell, whose
      // browser scheduler the fake timers own; there is no scripted scheduler to
      // fire by hand here.)
      const rig: Rig = { handle: handle as ConsoleHandle, doc, root, storage, scheduler: null };
      clickNav(rig, 'goal');
      clickAction(rig, 'launch-start');
      typeField(rig, 'name', 'Momentum scout');
      typeField(rig, 'objective', 'Find and keep an edge in momentum.');
      clickAction(rig, 'launch-step-budget');
      typeField(rig, 'capitalBudget', '10000.00');
      typeField(rig, 'riskBudget', '250.00');
      clickAction(rig, 'launch-step-markets');
      typeField(rig, 'markets', 'binance:BTC-USDT');
      typeField(rig, 'venues', 'binance');
      typeField(rig, 'dataSources', 'candles:1m');
      clickAction(rig, 'launch-step-review');
      clickAction(rig, 'confirm-arm-launch');
      clickAction(rig, 'confirm-launch');
      await vi.advanceTimersByTimeAsync(0); // settle the composed submit

      expect(demo.createdProjectIds.length).toBe(1);                              // POST /v1/projects created the project
      expect(handle?.state().scope.projectId).toBe(demo.createdProjectIds[0]);    // the launch ADOPTED it (superseding the demo project)
      expect(findByData(root, 'data-launch-phase', 'submitted')).not.toBeNull();  // the progress surface renders

      // THE CADENCE: the beats fire from the SCHEDULER (the browser
      // timer seam), never from the test — the animation the live
      // deployment never rendered (its boot injected no scheduler).
      await vi.advanceTimersByTimeAsync(1000); // beat 1 -> running
      expect(findByData(root, 'data-launch-phase', 'running')).not.toBeNull();
      await vi.advanceTimersByTimeAsync(1000); // beat 2 -> complete
      expect(handle?.state().launch.phase).toBe('launched');
      expect(findByData(root, 'data-launch-phase', 'complete')).not.toBeNull();
      expect(handle?.state().jobs[0]?.status).toBe('complete'); // the kickoff job tracked through the cadence
    } finally {
      vi.useRealTimers();
      delete holder.__TRADRL_CONSOLE_BOOT__;
      if (hadLocalStorage) globals.localStorage = priorLocalStorage;
      else delete globals.localStorage;
    }
  });
});

// ---------------------------------------------------------------------------
// J7 — the evidence capsules (the §4.9 surface: the badge opens the
// payload + provenance inline; capsules render inline from Outcomes /
// Decisions; a raw evidence ref answers honestly, never silently).
// ---------------------------------------------------------------------------

/** One outcome record (the Evidence capsule's source). */
function outcomeRecord(): OutcomeRecord {
  return {
    outcomeId: 'out-1', ordinal: 1, tenant: 'tenant-a', project: 'prj-a',
    decision: { decisionRef: 'dec-1', intentRef: 'int-1', disposition: 'filled' },
    outcomeClass: 'realized-profit',
    expectation: { expectedQuantity: '10', expectedRealized: '1.5', tolerance: '0.25', declaredBy: 'b1' },
    realization: { filledQuantity: '10', realizedOutcome: '1.75', feeTotal: '0.02', notionalTotal: '1000.00', unrealizedAtDecision: '0.00' },
    deviation: { quantityShortfall: null, realizedGap: '0.25', withinTolerance: true },
    evidence: [{ kind: 'fill', ref: 'fil-1' }],
    lineage: { shadow: { fidelity: { mode: 'shadow' }, riskPolicy: { policyId: 'pol-1', version: 2 }, experiment: null } },
    asOf: T0 + 30, priorChainHead: '00000000',
  } as unknown as OutcomeRecord;
}

describe('executed boot: J7 — the evidence capsules (§4.9 open/close)', () => {
  it('the Evidence section lists capsules with mono content-address badges; opening one renders the payload + provenance INLINE; closing works', async () => {
    const rig = await bootRig({ tradrl_onboarded: 'true' });
    rig.handle.dispatch({ kind: 'outcomes-loaded', at: T0 + 30, records: [outcomeRecord()] }); // the sanctioned write path
    clickNav(rig, 'evidence');
    const badge = elementsOf(rig.root).find((element) => element.getAttribute('data-action') === 'capsule-open');
    if (badge === undefined) throw new Error('the Evidence section renders no capsule badge');
    const capsuleId = badge.getAttribute('data-capsule-open') as string;
    expect(capsuleId.startsWith('evc:')).toBe(true);              // the mono content address
    expect(badge.getAttribute('aria-expanded')).toBe('false');    // closed
    expect(countByData(rig.root, 'data-capsule-open', capsuleId)).toBe(1); // the badge only — no payload yet

    click(rig, badge); // open
    expect(countByData(rig.root, 'data-capsule-open', capsuleId)).toBe(2); // the badge + the payload
    const payload = elementsOf(rig.root).find((element) => element.hasClass('capsule-payload'));
    if (payload === undefined) throw new Error('the opened capsule renders no payload');
    const mono = elementsOf(rig.root).find((element) => element.hasClass('capsule-mono'));
    if (mono === undefined) throw new Error('the payload carries no mono block');
    expect(textOf(mono)).toContain('disposition: filled');        // the record's own typed facts, verbatim
    expect(textOf(mono)).toContain('fill:fil-1');                 // the record's evidence refs, verbatim (L20 — never recomputed)
    const provenance = elementsOf(rig.root).find((element) => element.hasClass('capsule-provenance'));
    if (provenance === undefined) throw new Error('the payload carries no provenance line');
    expect(textOf(provenance)).toContain('/v1/outcomes/query');   // R45: the source route names itself
    expect(textOf(provenance)).toContain('outcome out-1');
    const openBadge = elementsOf(rig.root).find((element) => element.getAttribute('data-action') === 'capsule-open');
    if (openBadge === undefined) throw new Error('the badge vanished while open');
    expect(openBadge.getAttribute('aria-expanded')).toBe('true');

    click(rig, openBadge); // close (the toggle)
    expect(countByData(rig.root, 'data-capsule-open', capsuleId)).toBe(1); // the badge only again
  });

  it('capsules render INLINE from Outcomes (the outcome\'s own badge opens the payload)', async () => {
    const rig = await bootRig({ tradrl_onboarded: 'true' });
    rig.handle.dispatch({ kind: 'outcomes-loaded', at: T0 + 30, records: [outcomeRecord()] });
    clickNav(rig, 'outcomes');
    const badge = elementsOf(rig.root).find((element) => element.getAttribute('data-action') === 'capsule-open');
    if (badge === undefined) throw new Error('the Outcomes section renders no inline capsule badge');
    expect(findByData(rig.root, 'data-row', 'outcome:out-1')).not.toBeNull(); // the outcome row renders too
    click(rig, badge);
    expect(elementsOf(rig.root).some((element) => element.hasClass('capsule-payload'))).toBe(true);
    expect(elementsOf(rig.root).some((element) => element.hasClass('capsule-mono'))).toBe(true);
  });

  it('capsules render INLINE from Decisions (the submission\'s badge + the stream card\'s raw evidence ref answers honestly)', async () => {
    const rig = await bootRig({ tradrl_onboarded: 'true' });
    rig.handle.dispatch({
      kind: 'submission-recorded', at: T0 + 20,
      submission: { kind: 'routed', submissionId: 'sub-1', decisionId: 'dec-1', auditId: 'aud-1', requestRef: 'req-1', venue: 'venue-x', adapterRef: 'ad-1', channelRef: 'ch-1', routedAt: T0 + 20 },
    });
    clickNav(rig, 'decisions');
    // the submission's own capsule renders inline
    const badges = elementsOf(rig.root).filter((element) => element.getAttribute('data-action') === 'capsule-open');
    expect(badges.length).toBeGreaterThanOrEqual(2); // the stream card's evidence badge + the submission's own capsule badge
    const capsuleBadge = badges.find((badge) => (badge.getAttribute('data-capsule-open') as string).startsWith('evc:'));
    if (capsuleBadge === undefined) throw new Error('the Decisions section renders no inline capsule badge');
    click(rig, capsuleBadge);
    expect(elementsOf(rig.root).some((element) => element.hasClass('capsule-payload'))).toBe(true);
    expect(elementsOf(rig.root).some((element) => element.hasClass('capsule-provenance'))).toBe(true);
    // the stream card's RAW evidence ref (gateway-audit:aud-1) opens the honest reference-only render — never a silent no-op
    const rawBadge = badges.find((badge) => badge.getAttribute('data-capsule-open') === 'gateway-audit:aud-1');
    if (rawBadge === undefined) throw new Error('the stream card renders no evidence badge');
    click(rig, rawBadge);
    const mono = elementsOf(rig.root).find((element) => element.hasClass('capsule-mono'));
    if (mono === undefined) throw new Error('the raw evidence ref renders no payload');
    expect(textOf(mono)).toContain('gateway-audit:aud-1'); // the ref, verbatim
    const provenance = elementsOf(rig.root).find((element) => element.hasClass('capsule-provenance'));
    if (provenance === undefined) throw new Error('the raw evidence ref renders no provenance');
    expect(textOf(provenance)).toContain('L20'); // the honest provenance note
  });
});

// ---------------------------------------------------------------------------
// J8 — the command palette QUERY (the W-14c fix: the dead input wiring).
// The live catalog finding: the palette opens, the entries render grouped
// with type badges and Enter navigates — but TYPING NEVER FILTERS (no
// input-event wiring exists for [data-palette-input]; the pure
// fuzzyScore/rankPalette machinery in core/palette.ts was only ever fed
// the never-changing empty query). These tests pin the WIRING through
// the executed boot: the input event must feed view.palette.query and
// re-render the ranked results through the EXISTING pure machinery.
// ---------------------------------------------------------------------------

/** Type a query into the palette's input (the browser's semantics: the live value rides the DOM property, then the input event fires — the same event the delegated listener receives). */
function typePaletteQuery(rig: Rig, query: string): void {
  const input = findByData(rig.root, 'data-palette-input', 'true');
  if (input === null) throw new Error('the palette input is not in the current tree');
  input.value = query;
  rig.doc.fire('input', { target: input });
}

describe('executed boot: J8 — the command palette query (the dead input wiring)', () => {
  it('typing in the palette input FILTERS + RANKS the results through the pure machinery (the input event feeds the query)', async () => {
    const rig = await bootRig({ tradrl_onboarded: 'true' });
    clickAction(rig, 'palette-open');
    expect(countByClass(rig.root, 'palette-item')).toBe(15); // the opened state: every navigation target (the offline transport loads no entities)

    typePaletteQuery(rig, 'risk'); // the exact live repro: type anything -> the list must change
    expect(countByClass(rig.root, 'palette-item')).toBe(2); // the subsequence matches survive: risk (the tight run) + experiments (the scattered r-i-s-k)
    const item = elementsOf(rig.root).find((element) => element.hasClass('palette-item'));
    if (item === undefined) throw new Error('the filtered palette renders no item');
    expect(item.getAttribute('data-palette-ref')).toBe('nav:risk'); // best-first inside the group: the tight prefix run outranks the scattered match
    expect(item.getAttribute('data-target')).toBe('risk');

    // the re-projected input keeps the typed query as its value (the tree is rebuilt per render)
    const input = findByData(rig.root, 'data-palette-input', 'true');
    if (input === null) throw new Error('the palette input vanished mid-query');
    expect(input.getAttribute('value')).toBe('risk');

    // every keystroke re-ranks live: a letter no haystack carries empties the list
    typePaletteQuery(rig, 'risky');
    expect(countByClass(rig.root, 'palette-item')).toBe(0);
  });

  it('the no-match state renders the §4.12 teaching shape (icon + title + ONE sentence + ONE action) and Clear search restores the full list', async () => {
    const rig = await bootRig({ tradrl_onboarded: 'true' });
    clickAction(rig, 'palette-open');
    typePaletteQuery(rig, 'zzzz');
    const empty = elementsOf(rig.root).find((element) => element.hasClass('palette-empty'));
    if (empty === undefined) throw new Error('a no-match query renders no empty state (a blank region — the D3 law)');
    expect(empty.getAttribute('role')).toBe('status');
    expect(elementsOf(rig.root).some((element) => element.hasClass('empty-circle'))).toBe(true); // the icon
    expect(elementsOf(rig.root).some((element) => element.hasClass('empty-title') && textOf(element) === 'No matches')).toBe(true);
    expect(elementsOf(rig.root).some((element) => element.hasClass('empty-sentence') && textOf(element).includes('zzzz'))).toBe(true); // the sentence names the query
    const clear = elementsOf(rig.root).find((element) => element.hasClass('empty-action'));
    if (clear === undefined) throw new Error('the palette empty state renders no action');
    expect(textOf(clear)).toBe('Clear search');
    expect(clear.getAttribute('data-action')).toBe('palette-clear');
    click(rig, clear);
    expect(countByClass(rig.root, 'palette-item')).toBe(15); // the full list is back
    const input = findByData(rig.root, 'data-palette-input', 'true');
    if (input === null) throw new Error('the palette input vanished');
    expect(input.getAttribute('value')).toBe('');
  });

  it('the query reaches the ENTITY entries (the evidence capsules) — the palette filters every kind it covers, not just navigation', async () => {
    const rig = await bootRig({ tradrl_onboarded: 'true' });
    rig.handle.dispatch({ kind: 'outcomes-loaded', at: T0 + 30, records: [outcomeRecord()] }); // the sanctioned write path
    clickAction(rig, 'palette-open');
    expect(countByClass(rig.root, 'palette-item')).toBe(16); // 15 navigation + the outcome capsule
    typePaletteQuery(rig, 'evc:');
    const items = elementsOf(rig.root).filter((element) => element.hasClass('palette-item'));
    expect(items.length).toBe(1);
    expect((items[0] as FakeElement).getAttribute('data-palette-ref')?.startsWith('capsule:evc:')).toBe(true);
    expect((items[0] as FakeElement).getAttribute('data-target')).toBe('evidence');
  });

  it('keyboard select on a FILTERED query: Enter opens the top result and closes the palette', async () => {
    const rig = await bootRig({ tradrl_onboarded: 'true' });
    clickAction(rig, 'palette-open');
    typePaletteQuery(rig, 'time');
    rig.doc.fire('keydown', { target: null, key: 'Enter' });
    expect(findByData(rig.root, 'data-section', 'time-machine')).not.toBeNull(); // navigated to the filtered target
    expect(shellOf(rig.root).getAttribute('data-active-target')).toBe('time-machine');
    expect(elementsOf(rig.root).some((element) => element.hasClass('palette-backdrop'))).toBe(false); // the palette closed
  });

  it('clicking a palette result navigates AND closes the dialog (the modal selection law — the same behavior as Enter)', async () => {
    const rig = await bootRig({ tradrl_onboarded: 'true' });
    clickAction(rig, 'palette-open');
    typePaletteQuery(rig, 'settings');
    const item = elementsOf(rig.root).find((element) => element.hasClass('palette-item'));
    if (item === undefined) throw new Error('no filtered item to click');
    click(rig, item);
    expect(findByData(rig.root, 'data-settings', 'theme')).not.toBeNull(); // Settings opened
    expect(elementsOf(rig.root).some((element) => element.hasClass('palette-backdrop'))).toBe(false); // the dialog closed
  });
});

// ---------------------------------------------------------------------------
// J5 — the Time Machine (the J-catalog's RED half): the scrubber drag
// (data-action=tm-scrub — INERT on the deployed console: flow.ts renders
// it, no handler consumes it) and the PLAYBACK beat (frozen at fromAt:
// the beat scheduler only armed when a scheduler is INJECTED — the
// browser boot passed none).
// ---------------------------------------------------------------------------

describe('executed boot: J5 — the Time Machine (the scrubber + the playback beat)', () => {
  it('the scrubber DRAG: input events buffer (nothing commits mid-drag), the change COMMIT moves the view instant (mode -> timestamp, the mono readout follows)', async () => {
    // The ADVANCING instant source: the anchor drifts past the opened
    // instant when the app observes a fresh one, so the scrubber's
    // range is REAL (a degenerate min === max rig would make the drag
    // vacuous).
    let nowMs = T0;
    const instants: InstantSource = { nowMs: () => (nowMs += 50) };
    const rig = await bootRig({ tradrl_onboarded: 'true' }, offlineTransport, 'prj-a', { instants });
    // The scripted clock jumps forward (minutes pass) and the app
    // observes a fresh live instant — the anchor's own law (advanceAnchor
    // runs on the view transitions; the scripted source continues FROM
    // the jump so the anchor never regresses).
    nowMs = T0 + 5_000;
    rig.handle.dispatch({ kind: 'view-live', at: instants.nowMs() });
    const scrubber = findByData(rig.root, 'data-action', 'tm-scrub');
    if (scrubber === null) throw new Error('the Time Machine renders no scrubber');
    const state = rig.handle.state();
    const anchor = state.timeMachine.anchorAt;
    const floor = Math.min(state.openedAt, anchor);
    expect(anchor).toBeGreaterThan(floor); // the rig guarantees a non-degenerate scrub range

    // THE DRAG: input events fire per pointer move — they must NOT
    // dispatch (a re-render under the pointer replaces the range input
    // and the browser drops the drag — the same silent-no-op class the
    // J3 pointer gate closes for the launch form).
    scrubber.value = String(anchor - 100);
    rig.doc.fire('input', { target: scrubber });
    expect(rig.handle.state().timeMachine.mode).toBe('live'); // nothing committed mid-drag

    // THE RELEASE: the change event commits the scrubbed instant.
    rig.doc.fire('change', { target: scrubber });
    expect(rig.handle.state().timeMachine.mode).toBe('timestamp');
    expect(rig.handle.state().timeMachine.timestamp).toBe(anchor - 100);
    const readout = elementsOf(rig.root).find((element) => element.hasClass('tm-readout'));
    if (readout === undefined) throw new Error('the mono readout is missing');
    expect(textOf(readout)).toBe(formatInstantUtc(anchor - 100)); // the readout follows the drag

    // A hostile value beyond the anchor CLAMPS to the anchor (the view instant may never point after it — the machine's typed law).
    const again = findByData(rig.root, 'data-action', 'tm-scrub');
    if (again === null) throw new Error('the scrubber vanished after the commit');
    const anchorBeforeClamp = rig.handle.state().timeMachine.anchorAt;
    again.value = String(anchorBeforeClamp + 5_000_000);
    rig.doc.fire('input', { target: again });
    rig.doc.fire('change', { target: again });
    expect(rig.handle.state().timeMachine.mode).toBe('timestamp');
    expect(rig.handle.state().timeMachine.timestamp).toBe(anchorBeforeClamp); // clamped to the anchor — never the future
  });

  it('the beat loop advances armed playback (the scheduler seam): each scripted beat is one controlled step, the readout moves with it', async () => {
    const scheduler = new ScriptedScheduler();
    let nowMs = T0;
    const instants: InstantSource = { nowMs: () => (nowMs += 100) };
    const rig = await bootRig({ tradrl_onboarded: 'true' }, offlineTransport, 'prj-a', { scheduler, instants });
    nowMs = T0 + 60_000; // the scripted clock jumps forward — the playback span is real and the anchor never regresses
    rig.handle.dispatch({ kind: 'view-live', at: instants.nowMs() });
    clickAction(rig, 'tm-mode-playback'); // arm playback from the opened instant, step 500ms
    const armed = rig.handle.state().timeMachine.playback;
    if (armed === null) throw new Error('playback did not arm');
    expect(armed.ticks).toBe(0);

    for (let beat = 0; beat < 3; beat += 1) {
      expect(scheduler.fireNext(), `beat ${beat + 1} was scheduled`).toBe(true);
      await settle(); // beat() settles before the loop re-arms
    }
    const playback = rig.handle.state().timeMachine.playback;
    if (playback === null) throw new Error('the beats disarmed playback');
    expect(playback.ticks).toBe(3); // one controlled step per beat
    const readout = elementsOf(rig.root).find((element) => element.hasClass('tm-readout'));
    if (readout === undefined) throw new Error('the mono readout is missing');
    expect(textOf(readout)).toBe(formatInstantUtc(playback.fromAt + playback.ticks * playback.stepMs)); // advancing, not frozen
  });

  it('the beat NEVER throws when playback sits AT the anchor (the pure machine\'s tick-past-anchor input error is the app layer\'s to guard — the browser beat loop must not spray unhandled rejections)', async () => {
    const scheduler = new ScriptedScheduler();
    // The FIXED instant source: openedAt === anchorAt, so playback arms with a ZERO span.
    const rig = await bootRig({ tradrl_onboarded: 'true' }, offlineTransport, 'prj-a', { scheduler });
    clickAction(rig, 'tm-mode-playback');
    const armed = rig.handle.state().timeMachine.playback;
    if (armed === null) throw new Error('playback did not arm');
    expect(rig.handle.state().timeMachine.anchorAt).toBe(armed.fromAt); // the zero-span premise
    await expect(rig.handle.beat()).resolves.toBeUndefined(); // RED on the unguarded tree: tickPlayback throws
    const after = rig.handle.state().timeMachine.playback;
    if (after === null) throw new Error('the beat disarmed playback');
    expect(after.ticks).toBe(0); // the guard SKIPPED the dispatch (no view past the anchor)
  });
});

// ---------------------------------------------------------------------------
// J9 — the OFFLINE state (the W-14c fix: the never-dispatched 'offline').
// The live catalog finding: blocking the API renders DEGRADED (amber),
// never the catalog's UNREACHABLE surface — console.ts's only
// connection-changed dispatch carries 'connected'; a failed read maps to
// degraded-read ('degraded') unconditionally, so 'offline' (the rose
// UNREACHABLE block + Home's ErrorState with its Try again pill) was
// state-machine+test-only. THE TRIAGE: a TRANSPORT-level failure (the
// unavailable family) while the workspace knows NOTHING is the API
// being UNREACHABLE; a failure with the last known world present stays
// DEGRADED (the proven graceful path, guarded below).
// ---------------------------------------------------------------------------

/** A toggleable transport (J9's offline -> recovery -> degraded cycle): every call fails while blocked; while open, the meta negotiation + the prj-a reads succeed with honest shapes (an active project, empty pages). */
function toggleTransport(): { readonly transport: ApiTransport; block(): void; unblock(): void } {
  let blocked = true;
  const project = {
    id: 'prj-a', tenantId: 'tenant-a', name: 'Console Test Project', executionMode: 'simulation',
    lifecycle: { projectId: 'prj-a', status: 'active', acceptanceCriteriaId: null, organizationRef: null },
    lineage: { projectId: 'prj-a', createdAt: T0, createdBy: 'worker', priorVersion: null, version: 1, goal: { goalId: 'goal-1', version: 1 }, constraintSet: { id: 'cs-1', version: 1 } },
    createdAt: T0, updatedAt: T0,
  };
  const ok = (data: unknown) => ({ status: 200, headers: {}, body: { requestId: 'req-1', data } });
  const transport: ApiTransport = async (request) => {
    if (blocked) throw new Error('offline: the scripted transport rejects every read');
    const key = `${request.method} ${request.path.split('?')[0]}`;
    if (key === 'GET /v1/meta') return ok({ apiVersion: 'v1', supportedVersions: ['v1'], routeFamilies: [] });
    if (key === 'GET /v1/projects/prj-a') return ok(project);
    if (key === 'POST /v1/knowledge/query' || key === 'POST /v1/outcomes/query' || key === 'POST /v1/post-mortems/query') return ok({ items: [] });
    return { status: 404, headers: {}, body: { requestId: 'req-1', error: { code: 'not_found', message: 'no route', status: 404 } } };
  };
  return { transport, block: (): void => { blocked = true; }, unblock: (): void => { blocked = false; } };
}

/** A transport where the API ANSWERS but the project read returns a typed not_found: the API is reachable — never the offline surface. */
function typedFailureTransport(): ApiTransport {
  const ok = (data: unknown) => ({ status: 200, headers: {}, body: { requestId: 'req-1', data } });
  return async (request) => {
    const key = `${request.method} ${request.path.split('?')[0]}`;
    if (key === 'GET /v1/meta') return ok({ apiVersion: 'v1', supportedVersions: ['v1'], routeFamilies: [] });
    if (key === 'GET /v1/projects/prj-a') return { status: 404, headers: {}, body: { requestId: 'req-1', error: { code: 'not_found', message: 'the project does not exist', status: 404 } } };
    if (key === 'POST /v1/knowledge/query' || key === 'POST /v1/outcomes/query' || key === 'POST /v1/post-mortems/query') return ok({ items: [] });
    return { status: 404, headers: {}, body: { requestId: 'req-1', error: { code: 'not_found', message: 'no route', status: 404 } } };
  };
}

/** The connection block's state label (LIVE / DEGRADED / UNREACHABLE / CONNECTING — the label is the contract, never color alone). */
function connectionLabelOf(rig: Rig): string {
  const label = elementsOf(rig.root).find((element) => element.hasClass('conn-state-label'));
  if (label === undefined) throw new Error('the connection block renders no state label');
  return textOf(label);
}

describe('executed boot: J9 — the offline state (the boot/initial-read total failure)', () => {
  it('a total transport failure with NOTHING known renders the OFFLINE surface: the UNREACHABLE connection block + Home\'s ErrorState with its Try again pill — and Try again RECOVERS', async () => {
    const api = toggleTransport(); // starts BLOCKED: every read fails at the transport level
    const rig = await bootRig({ tradrl_onboarded: 'true' }, api.transport);

    // the offline surface (§1.3 + §4.12): the rose UNREACHABLE block + the Home ErrorState
    expect(rig.handle.state().connection).toBe('offline');
    expect(connectionLabelOf(rig)).toBe('UNREACHABLE');
    expect(elementsOf(rig.root).some((element) => element.hasClass('connection-offline'))).toBe(true);
    const alert = elementsOf(rig.root).find((element) => element.hasClass('error-state'));
    if (alert === undefined) throw new Error('Home renders no ErrorState while offline with nothing known');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(elementsOf(rig.root).some((element) => element.hasClass('error-sentence') && textOf(element) === 'The console could not reach the API.')).toBe(true);
    const retry = elementsOf(rig.root).find((element) => element.hasClass('error-retry'));
    if (retry === undefined) throw new Error('the ErrorState renders no Try again pill');
    expect(retry.getAttribute('data-action')).toBe('refresh');
    // the degraded notes still record the failure (the popover's degradation row + the technical details)
    expect(rig.handle.state().degraded.length).toBeGreaterThan(0);

    // RECOVERY: unblock the transport + Try again -> LIVE + the world loads + the ErrorState is gone
    api.unblock();
    click(rig, retry);
    await settle();
    await settle();
    expect(rig.handle.state().connection).toBe('connected');
    expect(connectionLabelOf(rig)).toBe('LIVE');
    expect(rig.handle.state().project?.id).toBe('prj-a');
    expect(elementsOf(rig.root).some((element) => element.hasClass('error-state'))).toBe(false);
    expect(elementsOf(rig.root).some((element) => textOf(element) === 'prj-a')).toBe(true); // the loaded world renders (the organization card's Project detail)
  });

  it('the DEGRADED path (the proven graceful path, guarded): a failure WITH the last known world stays amber + renders the world — never offline — and still recovers', async () => {
    const api = toggleTransport();
    const rig = await bootRig({ tradrl_onboarded: 'true' }, api.transport);
    api.unblock(); // recover the boot: the world loads
    click(rig, elementsOf(rig.root).find((element) => element.hasClass('error-retry')) as FakeElement);
    await settle();
    await settle();
    expect(rig.handle.state().connection).toBe('connected');
    expect(rig.handle.state().project?.id).toBe('prj-a');

    // the API goes away WITH the world known -> DEGRADED (amber) + the last known world
    api.block();
    click(rig, findByData(rig.root, 'data-action', 'refresh') as FakeElement); // the connection popover's Retry connection
    await settle();
    await settle();
    expect(rig.handle.state().connection).toBe('degraded');
    expect(connectionLabelOf(rig)).toBe('DEGRADED');
    expect(rig.handle.state().project?.id).toBe('prj-a'); // the last known world survives in the state
    expect(elementsOf(rig.root).some((element) => textOf(element) === 'prj-a')).toBe(true); // ...and on the surface (the organization card's Project detail)
    expect(elementsOf(rig.root).some((element) => element.hasClass('error-state'))).toBe(false); // never the offline ErrorState with data known

    // and the recovery still works (Try again -> LIVE)
    api.unblock();
    click(rig, findByData(rig.root, 'data-action', 'refresh') as FakeElement);
    await settle();
    await settle();
    expect(rig.handle.state().connection).toBe('connected');
    expect(connectionLabelOf(rig)).toBe('LIVE');
  });

  it('the FAMILY GATE: a typed API error (the API ANSWERS) with nothing known is DEGRADED, never the offline surface', async () => {
    const rig = await bootRig({ tradrl_onboarded: 'true' }, typedFailureTransport());
    expect(rig.handle.state().connection).toBe('degraded'); // the API responded — it is not unreachable
    expect(connectionLabelOf(rig)).toBe('DEGRADED');
    expect(elementsOf(rig.root).some((element) => element.hasClass('connection-offline'))).toBe(false);
    expect(elementsOf(rig.root).some((element) => element.hasClass('error-state'))).toBe(false); // no ErrorState: the API is reachable
  });
});

// ---------------------------------------------------------------------------
// J6 — the inbox read toggle + the toast lifecycle (the J-catalog's RED
// half): the per-notice notice-read dispatch (the workspace supported
// it; NO affordance dispatched it — and the delegated row branch would
// have swallowed the click anyway) and the toast (auto-dismiss needs
// the scheduler seam; the close button was never rendered; the re-fire
// guard keeps §4.10's "for NEW notices" honest).
// ---------------------------------------------------------------------------

describe('executed boot: J6 — the inbox read toggle + the toast lifecycle', () => {
  it('the per-notice READ TOGGLE: the affordance renders on unread rows, dispatches notice-read (the row falls to read, the badge drops), and read rows carry none', async () => {
    const rig = await bootRig({ tradrl_onboarded: 'true' });
    rig.handle.dispatch({ kind: 'job-updated', at: T0 + 20, job: FAILED_JOB }); // folds one unread notice
    const notice = rig.handle.state().inbox.notices[0];
    if (notice === undefined) throw new Error('the fixture folded no notice');
    expect(rig.handle.state().inbox.readNoticeIds.includes(notice.noticeId)).toBe(false);
    clickNav(rig, 'inbox');

    const row = findByData(rig.root, 'data-row', `notice:${notice.noticeId}`);
    if (row === null) throw new Error('the Inbox renders no notice row');
    expect(row.hasClass('unread')).toBe(true);
    const markRead = findByData(rig.root, 'data-notice-read', notice.noticeId);
    if (markRead === null) throw new Error('the unread notice row carries no Mark-read affordance'); // RED on the unfixed tree
    expect(markRead.getAttribute('data-action')).toBe('notice-read');

    click(rig, markRead); // the click lives INSIDE the row — the row branch must not swallow it
    expect(rig.handle.state().inbox.readNoticeIds).toContain(notice.noticeId); // the sanctioned write path fired
    const readRow = findByData(rig.root, 'data-row', `notice:${notice.noticeId}`);
    if (readRow === null) throw new Error('the notice row vanished');
    expect(readRow.hasClass('read')).toBe(true);
    expect(findByData(rig.root, 'data-notice-read', notice.noticeId)).toBeNull(); // read rows carry no toggle
    expect(countByData(rig.root, 'data-unread', '1')).toBe(0); // the bell badge dropped to zero
  });

  it('the toast AUTO-DISMISSES through the ~5s scheduler timer and NEVER re-fires for the same notice (§4.10: toasts are for NEW notices)', async () => {
    const scheduler = new ScriptedScheduler();
    const rig = await bootRig({ tradrl_onboarded: 'true' }, offlineTransport, 'prj-a', { scheduler });
    rig.handle.dispatch({ kind: 'job-updated', at: T0 + 20, job: FAILED_JOB });
    expect(findByData(rig.root, 'data-toast', 'failed_evaluation')).not.toBeNull(); // §4.10 D6: the notice surfaced
    expect(scheduler.fireAt(5000)).toBe(true); // the ~5s timer was scheduled at show time
    expect(findByData(rig.root, 'data-toast', 'failed_evaluation')).toBeNull(); // auto-dismissed

    // The re-fire guard: an UNRELATED dispatch must not bring the toast back (the unfixed layer re-toasted the latest notice on EVERY state change — with auto-dismiss that becomes an infinite toast loop).
    rig.handle.dispatch({ kind: 'section-selected', at: T0 + 21, section: 'goal' });
    expect(findByData(rig.root, 'data-toast', 'failed_evaluation')).toBeNull(); // RED on the unguarded tree

    // A NEW notice surfaces again (a distinct id — the second failed job).
    rig.handle.dispatch({ kind: 'job-updated', at: T0 + 22, job: FAILED_JOB_2 });
    expect(findByData(rig.root, 'data-toast', 'failed_evaluation')).not.toBeNull();
  });

  it('the toast carries a WORKING close button (the console.ts toast-close handler finally has an element)', async () => {
    const scheduler = new ScriptedScheduler();
    const rig = await bootRig({ tradrl_onboarded: 'true' }, offlineTransport, 'prj-a', { scheduler });
    rig.handle.dispatch({ kind: 'job-updated', at: T0 + 20, job: FAILED_JOB });
    const close = findByData(rig.root, 'data-action', 'toast-close');
    if (close === null) throw new Error('the toast renders no close affordance'); // RED on the unfixed tree
    click(rig, close);
    expect(findByData(rig.root, 'data-toast', 'failed_evaluation')).toBeNull(); // dismissed NOW, no timer needed
    expect(scheduler.fireAt(5000)).toBe(true); // the pending timer still fires…
    expect(findByData(rig.root, 'data-toast', 'failed_evaluation')).toBeNull(); // …but is token-checked: no resurrection
  });
});

// ---------------------------------------------------------------------------
// THE REAL-LOADER PIN — the same interactions execute through the
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
