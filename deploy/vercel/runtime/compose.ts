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
// CHECKPOINT-1 STOPGAP (honest, per R46): until W-3b..W-3d land the
// durable adapters (Neon/Upstash/R2/Resend/Apify) and deploy/wire/
// owns the production composition, every port here is a TYPED
// DEGRADED STUB: each call returns the typed port failure
// `deploy_adapter_pending`, which the boundary surfaces as the typed
// 503 `unavailable` — provider-absent is a degraded state, NEVER a
// crash (R46). The route table, the request pipeline (L20), the
// authn/authz planes and the L12 tenant-context injection all run
// for real: the pipeline is exercised end-to-end; only the
// backing-service reads/writes degrade.
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
import { missingApiEnvKeys, readApiEnv, type ApiDeploymentEnv } from './env';

// ---------------------------------------------------------------------------
// The typed degraded port stubs (R46 — checkpoint 1)
// ---------------------------------------------------------------------------

/** The checkpoint-1 port failure: the durable adapter lands in W-3b..W-3d. */
export const DEPLOY_ADAPTER_PENDING = 'deploy_adapter_pending' as const;

function degradedPending(port: string) {
  return { ok: false as const, error: { code: DEPLOY_ADAPTER_PENDING, message: `the ${port} adapter is not wired yet (T052 checkpoints W-3b..W-3d); the boundary degrades this route (R46)` } };
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

export type DeploymentComposition = { readonly ok: true; readonly service: ApiService } | DeploymentNotConfigured;

/** Compose the boundary service over the deployment environment (pure — no ambient env read, no cache). */
export function composeDeployment(env: ApiDeploymentEnv, overrides: DeploymentPortOverrides = {}): DeploymentComposition {
  const missing = missingApiEnvKeys(env);
  if (missing.length > 0) return { ok: false, code: 'deploy_not_configured', missing };
  // Non-null is guaranteed by missingApiEnvKeys for the developer keys.
  const token = env.apiDeveloperToken as string;
  const tenant = env.apiDeveloperTenant as string;
  const principal = env.apiDeveloperPrincipal as string;
  if (!isTenantId(tenant)) {
    // A malformed tenant id is a host configuration error — the name of the
    // KEY is reported, never the value (secrets never cross into errors).
    return { ok: false, code: 'deploy_not_configured', missing: ['TRADRL_API_DEVELOPER_TENANT (not a valid tenant id)'] };
  }
  const ports = degradedPorts();
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
  return { ok: true, service: construction.service };
}

// ---------------------------------------------------------------------------
// The per-instance memo (serverless warm starts reuse one service)
// ---------------------------------------------------------------------------

let cachedEnv: EnvIdentity | null = null;
let cachedService: ApiService | null = null;

interface EnvIdentity {
  readonly source: Readonly<Record<string, string | undefined>>;
  readonly env: ApiDeploymentEnv;
}

/**
 * The function's lazily-built, per-instance service. Composed once per
 * cold start; warm invocations reuse the instance (the closure state —
 * rate-limit windows, usage ledger, idempotency store — is per
 * instance, exactly like the T041 process model). Re-composes when the
 * env SOURCE OBJECT identity changes (tests inject fresh sources).
 */
export function getDeploymentService(
  source: Readonly<Record<string, string | undefined>> = process.env,
): DeploymentComposition {
  if (cachedService !== null && cachedEnv !== null && cachedEnv.source === source) {
    return { ok: true, service: cachedService };
  }
  const composed = composeDeployment(readApiEnv(source));
  if (!composed.ok) return composed;
  cachedEnv = { source, env: readApiEnv(source) };
  cachedService = composed.service;
  return { ok: true, service: composed.service };
}
