/**
 * @tradrl/time-machine — opaque branded identity references (Work Order T029).
 *
 * Id discipline (law D-003/D-004; mirrors @tradrl/domain-core `src/ids.ts`
 * and time-engine/knowledge `src/ids.ts`): every id is an opaque non-empty
 * string at runtime; branding is a compile-time nominal tag so distinct
 * identity spaces are not interchangeable. Identical brand strings keep the
 * mirrors mutually assignable with the owning lanes.
 *
 *   - `KnowledgeRecordId` — mirror of time-engine/knowledge (brand
 *     'TradRL.KnowledgeRecordId'), owner T026.
 *   - `TenantId`          — mirror of @tradrl/domain-core (brand 'TenantId'),
 *     owner of the isolation semantics is L12.
 *   - `DatasetRef`, `CursorId`, `ViewHash`, `SnapshotHash` — owned by THIS
 *     lane (T029) following the `TradRL.` brand convention.
 */

import { fail, ok, type TimeMachineResult } from './errors';

/** Opaque identity of a rolling dataset served by one time machine. Mirror-compatible string. */
export type DatasetRef = string & { readonly __brand: 'TradRL.DatasetRef' };

/** Opaque identity of a consumer cursor within one machine. */
export type CursorId = string & { readonly __brand: 'TradRL.CursorId' };

/** Opaque identity of a knowledge record (mirror of time-engine/knowledge, owner T026). */
export type KnowledgeRecordId = string & { readonly __brand: 'TradRL.KnowledgeRecordId' };

/** Tenant (customer firm) identity — mirror of @tradrl/domain-core (identical brand, L12). */
export type TenantId = string & { readonly __brand: 'TenantId' };

/** Deterministic lineage checksum of an AsOfView. */
export type ViewHash = string & { readonly __brand: 'TradRL.ViewHash' };

/** Deterministic lineage checksum of a TimeMachineSnapshot. */
export type SnapshotHash = string & { readonly __brand: 'TradRL.SnapshotHash' };

/** Runtime guard for a dataset reference. */
export function isDatasetRef(value: unknown): value is DatasetRef {
  return typeof value === 'string' && value.length > 0;
}

/** Runtime guard for a cursor id. */
export function isCursorId(value: unknown): value is CursorId {
  return typeof value === 'string' && value.length > 0;
}

/** Runtime guard for a knowledge-record id (mirror). */
export function isKnowledgeRecordId(value: unknown): value is KnowledgeRecordId {
  return typeof value === 'string' && value.length > 0;
}

/** Runtime guard for a tenant id (mirror). */
export function isTenantId(value: unknown): value is TenantId {
  return typeof value === 'string' && value.length > 0;
}

/** Runtime guard for a view/snapshot lineage hash (8-8 lowercase hex, dash-separated). */
export function isLineageHash(value: unknown): value is ViewHash | SnapshotHash {
  if (typeof value !== 'string' || value.length !== 17) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{8}$/.test(value);
}

/** Validating constructor for an untrusted dataset reference. */
export function datasetRef(value: string): TimeMachineResult<DatasetRef> {
  if (typeof value !== 'string' || value.length === 0) {
    return fail('invalid_config', 'a dataset reference must be a non-empty string');
  }
  return ok(value as DatasetRef);
}

/** Validating constructor for an untrusted tenant id. */
export function tenantId(value: string): TimeMachineResult<TenantId> {
  if (typeof value !== 'string' || value.length === 0) {
    return fail('invalid_config', 'a tenant id must be a non-empty string');
  }
  return ok(value as TenantId);
}

/**
 * Throwing constructors for trusted literals (tests, fixtures,
 * configuration). NOT for untrusted input — use the validating constructors.
 */
export function requireDatasetRef(value: string): DatasetRef {
  if (!isDatasetRef(value)) throw new TypeError(`requireDatasetRef: "${value}" is not a non-empty string`);
  return value as DatasetRef;
}

/** Throwing constructor for trusted tenant id literals. */
export function requireTenantId(value: string): TenantId {
  if (!isTenantId(value)) throw new TypeError(`requireTenantId: "${value}" is not a non-empty string`);
  return value as TenantId;
}

/** Throwing constructor for trusted knowledge-record id literals. */
export function requireKnowledgeRecordId(value: string): KnowledgeRecordId {
  if (!isKnowledgeRecordId(value)) throw new TypeError(`requireKnowledgeRecordId: "${value}" is not a non-empty string`);
  return value as KnowledgeRecordId;
}

/** Throwing constructor for trusted cursor id literals. */
export function requireCursorId(value: string): CursorId {
  if (!isCursorId(value)) throw new TypeError(`requireCursorId: "${value}" is not a non-empty string`);
  return value as CursorId;
}

/** Trusted-literal timestamp constructor used by fixtures and tests. */
export function requireTimestampMs(value: number): import('./timestamp').TimestampMs {
  const { isTimestampMs } = require('./timestamp') as typeof import('./timestamp');
  if (!isTimestampMs(value)) {
    throw new TypeError(`requireTimestampMs: ${value} is not a valid epoch-millisecond timestamp`);
  }
  return value;
}
