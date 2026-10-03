// @tradrl/api-service — the usage METERING ledger (R41 hooks).
//
// THE LAW (Work Order): "Usage METERING: per-tenant per-route usage
// records emitted on every request (R41 hooks — the fact surface
// T047's entitlements later enforces; record only, no enforcement)."
//
// - EVERY request — success or failure, either plane — emits exactly
//   one usage record. The record carries the acting tenant (the
//   injected tenant context of the public plane; the internal
//   request's declared scope; the internal principal's service
//   namespace when unscoped), the credential, the route family, the
//   method+path, and the response status.
// - RECORD ONLY: nothing here refuses, throttles or gates anything —
//   entitlement enforcement is T047's lane, not this boundary's.
// - DETERMINISM (L9): identical request sequences produce identical
//   metering bytes — the record ids are content-addressed over the
//   canonical content, and the ledger's per-tenant listing order is
//   the append order. Tests pin this.
//
// Spec anchors: R41 (usage accounting), L9, L12 (tenant-scoped
// records), L20.

import { canonicalJson, deepFreeze, fnv1a32Hex, isNonEmptyString, isNonNegativeSafeInteger, isPositiveSafeInteger, isRecord } from './primitives';
import type { TimestampMs } from './primitives';
import { isTimestampMs } from './primitives';
import { mintUsageRecordId, type TenantId, type UsageRecordId } from './ids';
import { isTenantId } from './ids';

// ---------------------------------------------------------------------------
// The usage record
// ---------------------------------------------------------------------------

/** One per-tenant per-route usage record — the R41 fact surface. */
export interface UsageRecord {
  /** Content-addressed identity: `usu:` + digest of the canonical content. */
  readonly usageId: UsageRecordId;
  /** The acting tenant (the injected context; internal unscoped requests use the `svc:` namespace). */
  readonly tenant: TenantId;
  /** The acting credential's id (the WHO of the usage fact). */
  readonly credentialId: string;
  /** The route family (the per-route dimension). */
  readonly route: string;
  /** The request's method and path (the observable dimension — no payload data, ever). */
  readonly method: string;
  readonly path: string;
  /** The response status (success and failure both metered). */
  readonly status: number;
  /** The request's injected instant. */
  readonly at: TimestampMs;
}

/** Guard: a usage record. */
export function isUsageRecord(v: unknown): v is UsageRecord {
  if (!isRecord(v)) return false;
  if (typeof v.usageId !== 'string' || !/^usu:[0-9a-f]{8}$/.test(v.usageId)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isNonEmptyString(v.credentialId)) return false;
  if (!isNonEmptyString(v.route)) return false;
  if (!isNonEmptyString(v.method) || !isNonEmptyString(v.path)) return false;
  if (!isNonNegativeSafeInteger(v.status)) return false;
  if (!isTimestampMs(v.at)) return false;
  return true;
}

/** The canonical content tree of a usage record (everything except the content-addressed id). */
function usageContentTree(record: Omit<UsageRecord, 'usageId'>): Record<string, unknown> {
  return {
    tenant: record.tenant,
    credentialId: record.credentialId,
    route: record.route,
    method: record.method,
    path: record.path,
    status: record.status,
    at: record.at,
  };
}

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

/**
 * The append-only usage ledger: one list per tenant namespace plus
 * the platform-wide append order. The ONLY write entry point is
 * {@link UsageLedger.record} (the pipeline calls it exactly once per
 * request, after the response is decided). No removal, no update —
 * usage facts are immutable.
 */
export class UsageLedger {
  private readonly byTenant: Map<string, UsageRecord[]> = new Map();
  private readonly all: UsageRecord[] = [];

  /** Record one usage fact (the pipeline's ONLY write path; returns the frozen record). */
  record(entry: Omit<UsageRecord, 'usageId'>): UsageRecord {
    if (!isTenantId(entry.tenant)) throw new Error('UsageLedger.record: the tenant scope is required on every usage fact (L12/R41)');
    if (!isNonEmptyString(entry.credentialId)) throw new Error('UsageLedger.record: the acting credential id is required');
    if (!isNonEmptyString(entry.route)) throw new Error('UsageLedger.record: the route family is required');
    if (!isNonEmptyString(entry.method) || !isNonEmptyString(entry.path)) throw new Error('UsageLedger.record: the method and path are required');
    if (!isNonNegativeSafeInteger(entry.status)) throw new Error('UsageLedger.record: the response status is required');
    if (!isTimestampMs(entry.at)) throw new Error('UsageLedger.record: the injected instant is required (no ambient clock)');
    const record: UsageRecord = deepFreeze({
      ...entry,
      usageId: mintUsageRecordId(fnv1a32Hex(canonicalJson(usageContentTree(entry) as never))),
    });
    const key = entry.tenant as string;
    let list = this.byTenant.get(key);
    if (list === undefined) {
      list = [];
      this.byTenant.set(key, list);
    }
    list.push(record);
    this.all.push(record);
    return record;
  }

  /** One tenant's usage records in append order (the R41 fact surface T047 reads). */
  usageOf(tenant: TenantId): readonly UsageRecord[] {
    return Object.freeze([...(this.byTenant.get(tenant as string) ?? [])]);
  }

  /** The platform-wide usage records in append order. */
  usageAll(): readonly UsageRecord[] {
    return Object.freeze([...this.all]);
  }

  /** The per-tenant per-route aggregate (the internal usage read's derivation). */
  aggregateOf(tenant: TenantId): { readonly totalRequests: number; readonly byRoute: Readonly<Record<string, number>> } {
    const byRoute: Record<string, number> = {};
    let total = 0;
    for (const record of this.byTenant.get(tenant as string) ?? []) {
      byRoute[record.route] = (byRoute[record.route] ?? 0) + 1;
      total += 1;
    }
    // Deterministic key order (the aggregate is served as JSON).
    const sorted: Record<string, number> = {};
    for (const key of Object.keys(byRoute).sort()) sorted[key] = byRoute[key];
    return deepFreeze({ totalRequests: total, byRoute: sorted });
  }

  /** The number of recorded usage facts. */
  get size(): number {
    return this.all.length;
  }
}

/** `true` when every record of a ledger listing is tenant-consistent with the listing's scope (L12). */
export function usageTenantConsistent(records: readonly UsageRecord[], tenant: TenantId): boolean {
  return records.every((record) => record.tenant === tenant);
}

/** `true` when the per-route aggregate's total equals the sum of its parts (the coherence law). */
export function usageAggregateCoherent(aggregate: { readonly totalRequests: number; readonly byRoute: Readonly<Record<string, number>> }): boolean {
  if (!isNonNegativeSafeInteger(aggregate.totalRequests)) return false;
  let sum = 0;
  for (const value of Object.values(aggregate.byRoute)) {
    if (!isPositiveSafeInteger(value)) return false;
    sum += value;
  }
  return sum === aggregate.totalRequests;
}
