// @tradrl/example-e2e-trading — STRUCTURAL MIRROR of @tradrl/agent-body's
// BodyVersion family (T003) and the shared agent vocabulary.
//
// D-003/D-004 law: this module imports NOTHING outside the example tree.
// The fields are PLAIN STRING types here (the body-forge mirror discipline)
// so records JSON-round-trip into the real factory — the interop trip-wire
// test builds a REAL `createBodyVersion` from this mirror's composition and
// asserts mutual guard acceptance.

import {
  deepFreeze,
  isIso8601,
  isNonEmptyString,
  isPositiveInteger,
  isMemberOf,
  isRecord,
  isBoolean,
  isArrayOf,
  isValidIdentifierString,
} from '../primitives';

// ---------------------------------------------------------------------------
// Vocabulary mirrors (kind-for-kind, in order — interop-trip-wired)
// ---------------------------------------------------------------------------

/** The fourteen kernel action names (mirror of agent-body/agent-os). */
export const AGENT_ACTION_NAMES_MIRROR = [
  'SPAWN',
  'TERMINATE',
  'DELEGATE',
  'REQUEST',
  'PUBLISH',
  'SUBSCRIBE',
  'CHALLENGE',
  'PROPOSE',
  'APPROVE',
  'EXECUTE',
  'ESCALATE',
  'OBSERVE',
  'LEARN',
  'REPORT',
] as const;

/** A kernel action name. */
export type AgentActionNameMirror = (typeof AGENT_ACTION_NAMES_MIRROR)[number];

/** Guard: a kernel action name. */
export const isAgentActionNameMirror = (v: unknown): v is AgentActionNameMirror =>
  isMemberOf(AGENT_ACTION_NAMES_MIRROR, v);

/** The execution authority modes — deliberately NO `model-autonomous` (L8/L20). */
export const EXECUTION_AUTHORITY_MODES_MIRROR = ['none', 'external-gateway-only'] as const;

/** An execution authority mode. */
export type ExecutionAuthorityModeMirror = (typeof EXECUTION_AUTHORITY_MODES_MIRROR)[number];

/** Guard: an execution authority mode. */
export const isExecutionAuthorityModeMirror = (v: unknown): v is ExecutionAuthorityModeMirror =>
  isMemberOf(EXECUTION_AUTHORITY_MODES_MIRROR, v);

/** The evaluation layers (mirror of agent-body). */
export const EVALUATION_LAYERS_MIRROR = [
  'data-integrity',
  'functional-correctness',
  'historical-performance',
  'blind-generalization',
  'execution-stress',
  'adversarial-stress',
  'organization-ablation',
  'model-substitution',
  'shadow-live-evidence',
] as const;

/** An evaluation layer. */
export type EvaluationLayerMirror = (typeof EVALUATION_LAYERS_MIRROR)[number];

/** The fidelity modes (agent-body hyphenated vocabulary — NOT time-engine's). */
export const FIDELITY_MODES_MIRROR = [
  'exact-replay',
  'reactive-replay',
  'counterfactual-generative',
] as const;

/** A fidelity mode (agent-body vocabulary). */
export type FidelityModeMirror = (typeof FIDELITY_MODES_MIRROR)[number];

/** The procedure triggers (mirror). */
export const PROCEDURE_TRIGGERS_MIRROR = ['scheduled', 'event', 'on-demand', 'escalation'] as const;
export type ProcedureTriggerMirror = (typeof PROCEDURE_TRIGGERS_MIRROR)[number];

/** The planning styles (mirror). */
export const PLANNING_STYLES_MIRROR = ['reactive', 'deliberative', 'hybrid'] as const;
export type PlanningStyleMirror = (typeof PLANNING_STYLES_MIRROR)[number];

/** The requirement levels (mirror). */
export const REQUIREMENT_LEVELS_MIRROR = ['required', 'preferred', 'not-required'] as const;
export type RequirementLevelMirror = (typeof REQUIREMENT_LEVELS_MIRROR)[number];

// ---------------------------------------------------------------------------
// The BodyVersion mirror family (plain-string mirror of agent-body's)
// ---------------------------------------------------------------------------

export interface MissionMirror {
  readonly summary: string;
  readonly goalRefs: readonly string[];
  readonly standingDirectives: readonly string[];
}

export interface BodyCapabilityMirror {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly skillArtifactRefs: readonly string[];
  readonly critical: boolean;
}

export interface KnowledgeToolPolicyMirror {
  readonly allowedTools: readonly string[];
  readonly forbiddenTools: readonly string[];
  readonly toolCallBudgetPerDecision: number | null;
  readonly allowedKnowledgeSources: readonly string[];
  readonly forbiddenKnowledgeSources: readonly string[];
}

