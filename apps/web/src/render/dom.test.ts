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
