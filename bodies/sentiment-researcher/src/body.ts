// @tradrl/body-sentiment-researcher — the researcher BODY SPEC.
//
// Owning Work Order: T021, section 5: "SENTIMENT_RESEARCHER_BODY — the
// body SPEC: mission ..., capabilities ..., knowledge/tool policy
// (read-only sources), procedures (the declared research pipeline steps),
// delegation boundaries (may SUBSCRIBE/PUBLISH via agent-os envelope
// mirrors — never EXECUTE), authority scope record (read-only — the L8
// declaration), evaluation requirements (the criteria refs its outputs
// are judged by), substrate compatibility (opaque refs), version."
//
// STRUCTURAL MIRROR of @tradrl/agent-body's BodyVersion family (law
// D-003/D-004: this package never imports it; the trip wire in
// src/interop.test.ts builds a REAL `createBodyVersion` from this spec's
// composition and asserts mutual guard acceptance). The body-version
// fields use PLAIN STRING types here (the body-forge mirror discipline)
// so the record can be JSON-round-tripped into the real factory.
//
// THE EXISTENTIAL LAW — L8 (read-only authority; spec/
// ARCHITECTURE-LOCK.md L8/L20, AGENTS.md "Execution authority is outside
// model prompts"): the sentiment researcher declares authority scope =
// observation/research/publication ONLY. `validateSentimentResearcherBody`
// rejects, as TYPED ERRORS:
//   - EXECUTE in allowedActions            (execution_authority_granted)
//   - executionAuthority != 'none'         (execution_authority_granted)
//   - EXECUTE not in prohibitedActions     (execute_not_prohibited)
//   - a consequential tool in a procedure  (consequential_tool_in_procedure)
//   - a non-research capability category   (non_research_capability)
//   - an edited read-only authority scope  (execution_authority_granted)
// L16a: substrate compatibility is opaque REQUIREMENT refs — a model
// identity offered as evidence fails (model_identity_as_evidence).
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
import { type MethodRegistry, isMethodRegistry, validateMethodRegistry, SENTIMENT_METHOD_REGISTRY } from './methods';
import { type ResearchError, type ResearchValidation, invalidField, invalidType, validationOf } from './errors';

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
// The research declaration (this lane's extension of the composition)
// ---------------------------------------------------------------------------

/**
 * THE L8 AUTHORITY SCOPE RECORD: the read-only declaration. The values
 * are fixed by law — any edit granting execution, order placement or
// consequential action is a typed validation error.
 */
export interface ResearchAuthorityScope {
  /** What the body may do: observe, research, publish. Nothing else. */
  readonly scope: 'observation-research-publication';
  /** Execution of orders: prohibited (L8). */
  readonly execution: 'prohibited';
  /** Order placement: prohibited (L8). */
  readonly orderPlacement: 'prohibited';
  /** Any consequential action: prohibited (L8). */
  readonly consequentialActions: 'prohibited';
}

/** Guard: `ResearchAuthorityScope`. */
export function isResearchAuthorityScope(v: unknown): v is ResearchAuthorityScope {
  if (!isRecord(v)) return false;
  return (
    v.scope === 'observation-research-publication' &&
    v.execution === 'prohibited' &&
    v.orderPlacement === 'prohibited' &&
    v.consequentialActions === 'prohibited'
  );
}

/** The declared research pipeline stage names (the procedures' steps). */
export const RESEARCH_PIPELINE_STAGES = [
  'intake',
  'l4-gate',
  'aggregate',
  'detect-events',
  'compose',
  'publish',
] as const;

/** A declared research pipeline stage. */
export type ResearchPipelineStage = (typeof RESEARCH_PIPELINE_STAGES)[number];

/** Guard: a declared research pipeline stage. */
export const isResearchPipelineStage = (v: unknown): v is ResearchPipelineStage =>
  isMemberOf(RESEARCH_PIPELINE_STAGES, v);

/**
 * The sentiment-researcher-specific declaration: the method registry the
 * body runs, the observation kinds its ports accept, the opaque
 * evaluation criteria its outputs are judged by (T012 — research output
 * quality is EVALUATED, never self-declared), the publication topic, and
 * the opaque substrate REQUIREMENT refs (L2/L16a — requirements, never
 * model identities as evidence).
 */
