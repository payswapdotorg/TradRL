// @tradrl/agent-body — Agent Body, BodyVersion and certification contracts.
//
// Spec anchors: spec/ARCHITECTURE-LOCK.md L2 (body/model separation), L3
// (immutable versioned capability — certified/versioned bodies do not mutate
// in place), L8/L20 (execution authority and safety live outside model
// prompts — enforced downstream, DECLARED here), L9 (reproducible lineage);
// spec/ARCHITECTURE.md ("Agent Body" section); spec/DOMAIN-MODEL.md
// (AgentBody/BodyVersion); spec/LEARNING-LOOP.md (Body Versions are produced
// by learning; version lineage is first-class).
//
// Core law (README.md, ARCHITECTURE-LOCK L2):
//   Agent Instance = Agent Body Version
//                  + Cognitive Substrate
//                  + Possession Configuration
//                  + Environment
//                  + Runtime State
// A model is a cognitive substrate. A Body is the persistent, versioned
// trading capability composition possessed by that substrate. A persistent
// capability change creates a NEW BodyVersion; certified versions never
// mutate (L3) — enforced both at type level (deeply readonly types) and at
// runtime (deep freeze + guards).
//
// Cross-lane law: trading domain entities (Order, Portfolio, Goal, Project —
// T002) and market events/time (T004) are referenced ONLY via opaque branded
// string ids declared in primitives.ts. Nothing from those packages is (or can
// be) imported here.

import {
  type BodyId,
  type BodyVersionId,
  type EvidenceRef,
  type GoalRef,
  type ISO8601,
  type KnowledgeSourceRef,
  type RiskPolicyRef,
  type SemVer,
  type SkillArtifactRef,
  type ToolRef,
  deepCloneJson,
  deepFreeze,
  isArrayOf,
  isBodyId,
  isBodyVersionId,
  isDeeplyFrozen,
  isEnum,
  isEvidenceRef,
  isGoalRef,
  isISO8601,
  isKnowledgeSourceRef,
  isNonEmptyString,
  isNonNegativeInteger,
  isNull,
  isPositiveInteger,
  isRecord,
  isRiskPolicyRef,
  isSemVer,
  isSkillArtifactRef,
  isToolRef,
  makeBodyVersionId,
  parseBodyVersionIdString,
} from './primitives';
import {
  type SubstrateCompatibilityManifest,
  isSubstrateCompatibilityManifest,
} from './compatibility';

// ---------------------------------------------------------------------------
// Enums shared by the composition (mirrors of upstream spec vocabulary)
// ---------------------------------------------------------------------------

/**
 * The stable Agent OS kernel verb set (spec/ARCHITECTURE.md, "Agent OS").
 * Semantics are owned by the Agent OS lane (T006); this union is the
 * declarative vocabulary for authority boundaries and authority scopes.
 */
