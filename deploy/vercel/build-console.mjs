#!/usr/bin/env node
// deploy/vercel/build-console.mjs — THE CONSOLE BUILD (T052).
//
// THE BUILD STORY (decided + documented in deploy/README.md): the
// console (apps/web — FROZEN) is a NO-BUILD static application: the
// shell (index.html) fetches its TypeScript sources at runtime through
// the erasable-type loader. Therefore "building the console for
// Vercel" means EXACTLY TWO THINGS, and nothing else:
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
// apps/web is NEVER edited — the substitution happens on the COPY.
// The output is deterministic: identical inputs (the apps/web tree +
// the build env) yield identical bytes (pinned by a test).
//
// Zero-dep law: node:fs, node:path, node:crypto ONLY (no npm deps,
// no bundler, no lockfile touch). Run from the repo root:
//   TRADRL_CONSOLE_TOKEN=... TRADRL_CONSOLE_TENANT_ID=... node deploy/vercel/build-console.mjs
// Output: deploy/vercel/dist/console (the vercel.json outputDirectory).

import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

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

// CLI entry (the vercel.json buildCommand).
if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const repoRoot = resolve(new URL('../../../', import.meta.url).pathname);
  const webDir = join(repoRoot, 'apps/web');
  const outDir = join(repoRoot, 'deploy/vercel/dist/console');
  const values = readConsoleEnvFromProcess();
  const manifest = buildConsole({ webDir, outDir, values });
  process.stdout.write(`build-console: ${manifest.files} files, ${manifest.totalBytes} bytes -> ${relative(repoRoot, outDir)}\n`);
  process.stdout.write(`build-console: values applied ${JSON.stringify(manifest.valuesApplied)}\n`);
  if (values.token === null) {
    process.stdout.write('build-console: WARNING — TRADRL_CONSOLE_TOKEN is not set; the console will boot into its no-credential-token degradation (deploy/README.md §env)\n');
  }
  if (values.tenantId === null) {
    process.stdout.write('build-console: WARNING — TRADRL_CONSOLE_TENANT_ID is not set; the console will boot into its no-tenant degradation (deploy/README.md §env)\n');
  }
}
