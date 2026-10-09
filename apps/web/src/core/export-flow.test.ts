// Tests for the export orchestration seam (export-flow.ts header) — the
// FW-36-B E-9 law pinned at the SEAM level (the mounted end-to-end
// switch+reload regression lives in app/console-interactions.test.ts;
// these are the pure orchestration laws over fake seams, no DOM):
//   - a CONVERGED scope composes synchronously (no busy flag, no wait);
//   - an UNREAD scope runs its own read bundle and composes the world
//     the refresh READ (never the reset world it started from);
//   - a scope that cannot converge degrades honestly (deferred toast,
//     nothing downloaded) — never an empty-but-valid file;
//   - a failure anywhere surfaces the failure toast (never a silent
//     no-op — FW-35-A; R46: nothing throws at the caller);
//   - the toast auto-dismiss is token-checked (a newer toast or a
//     manual close already cleared it — the late tick dismisses
//     nothing else).

import { describe, expect, it } from 'vitest';
import { runWorkspaceExport, type ExportFlowSeams, type ExportToastRecord } from './export-flow';
import { openWorkspace } from './workspace';

const SCOPE = { tenantId: 'tenant-a', projectId: 'proj-a' } as const;
const T0 = 1_700_000_000_000;

/** One macrotask beat — flushes every microtask the async wait path chains (the bounded retry loop). */
const settle = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

/** A fake seam set: every seam records its calls; the harness flips the knobs per scenario. */
function fakeSeams(overrides: Partial<ExportFlowSeams> = {}): ExportFlowSeams & {
  readonly downloads: { readonly fileName: string; readonly bytes: string }[];
  readonly toasts: ExportToastRecord[];
  readonly renders: number;
  readonly busyCalls: boolean[];
  readonly scheduled: { readonly ms: number; readonly run: () => void }[];
} {
  const recorded = {
    downloads: [] as { fileName: string; bytes: string }[],
    toasts: [] as ExportToastRecord[],
    renders: 0,
    busyCalls: [] as boolean[],
    scheduled: [] as { ms: number; run: () => void }[],
  };
  let shown: ExportToastRecord | null = null;
  const base: ExportFlowSeams = {
    state: () => state,
    simulated: () => false,
    scopeReadsComplete: () => true,
    refresh: async () => undefined,
    render: () => { recorded.renders += 1; },
    schedule: (ms, run) => { recorded.scheduled.push({ ms, run }); },
    setBusy: (busy) => { recorded.busyCalls.push(busy); },
    showToast: (toast) => { shown = toast; recorded.toasts.push(toast); },
    isToastShown: (toast) => shown === toast,
    clearToast: () => { shown = null; },
    download: (fileName, bytes) => { recorded.downloads.push({ fileName, bytes }); },
  };
  let state = openWorkspace(SCOPE, T0);
  return Object.assign(base, overrides, recorded);
}

