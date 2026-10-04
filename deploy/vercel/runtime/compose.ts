// deploy/vercel/runtime/compose.ts — THE FUNCTION-SIDE COMPOSITION SEAM (T052).
//
// This module composes the T041 API boundary service
// (services/api — FROZEN, wrapped and never edited) for the Vercel
// serverless function. It reads the deployment environment
// (deploy/vercel/runtime/env.ts — secrets never hardcoded), mints the
// credential registrations the host owns (the secure-boundary act),
// injects the instant source (the host MAY read the wall clock — the
// no-ambient-clock law binds services/api, not its host), and injects
// the five backing-service ports.
//
// THE BACKING RESOLUTION (W-3f — the demo/durable matrix): which
// ports back the data routes is resolved from the environment, once
// per composition (see env.ts `resolveDeployBacking`):
//   - DEMO (the DEFAULT when no durable-provider keys — NEON_*,
//     UPSTASH_* — are configured): the REAL in-memory fake ports from
//     the frozen service's own fixtures (runtime/demo.ts — seeded with
//     the fixture demo data for the credential tenant; the demo world
//     is seeded THROUGH the real routes). The data routes really
//     serve data — per-instance in-memory state, reset by serverless
//     cold starts, honest under the SIMULATED badge (UX-DESIGN §7).
//   - DURABLE (any durable-provider key present, or
//     TRADRL_DEPLOY_BACKING=durable): the current behavior path — the
//     typed degraded stubs below, because T041's port methods are
//     SYNCHRONOUS by design while the durable adapters (deploy/wire,
//     W-3d) are async; the async-to-sync hydration seam is the
//     documented W-3e/lead step (deploy/wire/production.md). The
//     wire's durable adapters own those cases; this seam keeps the
//     honest typed pending state until then.
//   - An INVALID explicit TRADRL_DEPLOY_BACKING value is a host
//     misconfiguration: the typed not-configured 503 (fail-closed,
//     key name + legal values only — never a value).
// The R46 degradation model is unchanged: a provider that is down or
// misconfigured answers its typed degraded state, never a crash.
//
// Zero-dep law: platform APIs only. Spec anchors: ARCHITECTURE-LOCK
// L8/L12/L20, R41/R43/R46, D-033.

import {
  createApiService,
  fnv1a32Hex,
  isTenantId,
  mintDeveloperCredentialId,
  mintInternalCredentialId,
  PRIVATE_ROUTE_FAMILIES,
  PUBLIC_ROUTE_FAMILIES,
  type ApiService,
  type ApiServiceConstruction,
  type ControlPlanePort,
  type ExecutionGatewayPort,
  type FirmMemoryPort,
  type JobSubmissionPort,
  type OutcomeLearningPort,
} from '../../../services/api/src/index';
import { missingApiEnvKeys, readApiEnv, resolveDeployBacking, DEPLOY_BACKING_VALUES, type ApiDeploymentEnv, type DeployBacking } from './env';
import { demoMachineryTick, seedDemoBacking, seedDemoWorld, type DemoPorts } from './demo';

// ---------------------------------------------------------------------------
// The typed degraded port stubs (R46 — checkpoint 1)
// ---------------------------------------------------------------------------

/** The typed port failure of the DURABLE path's stubs: the adapters are composed in deploy/wire (W-3d); the async-to-sync hydration seam is the documented W-3e/lead step. */
export const DEPLOY_ADAPTER_PENDING = 'deploy_adapter_pending' as const;

function degradedPending(port: string) {
  return { ok: false as const, error: { code: DEPLOY_ADAPTER_PENDING, message: `the ${port} backing is durable (deploy/wire W-3d) but the async-to-sync hydration seam is not wired yet (W-3e — deploy/wire/production.md); the boundary degrades this route (R46)` } };
}

/** Port overrides for tests (spy ports observe the pipeline's injected tenant — the L12 probe). */
export interface DeploymentPortOverrides {
  readonly controlPlane?: ControlPlanePort;
  readonly firmMemory?: FirmMemoryPort;
  readonly outcomeLearning?: OutcomeLearningPort;
  readonly executionGateway?: ExecutionGatewayPort;
  readonly jobSubmission?: JobSubmissionPort;
}

