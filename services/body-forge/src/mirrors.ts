/**
 * @tradrl/body-forge (service) — the agent-body BodyVersion structural
 * mirror.
 *
 * STRUCTURAL MIRRORS of @tradrl/agent-body's composition contracts (T003) —
 * DO NOT DIVERGE IN SHAPE. The frozen workspace lockfile forbids a package
 * dependency between the service and the contract packages, so this module
 * re-declares the BodyVersion contract family by STRUCTURE (never by
 * import): the enums, `Mission`, `BodyCapability`,
 * `KnowledgeToolPolicy`, `BodyProcedure`/`ProcedureStep`,
 * `PlanningPolicy`, `DelegationPolicy`, `AuthorityBoundary`,
 * `EvaluationEnvironmentRequirements`, `SubstrateCompatibilityManifest`
 * (requirements, constraints, tested-substrate records), and the
 * `BodyVersion` record itself.
 *
 * THE TRIP WIRES (services/body-forge/src/interop.test.ts) import the REAL
 * agent-body package and prove both directions:
 *  1. a REAL `createBodyVersion` output satisfies `isBodyVersionMirror`;
 *  2. a FORGED candidate (built purely in mirror shapes) satisfies the
 *     REAL agent-body `isBodyVersion` guard — the Work Order's acceptance
 *     criterion: "forged candidates satisfy agent-body's BodyVersion
 *     mirror".
 *
 * Spec anchors: spec/ARCHITECTURE.md "Agent Body" — VERBATIM: "A Body is
 * persistent capability composition containing mission, capabilities,
 * knowledge/tool policy, procedures, planning, delegation,
 * authority/safety boundaries, evaluation/environment requirements and
 * substrate compatibility. Body Versions are immutable.";
 * spec/ARCHITECTURE-LOCK.md L2 (body != model — a forged body carries
 * substrate COMPATIBILITY requirements, never a model identity as
 * suitability evidence), L3 (Body Versions are immutable — the forge
 * MINTS, never mutates), L8/L20 (no `model-autonomous` execution
 * authority), L9 (lineage), L12 (tenant/project).
 */

import {
  type ProjectId,
  type TenantId,
  type TimestampMs,
  canonicalJson,
  deepFreeze,
  isNonEmptyString,
  isRecord,
  stableDigest,
} from '../../../packages/skills/src/index';

// ---------------------------------------------------------------------------
// String-reference spaces (agent-body's unique-symbol brands are opaque at
// runtime — these mirrors use plain opaque-string fields, exactly like the
// JSON canon in contracts/agent/body-version.md)
// ---------------------------------------------------------------------------

/**
 * Canonical BodyVersion identity: `${bodyId}@${semver}` (agent-body's
 * canonical form, mirrored by the skills package's BodyVersionRef guard —
 * used here as a plain string type with the same canonical shape).
 */
export type BodyVersionIdMirror = string;

/** Stable body identity (identifier pattern), e.g. `regime-researcher`. */
export type BodyIdMirror = string;

/** Semantic version (agent-body's SemVer, structural mirror). */
export interface SemVerMirror {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly string[];
  readonly build: readonly string[];
}

/** Guard: `SemVerMirror` (non-negative integer core, identifier lists). */
export function isSemVerMirror(v: unknown): v is SemVerMirror {
  if (!isRecord(v)) return false;
  if (typeof v.major !== 'number' || !Number.isInteger(v.major) || v.major < 0) return false;
  if (typeof v.minor !== 'number' || !Number.isInteger(v.minor) || v.minor < 0) return false;
  if (typeof v.patch !== 'number' || !Number.isInteger(v.patch) || v.patch < 0) return false;
  if (!Array.isArray(v.prerelease) || !v.prerelease.every((p) => typeof p === 'string' && p.length > 0)) return false;
  if (!Array.isArray(v.build) || !v.build.every((p) => typeof p === 'string' && p.length > 0)) return false;
  return true;
}

