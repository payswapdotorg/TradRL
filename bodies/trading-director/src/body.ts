// @tradrl/body-trading-director — the director BODY SPEC.
//
// Owning Work Order: T024: "TRADING_DIRECTOR_BODY: structural mirror of
// @tradrl/agent-body's BodyVersion family (interop trip-wire: build a
// REAL createBodyVersion from your spec's composition and assert mutual
// guard acceptance). Mission: portfolio-level decision composition.
// Substrate compatibility stays opaque REQUIREMENT refs (L16a: model
// identity as evidence fails)."
//
// STRUCTURAL MIRROR of @tradrl/agent-body's BodyVersion family (law
// D-003/D-004: this package never imports it; the trip wire in
// src/interop.test.ts builds a REAL `createBodyVersion` from this spec's
// composition and asserts mutual guard acceptance). The body-version
// fields use PLAIN STRING types here (the body-forge mirror discipline)
// so the record can be JSON-round-tripped into the real factory.
//
// THE EXISTENTIAL LAWS — L8 (read-only authority) and L16
// (strategic/execution separation): the trading director DECIDES at
// strategic level only. Order-level control is a different body (T025)
// on a different clock, and execution authority itself lives outside
// the model entirely (L8/L20). `validateTradingDirectorBody` rejects,
// as TYPED ERRORS:
//   - EXECUTE in allowedActions            (execution_authority_granted)
//   - executionAuthority != 'none'         (execution_authority_granted)
//   - EXECUTE not in prohibitedActions     (execute_not_prohibited)
//   - a consequential tool in a procedure  (consequential_tool_in_procedure)
//   - a non-decision capability category   (non_director_capability)
//   - an edited authority-scope record     (execution_authority_granted /
//                                             order_level_control)
//   - an order-level clock declaration     (order_level_control — L16)
//   - a reserved kernel publication topic  (reserved_publication_topic)
//   - a model identity as evaluation evidence (model_identity_as_evidence — L16a)
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
  canonicalJson,
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
  type ResearchLane,
  RESEARCH_LANES,
  isMethodRegistry,
  isResearchLane,
  validateMethodRegistry,
  DIRECTOR_METHOD_REGISTRY,
} from './methods';
import { type DirectorError, type DirectorValidation, invalidField, invalidType, validationOf } from './errors';

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
// The director declaration (this lane's extension of the composition)
// ---------------------------------------------------------------------------

/**
 * THE L8/L16 AUTHORITY SCOPE RECORD: the strategic-only declaration.
 * The values are fixed by law — any edit granting execution, order
 * placement, order-level control or consequential action is a typed
 * validation error.
 */
export interface DirectorAuthorityScope {
  /** What the body may do: consume research, decide, publish. Nothing else. */
  readonly scope: 'research-consumption-decision-publication';
  /** Execution of orders: prohibited (L8). */
  readonly execution: 'prohibited';
  /** Order placement: prohibited (L8). */
  readonly orderPlacement: 'prohibited';
  /** Order-level lifecycle control: prohibited (L16 — a different body, T025, on a different clock). */
  readonly orderLevelControl: 'prohibited';
  /** Any consequential action: prohibited (L8). */
  readonly consequentialActions: 'prohibited';
}

/** Guard: `DirectorAuthorityScope`. */
export function isDirectorAuthorityScope(v: unknown): v is DirectorAuthorityScope {
  if (!isRecord(v)) return false;
  return (
    v.scope === 'research-consumption-decision-publication' &&
    v.execution === 'prohibited' &&
    v.orderPlacement === 'prohibited' &&
    v.orderLevelControl === 'prohibited' &&
    v.consequentialActions === 'prohibited'
  );
}

/**
 * The L16 clock declaration: the director runs on the STRATEGIC clock.
 * Order-level control (the T025 execution body) runs on a different
 * clock — this field exists so a body spec that tries to declare
 * order-level cadence fails validation.
 */
export const DIRECTOR_CLOCKS = ['strategic'] as const;

/** A declared decision clock. */
export type DirectorClock = (typeof DIRECTOR_CLOCKS)[number];

/** Guard: a declared decision clock. */
export const isDirectorClock = (v: unknown): v is DirectorClock =>
  isMemberOf(DIRECTOR_CLOCKS, v);

