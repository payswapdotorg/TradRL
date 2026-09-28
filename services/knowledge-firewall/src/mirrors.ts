/**
 * @tradrl/knowledge-firewall — structural mirrors of the knowledge contracts
 * (Work Order T026, service layer).
 *
 * D-004 (ratified cross-lane type-sharing pattern): contract packages stay
 * zero-dependency; shared shapes use STRUCTURAL MIRRORS + interop trip-wire
 * tests. This service is zero-dependency by the same discipline — the frozen
 * lockfile forbids a workspace edge — so it re-declares the knowledge
 * contracts it consumes, field-for-field, with IDENTICAL brand strings:
 *
 *   - `TimestampMs`       — mirror of @tradrl/time-engine (brand 'TradRL.TimestampMs').
 *   - `KnowledgeRecordId` — mirror of time-engine/knowledge (brand 'TradRL.KnowledgeRecordId').
 *   - `TenantId`          — mirror of @tradrl/domain-core (brand 'TenantId').
 *   - `KnowledgeRecord` / `KnowledgeBaseView` — mirrors of time-engine/knowledge
 *     records and bases (a real KnowledgeBase is structurally assignable to
 *     the view and vice versa).
 *   - `KnowledgeProvenance` (+ `CustodyChain`, `CorrectionRef`, ...) — mirror
 *     of time-engine/knowledge's provenance, which is itself the verbatim
 *     T008 `ProvenanceRecord` shape (see
 *     packages/time-engine/src/knowledge/t008-reference/ for the vendored
 *     reference copy; the reference bundle was re-provisioned by the Lead
 *     and the mirror is trip-wired against it — the earlier dispatch-time
 *     deviation is RESOLVED).
 *   - `FirewallClock`     — minimal clock contract; the real SimulationClock
 *     satisfies it structurally (it has `now`).
 *
 * `src/interop.test.ts` is the trip wire: if any declaration drifts from the
 * time-engine/knowledge contracts (or the T008 shapes they mirror), the
 * type-level assertions fail `pnpm typecheck` and the runtime parity checks
 * fail `pnpm test`.
 */

/** A validated epoch-millisecond timestamp (brand is compile-time only). */
export type TimestampMs = number & { readonly __brand: 'TradRL.TimestampMs' };

/** Opaque knowledge-record identity (mirror of time-engine/knowledge). */
export type KnowledgeRecordId = string & { readonly __brand: 'TradRL.KnowledgeRecordId' };

/** Tenant identity (mirror of @tradrl/domain-core — identical brand). */
export type TenantId = string & { readonly __brand: 'TenantId' };

/** A non-negative span of time (mirror of time-engine Duration). */
export interface Duration {
  readonly milliseconds?: number;
  readonly seconds?: number;
  readonly minutes?: number;
  readonly hours?: number;
  readonly days?: number;
}

/** How derived knowledge was computed (mirror of time-engine ComputationPolicy). */
export interface ComputationPolicy {
  readonly transform_id: string;
  readonly delay: Duration;
}

/** Where knowledge came from (mirror of the origin trichotomy). */
export type KnowledgeOrigin = 'historical' | 'simulated' | 'generated';

/** Producing adapter reference (mirror). */
export interface AdapterRef {
  readonly id: string;
  readonly version: string;
}

/** An amendment reference issued against a record (mirror of T008's CorrectionRef). */
export interface CorrectionRef {
  readonly correction_id: string;
  readonly reason: string;
}

/** The ingestion-batch hop of the custody chain (mirror of T008's BatchRef). */
export interface BatchRef {
  readonly batch_id: string;
}

/**
 * The store-commit hop of the custody chain (mirror of T008's CommitRef):
 * commit sequences are positive (the first commit is 1); the ingestion
 * timestamp is stamped at commit.
 */
export interface CommitRef {
  readonly commit_id: string;
  readonly commit_sequence: number;
  readonly ingestion_time: TimestampMs;
}

/**
 * The custody chain: adapter -> ingestion batch -> store commit (mirror of
 * T008's CustodyChain).
 */
export interface CustodyChain {
  readonly adapter: AdapterRef | null;
  readonly batch: BatchRef;
  readonly commit: CommitRef;
}