/** Renders a `SemVerMirror` to its canonical string form. */
export function semVerMirrorToString(v: SemVerMirror): string {
  const base = `${v.major}.${v.minor}.${v.patch}`;
  const prerelease = v.prerelease.length > 0 ? `-${v.prerelease.join('.')}` : '';
  const build = v.build.length > 0 ? `+${v.build.join('.')}` : '';
  return `${base}${prerelease}${build}`;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const ISO8601_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/** Guard: a canonical `${bodyId}@${semver}` identity (mirror of agent-body's isBodyVersionId). */
export function isBodyVersionIdMirror(v: unknown): v is BodyVersionIdMirror {
  if (typeof v !== 'string') return false;
  const at = v.indexOf('@');
  if (at <= 0 || at === v.length - 1) return false;
  if (!ID_PATTERN.test(v.slice(0, at))) return false;
  const version = v.slice(at + 1);
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    return false;
  }
  return true;
}

/** Guard: a body identity (identifier pattern). */
export function isBodyIdMirror(v: unknown): v is BodyIdMirror {
  return typeof v === 'string' && ID_PATTERN.test(v);
}

/** Guard: a timezone-qualified ISO 8601 timestamp string (mirror of agent-body's isISO8601). */
export function isIso8601Mirror(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  if (!ISO8601_PATTERN.test(v)) return false;
  return !Number.isNaN(Date.parse(v));
}

// ---------------------------------------------------------------------------
// Closed vocabularies (mirrors of agent-body's composition enums)
// ---------------------------------------------------------------------------

/** The Agent OS kernel verb set (mirror of agent-body's AGENT_ACTION_NAMES). */
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

/** One Agent OS kernel action (mirror). */
export type AgentActionNameMirror = (typeof AGENT_ACTION_NAMES_MIRROR)[number];

/** Guard: `AgentActionNameMirror`. */
export function isAgentActionNameMirror(v: unknown): v is AgentActionNameMirror {
  return typeof v === 'string' && (AGENT_ACTION_NAMES_MIRROR as readonly string[]).includes(v);
}

/**
 * Execution authority modes (mirror). There is deliberately NO
 * `model-autonomous` member — L8/L20: execution authority lives outside
 * model prompts.
 */
export const EXECUTION_AUTHORITY_MODES_MIRROR = ['none', 'external-gateway-only'] as const;

/** One execution authority mode (mirror). */
export type ExecutionAuthorityModeMirror = (typeof EXECUTION_AUTHORITY_MODES_MIRROR)[number];

/** Guard: `ExecutionAuthorityModeMirror`. */
export function isExecutionAuthorityModeMirror(v: unknown): v is ExecutionAuthorityModeMirror {
  return typeof v === 'string' && (EXECUTION_AUTHORITY_MODES_MIRROR as readonly string[]).includes(v);
}

/** Evaluation layers (mirror of spec/EVALUATION-PROTOCOL.md layers 0-8). */
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

/** One evaluation layer (mirror). */
export type EvaluationLayerMirror = (typeof EVALUATION_LAYERS_MIRROR)[number];

/** Guard: `EvaluationLayerMirror`. */
export function isEvaluationLayerMirror(v: unknown): v is EvaluationLayerMirror {
  return typeof v === 'string' && (EVALUATION_LAYERS_MIRROR as readonly string[]).includes(v);
}

/** Market World fidelity modes (mirror — L5). */
export const FIDELITY_MODES_MIRROR = ['exact-replay', 'reactive-replay', 'counterfactual-generative'] as const;

/** One fidelity mode (mirror). */
export type FidelityModeMirror = (typeof FIDELITY_MODES_MIRROR)[number];

/** Guard: `FidelityModeMirror`. */
export function isFidelityModeMirror(v: unknown): v is FidelityModeMirror {
  return typeof v === 'string' && (FIDELITY_MODES_MIRROR as readonly string[]).includes(v);
}

/** Procedure trigger kinds (mirror). */
export const PROCEDURE_TRIGGERS_MIRROR = ['scheduled', 'event', 'on-demand', 'escalation'] as const;

/** One procedure trigger (mirror). */
export type ProcedureTriggerMirror = (typeof PROCEDURE_TRIGGERS_MIRROR)[number];

/** Guard: `ProcedureTriggerMirror`. */
export function isProcedureTriggerMirror(v: unknown): v is ProcedureTriggerMirror {
  return typeof v === 'string' && (PROCEDURE_TRIGGERS_MIRROR as readonly string[]).includes(v);
}

