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
//     TRADRL_DEPLOY_BACKING=durable): the W-3e HYDRATION SEAM (W-25D,
//     runtime/durable.ts) — the Neon-backed surfaces (control plane,
//     firm memory, outcome learning) are SYNC in-memory ports hydrated
//     from the durable stores at every cold start, with write-through
//     on every mutation (the ordering law: durable writes are drained
//     by the host before the response is served; a failed write is the
//     typed 503 + a re-projection — never a crash, never a silent
//     divergence). A launched project + its goal set, organization
//     bindings and lifecycle events persist in Neon and REHYDRATE on
//     every cold start (D-5). Since W-26B the seam-live durable
//     resolution composes the FULL product surface — a SUPERSET of demo:
//     the SAME simulated execution gateway + job-submission engines the
//     demo backing composes (imported, zero new simulation logic), the
//     SAME per-request machinery tick over the hydrated control plane,
//     and the SAME demo world seed + fixture substance (runtime/
//     durable-world.ts — idempotent per database, drained before the
//     first serve). When the Neon keys are INCOMPLETE the seam is not
//     built and those surfaces answer the typed `deploy_adapter_absent`
//     503s (the matrix); the execution gateway keeps the honest
//     `deploy_adapter_pending` stub and the job port follows the matrix
//     for Apify (the gateway/seed/tick NEVER run in that state).
//   - An INVALID explicit TRADRL_DEPLOY_BACKING value is a host
//     misconfiguration: the typed not-configured 503 (fail-closed,
//     key name + legal values only — never a value).
// The R46 degradation model is unchanged: a provider that is down or
// misconfigured answers its typed degraded state, never a crash.
//
// Zero-dep law: platform APIs only. Spec anchors: ARCHITECTURE-LOCK
// L8/L12/L20, R41/R43/R46, D-033, D-5.

import {
  bearerTokenOf,
  createApiService,
  deepFreeze,
  fnv1a32Hex,
  isTenantId,
  mintDeveloperCredentialId,
  mintInternalCredentialId,
  PRIVATE_ROUTE_FAMILIES,
  PUBLIC_ROUTE_FAMILIES,
  type ApiRequest,
  type ApiResponse,
  type ApiService,
  type ApiServiceConstruction,
  type ConstraintSetStatement,
  type ControlPlanePort,
  type ExecutionGatewayPort,
  type FirmMemoryPort,
  type GoalStatement,
  type JobSubmissionPort,
  type OutcomeLearningPort,
  type TenantId,
} from '../../../services/api/src/index';
import { missingApiEnvKeys, readApiEnv, resolveDeployBacking, DEPLOY_BACKING_VALUES, type ApiDeploymentEnv, type DeployBacking } from './env';
import { buildDurableBacking, neonStoreDepsOf, type DurableBackingHandle, type DurableSeamDeps } from './durable';
import { buildDurableActivation, type DurableActivation } from './durable-world';
import { adapterAbsentFailure, enabledAdapters } from '../../wire/composition';
import type { FetchLike, InstantSourceMirror } from '../../adapters/shared';
import type { NeonStoreDeps } from '../../adapters/neon/stores';
import { DEMO_PROJECT_ID, demoExecutionGateway, demoJobsOf, demoMachineryTick, demoSubmissionBlotter, durableProjectEvidenceOf, isLaunchWorldRecord, outcomeLearningWithProjectEvidence, seedDemoBacking, seedDemoWorld, type DemoMachineryContext, type DemoPorts, type DurableDemoSubstance, type DurableEvidenceSource } from './demo';
import type { DemoSubstanceAuthorization, VerifyDeveloperAuthorization } from './routes';

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

/**
 * The durable-seam options (W-25D): the injected fetch + instant source for
 * the seam's Neon stores. Fakes in tests (the fake provider fleet's fetch);
 * absent in production (the platform fetch + the host wall clock — the same
 * law as the composition's own instants). The provider environment itself
 * rides `ApiDeploymentEnv.providers` (the wire's readProviderEnv — the
 * single provider implementation).
 */
export interface DurableSeamOptions {
  readonly fetchLike?: FetchLike;
  readonly instants?: InstantSourceMirror;
}

