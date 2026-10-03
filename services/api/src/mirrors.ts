// @tradrl/api-service — THE STRUCTURAL MIRRORS of the composed lanes.
//
// Work Order T041: "Study the merged surfaces you compose (mirrors
// only, never imports)". This service owns NO contract package among
// the frozen siblings, so EVERY cross-lane shape it consumes is
// re-declared here BY STRUCTURE (D-003/D-004 law), and
// src/interop.test.ts — which imports the REAL packages test-only —
// is the drift trip wire: a REAL record that fails these mirrors is a
// loud test failure, never a silent coercion.
//
// The mirrored lanes and what this boundary uses them for:
//   - T007 packages/control-domain + services/control-plane:
//     the goal/constraint/project identity shapes and the project
//     lifecycle machine — the public plane's tenant/project/goal
//     management routes serve these records VERBATIM.
//   - T018/T019/T040 packages/execution-policy +
//     packages/execution-authority + services/execution-gateway:
//     the StrategyIntent (THE request record the gate decides over),
//     the APPROVE/REFUSE decisions, the GatewayRefusal stages and the
//     GatewaySubmissionRecord — the public plane's execution REQUEST
//     route forwards intents through these shapes and NEVER executes
//     (L8).
//   - T034 packages/firm-memory + services/firm-memory: the
//     point-in-time knowledge query contracts and the served records
//     — the public plane's firm-knowledge READ queries.
//   - T044 packages/security: the tenant/project Scope — the L12
//     substrate of the boundary's tenant-context injection.
//   - T033 packages/outcomes: the OutcomeRecord / PostMortemRecord
//     query surface — mirrored separately in mirrors-outcomes.ts.
//
// Guard discipline (the T034 precedent, mirrored): the guards check
// STRUCTURAL presence, the closed vocabularies, the decimal grammars
// and the prefix disciplines; the owning lanes' COHERENCE laws were
// enforced at their own mints and are NOT re-derived here — the
// boundary validates structure and forwards semantics.

import {
  deepFreeze,
  isCanonicalPositiveDecimal,
  isCanonicalUnsignedDecimal,
  isFiniteNumber,
  isIdentifierPath,
  isMemberOf,
  isNonEmptyString,
  isNonNegativeSafeInteger,
  isOneOf,
  isPositiveSafeInteger,
  isRecord,
  isRfc3339Timestamp,
  isTimestampMs,
  isUnitInterval,
  isUnitIntervalDecimal,
  type TimestampMs,
} from './primitives';
import type {
  ConstraintSetRef,
  GoalRef,
  GoalVersionRef,
  OrganizationRef,
  ProjectId,
  TenantId,
} from './ids';
import { isConstraintSetRef, isGoalRef, isOrganizationRef, isProjectId, isTenantId } from './ids';

// ===========================================================================
// T007 — the control-plane mirrors (goal/constraint/project identity)
// ===========================================================================

/** The project's execution mode (T007 execution-mode.ts, mirrored): simulation | shadow | live. */
export const EXECUTION_MODES = ['simulation', 'shadow', 'live'] as const;

/** One execution mode. */
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

/** Guard: an execution mode. */
export function isExecutionMode(v: unknown): v is ExecutionMode {
  return isMemberOf(EXECUTION_MODES, v);
}

// --- The predicate vocabulary (T007 goal.ts, mirrored) ----------------------

/** Scalar value observable in an evaluation metric space. */
export type CriterionValue = number | string | boolean;

/** Guard: a criterion value. */
export function isCriterionValue(v: unknown): v is CriterionValue {
  if (typeof v === 'boolean') return true;
  if (typeof v === 'string') return isNonEmptyString(v);
  return isFiniteNumber(v);
}

/** Executable predicate over a criterion metric (T007's `CriterionPredicate`, mirrored). */
export type CriterionPredicate =
  | { readonly kind: 'limit.max'; readonly bound: number }
  | { readonly kind: 'limit.min'; readonly bound: number }
  | { readonly kind: 'limit.range'; readonly min: number; readonly max: number }
  | { readonly kind: 'equals'; readonly value: CriterionValue }
  | { readonly kind: 'notEquals'; readonly value: CriterionValue }
  | { readonly kind: 'oneOf'; readonly values: readonly string[] }
  | { readonly kind: 'flag'; readonly expected: boolean };

/** Guard: a criterion predicate. */
export function isCriterionPredicate(v: unknown): v is CriterionPredicate {
  if (!isRecord(v)) return false;
  switch (v.kind) {
    case 'limit.max':
    case 'limit.min':
      return isFiniteNumber(v.bound);
    case 'limit.range':
      return isFiniteNumber(v.min) && isFiniteNumber(v.max) && v.min <= v.max;
    case 'equals':
    case 'notEquals':
      return isCriterionValue(v.value);
    case 'oneOf':
      return (
        Array.isArray(v.values) &&
        v.values.length > 0 &&
        v.values.every((x) => isNonEmptyString(x))
      );
    case 'flag':
      return typeof v.expected === 'boolean';
    default:
      return false;
  }
}

/** One structured success criterion (T007's `SuccessCriterion`, mirrored). */
export interface SuccessCriterion {
  readonly id: string;
  readonly metric: string;
  readonly predicate: CriterionPredicate;
  readonly description?: string;
}

/** Guard: a success criterion. */
export function isSuccessCriterion(v: unknown): v is SuccessCriterion {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.id)) return false;
  if (!isIdentifierPath(v.metric)) return false;
  if (!isCriterionPredicate(v.predicate)) return false;
  if (v.description !== undefined && !isNonEmptyString(v.description)) return false;
  return true;
}

/** The structured success criteria of a goal (T007's `GoalSuccessCriteria`, mirrored). */
export interface GoalSuccessCriteria {
  readonly criteria: readonly SuccessCriterion[];
  /** Required share of criteria satisfied for attainment, [0, 1]. */
  readonly requiredSatisfaction: number;
}

/** Guard: goal success criteria (non-empty; criterion ids unique). */
export function isGoalSuccessCriteria(v: unknown): v is GoalSuccessCriteria {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.criteria) || v.criteria.length === 0) return false;
  if (!v.criteria.every((x) => isSuccessCriterion(x))) return false;
  const seen = new Set<string>();
  for (const c of v.criteria) {
    const criterion = c as SuccessCriterion;
    if (seen.has(criterion.id)) return false;
    seen.add(criterion.id);
  }
  if (!isUnitInterval(v.requiredSatisfaction)) return false;
  return true;
}

/** The evaluation horizon `[startsAt, endsAt)` (T007's `GoalHorizon`, mirrored). */
export interface GoalHorizon {
  readonly startsAt: TimestampMs;
  readonly endsAt: TimestampMs;
  readonly label?: string;
}

