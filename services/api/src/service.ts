// @tradrl/api-service — THE COMPOSITION ROOT.
//
// createApiService(config) builds the boundary service: the injected
// credential registry (BOTH planes' tokens — host-minted at the
// secure boundary, never over the wire), the five backing-service
// ports (control plane, firm memory, outcome learning, THE EXECUTION
// GATEWAY, the job machinery), the injected instant source (no
// ambient clock), the rate limiter, the usage ledger, the idempotency
// store and the per-scope audit trails.
//
// Construction is fail-closed (the T040 precedent): a service over
// malformed injections is inexpressible — every port is checked for
// presence and shape, every credential registration for validity, the
// instant source for existence.
//
// The service object is deeply frozen; all state lives in the closure
// ( WeakMap-free: one state object per service instance, the
// ApiServiceState).

import { canonicalJson, deepFreeze, fnv1a32Hex } from './primitives';
import { CredentialRegistry, isCredentialRegistration, type CredentialRegistration } from './auth';
import { RateLimiter, isRateLimitPolicy, DEFAULT_RATE_LIMIT_POLICY, type RateLimitPolicy } from './ratelimit';
import { UsageLedger, type UsageRecord } from './metering';
import { IdempotencyStore } from './idempotency';
import type { ApiAuditTrail } from './audit';
import { verifyApiAuditChain } from './audit';
import type { ControlPlanePort, ExecutionGatewayPort, FirmMemoryPort, JobSubmissionPort, OutcomeLearningPort } from './ports';
import { handleApiRequest, type ApiServiceState, type PaginationIndex } from './pipeline';
import type { InstantSource } from './instants';
import type { ApiRequest, ApiResponse, JobRecord, OrgStatusSnapshot } from './contracts';
import { API_VERSIONS, CURRENT_API_VERSION } from './contracts';
import type { ProjectId, TenantId } from './ids';

// ---------------------------------------------------------------------------
// The configuration
// ---------------------------------------------------------------------------

/** The boundary service's construction bundle — every dependency is INJECTED (the trust-zone law). */
export interface ApiServiceConfig {
  /** BOTH planes' credentials (tokens minted by the host at the secure boundary). */
  readonly credentials: readonly CredentialRegistration[];
  /** T007's control plane (project/goal management). */
  readonly controlPlane: ControlPlanePort;
  /** T034's firm memory (the knowledge READ serving surface). */
  readonly firmMemory: FirmMemoryPort;
  /** T033's outcome learning (the outcome/evidence query surface). */
  readonly outcomeLearning: OutcomeLearningPort;
  /** T040's execution gateway — THE L8 chokepoint (the only execution path). */
  readonly executionGateway: ExecutionGatewayPort;
  /** The job machinery (the async submitted/running/complete pattern's engine). */
  readonly jobSubmission: JobSubmissionPort;
  /** The injected instant source (no ambient clock — every request consumes exactly one instant). */
  readonly instants: InstantSource;
  /** The request-budget policy (default: 600 requests / 60s / credential / family). */
  readonly rateLimit?: RateLimitPolicy;
  /** The knowledge serving policy (T034's retention shape — opaque here, forwarded). */
  readonly knowledgeRetention?: unknown;
  /** The outcome/post-mortem retention policy (T033's shape — opaque here, forwarded). */
  readonly outcomeRetention?: unknown;
}

// ---------------------------------------------------------------------------
// The pagination index (deterministic cursor minting/resolution)
// ---------------------------------------------------------------------------

/** Build the pagination index: minted `cur:` tokens <-> listing offsets. Deterministic given the request sequence. */
export function createPaginationIndex(): PaginationIndex {
  const offsetsByToken = new Map<string, number>();
  return {
    mint(family: string, offset: number): string {
      const token = `cur:${fnv1a32Hex(canonicalJson([family, offset]))}`;
      if (!offsetsByToken.has(token)) offsetsByToken.set(token, offset);
      return token;
    },
    resolve(token: string): number | null {
      return offsetsByToken.get(token) ?? null;
    },
  };
}

// ---------------------------------------------------------------------------
// The service object
// ---------------------------------------------------------------------------

/** The boundary service's public surface. */
export interface ApiService {
  /** THE single entry point: one request through the whole pipeline. */
  handle(request: ApiRequest): ApiResponse;
  /** One tenant's usage records (the R41 fact surface — record only, no enforcement). */
  usageOf(tenant: TenantId): readonly UsageRecord[];
  /** The platform-wide usage records in append order. */
  usageAll(): readonly UsageRecord[];
  /** One scope's audit trail (the chain-verified consequence log), verified on read. */
  auditTrail(tenant: TenantId, project: ProjectId): ApiAuditTrail | null;
  /** Every audit trail (the operator view; deterministic key order). */
  auditTrails(): readonly ApiAuditTrail[];
  /** The job store's records (the async pattern's read model; test/operator surface). */
  jobs(): readonly JobRecord[];
  /** The stored org-status snapshots (the watch surface's store; test/operator surface). */
  orgStatusSnapshots(): readonly OrgStatusSnapshot[];
  /** The boundary's identity (the version surface). */
  readonly meta: { readonly apiVersion: string; readonly supportedVersions: readonly string[] };
}