export const AGENT_ACTION_NAMES = [
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

/** An Agent OS kernel action. */
export type AgentActionName = (typeof AGENT_ACTION_NAMES)[number];

/** Guard: `AgentActionName`. */
export const isAgentActionName = isEnum(AGENT_ACTION_NAMES);

/**
 * How a body may relate to consequential execution (ARCHITECTURE-LOCK L8/L20:
 * execution authority is outside model prompts). There is deliberately NO
 * `model-autonomous` member: a body can either never execute (`none`) or may
 * only REQUEST execution through the external authority gateway
 * (`external-gateway-only`). Enforcement lives in the execution gateway lane
 * (T040); this type makes the illegal state unrepresentable in body data.
 */
export const EXECUTION_AUTHORITY_MODES = ['none', 'external-gateway-only'] as const;

/** Declarative execution authority mode of a body. */
export type ExecutionAuthorityMode = (typeof EXECUTION_AUTHORITY_MODES)[number];

/** Guard: `ExecutionAuthorityMode`. */
export const isExecutionAuthorityMode = isEnum(EXECUTION_AUTHORITY_MODES);

/**
 * Evaluation layers, mirroring spec/EVALUATION-PROTOCOL.md layers 0–8.
 * A body declares which layers its certification evidence must cover.
 */
export const EVALUATION_LAYERS = [
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

/** An evaluation layer from spec/EVALUATION-PROTOCOL.md. */
export type EvaluationLayer = (typeof EVALUATION_LAYERS)[number];

/** Guard: `EvaluationLayer`. */
export const isEvaluationLayer = isEnum(EVALUATION_LAYERS);

/**
 * Market World fidelity modes, mirroring spec/ARCHITECTURE-LOCK.md L5
 * (exact replay != reactive replay != generative simulation). The canonical
 * enum is owned by the market lanes (T004/T009); if those lanes rename these
 * values, this mirror must be reconciled (flagged for Tech Lead).
 */
export const FIDELITY_MODES = [
  'exact-replay',
  'reactive-replay',
  'counterfactual-generative',
] as const;

/** A Market World fidelity mode (L5). */
export type FidelityMode = (typeof FIDELITY_MODES)[number];

/** Guard: `FidelityMode`. */
export const isFidelityMode = isEnum(FIDELITY_MODES);

/** Procedure trigger kinds. */
export const PROCEDURE_TRIGGERS = ['scheduled', 'event', 'on-demand', 'escalation'] as const;

/** What can trigger a body procedure. */
export type ProcedureTrigger = (typeof PROCEDURE_TRIGGERS)[number];

/** Guard: `ProcedureTrigger`. */
export const isProcedureTrigger = isEnum(PROCEDURE_TRIGGERS);

/** Planning styles. */
export const PLANNING_STYLES = ['reactive', 'deliberative', 'hybrid'] as const;

/** How the body plans. */
export type PlanningStyle = (typeof PLANNING_STYLES)[number];

/** Guard: `PlanningStyle`. */
export const isPlanningStyle = isEnum(PLANNING_STYLES);

// ---------------------------------------------------------------------------
// AgentBody — the stable identity behind a lineage of versions
// ---------------------------------------------------------------------------

/** The persistent Agent Body identity: stable across BodyVersions. */
export interface AgentBody {
  /** Stable identifier (e.g. `regime-researcher`). */
  readonly id: BodyId;
  /** Human-readable name. */
  readonly name: string;
  /** What this body is for. */
  readonly description: string;
  /** Coarse category, e.g. `research`, `execution`, `risk`, `coordination`. */
  readonly domain: string;
  /** When the body identity was created. */
  readonly createdAt: ISO8601;
}

/** Guard: `AgentBody`. */
export function isAgentBody(v: unknown): v is AgentBody {
  if (!isRecord(v)) return false;
  return (
    isBodyId(v.id) &&
    isNonEmptyString(v.name) &&
    isNonEmptyString(v.description) &&
    isNonEmptyString(v.domain) &&
    isISO8601(v.createdAt)
  );
}

/** Constructs a deeply frozen `AgentBody`. Throws `TypeError` on invalid input. */
export function createAgentBody(draft: AgentBody): AgentBody {
  const problems: string[] = [];
  if (!isBodyId(draft.id)) problems.push('id: invalid BodyId');
  if (!isNonEmptyString(draft.name)) problems.push('name: must be a non-empty string');
  if (!isNonEmptyString(draft.description)) problems.push('description: must be a non-empty string');
  if (!isNonEmptyString(draft.domain)) problems.push('domain: must be a non-empty string');
  if (!isISO8601(draft.createdAt)) problems.push('createdAt: invalid ISO8601 timestamp');
  if (problems.length > 0) throw new TypeError(`createAgentBody: ${problems.join('; ')}`);
  return deepFreeze({ ...draft });
}

// ---------------------------------------------------------------------------
// Capability composition
// ---------------------------------------------------------------------------

/**
 * The body's mission: what it exists to do. `goalRefs` are OPAQUE references
 * to Goal entities owned by the trading-domain lane (T002) — never imported.
 */
export interface Mission {
  /** One-paragraph statement of the mission. */
  readonly summary: string;
  /** Opaque Goal references (T002 lane) this mission serves. */
  readonly goalRefs: readonly GoalRef[];
  /** Standing directives that always apply (natural language). */
  readonly standingDirectives: readonly string[];
}

/** Guard: `Mission`. */
export function isMission(v: unknown): v is Mission {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.summary) &&
    isArrayOf(v.goalRefs, isGoalRef) &&
    isArrayOf(v.standingDirectives, isNonEmptyString)
  );
}

/**
 * One composed capability. `skillArtifactRefs` are OPAQUE references to skill
 * artifacts owned by the body-forge lane (T017). `critical` marks
 * capabilities whose absence blocks meaningful operation (informative for
 * evaluators; not itself an enforcement hook).
 */
