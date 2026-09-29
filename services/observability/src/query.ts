// @tradrl/observability_service — historical telemetry queries: the
// asOf discipline.
//
// THE LAW (the Work Order; spec/ARCHITECTURE-LOCK.md L4 —
// point-in-time truth: "observations and derived features obey
// information availability time"): `queryTelemetry(log, { tenant,
// project, asOf, kinds? })` returns ONLY records with `recordedAt <=
// asOf` — INCLUSIVE at the boundary (a record recorded at EXACTLY
// `asOf` IS returned; a record at `asOf - 1`-visible instants is
// filtered by the same law; a record 1ms PAST `asOf` is NOT
// returned). The query carries the REQUESTING scope, which must equal
// the log's scope (L12 — reading another tenant's log is
// inexpressible: the typed `tenant_missing` error, both directions).
// Results are returned in SEQUENCE order (the log's append order).
//
// The `kinds` filter is optional; absent means "every kind".

import {
  fail,
  isTelemetryKind,
  isTimestampMs,
  ok,
  type ObservabilityResult,
  type ProjectId,
  type TelemetryKind,
  type TelemetryRecord,
  type TenantId,
  type TimestampMs,
} from '../../../packages/observability/src/index';
import { isProjectId, isTenantId } from '../../../packages/observability/src/index';
import { isTelemetryLog, type TelemetryLog } from './log';

/** A point-in-time telemetry query (L4 + L12). */
export interface TelemetryQuery {
  /** The REQUESTING tenant scope — must equal the log's (L12). */
  readonly tenant: TenantId;
  /** The REQUESTING project scope — must equal the log's (L15). */
  readonly project: ProjectId;
  /** The point-in-time bound: only records with recordedAt <= asOf are returned (INCLUSIVE). */
  readonly asOf: TimestampMs;
  /** Optional kind filter (absent = every kind). */
  readonly kinds?: readonly TelemetryKind[];
}

/** Guard: `TelemetryQuery` (structural). */
export function isTelemetryQuery(v: unknown): v is TelemetryQuery {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const query = v as Record<string, unknown>;
  if (!isTenantId(query.tenant)) return false;
  if (!isProjectId(query.project)) return false;
  if (!isTimestampMs(query.asOf)) return false;
  if (query.kinds !== undefined) {
    if (!Array.isArray(query.kinds) || !query.kinds.every((kind) => isTelemetryKind(kind))) return false;
  }
  return true;
}

/**
 * Query one telemetry log's history as of an explicit instant (L4 —
 * INCLUSIVE bound): only records with `recordedAt <= asOf` are
 * returned, in sequence order, optionally filtered by kind. The
 * query's scope must equal the log's scope — a cross-scope query is
 * the typed `tenant_missing` error (L12, both directions: the
 * requesting scope may neither read another scope's log nor be read
 * from one).
 */
export function queryTelemetry(log: TelemetryLog, query: TelemetryQuery): ObservabilityResult<readonly TelemetryRecord[]> {
  if (!isTelemetryLog(log)) {
    return fail('invalid_type', 'queryTelemetry requires a valid telemetry log');
  }
  if (!isTenantId(query.tenant) || !isProjectId(query.project)) {
    return fail('tenant_missing', 'queryTelemetry requires a tenant/project scope (L12)');
  }
  if (!isTimestampMs(query.asOf)) {
    return fail('invalid_field', 'queryTelemetry requires a valid asOf instant (L4 — the explicit point-in-time bound)', 'asOf');
  }
  if (query.kinds !== undefined && (!Array.isArray(query.kinds) || !query.kinds.every((kind) => isTelemetryKind(kind)))) {
    return fail('invalid_field', 'queryTelemetry kinds must be an array of metric | trace-span | log', 'kinds');
  }
  if (query.tenant !== log.tenant || query.project !== log.project) {
    return fail(
      'tenant_missing',
      `the query's scope (${query.tenant}/${query.project}) does not match the log's (${log.tenant}/${log.project}) — telemetry logs are tenant-isolated (L12)`,
    );
  }
  const kinds = query.kinds === undefined ? null : new Set<string>(query.kinds);
  const results = log.records.filter((record) => {
    if (record.recordedAt > query.asOf) return false; // INCLUSIVE: recordedAt === asOf passes
    if (kinds !== null && !kinds.has(record.kind)) return false;
    return true;
  });
  return ok(Object.freeze([...results]));
}