/** Guard: a goal horizon (non-empty window). */
export function isGoalHorizon(v: unknown): v is GoalHorizon {
  if (!isRecord(v)) return false;
  if (!isTimestampMs(v.startsAt) || !isTimestampMs(v.endsAt)) return false;
  if ((v.endsAt as number) <= (v.startsAt as number)) return false;
  if (v.label !== undefined && !isNonEmptyString(v.label)) return false;
  return true;
}

/** The evaluation-policy declaration (T007's `GoalEvaluationPolicy`, mirrored — opaque refs, never resolved here). */
export interface GoalEvaluationPolicy {
  readonly blindRef: string;
  readonly walkForwardRef: string;
  readonly regimeRef: string;
  readonly adversarialRequired: boolean;
}

/** Guard: a goal evaluation policy. */
export function isGoalEvaluationPolicy(v: unknown): v is GoalEvaluationPolicy {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.blindRef)) return false;
  if (!isNonEmptyString(v.walkForwardRef)) return false;
  if (!isNonEmptyString(v.regimeRef)) return false;
  if (typeof v.adversarialRequired !== 'boolean') return false;
  return true;
}

/** The goal statement (T007's `GoalStatement`, mirrored field for field). */
export interface GoalStatement {
  readonly id: GoalRef;
  /** Integer >= 1; monotonically increasing per id. */
  readonly version: number;
  readonly tenantId: TenantId;
  /** Human-readable objective statement. Interpreted, never executed. */
  readonly objective: string;
  readonly horizon: GoalHorizon;
  readonly successCriteria: GoalSuccessCriteria;
  readonly evaluation: GoalEvaluationPolicy;
  readonly createdAt: TimestampMs;
  readonly description?: string;
}

/** Guard: a goal statement. */
export function isGoalStatement(v: unknown): v is GoalStatement {
  if (!isRecord(v)) return false;
  if (!isGoalRef(v.id)) return false;
  if (!isPositiveSafeInteger(v.version)) return false;
  if (!isTenantId(v.tenantId)) return false;
  if (!isNonEmptyString(v.objective)) return false;
  if (!isGoalHorizon(v.horizon)) return false;
  if (!isGoalSuccessCriteria(v.successCriteria)) return false;
  if (!isGoalEvaluationPolicy(v.evaluation)) return false;
  if (!isTimestampMs(v.createdAt)) return false;
  if (v.description !== undefined && !isNonEmptyString(v.description)) return false;
  return true;
}

// --- The constraint-set mirrors (T007 constraints.ts) ------------------------

/** Phase of the trading loop a constraint applies to. Mirror. */
export type ConstraintDomain = 'observation' | 'state' | 'action' | 'outcome';

export const CONSTRAINT_DOMAINS: readonly ConstraintDomain[] = [
  'observation',
  'state',
  'action',
  'outcome',
] as const;

/** Guard: a constraint domain. */
export function isConstraintDomain(v: unknown): v is ConstraintDomain {
  return isMemberOf(CONSTRAINT_DOMAINS, v);
}

/** How a violation of this constraint is aggregated. Mirror. */
export type ConstraintSeverity = 'advisory' | 'blocking';

export const CONSTRAINT_SEVERITIES: readonly ConstraintSeverity[] = ['advisory', 'blocking'] as const;

/** Guard: a constraint severity. */
export function isConstraintSeverity(v: unknown): v is ConstraintSeverity {
  return isMemberOf(CONSTRAINT_SEVERITIES, v);
}

/** A single executable constraint (T007's `ConstraintStatement`, mirrored). */
export interface ConstraintStatement {
  /** Unique within the set. */
  readonly id: string;
  readonly domain: ConstraintDomain;
  readonly subject: string;
  readonly predicate: CriterionPredicate;
  readonly severity: ConstraintSeverity;
  readonly description?: string;
}

/** Guard: a constraint statement. */
export function isConstraintStatement(v: unknown): v is ConstraintStatement {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.id)) return false;
  if (!isConstraintDomain(v.domain)) return false;
  if (!isIdentifierPath(v.subject)) return false;
  if (!isCriterionPredicate(v.predicate)) return false;
  if (!isConstraintSeverity(v.severity)) return false;
  if (v.description !== undefined && !isNonEmptyString(v.description)) return false;
  return true;
}

/** A versioned collection of executable constraints, tenant-scoped (T007's `ConstraintSetStatement`, mirrored). */
export interface ConstraintSetStatement {
  readonly id: ConstraintSetRef;
  /** Integer >= 1; monotonically increasing per id. */
  readonly version: number;
  readonly tenantId: TenantId;
  readonly name?: string;
  readonly constraints: readonly ConstraintStatement[];
  readonly createdAt: TimestampMs;
}

/** Guard: a constraint-set statement (ids unique within the set). */
export function isConstraintSetStatement(v: unknown): v is ConstraintSetStatement {
  if (!isRecord(v)) return false;
  if (!isConstraintSetRef(v.id)) return false;
  if (!isPositiveSafeInteger(v.version)) return false;
  if (!isTenantId(v.tenantId)) return false;
  if (v.name !== undefined && !isNonEmptyString(v.name)) return false;
  if (!Array.isArray(v.constraints)) return false;
  const seen = new Set<string>();
  for (const c of v.constraints) {
    if (!isConstraintStatement(c)) return false;
    const constraint = c as ConstraintStatement;
    if (seen.has(constraint.id)) return false;
    seen.add(constraint.id);
  }
  if (!isTimestampMs(v.createdAt)) return false;
  return true;
}

// --- The project lifecycle mirrors (T007 lifecycle.ts + project.ts) ---------

/** The project lifecycle statuses. Mirror. */
export const PROJECT_LIFECYCLE_STATUSES = [
  'draft',
  'active',
  'paused',
  'archived',
  'completed',
  'abandoned',
] as const;

/** One project lifecycle status. */
export type ProjectLifecycleStatus = (typeof PROJECT_LIFECYCLE_STATUSES)[number];

/** Guard: a project lifecycle status. */
export const isProjectLifecycleStatus = isOneOf(PROJECT_LIFECYCLE_STATUSES);

/** The lifecycle events (the machine's input vocabulary). Mirror. */
export const PROJECT_LIFECYCLE_EVENTS = [
  'activate',
  'pause',
  'resume',
  'complete',
  'abandon',
  'archive',
] as const;

/** One lifecycle event. */
export type ProjectLifecycleEvent = (typeof PROJECT_LIFECYCLE_EVENTS)[number];

/** Guard: a lifecycle event. */
export const isProjectLifecycleEvent = isOneOf(PROJECT_LIFECYCLE_EVENTS);

/** The lifecycle state record (T007's `ProjectLifecycleState`, mirrored). */
export interface ProjectLifecycleState {
  readonly projectId: ProjectId;
  readonly status: ProjectLifecycleStatus;
  /** Content-addressed id of the compiled AcceptanceCriteria; null pre-compilation. */
  readonly acceptanceCriteriaId: string | null;
  /** Opaque ref to the bound organization (T016); null until bound. */
  readonly organizationRef: OrganizationRef | null;
}

