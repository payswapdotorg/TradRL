// deploy/vercel/runtime/job-promote.ts — THE RESEARCH→DECISION PROMOTION
// (FW-32-A, Round A blocker 2 — 5/9 personas: "my research never reaches a
// decision"; M1, M3, M5, S2, S5).
//
// THE HOLE THIS CLOSES (ROUND-A-REPORT §4 blocker 2): a completed research
// job's release-candidate result only surfaced as an auto "observed" watch
// entry with EVIDENCE none — "The audit chain terminates exactly where a
// professional's workflow continues" (M3). The frozen T041 API has NO
// decisions:write route (decisions are minted by the org machinery), so the
// promotion is a HOST-OWNED route — the W-8/FW-31-A precedent — served
// BEFORE the boundary wrap with developer-credential authn:
//
//   POST /v1/jobs/:jobId/promote
//
// WHAT IT MINTS: a decision record that cites the job's deliverable through
// the SAME seam the org's own decision stream rides — the outcome-learning
// port's derived-rows wrapper (runtime/demo.ts's
// `outcomeLearningWithProjectEvidence` is the exact precedent: a wrapper
// that serves derived OutcomeRecordMirror rows ALONGSIDE the backing's base
// rows on the frozen /v1/outcomes/query read). The minted record is the
// demo seed's own enriched mirror shape (the full OutcomeRecordMirror —
// guard-passing — plus the R3 decision-audit additive fields decisionBody /
// decisionRationale, and FW-32-A's own additive `promotedFromJob` lineage
// field, the decision→job backlink Round A's C02 audits demanded). The
// rationale is audit prose citing the job + its deliverable HONESTLY: the
// job id, its spec id + version, the completion instant, and the no-execution
// truth (a research promotion runs no trades — outcomeClass is the closed
// vocabulary's own `no_execution`, never a fabricated fill).
//
// THE CONTRACT (typed per the established laws — authn first):
//   401 unauthenticated  — a Bearer token that is not the deployment's
//                         registered developer credential (the W-8 law).
//   404 not_found        — no job with that id in the credential tenant's
//                         store (unknown and cross-tenant stay
//                         indistinguishable, the boundary's own law).
//   409 conflict         — the job exists but is not promotable: not a
//                         research job, not complete, or its result is not
//                         a release candidate (the typed conflict the frozen
//                         service itself uses for illegal transitions).
//   200 { decision, replay } — the minted (or, on a repeat call, the
//                         existing) decision record. IDEMPOTENT PER JOB:
//                         promoting twice returns the SAME record with
//                         replay=true — never a duplicate.
//
// DISCLOSED LIMITATIONS (honest — UX-DESIGN §7 anti-deception):
//   - Under the DEMO backing the promotion registry is PER-INSTANCE host
//     state (the demo backing's own per-instance law): a serverless cold
//     start resets it. The record is SIMULATED-substance class, disclosed
//     under the console's badge. Under the DURABLE backing (FW-33-A) the
//     minted record WRITE-THROUGHS into tradrl_outcomes (the outcome lane,
//     the same putOutcome path the boot-world fixtures ride): it queues at
//     MINT time onto the seam's pending drain — the write CONFIRMS on the
//     next request's drain (the promote route itself is sync-hosted, so its
//     own response precedes the confirmation; the console's 1s beat poll
//     drains it within a beat, and the serve-time backstop re-queues on
//     every outcomes read that still lacks the record — a failed write
//     degrades the draining request per the ordering law and heals on the
//     idempotent re-promotion, which mints the SAME id).
//   - Host-owned routes run outside the T041 pipeline's metering/audit tail
//     — the one W-8 limitation every host route carries. The minted record
//     itself serves through the FROZEN /v1/outcomes/query read (full
//     pipeline) the moment it registers.
//   - Under port overrides (the injection seam owns its own world) the
//     composition does NOT wire the registry — the route is absent and the
//     path answers the boundary's typed not-found (the pre-W-8 law).
//
// NO CORS headers are ever emitted (the same-origin law — pinned by
// deploy/vercel/vercel.test.ts, which scans this file too).
//
// THE NO-CYCLE LAW (the risk-utilization precedent): this module is
// imported BY deploy/vercel/api/router.ts + runtime/compose.ts, so it
// imports ONLY types + frozen-service primitives and builds its own
// envelope helpers — never a runtime dependency on './routes'.
//
// Zero-dep law: platform APIs only. Spec anchors: R43 (additive), R45
// (provenance), R46 (every failure path typed; never a crash), L4 (the
// record's asOf is the promote instant; the capsule carries
// availabilityAt), L12 (every fold keys on the AUTHORIZED tenant), L20
// (the route records a decision; it never re-decides a gateway verdict),
// ROUND-A-REPORT §4 blocker 2 + §6 (FW-32).

