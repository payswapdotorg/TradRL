/**
 * @tradrl/event-store — the append-only event store (reference implementation).
 *
 * Public API:
 *   - `createEventStore` — an in-memory append-only store: `commit(events,
 *     batch)` (atomic, typed rejections) and `appendCorrections` (append-only
 *     amendments); pure reads: `getEvent`, `getProvenanceRecord`, `events`,
 *     `corrections`, `query` (point-in-time windows on `available_time`),
 *     `lineageOf`, `correctionStatus`, `commitLog`, `snapshot`, `stats`.
 *   - `replayCommitLog` — deterministic rebuild from the commit log
 *     (identical state; tampered logs are rejected with typed errors).
 *   - `StorableEvent` / `StoredEvent` — the envelope mirror of
 *     @tradrl/market-protocol's `MarketEvent` (availability quartet; the
 *     store stamps `ingestion_time` at commit).
 *   - Sequence discipline (mirror of T004's `SequenceTracker` /
 *     `validateSequenceMonotonicity` semantics), provenance input mirror,
 *     corrections with stamped custody.
 *   - `createDeterministicCommitClock` — the injectable commit clock; the
 *     ONLY source of nondeterminism, deterministic by default.
 *
 * APPEND-ONLY: there is no API that can mutate committed history (see
 * README.md — the structural test and the doc statement).
 *
 * Zero runtime dependencies. Law D-004: the contract shapes are STRUCTURAL
 * MIRRORS of @tradrl/market-protocol and @tradrl/provenance — never
 * imports; `packages/provenance/src/interop.test.ts` is the trip wire.
 */

// Timestamp mirror (canonical owner: @tradrl/time-engine)
export type { TimestampMs } from './timestamp';
export { MIN_TIMESTAMP_MS, MAX_TIMESTAMP_MS, isTimestampMs } from './timestamp';

// Identifiers, guards, store-level error taxonomy
export type {
  EventId,
  VenueId,
  InstrumentId,
  ProviderId,
  LineageId,
  CommitId,
  BatchId,
  CorrectionId,
  StoreErrorCode,
  StoreError,
} from './fields';
export {
  isRecord,
  isNonEmptyString,
  isNonNegativeSafeInteger,
  missingField,
  invalidField,
  invalidType,
} from './fields';

// Taxonomy mirror
export type { EventType, AssetClass } from './taxonomy';
export { EVENT_TYPES, ASSET_CLASSES, isEventType, isAssetClass } from './taxonomy';

// JSON value model
export type { JsonValue, JsonObject } from './json';
export { isJsonValue, isJsonObject, deepFreezeJson } from './json';

// Provenance at the store boundary
export type {
  EventOrigin,
  AdapterRef,
  BatchRef,
  CommitRef,
  CustodyChain,
  StorableProvenance,
  StoredProvenance,
  CorrectionRef,
  EventProvenanceRecord,
} from './provenance';
export {
  EVENT_ORIGINS,
  isEventOrigin,
  isAdapterRef,
  isStorableProvenance,
  validateStorableProvenance,
  validateCustodyChain,
  isSyntheticEvent,
  eventOrigin,
} from './provenance';

// Sequence discipline (mirror of T004)
export type { SequenceStream, SequenceKey, SequencedEvent, SequenceViolation, SequenceValidation, StreamSequencer } from './sequence';
export {
  payloadKindOf,
  sequenceStreamOf,
  sequenceKeyOf,
  validateBatchSequences,
  createStreamSequencer,
  checkSequence,
} from './sequence';

// Event envelope
export type { StorableEvent, StoredEvent } from './event';
export { validateStorableEvent, isStorableEvent, checkDerivedAvailability, lineageOf } from './event';

// Corrections
export type { StorableCorrection, StoredCorrection } from './correction';
export { validateStorableCorrection, isStorableCorrection, validateStoredCorrection, isStoredCorrection } from './correction';

// The store
export type {
  BatchMeta,
  CommitReceipt,
  CorrectionCommitReceipt,
  StoreRejectionCode,
  StoreCommitError,
  CommitResult,
  CorrectionCommitResult,
  CommitClock,
  EventStoreConfig,
  EventQueryFilter,
  LineageView,
  CorrectionStatusView,
  StoreSnapshot,
  CommitLogEntry,
  ReplayResult,
  StoreStats,
  EventStore,
} from './store';
export {
  createEventStore,
  replayCommitLog,
  createDeterministicCommitClock,
  commitIdFor,
} from './store';

/** Package identity and ownership (Work Order T008). */
export const packageInfo = {
  name: '@tradrl/event-store',
  owner: 'T008',
  status: 'implemented',
} as const;
