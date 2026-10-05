// THE BOOT-SEAM PINS (T051 follow-up W-14b — the J05/J06 scheduler seam).
//
// THE HOLE THIS FILE CLOSES (the live J-catalog findings, W-12a): the
// console's interaction layer EXPECTS an injected scheduler — the beat
// loop that advances PLAYBACK and polls jobs (console.ts's boot), the
// ~5s toast auto-dismiss timer — but the REAL browser boot (index.ts
// bootFromShell, the exact path the static shell's inline bootstrap
// executes) injected NONE. The seam was test-only: every scripted rig
// armed it; production never did. On the deployed console that meant
// PLAYBACK never auto-advanced (J05: the readout frozen at fromAt,
// progress 0%) and the new-notice toast NEVER dismissed (J06: a stuck
// permanent overlay — the SAME root cause).
//
// These pins boot the console through bootFromShell ITSELF — the real
// entry, the real app module (the native dynamic-import path) — with
// vitest's FAKE TIMERS standing in for the browser's clock: the
// browserScheduler seam (setTimeout) is intercepted, so advancing fake
// time advances the REAL boot's beats and toast timers, exactly as the
// shipped shell would. No scheduler is injected by the test — the
// entry's OWN injection is the thing under test.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiTransport } from '../api/transport';
import type { ConsoleHandle } from './console';
import { bootFromShell, CONSOLE_ROOT_ID } from '../index';
import { formatInstantUtc } from '../core/format';
import type * as ConsoleModule from './console';

const T0 = 1_700_000_000_000;

// ---------------------------------------------------------------------------
// THE FAKE DOCUMENT (the minimal surface bootFromShell + mount need —
// the same shape as console-interactions.test.ts's rig, plus the
// getElementById the entry uses to find the shell root).
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

/** The fake document: the MountDocument surface + getElementById + the focus-trap query + fire(). */
class FakeDocument {
  private readonly listeners = new Map<string, Array<(event: Record<string, unknown>) => void>>();
  readonly created: FakeElement[] = [];
  readonly activeElement: FakeElement | null = null;
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
// THE TREE HELPERS.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// THE SCRIPTED TRANSPORT (the demo backing's honest shape: a project,
// one out-of-tolerance shadow outcome and one active org snapshot —
// folding TWO notices, the shadow one first).
// ---------------------------------------------------------------------------

/** The transport the seam boots against: meta + project + reads that fold two notices (shadow_degradation, then organization_compiled). */
function seamTransport(): ApiTransport {
  const ok = (data: unknown) => ({ status: 200, headers: {}, body: { requestId: 'req-seam', data } });
  const project = {
    id: 'prj-seam', tenantId: 'tenant-seam', name: 'Seam Test Project', executionMode: 'simulation',
    lifecycle: { projectId: 'prj-seam', status: 'active', acceptanceCriteriaId: null, organizationRef: 'org:seam' },
    lineage: { projectId: 'prj-seam', createdAt: T0, createdBy: 'test', priorVersion: null, version: 1, goal: { goalId: 'goal-seam', version: 1 }, constraintSet: { id: 'cs-seam', version: 1 } },
    createdAt: T0, updatedAt: T0,
  };
  const shadowOutcome = {
    outcomeId: 'out-seam', ordinal: 1, tenant: 'tenant-seam', project: 'prj-seam',
    decision: { decisionRef: 'dec-seam', intentRef: 'int-seam', disposition: 'filled' },
    outcomeClass: 'realized-profit',
    expectation: { expectedQuantity: '10', expectedRealized: '1.5', tolerance: '0.25', declaredBy: 'b1' },
    realization: { filledQuantity: '10', realizedOutcome: '1.75', feeTotal: '0.02', notionalTotal: '1000.00', unrealizedAtDecision: '0.00' },
    deviation: { quantityShortfall: null, realizedGap: '0.90', withinTolerance: false }, // out of tolerance -> shadow_degradation
    evidence: [],
    lineage: { shadow: { fidelity: { mode: 'shadow' }, riskPolicy: { policyId: 'pol-seam', version: 1 }, experiment: null } },
    asOf: T0 + 30, priorChainHead: '00000000',
  };
  const snapshot = { organizationRef: 'org:seam', tenant: 'tenant-seam', project: 'prj-seam', status: 'active', at: T0 + 90, instanceRefs: ['inst:seam-1'] };
  const transport: ApiTransport = async (request) => {
    const key = `${request.method} ${decodeURIComponent(request.path.split('?')[0])}`;
    if (key === 'GET /v1/meta') return ok({ apiVersion: 'v1', supportedVersions: ['v1'], routeFamilies: [] });
    if (key === 'GET /v1/projects/prj-seam') return ok(project);
    if (key === 'POST /v1/knowledge/query' || key === 'POST /v1/post-mortems/query') return ok({ items: [] });
    if (key === 'POST /v1/outcomes/query') return ok({ items: [shadowOutcome] });
    if (key === 'GET /v1/organizations/org:seam/status') return ok(snapshot);
    return { status: 404, headers: {}, body: { requestId: 'req-seam', error: { code: 'not_found', message: 'no route', status: 404 } } };
  };
  return transport;
}

/** One booted seam rig. */
interface SeamRig {
  readonly handle: ConsoleHandle;
  readonly doc: FakeDocument;
  readonly root: FakeElement;
}

/** Boot the REAL entry (bootFromShell) against the fake document — no scheduler injected: the entry's OWN seam is under test. */
async function bootSeam(): Promise<SeamRig> {
  // THE PARKED MODULE (the browser's exact fallback): the static
  // shell's bootstrap loads the app module through the no-build loader
  // and parks it on window.__TRADRL_CONSOLE_BOOT__ BEFORE the package
  // main boots; the main's own native dynamic import of the TS entry
  // cannot resolve, so the parked module IS the boot path. The test
  // parks the same module (the native import of './app/console') on
  // the global holder — the entry then boots through the fallback
  // exactly as the shipped shell does.
  const holder = globalThis as { __TRADRL_CONSOLE_BOOT__?: typeof ConsoleModule };
  if (holder.__TRADRL_CONSOLE_BOOT__ === undefined) {
    holder.__TRADRL_CONSOLE_BOOT__ = await import('./console');
  }
  const doc = new FakeDocument();
  const root = doc.createElement('div');
  root.setAttribute('id', CONSOLE_ROOT_ID);
  const handle = await bootFromShell({
    document: doc as unknown as Document,
    config: { apiOrigin: 'http://seam.invalid', token: 'token-seam', tenantId: 'tenant-seam', projectId: 'prj-seam', simulated: true },
    transport: seamTransport(),
  });
  if (handle === null) throw new Error('bootFromShell failed to boot the console');
  await drain();
  return { handle, doc, root };
}

/** Flush the boot read cadence's microtask chain (the scripted transport resolves on microtasks; fake timers own the macros). */
async function drain(rounds = 200): Promise<void> {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

describe('the boot seam (bootFromShell): the REAL browser boot injects a REAL scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('boots the console into the shell root through the real entry (the module loads, mounts and reads)', async () => {
    const rig = await bootSeam();
    expect(rig.handle.state().scope.projectId).toBe('prj-seam');
    expect(rig.handle.state().connection).toBe('connected');
    expect(rig.handle.state().inbox.notices.length).toBe(2); // the fold worked: shadow_degradation + organization_compiled
    const shell = elementsOf(rig.root).find((element) => element.hasClass('tradrl-shell'));
    expect(shell).toBeDefined(); // the console rendered into the shell root
  });

