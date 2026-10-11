// Tests for the DOM projector (render/dom.ts) — a ZERO-DEPENDENCY DOM
// stub test-double (hand-authored, per the Work Order: no jsdom, no
// dependency; DOM APIs only, and the projector needs so little that a
// ~60-line stub exercises it fully).
//
// Laws pinned here (dom.ts header): the projector is a THIN, mechanical
// VNode -> Element translation with NO logic of its own — attributes
// verbatim, children in order, text as text nodes, NO innerHTML
// anywhere (the console never interprets markup), and findByDataAttribute
// walks the projected tree by hand.

import { describe, expect, it } from 'vitest';
import { v, type VNode } from './vtree';
import { findByDataAttribute, mountVTree, projectVNode } from './dom';

// ---------------------------------------------------------------------------
// The zero-dep DOM stub (Element + Text + Document — just enough surface)
// ---------------------------------------------------------------------------

/** A stub text node. */
class StubText {
  readonly nodeName = '#text';
  /** The parent chain (FW-40-C's move semantics reads it; null until attached). */
  parent: StubElement | null = null;
  constructor(readonly data: string) {}
}

/** A stub element (attributes, children, firstChild — the projector's whole surface). */
class StubElement {
  readonly nodeName: string;
  readonly attributes = new Map<string, string>();
  readonly childNodes: (StubElement | StubText)[] = [];
  /** The parent chain (FW-40-C: the identity-keyed transplant's replaceChild walks it). */
  parent: StubElement | null = null;
  /** The native interaction surface the beat-preservation reads/writes (R7/R8): a <details>' open flag + a scroller's offsets. */
  open = false;
  scrollTop = 0;
  scrollLeft = 0;
  /** The input's live value property (FW-40-C: the user-edited value the transplant preserves). */
  value = '';

  constructor(tag: string) {
    this.nodeName = tag.toUpperCase();
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.has(name) ? (this.attributes.get(name) as string) : null;
  }

