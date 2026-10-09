// @tradrl/web-console — THE EXPORT ORCHESTRATION SEAM (FW-36-B, Round E
// register E-9 — the empty-export-after-switch; extracted from
// apps/web/src/app/console.ts per the FW-34-B payload-budget precedent:
// the no-build console transfers its own source, so the byte budget is
// the law that keeps bootConsole's closure from swallowing the app).
//
// THE LAW (E-9): THE EXPORT NEVER COMPOSES AN UNREAD WORKSPACE. After a
// mid-session project switch + reload, the boot bundle adopts the stored
// scope while the adopted scope's own read bundle only runs on the NEXT
// beat — a window in which the state is the post-adoption RESET world
// (0 capsules / 0 decisions / 0 notices) and the chain still verifies
// over it (L1: an empty-but-valid payload). Here: a CONVERGED scope
// (its read bundle completed — the scopeReadsComplete seam) composes
// synchronously; an UNREAD scope runs its own read bundle and waits
// (bounded retries; a mid-await switch re-runs for whatever scope lands);
// a scope that cannot converge gets the honest degradation toast and
// NOTHING downloads — never an empty-but-valid file. And THE EXPORT
// NEVER SILENCES (FW-35-A): every failure is a toast, never a no-op.
//
// E-8, PART 2 rides through: the `simulated` seam (the boot options'
// own environment truth — the same flag the SIMULATED badges render)
// threads into every record of the composed document (see
// core/workspace.ts EXPORT_SIMULATED_FLAG_RULE for the published
// digest-rule decision). The module is PURE over its seams — no DOM, no
// scheduler, no view object; bootConsole owns the closure state and
// passes narrow accessors, so the orchestration is testable without
// the mount and the app layer keeps every rendering decision.

import type { WorkspaceState } from './workspace';
import { serializeWorkspaceExport } from './workspace';

/** One export-surface toast record (the W-15b-r shape the shell renders). */
export interface ExportToastRecord {
  readonly kind: string;
  readonly title: string;
  readonly sentence: string;
}

/** The narrow seams the orchestration threads (bootConsole owns the closure state; accessors read the LIVE bindings — the wait path's post-refresh world is the world that composes). */
export interface ExportFlowSeams {
  /** The live workspace state (the scope names the file; the state composes the bytes). */
  readonly state: () => WorkspaceState;
  /** The environment truth (E-8, part 2: threads into every record's `simulated` flag). */
  readonly simulated: () => boolean;
  /** E-9: has the CURRENT scope's read bundle completed? (the lastFetchedScope seam; the launchpad is always ready). */
  readonly scopeReadsComplete: () => boolean;
  /** Re-run the current scope's read bundle (the wait path's bounded retry). */
  readonly refresh: () => Promise<void>;
  /** Re-render the shell (after a view mutation). */
  readonly render: () => void;
  /** The auto-dismiss scheduler (undefined = no timer, the pre-scheduler behavior). */
  readonly schedule: ((ms: number, run: () => void) => void) | undefined;
  /** Set/clear the busy flag on the shared view (the wait's in-flight disclosure). */
  readonly setBusy: (busy: boolean) => void;
  /** Show a toast on the shared view. */
  readonly showToast: (toast: ExportToastRecord) => void;
  /** The token check: is this exact toast still shown? (a late tick dismisses nothing else). */
  readonly isToastShown: (toast: ExportToastRecord) => boolean;
  /** Clear the toast on the shared view. */
  readonly clearToast: () => void;
  /** Download the bytes (the anchor + click — the DOM stays in the app layer). */
  readonly download: (fileName: string, bytes: string) => void;
}

/** THE EXPORT ACTION (§5 D7): compose + download — synchronously when the scope's reads converged, bounded wait otherwise, never over an unread (reset) world; every failure is a toast (R46: never a throw at the caller). */
export function runWorkspaceExport(seams: ExportFlowSeams): void {
  /** The W-15b-r toast lifecycle (show + render + token-checked auto-dismiss — the notice toast's own surface). */
  const showExportToast = (toast: ExportToastRecord, ms: number): void => {
    seams.showToast(toast);
    seams.render();
    if (seams.schedule !== undefined) {
      seams.schedule(ms, () => {
        if (seams.isToastShown(toast)) {
          seams.clearToast();
          seams.render();
        }
      });
    }
  };
  const composeAndDownload = (): void => {
    const fileName = `tradrl-workspace-${seams.state().scope.projectId}.json`;
    try {
      // E-8, part 2: the environment truth threads into every record.
      const bytes = serializeWorkspaceExport(seams.state(), seams.simulated());
      // FW-32-B (b3): the download — the anchor + click seam, then the
      // CONFIRMATION toast (M1/M5's "no download toast" finding), ~5s.
      seams.download(fileName, bytes);
      showExportToast({ kind: 'export-download', title: 'Export downloaded', sentence: `${fileName} — verify it any time in Settings: "Verify an export file".` }, 5000);
    } catch (error) {
      // THE HONEST FAILURE (FW-35-A): nothing claimed, nothing hidden —
      // the ~8s auto-dismiss gives the sentence time to be read (an
      // error that must be read, not skimmed).
      const message = (error as Error)?.message ?? String(error);
      showExportToast({ kind: 'export-failed', title: 'Export failed', sentence: `The workspace export could not be composed (${message}). Nothing was downloaded — refresh the page and try again; if it persists, report this as a defect.` }, 8000);
    }
  };
  if (seams.scopeReadsComplete()) {
    composeAndDownload();
    return;
  }
  // THE WAIT PATH (the switch+reload window): run the current scope's
  // bundle, then compose from the world it read — the busy flag
  // discloses the work in flight. Bounded retries: a scope that keeps
  // moving under the export re-runs for whatever scope lands; three
  // unbundled attempts end in the honest degradation toast, never an
  // empty file.
  void (async () => {
    try {
      seams.setBusy(true);
      seams.render();
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (seams.scopeReadsComplete()) break;
        await seams.refresh();
      }
      if (seams.scopeReadsComplete()) {
        seams.setBusy(false);
        composeAndDownload();
        return;
      }
      seams.setBusy(false);
      const stalled = seams.state().scope.projectId;
      showExportToast({ kind: 'export-failed', title: 'Export deferred', sentence: `The workspace for ${stalled} has not finished loading — nothing was downloaded. Wait for the sections to render, then export again.` }, 8000);
    } catch (error) {
      // R46: even the wait path never throws at the user — the same
      // honest failure surface the composition rides.
      seams.setBusy(false);
      const message = (error as Error)?.message ?? String(error);
      showExportToast({ kind: 'export-failed', title: 'Export failed', sentence: `The workspace export could not be composed (${message}). Nothing was downloaded — refresh the page and try again; if it persists, report this as a defect.` }, 8000);
    }
  })();
}
