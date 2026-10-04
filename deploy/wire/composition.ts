// deploy/wire/composition.ts — THE COMPOSITION WIRING (T052, W-3d).
//
// Which adapters satisfy which T041 ports (invariant-9: the ports are
// injected, never imported — services/api stays frozen):
//
//   FirmMemoryPort        <- NeonFirmMemoryStore   (durable knowledge)
//   OutcomeLearningPort   <- NeonOutcomeLearningStore (outcomes + post-mortems)
//   ControlPlanePort      <- the REAL control plane over NeonProjectStore
//                            (the persistence substrate; T007's domain law
//                            — compilation, lifecycle preconditions — stays
//                            in the REAL service; see controlPlanePort())
//   ExecutionGatewayPort  <- the REAL gateway over the wire (L8: the only
//                            execution path — the deployment NEVER wraps it
//                            in a provider adapter; gatewayPort() carries the
//                            injected delegate verbatim)
//   JobSubmissionPort     <- apifyJobSubmissionPort (Apify ingestion jobs;
//                            the submitted/running/complete pattern)
//   idempotency + cache   <- Upstash (SET-EX-NX idempotency + tenant cache)
//   evidence blobs        <- R2EvidenceStore (content-addressed)
//   notice delivery       <- ResendNoticeDelivery (the eight UX.md kinds)
//
// THE SEAM: the composition reads the environment ONCE (the provider
// matrix), builds the adapters with INJECTED fetch + instants, and
// hands the port implementations to the caller (deploy/vercel's
// runtime/compose.ts injects them into createApiService — T041's
// composition root, unchanged). Every adapter that is ABSENT (its env
// keys missing) or UNREACHABLE degrades per R46: the affected port
// answers the typed degraded failure; the rest of the boundary keeps
// working — never a crash.
//
// Spec anchors: ARCHITECTURE-LOCK invariant-9/L8/L12/L20, R46, D-033.

import { NeonFirmMemoryStore, NeonOutcomeLearningStore, NeonProjectStore, type NeonStoreDeps } from '../adapters/neon/stores';
import type { NeonConfig } from '../adapters/neon/client';
import { UpstashCache, UpstashIdempotencyStore, type UpstashStoreDeps } from '../adapters/upstash/stores';
import type { UpstashConfig } from '../adapters/upstash/client';
import { R2EvidenceStore, type R2StoreDeps } from '../adapters/r2/store';
import type { SigV4Credentials } from '../adapters/r2/sigv4';
import { ResendNoticeDelivery } from '../adapters/resend/templates';
import type { ResendConfig } from '../adapters/resend/client';
import { ApifyIngestionJobs, type IngestionSchedule } from '../adapters/apify/jobs';
import type { ApifyConfig } from '../adapters/apify/client';
import type { FetchLike, InstantSourceMirror, StoreFailure, StoreResult } from '../adapters/shared';
import {
  JOB_KINDS,
  type ControlPlanePortMirror,
  type ExecutionGatewayPortMirror,
  type FirmMemoryPortMirror,
  type JobRecordMirror,
  type JobSubmissionPortMirror,
  type OutcomeLearningPortMirror,
} from './ports';

// ---------------------------------------------------------------------------
// The environment matrix (which vars enable which adapter)
// ---------------------------------------------------------------------------

/** The deployment's provider environment (every value env-sourced; null = absent). */
export interface ProviderEnv {
  readonly neon: { readonly host: string | null; readonly database: string | null; readonly user: string | null; readonly apiKey: string | null };
  readonly upstash: { readonly url: string | null; readonly token: string | null };
  readonly r2: { readonly accountId: string | null; readonly accessKeyId: string | null; readonly secretAccessKey: string | null; readonly bucket: string | null };
  readonly resend: { readonly apiKey: string | null; readonly from: string | null };
  readonly apify: { readonly apiToken: string | null };
}

