// @tradrl/trading-strategy — the strategy intent and the typed refusal.
//
// A {@link StrategyIntent} is the tradable REQUEST record: the
// OrderIntent-shaped mirror (side, instrument, venue, quantity, the
// declared price discipline — see exchange-mirror.ts), the
// constraint-set ref + the satisfied-predicate PROOF under which it was
// computed, the goal ref, the strategy version ref, the observation
// window refs, the seed, the tenant/project scope, and the structured
// rationale of the decision that produced it. Every intent is traceable
// to the goal, constraints, observations and policy that produced it
// (L9) — that is the whole point of the record.
//
// AN INTENT IS NEVER AUTHORITY (L8 — the existential law of this lane):
// the record carries NO venue permission, credential, grant or authority
// verb; embedding any of them fails validation with the typed
// `authority_in_strategy` error (see authority.ts). Execution
// (T019/T020/T034/T040) owns what happens next.
//
// REFUSALS ARE RECORDS, NEVER EXCEPTIONS (constraint primacy): when the
// constraint gate refuses a candidate intent, the run emits an
// {@link IntentRefusal} — a first-class record naming the violated
// predicate (constraint id, domain, subject, severity, the predicate,
// the observed value) with the SAME lineage block an intent would
// carry. A refusal is auditable evidence, not a crash.
//
// Spec anchors: spec/ARCHITECTURE.md (core flow; Execution: "hard
// controls outside prompts"), spec/ARCHITECTURE-LOCK.md L8, L9, L12,
// spec/DOMAIN-MODEL.md (Goal, ConstraintSet).

import {
  deepFreeze,
  isNonEmptyString,
  isPositiveSafeInteger,
  isRecord,
  isTimestampMs,
  type TimestampMs,
} from './primitives';
import {
  type ConstraintSetVersionRef,
  type GoalVersionRef,
  type ProjectId,
  type RiskPolicyRef,
  type Seed,
  type StrategyVersionRef,
  type TenantId,
  isGoalVersionRef,
  isProjectId,
  isRiskPolicyRef,
  isStrategyVersionRef,
  isTenantId,
} from './ids';
import {
  type ConstraintCheckMirror,
  type ConstraintDomainMirror,
  type ConstraintSeverityMirror,
  type CriterionPredicateMirror,
  isConstraintDomainMirror,
  isConstraintSeverityMirror,
  isCriterionPredicateMirror,
} from './control-mirror';
import { type OrderIntentMirror, isOrderIntentMirror } from './exchange-mirror';
import { authorityViolations } from './authority';
import {
  type StrategyError,
  type StrategyResult,
  fail,
  failures,
  invalidField,
  invalidType,
  missingField,
  ok,
} from './errors';

// ---------------------------------------------------------------------------
// The satisfied-predicate proof
// ---------------------------------------------------------------------------

/**
 * The proof that one constraint was SATISFIED under the decision that
 * produced an intent: the constraint's identity, domain, subject,
 * severity and predicate, plus the observed value the predicate was
 * evaluated against. Data, never prose — the proof is reconstructible
 * by re-running the gate over the pinned inputs.
 */
export interface SatisfiedPredicateProof {
  readonly constraintId: string;
  readonly domain: ConstraintDomainMirror;
  readonly subject: string;
  readonly severity: ConstraintSeverityMirror;
  readonly predicate: CriterionPredicateMirror;
  /** The observed value the predicate was evaluated against. */
  readonly observed: string | number | boolean;
}

/** Guard: `SatisfiedPredicateProof`. */
export function isSatisfiedPredicateProof(v: unknown): v is SatisfiedPredicateProof {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.constraintId)) return false;
  if (!isConstraintDomainMirror(v.domain)) return false;
  if (!isNonEmptyString(v.subject)) return false;
  if (!isConstraintSeverityMirror(v.severity)) return false;
  if (!isCriterionPredicateMirror(v.predicate)) return false;
  const observed = v.observed;
  if (typeof observed !== 'string' && typeof observed !== 'number' && typeof observed !== 'boolean') return false;
  if (typeof observed === 'number' && !Number.isFinite(observed)) return false;
  if (typeof observed === 'string' && observed.length === 0) return false;
  return true;
}

