// @tradrl/body-execution — the execution BODY SPEC.
//
// Owning Work Order: T025: "The body spec: `EXECUTION_BODY`: structural
// mirror of @tradrl/agent-body's BodyVersion family (interop trip-wire:
// build a REAL createBodyVersion from your spec's composition and
// assert mutual guard acceptance). Mission: order-lifecycle management.
// `executionAuthority: 'external-gateway-only'` — the only L8-compliant
// mode that fits this role. Substrate compatibility stays opaque
// REQUIREMENT refs (L16a)."
//
// STRUCTURAL MIRROR of @tradrl/agent-body's BodyVersion family (law
// D-003/D-004: this package never imports it; the trip wire in
// src/interop.test.ts builds a REAL `createBodyVersion` from this spec's
// composition and asserts mutual guard acceptance). The body-version
// fields use PLAIN STRING types here (the body-forge mirror discipline)
// so the record can be JSON-round-tripped into the real factory.
//
// THE EXISTENTIAL LAWS — L8 (external execution authority) and L16
// (strategic/execution separation), in the ORDER-LANE configuration:
// the trading director (T024) decides WHAT at portfolio level on the
// strategic clock; THIS body manages the decision->order lifecycle at
// ORDER level on its own clock — preparing, monitoring, reconciling,
// escalating. Execution AUTHORITY itself stays in the external gateway:
// the EXECUTE verb in `allowedActions` is the REQUEST semantics (the
// body REQUESTS through the gateway, the gateway executes — invariant
// 6; L20: safety in code, not prompts), which is why
// `EXECUTION_AUTHORITY_MODES_MIRROR` deliberately has no
// model-autonomous member and this spec never invents one.
// `validateExecutionBody` rejects, as TYPED ERRORS:
//   - EXECUTE in allowedActions with executionAuthority NOT
//     'external-gateway-only'      (execution_authority_granted — the
//     researchers' pairing law, kept: EXECUTE claims require the
//     gateway mode)
//   - executionAuthority outside the closed mirror set — in
//     particular any model-autonomous claim (execution_authority_granted)
//   - executionAuthority 'none' on the reference role (this body's
//     role REQUIRES the gateway-ref mode — the validator says so)
//   - EXECUTE in prohibitedActions (execute_prohibited — the
//     gateway-request action may not be prohibited)
//   - a consequential (venue-direct) tool in a procedure
//     (consequential_tool_in_procedure)
//   - a tool outside the allowed policy               (forbidden_tool_in_procedure)
//   - a non-order-lifecycle capability category       (non_execution_capability)
//   - a strategic clock declaration                   (clock_confusion — L16)
//   - a strategic-level authority-scope claim         (strategic_level_control — L16)
//   - a reserved kernel publication topic             (reserved_publication_topic)
//   - a model identity as evaluation evidence         (model_identity_as_evidence — L16a)
//
// L2: the spec references substrate compatibility REQUIREMENTS; no model
// identity appears as suitability evidence anywhere in the record.
//
// The spec is AUTHORED, not forged (T017 owns forging): `certified` is
// deliberately false with null evidence here; certification is the
// verification lane's verdict, never a self-declaration.

import {
  type ISO8601,
  type SemVer,
  deepFreeze,
  isIso8601,
  isNonEmptyString,
  isNonNegativeInteger,
  isPositiveInteger,
  isRecord,
  isSemVer,
  isArrayOf,
  isMemberOf,
  stableDigestJson,
} from './primitives';
import {
  type BodyVersionRef,
  type EvaluationCriteriaRef,
  type EvidenceRef,
  type GoalRef,
  type KnowledgeSourceRef,
  type SkillArtifactRef,
  type TopicName,
  type ToolRef,
  isBodyVersionRef,
  isEvaluationCriteriaRef,
  isEvidenceRef,
  isGoalRef,
  isKnowledgeSourceRef,
  isSkillArtifactRef,
  isTopicName,
  isToolRef,
} from './ids';
import {
  type MethodRegistry,
  EXECUTION_METHOD_REGISTRY,
  isMethodRegistry,
  validateMethodRegistry,
} from './methods';
import { type ExecutionBodyError, type ExecutionBodyValidation, invalidField, invalidType, validationOf } from './errors';

// ---------------------------------------------------------------------------
// Agent-body vocabulary mirrors (closed — kind-for-kind with T003)
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

/**
 * The execution authority modes — deliberately NO `model-autonomous`
 * (L8/L20). `external-gateway-only` is the ONLY L8-compliant mode that
 * fits this role: the body may REQUEST execution through the external
 * authority gateway; the gateway executes (T040's lane).
 */
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

/** Guard: an evaluation layer. */
export const isEvaluationLayerMirror = (v: unknown): v is EvaluationLayerMirror =>
  isMemberOf(EVALUATION_LAYERS_MIRROR, v);

/** The fidelity modes (mirror of agent-body). */
export const FIDELITY_MODES_MIRROR = [
  'exact-replay',
  'reactive-replay',
  'counterfactual-generative',
] as const;

/** A fidelity mode. */
export type FidelityModeMirror = (typeof FIDELITY_MODES_MIRROR)[number];

/** Guard: a fidelity mode. */
export const isFidelityModeMirror = (v: unknown): v is FidelityModeMirror =>
  isMemberOf(FIDELITY_MODES_MIRROR, v);

/** The procedure triggers (mirror of agent-body). */
export const PROCEDURE_TRIGGERS_MIRROR = ['scheduled', 'event', 'on-demand', 'escalation'] as const;

/** A procedure trigger. */
export type ProcedureTriggerMirror = (typeof PROCEDURE_TRIGGERS_MIRROR)[number];

/** Guard: a procedure trigger. */
export const isProcedureTriggerMirror = (v: unknown): v is ProcedureTriggerMirror =>
  isMemberOf(PROCEDURE_TRIGGERS_MIRROR, v);

/** The planning styles (mirror of agent-body). */
export const PLANNING_STYLES_MIRROR = ['reactive', 'deliberative', 'hybrid'] as const;

/** A planning style. */
export type PlanningStyleMirror = (typeof PLANNING_STYLES_MIRROR)[number];

/** Guard: a planning style. */
export const isPlanningStyleMirror = (v: unknown): v is PlanningStyleMirror =>
  isMemberOf(PLANNING_STYLES_MIRROR, v);

/** The substrate modalities (mirror of agent-body). */
export const MODALITIES_MIRROR = ['text', 'image', 'audio', 'video'] as const;

/** A substrate modality. */
export type ModalityMirror = (typeof MODALITIES_MIRROR)[number];

/** Guard: a substrate modality. */
export const isModalityMirror = (v: unknown): v is ModalityMirror =>
  isMemberOf(MODALITIES_MIRROR, v);

/** The requirement levels (mirror of agent-body). */
export const REQUIREMENT_LEVELS_MIRROR = ['required', 'optional'] as const;

/** A requirement level. */
export type RequirementLevelMirror = (typeof REQUIREMENT_LEVELS_MIRROR)[number];

