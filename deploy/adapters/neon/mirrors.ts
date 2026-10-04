// deploy/adapters/neon/mirrors.ts — the STRUCTURAL MIRRORS of the T041
// port shapes the Neon stores satisfy (invariant-9 law: the adapters
// NEVER import services/api — these mirrors are hand-authored and the
// contract test pins their compatibility with the REAL shapes
// test-only, the T041 interop precedent).
//
// Mirror discipline: the QUERY shapes are mirrored FIELD-FOR-FIELD
// (the stores filter on them — drift here breaks the SQL, so the
// contract test asserts the REAL query types are assignable to these
// mirrors). The RECORD envelopes are mirrored at the level the store
// touches (identity, scope, chain, status); the deep domain payloads
// (claims, provenance, outcome internals) stay OPAQUE — the store
// round-trips them byte-faithfully as canonical JSON without
// re-validating lane-owned internals. The full deep-record mirror +
// the strict store-implements-real-port assignability trip-wire land
// with deploy/wire (W-3d), where the wiring needs them.

import type { StoreResult } from '../shared';

// ---------------------------------------------------------------------------
// T034 — the firm-memory query surface (mirror of services/api/src/mirrors.ts)
// ---------------------------------------------------------------------------

/** The point-in-time knowledge query (mirror — scope mandatory). */
export interface KnowledgeQueryMirror {
  readonly tenant: string;
  readonly project: string;
  readonly kinds?: readonly string[];
  readonly polarity?: string;
  readonly dimension?: string;
  readonly lagBand?: string;
  readonly minEvidenceCount?: number;
  readonly minConfidence?: string;
  readonly knowledgeId?: string;
}

/** The knowledge query options (mirror — the injected instant + retention). */
export interface KnowledgeQueryOptionsMirror {
  readonly at: number;
  readonly retention: unknown;
  readonly activeOnly?: boolean;
}

/** One served-knowledge envelope (mirror — the record payload is opaque to the store). */
export interface ServedKnowledgeMirror {
  /** The full FirmKnowledgeRecord (opaque here — canonical-JSON round-tripped). */
  readonly record: unknown;
  readonly status: 'active' | 'superseded' | 'decayed';
  readonly supersededBy: string | null;
}

/** The firm-memory store surface (mirror of T041's FirmMemoryPort). */
export interface FirmMemoryStoreMirror {
  queryKnowledge(query: KnowledgeQueryMirror, options: KnowledgeQueryOptionsMirror): Promise<StoreResult<readonly ServedKnowledgeMirror[]>>;
}

// ---------------------------------------------------------------------------
// T033 — the outcome-learning query surface (mirror of mirrors-outcomes.ts)
// ---------------------------------------------------------------------------

/** The outcome query (mirror). */
export interface OutcomeQueryMirror {
  readonly tenant: string;
  readonly project: string;
  readonly decisionRef?: string;
  readonly intentRef?: string;
  readonly outcomeClass?: string;
  readonly sessionRef?: string;
  readonly outcomeRecordRef?: string;
}

/** The post-mortem query (mirror). */
export interface PostMortemQueryMirror {
  readonly tenant: string;
  readonly project: string;
  readonly decisionRef?: string;
  readonly outcomeRecordRef?: string;
  readonly attributionClass?: string;
}

/** The outcome/post-mortem query options (mirror). */
export interface OutcomeQueryOptionsMirror {
  readonly at: number;
  readonly retention: unknown;
  readonly latestPerOutcome?: boolean;
}

/** The outcome-learning store surface (mirror of T041's OutcomeLearningPort — the decoded record payloads are opaque to the store). */
export interface OutcomeLearningStoreMirror {
  queryOutcomes(query: OutcomeQueryMirror, options: OutcomeQueryOptionsMirror): Promise<StoreResult<readonly unknown[]>>;
  queryPostMortems(query: PostMortemQueryMirror, options: OutcomeQueryOptionsMirror): Promise<StoreResult<readonly unknown[]>>;
}

// ---------------------------------------------------------------------------
// T007 — the control-plane persistence substrate
// ---------------------------------------------------------------------------

/**
 * The project-store surface. NOTE (the honest boundary): this is the
 * PERSISTENCE substrate, not the control-plane port — the domain law
 * (goal/constraint-set compilation, lifecycle preconditions) stays in
 * T007's real control plane; deploy/wire (W-3d) composes the two. The
 * store persists and serves ProjectRecords + the append-only lifecycle
 * event log, tenant-scoped.
 */
export interface ProjectStoreMirror {
  /** Persist one project record (upsert by (tenant, project id); the record's own tenant must match the scope — L12). */
  putProjectRecord(scopeTenant: string, record: unknown): Promise<StoreResult<{ readonly stored: true }>>;
  /** Read one project record; foreign tenants get the typed not-found (indistinguishable — fail-closed L12). */
  getProjectRecord(tenant: string, projectId: string): Promise<StoreResult<unknown>>;
  /** All project records of one tenant, in creation order. */
  projectRecordsOf(tenant: string): Promise<StoreResult<readonly unknown[]>>;
  /** Append one lifecycle event to the log (append-only; ordinal assigned by the store). */
  appendProjectEvent(input: { readonly tenant: string; readonly projectId: string; readonly event: string; readonly at: number; readonly detail?: unknown }): Promise<StoreResult<{ readonly ordinal: number }>>;
  /** The lifecycle event log of one project, in ordinal order. */
  projectEventsOf(tenant: string, projectId: string): Promise<StoreResult<readonly { readonly event: string; readonly at: number; readonly detail: unknown }[]>>;
}
