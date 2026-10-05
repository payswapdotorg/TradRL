// @tradrl/web-console — the DOM projector.
//
// A thin, mechanical VNode -> Element translation. No logic of its
// own: every law lives in the render model (render/model.ts); this
// module only projects the already-validated tree into the document
// (DOM APIs only — createElement/textContent/setAttribute, no
// innerHTML anywhere: the console never interprets markup).
//
// THE BEAT-INTERACTION PRESERVATION LAW (W-19, the R7/R8 fix): the
// console re-projects the WHOLE tree on every state change (the poll
// beat lands ~every 500ms-1s), and a full replacement used to reset
// every native interaction the user had in flight — an open
// `<details>` accordion collapsed mid-read (the R7 register entry:
// 26 friction rows, per-notice mark-read was unclickable), and every
// scrollable region jumped back to the top (the R8 register entry:
// 22 friction rows — the sidebar nav scrolls internally below the
// fold, so a reset scroll moved the target out from under the
// pointer and the click landed on the connection tile / env badge /
// brand row instead). mountVTree now captures the outgoing tree's
// open `<details>` states + scroll offsets and carries them over to
// the incoming projection, keyed by stable identity (the row's
// data-row/data-timeline id first, then the structural path). A
// control the re-render REMOVES carries nothing over; a closed
// `<details>` stays closed (only the OPEN state is preserved, so the
// model stays the source of truth for what renders).

import type { VNode } from './vtree';

/** The minimal document surface the projector needs (DOM APIs only). */
export interface ProjectorDocument {
  createElement(tag: string): Element;
  createTextNode(text: string): Text;
}

/** Project one VNode into a fresh element (attributes verbatim; children in order). */
export function projectVNode(document: ProjectorDocument, node: VNode | string): Node {
  if (typeof node === 'string') return document.createTextNode(node);
  const element = document.createElement(node.tag);
  for (const [name, value] of Object.entries(node.attrs)) {
    element.setAttribute(name, value);
  }
  for (const child of node.children) {
    element.appendChild(projectVNode(document, child));
  }
  return element;
}

// ---------------------------------------------------------------------------
// The beat-interaction capture (R7/R8) — DOM-API reads only, never writes
// outside applyInteractions.
// ---------------------------------------------------------------------------

/** The open/closed state + scroll offsets captured from one element. */
interface InteractionState {
  readonly open: boolean | null;
  readonly scrollTop: number;
  readonly scrollLeft: number;
}

/**
 * The stable identity of one element across a re-projection: the
 * row/timeline id when the element carries one (notice and outcome
 * accordions do — content-addressed, stable across beats), else the
 * structural path (tag + child index from the root) — equivalent
 * trees produce equivalent paths, and a structural change simply
 * matches nothing.
 */
function interactionKeyOf(element: Element, path: string): string {
  const row = element.getAttribute('data-row');
  if (row !== null) return `row:${row}`;
  const timeline = element.getAttribute('data-timeline');
  if (timeline !== null) return `timeline:${timeline}`;
  return path;
}

/** One element's tag name, uppercased (the stub elements carry nodeName; the DOM carries tagName). */
function tagNameOf(element: Element): string {
  const named = element as Element & { readonly tagName?: string; readonly nodeName?: string };
  const tag = named.tagName ?? named.nodeName ?? '';
  return String(tag).toUpperCase();
}

/** The HTMLCollection-like item accessor (the erasable-subset law: function types live in named aliases, never inline in casts). */
type CollectionItemOf = (index: number) => Element | null;

/** The tree-visit callback of the interaction walks (same law — a named alias). */
type ElementVisitor = (element: Element, path: string) => void;

/**
 * The ELEMENT children of one node, across every element shape this
 * projector meets: the real DOM's HTMLCollection (length + item), the
 * render tests' stub ({ length, item }) and the app tests' fake (a
 * plain array). Text nodes are never returned.
 */
function elementChildrenOf(element: Element): Element[] {
  const children = (element as Element & { readonly children?: unknown }).children;
  if (children === undefined || children === null) return [];
  if (Array.isArray(children)) return children as Element[];
  const list = children as { readonly length?: unknown; item?: unknown };
  if (typeof list.item !== 'function') return [];
  const item = (list.item as CollectionItemOf).bind(list);
  const length = typeof list.length === 'number' ? list.length : 0;
  const out: Element[] = [];
  for (let index = 0; index < length; index += 1) {
    const child = item(index);
    if (child !== null) out.push(child);
  }
  return out;
}

