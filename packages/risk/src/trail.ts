// @tradrl/risk — the RiskPolicyTrail: the append-only policy-evolution
// trail (L11).
//
// THE L11 LAW (spec/ARCHITECTURE-LOCK.md L11: "Search integrity:
// optimization history is retained to expose selection effects"; the
// Work Order: "policy evolution is an append-only trail (superseded
// versions retained with structured reasons; rewriting history = typed
// error)"): a risk policy is IMMUTABLE — a change is a NEW VERSION.
// The trail retains EVERY version with the structured reason it was
// superseded for; there is no removal, update or reordering entry
// point anywhere in this module.
//
// THE CHAIN (the rewrite trip wire — the kill-switch discipline of
// T019, mirrored): every entry carries an FNV-1a chain head binding
// its content to everything before it
// (`fnv(prevHead + canonical(entryContent))`), and
// {@link verifyRiskPolicyTrail} recomputes the chain from the entries
// themselves. A trail whose history was SPLICED (a superseded version
// removed), EDITED (a reason changed) or TRUNCATED fails with the
// typed `policy_history_rewrite`. Illegal versioning (appending a
// policy that does not supersede the head, or version numbers that are
// not contiguous) is the same crime.
//
// L9/L12: every entry carries the policy's own lineage (goal,
// constraint set, tenant, project — the policy record carries them);
// the trail is scoped to one tenant/project and entries from another
// scope are inexpressible.
//
// Spec anchors: spec/ARCHITECTURE-LOCK.md L9, L11, L12.

import { deepFreeze, isNonEmptyString, isPositiveSafeInteger, isRecord, isTimestampMs, type JsonValue, type TimestampMs } from './primitives';
import { canonicalJson, fnv1a32Hex } from './primitives';
import type { RiskPolicy } from './policy';
import { isRiskPolicy, policyContentTree } from './policy';
import type { ProjectId, TenantId } from './ids';
import { isProjectId, isTenantId } from './ids';
import {
  type RiskResult,
  fail,
  invalidType,
  ok,
} from './errors';

// ---------------------------------------------------------------------------
// The trail entries
// ---------------------------------------------------------------------------

/**
 * One append-only trail entry: the policy version, the STRUCTURED
 * reason it exists (null iff the genesis version — a first version
 * needs no supersession reason), the append instant, and the chain
 * head binding it to everything before it.
 */
export interface RiskPolicyTrailEntry {
  readonly policy: RiskPolicy;
  /** Why this version superseded the previous one (null iff version 1). */
  readonly reason: string | null;
  /** The append instant (epoch ms; an explicit parameter, never a clock read). */
  readonly appendedAt: TimestampMs;
  /** The chain head: `fnv(prevHead + canonical(entryContent))`. */
  readonly chainHead: string;
}

/** Guard: `RiskPolicyTrailEntry` (structural). */
export function isRiskPolicyTrailEntry(v: unknown): v is RiskPolicyTrailEntry {
  if (!isRecord(v)) return false;
  if (!isRiskPolicy(v.policy)) return false;
  const policy = v.policy;
  if (policy.version === 1) {
    if (v.reason !== null) return false; // the genesis carries no supersession reason
  } else if (!isNonEmptyString(v.reason)) {
    return false; // every later version carries a structured reason
  }
  if (!isTimestampMs(v.appendedAt)) return false;
  if (typeof v.chainHead !== 'string' || !/^[0-9a-f]{8}$/.test(v.chainHead)) return false;
  return true;
}

/**
 * The append-only policy-evolution trail: every version of one
 * tenant/project scope's risk policy, in order, superseded versions
 * RETAINED (L11). Created with the genesis policy; grown ONLY through
 * {@link appendRiskPolicy} (the supersede path); verified through
 * {@link verifyRiskPolicyTrail}.
 */
export interface RiskPolicyTrail {
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly entries: readonly RiskPolicyTrailEntry[];
}