/** The declared research-subscription map: one topic per consumed lane. */
export interface ResearchTopicMap {
  readonly sentiment: TopicName;
  readonly regime: TopicName;
  readonly fundamental: TopicName;
  readonly 'cross-market': TopicName;
}

/** Guard: `ResearchTopicMap`. */
export function isResearchTopicMap(v: unknown): v is ResearchTopicMap {
  if (!isRecord(v)) return false;
  return (
    isTopicName(v.sentiment) &&
    isTopicName(v.regime) &&
    isTopicName(v.fundamental) &&
    isTopicName(v['cross-market'])
  );
}

/**
 * The trading-director-specific declaration: the method registry the body
 * runs, the four consumed research lanes and their SUBSCRIBE topics, the
 * decision/escalation publication topics, the opaque evaluation
 * criteria its outputs are judged by, the opaque substrate REQUIREMENT
 * refs (L2/L16a), the L8/L16 authority scope record, and the strategic
 * clock declaration.
 */
export interface DirectorDeclaration {
  /** The closed method registry this body may run (method honesty). */
  readonly methodRegistry: MethodRegistry;
  /** The four research lanes consumed (fixed by law: all four, D-020). */
  readonly consumedLanes: readonly ResearchLane[];
  /** The SUBSCRIBE topics of the four consumed research lanes. */
  readonly researchTopics: ResearchTopicMap;
  /** The organization topic decisions are published to. */
  readonly decisionTopic: TopicName;
  /** The organization topic escalation records are published to. */
  readonly escalationTopic: TopicName;
  /** Opaque evaluation-criteria refs (the T012 lane judges these outputs). */
  readonly evaluationCriteriaRefs: readonly EvaluationCriteriaRef[];
  /**
   * Opaque substrate REQUIREMENT refs (L2/L16a). These are requirement
   * citations, NEVER model identities offered as suitability evidence.
   */
  readonly substrateRequirements: readonly string[];
  /** The L8/L16 authority scope record (strategic-only — fixed by law). */
  readonly authorityScope: DirectorAuthorityScope;
  /** The L16 clock declaration (strategic — order-level control is T025's clock). */
  readonly clock: DirectorClock;
}

/** Guard: `DirectorDeclaration` (structure only — use the validator for the laws). */
export function isDirectorDeclaration(v: unknown): v is DirectorDeclaration {
  return (
    isRecord(v) &&
    isMethodRegistry(v.methodRegistry) &&
    isArrayOf(v.consumedLanes, isResearchLane) &&
    isResearchTopicMap(v.researchTopics) &&
    isTopicName(v.decisionTopic) &&
    isTopicName(v.escalationTopic) &&
    isArrayOf(v.evaluationCriteriaRefs, isEvaluationCriteriaRef) &&
    isArrayOf(v.substrateRequirements, isNonEmptyString) &&
    isDirectorAuthorityScope(v.authorityScope) &&
    isDirectorClock(v.clock)
  );
}

