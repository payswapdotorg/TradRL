// @tradrl/observability_service — historical telemetry queries: the
// asOf discipline + the WHO/WHICH filter surface.
//
// THE LAW (the Work Order; spec/ARCHITECTURE-LOCK.md L4 —
// point-in-time truth: "observations and derived features obey
// information availability time"): `queryTelemetry(log, { tenant,
// project, asOf, kinds?, actorKinds?, actors?, seamKinds? })`
// returns ONLY records with `recordedAt <= asOf` — INCLUSIVE at the
// boundary (a record recorded at EXACTLY `asOf` IS returned; a record
// 1ms PAST `asOf` is NOT returned). The query carries the REQUESTING
// scope, which must equal the log's scope (L12 — reading another
// tenant's log is inexpressible: the typed `tenant_missing` error,
// both directions). Results are returned in SEQUENCE order (the log's
// append order) and are deeply frozen.
//
// THE FILTER SURFACE (the Work Order's query surface, completed):
//   - `kinds`      — filter by record kind (metric | trace-span | log);
//   - `actorKinds` — filter by WHO's kind (principal | agent-instance |
//                    service | operator);
//   - `actors`     — filter by exact actor matches (kind AND ref);
//   - `seamKinds`  — filter by WHICH merged seam the record observes.
// Every filter is OPTIONAL (absent = unconstrained), validated with
// typed errors, and composable with the asOf discipline.

import {
  fail,
  isTelemetryActor,
  isTelemetryActorKind,
  isTelemetryKind,
  isTimestampMs,
  isObservedSeamKind,
  ok,
  type ObservabilityResult,
  type ObservedSeamKind,
  type ProjectId,
  type TelemetryActor,
  type TelemetryActorKind,
  type TelemetryKind,
  type TelemetryRecord,
  type TenantId,
  type TimestampMs,
} from '../../../packages/observability/src/index';
import { isProjectId, isTenantId } from '../../../packages/observability/src/index';
import { isTelemetryLog, type TelemetryLog } from './log';

/** A point-in-time telemetry query (L4 + L12 + the WHO/WHICH filter surface). */
export interface TelemetryQuery {
  /** The REQUESTING tenant scope — must equal the log's (L12). */
  readonly tenant: TenantId;
  /** The REQUESTING project scope — must equal the log's (L15). */
  readonly project: ProjectId;
  /** The point-in-time bound: only records with recordedAt <= asOf are returned (INCLUSIVE). */
  readonly asOf: TimestampMs;
  /** Optional kind filter (absent = every kind). */
  readonly kinds?: readonly TelemetryKind[];
  /** Optional actor-kind filter (absent = actors of every kind). */
  readonly actorKinds?: readonly TelemetryActorKind[];
  /** Optional exact-actor filter — a record matches when its actor equals one of these (kind AND ref; absent = every actor). */
  readonly actors?: readonly TelemetryActor[];
  /** Optional observed-seam-kind filter (absent = every seam kind). */
  readonly seamKinds?: readonly ObservedSeamKind[];
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
  if (query.actorKinds !== undefined) {
    if (!Array.isArray(query.actorKinds) || !query.actorKinds.every((kind) => isTelemetryActorKind(kind))) return false;
  }
  if (query.actors !== undefined) {
    if (!Array.isArray(query.actors) || !query.actors.every((actor) => isTelemetryActor(actor))) return false;
  }
  if (query.seamKinds !== undefined) {
    if (!Array.isArray(query.seamKinds) || !query.seamKinds.every((kind) => isObservedSeamKind(kind))) return false;
  }
  return true;
}

/**
 * Query one telemetry log's history as of an explicit instant (L4 —
 * INCLUSIVE bound): only records with `recordedAt <= asOf` are
 * returned, in sequence order, optionally filtered by kind, by actor
 * (kind and/or exact actor) and by observed-seam kind. The query's
 * scope must equal the log's scope — a cross-scope query is the typed
 * `tenant_missing` error (L12, both directions).
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
  if (query.actorKinds !== undefined && (!Array.isArray(query.actorKinds) || !query.actorKinds.every((kind) => isTelemetryActorKind(kind)))) {
    return fail('invalid_field', 'queryTelemetry actorKinds must be an array of principal | agent-instance | service | operator', 'actorKinds');
  }
  if (query.actors !== undefined && (!Array.isArray(query.actors) || !query.actors.every((actor) => isTelemetryActor(actor)))) {
    return fail('invalid_field', 'queryTelemetry actors must be an array of { kind, ref } actor references', 'actors');
  }
  if (query.seamKinds !== undefined && (!Array.isArray(query.seamKinds) || !query.seamKinds.every((kind) => isObservedSeamKind(kind)))) {
    return fail('invalid_field', 'queryTelemetry seamKinds must be an array of the five observed seam kinds', 'seamKinds');
  }
  if (query.tenant !== log.tenant || query.project !== log.project) {
    return fail(
      'tenant_missing',
      `the query's scope (${query.tenant}/${query.project}) does not match the log's (${log.tenant}/${log.project}) — telemetry logs are tenant-isolated (L12)`,
    );
  }
  const kinds = query.kinds === undefined ? null : new Set<string>(query.kinds);
  const actorKinds = query.actorKinds === undefined ? null : new Set<string>(query.actorKinds);
  const actors = query.actors === undefined ? null : new Set<string>(query.actors.map((actor) => `${actor.kind}\u0000${actor.ref}`));
  const seamKinds = query.seamKinds === undefined ? null : new Set<string>(query.seamKinds);
  const results = log.records.filter((record) => {
    if (record.recordedAt > query.asOf) return false; // INCLUSIVE: recordedAt === asOf passes
    if (kinds !== null && !kinds.has(record.kind)) return false;
    if (actorKinds !== null && !actorKinds.has(record.actor.kind)) return false;
    if (actors !== null && !actors.has(`${record.actor.kind}\u0000${record.actor.ref}`)) return false;
    if (seamKinds !== null && !seamKinds.has(record.seam.kind)) return false;
    return true;
  });
  return ok(Object.freeze([...results]));
}