/** Guard: `RiskPolicyTrail` (structural). */
export function isRiskPolicyTrail(v: unknown): v is RiskPolicyTrail {
  if (!isRecord(v)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  if (!Array.isArray(v.entries) || !v.entries.every((entry) => isRiskPolicyTrailEntry(entry))) return false;
  return v.entries.length > 0; // a trail always carries its genesis
}

// ---------------------------------------------------------------------------
// The chain (the rewrite trip wire)
// ---------------------------------------------------------------------------

/** The canonical JSON tree of an entry's CONTENT (everything except `chainHead`). */
function entryContentTree(entry: Omit<RiskPolicyTrailEntry, 'chainHead'>): JsonValue {
  return {
    policy: policyContentTree(entry.policy),
    reason: entry.reason,
    appendedAt: entry.appendedAt,
  };
}

/** The expected chain head of an entry: `fnv(prevHead + canonical(content))` (the T019 discipline). */
function expectedChainHead(previousHead: string, entry: Omit<RiskPolicyTrailEntry, 'chainHead'>): string {
  return fnv1a32Hex(`${previousHead}${canonicalJson(entryContentTree(entry))}`);
}

// ---------------------------------------------------------------------------
// Construction and growth (the ONLY paths)
// ---------------------------------------------------------------------------

/**
 * Start the trail with the GENESIS policy (version 1 — a policy with a
 * supersedes pointer cannot start a trail; the trail IS the chain).
 * The genesis entry carries no reason (there is nothing it supersedes).
 */
export function startRiskPolicyTrail(policy: unknown, appendedAt: TimestampMs): RiskResult<RiskPolicyTrail> {
  if (!isRiskPolicy(policy)) {
    return { ok: false, errors: [invalidType('startRiskPolicyTrail requires a validated risk policy (the genesis)')] };
  }
  if (policy.version !== 1) {
    return fail('policy_history_rewrite', `the genesis policy must be version 1 (got ${policy.version}) — a trail starts at the beginning`, 'policy.version');
  }
  if (!isTimestampMs(appendedAt)) {
    return { ok: false, errors: [{ code: 'invalid_timestamp', path: 'appendedAt', message: 'startRiskPolicyTrail requires an epoch-ms append instant' }] };
  }
  const content: Omit<RiskPolicyTrailEntry, 'chainHead'> = { policy, reason: null, appendedAt };
  const chainHead = expectedChainHead('rpol-genesis', content);
  const entry: RiskPolicyTrailEntry = deepFreeze({ ...content, chainHead });
  return ok(deepFreeze({ tenant: policy.tenant, project: policy.project, entries: [entry] }));
}

/**
 * SUPERSEDE: append the NEXT policy version — the trail's only growth
 * path. Laws (the append-only discipline):
 *   1. the policy is guard-valid and is a strict successor: version ==
 *      head.version + 1, and its `supersedes` pointer names the head's
 *      (policyId, version) exactly — the chain is contiguous (a skip
 *      or a fork is a rewrite);
 *   2. the reason is non-empty and structured (a supersession without
 *      a reason is unauditable history — L11's "structured reasons");
 *   3. the scope matches the trail's (L12 — cross-tenant evolution is
 *      inexpressible);
 *   4. the append instant is an epoch-ms parameter (no ambient clock).
 * Returns a NEW trail; the original is untouched.
 */
export function appendRiskPolicy(trail: RiskPolicyTrail, policy: unknown, reason: string, appendedAt: TimestampMs): RiskResult<RiskPolicyTrail> {
  if (!isRiskPolicyTrail(trail)) {
    return { ok: false, errors: [invalidType('appendRiskPolicy requires a valid policy trail')] };
  }
  if (!isRiskPolicy(policy)) {
    return { ok: false, errors: [invalidType('appendRiskPolicy requires a validated risk policy')] };
  }
  if (!isNonEmptyString(reason)) {
    return { ok: false, errors: [{ code: 'invalid_field', path: 'reason', message: 'a supersession carries a structured reason — an unexplained evolution is unauditable history (L11)' }] };
  }
  if (!isTimestampMs(appendedAt)) {
    return { ok: false, errors: [{ code: 'invalid_timestamp', path: 'appendedAt', message: 'appendRiskPolicy requires an epoch-ms append instant' }] };
  }
  const head = trail.entries[trail.entries.length - 1] as RiskPolicyTrailEntry;
  if (policy.tenant !== trail.tenant || policy.project !== trail.project) {
    return {
      ok: false,
      errors: [{ code: 'tenant_missing', path: 'policy', message: `the policy's scope (${policy.tenant}/${policy.project}) does not match the trail's (${trail.tenant}/${trail.project}) — trails are tenant-isolated (L12)` }],
    };
  }
  if (policy.version !== head.policy.version + 1) {
    return fail(
      'policy_history_rewrite',
      `the policy claims version ${policy.version} but the trail's next version is ${head.policy.version + 1} — versions chain contiguously (a skip or a fork is a rewrite)`,
      'policy.version',
    );
  }
  if (policy.supersedes === null || policy.supersedes.policyId !== head.policy.policyId || policy.supersedes.version !== head.policy.version) {
    return fail(
      'policy_history_rewrite',
      `the policy's supersedes pointer (${policy.supersedes === null ? 'null' : `${policy.supersedes.policyId}@${policy.supersedes.version}`}) does not name the trail's head (${head.policy.policyId}@${head.policy.version}) — the chain is contiguous or it is a rewrite`,
      'policy.supersedes',
    );
  }
  const content: Omit<RiskPolicyTrailEntry, 'chainHead'> = { policy, reason, appendedAt };
  const chainHead = expectedChainHead(head.chainHead, content);
  const entry: RiskPolicyTrailEntry = deepFreeze({ ...content, chainHead });
  return ok(deepFreeze({ tenant: trail.tenant, project: trail.project, entries: [...trail.entries, entry] }));
}

/** The semantic alias — the Work Order's own verb. */
export const supersedeRiskPolicy = appendRiskPolicy;

// ---------------------------------------------------------------------------
// Verification (the rewrite trip wire)
// ---------------------------------------------------------------------------

/**
 * Verify the trail's chain: recompute every entry's chain head from
 * the entries themselves and check the version contiguity (1, 2, 3,
 * ...), the supersedes pointers (each entry's policy supersedes the
 * previous entry's), the reason laws (genesis null; later versions
 * non-empty) and the tenant/project continuity. A trail whose history
 * was spliced, edited, truncated or illegally versioned fails with the
 * typed `policy_history_rewrite` — rewriting policy history is
 * impossible to express through the API, and a forged trail fails
 * verification.
 */
export function verifyRiskPolicyTrail(trail: RiskPolicyTrail): RiskResult<RiskPolicyTrail> {
  if (!isRiskPolicyTrail(trail)) {
    return { ok: false, errors: [invalidType('verifyRiskPolicyTrail requires a structurally valid policy trail')] };
  }
  let previousHead = 'rpol-genesis';
  for (let index = 0; index < trail.entries.length; index++) {
    const entry = trail.entries[index] as RiskPolicyTrailEntry;
    if (entry.policy.version !== index + 1) {
      return fail('policy_history_rewrite', `entry ${index} carries policy version ${entry.policy.version} — versions chain contiguously from 1 (a splice or skip is a rewrite)`, `entries[${index}].policy.version`);
    }
    if (entry.policy.tenant !== trail.tenant || entry.policy.project !== trail.project) {
      return fail('policy_history_rewrite', `entry ${index} changes the trail's tenant/project scope — scope continuity is part of the chain`, `entries[${index}]`);
    }
    if (index === 0) {
      if (entry.policy.version !== 1 || entry.policy.supersedes !== null) {
        return fail('policy_history_rewrite', 'the first entry must be the genesis (version 1, no supersedes pointer)', 'entries[0].policy');
      }
    } else {
      const previous = trail.entries[index - 1] as RiskPolicyTrailEntry;
      const supersedes = entry.policy.supersedes;
      if (supersedes === null || supersedes.policyId !== previous.policy.policyId || supersedes.version !== previous.policy.version) {
        return fail('policy_history_rewrite', `entry ${index}'s supersedes pointer does not name entry ${index - 1}'s policy (${previous.policy.policyId}@${previous.policy.version}) — the chain is contiguous or it is a rewrite`, `entries[${index}].policy.supersedes`);
      }
    }
    const expectedHead = expectedChainHead(previousHead, entry);
    if (entry.chainHead !== expectedHead) {
      return fail('policy_history_rewrite', `entry ${index}'s chain head does not fold onto its content — the entry (or something before it) was edited, removed or reordered`, `entries[${index}].chainHead`);
    }
    previousHead = entry.chainHead;
  }
  return ok(trail);
}

/**
 * The L11 retention made visible: the superseded policy versions the
 * trail RETAINS, in order (the current head included — every version
 * ever declared).
 */
export function retainedPolicyVersions(trail: RiskPolicyTrail): readonly RiskPolicy[] {
  return trail.entries.map((entry) => entry.policy);
}

/** The trail's CURRENT policy (the head — what evaluations run under). */
export function currentRiskPolicy(trail: RiskPolicyTrail): RiskPolicy {
  const head = trail.entries[trail.entries.length - 1] as RiskPolicyTrailEntry;
  return head.policy;
}