/** Guard: a project lifecycle state. */
export function isProjectLifecycleState(v: unknown): v is ProjectLifecycleState {
  if (!isRecord(v)) return false;
  if (!isProjectId(v.projectId)) return false;
  if (!isProjectLifecycleStatus(v.status)) return false;
  if (v.acceptanceCriteriaId !== null && !(isNonEmptyString(v.acceptanceCriteriaId) && (v.acceptanceCriteriaId as string).startsWith('ac:'))) return false;
  if (v.organizationRef !== null && !isOrganizationRef(v.organizationRef)) return false;
  switch (v.status) {
    case 'active':
    case 'paused':
    case 'completed':
      return v.acceptanceCriteriaId !== null && v.organizationRef !== null;
    case 'draft':
    case 'abandoned':
    case 'archived':
      return true;
  }
}

/** The project-scoped lineage block (T007's `ProjectLineage`, mirrored — L15). */
export interface ProjectLineage {
  readonly projectId: ProjectId;
  readonly goal: GoalVersionRef;
  readonly constraintSet: { readonly id: ConstraintSetRef; readonly version: number };
}

/** Guard: a project lineage block. */
export function isProjectLineage(v: unknown): v is ProjectLineage {
  if (!isRecord(v)) return false;
  if (!isProjectId(v.projectId)) return false;
  const goal = v.goal;
  if (!isRecord(goal) || !isGoalRef(goal.goalId) || !isPositiveSafeInteger(goal.version)) return false;
  const constraintSet = v.constraintSet;
  if (!isRecord(constraintSet) || !isConstraintSetRef(constraintSet.id) || !isPositiveSafeInteger(constraintSet.version)) return false;
  return true;
}

/** The durable control-plane project record (T007's `ProjectRecord`, mirrored field for field). */
export interface ProjectRecord {
  readonly id: ProjectId;
  readonly tenantId: TenantId;
  readonly name: string;
  readonly executionMode: ExecutionMode;
  readonly lifecycle: ProjectLifecycleState;
  readonly lineage: ProjectLineage;
  readonly createdAt: TimestampMs;
  readonly updatedAt: TimestampMs;
}

/** Guard: a project record (identity + lineage + audit-field consistency). */
export function isProjectRecord(v: unknown): v is ProjectRecord {
  if (!isRecord(v)) return false;
  if (!isProjectId(v.id)) return false;
  if (!isTenantId(v.tenantId)) return false;
  if (!isNonEmptyString(v.name)) return false;
  if (!isExecutionMode(v.executionMode)) return false;
  if (!isProjectLifecycleState(v.lifecycle)) return false;
  if (v.lifecycle.projectId !== v.id) return false;
  if (!isProjectLineage(v.lineage)) return false;
  if (v.lineage.projectId !== v.id) return false;
  if (!isTimestampMs(v.createdAt)) return false;
  if (!isTimestampMs(v.updatedAt)) return false;
  if ((v.updatedAt as number) < (v.createdAt as number)) return false;
  return true;
}

// ===========================================================================
// T018/T019/T040 — the execution-lane mirrors (the L8 forwarding shapes)
// ===========================================================================

/** The order side vocabulary. Mirror. */
export type OrderSide = 'buy' | 'sell';

export const ORDER_SIDES: readonly OrderSide[] = ['buy', 'sell'] as const;

/** Guard: an order side. */
export function isOrderSide(v: unknown): v is OrderSide {
  return isMemberOf(ORDER_SIDES, v);
}

/** The core order kinds. Mirror (the registered extension discipline stays open — a non-empty string). */
export type CoreOrderKind = 'market' | 'limit' | 'stop' | 'stop-limit';

export const CORE_ORDER_KINDS: readonly CoreOrderKind[] = ['market', 'limit', 'stop', 'stop-limit'] as const;

/** Guard: a core order kind. */
export function isCoreOrderKind(v: unknown): v is CoreOrderKind {
  return isMemberOf(CORE_ORDER_KINDS, v);
}

/** Guard: an order kind (open vocabulary: a non-empty string). */
export function isOrderKind(v: unknown): v is string {
  return isNonEmptyString(v);
}

/** The core time-in-force vocabulary. Mirror. */
export type CoreTimeInForce = 'day' | 'gtc' | 'ioc' | 'fok' | 'gtt';

export const CORE_TIME_IN_FORCE: readonly CoreTimeInForce[] = ['day', 'gtc', 'ioc', 'fok', 'gtt'] as const;

/** Guard: a core time-in-force value. */
export function isCoreTimeInForce(v: unknown): v is CoreTimeInForce {
  return isMemberOf(CORE_TIME_IN_FORCE, v);
}

/** Guard: a time-in-force value (open vocabulary: a non-empty string). */
export function isTimeInForce(v: unknown): v is string {
  return isNonEmptyString(v);
}

/**
 * The field-presence matrix for the core order kinds (T019/T039's law,
 * mirrored): market -> no price, no stopPrice; limit -> price, no
 * stopPrice; stop -> stopPrice, no price; stop-limit -> both.
 */
function validateCoreKindPriceMatrix(order: Record<string, unknown>): boolean {
  const hasPrice = order.price !== undefined;
  const hasStop = order.stopPrice !== undefined;
  switch (order.kind) {
    case 'market':
      return !hasPrice && !hasStop;
    case 'limit':
      return hasPrice && !hasStop;
    case 'stop':
      return hasStop && !hasPrice;
    case 'stop-limit':
      return hasPrice && hasStop;
    default:
      return true;
  }
}

/** The core time-in-force expiry discipline (gtt requires expiresAt; the others reject it). Mirror. */
function validateCoreTimeInForceExpiry(order: Record<string, unknown>): boolean {
  const hasExpiry = order.expiresAt !== undefined;
  switch (order.timeInForce) {
    case 'gtt':
      return hasExpiry;
    case 'day':
    case 'gtc':
    case 'ioc':
    case 'fok':
      return !hasExpiry;
    default:
      return true; // registered extension kinds may use expiry freely
  }
}

/**
 * The routed order form — the final request shape the gate decided
 * over (T019's OrderIntentMirror as T040's execution-authority
 * re-mirrors it; mirrored here field for field).
 */
export interface OrderIntentRecord {
  /** Caller-assigned idempotency key. Unique within the issuing project scope. */
  readonly clientOrderId: string;
  readonly instrumentId: string;
  readonly venueId: string;
  readonly side: OrderSide;
  readonly kind: string;
  /** Order quantity in instrument units. Strictly positive canonical decimal. */
  readonly quantity: string;
  /** Limit price. Strictly positive. Required for "limit" and "stop-limit". */
  readonly price?: string;
  /** Trigger price. Strictly positive. Required for "stop" and "stop-limit". */
  readonly stopPrice?: string;
  readonly timeInForce: string;
  /** Expiry instant. Required for "gtt"; rejected for other core TIF values. */
  readonly expiresAt?: string;
  readonly createdAt: string;
  /** Free-form annotation for humans/audit; never interpreted. */
  readonly notes?: string;
}

