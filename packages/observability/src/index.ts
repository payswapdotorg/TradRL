/**
 * @tradrl/observability — the observability contract package (Work
 * Order T043): the operational visibility layer's TYPED records.
 *
 * Spec anchors — spec/ARCHITECTURE.md (the planes this layer
 * OBSERVES: Experience/Control/Data/Execution), spec/ARCHITECTURE
 * -LOCK.md L4 (explicit recordedAt — the point-in-time law),
 * L9 (byte-determinism), L12 (tenant isolation), L15 (lineage-
 * complete records), L20 (the opacity trip wire in code, not
 * prompts); spec/SECURITY.md Secrets + Tenant isolation.
 *
 * Public API:
 *   - Structural primitives — the shared contract vocabulary
 *     (branding, hand-rolled guards, deep-freeze discipline, JSON
 *     model, canonical JSON, stable FNV-1a digests, TimestampMs)
 *     mirrored from @tradrl/execution-authority (T040) law-for-law.
 *   - Ids — the identity spaces owned here (the 'tel:' telemetry
 *     record id, the 'pau:' platform-audit record id) plus the
 *     opaque cross-lane mirrors (tenant, project, T040's 'xga:'
 *     gateway-audit id — the complement join key).
 *   - The credential-opacity trip wire — `credentialValueViolations`
 *     (the T019/T040 mirror): a credential VALUE anywhere in ANY
 *     record this package emits is the typed
 *     `credential_value_present` error.
 *   - The seam mirrors — the four merged seams this layer observes
 *     (agent-os MessageEnvelope/KernelOperation, execution-authority
 *     GatewayAuditRecord, control-plane ProjectAuditEntry, event-
 *     store StorableEvent) plus the ObservedSeamRef identity
 *     projection and its derivation helpers.
 *   - The TelemetryRecord union — metric | trace-span | log; tenant/
 *     project-scoped, actor-ref'd, seam-ref'd, explicitly
 *     recordedAt'd, content-addressed; canonical serialization
 *     (byte-stable) and collect-all validation.
 *
 * The TelemetryLog (the append-only, chain-verified log), the
 * collector (injected instants/sinks) and the asOf query live in
 * services/observability; the PlatformAuditRecord chain lives in
 * services/audit — both consume this package via relative source
 * imports (the services/execution-gateway precedent; zero
 * lockfile-touching workspace edges).
 *
 * Zero runtime dependencies; types, schemas and pure functions only.
 * No ambient clock (`Date.now()` never appears) and no ambient
 * randomness. Cross-lane shapes are STRUCTURAL MIRRORS (D-003/D-004)
 * — never imports; src/interop.test.ts is the drift trip wire.
 */

// Errors and results
export type { ObservabilityErrorCode, ObservabilityError, ObservabilityResult } from './errors';
export { errorOf, fail, failures, ok, missingField, invalidField, invalidType, isObservabilityError } from './errors';

// Structural primitives
export type { Brand, Mutable, JsonValue, JsonObject, TimestampMs } from './primitives';
export {
  isRecord,
  isNonEmptyString,
  isFiniteNumber,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
  isMemberOf,
  isArrayOf,
  deepFreeze,
  isDeeplyFrozen,
  isJsonValue,
  isJsonObject,
  canonicalJson,
  fnv1a32Hex,
  fnv1a32Int,
  stableDigest,
  isDigest,
  MIN_TIMESTAMP_MS,
  MAX_TIMESTAMP_MS,
  isTimestampMs,
} from './primitives';

// Ids and opaque cross-lane references
export type { TelemetryRecordId, PlatformAuditRecordId, TenantId, ProjectId, GatewayAuditRecordId } from './ids';
export {
  isTelemetryRecordId,
  isPlatformAuditRecordId,
  isTenantId,
  isProjectId,
  isGatewayAuditRecordId,
  mintTelemetryRecordId,
  mintPlatformAuditRecordId,
} from './ids';

// The credential-opacity trip wire
export { CREDENTIAL_VALUE_KEYS, isCredentialValueKey, credentialValueViolations } from './credentials';

