/**
 * @tradrl/time-machine — the knowledge-firewall projection contract
 * (Work Order T029; T026 mirror).
 *
 * THE FIREWALL IS THE AUTHORITY (spec/ARCHITECTURE-LOCK L4 + the T029 work
 * order): every as-of projection — every route by which a record leaves the
 * rolling window toward a consumer — passes through the knowledge
 * firewall's projection contract. There is NO bypass path: the machine
 * holds no API that hands out window records except (a) projections routed
 * through an injected {@link FirewallProjectionPort}, (b) snapshot/restore
 * (operator state transfer, documented as such — not a consumer
 * observation plane) and (c) the declared exception queues (quarantine /
 * rejections — T008 DLQ-shaped operator evidence, never as-of state).
 *
 * This module re-declares, as STRUCTURAL MIRRORS (law D-004 — the frozen
 * lockfile forbids the workspace edge; the vendored verbatim copy
 * `src/t026-reference/mirrors.ts` + `src/interop.test.ts` are the drift trip
 * wires), exactly the T026 shapes the projection needs:
 *
 *   - `FirewallClock`              — the minimal clock contract (`now`).
 *   - `KnowledgeQueryFilter`       — the serializable, replayable filter.
 *   - `FirewallDecision` / `FirewallAuditLog` — the replayable decision log.
 *   - `FirewallQueryResult`        — records + audit.
 *   - `FirewallErrorCode` / `FirewallResult` — the firewall's typed failure space.
 *   - `FirewallProjectionPort`     — the projection surface `@tradrl/knowledge-firewall`'s
 *                                    exported `firewallQuery(kb, clock, tenant, filter)`
 *                                    satisfies STRUCTURALLY (no import, no dependency).
 *
 * The port is deliberately a FUNCTION over the base: the rolling window is
 * rebuilt on every ingest (copy-on-append), so a service bound to one fixed
 * base cannot serve it; T026's free `firewallQuery` is the exact shape.
 */

import { isTimestampMs, type TimestampMs } from './timestamp';
import { fail, ok, type TimeMachineResult } from './errors';
import { isKnowledgeRecordId, type KnowledgeRecordId, type TenantId } from './ids';
import { isTimeMachineRecord, type TimeMachineRecord } from './record';

/** Minimal clock contract: the firewall decision needs exactly `now`. Mirror of T026. */
export interface FirewallClock {
  readonly now: TimestampMs;
}

/** Read surface of a knowledge base passed to the firewall. Mirror of T026 KnowledgeBaseView. */
export interface KnowledgeBaseView {
  readonly records: readonly TimeMachineRecord[];
  readonly size: number;
}

/**
 * A serializable query filter narrowing the visible+tenant-scoped slice
 * further. Data-shaped BY DESIGN (mirror of T026): the audit log records it
 * verbatim so the replay pass can re-derive every decision from the log alone.
 */
export interface KnowledgeQueryFilter {
  /** Restrict to these record ids (when present). */
  readonly ids?: readonly KnowledgeRecordId[];
  /** Only records with available_time >= this instant (when present). */
  readonly availableFrom?: TimestampMs;
  /** Only records with available_time <= this instant (when present). */
  readonly availableTo?: TimestampMs;
}

/** Why a record was included or excluded. Mirror of T026. */
export type KnowledgeDecisionReason = 'visible' | 'not_yet_available' | 'tenant_boundary' | 'filtered_out';

/** The decision for ONE scanned record: included or excluded, and why. Mirror of T026. */
export interface FirewallDecision {
  readonly record_id: KnowledgeRecordId;
  readonly decision: 'included' | 'excluded';
  readonly reason: KnowledgeDecisionReason;
  /**
   * The record's available_time — recorded for every NON-boundary entry so
   * the replay pass can re-derive the decision. NULL iff the reason is
   * `tenant_boundary` (L12: another tenant's timing is never disclosed).
   */
  readonly available_time: TimestampMs | null;
  /** The clock instant the decision was made at. */
  readonly now: TimestampMs;
}

/**
 * The replayable decision audit log: the query's (tenant, clock instant,
 * filter) plus one decision per scanned record, in base order. Deeply
 * frozen — audit logs are evidence, not scratch space. Mirror of T026.
 */
export interface FirewallAuditLog {
  readonly tenant: TenantId;
  readonly at: TimestampMs;
  readonly filter: KnowledgeQueryFilter;
  readonly scanned: number;
  readonly decisions: readonly FirewallDecision[];
}

/** The query outcome: the visible+tenant-scoped records plus the audit log. Mirror of T026. */
export interface FirewallQueryResult {
  readonly records: readonly TimeMachineRecord[];
  readonly audit: FirewallAuditLog;
}