/**
 * The constraint proof bound to an intent: the versioned constraint-set
 * ref it was computed under, the satisfied-predicate proofs for every
 * APPLICABLE constraint (satisfied — a refused candidate never becomes
 * an intent), and the advisory violations recorded alongside (advisories
 * do not refuse; they are recorded, never dropped).
 */
export interface ConstraintProof {
  readonly constraintSet: ConstraintSetVersionRef;
  readonly satisfied: readonly SatisfiedPredicateProof[];
  /** Advisory violations observed under this decision (structured, never dropped). */
  readonly advisoryViolations: readonly ConstraintCheckMirror[];
}

/** Guard: `ConstraintProof`. */
export function isConstraintProof(v: unknown): v is ConstraintProof {
  if (!isRecord(v)) return false;
  if (!isRecord(v.constraintSet)) return false;
  const constraintSet = v.constraintSet as Record<string, unknown>;
  if (!isNonEmptyString(constraintSet.id)) return false;
  if (typeof constraintSet.version !== 'number' || !Number.isInteger(constraintSet.version) || constraintSet.version < 1) return false;
  if (!Array.isArray(v.satisfied) || !v.satisfied.every((x) => isSatisfiedPredicateProof(x))) return false;
  if (!Array.isArray(v.advisoryViolations)) return false;
  for (const entry of v.advisoryViolations) {
    if (!isRecord(entry)) return false;
    if (!isNonEmptyString(entry.constraintId)) return false;
    if (entry.severity !== 'advisory') return false; // only advisories ride an intent
    if (entry.status !== 'violated') return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// The structured rationale (why this intent exists)
// ---------------------------------------------------------------------------

/** The closed decision-kind vocabulary of this Work Order's policies. */
export type IntentReasonKind = 'rebalance_drift' | 'rebalance_scheduled' | 'initial_allocation';

export const INTENT_REASON_KINDS: readonly IntentReasonKind[] = [
  'rebalance_drift',
  'rebalance_scheduled',
  'initial_allocation',
] as const;

/**
 * The structured rationale of one intent: the decision kind, the
 * instrument's target weight, the current weight at decision time, and
 * the measured drift (|current - target|, exact decimal). STRUCTURED
 * data — the audit trail reasons over numbers, never prose.
 */
export interface IntentRationale {
  readonly kind: IntentReasonKind;
  readonly instrumentId: string;
  readonly targetWeight: string;
  readonly currentWeight: string;
  readonly drift: string;
}

/** Guard: `IntentRationale`. */
export function isIntentRationale(v: unknown): v is IntentRationale {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.kind) || !(INTENT_REASON_KINDS as readonly string[]).includes(v.kind)) return false;
  if (!isNonEmptyString(v.instrumentId)) return false;
  if (typeof v.targetWeight !== 'string' || v.targetWeight === '') return false;
  if (typeof v.currentWeight !== 'string' || v.currentWeight === '') return false;
  if (typeof v.drift !== 'string' || v.drift === '') return false;
  return true;
}

// ---------------------------------------------------------------------------
// The strategy intent
// ---------------------------------------------------------------------------

/**
 * The tradable request record (see the module header). Field groups:
 *   - `order` — the OrderIntent-shaped mirror (exchange-sim's shape);
 *   - `constraintProof` — the satisfied-predicate proof (constraint
 *     primacy: an intent under an unsatisfied blocking constraint is
 *     inexpressible — the gate refuses instead);
 *   - lineage — goal ref, strategy version ref, observation window
 *     refs, seed, tenant, project (L9/L12);
 *   - `rationale` — the structured decision record;
 *   - `riskPolicyRefs` — the OPAQUE risk-policy refs the intent is
 *     submitted under (the T020 gate resolves them; this lane never
 *     does — L8).
 */