export interface SentimentResearchDeclaration {
  /** The closed method registry this body may run (method honesty). */
  readonly methodRegistry: MethodRegistry;
  /** The observation kinds the intake ports accept. */
  readonly observationKinds: readonly ('news' | 'social_signal')[];
  /** Opaque evaluation-criteria refs (the T012 lane judges these outputs). */
  readonly evaluationCriteriaRefs: readonly EvaluationCriteriaRef[];
  /** The organization topic research outputs are published to. */
  readonly publicationTopic: TopicName;
  /**
   * Opaque substrate REQUIREMENT refs (L2/L16a). These are requirement
   * citations, NEVER model identities offered as suitability evidence.
   */
  readonly substrateRequirements: readonly string[];
  /** The L8 authority scope record (read-only — fixed by law). */
  readonly authorityScope: ResearchAuthorityScope;
}

/** Guard: `SentimentResearchDeclaration` (structure only — use the validator for the laws). */
export function isSentimentResearchDeclaration(v: unknown): v is SentimentResearchDeclaration {
  return (
    isRecord(v) &&
    isMethodRegistry(v.methodRegistry) &&
    isArrayOf(v.observationKinds, (item): item is 'news' | 'social_signal' =>
      item === 'news' || item === 'social_signal',
    ) &&
    isArrayOf(v.evaluationCriteriaRefs, isEvaluationCriteriaRef) &&
    isTopicName(v.publicationTopic) &&
    isArrayOf(v.substrateRequirements, isNonEmptyString) &&
    isResearchAuthorityScope(v.authorityScope)
  );
}

/** The full researcher body spec: a BodyVersion mirror + the declaration. */
export interface SentimentResearcherBodySpec {
  readonly bodyVersion: BodyVersionMirror;
  readonly research: SentimentResearchDeclaration;
}

// ---------------------------------------------------------------------------
// L16a helper: model-identity detection in evidence positions
// ---------------------------------------------------------------------------

const SUBSTRATE_REF_SHAPE = /^[^\s/@]{1,128}\/[^\s/@]{1,128}@[^\s/@]{1,128}$/;

/**
 * `true` when a reference is shaped like a canonical substrate identity
 * (`provider/modelId@modelVersion`). A reference in an EVIDENCE position
 * with this shape is an L16a violation: a model identity is being
 * offered as evidence of research-output quality. (Substrate refs are
 * legal ONLY in the compatibility manifest's `testedSubstrates` — as
 * compatibility TEST records, not as suitability evidence.)
 */
export function looksLikeModelIdentity(ref: string): boolean {
  return SUBSTRATE_REF_SHAPE.test(ref);
}

// ---------------------------------------------------------------------------
// Validation (collect-all — every law, every violation)
// ---------------------------------------------------------------------------

/**
 * COLLECT-ALL validation of a sentiment-researcher body spec against the
 * full law set: body-version structure and semantics (the mirrored T003
 * invariants), the L8 read-only authority (the existential law for this
 * body), the L16a model-identity ban in evidence positions, method
 * registry honesty, and the declaration's own laws.
 */
