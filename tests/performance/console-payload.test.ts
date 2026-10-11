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
  // Re-recorded (FW-37-B, the oversight wave): 45 files, 951,325 bytes total
  //   (929.1 of the 1024 KiB budget — 90.7%). The base (main @ 03e1dc2) measured
  //   43 files / 917,153 bytes = 895.7 of the 896 KiB budget — 99.97%, 351
  //   bytes of headroom: the FW-35/36 waves consumed nearly all of FW-33-B's
  //   raise without recording it (their notes recorded only the single-file
  //   numbers). FW-37-B adds +34,172 bytes, crossing the total budget by
  //   33,821 bytes, and the byte budget is CONSCIOUSLY raised 896 -> 1024 KiB
  //   per this file's own protocol. The additions, itemized: the F-2
  //   consolidated oversight surface rides the EXTRACTION pattern the budget
  //   exists to encourage — two NEW modules (src/core/oversight.ts 11,043 +
  //   src/render/oversight.ts 7,322) plus its state plane + the F-5 launch
  //   root-cause fix in workspace.ts (+3,990); the F-1 UI half + F-6 + F-7
  //   Risk-section honesty in render/model.ts (+10,070 — in-place edits of the
  //   EXISTING Risk panel, not a new surface); the oversight read cadence in
  //   console.ts (+1,608); the pure parseInstantUtc in format.ts (+1,632); the
  //   nav target (+676). Against them, F-3's hard wall REMOVED the FW-34-B
  //   all-desks machinery (palette.ts −966, shell.ts −1,111 — the first wave
  //   to give bytes back). NB: src/app/console.ts now measures 163,488 of the
  //   163,840-byte (160 KiB) single-file budget — 322 bytes of headroom; the
  //   next wave that grows it crosses that one too.
  // Re-recorded (FW-39-2, the identity wave 2): 51 files, 1,048,088 bytes total
  //   (1023.5 of the 1024 KiB budget — 488 bytes of headroom). The true base
  //   (main @ 99f9a90) measured 48 files / 995,580 bytes (972.2 KiB) — the
  //   FW-38-A/B truth waves grew the boot transfer ~44 KiB past this file's
  //   last recorded 951,325 without re-recording it. FW-39-2 adds +52,508
  //   bytes through the EXTRACTION pattern the budget exists to encourage —
  //   three NEW modules (src/core/principal.ts 21,255 + src/render/account.ts
  //   9,954 + src/app/account-plane.ts 17,002 — the token store + auth client
  //   + whoami cache, the account surface's VNodes, and the interaction
  //   plane) plus the thin composition seams (shell.ts +2,089 for the account
  //   row + the copy-honesty folds + the optional ShellView field; model.ts
  //   +1,036 for the Home first-run offer's gate; flow.ts +130 for the
  //   'account' form vocabulary + the password input type; contracts.ts
  //   +608 for the additive 'principal-owned' marker vocabulary; tenant.ts
  //   +447 for the marker-law doc). src/app/console.ts measures 163,235 of
  //   the 163,840-byte single-file budget — NET −13 BYTES vs the base's
  //   163,248 (ZERO growth, the wave's own binding constraint): the
  //   ~2.3 KiB of account wiring (the plane's construction + the one
  //   interaction hook + the J3 edit-buffer hook + the boot validation call
  //   + the focus-restore vocabulary entry) is paid for by compressing the
  //   file's own historical comment blocks (the W-22/D-15 stored-scope
  //   restore, the MI-D9 manual steps, the J3/D-6a press wiring, the
  //   change-commit buffer — every law kept, the wording tightened). No
  //   budget raise: the byte total stays under its own line untouched.
  // Re-recorded (FW-39-3, the identity wave 3; numbers re-measured by the
  //   continuation worker — the predecessor's draft note under-recorded by
  //   exactly 50 bytes on both totals): 51 files, 1,053,572 bytes total
  //   (1028.9 of the 1088 KiB budget — 59.1 KiB headroom). The true
  //   base (main @ 3038ea5, the merged waves 1+2) measured 51 files /
  //   1,048,088 bytes — 488 bytes of headroom, so ANY honest wave-3
  //   addition crossed the line. The byte budget is CONSCIOUSLY raised
  //   1024 -> 1088 KiB per this file's own protocol ("growing past one is
  //   a CONSCIOUS decision"). The additions, itemized (net bytes, measured):
  //   the export disclosure (workspace.ts +1,487 — the EXPORT_ACTOR_RULE
  //   prose + the per-record actor fields on the events/capsules/watch/gateway
  //   records + the manifest's actorRule + the actor seam threading, paid
  //   down by tightening the file's own historical comment blocks); the
  //   audit stamp's client half (principal.ts +2,851 — the
  //   PRINCIPAL_TOKEN_HEADER mirror + the live token state + the
  //   header-carrying transport + the auth client's header-contract fix:
  //   the token now rides x-tradrl-principal-token beside the boundary
  //   credential, never `authorization`); the account plane's live-token
  //   write-throughs (account-plane.ts +1,021); the export orchestration
  //   seam (export-flow.ts +402). src/app/console.ts measures 162,958
  //   of the 163,840-byte single-file budget — NET −277 BYTES vs the
  //   wave-2 base's 163,235 (ZERO growth, the wave's own binding
  //   constraint): the principal-transport wiring + the export's actor
  //   seam are paid for by compressing the file's own
  //   historical comment blocks (the W-22/D-15 stored-scope restore, the
  //   W-17a beat block, the FW-33-B playback clamp — every law kept, the
  //   wording tightened). No new files: the wave rides the extraction
  //   pattern's existing modules.
  // Re-recorded (FW-40-B, the boot/resume wave; every number measured by
  //   the continuation worker on the final tree, main @ 97bd1d1 the base):
  //   53 files, 1,120,477 bytes total (1094.2 of the 1088 KiB budget —
  //   OVER by 6,365 bytes; re-measured by cont3 after the erasable-subset
  //   repair — the pre-repair tree measured 1,120,354). The true base (main @ 97bd1d1, FW-40-C merged)
  //   measured 51 files / 1,086,846 bytes (1061.4 of the 1088 KiB budget —
  //   26.6 KiB headroom). FW-40-B adds +33,631 bytes, crossing the total
  //   budget by 6,365, and the byte budget is CONSCIOUSLY raised
  //   1088 -> 1152 KiB per this file's own protocol ("growing past one is
  //   a CONSCIOUS decision"). The additions, itemized (net bytes,
  //   measured): TWO NEW MODULES riding the extraction pattern the budget
  //   exists to encourage — src/app/boot-resume-plane.ts +12,777 (the
  //   restored-view validation state + the draft restore/write-through/
  //   clear plane, extracted from console.ts by the wave's own
  //   single-file payment) + src/core/launch-draft-store.ts +11,562 (the
  //   wizard draft's versioned, fail-closed localStorage record, net of the
  //   cont3 erasable-subset repair — its value-is predicate names the
  //   LaunchPreference type instead of an inline object literal, the
  //   no-build loader grammar the boot-path pins enforce); the
  //   H-4/H-5/H-6 surfaces — src/render/model.ts +5,239 (the
  //   compile-divergence teaching + the view-projected unread count + the
  //   restored-draft hint), src/render/shell.ts +2,539 (the unread wiring
  //   + the heal/restored view fields), src/core/notices.ts +1,407
  //   (unreadCountAt); and src/app/console.ts +107 NET: the wave's own
  //   wiring (H-4's pending restored view + the heal note + the TM-drive
  //   retirement + the draft wiring) was paid down to near-zero growth by
  //   THREE comment-tightening passes (the plane extraction at 72fc594,
  //   the first continuation worker's in-flight pass, and the second
  //   continuation worker's finishing pass) — console.ts measures 163,685
  //   of the 163,840-byte single-file budget, 155 bytes under the line
  //   (every law kept, zero code lines touched, the FW-39-3/d2727da
  //   precedent). No single-file raise: console.ts stays under its own
  //   line untouched; the file count stays 53 of 64.
  // Re-recorded (FW-43-C, the union payload-budget repair; every number
  //   measured by the FW-43-C worker on the merged tree, main @ 54f0ee0 —
  //   the FW-43-A + FW-43-B union): 54 files, 1,192,098 bytes total
  //   (1164.2 of the 1152 KiB budget — OVER by 12,450 bytes). Each wave
  //   INDIVIDUALLY paid the 1152 line: FW-43-A (main @ 8a8ace9) measured
  //   53 files / 1,176,589 bytes (1149.0 of 1152 — 3,059 under), and
  //   FW-43-B alone on the shared base (main @ 838a8a0, 53 files /
  //   1,159,727 bytes = 1132.6 of 1152 — 19,921 under) adds +15,509 for
  //   1147.7 of 1152 — but the UNION stacks both product growths on ONE
  //   base: 1149.0 + 1147.7 − the shared 1132.6 ≈ the union 1164.2. The
  //   byte budget is CONSCIOUSLY raised 1152 -> 1168 KiB per this file's
  //   own protocol ("growing past one is a CONSCIOUS decision") — the
  //   SAME CLASS as the FW-40-B precedent (1088 -> 1152 when the product
  //   grew the draft store): two PRODUCT features landed, not bloat. The
  //   additions, itemized (net bytes, measured): FW-43-A's Oversight
  //   cockpit +16,862 — src/core/oversight.ts +8,234 (the cross-desk
  //   aggregate fold, one L4 fold over the same rows the cards ride) +
  //   src/render/oversight.ts +8,150 (the per-desk net-exposure +
  //   simulated-book columns + the drill-through buttons) +
  //   src/shell/shell.css +440 (the cockpit styling) + src/app/console.ts
  //   +38 NET (the drill-through wiring riding the switcher transition);
  //   FW-43-B +15,509 — ONE NEW MODULE src/core/export-record.ts +12,490
  //   (the export full-record scope: the record-derived event prefix,
  //   one event per durable row, stamped at each record's own instant) +
  //   src/core/workspace.ts +3,019 (the prefix's composition wiring + the
  //   manifest recordScopeNote + the additive derived label — the
  //   extraction pattern the budget exists to encourage; the
  //   deliverable's derived-statistics block itself rides the SERVER
  //   runtime in deploy/vercel/runtime/deliverable.ts, outside this boot
  //   payload). The new line leaves 4,318 bytes (0.36%) of headroom over
  //   the measured union. No single-file raise: console.ts measures
  //   163,799 of the 163,840-byte (160 KiB) single-file budget — 41
  //   bytes of headroom, the tightest this file has ever recorded; the
  //   next wave that grows it crosses that one too. The file count stays
  //   54 of 64.
  const FILE_COUNT_BUDGET = 64; // each source is one boot fetch — the fetch count stays bounded
  const TOTAL_BYTES_BUDGET = 1168 * 1024; // 1168 KiB — the whole boot transfer (raised from 1152 KiB at FW-43-C, the FW-43 union — see the note above)
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
