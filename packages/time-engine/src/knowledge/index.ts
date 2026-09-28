/**
 * @tradrl/time-engine/knowledge — the point-in-time KNOWLEDGE firewall
 * (Work Order T026). Public API of the NEW subtree inside @tradrl/time-engine.
 *
 * This subtree EXTENDS the T004 observable boundary (src/boundary.ts) from
 * raw events to ALL knowledge — features, aggregates, labels, cached data,
 * research artifacts, firm memory — each carrying the availability quartet
 * plus provenance, tenant and knowledge-graph lineage:
 *
 *   - `KnowledgeRecord` / `createKnowledgeRecord` — the record contract
 *     (opaque payload, quartet, inputs, computation policy, tenant,
 *     T008-shaped provenance mirror), deeply frozen.
 *   - `KnowledgeBase` / `appendKnowledgeRecord` / `loadKnowledgeRecords` —
 *     the pure, append-only, in-memory store with the full write contract
 *     (identity, parent resolution, L12 derivation isolation, L4
 *     propagation).
 *   - `visible` / `visibleSlice` / `getKnowledgeRecord` /
 *     `visibleKnowledgeSlice` — clock-policed queries: visibility is
 *     `available_time <= at` INCLUSIVE, origin-blind, tenant-scoped;
 *     cross-tenant reads are rejected with typed errors.
 *   - `derivedKnowledgeAvailableTime` / `knowledgePropagationFloor` /
 *     `validateKnowledgeRecord` — multi-input availability propagation.
 *   - `knowledgeLeakageScan` — the forensic pass detecting past-dated
 *     artifacts built from future-available inputs (and L12 boundary
 *     crossings / unresolved lineage).
 *
 * Zero runtime dependencies; types, guards and pure functions only. No
 * wall-clock coupling — runtime services drive clocks; the firewall only
 * validates, decides and audits. The pre-existing time-engine modules
 * (boundary.ts, derived.ts, leakage.ts, clock.ts, timestamp.ts, ...) are
 * consumed read-only; this subtree is exclusively NEW files.
 */

// Errors and results
export type { KnowledgeErrorCode, KnowledgeError, KnowledgeResult } from './errors';
export { fail, ok } from './errors';

// Opaque branded identity references
export type { KnowledgeRecordId, TenantId } from './ids';
export {
  isKnowledgeRecordId,
  isTenantId,
  knowledgeRecordId,
  tenantId,
  requireKnowledgeRecordId,
  requireTenantId,
} from './ids';

// Deep freezing
export { deepFreeze, isDeeplyFrozen } from './freeze';

// Provenance reference (T008 ProvenanceRecord shapes, mirrored; see
// ./t008-reference/ for the vendored verbatim reference copy the mirror is
// trip-wired against in interop.test.ts)
export type {
  LineageId,
  TransformId,
  AdapterId,
  AdapterVersion,
  CorrectionId,
  CorrectionReason,
  BatchId,
  CommitId,
  KnowledgeOrigin,
  AdapterRef,
  CorrectionRef,
  BatchRef,
  CommitRef,
  CustodyChain,
  KnowledgeProvenance,
} from './provenance';
export {
  KNOWLEDGE_ORIGINS,
  isKnowledgeOrigin,
  isAdapterRef,
  isCorrectionRef,
  isBatchRef,
  isCommitRef,
  isCustodyChain,
  validateKnowledgeProvenance,
  isKnowledgeProvenance,
  isSyntheticKnowledge,
} from './provenance';

// The knowledge record contract
export type { KnowledgeRecord } from './record';
export { isKnowledgeRecord, createKnowledgeRecord } from './record';

// Derived-knowledge availability propagation
export {
  derivedKnowledgeAvailableTime,
  knowledgePropagationFloor,
  validateKnowledgeRecord,
} from './propagation';

// The append-only knowledge base
export type { KnowledgeBase } from './base';
export {
  isKnowledgeBase,
  createKnowledgeBase,
  appendKnowledgeRecord,
  loadKnowledgeRecords,
  visible,
  visibleSlice,
  getKnowledgeRecord,
  visibleKnowledgeSlice,
} from './base';

// Leakage forensics
export type {
  LeakyRecordFinding,
  MissingInputFinding,
  TenantBoundaryCrossingFinding,
  KnowledgeLeakageFinding,
  KnowledgeLeakageReport,
} from './scan';
export { knowledgeLeakageScan, requireCleanKnowledgeBase } from './scan';

/** Subtree identity and ownership (Work Order T026). */
export const knowledgeFirewallInfo = {
  name: '@tradrl/time-engine/knowledge',
  owner: 'T026',
  status: 'implemented',
} as const;
