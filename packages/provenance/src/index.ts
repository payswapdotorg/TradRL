/**
 * @tradrl/provenance — store-level lineage contracts for the data plane.
 *
 * Public API:
 *   - `ProvenanceRecord` — the store-level provenance record: a structural
 *     MIRROR + EXTENSION of @tradrl/market-protocol's `Provenance` block
 *     (origin trichotomy, adapter reference, `derived_from` lineage,
 *     `transform`) plus the store-layer extensions: `corrections`
 *     (amendment refs) and `custody` (adapter -> ingestion batch -> store
 *     commit). Law D-004: structural mirrors only, never imports.
 *   - `DerivationChain` — `validateDerivationChain` (acyclic, no
 *     self-reference, no duplicate parents), `chainDepth`,
 *     `resolveRoots`, `ancestorsOf`.
 *   - `CorrectionRecord` — append-only amendments; corrections never mutate
 *     history; `latestCorrectionStatus` computes the current belief per
 *     event as a view over the correction log.
 *   - `CustodyChain` — the L9 lineage backbone for the data plane.
 *   - Hand-rolled total guards for every record; `deepFreeze`; typed
 *     errors (`ProvenanceError`, collect-all validation, `ProvenanceResult`
 *     for queries).
 *   - `TimestampMs` — structural mirror of @tradrl/time-engine (canonical
 *     owner), the same mirror discipline market-protocol follows.
 *
 * Zero runtime dependencies; types, schemas and pure functions only.
 * `src/interop.test.ts` is the cross-package trip wire against
 * @tradrl/market-protocol and @tradrl/time-engine (the repo's established
 * relative-import test pattern) and also hosts the behavioral suites for
 * the reference implementations `@tradrl/event-store` and
 * `@tradrl/data-ingestion`, keeping every T008 test inside the frozen
 * `pnpm verify` gate (root vitest/tsconfig include patterns cover
 * `packages/**` only).
 */

// Errors and results
export type {
  ProvenanceErrorCode,
  ProvenanceError,
  ProvenanceValidation,
  ProvenanceResult,
} from './errors';
export { fail, ok } from './errors';

// Timestamp mirror (canonical owner: @tradrl/time-engine)
export type { TimestampMs } from './timestamp';
export { MIN_TIMESTAMP_MS, MAX_TIMESTAMP_MS, isTimestampMs } from './timestamp';

// Identifiers and shared field guards
export type {
  EventId,
  CommitId,
  BatchId,
  CorrectionId,
  AdapterId,
  AdapterVersion,
  LineageId,
  TransformId,
  CorrectionReason,
} from './fields';
export {
  isRecord,
  isNonEmptyString,
  isNonNegativeSafeInteger,
  isNonEmptyStringArray,
  missingField,
  invalidField,
} from './fields';

// JSON value model (amendment payloads)
export type { JsonValue, JsonObject } from './json';
export { isJsonValue, isJsonObject } from './json';

// Deep freezing
export type { DeepFrozen } from './freeze';
export { deepFreeze } from './freeze';

// Custody chain
export type { AdapterRef, BatchRef, CommitRef, CustodyChain } from './custody';
export {
  isAdapterRef,
  isBatchRef,
  isCommitRef,
  isCustodyChain,
  validateAdapterRef,
  validateCustodyChain,
  commitRefOf,
  batchRefOf,
  adapterRefOf,
} from './custody';

// Store-level provenance record
export type { EventOrigin, CorrectionRef, ProvenanceRecord } from './provenance';
export {
  EVENT_ORIGINS,
  isEventOrigin,
  validateProvenanceRecord,
  isProvenanceRecord,
  isSyntheticRecord,
  recordOrigin,
} from './provenance';

// Derivation chains
export type { ChainNode, ChainViolation, ChainValidation } from './chain';
export {
  isChainNode,
  validateDerivationChain,
  ancestorsOf,
  resolveRoots,
  chainDepth,
} from './chain';

// Corrections
export type { CorrectionInput, CorrectionRecord, CorrectionStatus } from './correction';
export {
  isCorrectionId,
  validateCorrectionInput,
  validateCorrectionRecord,
  isCorrectionInput,
  isCorrectionRecord,
  latestCorrectionStatus,
  correctionIds,
  hasCorrectionId,
} from './correction';

/** Package identity and ownership (Work Order T008). */
export const packageInfo = {
  name: '@tradrl/provenance',
  owner: 'T008',
  status: 'implemented',
} as const;