/** Planning styles (mirror). */
export const PLANNING_STYLES_MIRROR = ['reactive', 'deliberative', 'hybrid'] as const;

/** One planning style (mirror). */
export type PlanningStyleMirror = (typeof PLANNING_STYLES_MIRROR)[number];

/** Guard: `PlanningStyleMirror`. */
export function isPlanningStyleMirror(v: unknown): v is PlanningStyleMirror {
  return typeof v === 'string' && (PLANNING_STYLES_MIRROR as readonly string[]).includes(v);
}

/** Substrate modalities (mirror of agent-body's MODALITIES). */
export const MODALITIES_MIRROR = ['text', 'image', 'audio', 'video'] as const;

/** One substrate modality (mirror). */
export type ModalityMirror = (typeof MODALITIES_MIRROR)[number];

/** Guard: `ModalityMirror`. */
export function isModalityMirror(v: unknown): v is ModalityMirror {
  return typeof v === 'string' && (MODALITIES_MIRROR as readonly string[]).includes(v);
}

/** Requirement levels (mirror). */
export const REQUIREMENT_LEVELS_MIRROR = ['required', 'optional'] as const;

/** One requirement level (mirror). */
export type RequirementLevelMirror = (typeof REQUIREMENT_LEVELS_MIRROR)[number];

/** Guard: `RequirementLevelMirror`. */
export function isRequirementLevelMirror(v: unknown): v is RequirementLevelMirror {
  return typeof v === 'string' && (REQUIREMENT_LEVELS_MIRROR as readonly string[]).includes(v);
}

/** Substitution test outcomes (mirror). */
export const SUBSTITUTION_TEST_RESULTS_MIRROR = ['pass', 'fail', 'conditional'] as const;

/** One substitution test outcome (mirror). */
export type SubstitutionTestResultMirror = (typeof SUBSTITUTION_TEST_RESULTS_MIRROR)[number];

/** Guard: `SubstitutionTestResultMirror`. */
export function isSubstitutionTestResultMirror(v: unknown): v is SubstitutionTestResultMirror {
  return typeof v === 'string' && (SUBSTITUTION_TEST_RESULTS_MIRROR as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Composition members (mirrors — field-for-field with agent-body's body.ts)
// ---------------------------------------------------------------------------

/** Mission (mirror of agent-body's Mission). */
export interface MissionMirror {
  readonly summary: string;
  readonly goalRefs: readonly string[];
  readonly standingDirectives: readonly string[];
}

/** Guard: `MissionMirror`. */
export function isMissionMirror(v: unknown): v is MissionMirror {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.summary) &&
    Array.isArray(v.goalRefs) &&
    v.goalRefs.every((g) => isNonEmptyString(g)) &&
    Array.isArray(v.standingDirectives) &&
    v.standingDirectives.every((d) => isNonEmptyString(d))
  );
}

/**
 * One composed capability (mirror of agent-body's BodyCapability).
 * `skillArtifactRefs` are the OPAQUE references THIS LANE mints (T017) —
 * the evidence law flows through them.
 */
export interface BodyCapabilityMirror {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly skillArtifactRefs: readonly string[];
  readonly critical: boolean;
}

/** Guard: `BodyCapabilityMirror`. */
export function isBodyCapabilityMirror(v: unknown): v is BodyCapabilityMirror {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.id) &&
    isNonEmptyString(v.name) &&
    isNonEmptyString(v.description) &&
    isNonEmptyString(v.category) &&
    Array.isArray(v.skillArtifactRefs) &&
    v.skillArtifactRefs.every((r) => isNonEmptyString(r)) &&
    typeof v.critical === 'boolean'
  );
}

/** Knowledge/tool policy (mirror of agent-body's KnowledgeToolPolicy). */
export interface KnowledgeToolPolicyMirror {
  readonly allowedTools: readonly string[];
  readonly forbiddenTools: readonly string[];
  readonly toolCallBudgetPerDecision: number | null;
  readonly allowedKnowledgeSources: readonly string[];
  readonly forbiddenKnowledgeSources: readonly string[];
}

