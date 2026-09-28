// @tradrl/agent-os — kernel error taxonomy.
//
// Spec anchors: spec/ARCHITECTURE-LOCK.md L12 (tenant isolation — cross-tenant
// references are kernel errors, not silent reroutes), L8 (authority
// neutrality — no error here ever means "authority denied by evaluation";
// 'action-not-allowed' is the declarative whitelist check only).
//
// The kernel reducer is PURE: it never throws for domain violations. It
// returns errors as DATA (`KernelError` records) so operation logs, replays
// and audits stay deterministic. Factories throw `TypeError` on malformed
// INPUT (mirroring agent-body's validity-by-construction discipline); the
// reducer rejects semantically illegal operations through this taxonomy.

import { deepFreeze, isEnum, isNonEmptyString, isRecord } from './primitives';

/**
 * The kernel error taxonomy. The first six codes are the frozen taxonomy
 * from the T006 Work Order (unknown instance, cross-tenant, not subscribed,
 * circular delegation chain, duplicate op id, monotonicity violation); the
 * remainder are the structural/supervisory completions the fourteen
 * operations require.
 */
export const KERNEL_ERROR_CODES = [
  // — frozen T006 taxonomy —
  'unknown-instance',
  'cross-tenant',
  'not-subscribed',
  'circular-delegation-chain',
  'duplicate-op-id',
  'monotonicity-violation',
  // — structural / supervision completions —
  'invalid-operation',
  'invalid-delegation-chain',
  'delegation-depth-exceeded',
  'escalation-chain-mismatch',
  'manager-chain-violation',
  'action-not-allowed',
  'duplicate-instance',
] as const;

/** A kernel error code. */
export type KernelErrorCode = (typeof KERNEL_ERROR_CODES)[number];

/** Guard: `KernelErrorCode`. */
export const isKernelErrorCode = isEnum(KERNEL_ERROR_CODES);

/**
 * One kernel rejection. A pure value: `code` selects the taxonomy entry,
 * `message` explains the specific violation (always safe to log — never
 * embeds payload content, only ids and references).
 */
export interface KernelError {
  /** Taxonomy code. */
  readonly code: KernelErrorCode;
  /** Human-readable explanation (ids/references only, no payload content). */
  readonly message: string;
}

/** Guard: `KernelError`. */
export function isKernelError(v: unknown): v is KernelError {
  if (!isRecord(v)) return false;
  return isKernelErrorCode(v.code) && isNonEmptyString(v.message);
}

/** Constructs a deeply frozen `KernelError`, throwing on invalid input. */
export function kernelError(code: KernelErrorCode, message: string): KernelError {
  if (!isKernelErrorCode(code)) {
    throw new TypeError(`kernelError: unknown code ${JSON.stringify(code)}`);
  }
  if (!isNonEmptyString(message)) {
    throw new TypeError('kernelError: message must be a non-empty string');
  }
  return deepFreeze({ code, message });
}
