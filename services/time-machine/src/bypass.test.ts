// The no-bypass suite (acceptance criterion 8): a projection without
// firewall passage is a TYPED error, every projection passes through the
// port (call-count evidence), the production source contains no import
// path to any store/firewall package (law D-004 mirrors only), and the
// acceptance grep ("no ': any' / 'as any'") holds as a self-check.
//
// This file reads the package's own sources — the same evidence the gate
// greps — so a violation fails the suite, not just the review.

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  createReferenceFirewallPort,
  referenceFirewallProject,
  restoreTimeMachine,
  type FirewallProjectionPort,
} from './index';
import { DATASET, TENANT, drainAt, feed, idsOf, machineOf, openCursor, rawEvent, viewAt } from './fixtures';

/** Recursively collect file paths under a directory. */
function collectFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      files.push(...collectFiles(path));
    } else if (path.endsWith('.ts')) {
      files.push(path);
    }
  }
  return files;
}

const SRC_DIR = join(__dirname);

describe('structural no-bypass: the source cannot reach a store or firewall package', () => {
  it('production modules import ONLY relative paths (zero runtime deps; law D-004 mirrors)', () => {
    const production = collectFiles(SRC_DIR).filter((path) => !path.endsWith('.test.ts'));
    expect(production.length).toBeGreaterThan(10);
    const offenders: string[] = [];
    for (const path of production) {
      const source = readFileSync(path, 'utf8');
      for (const line of source.split('\n')) {
        const importMatch = /^\s*import\b/.test(line) || /^\s*export\b.*\bfrom\b/.test(line);
        if (!importMatch) continue;
        if (line.includes("'./") || line.includes('"./')) continue;
        offenders.push(`${path}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('test modules import only vitest and relative paths (no sibling-package reach)', () => {
    const tests = collectFiles(SRC_DIR).filter((path) => path.endsWith('.test.ts'));
    expect(tests.length).toBeGreaterThan(5);
    const offenders: string[] = [];
    for (const path of tests) {
      const source = readFileSync(path, 'utf8');
      for (const line of source.split('\n')) {
        const importMatch = /^\s*import\b/.test(line) || /^\s*export\b.*\bfrom\b/.test(line);
        if (!importMatch) continue;
        if (line.includes("'./") || line.includes('"./')) continue;
        if (line.includes("'vitest'")) continue;
        offenders.push(`${path}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the acceptance self-check: no ": any" and no "as any" anywhere in the package sources', () => {
    const offenders: string[] = [];
    for (const path of collectFiles(SRC_DIR)) {
      const source = readFileSync(path, 'utf8');
      const lines = source.split('\n');
      lines.forEach((line, index) => {
        if (/: any\b/.test(line) || /as any\b/.test(line)) {
          offenders.push(`${path}:${index + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('no node: imports in production modules (pure contract code; tests may read their own sources)', () => {
    const production = collectFiles(SRC_DIR).filter((path) => !path.endsWith('.test.ts'));
    const offenders: string[] = [];
    for (const path of production) {
      const source = readFileSync(path, 'utf8');
      for (const line of source.split('\n')) {
        if (/^\s*import\b.*['"]node:/.test(line)) offenders.push(`${path}: ${line.trim()}`);
        if (/\brequire\s*\(/.test(line)) offenders.push(`${path}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('typed firewall_required: a projection without firewall passage is impossible', () => {
  it('a no-passage machine ingests fine but EVERY projection is a typed error', () => {
    const machine = machineOf({ firewall: null });
    const receipt = feed(machine, [rawEvent('evt-1', 1_000), rawEvent('evt-2', 2_000)], 'batch-1');
    expect(receipt.admitted).toBe(2);

    const view = machine.asOf({ dataset: DATASET, at: 5_000 as never });
    expect(view.ok).toBe(false);
    if (view.ok) return;
    expect(view.error.code).toBe('firewall_required');
    expect(view.error.message).toContain('knowledge firewall');

    const cursor = machine.openCursor();
    expect(cursor.ok).toBe(true);
    if (!cursor.ok) return;
    const drain = machine.drainCursor(cursor.value.cursor_id, 5_000 as never);
    expect(drain.ok).toBe(false);
    if (drain.ok) return;
    expect(drain.error.code).toBe('firewall_required');
  });

  it('a machine that LOSES its port at restore cannot project either (no silent fallback)', () => {
    const machine = machineOf();
    feed(machine, [rawEvent('evt-1', 1_000)], 'batch-1');
    const restored = restoreTimeMachine(machine.snapshot());
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    const drain = restored.value.openCursor();
    expect(drain.ok).toBe(true);
    if (!drain.ok) return;
    const projection = restored.value.drainCursor(drain.value.cursor_id, 5_000 as never);
    expect(projection.ok).toBe(false);
    if (projection.ok) return;
    expect(projection.error.code).toBe('firewall_required');
  });
});

describe('delegation evidence: every projection passes through the port exactly once', () => {
  /** A counting proxy around the reference port. */
  function countingPort(counter: { calls: number }): FirewallProjectionPort {
    return {
      project(base, clock, tenant, filter) {
        counter.calls += 1;
        return referenceFirewallProject(base, clock, tenant, filter);
      },
    };
  }

  it('asOf and drainCursor each route ONE port passage; ingestion routes NONE', () => {
    const counter = { calls: 0 };
    const machine = machineOf({ firewall: countingPort(counter) });

    feed(machine, [rawEvent('evt-1', 1_000), rawEvent('evt-2', 5_000)], 'batch-1');
    expect(counter.calls).toBe(0); // ingestion is not a projection

    viewAt(machine, 10_000);
    expect(counter.calls).toBe(1);

    const cursor = openCursor(machine);
    drainAt(machine, cursor.cursor_id, 10_000);
    expect(counter.calls).toBe(2);

    // stats / quarantine / rejections / snapshot never touch the port either.
    machine.stats();
    machine.quarantine();
    machine.rejections();
    machine.snapshot();
    expect(counter.calls).toBe(2);
  });

  it('a REJECTING port surfaces as a typed firewall_rejected (the authority propagates)', () => {
    const rejecting: FirewallProjectionPort = {
      project() {
        return { ok: false, error: { code: 'invalid_base', message: 'the authority refuses' } };
      },
    };
    const machine = machineOf({ firewall: rejecting });
    feed(machine, [rawEvent('evt-1', 1_000)], 'batch-1');
    const view = machine.asOf({ dataset: DATASET, at: 5_000 as never });
    expect(view.ok).toBe(false);
    if (view.ok) return;
    expect(view.error.code).toBe('firewall_rejected');
    expect(view.error.message).toContain('invalid_base');
    expect(view.error.message).toContain('the authority refuses');
  });

  it('the reference port itself is frozen and stateless (pure decisions)', () => {
    const port = createReferenceFirewallPort();
    expect(Object.isFrozen(port)).toBe(true);
    // Repeated identical projections produce identical results.
    const machine = machineOf();
    feed(machine, [rawEvent('evt-1', 1_000)], 'batch-1');
    const base = { records: [], size: 0 };
    const first = port.project(base as never, { now: 5_000 as never }, TENANT, {});
    const second = port.project(base as never, { now: 5_000 as never }, TENANT, {});
    expect(second).toEqual(first);
    expect(idsOf(viewAt(machine, 1_000).records)).toEqual(['evt-1']);
  });
});