export function validateSentimentResearcherBody(v: unknown): readonly ResearchError[] {
  const errors: ResearchError[] = [];
  if (!isRecord(v)) return [invalidType('body', 'a sentiment researcher body spec')];
  if (!isBodyVersionMirror(v.bodyVersion)) {
    if (!isRecord(v.bodyVersion)) {
      errors.push(invalidType('bodyVersion', 'a body-version mirror record'));
    } else {
      errors.push(invalidField('bodyVersion', 'must satisfy the agent-body BodyVersion mirror shape'));
    }
  }
  const research: unknown = v.research;
  if (!isRecord(research)) {
    errors.push(invalidType('research', 'a sentiment research declaration'));
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
    // THE T003 EXECUTE ⇔ external-gateway-only law, mirrored
    const executeAllowed = allowed.has('EXECUTE');
    if (executeAllowed && body.composition.authorityBoundary.executionAuthority !== 'external-gateway-only') {
      errors.push(invalidField('bodyVersion.composition.authorityBoundary.executionAuthority', 'EXECUTE in allowedActions requires external-gateway-only'));
    }
    if (!executeAllowed && body.composition.authorityBoundary.executionAuthority === 'external-gateway-only') {
      errors.push(invalidField('bodyVersion.composition.authorityBoundary.executionAuthority', 'external-gateway-only is only meaningful when EXECUTE is in allowedActions'));
    }

    // ---------------------------------------------------------------------
    // THE L8 LAWS (this lane's existential declaration — read-only)
    // ---------------------------------------------------------------------
    if (executeAllowed) {
      errors.push({
        code: 'execution_authority_granted',
        path: 'bodyVersion.composition.authorityBoundary.allowedActions',
        message: 'the sentiment researcher is a READ-ONLY body: EXECUTE must never appear in allowedActions (L8)',
      });
    }
    if (body.composition.authorityBoundary.executionAuthority !== 'none') {
      errors.push({
        code: 'execution_authority_granted',
        path: 'bodyVersion.composition.authorityBoundary.executionAuthority',
        message: 'the sentiment researcher declares executionAuthority "none" — and nothing else (L8)',
      });
    }
    if (!body.composition.authorityBoundary.prohibitedActions.includes('EXECUTE')) {
      errors.push({
        code: 'execute_not_prohibited',
        path: 'bodyVersion.composition.authorityBoundary.prohibitedActions',
        message: 'the sentiment researcher must explicitly PROHIBIT EXECUTE (L8 — prohibition is declared, not implied)',
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
          if (/(order|execution|trade)-/i.test(tool)) {
            errors.push({
              code: 'consequential_tool_in_procedure',
              path: `bodyVersion.composition.procedures.${procedure.id}.steps.${step.id}.toolRefs`,
              message: `step cites consequential tool ${JSON.stringify(tool)} — a read-only body cites no order/execution/trade tools (L8)`,
            });
          }
        }
      }
    }
    // capabilities must be research-category (a read-only research body)
    for (const capability of body.composition.capabilities) {
      if (capability.category !== 'research') {
        errors.push({
          code: 'non_research_capability',
          path: `bodyVersion.composition.capabilities.${capability.id}.category`,
          message: `capability ${JSON.stringify(capability.id)} declares category ${JSON.stringify(capability.category)} — every sentiment-researcher capability is research-category (L8)`,
        });
      }
    }
  }

  // declaration laws
  if (!isMethodRegistry(research.methodRegistry)) {
    errors.push(...validateMethodRegistry(research.methodRegistry).map((e) => ({ ...e, path: `research.methodRegistry.${e.path}` })));
  }
  if (!Array.isArray(research.observationKinds) || research.observationKinds.length === 0) {
    errors.push(invalidField('research.observationKinds', 'must be a non-empty subset of { news, social_signal }'));
  } else {
    for (const kind of research.observationKinds as readonly unknown[]) {
      if (kind !== 'news' && kind !== 'social_signal') {
        errors.push(invalidField('research.observationKinds', `unknown observation kind ${JSON.stringify(kind)}`));
      }
    }
  }
  if (!Array.isArray(research.evaluationCriteriaRefs) || (research.evaluationCriteriaRefs as readonly unknown[]).length === 0) {
    errors.push(invalidField('research.evaluationCriteriaRefs', 'research output quality is EVALUATED — at least one criteria ref must be cited (never self-declared)'));
  } else {
    for (const ref of research.evaluationCriteriaRefs as readonly unknown[]) {
      if (!isEvaluationCriteriaRef(ref)) {
        errors.push(invalidField('research.evaluationCriteriaRefs', `invalid criteria ref ${JSON.stringify(ref)}`));
      } else if (looksLikeModelIdentity(ref)) {
        // THE L16a LAW: a model identity offered as evaluation evidence.
        errors.push({
          code: 'model_identity_as_evidence',
          path: 'research.evaluationCriteriaRefs',
          message: `criteria ref ${JSON.stringify(ref)} is shaped like a model identity — model identities never establish suitability (L16a/L2)`,
        });
      }
    }
  }
  if (!isTopicName(research.publicationTopic)) {
    errors.push(invalidField('research.publicationTopic', 'must be a valid topic name'));
  } else if (research.publicationTopic.startsWith('kernel.')) {
    errors.push({
      code: 'reserved_publication_topic',
      path: 'research.publicationTopic',
      message: 'kernel.* topics are reserved for directed kernel mail — research publishes to organization topics only',
    });
  }
  if (!Array.isArray(research.substrateRequirements) || (research.substrateRequirements as readonly unknown[]).length === 0) {
    errors.push(invalidField('research.substrateRequirements', 'substrate compatibility must cite requirement refs (L2)'));
  } else {
    for (const ref of research.substrateRequirements as readonly unknown[]) {
      if (!isNonEmptyString(ref)) {
        errors.push(invalidField('research.substrateRequirements', `invalid requirement ref ${JSON.stringify(ref)}`));
      }
    }
  }
  if (!isResearchAuthorityScope(research.authorityScope)) {
    errors.push({
      code: 'execution_authority_granted',
      path: 'research.authorityScope',
      message: 'the L8 authority scope record is fixed by law: observation-research-publication only, execution/order-placement/consequential-actions prohibited',
    });
  }
  return errors;
}