/** Guard: a requirement level. */
export const isRequirementLevelMirror = (v: unknown): v is RequirementLevelMirror =>
  isMemberOf(REQUIREMENT_LEVELS_MIRROR, v);

/** The substitution test results (mirror of agent-body). */
export const SUBSTITUTION_TEST_RESULTS_MIRROR = ['pass', 'fail', 'conditional'] as const;

/** A substitution test result. */
export type SubstitutionTestResultMirror = (typeof SUBSTITUTION_TEST_RESULTS_MIRROR)[number];

/** Guard: a substitution test result. */
export const isSubstitutionTestResultMirror = (v: unknown): v is SubstitutionTestResultMirror =>
  isMemberOf(SUBSTITUTION_TEST_RESULTS_MIRROR, v);

// ---------------------------------------------------------------------------
// The body-composition mirrors (field-for-field with T003)
// ---------------------------------------------------------------------------

/** Mission: summary, opaque goal refs, standing directives. */
export interface MissionMirror {
  readonly summary: string;
  readonly goalRefs: readonly GoalRef[];
  readonly standingDirectives: readonly string[];
}

/** A composed capability, citing opaque skill-artifact refs (T017 lane). */
export interface BodyCapabilityMirror {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly skillArtifactRefs: readonly SkillArtifactRef[];
  readonly critical: boolean;
}

/** Knowledge & tool policy (declarative). */
export interface KnowledgeToolPolicyMirror {
  readonly allowedTools: readonly ToolRef[];
  readonly forbiddenTools: readonly ToolRef[];
  readonly toolCallBudgetPerDecision: number | null;
  readonly allowedKnowledgeSources: readonly KnowledgeSourceRef[];
  readonly forbiddenKnowledgeSources: readonly KnowledgeSourceRef[];
}

/** One step of a procedure. */
export interface ProcedureStepMirror {
  readonly id: string;
  readonly description: string;
  readonly toolRefs: readonly ToolRef[];
  readonly approvalRequired: boolean;
}

/** A named procedure/playbook. */
export interface BodyProcedureMirror {
  readonly id: string;
  readonly name: string;
  readonly trigger: ProcedureTriggerMirror;
  readonly steps: readonly ProcedureStepMirror[];
}

/** Planning policy. */
export interface PlanningPolicyMirror {
  readonly style: PlanningStyleMirror;
  readonly maxPlanDepth: number;
  readonly replanTriggers: readonly string[];
}

/** Delegation policy. */
export interface DelegationPolicyMirror {
  readonly canDelegate: boolean;
  readonly maxDelegationDepth: number;
  readonly delegateeCategories: readonly string[];
  readonly escalationCategories: readonly string[];
}

/** Authority/safety boundary (declarative; enforcement is external). */
export interface AuthorityBoundaryMirror {
  readonly allowedActions: readonly AgentActionNameMirror[];
  readonly prohibitedActions: readonly AgentActionNameMirror[];
  readonly approvalRequiredActions: readonly AgentActionNameMirror[];
  readonly executionAuthority: ExecutionAuthorityModeMirror;
  readonly riskPolicyRef: string | null;
}

/** Evaluation/environment requirements. */
export interface EvaluationEnvironmentRequirementsMirror {
  readonly requiredEvaluationLayers: readonly EvaluationLayerMirror[];
  readonly requiredEnvironmentFeatures: readonly string[];
  readonly requiredDataCategories: readonly string[];
  readonly requiredFidelityModes: readonly FidelityModeMirror[];
}

/** Substrate requirements (opaque capability floors). */
export interface SubstrateRequirementsMirror {
  readonly minContextWindowTokens: number;
  readonly minMaxOutputTokens: number;
  readonly requiredInputModalities: readonly ModalityMirror[];
  readonly requiredOutputModalities: readonly ModalityMirror[];
  readonly toolUse: RequirementLevelMirror;
  readonly structuredOutput: RequirementLevelMirror;
}

/** Substrate constraints (opaque substitution classes / cost / latency). */
export interface SubstrateConstraintsMirror {
  readonly allowedSubstitutionClasses: readonly string[] | null;
  readonly maxInputCostPerMTokens: number | null;
  readonly maxOutputCostPerMTokens: number | null;
  readonly maxP95LatencyMs: number | null;
}

/** A tested substrate record (compatibility test result — NOT suitability evidence). */
export interface TestedSubstrateRecordMirror {
  readonly substrate: string;
  readonly result: SubstitutionTestResultMirror;
  readonly testedAt: ISO8601;
  readonly evidence: EvidenceRef;
  readonly notes: string | null;
}

/** The substrate compatibility manifest. */
export interface SubstrateCompatibilityManifestMirror {
  readonly requirements: SubstrateRequirementsMirror;
  readonly constraints: SubstrateConstraintsMirror;
  readonly testedSubstrates: readonly TestedSubstrateRecordMirror[];
}

/** The capability composition (L2: substrate-independent). */
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

/** Certification evidence (the verification lane's record). */
export interface CertificationEvidenceMirror {
  readonly evidenceRefs: readonly EvidenceRef[];
  readonly evaluationRefs: readonly EvidenceRef[];
  readonly certifiedBy: string;
  readonly certifiedAt: ISO8601;
  readonly summary: string;
}

/** A body version — the immutable capability composition snapshot. */
export interface BodyVersionMirror {
  readonly id: string;
  readonly bodyId: string;
  readonly version: SemVer;
  readonly parentId: string | null;
  readonly composition: BodyCompositionMirror;
  readonly createdAt: ISO8601;
  readonly certified: boolean;
  readonly certificationEvidence: CertificationEvidenceMirror | null;
}

// -- mirror guards ------------------------------------------------------------

/** Guard: `MissionMirror`. */
export function isMissionMirror(v: unknown): v is MissionMirror {
  return (
    isRecord(v) &&
    isNonEmptyString(v.summary) &&
    isArrayOf(v.goalRefs, isGoalRef) &&
    isArrayOf(v.standingDirectives, isNonEmptyString)
  );
}

/** Guard: `BodyCapabilityMirror`. */
export function isBodyCapabilityMirror(v: unknown): v is BodyCapabilityMirror {
  return (
    isRecord(v) &&
    isNonEmptyString(v.id) &&
    isNonEmptyString(v.name) &&
    isNonEmptyString(v.description) &&
    isNonEmptyString(v.category) &&
    isArrayOf(v.skillArtifactRefs, isSkillArtifactRef) &&
    typeof v.critical === 'boolean'
  );
}

/** Guard: `KnowledgeToolPolicyMirror`. */
export function isKnowledgeToolPolicyMirror(v: unknown): v is KnowledgeToolPolicyMirror {
  return (
    isRecord(v) &&
    isArrayOf(v.allowedTools, isToolRef) &&
    isArrayOf(v.forbiddenTools, isToolRef) &&
    (v.toolCallBudgetPerDecision === null || isNonNegativeInteger(v.toolCallBudgetPerDecision)) &&
    isArrayOf(v.allowedKnowledgeSources, isKnowledgeSourceRef) &&
    isArrayOf(v.forbiddenKnowledgeSources, isKnowledgeSourceRef)
  );
}