/** The construction result (fail-closed). */
export type ApiServiceConstruction =
  | { readonly ok: true; readonly service: ApiService }
  | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly message: string; readonly path?: string }[] };

/**
 * Construct the boundary service. Fail-closed validation:
 *   - every port present and callable-shaped;
 *   - every credential registration valid (duplicate tokens/ids refused);
 *   - the instant source present;
 *   - the rate-limit policy well-formed when supplied.
 */
export function createApiService(config: unknown): ApiServiceConstruction {
  const errors: { readonly code: string; readonly message: string; readonly path?: string }[] = [];
  if (typeof config !== 'object' || config === null) {
    return { ok: false, errors: [{ code: 'invalid_type', message: 'createApiService requires a configuration object' }] };
  }
  const cfg = config as Record<string, unknown>;

  if (!Array.isArray(cfg.credentials)) {
    errors.push({ code: 'missing_field', message: 'the credentials array is required (both planes\' registrations)', path: 'credentials' });
  } else if (!cfg.credentials.every((c) => isCredentialRegistration(c))) {
    errors.push({ code: 'invalid_field', message: 'every credential registration must be { credential, token } with a valid credential', path: 'credentials' });
  }
  for (const port of ['controlPlane', 'firmMemory', 'outcomeLearning', 'executionGateway', 'jobSubmission', 'instants'] as const) {
    if (typeof cfg[port] !== 'object' || cfg[port] === null || typeof (cfg[port] as Record<string, unknown>).constructor !== 'function') {
      errors.push({ code: 'missing_field', message: `the injected ${port} is required (the boundary owns no backing state — everything is injected)`, path: port });
    }
  }
  if (cfg.rateLimit !== undefined && !isRateLimitPolicy(cfg.rateLimit)) {
    errors.push({ code: 'invalid_field', message: 'the rate-limit policy must be { windowMs, maxRequests } (positive integers)', path: 'rateLimit' });
  }
  if (errors.length > 0) return { ok: false, errors: Object.freeze(errors) };

  const typed = cfg as unknown as ApiServiceConfig;

  let registry: CredentialRegistry;
  try {
    registry = new CredentialRegistry(typed.credentials);
  } catch (cause) {
    return { ok: false, errors: [{ code: 'invalid_field', message: `the credential registry refused construction: ${(cause as Error).message}`, path: 'credentials' }] };
  }

  const state: ApiServiceState = {
    registry,
    controlPlane: typed.controlPlane,
    firmMemory: typed.firmMemory,
    outcomeLearning: typed.outcomeLearning,
    executionGateway: typed.executionGateway,
    jobSubmission: typed.jobSubmission,
    limiter: new RateLimiter(typed.rateLimit ?? DEFAULT_RATE_LIMIT_POLICY),
    usage: new UsageLedger(),
    idempotency: new IdempotencyStore(),
    instants: typed.instants,
    knowledgeRetention: typed.knowledgeRetention ?? { outcomeWindowMs: Number.MAX_SAFE_INTEGER, postMortemWindowMs: Number.MAX_SAFE_INTEGER },
    outcomeRetention: typed.outcomeRetention ?? { outcomeWindowMs: Number.MAX_SAFE_INTEGER, postMortemWindowMs: Number.MAX_SAFE_INTEGER },
    jobs: new Map(),
    orgStatus: new Map(),
    trails: new Map(),
    cursors: createPaginationIndex(),
    requestCounter: 0,
  };

  const service: ApiService = deepFreeze({
    handle(request: ApiRequest): ApiResponse {
      return handleApiRequest(state, request);
    },
    usageOf(tenant: TenantId): readonly UsageRecord[] {
      return state.usage.usageOf(tenant);
    },
    usageAll(): readonly UsageRecord[] {
      return state.usage.usageAll();
    },
    auditTrail(tenant: TenantId, project: ProjectId): ApiAuditTrail | null {
      const trail = state.trails.get(`${tenant}/${project}`);
      if (trail === undefined) return null;
      const verified = verifyApiAuditChain(trail);
      if (!verified.ok) throw new Error(`the audit trail of ${tenant}/${project} failed chain verification: ${verified.error.message}`);
      return trail;
    },
    auditTrails(): readonly ApiAuditTrail[] {
      const trails = [...state.trails.values()].sort((a, b) => (a.tenant === b.tenant ? (a.project < b.project ? -1 : 1) : a.tenant < b.tenant ? -1 : 1));
      for (const trail of trails) {
        const verified = verifyApiAuditChain(trail);
        if (!verified.ok) throw new Error(`the audit trail of ${trail.tenant}/${trail.project} failed chain verification: ${verified.error.message}`);
      }
      return Object.freeze(trails);
    },
    jobs(): readonly JobRecord[] {
      return Object.freeze([...state.jobs.values()]);
    },
    orgStatusSnapshots(): readonly OrgStatusSnapshot[] {
      return Object.freeze([...state.orgStatus.values()]);
    },
    meta: deepFreeze({ apiVersion: CURRENT_API_VERSION, supportedVersions: API_VERSIONS }),
  });

  return { ok: true, service };
}
