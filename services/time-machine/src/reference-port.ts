/**
 * @tradrl/time-machine — the REFERENCE firewall projection port
 * (Work Order T029; T026 decision-rule mirror).
 *
 * A faithful mirror of the T026 `FirewallService` decision rule
 * (`services/knowledge-firewall/src/service.ts` — `decide()`): tenant
 * boundary FIRST (L12, disclosing nothing — null timestamps on boundary
 * entries), then the INCLUSIVE point-in-time boundary (a record is visible
 * iff `available_time <= clock.now` — visible EXACTLY at its availability
 * instant, never one millisecond earlier; origin-blind; ingestion_time is
 * never consulted), then the data-shaped filter. The audit log it produces
 * is the T026 replayable shape.
 *
 * PURPOSE: behavioral suites and wiring demos. Production wiring MUST
 * inject the REAL firewall — `@tradrl/knowledge-firewall`'s exported
 * `firewallQuery` satisfies {@link FirewallProjectionPort} structurally
 * (law D-004), and the Lead formalizes that edge at the integration
 * station. This reference port enforces the same L4/L12 laws so the
 * time-machine's own guarantees are testable end-to-end without the
 * sibling package; it is NOT a bypass of the firewall contract — it IS the
 * contract, mirrored.
 */

import { isTimestampMs } from './timestamp';
import { deepFreeze } from './freeze';
import {
  isFirewallClock,
  isFirewallProjectionPort,
  isKnowledgeBaseView,
  isTenantId,
  validateProjectionSelector,
  type FirewallAuditLog,
  type FirewallClock,
  type FirewallDecision,
  type FirewallProjectionPort,
  type FirewallQueryResult,
  type FirewallResult,
  type KnowledgeBaseView,
  type KnowledgeQueryFilter,
  type TenantId,
  type TimeMachineRecord,
} from './firewall';
import { fail } from './errors';
import type { TimestampMs } from './timestamp';

/** Does the record pass the data-shaped filter? (Assumes visibility passed.) Mirror of T026's passesFilter. */
function passesFilter(record: TimeMachineRecord, filter: KnowledgeQueryFilter): boolean {
  if (filter.ids !== undefined && filter.ids.length > 0) {
    const allowed = new Set<string>(filter.ids);
    if (!allowed.has(record.record_id)) return false;
  }
  if (filter.availableFrom !== undefined && record.available_time < filter.availableFrom) return false;
  if (filter.availableTo !== undefined && record.available_time > filter.availableTo) return false;
  return true;
}

/**
 * The firewall decision for one record — a PURE function of
 * (record, clock.now, tenant, filter). Check order is the law (T026):
 * tenant boundary first (L12, disclosing nothing), then the inclusive
 * point-in-time boundary (L4), then the filter.
 */
function decide(
  record: TimeMachineRecord,
  now: number,
  tenant: TenantId,
  filter: KnowledgeQueryFilter,
): FirewallDecision {
  if (record.tenant !== tenant) {
    return { record_id: record.record_id, decision: 'excluded', reason: 'tenant_boundary', available_time: null, now: now as TimestampMs };
  }
  if (record.available_time > now) {
    return { record_id: record.record_id, decision: 'excluded', reason: 'not_yet_available', available_time: record.available_time, now: now as TimestampMs };
  }
  if (!passesFilter(record, filter)) {
    return { record_id: record.record_id, decision: 'excluded', reason: 'filtered_out', available_time: record.available_time, now: now as TimestampMs };
  }
  return { record_id: record.record_id, decision: 'included', reason: 'visible', available_time: record.available_time, now: now as TimestampMs };
}

/**
 * The reference projection: mirror of T026's `firewallQuery`. Returns ONLY
 * the visible + tenant-scoped records (narrowed by the filter) together
 * with the decision audit log explaining, for every scanned record, why it
 * was included or excluded. Pure; deterministic; the log is replayable.
 */
export function referenceFirewallProject(
  base: KnowledgeBaseView,
  clock: FirewallClock,
  tenant: TenantId,
  filter: KnowledgeQueryFilter,
): FirewallResult<FirewallQueryResult> {
  if (!isKnowledgeBaseView(base)) {
    return { ok: false, error: { code: 'invalid_base', message: 'the knowledge base is structurally invalid' } };
  }
  if (!isFirewallClock(clock)) {
    return { ok: false, error: { code: 'invalid_clock', message: 'the firewall clock must carry a valid now instant' } };
  }
  if (!isTenantId(tenant)) {
    return { ok: false, error: { code: 'invalid_tenant', message: 'the reading tenant must be a non-empty tenant id' } };
  }
  const filterResult = validateProjectionSelector(filter);
  if (!filterResult.ok) {
    return { ok: false, error: { code: 'invalid_filter', message: filterResult.error.message } };
  }

  const now = clock.now;
  const decisions: FirewallDecision[] = [];
  const included: TimeMachineRecord[] = [];
  for (const record of base.records) {
    // Total guards: the view guard validated every record; re-assert per
    // record so hand-built views cannot slip a malformed entry through.
    const decision = decide(record, now, tenant, filter);
    decisions.push(decision);
    if (decision.decision === 'included') included.push(record);
  }

  // Copy the filter into the audit (the log must not alias the caller's input).
  const auditFilter: KnowledgeQueryFilter =
    filterResult.value.ids === undefined
      ? { ...filterResult.value }
      : { ...filterResult.value, ids: [...filterResult.value.ids] };

  return {
    ok: true,
    value: deepFreeze({
      records: Object.freeze(included),
      audit: {
        tenant,
        at: now,
        filter: auditFilter,
        scanned: base.records.length,
        decisions,
      },
    }) as FirewallQueryResult,
  };
}

/**
 * Create the reference firewall projection port. The returned object
 * satisfies {@link FirewallProjectionPort}; `project` is
 * {@link referenceFirewallProject}.
 */
export function createReferenceFirewallPort(): FirewallProjectionPort {
  const port: FirewallProjectionPort = {
    project: referenceFirewallProject,
  };
  return deepFreeze(port);
}

/** Guard: the reference port is a valid port (used by the self-check test). */
export function isReferenceFirewallPort(value: unknown): boolean {
  return isFirewallProjectionPort(value) && value.project === referenceFirewallProject;
}

/** Fail helper re-export parity for the port's error construction sites. */
export const portFail = fail;