import {
  apiError,
  canonicalJson,
  CURRENT_API_VERSION,
  deepFreeze,
  fnv1a32Hex,
  isOutcomeRecordMirror,
  mintRequestId,
  type ApiError,
  type ApiRequest,
  type ApiResponse,
  type JobRecord,
  type OutcomeLearningPort,
  type OutcomeRecordMirror,
  type RequestId,
  type TimestampMs,
} from '../../../services/api/src/index';
import { outcomeDurableLaneOf, type OutcomeDurableWriteLane } from './demo';

// ---------------------------------------------------------------------------
// The route's own grammar
// ---------------------------------------------------------------------------

/** The promoted-decision record: the enriched mirror shape (the R3 substance + FW-32-A's job-lineage field). */
export type PromotedDecisionRecord = OutcomeRecordMirror & {
  /** The NAMED deciding body (the R3 additive field — never 'unknown'). */
  readonly decisionBody: string;
  /** The decision's audit rationale (published audit prose citing the job + its deliverable). */
  readonly decisionRationale: string;
  /** THE DECISION→JOB BACKLINK (FW-32-A): the producing job's own id — the lineage Round A's C02 audits demanded. */
  readonly promotedFromJob: string;
};

/** The promote route's success payload (the response body's `data`). */
export interface JobPromotionPayload {
  /** The minted (or existing, on a repeat call) decision record — the outcome read family's own shape. */
  readonly decision: PromotedDecisionRecord;
  /** True when the decision already existed (idempotent replay — never a duplicate). */
  readonly replay: boolean;
}

/** The promotion desk — the named deciding body behind every promoted decision (the R3 discipline). */
export const PROMOTION_DESK = 'desk:research-promotion';

/** The minimal request surface the promote route consumes (the wrapped ApiRequest carries exactly these). */
export type JobPromoteRequest = Pick<ApiRequest, 'method' | 'path' | 'headers'>;

// ---------------------------------------------------------------------------
// The envelope discipline (the risk-utilization/runbook precedent: built
// from the frozen service's own primitives — no runtime dependency on
// './routes')
// ---------------------------------------------------------------------------

function promoteRouteRequestId(request: JobPromoteRequest, serial: number): RequestId {
  return mintRequestId(fnv1a32Hex(canonicalJson(['job-promote-route', request.method, request.path, serial] as never)));
}

function promoteRouteSuccess(requestId: RequestId, data: unknown, status = 200): ApiResponse {
  return deepFreeze({ status, headers: { 'x-request-id': requestId, 'x-api-version': CURRENT_API_VERSION }, body: { requestId, data } });
}

function promoteRouteError(requestId: RequestId, error: ApiError): ApiResponse {
  const headers: Record<string, string> = { 'x-request-id': requestId, 'x-api-version': CURRENT_API_VERSION };
  if (error.retryAfterMs !== undefined) headers['retry-after-ms'] = String(error.retryAfterMs);
  return deepFreeze({ status: error.status, headers, body: { requestId, error } });
}

// ---------------------------------------------------------------------------
// The mint (pure, deterministic over the job record + the promote instant)
// ---------------------------------------------------------------------------

/** One content-addressed id over the promotion's own identity (tenant + job). */
function promotionId(prefix: 'out' | 'xd' | 'si' | 'swo' | 'shs', story: string, tenant: string, jobId: string): string {
  return `${prefix}:${fnv1a32Hex(canonicalJson([`job-promotion-${story}`, tenant, jobId] as never))}`;
}

