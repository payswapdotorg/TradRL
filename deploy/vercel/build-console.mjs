#!/usr/bin/env node
// deploy/vercel/build-console.mjs — THE DEPLOYMENT BUILD (T052).
//
// THE BUILD STORY (decided + documented in deploy/README.md): the
// console (apps/web — FROZEN) is a NO-BUILD static application: the
// shell (index.html) fetches its TypeScript sources at runtime through
// the erasable-type loader. "Building the console for Vercel" means
// exactly two things, and nothing else:
//
//   1. COPY the static tree verbatim: index.html + every non-test file
//      under apps/web/src/ (the loader fetches `./src/...` as text —
//      the .ts files are DATA, served statically; the content-type is
//      irrelevant, the loader reads `.text()`).
//   2. SUBSTITIUTE the host-owned shell configuration block
//      (window.__TRADRL_CONSOLE__ in index.html) for production:
//      apiOrigin -> '' (EMPTY = same-origin: the shell's own default
//      when no origin is configured — apps/web/src/index.ts
//      `apiBaseUrl`), token/tenantId/projectId -> the deployment env
//      values, simulated -> the anti-deception badge (default true
//      until the durable adapters land).
//
// THE PREBUILT FUNCTION EMIT (W-3k): the build ALSO emits the COMPLETE
// Build Output API v3 deployment under .vercel/output — config.json
// (version 3 + the two v2-style routes) + static/ (the console build)
// + functions/api/router.func/ (the CommonJS-emitted entry graph, sealed).
// The platform accepts the tree as a PREBUILT deployment: @vercel/node is
// never invoked (there is no repo-root api/ directory to discover), which
// eliminates the whole chain of platform-builder failures this deployment
// suffered — W-3h (discovery), W-3i (nodenext typecheck), W-3j (the ESM
// emit + subpath rewrites), W-3k (the copied services/api/package.json
// "type": "module" poisoning the CJS scope). The function is emitted by
// tsc — the workspace's own devDependency, the same toolchain the
// platform's installCommand provisions (probe-proven on the tepa build
// image, project trrl-echo-probe: a no-op echo install leaves the image
// with NO node_modules at all).
//
// apps/web is NEVER edited — the substitution happens on the COPY.
// The output is deterministic: identical inputs (the apps/web +
// deploy/vercel + services/api trees + the build env) yield identical
// bytes (pinned by a test).
//
// Zero-dep law: node:fs, node:path, node:crypto, node:url,
// node:child_process ONLY (platform APIs; no npm deps, no bundler, no
// lockfile touch). Run from the repo root:
//   TRADRL_CONSOLE_TOKEN=... TRADRL_CONSOLE_TENANT_ID=... node deploy/vercel/build-console.mjs
// Output: .vercel/output (config.json + static/ + functions/api/router.func).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// The copy spec (the single inventory — the completeness test pins it against the apps/web tree)
// ---------------------------------------------------------------------------

/** True for files the public static tree NEVER carries (test sources; the loader never imports them). */
export function isExcluded(relativePath) {
  return relativePath.endsWith('.test.ts');
}

/**
 * The complete list of files the static console build carries, relative
 * to apps/web: index.html + every non-test file under src/.
 */
export function consoleFileSpec(webDir) {
  const files = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        if (!isExcluded(rel)) files.push(rel);
      }
    }
  };
  walk(join(webDir, 'src'), 'src');
  if (statSync(join(webDir, 'index.html')).isFile()) files.push('index.html');
  files.sort();
  return files;
}

// ---------------------------------------------------------------------------
// The shell-config substitution (the host act at the secure boundary)
// ---------------------------------------------------------------------------

/** Escape a value for a single-quoted JavaScript string literal. */
export function escapeShellConfigValue(value) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** The pinned anchors in the FROZEN shell (apps/web/index.html) the substitution rewrites (a test pins each). */
export const SHELL_ANCHORS = {
  apiOrigin: "apiOrigin: 'http://localhost:8787',",
  token: "token: '',",
  tenantId: "tenantId: '',",
  projectId: "projectId: '',",
  simulated: 'simulated: true',
};

/**
 * Substitute the shell's __TRADRL_CONSOLE__ block on the COPY.
 * Every value is env-sourced (never hardcoded); an absent value leaves
 * the shipped default in place (the console degrades honestly).
 * Fails loudly when an anchor is missing — apps/web is frozen, so a
 * missing anchor means the shell drifted and this build must not ship.
 */
