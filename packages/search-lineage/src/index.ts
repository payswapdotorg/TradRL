/**
 * @tradrl/search-lineage — the immutable, append-only SEARCH RECORD (Work
 * Order T031 — the platform-level overfitting/search-integrity control
 * layer, record half).
 *
 * Public API:
 *   - `primitives.ts` — the shared contract discipline (Brand, guards,
 *     deep-freeze, canonical JSON, the dual-lane FNV-1a stable digest, the
 *     TimestampMs mirror of @tradrl/time-engine).
 *   - `ids.ts` — this lane's own identity spaces (`SearchRecordId`,
 *     `ConfigSnapshotId`) plus the opaque cross-lane reference mirrors
 *     (ExperimentId/TrialId/ArmId/SplitPolicyRef/EvaluatorVersionRef/
 *     DataRef from T011; TenantId/ProjectId from domain-core).
 *   - `snapshot.ts` — CONTENT-ADDRESSED config snapshots: the id is the
 *     digest of the canonical config; identical configs address
 *     identically; content and address cannot disagree.
 *   - `trial.ts` — the SEARCH TRIAL ENTRY: trial id, arm, in-search vs
 *     holdout classification, config snapshot ref, parent links (the search
 *     DAG), the data-split ids consumed, the datasets consumed, the
 *     optimization window, the evaluation-policy ref, the injected
 *     recording instant, tenant/project scoping.
 *   - `record.ts` — the SEARCH RECORD: append-only entry log + snapshot
 *     store + the hash CHAIN that binds the binding block and every entry
 *     in order (`appendSearchTrial`, `verifySearchRecord`, `searchDag`).
 *     Hiding or rewriting a trial breaks the chain: `chain_mismatch`.
 *   - `coverage.ts` — the platform hidden-trials law: a claimed view of the
 *     search must name exactly the logged trials (`hidden_trials` /
 *     `unknown_trial` — the platform mirror of T012's hidden_trials), and
 *     the inventory is always computed FROM the verified record.
 *
 * Spec anchors: ARCHITECTURE-LOCK L11 (search integrity), L9 (reproducible
 * lineage), L4 (point-in-time truth — injected instants only), L12 (tenant
 * isolation on every record); spec/EVALUATION-PROTOCOL.md "Selection
 * integrity: Retain search histories and distinguish in-search performance
 * from holdout performance"; spec/ARCHITECTURE.md "Evaluation" ("Preserve
 * search history"); R20 (Backtest-overfitting/search-integrity controls);
 * PROJECT-STATE invariant 7 ("Search history is preserved against
 * overfitting").
 *
 * Package laws: zero runtime dependencies; no `any`; every exported shape
 * has a hand-rolled total type guard; all contract data is
 * JSON-serializable and byte-stable under canonical serialization;
 * cross-lane shapes from T011/T012/T028 are consumed through STRUCTURAL
 * MIRRORS only (D-003/D-004) — the interop trip-wire tests prove the
 * mirrors against the real packages in this tree.
 */

export type { SearchErrorCode, SearchError, SearchResult } from './errors';
export { fail, failures, ok, missingField, invalidField, invalidType } from './errors';

export type { Brand, Mutable, JsonValue, JsonObject, TimestampMs } from './primitives';
export {
  isRecord,
  isNonEmptyString,
  isFiniteNumber,
  isNonNegativeInteger,
  isPositiveInteger,
  deepFreeze,
  isDeeplyFrozen,
  isJsonValue,
  isJsonObject,
  MIN_TIMESTAMP_MS,
  MAX_TIMESTAMP_MS,
  isTimestampMs,
  timestampMs,
  requireTimestampMs,
  canonicalJson,
  stableDigest,
  stableDigestJson,
  isDigest,
} from './primitives';

export type {
  SearchRecordId,
  ConfigSnapshotId,
  ExperimentId,
  TrialId,
  ArmId,
  SplitPolicyRef,
  EvaluatorVersionRef,
  DataRef,
  TenantId,
  ProjectId,
} from './ids';
export {
  isSearchRecordId,
  isConfigSnapshotId,
  isExperimentId,
  isTrialId,
  isArmId,
  isSplitPolicyRef,
  isEvaluatorVersionRef,
  isDataRef,
  isTenantId,
  isProjectId,
} from './ids';

export { SNAPSHOT_ID_PREFIX, configSnapshotId, isConfigSnapshot, validateConfigSnapshot, mintConfigSnapshot, snapshotCanonicalBytes, validateSnapshotStore } from './snapshot';
export type { ConfigSnapshot } from './snapshot';

export { SEARCH_CLASSIFICATIONS, isSearchClassification, isSearchWindow, isSearchTrialEntry, validateSearchTrialEntry, searchTrialDigestInput } from './trial';
export type { SearchClassification, SearchWindow, SearchTrialEntry, SearchTrialInput } from './trial';

export {
  SEARCH_RECORD_ID_PREFIX,
  isSearchBinding,
  searchRecordId,
  chainGenesis,
  chainFold,
  computeChainHead,
  createSearchRecord,
  appendSearchTrial,
  verifySearchRecord,
  searchDag,
  canonicalSearchRecord,
} from './record';
export type { SearchBinding, SearchRecord, SearchDag, SearchDagNode } from './record';

export { searchInventory, inSearchTrials } from './coverage';
export type { SearchInventory } from './coverage';

/** Package identity and ownership (Work Order T031). */
export const packageInfo = {
  name: '@tradrl/search-lineage',
  owner: 'T031',
  status: 'implemented',
} as const;