/** Read the provider environment from a source (defaults to process.env). */
export function readProviderEnv(source: Readonly<Record<string, string | undefined>> = process.env): ProviderEnv {
  const read = (key: string): string | null => {
    const value = source[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
  };
  return {
    neon: { host: read('NEON_API_HOST'), database: read('NEON_DATABASE'), user: read('NEON_API_USER'), apiKey: read('NEON_API_KEY') },
    upstash: { url: read('UPSTASH_REDIS_REST_URL'), token: read('UPSTASH_REDIS_REST_TOKEN') },
    r2: { accountId: read('R2_ACCOUNT_ID'), accessKeyId: read('R2_ACCESS_KEY_ID'), secretAccessKey: read('R2_SECRET_ACCESS_KEY'), bucket: read('R2_BUCKET') },
    resend: { apiKey: read('RESEND_API_KEY'), from: read('RESEND_FROM') },
    apify: { apiToken: read('APIFY_API_TOKEN') },
  };
}

/** The enabled-adapter matrix (pure — the boot record's first half). */
export function enabledAdapters(env: ProviderEnv): Readonly<Record<'neon' | 'upstash' | 'r2' | 'resend' | 'apify', boolean>> {
  return {
    neon: env.neon.host !== null && env.neon.database !== null && env.neon.user !== null && env.neon.apiKey !== null,
    upstash: env.upstash.url !== null && env.upstash.token !== null,
    r2: env.r2.accountId !== null && env.r2.accessKeyId !== null && env.r2.secretAccessKey !== null && env.r2.bucket !== null,
    resend: env.resend.apiKey !== null && env.resend.from !== null,
    apify: env.apify.apiToken !== null,
  };
}

// ---------------------------------------------------------------------------
// The typed degraded port (an absent adapter — R46)
// ---------------------------------------------------------------------------

/** The typed failure of an absent adapter (its env keys are not configured). */
export function adapterAbsentFailure(adapter: string): StoreFailure {
  return { code: 'deploy_adapter_absent', message: `the ${adapter} adapter is not configured (its environment keys are absent — see deploy/.env.example); the boundary degrades this route (R46)` };
}

/** A port over an absent adapter: every call answers the typed degraded failure. */
export function absentPort<T extends object>(adapter: string, methods: readonly (keyof T)[]): T {
  const failure = adapterAbsentFailure(adapter);
  const port = {} as Record<string, unknown>;
  for (const method of methods) {
    port[String(method)] = async () => ({ ok: false, error: failure });
  }
  return port as unknown as T;
}

// ---------------------------------------------------------------------------
// The composed deployment (the adapters + the port implementations)
// ---------------------------------------------------------------------------

/** The injected dependencies the composition consumes. */
export interface WireDeps {
  /** The injected fetch (fakes in CI/production alike — never ambient). */
  readonly fetchLike: FetchLike;
  /** The injected instant source (no ambient clock). */
  readonly instants: InstantSourceMirror;
  /** The L8 execution-gateway delegate (the REAL gateway's port — carried verbatim, never wrapped). */
  readonly executionGateway: ExecutionGatewayPortMirror;
  /** The control-plane port (the REAL T007 control plane over the Neon persistence substrate). */
  readonly controlPlane: ControlPlanePortMirror;
}

/** The composed deployment: the adapters + the port implementations. */
export interface ComposedDeployment {
  /** The port implementations (injectable into T041's createApiService at the seam). */
  readonly firmMemory: FirmMemoryPortMirror;
  readonly outcomeLearning: OutcomeLearningPortMirror;
  readonly controlPlane: ControlPlanePortMirror;
  readonly executionGateway: ExecutionGatewayPortMirror;
  readonly jobSubmission: JobSubmissionPortMirror;
  /** The Upstash surfaces (idempotency + cache) — host-owned, not a T041 port. */
  readonly idempotency: UpstashIdempotencyStore | null;
  readonly cache: UpstashCache | null;
  /** The R2 evidence store (content-addressed blobs). */
  readonly evidence: R2EvidenceStore | null;
  /** The Resend notice delivery lane (the eight UX.md kinds). */
  readonly noticeDelivery: ResendNoticeDelivery | null;
  /** The Apify ingestion jobs + schedules. */
  readonly ingestion: ApifyIngestionJobs | null;
  /** The boot record (which adapters enabled; the provenance of the composition). */
  readonly boot: Readonly<Record<'neon' | 'upstash' | 'r2' | 'resend' | 'apify', boolean>>;
}

/**
 * Compose the deployment over the provider environment. An adapter
 * whose keys are absent yields its TYPED DEGRADED port (R46) — the
 * composition never throws. The real gateway + control plane are
 * carried verbatim (L8: the deployment wraps NOTHING around the gate).
 */
export function composeDeploymentAdapters(env: ProviderEnv, deps: WireDeps): ComposedDeployment {
  const boot = enabledAdapters(env);

  // Neon: the durable stores.
  let firmMemory: FirmMemoryPortMirror;
  let outcomeLearning: OutcomeLearningPortMirror;
  let projectStore: NeonProjectStore | null = null;
  if (boot.neon) {
    const neonConfig: NeonConfig = {
      apiHost: env.neon.host as string,
      database: env.neon.database as string,
      apiUser: env.neon.user as string,
      apiKey: env.neon.apiKey as string,
    };
    const neonDeps: NeonStoreDeps = { config: neonConfig, fetchLike: deps.fetchLike, instants: deps.instants };
    const firmMemoryStore = new NeonFirmMemoryStore(neonDeps);
    const outcomeStore = new NeonOutcomeLearningStore(neonDeps);
    projectStore = new NeonProjectStore(neonDeps);
    firmMemory = firmMemoryStore; // the store IS the port (strict assignability — pinned by wire.test.ts)
    outcomeLearning = outcomeStore;
  } else {
    firmMemory = absentPort<FirmMemoryPortMirror>('neon', ['queryKnowledge']);
    outcomeLearning = absentPort<OutcomeLearningPortMirror>('neon', ['queryOutcomes', 'queryPostMortems']);
  }

  // Upstash: idempotency + cache (null when absent — the host falls back to the in-memory stores).
  let idempotency: UpstashIdempotencyStore | null = null;
  let cache: UpstashCache | null = null;
  if (boot.upstash) {
    const upstashConfig: UpstashConfig = { url: env.upstash.url as string, token: env.upstash.token as string };
    const upstashDeps: UpstashStoreDeps = { config: upstashConfig, fetchLike: deps.fetchLike, instants: deps.instants };
    idempotency = new UpstashIdempotencyStore(upstashDeps);
    cache = new UpstashCache(upstashDeps);
  }

  // R2: the evidence/blob store.
  let evidence: R2EvidenceStore | null = null;
  if (boot.r2) {
    const credentials: SigV4Credentials = {
      accountId: env.r2.accountId as string,
      accessKeyId: env.r2.accessKeyId as string,
      secretAccessKey: env.r2.secretAccessKey as string,
    };
    const r2Deps: R2StoreDeps = { credentials, bucket: env.r2.bucket as string, fetchLike: deps.fetchLike, instants: deps.instants };
    evidence = new R2EvidenceStore(r2Deps);
  }

  // Resend: the notice delivery lane.
  let noticeDelivery: ResendNoticeDelivery | null = null;
  if (boot.resend) {
    const resendConfig: ResendConfig = { apiKey: env.resend.apiKey as string, from: env.resend.from as string };
    noticeDelivery = new ResendNoticeDelivery({ config: resendConfig, fetchLike: deps.fetchLike, instants: deps.instants });
  }

  // Apify: the ingestion jobs (the job-submission port over actor runs).
  let ingestion: ApifyIngestionJobs | null = null;
  if (boot.apify) {
    const apifyConfig: ApifyConfig = { apiToken: env.apify.apiToken as string };
    ingestion = new ApifyIngestionJobs({ config: apifyConfig, fetchLike: deps.fetchLike, instants: deps.instants });
  }
  const apifyJobs = ingestion;
  const jobSubmission: JobSubmissionPortMirror = apifyJobs === null
    ? absentPort<JobSubmissionPortMirror>('apify', ['submitJob'])
    : {
        async submitJob(input): Promise<StoreResult<JobRecordMirror>> {
          // The T041 job kinds map onto the ingestion feeds; the spec rides
          // the actor-run input (the T037/T038 pass-through). The job record
          // mirrors T041's shape (submittedAt/completedAt, the closed statuses).
          if (!(JOB_KINDS as readonly string[]).includes(input.kind)) {
            return { ok: false, error: { code: 'invalid_job_kind', message: `the job kind ${String(input.kind)} is not in the closed set (research|learning)` } };
          }
          const spec = typeof input.spec === 'object' && input.spec !== null
            ? (input.spec as { actorId?: unknown; spec?: unknown })
            : {};
          const actorId = typeof spec.actorId === 'string' ? spec.actorId : '';
          const feedSpec = spec.spec;
          const submitted = await apifyJobs.submitJob(input.tenant, input.kind === 'research' ? 'news' : 'alternative', actorId, feedSpec as never);
          if (!submitted.ok) return submitted;
          const record = submitted.value;
          return {
            ok: true,
            value: {
              jobId: record.jobId,
              kind: input.kind,
              tenant: input.tenant,
              project: input.project,
              status: record.status === 'succeeded' ? 'complete' : record.status === 'failed' ? 'failed' : 'running',
              submittedAt: record.at,
            },
          };
        },
      };

  return {
    firmMemory,
    outcomeLearning,
    controlPlane: deps.controlPlane, // the REAL T007 control plane over the Neon substrate — carried verbatim
    executionGateway: deps.executionGateway, // L8: the REAL gateway — carried verbatim, never wrapped
    jobSubmission,
    idempotency,
    cache,
    evidence,
    noticeDelivery,
    ingestion,
    boot,
  };
}

// ---------------------------------------------------------------------------
// The schedule lane (Apify schedules — host-owned, not a T041 port)
// ---------------------------------------------------------------------------

export { buildSchedule as buildIngestionSchedule } from '../adapters/apify/jobs';
export type { IngestionSchedule } from '../adapters/apify/jobs';