export interface BodyCapability {
  /** Capability identifier, unique within the composition. */
  readonly id: string;
  /** Human-readable name. */
  readonly name: string;
  /** What this capability provides. */
  readonly description: string;
  /** Coarse category, e.g. `research`, `execution`, `risk`. */
  readonly category: string;
  /** Opaque skill-artifact references (T017 lane) backing this capability. */
  readonly skillArtifactRefs: readonly SkillArtifactRef[];
  /** Whether absence of this capability blocks meaningful operation. */
  readonly critical: boolean;
}

/** Guard: `BodyCapability`. */
export function isBodyCapability(v: unknown): v is BodyCapability {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.id) &&
    isNonEmptyString(v.name) &&
    isNonEmptyString(v.description) &&
    isNonEmptyString(v.category) &&
    isArrayOf(v.skillArtifactRefs, isSkillArtifactRef) &&
    typeof v.critical === 'boolean'
  );
}

/**
 * Which tools and knowledge sources the body may use. This is DECLARATIVE
 * policy data; runtime enforcement (untrusted-content rules, budgets) lives
 * in the Agent OS / security lanes (T006/T044). Point-in-time compliance
 * (L4) applies system-wide and is not a per-body choice.
 */
export interface KnowledgeToolPolicy {
  /** Tools the body may invoke (opaque tool refs; tooling lane). */
  readonly allowedTools: readonly ToolRef[];
  /** Tools the body must never invoke, even if otherwise available. */
  readonly forbiddenTools: readonly ToolRef[];
  /** Hard cap on tool calls per decision step, or `null` for no declared cap. */
  readonly toolCallBudgetPerDecision: number | null;
  /** Knowledge sources the body may retrieve from (opaque; knowledge lanes). */
  readonly allowedKnowledgeSources: readonly KnowledgeSourceRef[];
  /** Knowledge sources the body must never retrieve from. */
  readonly forbiddenKnowledgeSources: readonly KnowledgeSourceRef[];
}

/** Guard: `KnowledgeToolPolicy`. */
export function isKnowledgeToolPolicy(v: unknown): v is KnowledgeToolPolicy {
  if (!isRecord(v)) return false;
  const budgetOk =
    isNull(v.toolCallBudgetPerDecision) || isNonNegativeInteger(v.toolCallBudgetPerDecision);
  return (
    isArrayOf(v.allowedTools, isToolRef) &&
    isArrayOf(v.forbiddenTools, isToolRef) &&
    budgetOk &&
    isArrayOf(v.allowedKnowledgeSources, isKnowledgeSourceRef) &&
    isArrayOf(v.forbiddenKnowledgeSources, isKnowledgeSourceRef)
  );
}

/** One step of a body procedure. */
export interface ProcedureStep {
  /** Step identifier, unique within its procedure. */
  readonly id: string;
  /** What to do in this step (natural language). */
  readonly description: string;
  /** Opaque tool refs this step may invoke. */
  readonly toolRefs: readonly ToolRef[];
  /** Whether executing this step requires an approval from outside the model. */
  readonly approvalRequired: boolean;
}

/** Guard: `ProcedureStep`. */
export function isProcedureStep(v: unknown): v is ProcedureStep {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.id) &&
    isNonEmptyString(v.description) &&
    isArrayOf(v.toolRefs, isToolRef) &&
    typeof v.approvalRequired === 'boolean'
  );
}

/** A named playbook the body follows when `trigger` fires. */
export interface BodyProcedure {
  /** Procedure identifier, unique within the composition. */
  readonly id: string;
  /** Human-readable name. */
  readonly name: string;
  /** When this procedure runs. */
  readonly trigger: ProcedureTrigger;
  /** Ordered steps (at least one). */
  readonly steps: readonly ProcedureStep[];
}

/** Guard: `BodyProcedure`. */
export function isBodyProcedure(v: unknown): v is BodyProcedure {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.id) &&
    isNonEmptyString(v.name) &&
    isProcedureTrigger(v.trigger) &&
    isArrayOf(v.steps, isProcedureStep)
  );
}

/** How the body plans its work. */
export interface PlanningPolicy {
  /** Planning style. */
  readonly style: PlanningStyle;
  /** Maximum plan depth (plans about plans). */
  readonly maxPlanDepth: number;
  /** Conditions (natural language) that force replanning. */
  readonly replanTriggers: readonly string[];
}

