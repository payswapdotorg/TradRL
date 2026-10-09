// @tradrl/web-console — THE EXPORT DOWNLOAD SEAM (FW-36-B, Round E
// register §3.1 — the false-success toast, S5's flow).
//
// THE LAW: the export toast is a RECEIPT, not a wish. S5's Round E flow
// measured five consecutive Export clicks that produced NO file while
// the toast claimed "Export downloaded" — the pre-FW-36-B handler
// clicked a DETACHED anchor and toasted success unconditionally: the
// FW-35-A guard closed the THROWN-composition class, but a download the
// browser declines (a hardened context, a missing click surface) still
// claimed success. This module owns the honest half of the click:
//   - COMPOSE + SELF-CHECK: the document composes through the same
//     fold (core/workspace.ts), then VERIFIES through the SAME
//     file-alone verifier the Settings surface rides — a composition
//     that cannot verify is refused LOUDLY (ExportCompositionError, the
//     honest failure toast carries the reason), never a receipt. The
//     receipt's numbers (bytes, sealed events) are measured from the
//     exact bytes handed to the browser.
//   - DISPATCH: the anchor is APPENDED IN-TREE before the click and
//     removed after (a detached anchor's click is the class a hardened
//     context silently declines), and the click's DISPATCH is the
//     success precondition: an anchor with no click surface reports
//     dispatched:false — the caller's honest-failure path, never a
//     success claim.
// The honest limit: a browser that accepts the click but writes no
// file (OS-level failure) is unobservable from the page — the
// receipt's counts are the user's checkable claim against whatever
// landed, and the Settings verifier re-proves the file any time.
// PURE + seamed: every DOM capability is INJECTED, so the tests pin
// the receipt law without a browser.

import { serializeWorkspaceExport, verifyWorkspaceExportReport, type WorkspaceState } from './workspace';

/** The download anchor's minimal surface (an <a> element, structurally). */
export interface DownloadAnchor {
  setAttribute(name: string, value: string): void;
  click?(): void;
  remove?(): void;
}

/** The document surface the dispatch needs: the anchor factory + the mount tree it appends into. */
export interface DownloadSurface {
  createElement(tag: string): DownloadAnchor;
  /** Best-effort append into the live tree (absent = the degraded detached-click path, still attempted). */
  appendChild?(node: DownloadAnchor): unknown;
}

/** One export receipt — the numbers the success toast states (measured from the exact bytes handed to the browser). */
export interface ExportReceipt {
  readonly fileName: string;
  readonly byteLength: number;
  readonly eventCount: number;
  /** True when the click DISPATCHED on an in-tree anchor (the success precondition). */
  readonly dispatched: boolean;
}

/** The honest failure (a composition that cannot be served as a receipt). */
export class ExportCompositionError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'ExportCompositionError';
  }
}

/**
 * Compose + self-check the export document. Throws ExportCompositionError
 * (the honest failure the toast carries) when the composition throws, is
 * empty, or FAILS the same file-alone verification the Settings surface
 * rides — never a receipt for bytes the console's own verifier refuses.
 */
export function composeVerifiedExport(state: WorkspaceState): { readonly bytes: string; readonly eventCount: number } {
  let bytes: string;
  try {
    // ANY fold failure (the chain-of-thought firewall, a future
    // composition defect — the FW-35-A class) is wrapped as the honest
    // failure the toast carries, never an escape from this seam.
    bytes = serializeWorkspaceExport(state);
  } catch (error) {
    throw new ExportCompositionError(`the export document could not be composed (${error instanceof Error ? error.message : String(error)})`);
  }
  if (bytes.trim().length === 0) {
    throw new ExportCompositionError('the composed export document is empty');
  }
  let document: unknown;
  try {
    document = JSON.parse(bytes);
  } catch (error) {
    throw new ExportCompositionError(`the composed export document does not parse (${error instanceof Error ? error.message : String(error)})`);
  }
  const report = verifyWorkspaceExportReport(document);
  if (!report.ok) {
    throw new ExportCompositionError(`the composed export document failed its own verification (${report.reason ?? 'unknown reason'})`);
  }
  // the receipt's sealed-event count is the manifest's own events
  // count — read from the exact bytes handed to the browser (one fold,
  // no second composition).
  const manifest = (document as { manifest: { counts: { events: number } } }).manifest;
  return { bytes, eventCount: manifest.counts.events };
}

/**
 * Dispatch the download: the data: URI anchor is appended into the live
 * tree, clicked, and removed — and the RECEIPT reports whether the click
 * dispatched. A surface without a click-capable anchor reports
 * dispatched: false (the caller's honest-failure path) instead of
 * claiming success for a download the browser never received.
 */
export function dispatchExportDownload(surface: DownloadSurface, fileName: string, bytes: string): boolean {
  const anchor = surface.createElement('a');
  anchor.setAttribute('href', `data:application/json;charset=utf-8,${encodeURIComponent(bytes)}`);
  anchor.setAttribute('download', fileName);
  if (typeof surface.appendChild === 'function') {
    try {
      surface.appendChild(anchor);
    } catch {
      // a tree that refuses the append: the detached click still attempts
    }
  }
  let dispatched = false;
  if (typeof anchor.click === 'function') {
    anchor.click();
    dispatched = true;
  }
  if (typeof anchor.remove === 'function') {
    try {
      anchor.remove();
    } catch {
      // the tree owns the removal from here — never a failure of the dispatch
    }
  }
  return dispatched;
}

/**
 * The one-call honest export: compose + self-check + dispatch, returning
 * the receipt the toast states — or throwing ExportCompositionError, or
 * returning dispatched: false when the browser surface never received the
 * click. The caller toasts success ONLY on a dispatched receipt.
 */
export function exportWorkspaceDownload(state: WorkspaceState, surface: DownloadSurface, fileName: string): ExportReceipt {
  const { bytes, eventCount } = composeVerifiedExport(state);
  const dispatched = dispatchExportDownload(surface, fileName, bytes);
  return { fileName, byteLength: bytes.length, eventCount, dispatched };
}

/**
 * The live-tree download surface of a mounted console (the app layer's
 * binding): anchors come from the document's own factory and append
 * best-effort into the mount root — the in-tree dispatch seam.
 */
export function downloadSurfaceOf(documentLike: { createElement(tag: string): unknown }, root: Element): DownloadSurface {
  return {
    createElement: (tag: string): DownloadAnchor => documentLike.createElement(tag) as unknown as DownloadAnchor,
    appendChild: (node: DownloadAnchor): unknown => (root as Element & { appendChild?(child: unknown): unknown }).appendChild?.(node),
  };
}
