/**
 * @tradrl/autonomous-learning (service) — branded identity references
 * (Work Order T035).
 *
 * Id discipline (mirroring every merged lane):
 * - Every id is an opaque non-empty string at runtime; branding is a
 *   compile-time nominal tag so distinct identity spaces are not
 *   interchangeable.
 * - Ids OWNED by this lane are listed first: the improvement cycle, gap,
 *   revision, commission, memory-feed and search-trial identity spaces —
 *   every one content-addressed over its canonical content (L9: identity
 *   is derived, deterministic and bound to content).
 * - The remaining OPAQUE cross-lane references mirror their owners' exact
 *   discipline (D-003/D-004): T033's hook/outcome/post-mortem refs
 *   (packages/outcomes), T034's firm-knowledge refs (packages/firm-memory),
 *   T015/T016's capability-gap and curriculum identities
 *   (packages/organization + services/learning), T011's
 *   trajectory/experiment/trial/verdict identity spaces, T031's
 *   search-record/config-snapshot identity spaces (packages/search-lineage),
 *   and T007's tenant/project scope (packages/control-domain). This lane
 *   never imports those packages — it reserves the reference types here
 *   (the same structural-mirror law as TimestampMs; the interop test is
 *   the drift trip wire).
 */

import { isNonEmptyString, type Brand } from './primitives';

// --- Ids owned by the autonomous-learning lane (T035) -------------------------

/**
 * Identity of one IMPROVEMENT CYCLE record: `alc:<digest>` where the
 * digest covers the canonical content of the cycle's record (the consumed
 * hooks, the minted products, the gate verdicts, the injected instant, the
 * scope). The improvement log's entries are these records, chain-folded
 * in append order.
 */
export type ImprovementCycleId = Brand<string, 'TradRL.ImprovementCycleId'>;

/**
 * Identity of one MINTED CAPABILITY GAP: `alg:<digest>` — a loop-minted
 * failure-class gap record in the organization lane's opaque
 * `CapabilityGapId` identity space (T016's guard accepts any identifier
 * string; the loop's ids are additionally content-addressed so the same
 * failure evidence always addresses the same gap).
 */
export type ImprovementGapId = Brand<string, 'TradRL.ImprovementGapId'>;

/**
 * Identity of one CURRICULUM REVISION: `alv:<digest>` — the revised
 * curriculum plan-input bundle (T015 `planCurriculum`-consumable), derived
 * from the cycle's minted gaps and the trail's earned rung.
 */
export type CurriculumRevisionId = Brand<string, 'TradRL.CurriculumRevisionId'>;

/**
 * Identity of one SKILL COMMISSION: `als:<digest>` — the body-forge input
 * bundle (T017 `forgeBodyVersion`-consumable: gaps + evidence + seed),
 * with the adoption gate's verdict (commissioned | withheld + the typed
 * refusal).
 */
export type SkillCommissionId = Brand<string, 'TradRL.SkillCommissionId'>;

/**
 * Identity of one MEMORY FEED: `alm:<digest>` — the Firm-Brain ingestion
 * bundle (T034 `ingestFirmLearning`-consumable: the outcome + post-mortem
 * snapshot at the cycle instant).
 */
export type MemoryFeedId = Brand<string, 'TradRL.MemoryFeedId'>;

/**
 * Identity of one IMPROVEMENT SEARCH TRIAL: `alt:<digest>` — the trial id
 * the loop mints for every emitted search-record append bundle (the
 * improvement loop IS a search; T031's record retains it).
 */
export type ImprovementTrialId = Brand<string, 'TradRL.ImprovementTrialId'>;

// --- Opaque cross-lane references (referents owned by other lanes) ------------

/** Tenant identity — L12 (tenant isolation). Mirror of @tradrl/domain-core. */
export type TenantId = Brand<string, 'TenantId'>;

/** Project continuity root — L15. Mirror of @tradrl/domain-core. */
export type ProjectId = Brand<string, 'ProjectId'>;

/** Goal reference (T007 control plane) — opaque. */
export type GoalRef = Brand<string, 'GoalRef'>;

/** Constraint-set reference (T007 control plane) — opaque. */
export type ConstraintSetRef = Brand<string, 'ConstraintSetRef'>;

