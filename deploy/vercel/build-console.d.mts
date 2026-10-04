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
