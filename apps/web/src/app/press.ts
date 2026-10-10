// @tradrl/web-console — THE CAPTURED PRESS (D-6a, W-25C — the beat-render
// click race machinery; extracted from app/console.ts by FW-38-B to keep
// console.ts under its 160 KiB single-file payload line — the same
// extraction pattern app/oversight-plane.ts and core/export-flow.ts ride).
//
// The law the module owns: the beat re-projection rebuilds the WHOLE tree
// (~every 500ms-1s); when it lands between mousedown and mouseup, the
// browser composes the click on a common ANCESTOR of the replaced pair,
// and closest('[data-action]') from that ancestor resolves to NOTHING —
// the user's click silently no-ops. The press intent is captured at
// MOUSEDOWN (the affordance under the pointer) and the click handler
// replays it ONLY when the composed click resolved to no affordance AND
// the pressed element left the mounted tree (the beat replaced it
// mid-press). A normal click — same element, still attached, or released
// over another interactive element — resolves by itself and is never
// double-dispatched; a press the user dragged away from (released over
// nothing interactive, element never replaced) stays cancelled exactly as
// the browser intended.

/**
 * A captured press affordance: the element the pointer pressed at
 * MOUSEDOWN (the resolved `[data-action]` / `BUTTON[data-target]`) plus
 * which delegated vocabulary it resolved to. The click handler replays
 * it only when the composed click itself resolved to NO affordance and
 * the beat re-projection replaced the pressed element mid-press.
 */
export interface PendingPress {
  readonly kind: 'action' | 'target';
  readonly element: { getAttribute(name: string): string | null; readonly tagName: string };
  readonly key: string;
}

/**
 * Whether an element still belongs to the mounted tree — a beat
 * re-projection detaches the whole previous projection, so a mid-press
 * replacement leaves the pressed element orphaned (its parent chain no
 * longer reaches the mount root).
 */
export function attachedToRoot(root: unknown, element: unknown): boolean {
  let node: unknown = element;
  while (node !== null && node !== undefined) {
    if (node === root) return true;
    const parentNode = (node as { readonly parentNode?: unknown }).parentNode;
    node = parentNode !== null && parentNode !== undefined ? parentNode : (node as { readonly parent?: unknown }).parent;
  }
  return false;
}
