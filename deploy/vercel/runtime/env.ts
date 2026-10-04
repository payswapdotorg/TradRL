// deploy/vercel/runtime/env.ts — THE DEPLOYMENT ENVIRONMENT READER (T052).
//
// The deployment's ONLY source of secrets and configuration is the
// environment (Vercel project env vars for the functions; local shell
// env for the console build). SECRETS ARE NEVER HARDCODED and never
// logged: this module reads, validates presence, and reports MISSING
// KEY NAMES ONLY (a value never crosses into an error message).
//
// Zero-dep law: platform APIs only (no npm imports anywhere in deploy/).
//
// Spec anchors: spec/SECURITY.md (secrets at the secure boundary),
// R46 (a missing provider key is a typed degraded state, never a crash),
// D-033 (the free-tier provider set is normative).

/** The API-plane environment the serverless functions consume. */
export interface ApiDeploymentEnv {
  /** The public-plane developer credential token (host-minted, opaque). */
  readonly apiDeveloperToken: string | null;
  /** The developer credential's L12 tenant (the isolation root injected into every request). */
  readonly apiDeveloperTenant: string | null;
  /** The developer credential's principal name (audit WHO). */
  readonly apiDeveloperPrincipal: string | null;
  /** The private-plane internal credential token (optional — internal routes stay closed when absent). */
  readonly apiInternalToken: string | null;
  /** The internal credential's service principal name. */
  readonly apiInternalPrincipal: string | null;
}

/** The console-build environment (consumed by deploy/vercel/build-console.mjs at build time). */
export interface ConsoleBuildEnv {
  readonly consoleToken: string | null;
  readonly consoleTenantId: string | null;
  readonly consoleProjectId: string | null;
  readonly consoleSimulated: boolean;
}

/** The canonical environment key names (documented in deploy/.env.example — the single inventory). */
export const API_ENV_KEYS = {
  apiDeveloperToken: 'TRADRL_API_DEVELOPER_TOKEN',
  apiDeveloperTenant: 'TRADRL_API_DEVELOPER_TENANT',
  apiDeveloperPrincipal: 'TRADRL_API_DEVELOPER_PRINCIPAL',
  apiInternalToken: 'TRADRL_API_INTERNAL_TOKEN',
  apiInternalPrincipal: 'TRADRL_API_INTERNAL_PRINCIPAL',
} as const;

export const CONSOLE_ENV_KEYS = {
  consoleToken: 'TRADRL_CONSOLE_TOKEN',
  consoleTenantId: 'TRADRL_CONSOLE_TENANT_ID',
  consoleProjectId: 'TRADRL_CONSOLE_PROJECT_ID',
  consoleSimulated: 'TRADRL_CONSOLE_SIMULATED',
} as const;

type EnvSource = Readonly<Record<string, string | undefined>>;

function read(env: EnvSource, key: string): string | null {
  const value = env[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Read the API-plane environment (Vercel function env). Absent keys are `null` — never an exception. */
export function readApiEnv(env: EnvSource = process.env): ApiDeploymentEnv {
  return {
    apiDeveloperToken: read(env, API_ENV_KEYS.apiDeveloperToken),
    apiDeveloperTenant: read(env, API_ENV_KEYS.apiDeveloperTenant),
    apiDeveloperPrincipal: read(env, API_ENV_KEYS.apiDeveloperPrincipal),
    apiInternalToken: read(env, API_ENV_KEYS.apiInternalToken),
    apiInternalPrincipal: read(env, API_ENV_KEYS.apiInternalPrincipal),
  };
}

/** Read the console-build environment (the shell-config substitution values). */
export function readConsoleEnv(env: EnvSource = process.env): ConsoleBuildEnv {
  const simulated = read(env, CONSOLE_ENV_KEYS.consoleSimulated);
  return {
    consoleToken: read(env, CONSOLE_ENV_KEYS.consoleToken),
    consoleTenantId: read(env, CONSOLE_ENV_KEYS.consoleTenantId),
    consoleProjectId: read(env, CONSOLE_ENV_KEYS.consoleProjectId),
    // Default TRUE (UX-DESIGN §7 anti-deception): the public deployment
    // claims SIMULATED until the real adapters (W-3b..W-3d) are wired.
    consoleSimulated: simulated === null ? true : simulated !== 'false',
  };
}

/** The API-plane keys that MUST be present for the service to boot (names only — never values). */
export function missingApiEnvKeys(env: ApiDeploymentEnv): readonly string[] {
  const missing: string[] = [];
  if (env.apiDeveloperToken === null) missing.push(API_ENV_KEYS.apiDeveloperToken);
  if (env.apiDeveloperTenant === null) missing.push(API_ENV_KEYS.apiDeveloperTenant);
  if (env.apiDeveloperPrincipal === null) missing.push(API_ENV_KEYS.apiDeveloperPrincipal);
  // The internal plane is OPTIONAL (R46: absent internal credential = internal routes stay closed).
  if (env.apiInternalToken !== null && env.apiInternalPrincipal === null) {
    missing.push(API_ENV_KEYS.apiInternalPrincipal);
  }
  return missing;
}