/** Guard: `PlanningPolicy`. */
export function isPlanningPolicy(v: unknown): v is PlanningPolicy {
  if (!isRecord(v)) return false;
  return (
    isPlanningStyle(v.style) &&
    isPositiveInteger(v.maxPlanDepth) &&
    isArrayOf(v.replanTriggers, isNonEmptyString)
  );
}

/** Whether and how the body may delegate to other agents. */
export interface DelegationPolicy {
  /** Whether the body may delegate at all. */
  readonly canDelegate: boolean;
  /** Maximum delegation chain depth below this body (0 when `canDelegate` is false). */
  readonly maxDelegationDepth: number;
  /** Categories of agents this body may delegate to (e.g. `research`). */
  readonly delegateeCategories: readonly string[];
  /** Categories of agents this body escalates to (e.g. `trading-director`). */
  readonly escalationCategories: readonly string[];
}

/** Guard: `DelegationPolicy`. */
export function isDelegationPolicy(v: unknown): v is DelegationPolicy {
  if (!isRecord(v)) return false;
  return (
    typeof v.canDelegate === 'boolean' &&
    isNonNegativeInteger(v.maxDelegationDepth) &&
    isArrayOf(v.delegateeCategories, isNonEmptyString) &&
    isArrayOf(v.escalationCategories, isNonEmptyString)
  );
}

/**
 * The body's authority and safety boundaries. DECLARATIVE policy data only —
 * enforcement (identity, authorization, limits, kill switch, audit) is
 * implemented outside prompts in code/infrastructure (L8/L20; T040/T044
 * lanes). `riskPolicyRef` is an opaque reference to the risk-policy lane
 * (T020).
 */
export interface AuthorityBoundary {
  /** Kernel actions this body is allowed to perform (a superset grant). */
  readonly allowedActions: readonly AgentActionName[];
  /** Kernel actions this body must never perform. */
  readonly prohibitedActions: readonly AgentActionName[];
  /** Actions that additionally require out-of-model approval before effect. */
  readonly approvalRequiredActions: readonly AgentActionName[];
  /** Execution authority mode — `model-autonomous` does not exist (L8/L20). */
  readonly executionAuthority: ExecutionAuthorityMode;
  /** Opaque risk-policy reference (T020 lane), or `null` when not applicable. */
  readonly riskPolicyRef: RiskPolicyRef | null;
}

/** Guard: `AuthorityBoundary`. */
export function isAuthorityBoundary(v: unknown): v is AuthorityBoundary {
  if (!isRecord(v)) return false;
  return (
    isArrayOf(v.allowedActions, isAgentActionName) &&
    isArrayOf(v.prohibitedActions, isAgentActionName) &&
    isArrayOf(v.approvalRequiredActions, isAgentActionName) &&
    isExecutionAuthorityMode(v.executionAuthority) &&
    (isNull(v.riskPolicyRef) || isRiskPolicyRef(v.riskPolicyRef))
  );
}

/**
 * Evaluation and environment requirements a body declares for its
 * certification and operation. Environment features and data categories are
 * opaque strings owned by the environment (T005) and data (T004/T008) lanes.
 */
export interface EvaluationEnvironmentRequirements {
  /** Evaluation layers the body's certification evidence must cover. */
  readonly requiredEvaluationLayers: readonly EvaluationLayer[];
  /** Opaque environment-feature requirements (T005 lane). */
  readonly requiredEnvironmentFeatures: readonly string[];
  /** Opaque data-category requirements (T004/T008 lanes). */
  readonly requiredDataCategories: readonly string[];
  /** Market World fidelity modes the body requires (L5). */
  readonly requiredFidelityModes: readonly FidelityMode[];
}

/** Guard: `EvaluationEnvironmentRequirements`. */
export function isEvaluationEnvironmentRequirements(
  v: unknown,
): v is EvaluationEnvironmentRequirements {
  if (!isRecord(v)) return false;
  return (
    isArrayOf(v.requiredEvaluationLayers, isEvaluationLayer) &&
    isArrayOf(v.requiredEnvironmentFeatures, isNonEmptyString) &&
    isArrayOf(v.requiredDataCategories, isNonEmptyString) &&
    isArrayOf(v.requiredFidelityModes, isFidelityMode)
  );
}

