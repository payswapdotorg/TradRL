/**
 * @tradrl/knowledge-firewall — public API (Work Order T026, reference
 * implementation of the point-in-time knowledge firewall service).
 *
 * Two layers:
 *   - mirrors.ts — zero-dependency structural mirrors of the
 *     @tradrl/time-engine knowledge contracts (D-004 discipline, identical
 *     brands, trip-wired by interop.test.ts).
 *   - service.ts — the FirewallService: clock-policed, tenant-scoped
 *     queries with a REPLAYABLE decision audit log, typed single-record
 *     reads, audit replay/verification, and the service wrapper.
 *
 * fixtures.ts wires the reference implementation to the real time-engine
 * knowledge module (integration wiring — see its header note and README.md).
 */

// Structural mirrors of the knowledge contracts (zero-dependency, D-004).
export type {
  TimestampMs,
  KnowledgeRecordId,
  TenantId,
  Duration,
  ComputationPolicy,
  KnowledgeOrigin,
  AdapterRef,
  CorrectionRef,
  BatchRef,
  CommitRef,
  CustodyChain,
  KnowledgeProvenance,
  KnowledgeRecord,
  KnowledgeBaseView,
  FirewallClock,
  KnowledgeQueryFilter,
  FirewallErrorCode,
  FirewallError,
  FirewallResult,
} from './mirrors';
export {
  MIN_TIMESTAMP_MS,
  MAX_TIMESTAMP_MS,
  isTimestampMs,
  isKnowledgeRecordId,
  isTenantId,
  isDuration,
  isComputationPolicy,
  isKnowledgeOrigin,
  isAdapterRef,
  isCorrectionRef,
  isBatchRef,
  isCommitRef,
  isCustodyChain,
  isFirewallProvenance,
  isFirewallRecord,
  isKnowledgeBaseView,
  isFirewallClock,
  validateKnowledgeQueryFilter,
  deepFreeze,
  fail,
  ok,
} from './mirrors';

// The firewall service.
export type {
  KnowledgeDecisionReason,
  FirewallDecision,
  FirewallAuditLog,
  FirewallQueryResult,
  FirewallReplayMismatch,
  FirewallReplayReport,
  FirewallService,
} from './service';
export {
  firewallQuery,
  firewallGetRecord,
  replayFirewallAudit,
  verifyFirewallAudit,
  createFirewallService,
} from './service';

// Fixture scenarios (integration wiring to the real knowledge module).
export type {
  CleanKnowledgeGraphFixture,
  LeakyKnowledgeGraphFixture,
  TenantIsolationFixture,
} from './fixtures';
export {
  cleanKnowledgeGraph,
  leakyKnowledgeGraph,
  tenantIsolationScenario,
  crossTenantDerivation,
  firewallClockAt,
  ids,
} from './fixtures';

/** Service identity and ownership (Work Order T026). */
export const serviceInfo = {
  name: '@tradrl/knowledge-firewall',
  owner: 'T026',
  status: 'implemented',
} as const;