/**
 * The firewall's own typed failure space, mirrored (T026 FirewallErrorCode):
 * the machine wraps any port failure as `firewall_rejected` with the port's
 * code embedded verbatim in the message — the firewall stays the authority.
 */
export type FirewallErrorCode =
  | 'invalid_clock'
  | 'invalid_tenant'
  | 'invalid_filter'
  | 'invalid_base'
  | 'tenant_isolation'
  | 'unknown_record'
  | 'not_yet_available';

/** A single typed firewall failure. Mirror of T026. */
export interface FirewallError {
  readonly code: FirewallErrorCode;
  readonly message: string;
}

/** Explicit firewall success/failure result. Mirror of T026. */
export type FirewallResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: FirewallError };

// ---------------------------------------------------------------------------
// Hand-rolled guards (mirror of the T026 mirror discipline).
// ---------------------------------------------------------------------------

/** Runtime type guard for a firewall clock. */
export function isFirewallClock(value: unknown): value is FirewallClock {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return isTimestampMs(candidate.now);
}

/** Runtime type guard for a structurally valid base view (records + size). */
export function isKnowledgeBaseView(value: unknown): value is KnowledgeBaseView {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.records)) return false;
  if (typeof candidate.size !== 'number' || !Number.isSafeInteger(candidate.size) || candidate.size < 0) return false;
  if (candidate.size !== candidate.records.length) return false;
  for (const record of candidate.records) {
    if (!isTimeMachineRecord(record)) return false;
  }
  return true;
}

/**
 * Validate a filter (mirror of T026's validateKnowledgeQueryFilter —
 * identical rules): ids non-empty and duplicate-free, bounds valid,
 * from <= to. Returns the machine's typed result (invalid_query).
 */
export function validateProjectionSelector(value: unknown): TimeMachineResult<KnowledgeQueryFilter> {
  if (typeof value !== 'object' || value === null) {
    return fail('invalid_query', 'the projection selector must be an object');
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.ids !== undefined) {
    if (!Array.isArray(candidate.ids)) {
      return fail('invalid_query', 'selector.ids must be an array of record ids');
    }
    const seen = new Set<string>();
    for (const id of candidate.ids) {
      if (!isKnowledgeRecordId(id)) {
        return fail('invalid_query', 'every selector.ids entry must be a non-empty record id');
      }
      if (seen.has(id)) {
        return fail('invalid_query', `duplicate selector id "${id}"`);
      }
      seen.add(id);
    }
  }
  if (candidate.availableFrom !== undefined && !isTimestampMs(candidate.availableFrom)) {
    return fail('invalid_query', 'selector.availableFrom must be a valid epoch-millisecond timestamp');
  }
  if (candidate.availableTo !== undefined && !isTimestampMs(candidate.availableTo)) {
    return fail('invalid_query', 'selector.availableTo must be a valid epoch-millisecond timestamp');
  }
  if (
    candidate.availableFrom !== undefined &&
    candidate.availableTo !== undefined &&
    (candidate.availableFrom as number) > (candidate.availableTo as number)
  ) {
    return fail('invalid_query', 'selector.availableFrom may not exceed selector.availableTo');
  }
  return ok(candidate as KnowledgeQueryFilter);
}

// ---------------------------------------------------------------------------
// The projection port — the ONLY route from the window to a consumer.
// ---------------------------------------------------------------------------

/**
 * The knowledge-firewall projection port. `@tradrl/knowledge-firewall`'s
 * exported `firewallQuery(kb, clock, tenant, filter)` satisfies this
 * interface STRUCTURALLY (law D-004): the Lead wires the real firewall at
 * integration; behavioral suites may use the documented reference port
 * (`src/reference-port.ts`), which mirrors the T026 decision rule.
 *
 * A machine constructed WITHOUT a port can ingest but every projection
 * (asOf, cursor drains) is a TYPED `firewall_required` error — there is no
 * fallback direct-store-read path, by construction and by test.
 */
export interface FirewallProjectionPort {
  /**
   * Project one base through the firewall at one instant for one tenant:
   * returns ONLY the visible + tenant-scoped records (narrowed by the
   * filter) together with the replayable decision audit log.
   */
  project(base: KnowledgeBaseView, clock: FirewallClock, tenant: TenantId, filter: KnowledgeQueryFilter): FirewallResult<FirewallQueryResult>;
}

/** Runtime guard for the port shape (an object exposing a project function). */
export function isFirewallProjectionPort(value: unknown): value is FirewallProjectionPort {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).project === 'function'
  );
}