/** Validation wrapper: `SentimentResearcherBodySpec`. */
export function validateSentimentResearcherBodySpec(v: unknown): ResearchValidation<SentimentResearcherBodySpec> {
  const errors = validateSentimentResearcherBody(v);
  return validationOf(errors.length === 0 ? (v as SentimentResearcherBodySpec) : null, errors);
}

// ---------------------------------------------------------------------------
// SENTIMENT_RESEARCHER_BODY — the authored spec (certified: false —
// certification is the verification lane's verdict, never self-declared)
// ---------------------------------------------------------------------------

/** The body identity: `sentiment-researcher` (the T021 write surface's body). */
export const SENTIMENT_RESEARCHER_BODY_ID = 'sentiment-researcher';

/** The spec version: `1.0.0` (root of this body's lineage). */
export const SENTIMENT_RESEARCHER_BODY_SEMVER: SemVer = deepFreeze({
  major: 1,
  minor: 0,
  patch: 0,
  prerelease: [],
  build: [],
});

/** The canonical body-version reference of this spec. */
export const SENTIMENT_RESEARCHER_BODY_VERSION_REF: BodyVersionRef =
  'sentiment-researcher@1.0.0' as BodyVersionRef;

/**
 * THE SENTIMENT/EVENT RESEARCHER BODY SPEC. Mission: produce
 * evidence-backed sentiment/event research. Capabilities: observation
 * intake over the news/alternative-data emitter shapes, sentiment
 * aggregation, event detection/digestion, research publication.
 * Knowledge/tool policy: read-only sources. Procedures: the declared
 * research pipeline. Delegation: may SUBSCRIBE/PUBLISH via agent-os
 * envelope mirrors — never EXECUTE. Authority: read-only (the L8
 * declaration). Evaluation: judged by the cited criteria refs (T012).
 * Substrate compatibility: opaque requirement refs (L2/L16a).
 */
