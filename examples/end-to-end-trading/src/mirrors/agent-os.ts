// @tradrl/example-e2e-trading — STRUCTURAL MIRROR of @tradrl/agent-os's
// kernel operation vocabulary, message envelopes and topics (T006), and of
// @tradrl/organization's blueprint axes (T016) + @tradrl/domain-core's
// Organization membership record (T002).
//
// D-003/D-004 law: this module imports NOTHING outside the example tree.
// The envelope id formula (`msg:<opId>:<sender>:<sequence>`) and the kernel
// topic list are mirrored byte-identically; interop tests prove parity.

import { deepFreeze, isNonEmptyString, isRecord, isTimestampMs, isPositiveInteger } from '../primitives';
import { type AgentActionNameMirror, isAgentActionNameMirror } from './agent-body';

// ---------------------------------------------------------------------------
// Kernel vocabulary (mirror)
// ---------------------------------------------------------------------------

/** The reserved kernel topics (mirror — PUBLISH to these is refused). */
export const KERNEL_TOPICS_MIRROR = [
  'kernel.request',
  'kernel.delegate',
  'kernel.challenge',
  'kernel.propose',
  'kernel.approve',
  'kernel.escalate',
  'kernel.cascade-escalate',
] as const;

/** A kernel topic name. */
export type KernelTopicMirror = (typeof KERNEL_TOPICS_MIRROR)[number];

/** Guard: a reserved kernel topic. */
export function isKernelTopicMirror(v: unknown): v is KernelTopicMirror {
  return (KERNEL_TOPICS_MIRROR as readonly string[]).includes(v as string);
}

/** Guard: a legal organization topic (non-empty, NOT kernel-reserved). */
export function isOrganizationTopicMirror(v: unknown): v is string {
  return isNonEmptyString(v) && !(v as string).startsWith('kernel.');
}

/** A kernel operation record (the subset this slice exercises). */
export interface KernelOperationMirror {
  readonly opId: string;
  readonly type: AgentActionNameMirror;
  readonly timestamp: number;
  readonly actor: string;
  readonly tenantId: string;
  readonly topic: string | null;
  readonly payloadRef: string | null;
}

/** Guard: a kernel operation record. */
export function isKernelOperationMirror(v: unknown): v is KernelOperationMirror {
  return (
    isRecord(v) &&
    isNonEmptyString(v.opId) &&
    isAgentActionNameMirror(v.type) &&
    isTimestampMs(v.timestamp) &&
    isNonEmptyString(v.actor) &&
    isNonEmptyString(v.tenantId) &&
    (v.topic === null || isOrganizationTopicMirror(v.topic)) &&
    (v.payloadRef === null || isNonEmptyString(v.payloadRef))
  );
}

/** The kernel message envelope (plain-string mirror — round-trips into the real factory). */
export interface MessageEnvelopeMirror {
  readonly id: string;
  readonly topic: string;
  readonly tenantId: string;
  readonly sender: string;
  readonly payloadRef: string;
  readonly sequence: number;
  readonly causalityId: string | null;
  readonly publishedAt: number;
}

/** Guard: a message envelope. */
export function isMessageEnvelopeMirror(v: unknown): v is MessageEnvelopeMirror {
  return (
    isRecord(v) &&
    isNonEmptyString(v.id) &&
    isOrganizationTopicMirror(v.topic) &&
    isNonEmptyString(v.tenantId) &&
    isNonEmptyString(v.sender) &&
    isNonEmptyString(v.payloadRef) &&
    isPositiveInteger(v.sequence) &&
    (v.causalityId === null || isNonEmptyString(v.causalityId)) &&
    isTimestampMs(v.publishedAt)
  );
}

/** Derives the envelope id: `msg:<opId>:<sender>:<sequence>` (the kernel law). */
export function messageIdOf(opId: string, sender: string, sequence: number): string {
  return `msg:${opId}:${sender}:${String(sequence)}`;
}