/** The full director body spec: a BodyVersion mirror + the declaration. */
export interface TradingDirectorBodySpec {
  readonly bodyVersion: BodyVersionMirror;
  readonly director: DirectorDeclaration;
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
 * COLLECT-ALL validation of a trading-director body spec against the
 * full law set: body-version structure and semantics (the mirrored T003
 * invariants), the L8 read-only authority (the existential law for this
 * body), the L16 strategic/execution separation (order-level control and
 * clock), the L16a model-identity ban in evidence positions, method
 * registry honesty, and the declaration's own laws.
 */
export function validateTradingDirectorBody(v: unknown): readonly DirectorError[] {
  const errors: DirectorError[] = [];
  if (!isRecord(v)) return [invalidType('body', 'a trading director body spec')];
  if (!isBodyVersionMirror(v.bodyVersion)) {
    if (!isRecord(v.bodyVersion)) {
      errors.push(invalidType('bodyVersion', 'a body-version mirror record'));
    } else {
      errors.push(invalidField('bodyVersion', 'must satisfy the agent-body BodyVersion mirror shape'));
    }
  }
  const director: unknown = v.director;
  if (!isRecord(director)) {
    errors.push(invalidType('director', 'a trading director declaration'));
    return errors;
  }

  const body = isBodyVersionMirror(v.bodyVersion) ? (v.bodyVersion as BodyVersionMirror) : null;
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
    // THE T003 EXECUTE <=> external-gateway-only law, mirrored
    const executeAllowed = allowed.has('EXECUTE');
    if (executeAllowed && body.composition.authorityBoundary.executionAuthority !== 'external-gateway-only') {
      errors.push(invalidField('bodyVersion.composition.authorityBoundary.executionAuthority', 'EXECUTE in allowedActions requires external-gateway-only'));
    }
    if (!executeAllowed && body.composition.authorityBoundary.executionAuthority === 'external-gateway-only') {
      errors.push(invalidField('bodyVersion.composition.authorityBoundary.executionAuthority', 'external-gateway-only is only meaningful when EXECUTE is in allowedActions'));
    }

    // ---------------------------------------------------------------------
    // THE L8 LAWS (this lane's existential declaration — strategic-only)
    // ---------------------------------------------------------------------
    if (executeAllowed) {
      errors.push({
        code: 'execution_authority_granted',
        path: 'bodyVersion.composition.authorityBoundary.allowedActions',
        message: 'the trading director is a DECISION body, never an execution body: EXECUTE must never appear in allowedActions (L8)',
      });
    }
    if (body.composition.authorityBoundary.executionAuthority !== 'none') {
      errors.push({
        code: 'execution_authority_granted',
        path: 'bodyVersion.composition.authorityBoundary.executionAuthority',
        message: 'the trading director declares executionAuthority "none" — execution authority lives outside the model entirely (L8/L20)',
      });
    }
    if (!body.composition.authorityBoundary.prohibitedActions.includes('EXECUTE')) {
      errors.push({
        code: 'execute_not_prohibited',
        path: 'bodyVersion.composition.authorityBoundary.prohibitedActions',
        message: 'the trading director must explicitly PROHIBIT EXECUTE (L8 — prohibition is declared, not implied)',
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
          if (/(order|execution|trade|position)-/i.test(tool)) {
            errors.push({
              code: 'consequential_tool_in_procedure',
              path: `bodyVersion.composition.procedures.${procedure.id}.steps.${step.id}.toolRefs`,
              message: `step cites consequential tool ${JSON.stringify(tool)} — a strategic decision body cites no order/execution/trade/position tools (L8/L16)`,
            });
          }
        }
      }
    }
    // capabilities must be decision-category (the decision-hub declaration)
    for (const capability of body.composition.capabilities) {
      if (capability.category !== 'decision') {
        errors.push({
          code: 'non_director_capability',
          path: `bodyVersion.composition.capabilities.${capability.id}.category`,
          message: `capability ${JSON.stringify(capability.id)} declares category ${JSON.stringify(capability.category)} — every trading-director capability is decision-category (L8/L16)`,
        });
      }
    }
  }