/** Guard: `ProcedureStepMirror`. */
export function isProcedureStepMirror(v: unknown): v is ProcedureStepMirror {
  return (
    isRecord(v) &&
    isNonEmptyString(v.id) &&
    isNonEmptyString(v.description) &&
    isArrayOf(v.toolRefs, isToolRef) &&
    typeof v.approvalRequired === 'boolean'
  );
}

/** Guard: `BodyProcedureMirror`. */
export function isBodyProcedureMirror(v: unknown): v is BodyProcedureMirror {
  return (
    isRecord(v) &&
    isNonEmptyString(v.id) &&
    isNonEmptyString(v.name) &&
    isProcedureTriggerMirror(v.trigger) &&
    isArrayOf(v.steps, isProcedureStepMirror) &&
    (v.steps as readonly unknown[]).length > 0
  );
}

/** Guard: `PlanningPolicyMirror`. */
export function isPlanningPolicyMirror(v: unknown): v is PlanningPolicyMirror {
  return (
    isRecord(v) &&
    isPlanningStyleMirror(v.style) &&
    isPositiveInteger(v.maxPlanDepth) &&
    isArrayOf(v.replanTriggers, isNonEmptyString)
  );
}

/** Guard: `DelegationPolicyMirror`. */
export function isDelegationPolicyMirror(v: unknown): v is DelegationPolicyMirror {
  return (
    isRecord(v) &&
    typeof v.canDelegate === 'boolean' &&
    isNonNegativeInteger(v.maxDelegationDepth) &&
    isArrayOf(v.delegateeCategories, isNonEmptyString) &&
    isArrayOf(v.escalationCategories, isNonEmptyString)
  );
}

/** Guard: `AuthorityBoundaryMirror`. */
export function isAuthorityBoundaryMirror(v: unknown): v is AuthorityBoundaryMirror {
  return (
    isRecord(v) &&
    isArrayOf(v.allowedActions, isAgentActionNameMirror) &&
    isArrayOf(v.prohibitedActions, isAgentActionNameMirror) &&
    isArrayOf(v.approvalRequiredActions, isAgentActionNameMirror) &&
    isExecutionAuthorityModeMirror(v.executionAuthority) &&
    (v.riskPolicyRef === null || isNonEmptyString(v.riskPolicyRef))
  );
}

/** Guard: `EvaluationEnvironmentRequirementsMirror`. */
export function isEvaluationEnvironmentRequirementsMirror(v: unknown): v is EvaluationEnvironmentRequirementsMirror {
  return (
    isRecord(v) &&
    isArrayOf(v.requiredEvaluationLayers, isEvaluationLayerMirror) &&
    isArrayOf(v.requiredEnvironmentFeatures, isNonEmptyString) &&
    isArrayOf(v.requiredDataCategories, isNonEmptyString) &&
    isArrayOf(v.requiredFidelityModes, isFidelityModeMirror)
  );
}

/** Guard: `SubstrateRequirementsMirror`. */
export function isSubstrateRequirementsMirror(v: unknown): v is SubstrateRequirementsMirror {
  return (
    isRecord(v) &&
    isNonNegativeInteger(v.minContextWindowTokens) &&
    isNonNegativeInteger(v.minMaxOutputTokens) &&
    isArrayOf(v.requiredInputModalities, isModalityMirror) &&
    isArrayOf(v.requiredOutputModalities, isModalityMirror) &&
    isRequirementLevelMirror(v.toolUse) &&
    isRequirementLevelMirror(v.structuredOutput)
  );
}

/** Guard: `SubstrateConstraintsMirror`. */
export function isSubstrateConstraintsMirror(v: unknown): v is SubstrateConstraintsMirror {
  return (
    isRecord(v) &&
    (v.allowedSubstitutionClasses === null || isArrayOf(v.allowedSubstitutionClasses, isNonEmptyString)) &&
    (v.maxInputCostPerMTokens === null || isNonNegativeInteger(v.maxInputCostPerMTokens)) &&
    (v.maxOutputCostPerMTokens === null || isNonNegativeInteger(v.maxOutputCostPerMTokens)) &&
    (v.maxP95LatencyMs === null || isNonNegativeInteger(v.maxP95LatencyMs))
  );
}

/** Guard: `TestedSubstrateRecordMirror`. */
export function isTestedSubstrateRecordMirror(v: unknown): v is TestedSubstrateRecordMirror {
  return (
    isRecord(v) &&
    isNonEmptyString(v.substrate) &&
    isSubstitutionTestResultMirror(v.result) &&
    isIso8601(v.testedAt) &&
    isEvidenceRef(v.evidence) &&
    (v.notes === null || isNonEmptyString(v.notes))
  );
}

/** Guard: `SubstrateCompatibilityManifestMirror`. */
export function isSubstrateCompatibilityManifestMirror(v: unknown): v is SubstrateCompatibilityManifestMirror {
  return (
    isRecord(v) &&
    isSubstrateRequirementsMirror(v.requirements) &&
    isSubstrateConstraintsMirror(v.constraints) &&
    isArrayOf(v.testedSubstrates, isTestedSubstrateRecordMirror)
  );
}

/** Guard: `BodyCompositionMirror`. */
export function isBodyCompositionMirror(v: unknown): v is BodyCompositionMirror {
  return (
    isRecord(v) &&
    isMissionMirror(v.mission) &&
    isArrayOf(v.capabilities, isBodyCapabilityMirror) &&
    (v.capabilities as readonly unknown[]).length > 0 &&
    isKnowledgeToolPolicyMirror(v.knowledgeToolPolicy) &&
    isArrayOf(v.procedures, isBodyProcedureMirror) &&
    isPlanningPolicyMirror(v.planningPolicy) &&
    isDelegationPolicyMirror(v.delegationPolicy) &&
    isAuthorityBoundaryMirror(v.authorityBoundary) &&
    isEvaluationEnvironmentRequirementsMirror(v.evaluationEnvironment) &&
    isSubstrateCompatibilityManifestMirror(v.substrateCompatibility)
  );
}

/** Guard: `BodyVersionMirror`. */
export function isBodyVersionMirror(v: unknown): v is BodyVersionMirror {
  return (
    isRecord(v) &&
    isNonEmptyString(v.id) &&
    isNonEmptyString(v.bodyId) &&
    isSemVer(v.version) &&
    (v.parentId === null || isNonEmptyString(v.parentId)) &&
    isBodyCompositionMirror(v.composition) &&
    isIso8601(v.createdAt) &&
    typeof v.certified === 'boolean' &&
    (v.certified ? v.certificationEvidence !== null : v.certificationEvidence === null) &&
    (v.certificationEvidence === null || isRecord(v.certificationEvidence))
  );
}

