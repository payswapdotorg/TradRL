// @tradrl/web-console — the view tree: a typed, serializable DOM
// description.
//
// The render model (render/model.ts) builds VNodes — pure data, no
// DOM — so every determinism law applies at the model level (same
// state + same injected instant -> identical serialized bytes, pinned
// by tests). The DOM projector (render/dom.ts) is then a thin,
// mechanical VNode -> Element translation with no logic of its own.
// No framework, no virtual-DOM diffing: the console re-projects the
// tree per state change (a console-sized tree; simplicity is the
// feature).

/** One node of the view tree: a tag, closed-vocabulary attributes, and children (elements or text). */
export interface VNode {
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: readonly (VNode | string)[];
}

/** Build a VNode (children flattened; null/undefined children dropped). */
export function v(tag: string, attrs: Readonly<Record<string, string>> = {}, children: readonly (VNode | string | null | undefined)[] = []): VNode {
  const flattened: (VNode | string)[] = [];
  for (const child of children) {
    if (child === null || child === undefined) continue;
    flattened.push(child);
  }
  return { tag, attrs, children: Object.freeze(flattened) };
}

/** Guard: a VNode. */
export function isVNode(value: unknown): value is VNode {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.tag === 'string' && typeof candidate.attrs === 'object' && candidate.attrs !== null && Array.isArray(candidate.children);
}

/** Escape a text for XML-ish serialization (the canonical form's own alphabet). */
function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape an attribute value for serialization. */
function escapeAttr(text: string): string {
  return escapeText(text).replace(/"/g, '&quot;');
}

/**
 * Serialize a VNode to canonical bytes: attrs in object order,
 * children in tree order. THE DETERMINISM PIN at the render level —
 * identical models serialize identically (tests byte-compare).
 */
export function serializeVNode(node: VNode | string): string {
  if (typeof node === 'string') return escapeText(node);
  const attrs = Object.entries(node.attrs).map(([key, value]) => ` ${key}="${escapeAttr(value)}"`).join('');
  if (node.children.length === 0) return `<${node.tag}${attrs}></${node.tag}>`;
  return `<${node.tag}${attrs}>${node.children.map(serializeVNode).join('')}</${node.tag}>`;
}
