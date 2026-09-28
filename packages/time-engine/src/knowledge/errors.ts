/**
 * @tradrl/time-engine/knowledge — typed errors and results for the knowledge
 * firewall (Work Order T026).
 *
 * The knowledge lane is a NEW subtree inside @tradrl/time-engine; the
 * pre-existing `src/errors.ts` (owned by T004) is read-only to T026, so this
 * module declares the knowledge error space. It deliberately EXTENDS the
 * time-engine error vocabulary instead of paralleling it: every
 * {@link TimeErrorCode} is also a {@link KnowledgeErrorCode}, so shared
 * semantics (`invalid_policy`, `no_inputs`, `derived_before_inputs`, ...) keep
 * one spelling across the two layers, while knowledge-specific codes
 * (tenant isolation, append identity, ...) extend the union — the same
 * discipline market-protocol applied versus time-engine for its own codes.
 *
 * Like every TradRL contract module: never throw for untrusted input; return
 * an explicit typed result. Throwing is reserved for programming errors
 * internal to a caller.
 */

import type { TimeErrorCode } from '../errors';

/**
 * Machine-readable failure codes for knowledge-firewall operations.
 * Extends the time-engine codes with the knowledge-layer laws:
 * L4 propagation, L9 lineage resolution and L12 tenant isolation.
 */
export type KnowledgeErrorCode =
  | TimeErrorCode
  /** A value is not a structurally valid KnowledgeRecord (guard failed). */
  | 'invalid_record'
  /** The provenance block violates the mirrored provenance rules (T008 shapes). */
  | 'invalid_provenance'
  /** `available_time` precedes `event_time` — quartet ordering (D-003). */
  | 'timestamp_order'
  /** A parent record id does not resolve in the knowledge base. */
  | 'unknown_input'
  /** A record id is not present in the knowledge base. */
  | 'unknown_record'
  /** A record id is already present — append-only identity. */
  | 'duplicate_record'
  /** Cross-tenant read or derivation (L12 — tenant isolation). */
  | 'tenant_isolation'
  /** A derived record (non-empty inputs) carries no computation policy. */
  | 'derived_without_policy'
  /** A computation policy is present without knowledge lineage (empty inputs). */
  | 'policy_without_lineage';

/** A single typed knowledge-firewall failure. */
export interface KnowledgeError {
  readonly code: KnowledgeErrorCode;
  readonly message: string;
}

/** Explicit success/failure result. No exceptions for data-driven failures. */
export type KnowledgeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: KnowledgeError };

/** Construct a knowledge-firewall failure result. */
export function fail<T = never>(code: KnowledgeErrorCode, message: string): KnowledgeResult<T> {
  return { ok: false, error: { code, message } };
}

/** Construct a knowledge-firewall success result. */
export function ok<T>(value: T): KnowledgeResult<T> {
  return { ok: true, value };
}