/** Walk an element tree depth-first, visiting every ELEMENT node with its structural path. */
function walkElements(root: Element, visit: ElementVisitor, path = ''): void {
  visit(root, path);
  const children = elementChildrenOf(root);
  for (let index = 0; index < children.length; index++) {
    const child = children[index] as Element;
    if (child === undefined) continue;
    walkElements(child, visit, `${path}/${tagNameOf(child)}[${index}]`);
  }
}

/** The first ELEMENT child of a container (across every element shape — see elementChildrenOf). */
function firstElementOf(container: Element): Element | null {
  return elementChildrenOf(container)[0] ?? null;
}

/**
 * Capture the outgoing tree's in-flight interactions: every OPEN
 * `<details>` and every scrolled element (scrollTop/scrollLeft > 0),
 * keyed by identity. Pure reads — the tree is about to be discarded.
 */
function captureInteractions(outgoing: Element): ReadonlyMap<string, InteractionState> {
  // The erasable-subset law: constructor type arguments (new Map<...>)
  // are not in the published subset — the annotation carries the typing.
  const captured: Map<string, InteractionState> = new Map();
  walkElements(outgoing, (element, path) => {
    const scrollable = element as Element & { readonly scrollTop?: unknown; readonly scrollLeft?: unknown };
    const top = typeof scrollable.scrollTop === 'number' ? scrollable.scrollTop : 0;
    const left = typeof scrollable.scrollLeft === 'number' ? scrollable.scrollLeft : 0;
    const isOpen = tagNameOf(element) === 'DETAILS' ? (element as HTMLDetailsElement).open === true : null;
    if (isOpen === null && top === 0 && left === 0) return; // nothing in flight
    captured.set(interactionKeyOf(element, path), { open: isOpen, scrollTop: top, scrollLeft: left });
  });
  return captured;
}

/**
 * Re-apply the captured interactions to an incoming projection: an
 * element with the SAME identity re-opens when its predecessor was
 * open, and re-seeks its scroll offsets (the browser clamps them to
 * the new content). Only the OPEN state carries over — a closed
 * element never opens itself, so the render model keeps deciding
 * what exists; this layer only keeps what the user had in flight.
 */
function applyInteractions(incoming: Element, captured: ReadonlyMap<string, InteractionState>): void {
  if (captured.size === 0) return;
  walkElements(incoming, (element, path) => {
    const state = captured.get(interactionKeyOf(element, path));
    if (state === undefined) return;
    if (state.open === true && tagNameOf(element) === 'DETAILS') {
      (element as HTMLDetailsElement).open = true;
    }
    if (state.scrollTop !== 0 || state.scrollLeft !== 0) {
      const scrollable = element as Element & { scrollTop: number; scrollLeft: number };
      if (state.scrollTop !== 0) scrollable.scrollTop = state.scrollTop;
      if (state.scrollLeft !== 0) scrollable.scrollLeft = state.scrollLeft;
    }
  });
}

/** Project the whole tree into a container (clearing its previous content — no diffing, a console-sized tree). */
export function mountVTree(document: ProjectorDocument, container: Element, root: VNode): Element {
  // R7/R8: capture what the user had in flight on the outgoing tree
  // BEFORE the clear — an open accordion, a scrolled nav — and carry
  // it onto the fresh projection (identity-matched; see above).
  let captured: ReadonlyMap<string, InteractionState> = new Map();
  const outgoing = firstElementOf(container);
  if (outgoing !== null) {
    captured = captureInteractions(outgoing);
  }
  while (container.firstChild !== null) container.removeChild(container.firstChild);
  const projected = projectVNode(document, root);
  container.appendChild(projected);
  const incoming = firstElementOf(container);
  if (captured.size > 0 && incoming !== null) {
    applyInteractions(incoming, captured);
  }
  return container;
}

/** Find the first element carrying a `[data-...]` attribute value, by hand (the tree walk stays projector-owned). */
export function findByDataAttribute(root: Element, name: string, value: string): Element | null {
  if (root.getAttribute(name) === value) return root;
  const children = root.children;
  for (let index = 0; index < children.length; index++) {
    const found = findByDataAttribute(children.item(index) as Element, name, value);
    if (found !== null) return found;
  }
  return null;
}