/**
 * Provenance block (mirror of time-engine/knowledge's KnowledgeProvenance —
 * the verbatim T008 `ProvenanceRecord` shape: the market-protocol block plus
 * the store-layer extension, corrections + custody).
 */
export interface KnowledgeProvenance {
  readonly origin: KnowledgeOrigin;
  readonly adapter: AdapterRef | null;
  readonly derived_from: readonly string[];
  readonly transform: string | null;
  /** Amendment refs issued against this record (append-only; a query-time view). */
  readonly corrections: readonly CorrectionRef[];
  /** adapter -> ingestion batch -> store commit. */
  readonly custody: CustodyChain;
}

/**
 * One unit of knowledge policed by the firewall (mirror of
 * time-engine/knowledge KnowledgeRecord — the availability quartet, the
 * knowledge-graph lineage, the computation policy, the tenant, the
 * provenance reference and the opaque payload).
 */
export interface KnowledgeRecord {
  readonly record_id: KnowledgeRecordId;
  readonly tenant: TenantId;
  readonly payload: unknown;
  readonly event_time: TimestampMs;
  readonly source_time: TimestampMs | null;
  readonly available_time: TimestampMs;
  readonly ingestion_time: TimestampMs;
  readonly inputs: readonly KnowledgeRecordId[];
  readonly computation: ComputationPolicy | null;
  readonly provenance: KnowledgeProvenance;
}

/** Read surface of a knowledge base (a real KnowledgeBase is assignable). */
export interface KnowledgeBaseView {
  readonly records: readonly KnowledgeRecord[];
  readonly size: number;
}

/** Minimal clock contract: the firewall decision needs exactly `now`. */
export interface FirewallClock {
  readonly now: TimestampMs;
}

// ---------------------------------------------------------------------------
// Errors (the service's own typed failure space).
// ---------------------------------------------------------------------------

/** Machine-readable failure codes for firewall-service operations. */
export type FirewallErrorCode =
  /** The clock is structurally invalid (now is not a TimestampMs). */
  | 'invalid_clock'
  /** The tenant id is invalid. */
  | 'invalid_tenant'
  /** The query filter is invalid (bad ids, bad bounds, from > to). */
  | 'invalid_filter'
  /** The knowledge base is structurally invalid. */
  | 'invalid_base'
  /** Cross-tenant single-record read (L12). */
  | 'tenant_isolation'
  /** The requested record id is not present. */
  | 'unknown_record'
  /** The record exists and belongs to the tenant but is not yet visible. */
  | 'not_yet_available';

/** A single typed firewall-service failure. */
export interface FirewallError {
  readonly code: FirewallErrorCode;
  readonly message: string;
}

/** Explicit success/failure result. No exceptions for data-driven failures. */
export type FirewallResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: FirewallError };

/** Construct a firewall failure result. */
export function fail<T = never>(code: FirewallErrorCode, message: string): FirewallResult<T> {
  return { ok: false, error: { code, message } };
}

/** Construct a firewall success result. */
export function ok<T>(value: T): FirewallResult<T> {
  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// Hand-rolled guards (total: every firewall input is validated).
// ---------------------------------------------------------------------------

/** Timestamp bounds — mirror of time-engine (the Unix epoch .. max Date). */
export const MIN_TIMESTAMP_MS = 0;
export const MAX_TIMESTAMP_MS = 8_639_999_999_999_999;

/** Runtime type guard for a validated epoch-millisecond timestamp. */
export function isTimestampMs(value: unknown): value is TimestampMs {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= MIN_TIMESTAMP_MS &&
    value <= MAX_TIMESTAMP_MS
  );
}

/** Runtime type guard for a knowledge-record id. */
export function isKnowledgeRecordId(value: unknown): value is KnowledgeRecordId {
  return typeof value === 'string' && value.length > 0;
}

/** Runtime type guard for a tenant id. */
export function isTenantId(value: unknown): value is TenantId {
  return typeof value === 'string' && value.length > 0;
}

/** Runtime type guard for a structurally valid Duration (mirror). */
export function isDuration(value: unknown): value is Duration {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  for (const key of ['milliseconds', 'seconds', 'minutes', 'hours', 'days'] as const) {
    const component = candidate[key];
    if (component !== undefined && !(typeof component === 'number' && Number.isFinite(component) && component >= 0)) return false;
    if (component === undefined && key in candidate) return false;
  }
  return true;
}