// ---------------------------------------------------------------------------
// The execution declaration (this lane's extension of the composition)
// ---------------------------------------------------------------------------

/**
 * THE L8/L16 AUTHORITY SCOPE RECORD: the order-lane declaration. The
 * values are fixed by law — any edit granting strategic control,
 * venue-direct placement, order routing (T040's chokepoint), position
 * management or fill/cancel fabrication is a typed validation error.
 */
export interface ExecutionAuthorityScope {
  /** What the body may do: order-lifecycle management. Nothing else. */
  readonly scope: 'order-lifecycle-management';
  /** Execution REQUESTS go through the external gateway ONLY — the gateway executes (L8/L20, invariant 6). */
  readonly executionRequest: 'gateway-request-only';
  /** Venue-direct placement: prohibited (L8 — the venue binding is the gateway lane's). */
  readonly venueDirectPlacement: 'prohibited';
  /** Order routing: prohibited (T040's chokepoint — this body only prepares and monitors). */
  readonly orderRouting: 'prohibited';
  /** Position management: prohibited (the portfolio lane's). */
  readonly positionManagement: 'prohibited';
  /** Strategic-level control: prohibited (L16 — the trading director's clock and authority). */
  readonly strategicLevelControl: 'prohibited';
  /** Fabricating a fill: prohibited (the monitoring law). */
  readonly fillFabrication: 'prohibited';
  /** Fabricating a cancel: prohibited (the monitoring law). */
  readonly cancelFabrication: 'prohibited';
}

/** Guard: `ExecutionAuthorityScope`. */
export function isExecutionAuthorityScope(v: unknown): v is ExecutionAuthorityScope {
  if (!isRecord(v)) return false;
  return (
    v.scope === 'order-lifecycle-management' &&
    v.executionRequest === 'gateway-request-only' &&
    v.venueDirectPlacement === 'prohibited' &&
    v.orderRouting === 'prohibited' &&
    v.positionManagement === 'prohibited' &&
    v.strategicLevelControl === 'prohibited' &&
    v.fillFabrication === 'prohibited' &&
    v.cancelFabrication === 'prohibited'
  );
}

/**
 * THE L16 CLOCK DECLARATION: the execution body runs on the ORDER-LEVEL
 * clock. Strategic-level control (the T024 director) runs on a
 * different clock — this field exists so a body spec that tries to
 * declare the strategic cadence fails validation with the typed
 * `clock_confusion` error.
 */
export const EXECUTION_CLOCKS = ['order-level'] as const;

/** A declared order-lifecycle clock. */
export type ExecutionClock = (typeof EXECUTION_CLOCKS)[number];

/** Guard: a declared execution clock. */
export const isExecutionClock = (v: unknown): v is ExecutionClock =>
  isMemberOf(EXECUTION_CLOCKS, v);

/**
 * The declared order-lane topics: the director-decision topic and the
 * gateway-verdict topic this body SUBSCRIBEs to, and the
 * lifecycle-report and escalation topics it PUBLISHes/REPORTs to.
 */
export interface ExecutionTopicMap {
  /** The organization topic the T024 director's decisions arrive on (SUBSCRIBE — consumed as opaque refs, L16). */
  readonly directorDecisions: TopicName;
  /** The organization topic the gateway's verdicts arrive on (SUBSCRIBE). */
  readonly gatewayVerdicts: TopicName;
  /** The organization topic lifecycle facts are reported to (PUBLISH/REPORT — the body reports lifecycle facts upstream; it never publishes order authority). */
  readonly lifecycleReports: TopicName;
  /** The organization topic escalation records are published to (ESCALATE). */
  readonly escalations: TopicName;
}

/** Guard: `ExecutionTopicMap`. */
export function isExecutionTopicMap(v: unknown): v is ExecutionTopicMap {
  if (!isRecord(v)) return false;
  return (
    isTopicName(v.directorDecisions) &&
    isTopicName(v.gatewayVerdicts) &&
    isTopicName(v.lifecycleReports) &&
    isTopicName(v.escalations)
  );
}

/**
 * The execution-body-specific declaration: the method registry the body
 * runs, the order-lane topics, the opaque evaluation criteria its
 * outputs are judged by, the opaque substrate REQUIREMENT refs
 * (L2/L16a), the L8/L16 authority scope record, and the L16 order-level
 * clock declaration.
 */
export interface ExecutionDeclaration {
  /** The closed method registry this body may run (method honesty). */
  readonly methodRegistry: MethodRegistry;
  /** The order-lane organization topics. */
  readonly topics: ExecutionTopicMap;
  /** Opaque evaluation-criteria refs (the T012 lane judges these outputs). */
  readonly evaluationCriteriaRefs: readonly EvaluationCriteriaRef[];
  /**
   * Opaque substrate REQUIREMENT refs (L2/L16a). These are requirement
   * citations, NEVER model identities offered as suitability evidence.
   */
  readonly substrateRequirements: readonly string[];
  /** The L8/L16 authority scope record (order-lane — fixed by law). */
  readonly authorityScope: ExecutionAuthorityScope;
  /** The L16 clock declaration (order-level — the strategic clock is the director's). */
  readonly clock: ExecutionClock;
}

/** Guard: `ExecutionDeclaration` (structure only — use the validator for the laws). */
export function isExecutionDeclaration(v: unknown): v is ExecutionDeclaration {
  return (
    isRecord(v) &&
    isMethodRegistry(v.methodRegistry) &&
    isExecutionTopicMap(v.topics) &&
    isArrayOf(v.evaluationCriteriaRefs, isEvaluationCriteriaRef) &&
    isArrayOf(v.substrateRequirements, isNonEmptyString) &&
    isExecutionAuthorityScope(v.authorityScope) &&
    isExecutionClock(v.clock)
  );
}

/** The full execution body spec: a BodyVersion mirror + the declaration. */
export interface ExecutionBodySpec {
  readonly bodyVersion: BodyVersionMirror;
  readonly execution: ExecutionDeclaration;
}

// ---------------------------------------------------------------------------
// L16a helper: model-identity detection in evidence positions
// ---------------------------------------------------------------------------

const SUBSTRATE_REF_SHAPE = /^[^\s/@]{1,128}\/[^\s/@]{1,128}@[^\s/@]{1,128}$/;

/**
 * `true` when a reference is shaped like a canonical substrate identity
 * (`provider/modelId@modelVersion`). A reference in an EVIDENCE position
 * with this shape is an L16a violation: a model identity is being
 * offered as evidence of decision quality. (Substrate refs are legal
 * ONLY in the compatibility manifest's `testedSubstrates` — as
 * compatibility TEST records, not as suitability evidence.)
 */
export function looksLikeModelIdentity(ref: string): boolean {
  return SUBSTRATE_REF_SHAPE.test(ref);
}

// ---------------------------------------------------------------------------
// Validation (collect-all — every law, every violation)
// ---------------------------------------------------------------------------

