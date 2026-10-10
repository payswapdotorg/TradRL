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
//
// THE FORM-CONTROL IDENTITY LAW (FW-40-C, the Round H wizard-race
// cluster — the round's most-frequent friction, S2 + M3 + S3): a
// full replacement also DETACHED every live form control mid-fill,
// so an input value staged on the current node (a two-step
// programmatic fill, an autofill, an IME composition) could lose its
// input/change events — dispatched on the detached node, they never
// bubble to the document, and the value silently vanished (the
// wizard refused to advance with no inline error; the Settings
// account form lost the same values; the datetime-local editor reset
// mid-typing). The eligible controls (the delegated form fields +
// the id-carrying interactive controls) are now collected from the
// OUTGOING tree and TRANSPLANTED onto the identity-matched fresh
// projections: the live ELEMENT persists across every beat, its
// user-edited value property survives, and any event later
// dispatched against a handle resolved for it still reaches the
// document's delegated listeners. Attributes and children re-sync
// from the incoming VNode — the model stays the source of truth for
// what renders; this layer keeps only what the user had in flight
// (the same law as the open accordions and scroll offsets above).

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

/**
 * The in-flight interaction state captured from one element. FW-36-B
 * (Round E register E-8, part 4 — the export-verify file-input race)
 * adds the FILE SELECTION: an `<input type="file">` the user (or the
 * automation path) had staged a selection on carries its FileList into
 * the capture, so the fresh projection re-attaches it — the same class
 * as the open accordion + scroll offsets (the browser owns this state;
 * the projector only keeps what was in flight).
 */
interface InteractionState {
  readonly open: boolean | null;
  readonly scrollTop: number;
  readonly scrollLeft: number;
  /** The staged file selection of an `<input type="file">` (null when the element is not one / carried no selection). */
  readonly files: readonly unknown[] | null;
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
  // FW-36-B (E-8, part 4): an element carrying an id keys on it — ids
  // are unique per document, so the identity is strictly MORE stable
  // than the structural path (the export-verify file input's own key).
  const id = element.getAttribute('id');
  if (id !== null) return `id:${id}`;
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
 * FW-36-B (E-8, part 4): the staged file selection of an element — the
 * items of an `<input type="file">`'s FileList (an array-like: numeric
 * length + index reads, the same surface verifyFileTargetOf reads in
 * the app layer), or null for any other element / an empty selection.
 * Pure read; the tree is about to be discarded.
 */
function stagedFilesOf(element: Element): readonly unknown[] | null {
  if (tagNameOf(element) !== 'INPUT') return null;
  if (element.getAttribute('type') !== 'file') return null;
  const files = (element as Element & { readonly files?: unknown }).files;
  if (files === null || files === undefined) return null;
  const list = files as { readonly length?: unknown; readonly [index: number]: unknown };
  if (typeof list.length !== 'number' || list.length < 1) return null;
  const staged: unknown[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const file = list[index];
    if (file !== null && file !== undefined) staged.push(file);
  }
  return staged.length === 0 ? null : staged;
}

/**
 * Capture the outgoing tree's in-flight interactions: every OPEN
 * `<details>`, every scrolled element (scrollTop/scrollLeft > 0) and
 * every staged file selection, keyed by identity. Pure reads — the
 * tree is about to be discarded.
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
    // FW-36-B (E-8, part 4): the staged file selection joins the capture.
    const files = stagedFilesOf(element);
    if (isOpen === null && top === 0 && left === 0 && files === null) return; // nothing in flight
    captured.set(interactionKeyOf(element, path), { open: isOpen, scrollTop: top, scrollLeft: left, files });
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
 * FW-36-B (E-8, part 4): the staged file selection re-attaches the
 * same way — the fresh input carries what the outgoing one had.
 */
/**
 * FW-36-B (E-8, part 4): the DataTransfer surface the file re-attach
 * needs — the browser's own global, structurally (the erasable-subset
 * law: the signatures live in named types, never inline at cast depth).
 */
interface StagedFileTransfer {
  readonly items: { add(file: unknown): unknown };
  readonly files: unknown;
}

/** The DataTransfer constructor's shape (a no-argument constructor — named, per the same erasable-subset law; the `new ()` lives HERE, never inline at cast depth). */
type StagedFileTransferConstructor = new () => StagedFileTransfer;

/**
 * FW-36-B (E-8, part 4): re-attach a staged file selection onto the
 * fresh projection of the same file input. The browser's `<input
 * type="file">` is programmatically assignable ONLY through a
 * DataTransfer's FileList (a browser law — the very workaround L3
 * needed by hand in Round E); the DataTransfer global is looked up
 * defensively and the whole re-attach degrades SILENTLY when the
 * platform provides none (the test stubs, a hardened browser): the
 * selection is simply not carried, exactly the pre-fix behavior — R46,
 * the projector never throws at the user over a preservation nicety.
 * The commit path itself is unaffected: the change event still reads
 * the LIVE element, which now carries what the user staged.
 */
