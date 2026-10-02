/**
 * @tradrl/outcome-learning — the outcome-learning service (Work Order
 * T033): the Memory/evaluation plane's OUTCOMES + POST-MORTEMS
 * service over the @tradrl/outcomes contracts.
 *
 * Public API:
 *   - `createOutcomeLearningState` / `ingestShadowOutcomes` — the
 *     state machine: ingest T030's shadow outcome stream through the
 *     structural mirrors (byte-preserving physics lineage; the
 *     stream's chain is re-verified through the mirror fold — a
 *     tampered stream is the typed `chain_mismatch` and is never
 *     learned from), reconcile expected-vs-realized (per decision,
 *     with honest NULLs where the caller supplied no facts; and
 *     against the shadow book — the exact accrual delta, quantified
 *     never assumed away), and append the learned outcome records
 *     atomically onto the chain-verified log.
 *   - `generatePostMortemDrafts` — the structured drafts: expected /
 *     happened / gap carried by value + the four TYPED attribution
 *     hypothesis classes (evidence-gated emission; policy-declared
 *     confidences; the canonical ordering) — supersession by APPEND.
 *   - `queryOutcomeRecords` / `queryPostMortems` /
 *     `queryLearningHooks` — the tenant/project/decision query
 *     surface T034's Firm Brain reads (L12 filtering; L4 windowed
 *     visibility over injected instants; latest-per-outcome
 *     post-mortem projection; the hooks T035 consumes).
 *   - `reconcileAgainstBook` / `reconcileOne` / `BookReconciliation`
 *     — the reconciliation engine's direct surface.
 *   - `validateReconciliationPolicy` / `validatePostMortemDraftPolicy`
 *     / `validateRetentionPolicy` + `DEFAULT_POST_MORTEM_DRAFT_POLICY`
 *     — the versioned policies.
 *   - `outcomeLearningStateDigest` — the determinism comparator.
 *
 * Package laws (mirroring the merged lanes):
 * - Zero runtime dependencies; the ONLY workspace source import is
 *   this lane's own contract package (packages/outcomes) through the
 *   single import surface (src/imports.ts) — every other lane's
 *   shapes are structural mirrors inside that package (D-003/D-004).
 *   interop.test.ts drives the REAL shadow-trading session, the REAL
 *   T011 records and the REAL execution-policy decimal kernel through
 *   the mirrors (test-only imports — the drift trip wires).
 * - No ambient clock (`Date.now()` never appears) and no ambient
 *   randomness; every instant is an injected parameter; every id is
 *   content-addressed.
 * - Exact decimals on every money path (the contracts' local BigInt
 *   fixed-point kernel, pinned against the REAL kernel by the interop
 *   parity trip wire); a JS number on a money path is the typed
 *   `decimal_imprecision`.
 * - L12 tenant scoping on every record and every query; L4 at every
 *   evidence boundary (ingestion, drafting, querying); append-only +
 *   chain-verified wherever history is retained; retention NEVER
 *   deletes.
 */

// The single import surface (re-exported for the lane's consumers)
export type { OutcomesErrorCode, OutcomesError, OutcomesResult, TimestampMs } from './imports';
export { fail, failures, ok } from './imports';

// The policies
export type { ReconciliationPolicy, PostMortemDraftPolicy, DraftConfidences, RetentionPolicy } from './policy';
export {
  validateReconciliationPolicy,
  validatePostMortemDraftPolicy,
  validateRetentionPolicy,
  DEFAULT_POST_MORTEM_DRAFT_POLICY,
} from './policy';

// The mirrors (the book snapshot + the mark facts)
export type { ShadowPositionMirror, ShadowBookSnapshotMirror, MarkFactsMirror } from './book-mirror';
export { isShadowPositionMirror, isShadowBookSnapshotMirror, isMarkFactsMirror } from './book-mirror';

// The reconciliation engine
export type { SessionBinding, DeclaredExpectation, BookReconciliation, ReconcileOneInput } from './reconcile';
export { isSessionBinding, isDeclaredExpectation, reconcileAgainstBook, reconcileOne } from './reconcile';

// The state machine
export type { OutcomeLearningState, ShadowOutcomeBatch, IngestionReceipt, OutcomeFactsEntry } from './state';
export { createOutcomeLearningState, ingestShadowOutcomes, bookSnapshotDigestOf, outcomeLearningStateDigest } from './state';

// The post-mortem draft generator
export type { PostMortemDraftInputs, PostMortemDraftResult } from './postmortem';
export { generatePostMortemDrafts } from './postmortem';

// The retention laws
export type { RetentionWindow, RetentionKind } from './retention';
export { retentionWindow, withinRetentionWindow, validatedWindow } from './retention';

// The query surface
export type { OutcomeQuery, PostMortemQuery, QueryOptions } from './query';
export { queryOutcomeRecords, queryPostMortems, queryLearningHooks } from './query';

// The golden determinism constants
export {
  GOLDEN_STATE_DIGEST,
  GOLDEN_OUTCOME_LOG_HEAD,
  GOLDEN_POSTMORTEM_LOG_HEAD,
  GOLDEN_CLASSES,
  GOLDEN_ACCRUAL_DELTA,
  GOLDEN_DRAFT_COUNT,
  GOLDEN_DATA_LAG_HYPOTHESES,
  GOLDEN_MARKET_MOVE_HYPOTHESES,
  GOLDEN_MODEL_ERROR_HYPOTHESES,
} from './golden';
