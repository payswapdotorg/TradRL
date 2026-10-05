// deploy/vercel/build-console-cli.test.ts — THE CLI ROOT-RESOLUTION
// REGRESSION (W-3g) + the prebuilt CLI contract (W-3k).
//
// The build units are deterministic and already pinned (vercel.test.ts) —
// but those tests inject EXPLICIT repoRoot/outputDir paths and never
// exercise the CLI entry's own repo-root resolution, which is exactly how
// W-3g shipped: `new URL('../../../', import.meta.url)` from
// deploy/vercel/build-console.mjs climbs THREE levels from the FILE
// (vercel -> deploy -> repo -> the repo's PARENT), so the CLI looked for
// <parent>/apps/web and died ENOENT — identically on the Vercel build image
// (vercel.json buildCommand: `node deploy/vercel/build-console.mjs`).
//
// This test runs the REAL script as a REAL CLI, exactly the way vercel.json
// does (spawned from the repo root with the relative buildCommand path), in
// a hermetic repo-shaped temp fixture carrying EVERYTHING the prebuilt
// build needs (the W-3k full-build contract):
//
//   <tmp>/parent/                          <- where the W-3g bug built from
//     repo/                                <- the fixture REPO
//       apps/web/...                       <- byte-identical copy of the console
//       deploy/vercel/build-console.mjs    <- byte-identical copy of the script
//       deploy/vercel/function.tsconfig.json
//       deploy/vercel/{api,runtime}/*.ts   <- the function entry graph
//       services/api/src/*.ts              <- the frozen service (emit input)
//       tsconfig.base.json
//       node_modules -> <real repo>/node_modules  (the toolchain provision —
//                            the same provision the platform's installCommand
//                            makes: typescript + @types/node)
//
// The assertions pin the fix + the prebuilt CLI contract: the CLI exits 0,
// announces its output lines (static + function + the prebuilt tree), and
// the COMPLETE Build Output API v3 tree lands under the FIXTURE REPO's
// .vercel/output — NEVER under its parent. A second case spawns from a
// DIFFERENT cwd with an ABSOLUTE script path to pin that the root is
// resolved from the SCRIPT location (import.meta.url), not the cwd.
//
// Zero-dep, offline, deterministic (node:child_process + node:fs + vitest).

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const WEB_DIR = join(REPO_ROOT, 'apps', 'web');
const BUILD_SCRIPT = join(REPO_ROOT, 'deploy', 'vercel', 'build-console.mjs');
const FUNCTION_TSCONFIG = join(REPO_ROOT, 'deploy', 'vercel', 'function.tsconfig.json');

/** Recursively copy a directory tree (byte-identical, files only). */
function copyDirTree(source: string, target: string): void {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.isDirectory()) copyDirTree(join(source, entry.name), join(target, entry.name));
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

// The hermetic repo-shaped fixture (the W-3k full-build shape).
// The parent directory is the exact location the W-3g bug resolved as the
// "repo root" — the negative probes below assert nothing ever lands there.
const FIXTURE_PARENT = mkdtempSync(join(tmpdir(), 'tradrl-cli-root-'));
const FIXTURE_REPO = join(FIXTURE_PARENT, 'repo');
const FIXTURE_SCRIPT = join(FIXTURE_REPO, 'deploy', 'vercel', 'build-console.mjs');
const FIXTURE_OUTPUT = join(FIXTURE_REPO, '.vercel', 'output');
const FIXTURE_FUNC = join(FIXTURE_OUTPUT, 'functions', 'api', 'router.func');

beforeAll(() => {
  copyDirTree(WEB_DIR, join(FIXTURE_REPO, 'apps', 'web'));
  mkdirSync(join(FIXTURE_REPO, 'deploy', 'vercel'), { recursive: true });
  copyFileSync(BUILD_SCRIPT, FIXTURE_SCRIPT);
  copyFileSync(FUNCTION_TSCONFIG, join(FIXTURE_REPO, 'deploy', 'vercel', 'function.tsconfig.json'));
  copyDirTree(join(REPO_ROOT, 'deploy', 'vercel', 'api'), join(FIXTURE_REPO, 'deploy', 'vercel', 'api'));
  copyDirTree(join(REPO_ROOT, 'deploy', 'vercel', 'runtime'), join(FIXTURE_REPO, 'deploy', 'vercel', 'runtime'));
  copyDirTree(join(REPO_ROOT, 'services', 'api', 'src'), join(FIXTURE_REPO, 'services', 'api', 'src'));
  copyFileSync(join(REPO_ROOT, 'tsconfig.base.json'), join(FIXTURE_REPO, 'tsconfig.base.json'));
  // The toolchain provision: the platform's installCommand provisions the
  // workspace devDependencies (typescript + @types/node); the fixture
  // mirrors that provision with a symlink to the real workspace install.
  symlinkSync(join(REPO_ROOT, 'node_modules'), join(FIXTURE_REPO, 'node_modules'), 'dir');
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
    // CLI prints its announcement lines and NO degradation warnings.
    env: { TRADRL_CONSOLE_TOKEN: 'tok-cli-regression', TRADRL_CONSOLE_TENANT_ID: 'tenant-cli-regression' },
  });
}

// THE TIMEOUT LAW (W-8, FW-2-b): these two cases each spawn the REAL CLI —
// a full static copy + a full tsc emit of the function entry graph — and
// the pre-W-8 margin against vitest's 5000ms default was razor-thin (base
// 04cc5d5 measures ~4.4s/case on an idle machine; the W-8 runtime surface
// adds runtime/routes.ts to the emit graph and grows runtime/demo.ts, and a
// loaded CI machine tips the spawn over the default). A timeout here would
// measure MACHINE LOAD, not the contract — the per-test timeout is raised
// to a generous ceiling for these integration-shaped spawns (the assertions
// themselves stay byte-strict).
const FULL_BUILD_SPAWN_TIMEOUT_MS = 60_000;

