// @tradrl/execution-policy — the strategy-lane structural mirrors: the
// INPUT RECORD of the execution gate.
//
// STRUCTURAL MIRROR of @tradrl/trading-strategy (T018) — re-declared by
// STRUCTURE, never imported (D-003/D-004): field-for-field identical
// (same names, same brands, same optionality, same field-presence
// matrix), so a REAL trading-strategy `StrategyIntent` IS a
// {@link StrategyIntentMirror} (mutually assignable, zero casts; proven
// by src/interop.test.ts against the REAL package on this branch). Any
// change in the strategy-lane contracts MUST be mirrored here and vice
// versa.
//
// WHY THIS MIRROR EXISTS (the lane's position in the core flow —
// spec/ARCHITECTURE.md: "Strategy/Portfolio/Risk -> Execution -> Outcome"):
// every execution decision starts from a strategy intent carrying
// goal/constraint/lineage refs (the Work Order's §2: "StrategyIntent +
// IntentRefusal — YOUR INPUT RECORD (mirrors): every execution decision
// starts from a strategy intent"). The intent arrives as an UNTRUSTED
// request: the gate re-validates it through the mirror guard before any
// check runs (fail-closed — a malformed intent never reaches a check).
//
// THE ONE SEMANTIC DIFFERENCE, AND IT IS THE L8 POINT OF THIS LANE
// (spec/ARCHITECTURE-LOCK.md L8: "models cannot bypass hard
// risk/authorization gates"): upstream, an intent is a REQUEST that
// already passed the STRATEGY lane's constraint gate (constraint
// primacy); HERE it is the CONSEQUENTIAL OBJECT the hard gate decides
// over. The intent itself carries NO authority (the strategy lane's own
// L8 trip wire enforces that upstream) — identity, authorization,
// limits, venue permissions, rate budgets, credentials and the kill
// switch live in THIS lane's ExecutionPolicy, never in the intent.
//
// The portfolio-state mirror (also trading-strategy's shape) supplies
// the position/cash facts the LIMITS check reasons over; the
// constraint-proof mirrors ride the intent unchanged (the gate never
// re-evaluates the strategy lane's constraints — L16: strategic and
// order-level control have distinct clocks and authority).
//
// Spec anchors: spec/ARCHITECTURE.md (core flow; Execution),
// spec/ARCHITECTURE-LOCK.md L8, L9, L12, L16.

import { deepFreeze, isFiniteNumber, isMemberOf, isNonEmptyString, isRecord, isTimestampMs, type TimestampMs } from './primitives';
import { isCanonicalDecimal, isNonNegativeDecimalInput, compare as compareDecimal } from './decimals';
import type { ConstraintSetVersionRef, GoalVersionRef, InstrumentId, PortfolioStateId, ProjectId, RiskPolicyRef, Seed, StrategySpecId, StrategyVersionRef, TenantId, VenueId } from './ids';
import {
  isConstraintSetVersionRef,
  isGoalVersionRef,
  isInstrumentId,
  isPortfolioStateId,
  isProjectId,
  isRiskPolicyRef,
  isStrategyVersionRef,
  isTenantId,
  isVenueId,
} from './ids';

// ---------------------------------------------------------------------------
// The order vocabulary (mirror of exchange-sim's domain-mirror.ts, which is
// the mirror of domain-core's canonical Order — the final request form)
// ---------------------------------------------------------------------------

export type OrderSide = 'buy' | 'sell';

export const ORDER_SIDES: readonly OrderSide[] = ['buy', 'sell'] as const;

export type CoreOrderKind = 'market' | 'limit' | 'stop' | 'stop-limit';

export const CORE_ORDER_KINDS: readonly CoreOrderKind[] = ['market', 'limit', 'stop', 'stop-limit'] as const;

/** Open vocabulary (registration discipline): a non-empty string. */
export type OrderKind = CoreOrderKind | (string & Record<never, never>);

export type CoreTimeInForce = 'day' | 'gtc' | 'ioc' | 'fok' | 'gtt';