// ---------------------------------------------------------------------------
// Organization blueprint (T016 mirror — the seven axes)
// ---------------------------------------------------------------------------

/** The seven organization axes (mirror, in order). */
export const ORGANIZATION_AXES_MIRROR = [
  'agentCount',
  'specializations',
  'assignments',
  'topology',
  'trainingAllocation',
  'decisionCadence',
  'adversarialPopulation',
] as const;

export interface AgentAssignmentMirror {
  readonly slotId: string;
  /** The body-version assigned to the slot (L16a: evidence, not labels). */
  readonly bodyVersionRef: string;
  /** The capability record refs that established suitability. */
  readonly capabilityRecordRefs: readonly string[];
  readonly riskPolicyRefs: readonly string[];
}

export interface TopicWireMirror {
  readonly topic: string;
  readonly publishers: readonly string[];
  readonly subscribers: readonly string[];
}

export interface CommunicationTopologyMirror {
  readonly wires: readonly TopicWireMirror[];
}

export interface OrganizationBlueprintMirror {
  readonly tenantId: string;
  readonly projectId: string;
  readonly agentCount: number;
  readonly specializations: readonly string[];
  readonly assignments: readonly AgentAssignmentMirror[];
  readonly topology: CommunicationTopologyMirror;
  readonly trainingAllocation: { readonly research: number; readonly strategy: number; readonly evaluation: number };
  readonly decisionCadence: { readonly mode: 'event-driven' | 'scheduled' | 'continuous' };
  readonly adversarialPopulation: { readonly adversarySlots: number; readonly declared: 'none-required' };
}

/** Guard: a topic wire. */
export function isTopicWireMirror(v: unknown): v is TopicWireMirror {
  return (
    isRecord(v) &&
    isOrganizationTopicMirror(v.topic) &&
    Array.isArray(v.publishers) &&
    v.publishers.length >= 1 &&
    Array.isArray(v.subscribers) &&
    v.subscribers.length >= 1
  );
}

/** Guard: a blueprint. */
export function isOrganizationBlueprintMirror(v: unknown): v is OrganizationBlueprintMirror {
  return (
    isRecord(v) &&
    isNonEmptyString(v.tenantId) &&
    isNonEmptyString(v.projectId) &&
    isPositiveInteger(v.agentCount) &&
    v.agentCount === (v.assignments as readonly unknown[]).length &&
    Array.isArray(v.specializations) &&
    Array.isArray(v.assignments) &&
    isRecord(v.topology) &&
    Array.isArray(v.topology.wires) &&
    v.topology.wires.every(isTopicWireMirror)
  );
}

// ---------------------------------------------------------------------------
// Organization membership (T002 domain-core mirror)
// ---------------------------------------------------------------------------

export interface OrganizationMembershipMirror {
  readonly agentInstanceId: string;
  readonly role: string;
  readonly bodyVersionId?: string;
  readonly managerId?: string;
}

export interface OrganizationMirror {
  readonly id: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly name?: string;
  readonly status: 'forming' | 'active' | 'paused' | 'dissolved';
  readonly createdAt: number;
  readonly memberships: readonly OrganizationMembershipMirror[];
  readonly communicationTopologyId: string;
  readonly decisionCadence: { readonly mode: 'event-driven' | 'scheduled' | 'continuous' };
}

/** Guard: an organization record. */
export function isOrganizationMirror(v: unknown): v is OrganizationMirror {
  return (
    isRecord(v) &&
    isNonEmptyString(v.id) &&
    isNonEmptyString(v.tenantId) &&
    isNonEmptyString(v.projectId) &&
    isNonEmptyString(v.communicationTopologyId) &&
    Array.isArray(v.memberships) &&
    isTimestampMs(v.createdAt)
  );
}

/** Freezes a blueprint (the L3 discipline). */
export function freezeBlueprint<T extends OrganizationBlueprintMirror>(blueprint: T): T {
  return deepFreeze(blueprint);
}
