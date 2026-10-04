// deploy/vercel/build-console-cli.test.ts — THE CLI ROOT-RESOLUTION
// REGRESSION (W-3g).
//
// The buildConsole() unit is deterministic and already pinned (vercel.test.ts
// §4/§5) — but those tests inject EXPLICIT webDir/outDir paths and never
// exercise the CLI entry's own repo-root resolution, which is exactly how
// W-3g shipped: `new URL('../../../', import.meta.url)` from
// deploy/vercel/build-console.mjs climbs THREE levels from the FILE
// (vercel -> deploy -> repo -> the repo's PARENT), so the CLI looked for
// <parent>/apps/web and died ENOENT — identically on the Vercel build image
// (vercel.json buildCommand: `node deploy/vercel/build-console.mjs`).
//
// This test runs the REAL script as a REAL CLI, exactly the way vercel.json
// does (spawned from the repo root with the relative buildCommand path), in
// a hermetic repo-shaped temp fixture:
//
//   <tmp>/parent/                        <- where the W-3g bug built from
//     repo/                              <- the fixture REPO
//       apps/web/...                     <- byte-identical copy of the console
//       deploy/vercel/build-console.mjs  <- byte-identical copy of the script
//
// The assertions pin the fix: the CLI exits 0, announces its file count +
// the repo-relative output path, and the output lands under the FIXTURE REPO
// (deploy/vercel/dist/console) — NEVER under its parent. A second case
// spawns from a DIFFERENT cwd with an ABSOLUTE script path to pin that the
// root is resolved from the SCRIPT location (import.meta.url), not the cwd.
//
// Zero-dep, offline, deterministic (node:child_process + node:fs + vitest).

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const WEB_DIR = join(REPO_ROOT, 'apps', 'web');
const BUILD_SCRIPT = join(REPO_ROOT, 'deploy', 'vercel', 'build-console.mjs');

/** Recursively copy a directory tree (byte-identical, files only). */
function copyTree(source: string, target: string): void {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.isDirectory()) copyTree(join(source, entry.name), join(target, entry.name));
    else if (entry.isFile()) copyFileSync(join(source, entry.name), join(target, entry.name));
  }
}

/** Recursively list every file under a directory (relative paths, sorted). */
function walkFiles(dir: string, prefix = ''): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...walkFiles(join(dir, entry.name), rel));
    else if (entry.isFile()) files.push(rel);
  }
  return files.sort();
}

// The hermetic repo-shaped fixture: <tmp>/parent/repo/{apps/web, deploy/vercel}.
// The parent directory is the exact location the W-3g bug resolved as the
// "repo root" — the negative probes below assert nothing ever lands there.
const FIXTURE_PARENT = mkdtempSync(join(tmpdir(), 'tradrl-cli-root-'));
const FIXTURE_REPO = join(FIXTURE_PARENT, 'repo');
const FIXTURE_SCRIPT = join(FIXTURE_REPO, 'deploy', 'vercel', 'build-console.mjs');
const FIXTURE_DIST = join(FIXTURE_REPO, 'deploy', 'vercel', 'dist', 'console');

beforeAll(() => {
  copyTree(WEB_DIR, join(FIXTURE_REPO, 'apps', 'web'));
  mkdirSync(join(FIXTURE_REPO, 'deploy', 'vercel'), { recursive: true });
  copyFileSync(BUILD_SCRIPT, FIXTURE_SCRIPT);
});

afterAll(() => {
  rmSync(FIXTURE_PARENT, { recursive: true, force: true });
});

/** Run the fixture's build-console.mjs as a real CLI (the vercel.json buildCommand shape). */
function runCli(cwd: string, scriptArg: string) {
  return spawnSync(process.execPath, [scriptArg], {
    cwd,
    encoding: 'utf8',
    // Controlled env: no ambient TRADRL_* leakage; token+tenant set, so the
    // CLI prints its two announcement lines and NO degradation warnings.
    env: { TRADRL_CONSOLE_TOKEN: 'tok-cli-regression', TRADRL_CONSOLE_TENANT_ID: 'tenant-cli-regression' },
  });
}

describe('deploy/vercel/build-console.mjs — the CLI entry resolves the repo root from the script location (W-3g)', () => {
  it('spawned as the vercel.json buildCommand (relative path, from the repo root) it builds under the FIXTURE repo — never its parent', async () => {
    const result = runCli(FIXTURE_REPO, 'deploy/vercel/build-console.mjs');
    // The W-3g bug crashed HERE: exit != 0 with an ENOENT stack (it looked
    // for <parent>/apps/web, which does not exist in a repo-shaped layout).
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');

    // The CLI's own announcement: file count + bytes + the repo-relative output path.
    const stdout = result.stdout ?? '';
    const announced = /^build-console: (\d+) files, (\d+) bytes -> (\S+)\n/m.exec(stdout);
    expect(announced).not.toBeNull();
    expect(announced?.[3]).toBe('deploy/vercel/dist/console'); // the vercel.json outputDirectory
    expect(Number(announced?.[2])).toBeGreaterThan(0);
    expect(stdout).toContain('build-console: values applied ');

    // The output lands under the FIXTURE REPO — the full copy spec, verbatim.
    const build = await import('./build-console.mjs');
    const spec = build.consoleFileSpec(join(FIXTURE_REPO, 'apps', 'web'));
    expect(spec.length).toBeGreaterThan(5);
    expect(Number(announced?.[1])).toBe(spec.length); // the announced count IS the spec size
    expect(walkFiles(FIXTURE_DIST)).toEqual(spec);
    // The substituted shell shipped (same-origin; the dev origin is gone).
    const substituted = readFileSync(join(FIXTURE_DIST, 'index.html'), 'utf8');
    expect(substituted).toContain("apiOrigin: ''");
    expect(substituted.includes('http://localhost:8787')).toBe(false);
    expect(substituted).toContain("tenantId: 'tenant-cli-regression'");

    // THE W-3g SYMPTOM — nothing may be read from or written to the fixture
    // repo's PARENT: no apps/, no deploy/ outside the fixture repo.
    expect(existsSync(join(FIXTURE_PARENT, 'apps'))).toBe(false);
    expect(existsSync(join(FIXTURE_PARENT, 'deploy'))).toBe(false);
    expect(readdirSync(FIXTURE_PARENT)).toEqual(['repo']); // the parent carries ONLY the repo
  });

  it('resolves the root from the SCRIPT location, not the cwd (spawned from apps/web with an absolute path, output still under the fixture repo)', () => {
    const result = runCli(join(FIXTURE_REPO, 'apps', 'web'), FIXTURE_SCRIPT);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout ?? '').toMatch(/^build-console: \d+ files, \d+ bytes -> deploy\/vercel\/dist\/console\n/m);
    // Still the fixture repo's dist — a cwd-based root resolution would have
    // written apps/web/deploy/vercel/dist/console instead.
    expect(existsSync(join(FIXTURE_DIST, 'index.html'))).toBe(true);
    expect(existsSync(join(FIXTURE_REPO, 'apps', 'web', 'deploy'))).toBe(false);
    expect(existsSync(join(FIXTURE_PARENT, 'deploy'))).toBe(false);
    expect(readdirSync(FIXTURE_PARENT)).toEqual(['repo']);
  });
});