/** The job's release-candidate result as the promotion reads it (null when the result is not one). */
function releaseCandidateOf(job: JobRecord): { readonly specId: string; readonly version: number } | null {
  const result = job.result as unknown;
  if (typeof result !== 'object' || result === null) return null;
  const payload = result as { readonly kind?: unknown; readonly specId?: unknown; readonly version?: unknown };
  if (payload.kind !== 'release-candidate') return null;
  if (typeof payload.specId !== 'string' || payload.specId.length === 0) return null;
  if (typeof payload.version !== 'number' || !Number.isSafeInteger(payload.version)) return null;
  return { specId: payload.specId, version: payload.version };
}

/**
 * Mint the promoted-decision record (pure — the registry keeps the first
 * mint verbatim, so a replay serves byte-identical bytes). The record is
 * the demo seed's own enriched mirror shape: the FULL OutcomeRecordMirror
 * (the structural guard passes — pinned by test) with the R3
 * decision-audit substance and FW-32-A's `promotedFromJob` lineage.
 *
 * THE HONESTY DISCIPLINE (the anti-deception law): a research promotion
 * runs NO execution — the outcome class is the closed vocabulary's own
 * `no_execution`, the expectation/realization figures are the structural
 * unit truths of exactly-one-deliverable-promoted (expected 1, realized 1,
 * zero shortfall, zero fees, zero notional — no fabricated economics), and
 * the rationale cites the job, its spec + version, the completion instant
 * and the job's own evidence capsule source (`/v1/jobs/:jobId`) verbatim.
 */
export function mintPromotedDecision(tenant: string, job: JobRecord, at: number): PromotedDecisionRecord {
  const candidate = releaseCandidateOf(job);
  // The route gates promotability before minting; a non-candidate here is a
  // programming error, never a served fabrication — loud (the seed's own law).
  if (candidate === null) {
    throw new Error(`mintPromotedDecision: the job ${JSON.stringify(job.jobId)} carries no release-candidate result`);
  }
  const digest = fnv1a32Hex(canonicalJson(['job-promotion-config', tenant, job.project, job.jobId] as never));
  const outcomeId = promotionId('out', 'outcome', tenant, job.jobId);
  const decisionRef = promotionId('xd', 'decision', tenant, job.jobId);
  const intentRef = promotionId('si', 'intent', tenant, job.jobId);
  const shadowOutcomeRef = promotionId('swo', 'shadow-outcome', tenant, job.jobId);
  const sessionId = promotionId('shs', 'shadow-session', tenant, job.jobId);
  const completedAt = job.completedAt ?? job.submittedAt;
  const rationale = `The research job ${job.jobId} completed at ${new Date(completedAt).toISOString()}; its release-candidate deliverable (spec ${candidate.specId}, version ${candidate.version}) is promoted as this decision on the professional's proposal. The decision cites the job's own evidence capsule (source ref ${job.jobId} at /v1/jobs/:jobId); no execution ran (outcome class no_execution) and the promotion is simulated substance under the console's SIMULATED badge.`;
  const record: PromotedDecisionRecord = deepFreeze({
    outcomeId,
    ordinal: 1,
    tenant,
    project: job.project,
    decision: { decisionRef, intentRef, disposition: 'filled' },
    outcomeClass: 'no_execution',
    expectation: { expectedQuantity: '1', expectedRealized: '1', tolerance: '0', declaredBy: candidate.specId },
    realization: { filledQuantity: '1', realizedOutcome: '1', feeTotal: '0', notionalTotal: '0', unrealizedAtDecision: '0' },
    deviation: { quantityShortfall: '0', realizedGap: '0', withinTolerance: true },
    evidence: [
      { kind: 'shadow_outcome', ref: shadowOutcomeRef },
      { kind: 'shadow_session', ref: sessionId },
      { kind: 'decision', ref: decisionRef },
    ],
    lineage: {
      shadow: {
        sessionId,
        fidelity: { mode: 'shadow', fill_origin: 'simulated' },
        executionPolicy: { policyId: 'xp-promote', version: 1 },
        riskPolicy: { policyId: 'rp-promote', version: 1 },
        configDigests: { worldConfigHash: `promote-world-${digest}`, engineConfigHash: `promote-engine-${digest}`, dataset: `promote-dataset-${digest}` },
        run: { runId: `run-promote-${digest}`, episodeId: `ep-promote-${digest}` },
        cursor: { cursorId: `cur-promote-${digest}`, position: 1 },
        seed: `promote-seed-${digest}`,
        tenant,
        project: job.project,
      },
      shadowOutcomeRef,
      shadowOutcomeOrdinal: 1,
      shadowAsOf: completedAt as TimestampMs,
      decisionStreamPosition: 1,
      trajectoryRef: null,
      experiment: null,
    },
    decisionBody: PROMOTION_DESK,
    decisionRationale: rationale,
    promotedFromJob: job.jobId,
    asOf: at as TimestampMs,
    priorChainHead: '00000000',
  });
  return record;
}