/** Organization reference (T016 organization lane) — opaque. */
export type OrganizationId = Brand<string, 'OrganizationId'>;

/** The master seed a curriculum derives its commissioned batches from — mirror of the curriculum lane's `Seed` (the same 'EnvironmentSeed' brand tag, T015). */
export type Seed = Brand<string, 'EnvironmentSeed'>;

/** Capability-gap identity — mirror of the organization lane's `CapabilityGapId` (T016). */
export type CapabilityGapId = Brand<string, 'CapabilityGapId'>;

/** Capability-contract identity — mirror of the organization lane's `CapabilityKey` (T016). */
export type CapabilityKey = Brand<string, 'CapabilityKey'>;

/** Attainment-evidence reference — mirror of the organization lane (T016/T012). */
export type AttainmentEvidenceRef = Brand<string, 'AttainmentEvidenceRef'>;

/** Verdict identity — mirror of @tradrl/evaluation (T012). */
export type VerdictId = Brand<string, 'VerdictId'>;

/** Trial identity — mirror of @tradrl/experiments (T011). */
export type TrialId = Brand<string, 'TrialId'>;

/** Comparison-arm identity — mirror of @tradrl/experiments (T011). */
export type ArmId = Brand<string, 'ArmId'>;

/** Trajectory identity — mirror of @tradrl/trajectory (T011). */
export type TrajectoryRef = Brand<string, 'TrajectoryRef'>;

/** Experiment identity — mirror of @tradrl/experiments + @tradrl/search-lineage (the same 'ExperimentId' brand tag, T011/T031). */
export type ExperimentId = Brand<string, 'ExperimentId'>;

/** Experiment reference (T033's lineage binding shape) — opaque. */
export type ExperimentRef = Brand<string, 'ExperimentRef'>;

/** Split-policy reference — mirror of the evaluation split lane (T012/T032). */
export type SplitPolicyRef = Brand<string, 'SplitPolicyRef'>;

/** Evaluator version reference — mirror of @tradrl/experiments (T011). */
export type EvaluatorVersionRef = Brand<string, 'EvaluatorVersionRef'>;

/** Dataset reference — mirror of @tradrl/experiments (T011). */
export type DataRef = Brand<string, 'DataRef'>;

/** Search-record identity — mirror of @tradrl/search-lineage (T031). */
export type SearchRecordId = Brand<string, 'TradRL.SearchRecordId'>;

/** Content-addressed config-snapshot identity — mirror of @tradrl/search-lineage (T031). */
export type ConfigSnapshotId = Brand<string, 'TradRL.ConfigSnapshotId'>;

/** Firm-knowledge identity (`fkr:`) — mirror of @tradrl/firm-memory (T034). */
export type KnowledgeId = Brand<string, 'TradRL.KnowledgeId'>;

/** Curriculum-version identity (e.g. `curriculum@1.0.0`) — mirror of the curriculum lane (T015). */
export type CurriculumVersionRef = Brand<string, 'CurriculumVersionRef'>;

// --- The prefix-disciplined consumption refs (T033's content-addressed ids) ---

/** A learning-hook identity (`olh:` + digest) — mirror of @tradrl/outcomes (T033). */
export type HookRef = Brand<string, 'TradRL.HookRef'>;

/** An outcome-record identity (`out:` + digest) — mirror of @tradrl/outcomes (T033). */
export type OutcomeRecordRef = Brand<string, 'TradRL.OutcomeRecordRef'>;

/** A post-mortem-record identity (`pmr:` + digest) — mirror of @tradrl/outcomes (T033). */
export type PostMortemRef = Brand<string, 'TradRL.PostMortemRef'>;

/** A shadow-session identity (`shs:`) — mirror of services/shadow-trading (T030). */
export type SessionRef = Brand<string, 'TradRL.SessionRef'>;

// --- Guards --------------------------------------------------------------------
//
// Opaque refs are non-empty strings: the runtime check is shared. Brand
// discipline is enforced at compile time (see interop.test.ts). The OWNED
// identity spaces and the prefix-disciplined consumption refs additionally
// carry a derivation-prefix law, so a hand-minted id that never went
// through the content-addressing is rejected at the runtime boundary.

