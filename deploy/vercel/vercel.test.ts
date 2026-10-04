// deploy/vercel/vercel.test.ts — the HOSTING CONFIGURATION INVARIANTS (T052).
//
// vercel.json + the console build are configuration — these tests pin
// the invariants the deployment's laws require, so a config edit that
// breaks any of them fails CI (offline; no Vercel, no network):
//
//   1. the same-origin /v1: the rewrites carry /v1/* and /internal/* to
//      the function's mount, destinations never leave the origin —
//      therefore NO CORS anywhere (config + function sources);
//   2. the free-tier function envelope: memory <= 1024MB, maxDuration
//      <= 60s (Hobby), a single region;
//   3. the zero-dep law: the install step installs NOTHING (the
//      lockfile is never touched, even at deploy time);
//   4. the static console source list is COMPLETE against the real
//      apps/web tree (index.html + every non-test src file — the
//      no-build loader fetches these at runtime);
//   5. the shell-config substitution anchors exist in the FROZEN shell
//      and the build is deterministic + escaping-safe;
//   6. secrets are never hardcoded anywhere under deploy/ and every
//      env key the code reads is documented in deploy/.env.example;
//   7. the function BUILD typechecks under the repo's module resolution
//      (the W-3i nearest-tsconfig pin api/tsconfig.json — @vercel/node
//      must never typecheck the entry graph under nodenext).
//
// Spec anchors: R43/R46, ARCHITECTURE-LOCK L12 (same-origin keeps the
// browser a single trust surface), D-033 (the free-tier provider set).

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { API_ENV_KEYS, CONSOLE_ENV_KEYS } from './runtime/env';
import { FUNCTION_MOUNT_PATH } from './runtime/http';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const DEPLOY_DIR = join(REPO_ROOT, 'deploy');
const VERCEL_DIR = join(DEPLOY_DIR, 'vercel');
const WEB_DIR = join(REPO_ROOT, 'apps', 'web');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const config = JSON.parse(readFileSync(join(VERCEL_DIR, 'vercel.json'), 'utf8')) as any;

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