/** The checkpoint-1 backing services: every route that needs a port degrades to the typed 503. */
export function degradedPorts(): Required<DeploymentPortOverrides> {
  return {
    controlPlane: {
      createProject: () => degradedPending('control-plane'),
      getProject: () => degradedPending('control-plane'),
      projectsOf: () => degradedPending('control-plane'),
      transition: () => degradedPending('control-plane'),
      bindOrganization: () => degradedPending('control-plane'),
    },
    firmMemory: { queryKnowledge: () => degradedPending('firm-memory') },
    outcomeLearning: {
      queryOutcomes: () => degradedPending('outcome-learning'),
      queryPostMortems: () => degradedPending('outcome-learning'),
    },
    executionGateway: { submitRequest: () => degradedPending('execution-gateway') },
    jobSubmission: { submitJob: () => degradedPending('job-submission') },
  };
}

// ---------------------------------------------------------------------------
// The composition (fail-closed, mirrors services/api's own law)
// ---------------------------------------------------------------------------

/** The typed not-configured result (the function surfaces it as 503 — R46, never a crash). */
export interface DeploymentNotConfigured {
  readonly ok: false;
  readonly code: 'deploy_not_configured';
  readonly missing: readonly string[];
}

/** The composed DEMO backing (present only when the resolution picked `demo` AND no port overrides were injected). */
export interface DemoBackingHandle {
  /** The demo ports (the fixture fakes the service was composed over — introspection/probe surface). */
  readonly ports: DemoPorts;
  /** Whether the boot-time org-status report landed (the watch surface's snapshot; requires the internal credential). */
  readonly orgStatusSeeded: boolean;
  /**
   * The per-request demo machinery tick: advances non-terminal jobs through
   * the REAL private plane so the launch journey's async progress renders.
   * `null` when no internal credential is configured (nothing animates — the
   * jobs stay in their submitted state; honest under SIMULATED).
   */
  readonly tick: ((at: number) => void) | null;
}

export type DeploymentComposition =
  | { readonly ok: true; readonly service: ApiService; readonly backing: DeployBacking; readonly demo: DemoBackingHandle | null }
  | DeploymentNotConfigured;

