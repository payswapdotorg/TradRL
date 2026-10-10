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

import { readProviderEnv, type ProviderEnv } from '../../wire/composition';

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
  /**
   * The PRINCIPAL AUTH token-signing key (FW-39-1, optional): the HMAC
   * key the host-owned /v1/auth/* routes sign + verify principal session
   * tokens with (Node platform crypto — the zero-dep law). When ABSENT the
   * auth routes answer the typed not-available 503 (R46 — the surface
   * requires configuration, never a fallback key derived from another
   * credential). NAMES only in errors, never values.
   */
  readonly authTokenKey: string | null;
  /** The explicit backing override (`TRADRL_DEPLOY_BACKING`): the raw string, `null` when unset (validated at the composition seam — fail-closed). */
  readonly deployBacking: string | null;
  /** The durable-provider keys PRESENT in the source (NAMES only, never values) — the auto-resolution input for the backing. */
  readonly durableProviderKeysPresent: readonly string[];
  /**
   * The durable-provider environment (the VALUES — the wire's readProviderEnv,
   * the single provider implementation). The W-25D hydration seam's input:
   * which adapters are enabled and the Neon store configuration. The values
   * never cross into any error message (the names-only law above holds).
   */
  readonly providers: ProviderEnv;
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
  authTokenKey: 'TRADRL_AUTH_TOKEN_KEY',
  deployBacking: 'TRADRL_DEPLOY_BACKING',
} as const;

export const CONSOLE_ENV_KEYS = {
  consoleToken: 'TRADRL_CONSOLE_TOKEN',
  consoleTenantId: 'TRADRL_CONSOLE_TENANT_ID',
  consoleProjectId: 'TRADRL_CONSOLE_PROJECT_ID',
  consoleSimulated: 'TRADRL_CONSOLE_SIMULATED',
} as const;

// ---------------------------------------------------------------------------
// The backing resolution (W-3f — which ports back the data routes)
// ---------------------------------------------------------------------------

/** Which backing services the composed API is served over. */
export type DeployBacking = 'demo' | 'durable';

/** The legal `TRADRL_DEPLOY_BACKING` values (the fail-closed message names them). */
export const DEPLOY_BACKING_VALUES: readonly DeployBacking[] = ['demo', 'durable'];

/**
 * The durable-provider keys whose PRESENCE (any of them) selects the
 * durable backing when `TRADRL_DEPLOY_BACKING` is unset. The SAME key
 * names `deploy/wire/composition.ts` reads (`readProviderEnv` — the
 * single provider implementation); only the NAMES live here, never
 * values. An empty set = no durable provider configured = the DEMO
 * backing (the public free-tier default — exactly what the SIMULATED
 * badge exists for, UX-DESIGN §7).
 */
export const DURABLE_PROVIDER_ENV_KEYS = [
  'NEON_API_HOST',
  'NEON_DATABASE',
  'NEON_API_USER',
  'NEON_API_KEY',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
] as const;

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
    authTokenKey: read(env, API_ENV_KEYS.authTokenKey),
    deployBacking: read(env, API_ENV_KEYS.deployBacking),
    durableProviderKeysPresent: DURABLE_PROVIDER_ENV_KEYS.filter((key) => read(env, key) !== null),
    providers: readProviderEnv(env),
  };
}

/**
 * Resolve the backing (pure): the explicit `TRADRL_DEPLOY_BACKING`
 * override wins; otherwise the deployment is DURABLE the moment any
 * durable-provider key is configured (the operator opted into the
 * durable plane) and DEMO when none are (the default — the honest
 * in-memory demo the SIMULATED badge discloses). An INVALID explicit
 * value is NOT resolved here — the composition seam fails closed on
 * it (see `composeDeployment`).
 */
export function resolveDeployBacking(env: ApiDeploymentEnv): DeployBacking {
  if (env.deployBacking === 'demo' || env.deployBacking === 'durable') return env.deployBacking;
  return env.durableProviderKeysPresent.length > 0 ? 'durable' : 'demo';
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