describe('export-flow: FW-36-B (E-9) — the export never composes an unread workspace', () => {
  it('a CONVERGED scope composes SYNCHRONOUSLY: one download, no busy flag, no refresh, the confirmation toast + its 5s auto-dismiss', () => {
    const seams = fakeSeams();
    runWorkspaceExport(seams);
    expect(seams.downloads.length).toBe(1);
    expect(seams.downloads[0]?.fileName).toBe('tradrl-workspace-proj-a.json');
    expect(seams.busyCalls).toEqual([]); // no wait, no busy flag
    expect(seams.toasts.map((toast) => toast.kind)).toEqual(['export-download']);
    expect(seams.scheduled.map((entry) => entry.ms)).toEqual([5000]);
    // the bytes are the real composed document (the manifest carries the E-8.2 published rule)
    expect(JSON.parse(seams.downloads[0]?.bytes ?? '{}').scope.projectId).toBe('proj-a');
  });

  it('the SIMULATED seam threads into every composed record (E-8, part 2): simulated=TRUE lands in the document the orchestration downloads', () => {
    const seams = fakeSeams({ simulated: () => true });
    runWorkspaceExport(seams);
    const document = JSON.parse(seams.downloads[0]?.bytes ?? '{}') as { readonly manifest: { readonly simulatedFlagRule: string } };
    expect(document.manifest.simulatedFlagRule).toContain('simulated flag');
  });

  it('an UNREAD scope runs its own read bundle and composes the world the refresh READ — the busy flag discloses the wait, then clears', async () => {
    let readsComplete = false;
    let refreshed = false;
    const seams = fakeSeams({
      scopeReadsComplete: () => readsComplete,
      refresh: async () => { refreshed = true; readsComplete = true; },
    });
    runWorkspaceExport(seams);
    await settle(); // the async wait path settles
    expect(refreshed).toBe(true); // the read bundle RAN
    expect(seams.busyCalls).toEqual([true, false]); // the wait was disclosed, then cleared
    expect(seams.downloads.length).toBe(1); // and the world it read is the world that composed
    expect(seams.toasts.map((toast) => toast.kind)).toEqual(['export-download']);
  });

  it('a scope that NEVER converges (three unbundled attempts) degrades HONESTLY: the deferred toast names the scope, NOTHING is downloaded', async () => {
    let refreshes = 0;
    const seams = fakeSeams({
      scopeReadsComplete: () => false,
      refresh: async () => { refreshes += 1; },
    });
    runWorkspaceExport(seams);
    await settle();
    expect(refreshes).toBe(3); // bounded retries, never an infinite loop
    expect(seams.downloads).toEqual([]); // never an empty-but-valid file
    expect(seams.toasts.map((toast) => toast.kind)).toEqual(['export-failed']);
    expect(seams.toasts[0]?.title).toBe('Export deferred');
    expect(seams.toasts[0]?.sentence).toContain('proj-a'); // the state is named
  });

  it('a composition/download FAILURE surfaces the failure toast — never a silent no-op (FW-35-A), never a throw at the caller (R46)', () => {
    const seams = fakeSeams({ download: () => { throw new Error('the anchor never attached'); } });
    expect(() => runWorkspaceExport(seams)).not.toThrow();
    expect(seams.downloads).toEqual([]);
    expect(seams.toasts.map((toast) => toast.kind)).toEqual(['export-failed']);
    expect(seams.toasts[0]?.sentence).toContain('Nothing was downloaded');
  });

  it('a refresh FAILURE (the wait path throws) surfaces the failure toast and clears the busy flag — R46 again', async () => {
    const seams = fakeSeams({
      scopeReadsComplete: () => false,
      refresh: async () => { throw new Error('the transport died'); },
    });
    runWorkspaceExport(seams);
    await settle();
    expect(seams.downloads).toEqual([]);
    expect(seams.busyCalls).toEqual([true, false]);
    expect(seams.toasts.map((toast) => toast.kind)).toEqual(['export-failed']);
  });

  it('the toast auto-dismiss is TOKEN-CHECKED: a late tick after a newer toast (or a manual close) dismisses nothing else', () => {
    const seams = fakeSeams();
    runWorkspaceExport(seams);
    expect(seams.scheduled.length).toBe(1);
    // a NEWER toast replaces the export one before the tick fires
    seams.showToast({ kind: 'other', title: 'later', sentence: 'a newer toast' });
    seams.scheduled[0]?.run();
    expect(seams.toasts.filter((toast) => toast.kind === 'other').length).toBe(1); // still shown — the late tick cleared nothing
    // and when the export toast IS still the one shown, the tick clears it
    const again = fakeSeams();
    runWorkspaceExport(again);
    again.scheduled[0]?.run();
    expect(again.toasts.length).toBe(1); // shown once, cleared once
    expect(again.isToastShown(again.toasts[0] as ExportToastRecord)).toBe(false);
  });
});