export function substituteShellConfig(html, values) {
  let output = html;
  const replaceOnce = (anchor, replacement, label) => {
    const first = output.indexOf(anchor);
    if (first === -1) {
      throw new Error(`build-console: the frozen shell's ${label} anchor is missing (apps/web drifted) — refusing to build`);
    }
    if (output.indexOf(anchor, first + anchor.length) !== -1) {
      throw new Error(`build-console: the frozen shell's ${label} anchor appears more than once — refusing to build`);
    }
    output = output.slice(0, first) + replacement + output.slice(first + anchor.length);
  };
  // SAME-ORIGIN: the empty apiOrigin makes the console use the page's own
  // origin (apps/web/src/index.ts apiBaseUrl) — /v1 is a rewrite away.
  replaceOnce(SHELL_ANCHORS.apiOrigin, "apiOrigin: '',", 'apiOrigin');
  if (values.token !== null) replaceOnce(SHELL_ANCHORS.token, `token: '${escapeShellConfigValue(values.token)}',`, 'token');
  if (values.tenantId !== null) replaceOnce(SHELL_ANCHORS.tenantId, `tenantId: '${escapeShellConfigValue(values.tenantId)}',`, 'tenantId');
  if (values.projectId !== null) replaceOnce(SHELL_ANCHORS.projectId, `projectId: '${escapeShellConfigValue(values.projectId)}',`, 'projectId');
  replaceOnce(SHELL_ANCHORS.simulated, `simulated: ${values.simulated ? 'true' : 'false'}`, 'simulated');
  return output;
}

// ---------------------------------------------------------------------------
// The build
// ---------------------------------------------------------------------------