/** Guard: `KnowledgeToolPolicyMirror`. */
export function isKnowledgeToolPolicyMirror(v: unknown): v is KnowledgeToolPolicyMirror {
  if (!isRecord(v)) return false;
  const budgetOk =
    v.toolCallBudgetPerDecision === null ||
    (typeof v.toolCallBudgetPerDecision === 'number' &&
      Number.isInteger(v.toolCallBudgetPerDecision) &&
      v.toolCallBudgetPerDecision >= 0);
  return (
    Array.isArray(v.allowedTools) &&
    v.allowedTools.every((t) => isNonEmptyString(t)) &&
    Array.isArray(v.forbiddenTools) &&
    v.forbiddenTools.every((t) => isNonEmptyString(t)) &&
    budgetOk &&
    Array.isArray(v.allowedKnowledgeSources) &&
    v.allowedKnowledgeSources.every((s) => isNonEmptyString(s)) &&
    Array.isArray(v.forbiddenKnowledgeSources) &&
    v.forbiddenKnowledgeSources.every((s) => isNonEmptyString(s))
  );
}

/** One procedure step (mirror of agent-body's ProcedureStep). */
export interface ProcedureStepMirror {
  readonly id: string;
  readonly description: string;
  readonly toolRefs: readonly string[];
  readonly approvalRequired: boolean;
}

/** Guard: `ProcedureStepMirror`. */
export function isProcedureStepMirror(v: unknown): v is ProcedureStepMirror {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.id) &&
    isNonEmptyString(v.description) &&
    Array.isArray(v.toolRefs) &&
    v.toolRefs.every((t) => isNonEmptyString(t)) &&
    typeof v.approvalRequired === 'boolean'
  );
}

/** A named playbook (mirror of agent-body's BodyProcedure). */
export interface BodyProcedureMirror {
  readonly id: string;
  readonly name: string;
  readonly trigger: ProcedureTriggerMirror;
  readonly steps: readonly ProcedureStepMirror[];
}

/** Guard: `BodyProcedureMirror`. */
export function isBodyProcedureMirror(v: unknown): v is BodyProcedureMirror {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.id) &&
    isNonEmptyString(v.name) &&
    isProcedureTriggerMirror(v.trigger) &&
    Array.isArray(v.steps) &&
    v.steps.length > 0 &&
    v.steps.every((s) => isProcedureStepMirror(s))
  );
}

/** Planning policy (mirror of agent-body's PlanningPolicy). */
export interface PlanningPolicyMirror {
  readonly style: PlanningStyleMirror;
  readonly maxPlanDepth: number;
  readonly replanTriggers: readonly string[];
}

/** Guard: `PlanningPolicyMirror`. */
export function isPlanningPolicyMirror(v: unknown): v is PlanningPolicyMirror {
  if (!isRecord(v)) return false;
  return (
    isPlanningStyleMirror(v.style) &&
    typeof v.maxPlanDepth === 'number' &&
    Number.isInteger(v.maxPlanDepth) &&
    v.maxPlanDepth >= 1 &&
    Array.isArray(v.replanTriggers) &&
    v.replanTriggers.every((t) => isNonEmptyString(t))
  );
}

/** Delegation policy (mirror of agent-body's DelegationPolicy). */
export interface DelegationPolicyMirror {
  readonly canDelegate: boolean;
  readonly maxDelegationDepth: number;
  readonly delegateeCategories: readonly string[];
  readonly escalationCategories: readonly string[];
}

/** Guard: `DelegationPolicyMirror`. */
export function isDelegationPolicyMirror(v: unknown): v is DelegationPolicyMirror {
  if (!isRecord(v)) return false;
  return (
    typeof v.canDelegate === 'boolean' &&
    typeof v.maxDelegationDepth === 'number' &&
    Number.isInteger(v.maxDelegationDepth) &&
    v.maxDelegationDepth >= 0 &&
    Array.isArray(v.delegateeCategories) &&
    v.delegateeCategories.every((c) => isNonEmptyString(c)) &&
    Array.isArray(v.escalationCategories) &&
    v.escalationCategories.every((c) => isNonEmptyString(c))
  );
}

/**
 * Authority/safety boundaries (mirror of agent-body's AuthorityBoundary —
 * DECLARATIVE policy data only; enforcement is external, L8/L20).
 */