/** Guard: an order intent record (the mirror of the mirror, law for law). */
export function isOrderIntentRecord(value: unknown): value is OrderIntentRecord {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.clientOrderId)) return false;
  if (!isNonEmptyString(value.instrumentId)) return false;
  if (!isNonEmptyString(value.venueId)) return false;
  if (!isOrderSide(value.side)) return false;
  if (!isOrderKind(value.kind)) return false;
  if (!isCanonicalPositiveDecimal(value.quantity)) return false;
  if (value.price !== undefined && !isCanonicalPositiveDecimal(value.price)) return false;
  if (value.stopPrice !== undefined && !isCanonicalPositiveDecimal(value.stopPrice)) return false;
  if (!isTimeInForce(value.timeInForce)) return false;
  if (value.expiresAt !== undefined && !isRfc3339Timestamp(value.expiresAt)) return false;
  if (!isRfc3339Timestamp(value.createdAt)) return false;
  if (value.notes !== undefined && !isNonEmptyString(value.notes)) return false;
  if (isCoreOrderKind(value.kind) && !validateCoreKindPriceMatrix(value)) return false;
  if (isCoreTimeInForce(value.timeInForce) && !validateCoreTimeInForceExpiry(value)) return false;
  return true;
}

// --- The strategy intent (THE REQUEST RECORD the gate decides over) ---------

/** The constraint check-status vocabulary. Mirror. */
export type ConstraintCheckStatus = 'satisfied' | 'violated' | 'not_applicable' | 'error';

export const CONSTRAINT_CHECK_STATUSES: readonly ConstraintCheckStatus[] = [
  'satisfied',
  'violated',
  'not_applicable',
  'error',
] as const;

/** Guard: a constraint check status. */
export function isConstraintCheckStatus(v: unknown): v is ConstraintCheckStatus {
  return isMemberOf(CONSTRAINT_CHECK_STATUSES, v);
}

/**
 * The proof that one constraint was SATISFIED under the decision that
 * produced an intent (T019's `SatisfiedPredicateProof`, mirrored).
 */
export interface SatisfiedPredicateProof {
  readonly constraintId: string;
  readonly domain: ConstraintDomain;
  readonly subject: string;
  readonly severity: ConstraintSeverity;
  readonly predicate: CriterionPredicate;
  /** The observed value the predicate was evaluated against. */
  readonly observed: string | number | boolean;
}

/** Guard: a satisfied-predicate proof. */
export function isSatisfiedPredicateProof(v: unknown): v is SatisfiedPredicateProof {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.constraintId)) return false;
  if (!isConstraintDomain(v.domain)) return false;
  if (!isNonEmptyString(v.subject)) return false;
  if (!isConstraintSeverity(v.severity)) return false;
  if (!isCriterionPredicate(v.predicate)) return false;
  const observed: unknown = v.observed;
  if (typeof observed !== 'string' && typeof observed !== 'number' && typeof observed !== 'boolean') return false;
  if (typeof observed === 'number' && !Number.isFinite(observed)) return false;
  if (typeof observed === 'string' && observed.length === 0) return false;
  return true;
}

/** One constraint-gate check record (the advisory violations that ride an intent carry this shape). Mirror. */
export interface ConstraintCheck {
  readonly constraintId: string;
  readonly domain: ConstraintDomain;
  readonly subject: string;
  readonly severity: ConstraintSeverity;
  readonly status: ConstraintCheckStatus;
  readonly observed?: CriterionValue;
  readonly reason?: string;
}

/** Guard: a constraint check. */
export function isConstraintCheck(v: unknown): v is ConstraintCheck {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.constraintId)) return false;
  if (!isConstraintDomain(v.domain)) return false;
  if (!isNonEmptyString(v.subject)) return false;
  if (!isConstraintSeverity(v.severity)) return false;
  if (!isConstraintCheckStatus(v.status)) return false;
  if (v.observed !== undefined && !isCriterionValue(v.observed)) return false;
  if (v.reason !== undefined && !isNonEmptyString(v.reason)) return false;
  return true;
}

/** The constraint proof bound to an intent. Mirror. */
export interface ConstraintProof {
  readonly constraintSet: { readonly id: ConstraintSetRef; readonly version: number };
  readonly satisfied: readonly SatisfiedPredicateProof[];
  /** Advisory violations observed under this decision (structured, never dropped). */
  readonly advisoryViolations: readonly ConstraintCheck[];
}

/** Guard: a constraint proof. */
export function isConstraintProof(v: unknown): v is ConstraintProof {
  if (!isRecord(v)) return false;
  const constraintSet = v.constraintSet;
  if (!isRecord(constraintSet) || !isConstraintSetRef(constraintSet.id) || !isPositiveSafeInteger(constraintSet.version)) return false;
  if (!Array.isArray(v.satisfied) || !v.satisfied.every((x) => isSatisfiedPredicateProof(x))) return false;
  if (!Array.isArray(v.advisoryViolations)) return false;
  for (const entry of v.advisoryViolations) {
    if (!isConstraintCheck(entry)) return false;
    if ((entry as ConstraintCheck).severity !== 'advisory') return false;
    if ((entry as ConstraintCheck).status !== 'violated') return false;
  }
  return true;
}

/** The closed decision-kind vocabulary of the strategy lane's policies. Mirror. */
export type IntentReasonKind = 'rebalance_drift' | 'rebalance_scheduled' | 'initial_allocation';

export const INTENT_REASON_KINDS: readonly IntentReasonKind[] = [
  'rebalance_drift',
  'rebalance_scheduled',
  'initial_allocation',
] as const;

/** Guard: an intent reason kind. */
export function isIntentReasonKind(v: unknown): v is IntentReasonKind {
  return isMemberOf(INTENT_REASON_KINDS, v);
}

/** The structured rationale of one intent (numbers, never prose). Mirror. */
export interface IntentRationale {
  readonly kind: IntentReasonKind;
  readonly instrumentId: string;
  readonly targetWeight: string;
  readonly currentWeight: string;
  readonly drift: string;
}

/** Guard: an intent rationale. */
export function isIntentRationale(v: unknown): v is IntentRationale {
  if (!isRecord(v)) return false;
  if (!isIntentReasonKind(v.kind)) return false;
  if (!isNonEmptyString(v.instrumentId)) return false;
  if (typeof v.targetWeight !== 'string' || v.targetWeight === '') return false;
  if (typeof v.currentWeight !== 'string' || v.currentWeight === '') return false;
  if (typeof v.drift !== 'string' || v.drift === '') return false;
  return true;
}