/** Guard pin: the minted record satisfies the boundary's own structural mirror guard. */
export function promotedDecisionIsValid(record: PromotedDecisionRecord): boolean {
  return isOutcomeRecordMirror(record);
}

// ---------------------------------------------------------------------------
// The per-instance promotion registry (the demo backing's own state law)
// ---------------------------------------------------------------------------

/** The registry's promote outcome: the record + whether it already existed. */
export interface PromotedDecisionEntry {
  readonly decision: PromotedDecisionRecord;
  readonly replay: boolean;
}

/**
 * The composition-private registry lookup (FW-33-A): `createPromotionRegistry`
 * registers each registry under its own `outcomesOf` fold — the outcome
 * wrapper's composition-time lane binding (below) finds the registry the
 * composition wired it to, with no ambient state and no cross-instance
 * aliasing (every registry owns its own fold function, so concurrent
 * compositions in one process — the test harness's instance-per-compose
 * law — never cross). A hand-rolled fold (the port-override arm's `() => []`)
 * is not in the map: no registry, no binding.
 */
const registryOfOutcomeFold = new WeakMap<object, PromotionRegistry>();

/**
 * The host-owned promotion registry (per instance — see the disclosed
 * limitations above). FW-33-A: under the DURABLE backing the registry
 * carries a BOUND durable write lane (bound at composition time by the
 * outcome wrapper below, when the wrapper chain carries one): every
 * minted record — first mint AND idempotent replay — queues its putOutcome
 * write-through onto the seam's pending drain, so a promoted decision
 * becomes DURABLE TRUTH the moment it mints (the write confirms on the
 * next request's drain; the wrapper's serve-time backstop re-queues where
 * it never landed). Under the DEMO backing no lane ever binds: the
 * per-instance law, unchanged, honestly under SIMULATED.
 */
export interface PromotionRegistry {
  /** Register (or return the existing) promotion of one job — idempotent per job, keyed tenant+job. */
  record(tenant: string, job: JobRecord, at: number): PromotedDecisionEntry;
  /** The promoted decision records of one tenant + project (L12: keyed on the AUTHORIZED tenant). */
  outcomesOf(tenant: string, project: string): readonly PromotedDecisionRecord[];
  /** The existing promotion of one job, when this instance already minted it. */
  decisionOfJob(tenant: string, jobId: string): PromotedDecisionRecord | null;
  /**
   * FW-33-A: bind the durable write-through lane (idempotent — the last
   * binding wins; the composition binds at most once per registry).
   */
  bindDurableLane(lane: OutcomeDurableWriteLane): void;
}

/** Build one per-instance promotion registry (the composition owns exactly one). */
export function createPromotionRegistry(): PromotionRegistry {
  const byJob = new Map<string, PromotedDecisionRecord>();
  let durableLane: OutcomeDurableWriteLane | null = null;
  const registry: PromotionRegistry = {
    record(tenant, job, at) {
      const key = `${tenant}/${job.jobId}`;
      const existing = byJob.get(key);
      if (existing !== undefined) {
        // FW-33-A: the REPLAY re-queues the write-through too — a first
        // mint whose durable write never confirmed (a failed drain, an
        // instance that died before the next request) heals here; the
        // lane's own idempotence (projection match + pending match) keeps
        // the confirmed case a no-op.
        durableLane?.recordOutcome(existing);
        return { decision: existing, replay: true };
      }
      const decision = mintPromotedDecision(tenant, job, at);
      byJob.set(key, decision);
      // FW-33-A: the mint queues its durable write-through IMMEDIATELY — a
      // promoted decision becomes durable TRUTH, not per-instance state.
      durableLane?.recordOutcome(decision);
      return { decision, replay: false };
    },
    outcomesOf(tenant, project) {
      const rows: PromotedDecisionRecord[] = [];
      for (const decision of byJob.values()) {
        if (decision.tenant === tenant && decision.project === project) rows.push(decision);
      }
      return Object.freeze(rows);
    },
    decisionOfJob(tenant, jobId) {
      return byJob.get(`${tenant}/${jobId}`) ?? null;
    },
    bindDurableLane(lane) {
      durableLane = lane;
    },
  };
  // FW-33-A: the registry is discoverable through its own outcomesOf fold
  // — the outcome wrapper's composition-time binding (the only seam where
  // the durable port chain and this registry meet). Keyed by the fold
  // function object itself: two compositions in one process never alias.
  registryOfOutcomeFold.set(registry.outcomesOf, registry);
  return registry;
}