/**
 * COLLECT-ALL validation of an execution body spec against the full law
 * set: body-version structure and semantics (the mirrored T003
 * invariants), the L8 external-gateway authority (the existential law
 * for this role, in the ORDER-LANE configuration: EXECUTE is the
 * REQUEST semantics and REQUIRES the external-gateway-only pairing),
 * the L16 strategic/execution separation (the order-level clock; no
 * strategic-level control), the L16a model-identity ban in evidence
 * positions, method registry honesty, and the declaration's own laws.
 */
export function validateExecutionBody(v: unknown): readonly ExecutionBodyError[] {
  const errors: ExecutionBodyError[] = [];
  if (!isRecord(v)) return [invalidType('body', 'an execution body spec')];
  if (!isBodyVersionMirror(v.bodyVersion)) {
    if (!isRecord(v.bodyVersion)) {
      errors.push(invalidType('bodyVersion', 'a body-version mirror record'));
    } else {
      errors.push(invalidField('bodyVersion', 'must satisfy the agent-body BodyVersion mirror shape'));
    }
  }
  const execution: unknown = v.execution;
  if (!isRecord(execution)) {
    errors.push(invalidType('execution', 'an execution declaration'));
    return errors;
  }

  const body = isBodyVersionMirror(v.bodyVersion) ? (v.bodyVersion as BodyVersionMirror) : null;

  // THE OUT-OF-SET MODE CHECK runs on the RAW field — even when the
  // mirror guard failed structurally (a doctored spec claiming a
  // model-autonomous mode fails the mirror AND the explicit law):
  // executionAuthority outside {none, external-gateway-only} — in
  // particular any model-autonomous claim — is a typed error.
  if (
    isRecord(v.bodyVersion) &&
    isRecord((v.bodyVersion as Record<string, unknown>).composition) &&
    isRecord(((v.bodyVersion as Record<string, unknown>).composition as Record<string, unknown>).authorityBoundary)
  ) {
    const rawMode = (((v.bodyVersion as Record<string, unknown>).composition as Record<string, unknown>).authorityBoundary as Record<string, unknown>).executionAuthority;
    if (typeof rawMode === 'string' && rawMode !== 'none' && rawMode !== 'external-gateway-only') {
      errors.push({
        code: 'execution_authority_granted',
        path: 'bodyVersion.composition.authorityBoundary.executionAuthority',
        message: `executionAuthority ${JSON.stringify(rawMode)} is outside the closed mode set {'none','external-gateway-only'} — in particular, any model-autonomous claim is a typed error (L8/L20: EXECUTION_AUTHORITY_MODES has no model-autonomous member by design)`,
      });
    }
  }

  if (body !== null) {
    // canonical id law (mirrored T003 invariant)
    const versionText = `${body.version.major}.${body.version.minor}.${body.version.patch}`;
    const expectedId = `${body.bodyId}@${versionText}`;
    if (body.id !== expectedId) {
      errors.push(invalidField('bodyVersion.id', `must be the canonical identity ${expectedId}`));
    }
    // unique capability ids (mirrored T003 invariant)
    const capabilityIds = body.composition.capabilities.map((capability) => capability.id);
    if (new Set(capabilityIds).size !== capabilityIds.length) {
      errors.push(invalidField('bodyVersion.composition.capabilities', 'capability ids must be unique'));
    }
    // allowed/forbidden tool disjointness (mirrored T003 invariant)
    const allowedTools = new Set(body.composition.knowledgeToolPolicy.allowedTools);
    for (const tool of body.composition.knowledgeToolPolicy.forbiddenTools) {
      if (allowedTools.has(tool)) {
        errors.push(invalidField('bodyVersion.composition.knowledgeToolPolicy', 'a tool cannot be both allowed and forbidden'));
      }
    }
    const allowedSources = new Set(body.composition.knowledgeToolPolicy.allowedKnowledgeSources);
    for (const source of body.composition.knowledgeToolPolicy.forbiddenKnowledgeSources) {
      if (allowedSources.has(source)) {
        errors.push(invalidField('bodyVersion.composition.knowledgeToolPolicy', 'a knowledge source cannot be both allowed and forbidden'));
      }
    }
    // procedure + step uniqueness, >= 1 step (mirrored T003 invariants)
    const procedureIds = body.composition.procedures.map((procedure) => procedure.id);
    if (new Set(procedureIds).size !== procedureIds.length) {
      errors.push(invalidField('bodyVersion.composition.procedures', 'procedure ids must be unique'));
    }
    for (const procedure of body.composition.procedures) {
      const stepIds = procedure.steps.map((step) => step.id);
      if (new Set(stepIds).size !== stepIds.length) {
        errors.push(invalidField(`bodyVersion.composition.procedures.${procedure.id}.steps`, 'step ids must be unique'));
      }
    }
    // delegation depth law (mirrored T003 invariant)
    if (!body.composition.delegationPolicy.canDelegate && body.composition.delegationPolicy.maxDelegationDepth !== 0) {
      errors.push(invalidField('bodyVersion.composition.delegationPolicy', 'maxDelegationDepth must be 0 when canDelegate is false'));
    }
    // action-set laws (mirrored T003 invariants)
    const allowed = new Set(body.composition.authorityBoundary.allowedActions);
    for (const action of body.composition.authorityBoundary.prohibitedActions) {
      if (allowed.has(action)) {
        errors.push(invalidField('bodyVersion.composition.authorityBoundary', 'an action cannot be both allowed and prohibited'));
      }
    }
    for (const action of body.composition.authorityBoundary.approvalRequiredActions) {
      if (!allowed.has(action)) {
        errors.push(invalidField('bodyVersion.composition.authorityBoundary', 'approval-required actions must be allowed'));
      }
    }
    // THE T003 EXECUTE <=> external-gateway-only law, mirrored (bidirectional)
    const executeAllowed = allowed.has('EXECUTE');
    if (executeAllowed && body.composition.authorityBoundary.executionAuthority !== 'external-gateway-only') {
      errors.push(invalidField('bodyVersion.composition.authorityBoundary.executionAuthority', 'EXECUTE in allowedActions requires external-gateway-only (L8/L20)'));
    }
    if (!executeAllowed && body.composition.authorityBoundary.executionAuthority === 'external-gateway-only') {
      errors.push(invalidField('bodyVersion.composition.authorityBoundary.executionAuthority', 'external-gateway-only is only meaningful when EXECUTE is in allowedActions'));
    }

    // ---------------------------------------------------------------------
    // THE L8 LAWS (this lane's existential declaration — the order-lane
    // configuration: EXECUTE is the gateway REQUEST, the pairing is law)
    // ---------------------------------------------------------------------
    if (executeAllowed && body.composition.authorityBoundary.executionAuthority !== 'external-gateway-only') {
      errors.push({
        code: 'execution_authority_granted',
        path: 'bodyVersion.composition.authorityBoundary.allowedActions',
        message: 'EXECUTE in allowedActions requires the external-gateway-only pairing: even here, the body REQUESTS through the gateway, the gateway executes (invariant 6; L20: safety in code, not prompts)',
      });
    }
    if (!isExecutionAuthorityModeMirror(body.composition.authorityBoundary.executionAuthority)) {
      errors.push({
        code: 'execution_authority_granted',
        path: 'bodyVersion.composition.authorityBoundary.executionAuthority',
        message: `executionAuthority ${JSON.stringify(body.composition.authorityBoundary.executionAuthority)} is outside the closed mode set {'none','external-gateway-only'} — in particular, any model-autonomous claim is a typed error (L8/L20: EXECUTION_AUTHORITY_MODES has no model-autonomous member by design)`,
      });
    } else if (body.composition.authorityBoundary.executionAuthority !== 'external-gateway-only') {
      errors.push({
        code: 'execution_authority_granted',
        path: 'bodyVersion.composition.authorityBoundary.executionAuthority',
        message: 'executionAuthority "none" on the execution body\'s reference spec is a declaration error — this body\'s role REQUIRES the gateway-ref mode (external-gateway-only); the researchers\' "none" mode is for read-only lanes, never this one',
      });
    }
    if (body.composition.authorityBoundary.prohibitedActions.includes('EXECUTE')) {
      errors.push({
        code: 'execute_prohibited',
        path: 'bodyVersion.composition.authorityBoundary.prohibitedActions',
        message: 'EXECUTE must be ABSENT from prohibitedActions — the gateway-request action is this role\'s lawful EXECUTE semantics; prohibiting it contradicts the external-gateway-only declaration (L8)',
      });
    }
    // consequential tools must not appear in any procedure step
    for (const procedure of body.composition.procedures) {
      for (const step of procedure.steps) {
        for (const tool of step.toolRefs) {
          if (!allowedTools.has(tool)) {
            errors.push({
              code: 'forbidden_tool_in_procedure',
              path: `bodyVersion.composition.procedures.${procedure.id}.steps.${step.id}.toolRefs`,
              message: `step cites tool ${JSON.stringify(tool)} which is not in the allowed tool policy`,
            });
          }
          if (isConsequentialToolName(tool)) {
            errors.push({
              code: 'consequential_tool_in_procedure',
              path: `bodyVersion.composition.procedures.${procedure.id}.steps.${step.id}.toolRefs`,
              message: `step cites consequential tool ${JSON.stringify(tool)} — a venue-direct/transmitting tool is the gateway lane\'s (T040); this body only prepares and monitors (L8/L16)`,
            });
          }
        }
      }
    }
    // capabilities must be order-lifecycle-category (the order-lane declaration)
    for (const capability of body.composition.capabilities) {
      if (capability.category !== 'order-lifecycle') {
        errors.push({
          code: 'non_execution_capability',
          path: `bodyVersion.composition.capabilities.${capability.id}.category`,
          message: `capability ${JSON.stringify(capability.id)} declares category ${JSON.stringify(capability.category)} — every execution-body capability is order-lifecycle-category (L8/L16)`,
        });
      }
    }
  }

  // declaration laws
  if (!isMethodRegistry(execution.methodRegistry)) {
    errors.push(...validateMethodRegistry(execution.methodRegistry).map((e) => ({ ...e, path: `execution.methodRegistry.${e.path}` })));
  }
  if (!isExecutionTopicMap(execution.topics)) {
    errors.push(invalidField('execution.topics', 'must declare the four order-lane topics (directorDecisions, gatewayVerdicts, lifecycleReports, escalations)'));
  } else {
    for (const [name, topic] of [
      ['directorDecisions', execution.topics.directorDecisions],
      ['gatewayVerdicts', execution.topics.gatewayVerdicts],
      ['lifecycleReports', execution.topics.lifecycleReports],
      ['escalations', execution.topics.escalations],
    ] as const) {
      if (topic.startsWith('kernel.')) {
        errors.push({
          code: 'reserved_publication_topic',
          path: `execution.topics.${name}`,
          message: 'kernel.* topics are reserved for directed kernel mail — the execution body uses organization topics only',
        });
      }
    }
  }
  if (!Array.isArray(execution.evaluationCriteriaRefs) || (execution.evaluationCriteriaRefs as readonly unknown[]).length === 0) {
    errors.push(invalidField('execution.evaluationCriteriaRefs', 'lifecycle quality is EVALUATED — at least one criteria ref must be cited (never self-declared)'));
  } else {
    for (const ref of execution.evaluationCriteriaRefs as readonly unknown[]) {
      if (!isEvaluationCriteriaRef(ref)) {
        errors.push(invalidField('execution.evaluationCriteriaRefs', `invalid criteria ref ${JSON.stringify(ref)}`));
      } else if (looksLikeModelIdentity(ref)) {
        // THE L16a LAW: a model identity offered as evaluation evidence.
        errors.push({
          code: 'model_identity_as_evidence',
          path: 'execution.evaluationCriteriaRefs',
          message: `criteria ref ${JSON.stringify(ref)} is shaped like a model identity — model identities never establish suitability (L16a/L2)`,
        });
      }
    }
  }
  if (!Array.isArray(execution.substrateRequirements) || (execution.substrateRequirements as readonly unknown[]).length === 0) {
    errors.push(invalidField('execution.substrateRequirements', 'substrate compatibility must cite requirement refs (L2)'));
  } else {
    for (const ref of execution.substrateRequirements as readonly unknown[]) {
      if (!isNonEmptyString(ref)) {
        errors.push(invalidField('execution.substrateRequirements', `invalid requirement ref ${JSON.stringify(ref)}`));
      }
    }
  }
  if (!isExecutionAuthorityScope(execution.authorityScope)) {
    // distinguish the L16 edit (strategic-level control) from the L8 edits
    const scope = execution.authorityScope;
    if (isRecord(scope) && scope.strategicLevelControl !== undefined && scope.strategicLevelControl !== 'prohibited') {
      errors.push({
        code: 'strategic_level_control',
        path: 'execution.authorityScope',
        message: 'the L16 authority scope record is fixed by law: strategic-level control is the trading director\'s (T024) — this body never decides WHAT at portfolio level',
      });
    } else if (isRecord(scope) && (scope.fillFabrication === 'permitted' || scope.cancelFabrication === 'permitted' || scope.fabricatedTerminalStates === 'permitted')) {
      errors.push({
        code: 'execution_authority_granted',
        path: 'execution.authorityScope',
        message: 'the monitoring law is fixed: fabricating fills or cancels is prohibited — a thrown switch escalates and records, never fabricates',
      });
    } else {
      errors.push({
        code: 'execution_authority_granted',
        path: 'execution.authorityScope',
        message: 'the L8 authority scope record is fixed by law: order-lifecycle-management only; execution requests are gateway-request-only; venue-direct placement, order routing (T040\'s chokepoint) and position management are prohibited',
      });
    }
  }
  if (!isExecutionClock(execution.clock)) {
    errors.push({
      code: 'clock_confusion',
      path: 'execution.clock',
      message: 'the L16 clock declaration is fixed by law: the execution body runs on the ORDER-LEVEL clock — the strategic clock is the trading director\'s (T024)',
    });
  }
  return errors;
}

