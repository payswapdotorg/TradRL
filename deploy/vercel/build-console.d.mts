// deploy/vercel/build-console.d.mts — the typed surface of the console
// build script (hand-authored; the .mjs is the implementation — the
// tests import this declaration, tsc stays strict with no `any`).

/** True for files the public static tree never carries (test sources). */
export function isExcluded(relativePath: string): boolean;

/** The complete static console file list (index.html + every non-test src file), relative to apps/web. */
export function consoleFileSpec(webDir: string): string[];

/** Escape a value for a single-quoted JavaScript string literal. */
export function escapeShellConfigValue(value: string): string;

/** The pinned anchors in the FROZEN shell (apps/web/index.html) the substitution rewrites. */
export const SHELL_ANCHORS: {
  readonly apiOrigin: string;
  readonly token: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly simulated: string;
};

/** The host-owned shell configuration values (env-sourced; null = leave the shipped default). */
export interface ShellConfigValues {
  readonly token: string | null;
  readonly tenantId: string | null;
  readonly projectId: string | null;
  readonly simulated: boolean;
}

/** Substitute the shell's __TRADRL_CONSOLE__ block on the copy (fails loudly on a drifted shell). */
export function substituteShellConfig(html: string, values: ShellConfigValues): string;

/** One output file's content digest (names + digests only — never the values). */
export interface BuildDigest {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

/** The build manifest (deterministic; carries no secret values). */
export interface BuildManifest {
  readonly files: number;
  readonly totalBytes: number;
  readonly digests: readonly BuildDigest[];
  readonly valuesApplied: {
    readonly apiOrigin: '';
    readonly token: boolean;
    readonly tenantId: boolean;
    readonly projectId: boolean;
    readonly simulated: boolean;
  };
}

/** Build the static console tree (deterministic: a pure function of apps/web + the values). */
export function buildConsole(options: { webDir: string; outDir: string; values: ShellConfigValues }): BuildManifest;

// ---------------------------------------------------------------------------
// The prebuilt function emit (W-3k — the Build Output API v3 deployment)
// ---------------------------------------------------------------------------

/** One v2-style routing rule of the emitted .vercel/output/config.json. */
export interface FunctionRoute {
  readonly src: string;
  readonly dest: string;
}

/**
 * The routes the emitted config.json carries (probe-proven live: the
 * destination is the function's EXACT mount — must equal runtime/http.ts
 * FUNCTION_MOUNT_PATH verbatim, test-pinned; req.url stays the ORIGINAL
 * public path).
 */
export const FUNCTION_ROUTES: readonly FunctionRoute[];

/** The .vc-config.json the .func carries (the probe-proven minimal shape: nodejs24.x, <=1024MB, <=10s, handler index.js, Nodejs launcher). */
export const FUNCTION_VC_CONFIG: {
  readonly runtime: string;
  readonly memory: number;
  readonly maxDuration: number;
  readonly handler: string;
  readonly launcherType: string;
};

/** The .func root package.json — deliberately NO "type" field (the sealed tree resolves CommonJS; the W-3k law). */
export const FUNCTION_PACKAGE_JSON: {
  readonly name: string;
  readonly private: boolean;
};

/** The single substantive line of the .func index.js: re-export the tsc-emitted entry's default handler. */
export const FUNCTION_ENTRY_LINE: string;

/**
 * Resolve the workspace's own TypeScript compiler (<repoRoot>/node_modules/typescript/bin/tsc).
 * Throws a LOUD typed error naming the problem + remediation when missing — never a silent skip.
 */
export function resolveTypeScriptCompiler(repoRoot: string): string;

/** Run the tsc CommonJS emit of the function entry graph into the .func directory (throws loudly on any compiler failure). */
export function emitFunctionTree(options: { repoRoot: string; funcDir: string }): void;

/** Write the sealed .func envelope: index.js + .vc-config.json + the root package.json (NO "type" field). Deterministic bytes. */
export function writeFunctionEnvelope(funcDir: string): void;

/** The emitted function manifest (the sealed .func tree — digests only, never values). */
export interface FunctionBuildManifest {
  readonly files: number;
  readonly totalBytes: number;
  readonly digests: readonly BuildDigest[];
}

/** The complete prebuilt Build Output API v3 build manifest (deterministic; carries no secret values). */
export interface PrebuiltManifest {
  readonly console: BuildManifest;
  readonly function: FunctionBuildManifest;
  readonly config: { readonly sha256: string; readonly bytes: number };
  readonly routes: FunctionRoute[];
}

/**
 * Emit the COMPLETE prebuilt deployment under outputDir (CLEANED first):
 * config.json + static/ + functions/api/router.func (the sealed CommonJS
 * function). Deterministic: identical inputs -> identical bytes.
 */
export function buildPrebuiltOutput(options: { repoRoot: string; outputDir: string; values: ShellConfigValues }): PrebuiltManifest;
