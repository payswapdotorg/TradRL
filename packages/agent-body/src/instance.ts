// @tradrl/agent-body — AgentInstance contracts.
//
// Spec anchors: spec/ARCHITECTURE-LOCK.md L2, L12 (tenant isolation — the
// project reference is tenant-scoped), L16 (strategic/execution separation —
// reflected in authority scopes being subsets of body boundaries);
// spec/DOMAIN-MODEL.md ("AgentInstance: a possession operating for a project
// with authority scope, parent/manager and runtime state"); spec/SECURITY.md
// (audit records BodyVersion, substrate, policy and outcome).
//
// An AgentInstance is a possession operating at runtime. The runtime state
// ITSELF lives in the Agent OS lane (T006) — this record holds only an opaque
// `runtimeStateRef` handle. Lifecycle is copy-on-write like possession.

import {
  type AgentInstanceId,
  type ISO8601,
  type PossessionId,
  type ProjectRef,
  type RuntimeStateRef,
  IllegalTransitionError,
  deepFreeze,
  isAgentInstanceId,
  isEnum,
  isISO8601,
  isNonNegativeInteger,
  isPossessionId,
  isProjectRef,
  isRecord,
  isRuntimeStateRef,
} from './primitives';
import {
  type AgentActionName,
  type BodyVersion,
  isAgentActionName,
} from './body';
import { type Possession, isPossession } from './possession';

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** Agent instance lifecycle states. */
export const AGENT_INSTANCE_STATUSES = [
  'spawning',
  'ready',
  'running',
  'paused',
  'failed',
  'terminated',
] as const;

/** Agent instance lifecycle state. */
export type AgentInstanceStatus = (typeof AGENT_INSTANCE_STATUSES)[number];

/** Guard: `AgentInstanceStatus`. */
export const isAgentInstanceStatus = isEnum(AGENT_INSTANCE_STATUSES);

/**
 * The agent-instance lifecycle state machine (authoritative; see
 * contracts/agent/agent-instance.md):
 *
 * ```text
 *   spawning ──► ready ──► running ◄──► paused
 *       │          │          │           │
 *       ▼          ▼          ▼           ▼
 *     failed    terminated  failed    terminated
 *       │                     │
 *       └──────► terminated ◄─┘ (failed -> terminated)
 * ```
 */
export const AGENT_INSTANCE_TRANSITIONS: Readonly<
  Record<AgentInstanceStatus, readonly AgentInstanceStatus[]>
> = {
  spawning: ['ready', 'failed'],
  ready: ['running', 'terminated', 'failed'],
  running: ['paused', 'terminated', 'failed'],
  paused: ['running', 'terminated', 'failed'],
  failed: ['terminated'],
  terminated: [],
};