function readConsoleEnvFromProcess() {
  const read = (key) => {
    const value = process.env[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
  };
  const simulated = read('TRADRL_CONSOLE_SIMULATED');
  return {
    token: read('TRADRL_CONSOLE_TOKEN'),
    tenantId: read('TRADRL_CONSOLE_TENANT_ID'),
    projectId: read('TRADRL_CONSOLE_PROJECT_ID'),
    // Default TRUE (UX-DESIGN §7 anti-deception): the public deployment
    // claims SIMULATED until the durable adapters (W-3b..W-3d) are wired.
    simulated: simulated === null ? true : simulated !== 'false',
  };
}

/**
 * Build the static console tree. Deterministic: the output bytes are a
 * pure function of the apps/web tree + the substitution values.
 */
export function buildConsole({ webDir, outDir, values }) {
  const spec = consoleFileSpec(webDir);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const digests = [];
  let totalBytes = 0;
  for (const relativePath of spec) {
    const sourcePath = join(webDir, relativePath);
    const targetPath = join(outDir, relativePath);
    mkdirSync(dirname(targetPath), { recursive: true });
    let bytes = readFileSync(sourcePath);
    if (relativePath === 'index.html') {
      bytes = Buffer.from(substituteShellConfig(bytes.toString('utf8'), values), 'utf8');
    }
    writeFileSync(targetPath, bytes);
    totalBytes += bytes.length;
    digests.push({ path: relativePath, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
  }
  // The manifest carries file names + content digests ONLY — never the
  // substituted values (the token is a secret; digests are not).
  return { files: spec.length, totalBytes, digests, valuesApplied: { apiOrigin: '', token: values.token !== null, tenantId: values.tenantId !== null, projectId: values.projectId !== null, simulated: values.simulated } };
}

// ---------------------------------------------------------------------------
// The prebuilt function emit (W-3k — the Build Output API v3 deployment)
// ---------------------------------------------------------------------------

/**
 * The v2-style routes the emitted .vercel/output/config.json carries
 * (probe-proven live, projects trrl-probe-tepa + trrl-router-probe):
 * the destination is the function's EXACT mount path (functions match
 * exact paths only — a subpath destination can never resolve), and the
 * platform hands the function req.url = the ORIGINAL public path
 * (`/v1/meta` stays `/v1/meta`). The dest must equal
 * runtime/http.ts FUNCTION_MOUNT_PATH verbatim — pinned by
 * deploy/vercel/vercel.test.ts.
 */
export const FUNCTION_ROUTES = [
  { src: '/v1/(?<path>.*)', dest: '/api/router' },
  { src: '/internal/(?<path>.*)', dest: '/api/router' },
];

/** The .vc-config.json the .func carries (the probe-proven minimal shape). */
export const FUNCTION_VC_CONFIG = {
  runtime: 'nodejs24.x',
  memory: 1024,
  // W-30 (PROD-504) — THE 60s BELT: the pre-fix value (10) was part of the
  // production API-plane outage: the durable boot projection's ~6-per-project
  // SQL-over-HTTP round trips (≈151 sequential fetches at 25 durable projects,
  // iad1 -> the us-west-2 pooler) exceeded the cap before authn on every cold
  // start -> FUNCTION_INVOCATION_TIMEOUT on every request. The ROOT fix is the
  // W-30 batch (tenant-wide reads — the projection is ~7 round trips and a
  // healthy boot is ~1-3s); this 60s ceiling is the BELT: a SLOW (not dead)
  // Neon degrades to the typed 503-retry path (R46, per-query 8s aborts bound
  // each read) instead of the platform's opaque 504. The Hobby plan's max is
  // 60s — pinned at the ceiling.
  maxDuration: 60,
  handler: 'index.js',
  launcherType: 'Nodejs',
};

/**
 * The .func root package.json — deliberately NO "type" field: the whole
 * sealed tree resolves CommonJS (the W-3k type:module poison lesson).
 */
export const FUNCTION_PACKAGE_JSON = { name: 'tradrl-function', private: true };

/**
 * The single substantive line of the .func index.js: re-export the
 * tsc-emitted entry's default handler as the function's module shape.
 */
export const FUNCTION_ENTRY_LINE = "module.exports = require('./deploy/vercel/api/router').default;";

/** The .func index.js, verbatim (the header documents the seal; the one substantive line is FUNCTION_ENTRY_LINE). */
const FUNCTION_INDEX_JS = [
  '// .vercel/output/functions/api/router.func/index.js — the prebuilt function entry (W-3k).',
  '//',
  '// The Vercel Build Output API invokes the .func through its .vc-config.json',
  '// handler (this file). The function itself is the tsc-emitted CommonJS',
  '// tree mirrored from the repo root (rootDir) — the true entry stays',
  '// deploy/vercel/api/router.ts in the repository; this seal re-exports its',
  '// default handler. The .func root package.json carries NO "type" field and',
  '// there is NO inner package.json anywhere in the tree: the whole sealed',
  '// scope resolves CommonJS (the W-3k lesson — a copied "type": "module"',
  '// package.json made every invocation die with `exports is not defined in',
  '// ES module scope`).',
  FUNCTION_ENTRY_LINE,
  '',
].join('\n');

/**
 * Resolve the workspace's own TypeScript compiler (a root devDependency —
 * the same toolchain the platform's installCommand provisions). A missing
 * compiler is a LOUD typed failure naming the problem and its remediation —
 * NEVER a silent skip of the function emit (a deployment without the
 * function would ship a dead API plane).
 */
export function resolveTypeScriptCompiler(repoRoot) {
  const tscPath = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!existsSync(tscPath)) {
    throw new Error(
      `build-console: the TypeScript compiler is missing at ${relative(repoRoot, tscPath)} — the function emit requires the workspace's own devDependency (typescript). ` +
        `The platform's installCommand provisions it (corepack pnpm install --frozen-lockfile; probe-proven on trrl-echo-probe that a no-op echo install leaves the build image with NO node_modules); ` +
        `locally, run the workspace install at the repo root first. NEVER add an npm dependency to deploy/ to work around this.`,
    );
  }
  return tscPath;
}

/**
 * Run the tsc emit of the function entry graph into the .func directory.
 * tsc is spawned through node:child_process (a platform API) with the
 * build's own compiler config (deploy/vercel/function.tsconfig.json:
 * CommonJS + node10 resolution — the W-3i/W-3j laws). The --outDir flag
 * mirrors the tsconfig's production outDir (hermetic builds may override
 * it); rootDir stays owned by the tsconfig so the emit mirrors the repo
 * layout (deploy/vercel/**, services/api/src/**) inside the .func —
 * exactly what the sealed index.js requires. Any compiler failure is a
 * LOUD typed failure — the build never ships a half-emitted function.
 */
export function emitFunctionTree({ repoRoot, funcDir }) {
  const tscPath = resolveTypeScriptCompiler(repoRoot);
  const tsconfigPath = join(repoRoot, 'deploy', 'vercel', 'function.tsconfig.json');
  if (!existsSync(tsconfigPath)) {
    throw new Error('build-console: deploy/vercel/function.tsconfig.json is missing — the function emit has no compiler config (refusing to ship a half-emitted deployment)');
  }
  const result = spawnSync(process.execPath, [tscPath, '-p', tsconfigPath, '--outDir', funcDir], { cwd: repoRoot, encoding: 'utf8' });
  if (result.error !== undefined) {
    throw new Error(`build-console: the TypeScript compiler could not be spawned (${result.error.message}) — the function emit failed`);
  }
  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    throw new Error(`build-console: the function emit (tsc -p deploy/vercel/function.tsconfig.json --outDir ${funcDir}) FAILED with exit ${result.status}:\n${output}`);
  }
  if (!existsSync(join(funcDir, 'deploy', 'vercel', 'api', 'router.js'))) {
    throw new Error('build-console: the function emit produced no deploy/vercel/api/router.js inside the .func — the entry graph did not compile (refusing to ship an empty function)');
  }
}

/**
 * Write the sealed .func envelope: index.js (the entry seal),
 * .vc-config.json (the probe-proven runtime envelope) and the root
 * package.json (NO "type" field — CommonJS). Deterministic bytes.
 */
export function writeFunctionEnvelope(funcDir) {
  mkdirSync(funcDir, { recursive: true });
  writeFileSync(join(funcDir, 'index.js'), FUNCTION_INDEX_JS);
  writeFileSync(join(funcDir, '.vc-config.json'), `${JSON.stringify(FUNCTION_VC_CONFIG, null, 2)}\n`);
  writeFileSync(join(funcDir, 'package.json'), `${JSON.stringify(FUNCTION_PACKAGE_JSON, null, 2)}\n`);
}

/** Digest a whole emitted tree (sorted relative paths + sha256 + sizes — names and digests only, never values). */
function digestTree(rootDir) {
  const digests = [];
  let totalBytes = 0;
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        const bytes = readFileSync(join(rootDir, rel));
        totalBytes += bytes.length;
        digests.push({ path: rel, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
      }
    }
  };
  walk(rootDir, '');
  digests.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files: digests.length, totalBytes, digests };
}