export const CORE_TIME_IN_FORCE: readonly CoreTimeInForce[] = ['day', 'gtc', 'ioc', 'fok', 'gtt'] as const;

/** Open vocabulary: a non-empty string. */
export type TimeInForce = CoreTimeInForce | (string & Record<never, never>);

/**
 * Exact decimal encoded as a canonical string. Mirror of domain-core's /
 * exchange-sim's `DecimalString`: no leading zeros, no "-0", no trailing
 * ".", at least one fractional digit when a dot is present.
 */
export type DecimalString = string & { readonly __brand: 'DecimalString' };

/**
 * Instant encoded as RFC 3339 / ISO-8601 with a MANDATORY explicit UTC
 * offset. Mirror of domain-core's / exchange-sim's `Timestamp`.
 */
export type Timestamp = string & { readonly __brand: 'Timestamp' };

const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Guard: RFC 3339 timestamp with explicit offset and a real calendar date/time. Mirror. */
export function isTimestamp(v: unknown): v is Timestamp {
  if (typeof v !== 'string' || !TIMESTAMP_PATTERN.test(v)) return false;
  return Number.isFinite(Date.parse(v));
}

/** Guard: canonical decimal string. Mirror. */
export function isDecimalString(v: unknown): v is DecimalString {
  return isCanonicalDecimal(v);
}

/** Precondition: a valid DecimalString. True when its value is > 0. Mirror. */
export function isPositiveDecimalString(a: DecimalString): boolean {
  return compareDecimal(a, '0') > 0;
}

// ---------------------------------------------------------------------------
// The order intent (field-for-field mirror of exchange-sim's OrderIntent /
// domain-core's Order — the final request form the gate decides over)
// ---------------------------------------------------------------------------

/**
 * The tradable request — structurally identical to exchange-sim's
 * `OrderIntent` and domain-core's canonical `Order` (same field names,
 * same brands, same optionality, same field-presence matrix for core
 * kinds, same expiry discipline for core time-in-force values).
 */
export interface OrderIntentMirror {
  /** Caller-assigned idempotency key. Unique within the issuing project scope. */
  readonly clientOrderId: string;
  readonly instrumentId: InstrumentId;
  readonly venueId: VenueId;
  readonly side: OrderSide;
  readonly kind: OrderKind;
  /** Order quantity in instrument units. Strictly positive canonical decimal. */
  readonly quantity: DecimalString;
  /** Limit price. Strictly positive. Required for "limit" and "stop-limit". */
  readonly price?: DecimalString;
  /** Trigger price. Strictly positive. Required for "stop" and "stop-limit". */
  readonly stopPrice?: DecimalString;
  readonly timeInForce: TimeInForce;
  /** Expiry instant. Required for "gtt"; rejected for other core TIF values. */
  readonly expiresAt?: Timestamp;
  readonly createdAt: Timestamp;
  /** Free-form annotation for humans/audit; never interpreted. */
  readonly notes?: string;
}

export function isOrderSide(v: unknown): v is OrderSide {
  return isMemberOf(ORDER_SIDES, v);
}

export function isCoreOrderKind(v: unknown): v is CoreOrderKind {
  return isMemberOf(CORE_ORDER_KINDS, v);
}

/** Open vocabulary: a non-empty string (registration discipline). */
export function isOrderKind(v: unknown): v is OrderKind {
  return isNonEmptyString(v);
}

export function isCoreTimeInForce(v: unknown): v is CoreTimeInForce {
  return isMemberOf(CORE_TIME_IN_FORCE, v);
}

/** Open vocabulary: a non-empty string. */
export function isTimeInForce(v: unknown): v is TimeInForce {
  return isNonEmptyString(v);
}