/**
 * The closed key vocabulary that makes an intent record EMBED EXECUTION
 * AUTHORITY (T019's AUTHORITY_EMBEDDING_KEYS, mirrored — the strategy
 * lane's own L8 trip wire). Risk/authorization POLICY stays referable
 * via the OPAQUE `riskPolicyRefs` field; an embedded GRANT, TOKEN,
 * CREDENTIAL or PERMISSION is the crime — and at THIS boundary it is
 * the typed `gate_bypass_attempt`.
 */
export const INTENT_AUTHORITY_EMBEDDING_KEYS: readonly string[] = [
  'authority',
  'authorityToken',
  'executionAuthority',
  'executionGrant',
  'grant',
  'authorizedActions',
  'token',
  'credential',
  'apiKey',
  'secret',
  'permissions',
  'scopes',
  'venuePermission',
  'venuePermissions',
  'credentialRef',
  'credentials',
] as const;

/** Walks an intent's JSON tree and returns the dotted paths of every authority-embedding key. Mirror of T019's walk. */
export function intentAuthorityViolations(value: unknown, prefix = ''): readonly string[] {
  const found: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      for (const path of intentAuthorityViolations(item, `${prefix}[${index}]`)) found.push(path);
    });
    return Object.freeze(found);
  }
  if (!isRecord(value)) return Object.freeze(found);
  for (const key of Object.keys(value)) {
    if ((INTENT_AUTHORITY_EMBEDDING_KEYS as readonly string[]).includes(key)) {
      found.push(prefix === '' ? key : `${prefix}.${key}`);
    }
    for (const path of intentAuthorityViolations(value[key], prefix === '' ? key : `${prefix}.${key}`)) {
      found.push(path);
    }
  }
  return Object.freeze(found);
}

/** One opaque risk-policy ref (the T020 gate resolves them; the boundary records them, never resolves them). Mirror. */
export interface RiskPolicyRef {
  readonly policyId: string;
  readonly version: number;
}

/** Guard: a risk-policy ref. */
export function isRiskPolicyRef(v: unknown): v is RiskPolicyRef {
  return (
    isRecord(v) &&
    isNonEmptyString(v.policyId) &&
    isPositiveSafeInteger(v.version)
  );
}

/**
 * The tradable request record the gate decides over — the public
 * plane's execution REQUEST body (T018/T019's `StrategyIntent`,
 * mirrored field for field). THIS is the ONLY shape the execution
 * route accepts and forwards; submitting an APPROVE decision, a
 * GatewayOrderRequest or anything else authority-shaped is the typed
 * `gate_bypass_attempt` (L8).
 */
export interface StrategyIntent {
  /** Deterministic identity: `si:` + digest of the intent's content. */
  readonly intentId: string;
  /** 1-based position in the run's intent sequence. */
  readonly sequence: number;
  readonly order: OrderIntentRecord;
  readonly constraintProof: ConstraintProof;
  readonly goal: GoalVersionRef;
  readonly strategy: { readonly specId: string; readonly version: number };
  /** The observation window refs the decision was computed from (>= 1, L9). */
  readonly windowRefs: readonly string[];
  /** The run's deterministic seed (part of the determinism contract). */
  readonly seed: string;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly riskPolicyRefs: readonly RiskPolicyRef[];
  readonly rationale: IntentRationale;
  /** The decision instant (epoch ms; the order's createdAt derives from it deterministically). */
  readonly asOf: TimestampMs;
}

/** Guard: a strategy intent (structural + the L8 authority-embedding scan). */
export function isStrategyIntent(v: unknown): v is StrategyIntent {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.intentId) || !(v.intentId as string).startsWith('si:')) return false;
  if (!isPositiveSafeInteger(v.sequence)) return false;
  if (!isOrderIntentRecord(v.order)) return false;
  if (!isConstraintProof(v.constraintProof)) return false;
  const goal = v.goal;
  if (!isRecord(goal) || !isGoalRef(goal.goalId) || !isPositiveSafeInteger(goal.version)) return false;
  const strategy = v.strategy;
  if (!isRecord(strategy) || !isNonEmptyString(strategy.specId) || !isPositiveSafeInteger(strategy.version)) return false;
  if (!Array.isArray(v.windowRefs) || v.windowRefs.length === 0 || !v.windowRefs.every((x) => isNonEmptyString(x))) return false;
  if (!isNonEmptyString(v.seed)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  if (!Array.isArray(v.riskPolicyRefs) || !v.riskPolicyRefs.every((x) => isRiskPolicyRef(x))) return false;
  if (!isIntentRationale(v.rationale)) return false;
  if (!isTimestampMs(v.asOf)) return false;
  // The L8 trip wire (the mirror of the real guard's law): an intent embedding execution authority is not an intent.
  if (intentAuthorityViolations(v).length > 0) return false;
  return true;
}

// --- The gate's output records (T040 execution-authority, mirrored) ----------

/** The seven pre-trade check kinds (kill_switch first). Mirror. */
export const PRE_TRADE_CHECK_KINDS: readonly string[] = [
  'kill_switch',
  'identity',
  'authorization',
  'limits',
  'venue_permissions',
  'rate_limits',
  'credentials',
] as const;

/** Guard: a pre-trade check kind. */
export function isPreTradeCheckKind(value: unknown): value is string {
  return typeof value === 'string' && (PRE_TRADE_CHECK_KINDS as readonly string[]).includes(value);
}

/** One executed pre-trade check: the dimension, its 1-based position, the outcome. Mirror. */
export interface CheckResultRecord {
  readonly dimension: string;
  readonly ordinal: number;
  readonly outcome: 'pass' | 'fail';
}

/** Guard: a check result record. */
export function isCheckResultRecord(value: unknown): value is CheckResultRecord {
  return (
    isRecord(value) &&
    isPreTradeCheckKind(value.dimension) &&
    isPositiveSafeInteger(value.ordinal) &&
    (value.outcome === 'pass' || value.outcome === 'fail')
  );
}

/** The execution lane's full lineage block (L9). Mirror. */
export interface ExecutionLineageRecord {
  readonly intentRef: string;
  readonly strategy: { readonly specId: string; readonly version: number };
  readonly goal: { readonly goalId: string; readonly version: number };
  readonly policy: { readonly policyId: string; readonly version: number };
  readonly venues: readonly string[];
  readonly seed: string;
  readonly tenant: string;
  readonly project: string;
}

/** Guard: an execution lineage record. */
export function isExecutionLineageRecord(value: unknown): value is ExecutionLineageRecord {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.intentRef)) return false;
  const strategy = value.strategy;
  if (!isRecord(strategy) || !isNonEmptyString(strategy.specId) || !isPositiveSafeInteger(strategy.version)) return false;
  const goal = value.goal;
  if (!isRecord(goal) || !isNonEmptyString(goal.goalId) || !isPositiveSafeInteger(goal.version)) return false;
  const policy = value.policy;
  if (!isRecord(policy) || !isNonEmptyString(policy.policyId) || !isPositiveSafeInteger(policy.version)) return false;
  if (!Array.isArray(value.venues) || value.venues.length === 0 || !value.venues.every((x) => isNonEmptyString(x))) return false;
  if (!isNonEmptyString(value.seed)) return false;
  if (!isNonEmptyString(value.tenant)) return false;
  if (!isNonEmptyString(value.project)) return false;
  return true;
}

