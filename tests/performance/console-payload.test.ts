/**
 * T050 — the console boot payload's production budgets (the
 * deterministic performance surface).
 *
 * THE LAW (R36 + the deploy/ tree's no-build console law, pinned as a
 * BYTE BUDGET — never wall clock): apps/web is a NO-BUILD console —
 * the deployed shell fetches `./src/...` TypeScript at runtime
 * through the erasable-type loader, so the console's BOOT TRANSFER is
 * exactly the byte total of `index.html` + every non-test source
 * under `apps/web/src` (the same file set the deploy build's copy
 * spec publishes — `deploy/vercel/build-console.mjs` `isExcluded`
 * pins the *.test.ts exclusion; THIS test pins the payload's SIZE
 * consequences on the real tree: the file count, the byte total, and
 * the largest single fetch each stay under a recorded budget, so a
 * payload regression fails the release gate instead of silently
 * fattening every console boot on the free tier's bandwidth).
 *
 * THE METHOD (the tests/performance/README.md discipline): walk the
 * REAL tree with the deploy build's own exclusion rule, measure
 * bytes, assert the budgets. No network, no clock — the payload is
 * static bytes; the budget is the law.
 *
 * Relation to deploy/vercel/vercel.test.ts: the deploy suite pins
 * the copy SPEC (the complete file list, the exclusion rule, the
 * substitution anchors); THIS suite pins the payload's SIZE LAWS on
 * the real tree — the production consequence of that spec.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const WEB_DIR = join(REPO_ROOT, 'apps', 'web');

/** Recursively list every file under a directory (relative paths, sorted). */
function walkFiles(directory: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) out.push(path);
    }
  };
  visit(directory);
  return out.sort();
}

/** The deploy build's own exclusion rule (build-console.mjs `isExcluded`): test sources never publish. */
function isExcluded(relativePath: string): boolean {
  return relativePath.endsWith('.test.ts');
}

/** The console boot payload: index.html + every non-test file under apps/web/src (the copy spec's set, on the real tree). */
function consolePayload(): { readonly files: readonly string[]; readonly bytes: readonly { readonly file: string; readonly size: number }[] } {
  const sources = walkFiles(join(WEB_DIR, 'src')).filter((file) => !isExcluded(relative(WEB_DIR, file)));
  const files = [join(WEB_DIR, 'index.html'), ...sources];
  const bytes = files.map((file) => ({ file: relative(WEB_DIR, file), size: statSync(file).size }));
  return { files, bytes };
}

describe('the console boot payload budgets (the no-build console\'s boot transfer)', () => {
  // The recorded budgets. Today's measurements (2026-10-05, main @ 14357ae):
  //   38 files, 501,755 bytes total (490.0 KiB), largest file src/loader/strip-types.ts at 61,327 bytes.
  // Re-recorded (FW-33-B, 2026-10-08): 40 files, 808,591 bytes total (789.6 KiB),
  //   largest src/app/console.ts. The T050 headroom was consumed by the fix
  //   waves (main @ 8ab358a measured 763.6 of the 768 KiB budget — 99.4%);
  //   FW-33-B's four product fixes (the in-dialog Propose affordance, the
  //   horizon datetime grammar, the playback speed select + the anchor
  //   clamp, the observed Market World) added 26.0 KiB of source — the
  //   no-build console transfers the source itself, documentation included.
  //   The byte budget was CONSCIOUSLY raised 768 -> 896 KiB per this file's
  //   own protocol ("growing past one is a CONSCIOUS decision" — the
  //   measurement note records this crossing; the next one needs its own).
  //   NB: src/app/console.ts now measures 125.5 of the 128 KiB single-file
  //   budget — the next growth there crosses that one too.
  // The budgets carry deliberate headroom: growing past one is a CONSCIOUS decision.
  // Re-recorded (FW-34-B, 2026-10-08): 42 files, 868,381 bytes total (848.0 of the
  //   896 KiB budget — 94.6%). The single-file budget was CONSCIOUSLY raised
  //   128 -> 160 KiB per this file's own protocol: FW-34-B (the Round C
  //   transition-noise wave — the playback live-edge anchor + free speed, the
  //   session-posture seam, the keyboard/focus law, the export-verify commit
  //   buffer, the all-desks disclosure) added ~23 KiB of app-layer wiring to
  //   src/app/console.ts (125.5 -> 148.8 KiB — the crossing FW-33-B's own note
  //   predicted: "the next growth there crosses that one too"). The wave also
  //   added two NEW modules (src/core/posture.ts 9.6 KiB, src/core/blotter.ts
  //   3.4 KiB) — the extraction pattern the budget exists to encourage; the
  //   remainder is interaction-layer wiring (the one delegated resolver) that
  //   has no pure home. The byte total stays under its own budget untouched.
  const FILE_COUNT_BUDGET = 64; // each source is one boot fetch — the fetch count stays bounded
  const TOTAL_BYTES_BUDGET = 896 * 1024; // 896 KiB — the whole boot transfer (raised from 768 KiB at FW-33-B — see the note above)
  const LARGEST_FILE_BUDGET = 160 * 1024; // 160 KiB — one fetch + one strip pass (raised from 128 KiB at FW-34-B — see the note above)

  it('the payload is the copy spec\'s set on the real tree: index.html + non-test sources, NO test sources, the loader\'s critical path present', () => {
    const { files, bytes } = consolePayload();
    const relativeFiles = bytes.map((entry) => entry.file);
    expect(relativeFiles).toContain('index.html');
    expect(relativeFiles).toContain(join('src', 'loader', 'strip-types.ts')); // the boot-critical path (the shell fetches it first)
    expect(relativeFiles.some((file) => file.endsWith('.test.ts'))).toBe(false); // test sources never publish (the deploy law, measured on the real tree)
    // The tree REALLY has test sources (the exclusion is real work, not a vacuous filter).
    const testSources = walkFiles(join(WEB_DIR, 'src')).filter((file) => isExcluded(relative(WEB_DIR, file)));
    expect(testSources.length).toBeGreaterThan(20);
    expect(files.length).toBe(bytes.length);
  });

  it('the payload file count stays under the budget (bounded boot fetches)', () => {
    const { bytes } = consolePayload();
    expect(bytes.length).toBeGreaterThan(30); // the teeth: the walk measured a real payload, never zero
    expect(bytes.length).toBeLessThanOrEqual(FILE_COUNT_BUDGET);
  });

  it('the payload byte total stays under the budget (the boot transfer is bounded)', () => {
    const { bytes } = consolePayload();
    const total = bytes.reduce((sum, entry) => sum + entry.size, 0);
    expect(total).toBeGreaterThan(256 * 1024); // the teeth: the measurement is real (today: ~490 KiB)
    expect(total).toBeLessThanOrEqual(TOTAL_BYTES_BUDGET);
  });

  it('the largest single file stays under the budget (one fetch + one strip pass is bounded)', () => {
    const { bytes } = consolePayload();
    const largest = bytes.reduce((max, entry) => (entry.size > max.size ? entry : max));
    expect(largest.size).toBeGreaterThan(16 * 1024); // the teeth: today the loader is the largest at ~61 KiB
    expect(largest.size).toBeLessThanOrEqual(LARGEST_FILE_BUDGET);
  });

  it('every payload file is non-empty and readable as UTF-8 (a truncated publish cannot boot)', () => {
    const { bytes } = consolePayload();
    for (const entry of bytes) {
      expect(entry.size).toBeGreaterThan(0);
      expect(() => readFileSync(join(WEB_DIR, entry.file), 'utf8')).not.toThrow();
    }
  });
});