/**
 * Field-presence matrix for core order kinds (mirror of exchange-sim /
 * domain-core):
 *   market     -> no price, no stopPrice
 *   limit      -> price required, no stopPrice
 *   stop       -> stopPrice required, no price
 *   stop-limit -> price and stopPrice required
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

/** Runtime guard for a structurally valid order intent (mirror of exchange-sim's `isOrderIntent`). */
export function isOrderIntentMirror(v: unknown): v is OrderIntentMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.clientOrderId)) return false;
  if (!isInstrumentId(v.instrumentId)) return false;
  if (!isVenueId(v.venueId)) return false;
  if (!isOrderSide(v.side)) return false;
  if (!isOrderKind(v.kind)) return false;
  if (!isDecimalString(v.quantity) || !isPositiveDecimalString(v.quantity as DecimalString)) return false;
  if (v.price !== undefined && (!isDecimalString(v.price) || !isPositiveDecimalString(v.price as DecimalString))) {
    return false;
  }
  if (v.stopPrice !== undefined && (!isDecimalString(v.stopPrice) || !isPositiveDecimalString(v.stopPrice as DecimalString))) {
    return false;
  }
  if (!isTimeInForce(v.timeInForce)) return false;
  if (v.expiresAt !== undefined && !isTimestamp(v.expiresAt)) return false;
  if (!isTimestamp(v.createdAt)) return false;
  if (v.notes !== undefined && !isNonEmptyString(v.notes)) return false;
  if (isCoreOrderKind(v.kind) && !validateCoreKindPriceMatrix(v)) return false;
  if (isCoreTimeInForce(v.timeInForce) && !validateCoreTimeInForceExpiry(v)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The constraint-proof mirrors (the strategy lane's satisfied-predicate
// evidence — rides the intent unchanged; the gate records, never re-evaluates)
// ---------------------------------------------------------------------------

/** Scalar value observable in an evaluation context. Mirror. */
export type CriterionValueMirror = number | string | boolean;

/**
 * Executable predicate over a criterion metric or constraint subject.
 * Mirror of trading-strategy's `CriterionPredicateMirror` (itself the
 * control-domain mirror). Discriminated by `kind` — the SAME closed
 * vocabulary.
 */
export type CriterionPredicateMirror =
  | { readonly kind: 'limit.max'; readonly bound: number }
  | { readonly kind: 'limit.min'; readonly bound: number }
  | { readonly kind: 'limit.range'; readonly min: number; readonly max: number }
  | { readonly kind: 'equals'; readonly value: CriterionValueMirror }
  | { readonly kind: 'notEquals'; readonly value: CriterionValueMirror }
  | { readonly kind: 'oneOf'; readonly values: readonly string[] }
  | { readonly kind: 'flag'; readonly expected: boolean };

/** The closed predicate-kind vocabulary (mirror). */
export const CRITERION_PREDICATE_KINDS_MIRROR: readonly CriterionPredicateMirror['kind'][] = [
  'limit.max',
  'limit.min',
  'limit.range',
  'equals',
  'notEquals',
  'oneOf',
  'flag',
] as const;

/** Guard: `CriterionValueMirror`. */
export function isCriterionValueMirror(v: unknown): v is CriterionValueMirror {
  if (typeof v === 'boolean') return true;
  if (typeof v === 'string') return isNonEmptyString(v);
  return isFiniteNumber(v);
}

/** Guard: `CriterionPredicateMirror` (total over the closed union). */
export function isCriterionPredicateMirror(v: unknown): v is CriterionPredicateMirror {
  if (!isRecord(v)) return false;
  switch (v.kind) {
    case 'limit.max':
    case 'limit.min':
      return isFiniteNumber(v.bound);
    case 'limit.range':
      return isFiniteNumber(v.min) && isFiniteNumber(v.max) && v.min <= v.max;
    case 'equals':
    case 'notEquals':
      return isCriterionValueMirror(v.value);
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

/** The constraint domain vocabulary. Mirror of trading-strategy's / control-domain's. */
export type ConstraintDomainMirror = 'observation' | 'state' | 'action' | 'outcome';

export const CONSTRAINT_DOMAINS_MIRROR: readonly ConstraintDomainMirror[] = [
  'observation',
  'state',
  'action',
  'outcome',
] as const;

/** Guard: `ConstraintDomainMirror`. */
export function isConstraintDomainMirror(v: unknown): v is ConstraintDomainMirror {
  return isMemberOf(CONSTRAINT_DOMAINS_MIRROR, v);
}

/** The constraint severity vocabulary. Mirror. */
export type ConstraintSeverityMirror = 'advisory' | 'blocking';

export const CONSTRAINT_SEVERITIES_MIRROR: readonly ConstraintSeverityMirror[] = ['advisory', 'blocking'] as const;

/** Guard: `ConstraintSeverityMirror`. */
export function isConstraintSeverityMirror(v: unknown): v is ConstraintSeverityMirror {
  return isMemberOf(CONSTRAINT_SEVERITIES_MIRROR, v);
}

/**
 * The proof that one constraint was SATISFIED under the decision that
 * produced an intent. Mirror of trading-strategy's
 * `SatisfiedPredicateProof`: data, never prose.
 */
export interface SatisfiedPredicateProofMirror {
  readonly constraintId: string;
  readonly domain: ConstraintDomainMirror;
  readonly subject: string;
  readonly severity: ConstraintSeverityMirror;
  readonly predicate: CriterionPredicateMirror;
  /** The observed value the predicate was evaluated against. */
  readonly observed: string | number | boolean;
}

/** Guard: `SatisfiedPredicateProofMirror`. */
export function isSatisfiedPredicateProofMirror(v: unknown): v is SatisfiedPredicateProofMirror {
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

/** The constraint check-status vocabulary. Mirror. */
export type ConstraintCheckStatusMirror = 'satisfied' | 'violated' | 'not_applicable' | 'error';

export const CONSTRAINT_CHECK_STATUSES_MIRROR: readonly ConstraintCheckStatusMirror[] = ['satisfied', 'violated', 'not_applicable', 'error'] as const;

/** Guard: `ConstraintCheckStatusMirror`. */
export function isConstraintCheckStatusMirror(v: unknown): v is ConstraintCheckStatusMirror {
  return isMemberOf(CONSTRAINT_CHECK_STATUSES_MIRROR, v);
}

/**
 * One constraint-gate check record. Mirror of trading-strategy's /
 * control-domain's `ConstraintCheckMirror` (the advisory violations
 * that ride an intent carry this shape).
 */
export interface ConstraintCheckMirror {
  readonly constraintId: string;
  readonly domain: ConstraintDomainMirror;
  readonly subject: string;
  readonly severity: ConstraintSeverityMirror;
  readonly status: ConstraintCheckStatusMirror;
  /** Present when the subject was applicable (satisfied or violated). */
  readonly observed?: CriterionValueMirror;
  /** Present for `not_applicable` / `error` statuses. Human-readable, never executed. */
  readonly reason?: string;
}

/** Guard: `ConstraintCheckMirror`. */
export function isConstraintCheckMirror(v: unknown): v is ConstraintCheckMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.constraintId)) return false;
  if (!isConstraintDomainMirror(v.domain)) return false;
  if (!isNonEmptyString(v.subject)) return false;
  if (!isConstraintSeverityMirror(v.severity)) return false;
  if (!isConstraintCheckStatusMirror(v.status)) return false;
  if (v.observed !== undefined && !isCriterionValueMirror(v.observed)) return false;
  if (v.reason !== undefined && !isNonEmptyString(v.reason)) return false;
  return true;
}

/**
 * The constraint proof bound to an intent. Mirror of trading-strategy's
 * `ConstraintProof`: the versioned constraint-set ref it was computed
 * under, the satisfied-predicate proofs, and the advisory violations
 * observed under the decision (structured, never dropped).
 */
export interface ConstraintProofMirror {
  readonly constraintSet: ConstraintSetVersionRef;
  readonly satisfied: readonly SatisfiedPredicateProofMirror[];
  /** Advisory violations observed under this decision (structured, never dropped). */
  readonly advisoryViolations: readonly ConstraintCheckMirror[];
}

/** Guard: `ConstraintProofMirror`. */
export function isConstraintProofMirror(v: unknown): v is ConstraintProofMirror {
  if (!isRecord(v)) return false;
  if (!isConstraintSetVersionRef(v.constraintSet)) return false;
  if (!Array.isArray(v.satisfied) || !v.satisfied.every((x) => isSatisfiedPredicateProofMirror(x))) return false;
  if (!Array.isArray(v.advisoryViolations)) return false;
  for (const entry of v.advisoryViolations) {
    if (!isConstraintCheckMirror(entry)) return false;
    if (entry.severity !== 'advisory') return false; // only advisories ride an intent
    if (entry.status !== 'violated') return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// The structured rationale mirror (why this intent exists)
// ---------------------------------------------------------------------------

/** The closed decision-kind vocabulary of the strategy lane's policies. Mirror. */
export type IntentReasonKind = 'rebalance_drift' | 'rebalance_scheduled' | 'initial_allocation';

export const INTENT_REASON_KINDS: readonly IntentReasonKind[] = [
  'rebalance_drift',
  'rebalance_scheduled',
  'initial_allocation',
] as const;

/**
 * The structured rationale of one intent. Mirror of trading-strategy's
 * `IntentRationale`: numbers, never prose.
 */
export interface IntentRationaleMirror {
  readonly kind: IntentReasonKind;
  readonly instrumentId: string;
  readonly targetWeight: string;
  readonly currentWeight: string;
  readonly drift: string;
}

/** Guard: `IntentRationaleMirror`. */
export function isIntentRationaleMirror(v: unknown): v is IntentRationaleMirror {
  if (!isRecord(v)) return false;
  if (!isMemberOf(INTENT_REASON_KINDS, v.kind)) return false;
  if (!isNonEmptyString(v.instrumentId)) return false;
  if (typeof v.targetWeight !== 'string' || v.targetWeight === '') return false;
  if (typeof v.currentWeight !== 'string' || v.currentWeight === '') return false;
  if (typeof v.drift !== 'string' || v.drift === '') return false;
  return true;
}

// ---------------------------------------------------------------------------
// The L8 authority trip wire (mirror of trading-strategy's authority scan)
// ---------------------------------------------------------------------------

/**
 * The closed key vocabulary that makes an intent record EMBED EXECUTION
 * AUTHORITY — mirror of trading-strategy's AUTHORITY_EMBEDDING_KEYS (the
 * strategy lane's own L8 trip wire; re-declared here so the mirror guard
 * enforces the SAME law — a REAL intent and a mirror intent must agree
 * on every crime). Risk/authorization POLICY stays referable via the
 * OPAQUE `riskPolicyRefs` field; an embedded GRANT, TOKEN, CREDENTIAL
 * or PERMISSION is the crime.
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

/**
 * Walks an intent's JSON tree and returns the dotted paths of every
 * authority-embedding key (mirror of trading-strategy's
 * `authorityKeyPaths` — the same walk discipline).
 */
export function intentAuthorityViolations(value: unknown, prefix = ''): readonly string[] {
  const found: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      for (const path of intentAuthorityViolations(item, `${prefix}[${index}]`)) found.push(path);
    });
    return found;
  }
  if (!isRecord(value)) return found;
  for (const key of Object.keys(value)) {
    if (INTENT_AUTHORITY_EMBEDDING_KEYS.includes(key)) found.push(prefix === '' ? key : `${prefix}.${key}`);
    for (const path of intentAuthorityViolations(value[key], prefix === '' ? key : `${prefix}.${key}`)) {
      found.push(path);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// The strategy intent (THE INPUT RECORD — field-for-field mirror of
// trading-strategy's StrategyIntent)
// ---------------------------------------------------------------------------

/**
 * The tradable request record the gate decides over. Field-for-field
 * mirror of trading-strategy's `StrategyIntent`: the order mirror, the
 * constraint proof, the lineage group (goal ref, strategy version ref,
 * window refs, seed, tenant, project), the risk-policy refs (OPAQUE —
 * the T020 gate resolves them; this lane records them into the audit
 * trail, never resolves them), the structured rationale and the
 * decision instant.
 */
export interface StrategyIntentMirror {
  /** Deterministic identity: `si:` + digest of the intent's content. */
  readonly intentId: string;
  /** 1-based position in the run's intent sequence. */
  readonly sequence: number;
  readonly order: OrderIntentMirror;
  readonly constraintProof: ConstraintProofMirror;
  readonly goal: GoalVersionRef;
  readonly strategy: StrategyVersionRef;
  /** The observation window refs the decision was computed from (>= 1, L9). */
  readonly windowRefs: readonly string[];
  readonly seed: Seed;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly riskPolicyRefs: readonly RiskPolicyRef[];
  readonly rationale: IntentRationaleMirror;
  /** The decision instant (epoch ms; the order's createdAt derives from it deterministically). */
  readonly asOf: TimestampMs;
}

/** Guard: `StrategyIntentMirror` (structural; mirrors trading-strategy's `isStrategyIntent` law for law — the L8 scan included). */
export function isStrategyIntentMirror(v: unknown): v is StrategyIntentMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.intentId) || !(v.intentId as string).startsWith('si:')) return false;
  if (typeof v.sequence !== 'number' || !Number.isSafeInteger(v.sequence) || v.sequence < 1) return false;
  if (!isOrderIntentMirror(v.order)) return false;
  if (!isConstraintProofMirror(v.constraintProof)) return false;
  if (!isGoalVersionRef(v.goal)) return false;
  if (!isStrategyVersionRef(v.strategy)) return false;
  if (!Array.isArray(v.windowRefs) || v.windowRefs.length === 0) return false;
  if (!v.windowRefs.every((x) => isNonEmptyString(x))) return false;
  if (!isNonEmptyString(v.seed)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  if (!Array.isArray(v.riskPolicyRefs) || !v.riskPolicyRefs.every((x) => isRiskPolicyRef(x))) return false;
  if (!isIntentRationaleMirror(v.rationale)) return false;
  if (!isTimestampMs(v.asOf)) return false;
  // The L8 trip wire (mirror of the real guard's law): an intent
  // embedding execution authority is not a mirror intent.
  if (intentAuthorityViolations(v).length > 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The portfolio-state mirror (the limits check's facts)
// ---------------------------------------------------------------------------

/**
 * The strategy lane's lineage block. Mirror of trading-strategy's
 * `StrategyLineage`: the strategy version, the goal version, the
 * constraint-set version, the observation window identity, the seed,
 * the tenant and the project.
 */
export interface StrategyLineageMirror {
  readonly strategy: StrategyVersionRef;
  readonly goal: GoalVersionRef;
  readonly constraintSet: ConstraintSetVersionRef;
  /** The observation window the record was computed under. */
  readonly windowId: string;
  /** The run's deterministic seed (part of the determinism contract). */
  readonly seed: Seed;
  /** Tenant scope (L12). */
  readonly tenant: TenantId;
  /** Project continuity root (L12/L15). */
  readonly project: ProjectId;
}

/** Guard: `StrategyLineageMirror`. */
export function isStrategyLineageMirror(v: unknown): v is StrategyLineageMirror {
  if (!isRecord(v)) return false;
  if (!isStrategyVersionRef(v.strategy)) return false;
  if (!isGoalVersionRef(v.goal)) return false;
  if (!isConstraintSetVersionRef(v.constraintSet)) return false;
  if (!isNonEmptyString(v.windowId)) return false;
  if (!isNonEmptyString(v.seed)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  return true;
}

/** The recorded mark source of a portfolio weight. Mirror. */
export type MarkSourceMirror = 'last_trade' | 'mid_quote';

/**
 * One position record. Mirror of trading-strategy's `PositionRecord`:
 * instrument + venue (the netting key), UNSIGNED quantity, total cost
 * basis, opened-at.
 */
export interface PositionRecordMirror {
  readonly instrumentId: InstrumentId;
  readonly venueId: VenueId;
  /** Held quantity, non-negative decimal. */
  readonly quantity: string;
  /** Total cost basis of the held quantity, non-negative decimal. */
  readonly costBasis: string;
  /** The instant the position was opened (epoch ms). */
  readonly openedAt: TimestampMs;
}

/** Guard: `PositionRecordMirror`. */
export function isPositionRecordMirror(v: unknown): v is PositionRecordMirror {
  if (!isRecord(v)) return false;
  if (!isInstrumentId(v.instrumentId)) return false;
  if (!isVenueId(v.venueId)) return false;
  if (!isNonNegativeDecimalInput(v.quantity)) return false;
  if (!isNonNegativeDecimalInput(v.costBasis)) return false;
  if (!isTimestampMs(v.openedAt)) return false;
  return true;
}

/** One recorded weight. Mirror of trading-strategy's `PortfolioWeight`. */
export interface PortfolioWeightMirror {
  readonly instrumentId: InstrumentId;
  readonly weight: string;
  /** The mark source the snapshot was priced from. */
  readonly markSource: MarkSourceMirror;
}

/** Guard: `PortfolioWeightMirror`. */
export function isPortfolioWeightMirror(v: unknown): v is PortfolioWeightMirror {
  if (!isRecord(v)) return false;
  if (!isInstrumentId(v.instrumentId)) return false;
  if (!isNonNegativeDecimalInput(v.weight)) return false;
  if (v.markSource !== 'last_trade' && v.markSource !== 'mid_quote') return false;
  return true;
}

/**
 * The immutable portfolio snapshot the LIMITS check reasons over.
 * Field-for-field mirror of trading-strategy's `PortfolioState`
 * (content-addressed id, positions, weights, cash, the signed PnL
 * split, asOf, the full lineage block).
 */
export interface PortfolioStateMirror {
  /** Content-addressed identity (`ps:` + digest of the canonical content minus the id). */
  readonly stateId: PortfolioStateId;
  readonly positions: readonly PositionRecordMirror[];
  readonly weights: readonly PortfolioWeightMirror[];
  /** Cash, non-negative decimal. */
  readonly cash: string;
  /** Realized PnL accumulated over the state's history, SIGNED decimal. */
  readonly realizedPnl: string;
  /** Unrealized (mark-to-market) PnL at `asOf`, SIGNED decimal. */
  readonly unrealizedPnl: string;
  /** The snapshot instant. */
  readonly asOf: TimestampMs;
  readonly lineage: StrategyLineageMirror;
}

/** `true` for a canonical decimal with an optional single leading "-" (the PnL split's grammar). */
export function isSignedCanonicalDecimal(v: unknown): v is string {
  if (typeof v !== 'string' || v === '') return false;
  const body = v.startsWith('-') ? v.slice(1) : v;
  return /^(0|[1-9]\d*)(\.\d+)?$/.test(body);
}

/** Guard: `PortfolioStateMirror` (structural; the netting and lineage laws included). */
export function isPortfolioStateMirror(v: unknown): v is PortfolioStateMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.stateId)) return false;
  if (!Array.isArray(v.positions)) return false;
  if (!v.positions.every((x) => isPositionRecordMirror(x))) return false;
  const seen = new Set<string>();
  for (const position of v.positions) {
    const record = position as PositionRecordMirror;
    const key = `${record.instrumentId}|${record.venueId}`;
    if (seen.has(key)) return false; // netting discipline
    seen.add(key);
  }
  if (!Array.isArray(v.weights)) return false;
  if (!v.weights.every((x) => isPortfolioWeightMirror(x))) return false;
  const weightSeen = new Set<string>();
  for (const weight of v.weights) {
    const record = weight as PortfolioWeightMirror;
    if (weightSeen.has(record.instrumentId)) return false;
    weightSeen.add(record.instrumentId);
  }
  if (!isNonNegativeDecimalInput(v.cash)) return false;
  if (!isSignedCanonicalDecimal(v.realizedPnl)) return false;
  if (!isSignedCanonicalDecimal(v.unrealizedPnl)) return false;
  if (!isTimestampMs(v.asOf)) return false;
  if (!isStrategyLineageMirror(v.lineage)) return false;
  return true;
}

/** Deep-freeze helper for hand-assembled fixture inputs (tests/services). */
export function freezeIntent<T extends StrategyIntentMirror>(intent: T): T {
  return deepFreeze(intent);
}
