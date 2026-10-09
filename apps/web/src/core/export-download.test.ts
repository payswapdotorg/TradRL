// FW-36-B (Round E register §3.1 — S5's flow: 5 clicks, no file, a
// false "Export downloaded" toast) — THE EXPORT DOWNLOAD SEAM'S OWN
// PINS. The toast is a RECEIPT, never a wish:
//   - the composition verifies under the SAME file-alone rules the
//     Settings verifier rides before any claim is possible;
//   - the download anchor is clicked IN-TREE (appended, clicked,
//     removed) and the receipt reports whether the click DISPATCHED;
//   - a surface that never receives the click reports dispatched:false —
//     the caller's honest-failure path, never a success claim.

import { describe, expect, it } from 'vitest';
import type { JobRecord, OutcomeRecord } from '../api/contracts';
import { openWorkspace } from './workspace';
import { composeVerifiedExport, dispatchExportDownload, ExportCompositionError, type DownloadAnchor, type DownloadSurface } from './export-download';

const T0 = 1_700_000_000_000;

/** One job record (the workspace test's own fixture shape). */
function jobRecord(): JobRecord {
  return { jobId: 'job-1', kind: 'research', tenant: 'tenant-a', project: 'prj-a', status: 'running', submittedAt: T0 + 20 };
}

/** One outcome record (the interaction test's own fixture shape). */
function outcomeRecord(): OutcomeRecord {
  return {
    outcomeId: 'out-1', ordinal: 1, tenant: 'tenant-a', project: 'prj-a',
    decision: { decisionRef: 'dec-1', intentRef: 'int-1', disposition: 'filled' },
    outcomeClass: 'realized-profit',
    expectation: { expectedQuantity: '10', expectedRealized: '1.5', tolerance: '0.25', declaredBy: 'b1' },
    realization: { filledQuantity: '10', realizedOutcome: '1.75', feeTotal: '0.02', notionalTotal: '1000.00', unrealizedAtDecision: '0.00' },
    deviation: { quantityShortfall: null, realizedGap: '0.25', withinTolerance: true },
    evidence: [{ kind: 'fill', ref: 'fil-1' }],
    lineage: { shadow: { fidelity: { mode: 'shadow' }, riskPolicy: { policyId: 'pol-1', version: 2 }, experiment: null } },
    asOf: T0 + 30, priorChainHead: '00000000',
  } as unknown as OutcomeRecord;
}

/** A workspace state carrying one job + one outcome. */
function stateWithHistory(): ReturnType<typeof openWorkspace> {
  const state = openWorkspace({ tenantId: 'tenant-a', projectId: 'prj-a' }, T0);
  return {
    ...state,
    jobs: [jobRecord()],
    outcomes: [outcomeRecord()],
  };
}

/** One recorded anchor (the click/removal counts a surface's behavior). */
class RecordingAnchor implements DownloadAnchor {
  readonly attributes: Record<string, string> = {};
  clickCount = 0;
  removeCount = 0;
  appendedTo: unknown = null;
  setAttribute(name: string, value: string): void {
    this.attributes[name] = String(value);
  }
  click(): void {
    this.clickCount += 1;
  }
  remove(): void {
    this.removeCount += 1;
  }
}

describe('FW-36-B (Round E register §3.1): the export receipt seam', () => {
  it('composeVerifiedExport verifies through the Settings verifier\'s own rules and returns the receipt numbers (bytes + sealed events)', () => {
    const state = stateWithHistory();
    const { bytes, eventCount } = composeVerifiedExport(state);
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes).toContain('tradrl-workspace-export'); // the composed document is the R9 v2 chain export
    // the receipt's event count is the manifest's own events count (the
    // manifest.counts.events the auditor reads)
    const parsed = JSON.parse(bytes) as { manifest: { counts: { events: number } } };
    expect(eventCount).toBe(parsed.manifest.counts.events);
    expect(eventCount).toBeGreaterThan(0);
  });

  it('a composition that trips the fold surfaces the honest ExportCompositionError — never a receipt (M1\'s 4x class, carried by the same guard)', () => {
    // A record carrying a REASONING-SHAPED key — any fold over it throws
    // (the chain-of-thought firewall's own loud error class).
    const poisoned = { ...outcomeRecord(), rationale: 'hidden reasoning text' } as never;
    const state = {
      ...stateWithHistory(),
      outcomes: [poisoned],
    };
    expect(() => composeVerifiedExport(state)).toThrow(ExportCompositionError);
  });

  it('dispatchExportDownload appends the anchor IN-TREE, clicks it, removes it, and reports dispatched:true (the receipt\'s precondition)', () => {
    const created: RecordingAnchor[] = [];
    const appended: unknown[] = [];
    const surface: DownloadSurface = {
      createElement: (): RecordingAnchor => {
        const anchor = new RecordingAnchor();
        created.push(anchor);
        return anchor;
      },
      appendChild: (node: DownloadAnchor): unknown => {
        appended.push(node);
        return node;
      },
    };
    const dispatched = dispatchExportDownload(surface, 'tradrl-workspace-prj-a.json', '{"format":"tradrl-workspace-export"}');
    expect(dispatched).toBe(true);
    expect(created).toHaveLength(1);
    const anchor = created[0] as RecordingAnchor;
    expect(anchor.attributes['download']).toBe('tradrl-workspace-prj-a.json');
    expect(anchor.attributes['href']).toBe('data:application/json;charset=utf-8,%7B%22format%22%3A%22tradrl-workspace-export%22%7D');
    expect(anchor.clickCount).toBe(1);
    expect(anchor.removeCount).toBe(1);
    expect(appended).toContain(anchor); // IN-TREE before the click — the detached-anchor class is the hardened-context no-op
  });

  it('a surface that never receives the click (no click-capable anchor) reports dispatched:false — the honest failure, never a success claim (S5\'s 5-click no-op class)', () => {
    const anchorless: DownloadAnchor = {
      setAttribute: (): void => undefined,
      // no click(), no remove() — the degraded foreign embedding
    };
    const surface: DownloadSurface = {
      createElement: (): DownloadAnchor => anchorless,
    };
    expect(dispatchExportDownload(surface, 'x.json', '{}')).toBe(false);
    // and a tree that refuses the append still attempts the dispatch (best-effort, never a crash)
    const appended: RecordingAnchor[] = [];
    const refused: DownloadSurface = {
      createElement: (): RecordingAnchor => new RecordingAnchor(),
      appendChild: (node: DownloadAnchor): unknown => {
        appended.push(node as RecordingAnchor);
        throw new Error('tree refuses');
      },
    };
    expect(dispatchExportDownload(refused, 'x.json', '{}')).toBe(true);
    expect(appended).toHaveLength(1);
  });

  it('the composed bytes are the SAME bytes the anchor carries (the receipt\'s byte count is checkable against the landed file)', () => {
    const state = stateWithHistory();
    const { bytes } = composeVerifiedExport(state);
    const created: RecordingAnchor[] = [];
    const surface: DownloadSurface = {
      createElement: (): RecordingAnchor => {
        const anchor = new RecordingAnchor();
        created.push(anchor);
        return anchor;
      },
    };
    dispatchExportDownload(surface, 'tradrl-workspace-prj-a.json', bytes);
    const carried = decodeURIComponent((created[0] as RecordingAnchor).attributes['href'] ?? '').slice('data:application/json;charset=utf-8,'.length);
    expect(carried).toBe(bytes); // byte-identical — the toast\'s "N bytes" is the exact download
  });
});