/** Runtime type guard for a computation policy (mirror). */
export function isComputationPolicy(value: unknown): value is ComputationPolicy {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.transform_id === 'string' && candidate.transform_id.length > 0 && isDuration(candidate.delay);
}

/** Runtime type guard for the origin discriminator. */
export function isKnowledgeOrigin(value: unknown): value is KnowledgeOrigin {
  return typeof value === 'string' && (['historical', 'simulated', 'generated'] as readonly string[]).includes(value);
}

/** Runtime type guard for an adapter reference (mirror of T008's isAdapterRef). */
export function isAdapterRef(value: unknown): value is AdapterRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.version === 'string' &&
    candidate.version.length > 0
  );
}

/** Runtime type guard for a correction reference. */
export function isCorrectionRef(value: unknown): value is CorrectionRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.correction_id === 'string' &&
    candidate.correction_id.length > 0 &&
    typeof candidate.reason === 'string' &&
    candidate.reason.length > 0
  );
}

/** Runtime type guard for a batch reference (mirror of T008's isBatchRef). */
export function isBatchRef(value: unknown): value is BatchRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.batch_id === 'string' && candidate.batch_id.length > 0;
}

/**
 * Runtime type guard for a commit reference (mirror of T008's isCommitRef):
 * commit sequences are positive safe integers — the first commit is 1.
 */
export function isCommitRef(value: unknown): value is CommitRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.commit_id !== 'string' || candidate.commit_id.length === 0) return false;
  if (typeof candidate.commit_sequence !== 'number' || !Number.isSafeInteger(candidate.commit_sequence) || candidate.commit_sequence < 1) {
    return false;
  }
  return isTimestampMs(candidate.ingestion_time);
}

/** Runtime type guard for a custody chain (mirror of T008's isCustodyChain). */
export function isCustodyChain(value: unknown): value is CustodyChain {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.adapter !== null && !isAdapterRef(candidate.adapter)) return false;
  return isBatchRef(candidate.batch) && isCommitRef(candidate.commit);
}

/**
 * Runtime type guard for a provenance block (structural mirror of
 * time-engine/knowledge's isKnowledgeProvenance — the verbatim T008
 * `isProvenanceRecord` discipline, store-layer extension included).
 */
export function isFirewallProvenance(value: unknown): value is KnowledgeProvenance {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (!isKnowledgeOrigin(candidate.origin)) return false;
  if (candidate.adapter !== null && !isAdapterRef(candidate.adapter)) return false;
  if (!Array.isArray(candidate.derived_from)) return false;
  if (!candidate.derived_from.every((parent) => typeof parent === 'string' && parent.length > 0)) return false;
  if (typeof candidate.transform !== 'string' || candidate.transform.length === 0) {
    if (candidate.transform !== null) return false;
  }
  if (candidate.origin === 'historical' && candidate.adapter === null) return false;
  const derived = candidate.derived_from.length > 0;
  if (derived && (typeof candidate.transform !== 'string' || candidate.transform.length === 0)) return false;
  if (!derived && candidate.transform !== null) return false;
  if (!Array.isArray(candidate.corrections)) return false;
  if (!candidate.corrections.every((ref) => isCorrectionRef(ref))) return false;
  return isCustodyChain(candidate.custody);
}

/** A payload is opaque but must be JSON-representable. */
function isOpaquePayload(value: unknown): boolean {
  if (value === null) return true;
  const kind = typeof value;
  return kind === 'object' || kind === 'boolean' || kind === 'number' || kind === 'string';
}

/**
 * Runtime type guard for a structurally valid knowledge record (mirror of
 * time-engine/knowledge's isKnowledgeRecord: quartet ordering, lineage
 * self-consistency, computation-iff-inputs, provenance shape).
 */