/** Compose the boundary service over the deployment environment (pure — no ambient env read, no cache). */
export function composeDeployment(env: ApiDeploymentEnv, overrides: DeploymentPortOverrides = {}): DeploymentComposition {
  const missing = missingApiEnvKeys(env);
  if (missing.length > 0) return { ok: false, code: 'deploy_not_configured', missing };
  // An invalid explicit backing value is a host misconfiguration —
  // fail closed naming the KEY and the legal values, never a value.
  if (env.deployBacking !== null && !(DEPLOY_BACKING_VALUES as readonly string[]).includes(env.deployBacking)) {
    return { ok: false, code: 'deploy_not_configured', missing: [`TRADRL_DEPLOY_BACKING (must be exactly "demo" or "durable"; got an unrecognized value)`] };
  }
  const backing = resolveDeployBacking(env);
  // Non-null is guaranteed by missingApiEnvKeys for the developer keys.
  const token = env.apiDeveloperToken as string;
  const tenant = env.apiDeveloperTenant as string;
  const principal = env.apiDeveloperPrincipal as string;
  const internalToken = env.apiInternalToken;
  if (!isTenantId(tenant)) {
    // A malformed tenant id is a host configuration error — the name of the
    // KEY is reported, never the value (secrets never cross into errors).
    return { ok: false, code: 'deploy_not_configured', missing: ['TRADRL_API_DEVELOPER_TENANT (not a valid tenant id)'] };
  }
  // The backing matrix: DEMO = the seeded fixture fakes (runtime/demo.ts);
  // DURABLE = the typed degraded stubs (the hydration seam is W-3e).
  const demoPorts = backing === 'demo' ? seedDemoBacking(tenant) : null;
  const ports: Required<DeploymentPortOverrides> = demoPorts ?? degradedPorts();
  const construction: ApiServiceConstruction = createApiService({
    credentials: [
      {
        credential: {
          kind: 'developer',
          credentialId: mintDeveloperCredentialId(fnv1a32Hex(`deploy:${principal}:${tenant}`)),
          tenant,
          principal,
          permissions: PUBLIC_ROUTE_FAMILIES,
        },
        token,
      },
      ...(env.apiInternalToken !== null && env.apiInternalPrincipal !== null
        ? [{
            credential: {
              kind: 'internal' as const,
              credentialId: mintInternalCredentialId(fnv1a32Hex(`deploy-internal:${env.apiInternalPrincipal}`)),
              principal: env.apiInternalPrincipal,
              permissions: PRIVATE_ROUTE_FAMILIES,
            },
            token: env.apiInternalToken,
          }]
        : []),
    ],
    controlPlane: overrides.controlPlane ?? ports.controlPlane,
    firmMemory: overrides.firmMemory ?? ports.firmMemory,
    outcomeLearning: overrides.outcomeLearning ?? ports.outcomeLearning,
    executionGateway: overrides.executionGateway ?? ports.executionGateway,
    jobSubmission: overrides.jobSubmission ?? ports.jobSubmission,
    instants: { next: () => Date.now() },
  });
  if (!construction.ok) {
    return { ok: false, code: 'deploy_not_configured', missing: construction.errors.map((error) => `${error.path ?? error.code}: ${error.message}`) };
  }
  // The demo world seed — ONLY for the un-overridden demo composition
  // (port overrides are the injection seam for tests/future hosts: an
  // overridden port set owns its own world). Every seed mutation goes
  // THROUGH the real routes (L20 runs for real — see runtime/demo.ts).
  if (demoPorts === null) {
    return { ok: true, service: construction.service, backing, demo: null };
  }
  const seed = seedDemoWorld(construction.service, { tenant, developerToken: token, internalToken }, Date.now());
  return {
    ok: true,
    service: construction.service,
    backing,
    demo: {
      ports: demoPorts,
      orgStatusSeeded: seed.orgStatusSeeded,
      tick: internalToken === null ? null : (at: number) => demoMachineryTick(construction.service, internalToken as string, at),
    },
  };
}

// ---------------------------------------------------------------------------
// The per-instance memo (serverless warm starts reuse one service)
// ---------------------------------------------------------------------------

let cachedEnv: EnvIdentity | null = null;
let cachedService: ApiService | null = null;
let cachedDemo: DemoBackingHandle | null = null;
let cachedBacking: DeployBacking | null = null;

interface EnvIdentity {
  readonly source: Readonly<Record<string, string | undefined>>;
  readonly env: ApiDeploymentEnv;
}

/**
 * The function's lazily-built, per-instance service. Composed once per
 * cold start; warm invocations reuse the instance (the closure state —
 * rate-limit windows, usage ledger, idempotency store, and under the
 * demo backing the seeded demo world — is per instance, exactly like
 * the T041 process model; a serverless cold start resets it, which is
 * the honest SIMULATED semantics). Re-composes when the env SOURCE
 * OBJECT identity changes (tests inject fresh sources).
 */
export function getDeploymentService(
  source: Readonly<Record<string, string | undefined>> = process.env,
): DeploymentComposition {
  if (cachedService !== null && cachedEnv !== null && cachedEnv.source === source && cachedBacking !== null) {
    return { ok: true, service: cachedService, backing: cachedBacking, demo: cachedDemo };
  }
  const composed = composeDeployment(readApiEnv(source));
  if (!composed.ok) return composed;
  cachedEnv = { source, env: readApiEnv(source) };
  cachedService = composed.service;
  cachedDemo = composed.demo;
  cachedBacking = composed.backing;
  return { ok: true, service: composed.service, backing: composed.backing, demo: composed.demo };
}
