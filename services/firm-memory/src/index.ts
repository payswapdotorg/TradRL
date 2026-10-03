/**
 * @tradrl/firm-memory-service — the firm-memory SERVICE (Work Order
 * T034): the tenant-isolated organizational memory over the
 * @tradrl/firm-memory contracts — the ARCHITECTURE.md pipeline's Firm
 * Brain stage ("Outcome -> Firm Brain -> Capability Improvement").
 *
 * Public API:
 *   - `createFirmMemoryState` / `ingestFirmLearning` — the state
 *     machine: ingest T033's query surface through the structural
 *     mirrors (outcome records + post-mortem drafts + attribution
 *     classes), enforce the coherence laws (ONE scope per batch —
 *     `tenant_mismatch`; subject binding — `lineage_gap`; L4 —
 *     `l4_boundary_violation`; idempotence — `duplicate_evidence`),
 *     lift the hypotheses into typed claim candidates, apply the
 *     promotion policy (evidence count, aggregate confidence, window
 *     stability — injected instants only), and reconcile + dedupe
 *     against the existing knowledge (revisions fold; contradictions
 *     are typed records in the chain-verified register, never silent
 *     overwrites; polarity flips require strictly dominating
 *     evidence). ATOMIC per batch.
 *   - `queryFirmKnowledge` / `getKnowledgeAt` / `queryContradictions`
 *     — the serving surface T035's autonomous improvement and the
 *     research bodies' knowledge lookups read: point-in-time by
 *     instant (L4 — the future is never returned, not even by id),
 *     tenant-isolated at every read (R25/L12 — a cross-tenant read is
 *     the typed `cross_tenant_access` naming both scopes),
 *     chain-gated (a tampered brain never serves — `chain_mismatch`),
 *     with the deterministic family projection (active / superseded /
 *     decayed + retention windows).
 *   - `firmMemoryStateDigest` — the determinism comparator.
 *
 * Package laws (mirroring the merged lanes):
 * - Zero runtime dependencies; the ONLY workspace source import is
 *   this lane's own contract package (packages/firm-memory) through
 *   the single import surface (src/imports.ts) — every other lane's
 *   shapes (T033's records, T011's refs, T007's identity) are
 *   structural mirrors inside that package (D-003/D-004). interop
 *   .test.ts drives the REAL T033 pipeline, the REAL T011 records and
 *   the REAL execution-policy decimal kernel through the mirrors
 *   (test-only imports — the drift trip wires).
 * - No ambient clock (`Date.now()` never appears) and no ambient
 *   randomness; every instant is an injected parameter; every id is
 *   content-addressed.
 * - Exact decimals on every confidence path; a JS number is the typed
 *   `decimal_imprecision`.
 * - L12 tenant scoping on every record and every query; L4 at every
 *   evidence boundary; append-only + chain-verified wherever history
 *   is retained (rewriting or HIDING a knowledge entry or a
 *   contradiction is a typed error; retention NEVER deletes).
 */

// The single import surface (re-exported for the lane's consumers)
export type { FirmMemoryErrorCode, FirmMemoryError, FirmMemoryResult, TimestampMs } from './imports';
export { fail, failures, ok } from './imports';

// The state machine + the receipts
export type { ConsumedEvidenceEntry, FirmIngestionReceipt, FirmMemoryState } from './state';
export { createFirmMemoryState, isFirmMemoryState, mintReceipt, firmMemoryStateDigest } from './state';

// The ingestion pipeline
export type { FirmLearningSnapshot, FirmIngestInputs, FirmIngestResult } from './ingest';
export { ingestFirmLearning } from './ingest';

// The serving surface
export type { KnowledgeQuery, ContradictionQuery, KnowledgeQueryOptions, ServedKnowledge } from './imports';
export { queryFirmKnowledge, getKnowledgeAt, queryContradictions } from './serve';

// The policies (the service's consumers pin their own)
export type { PromotionPolicy, ServingPolicy } from './imports';
export { DEFAULT_PROMOTION_POLICY, DEFAULT_SERVING_POLICY, validatePromotionPolicy, validateServingPolicy } from './imports';

// The golden determinism constants (the pinned literals the determinism tests compare against)
export {
  GOLDEN_STATE_DIGEST_B1,
  GOLDEN_KNOWLEDGE_HEAD_B1,
  GOLDEN_STATE_DIGEST_B2,
  GOLDEN_STATE_DIGEST_B3,
  GOLDEN_CONTRADICTION_HEAD_B3,
  GOLDEN_STATE_DIGEST_B4,
  GOLDEN_STATE_DIGEST_B5,
  GOLDEN_STATE_DIGEST_B6,
  GOLDEN_STATE_DIGEST_B,
  GOLDEN_ACTIVE_COUNT,
  GOLDEN_KNOWLEDGE_COUNT,
  GOLDEN_CONTRADICTION_COUNT,
} from './golden';

// The deterministic scenario fixtures (test-support only — the T033-fixtures precedent)
export {
  FIRM_T0,
  FIRM_TENANT,
  FIRM_PROJECT,
  FIRM_TENANT_B,
  FIRM_PROJECT_B,
  FIRM_SESSION,
  FIRM_SESSION_B,
  scenarioSnapshotAdverse,
  scenarioSnapshotReinforce,
  scenarioSnapshotChallenger,
  scenarioSnapshotDominating,
  scenarioSnapshotTenantB,
  scenarioSnapshotInternalContest,
  scenarioSnapshotInternalDomination,
  scenarioSnapshotMinimal,
  firmScenarioPolicy,
  firmScenarioShortPolicy,
  firmScenarioServingPolicy,
} from './fixtures';
