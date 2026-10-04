// @tradrl/web-console — the DOM projector.
//
// A thin, mechanical VNode -> Element translation. No logic of its
// own: every law lives in the render model (render/model.ts); this
// module only projects the already-validated tree into the document
// (DOM APIs only — createElement/textContent/setAttribute, no
// innerHTML anywhere: the console never interprets markup).

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

/** Project the whole tree into a container (clearing its previous content — no diffing, a console-sized tree). */
export function mountVTree(document: ProjectorDocument, container: Element, root: VNode): Element {
  while (container.firstChild !== null) container.removeChild(container.firstChild);
  const projected = projectVNode(document, root);
  container.appendChild(projected);
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