// ---------------------------------------------------------------------------
// THE SEAM — the outcome-learning wrapper (the org's own decision stream's
// derived-rows pattern; runtime/demo.ts's outcomeLearningWithProjectEvidence
// is the exact precedent)
// ---------------------------------------------------------------------------

/**
 * Wrap one outcome-learning port so the promoted decision records serve
 * ALONGSIDE the base rows on the frozen /v1/outcomes/query read — the
 * promoted decision joins the org's own decision stream exactly like the
 * demo project's seeded records and every launched desk's derived stream
 * (idempotent by content-addressed outcomeId; the base port's typed
 * failures pass through untouched — R46). The post-mortem read passes
 * through untouched (a promotion mints no post-mortem).
 *
 * FW-33-A (Round B blocker 1 — the launched-desk record durability wave):
 * the wrapper is the composition's one meeting point of the DURABLE
 * port chain (carrying the seam's outcome write lane, propagated by demo.ts's
 * outcomeLearningWithProjectEvidence) and the promotion registry (whose own
 * `outcomesOf` fold is registered in `registryOfOutcomeFold`), so at
 * CONSTRUCTION time it binds the lane to the registry — every mint queues
 * its putOutcome write-through at MINT time. And per SERVE, the wrapper
 * re-queues every promoted record the durable truth lacks (the additions it
 * is about to serve): the write rides the QUERYING request's own drain (the
 * W-25D ordering law, the W-27 recordJobs pattern) — the backstop that
 * heals a mint whose first write never confirmed, and the lane that makes a
 * fresh instance's boot projection + a warm instance's staleness heal serve
 * the record EVERYWHERE. Under the DEMO backing (or port overrides) the
 * lane/registry probes find nothing: the per-instance law, byte-identical.
 */
export function outcomeLearningWithPromotedDecisions(
  inner: OutcomeLearningPort,
  promotedOutcomesOf: (tenant: string, project: string) => readonly PromotedDecisionRecord[],
): OutcomeLearningPort {
  // FW-33-A — the composition-time binding: the durable seam's lane (when
  // the inner chain carries one) meets the registry (when the fold is the
  // registry's own). Both probes are structural (null/undefined under demo
  // and port overrides — no binding, no writes, the pre-law).
  const durableLane = outcomeDurableLaneOf(inner);
  const registry = registryOfOutcomeFold.get(promotedOutcomesOf);
  if (durableLane !== null && registry !== undefined) registry.bindDurableLane(durableLane);
  return {
    queryOutcomes(query, options) {
      const result = inner.queryOutcomes(query, options);
      if (!result.ok) return result; // the base port's typed failure passes through untouched
      const promoted = promotedOutcomesOf(query.tenant, query.project);
      if (promoted.length === 0) return result;
      const present = new Set(result.value.map((record) => record.outcomeId));
      const additions = promoted.filter((record) => !present.has(record.outcomeId));
      if (additions.length === 0) return result; // idempotent — never a duplicate
      // FW-33-A — THE SERVE-TIME BACKSTOP: every promoted record the
      // durable truth lacks (these additions) re-queues its write-through;
      // THIS request's own drain confirms them before the response serves
      // (the ordering law). A record the durable truth already holds never
      // queues (the lane's projection-match skip).
      for (const addition of additions) durableLane?.recordOutcome(addition);
      return { ok: true, value: Object.freeze([...result.value, ...additions]) };
    },
    queryPostMortems(query, options) {
      return inner.queryPostMortems(query, options); // a promotion mints no post-mortem
    },
  };
}