/** The typed absent stubs for the Neon-backed surfaces (the matrix's Neon-absent row — R46, never a throw). */
function neonAbsentPorts(): Pick<Required<DeploymentPortOverrides>, 'controlPlane' | 'firmMemory' | 'outcomeLearning'> {
  const failure = adapterAbsentFailure('neon');
  const refuse = () => ({ ok: false as const, error: failure });
  return {
    controlPlane: { createProject: refuse, getProject: refuse, projectsOf: refuse, transition: refuse, bindOrganization: refuse },
    firmMemory: { queryKnowledge: refuse },
    outcomeLearning: { queryOutcomes: refuse, queryPostMortems: refuse },
  };
}

/** The typed absent stub for the job-submission port (the matrix's Apify-absent row). */
function apifyAbsentJobPort(): JobSubmissionPort {
  const failure = adapterAbsentFailure('apify');
  return { submitJob: () => ({ ok: false as const, error: failure }) };
}

// ---------------------------------------------------------------------------
// THE DURABLE JOB WRITE-THROUGH WRAPPER (W-27, D-7)
// ---------------------------------------------------------------------------

/**
 * Wrap the composed boundary service so every JOB MUTATION that lands in
 * the frozen service's API-owned job store (a submission through the
 * public routes, a transition through the private plane — the machinery
 * tick's own driver included, a hydration replay's re-store) queues its
 * durable write through the seam's job lane (`recordJobs`), drained by
 * the host per the W-25D ordering law. The wrapper is TRANSPARENT: every
 * other surface delegates to the inner service verbatim.
 *
 * THE DEMO-PROJECT EXCLUSION: the boot world re-seeds the demo project's
 * two jobs per instance (R3's disclosed limitation — the frozen service's
 * closure); persisting them would accumulate one seeded pair per cold
 * start in the durable table (the seed ids are minted fresh per
 * instance), so the write-through lane skips the demo project's records.
 * The durable (launched) projects' records — D-7's subject — all ride the
 * lane.
 */