/** The APPROVE decision — the ONLY record the authority lane accepts as authority (L8). Mirror. */
export interface ApproveDecisionRecord {
  readonly kind: 'approve';
  readonly decisionId: string;
  readonly intentRef: string;
  readonly policy: { readonly policyId: string; readonly version: number };
  readonly checkOrder: readonly string[];
  readonly checks: readonly CheckResultRecord[];
  readonly lineage: ExecutionLineageRecord;
  readonly asOf: number;
}

/** Guard: an APPROVE decision record. */
export function isApproveDecisionRecord(value: unknown): value is ApproveDecisionRecord {
  if (!isRecord(value) || value.kind !== 'approve') return false;
  if (typeof value.decisionId !== 'string' || !value.decisionId.startsWith('xd:')) return false;
  if (!isNonEmptyString(value.intentRef)) return false;
  const policy = value.policy;
  if (!isRecord(policy) || !isNonEmptyString(policy.policyId) || !isPositiveSafeInteger(policy.version)) return false;
  if (!Array.isArray(value.checkOrder) || !value.checkOrder.every((x) => isPreTradeCheckKind(x))) return false;
  if (!Array.isArray(value.checks) || !value.checks.every((check) => isCheckResultRecord(check) && check.outcome === 'pass')) return false;
  if (!isExecutionLineageRecord(value.lineage)) return false;
  if (typeof value.asOf !== 'number' || !Number.isSafeInteger(value.asOf) || value.asOf < 0) return false;
  return true;
}

/**
 * The gateway's typed refusal — the 13-stage pipeline's structured
 * "no" (services/execution-gateway, mirrored as the WIDENED stage
 * union: every stage's discriminator plus its typed fact fields as
 * opaque JSON where the stage's own contracts are not this lane's).
 */
export type GatewayRefusal =
  | { readonly stage: 'credential_opacity'; readonly violations: readonly string[] }
  | { readonly stage: 'intent_validation'; readonly reason: string }
  | { readonly stage: 'shadow_mode'; readonly mode: string }
  | { readonly stage: 'policy_gate'; readonly decision: Record<string, unknown> }
  | { readonly stage: 'gate_envelope'; readonly errors: readonly { readonly code: string; readonly message: string }[] }
  | { readonly stage: 'duplicate_decision'; readonly decisionId: string }
  | { readonly stage: 'risk_limits'; readonly evaluationId: string; readonly refusals: readonly unknown[] }
  | { readonly stage: 'risk_envelope'; readonly errors: readonly { readonly code: string; readonly message: string }[] }
  | { readonly stage: 'authority_grant'; readonly refusal: unknown }
  | { readonly stage: 'entitlement'; readonly refusal: unknown }
  | { readonly stage: 'rate_budget'; readonly venue: string; readonly budget: number; readonly observed: number; readonly windowMs: number | null }
  | { readonly stage: 'kill_switch'; readonly switchId: string; readonly thrownAt: number; readonly reason: string }
  | { readonly stage: 'translation'; readonly errors: readonly { readonly code: string; readonly message: string }[] }
  | { readonly stage: 'adapter'; readonly error: { readonly code: string; readonly message: string } };

/** Guard: a gateway refusal (the stage discriminator + per-stage field presence). */
export function isGatewayRefusal(v: unknown): v is GatewayRefusal {
  if (!isRecord(v)) return false;
  switch (v.stage) {
    case 'credential_opacity':
      return Array.isArray(v.violations) && v.violations.every((x) => typeof x === 'string');
    case 'intent_validation':
      return isNonEmptyString(v.reason);
    case 'shadow_mode':
      return isNonEmptyString(v.mode);
    case 'policy_gate':
      return isRecord(v.decision);
    case 'gate_envelope':
    case 'risk_envelope':
    case 'translation':
      return (
        Array.isArray(v.errors) &&
        v.errors.every((x) => isRecord(x) && typeof (x as Record<string, unknown>).code === 'string' && typeof (x as Record<string, unknown>).message === 'string')
      );
    case 'duplicate_decision':
      return isNonEmptyString(v.decisionId);
    case 'risk_limits':
      return isNonEmptyString(v.evaluationId) && Array.isArray(v.refusals);
    case 'authority_grant':
    case 'entitlement':
      return v.refusal !== undefined;
    case 'rate_budget':
      return (
        isNonEmptyString(v.venue) &&
        typeof v.budget === 'number' &&
        typeof v.observed === 'number' &&
        (v.windowMs === null || typeof v.windowMs === 'number')
      );
    case 'kill_switch':
      return isNonEmptyString(v.switchId) && typeof v.thrownAt === 'number' && isNonEmptyString(v.reason);
    case 'adapter':
      return (
        isRecord(v.error) &&
        typeof (v.error as Record<string, unknown>).code === 'string' &&
        typeof (v.error as Record<string, unknown>).message === 'string'
      );
    default:
      return false;
  }
}

/** The gateway submission id ('xgs:'-prefixed). Mirror (opaque). */
export function isGatewaySubmissionId(v: unknown): v is string {
  return typeof v === 'string' && /^xgs:[0-9a-f]{8}$/.test(v);
}

/**
 * One submission's outcome as the boundary serves it (the execution
 * REQUEST route's response): routed (an order went to the adapter
 * THROUGH the gateway) or refused (the typed record). Mirror of the
 * gateway service's `GatewaySubmissionRecord`, widened where the
 * referent contracts are the gateway's own.
 */
export type GatewaySubmissionRecord =
  | {
      readonly kind: 'routed';
      readonly submissionId: string;
      readonly decisionId: string;
      readonly auditId: string;
      readonly requestRef: string;
      readonly venue: string;
      readonly adapterRef: string;
      readonly channelRef: string;
      readonly routedAt: TimestampMs;
    }
  | {
      readonly kind: 'refused';
      readonly submissionId: string;
      readonly decisionId: string | null;
      readonly auditId: string;
      readonly refusal: GatewayRefusal;
      readonly refusedAt: TimestampMs;
    };

/** Guard: a gateway submission record. */
export function isGatewaySubmissionRecord(v: unknown): v is GatewaySubmissionRecord {
  if (!isRecord(v)) return false;
  if (v.kind === 'routed') {
    return (
      isGatewaySubmissionId(v.submissionId) &&
      isNonEmptyString(v.decisionId) &&
      isNonEmptyString(v.auditId) &&
      isNonEmptyString(v.requestRef) &&
      isNonEmptyString(v.venue) &&
      isNonEmptyString(v.adapterRef) &&
      isNonEmptyString(v.channelRef) &&
      isTimestampMs(v.routedAt)
    );
  }
  if (v.kind === 'refused') {
    return (
      isGatewaySubmissionId(v.submissionId) &&
      (v.decisionId === null || isNonEmptyString(v.decisionId)) &&
      isNonEmptyString(v.auditId) &&
      isGatewayRefusal(v.refusal) &&
      isTimestampMs(v.refusedAt)
    );
  }
  return false;
}