export interface StrategyIntent {
  /** Deterministic identity: `si:` + digest of the intent's content (see run.ts minting). */
  readonly intentId: string;
  /** 1-based position in the run's intent sequence. */
  readonly sequence: number;
  readonly order: OrderIntentMirror;
  readonly constraintProof: ConstraintProof;
  readonly goal: GoalVersionRef;
  readonly strategy: StrategyVersionRef;
  /** The observation window refs the decision was computed from (>= 1, L9). */
  readonly windowRefs: readonly string[];
  readonly seed: Seed;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly riskPolicyRefs: readonly RiskPolicyRef[];
  readonly rationale: IntentRationale;
  /** The decision instant (epoch ms; the order's createdAt derives from it deterministically). */
  readonly asOf: TimestampMs;
}

/** Guard: `StrategyIntent` (structural; the L8 scan included). */
export function isStrategyIntent(v: unknown): v is StrategyIntent {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.intentId) || !(v.intentId as string).startsWith('si:')) return false;
  if (!isPositiveSafeInteger(v.sequence)) return false;
  if (!isOrderIntentMirror(v.order)) return false;
  if (!isConstraintProof(v.constraintProof)) return false;
  if (!isGoalVersionRef(v.goal)) return false;
  if (!isStrategyVersionRef(v.strategy)) return false;
  if (!Array.isArray(v.windowRefs) || v.windowRefs.length === 0) return false;
  if (!v.windowRefs.every((x) => isNonEmptyString(x))) return false;
  if (!isNonEmptyString(v.seed)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  if (!Array.isArray(v.riskPolicyRefs) || !v.riskPolicyRefs.every((x) => isRiskPolicyRef(x))) return false;
  if (!isIntentRationale(v.rationale)) return false;
  if (!isTimestampMs(v.asOf)) return false;
  // The L8 trip wire (the guard half).
  if (authorityViolations(v).length > 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The typed refusal (a RECORD, never an exception)
// ---------------------------------------------------------------------------

/** The closed refusal-cause vocabulary. */
export type RefusalCause =
  /** A blocking constraint was violated — constraint primacy. */
  | 'constraint_refused'
  /** A blocking constraint ERRORED (type conflict / bad subject value) — fail-closed. */
  | 'constraint_error'
  /** The candidate action referenced an instrument outside the spec universe. */
  | 'universe_violation';

export const REFUSAL_CAUSES: readonly RefusalCause[] = [
  'constraint_refused',
  'constraint_error',
  'universe_violation',
] as const;

/**
 * The violated predicate, identified — the Work Order's law: "an intent
 * computed under an unsatisfied constraint is a typed refusal with the
 * violated predicate identified". Carries the full constraint identity
 * (id, domain, subject, severity, predicate) and the observed value
 * (when applicable) so the refusal is its own evidence.
 */
export interface ViolatedPredicate {
  readonly constraintId: string;
  readonly domain: ConstraintDomainMirror;
  readonly subject: string;
  readonly severity: ConstraintSeverityMirror;
  readonly predicate: CriterionPredicateMirror;
  /** The observed value, when the subject was applicable. */
  readonly observed?: string | number | boolean;
}

/** Guard: `ViolatedPredicate`. */
export function isViolatedPredicate(v: unknown): v is ViolatedPredicate {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.constraintId)) return false;
  if (!isConstraintDomainMirror(v.domain)) return false;
  if (!isNonEmptyString(v.subject)) return false;
  if (!isConstraintSeverityMirror(v.severity)) return false;
  if (!isCriterionPredicateMirror(v.predicate)) return false;
  if (v.observed !== undefined) {
    const observed = v.observed;
    if (typeof observed !== 'string' && typeof observed !== 'number' && typeof observed !== 'boolean') return false;
    if (typeof observed === 'string' && observed.length === 0) return false;
  }
  return true;
}