  // declaration laws
  if (!isMethodRegistry(director.methodRegistry)) {
    errors.push(...validateMethodRegistry(director.methodRegistry).map((e) => ({ ...e, path: `director.methodRegistry.${e.path}` })));
  }
  if (!Array.isArray(director.consumedLanes) || (director.consumedLanes as readonly unknown[]).length !== RESEARCH_LANES.length) {
    errors.push(invalidField('director.consumedLanes', 'the decision hub consumes all four research lanes (D-020 — fixed by law)'));
  } else {
    for (const lane of RESEARCH_LANES) {
      if (!(director.consumedLanes as readonly unknown[]).includes(lane)) {
        errors.push(invalidField('director.consumedLanes', `lane ${JSON.stringify(lane)} must be consumed (D-020)`));
      }
    }
  }
  if (!isResearchTopicMap(director.researchTopics)) {
    errors.push(invalidField('director.researchTopics', 'must declare the four research SUBSCRIBE topics'));
  } else {
    for (const topic of [director.researchTopics.sentiment, director.researchTopics.regime, director.researchTopics.fundamental, director.researchTopics['cross-market']] as const) {
      if (topic.startsWith('kernel.')) {
        errors.push({
          code: 'reserved_publication_topic',
          path: 'director.researchTopics',
          message: 'kernel.* topics are reserved for directed kernel mail — research is consumed from organization topics only',
        });
      }
    }
  }
  for (const [name, topic] of [['decisionTopic', director.decisionTopic], ['escalationTopic', director.escalationTopic]] as const) {
    if (!isTopicName(topic)) {
      errors.push(invalidField(`director.${name}`, 'must be a valid topic name'));
    } else if ((topic as string).startsWith('kernel.')) {
      errors.push({
        code: 'reserved_publication_topic',
        path: `director.${name}`,
        message: 'kernel.* topics are reserved for directed kernel mail — the director publishes to organization topics only',
      });
    }
  }
  if (!Array.isArray(director.evaluationCriteriaRefs) || (director.evaluationCriteriaRefs as readonly unknown[]).length === 0) {
    errors.push(invalidField('director.evaluationCriteriaRefs', 'decision quality is EVALUATED — at least one criteria ref must be cited (never self-declared)'));
  } else {
    for (const ref of director.evaluationCriteriaRefs as readonly unknown[]) {
      if (!isEvaluationCriteriaRef(ref)) {
        errors.push(invalidField('director.evaluationCriteriaRefs', `invalid criteria ref ${JSON.stringify(ref)}`));
      } else if (looksLikeModelIdentity(ref)) {
        // THE L16a LAW: a model identity offered as evaluation evidence.
        errors.push({
          code: 'model_identity_as_evidence',
          path: 'director.evaluationCriteriaRefs',
          message: `criteria ref ${JSON.stringify(ref)} is shaped like a model identity — model identities never establish suitability (L16a/L2)`,
        });
      }
    }
  }
  if (!Array.isArray(director.substrateRequirements) || (director.substrateRequirements as readonly unknown[]).length === 0) {
    errors.push(invalidField('director.substrateRequirements', 'substrate compatibility must cite requirement refs (L2)'));
  } else {
    for (const ref of director.substrateRequirements as readonly unknown[]) {
      if (!isNonEmptyString(ref)) {
        errors.push(invalidField('director.substrateRequirements', `invalid requirement ref ${JSON.stringify(ref)}`));
      }
    }
  }
  if (!isDirectorAuthorityScope(director.authorityScope)) {
    // distinguish the L16 edit (order-level control) from the L8 edits
    const scope = director.authorityScope;
    if (isRecord(scope) && scope.orderLevelControl !== undefined && scope.orderLevelControl !== 'prohibited') {
      errors.push({
        code: 'order_level_control',
        path: 'director.authorityScope',
        message: 'the L16 authority scope record is fixed by law: order-level lifecycle control is the execution body\'s (T025) — this body never controls orders',
      });
    } else {
      errors.push({
        code: 'execution_authority_granted',
        path: 'director.authorityScope',
        message: 'the L8 authority scope record is fixed by law: research-consumption-decision-publication only, execution/order-placement/order-level-control/consequential-actions prohibited',
      });
    }
  }
  if (!isDirectorClock(director.clock)) {
    errors.push({
      code: 'order_level_control',
      path: 'director.clock',
      message: 'the L16 clock declaration is fixed by law: the director runs on the STRATEGIC clock — order-level cadence is the execution body\'s (T025)',
    });
  }
  return errors;
}

/** Validation wrapper: `TradingDirectorBodySpec`. */
export function validateTradingDirectorBodySpec(v: unknown): DirectorValidation<TradingDirectorBodySpec> {
  const errors = validateTradingDirectorBody(v);
  return validationOf(errors.length === 0 ? (v as TradingDirectorBodySpec) : null, errors);
}

// ---------------------------------------------------------------------------
// TRADING_DIRECTOR_BODY — the authored spec (certified: false —
// certification is the verification lane's verdict, never self-declared)
// ---------------------------------------------------------------------------

/** The body identity: `trading-director` (the T024 write surface's body). */
export const TRADING_DIRECTOR_BODY_ID = 'trading-director';

/** The spec version: `1.0.0` (root of this body's lineage). */
export const TRADING_DIRECTOR_BODY_SEMVER: SemVer = deepFreeze({
  major: 1,
  minor: 0,
  patch: 0,
  prerelease: [],
  build: [],
});

/** The canonical body-version reference of this spec. */
export const TRADING_DIRECTOR_BODY_VERSION_REF: BodyVersionRef =
  'trading-director@1.0.0' as BodyVersionRef;