/** Validation wrapper: `ExecutionBodySpec`. */
export function validateExecutionBodySpec(v: unknown): ExecutionBodyValidation<ExecutionBodySpec> {
  const errors = validateExecutionBody(v);
  return validationOf(errors.length === 0 ? (v as ExecutionBodySpec) : null, errors);
}

/**
 * `true` when a tool ref names a CONSEQUENTIAL (venue-mutating) tool:
 * placing, routing, transmitting, amending or cancelling orders
 * DIRECTLY at a venue, direct venue access, or execution routing /
 * position management. These are the gateway lane's (T040) and the
 * venue adapters' — an order-LIFECYCLE body cites none of them (this
 * body only prepares and monitors).
 */
export function isConsequentialToolName(tool: string): boolean {
  return /(place[-_]?order|order[-_]?place|route[-_]?order|order[-_]?route|transmit[-_]?order|order[-_]?transmit|amend[-_]?order|order[-_]?amend|cancel[-_]?order|order[-_]?cancel|venue[-_]?direct|direct[-_]?venue|execution[-_]?router|position[-_]?manager|order[-_]?entry)/i.test(tool);
}

// ---------------------------------------------------------------------------
// EXECUTION_BODY — the authored spec (certified: false —
// certification is the verification lane's verdict, never self-declared)
// ---------------------------------------------------------------------------