describe('deploy/vercel/build-console.mjs — the CLI entry resolves the repo root from the script location (W-3g) and emits the prebuilt tree (W-3k)', () => {
  it('spawned as the vercel.json buildCommand (relative path, from the repo root) it builds the COMPLETE prebuilt output under the FIXTURE repo — never its parent', { timeout: FULL_BUILD_SPAWN_TIMEOUT_MS }, async () => {
    const result = runCli(FIXTURE_REPO, 'deploy/vercel/build-console.mjs');
    // The W-3g bug crashed HERE: exit != 0 with an ENOENT stack (it looked
    // for <parent>/apps/web, which does not exist in a repo-shaped layout).
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');

    // The CLI's own announcements: the static tree, the function emit, and
    // the prebuilt output root — all repo-relative, all under .vercel/output.
    const stdout = result.stdout ?? '';
    const staticLine = /^build-console: (\d+) files, (\d+) bytes -> (\S+)\n/m.exec(stdout);
    expect(staticLine).not.toBeNull();
    expect(staticLine?.[3]).toBe('.vercel/output/static');
    expect(Number(staticLine?.[2])).toBeGreaterThan(0);
    const functionLine = /^build-console: function (\d+) files, (\d+) bytes -> (\S+)\n/m.exec(stdout);
    expect(functionLine).not.toBeNull();
    expect(functionLine?.[3]).toBe('.vercel/output/functions/api/router.func');
    expect(Number(functionLine?.[1])).toBeGreaterThan(0);
    expect(stdout).toContain('build-console: values applied ');
    expect(stdout).toMatch(/^build-console: prebuilt deployment -> \.vercel\/output \(config\.json \+ static\/ \+ functions\/api\/router\.func\)\n/m);

    // The static output is the full copy spec, verbatim, substituted.
    const build = await import('./build-console.mjs');
    const spec = build.consoleFileSpec(join(FIXTURE_REPO, 'apps', 'web'));
    expect(spec.length).toBeGreaterThan(5);
    expect(Number(staticLine?.[1])).toBe(spec.length); // the announced count IS the spec size
    expect(walkFiles(join(FIXTURE_OUTPUT, 'static'))).toEqual(spec);
    const substituted = readFileSync(join(FIXTURE_OUTPUT, 'static', 'index.html'), 'utf8');
    expect(substituted).toContain("apiOrigin: ''");
    expect(substituted.includes('http://localhost:8787')).toBe(false);
    expect(substituted).toContain("tenantId: 'tenant-cli-regression'");

    // The prebuilt function: the sealed .func carries the tsc-emitted entry
    // graph + the envelope (index.js requires the entry; NO inner
    // package.json — the W-3k type:module poison law).
    const funcTree = walkFiles(FIXTURE_FUNC);
    expect(funcTree).toContain('deploy/vercel/api/router.js');
    expect(funcTree).toContain('deploy/vercel/runtime/compose.js');
    expect(funcTree).toContain('services/api/src/index.js');
    expect(funcTree).toContain('index.js');
    expect(funcTree.filter((file) => file.endsWith('package.json'))).toEqual(['package.json']);
    expect(readFileSync(join(FIXTURE_FUNC, 'index.js'), 'utf8')).toContain("require('./deploy/vercel/api/router')");
    // The emitted config.json carries the two v2-style routes.
    const emittedConfig = JSON.parse(readFileSync(join(FIXTURE_OUTPUT, 'config.json'), 'utf8')) as { version: number; routes: { src: string; dest: string }[] };
    expect(emittedConfig.version).toBe(3);
    expect(emittedConfig.routes.map((route) => route.src)).toEqual(['/v1/(?<path>.*)', '/internal/(?<path>.*)']);

    // THE W-3g SYMPTOM — nothing may be read from or written to the fixture
    // repo's PARENT: no apps/, no deploy/ outside the fixture repo.
    expect(existsSync(join(FIXTURE_PARENT, 'apps'))).toBe(false);
    expect(existsSync(join(FIXTURE_PARENT, 'deploy'))).toBe(false);
    expect(readdirSync(FIXTURE_PARENT)).toEqual(['repo']); // the parent carries ONLY the repo
    // The old console-only output path is gone (the prebuilt build writes
    // .vercel/output only — never deploy/vercel/dist).
    expect(existsSync(join(FIXTURE_REPO, 'deploy', 'vercel', 'dist'))).toBe(false);
  });

  it('resolves the root from the SCRIPT location, not the cwd (spawned from apps/web with an absolute path, output still under the fixture repo)', { timeout: FULL_BUILD_SPAWN_TIMEOUT_MS }, () => {
    const result = runCli(join(FIXTURE_REPO, 'apps', 'web'), FIXTURE_SCRIPT);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout ?? '').toMatch(/^build-console: \d+ files, \d+ bytes -> \.vercel\/output\/static\n/m);
    // Still the fixture repo's output — a cwd-based root resolution would
    // have written apps/web/.vercel/output instead.
    expect(existsSync(join(FIXTURE_FUNC, 'index.js'))).toBe(true);
    expect(existsSync(join(FIXTURE_REPO, 'apps', 'web', '.vercel'))).toBe(false);
    expect(existsSync(join(FIXTURE_REPO, 'apps', 'web', 'deploy'))).toBe(false);
    expect(existsSync(join(FIXTURE_PARENT, 'deploy'))).toBe(false);
    expect(readdirSync(FIXTURE_PARENT)).toEqual(['repo']);
  });
});