export function isImprovementCycleId(v: unknown): v is ImprovementCycleId {
  return isNonEmptyString(v) && v.startsWith('alc:');
}

export function isImprovementGapId(v: unknown): v is ImprovementGapId {
  return isNonEmptyString(v) && v.startsWith('alg:');
}

export function isCurriculumRevisionId(v: unknown): v is CurriculumRevisionId {
  return isNonEmptyString(v) && v.startsWith('alv:');
}

export function isSkillCommissionId(v: unknown): v is SkillCommissionId {
  return isNonEmptyString(v) && v.startsWith('als:');
}

export function isMemoryFeedId(v: unknown): v is MemoryFeedId {
  return isNonEmptyString(v) && v.startsWith('alm:');
}

export function isImprovementTrialId(v: unknown): v is ImprovementTrialId {
  return isNonEmptyString(v) && v.startsWith('alt:');
}

export const isTenantId = (v: unknown): v is TenantId => isNonEmptyString(v);
export const isProjectId = (v: unknown): v is ProjectId => isNonEmptyString(v);
export const isGoalRef = (v: unknown): v is GoalRef => isNonEmptyString(v);
export const isConstraintSetRef = (v: unknown): v is ConstraintSetRef => isNonEmptyString(v);
export const isOrganizationId = (v: unknown): v is OrganizationId => isNonEmptyString(v);
export const isSeed = (v: unknown): v is Seed => isNonEmptyString(v);
export const isCapabilityGapId = (v: unknown): v is CapabilityGapId => isNonEmptyString(v);
export const isCapabilityKey = (v: unknown): v is CapabilityKey => isNonEmptyString(v);
export const isAttainmentEvidenceRef = (v: unknown): v is AttainmentEvidenceRef => isNonEmptyString(v);
export const isVerdictId = (v: unknown): v is VerdictId => isNonEmptyString(v);
export const isTrialId = (v: unknown): v is TrialId => isNonEmptyString(v);
export const isArmId = (v: unknown): v is ArmId => isNonEmptyString(v);
export const isTrajectoryRef = (v: unknown): v is TrajectoryRef => isNonEmptyString(v);
export const isExperimentRef = (v: unknown): v is ExperimentRef => isNonEmptyString(v);
export const isExperimentId = (v: unknown): v is ExperimentId => isNonEmptyString(v);
export const isSplitPolicyRef = (v: unknown): v is SplitPolicyRef => isNonEmptyString(v);
export const isEvaluatorVersionRef = (v: unknown): v is EvaluatorVersionRef => isNonEmptyString(v);
export const isDataRef = (v: unknown): v is DataRef => isNonEmptyString(v);
export const isSearchRecordId = (v: unknown): v is SearchRecordId => isNonEmptyString(v) && v.startsWith('srch:');
export const isConfigSnapshotId = (v: unknown): v is ConfigSnapshotId => isNonEmptyString(v) && v.startsWith('snap:');
export const isKnowledgeId = (v: unknown): v is KnowledgeId => isNonEmptyString(v) && v.startsWith('fkr:');
export const isCurriculumVersionRef = (v: unknown): v is CurriculumVersionRef => isNonEmptyString(v);
export const isHookRef = (v: unknown): v is HookRef => isNonEmptyString(v) && v.startsWith('olh:');
export const isOutcomeRecordRef = (v: unknown): v is OutcomeRecordRef => isNonEmptyString(v) && v.startsWith('out:');
export const isPostMortemRef = (v: unknown): v is PostMortemRef => isNonEmptyString(v) && v.startsWith('pmr:');
export const isSessionRef = (v: unknown): v is SessionRef => isNonEmptyString(v) && v.startsWith('shs:');

/** The identifier pattern the organization lane's CapabilityGapId/CapabilityKey spaces accept (mirror of @tradrl/skills' ID_PATTERN). */
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

/** Guard: an identifier in the organization lane's gap/key identity pattern (the interop lane's own law, mirrored). */
export function isIdentifierString(v: unknown): v is string {
  return typeof v === 'string' && IDENTIFIER_PATTERN.test(v);
}