/** The body identity: `execution` (the T025 write surface's body). */
export const EXECUTION_BODY_ID = 'execution';

/** The spec version: `1.0.0` (root of this body's lineage). */
export const EXECUTION_BODY_SEMVER: SemVer = deepFreeze({
  major: 1,
  minor: 0,
  patch: 0,
  prerelease: [],
  build: [],
});

/** The canonical body-version reference of this spec. */
export const EXECUTION_BODY_VERSION_REF: BodyVersionRef = 'execution@1.0.0' as BodyVersionRef;

/**
 * THE EXECUTION BODY SPEC (the T025 order-life-cycle specialist).
 * Mission: order-lifecycle management — preparing, monitoring,
 * reconciling and escalating the decision->order lifecycle at ORDER
 * level, on the order-level clock (L16), with execution authority in
 * the external gateway (L8: EXECUTE is the gateway REQUEST; the
 * gateway executes). Capabilities: order-lane intake, order
 * preparation, lifecycle monitoring, fill reconciliation, escalation.
 * Knowledge/tool policy: read-only order-lane sources, preparation and
 * monitoring tools only (no venue-direct tools). Procedures: the
 * declared order-management cycle. Delegation: may
 * SUBSCRIBE/PUBLISH/REQUEST/REPORT/ESCALATE via the agent-os envelope
 * mirror — the REQUEST is the submission seam. Authority:
 * external-gateway-only (the L8/L16 declaration). Evaluation: judged
 * by the cited criteria refs (T012). Substrate compatibility: opaque
 * requirement refs (L2/L16a).
 */