/**
 * THE TRADING DIRECTOR BODY SPEC (the D-020 decision hub). Mission:
 * portfolio-level decision composition from the four research bodies'
 * typed publications. Capabilities: research intake over the four
 * research topics, declared-method synthesis, decision publication,
 * escalation publication. Knowledge/tool policy: read-only research
 * sources, no consequential tools. Procedures: the declared decision
 * cycle. Delegation: may SUBSCRIBE/PUBLISH/REPORT via agent-os envelope
 * mirrors — never EXECUTE. Authority: strategic-only (the L8/L16
 * declaration). Evaluation: judged by the cited criteria refs (T012).
 * Substrate compatibility: opaque requirement refs (L2/L16a).
 */
export const TRADING_DIRECTOR_BODY: TradingDirectorBodySpec = deepFreeze({
  bodyVersion: {
    id: 'trading-director@1.0.0',
    bodyId: TRADING_DIRECTOR_BODY_ID,
    version: TRADING_DIRECTOR_BODY_SEMVER,
    parentId: null,
    composition: {
      mission: {
        summary:
          'Consume the four research bodies\' typed publications under point-in-time discipline and compose portfolio-level decisions — target-allocation directives or typed escalations — for the strategy and execution lanes. Strategic level only: never order-level control.',
        goalRefs: ['goal/portfolio-direction'],
        standingDirectives: [
          'Every decision carries its full input lineage — the four research report refs (L9).',
          'Never consume a research report computed after the decision instant (L4).',
          'Every one of the four lanes is accounted consumed, conflicted or absent — never silence.',
          'Strategic decisions only: order-level control is the execution body\'s, on a different clock (L16).',
          'Execution authority lives outside the model entirely (L8).',
          'A decision without a declared synthesis-method version is a typed error, never a magic output.',
        ],
      },
      capabilities: [
        {
          id: 'research-intake',
          name: 'Research Intake',
          description:
            'SUBSCRIBE to the four research topics (sentiment, regime, fundamental, cross-market) and accept their typed publications through the field-for-field report mirrors, enforcing the L4 as-of gate and tenant/project scope.',
          category: 'decision',
          skillArtifactRefs: ['skills/director/research-intake-v1'],
          critical: true,
        },
        {
          id: 'decision-synthesis',
          name: 'Decision Synthesis',
          description:
            'Compose the four research publications into a portfolio-level decision by the declared synthesis method (versioned method records: quorum, stance map, lane weights, tilt/threshold parameters, conflict policy) with exact decimal arithmetic.',
          category: 'decision',
          skillArtifactRefs: ['skills/director/synthesis-v1'],
          critical: true,
        },
        {
          id: 'decision-publication',
          name: 'Decision Publication',
          description:
            'Publish the structured decision record (or escalation record) through the agent-os envelope mirror port to the organization topics as structured records only.',
          category: 'decision',
          skillArtifactRefs: ['skills/director/decision-publication-v1'],
          critical: true,
        },
        {
          id: 'escalation',
          name: 'Quorum and Conflict Escalation',
          description:
            'Escalate when the declared quorum is unmet or conflicts are irreconcilable under the declared method — an escalation RECORD (the kernel ESCALATE verb), never an exception, never a silent default.',
          category: 'decision',
          skillArtifactRefs: ['skills/director/escalation-v1'],
          critical: false,
        },
      ],
      knowledgeToolPolicy: {
        allowedTools: [
          'tools/research-subscriber',
          'tools/decision-synthesizer',
          'tools/decision-publisher',
        ],
        forbiddenTools: ['tools/order-entry', 'tools/execution-router', 'tools/position-manager'],
        toolCallBudgetPerDecision: 16,
        allowedKnowledgeSources: [
          'knowledge/organization/research-publications',
          'knowledge/organization/strategy-specs',
        ],
        forbiddenKnowledgeSources: ['knowledge/private/another-tenant'],
      },
      procedures: [
        {
          id: 'decision-cycle',
          name: 'Trading Director Decision Cycle',
          trigger: 'scheduled',
          steps: [
            {
              id: 'subscribe-research',
              description: 'SUBSCRIBE to the four research topics; receive the typed research publications.',
              toolRefs: ['tools/research-subscriber'],
              approvalRequired: false,
            },
            {
              id: 'intake-gate',
              description: 'Accept each publication through its field-for-field mirror; enforce the L4 as-of gate (inclusive at the decision instant) and the tenant/project scope.',
              toolRefs: ['tools/research-subscriber'],
              approvalRequired: false,
            },
            {
              id: 'synthesize',
              description: 'Compose the decision by the declared synthesis method (coverage accounting, conflict records, majority-rules tilts).',
              toolRefs: ['tools/decision-synthesizer'],
              approvalRequired: false,
            },
            {
              id: 'decide-or-escalate',
              description: 'Emit the decision (target-allocation directive or typed no-change verdict), or the escalation record when quorum is unmet or conflicts are irreconcilable.',
              toolRefs: ['tools/decision-synthesizer'],
              approvalRequired: false,
            },
            {
              id: 'publish',
              description: 'Publish the decision or escalation record through the envelope mirror port to the organization topic.',
              toolRefs: ['tools/decision-publisher'],
              approvalRequired: false,
            },
          ],
        },
        {
          id: 'escalation',
          name: 'Quorum/Conflict Escalation',
          trigger: 'escalation',
          steps: [
            {
              id: 'escalate-blocked-synthesis',
              description: 'Escalate a blocked synthesis (unmet quorum or irreconcilable conflict) as the structured escalation record to the escalation topic.',
              toolRefs: [],
              approvalRequired: true,
            },
          ],
        },
      ],
      planningPolicy: {
        style: 'reactive',
        maxPlanDepth: 1,
        replanTriggers: ['research-gap-detected', 'manager-request'],
      },
      delegationPolicy: {
        canDelegate: false,
        maxDelegationDepth: 0,
        delegateeCategories: [],
        escalationCategories: ['portfolio-manager', 'human-oversight'],
      },
      authorityBoundary: {
        allowedActions: ['OBSERVE', 'SUBSCRIBE', 'PUBLISH', 'REQUEST', 'LEARN', 'REPORT', 'ESCALATE'],
        prohibitedActions: ['EXECUTE', 'SPAWN', 'TERMINATE', 'APPROVE', 'DELEGATE'],
        approvalRequiredActions: ['ESCALATE'],
        executionAuthority: 'none',
        riskPolicyRef: null,
      },
      evaluationEnvironment: {
        requiredEvaluationLayers: ['data-integrity', 'functional-correctness', 'blind-generalization'],
        requiredEnvironmentFeatures: ['organization-research-topics', 'point-in-time-knowledge-firewall'],
        requiredDataCategories: ['research-reports'],
        requiredFidelityModes: ['exact-replay'],
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
          maxP95LatencyMs: 10000,
        },
        testedSubstrates: [
          {
            substrate: 'acme-models/reasoner-2@2026.03',
            result: 'pass',
            testedAt: '2026-06-01T00:00:00Z',
            evidence: 'capsule/substitution/trading-director/reasoner-2-2026.03',
            notes: null,
          },
        ],
      },
    },
    createdAt: '2026-06-01T00:00:00Z',
    certified: false,
    certificationEvidence: null,
  },
  director: {
    methodRegistry: DIRECTOR_METHOD_REGISTRY,
    consumedLanes: RESEARCH_LANES,
    researchTopics: {
      sentiment: 'research.sentiment',
      regime: 'research.regime',
      fundamental: 'research.fundamental',
      'cross-market': 'research.crossmarket',
    },
    decisionTopic: 'directors.decisions',
    escalationTopic: 'directors.escalations',
    evaluationCriteriaRefs: [
      'criteria/director/decision-attainment@1',
      'criteria/director/escalation-attainment@1',
    ],
    substrateRequirements: [
      'substrate-requirement/structured-output',
      'substrate-requirement/text-modality',
    ],
    authorityScope: {
      scope: 'research-consumption-decision-publication',
      execution: 'prohibited',
      orderPlacement: 'prohibited',
      orderLevelControl: 'prohibited',
      consequentialActions: 'prohibited',
    },
    clock: 'strategic',
  },
} as unknown as TradingDirectorBodySpec);

/** The spec's canonical digest (L9 — the spec identity binds into decision lineage). */
export const TRADING_DIRECTOR_BODY_DIGEST: string = stableDigestJson(
  TRADING_DIRECTOR_BODY as never,
);

/** Guard: the exact authored spec (identity binding, not just shape). */
export function isTradingDirectorBody(v: unknown): v is TradingDirectorBodySpec {
  return (
    isRecord(v) &&
    isRecord(v.bodyVersion) &&
    (v.bodyVersion as Record<string, unknown>).id === 'trading-director@1.0.0' &&
    validateTradingDirectorBody(v).length === 0
  );
}