/** `true` when `from -> to` is a legal agent-instance transition. */
export function canTransitionAgentInstance(
  from: AgentInstanceStatus,
  to: AgentInstanceStatus,
): boolean {
  if (!isAgentInstanceStatus(from) || !isAgentInstanceStatus(to)) return false;
  return AGENT_INSTANCE_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------------------
// Authority scope
// ---------------------------------------------------------------------------

/**
 * The authority granted to THIS instance at runtime. Authority can narrow but
 * never widen the body's declared `AuthorityBoundary`: `allowedActions` must
 * be a subset of the body's allowed actions (validated by
 * `validateAgentInstance`). Enforcement of these declarations is
 * out-of-model (L8/L20; Agent OS + execution gateway lanes).
 */
export interface AuthorityScope {
  /** Kernel actions this instance may perform (subset of the body's grant). */
  readonly allowedActions: readonly AgentActionName[];
  /** Kernel actions explicitly denied to this instance. */
  readonly deniedActions: readonly AgentActionName[];
  /** Maximum delegation chain depth below this instance. */
  readonly maxDelegationDepth: number;
}

/** Guard: `AuthorityScope`. */
export function isAuthorityScope(v: unknown): v is AuthorityScope {
  if (!isRecord(v)) return false;
  return (
    Array.isArray(v.allowedActions) &&
    v.allowedActions.every(isAgentActionName) &&
    Array.isArray(v.deniedActions) &&
    v.deniedActions.every(isAgentActionName) &&
    isNonNegativeInteger(v.maxDelegationDepth)
  );
}

// ---------------------------------------------------------------------------
// AgentInstance
// ---------------------------------------------------------------------------

/** Draft accepted by `createAgentInstance` — everything except lifecycle state. */
export type AgentInstanceDraft = Omit<AgentInstance, 'status'>;

/**
 * A possession operating at runtime for a project. The five components of the
 * core law (L2) resolve as: BodyVersion + CognitiveSubstrate + Possession
 * configuration (all via `possessionId`), Environment (via the possession's
 * environment profile), Runtime State (via the opaque `runtimeStateRef`
 * handle; the state itself lives in the Agent OS lane, T006).
 */
export interface AgentInstance {
  /** Instance identity. */
  readonly id: AgentInstanceId;
  /** The possession this instance operates. */
  readonly possessionId: PossessionId;
  /** Opaque project reference (tenant-scoped; T002/T007 lane). */
  readonly projectId: ProjectRef;
  /** Managing agent instance, or `null` for a root agent. */
  readonly managerId: AgentInstanceId | null;
  /** Runtime-granted authority scope (subset of the body's boundary). */
  readonly authority: AuthorityScope;
  /** Opaque handle to runtime state owned by the Agent OS (T006). */
  readonly runtimeStateRef: RuntimeStateRef;
  /** Lifecycle state (state machine above). */
  readonly status: AgentInstanceStatus;
  /** When the instance was spawned. */
  readonly spawnedAt: ISO8601;
}

/** Guard: `AgentInstance`. */
export function isAgentInstance(v: unknown): v is AgentInstance {
  if (!isRecord(v)) return false;
  return (
    isAgentInstanceId(v.id) &&
    isPossessionId(v.possessionId) &&
    isProjectRef(v.projectId) &&
    (v.managerId === null || isAgentInstanceId(v.managerId)) &&
    isAuthorityScope(v.authority) &&
    isRuntimeStateRef(v.runtimeStateRef) &&
    isAgentInstanceStatus(v.status) &&
    isISO8601(v.spawnedAt)
  );
}

/**
 * Constructs a deeply frozen `AgentInstance` in state `spawning` (single
 * entry point of the lifecycle). Throws `TypeError` (field-prefixed) on
 * invalid input, including `managerId === id` self-management.
 */
export function createAgentInstance(draft: AgentInstanceDraft): AgentInstance {
  const problems: string[] = [];
  if (!isAgentInstanceId(draft.id)) problems.push('id: invalid AgentInstanceId');
  if (!isPossessionId(draft.possessionId)) problems.push('possessionId: invalid PossessionId');
  if (!isProjectRef(draft.projectId)) problems.push('projectId: invalid ProjectRef');
  if (draft.managerId !== null && !isAgentInstanceId(draft.managerId)) {
    problems.push('managerId: invalid AgentInstanceId');
  }
  if (draft.managerId !== null && draft.managerId === draft.id) {
    problems.push('managerId: an agent cannot manage itself');
  }
  if (!isAuthorityScope(draft.authority)) problems.push('authority: invalid AuthorityScope');
  if (!isRuntimeStateRef(draft.runtimeStateRef)) {
    problems.push('runtimeStateRef: invalid RuntimeStateRef');
  }
  if (!isISO8601(draft.spawnedAt)) problems.push('spawnedAt: invalid ISO8601 timestamp');
  if (problems.length > 0) throw new TypeError(`createAgentInstance: ${problems.join('; ')}`);
  const instance: AgentInstance = { ...draft, status: 'spawning' };
  return deepFreeze(instance);
}

/**
 * Copy-on-write lifecycle transition: returns a NEW deeply frozen instance in
 * state `to`; the input record is untouched. Throws `IllegalTransitionError`
 * on an illegal edge and `TypeError` on an unknown state. Transition
 * timestamps/audit live in the observability lane (T043) — this contract
 * keeps records minimal.
 */
export function transitionAgentInstance(
  instance: AgentInstance,
  to: AgentInstanceStatus,
): AgentInstance {
  if (!isAgentInstanceStatus(to)) {
    throw new TypeError(`transitionAgentInstance: unknown status ${JSON.stringify(to)}`);
  }
  if (!canTransitionAgentInstance(instance.status, to)) {
    throw new IllegalTransitionError('agent-instance', instance.status, to);
  }
  const next: AgentInstance = { ...instance, status: to };
  return deepFreeze(next);
}

// ---------------------------------------------------------------------------
// Instance validity
// ---------------------------------------------------------------------------

/** Why an agent instance is invalid against its possession and body. */
export const INSTANCE_VIOLATION_CODES = [
  'possession-mismatch',
  'authority-exceeds-body',
  'authority-contradiction',
  'self-management',
  'delegation-depth-exceeds-body',
] as const;

/** Agent-instance validity violation code. */
export type InstanceViolationCode = (typeof INSTANCE_VIOLATION_CODES)[number];

/** Guard: `InstanceViolationCode`. */
export const isInstanceViolationCode = isEnum(INSTANCE_VIOLATION_CODES);

/** One agent-instance validity violation. */
export interface InstanceViolation {
  /** Violation code. */
  readonly code: InstanceViolationCode;
  /** Human-readable explanation. */
  readonly message: string;
}

/** Result of `validateAgentInstance`. */
export interface AgentInstanceValidation {
  /** `true` iff there are no violations. */
  readonly valid: boolean;
  /** All violations (empty iff `valid`). */
  readonly violations: readonly InstanceViolation[];
}

/**
 * Validates an agent instance against its possession and the possessed
 * body version:
 * - `possessionId` must reference the given possession;
 * - the instance's `allowedActions` must be a SUBSET of the body's declared
 *   `authorityBoundary.allowedActions` (runtime authority can narrow, never
 *   widen — L16);
 * - `allowedActions` and `deniedActions` must be disjoint;
 * - the instance cannot manage itself;
 * - `maxDelegationDepth` must not exceed the body's delegation policy depth
 *   (and must be 0 when the body cannot delegate).
 *
 * The possession itself must be validated separately (`validatePossession`)
 * — validity composes along the chain instance -> possession -> body.
 */
export function validateAgentInstance(
  instance: AgentInstance,
  possession: Possession,
  bodyVersion: BodyVersion,
): AgentInstanceValidation {
  const violations: InstanceViolation[] = [];
  if (instance.possessionId !== possession.id) {
    violations.push({
      code: 'possession-mismatch',
      message: `instance references possessionId ${instance.possessionId} but the given possession is ${possession.id}`,
    });
  }
  if (possession.bodyVersionId !== bodyVersion.id) {
    violations.push({
      code: 'possession-mismatch',
      message: `possession references bodyVersionId ${possession.bodyVersionId} but the given version is ${bodyVersion.id} — validate the possession against its own body version`,
    });
  }
  if (!isPossession(possession)) {
    violations.push({
      code: 'possession-mismatch',
      message: 'possession is not a valid Possession record (structural guard failed)',
    });
    return { valid: false, violations };
  }

  const boundary = bodyVersion.composition.authorityBoundary;
  const bodyAllowed = new Set<string>(boundary.allowedActions);
  const exceeds = instance.authority.allowedActions.filter((a) => !bodyAllowed.has(a));
  if (exceeds.length > 0) {
    violations.push({
      code: 'authority-exceeds-body',
      message: `instance allows ${exceeds.join(', ')} which the body ${bodyVersion.id} does not grant`,
    });
  }
  const denied = new Set<string>(instance.authority.deniedActions);
  const contradiction = instance.authority.allowedActions.filter((a) => denied.has(a));
  if (contradiction.length > 0) {
    violations.push({
      code: 'authority-contradiction',
      message: `instance both allows and denies ${contradiction.join(', ')}`,
    });
  }
  if (instance.managerId !== null && instance.managerId === instance.id) {
    violations.push({
      code: 'self-management',
      message: 'instance.managerId equals instance.id — an agent cannot manage itself',
    });
  }
  const bodyDepth = bodyVersion.composition.delegationPolicy.maxDelegationDepth;
  const canDelegate = bodyVersion.composition.delegationPolicy.canDelegate;
  if (instance.authority.maxDelegationDepth > bodyDepth || (!canDelegate && instance.authority.maxDelegationDepth > 0)) {
    violations.push({
      code: 'delegation-depth-exceeds-body',
      message: `instance maxDelegationDepth ${instance.authority.maxDelegationDepth} exceeds body ${bodyVersion.id} policy (depth ${bodyDepth}, canDelegate ${canDelegate})`,
    });
  }
  return { valid: violations.length === 0, violations };
}

/**
 * Walks the manager chain of `instances` and returns the first management
 * cycle found (e.g. `[a, b, c, a]`), or `null` when management is acyclic.
 * Dangling manager references (manager not in the list) are not cycles.
 */
export function detectManagementCycle(
  instances: readonly AgentInstance[],
): readonly AgentInstanceId[] | null {
  const byId = new Map<AgentInstanceId, AgentInstance>();
  for (const instance of instances) byId.set(instance.id, instance);
  for (const start of instances) {
    const seen = new Set<AgentInstanceId>();
    const path: AgentInstanceId[] = [];
    let current: AgentInstance | null = start;
    while (current !== null && current.managerId !== null) {
      if (seen.has(current.id)) {
        const from = path.indexOf(current.id);
        return [...path.slice(from), current.id];
      }
      seen.add(current.id);
      path.push(current.id);
      const next: AgentInstance | undefined = byId.get(current.managerId);
      current = next === undefined ? null : next;
    }
  }
  return null;
}
