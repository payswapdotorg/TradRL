/**
 * @tradrl/time-engine/knowledge — opaque branded identity references.
 *
 * Id discipline (mirrors @tradrl/domain-core `src/ids.ts`, D-003/D-004):
 * - Every id is an opaque non-empty string at runtime; branding is a
 *   compile-time nominal tag so distinct identity spaces are not
 *   interchangeable (verified by type-level tests in `interop.test.ts`).
 * - `TenantId` is a STRUCTURAL MIRROR of @tradrl/domain-core's declaration
 *   (`Brand<string, 'TenantId'>`): identical brand string, so the two
 *   declarations are mutually assignable and the cross-package interop test
 *   is the drift trip-wire. The frozen lockfile forbids a package edge.
 * - `KnowledgeRecordId` is owned by this lane (T026) and follows the
 *   time-engine brand convention (`TradRL.` prefix).
 */

import { fail, ok, type KnowledgeResult } from './errors';

/**
 * Opaque identity of a knowledge record within a KnowledgeBase. The format
 * (prefix, uuid, ulid, ...) is decided by the creating lane/service; these
 * contracts only require an opaque non-empty string.
 */
export type KnowledgeRecordId = string & { readonly __brand: 'TradRL.KnowledgeRecordId' };

/**
 * Tenant (customer firm) identity — STRUCTURAL MIRROR of
 * `@tradrl/domain-core`'s `TenantId` (identical brand, mutual assignability;
 * isolation semantics per ARCHITECTURE-LOCK L12, owned by the tenant lane).
 */
export type TenantId = string & { readonly __brand: 'TenantId' };

/** Runtime type guard for a knowledge-record id. */
export function isKnowledgeRecordId(value: unknown): value is KnowledgeRecordId {
  return typeof value === 'string' && value.length > 0;
}

/** Runtime type guard for a tenant id. */
export function isTenantId(value: unknown): value is TenantId {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validating constructor for an untrusted knowledge-record id string.
 * Returns a typed error instead of throwing.
 */
export function knowledgeRecordId(value: string): KnowledgeResult<KnowledgeRecordId> {
  if (typeof value !== 'string' || value.length === 0) {
    return fail('invalid_record', 'a knowledge record id must be a non-empty string');
  }
  return ok(value as KnowledgeRecordId);
}

/** Validating constructor for an untrusted tenant id string. */
export function tenantId(value: string): KnowledgeResult<TenantId> {
  if (typeof value !== 'string' || value.length === 0) {
    return fail('invalid_record', 'a tenant id must be a non-empty string');
  }
  return ok(value as TenantId);
}

/**
 * Throwing constructor for trusted literals (tests, fixtures, configuration).
 * NOT for untrusted input — use {@link knowledgeRecordId} there.
 */
export function requireKnowledgeRecordId(value: string): KnowledgeRecordId {
  const result = knowledgeRecordId(value);
  if (result.ok) return result.value;
  throw new TypeError(`requireKnowledgeRecordId: ${result.error.message}`);
}

/** Throwing constructor for trusted tenant id literals. */
export function requireTenantId(value: string): TenantId {
  const result = tenantId(value);
  if (result.ok) return result.value;
  throw new TypeError(`requireTenantId: ${result.error.message}`);
}