export const EXECUTION_BODY: ExecutionBodySpec = deepFreeze({
  bodyVersion: {
    id: 'execution@1.0.0',
    bodyId: EXECUTION_BODY_ID,
    version: EXECUTION_BODY_SEMVER,
    parentId: null,
    composition: {
      mission: {
        summary:
          'Manage the decision->order lifecycle at ORDER level on the order-level clock: prepare orders from the gateway\'s APPROVED decisions, monitor acknowledgements and fills, reconcile exactly, and escalate anomalies — while execution authority itself stays in the external gateway. Strategic-level control is the trading director\'s (L16); this body never decides WHAT at portfolio level.',
        goalRefs: ['goal/order-lifecycle-management'],
        standingDirectives: [
          'Every lifecycle record carries the L16 clock marker — order-level time, a distinct field from any strategic asOf.',
          'Only the gateway\'s APPROVE decision is authority: a refusal is a record, never authority to prepare an order (L8).',
          'The body REQUESTS through the gateway; the gateway executes (invariant 6; L20: safety in code, not prompts).',
          'An undefined transition is a typed lifecycle_violation — never a silent motion.',
          'Float mediation on any quantity is the typed decimal_imprecision — exact-decimal accounting always.',
          'A stuck order escalates and records — never an exception, never a silent timeout.',
          'A thrown switch mid-flight escalates and records — never a fabricated fill or cancel.',
          'An order-management procedure without a declared, versioned method is a typed error.',
        ],
      },
      capabilities: [
        {
          id: 'order-lane-intake',
          name: 'Order-Lane Intake',
          description:
            'SUBSCRIBE to the gateway-verdict topic and the director-decision topic; accept the APPROVED decisions, gated intents, standing kill-switch state and observed limit states through the field-for-field order-lane mirrors (T019/T020/T039 shapes), enforcing the L8 approve-only authority gate and the L12 scope.',
          category: 'order-lifecycle',
          skillArtifactRefs: ['skills/execution/order-intake-v1'],
          critical: true,
        },
        {
          id: 'order-preparation',
          name: 'Order Preparation',
          description:
            'Prepare the order request from the APPROVED decision and its gated intent by the declared preparation method: the quantity carried verbatim (exact decimals), the order identity derived from the clientOrderId, the L16 order-level clock marker distinct from the decision instant.',
          category: 'order-lifecycle',
          skillArtifactRefs: ['skills/execution/order-preparation-v1'],
          critical: true,
        },
        {
          id: 'lifecycle-monitoring',
          name: 'Lifecycle Monitoring',
          description:
            'Monitor the prepared/submitted/acknowledged lifecycle against the declared deadlines: stuck detection, cancellation policy with race recording, and kill-switch mid-flight response — every outcome a record (transition, escalation or reconciliation), never an exception.',
          category: 'order-lifecycle',
          skillArtifactRefs: ['skills/execution/lifecycle-monitoring-v1'],
          critical: true,
        },
        {
          id: 'fill-reconciliation',
          name: 'Fill Reconciliation',
          description:
            'Reconcile the cumulative fills against the acknowledged quantity at exact equality (BigInt fixed-point): reconciled or the typed reconciliation_gap carrying the exact difference — one smallest-grid-step off included.',
          category: 'order-lifecycle',
          skillArtifactRefs: ['skills/execution/fill-reconciliation-v1'],
          critical: true,
        },
        {
          id: 'escalation',
          name: 'Anomaly Escalation',
          description:
            'Escalate stuck orders, reconciliation gaps, kill-switch throws and cancellation races as structured EscalationRecords (the kernel ESCALATE verb) — never an exception, never a silent timeout, never a fabricated terminal state.',
          category: 'order-lifecycle',
          skillArtifactRefs: ['skills/execution/escalation-v1'],
          critical: false,
        },
      ],
      knowledgeToolPolicy: {
        allowedTools: [
          'tools/order-lane-subscriber',
          'tools/order-request-preparer',
          'tools/execution-gateway-requester',
          'tools/order-lifecycle-monitor',
          'tools/fill-reconciler',
          'tools/escalation-publisher',
        ],
        forbiddenTools: ['tools/venue-direct-order-entry', 'tools/execution-router', 'tools/position-manager'],
        toolCallBudgetPerDecision: 24,
        allowedKnowledgeSources: [
          'knowledge/organization/gateway-verdicts',
          'knowledge/organization/director-decisions',
        ],
        forbiddenKnowledgeSources: ['knowledge/private/another-tenant'],
      },
      procedures: [
        {
          id: 'order-management-cycle',
          name: 'Execution Body Order-Management Cycle',
          trigger: 'event',
          steps: [
            {
              id: 'subscribe-verdicts',
              description: 'SUBSCRIBE to the gateway-verdict and director-decision topics; receive the typed order-lane records.',
              toolRefs: ['tools/order-lane-subscriber'],
              approvalRequired: false,
            },
            {
              id: 'intake-gate',
              description: 'Accept the APPROVED decision, gated intent, standing switch state and limit states through the field-for-field mirrors; enforce the L8 approve-only authority gate and the L12 scope.',
              toolRefs: ['tools/order-lane-subscriber'],
              approvalRequired: false,
            },
            {
              id: 'prepare',
              description: 'Prepare the order request by the declared preparation method (verbatim quantity, derived identity, the L16 order-level clock marker).',
              toolRefs: ['tools/order-request-preparer'],
              approvalRequired: false,
            },
            {
              id: 'request-submission',
              description: 'REQUEST the submission through the external execution gateway (the only submission seam — the gateway executes; the body requests).',
              toolRefs: ['tools/execution-gateway-requester'],
              approvalRequired: true,
            },
            {
              id: 'monitor',
              description: 'Monitor the lifecycle against the declared deadlines (stuck detection, cancellation policy, kill-switch mid-flight response) — every anomaly a record.',
              toolRefs: ['tools/order-lifecycle-monitor'],
              approvalRequired: false,
            },
            {
              id: 'reconcile',
              description: 'Reconcile the cumulative fills against the acknowledged quantity at exact equality; record the typed gap when they differ.',
              toolRefs: ['tools/fill-reconciler'],
              approvalRequired: false,
            },
            {
              id: 'report-and-escalate',
              description: 'REPORT lifecycle facts upstream and ESCALATE anomalies through the envelope mirror port to the organization topics.',
              toolRefs: ['tools/escalation-publisher'],
              approvalRequired: false,
            },
          ],
        },
        {
          id: 'escalation',
          name: 'Anomaly Escalation',
          trigger: 'escalation',
          steps: [
            {
              id: 'escalate-anomaly',
              description: 'Escalate a stuck order, reconciliation gap, kill-switch throw or cancellation race as the structured escalation record to the escalation topic.',
              toolRefs: ['tools/escalation-publisher'],
              approvalRequired: true,
            },
          ],
        },
      ],
      planningPolicy: {
        style: 'reactive',
        maxPlanDepth: 1,
        replanTriggers: ['gateway-verdict-arrived', 'deadline-exceeded', 'kill-switch-thrown'],
      },
      delegationPolicy: {
        canDelegate: false,
        maxDelegationDepth: 0,
        delegateeCategories: [],
        escalationCategories: ['execution-gateway', 'human-oversight', 'portfolio-manager'],
      },
      authorityBoundary: {
        allowedActions: ['OBSERVE', 'SUBSCRIBE', 'PUBLISH', 'REQUEST', 'EXECUTE', 'LEARN', 'REPORT', 'ESCALATE'],
        prohibitedActions: ['SPAWN', 'TERMINATE', 'APPROVE', 'DELEGATE'],
        approvalRequiredActions: ['EXECUTE', 'ESCALATE'],
        executionAuthority: 'external-gateway-only',
        riskPolicyRef: null,
      },
      evaluationEnvironment: {
        requiredEvaluationLayers: ['data-integrity', 'functional-correctness', 'execution-stress', 'blind-generalization'],
        requiredEnvironmentFeatures: ['execution-gateway-seam', 'order-lane-topic-transport', 'point-in-time-knowledge-firewall'],
        requiredDataCategories: ['gateway-verdicts', 'simulated-fills', 'order-lifecycle-events'],
        requiredFidelityModes: ['exact-replay', 'reactive-replay'],
      },
      substrateCompatibility: {
        requirements: {
          minContextWindowTokens: 32768,
          minMaxOutputTokens: 4096,
          requiredInputModalities: ['text'],
          requiredOutputModalities: ['text'],
          toolUse: 'optional',
          structuredOutput: 'required',
        },
        constraints: {
          allowedSubstitutionClasses: ['frontier-reasoner', 'mid-reasoner'],
          maxInputCostPerMTokens: 20,
          maxOutputCostPerMTokens: 80,
          maxP95LatencyMs: 5000,
        },
        testedSubstrates: [
          {
            substrate: 'acme-models/reasoner-2@2026.03',
            result: 'pass',
            testedAt: '2026-06-01T00:00:00Z',
            evidence: 'capsule/substitution/execution/reasoner-2-2026.03',
            notes: null,
          },
        ],
      },
    },
    createdAt: '2026-06-01T00:00:00Z',
    certified: false,
    certificationEvidence: null,
  },
  execution: {
    methodRegistry: EXECUTION_METHOD_REGISTRY,
    topics: {
      directorDecisions: 'directors.decisions',
      gatewayVerdicts: 'execution.gateway-verdicts',
      lifecycleReports: 'execution.lifecycle-reports',
      escalations: 'execution.escalations',
    },
    evaluationCriteriaRefs: [
      'criteria/execution/lifecycle-attainment@1',
      'criteria/execution/reconciliation-attainment@1',
    ],
    substrateRequirements: [
      'substrate-requirement/structured-output',
      'substrate-requirement/text-modality',
    ],
    authorityScope: {
      scope: 'order-lifecycle-management',
      executionRequest: 'gateway-request-only',
      venueDirectPlacement: 'prohibited',
      orderRouting: 'prohibited',
      positionManagement: 'prohibited',
      strategicLevelControl: 'prohibited',
      fillFabrication: 'prohibited',
      cancelFabrication: 'prohibited',
    },
    clock: 'order-level',
  },
} as unknown as ExecutionBodySpec);

/** The spec's canonical digest (L9 — the spec identity binds into lifecycle lineage). */
export const EXECUTION_BODY_DIGEST: string = stableDigestJson(EXECUTION_BODY as never);

/** Guard: the exact authored spec (identity binding, not just shape). */
export function isExecutionBody(v: unknown): v is ExecutionBodySpec {
  return (
    isRecord(v) &&
    isRecord(v.bodyVersion) &&
    (v.bodyVersion as Record<string, unknown>).id === 'execution@1.0.0' &&
    validateExecutionBody(v).length === 0
  );
}
