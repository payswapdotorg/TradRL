/**
 * @tradrl/time-machine — the rolling near-real-time Time Machine
 * (Work Order T029, reference implementation).
 *
 * Public API:
 *   - `RollingTimeMachine` / `createRollingTimeMachine` / `restoreTimeMachine` —
 *     the service: ingests canonical events (T008 ingestion shapes,
 *     mirrored), maintains the rolling window (configurable horizon,
 *     memory-bounded eviction) and serves AsOfQuery -> AsOfView.
 *   - `AsOfQuery` / `AsOfView` / `recomputeViewHash` — the point-in-time
 *     state honoring the availability quartet; every record carries its
 *     quartet; the view hash is lineage-recomputable.
 *   - `PointInTimeCursor` / `CursorDrain` — resumable consumer positions
 *     (opaque cursor id, monotone advance, replay-from-cursor determinism).
 *   - `LateArrivalPolicy` — declared reconciliation (T008 rules mirrored):
 *     recompute or quarantine; silent drop is unrepresentable.
 *   - `FirewallProjectionPort` / `createReferenceFirewallPort` — the T026
 *     projection contract (mirrored) every projection delegates to; no
 *     bypass path exists.
 *   - `TimeMachineSnapshot` — as-of state snapshot with lineage hash.
 *
 * Zero runtime dependencies; law D-004: every shared shape is a STRUCTURAL
 * MIRROR (time-engine, market-protocol, data-ingestion, knowledge-firewall)
 * — the vendored verbatim copy under `src/t026-reference/` plus
 * `src/interop.test.ts` are the drift trip wires. No wall-clock anywhere
 * (L9); visibility is ALWAYS the firewall's inclusive available_time <= T
 * boundary (L4); tenant scoping is enforced on every projection (L12).
 * See README.md for how T030 (shadow trading) and T027 (reactive world)
 * consume the cursor + as-of views.
 */

// Timestamps, durations, freezing, hashing
export type { TimestampMs } from './timestamp';
export { MIN_TIMESTAMP_MS, MAX_TIMESTAMP_MS, isTimestampMs } from './timestamp';
export type { Duration } from './duration';
export { isDuration, durationToMillis } from './duration';
export { deepFreeze, isDeeplyFrozen } from './freeze';
export { canonicalString, hashOf } from './hash';

// Errors and results
export type { TimeMachineErrorCode, TimeMachineError, TimeMachineResult } from './errors';
export { fail, ok } from './errors';

// Opaque branded identity references
export type { DatasetRef, CursorId, KnowledgeRecordId, TenantId, ViewHash, SnapshotHash } from './ids';
export {
  isDatasetRef,
  isCursorId,
  isKnowledgeRecordId,
  isTenantId,
  isLineageHash,
  datasetRef,
  tenantId,
  requireDatasetRef,
  requireTenantId,
  requireKnowledgeRecordId,
  requireCursorId,
  requireTimestampMs,
} from './ids';

// The canonical event (T008 ingestion contract mirror)
export type { CanonicalEvent, EventType, AssetClass, CanonicalEventValidation, ValidationFailure } from './canonical-event';
export {
  EVENT_TYPES,
  ASSET_CLASSES,
  isEventType,
  isAssetClass,
  isCanonicalEvent,
  validateCanonicalEvent,
  isRecord,
  isNonEmptyString,
  isNonNegativeSafeInteger,
  payloadKindOf,
} from './canonical-event';

// Provenance (T008 shapes, mirrored) + computation policy
export type {
  EventOrigin,
  AdapterRef,
  BatchRef,
  CommitRef,
  CustodyChain,
  CorrectionRef,
  IngestionProvenance,
  MachineProvenance,
} from './provenance';
export {
  EVENT_ORIGINS,
  isEventOrigin,
  isAdapterRef,
  isBatchRef,
  isCommitRef,
  isCustodyChain,
  isCorrectionRef,
  isIngestionProvenance,
  isMachineProvenance,
  validateIngestionProvenance,
} from './provenance';
export type { ComputationPolicy } from './computation';
export { isComputationPolicy } from './computation';

// The rolling-window record (firewall KnowledgeRecord mirror + arrival axis)
export type { TimeMachineRecord, AdmissionStamp } from './record';
export { isTimeMachineRecord, admitCanonicalEvent, admissionCommitIdFor, isAdmissionStamp, recordProvenanceErrors } from './record';

// The knowledge-firewall projection contract (T026 mirror) + reference port
export type {
  FirewallClock,
  KnowledgeBaseView,
  KnowledgeQueryFilter,
  KnowledgeDecisionReason,
  FirewallDecision,
  FirewallAuditLog,
  FirewallQueryResult,
  FirewallErrorCode,
  FirewallError,
  FirewallResult,
  FirewallProjectionPort,
} from './firewall';
export {
  isFirewallClock,
  isKnowledgeBaseView,
  validateProjectionSelector,
  isFirewallProjectionPort,
} from './firewall';
export { createReferenceFirewallPort, referenceFirewallProject, isReferenceFirewallPort } from './reference-port';

// The ingest clock (L9 — injected, deterministic by contract)
export type { IngestClock, DeterministicIngestClock, DeterministicClockState } from './clock';
export {
  createDeterministicIngestClock,
  isDeterministicClockState,
  nextIngestStamp,
} from './clock';

// The as-of view (point-in-time state + lineage-recomputable hash)
export type { AsOfQuery, AsOfView } from './view';
export {
  compareByAvailability,
  sortByAvailability,
  computeViewHash,
  recomputeViewHash,
} from './view';

// The machine
export type {
  TimeMachineConfig,
  LateArrivalPolicy,
  IngestDispositionKind,
  IngestDisposition,
  EvictionReason,
  EvictionNotice,
  WindowStats,
  IngestReceipt,
  QuarantinedEvent,
  RejectionRecord,
  CursorOptions,
  PointInTimeCursor,
  CursorDrain,
  MachineStats,
  RollingTimeMachine,
  RestoreDependencies,
} from './machine';
export {
  isTimeMachineConfig,
  createRollingTimeMachine,
  restoreTimeMachine,
} from './machine';

// Snapshot/restore
export type { TimeMachineSnapshot, IngestClockDescriptor, CursorSnapshotEntry } from './snapshot';
export { SNAPSHOT_KIND, sealSnapshot, validateTimeMachineSnapshot } from './snapshot';

/** Package identity and ownership (Work Order T029). */
export const packageInfo = {
  name: '@tradrl/time-machine',
  owner: 'T029',
  status: 'implemented',
} as const;