// The seam mirrors (the four merged seams, D-004)
export type {
  MessageEnvelopeMirror,
  KernelActionNameMirror,
  KernelAuthorityMirror,
  ReportSummaryMirror,
  KernelOperationBaseMirror,
  SpawnOperationMirror,
  TerminateOperationMirror,
  DelegateOperationMirror,
  RequestOperationMirror,
  PublishOperationMirror,
  SubscribeOperationMirror,
  ChallengeOperationMirror,
  ProposeOperationMirror,
  ApproveOperationMirror,
  ExecuteOperationMirror,
  EscalateOperationMirror,
  ObserveOperationMirror,
  LearnOperationMirror,
  ReportOperationMirror,
  KernelOperationMirror,
  AuditWhoWhatMirror,
  AuditVisibleStateMirror,
  AuditRiskChecksMirror,
  AuditOrderBlockMirror,
  AuditExecutionBlockMirror,
  AuditRefusalSummaryMirror,
  ExecutionLineageRecordMirror,
  GatewayAuditRecordMirror,
  ProjectAuditOperationKindMirror,
  ProjectAuditOperationMirror,
  ProjectLineageMirror,
  ProjectAuditEntryMirror,
  EventTypeMirror,
  AssetClassMirror,
  EventOriginMirror,
  StorableProvenanceMirror,
  StorableEventMirror,
  ObservedSeamKind,
  ObservedSeamRef,
} from './seams';
export {
  KERNEL_ACTION_NAMES_MIRROR,
  isKernelActionNameMirror,
  isKernelAuthorityMirror,
  isReportSummaryMirror,
  isMessageEnvelopeMirror,
  isKernelOperationMirror,
  isAuditWhoWhatMirror,
  isAuditVisibleStateMirror,
  isAuditRiskChecksMirror,
  isAuditOrderBlockMirror,
  isAuditExecutionBlockMirror,
  isAuditRefusalSummaryMirror,
  isExecutionLineageRecordMirror,
  isGatewayAuditRecordMirror,
  PROJECT_AUDIT_OPERATION_KINDS_MIRROR,
  isProjectAuditOperationKindMirror,
  isProjectLineageMirror,
  isProjectAuditEntryMirror,
  EVENT_TYPES_MIRROR,
  isEventTypeMirror,
  ASSET_CLASSES_MIRROR,
  isAssetClassMirror,
  isStorableEventMirror,
  OBSERVED_SEAM_KINDS,
  isObservedSeamKind,
  isObservedSeamRef,
  seamRefOfEnvelope,
  seamRefOfOperation,
  seamRefOfGatewayAudit,
  seamRefOfProjectAuditEntry,
  seamRefOfStorableEvent,
} from './seams';

// The telemetry record contract
export type {
  TelemetryActorKind,
  TelemetryActor,
  TelemetryKind,
  TelemetryLogLevel,
  TelemetrySpanStatus,
  TelemetryRecordBase,
  MetricTelemetryRecord,
  TraceSpanTelemetryRecord,
  LogTelemetryRecord,
  TelemetryRecord,
  TelemetryRecordContent,
} from './telemetry';
export {
  TELEMETRY_ACTOR_KINDS,
  isTelemetryActorKind,
  isTelemetryActor,
  TELEMETRY_KINDS,
  isTelemetryKind,
  TELEMETRY_LOG_LEVELS,
  isTelemetryLogLevel,
  TELEMETRY_SPAN_STATUSES,
  isTelemetrySpanStatus,
  isTelemetryName,
  isTelemetryMessage,
  isTelemetryUnit,
  seamScopeViolation,
  telemetryRecordContentTree,
  canonicalTelemetryContentJson,
  validateTelemetryRecord,
  isTelemetryRecord,
  telemetryRecordTreeOf,
  freezeTelemetryRecord,
} from './telemetry';

/** Package identity and ownership (governance surface). */
export const packageInfo = {
  name: '@tradrl/observability',
  owner: 'T043',
  status: 'implemented',
  concepts: [
    'TelemetryRecord',
    'ObservedSeamRef',
    'credentialValueViolations',
    'seamScopeViolation',
    'seamMirrors',
  ],
} as const;