export function isFirewallRecord(value: unknown): value is KnowledgeRecord {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (!isKnowledgeRecordId(candidate.record_id)) return false;
  if (!isTenantId(candidate.tenant)) return false;
  if (!isOpaquePayload(candidate.payload)) return false;
  if (!isTimestampMs(candidate.event_time)) return false;
  if (candidate.source_time !== null && !isTimestampMs(candidate.source_time)) return false;
  if (!isTimestampMs(candidate.available_time)) return false;
  if (!isTimestampMs(candidate.ingestion_time)) return false;
  if ((candidate.available_time as number) < (candidate.event_time as number)) return false;
  if (!Array.isArray(candidate.inputs)) return false;
  const seen = new Set<string>();
  for (const input of candidate.inputs) {
    if (!isKnowledgeRecordId(input)) return false;
    if (input === candidate.record_id) return false;
    if (seen.has(input)) return false;
    seen.add(input);
  }
  const derived = candidate.inputs.length > 0;
  if (derived && !isComputationPolicy(candidate.computation)) return false;
  if (!derived && candidate.computation !== null) return false;
  if (!isFirewallProvenance(candidate.provenance)) return false;
  return true;
}

/** Runtime type guard for a structurally valid base view. */
export function isKnowledgeBaseView(value: unknown): value is KnowledgeBaseView {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.records)) return false;
  if (typeof candidate.size !== 'number' || !Number.isSafeInteger(candidate.size) || candidate.size < 0) return false;
  if (candidate.size !== candidate.records.length) return false;
  for (const record of candidate.records) {
    if (!isFirewallRecord(record)) return false;
  }
  return true;
}

/** Runtime type guard for a firewall clock. */
export function isFirewallClock(value: unknown): value is FirewallClock {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return isTimestampMs(candidate.now);
}

// ---------------------------------------------------------------------------
// The query filter (data-shaped — serializable, therefore replayable).
// ---------------------------------------------------------------------------

/**
 * A serializable query filter narrowing the visible+tenant-scoped slice
 * further. Data-shaped BY DESIGN: the audit log records it verbatim so the
 * replay pass can re-derive every decision from the log alone.
 */
export interface KnowledgeQueryFilter {
  /** Restrict to these record ids (when present). */
  readonly ids?: readonly KnowledgeRecordId[];
  /** Only records with available_time >= this instant (when present). */
  readonly availableFrom?: TimestampMs;
  /** Only records with available_time <= this instant (when present). */
  readonly availableTo?: TimestampMs;
}

/** Validate a filter: ids non-empty and duplicate-free, bounds valid, from <= to. */
export function validateKnowledgeQueryFilter(value: KnowledgeQueryFilter): FirewallResult<KnowledgeQueryFilter> {
  if (typeof value !== 'object' || value === null) {
    return fail('invalid_filter', 'filter must be an object');
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.ids !== undefined) {
    if (!Array.isArray(candidate.ids)) {
      return fail('invalid_filter', 'filter.ids must be an array of record ids');
    }
    const seen = new Set<string>();
    for (const id of candidate.ids) {
      if (!isKnowledgeRecordId(id)) {
        return fail('invalid_filter', 'every filter.ids entry must be a non-empty record id');
      }
      if (seen.has(id)) {
        return fail('invalid_filter', `duplicate filter id "${id}"`);
      }
      seen.add(id);
    }
  }
  if (candidate.availableFrom !== undefined && !isTimestampMs(candidate.availableFrom)) {
    return fail('invalid_filter', 'filter.availableFrom must be a valid epoch-millisecond timestamp');
  }
  if (candidate.availableTo !== undefined && !isTimestampMs(candidate.availableTo)) {
    return fail('invalid_filter', 'filter.availableTo must be a valid epoch-millisecond timestamp');
  }
  if (
    candidate.availableFrom !== undefined &&
    candidate.availableTo !== undefined &&
    (candidate.availableFrom as number) > (candidate.availableTo as number)
  ) {
    return fail('invalid_filter', 'filter.availableFrom may not exceed filter.availableTo');
  }
  return ok(value);
}

// ---------------------------------------------------------------------------
// Deep freezing (mirror of the knowledge-subtree discipline: results are
// immutable — audit logs are evidence, not scratch space).
// ---------------------------------------------------------------------------

/** Deeply freeze a value: every reachable plain object and array. */
export function deepFreeze<T>(value: T): T {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== 'object' || Object.isFrozen(current)) continue;
    Object.freeze(current);
    if (Array.isArray(current)) {
      for (const item of current) {
        if (item !== null && typeof item === 'object') stack.push(item);
      }
    } else {
      for (const key of Object.keys(current)) {
        const child: unknown = (current as Record<string, unknown>)[key];
        if (child !== null && typeof child === 'object') stack.push(child);
      }
    }
  }
  return value;
}