export interface ProcedureStepMirror {
  readonly id: string;
  readonly description: string;
  readonly toolRefs: readonly string[];
  readonly approvalRequired: boolean;
}

export interface BodyProcedureMirror {
  readonly id: string;
  readonly name: string;
  readonly trigger: ProcedureTriggerMirror;
  readonly steps: readonly ProcedureStepMirror[];
}

export interface PlanningPolicyMirror {
  readonly style: PlanningStyleMirror;
  readonly maxPlanDepth: number;
  readonly replanTriggers: readonly string[];
}

export interface DelegationPolicyMirror {
  readonly canDelegate: boolean;
  readonly maxDelegationDepth: number;
  readonly delegateeCategories: readonly string[];
  readonly escalationCategories: readonly string[];
}

export interface AuthorityBoundaryMirror {
  readonly allowedActions: readonly AgentActionNameMirror[];
  readonly prohibitedActions: readonly AgentActionNameMirror[];
  readonly approvalRequiredActions: readonly AgentActionNameMirror[];
  readonly executionAuthority: ExecutionAuthorityModeMirror;
  readonly riskPolicyRef: string | null;
}

export interface EvaluationEnvironmentRequirementsMirror {
  readonly requiredEvaluationLayers: readonly EvaluationLayerMirror[];
  readonly requiredEnvironmentFeatures: readonly string[];
  readonly requiredDataCategories: readonly string[];
  readonly requiredFidelityModes: readonly FidelityModeMirror[];
}

export interface SubstrateRequirementsMirror {
  readonly minContextWindowTokens: number;
  readonly minMaxOutputTokens: number;
  readonly requiredInputModalities: readonly string[];
  readonly requiredOutputModalities: readonly string[];
  readonly toolUse: RequirementLevelMirror;
  readonly structuredOutput: RequirementLevelMirror;
}

export interface SubstrateConstraintsMirror {
  readonly allowedSubstitutionClasses: readonly string[] | null;
  readonly maxInputCostPerMTokens: number | null;
  readonly maxOutputCostPerMTokens: number | null;
  readonly maxP95LatencyMs: number | null;
}

export interface TestedSubstrateRecordMirror {
  readonly substrate: string;
  readonly result: 'pass' | 'fail' | 'conditional';
  readonly testedAt: string;
  readonly evidence: string;
  readonly notes: string | null;
}

export interface SubstrateCompatibilityManifestMirror {
  readonly requirements: SubstrateRequirementsMirror;
  readonly constraints: SubstrateConstraintsMirror;
  readonly testedSubstrates: readonly TestedSubstrateRecordMirror[];
}

export interface BodyCompositionMirror {
  readonly mission: MissionMirror;
  readonly capabilities: readonly BodyCapabilityMirror[];
  readonly knowledgeToolPolicy: KnowledgeToolPolicyMirror;
  readonly procedures: readonly BodyProcedureMirror[];
  readonly planningPolicy: PlanningPolicyMirror;
  readonly delegationPolicy: DelegationPolicyMirror;
  readonly authorityBoundary: AuthorityBoundaryMirror;
  readonly evaluationEnvironment: EvaluationEnvironmentRequirementsMirror;
  readonly substrateCompatibility: SubstrateCompatibilityManifestMirror;
}

/** An ISO-8601 calendar string with a mandatory offset. */
export type ISO8601 = string;

/** A SemVer record (mirror). */
export interface SemVerMirror {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly string[];
  readonly build: readonly string[];
}

/** The BodyVersion mirror — JSON-round-trips into the real factory. */
export interface BodyVersionMirror {
  /** Canonical identity `${bodyId}@${semver}`. */
  readonly id: string;
  readonly bodyId: string;
  readonly version: SemVerMirror;
  readonly parentId: string | null;
  readonly composition: BodyCompositionMirror;
  readonly createdAt: string;
  readonly certified: boolean;
  readonly certificationEvidence: null;
}

// ---------------------------------------------------------------------------
// Possession + AgentInstance mirrors (the L2 possession law)
// ---------------------------------------------------------------------------

export const POSSESSION_STATUSES_MIRROR = ['draft', 'validated', 'active', 'suspended', 'retired'] as const;
export type PossessionStatusMirror = (typeof POSSESSION_STATUSES_MIRROR)[number];

export interface PossessionMirror {
  readonly id: string;
  /** The bound BodyVersion (`${bodyId}@${semver}`). */
  readonly bodyVersionId: string;
  /** The possessing substrate (canonical `provider/modelId@modelVersion`). */
  readonly substrateId: string;
  readonly adapter: { readonly adapterId: string; readonly configRef: string };
  readonly runtimeProfile: {
    readonly timeoutMs: number;
    readonly maxRetries: number;
    readonly maxConcurrentInvocations: number;
    readonly costBudgetRef: string | null;
  };
  readonly environmentProfile: {
    readonly environmentRef: string;
    readonly fidelityMode: FidelityModeMirror;
  };
  readonly policyBundleRef: string;
  readonly status: PossessionStatusMirror;
  readonly createdAt: string;
}