function wrapServiceForDurableJobs(service: ApiService, durable: DurableBackingHandle, demoProjectId: string): ApiService {
  return deepFreeze({
    ...service, // every surface delegates verbatim (the frozen service's own closures)
    handle(request: ApiRequest): ApiResponse {
      const before = new Map(service.jobs().map((job) => [job.jobId as string, job as unknown]));
      const response = service.handle(request);
      // The diff: a NEW record or a REPLACED one (the pipeline's handlers
      // set a fresh frozen object per mutation; unchanged records keep
      // their identity — the map lookup is the cheap diff).
      const changed = service.jobs().filter((job) => before.get(job.jobId as string) !== (job as unknown));
      if (changed.length > 0) {
        durable.recordJobs(changed.filter((job) => (job.project as string) !== demoProjectId));
      }
      return response;
    },
  }) as ApiService;
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
  | { readonly ok: true; readonly service: ApiService; readonly backing: DeployBacking; readonly demo: DemoBackingHandle | null; readonly durable: DurableDeploymentHandle | null; readonly verifyDeveloperAuthorization: VerifyDeveloperAuthorization }
  | DeploymentNotConfigured;

/**
 * The durable deployment handle (W-26B): the W-25D seam handle (the sync
 * ports + the projection lifecycle) EXTENDED with the durable activation —
 * the per-request machinery tick and the idempotent boot world. The base
 * seam (`buildDurableBacking`) builds the handle with the activation
 * dormant; the composition wraps it below, once the service exists (the
 * tick and the boot world drive the REAL routes through the composed
 * service — they cannot exist before it does).
 */
export interface DurableDeploymentHandle extends DurableBackingHandle {
  /**
   * The per-request machinery tick (W-26B, R2): the SAME demoMachineryTick
   * law (org compile + job advancement through the real private plane) over
   * the seam's HYDRATED control plane. `null` when no internal credential
   * is configured or when port overrides own the world.
   */
  readonly tick: ((at: number) => void) | null;
  /**
   * The idempotent boot world (W-26B, R3+R4+R7): the demo world seed + the
   * fixture boot-writes + the org-status snapshot pass, once per instance,
   * every durable write DRAINED before the first serve (the W-25D ordering
   * law). Rejects with the typed failure while unconfirmed — the host
   * serves the typed 503 and the next request retries. A no-op when port
   * overrides own the world (the injection seam's own law).
   */
  readonly ensureBootWorld: () => Promise<void>;
  /**
   * THE DURABLE DEMO-SUBSTANCE READS (W-26C, R4 — D-3 + the execution
   * blotter preserved under durable): the SAME folds the demo arm serves
   * (demoJobsOf + demoSubmissionsOf — imported, never duplicated), wired
   * over THIS composition's per-instance stores: `jobsOf` reads the
   * composed service's API-owned job store (the same store the per-id GET
   * /v1/jobs/:jobId reads; the boot world re-seeds the two demo jobs per
   * instance), and the submissions source is the SEEDED demo blotter plus
   * the seam-live recording gateway the composition injects (every routed
   * submission of this instance). `null` under port overrides (the
   * injection seam owns its own world — the host routes then fall through
   * to the boundary, the pre-W-8 law).
   */
  readonly demoSubstance: DurableDemoSubstance | null;
}

/** Compose the boundary service over the deployment environment (pure — no ambient env read, no cache, no network). */
export function composeDeployment(env: ApiDeploymentEnv, overrides: DeploymentPortOverrides = {}, seam: DurableSeamOptions = {}): DeploymentComposition {
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
  // DURABLE = the W-3e hydration seam (runtime/durable.ts) over the Neon
  // stores — or the typed absent stubs when the Neon keys are incomplete.
  const demoPorts = backing === 'demo' ? seedDemoBacking(tenant) : null;
  const stubs = degradedPorts();
  let durable: DurableDeploymentHandle | null = null;
  let durableStores: NeonStoreDeps | null = null;
  /**
   * THE FW-MI-B DURABLE EVIDENCE SOURCE (MI-D2 + MI-D10): the same
   * per-project derivation the demo arm serves, over the seam's OWN
   * surfaces — the hydrated goal set (goal + constraint set + the W-28
   * world, rehydrated at every cold start) and the hydrated control
   * plane's project listing (the compile gate). Assigned exactly when the
   * seam built; `null` everywhere else (the folds answer nothing — the
   * honest pre-fix emptiness, R46).
   */
  let durableEvidenceSource: DurableEvidenceSource | null = null;
  // The seam-live recording gateway (W-26C): the same instance the port
  // map injects under durable — its `recorded` blotter is the live half of
  // the durable demo-substance submissions fold (R4). Non-null exactly
  // when the seam built.
  let seamGateway: ReturnType<typeof demoExecutionGateway> | null = null;
  let ports: Required<DeploymentPortOverrides>;
  if (demoPorts !== null) {
    ports = demoPorts;
  } else {
    // backing === 'durable': the seam activates only when the Neon adapter
    // is enabled (its four keys present); otherwise the Neon-backed surfaces
    // answer the typed `deploy_adapter_absent` 503s (the matrix).
    const seamDeps: DurableSeamDeps = {
      providerEnv: env.providers,
      tenant,
      ...(seam.fetchLike === undefined ? {} : { fetchLike: seam.fetchLike }),
      instants: seam.instants ?? { next: () => Date.now() },
    };
    const seamHandle = buildDurableBacking(seamDeps);
    if (seamHandle !== null) {
      // THE FW-MI-B DURABLE EVIDENCE SOURCE: the same derivation the demo
      // arm serves, over the seam's own hydrated surfaces — the derived
      // stream rides the WRAPPED outcome-learning port (the frozen
      // outcome/post-mortem reads serve it alongside the hydrated rows)
      // and the demoSubstance submissions fold (the blotter route) — the
      // same pure generator under both backings (imported, never
      // duplicated). Defensive by construction: a degraded goalOf read,
      // a malformed row or a world-less record answers null (R46 — the
      // reads keep their honest pre-fix emptiness).
      durableEvidenceSource = {
        goalSetOf(project) {
          const read = seamHandle.goalOf(project);
          if (!read.ok || read.value === null) return null;
          const goal = read.value.goal;
          const constraintSet = read.value.constraintSet;
          if (typeof goal !== 'object' || goal === null || typeof constraintSet !== 'object' || constraintSet === null) return null;
          return {
            goal: goal as GoalStatement,
            constraintSet: constraintSet as ConstraintSetStatement,
            world: isLaunchWorldRecord(read.value.world) ? read.value.world : null,
          };
        },
        organizationRefOf(tenant, project) {
          const listed = seamHandle.ports.controlPlane.projectsOf(tenant as TenantId);
          if (!listed.ok) return null; // R46: a degraded projection answers nothing
          const record = listed.value.find((entry) => (entry.id as string) === project);
          if (record === undefined) return null;
          const organizationRef = record.lifecycle.organizationRef;
          return typeof organizationRef === 'string' && organizationRef.length > 0 ? organizationRef : null;
        },
      };
      // THE W-26B ACTIVATION (the durable superset law): the seam-live
      // durable resolution composes the SAME simulated execution +
      // job-submission engines the demo backing composes — imported, zero
      // new simulation logic (runtime/demo.ts's demoExecutionGateway + the
      // seam's own hydration-aware job port over the frozen service's
      // fakeJobSubmission, the exact engine the demo ports are built from).
      // POST /v1/execution/requests routes, POST /v1/jobs/* answer 202, and
      // the per-request machinery tick animates the jobs — the launch
      // journey (J3) works exactly as under demo, PLUS the Neon
      // persistence. The W-26C durable demo-substance reads (R4) ride the
      // SAME gateway instance: its `recorded` blotter is the live half of
      // the submissions fold the host route serves. Since W-27 (D-7) the
      // seam's job port is HYDRATION-AWARE (the boot world replays the
      // durable job records through the real routes with the port serving
      // them verbatim) and its `jobSubmission` port rides the seam spread
      // below (never the bare fixture engine).
      durableStores = neonStoreDepsOf(seamDeps); // non-null whenever the seam built (the shared construction)
      seamGateway = demoExecutionGateway();
      ports = {
        ...stubs,
        ...seamHandle.ports, // controlPlane + firmMemory + outcomeLearning + the W-27 hydration-aware jobSubmission
        // FW-MI-B (MI-D2): the seam's outcome-learning port WRAPPED — the
        // frozen outcome/post-mortem reads serve the hydrated rows AND
        // every launched desk's own derived stream (idempotent by
        // content-addressed id; the degraded states pass through).
        outcomeLearning: outcomeLearningWithProjectEvidence(
          seamHandle.ports.outcomeLearning,
          (evidenceTenant, evidenceProject) => durableProjectEvidenceOf(durableEvidenceSource as DurableEvidenceSource, evidenceTenant, evidenceProject),
        ),
        executionGateway: seamGateway,
      };
      // The base seam handle, carried DORMANT (tick null, the boot world a
      // no-op, the demo-substance reads absent) until the composition binds
      // the activation below, once the service exists (the tick + the boot
      // world drive the real routes through the composed service).
      durable = { ...seamHandle, tick: null, ensureBootWorld: async () => undefined, demoSubstance: null };
    } else {
      // The seam is NOT built (the Neon keys are incomplete): the matrix's
      // Neon-absent row keeps EXACTLY the pre-W-26B law — the typed absent
      // stubs for the Neon-backed surfaces, the honest pending stub for the
      // gateway, and the job port follows the matrix for Apify (absent keys
      // -> the typed absent; present keys -> the pending stub). The
      // gateway/seed/tick NEVER run in this state.
      ports = { ...stubs, ...neonAbsentPorts() };
      if (!enabledAdapters(env.providers).apify) {
        ports = { ...ports, jobSubmission: apifyAbsentJobPort() };
      }
    }
  }
  // Port overrides are the injection seam (tests + future hosts): an
  // overridden port set owns its own world — the demo world seed and
  // the machinery handle are suppressed under overrides.
  const hasOverrides = Object.keys(overrides).length > 0;
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
  // THE HOST AUTH SEAM (W-8): the host owns the credential registrations
  // (the secure-boundary act above), so it can authenticate its own
  // demo-substance read routes (runtime/routes.ts) with the boundary's own
  // law — a Bearer token that is not the registered developer credential is
  // rejected; the served records are the credential tenant's own (L12 by
  // construction). The token never crosses into any error or response.
  const verifyDeveloperAuthorization: VerifyDeveloperAuthorization = (authorization: string | undefined): DemoSubstanceAuthorization | null => {
    const presented = bearerTokenOf(authorization);
    return presented !== null && presented === token ? { tenant, principal } : null;
  };
  // The demo world seed — ONLY for the un-overridden demo composition
  // (see hasOverrides above). Every seed mutation goes THROUGH the real
  // routes (L20 runs for real — see runtime/demo.ts). The durable handle
  // rides every composition where the seam was built (an overridden port
  // set owns its own world; the seam's other surfaces + the drain stay
  // live).
  if (demoPorts === null || hasOverrides) {
    // THE W-26B DURABLE ACTIVATION (the durable backing reaches this arm
    // with the seam built): wrap the seam handle with the machinery tick +
    // the boot world, now that the composed service exists. Under port
    // overrides the world is the injection seam's own — the activation
    // stays dormant (tick null, the boot world a no-op) while the seam's
    // settled/drain/goalOf surfaces stay live (the W-25D law).
    if (durable !== null && durableStores !== null) {
      // THE W-27 JOB WRITE-THROUGH WRAPPER (D-7): when the composition owns
      // the world, every job mutation that lands in the frozen service's
      // API-owned store queues its durable write through the seam's job
      // lane — the wrapped service is what the router, the boot world, the
      // tick and the demo-substance folds all drive (ONE capture point for
      // every mutation path). Under port overrides the injection seam owns
      // the world — the raw service rides, exactly as before.
      const serving = hasOverrides ? construction.service : wrapServiceForDurableJobs(construction.service, durable, DEMO_PROJECT_ID);
      const activation: DurableActivation = hasOverrides
        ? { tick: null, ensureBootWorld: async () => undefined }
        : buildDurableActivation({
            service: serving,
            durable,
            storeDeps: durableStores,
            seed: { tenant, developerToken: token, internalToken },
            at: () => Date.now(),
          });
      // THE W-26C DURABLE DEMO-SUBSTANCE READS (R4): the same folds the
      // demo arm serves, over THIS composition's per-instance stores —
      // bound only when the composition owns the world (under port
      // overrides the injection seam owns it and the routes fall through).
      const demoSubstance: DurableDemoSubstance | null = hasOverrides || seamGateway === null || durableEvidenceSource === null
        ? null
        : {
            ports: {
              submissions: demoSubmissionBlotter(),
              executionGateway: seamGateway,
              // FW-MI-B (MI-D2): the durable arm's blotter fold carries the
              // per-project derived rows — the same derivation the wrapped
              // outcome-learning port serves, over the same evidence source.
              projectEvidenceOf: (evidenceTenant, evidenceProject) => durableProjectEvidenceOf(durableEvidenceSource as DurableEvidenceSource, evidenceTenant, evidenceProject)?.submissions ?? [],
            },
            jobsOf: (tenant, project) => demoJobsOf(serving, tenant, project),
          };
      durable = { ...durable, tick: activation.tick, ensureBootWorld: activation.ensureBootWorld, demoSubstance };
      return { ok: true, service: serving, backing, demo: null, durable, verifyDeveloperAuthorization };
    }
    return { ok: true, service: construction.service, backing, demo: null, durable, verifyDeveloperAuthorization };
  }
  const seed = seedDemoWorld(construction.service, { tenant, developerToken: token, internalToken }, Date.now());
  const machinery: DemoMachineryContext = { ports: demoPorts, tenant, developerToken: token, internalToken: internalToken as string };
  return {
    ok: true,
    service: construction.service,
    backing,
    demo: {
      ports: demoPorts,
      orgStatusSeeded: seed.orgStatusSeeded,
      tick: internalToken === null ? null : (at: number) => demoMachineryTick(construction.service, machinery, at),
    },
    durable,
    verifyDeveloperAuthorization,
  };
}

// ---------------------------------------------------------------------------
// The per-instance memo (serverless warm starts reuse one service)
// ---------------------------------------------------------------------------

let cachedEnv: EnvIdentity | null = null;
let cachedService: ApiService | null = null;
let cachedDemo: DemoBackingHandle | null = null;
let cachedDurable: DurableDeploymentHandle | null = null;
let cachedBacking: DeployBacking | null = null;
let cachedVerify: VerifyDeveloperAuthorization | null = null;

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
  if (cachedService !== null && cachedEnv !== null && cachedEnv.source === source && cachedBacking !== null && cachedVerify !== null) {
    return { ok: true, service: cachedService, backing: cachedBacking, demo: cachedDemo, durable: cachedDurable, verifyDeveloperAuthorization: cachedVerify };
  }
  const composed = composeDeployment(readApiEnv(source));
  if (!composed.ok) return composed;
  cachedEnv = { source, env: readApiEnv(source) };
  cachedService = composed.service;
  cachedDemo = composed.demo;
  cachedDurable = composed.durable;
  cachedBacking = composed.backing;
  cachedVerify = composed.verifyDeveloperAuthorization;
  return { ok: true, service: composed.service, backing: composed.backing, demo: composed.demo, durable: composed.durable, verifyDeveloperAuthorization: composed.verifyDeveloperAuthorization };
}