  /** FW-40-C: the attribute enumeration + removal the transplant's re-sync rides (the real DOM's own surface). */
  getAttributeNames(): string[] {
    return [...this.attributes.keys()];
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  /** FW-40-C: the DOM's own MOVE semantics (an appendChild of an attached node removes it from its prior parent — the transplant's children move rides it). */
  appendChild(node: StubElement | StubText): StubElement | StubText {
    const prior = node.parent;
    if (prior !== null) {
      const priorIndex = prior.childNodes.indexOf(node);
      if (priorIndex !== -1) prior.childNodes.splice(priorIndex, 1);
    }
    node.parent = this;
    this.childNodes.push(node);
    return node;
  }

  removeChild(node: StubElement | StubText): StubElement | StubText {
    const index = this.childNodes.indexOf(node);
    if (index !== -1) this.childNodes.splice(index, 1);
    node.parent = null;
    return node;
  }

  /** FW-40-C: the DOM's own swap (the transplant's carrier). */
  replaceChild<T extends StubElement | StubText>(newNode: T, oldNode: T): T {
    const index = this.childNodes.indexOf(oldNode);
    if (index === -1) return oldNode;
    this.childNodes.splice(index, 1, newNode);
    oldNode.parent = null;
    newNode.parent = this;
    return oldNode;
  }

  get firstChild(): StubElement | StubText | null {
    return this.childNodes.length === 0 ? null : (this.childNodes[0] as StubElement | StubText);
  }

  /** The ELEMENT children as an HTMLCollection-like (length + item) — dom.ts's traversal surface. */
  get children(): { readonly length: number; item(index: number): StubElement | null } {
    const elements = this.childNodes.filter((child): child is StubElement => child instanceof StubElement);
    return { length: elements.length, item: (index: number) => (index >= 0 && index < elements.length ? (elements[index] as StubElement) : null) };
  }

  /** The projected tree as an S-expression (structure assertions without a DOM). */
  toSexpr(): string {
    if (this.nodeName === '#text') return JSON.stringify((this as unknown as StubText).data);
    const attrs = [...this.attributes.entries()].map(([key, value]) => ` ${key}=${JSON.stringify(value)}`).join('');
    const children = this.childNodes.map((child) => (child instanceof StubElement ? child.toSexpr() : JSON.stringify(child.data))).join(' ');
    return `(${this.nodeName}${attrs}${children.length > 0 ? ' ' + children : ''})`;
  }
}

/** The stub document (createElement + createTextNode — the projector's whole need), cast to the projector's interface. */
const stubDocument = {
  createElement(tag: string): StubElement {
    return new StubElement(tag);
  },
  createTextNode(text: string): StubText {
    return new StubText(text);
  },
} as unknown as import('./dom').ProjectorDocument;

describe('dom: projectVNode (the mechanical translation)', () => {
  it('projects elements with attributes verbatim and children in order', () => {
    const tree = v('div', { class: 'card', 'data-section': 'goal' }, [
      'hello',
      v('span', { class: 'b' }, ['world']),
      v('b', {}, []),
    ]);
    const projected = projectVNode(stubDocument, tree) as unknown as StubElement;
    expect(projected.toSexpr()).toBe('(DIV class="card" data-section="goal" "hello" (SPAN class="b" "world") (B))');
  });

  it('projects a bare string as a text node', () => {
    const text = projectVNode(stubDocument, 'just text') as unknown as StubText;
    expect(text.data).toBe('just text');
    expect(text.nodeName).toBe('#text');
  });

  it('attribute VALUES stay verbatim strings (no interpretation, no innerHTML)', () => {
    const projected = projectVNode(stubDocument, v('p', { title: '<script>&"' }, [])) as unknown as StubElement;
    expect(projected.getAttribute('title')).toBe('<script>&"');
    expect(projected.toSexpr()).not.toContain('innerHTML');
  });
});

describe('dom: mountVTree (clear + project, no diffing)', () => {
  it('mounts into an empty container and returns it', () => {
    const container = new StubElement('div');
    const returned = mountVTree(stubDocument, container as unknown as Element, v('section', { class: 'panel' }, ['x'])) as unknown as Element;
    expect(returned).toBe(container);
    expect(container.toSexpr()).toBe('(DIV (SECTION class="panel" "x"))');
  });

  it('re-mounting REPLACES the previous tree (the console re-projects per state change)', () => {
    const container = new StubElement('div');
    mountVTree(stubDocument, container as unknown as Element, v('section', { 'data-section': 'goal' }, ['first']));
    mountVTree(stubDocument, container as unknown as Element, v('section', { 'data-section': 'risk' }, ['second']));
    expect(container.toSexpr()).toBe('(DIV (SECTION data-section="risk" "second"))');
    expect(container.childNodes).toHaveLength(1);
  });
});

describe('dom: mountVTree — the beat-interaction preservation (R7/R8, W-19)', () => {
  /** Find a descendant by data-row (the projector's own finder, over the stub). */
  function rowByData(container: StubElement, rowId: string): StubElement | null {
    const found = findByDataAttribute(container as unknown as Element, 'data-row', rowId);
    return found === null ? null : (found as unknown as StubElement);
  }

  it('R7: an accordion the user opened STAYS OPEN across a re-render beat (two consecutive mounts, same row identity)', () => {
    const container = new StubElement('div');
    const tree = () => v('section', { class: 'panel' }, [
      v('details', { class: 'accordion-row', 'data-row': 'notice:ntc-1' }, [v('summary', {}, ['first'])]),
      v('details', { class: 'accordion-row', 'data-row': 'notice:ntc-2' }, [v('summary', {}, ['second'])]),
    ]);
    mountVTree(stubDocument, container as unknown as Element, tree());
    const opened = rowByData(container, 'notice:ntc-1');
    expect(opened).not.toBeNull();
    (opened as unknown as { open: boolean }).open = true; // the user expands the first notice
    // the ~500ms beat re-projects the SAME tree (a poll tick, an elapsed metric)
    mountVTree(stubDocument, container as unknown as Element, tree());
    const reopened = rowByData(container, 'notice:ntc-1');
    expect((reopened as unknown as { open: boolean }).open).toBe(true); // still open — mark-read is reachable
    const untouched = rowByData(container, 'notice:ntc-2');
    expect((untouched as unknown as { open: boolean }).open).toBe(false); // a closed row never opens itself
  });

  it('R7: the identity is the row id, not the position — a DIFFERENT row at the same path does not inherit the open state', () => {
    const container = new StubElement('div');
    mountVTree(stubDocument, container as unknown as Element, v('section', {}, [
      v('details', { 'data-row': 'notice:ntc-1' }, [v('summary', {}, ['first'])]),
    ]));
    (rowByData(container, 'notice:ntc-1') as unknown as { open: boolean }).open = true;
    // the next beat carries a DIFFERENT notice at the same structural position
    mountVTree(stubDocument, container as unknown as Element, v('section', {}, [
      v('details', { 'data-row': 'notice:ntc-9' }, [v('summary', {}, ['replaced'])]),
    ]));
    const replaced = rowByData(container, 'notice:ntc-9');
    expect((replaced as unknown as { open: boolean }).open).toBe(false); // nothing fabricated open
  });

  it('R7: a row the beat REMOVES carries nothing over (no resurrection)', () => {
    const container = new StubElement('div');
    mountVTree(stubDocument, container as unknown as Element, v('section', {}, [
      v('details', { 'data-row': 'notice:ntc-1' }, []),
      v('details', { 'data-row': 'notice:ntc-2' }, []),
    ]));
    (rowByData(container, 'notice:ntc-1') as unknown as { open: boolean }).open = true;
    mountVTree(stubDocument, container as unknown as Element, v('section', {}, [
      v('details', { 'data-row': 'notice:ntc-2' }, []), // ntc-1 left the projection (instant-filtered)
    ]));
    expect(rowByData(container, 'notice:ntc-1')).toBeNull();
    expect((rowByData(container, 'notice:ntc-2') as unknown as { open: boolean }).open).toBe(false);
  });

  it('R8: a scrollable region keeps its scroll offsets across the beat (the sidebar nav scrolled to a bottom item stays there)', () => {
    const container = new StubElement('div');
    const tree = (meta: string) => v('div', { class: 'tradrl-shell' }, [
      v('nav', { class: 'shell-nav' }, [v('button', { 'data-target': meta }, [meta])]),
    ]);
    mountVTree(stubDocument, container as unknown as Element, tree('home'));
    const nav = (container.childNodes[0] as StubElement).childNodes[0] as StubElement;
    nav.scrollTop = 200; // the user scrolled the nav to reach the bottom nav group
    mountVTree(stubDocument, container as unknown as Element, tree('risk')); // the beat re-projects
    const navAfter = (container.childNodes[0] as StubElement).childNodes[0] as StubElement;
    expect(navAfter).not.toBe(nav); // the tree WAS fully replaced (no diffing)
    expect(navAfter.scrollTop).toBe(200); // ...and the scroll position survived the replacement
    expect(navAfter.scrollLeft).toBe(0);
  });

  it('R8: an element that did not scroll stays at 0 (only in-flight state carries over)', () => {
    const container = new StubElement('div');
    const tree = () => v('div', {}, [v('nav', { class: 'shell-nav' }, [])]);
    mountVTree(stubDocument, container as unknown as Element, tree());
    mountVTree(stubDocument, container as unknown as Element, tree());
    const navAfter = (container.childNodes[0] as StubElement).childNodes[0] as StubElement;
    expect(navAfter.scrollTop).toBe(0);
  });

  it('R7+R8 together: an open timeline details AND a scrolled nav both survive one beat', () => {
    const container = new StubElement('div');
    const tree = () => v('div', { class: 'tradrl-shell' }, [
      v('nav', { class: 'shell-nav' }, []),
      v('details', { 'data-timeline': 'release_candidate' }, [v('summary', {}, ['Release candidate'])]),
    ]);
    mountVTree(stubDocument, container as unknown as Element, tree());
    const root = container.childNodes[0] as StubElement;
    (root.childNodes[0] as StubElement).scrollTop = 120;
    (root.childNodes[1] as StubElement).open = true;
    mountVTree(stubDocument, container as unknown as Element, tree());
    const rootAfter = container.childNodes[0] as StubElement;
    expect((rootAfter.childNodes[0] as StubElement).scrollTop).toBe(120);
    expect((rootAfter.childNodes[1] as StubElement).open).toBe(true);
  });
});

describe('dom: findByDataAttribute (the hand walk)', () => {
  it('finds the root itself when it carries the attribute', () => {
    const root = projectVNode(stubDocument, v('main', { 'data-section': 'goal' }, [])) as unknown as StubElement;
    expect(findByDataAttribute(root as unknown as Element, 'data-section', 'goal')).toBe(root);
  });

  it('finds a nested descendant (depth-first, first match wins)', () => {
    const tree: VNode = v('div', {}, [
      v('nav', {}, [
        v('button', { 'data-section': 'goal' }, ['Goal']),
        v('button', { 'data-section': 'risk' }, ['Risk']),
      ]),
      v('main', {}, [v('section', { 'data-section': 'risk', class: 'panel' }, [])]),
    ]);
    const root = projectVNode(stubDocument, tree) as unknown as StubElement;
    const found = findByDataAttribute(root as unknown as Element, 'data-section', 'risk');
    expect(found).not.toBeNull();
    expect((found as unknown as StubElement)?.nodeName).toBe('BUTTON'); // the FIRST match in tree order
  });

  it('returns null when no element carries it', () => {
    const root = projectVNode(stubDocument, v('div', {}, [v('span', { class: 'x' }, [])])) as unknown as StubElement;
    expect(findByDataAttribute(root as unknown as Element, 'data-section', 'goal')).toBeNull();
  });

  it('the whole console model mounts and its section nav is findable (the app-layer contract)', async () => {
    const { renderConsoleModel } = await import('./model');
    const { openWorkspace } = await import('../core/workspace');
    const state = openWorkspace({ tenantId: 'tenant-a', projectId: 'proj-a' }, 1_700_000_000_000);
    const container = new StubElement('div');
    mountVTree(stubDocument, container as unknown as Element, renderConsoleModel(state, 1_700_000_000_000));
    const goalNav = findByDataAttribute(container as unknown as Element, 'data-section', 'goal');
    expect(goalNav).not.toBeNull();
    expect((goalNav as unknown as StubElement)?.getAttribute('type')).toBe('button');
    expect(findByDataAttribute(container as unknown as Element, 'data-section', 'lessons')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FW-36-B (Round E register E-8, part 4) — THE FILE-INPUT SELECTION
// PRESERVATION. The export-verify file input races the re-render beat: the
// projector replaces the whole tree every beat, so a staged selection (the
// user's pick in flight, the automation path's DataTransfer set) died with
// the outgoing element — the fresh input read files:0 and the face reset to
// "No file chosen" (L3 needed a DataTransfer workaround by hand; S1/M1 saw
// the never-attaches variant). The fix is the accordion-preservation class:
// the outgoing selection is CAPTURED with the open/scroll state (keyed by
// the input's stable id) and RE-ATTACHED to the fresh projection through a
// DataTransfer — the only surface a browser allows.
// ---------------------------------------------------------------------------

describe('dom: FW-36-B (E-8, part 4) — the beat-interaction preservation extends to the file input', () => {
  /** A minimal DataTransfer stand-in (the browser's own global in production; installed on globalThis by these tests). `items.add` binds to the INSTANCE through the closure — the browser's own binding. */
  class StubDataTransfer {
    private readonly filesList: unknown[] = [];
    readonly items = { add: (file: unknown): unknown => this.filesList.push(file) };
    get files(): unknown[] {
      return this.filesList;
    }
  }

  /** The file the tests stage (a name + a text read — the verify flow's whole need). */
  const stagedFile = (name: string): { readonly name: string } => ({ name });

  /** Install the stub DataTransfer global; returns the restore function. */
  const installDataTransfer = (): (() => void) => {
    const holder = globalThis as { DataTransfer?: unknown };
    const prior = holder.DataTransfer;
    holder.DataTransfer = StubDataTransfer;
    return () => {
      if (prior === undefined) delete holder.DataTransfer;
      else holder.DataTransfer = prior;
    };
  };

  /** The Settings tree carrying the verify input (shell.ts's own shape). */
  const settingsTree = () => v('section', { class: 'panel', 'data-section': 'settings' }, [
    v('div', { class: 'card settings-row' }, [
      v('button', { class: 'connection-retry', 'data-action': 'export-workspace', type: 'button' }, ['Export workspace data']),
      v('label', { class: 'export-verify-label', for: 'export-verify-file' }, [
        'Verify an export file',
        v('input', {
          class: 'export-verify-input',
          id: 'export-verify-file',
          type: 'file',
          accept: 'application/json,.json',
          'data-action': 'export-verify-file',
        }, []),
      ]),
    ]),
  ]);

  /** The input of the CURRENT projection (the tree is replaced per mount). */
  const verifyInputOf = (container: StubElement): StubElement => {
    const input = (container as unknown as Element);
    const found = findByDataAttribute(input, 'data-action', 'export-verify-file');
    if (found === null) throw new Error('the verify input is missing from the projection');
    return found as unknown as StubElement;
  };

  it('a selection staged on the outgoing input SURVIVES the beat re-projection — FW-40-C: the id-carrying input is PRESERVED (the same live element), so its FileList survives natively', () => {
    const restore = installDataTransfer();
    try {
      const container = new StubElement('div');
      mountVTree(stubDocument, container as unknown as Element, settingsTree());
      const outgoing = verifyInputOf(container);
      (outgoing as unknown as { files: unknown }).files = [stagedFile('tradrl-workspace-prj-a.json')]; // the selection lands (the browser's pick / the automation path)
      mountVTree(stubDocument, container as unknown as Element, settingsTree()); // the beat re-projects the WHOLE tree
      const incoming = verifyInputOf(container);
      expect(incoming).toBe(outgoing); // FW-40-C: the element is the SAME live object (identity-keyed reuse — a stronger guarantee than the DataTransfer re-attach)
      const carried = (incoming as unknown as { files?: { readonly length: number; readonly [index: number]: { readonly name: string } } }).files;
      expect(carried?.length).toBe(1); // the files:0 class is dead — the selection never left the element
      expect(carried?.[0]?.name).toBe('tradrl-workspace-prj-a.json');
    } finally {
      restore();
    }
  });

  it('FW-40-C: the DataTransfer re-attach stays as the FALLBACK — a file input WITHOUT an id is still replaced, and its captured selection re-attaches (the mechanism guards any future non-id input)', () => {
    const restore = installDataTransfer();
    try {
      const idlessTree = () => v('section', { class: 'panel' }, [
        v('input', { class: 'export-verify-input', type: 'file', 'data-action': 'export-verify-file-alt' }, []),
      ]);
      const container = new StubElement('div');
      mountVTree(stubDocument, container as unknown as Element, idlessTree());
      const outgoing = findByDataAttribute(container as unknown as Element, 'data-action', 'export-verify-file-alt') as unknown as StubElement;
      (outgoing as unknown as { files: unknown }).files = [stagedFile('a.json')];
      mountVTree(stubDocument, container as unknown as Element, idlessTree());
      const incoming = findByDataAttribute(container as unknown as Element, 'data-action', 'export-verify-file-alt') as unknown as StubElement;
      expect(incoming).not.toBe(outgoing); // no identity key — replaced as always
      const carried = (incoming as unknown as { files?: { readonly length: number } }).files;
      expect(carried?.length ?? 0).toBe(1); // the DataTransfer re-attach carried it
    } finally {
      restore();
    }
  });

  it('the identity is the input\'s id (not the structural path): a DIFFERENT element at the same path inherits nothing', () => {
    const restore = installDataTransfer();
    try {
      const container = new StubElement('div');
      mountVTree(stubDocument, container as unknown as Element, settingsTree());
      const outgoing = verifyInputOf(container);
      (outgoing as unknown as { files: unknown }).files = [stagedFile('a.json')];
      // the next beat replaces the SETTINGS panel with a panel carrying NO verify input
      mountVTree(stubDocument, container as unknown as Element, v('section', { class: 'panel', 'data-section': 'home' }, []));
      const projected = findByDataAttribute(container as unknown as Element, 'data-action', 'export-verify-file');
      expect(projected).toBeNull(); // the control left the projection — nothing resurrects, nothing leaks
    } finally {
      restore();
    }
  });

  it('an input whose selection was CLEARED (the verify flow\'s own reset, so a re-pick re-fires change) carries nothing over — the clear survives the beat', () => {
    const restore = installDataTransfer();
    try {
      const container = new StubElement('div');
      mountVTree(stubDocument, container as unknown as Element, settingsTree());
      const outgoing = verifyInputOf(container);
      (outgoing as unknown as { files: unknown }).files = [stagedFile('a.json')];
      mountVTree(stubDocument, container as unknown as Element, settingsTree()); // carried once
      const cleared = verifyInputOf(container);
      (cleared as unknown as { files: unknown }).files = []; // the flow clears the value (re-selecting the SAME file must re-fire change)
      mountVTree(stubDocument, container as unknown as Element, settingsTree());
      const incoming = verifyInputOf(container);
      const carried = (incoming as unknown as { files?: { readonly length: number } }).files;
      expect(carried?.length ?? 0).toBe(0); // never resurrected — the clear is the user's own state (and FW-40-C: the SAME element, so nothing even re-attached)
    } finally {
      restore();
    }
  });

  it('WITHOUT a DataTransfer global (the hardened/stubbed platform) the preservation degrades SILENTLY — never a throw (R46); FW-40-C: the id-carrying input is preserved anyway (the selection needs no re-attach at all)', () => {
    const holder = globalThis as { DataTransfer?: unknown };
    const prior = holder.DataTransfer;
    delete holder.DataTransfer;
    try {
      const container = new StubElement('div');
      mountVTree(stubDocument, container as unknown as Element, settingsTree());
      const outgoing = verifyInputOf(container);
      (outgoing as unknown as { files: unknown }).files = [stagedFile('a.json')];
      expect(() => mountVTree(stubDocument, container as unknown as Element, settingsTree())).not.toThrow();
      const incoming = verifyInputOf(container);
      expect(incoming).toBe(outgoing); // FW-40-C: identity-keyed reuse — the element (and its selection) never left
      const carried = (incoming as unknown as { files?: { readonly length: number } }).files;
      expect(carried?.length ?? 0).toBe(1);
    } finally {
      if (prior !== undefined) holder.DataTransfer = prior;
    }
  });
});

// ---------------------------------------------------------------------------
// FW-40-C (the Round H wizard-race cluster) — THE FORM-CONTROL IDENTITY
// LAW. The round's most-frequent friction (S2 + M3 + S3): a fill staged on
// a live form control was EATEN by the ~500ms beat re-projection — the
// full-tree replacement detached the node mid-fill, the input/change
// events dispatched against it never bubbled to the document, and the
// value silently vanished (the wizard refused to advance with no inline
// error; the Settings account form lost the same values; the
// datetime-local editor reset mid-typing). The fix: the eligible controls
// (the delegated form fields — data-launch-field / data-research-field /
// data-account-field — plus the id-carrying interactive controls) are
// TRANSPLANTED onto the identity-matched fresh projections: the live
// ELEMENT persists across every beat, its user-edited value property
// survives, and any event later dispatched against a handle resolved for
// it still reaches the document's delegated listeners.
// ---------------------------------------------------------------------------

describe('dom: FW-40-C — the form-control identity law (the beat-value preservation)', () => {
  /** The wizard's markets step (the exact labeledInput shape render/flow.ts serves). */
  const marketsTree = (typed: string) => v('section', { class: 'panel' }, [
    v('div', { class: 'card launch-wizard' }, [
      v('div', { class: 'field', 'data-field': 'markets' }, [
        v('label', { class: 'field-label', for: 'launch-markets' }, ['Markets *']),
        v('input', { class: 'field-input', id: 'launch-markets', name: 'markets', type: 'text', value: typed, 'data-launch-field': 'markets' }, []),
      ]),
      v('button', { class: 'tm-button', id: 'launch-next', 'data-action': 'launch-step-world', type: 'button' }, ['Next: world']),
    ]),
  ]);

  it('a delegated form field TRANSPLANTS across the beat: the SAME live element, its USER-EDITED value property surviving (the input event may never have landed)', () => {
    const container = new StubElement('div');
    mountVTree(stubDocument, container as unknown as Element, marketsTree(''));
    const outgoing = findByDataAttribute(container as unknown as Element, 'data-launch-field', 'markets') as unknown as StubElement;

    // THE EATEN-FILL CLASS: the automation sets the value on the live node,
    // then the beat re-projects BEFORE the input event is dispatched.
    outgoing.value = 'futures, fx';
    mountVTree(stubDocument, container as unknown as Element, marketsTree(''));

    const incoming = findByDataAttribute(container as unknown as Element, 'data-launch-field', 'markets') as unknown as StubElement;
    expect(incoming).toBe(outgoing); // the SAME element — a handle resolved against it never goes stale
    expect(incoming.value).toBe('futures, fx'); // the user's value survived on the live node
    expect(incoming.getAttribute('value')).toBe(''); // the ATTRIBUTE stays the model's truth (the painted value)
  });

  it('an id-carrying BUTTON transplants too (the stepper controls never go stale) and its label re-syncs from the model', () => {
    const container = new StubElement('div');
    mountVTree(stubDocument, container as unknown as Element, marketsTree(''));
    const outgoing = findByDataAttribute(container as unknown as Element, 'id', 'launch-next') as unknown as StubElement;

    mountVTree(stubDocument, container as unknown as Element, marketsTree('')); // the beat

    const incoming = findByDataAttribute(container as unknown as Element, 'id', 'launch-next') as unknown as StubElement;
    expect(incoming).toBe(outgoing); // the stepper's Next button is the SAME element across every beat
    expect(incoming.getAttribute('data-action')).toBe('launch-step-world'); // attributes re-sync from the incoming VNode
  });

  it('an element with NO identity key (a plain div, an id-less button) is still REPLACED — the model keeps deciding what renders', () => {
    const container = new StubElement('div');
    mountVTree(stubDocument, container as unknown as Element, v('section', {}, [
      v('div', { class: 'card', 'data-section': 'goal' }, []),
      v('button', { class: 'tm-button', 'data-action': 'launch-start', type: 'button' }, ['Describe your goal']),
    ]));
    const outgoingDiv = findByDataAttribute(container as unknown as Element, 'data-section', 'goal');
    const outgoingButton = findByDataAttribute(container as unknown as Element, 'data-action', 'launch-start');

    mountVTree(stubDocument, container as unknown as Element, v('section', {}, [
      v('div', { class: 'card', 'data-section': 'goal' }, []),
      v('button', { class: 'tm-button', 'data-action': 'launch-start', type: 'button' }, ['Describe your goal']),
    ]));

    expect(findByDataAttribute(container as unknown as Element, 'data-section', 'goal')).not.toBe(outgoingDiv); // replaced
    expect(findByDataAttribute(container as unknown as Element, 'data-action', 'launch-start')).not.toBe(outgoingButton); // replaced (no id, no delegated field attribute)
  });

  it('when the model itself repaints the field (no user edit), the transplanted control carries the MODEL\'S fresh value — the value never runs stale', () => {
    const container = new StubElement('div');
    mountVTree(stubDocument, container as unknown as Element, marketsTree(''));
    const outgoing = findByDataAttribute(container as unknown as Element, 'data-launch-field', 'markets') as unknown as StubElement;

    mountVTree(stubDocument, container as unknown as Element, marketsTree('SPY, GLD')); // the flush committed — the model paints the new value

    const incoming = findByDataAttribute(container as unknown as Element, 'data-launch-field', 'markets') as unknown as StubElement;
    expect(incoming).toBe(outgoing); // still the same element
    expect(incoming.value).toBe('SPY, GLD'); // the MODEL's value took the property (no user edit was in flight)
    expect(incoming.getAttribute('value')).toBe('SPY, GLD');
  });

  it('a control whose step LEFT the projection (no incoming identity match) is discarded — nothing resurrects', () => {
    const container = new StubElement('div');
    mountVTree(stubDocument, container as unknown as Element, marketsTree('futures'));
    const outgoing = findByDataAttribute(container as unknown as Element, 'data-launch-field', 'markets');
    expect(outgoing).not.toBeNull();

    // the world step carries NO markets field — the wizard moved on
    mountVTree(stubDocument, container as unknown as Element, v('section', {}, [
      v('input', { class: 'field-input', id: 'launch-horizonStartsAt', type: 'datetime-local', value: '', 'data-launch-field': 'horizonStartsAt' }, []),
    ]));

    expect(findByDataAttribute(container as unknown as Element, 'data-launch-field', 'markets')).toBeNull();
    // and returning to the markets step later does NOT resurrect the old node — a fresh projection
    // (the detached subtree keeps its internal parent links, as in the real DOM; what matters is
    // that nothing ever re-attaches it to the mounted tree)
    mountVTree(stubDocument, container as unknown as Element, marketsTree(''));
    const back = findByDataAttribute(container as unknown as Element, 'data-launch-field', 'markets');
    expect(back).not.toBe(outgoing); // never the old element — no resurrection, no leak
  });
});

// ---------------------------------------------------------------------------
// FW-41-B (Round I register I-2 — 7/7 personas who checked) — THE SELECT
// DISPLAY LAW. The form-control identity law (FW-40-C) fixed the text /
// datetime / constraints classes but left a SELECT-CLASS GAP: a select
// never carries a `value` CONTENT attribute (its paint rides the OPTIONS'
// selected attributes), so the transplant's user-edit detection (live
// value vs the painted value attribute) could never fire, and the
// incoming paint's model value — absent from the select's own attrs —
// fell through to the `''` default: EVERY beat re-projection WIPED the
// displayed selection. The wizard's executionMode select rendered empty
// from every seat while its STATE stayed correct (Review and the launch
// record read "simulation" — L1: "val '' idx -1; selectOption ran clean
// but val still '' idx -1"; M2 needed the React value-tracker workaround
// to advance). M1's cross-check isolated the class: the Settings
// project-switcher select — NOT identity-eligible (no field attribute,
// no id), so freshly projected each beat — displays fine; the residual
// is the TRANSPLANTED select class specifically. THE LAW: the select's
// displayed selection rides the same identity law as the text controls —
// the OUTGOING options' selected paint is the model's last paint (the
// browser never mutates content attributes through user interaction), a
// live value that differs from it is the user's in-flight pick and
// SURVIVES, and the incoming paint (the select's own value attribute
// when it carries one, else the fresh options' selected paint) re-syncs
// the display on EVERY projection — never the pre-fix wipe to ''.
// ---------------------------------------------------------------------------

describe('dom: FW-41-B — the select display law (the identity law\'s select-class gap, I-2)', () => {
  /**
   * A select in the OPTION-PAINT grammar (the closed-vocabulary paint:
   * the model value rides the options' selected attributes — no
   * select-level value attribute). This is labeledSelect's pre-FW-41-B
   * grammar, and remains the grammar of the switcher and speed selects,
   * so the projector's CLASS law must carry it on its own.
   */
  const modeSelectTree = (painted: string) => v('section', { class: 'panel' }, [
    v('div', { class: 'card launch-wizard' }, [
      v('div', { class: 'field', 'data-field': 'executionMode' }, [
        v('label', { class: 'field-label', for: 'launch-executionMode' }, ['Execution mode *']),
        v('select', { class: 'field-input field-select', id: 'launch-executionMode', name: 'executionMode', 'data-launch-field': 'executionMode' }, [
          v('option', { value: 'simulation', ...(painted === 'simulation' ? { selected: 'selected' } : {}) }, ['simulation']),
          v('option', { value: 'shadow', ...(painted === 'shadow' ? { selected: 'selected' } : {}) }, ['shadow']),
          v('option', { value: 'live', ...(painted === 'live' ? { selected: 'selected' } : {}) }, ['live']),
        ]),
      ]),
    ]),
  ]);

  /** The wizard's execution select of the CURRENT projection (the tree is replaced per mount). */
  const executionSelectOf = (container: StubElement): StubElement => {
    const found = findByDataAttribute(container as unknown as Element, 'data-launch-field', 'executionMode');
    if (found === null) throw new Error('the execution-mode select is missing from the projection');
    return found as unknown as StubElement;
  };

  it('(b) a beat re-projection with the model value set DISPLAYS it: the transplanted select\'s value property re-syncs to the model\'s painted option — never the pre-fix wipe to \'\'', () => {
    const container = new StubElement('div');
    mountVTree(stubDocument, container as unknown as Element, modeSelectTree('simulation'));
    const select = executionSelectOf(container);
    // the browser derives the displayed selection from the painted option at insertion
    // (the stub models that derivation as the value property — the real DOM does it natively)
    select.value = 'simulation';

    mountVTree(stubDocument, container as unknown as Element, modeSelectTree('simulation')); // the ~500ms beat re-projects the same paint

    const after = executionSelectOf(container);
    expect(after).toBe(select); // the identity law: the SAME live element
    expect(after.value).toBe('simulation'); // THE DISPLAY LAW: the model's value holds — not ''
  });

  it('(c) a user pick in flight SURVIVES the beat (the eaten-fill class): the live value — the pick whose change event may never have landed — rides the same law as a text fill', () => {
    const container = new StubElement('div');
    mountVTree(stubDocument, container as unknown as Element, modeSelectTree('simulation'));
    const select = executionSelectOf(container);
    select.value = 'simulation'; // the browser's derivation of the painted selection
    select.value = 'shadow'; // the user picks shadow (the UI / the native setter); the change event has NOT committed the model yet

    mountVTree(stubDocument, container as unknown as Element, modeSelectTree('simulation')); // the beat re-projects the UNCOMMITTED paint

    const after = executionSelectOf(container);
    expect(after).toBe(select); // still the same live element — the handle never goes stale
    expect(after.value).toBe('shadow'); // the pick survives on the live node; the next change event commits it
  });

  it('(c\') the committed pick: once the model repaints the pick, the display follows it — the beat landing AFTER the change event', () => {
    const container = new StubElement('div');
    mountVTree(stubDocument, container as unknown as Element, modeSelectTree('simulation'));
    const select = executionSelectOf(container);
    select.value = 'simulation'; // the browser's derivation of the painted selection
    select.value = 'shadow'; // the user picks shadow
    // the change event landed: the app layer's edit buffer committed, the model repaints the pick
    mountVTree(stubDocument, container as unknown as Element, modeSelectTree('shadow'));

    const after = executionSelectOf(container);
    expect(after.value).toBe('shadow'); // the display shows the committed pick (never blank, never the stale paint)
  });

  it('(d) the model\'s own repaint takes the display (no user edit in flight): the value property follows the fresh paint — a select never shows a stale or blank face', () => {
    const container = new StubElement('div');
    mountVTree(stubDocument, container as unknown as Element, modeSelectTree('simulation'));
    const select = executionSelectOf(container);
    select.value = 'simulation'; // the browser's derivation of the painted selection

    mountVTree(stubDocument, container as unknown as Element, modeSelectTree('shadow')); // the model changed underneath (a draft restore, a programmatic edit)

    const after = executionSelectOf(container);
    expect(after).toBe(select); // the same element
    expect(after.value).toBe('shadow'); // the display follows the model — never stale, never wiped
  });

  it('the CLASS law, not the one instance: an id-carrying select WITHOUT a delegated field attribute (the switcher\'s grammar — options paint, no select-level value) re-syncs its display the same way', () => {
    const switcherTree = (painted: string) => v('section', {}, [
      v('select', { class: 'project-select', id: 'project-switcher', 'data-action': 'project-switch' }, [
        v('option', { value: 'prj-a', ...(painted === 'prj-a' ? { selected: 'selected' } : {}) }, ['prj-a — Desk A']),
        v('option', { value: 'prj-b', ...(painted === 'prj-b' ? { selected: 'selected' } : {}) }, ['prj-b — Desk B']),
      ]),
    ]);
    const container = new StubElement('div');
    mountVTree(stubDocument, container as unknown as Element, switcherTree('prj-a'));
    const select = findByDataAttribute(container as unknown as Element, 'id', 'project-switcher') as unknown as StubElement;
    select.value = 'prj-a'; // the browser's derivation of the painted selection

    mountVTree(stubDocument, container as unknown as Element, switcherTree('prj-a')); // the beat

    const after = findByDataAttribute(container as unknown as Element, 'id', 'project-switcher') as unknown as StubElement;
    expect(after).toBe(select); // identity-keyed reuse (the id-carrying control class)
    expect(after.value).toBe('prj-a'); // the display law holds for ANY preserved select, not just the wizard's
  });

  it('THE WIZARD\'S OWN SURFACE end-to-end: the world step\'s execution-mode select displays its model value across a beat, through an in-flight pick, and through the model\'s repaint (the real renderConsoleModel projection)', async () => {
    const { renderConsoleModel } = await import('./model');
    const { openWorkspace, reduceAll } = await import('../core/workspace');
    const scope = { tenantId: 'tenant-a', projectId: 'proj-a' };
    const t0 = 1_700_000_000_000;
    const draft = {
      name: 'Momentum scout', objective: 'Beat the index with bounded drawdown.',
      horizon: { startsAt: t0, endsAt: t0 + 86_400_000, label: 'one day' },
      successCriteria: [], evaluation: { blindRef: 'blind-1', walkForwardRef: 'wf-1', regimeRef: 'regime-1', adversarialRequired: true },
      constraints: [], capitalBudget: '10000.00', riskBudget: '250.00',
      markets: ['SPY'], venues: ['venue-x'], dataSources: ['src-1'],
      executionMode: 'simulation', preferences: [],
    } as never;
    const worldStep = reduceAll(openWorkspace(scope, t0), [
      { kind: 'launch-draft-started', at: t0 + 2, draft },
      { kind: 'launch-step-changed', at: t0 + 3, step: 'world' as never },
      { kind: 'section-selected', at: t0 + 4, section: 'goal' },
      { kind: 'view-live', at: t0 + 50 },
    ]);

    const container = new StubElement('div');
    mountVTree(stubDocument, container as unknown as Element, renderConsoleModel(worldStep, t0 + 50));
    const select = executionSelectOf(container);
    select.value = 'simulation'; // the browser's derivation of the painted selection (state default — the SIMULATED anti-deception default)

    // (b) the beat re-projects the same world step — the display must hold
    mountVTree(stubDocument, container as unknown as Element, renderConsoleModel(worldStep, t0 + 50));
    expect(executionSelectOf(container).value).toBe('simulation'); // RED pre-fix: the transplant wiped it to ''

    // (c) the user picks shadow; the change event has not committed the model yet — the pick survives the beat
    const picked = executionSelectOf(container);
    picked.value = 'shadow';
    mountVTree(stubDocument, container as unknown as Element, renderConsoleModel(worldStep, t0 + 50));
    expect(executionSelectOf(container).value).toBe('shadow'); // RED pre-fix: the pick was wiped to ''

    // (c') the pick commits (the app layer's edit buffer) — the model repaints, the display follows
    const { defaultShellView } = await import('./shell');
    const committedView = { ...defaultShellView(worldStep), launchEdits: { executionMode: 'shadow' } };
    mountVTree(stubDocument, container as unknown as Element, renderConsoleModel(worldStep, t0 + 50, committedView));
    expect(executionSelectOf(container).value).toBe('shadow'); // the display shows the committed pick
  });
});
