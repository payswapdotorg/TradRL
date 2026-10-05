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
  constructor(readonly data: string) {}
}

/** A stub element (attributes, children, firstChild — the projector's whole surface). */
class StubElement {
  readonly nodeName: string;
  readonly attributes = new Map<string, string>();
  readonly childNodes: (StubElement | StubText)[] = [];
  /** The native interaction surface the beat-preservation reads/writes (R7/R8): a <details>' open flag + a scroller's offsets. */
  open = false;
  scrollTop = 0;
  scrollLeft = 0;

  constructor(tag: string) {
    this.nodeName = tag.toUpperCase();
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.has(name) ? (this.attributes.get(name) as string) : null;
  }

  appendChild(node: StubElement | StubText): StubElement | StubText {
    this.childNodes.push(node);
    return node;
  }

  removeChild(node: StubElement | StubText): StubElement | StubText {
    const index = this.childNodes.indexOf(node);
    if (index !== -1) this.childNodes.splice(index, 1);
    return node;
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