function applyStagedFiles(element: Element, files: readonly unknown[]): void {
  if (tagNameOf(element) !== 'INPUT' || element.getAttribute('type') !== 'file') return;
  const transferConstructor = (globalThis as { readonly DataTransfer?: unknown }).DataTransfer;
  if (typeof transferConstructor !== 'function') return; // no DataTransfer (the stub environment) — degrade silently
  try {
    const transfer = new (transferConstructor as StagedFileTransferConstructor)();
    for (const file of files) transfer.items.add(file);
    (element as Element & { files: unknown }).files = transfer.files;
  } catch {
    // a platform refusing the assignment (a hardened surface, a non-File
    // object in the staged list) keeps the pre-fix behavior — never a crash.
  }
}

// ---------------------------------------------------------------------------
// The beat-value preservation (FW-40-C, the Round H wizard-race cluster)
// — the identity-keyed REUSE of the live form controls.
// ---------------------------------------------------------------------------

/**
 * The delegated form-field attributes — the identities the app layer's
 * edit buffers read (launch / research / account). An element carrying
 * one of these is a FORM CONTROL the user types into; its live value is
 * the user's latest intent.
 */
const FIELD_ATTRIBUTES: readonly string[] = ['data-launch-field', 'data-research-field', 'data-account-field'];

/** The control tags eligible for identity-keyed reuse (the value/focus carriers + the stepper's buttons). */
function isPreservableTag(tag: string): boolean {
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON';
}

/** The stable identity of an eligible control, from the DOM side (null = not eligible). */
function preserveKeyOfElement(element: Element): string | null {
  if (!isPreservableTag(tagNameOf(element))) return null;
  for (const attribute of FIELD_ATTRIBUTES) {
    const value = element.getAttribute(attribute);
    if (value !== null && value.length > 0) return `${attribute}:${value}`;
  }
  const id = element.getAttribute('id');
  if (id !== null && id.length > 0) return `id:${id}`;
  return null;
}

/** The stable identity of an eligible control, from the VNode side (same law, pure attrs). */
function preserveKeyOfAttrs(tag: string, attrs: Readonly<Record<string, string>>): string | null {
  if (!isPreservableTag(tag.toUpperCase())) return null;
  for (const attribute of FIELD_ATTRIBUTES) {
    const value = attrs[attribute];
    if (typeof value === 'string' && value.length > 0) return `${attribute}:${value}`;
  }
  const id = attrs.id;
  if (typeof id === 'string' && id.length > 0) return `id:${id}`;
  return null;
}

/**
 * Collect the OUTGOING tree's eligible controls (identity -> live
 * element), BEFORE the clear — the same place captureInteractions reads.
 */
function collectPreservable(outgoing: Element, found: Map<string, Element>): void {
  walkElements(outgoing, (element) => {
    const key = preserveKeyOfElement(element);
    if (key !== null && !found.has(key)) found.set(key, element);
  });
}

/** The parent of an element across every element shape (the real DOM's parentNode; the stubs' parent; null when detached). */
function parentOf(element: Element): Element | null {
  const parentNode = (element as Element & { readonly parentNode?: unknown }).parentNode;
  if (parentNode !== null && parentNode !== undefined) return parentNode as Element;
  const parent = (element as Element & { readonly parent?: unknown }).parent;
  return parent === null || parent === undefined ? null : (parent as Element);
}

/**
 * The transplant's swap carrier (the erasable-subset law: function
 * signatures live in named interfaces, never inline in casts).
 */
interface ReplaceChildCarrier {
  replaceChild?(newNode: Node, oldNode: Node): unknown;
}

/** The attribute re-sync surface (the same law — named method signatures, never inline arrows). */
interface AttributeResyncCarrier {
  getAttributeNames?(): Iterable<string>;
  removeAttribute?(name: string): void;
}

/** The value-property carrier (a form control's live value — the browser-owned state the transplant preserves). */
interface ValueCarrier {
  value?: string;
}

/** The paired (VNode, Element) visitor of the preservable walk (the ElementVisitor pattern). */
type PreservableVisitor = (vnode: VNode, element: Element) => void;

/**
 * Re-attach one preserved control in place of its fresh projection (the
 * transplant): the preserved element takes the fresh node's place in the
 * incoming tree, its attributes are re-synced from the incoming VNode, and
 * the fresh node's children move onto it (labels/options re-render; the
 * ELEMENT IDENTITY persists). Degrades to the fresh projection whenever the
 * parent lacks replaceChild (R46 — never a crash over a preservation nicety).
 */
