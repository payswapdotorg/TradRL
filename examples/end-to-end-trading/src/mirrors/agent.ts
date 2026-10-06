// @tradrl/example-e2e-trading — AGENT MIRRORS.
//
// Structural mirrors of the agent plane the slice composes: the
// BodyVersion composition (packages/agent-body body.ts, as mirrored by
// the bodies lane), the Possession binding (packages/agent-body
// possession.ts), the Agent OS message fabric + kernel operations
// (packages/agent-os), and the organization compiler's seven-axis
// blueprint + registry snapshot + search log (packages/organization).
// tests/end-to-end-trading/interop.test.ts feeds this slice's records
// through the REAL organization/agent-os guards.

import type {
  TenantId, ProjectId, TopicName, AgentInstanceId, BodyVersionRef,
  SubstrateRef, CapabilityKey, CapabilityRecordId, Seed, GoalRef, ConstraintSetRef,
} from '../ids';
import type { GoalStatementMirror, ConstraintSetStatementMirror } from './control';

// ---------------------------------------------------------------------------
// Body composition (agent-body BodyVersion — the bodies-lane mirror form)
// ---------------------------------------------------------------------------

export interface BodyVersionMirror {
  readonly id: BodyVersionRef;
  readonly bodyId: string;
  readonly version: { readonly major: number; readonly minor: number; readonly patch: number };
  readonly parentId: string | null;
  readonly composition: BodyCompositionMirror;
  readonly createdAt: string;
  readonly certified: false;
  readonly certificationEvidence: null;
}

export interface BodyCompositionMirror {
  readonly mission: {
    readonly summary: string;
    readonly goalRefs: readonly GoalRef[];
    readonly standingDirectives: readonly string[];
  };
  readonly capabilities: readonly {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly category: string;
    readonly skillArtifactRefs: readonly string[];
    readonly critical: boolean;
  }[];
  readonly knowledgeToolPolicy: {
    readonly allowedTools: readonly string[];
    readonly forbiddenTools: readonly string[];
    readonly toolCallBudgetPerDecision: number;
    readonly allowedKnowledgeSources: readonly string[];
    readonly forbiddenKnowledgeSources: readonly string[];
  };
  readonly procedures: readonly {
    readonly id: string;
    readonly name: string;
    readonly trigger: string;
    readonly steps: readonly {
      readonly id: string;
      readonly description: string;
      readonly toolRefs: readonly string[];
      readonly approvalRequired: boolean;
    }[];
  }[];
  readonly planningPolicy: { readonly style: string; readonly horizon: string };
  readonly delegationPolicy: { readonly mayDelegate: boolean; readonly scope: string };
  readonly authorityBoundary: {
    readonly allowedActions: readonly string[];
    readonly prohibitedActions: readonly string[];
    readonly approvalRequiredActions: readonly string[];
    readonly executionAuthority: string;
    readonly riskPolicyRef: string | null;
  };
  readonly evaluationEnvironment: { readonly requiredLayers: readonly string[] };
  readonly substrateCompatibility: {
    readonly requirements: readonly string[];
    readonly constraints: readonly string[];
    readonly testedSubstrates: readonly string[];
  };
}

// ---------------------------------------------------------------------------
// Possession (agent-body possession.ts)
// ---------------------------------------------------------------------------

export type PossessionStatusMirror = 'draft' | 'validated' | 'active' | 'suspended' | 'retired';