export const SENTIMENT_RESEARCHER_BODY: SentimentResearcherBodySpec = deepFreeze({
  bodyVersion: {
    id: 'sentiment-researcher@1.0.0',
    bodyId: SENTIMENT_RESEARCHER_BODY_ID,
    version: SENTIMENT_RESEARCHER_BODY_SEMVER,
    parentId: null,
    composition: {
      mission: {
        summary:
          'Continuously ingest news and sentiment-score observations under point-in-time discipline and publish evidence-backed sentiment readings, event digests and research reports to the trading organization.',
        goalRefs: ['goal/sentiment-awareness'],
        standingDirectives: [
          'Every research output carries its full evidence lineage (L9).',
          'Never consume an observation whose availability exceeds the declared as-of instant (L4).',
          'Read-only: observe, research, publish — never execute (L8).',
          'Sentiment is a declared-method output, never a magic number.',
        ],
      },
      capabilities: [
        {
          id: 'observation-intake',
          name: 'Observation Intake',
          description:
            'Consume news and sentiment-score observations from the injected news/alternative-data emitter ports (T038 shapes via mirrors), validating availability quartets and provenance blocks.',
          category: 'research',
          skillArtifactRefs: ['skills/sentiment/observation-intake-v1'],
          critical: true,
        },
        {
          id: 'sentiment-aggregation',
          name: 'Sentiment Aggregation',
          description:
            'Aggregate sentiment-score observations into polarity and intensity assessments by the declared aggregation method (versioned method records, exact decimal arithmetic).',
          category: 'research',
          skillArtifactRefs: ['skills/sentiment/aggregation-v1'],
          critical: true,
        },
        {
          id: 'event-digestion',
          name: 'Event Detection and Digestion',
          description:
            'Cluster news observations over declared knowledge-time windows into structured event digests under the declared event taxonomy.',
          category: 'research',
          skillArtifactRefs: ['skills/sentiment/event-detection-v1'],
          critical: false,
        },
        {
          id: 'research-publication',
          name: 'Research Publication',
          description:
            'Compose readings and digests into the structured research report and publish it through the agent-os envelope mirror port as structured records only.',
          category: 'research',
          skillArtifactRefs: ['skills/sentiment/report-composition-v1'],
          critical: true,
        },
      ],
      knowledgeToolPolicy: {
        allowedTools: [
          'tools/observation-reader',
          'tools/sentiment-aggregator',
          'tools/event-clusterer',
          'tools/research-publisher',
        ],
        forbiddenTools: ['tools/order-entry', 'tools/execution-router'],
        toolCallBudgetPerDecision: 16,
        allowedKnowledgeSources: [
          'knowledge/point-in-time/news-wire',
          'knowledge/point-in-time/sentiment-vendor',
        ],
        forbiddenKnowledgeSources: ['knowledge/private/another-tenant'],
      },
      procedures: [
        {
          id: 'research-cycle',
          name: 'Sentiment/Event Research Cycle',
          trigger: 'scheduled',
          steps: [
            {
              id: 'intake',
              description: 'Pull observations from the injected emitter ports; validate quartets and provenance.',
              toolRefs: ['tools/observation-reader'],
              approvalRequired: false,
            },
            {
              id: 'l4-gate',
              description: 'Admit only observations whose available_time is at or before the declared as-of instant; defer the rest with typed records.',
              toolRefs: ['tools/observation-reader'],
              approvalRequired: false,
            },
            {
              id: 'aggregate',
              description: 'Aggregate admitted sentiment-score observations by the declared aggregation method.',
              toolRefs: ['tools/sentiment-aggregator'],
              approvalRequired: false,
            },
            {
              id: 'detect-events',
              description: 'Cluster admitted news observations into event digests by the declared event-detection method.',
              toolRefs: ['tools/event-clusterer'],
              approvalRequired: false,
            },
            {
              id: 'compose',
              description: 'Compose readings and digests into the structured research report by the declared composition method.',
              toolRefs: ['tools/research-publisher'],
              approvalRequired: false,
            },
            {
              id: 'publish',
              description: 'Publish the report through the envelope mirror port to the organization topic.',
              toolRefs: ['tools/research-publisher'],
              approvalRequired: false,
            },
          ],
        },
        {
          id: 'escalation',
          name: 'Evidence Gap Escalation',
          trigger: 'escalation',
          steps: [
            {
              id: 'escalate-gap',
              description: 'Escalate persistent evidence gaps (data gaps that block a reading) to the escalation category.',
              toolRefs: [],
              approvalRequired: true,
            },
          ],
        },
      ],
      planningPolicy: {
        style: 'reactive',
        maxPlanDepth: 1,
        replanTriggers: ['data-gap-detected', 'manager-request'],
      },
      delegationPolicy: {
        canDelegate: false,
        maxDelegationDepth: 0,
        delegateeCategories: [],
        escalationCategories: ['trading-director'],
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
        requiredEnvironmentFeatures: ['market-event-stream', 'point-in-time-knowledge-firewall'],
        requiredDataCategories: ['news', 'sentiment-scores'],
        requiredFidelityModes: ['exact-replay'],
      },
      substrateCompatibility: {
        requirements: {
          minContextWindowTokens: 32768,
          minMaxOutputTokens: 2048,
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
            evidence: 'capsule/substitution/sentiment-researcher/reasoner-2-2026.03',
            notes: null,
          },
        ],
      },
    },
    createdAt: '2026-06-01T00:00:00Z',
    certified: false,
    certificationEvidence: null,
  },
  research: {
    methodRegistry: SENTIMENT_METHOD_REGISTRY,
    observationKinds: ['news', 'social_signal'],
    evaluationCriteriaRefs: [
      'criteria/sentiment/reading-attainment@1',
      'criteria/sentiment/digest-attainment@1',
      'criteria/sentiment/report-attainment@1',
    ],
    publicationTopic: 'research.sentiment',
    substrateRequirements: [
      'substrate-requirement/structured-output',
      'substrate-requirement/text-modality',
    ],
    authorityScope: {
      scope: 'observation-research-publication',
      execution: 'prohibited',
      orderPlacement: 'prohibited',
      consequentialActions: 'prohibited',
    },
  },
} as unknown as SentimentResearcherBodySpec);

/** The spec's canonical digest (L9 — the spec identity binds into run lineage). */
export const SENTIMENT_RESEARCHER_BODY_DIGEST: string = stableDigestJson(
  SENTIMENT_RESEARCHER_BODY as never,
);

/** Guard: the exact authored spec (identity binding, not just shape). */
export function isSentimentResearcherBody(v: unknown): v is SentimentResearcherBodySpec {
  return (
    isRecord(v) &&
    isRecord(v.bodyVersion) &&
    (v.bodyVersion as Record<string, unknown>).id === 'sentiment-researcher@1.0.0' &&
    validateSentimentResearcherBody(v).length === 0
  );
}
