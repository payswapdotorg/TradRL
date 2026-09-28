// @tradrl/agent-os — kernel-side authority scope.
//
// Spec anchors: spec/ARCHITECTURE-LOCK.md L2 (body/model separation),
// L8 (external execution authority), L16 (strategic/execution separation —
// runtime authority narrows, never widens, the body's boundary), L20 (safety
// outside prompts); spec/DOMAIN-MODEL.md ("AgentInstance: a possession
// operating for a project with authority scope, parent/manager and runtime
// state"); contracts/agent/agent-instance.md ("AuthorityScope").
//
// STRUCTURAL MIRROR — DO NOT DIVERGE. `@tradrl/agent-body` (T003) declares
// `AuthorityScope` as part of the AgentInstance contract. The kernel keeps
// its OWN copy (cross-lane types are never imported — program decision
// D-004): `KernelAuthority` re-declares the identical shape over the
// mirrored fourteen-action vocabulary. The body-side declaration is the
// SOURCE of a scope (validated against the body's boundary by T003's
// `validateAgentInstance`); the kernel-side copy is the LIVE enforcement
// record (checked by the kernel reducer on every operation).
//
// Enforcement split (L8/L20): the kernel checks ONLY the declared action
// vocabulary — "is this verb allowed for this actor?". It NEVER evaluates
// authority tokens, limits or kill-switch semantics: EXECUTE transports an
// opaque `AuthorityTokenRef` to the external execution gate, which alone
// decides (T019/T020/T034 lane).

import {
  type KernelActionName,
  isKernelActionName,
} from './actions';
import {
  deepFreeze,
  isArrayOf,
  isEnum,
  isNonNegativeInteger,
  isRecord,
} from './primitives';

/**
 * The authority granted to one live instance INSIDE the kernel. Mirrors
 * agent-body's `AuthorityScope`: `allowedActions` / `deniedActions` over the
 * fourteen kernel verbs (the body-side law guarantees the subset relation to
 * the body's declared boundary — L16), plus a delegation-depth bound.
 */
export interface KernelAuthority {
  /** Kernel actions this instance may perform (subset of the body's grant). */
  readonly allowedActions: readonly KernelActionName[];
  /** Kernel actions explicitly denied to this instance (disjoint from allowed). */
  readonly deniedActions: readonly KernelActionName[];
  /** Maximum delegation chain depth below this instance. */
  readonly maxDelegationDepth: number;
}

/** Guard: `KernelAuthority` (structural). */
export function isKernelAuthority(v: unknown): v is KernelAuthority {
  if (!isRecord(v)) return false;
  return (
    isArrayOf(v.allowedActions, isKernelActionName) &&
    isArrayOf(v.deniedActions, isKernelActionName) &&
    isNonNegativeInteger(v.maxDelegationDepth)
  );
}

/**
 * Why a `KernelAuthority` draft is semantically invalid (beyond structure):
 * allowed/denied overlap, duplicate entries, or a negative delegation depth.
 */
export const AUTHORITY_VIOLATION_CODES = [
  'authority-contradiction',
  'duplicate-action',
  'delegation-depth-negative',
] as const;

/** Kernel-authority semantic violation code. */
export type AuthorityViolationCode = (typeof AUTHORITY_VIOLATION_CODES)[number];

/** Guard: `AuthorityViolationCode`. */
export const isAuthorityViolationCode = isEnum(AUTHORITY_VIOLATION_CODES);

/**
 * Constructs a deeply frozen `KernelAuthority`, throwing `TypeError`
 * (field-prefixed) on structural or semantic invalidity. Mirrors the
 * discipline of agent-body's factories: validity by construction.
 */
export function createKernelAuthority(draft: KernelAuthority): KernelAuthority {
  const problems: string[] = [];
  if (!isKernelAuthority(draft)) {
    problems.push('authority: invalid KernelAuthority structure');
  } else {
    const allowed = new Set<string>(draft.allowedActions);
    const denied = new Set<string>(draft.deniedActions);
    for (const action of draft.allowedActions) {
      if (denied.has(action)) {
        problems.push(`allowedActions: ${action} is also denied — authority contradiction`);
        break;
      }
    }
    if (allowed.size !== draft.allowedActions.length) {
      problems.push('allowedActions: duplicate action');
    }
    if (denied.size !== draft.deniedActions.length) {
      problems.push('deniedActions: duplicate action');
    }
  }
  if (problems.length > 0) throw new TypeError(`createKernelAuthority: ${problems.join('; ')}`);
  const authority: KernelAuthority = {
    allowedActions: [...draft.allowedActions],
    deniedActions: [...draft.deniedActions],
    maxDelegationDepth: draft.maxDelegationDepth,
  };
  return deepFreeze(authority);
}

/**
 * `true` when `action` is permitted by `authority`: present in
 * `allowedActions` and absent from `deniedActions`. This is the ENTIRE
 * authority evaluation the kernel ever performs — a declarative whitelist
 * check over the fourteen verbs. Token/limit/kill-switch evaluation is
 * out-of-kernel by construction (L8/L20).
 */
export function isActionAllowed(
  authority: KernelAuthority,
  action: KernelActionName,
): boolean {
  return (
    authority.allowedActions.includes(action) &&
    !authority.deniedActions.includes(action)
  );
}
