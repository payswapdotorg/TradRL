// @tradrl/api-service — THE INJECTED BACKING-SERVICE PORTS.
//
// THE BOUNDARY IS A ROUTER: every public route's handler forwards to
// an injected port shaped after the REAL backing service's surface
// (structural mirrors — the interop test proves the REAL services
// satisfy these ports with zero casts). NO port is ever called from
// two routes' handlers except its declared family; NO handler holds
// backing-service state of its own.
//
// THE L8 LAW (the charter's hardest): {@link ExecutionGatewayPort}
// is the ONLY execution-shaped dependency this boundary will EVER
// hold, its single method `submitRequest` is the ONLY path an
// execution request can take, and the handler that calls it performs
// NO authority computation of its own — the gateway's 13-stage
// pipeline IS the authority. A direct-execution code path (executing,
// translating or honoring submitted authority at the boundary) is the
// typed `gate_bypass_attempt` error (see pipeline.ts; the test is
// REQUIRED by the Work Order).
//
// THE INSTANT LAW: no port call reads a clock — the pipeline injects
// the instant source once per request and passes what the ports need.
//
// Spec anchors: ARCHITECTURE-LOCK.md L8, L12, L20; SECURITY.md trust
// zones; R29 (provider-neutral shapes at this boundary — no vendor
// specifics cross these ports).

import type { KnowledgeQuery, KnowledgeQueryOptions, ServedKnowledge, StrategyIntent, GatewaySubmissionRecord } from './mirrors';
import type { OutcomeQuery, OutcomeQueryOptions, OutcomeRecordMirror, PostMortemQuery, PostMortemRecordMirror } from './mirrors-outcomes';
import type { JobId, ProjectId, TenantId } from './ids';
import type { JobKind } from './contracts';
import type { JobRecord, TransitionProjectResponse } from './contracts';
import type { ProjectRecord } from './mirrors';

// ---------------------------------------------------------------------------
// The typed port-failure (widened; the boundary surfaces it as 503 `unavailable`)
// ---------------------------------------------------------------------------

/** One backing-service refusal: a typed code + message (the port never throws). */
export interface PortFailure {
  readonly code: string;
  readonly message: string;
  /** The owning lane's typed problems, when it reports any (dotted paths). */
  readonly problems?: readonly { readonly path: string; readonly message: string }[];
}

/** The widened port result: success value or the typed port failure. */
export type PortResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: PortFailure };

// ---------------------------------------------------------------------------
// T007 — the control-plane port
// ---------------------------------------------------------------------------

/** The control-plane service's public surface, widened (the REAL ControlPlane IS this port — interop test). */
export interface ControlPlanePort {
  /** Create a project (goal + constraint set compile FIRST at the control plane — typed refusals propagate). */
  createProject(input: {
    readonly id: ProjectId;
    readonly tenantId: TenantId;
    readonly name: string;
    readonly executionMode: string;
    readonly goal: unknown;
    readonly constraintSet: unknown;
    readonly at: number;
  }): PortResult<ProjectRecord>;
  /** Read one project (cross-tenant is the lane's own typed `project-not-found`). */
  getProject(tenantId: TenantId, projectId: ProjectId): PortResult<ProjectRecord>;
  /** All projects of one tenant, in creation order (the boundary paginates). */
  projectsOf(tenantId: TenantId): PortResult<readonly ProjectRecord[]>;
  /** Apply a lifecycle event (the reducer's typed errors propagate). */
  transition(input: {
    readonly tenantId: TenantId;
    readonly projectId: ProjectId;
    readonly event: string;
    readonly at: number;
  }): PortResult<TransitionProjectResponse>;
  /** Bind (or re-bind) an organization. */
  bindOrganization(input: {
    readonly tenantId: TenantId;
    readonly projectId: ProjectId;
    readonly organizationRef: string;
    readonly at: number;
  }): PortResult<ProjectRecord>;
}

// ---------------------------------------------------------------------------
// T034 — the firm-memory serving port (READ only)
// ---------------------------------------------------------------------------

/** The firm-memory serving surface, widened (the REAL query function satisfies this port — interop test). */
export interface FirmMemoryPort {
  /** The point-in-time knowledge query (L4: the future is never returned; L12: foreign scopes never served). */
  queryKnowledge(query: KnowledgeQuery, options: KnowledgeQueryOptions): PortResult<readonly ServedKnowledge[]>;
}

// ---------------------------------------------------------------------------
// T033 — the outcome-learning query port (READ only)
// ---------------------------------------------------------------------------

/** The outcome-learning query surface, widened (the REAL queryOutcomeRecords/queryPostMortems satisfy this port — interop test). */
export interface OutcomeLearningPort {
  queryOutcomes(query: OutcomeQuery, options: OutcomeQueryOptions): PortResult<readonly OutcomeRecordMirror[]>;
  queryPostMortems(query: PostMortemQuery, options: OutcomeQueryOptions): PortResult<readonly PostMortemRecordMirror[]>;
}

// ---------------------------------------------------------------------------
// T040 — the execution gateway port (THE L8 CHOKEPOINT)
// ---------------------------------------------------------------------------

/**
 * THE EXECUTION GATEWAY PORT — the single, only, never-bypassed path
 * an execution REQUEST leaving this boundary can take. The REAL
 * gateway session (`submitDecision`) satisfies this port with zero
 * casts (the interop test proves it over the REAL golden session).
 * The boundary NEVER implements, re-implements, pre-computes or
 * re-interprets policy: it forwards intents and serves the gateway's
 * typed outcome (routed or refused) verbatim.
 */
export interface ExecutionGatewayPort {
  /** Submit one strategy intent through the gateway's whole pipeline. THE ONLY METHOD. */
  submitRequest(intent: StrategyIntent): PortResult<GatewaySubmissionRecord>;
}

// ---------------------------------------------------------------------------
// The job machinery port (the async submitted/running/complete pattern)
// ---------------------------------------------------------------------------

/** The job submission sink — the machinery behind the async pattern (NOT this lane's). */
export interface JobSubmissionPort {
  /** Accept one job submission; returns the SUBMITTED job record (the machinery runs it). */
  submitJob(input: {
    readonly kind: JobKind;
    readonly tenant: TenantId;
    readonly project: ProjectId;
    readonly spec: unknown;
    readonly at: number;
  }): PortResult<JobRecord>;
}