export interface AuthorityBoundaryMirror {
  readonly allowedActions: readonly AgentActionNameMirror[];
  readonly prohibitedActions: readonly AgentActionNameMirror[];
  readonly approvalRequiredActions: readonly AgentActionNameMirror[];
  readonly executionAuthority: ExecutionAuthorityModeMirror;
  readonly riskPolicyRef: string | null;
}

/** Guard: `AuthorityBoundaryMirror`. */
export function isAuthorityBoundaryMirror(v: unknown): v is AuthorityBoundaryMirror {
  if (!isRecord(v)) return false;
  return (
    Array.isArray(v.allowedActions) &&
    v.allowedActions.every((a) => isAgentActionNameMirror(a)) &&
    Array.isArray(v.prohibitedActions) &&
    v.prohibitedActions.every((a) => isAgentActionNameMirror(a)) &&
    Array.isArray(v.approvalRequiredActions) &&
    v.approvalRequiredActions.every((a) => isAgentActionNameMirror(a)) &&
    isExecutionAuthorityModeMirror(v.executionAuthority) &&
    (v.riskPolicyRef === null || isNonEmptyString(v.riskPolicyRef))
  );
}

/** Evaluation/environment requirements (mirror). */
export interface EvaluationEnvironmentRequirementsMirror {
  readonly requiredEvaluationLayers: readonly EvaluationLayerMirror[];
  readonly requiredEnvironmentFeatures: readonly string[];
  readonly requiredDataCategories: readonly string[];
  readonly requiredFidelityModes: readonly FidelityModeMirror[];
}

/** Guard: `EvaluationEnvironmentRequirementsMirror`. */
export function isEvaluationEnvironmentRequirementsMirror(
  v: unknown,
): v is EvaluationEnvironmentRequirementsMirror {
  if (!isRecord(v)) return false;
  return (
    Array.isArray(v.requiredEvaluationLayers) &&
    v.requiredEvaluationLayers.every((l) => isEvaluationLayerMirror(l)) &&
    Array.isArray(v.requiredEnvironmentFeatures) &&
    v.requiredEnvironmentFeatures.every((f) => isNonEmptyString(f)) &&
    Array.isArray(v.requiredDataCategories) &&
    v.requiredDataCategories.every((c) => isNonEmptyString(c)) &&
    Array.isArray(v.requiredFidelityModes) &&
    v.requiredFidelityModes.every((m) => isFidelityModeMirror(m))
  );
}

// ---------------------------------------------------------------------------
// Substrate compatibility (mirror of agent-body's compatibility.ts)
// ---------------------------------------------------------------------------

/** Substrate requirements (mirror of agent-body's SubstrateRequirements). */
export interface SubstrateRequirementsMirror {
  readonly minContextWindowTokens: number;
  readonly minMaxOutputTokens: number;
  readonly requiredInputModalities: readonly ModalityMirror[];
  readonly requiredOutputModalities: readonly ModalityMirror[];
  readonly toolUse: RequirementLevelMirror;
  readonly structuredOutput: RequirementLevelMirror;
}

/** Guard: `SubstrateRequirementsMirror`. */
export function isSubstrateRequirementsMirror(v: unknown): v is SubstrateRequirementsMirror {
  if (!isRecord(v)) return false;
  const nonNegInt = (x: unknown): boolean =>
    typeof x === 'number' && Number.isInteger(x) && x >= 0;
  return (
    nonNegInt(v.minContextWindowTokens) &&
    nonNegInt(v.minMaxOutputTokens) &&
    Array.isArray(v.requiredInputModalities) &&
    v.requiredInputModalities.every((m) => isModalityMirror(m)) &&
    Array.isArray(v.requiredOutputModalities) &&
    v.requiredOutputModalities.every((m) => isModalityMirror(m)) &&
    isRequirementLevelMirror(v.toolUse) &&
    isRequirementLevelMirror(v.structuredOutput)
  );
}

/** Substrate constraints (mirror of agent-body's SubstrateConstraints). */
export interface SubstrateConstraintsMirror {
  readonly allowedSubstitutionClasses: readonly string[] | null;
  readonly maxInputCostPerMTokens: number | null;
  readonly maxOutputCostPerMTokens: number | null;
  readonly maxP95LatencyMs: number | null;
}

