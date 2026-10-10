// deploy/vercel/vercel.test.ts — the HOSTING CONFIGURATION INVARIANTS (T052).
//
// vercel.json + the prebuilt deployment build are configuration — these
// tests pin the invariants the deployment's laws require, so a config
// edit that breaks any of them fails CI (offline; no Vercel, no network):
//
//   1. the same-origin /v1: the EMITTED .vercel/output/config.json routes
//      carry /v1/* and /internal/* to the function's EXACT mount path
//      (dest === FUNCTION_MOUNT_PATH — W-3j/W-3k), destinations never
//      leave the origin — therefore NO CORS anywhere (config + function
//      sources);
//   2. the PREBUILT law (W-3k): vercel.json itself carries NO routing
//      (functions/rewrites) and NO outputDirectory — the buildCommand
//      emits the complete Build Output API v3 tree (.vercel/output:
//      config.json + static/ + functions/api/router.func) and the
//      platform accepts it as a prebuilt deployment (@vercel/node is
//      never invoked — there is no api/ directory to discover);
//   3. the toolchain provision: the install step is a FROZEN-LOCKFILE
//      provision of the build toolchain (typescript + @types/node — the
//      workspace's own devDependencies), never a dependency addition;
//      deploy/ itself stays zero-dependency;
//   4. the .func law (W-3k, the type:module poison lesson): the sealed
//      functions/api/router.func tree resolves COMMONJS — its root
//      package.json carries NO "type" field and NO inner package.json
//      exists anywhere in the tree (the W-3j @vercel/node emit copied
//      services/api/package.json — "type": "module" — into the .func and
//      every invocation died with `exports is not defined in ES module
//      scope`); index.js requires the tsc-emitted entry; the .vc-config
//      envelope stays within the Hobby free tier; the emitted function
//      is require()-loadable (an ESM emit or a poisoned scope dies
//      right there);
//   5. the function emit config (deploy/vercel/function.tsconfig.json):
//      module CommonJS + moduleResolution node (the W-3i/W-3j laws, now
//      owned by the build) — never nodenext (TS2835 on the frozen
//      extensionless imports), never an ESM emit;
//   6. the static console source list is COMPLETE against the real
//      apps/web tree + the shell-config substitution anchors exist in
//      the FROZEN shell + the build is deterministic + escaping-safe;
//   7. secrets are never hardcoded anywhere under deploy/ and every env
//      key the code reads is documented in deploy/.env.example; the
//      build outputs (.vercel/, dist/) and secrets (.env*) are
//      gitignored.
//
// Spec anchors: R43/R46, ARCHITECTURE-LOCK L12 (same-origin keeps the
// browser a single trust surface), D-033 (the free-tier provider set).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

/** Strip JSONC comments so a tsconfig.json carrying a header comment parses (tsc accepts them; JSON.parse does not).
 * Full-line `//` comments ONLY — never a block-comment strip: the W-3k config's comments quote glob
 * patterns whose star-slash sequences would open a phantom block comment and eat across the real
 * payload (JSON strings cannot span lines, so a JSON line starting with `//` can never be payload). */
function stripJsonComments(text: string): string {
  return text
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');
}

// ---------------------------------------------------------------------------
// The real prebuilt build (once for this file; the REAL tsc, the REAL
// apps/web + deploy/vercel + services/api trees, into a hermetic tmpdir).
// ---------------------------------------------------------------------------

/** The fixed substitution values every deterministic build in this file uses (a fake token — digests only, never values). */
const TEST_VALUES = { token: 'tok-test-values', tenantId: 'tenant-test', projectId: null, simulated: true } as const;

const OUT_A = mkdtempSync(join(tmpdir(), 'tradrl-prebuilt-a-'));
const OUT_B = mkdtempSync(join(tmpdir(), 'tradrl-prebuilt-b-'));
let buildA: ReturnType<typeof import('./build-console.mjs').buildPrebuiltOutput> | null = null;
let buildB: ReturnType<typeof import('./build-console.mjs').buildPrebuiltOutput> | null = null;