function transplantPreserved(preserved: Element, fresh: Element, attrs: Readonly<Record<string, string>>): boolean {
  const parent = parentOf(fresh);
  if (parent === null) return false;
  const replacer = parent as Element & ReplaceChildCarrier;
  if (typeof replacer.replaceChild !== 'function') return false;
  // The user's live value is captured BEFORE the attribute sync: a value
  // that differs from the outgoing tree's own painted attribute is an edit
  // whose input/change events may NEVER have landed (the beat detached the
  // node mid-fill) — it survives the re-projection on the SAME element, so
  // the next input event (whenever it fires, on this live node) commits it.
  const isField = tagNameOf(preserved) === 'INPUT' || tagNameOf(preserved) === 'SELECT' || tagNameOf(preserved) === 'TEXTAREA';
  const liveValue = (preserved as Element & ValueCarrier).value;
  const outgoingValueAttribute = preserved.getAttribute('value');
  const userEdited = isField && typeof liveValue === 'string' && outgoingValueAttribute !== null && liveValue !== outgoingValueAttribute;
  // Attribute sync: the incoming set applies verbatim; an attribute the
  // incoming projection dropped is removed (class/aria-invalid toggles stay
  // the model's truth). Best-effort without getAttributeNames (a stub
  // without it keeps stale attrs — never a crash).
  const named = preserved as Element & AttributeResyncCarrier;
  if (typeof named.getAttributeNames === 'function' && typeof named.removeAttribute === 'function') {
    for (const name of named.getAttributeNames()) {
      if (!Object.prototype.hasOwnProperty.call(attrs, name)) named.removeAttribute(name);
    }
  }
  for (const [name, value] of Object.entries(attrs)) preserved.setAttribute(name, value);
  // Children: the fresh projection's children replace the preserved node's
  // own (the model keeps deciding what renders; this layer keeps only the
  // element identity + its browser-owned state).
  while (preserved.firstChild !== null) preserved.removeChild(preserved.firstChild);
  while (fresh.firstChild !== null) preserved.appendChild(fresh.firstChild);
  // The value property: a USER-EDITED live value survives untouched (the
  // dirty value the browser would keep anyway); otherwise the incoming
  // (model) value takes the property so the control reflects the fresh paint.
  if (isField && typeof liveValue === 'string') {
    const valueCarrier = preserved as Element & { value: string };
    if (userEdited) {
      valueCarrier.value = liveValue;
    } else {
      valueCarrier.value = Object.prototype.hasOwnProperty.call(attrs, 'value') ? (attrs.value as string) : '';
    }
  }
  replacer.replaceChild(preserved, fresh);
  return true;
}

/** Walk the incoming projection paired with its VNode (element children pair 1:1 with element VNodes, in order). */
function walkPreservable(vnode: VNode, element: Element, visit: PreservableVisitor): void {
  visit(vnode, element);
  const children = elementChildrenOf(element);
  let index = 0;
  for (const child of vnode.children) {
    if (typeof child === 'string') continue;
    const paired = children[index];
    if (paired === undefined) break;
    walkPreservable(child, paired, visit);
    index += 1;
  }
}

/**
 * Re-attach every identity-matched preserved control onto the incoming
 * projection (the pairs are collected FIRST — the full walk over the fresh
 * tree — then the transplants mutate it; the eligible controls are leaves
 * in this render model, so no transplant ever hides a deeper match).
 */
function reattachPreservable(incoming: Element, root: VNode, preservable: ReadonlyMap<string, Element>): void {
  const pairs: { readonly key: string; readonly attrs: Readonly<Record<string, string>>; readonly element: Element }[] = [];
  walkPreservable(root, incoming, (vnode, element) => {
    const key = preserveKeyOfAttrs(vnode.tag, vnode.attrs);
    if (key !== null && preservable.has(key)) pairs.push({ key, attrs: vnode.attrs, element });
  });
  for (const pair of pairs) {
    const preserved = preservable.get(pair.key);
    if (preserved === undefined) continue;
    transplantPreserved(preserved, pair.element, pair.attrs);
  }
}

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
    if (state.files !== null) applyStagedFiles(element, state.files);
  });
}

/** Project the whole tree into a container (clearing its previous content — no diffing, a console-sized tree). */
export function mountVTree(document: ProjectorDocument, container: Element, root: VNode): Element {
  // R7/R8: capture what the user had in flight on the outgoing tree
  // BEFORE the clear — an open accordion, a scrolled nav — and carry
  // it onto the fresh projection (identity-matched; see above).
  // FW-40-C (the wizard-race cluster): the outgoing tree's eligible form
  // controls are collected here too — the live elements themselves, not
  // just their state — so the identity-matched ones TRANSPLANT onto the
  // fresh projection (a fill or press resolved against them keeps
  // landing: the element never leaves the document, so its events always
  // reach the document's delegated listeners).
  let captured: ReadonlyMap<string, InteractionState> = new Map();
  const preservable: Map<string, Element> = new Map();
  const outgoing = firstElementOf(container);
  if (outgoing !== null) {
    captured = captureInteractions(outgoing);
    collectPreservable(outgoing, preservable);
  }
  while (container.firstChild !== null) container.removeChild(container.firstChild);
  const projected = projectVNode(document, root);
  container.appendChild(projected);
  const incoming = firstElementOf(container);
  if (preservable.size > 0 && incoming !== null) {
    reattachPreservable(incoming, root, preservable);
  }
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
