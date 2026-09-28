/**
 * @tradrl/data-ingestion — the ingestion pipeline (reference implementation).
 *
 * Public API:
 *   - `ProviderAdapter<Raw>` — the provider-NEUTRAL adapter interface
 *     (L13/L14): `discover()` / `fetch(batch)` / `normalize(raw)` —
 *     vendor specifics live ONLY in adapter implementations.
 *   - `createIngestionPipeline` — adapter -> validate (quartet +
 *     sequence + provenance) -> batch -> commit to the event store,
 *     through a STRUCTURAL commit port (`EventCommitPort`) that
 *     `@tradrl/event-store` satisfies without any package dependency.
 *   - Dead-letter queue: `deadLetters()` / `deadLetterReport()` — every
 *     rejected record with a typed reason; nothing is silently dropped.
 *   - `CanonicalEvent` — the envelope mirror of market-protocol's
 *     `MarketEvent` (availability quartet; `ingestion_time` advisory on
 *     input — the store stamps it at commit).
 *   - Example adapters: `createSyntheticTickAdapter` and
 *     `createSyntheticNewsAdapter` — deterministic, network-free streams
 *     used by the behavioral suites.
 *
 * Zero runtime dependencies. Law D-004: the contract shapes are STRUCTURAL
 * MIRRORS of @tradrl/market-protocol and @tradrl/event-store — never
 * imports; `packages/provenance/src/interop.test.ts` and
 * `packages/provenance/src/data-ingestion.test.ts` are the trip wires.
 * See README.md for how T009 (replay world), T026 (firewall) and T036
 * (adapter SDK) consume this plane.
 */

// Timestamp mirror (canonical owner: @tradrl/time-engine)
export type { TimestampMs } from './timestamp';
export { MIN_TIMESTAMP_MS, MAX_TIMESTAMP_MS, isTimestampMs } from './timestamp';

// Identifiers, guards, ingestion error taxonomy
export type { IngestionErrorCode, ValidationFailure, EventId, VenueId, InstrumentId, ProviderId, LineageId, BatchId, AdapterId, AdapterVersion } from './fields';
export {
  isRecord,
  isNonEmptyString,
  isNonNegativeSafeInteger,
  isNonEmptyStringArray,
  missingField,
  invalidField,
  invalidType,
  sequenceViolation,
} from './fields';

// Taxonomy mirror
export type { EventType, AssetClass } from './taxonomy';
export { EVENT_TYPES, ASSET_CLASSES, isEventType, isAssetClass } from './taxonomy';

// Provenance at the ingest boundary
export type { EventOrigin, AdapterRef, IngestionProvenance } from './provenance';
export { EVENT_ORIGINS, isEventOrigin, isAdapterRef, isIngestionProvenance, validateIngestionProvenance, isSyntheticEvent } from './provenance';

// Sequence pre-check (mirror of T004)
export type { SequenceStream, SequenceKey, SequencedEvent, SequenceViolation, SequenceValidation } from './sequence';
export { payloadKindOf, sequenceStreamOf, sequenceKeyOf, validateBatchSequences } from './sequence';

// Canonical event (envelope mirror)
export type { CanonicalEvent, CanonicalEventValidation } from './canonical-event';
export { validateCanonicalEvent, isCanonicalEvent, lineageOf } from './canonical-event';

// Provider adapter interface
export type { AdapterDescriptor, FetchBatch, DiscoveryReport, FetchResult, NormalizationError, NormalizeResult, ProviderAdapter } from './adapter';

// Dead-letter queue
export type { StoreRejectionDetail, StoreRejectionError, DeadLetter, DeadLetterKind, DeadLetterReport } from './dlq';
export { deadLetterReportOf } from './dlq';

// Pipeline
export type {
  CommitPortReceipt,
  CommitPortError,
  CommitPortResult,
  CommitPortBatch,
  EventCommitPort,
  BatchIngestionReport,
  IngestionSummary,
  IngestionPipeline,
  IngestionPipelineConfig,
} from './pipeline';
export { createIngestionPipeline } from './pipeline';

// Example adapters (deterministic fixtures)
export type { SyntheticTickRecord, SyntheticVwapRecord, SyntheticTickRaw } from './adapters/synthetic-tick';
export { createSyntheticTickAdapter } from './adapters/synthetic-tick';
export type { SyntheticNewsRecord } from './adapters/synthetic-news';
export { createSyntheticNewsAdapter } from './adapters/synthetic-news';

/** Package identity and ownership (Work Order T008). */
export const packageInfo = {
  name: '@tradrl/data-ingestion',
  owner: 'T008',
  status: 'implemented',
} as const;