/**
 * The capability composition — the persistent "what the body is" that is
 * independent of any substrate (L2). A change to any field is a persistent
 * capability change and therefore requires a NEW BodyVersion (L3).
 */
export interface BodyComposition {
  /** Mission: summary, opaque goal refs, standing directives. */
  readonly mission: Mission;
  /** Composed capabilities (at least one). */
  readonly capabilities: readonly BodyCapability[];
  /** Knowledge & tool policy (declarative). */
  readonly knowledgeToolPolicy: KnowledgeToolPolicy;
  /** Named procedures/playbooks. */
  readonly procedures: readonly BodyProcedure[];
  /** Planning policy. */
  readonly planningPolicy: PlanningPolicy;
  /** Delegation policy. */
  readonly delegationPolicy: DelegationPolicy;
  /** Authority/safety boundaries (declarative; enforcement is external). */
  readonly authorityBoundary: AuthorityBoundary;
  /** Evaluation/environment requirements. */
  readonly evaluationEnvironment: EvaluationEnvironmentRequirements;
  /** Substrate compatibility manifest. */
  readonly substrateCompatibility: SubstrateCompatibilityManifest;
}

/** Guard: `BodyComposition`. */
export function isBodyComposition(v: unknown): v is BodyComposition {
  if (!isRecord(v)) return false;
  return (
    isMission(v.mission) &&
    isArrayOf(v.capabilities, isBodyCapability) &&
    isKnowledgeToolPolicy(v.knowledgeToolPolicy) &&
    isArrayOf(v.procedures, isBodyProcedure) &&
    isPlanningPolicy(v.planningPolicy) &&
    isDelegationPolicy(v.delegationPolicy) &&
    isAuthorityBoundary(v.authorityBoundary) &&
    isEvaluationEnvironmentRequirements(v.evaluationEnvironment) &&
    isSubstrateCompatibilityManifest(v.substrateCompatibility)
  );
}