/** Guard: `SubstrateConstraintsMirror`. */
export function isSubstrateConstraintsMirror(v: unknown): v is SubstrateConstraintsMirror {
  if (!isRecord(v)) return false;
  const nonNeg = (x: unknown): boolean =>
    x === null || (typeof x === 'number' && Number.isFinite(x) && x >= 0);
  return (
    (v.allowedSubstitutionClasses === null ||
      (Array.isArray(v.allowedSubstitutionClasses) &&
        v.allowedSubstitutionClasses.every((c) => isNonEmptyString(c)))) &&
    nonNeg(v.maxInputCostPerMTokens) &&
    nonNeg(v.maxOutputCostPerMTokens) &&
    nonNeg(v.maxP95LatencyMs)
  );
}

/** A recorded substitution test (mirror of agent-body's TestedSubstrateRecord). */
export interface TestedSubstrateRecordMirror {
  readonly substrate: string;
  readonly result: SubstitutionTestResultMirror;
  readonly testedAt: string;
  readonly evidence: string;
  readonly notes: string | null;
}

/** Guard: `TestedSubstrateRecordMirror`. */
export function isTestedSubstrateRecordMirror(v: unknown): v is TestedSubstrateRecordMirror {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.substrate) &&
    isSubstitutionTestResultMirror(v.result) &&
    isIso8601Mirror(v.testedAt) &&
    isNonEmptyString(v.evidence) &&
    (v.notes === null || isNonEmptyString(v.notes))
  );
}

/**
 * The substrate compatibility manifest (mirror of agent-body's
 * SubstrateCompatibilityManifest). This is the COMPATIBILITY GATE's mirror
 * shape: a forged candidate whose manifest fails this guard is NOT minted
 * (`compatibility_fail`, typed error).
 */
export interface SubstrateCompatibilityManifestMirror {
  readonly requirements: SubstrateRequirementsMirror;
  readonly constraints: SubstrateConstraintsMirror;
  readonly testedSubstrates: readonly TestedSubstrateRecordMirror[];
}

/** Guard: `SubstrateCompatibilityManifestMirror`. */
export function isSubstrateCompatibilityManifestMirror(
  v: unknown,
): v is SubstrateCompatibilityManifestMirror {
  if (!isRecord(v)) return false;
  return (
    isSubstrateRequirementsMirror(v.requirements) &&
    isSubstrateConstraintsMirror(v.constraints) &&
    Array.isArray(v.testedSubstrates) &&
    v.testedSubstrates.every((r) => isTestedSubstrateRecordMirror(r))
  );
}

// ---------------------------------------------------------------------------
// The composition + the version (mirrors of agent-body's BodyComposition /
// BodyVersion — full shape, JSON-canonical)
// ---------------------------------------------------------------------------

/** The capability composition (mirror of agent-body's BodyComposition). */
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

/** Guard: `BodyCompositionMirror` (structural; semantic invariants via `compositionInvariantsMirror`). */
export function isBodyCompositionMirror(v: unknown): v is BodyCompositionMirror {
  if (!isRecord(v)) return false;
  return (
    isMissionMirror(v.mission) &&
    Array.isArray(v.capabilities) &&
    v.capabilities.length > 0 &&
    v.capabilities.every((c) => isBodyCapabilityMirror(c)) &&
    isKnowledgeToolPolicyMirror(v.knowledgeToolPolicy) &&
    Array.isArray(v.procedures) &&
    v.procedures.every((p) => isBodyProcedureMirror(p)) &&
    isPlanningPolicyMirror(v.planningPolicy) &&
    isDelegationPolicyMirror(v.delegationPolicy) &&
    isAuthorityBoundaryMirror(v.authorityBoundary) &&
    isEvaluationEnvironmentRequirementsMirror(v.evaluationEnvironment) &&
    isSubstrateCompatibilityManifestMirror(v.substrateCompatibility)
  );
}

/** Certification evidence (mirror of agent-body's CertificationEvidence). */
export interface CertificationEvidenceMirror {
  readonly evidenceRefs: readonly string[];
  readonly evaluationRefs: readonly string[];
  readonly certifiedBy: string;
  readonly certifiedAt: string;
  readonly summary: string;
}

