// @tradrl/domain-core — Organization: the structural team contract.
//
// STRUCTURAL ONLY. Agent bodies, substrates, possessions and instances are
// the agent-body lane (T003) — they are referenced here by opaque ids only
// and this package never imports that lane. Communication topology (learned
// by the organization compiler, T016) is referenced by opaque id as well.
//
// Laws honored here:
// - L2 body/model separation preserved: memberships reference instances and
//   (optionally) their immutable body versions — never substrates/models.
// - Organization topology is learnable (AGENTS.md): evolution produces a new
//   Organization record; records are immutable snapshots.

import {
  Timestamp,
  isFiniteNumber,
  isNonEmptyString,
  isRecord,
  isTimestamp,
} from './primitives';
import {
  AgentInstanceId,
  BodyVersionId,
  OrganizationId,
  ProjectId,
  TenantId,
  TopologyId,
  isAgentInstanceId,
  isBodyVersionId,
  isOrganizationId,
  isProjectId,
  isTenantId,
  isTopologyId,
} from './ids';

export type OrganizationStatus = 'forming' | 'active' | 'paused' | 'dissolved';

export const ORGANIZATION_STATUSES: readonly OrganizationStatus[] = [
  'forming',
  'active',
  'paused',
  'dissolved',
] as const;

/** One agent instance's structural membership in the organization. */
export interface OrganizationMembership {
  /** Opaque reference; referent owned by T003. */
  readonly agentInstanceId: AgentInstanceId;
  /** Role label, e.g. "researcher", "trading-director". Free-form. */
  readonly role: string;
  /** Immutable body version the instance was running when recorded. Opaque (T003). */
  readonly bodyVersionId?: BodyVersionId;
  /** Manager within this organization, when hierarchical. */
  readonly managerId?: AgentInstanceId;
}

export type DecisionCadenceMode = 'event-driven' | 'scheduled' | 'continuous';

export const DECISION_CADENCE_MODES: readonly DecisionCadenceMode[] = [
  'event-driven',
  'scheduled',
  'continuous',
] as const;

/**
 * Structural decision cadence. `scheduled` requires a strictly positive
 * `intervalSeconds`. For other modes an interval, when present, is the
 * minimum spacing between decisions (advisory).
 */
export interface DecisionCadence {
  readonly mode: DecisionCadenceMode;
  readonly intervalSeconds?: number;
}

export interface Organization {
  readonly id: OrganizationId;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly name?: string;
  readonly status: OrganizationStatus;
  readonly createdAt: Timestamp;
  /** Members. Each agent instance appears at most once. */
  readonly memberships: readonly OrganizationMembership[];
  /** Communication topology record. Opaque; referent owned by T006/T016. */
  readonly communicationTopologyId: TopologyId;
  readonly decisionCadence: DecisionCadence;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

export function isOrganizationStatus(v: unknown): v is OrganizationStatus {
  return isNonEmptyString(v) && (ORGANIZATION_STATUSES as readonly string[]).includes(v);
}

export function isOrganizationMembership(v: unknown): v is OrganizationMembership {
  if (!isRecord(v)) return false;
  if (!isAgentInstanceId(v.agentInstanceId)) return false;
  if (!isNonEmptyString(v.role)) return false;
  if (v.bodyVersionId !== undefined && !isBodyVersionId(v.bodyVersionId)) return false;
  if (v.managerId !== undefined && !isAgentInstanceId(v.managerId)) return false;
  return true;
}

export function isDecisionCadence(v: unknown): v is DecisionCadence {
  if (!isRecord(v)) return false;
  if (
    !isNonEmptyString(v.mode) ||
    !(DECISION_CADENCE_MODES as readonly string[]).includes(v.mode)
  ) {
    return false;
  }
  if (v.intervalSeconds !== undefined) {
    if (!isFiniteNumber(v.intervalSeconds) || v.intervalSeconds <= 0) return false;
  }
  if (v.mode === 'scheduled' && v.intervalSeconds === undefined) return false;
  return true;
}

export function isOrganization(v: unknown): v is Organization {
  if (!isRecord(v)) return false;
  if (!isOrganizationId(v.id)) return false;
  if (!isTenantId(v.tenantId)) return false;
  if (!isProjectId(v.projectId)) return false;
  if (v.name !== undefined && !isNonEmptyString(v.name)) return false;
  if (!isOrganizationStatus(v.status)) return false;
  if (!isTimestamp(v.createdAt)) return false;
  if (!Array.isArray(v.memberships)) return false;
  if (!v.memberships.every((x) => isOrganizationMembership(x))) return false;
  // Each agent instance holds at most one membership in an organization.
  const instanceIds = v.memberships.map(
    (m) => (m as OrganizationMembership).agentInstanceId,
  );
  if (new Set(instanceIds).size !== instanceIds.length) return false;
  if (!isTopologyId(v.communicationTopologyId)) return false;
  if (!isDecisionCadence(v.decisionCadence)) return false;
  return true;
}