/**
 * The refusal record: the would-be action (structured summary — what
 * the policy wanted to do), the violated predicates (ALL of them,
 * deterministic order), the cause, and the SAME lineage block an
 * intent would carry. Refusals are auditable evidence of constraint
 * primacy — never exceptions, never silent drops.
 */
export interface IntentRefusal {
  /** 1-based position in the run's refusal sequence. */
  readonly sequence: number;
  readonly cause: RefusalCause;
  /** The violated predicates, in constraint-set order. */
  readonly violated: readonly ViolatedPredicate[];
  /** Structured summary of the refused candidate action. */
  readonly candidate: {
    readonly side: 'buy' | 'sell';
    readonly instrumentId: string;
    readonly venueId: string;
    /** The candidate quantity the policy computed (decimal string). */
    readonly quantity: string;
  };
  readonly goal: GoalVersionRef;
  readonly strategy: StrategyVersionRef;
  readonly windowRefs: readonly string[];
  readonly seed: Seed;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly asOf: TimestampMs;
}

/** Guard: `IntentRefusal`. */
export function isIntentRefusal(v: unknown): v is IntentRefusal {
  if (!isRecord(v)) return false;
  if (!isPositiveSafeInteger(v.sequence)) return false;
  if (!isNonEmptyString(v.cause) || !(REFUSAL_CAUSES as readonly string[]).includes(v.cause)) return false;
  if (!Array.isArray(v.violated) || v.violated.length === 0) return false;
  if (!v.violated.every((x) => isViolatedPredicate(x))) return false;
  if (!isRecord(v.candidate)) return false;
  if (v.candidate.side !== 'buy' && v.candidate.side !== 'sell') return false;
  if (!isNonEmptyString(v.candidate.instrumentId)) return false;
  if (!isNonEmptyString(v.candidate.venueId)) return false;
  if (typeof v.candidate.quantity !== 'string' || v.candidate.quantity === '') return false;
  if (!isGoalVersionRef(v.goal)) return false;
  if (!isStrategyVersionRef(v.strategy)) return false;
  if (!Array.isArray(v.windowRefs) || v.windowRefs.length === 0) return false;
  if (!v.windowRefs.every((x) => isNonEmptyString(x))) return false;
  if (!isNonEmptyString(v.seed)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  if (!isTimestampMs(v.asOf)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Validation (collect-all)
// ---------------------------------------------------------------------------

/**
 * Collect-all validation of an untrusted strategy intent. Enforces the
 * L8/L9/L12 laws beyond the structural guard:
 *   - `authority_in_strategy` — any authority-embedding key or verb in
 *     the record's JSON tree (the negative test's crime scene);
 *   - `lineage_gap` — a missing/malformed lineage field group;
 *   - `tenant_missing` — absent tenant/project.
 * On success the value is returned narrowed, deeply frozen.
 */
export function validateStrategyIntent(value: unknown, path = 'intent'): StrategyResult<StrategyIntent> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: StrategyError[] = [];

  if (value.intentId === undefined) errors.push(missingField(`${path}.intentId`));
  else if (!isNonEmptyString(value.intentId)) errors.push(invalidField(`${path}.intentId`, 'must be a non-empty string'));

  if (value.sequence === undefined) errors.push(missingField(`${path}.sequence`));
  else if (!isPositiveSafeInteger(value.sequence)) errors.push(invalidField(`${path}.sequence`, 'must be a positive safe integer'));

  if (value.order === undefined) errors.push(missingField(`${path}.order`));
  else if (!isOrderIntentMirror(value.order)) {
    errors.push(invalidField(`${path}.order`, 'must be a structurally valid order-intent mirror (exchange-sim shape)'));
  }

  if (value.constraintProof === undefined) errors.push(missingField(`${path}.constraintProof`));
  else if (!isConstraintProof(value.constraintProof)) {
    errors.push(invalidField(`${path}.constraintProof`, 'must carry the constraint-set ref, satisfied proofs and advisory violations'));
  }

  if (value.goal === undefined) errors.push({ code: 'lineage_gap', path: `${path}.goal`, message: 'the intent carries no goal version ref (L9)' });
  else if (!isGoalVersionRef(value.goal)) errors.push({ code: 'lineage_gap', path: `${path}.goal`, message: 'the goal version ref is malformed (L9)' });

  if (value.strategy === undefined) errors.push({ code: 'lineage_gap', path: `${path}.strategy`, message: 'the intent carries no strategy version ref (L9)' });
  else if (!isStrategyVersionRef(value.strategy)) errors.push({ code: 'lineage_gap', path: `${path}.strategy`, message: 'the strategy version ref is malformed (L9)' });

  if (value.windowRefs === undefined) errors.push({ code: 'lineage_gap', path: `${path}.windowRefs`, message: 'the intent carries no observation window refs (L9)' });
  else if (!Array.isArray(value.windowRefs) || value.windowRefs.length === 0 || !value.windowRefs.every((x) => isNonEmptyString(x))) {
    errors.push({ code: 'lineage_gap', path: `${path}.windowRefs`, message: 'windowRefs must be a non-empty array of window ids (L9)' });
  }

  if (value.seed === undefined) errors.push({ code: 'lineage_gap', path: `${path}.seed`, message: 'the intent carries no seed (L9 determinism contract)' });
  else if (!isNonEmptyString(value.seed)) errors.push({ code: 'lineage_gap', path: `${path}.seed`, message: 'the seed must be a non-empty string' });

  if (value.tenant === undefined) errors.push({ code: 'tenant_missing', path: `${path}.tenant`, message: 'the intent carries no tenant scope (L12)' });
  else if (!isTenantId(value.tenant)) errors.push({ code: 'tenant_missing', path: `${path}.tenant`, message: 'the tenant scope must be a non-empty id (L12)' });

  if (value.project === undefined) errors.push({ code: 'tenant_missing', path: `${path}.project`, message: 'the intent carries no project scope (L12/L15)' });
  else if (!isProjectId(value.project)) errors.push({ code: 'tenant_missing', path: `${path}.project`, message: 'the project scope must be a non-empty id (L12/L15)' });

  if (value.riskPolicyRefs === undefined) errors.push(missingField(`${path}.riskPolicyRefs`));
  else if (!Array.isArray(value.riskPolicyRefs) || !value.riskPolicyRefs.every((x) => isRiskPolicyRef(x))) {
    errors.push(invalidField(`${path}.riskPolicyRefs`, 'must be an array of opaque risk-policy refs'));
  }

  if (value.rationale === undefined) errors.push(missingField(`${path}.rationale`));
  else if (!isIntentRationale(value.rationale)) {
    errors.push(invalidField(`${path}.rationale`, `must be a structured rationale (${INTENT_REASON_KINDS.join(' | ')})`));
  }

  if (value.asOf === undefined) errors.push(missingField(`${path}.asOf`));
  else if (!isTimestampMs(value.asOf)) errors.push(invalidField(`${path}.asOf`, 'must be an epoch-ms timestamp'));

  for (const crimePath of authorityViolations(value)) {
    errors.push({
      code: 'authority_in_strategy',
      path: `${path}.${crimePath}`,
      message: `strategy intents embed no execution authority ("${crimePath}") — execution authority lives in the T019/T020 gates (L8)`,
    });
  }

  if (errors.length > 0) return failures(errors);
  if (!isStrategyIntent(value)) {
    return fail('invalid_intent', `${path} failed the structural intent guard`);
  }
  return ok(deepFreeze(value) as StrategyIntent);
}

/**
 * Collect-all validation of an untrusted refusal record. The same
 * lineage discipline as intents (a refusal without lineage is not
 * auditable evidence). On success the value is returned narrowed,
 * deeply frozen.
 */
export function validateIntentRefusal(value: unknown, path = 'refusal'): StrategyResult<IntentRefusal> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: StrategyError[] = [];

  if (value.cause === undefined) errors.push(missingField(`${path}.cause`));
  else if (!isNonEmptyString(value.cause) || !(REFUSAL_CAUSES as readonly string[]).includes(value.cause)) {
    errors.push(invalidField(`${path}.cause`, `must be one of ${REFUSAL_CAUSES.join(' | ')}`));
  }

  if (value.violated === undefined) {
    errors.push(missingField(`${path}.violated`));
  } else if (!Array.isArray(value.violated) || value.violated.length === 0 || !value.violated.every((x) => isViolatedPredicate(x))) {
    errors.push(invalidField(`${path}.violated`, 'a refusal names at least one violated predicate (constraint primacy)'));
  }

  if (value.candidate === undefined) {
    errors.push(missingField(`${path}.candidate`));
  } else {
    const candidate = value.candidate as Record<string, unknown>;
    const candidateOk =
      isRecord(candidate) &&
      (candidate.side === 'buy' || candidate.side === 'sell') &&
      isNonEmptyString(candidate.instrumentId) &&
      isNonEmptyString(candidate.venueId) &&
      typeof candidate.quantity === 'string' &&
      candidate.quantity !== '';
    if (!candidateOk) {
      errors.push(invalidField(`${path}.candidate`, 'must be { side, instrumentId, venueId, quantity }'));
    }
  }

  if (value.goal === undefined) errors.push({ code: 'lineage_gap', path: `${path}.goal`, message: 'the refusal carries no goal version ref (L9)' });
  else if (!isGoalVersionRef(value.goal)) errors.push({ code: 'lineage_gap', path: `${path}.goal`, message: 'the goal version ref is malformed (L9)' });

  if (value.strategy === undefined) errors.push({ code: 'lineage_gap', path: `${path}.strategy`, message: 'the refusal carries no strategy version ref (L9)' });
  else if (!isStrategyVersionRef(value.strategy)) errors.push({ code: 'lineage_gap', path: `${path}.strategy`, message: 'the strategy version ref is malformed (L9)' });

  if (value.windowRefs === undefined) errors.push({ code: 'lineage_gap', path: `${path}.windowRefs`, message: 'the refusal carries no observation window refs (L9)' });
  else if (!Array.isArray(value.windowRefs) || value.windowRefs.length === 0) {
    errors.push({ code: 'lineage_gap', path: `${path}.windowRefs`, message: 'windowRefs must be a non-empty array (L9)' });
  }

  if (value.seed === undefined) errors.push({ code: 'lineage_gap', path: `${path}.seed`, message: 'the refusal carries no seed (L9)' });
  if (value.tenant === undefined) errors.push({ code: 'tenant_missing', path: `${path}.tenant`, message: 'the refusal carries no tenant scope (L12)' });
  if (value.project === undefined) errors.push({ code: 'tenant_missing', path: `${path}.project`, message: 'the refusal carries no project scope (L12/L15)' });

  if (value.sequence === undefined) errors.push(missingField(`${path}.sequence`));
  else if (!isPositiveSafeInteger(value.sequence)) errors.push(invalidField(`${path}.sequence`, 'must be a positive safe integer'));

  if (value.asOf === undefined) errors.push(missingField(`${path}.asOf`));
  else if (!isTimestampMs(value.asOf)) errors.push(invalidField(`${path}.asOf`, 'must be an epoch-ms timestamp'));

  if (errors.length > 0) return failures(errors);
  if (!isIntentRefusal(value)) {
    return fail('invalid_refusal', `${path} failed the structural refusal guard`);
  }
  return ok(deepFreeze(value) as IntentRefusal);
}
