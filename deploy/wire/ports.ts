// deploy/wire/ports.ts — the DEEP structural mirrors completing the
// strict assignability law (T052, W-3d; the W-3b deferral resolved).
//
// The deployment adapters NEVER import services/api at runtime
// (invariant-9). This module completes the mirrors at the depth the
// STRICT direction needs: the port method signatures — the exact
// (query, options) -> PortResult<records> shapes the adapters'
// stores must satisfy for direct injection at the composition seam.
// The record PAYLOADS stay opaque (canonical-JSON round-trip — the
// W-3b decision stands); what is mirrored here is the PORT SURFACE:
// method names, parameter shapes, and the widened result envelope
// with the concrete record types the T041 pipeline consumes.
//
// The wire tests (wire.test.ts) then assert BOTH assignability
// directions against the REAL T041 port types via TEST-ONLY imports
// (the interop precedent): a store built for a mirror port IS a real
// port implementation — drift in services/api's ports breaks the
// wire at typecheck time.
//
// Spec anchors: ARCHITECTURE-LOCK invariant-9 (ports unchanged,
// providers injected), L12, R46, D-033.

import type { StoreResult } from '../adapters/shared';
import type { KnowledgeQueryMirror, KnowledgeQueryOptionsMirror, OutcomeQueryMirror, OutcomeQueryOptionsMirror, PostMortemQueryMirror, ServedKnowledgeMirror } from '../adapters/neon/mirrors';

// ---------------------------------------------------------------------------
// The T034 firm-memory port (the deep mirror — the record envelope)
// ---------------------------------------------------------------------------

/** The firm-memory port surface (structural mirror of T041's FirmMemoryPort). */
export interface FirmMemoryPortMirror {
  queryKnowledge(query: KnowledgeQueryMirror, options: KnowledgeQueryOptionsMirror): Promise<StoreResult<readonly ServedKnowledgeMirror[]>>;
}

// ---------------------------------------------------------------------------
// The T033 outcome-learning port
// ---------------------------------------------------------------------------

/** The outcome-learning port surface (structural mirror of T041's OutcomeLearningPort; records opaque). */
export interface OutcomeLearningPortMirror {
  queryOutcomes(query: OutcomeQueryMirror, options: OutcomeQueryOptionsMirror): Promise<StoreResult<readonly unknown[]>>;
  queryPostMortems(query: PostMortemQueryMirror, options: OutcomeQueryOptionsMirror): Promise<StoreResult<readonly unknown[]>>;
}

// ---------------------------------------------------------------------------
// The T040 execution gateway port (the L8 chokepoint — mirrored verbatim)
// ---------------------------------------------------------------------------

/** The strategy-intent input (opaque to the deployment: the gateway's own contract). */
export type StrategyIntentMirror = unknown;

/** The gateway submission record (opaque: the gateway's output, served verbatim). */
export type GatewaySubmissionRecordMirror = unknown;

/** The execution-gateway port surface (structural mirror of T041's ExecutionGatewayPort — THE ONLY execution path, L8). */
export interface ExecutionGatewayPortMirror {
  submitRequest(intent: StrategyIntentMirror): Promise<StoreResult<GatewaySubmissionRecordMirror>>;
}

// ---------------------------------------------------------------------------
// The job-submission port (the async submitted/running/complete pattern)
// ---------------------------------------------------------------------------

/** The job kinds (T041's closed set — mirrored). */
export const JOB_KINDS = ['research', 'learning'] as const;

/** One job kind. */
export type JobKindMirror = (typeof JOB_KINDS)[number];

/** The job statuses (T041's closed set — mirrored). */
export const JOB_STATUSES = ['submitted', 'running', 'complete', 'failed'] as const;

/** One job status. */
export type JobStatusMirror = (typeof JOB_STATUSES)[number];

/** One job record (structural mirror of T041's JobRecord). */
export interface JobRecordMirror {
  readonly jobId: string;
  readonly kind: JobKindMirror;
  readonly tenant: string;
  readonly project: string;
  readonly status: JobStatusMirror;
  readonly submittedAt: number;
  readonly result?: unknown;
  readonly completedAt?: number;
}

/** The job-submission port surface (structural mirror of T041's JobSubmissionPort). */
export interface JobSubmissionPortMirror {
  submitJob(input: {
    readonly kind: JobKindMirror;
    readonly tenant: string;
    readonly project: string;
    readonly spec: unknown;
    readonly at: number;
  }): Promise<StoreResult<JobRecordMirror>>;
}

// ---------------------------------------------------------------------------
// The control-plane port (T007's domain law stays in the REAL control
// plane — the deployment composes the real one over the persistence
// substrate; the mirror exists for the wire's record)
// ---------------------------------------------------------------------------

/** The control-plane port surface (structural mirror of T041's ControlPlanePort; records opaque). */
export interface ControlPlanePortMirror {
  createProject(input: { readonly id: string; readonly tenantId: string; readonly name: string; readonly executionMode: string; readonly goal: unknown; readonly constraintSet: unknown; readonly at: number }): Promise<StoreResult<unknown>>;
  getProject(tenantId: string, projectId: string): Promise<StoreResult<unknown>>;
  projectsOf(tenantId: string): Promise<StoreResult<readonly unknown[]>>;
  transition(input: { readonly tenantId: string; readonly projectId: string; readonly event: string; readonly at: number }): Promise<StoreResult<unknown>>;
  bindOrganization(input: { readonly tenantId: string; readonly projectId: string; readonly organizationRef: string; readonly at: number }): Promise<StoreResult<unknown>>;
}