/** Semantic invariants of a structurally valid composition (checked by factories). */
function compositionInvariants(composition: BodyComposition): readonly string[] {
  const problems: string[] = [];
  const { mission, capabilities, knowledgeToolPolicy, procedures } = composition;
  const { delegationPolicy, authorityBoundary } = composition;

  if (mission.summary.trim().length === 0) {
    problems.push('mission.summary: must not be blank');
  }
  if (capabilities.length === 0)
    problems.push('capabilities: a body composes at least one capability');
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
  const sourceOverlap = knowledgeToolPolicy.allowedKnowledgeSources.filter((s) =>
    forbiddenSources.has(s),
  );
  if (sourceOverlap.length > 0) {
    problems.push(
      `knowledgeToolPolicy: knowledge sources both allowed and forbidden: ${sourceOverlap.join(', ')}`,
    );
  }

  const procedureIds = procedures.map((p) => p.id);
  const duplicateProcedures = procedureIds.filter((id, i) => procedureIds.indexOf(id) !== i);
  if (duplicateProcedures.length > 0) {
    problems.push(`procedures: duplicate procedure ids ${[...new Set(duplicateProcedures)].join(', ')}`);
  }
  for (const procedure of procedures) {
    if (procedure.steps.length === 0) {
      problems.push(`procedures[${procedure.id}]: a procedure has at least one step`);
    }
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
    problems.push(
      `authorityBoundary: actions both allowed and prohibited: ${prohibitedOverlap.join(', ')}`,
    );
  }
  const approvalOutside = authorityBoundary.approvalRequiredActions.filter(
    (a) => !allowed.has(a),
  );
  if (approvalOutside.length > 0) {
    problems.push(
      `authorityBoundary: approval-required actions not in allowedActions: ${approvalOutside.join(', ')}`,
    );
  }
  if (
    authorityBoundary.allowedActions.includes('EXECUTE') &&
    authorityBoundary.executionAuthority !== 'external-gateway-only'
  ) {
    problems.push(
      'authorityBoundary: EXECUTE in allowedActions requires executionAuthority "external-gateway-only" (L8/L20)',
    );
  }
  if (authorityBoundary.executionAuthority === 'external-gateway-only' && !authorityBoundary.allowedActions.includes('EXECUTE')) {
    problems.push(
      'authorityBoundary: executionAuthority "external-gateway-only" is only meaningful when EXECUTE is in allowedActions',
    );
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Certification evidence
// ---------------------------------------------------------------------------

/**
 * Evidence that a BodyVersion was certified: references to evidence capsules
 * and evaluation reports (opaque; evidence lane), plus who certified, when,
 * and a human summary. The learning loop (spec/LEARNING-LOOP.md) produces
 * this on the path `evaluation -> verification -> Body Version`.
 */
export interface CertificationEvidence {
  /** Evidence capsule references backing the certification decision. */
  readonly evidenceRefs: readonly EvidenceRef[];
  /** Evaluation report references (spec/EVALUATION-PROTOCOL.md runs). */
  readonly evaluationRefs: readonly EvidenceRef[];
  /** Identity of the certifying authority (person, service or pipeline). */
  readonly certifiedBy: string;
  /** When the certification was recorded. */
  readonly certifiedAt: ISO8601;
  /** Human-readable summary of what was verified. */
  readonly summary: string;
}

/** Guard: `CertificationEvidence`. */
export function isCertificationEvidence(v: unknown): v is CertificationEvidence {
  if (!isRecord(v)) return false;
  return (
    isArrayOf(v.evidenceRefs, isEvidenceRef) &&
    isArrayOf(v.evaluationRefs, isEvidenceRef) &&
    isNonEmptyString(v.certifiedBy) &&
    isISO8601(v.certifiedAt) &&
    isNonEmptyString(v.summary)
  );
}

// ---------------------------------------------------------------------------
// BodyVersion / CertifiedBodyVersion
// ---------------------------------------------------------------------------

/**
 * One immutable version of an Agent Body. Created by the body forge (T017)
 * and the learning loop; certified versions never mutate (L3).
 *
 * `id` is canonical and derived: `${bodyId}@${semver}`. `parentId` links to
 * the direct predecessor version within the SAME body (lineage is therefore
 * first-class; see lineage.ts).
 */
export interface BodyVersion {
  /** Canonical identity `${bodyId}@${semver}` (e.g. `regime-researcher@1.2.0`). */
  readonly id: BodyVersionId;
  /** Which body this version belongs to. */
  readonly bodyId: BodyId;
  /** Semantic version of this version (strict semver). */
  readonly version: SemVer;
  /** Direct parent version, or `null` for the root version. */
  readonly parentId: BodyVersionId | null;
  /** The capability composition (L2: substrate-independent). */
  readonly composition: BodyComposition;
  /** When this version was created. */
  readonly createdAt: ISO8601;
  /** Certification flag — `true` only on certified records. */
  readonly certified: boolean;
  /** Certification evidence — non-null iff `certified` (L3 freeze). */
  readonly certificationEvidence: CertificationEvidence | null;
}

/** Guard: `BodyVersion` (structural; accepts certified records too). */
export function isBodyVersion(v: unknown): v is BodyVersion {
  if (!isRecord(v)) return false;
  return (
    isBodyVersionId(v.id) &&
    isBodyId(v.bodyId) &&
    isSemVer(v.version) &&
    (isNull(v.parentId) || isBodyVersionId(v.parentId)) &&
    isBodyComposition(v.composition) &&
    isISO8601(v.createdAt) &&
    typeof v.certified === 'boolean' &&
    (isNull(v.certificationEvidence) || isCertificationEvidence(v.certificationEvidence)) &&
    (v.certified ? v.certificationEvidence !== null : v.certificationEvidence === null)
  );
}

/** Draft accepted by `createBodyVersion`: everything except identity and certification state. */
export type BodyVersionDraft = Omit<BodyVersion, 'id' | 'certified' | 'certificationEvidence'>;

/**
 * Type-level tag proving a BodyVersion went through `certifyBodyVersion`.
 * Compile-time only: `declare const` emits no runtime value, so the tag never
 * appears in serialized data — the runtime guarantee is the `certified` flag
 * plus deep frozenness, checked by `isCertifiedBodyVersion`.
 */
declare const certifiedTag: unique symbol;

/**
 * A certified BodyVersion: deeply readonly at type level, deeply frozen at
 * runtime, carrying non-null certification evidence. Constructible ONLY via
 * `certifyBodyVersion` (or `adoptCertifiedBodyVersion` for trusted ingestion);
 * the phantom symbol tag makes forgery via object literals impossible without
 * an explicit cast.
 */
export interface CertifiedBodyVersion extends BodyVersion {
  readonly certified: true;
  readonly certificationEvidence: CertificationEvidence;
  readonly [certifiedTag]: 'CertifiedBodyVersion';
}

/**
 * Guard: `CertifiedBodyVersion` — the runtime half of the L3 freeze law.
 * Requires the full `BodyVersion` shape, `certified === true`, valid evidence
 * AND deep frozenness: a certified record that can be mutated fails here.
 */
export function isCertifiedBodyVersion(v: unknown): v is CertifiedBodyVersion {
  if (!isBodyVersion(v)) return false;
  if (v.certified !== true) return false;
  if (!isCertificationEvidence(v.certificationEvidence)) return false;
  return isDeeplyFrozen(v);
}

/** Semantic invariants of a structurally valid BodyVersion. */
function bodyVersionInvariants(version: BodyVersion): readonly string[] {
  const problems: string[] = [];
  const canonical = makeBodyVersionId(version.bodyId, version.version);
  if (version.id !== canonical) {
    problems.push(`id: must be canonical "${canonical}" for bodyId + version`);
  }
  if (version.parentId !== null) {
    const parent = parseBodyVersionIdString(version.parentId);
    if (parent === null) {
      problems.push('parentId: not a canonical BodyVersionId');
    } else if (parent.bodyId !== version.bodyId) {
      problems.push(`parentId: belongs to body "${parent.bodyId}", not "${version.bodyId}"`);
    }
  }
  problems.push(...compositionInvariants(version.composition));
  return problems;
}

/**
 * Constructs a deeply frozen, uncertified `BodyVersion` from a draft. The
 * canonical `id` is derived from `bodyId` + `version`, so identity can never
 * disagree with content. Throws `TypeError` (field-prefixed) on invalid input.
 * This is the ONLY sanctioned constructor for uncertified versions; any
 * persistent capability change must go through it (producing a NEW version).
 */
export function createBodyVersion(draft: BodyVersionDraft): BodyVersion {
  const problems: string[] = [];
  if (!isBodyId(draft.bodyId)) problems.push('bodyId: invalid BodyId');
  if (!isSemVer(draft.version)) problems.push('version: invalid SemVer');
  if (!isNull(draft.parentId) && !isBodyVersionId(draft.parentId)) {
    problems.push('parentId: invalid BodyVersionId');
  }
  if (!isBodyComposition(draft.composition)) {
    problems.push('composition: invalid BodyComposition');
  }
  if (!isISO8601(draft.createdAt)) problems.push('createdAt: invalid ISO8601 timestamp');
  if (problems.length === 0) {
    const candidate: BodyVersion = {
      id: makeBodyVersionId(draft.bodyId, draft.version),
      bodyId: draft.bodyId,
      version: draft.version,
      parentId: draft.parentId,
      composition: draft.composition,
      createdAt: draft.createdAt,
      certified: false,
      certificationEvidence: null,
    };
    problems.push(...bodyVersionInvariants(candidate));
  }
  if (problems.length > 0) {
    throw new TypeError(`createBodyVersion: ${problems.join('; ')}`);
  }
  const version: BodyVersion = deepFreeze({
    id: makeBodyVersionId(draft.bodyId, draft.version),
    bodyId: draft.bodyId,
    version: draft.version,
    parentId: draft.parentId,
    composition: draft.composition,
    createdAt: draft.createdAt,
    certified: false,
    certificationEvidence: null,
  });
  return version;
}

/** Why `certifyBodyVersion` refused to certify. */
export const CERTIFICATION_VIOLATION_CODES = [
  'invalid-version',
  'invalid-evidence',
  'missing-evidence',
  'missing-evaluation-evidence',
  'no-tested-substrates',
  'no-passing-substrate-test',
  'already-certified',
] as const;

/** Certification refusal reason. */
export type CertificationViolationCode = (typeof CERTIFICATION_VIOLATION_CODES)[number];

/** Guard: `CertificationViolationCode`. */
export const isCertificationViolationCode = isEnum(CERTIFICATION_VIOLATION_CODES);

/** One certification refusal reason. */
export interface CertificationViolation {
  /** Refusal code. */
  readonly code: CertificationViolationCode;
  /** Human-readable explanation. */
  readonly message: string;
}

/** Result of `certifyBodyVersion`. */
export type CertificationResult =
  | { readonly ok: true; readonly certified: CertifiedBodyVersion }
  | { readonly ok: false; readonly violations: readonly CertificationViolation[] };

/**
 * Certifies a BodyVersion: returns a NEW, deeply frozen `CertifiedBodyVersion`
 * carrying the given evidence. The input version is never mutated (L3); the
 * certified record is a distinct object.
 *
 * Certification preconditions (defensible reading of spec/LEARNING-LOOP.md
 * "Body Version -> compatibility -> shadow" and spec/EVALUATION-PROTOCOL.md
 * layer 7; flagged for Tech Lead ratification):
 * - the version is structurally and semantically valid;
 * - the evidence carries at least one evidence ref and one evaluation ref;
 * - the compatibility manifest records at least one substitution test, with
 *   at least one `pass` (a certified body must be possessable — tested
 *   substrates are frozen into the version because certified versions never
 *   mutate, so adding tests later requires a new version).
 */
export function certifyBodyVersion(
  version: BodyVersion,
  evidence: CertificationEvidence,
): CertificationResult {
  const violations: CertificationViolation[] = [];

  if (!isBodyVersion(version) || bodyVersionInvariants(version).length > 0) {
    violations.push({
      code: 'invalid-version',
      message: `version is not a valid BodyVersion: ${[...bodyVersionProblemsSafe(version)].join('; ')}`,
    });
  }
  if (!isCertificationEvidence(evidence)) {
    violations.push({ code: 'invalid-evidence', message: 'evidence: invalid CertificationEvidence' });
  } else {
    if (evidence.evidenceRefs.length === 0) {
      violations.push({ code: 'missing-evidence', message: 'evidence.evidenceRefs: at least one evidence reference is required' });
    }
    if (evidence.evaluationRefs.length === 0) {
      violations.push({ code: 'missing-evaluation-evidence', message: 'evidence.evaluationRefs: at least one evaluation reference is required' });
    }
  }
  if (isBodyVersion(version)) {
    const manifest = version.composition.substrateCompatibility;
    if (manifest.testedSubstrates.length === 0) {
      violations.push({
        code: 'no-tested-substrates',
        message: 'composition.substrateCompatibility.testedSubstrates: at least one substitution test must be recorded before certification',
      });
    } else if (!manifest.testedSubstrates.some((r) => r.result === 'pass')) {
      violations.push({
        code: 'no-passing-substrate-test',
        message: 'composition.substrateCompatibility.testedSubstrates: at least one substitution test must have result "pass"',
      });
    }
    if (version.certified) {
      violations.push({
        code: 'already-certified',
        message: 'version is already certified; certification is terminal — produce a new version instead (L3)',
      });
    }
  }

  if (violations.length > 0) {
    return { ok: false, violations };
  }

  // The phantom tag is compile-time only; the runtime guarantees are the
  // `certified: true` flag, embedded evidence and deep frozenness (guarded by
  // isCertifiedBodyVersion below).
  const certified = deepFreeze({
    ...deepCloneJson(version),
    certified: true,
    certificationEvidence: deepCloneJson(evidence),
  }) as CertifiedBodyVersion;
  return { ok: true, certified };
}

function bodyVersionProblemsSafe(version: BodyVersion): readonly string[] {
  if (!isBodyVersion(version)) return ['not a valid BodyVersion shape'];
  return bodyVersionInvariants(version);
}

/**
 * Trusted-ingestion constructor for `CertifiedBodyVersion`: validates an
 * unknown value (e.g. parsed JSON) as a certified version, deep-freezes it,
 * and returns it. Throws `TypeError` when the value is not a certifiable
 * record. Use this when loading certified versions from storage; use
 * `certifyBodyVersion` to CREATE certifications.
 */
export function adoptCertifiedBodyVersion(v: unknown): CertifiedBodyVersion {
  if (!isBodyVersion(v) || v.certified !== true || !isCertificationEvidence(v.certificationEvidence)) {
    throw new TypeError('adoptCertifiedBodyVersion: not a certified BodyVersion shape');
  }
  const problems = bodyVersionInvariants(v);
  if (problems.length > 0) {
    throw new TypeError(`adoptCertifiedBodyVersion: ${problems.join('; ')}`);
  }
  const frozen = deepFreeze(deepCloneJson(v)) as BodyVersion;
  if (!isCertifiedBodyVersion(frozen)) {
    throw new TypeError('adoptCertifiedBodyVersion: record failed the certified-version guard after freezing');
  }
  return frozen;
}