// ===========================================================================
// T034 — the firm-memory mirrors (the knowledge READ serving surface)
// ===========================================================================

/** The closed knowledge-kind vocabulary. Mirror. */
export const KNOWLEDGE_KINDS = ['decision_pattern', 'market_behavior', 'model_calibration', 'data_latency'] as const;

/** One knowledge kind. */
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

/** Guard: a knowledge kind. */
export function isKnowledgeKind(v: unknown): v is KnowledgeKind {
  return typeof v === 'string' && (KNOWLEDGE_KINDS as readonly string[]).includes(v);
}

/** The closed lag-band vocabulary. Mirror. */
export const LAG_BANDS = ['sub_second', 'seconds', 'minutes', 'hours_plus'] as const;

/** One lag band. */
export type LagBand = (typeof LAG_BANDS)[number];

/** Guard: a lag band. */
export function isLagBand(v: unknown): v is LagBand {
  return typeof v === 'string' && (LAG_BANDS as readonly string[]).includes(v);
}

/** The union of all claim-polarity values. Mirror. */
export const CLAIM_POLARITIES: readonly string[] = [
  'harmful',
  'helpful',
  'adverse',
  'favorable',
  'over_projection',
  'under_projection',
] as const;

/** Guard: a claim polarity. */
export function isClaimPolarity(v: unknown): v is string {
  return typeof v === 'string' && (CLAIM_POLARITIES as readonly string[]).includes(v);
}

/** The decision dimensions (T033's decision payload, mirrored). */
export const DECISION_DIMENSIONS = ['timing', 'sizing', 'selection', 'price', 'risk_calibration', 'unresolved'] as const;

/** One decision dimension. */
export type DecisionDimension = (typeof DECISION_DIMENSIONS)[number];

/** Guard: a decision dimension. */
export function isDecisionDimension(v: unknown): v is DecisionDimension {
  return typeof v === 'string' && (DECISION_DIMENSIONS as readonly string[]).includes(v);
}

/** WHAT the firm knows — the typed claim (T034's `KnowledgeClaim`, mirrored). */
export interface KnowledgeClaim {
  readonly kind: KnowledgeKind;
  readonly polarity: string;
  readonly dimension: DecisionDimension | null;
  readonly lagBand: LagBand | null;
}

/** Guard: a knowledge claim (structural; the owning mint enforced the coherence laws). */
export function isKnowledgeClaim(v: unknown): v is KnowledgeClaim {
  if (!isRecord(v)) return false;
  if (!isKnowledgeKind(v.kind)) return false;
  if (!isClaimPolarity(v.polarity)) return false;
  if (v.dimension !== null && !isDecisionDimension(v.dimension)) return false;
  if (v.lagBand !== null && !isLagBand(v.lagBand)) return false;
  return true;
}

/** The evidence chain of one firm-knowledge unit (L9). Mirror. */
export interface KnowledgeProvenance {
  readonly postMortemRefs: readonly string[];
  readonly outcomeRefs: readonly string[];
  readonly experimentRefs: readonly string[];
  readonly trialRefs: readonly string[];
  readonly trajectoryRefs: readonly string[];
  readonly sessionRefs: readonly string[];
}

/** Guard: a knowledge provenance block. */
export function isKnowledgeProvenance(v: unknown): v is KnowledgeProvenance {
  if (!isRecord(v)) return false;
  const lists: readonly unknown[] = [v.postMortemRefs, v.outcomeRefs, v.experimentRefs, v.trialRefs, v.trajectoryRefs, v.sessionRefs];
  return lists.every((list) => Array.isArray(list) && list.every((x) => isNonEmptyString(x)));
}

/** The validity window `[from, to)` — the knowledge's freshness horizon. Mirror. */
export interface ValidityWindow {
  readonly from: TimestampMs;
  readonly to: TimestampMs;
}

/** Guard: a validity window. */
export function isValidityWindow(v: unknown): v is ValidityWindow {
  return isRecord(v) && isTimestampMs(v.from) && isTimestampMs(v.to);
}

/** One firm-knowledge record — the promoted, deduplicated learning unit. Mirror, field for field. */
export interface FirmKnowledgeRecord {
  /** Content-addressed identity: `fkr:` + digest of the canonical content. */
  readonly knowledgeId: string;
  /** 1-based position in the knowledge chain's sequence (append-only). */
  readonly ordinal: number;
  readonly tenant: string;
  readonly project: string;
  readonly claim: KnowledgeClaim;
  /** The aggregate confidence (unit-interval decimal string — exact, never a JS number). */
  readonly confidence: string;
  readonly evidenceCount: number;
  readonly provenance: KnowledgeProvenance;
  readonly validity: ValidityWindow;
  readonly asOf: TimestampMs;
  readonly priorChainHead: string;
}

/** Guard: a firm-knowledge record (structural). */
export function isFirmKnowledgeRecord(v: unknown): v is FirmKnowledgeRecord {
  if (!isRecord(v)) return false;
  if (typeof v.knowledgeId !== 'string' || !v.knowledgeId.startsWith('fkr:')) return false;
  if (!isPositiveSafeInteger(v.ordinal)) return false;
  if (!isNonEmptyString(v.tenant) || !isNonEmptyString(v.project)) return false;
  if (!isKnowledgeClaim(v.claim)) return false;
  if (typeof v.confidence === 'number') return false;
  if (typeof v.confidence !== 'string' || !isUnitIntervalDecimal(v.confidence)) return false;
  if (!isPositiveSafeInteger(v.evidenceCount)) return false;
  if (!isKnowledgeProvenance(v.provenance)) return false;
  if (!isValidityWindow(v.validity)) return false;
  if (!isTimestampMs(v.asOf)) return false;
  if (typeof v.priorChainHead !== 'string' || v.priorChainHead === '') return false;
  return true;
}

/** The knowledge query: the declared scope + the optional filters (T034's serving contract, mirrored). */
export interface KnowledgeQuery {
  readonly tenant: string;
  readonly project: string;
  readonly kinds?: readonly string[];
  readonly polarity?: string;
  readonly dimension?: string;
  readonly lagBand?: string;
  readonly minEvidenceCount?: number;
  readonly minConfidence?: string;
  readonly knowledgeId?: string;
}