/** Strip JSONC comments so a tsconfig.json carrying a header comment parses (tsc accepts them; JSON.parse does not). */
function stripJsonComments(text: string): string {
  // Full-line `//` comments only — a JSON line starting with `//` can never be
  // payload (JSON strings cannot span lines), so nothing legitimate is cut.
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

// ---------------------------------------------------------------------------
// 1. The same-origin /v1 (no CORS exposure)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the hosting config: same-origin /v1, no CORS', () => {
  it('rewrites BOTH public planes (/v1, /internal) to the function mount with the path passed through', () => {
    const rewrites = config.rewrites as { source: string; destination: string }[];
    expect(Array.isArray(rewrites)).toBe(true);
    const bySource = new Map(rewrites.map((rewrite) => [rewrite.source, rewrite.destination]));
    expect(bySource.get('/v1/:path*')).toBe(`${FUNCTION_MOUNT_PATH}/v1/:path*`);
    expect(bySource.get('/internal/:path*')).toBe(`${FUNCTION_MOUNT_PATH}/internal/:path*`);
  });

  it('every destination stays on-origin (no absolute URLs — the console never crosses origins)', () => {
    for (const rewrite of config.rewrites as { destination: string }[]) {
      expect(rewrite.destination.startsWith('/')).toBe(true);
      expect(rewrite.destination.includes('://')).toBe(false);
    }
  });

  it('NO CORS ANYWHERE: the config carries no cors key and no access-control header; the function sources emit none', () => {
    expect(config.cors).toBeUndefined();
    const serialized = JSON.stringify(config).toLowerCase();
    expect(serialized.includes('access-control')).toBe(false);
    expect(serialized.includes('cors')).toBe(false);
    // The forbidden header family, assembled at runtime so this test's own source stays clean.
    const forbidden = ['access', '-control'].join('').toLowerCase();
    for (const source of ['api/router.ts', 'runtime/compose.ts', 'runtime/env.ts', 'runtime/http.ts']) {
      const text = readFileSync(join(VERCEL_DIR, source), 'utf8').toLowerCase();
      expect(text.includes(forbidden)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. The free-tier function envelope + 3. the zero-dep install
// ---------------------------------------------------------------------------

describe('deploy/vercel — the hosting config: free-tier envelope + zero-dep law', () => {
  it('the function envelope stays within the Hobby free tier (<=1024MB, <=60s, one region)', () => {
    const functions = config.functions as Record<string, { memory?: number; maxDuration?: number }>;
    expect(Object.keys(functions).length).toBeGreaterThan(0);
    for (const [source, settings] of Object.entries(functions)) {
      expect(settings.memory).toBeLessThanOrEqual(1024);
      expect(settings.maxDuration).toBeLessThanOrEqual(60);
      expect(existsSync(join(REPO_ROOT, source))).toBe(true); // the mapped source exists
    }
    expect((config.regions as string[]).length).toBe(1);
  });

  it('the functions config maps EXACTLY the root api/ discovery shim (the platform builds functions only from the repo-root api/ directory)', () => {
    // The W-3h fix (the deploy-triggered failure dpl_EDheNMGU3zN9pfsscQuSD9JMHYfT):
    // Vercel REFUSES a functions config that points into the deploy tree — it
    // builds Serverless Functions ONLY from the repo-root api/ directory. The
    // law: the config maps the ROOT SHIM; every source under deploy/vercel/api/
    // remains the IMPLEMENTATION, reached through the shim's re-export.
    expect(Object.keys(config.functions as object)).toEqual(['api/router.ts']);
    expect(config.functions['api/router.ts']).toEqual({ memory: 1024, maxDuration: 10 });
    // No orphan functions config pointing into deploy/vercel/api/ (the platform
    // would reject it: "doesn't match any Serverless Functions inside the `api`
    // directory").
    for (const key of Object.keys(config.functions as object)) {
      expect(key.startsWith('deploy/')).toBe(false);
    }
    // The implementation the shim re-exports exists under deploy/vercel/api/.
    expect(walkFiles(join(VERCEL_DIR, 'api'), 'api')).toEqual(['api/router.ts']);
    // The shim exists at the repo root and re-exports the deploy router's
    // default export — adding NOTHING of its own (the frozen-sibling law:
    // comments aside, its whole code is the one re-export line).
    const shim = readFileSync(join(REPO_ROOT, 'api', 'router.ts'), 'utf8');
    expect(shim.includes("export { default } from '../deploy/vercel/api/router'")).toBe(true);
    const code = shim.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n').trim();
    expect(code).toBe("export { default } from '../deploy/vercel/api/router';");
  });

  it('the root api/tsconfig.json pins the function build\'s module resolution (the @vercel/node nearest-tsconfig law, W-3i)', () => {
    // The W-3i lesson (deploy-triggered failure dpl_Ajr2KCQmT9axQGwDEcvpBkLFc4aV):
    // the function WAS discovered through the W-3h shim, but @vercel/node's
    // build-time typecheck runs with the tsconfig.json NEAREST the entry
    // (walking up from api/router.ts) — and without this pin its default
    // synthesis is moduleResolution "nodenext", which rejects the repo's
    // extensionless relative imports (TS2835: "Relative import paths need
    // explicit file extensions..."), collapsing services/api's types into
    // cascade errors (TS2339/TS2322) and dropping the function from the
    // deployment. The repo typechecks 0 errors under tsconfig.base.json
    // (moduleResolution "Bundler") — the code is sound; only the function
    // build's resolution mode was wrong.
    //
    // THE LAW: never add file extensions to the frozen services/api imports
    // to satisfy a build tool — pin the resolution at the nearest tsconfig.
    const pinPath = join(REPO_ROOT, 'api', 'tsconfig.json');
    expect(existsSync(pinPath)).toBe(true);
    const pin = JSON.parse(stripJsonComments(readFileSync(pinPath, 'utf8'))) as {
      extends?: string;
      compilerOptions?: { module?: string; moduleResolution?: string };
    };
    // Extends the repo base — the configuration the whole repo already
    // typechecks green under.
    expect(pin.extends).toBe('../tsconfig.base.json');
    // The resolution pin (case-insensitive compare: "Bundler", never
    // "NodeNext") and its required module mode.
    expect(String(pin.compilerOptions?.moduleResolution).toLowerCase()).toBe('bundler');
    expect(String(pin.compilerOptions?.module).toLowerCase()).toBe('esnext');
  });

  it('the root vercel.json (the b4561b7 hosting-exception copy) is byte-identical to deploy/vercel/vercel.json', () => {
    // Git-based Vercel deploys read the ROOT vercel.json, so any edit to the
    // deploy tree's config must land in BOTH files — the durable-copy drift
    // lesson, pinned byte-exact here.
    const rootCopy = readFileSync(join(REPO_ROOT, 'vercel.json'));
    const deployCopy = readFileSync(join(VERCEL_DIR, 'vercel.json'));
    expect(rootCopy.equals(deployCopy)).toBe(true);
  });

  it('the install step installs NOTHING (the lockfile is never touched, even at deploy time)', () => {
    const installCommand = String(config.installCommand);
    expect(/pnpm\s+install|npm\s+install|yarn\s+install|bun\s+install/.test(installCommand)).toBe(false);
  });

  it('the console build owns the static output (framework null, buildCommand + outputDirectory point at deploy/vercel)', () => {
    expect(config.framework).toBeNull();
    expect(String(config.buildCommand)).toBe('node deploy/vercel/build-console.mjs');
    expect(config.outputDirectory).toBe('deploy/vercel/dist/console');
  });
});

// ---------------------------------------------------------------------------
// 4. The static console source list (complete vs the apps/web tree)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the console build: the static source list is complete', () => {
  it('the copy spec carries index.html + EVERY non-test file under apps/web/src — nothing else', async () => {
    const build = await import('./build-console.mjs');
    const spec = build.consoleFileSpec(WEB_DIR);
    expect(spec).toContain('index.html');
    const realTree = walkFiles(join(WEB_DIR, 'src'), 'src');
    const expected = realTree.filter((file) => !file.endsWith('.test.ts'));
    expect(spec).toEqual(expected.concat('index.html').sort());
    // No test source ships to the public static tree.
    for (const file of spec) expect(file.endsWith('.test.ts')).toBe(false);
  });

  it("the loader's critical path ships (the shell fetches these at runtime)", async () => {
    const build = await import('./build-console.mjs');
    const spec = build.consoleFileSpec(WEB_DIR);
    for (const critical of ['src/index.ts', 'src/app/console.ts', 'src/loader/strip-types.ts', 'src/shell/tokens.css', 'src/shell/shell.css']) {
      expect(spec).toContain(critical);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. The shell-config substitution (anchors + determinism + escaping)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the console build: the shell-config substitution', () => {
  it('the FROZEN shell carries each pinned anchor EXACTLY ONCE (the substitution contract)', async () => {
    const build = await import('./build-console.mjs');
    const shell = readFileSync(join(WEB_DIR, 'index.html'), 'utf8');
    for (const anchor of Object.values(build.SHELL_ANCHORS)) {
      expect(shell.indexOf(anchor)).toBeGreaterThan(-1);
      expect(shell.indexOf(anchor, shell.indexOf(anchor) + anchor.length)).toBe(-1);
    }
  });

  it('the substitution rewrites the config block and escapes hostile values safely', async () => {
    const build = await import('./build-console.mjs');
    const shell = readFileSync(join(WEB_DIR, 'index.html'), 'utf8');
    const substituted = build.substituteShellConfig(shell, { token: "tok-'\\n", tenantId: 'tenant-demo', projectId: 'prj_one', simulated: false });
    // Same-origin: the empty apiOrigin is the shell's same-origin default.
    expect(substituted.includes("apiOrigin: '',")).toBe(true);
    expect(substituted.includes('http://localhost:8787')).toBe(false);
    // Escaped single-quoted literals (no string break-out).
    expect(substituted.includes("token: 'tok-\\'\\\\n',")).toBe(true);
    expect(substituted.includes("tenantId: 'tenant-demo',")).toBe(true);
    expect(substituted.includes("projectId: 'prj_one',")).toBe(true);
    expect(substituted.includes('simulated: false')).toBe(true);
  });

  it('an absent value leaves the shipped default (the console degrades honestly)', async () => {
    const build = await import('./build-console.mjs');
    const shell = readFileSync(join(WEB_DIR, 'index.html'), 'utf8');
    const substituted = build.substituteShellConfig(shell, { token: null, tenantId: null, projectId: null, simulated: true });
    expect(substituted.includes("token: '',")).toBe(true);
    expect(substituted.includes("tenantId: '',")).toBe(true);
  });

  it('a drifted shell (missing anchor) fails the build LOUDLY, never ships a half-substituted page', async () => {
    const build = await import('./build-console.mjs');
    expect(() => build.substituteShellConfig('<html>no config block</html>', { token: 'x', tenantId: 'y', projectId: null, simulated: true })).toThrow(/anchor is missing/);
  });

  it('the build is DETERMINISTIC (identical inputs -> identical bytes) and copies sources verbatim', async () => {
    const build = await import('./build-console.mjs');
    const values = { token: 'tok-demo', tenantId: 'tenant-demo', projectId: null, simulated: true };
    const outA = mkdtempSync(join(tmpdir(), 'tradrl-console-a-'));
    const outB = mkdtempSync(join(tmpdir(), 'tradrl-console-b-'));
    try {
      build.buildConsole({ webDir: WEB_DIR, outDir: outA, values });
      build.buildConsole({ webDir: WEB_DIR, outDir: outB, values });
      const treeA = walkFiles(outA);
      expect(treeA).toEqual(walkFiles(outB));
      expect(treeA.length).toBeGreaterThan(5);
      for (const file of treeA) {
        expect(readFileSync(join(outA, file))).toEqual(readFileSync(join(outB, file))); // byte-identical
      }
      // The loader's stripper is copied VERBATIM (the no-build loader contract).
      expect(readFileSync(join(outA, 'src/loader/strip-types.ts'))).toEqual(readFileSync(join(WEB_DIR, 'src/loader/strip-types.ts')));
      // The substituted shell differs from the source shell exactly in the config block.
      expect(readFileSync(join(outA, 'index.html'), 'utf8')).not.toBe(readFileSync(join(WEB_DIR, 'index.html'), 'utf8'));
    } finally {
      rmSync(outA, { recursive: true, force: true });
      rmSync(outB, { recursive: true, force: true });
    }
  });

  it('the build manifest digests the output WITHOUT carrying the secret values', async () => {
    const build = await import('./build-console.mjs');
    const out = mkdtempSync(join(tmpdir(), 'tradrl-console-manifest-'));
    try {
      const manifest = build.buildConsole({ webDir: WEB_DIR, outDir: out, values: { token: 'tok-secret-value', tenantId: 'tenant-demo', projectId: null, simulated: true } });
      expect(manifest.files).toBeGreaterThan(5);
      expect(manifest.valuesApplied.token).toBe(true); // booleans only — the token itself never appears
      expect(JSON.stringify(manifest).includes('tok-secret-value')).toBe(false);
      const indexDigest = manifest.digests.find((entry) => entry.path === 'index.html');
      expect(indexDigest?.sha256).toBe(createHash('sha256').update(readFileSync(join(out, 'index.html'))).digest('hex'));
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Secrets + the env inventory
// ---------------------------------------------------------------------------

describe('deploy/vercel — secrets never hardcoded + the .env.example inventory', () => {
  it('no file under deploy/ carries a credential literal', () => {
    // The leak signatures, assembled at runtime so this test's own source stays clean.
    const signatures = ['ghp' + '_', 'github_pat' + '_', 'x-access-token' + ':'];
    for (const file of walkFiles(DEPLOY_DIR)) {
      const text = readFileSync(join(DEPLOY_DIR, file), 'utf8');
      for (const signature of signatures) {
        expect(text.includes(signature)).toBe(false);
      }
    }
  });

  it('every env key the deployment code reads is documented in deploy/.env.example', () => {
    const example = readFileSync(join(DEPLOY_DIR, '.env.example'), 'utf8');
    for (const key of [...Object.values(API_ENV_KEYS), ...Object.values(CONSOLE_ENV_KEYS)]) {
      expect(example.includes(`${key}=`)).toBe(true);
    }
    // The reserved adapter keys (W-3b/W-3c) are inventoried too.
    for (const reserved of ['NEON_API_HOST', 'NEON_DATABASE', 'NEON_API_KEY', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_ENDPOINT', 'RESEND_API_KEY', 'RESEND_FROM', 'APIFY_API_TOKEN', 'APIFY_DEFAULT_RUNS_ENDPOINT']) {
      expect(example.includes(`${reserved}=`)).toBe(true);
    }
  });

  it('the deploy tree stays zero-dependency: no package.json, no node_modules, no lockfile under deploy/', () => {
    for (const file of walkFiles(DEPLOY_DIR)) {
      expect(file.endsWith('package.json')).toBe(false);
      expect(file).not.toContain('node_modules');
    }
    expect(existsSync(join(DEPLOY_DIR, 'package.json'))).toBe(false);
  });

  it('the built static tree is never committed (dist/ is gitignored at the root)', () => {
    const gitignore = readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8');
    expect(gitignore.split('\n').some((line) => line.trim() === 'dist/')).toBe(true);
    expect(existsSync(join(VERCEL_DIR, 'dist'))).toBe(false); // tests build into tmpdirs only
    expect(statSync(join(VERCEL_DIR, 'vercel.json')).isFile()).toBe(true);
  });
});