export const AGENT_INSTANCE_STATUSES_MIRROR = [
  'spawning',
  'ready',
  'running',
  'paused',
  'failed',
  'terminated',
] as const;
export type AgentInstanceStatusMirror = (typeof AGENT_INSTANCE_STATUSES_MIRROR)[number];

export interface AgentInstanceMirror {
  readonly id: string;
  readonly possessionId: string;
  readonly projectId: string;
  readonly managerId: string | null;
  readonly authority: {
    readonly allowedActions: readonly AgentActionNameMirror[];
    readonly deniedActions: readonly AgentActionNameMirror[];
    readonly maxDelegationDepth: number;
  };
  readonly runtimeStateRef: string;
  readonly status: AgentInstanceStatusMirror;
  readonly spawnedAt: string;
}

// ---------------------------------------------------------------------------
// Guards (structural, hand-rolled — no `any`)
// ---------------------------------------------------------------------------

/** Guard: a body-version ref string in the canonical pattern. */
export function isBodyVersionRefMirror(v: unknown): v is string {
  return typeof v === 'string' && /^[\w.-]+@(\d+)\.(\d+)\.(\d+)$/.test(v);
}

/** Guard: a capability record. */
export function isBodyCapabilityMirror(v: unknown): v is BodyCapabilityMirror {
  return (
    isRecord(v) &&
    isValidIdentifierString(v.id) &&
    isNonEmptyString(v.name) &&
    isNonEmptyString(v.description) &&
    isNonEmptyString(v.category) &&
    Array.isArray(v.skillArtifactRefs) &&
    isBoolean(v.critical)
  );
}

/**
 * L8/L20 LAWS for the authority boundary (mirrored from the body
 * validators): EXECUTE requires external-gateway-only; a body with no
 * execution authority must explicitly prohibit EXECUTE. Returns the typed
 * violation codes (empty = lawful).
 */
export function authorityViolationsOf(boundary: AuthorityBoundaryMirror): readonly string[] {
  const violations: string[] = [];
  const allowed = boundary.allowedActions;
  if (allowed.includes('EXECUTE') && boundary.executionAuthority !== 'external-gateway-only') {
    violations.push('execution_authority_granted');
  }
  if (boundary.executionAuthority === 'none' && !boundary.prohibitedActions.includes('EXECUTE')) {
    violations.push('execute_not_prohibited');
  }
  return deepFreeze(violations);
}

/** Guard: a mission mirror. */
export function isMissionMirror(v: unknown): v is MissionMirror {
  return (
    isRecord(v) &&
    isNonEmptyString(v.summary) &&
    Array.isArray(v.goalRefs) &&
    Array.isArray(v.standingDirectives)
  );
}

/** Guard: a possession record. */
export function isPossessionMirror(v: unknown): v is PossessionMirror {
  return (
    isRecord(v) &&
    isNonEmptyString(v.id) &&
    isBodyVersionRefMirror(v.bodyVersionId) &&
    isNonEmptyString(v.substrateId) &&
    isMemberOf(POSSESSION_STATUSES_MIRROR, v.status) &&
    isIso8601(v.createdAt)
  );
}

/** Guard: an agent instance record. */
export function isAgentInstanceMirror(v: unknown): v is AgentInstanceMirror {
  return (
    isRecord(v) &&
    isNonEmptyString(v.id) &&
    isNonEmptyString(v.possessionId) &&
    isNonEmptyString(v.projectId) &&
    isMemberOf(AGENT_INSTANCE_STATUSES_MIRROR, v.status)
  );
}

/** Guard: a body version mirror (structure only). */
export function isBodyVersionMirror(v: unknown): v is BodyVersionMirror {
  return (
    isRecord(v) &&
    isBodyVersionRefMirror(v.id) &&
    isNonEmptyString(v.bodyId) &&
    isRecord(v.version) &&
    isPositiveInteger(v.version.major) &&
    isPositiveInteger(v.version.minor) &&
    isPositiveInteger(v.version.patch) &&
    Array.isArray(v.version.prerelease) &&
    Array.isArray(v.version.build) &&
    (v.parentId === null || isBodyVersionRefMirror(v.parentId)) &&
    isRecord(v.composition) &&
    isMissionMirror(v.composition.mission) &&
    isArrayOf(v.composition.capabilities, isBodyCapabilityMirror) &&
    v.composition.capabilities.length >= 1 &&
    isIso8601(v.createdAt) &&
    isBoolean(v.certified) &&
    v.certified === false &&
    v.certificationEvidence === null
  );
}