/** Guard: a knowledge query (scope mandatory — a query without a scope is inexpressible). */
export function isKnowledgeQuery(v: unknown): v is KnowledgeQuery {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.tenant) || !isNonEmptyString(v.project)) return false;
  if (v.kinds !== undefined && !(Array.isArray(v.kinds) && v.kinds.every((x) => isKnowledgeKind(x)))) return false;
  if (v.polarity !== undefined && !isNonEmptyString(v.polarity)) return false;
  if (v.dimension !== undefined && !isNonEmptyString(v.dimension)) return false;
  if (v.lagBand !== undefined && !isNonEmptyString(v.lagBand)) return false;
  if (v.minEvidenceCount !== undefined && !isPositiveSafeInteger(v.minEvidenceCount)) return false;
  if (v.minConfidence !== undefined && !(typeof v.minConfidence === 'string' && isUnitIntervalDecimal(v.minConfidence))) return false;
  if (v.knowledgeId !== undefined && !isNonEmptyString(v.knowledgeId)) return false;
  return true;
}

/** The query options: the injected instant + the serving policy + the projection switches. Mirror. */
export interface KnowledgeQueryOptions {
  readonly at: TimestampMs;
  readonly retention: unknown;
  readonly activeOnly?: boolean;
}

/** Guard: knowledge query options. */
export function isKnowledgeQueryOptions(v: unknown): v is KnowledgeQueryOptions {
  if (!isRecord(v)) return false;
  if (!isTimestampMs(v.at)) return false;
  if (v.activeOnly !== undefined && typeof v.activeOnly !== 'boolean') return false;
  return true;
}

/** One knowledge entry as served at an instant: the record + the projection's verdict. Mirror. */
export interface ServedKnowledge {
  readonly record: FirmKnowledgeRecord;
  readonly status: 'active' | 'superseded' | 'decayed';
  readonly supersededBy: string | null;
}

/** Guard: served knowledge. */
export function isServedKnowledge(v: unknown): v is ServedKnowledge {
  if (!isRecord(v)) return false;
  if (!isFirmKnowledgeRecord(v.record)) return false;
  if (v.status !== 'active' && v.status !== 'superseded' && v.status !== 'decayed') return false;
  if (v.supersededBy !== null && !isNonEmptyString(v.supersededBy)) return false;
  return true;
}

// ===========================================================================
// T044 — the security-scope mirrors (the L12 substrate)
// ===========================================================================

/**
 * The tenant+project scope EVERY record carries (L12/L15). Structural
 * mirror of packages/security's `Scope` so a REAL T044 scope IS a
 * scope here (the interop trip wire proves it).
 */
export interface Scope {
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

/** Guard: a scope. */
export function isScope(v: unknown): v is Scope {
  if (!isRecord(v)) return false;
  return isTenantId(v.tenant) && isProjectId(v.project);
}

/** `true` iff both components match exactly. PURE and TOTAL; no wildcard, no hierarchy. */
export function sameScope(a: Scope, b: Scope): boolean {
  return a.tenant === b.tenant && a.project === b.project;
}

/** The deterministic scope key: `tenant/project` (index form; stable across processes). */
export function scopeKey(scope: Scope): string {
  return `${scope.tenant}/${scope.project}`;
}

// ===========================================================================
// T043 — the platform-audit complement shapes (emit, never define)
// ===========================================================================

/**
 * The platform actor kinds (T043's closed vocabulary, mirrored — the
 * API's audit records REUSE this vocabulary verbatim; adding a word
 * is T043's decision, never this lane's).
 */
export const PLATFORM_AUDIT_ACTOR_KINDS: readonly string[] = [
  'principal',
  'agent-instance',
  'service',
  'operator',
] as const;

/** One platform actor kind. */
export type PlatformAuditActorKind = (typeof PLATFORM_AUDIT_ACTOR_KINDS)[number];

/** Guard: a platform actor kind. */
export function isPlatformAuditActorKind(v: unknown): v is PlatformAuditActorKind {
  return typeof v === 'string' && (PLATFORM_AUDIT_ACTOR_KINDS as readonly string[]).includes(v);
}

/** The WHO of an audit record: { kind, ref }. Mirror of T043's actor block. */
export interface AuditActor {
  readonly kind: PlatformAuditActorKind;
  readonly ref: string;
}

/** Guard: an audit actor. */
export function isAuditActor(v: unknown): v is AuditActor {
  return isRecord(v) && isPlatformAuditActorKind(v.kind) && isNonEmptyString(v.ref);
}

/** The L15 lineage block of an audit record (T043's shape, mirrored): the goal version + the project continuity root. */
export interface AuditLineage {
  readonly goal: { readonly goalId: string; readonly version: number } | null;
  readonly project: ProjectId;
}

/** Guard: an audit lineage block. */
export function isAuditLineage(v: unknown): v is AuditLineage {
  if (!isRecord(v)) return false;
  if (v.goal !== null) {
    const goal = v.goal;
    if (!isRecord(goal) || !isNonEmptyString(goal.goalId) || !isPositiveSafeInteger(goal.version)) return false;
  }
  return isProjectId(v.project);
}

/** A constant used by the outcome mirrors (imported shape discipline). */
export const OUTCOME_RECORD_PREFIX = 'out:';

/** Guard helper reused by the outcome mirrors: an `out:`-prefixed ref. */
export function isOutcomeRef(v: unknown): v is string {
  return isNonEmptyString(v) && (v as string).startsWith(OUTCOME_RECORD_PREFIX);
}

/** Guard helper: a `pmr:`-prefixed ref. */
export function isPostMortemRef(v: unknown): v is string {
  return isNonEmptyString(v) && (v as string).startsWith('pmr:');
}

/** Guard helper: an unsigned-decimal string carried by served records. */
export function isServedDecimal(v: unknown): v is string {
  return isCanonicalUnsignedDecimal(v);
}

/** Guard helper: a non-negative ordinal (served record positions). */
export function isServedOrdinal(v: unknown): v is number {
  return isNonNegativeSafeInteger(v);
}

deepFreeze(EXECUTION_MODES);
deepFreeze(CONSTRAINT_DOMAINS);
deepFreeze(CONSTRAINT_SEVERITIES);
deepFreeze(PROJECT_LIFECYCLE_STATUSES);
deepFreeze(PROJECT_LIFECYCLE_EVENTS);
deepFreeze(ORDER_SIDES);
deepFreeze(CORE_ORDER_KINDS);
deepFreeze(CORE_TIME_IN_FORCE);
deepFreeze(CONSTRAINT_CHECK_STATUSES);
deepFreeze(INTENT_REASON_KINDS);
deepFreeze(INTENT_AUTHORITY_EMBEDDING_KEYS);
deepFreeze(PRE_TRADE_CHECK_KINDS);
deepFreeze(KNOWLEDGE_KINDS);
deepFreeze(LAG_BANDS);
deepFreeze(CLAIM_POLARITIES);
deepFreeze(DECISION_DIMENSIONS);
deepFreeze(PLATFORM_AUDIT_ACTOR_KINDS);