  it('J06: a new notice toasts and AUTO-DISMISSES after ~5s through the browser scheduler (the stuck-toast fix)', async () => {
    const rig = await bootSeam();
    // The outcomes read folds the FIRST notice (shadow_degradation) — the toast surfaces it (D6, within one poll cycle).
    expect(findByData(rig.root, 'data-toast', 'shadow_degradation')).not.toBeNull();
    // THE SEAM: the entry armed the ~5s timer through the browser
    // scheduler — advancing the clock dismisses the toast.
    await vi.advanceTimersByTimeAsync(5000);
    expect(findByData(rig.root, 'data-toast', 'shadow_degradation')).toBeNull(); // RED on the unfixed tree: no scheduler, no timer, the toast stays forever
  });

  it('J06: the toast\'s close button dismisses it immediately (no timer needed, no resurrection after the timer fires)', async () => {
    const rig = await bootSeam();
    const close = findByData(rig.root, 'data-action', 'toast-close');
    if (close === null) throw new Error('the toast renders no close affordance'); // RED on the unfixed tree
    rig.doc.fire('click', { target: close });
    expect(findByData(rig.root, 'data-toast', 'shadow_degradation')).toBeNull();
    await vi.advanceTimersByTimeAsync(10_000); // the pending ~5s timer fires…
    expect(findByData(rig.root, 'data-toast', 'shadow_degradation')).toBeNull(); // …and is token-checked: no resurrection
  });

  it('J05: armed playback AUTO-ADVANCES on the beat (the readout + progress move — the frozen-playback fix)', async () => {
    const rig = await bootSeam();
    // 30s of idle beats (the anchor stays at the boot instant until a
    // Time Machine event observes a fresh one — the app's own law).
    await vi.advanceTimersByTimeAsync(30_000);
    const play = findByData(rig.root, 'data-action', 'tm-mode-playback');
    if (play === null) throw new Error('the Time Machine renders no PLAYBACK mode button');
    rig.doc.fire('click', { target: play }); // arms playback from the opened instant; the click's own instant becomes the anchor
    const readoutOf = (): string => {
      const readout = elementsOf(rig.root).find((element) => element.hasClass('tm-readout'));
      if (readout === undefined) throw new Error('the mono readout is missing');
      return textOf(readout);
    };
    const before = readoutOf();
    await vi.advanceTimersByTimeAsync(4000); // 4 beats -> 4 controlled steps of 500ms
    const playback = rig.handle.state().timeMachine.playback;
    if (playback === null) throw new Error('playback is not armed');
    expect(playback.ticks).toBe(4); // RED on the unfixed tree: no scheduler, no beats, 0 ticks forever
    expect(readoutOf()).toBe(formatInstantUtc(playback.fromAt + playback.ticks * playback.stepMs)); // the readout advanced
    expect(readoutOf()).not.toBe(before);
    const progress = elementsOf(rig.root).find((element) => element.hasClass('tm-progress'));
    if (progress === undefined) throw new Error('the progress readout is missing while playing');
    expect(textOf(progress)).not.toBe('0%'); // progress climbed off zero
  });
});