/** Guard: `CertificationEvidenceMirror`. */
export function isCertificationEvidenceMirror(v: unknown): v is CertificationEvidenceMirror {
  if (!isRecord(v)) return false;
  return (
    Array.isArray(v.evidenceRefs) &&
    v.evidenceRefs.length > 0 &&
    v.evidenceRefs.every((r) => isNonEmptyString(r)) &&
    Array.isArray(v.evaluationRefs) &&
    v.evaluationRefs.length > 0 &&
    v.evaluationRefs.every((r) => isNonEmptyString(r)) &&
    isNonEmptyString(v.certifiedBy) &&
    isIso8601Mirror(v.certifiedAt) &&
    isNonEmptyString(v.summary)
  );
}

/**
 * One immutable BodyVersion (mirror of agent-body's BodyVersion — the full
 * JSON canon from contracts/agent/body-version.md). The forge MINTS these;
 * certified versions never mutate (L3).
 */
export interface BodyVersionMirror {
  readonly id: BodyVersionIdMirror;
  readonly bodyId: BodyIdMirror;
  readonly version: SemVerMirror;
  readonly parentId: BodyVersionIdMirror | null;
  readonly composition: BodyCompositionMirror;
  readonly createdAt: string;
  readonly certified: boolean;
  readonly certificationEvidence: CertificationEvidenceMirror | null;
}

/** Guard: `BodyVersionMirror` (structural; `certified` iff evidence non-null — the L3 flag law). */
export function isBodyVersionMirror(v: unknown): v is BodyVersionMirror {
  if (!isRecord(v)) return false;
  return (
    isBodyVersionIdMirror(v.id) &&
    isBodyIdMirror(v.bodyId) &&
    isSemVerMirror(v.version) &&
    (v.parentId === null || isBodyVersionIdMirror(v.parentId)) &&
    isBodyCompositionMirror(v.composition) &&
    isIso8601Mirror(v.createdAt) &&
    typeof v.certified === 'boolean' &&
    (v.certificationEvidence === null || isCertificationEvidenceMirror(v.certificationEvidence)) &&
    (v.certified ? v.certificationEvidence !== null : v.certificationEvidence === null)
  );
}

// ---------------------------------------------------------------------------
// Semantic invariants (mirrors of agent-body's composition/version laws)
// ---------------------------------------------------------------------------

/**
 * The semantic invariants of a structurally valid composition (mirror of
 * agent-body's `compositionInvariants`): unique capability ids, no
 * allowed/forbidden overlap (tools AND knowledge sources), unique
 * procedure ids with non-empty steps, delegation depth law, authority
 * boundary laws (EXECUTE requires external-gateway-only — L8/L20).
 */