beforeAll(async () => {
  const build = await import('./build-console.mjs');
  // OUT_B is PRE-SEEDED with stale artifacts — the second build must CLEAN
  // them (the stale-artifact law) and still land byte-identical to OUT_A.
  const funcDir = join(OUT_B, 'functions/api/router.func');
  mkdirSync(funcDir, { recursive: true });
  mkdirSync(join(OUT_B, 'static'), { recursive: true });
  writeFileSync(join(OUT_B, 'stale-root.txt'), 'stale');
  writeFileSync(join(funcDir, 'stale-function.js'), 'module.exports = "stale";');
  writeFileSync(join(OUT_B, 'static', 'stale.css'), 'stale');
  buildA = build.buildPrebuiltOutput({ repoRoot: REPO_ROOT, outputDir: OUT_A, values: { ...TEST_VALUES } });
  buildB = build.buildPrebuiltOutput({ repoRoot: REPO_ROOT, outputDir: OUT_B, values: { ...TEST_VALUES } });
}, 120_000);

afterAll(() => {
  rmSync(OUT_A, { recursive: true, force: true });
  rmSync(OUT_B, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. The same-origin /v1 (no CORS exposure) — the EMITTED config.json routes
// ---------------------------------------------------------------------------

describe('deploy/vercel — the hosting config: same-origin /v1, no CORS', () => {
  it('the emitted config.json routes BOTH public planes (/v1, /internal) to the function\'s EXACT mount path (dest === mount, verbatim)', async () => {
    // The W-3j/W-3k routing law (probe-proven live, projects tradrl-router-probe
    // + trrl-probe-tepa): Vercel functions match their EXACT path only — the
    // route destination must be the mount itself (`/api/router`), never a
    // subpath (`/api/router/v1/...` can never resolve). The prebuilt
    // .vercel/output/config.json carries the v2-style rules
    // {"src": "/v1/(?<path>.*)", "dest": "/api/router"} (and the /internal
    // twin), and the platform then hands the function req.url = the ORIGINAL
    // public path (`/v1/meta` stays `/v1/meta`) — the runtime's mount-strip
    // stays as the guard for DIRECT-mount invocations only.
    const build = await import('./build-console.mjs');
    const routes = build.FUNCTION_ROUTES as readonly { src: string; dest: string }[];
    expect(routes.length).toBe(2);
    const bySource = new Map(routes.map((route) => [route.src, route.dest]));
    expect(bySource.get('/v1/(?<path>.*)')).toBe(FUNCTION_MOUNT_PATH);
    expect(bySource.get('/internal/(?<path>.*)')).toBe(FUNCTION_MOUNT_PATH);
    // The EMITTED config.json (not just the constant) carries exactly those
    // routes, and its dest pairs with FUNCTION_MOUNT_PATH verbatim.
    const emitted = JSON.parse(readFileSync(join(OUT_A, 'config.json'), 'utf8')) as { version: number; routes: { src: string; dest: string }[] };
    expect(emitted.version).toBe(3);
    expect(emitted.routes).toEqual([
      { src: '/v1/(?<path>.*)', dest: FUNCTION_MOUNT_PATH },
      { src: '/internal/(?<path>.*)', dest: FUNCTION_MOUNT_PATH },
    ]);
    // The emitted manifest reports the same routes (no drift between the
    // manifest and the artifact).
    expect(buildA?.routes).toEqual(emitted.routes);
  });

  it('every route destination stays on-origin (no absolute URLs — the console never crosses origins)', async () => {
    const build = await import('./build-console.mjs');
    for (const route of build.FUNCTION_ROUTES as readonly { dest: string }[]) {
      expect(route.dest.startsWith('/')).toBe(true);
      expect(route.dest.includes('://')).toBe(false);
    }
  });

  it('NO CORS ANYWHERE: the config carries no cors key and no access-control header; the function sources emit none', () => {
    expect(config.cors).toBeUndefined();
    const serialized = JSON.stringify(config).toLowerCase();
    expect(serialized.includes('access-control')).toBe(false);
    expect(serialized.includes('cors')).toBe(false);
    // The forbidden header family, assembled at runtime so this test's own source stays clean.
    const forbidden = ['access', '-control'].join('').toLowerCase();
    for (const source of ['api/router.ts', 'runtime/auth-routes.ts', 'runtime/compose.ts', 'runtime/durable.ts', 'runtime/durable-world.ts', 'runtime/env.ts', 'runtime/http.ts', 'runtime/routes.ts', 'runtime/session-routes.ts']) {
      const text = readFileSync(join(VERCEL_DIR, source), 'utf8').toLowerCase();
      expect(text.includes(forbidden)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. The prebuilt law (vercel.json carries NO routing / NO outputDirectory)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the hosting config: the prebuilt Build Output API v3 law', () => {
  it('vercel.json carries NO functions, NO rewrites, NO outputDirectory — routing + outputs live in the EMITTED .vercel/output tree', () => {
    // The W-3k design: the buildCommand emits the complete prebuilt
    // deployment (.vercel/output: config.json + static/ + the .func), so
    // vercel.json needs no routing keys at all — @vercel/node is never
    // invoked (there is no repo-root api/ directory to discover), which is
    // exactly what eliminates the W-3h discovery + W-3i typecheck + W-3j
    // emit + W-3k type:module chain of platform-builder failures.
    expect(config.functions).toBeUndefined();
    expect(config.rewrites).toBeUndefined();
    expect(config.outputDirectory).toBeUndefined();
  });

  it('keeps the deployment envelope keys: framework null, the buildCommand, the single region', () => {
    expect(config.framework).toBeNull();
    expect(String(config.buildCommand)).toBe('node deploy/vercel/build-console.mjs');
    expect(config.regions).toEqual(['iad1']);
  });

  it('the repo-root api/ discovery exception is GONE (prebuilt mode needs no discovery shim)', () => {
    // The W-3h shim + the W-3i tsconfig pin were the @vercel/node path's
    // platform requirements. The prebuilt path builds the function itself —
    // a resurrected api/ directory would make @vercel/node DISCOVER a
    // function again (the exact failure chain W-3k eliminates).
    expect(existsSync(join(REPO_ROOT, 'api'))).toBe(false);
  });

  it('the root vercel.json (the b4561b7 hosting-exception copy) is byte-identical to deploy/vercel/vercel.json', () => {
    // Git-based Vercel deploys read the ROOT vercel.json, so any edit to the
    // deploy tree's config must land in BOTH files — the durable-copy drift
    // lesson, pinned byte-exact here.
    const rootCopy = readFileSync(join(REPO_ROOT, 'vercel.json'));
    const deployCopy = readFileSync(join(VERCEL_DIR, 'vercel.json'));
    expect(rootCopy.equals(deployCopy)).toBe(true);
  });

  it('the function emit config (deploy/vercel/function.tsconfig.json) pins the resolution AND the CommonJS emit (the W-3i/W-3j laws, now owned by the build)', () => {
    // The W-3i lesson: moduleResolution "nodenext" (a builder's default
    // synthesis) rejects the repo's extensionless relative imports (TS2835)
    // and collapses services/api's types into cascade errors. The W-3j
    // lesson: an ESM emit (`module: "ESNext"`) is UNLOADABLE at invoke time
    // (extensionless specifiers Node cannot load). The prebuilt build now
    // owns the emit with this config: CommonJS + node10 resolution —
    // extensionless imports stay legal (NEVER add extensions to the frozen
    // services/api sources) and the emit is require()-loadable.
    const pinPath = join(VERCEL_DIR, 'function.tsconfig.json');
    expect(existsSync(pinPath)).toBe(true);
    const pin = JSON.parse(stripJsonComments(readFileSync(pinPath, 'utf8'))) as {
      extends?: string;
      compilerOptions?: { module?: string; moduleResolution?: string; noEmit?: boolean; types?: string[] };
      exclude?: string[];
    };
    expect(pin.extends).toBe('../../tsconfig.base.json');
    expect(String(pin.compilerOptions?.moduleResolution).toLowerCase()).toBe('node');
    expect(String(pin.compilerOptions?.module).toLowerCase()).toBe('commonjs');
    expect(pin.compilerOptions?.noEmit).toBe(false);
    expect(pin.compilerOptions?.types).toContain('node');
    // The vitest-only test sources are never part of the emit (import.meta
    // is illegal under a CommonJS compile — TS1343). The exclude is
    // REPO-ROOT-scoped: exclude patterns resolve relative to the config
    // file, and the repo's test files deep-import the real packages (the
    // interop trip-wires) — a bare test glob silently drags them into
    // the emit (the W-3k exclude-scope law).
    expect(pin.exclude).toContain('../../**/*.test.ts');
  });
});

// ---------------------------------------------------------------------------
// 3. The toolchain provision + the zero-dep law
// ---------------------------------------------------------------------------

describe('deploy/vercel — the hosting config: the toolchain provision + the zero-dep law', () => {
  it('the install step is a FROZEN-LOCKFILE provision of the build toolchain — never a dependency addition', () => {
    // The W-3k platform fact (probe-proven live on the tepa build image,
    // project trrl-echo-probe): a no-op echo installCommand leaves the build
    // image with NO node_modules — the workspace-install seen in every
    // earlier build log was @vercel/node's own function-phase install, which
    // the prebuilt path never runs. The build needs exactly one tool from
    // the workspace's own devDependencies (typescript, for the function
    // emit), so the install step provisions the pinned lockfile state —
    // frozen: the lockfile itself is NEVER modified, no package is EVER
    // added (deploy/ stays zero-dependency; the emitted .func carries no
    // node_modules at all).
    const installCommand = String(config.installCommand);
    expect(installCommand.includes('pnpm install')).toBe(true);
    expect(installCommand.includes('--frozen-lockfile')).toBe(true);
    // Never a dependency ADDITION (word-boundaries matter: "pnpm install"
    // contains the substring "npm install").
    expect(/\b(pnpm|yarn)\s+add\b/.test(installCommand)).toBe(false);
    expect(/\bnpm\s+(i|install)\s+[^-\s]/.test(installCommand)).toBe(false);
  });

  it('the deploy tree stays zero-dependency: no package.json, no node_modules, no lockfile under deploy/', () => {
    for (const file of walkFiles(DEPLOY_DIR)) {
      expect(file.endsWith('package.json')).toBe(false);
      expect(file).not.toContain('node_modules');
    }
    expect(existsSync(join(DEPLOY_DIR, 'package.json'))).toBe(false);
  });

  it('the build outputs and secrets are gitignored (.vercel/ + dist/ + .env*) and the deploy tree stays clean of build artifacts', () => {
    const gitignore = readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8');
    const lines = gitignore.split('\n').map((line) => line.trim());
    expect(lines).toContain('.vercel/');
    expect(lines).toContain('dist/');
    expect(lines).toContain('.env');
    expect(lines).toContain('.env.*');
    // The prebuilt build never writes into deploy/ (the old dist/ output path
    // is gone; the output lives under the gitignored .vercel/output).
    expect(existsSync(join(VERCEL_DIR, 'dist'))).toBe(false);
    expect(statSync(join(VERCEL_DIR, 'vercel.json')).isFile()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. The prebuilt output: the .func law (the W-3k type:module poison lesson)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the prebuilt output: the .func law (CommonJS, sealed, no inner package.json)', () => {
  const FUNC_DIR = () => join(OUT_A, 'functions', 'api', 'router.func');

  it('the output tree is the complete Build Output API v3 shape: config.json + static/ + functions/api/router.func', () => {
    expect(existsSync(join(OUT_A, 'config.json'))).toBe(true);
    expect(existsSync(join(OUT_A, 'static', 'index.html'))).toBe(true);
    expect(existsSync(join(FUNC_DIR(), 'index.js'))).toBe(true);
    // The static tree is EXACTLY the console file spec (no test sources, no extras).
    const staticTree = walkFiles(join(OUT_A, 'static'));
    expect(staticTree.every((file) => !file.endsWith('.test.ts'))).toBe(true);
    expect(staticTree).toContain('index.html');
    expect(staticTree).toContain('src/loader/strip-types.ts');
    // The .func carries the tsc-emitted entry graph, mirrored from the repo
    // root (rootDir = the repo): the entry, the runtime, the frozen service.
    const funcTree = walkFiles(FUNC_DIR());
    expect(funcTree).toContain('deploy/vercel/api/router.js');
    expect(funcTree).toContain('deploy/vercel/runtime/http.js');
    expect(funcTree).toContain('services/api/src/index.js');
    expect(funcTree.every((file) => file.endsWith('.js') || file === 'package.json' || file === '.vc-config.json')).toBe(true);
  });

  it('the .func root package.json carries NO "type" field — the sealed tree resolves CommonJS', async () => {
    const build = await import('./build-console.mjs');
    const pkg = JSON.parse(readFileSync(join(FUNC_DIR(), 'package.json'), 'utf8')) as Record<string, unknown>;
    expect(pkg).toEqual(build.FUNCTION_PACKAGE_JSON);
    expect('type' in pkg).toBe(false);
    expect(pkg.private).toBe(true);
  });

  it('NO inner package.json anywhere in the .func (exactly one, at the .func root — the W-3k type:module poison law)', () => {
    // The W-3k root cause: @vercel/node's emit copied the package.json files
    // it encountered, so the emitted CJS graph's NEAREST package.json
    // (services/api/package.json — "type": "module") made Node treat the
    // CommonJS text as ESM: `ReferenceError: exports is not defined in ES
    // module scope` at module load, every invocation 500. The tsc emit
    // produces .js files ONLY — this pin walks the whole emitted tree and
    // fails if any package.json other than the .func root's ever appears.
    const packageJsons = walkFiles(FUNC_DIR()).filter((file) => file.endsWith('package.json'));
    expect(packageJsons).toEqual(['package.json']);
  });

  it('index.js requires the tsc-emitted entry (one substantive line) — the function\'s true entry stays deploy/vercel/api/router.ts', async () => {
    const build = await import('./build-console.mjs');
    const entry = readFileSync(join(FUNC_DIR(), 'index.js'), 'utf8');
    // Comments aside, the whole file is the one re-export line.
    const code = entry.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n').trim();
    expect(code).toBe("module.exports = require('./deploy/vercel/api/router').default;");
    expect(code).toBe(build.FUNCTION_ENTRY_LINE);
    // The required entry exists in the emitted tree.
    expect(existsSync(join(FUNC_DIR(), 'deploy', 'vercel', 'api', 'router.js'))).toBe(true);
  });

  it('the .vc-config.json envelope stays within the Hobby free tier (<=1024MB, <=60s, the probe-proven runtime + launcher)', async () => {
    const build = await import('./build-console.mjs');
    const vcConfig = JSON.parse(readFileSync(join(FUNC_DIR(), '.vc-config.json'), 'utf8')) as {
      runtime: string; memory: number; maxDuration: number; handler: string; launcherType: string;
    };
    expect(vcConfig).toEqual(build.FUNCTION_VC_CONFIG);
    expect(vcConfig.runtime).toBe('nodejs24.x');
    expect(vcConfig.memory).toBeLessThanOrEqual(1024);
    expect(vcConfig.maxDuration).toBeLessThanOrEqual(60);
    expect(vcConfig.handler).toBe('index.js');
    expect(vcConfig.launcherType).toBe('Nodejs');
  });

  it('the emitted function is CommonJS-LOADABLE: require() of the .func index.js succeeds and exports the handler', () => {
    // The EMIT+EXECUTE proof, distilled: if the emit were ESM (W-3j) or the
    // sealed scope were poisoned by an inner "type": "module" package.json
    // (W-3k), THIS require() dies — `Cannot use import statement outside a
    // module` / `exports is not defined in ES module scope`.
    const requireFromFile = createRequire(join(FUNC_DIR(), 'index.js'));
    const handler = requireFromFile('./index.js') as unknown;
    expect(typeof handler).toBe('function');
  });

  it('a missing TypeScript compiler is a LOUD typed failure — never a silent skip of the function emit', async () => {
    const build = await import('./build-console.mjs');
    const bogusRoot = mkdtempSync(join(tmpdir(), 'tradrl-no-tsc-'));
    try {
      expect(() => build.resolveTypeScriptCompiler(bogusRoot)).toThrow(/TypeScript compiler is missing/);
    } finally {
      rmSync(bogusRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Determinism + the stale-artifact law (the prebuilt build)
// ---------------------------------------------------------------------------

describe('deploy/vercel — the prebuilt build: determinism + the stale-artifact law', () => {
  it('identical inputs -> identical bytes across the WHOLE prebuilt output (static + .func + config.json)', () => {
    const treeA = walkFiles(OUT_A);
    const treeB = walkFiles(OUT_B);
    expect(treeA).toEqual(treeB);
    expect(treeA.length).toBeGreaterThan(40);
    for (const file of treeA) {
      expect(readFileSync(join(OUT_A, file))).toEqual(readFileSync(join(OUT_B, file))); // byte-identical
    }
    // The manifests agree (digests only — same file set, same digests).
    expect(buildA?.function.files).toBe(buildB?.function.files);
    expect(buildA?.function.digests).toEqual(buildB?.function.digests);
  });

  it('the build CLEANS the output directory first — pre-seeded stale artifacts never leak', () => {
    expect(existsSync(join(OUT_B, 'stale-root.txt'))).toBe(false);
    expect(existsSync(join(OUT_B, 'functions', 'api', 'router.func', 'stale-function.js'))).toBe(false);
    expect(existsSync(join(OUT_B, 'static', 'stale.css'))).toBe(false);
  });

  it('the build manifest carries digests ONLY — never the substituted secret values', () => {
    expect(buildA?.console.valuesApplied.token).toBe(true); // booleans only — the token itself never appears
    const serialized = JSON.stringify(buildA);
    expect(serialized.includes(TEST_VALUES.token)).toBe(false);
    expect(serialized.includes(TEST_VALUES.tenantId)).toBe(false);
    // The console digest matches the emitted bytes; the function digest set covers the emitted entry.
    const indexDigest = buildA?.console.digests.find((entry) => entry.path === 'index.html');
    expect(indexDigest?.sha256).toBe(createHash('sha256').update(readFileSync(join(OUT_A, 'static', 'index.html'))).digest('hex'));
    const functionPaths = buildA?.function.digests.map((entry) => entry.path) ?? [];
    expect(functionPaths).toContain('deploy/vercel/api/router.js');
    expect(functionPaths).toContain('index.js');
  });
});

// ---------------------------------------------------------------------------
// 6. The static console source list (complete vs the apps/web tree)
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
// 7. The shell-config substitution (anchors + escaping)
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

  it('the static console build is deterministic on its own (identical inputs -> identical bytes) and copies sources verbatim', async () => {
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
    } finally {
      rmSync(outA, { recursive: true, force: true });
      rmSync(outB, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 8. Secrets + the env inventory
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
});