/**
 * Emit the COMPLETE prebuilt Build Output API v3 deployment:
 *   <outputDir>/config.json                    — version 3 + the two routes
 *   <outputDir>/static/                        — the console build
 *   <outputDir>/functions/api/router.func/     — the sealed CommonJS function
 * The output directory is CLEANED first (stale artifacts must never leak
 * into a deployment). Deterministic: identical inputs -> identical bytes.
 */
export function buildPrebuiltOutput({ repoRoot, outputDir, values }) {
  // 1. CLEAN — a stale .func or static tree from a previous build must
  //    never leak into this deployment.
  rmSync(outputDir, { recursive: true, force: true });
  mkdirSync(outputDir, { recursive: true });
  // 2. STATIC — the console build (copy + substitute).
  const consoleManifest = buildConsole({ webDir: join(repoRoot, 'apps', 'web'), outDir: join(outputDir, 'static'), values });
  // 3. FUNCTION — the tsc CommonJS emit + the sealed envelope.
  const funcDir = join(outputDir, 'functions', 'api', 'router.func');
  emitFunctionTree({ repoRoot, funcDir });
  writeFunctionEnvelope(funcDir);
  const functionManifest = digestTree(funcDir);
  // 4. CONFIG — the Build Output API v3 routing (the probe-proven shape;
  //    NO images key — the platform rejects it without sizes, probe-proven).
  const routes = FUNCTION_ROUTES.map((route) => ({ src: route.src, dest: route.dest }));
  const configJson = `${JSON.stringify({ version: 3, routes }, null, 2)}\n`;
  writeFileSync(join(outputDir, 'config.json'), configJson);
  return {
    console: consoleManifest,
    function: functionManifest,
    config: { sha256: createHash('sha256').update(configJson).digest('hex'), bytes: configJson.length },
    routes,
  };
}

// CLI entry (the vercel.json buildCommand).
// fileURLToPath (node:url) is the correct API for a module URL -> platform
// path (no URL percent-encoding drift, no platform path bugs) — the same
// scriptPath feeds the entry guard and the root resolution below.
const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(scriptPath)) {
  // deploy/vercel/build-console.mjs -> deploy/vercel -> deploy -> the REPO ROOT.
  // (W-3g regression fix: the old `new URL('../../../', import.meta.url)`
  // climbed THREE levels from the FILE — vercel -> deploy -> repo -> the
  // repo's PARENT — so the CLI looked for <parent>/apps/web and died ENOENT
  // both locally and on the Vercel build image.)
  const repoRoot = resolve(dirname(scriptPath), '../..');
  const outputDir = join(repoRoot, '.vercel', 'output');
  const values = readConsoleEnvFromProcess();
  const manifest = buildPrebuiltOutput({ repoRoot, outputDir, values });
  process.stdout.write(`build-console: ${manifest.console.files} files, ${manifest.console.totalBytes} bytes -> ${relative(repoRoot, join(outputDir, 'static'))}\n`);
  process.stdout.write(`build-console: values applied ${JSON.stringify(manifest.console.valuesApplied)}\n`);
  process.stdout.write(`build-console: function ${manifest.function.files} files, ${manifest.function.totalBytes} bytes -> ${relative(repoRoot, join(outputDir, 'functions', 'api', 'router.func'))}\n`);
  process.stdout.write(`build-console: prebuilt deployment -> ${relative(repoRoot, outputDir)} (config.json + static/ + functions/api/router.func)\n`);
  if (values.token === null) {
    process.stdout.write('build-console: WARNING — TRADRL_CONSOLE_TOKEN is not set; the console will boot into its no-credential-token degradation (deploy/README.md §env)\n');
  }
  if (values.tenantId === null) {
    process.stdout.write('build-console: WARNING — TRADRL_CONSOLE_TENANT_ID is not set; the console will boot into its no-tenant degradation (deploy/README.md §env)\n');
  }
}