// ---------------------------------------------------------------------------
// The route (authn first, the typed errors — the W-8 / FW-31-A law)
// ---------------------------------------------------------------------------

/** The promote route's structural input (both arms build it; null promotions = the route is absent). */
export interface JobPromoteRouteInput {
  /** The host auth seam (the composition's registered developer credential — the W-8 law). */
  readonly verifyDeveloperAuthorization: (authorization: string | undefined) => { readonly tenant: string; readonly principal: string } | null;
  /** The backing's API-owned job store (the SAME store the per-id GET /v1/jobs/:jobId reads). */
  readonly jobs: () => readonly JobRecord[];
  /** The composition's promotion registry (the mint + the idempotence state). */
  readonly promotions: PromotionRegistry;
}

/** The `/v1/jobs/:jobId/promote` path match (the captured job id, or null). */
export function matchJobPromotePath(path: string): string | null {
  const segments = path.split('/').filter((segment) => segment.length > 0);
  if (segments.length !== 4) return null;
  if (segments[0] !== 'v1' || segments[1] !== 'jobs' || segments[3] !== 'promote') return null;
  const jobId = segments[2] as string;
  return jobId.length > 0 ? jobId : null;
}

/**
 * Serve ONE POST /v1/jobs/:jobId/promote request. Returns `null` when the
 * request is NOT the promote route (the caller falls through to the frozen
 * boundary — the pre-FW-32-A behavior, byte-identical). Authn FIRST (the
 * typed 401); the job lookup answers the typed 404 (unknown and
 * cross-tenant indistinguishable — the boundary's own law); a job that is
 * not a completed research release candidate answers the typed 409 (the
 * frozen service's own conflict family); the mint is idempotent per job.
 */
export function serveJobPromoteRoute(input: JobPromoteRouteInput, request: JobPromoteRequest, serial: number): ApiResponse | null {
  if (request.method !== 'POST') return null;
  const jobId = matchJobPromotePath(request.path);
  if (jobId === null) return null;
  const requestId = promoteRouteRequestId(request, serial);
  // AUTHN FIRST (the boundary's own 401 law — the W-8 demo-substance routes' own shape).
  const authorization = input.verifyDeveloperAuthorization(request.headers.authorization);
  if (authorization === null) {
    return promoteRouteError(requestId, apiError('unauthenticated', 'a Bearer credential token is required on every route of this boundary'));
  }
  // L12 by construction: the lookup keys on the AUTHORIZED tenant (a foreign
  // tenant's job is indistinguishable from an unknown id — the typed 404).
  const job = input.jobs().find((candidate) => candidate.jobId === jobId && candidate.tenant === authorization.tenant);
  if (job === undefined) {
    return promoteRouteError(requestId, apiError('not_found', `no job ${JSON.stringify(jobId)} exists for this credential (the promotion serves the credential tenant's own job records; unknown and cross-tenant are indistinguishable)`));
  }
  // THE PROMOTABLE GATE (typed 409 — the frozen service's own conflict
  // family): only a COMPLETED RESEARCH job whose result is a RELEASE
  // CANDIDATE promotes. The gate quotes the job's actual state verbatim —
  // never a fabricated eligibility.
  const promotable = job.kind === 'research' && job.status === 'complete' && releaseCandidateOf(job) !== null;
  if (!promotable) {
    const resultKind = typeof (job.result as { readonly kind?: unknown } | undefined)?.kind === 'string' ? (job.result as { readonly kind: string }).kind : 'none';
    return promoteRouteError(requestId, apiError('conflict', `the job ${JSON.stringify(jobId)} is not promotable (kind ${job.kind}, status ${job.status}, result ${resultKind}) — the promotion serves completed research jobs whose result is a release candidate`));
  }
  // The mint (idempotent per job — the registry keeps the first record verbatim).
  const entry = input.promotions.record(authorization.tenant, job, Date.now());
  return promoteRouteSuccess(requestId, deepFreeze({ decision: entry.decision, replay: entry.replay }));
}