export function compositionInvariantsMirror(composition: BodyCompositionMirror): readonly string[] {
  const problems: string[] = [];
  const { mission, capabilities, knowledgeToolPolicy, procedures } = composition;
  const { delegationPolicy, authorityBoundary } = composition;

  if (mission.summary.trim().length === 0) {
    problems.push('mission.summary: must not be blank');
  }
  if (capabilities.length === 0) {
    problems.push('capabilities: a body composes at least one capability');
  }
  const capabilityIds = capabilities.map((c) => c.id);
  const duplicateCapabilities = capabilityIds.filter((id, i) => capabilityIds.indexOf(id) !== i);
  if (duplicateCapabilities.length > 0) {
    problems.push(`capabilities: duplicate capability ids ${[...new Set(duplicateCapabilities)].join(', ')}`);
  }

  const forbiddenTools = new Set<string>(knowledgeToolPolicy.forbiddenTools);
  const toolOverlap = knowledgeToolPolicy.allowedTools.filter((t) => forbiddenTools.has(t));
  if (toolOverlap.length > 0) {
    problems.push(`knowledgeToolPolicy: tools both allowed and forbidden: ${toolOverlap.join(', ')}`);
  }
  const forbiddenSources = new Set<string>(knowledgeToolPolicy.forbiddenKnowledgeSources);
  const sourceOverlap = knowledgeToolPolicy.allowedKnowledgeSources.filter((s) => forbiddenSources.has(s));
  if (sourceOverlap.length > 0) {
    problems.push(`knowledgeToolPolicy: knowledge sources both allowed and forbidden: ${sourceOverlap.join(', ')}`);
  }

  const procedureIds = procedures.map((p) => p.id);
  const duplicateProcedures = procedureIds.filter((id, i) => procedureIds.indexOf(id) !== i);
  if (duplicateProcedures.length > 0) {
    problems.push(`procedures: duplicate procedure ids ${[...new Set(duplicateProcedures)].join(', ')}`);
  }
  for (const procedure of procedures) {
    const stepIds = procedure.steps.map((s) => s.id);
    const duplicateSteps = stepIds.filter((id, i) => stepIds.indexOf(id) !== i);
    if (duplicateSteps.length > 0) {
      problems.push(`procedures[${procedure.id}]: duplicate step ids ${[...new Set(duplicateSteps)].join(', ')}`);
    }
  }

  if (!delegationPolicy.canDelegate && delegationPolicy.maxDelegationDepth > 0) {
    problems.push('delegationPolicy: maxDelegationDepth must be 0 when canDelegate is false');
  }

  const allowed = new Set<string>(authorityBoundary.allowedActions);
  const prohibitedOverlap = authorityBoundary.prohibitedActions.filter((a) => allowed.has(a));
  if (prohibitedOverlap.length > 0) {
    problems.push(`authorityBoundary: actions both allowed and prohibited: ${prohibitedOverlap.join(', ')}`);
  }
  const approvalOutside = authorityBoundary.approvalRequiredActions.filter((a) => !allowed.has(a));
  if (approvalOutside.length > 0) {
    problems.push(`authorityBoundary: approval-required actions not in allowedActions: ${approvalOutside.join(', ')}`);
  }
  if (
    authorityBoundary.allowedActions.includes('EXECUTE') &&
    authorityBoundary.executionAuthority !== 'external-gateway-only'
  ) {
    problems.push('authorityBoundary: EXECUTE in allowedActions requires executionAuthority "external-gateway-only" (L8/L20)');
  }
  if (authorityBoundary.executionAuthority === 'external-gateway-only' && !authorityBoundary.allowedActions.includes('EXECUTE')) {
    problems.push('authorityBoundary: executionAuthority "external-gateway-only" is only meaningful when EXECUTE is in allowedActions');
  }
  return problems;
}

/**
 * The semantic invariants of a structurally valid version (mirror of
 * agent-body's `bodyVersionInvariants`): canonical identity, parent in the
 * SAME body, composition invariants.
 */
export function bodyVersionInvariantsMirror(version: BodyVersionMirror): readonly string[] {
  const problems: string[] = [];
  const canonical = `${version.bodyId}@${semVerMirrorToString(version.version)}`;
  if (version.id !== canonical) {
    problems.push(`id: must be canonical "${canonical}" for bodyId + version`);
  }
  if (version.parentId !== null) {
    const parentAt = version.parentId.indexOf('@');
    const parentBody = parentAt > 0 ? version.parentId.slice(0, parentAt) : '';
    if (parentBody !== version.bodyId) {
      problems.push(`parentId: belongs to body "${parentBody}", not "${version.bodyId}"`);
    }
  }
  problems.push(...compositionInvariantsMirror(version.composition));
  return problems;
}

/** Canonical JSON of any mirror record (byte-determinism, L9). */
export function mirrorCanonicalJson(value: unknown): string {
  return canonicalJson(JSON.parse(JSON.stringify(value)) as never);
}

/** Stable digest of a mirror record's canonical JSON (L9 lineage binding). */
export function mirrorStableDigest(value: unknown): string {
  return stableDigest(mirrorCanonicalJson(value));
}

/** Deep-freezes a mirror record (L3 runtime half — re-exported from the contract package). */
export const freezeMirror = deepFreeze;

/** The forge's scope (L12) — carried on every run-state and attempt record. */
export interface ForgeScope {
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
}

/** Guard: `ForgeScope`. */
export function isForgeScope(v: unknown): v is ForgeScope {
  if (!isRecord(v)) return false;
  return isNonEmptyString(v.tenantId) && isNonEmptyString(v.projectId);
}

/** An explicit epoch-ms instant (carried, never read from a clock). */
export type ForgeInstant = TimestampMs;