export interface PossessionMirror {
  readonly id: string;
  readonly bodyVersionId: BodyVersionRef;
  readonly substrateId: SubstrateRef;
  readonly adapter: { readonly adapterId: string; readonly configRef: string };
  readonly runtimeProfile: { readonly maxConcurrentDecisions: number; readonly timeoutMs: number };
  readonly environmentProfile: { readonly profileRef: string; readonly fidelity: string };
  readonly policyBundleRef: string;
  readonly status: PossessionStatusMirror;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------
// Agent OS fabric (agent-os envelope.ts + kernel subset)
// ---------------------------------------------------------------------------

export const KERNEL_TOPICS_MIRROR = [
  'kernel.request',
  'kernel.delegate',
  'kernel.challenge',
  'kernel.propose',
  'kernel.approve',
  'kernel.escalate',
  'kernel.cascade-escalate',
] as const;

export type KernelTopicMirror = (typeof KERNEL_TOPICS_MIRROR)[number];

export interface MessageEnvelopeMirror {
  readonly id: string;
  readonly topic: TopicName;
  readonly tenantId: TenantId;
  readonly sender: AgentInstanceId;
  readonly payload: string;
  readonly sequence: number;
  readonly causalityId: string | null;
  readonly publishedAt: number;
}

/** The kernel operations the reference slice exercises. */
export type SliceKernelOperationMirror =
  | {
      readonly opId: string;
      readonly type: 'SPAWN';
      readonly timestamp: number;
      readonly actor: AgentInstanceId;
      readonly tenantId: TenantId;
      readonly instance: AgentInstanceId;
      readonly bodyVersion: BodyVersionRef;
      readonly substrate: SubstrateRef;
      readonly manager: AgentInstanceId | null;
    }
  | {
      readonly opId: string;
      readonly type: 'SUBSCRIBE';
      readonly timestamp: number;
      readonly actor: AgentInstanceId;
      readonly tenantId: TenantId;
      readonly topic: TopicName;
    }
  | {
      readonly opId: string;
      readonly type: 'PUBLISH';
      readonly timestamp: number;
      readonly actor: AgentInstanceId;
      readonly tenantId: TenantId;
      readonly topic: TopicName;
      readonly payloadRef: string;
    }
  | {
      readonly opId: string;
      readonly type: 'OBSERVE';
      readonly timestamp: number;
      readonly actor: AgentInstanceId;
      readonly tenantId: TenantId;
      readonly windowRef: string;
    }
  | {
      readonly opId: string;
      readonly type: 'EXECUTE';
      readonly timestamp: number;
      readonly actor: AgentInstanceId;
      readonly tenantId: TenantId;
      /** Opaque intent ref — the kernel NEVER evaluates it (L8). */
      readonly intentRef: string;
      /** Opaque authority token ref — also never evaluated (L8). */
      readonly authorityTokenRef: string;
    }
  | {
      readonly opId: string;
      readonly type: 'REPORT';
      readonly timestamp: number;
      readonly actor: AgentInstanceId;
      readonly tenantId: TenantId;
      readonly subject: AgentInstanceId;
      readonly headline: string;
      readonly detailRef: string;
    };

export const KERNEL_ACTION_NAMES_MIRROR = [
  'SPAWN', 'TERMINATE', 'DELEGATE', 'REQUEST', 'PUBLISH', 'SUBSCRIBE',
  'CHALLENGE', 'PROPOSE', 'APPROVE', 'EXECUTE', 'ESCALATE', 'OBSERVE',
  'LEARN', 'REPORT',
] as const;

// ---------------------------------------------------------------------------
// Organization compiler mirrors (packages/organization)
// ---------------------------------------------------------------------------

export interface CompileBudgetsMirror {
  readonly maxAgents: number;
  readonly maxComputeUnits: number;
  readonly maxCoordinationWires: number;
  readonly maxLatencyMs: number;
  readonly maxEnumeratedCandidates: number;
  readonly retainLimitK: number;
}

export interface SpecializationRequestMirror {
  readonly capabilityKey: CapabilityKey;
  readonly benchmarkRefs: readonly string[];
  readonly gapId?: string;
}

export interface RegistrySubjectMirror {
  readonly kind: 'body-version' | 'cognitive-substrate';
  readonly ref: string;
}

export interface AgentAssignmentMirror {
  readonly slotId: string;
  readonly subject: RegistrySubjectMirror;
  readonly capabilityRecordRefs: readonly CapabilityRecordId[];
  readonly riskPolicyRefs: readonly string[];
}

export interface TopicWireMirror {
  readonly topic: TopicName;
  readonly publishers: readonly string[];
  readonly subscribers: readonly string[];
}

export interface CommunicationTopologyMirror {
  readonly wires: readonly TopicWireMirror[];
}

export interface TrainingAllocationEntryMirror {
  readonly slotId: string;
  readonly method: string;
  readonly computeUnits: number;
}

export interface TrainingAllocationMirror {
  readonly entries: readonly TrainingAllocationEntryMirror[];
}

export interface DecisionCadenceEntryMirror {
  readonly slotId: string;
  readonly intervalMs: number;
}

export interface DecisionCadenceMirror {
  readonly entries: readonly DecisionCadenceEntryMirror[];
}

export interface AdversarialPopulationMirror {
  readonly populationRef: string;
  readonly declaredGaps: readonly string[];
}

export interface OrganizationBlueprintMirror {
  readonly agentCount: number;
  readonly specializations: readonly SpecializationRequestMirror[];
  readonly assignments: readonly AgentAssignmentMirror[];
  readonly topology: CommunicationTopologyMirror;
  readonly trainingAllocation: TrainingAllocationMirror;
  readonly decisionCadence: DecisionCadenceMirror;
  readonly adversarialPopulation: AdversarialPopulationMirror | null;
}

export interface ObjectiveMeasurementsMirror {
  readonly objectiveAttainment: number;
  readonly risk: number;
  readonly compute: number;
  readonly coordinationCost: number;
  readonly latency: number;
  readonly robustness: number;
  readonly redundancy: number;
}

export interface ObjectiveAggregateMirror {
  readonly score: number;
  readonly contributions: Readonly<Record<string, number>>;
  readonly inputDigest: string;
}

export type CandidateDispositionMirror = 'proposed' | 'retained' | 'rejected';

export type CandidateRejectionReasonMirror =
  | { readonly code: 'below-required-satisfaction'; readonly requiredSatisfaction: number; readonly attainmentScore: number }
  | { readonly code: 'budget-exceeded'; readonly axis: string; readonly measured: number; readonly budget: number }
  | { readonly code: 'blocking-constraint'; readonly constraintId: string }
  | { readonly code: 'retain-limit'; readonly retainedCount: number };

export interface CandidateLineageMirror {
  readonly goalRef: GoalRef;
  readonly goalVersion: number;
  readonly constraintSetRef: ConstraintSetRef;
  readonly constraintSetVersion: number;
  readonly registrySnapshotDigest: string;
  readonly seed: Seed;
  readonly compilerVersion: string;
  readonly parentCandidateId: string | null;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
}

export interface OrganizationCandidateMirror {
  readonly candidateId: string;
  readonly sequence: number;
  readonly blueprint: OrganizationBlueprintMirror;
  readonly measurements: ObjectiveMeasurementsMirror;
  readonly objective: ObjectiveAggregateMirror;
  readonly lineage: CandidateLineageMirror;
  readonly disposition: CandidateDispositionMirror;
  readonly reasons: readonly CandidateRejectionReasonMirror[];
}

export interface SearchLogMirror {
  readonly searchRunId: string;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly goal: GoalStatementMirror;
  readonly constraints: ConstraintSetStatementMirror;
  readonly budgets: CompileBudgetsMirror;
  readonly registrySnapshot: RegistrySnapshotMirror;
  readonly seed: Seed;
  readonly compilerVersion: string;
  readonly candidates: readonly OrganizationCandidateMirror[];
}

// ---------------------------------------------------------------------------
// Capability registry snapshot (packages/organization capability-mirror)
// ---------------------------------------------------------------------------

export type CapabilityEvidenceKindMirror = 'benchmark' | 'measurement_record' | 'result_ref';

export interface MeasuredEvidenceMirror {
  readonly kind: 'measured';
  readonly metric: string;
  readonly value: number;
  readonly unit: string;
  readonly measuredAt: number;
  readonly measuredBy: string;
}

export interface CapabilityDescriptorMirror {
  readonly capabilityKey: CapabilityKey;
  readonly summary: string;
}

export interface CapabilityRecordMirror {
  readonly recordId: CapabilityRecordId;
  readonly subject: RegistrySubjectMirror;
  readonly descriptor: CapabilityDescriptorMirror;
  readonly evidence: readonly (MeasuredEvidenceMirror | { readonly kind: CapabilityEvidenceKindMirror; readonly ref: string })[];
  readonly declaredAt: number;
  readonly tenantId: TenantId;
}

export interface RegistrySnapshotMirror {
  readonly digest: string;
  readonly records: readonly CapabilityRecordMirror[];
  readonly takenAt: number;
  readonly tenantId: TenantId;
}
