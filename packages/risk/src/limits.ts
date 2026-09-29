// @tradrl/risk — the LimitEvaluation: (ExposureRecord, RiskPolicy,
// kill-switch mirror) -> the LimitState set.
//
// THE TOTALITY LAW (the Work Order: "Limit-state totality: every limit
// kind the engine declares (position, notional, order-size,
// concentration, drawdown, leverage...) has an EXHAUSTIVE
// machine-enumerated check: (portfolio state, market state, policy) ->
// LimitState (within | breaching | blocked) with structured reasons; an
// unevaluable limit is a typed error, never a silent pass"): the seven
// kinds of RISK_LIMIT_KINDS each have a check function over the
// measured facts; every DECLARED limit produces a state; a limit whose
// evaluation cannot proceed fails the whole evaluation with the typed
// `limit_unevaluable` NAMING the kind. The unevaluable sites:
//   - the four class kinds: an incoherent MEASURE RECORD (an order or
//     position whose recorded notional does not equal its quantity x
//     reference price) — the evaluator re-proves the arithmetic of every
//     measure it reasons over (defense-in-depth: the exposure guard
//     checks structure; the evaluator proves arithmetic);
//   - concentration: an instrument notional exceeding the gross
//     (incoherent aggregate);
//   - drawdown: an incoherent high-water mark (drawdown != peak -
//     equity, or peak < equity);
//   - leverage: equity <= 0 (the ratio is undefined over a non-positive
//     denominator — never a silent pass, never a guessed sign).
//
// THE BLOCKED STATE'S TWO CAUSES (structured, never silent):
//   - KILL-SWITCH DOMINANCE (the interop law: "a thrown switch means
//     every limit evaluates to blocked"): a chain-VERIFIED thrown
//     switch log (T019's records, honored through the mirror) blocks
//     EVERY state with the kill-switch reason. A log that fails chain
//     verification is the typed `killswitch_rewrite` — the engine never
//     honors a switch it cannot trust.
//   - NO DECLARED LIMIT (fail-closed, mirroring T019's empty-collection
//     semantics: "the crime the totality law forbids is the ABSENT
//     DIMENSION, never the empty-but-declared one"): an instrument
//     whose class has no record and no '*' catch-all produces blocked
//     states carrying the structured no-declared-limit reason — the
//     engine refuses to guess a cap it does not know.
//
// THE L7 LAW: a BREACHING state is a MEASUREMENT outcome — structured
// data (which limit, the bound, the observed value, the excess). It is
// NOT an acceptance verdict; the engine informs, evaluation (T012)
// decides. The T019 gate consumes the class-kind states through
// {@link executionLimitRefusals} — the execution-policy limits-refusal
// mirror (check-machine.ts's `RefusalReason` 'limits' variant shape).
//
// DETERMINISM (L9): the same (exposure, policy, kill switch) always
// produces the byte-identical evaluation — the evaluation id is
// content-addressed (`rls:` + digest). No ambient clock (the record's
// asOf is the exposure's), no randomness.
//
// Spec anchors: spec/ARCHITECTURE.md (Execution — "limits"), spec/
// ARCHITECTURE-LOCK.md L7, L8, L9, L12.

import { deepFreeze, isRecord, type JsonValue, type TimestampMs } from './primitives';
import { canonicalJson, stableDigest } from './primitives';
import {
  add as decAdd,
  compare as decCompare,
  divideRoundHalfUp,
  isEqual as decIsEqual,
  multiply as decMultiply,
  normalize as decNormalize,
  signedAdd,
  signedCompare,
  signedSubtract,
  subtract as decSubtract,
} from './decimals';
import type { ClassLimitKind, RiskLimitKind, RiskPolicy } from './policy';
import { isRiskPolicy } from './policy';
import type { ExposureRecord } from './exposure';
import { isExposureRecord } from './exposure';
import type { KillSwitchLogMirror } from './killswitch-mirror';
import { isKillSwitchLogMirror, killSwitchStateMirror, verifyKillSwitchChainMirror } from './killswitch-mirror';
import type { ConstraintSetVersionRef, ExposureRecordId, GoalVersionRef, InstrumentId, LimitEvaluationId, ProjectId, RiskPolicyVersionRef, Seed, TenantId, VenueId } from './ids';
import { mintLimitEvaluationId } from './ids';
import {
  type RiskError,
  type RiskResult,
  fail,
  invalidField,
  ok,
} from './errors';

// ---------------------------------------------------------------------------
// The limit states
// ---------------------------------------------------------------------------

/** The state vocabulary: within, breaching (structured reason), or blocked (structured cause). */
export type LimitStateValue = 'within' | 'breaching' | 'blocked';

export const LIMIT_STATE_VALUES: readonly LimitStateValue[] = ['within', 'breaching', 'blocked'] as const;

/** Guard: a limit state value. */
export function isLimitStateValue(v: unknown): v is LimitStateValue {
  return v === 'within' || v === 'breaching' || v === 'blocked';
}

/** The state's scope: one instrument (with its class) or the whole portfolio. */
export type LimitScope =
  | { readonly kind: 'instrument'; readonly venue: VenueId; readonly instrument: InstrumentId; readonly instrumentClass: string }
  | { readonly kind: 'portfolio' };

/** Guard: `LimitScope`. */
export function isLimitScope(v: unknown): v is LimitScope {
  if (!isRecord(v)) return false;
  if (v.kind === 'portfolio') return true;
  if (v.kind !== 'instrument') return false;
  if (typeof v.venue !== 'string' || v.venue === '') return false;
  if (typeof v.instrument !== 'string' || v.instrument === '') return false;
  if (typeof v.instrumentClass !== 'string' || v.instrumentClass === '') return false;
  return true;
}

/**
 * The structured reason — enumerated data, never free text. `breach`
 * carries the exact-evidence triple (bound, observed, excess); the
 * blocked causes carry the kill-switch evidence or the absent class
 * record.
 */
export type LimitReason =
  | { readonly cause: 'breach'; readonly bound: string; readonly observed: string; readonly excess: string }
  | { readonly cause: 'kill_switch'; readonly switchId: string; readonly thrownAt: TimestampMs }
  | { readonly cause: 'no_declared_limit'; readonly instrumentClass: string };

/** Guard: `LimitReason` (total over the closed union). */
export function isLimitReason(v: unknown): v is LimitReason {
  if (!isRecord(v)) return false;
  switch (v.cause) {
    case 'breach':
      return (
        typeof v.bound === 'string' && v.bound !== '' &&
        typeof v.observed === 'string' && v.observed !== '' &&
        typeof v.excess === 'string' && v.excess !== ''
      );
    case 'kill_switch':
      return typeof v.switchId === 'string' && v.switchId !== '' && typeof v.thrownAt === 'number' && Number.isSafeInteger(v.thrownAt) && v.thrownAt >= 0;
    case 'no_declared_limit':
      return typeof v.instrumentClass === 'string' && v.instrumentClass !== '';
    default:
      return false;
  }
}

/**
 * One limit's state: the kind, the scope, the value, and the structured
 * reason (null iff within — a within state needs no explanation; every
 * non-within state carries one).
 */
export interface LimitState {
  readonly kind: RiskLimitKind;
  readonly scope: LimitScope;
  readonly state: LimitStateValue;
  readonly reason: LimitReason | null;
}

/** Guard: `LimitState`. */
export function isLimitState(v: unknown): v is LimitState {
  if (!isRecord(v)) return false;
  if (typeof v.kind !== 'string' || !( ['order_size', 'order_notional', 'position_size', 'position_notional', 'concentration', 'drawdown', 'leverage'] as readonly string[]).includes(v.kind)) return false;
  if (!isLimitScope(v.scope)) return false;
  if (!isLimitStateValue(v.state)) return false;
  if (v.state === 'within' && v.reason !== null) return false;
  if (v.state !== 'within' && !isLimitReason(v.reason)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The lineage block (L9 — every risk record carries it)
// ---------------------------------------------------------------------------

/**
 * The risk lane's full lineage block: the policy version whose limits
 * were evaluated, the constraint set the policy compiled from, the goal
 * it serves, the measured portfolio and market states, the seed, and
 * the tenant/project scope (L12).
 */
export interface RiskLineage {
  readonly policy: RiskPolicyVersionRef;
  readonly constraintSet: ConstraintSetVersionRef;
  readonly goal: GoalVersionRef;
  readonly portfolioState: string;
  readonly marketState: string;
  readonly seed: Seed;
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

/** Guard: `RiskLineage`. */
export function isRiskLineage(v: unknown): v is RiskLineage {
  if (!isRecord(v)) return false;
  const policy = v.policy;
  if (!isRecord(policy) || typeof policy.policyId !== 'string' || !policy.policyId.startsWith('rpol:') || typeof policy.version !== 'number' || !Number.isSafeInteger(policy.version) || policy.version < 1) return false;
  const constraintSet = v.constraintSet;
  if (!isRecord(constraintSet) || typeof constraintSet.id !== 'string' || constraintSet.id === '' || typeof constraintSet.version !== 'number' || !Number.isSafeInteger(constraintSet.version) || constraintSet.version < 1) return false;
  const goal = v.goal;
  if (!isRecord(goal) || typeof goal.goalId !== 'string' || goal.goalId === '' || typeof goal.version !== 'number' || !Number.isSafeInteger(goal.version) || goal.version < 1) return false;
  if (typeof v.portfolioState !== 'string' || v.portfolioState === '') return false;
  if (typeof v.marketState !== 'string' || v.marketState === '') return false;
  if (typeof v.seed !== 'string' || v.seed === '') return false;
  if (typeof v.tenant !== 'string' || v.tenant === '') return false;
  if (typeof v.project !== 'string' || v.project === '') return false;
  return true;
}

// ---------------------------------------------------------------------------
// The evaluation record
// ---------------------------------------------------------------------------

/**
 * The limit evaluation: every declared limit's state over one measured
 * exposure, under one policy version, honoring one kill-switch log.
 * Content-addressed (`rls:` + digest of the canonical content); deeply
 * frozen; byte-stable (L9).
 */
export interface LimitEvaluationRecord {
  /** Content-addressed identity: `rls:` + digest of the canonical content. */
  readonly evaluationId: LimitEvaluationId;
  readonly policy: RiskPolicyVersionRef;
  /** The measured exposure this evaluation reasons over. */
  readonly exposureRef: ExposureRecordId;
  /** The honored switch log's state at evaluation time ('thrown' blocked everything). */
  readonly killSwitchState: 'standing' | 'thrown';
  readonly states: readonly LimitState[];
  readonly lineage: RiskLineage;
  /** The evaluation instant (the exposure's asOf — no ambient clock). */
  readonly asOf: TimestampMs;
}

/** Guard: `LimitEvaluationRecord` (structural). */
export function isLimitEvaluationRecord(v: unknown): v is LimitEvaluationRecord {
  if (!isRecord(v)) return false;
  if (typeof v.evaluationId !== 'string' || !v.evaluationId.startsWith('rls:')) return false;
  const policy = v.policy;
  if (!isRecord(policy) || typeof policy.policyId !== 'string' || !policy.policyId.startsWith('rpol:') || typeof policy.version !== 'number' || !Number.isSafeInteger(policy.version) || policy.version < 1) return false;
  if (typeof v.exposureRef !== 'string' || !v.exposureRef.startsWith('exp:')) return false;
  if (v.killSwitchState !== 'standing' && v.killSwitchState !== 'thrown') return false;
  if (!Array.isArray(v.states) || !v.states.every((x) => isLimitState(x))) return false;
  if (!isRiskLineage(v.lineage)) return false;
  if (typeof v.asOf !== 'number' || !Number.isSafeInteger(v.asOf) || v.asOf < 0) return false;
  return true;
}

/** The canonical JSON tree of a limit scope (the explicit-tree discipline — JSON shape proven by construction). */
function scopeTree(scope: LimitScope): JsonValue {
  return scope.kind === 'portfolio'
    ? { kind: 'portfolio' }
    : { kind: 'instrument', venue: scope.venue, instrument: scope.instrument, instrumentClass: scope.instrumentClass };
}

/** The canonical JSON tree of a limit reason. */
function reasonTree(reason: LimitReason): JsonValue {
  return reason.cause === 'breach'
    ? { cause: 'breach', bound: reason.bound, observed: reason.observed, excess: reason.excess }
    : reason.cause === 'kill_switch'
      ? { cause: 'kill_switch', switchId: reason.switchId, thrownAt: reason.thrownAt }
      : { cause: 'no_declared_limit', instrumentClass: reason.instrumentClass };
}

/** The canonical JSON tree of an evaluation's CONTENT (everything except the content-addressed `evaluationId`). */
export function evaluationContentTree(record: Omit<LimitEvaluationRecord, 'evaluationId'>): JsonValue {
  return {
    policy: { policyId: record.policy.policyId, version: record.policy.version },
    exposureRef: record.exposureRef,
    killSwitchState: record.killSwitchState,
    states: record.states.map((state) => ({
      kind: state.kind,
      scope: scopeTree(state.scope),
      state: state.state,
      reason: state.reason === null ? null : reasonTree(state.reason),
    })),
    lineage: {
      policy: { policyId: record.lineage.policy.policyId, version: record.lineage.policy.version },
      constraintSet: { id: record.lineage.constraintSet.id, version: record.lineage.constraintSet.version },
      goal: { goalId: record.lineage.goal.goalId, version: record.lineage.goal.version },
      portfolioState: record.lineage.portfolioState,
      marketState: record.lineage.marketState,
      seed: record.lineage.seed,
      tenant: record.lineage.tenant,
      project: record.lineage.project,
    },
    asOf: record.asOf,
  };
}

/** The L9 anchor: the canonical JSON of a validated evaluation. */
export function canonicalEvaluationJson(record: LimitEvaluationRecord): string {
  return canonicalJson(evaluationContentTree(record));
}

// ---------------------------------------------------------------------------
// The evaluation
// ---------------------------------------------------------------------------

/** The evaluation's input bundle. */
export interface LimitEvaluationInput {
  /** The untrusted exposure record (validated inside; its arithmetic is re-proved per kind). */
  readonly exposure: unknown;
  /** The VALIDATED risk policy (see policy.ts `validateRiskPolicy` — re-guarded here). */
  readonly policy: RiskPolicy;
  /** The untrusted kill-switch log mirror (chain-verified inside — the interop law). */
  readonly killSwitch: unknown;
}

/** The class record for an instrument class: the exact class first, then the '*' catch-all (T019's selector, mirrored). */
function classRecordOf(policy: RiskPolicy, instrumentClass: string): RiskPolicy['classLimits'][number] | undefined {
  return policy.classLimits.find((limit) => limit.instrumentClass === instrumentClass) ?? policy.classLimits.find((limit) => limit.instrumentClass === '*');
}

/**
 * Evaluate every declared limit over one measured exposure — the pure,
 * total, deterministic core of this lane. Fails with:
 *   - `invalid_field` — the exposure fails its structural guard;
 *   - `killswitch_rewrite` — the switch log fails chain verification;
 *   - `tenant_missing` — the policy's scope does not match the
 *     exposure's lineage scope (L12);
 *   - `limit_unevaluable` — a declared limit whose evaluation cannot
 *     proceed (incoherent measures; non-positive equity for leverage) —
 *     the kind is NAMED in the error, never a silent pass.
 * On success the record is deeply frozen with its content-addressed id
 * (L9): the same inputs always produce the byte-identical evaluation.
 */
export function evaluateLimits(input: LimitEvaluationInput): RiskResult<LimitEvaluationRecord> {
  if (!isRecord(input)) {
    return { ok: false, errors: [invalidField('input', 'evaluateLimits requires an input object { exposure, policy, killSwitch }')] };
  }
  if (!isExposureRecord(input.exposure)) {
    return { ok: false, errors: [invalidField('exposure', 'evaluateLimits requires a structurally valid exposure record (exposure.ts computeExposure)')] };
  }
  const exposure = input.exposure;
  if (!isRiskPolicy(input.policy)) {
    return { ok: false, errors: [invalidField('policy', 'evaluateLimits requires a validated risk policy (policy.ts validateRiskPolicy)')] };
  }
  const policy = input.policy;
  if (!isKillSwitchLogMirror(input.killSwitch)) {
    return { ok: false, errors: [{ code: 'killswitch_rewrite', path: 'killSwitch', message: 'evaluateLimits requires a structurally valid kill-switch log mirror (the T019 records)' }] };
  }
  const switchLog = input.killSwitch;
  const verified = verifyKillSwitchChainMirror(switchLog);
  if (!verified.ok) return verified;
  const switchState = killSwitchStateMirror(switchLog);

  // L12: the policy's scope binds the measurement's scope.
  if (policy.tenant !== exposure.lineage.tenant || policy.project !== exposure.lineage.project) {
    return {
      ok: false,
      errors: [{
        code: 'tenant_missing',
        path: 'policy',
        message: `the policy's scope (${policy.tenant}/${policy.project}) does not match the exposure's lineage (${exposure.lineage.tenant}/${exposure.lineage.project}) — cross-tenant measurement is inexpressible (L12)`,
      }],
    };
  }

  // The kill-switch evidence (when thrown, every state blocks with it).
  let throwEvidence: { switchId: string; thrownAt: TimestampMs } | null = null;
  if (switchState === 'thrown') {
    const thrown = [...switchLog.records].reverse().find((record) => record.state === 'thrown');
    // Unreachable when the state is thrown (the guard enforces a thrown
    // record exists); kept total — a thrown log without evidence cannot
    // block silently, so it is the typed rewrite crime instead.
    if (thrown === undefined || thrown.thrownAt === null) {
      return fail('killswitch_rewrite', 'the thrown switch log carries no throw evidence — the engine never blocks on a switch it cannot read');
    }
    throwEvidence = { switchId: switchLog.switchId, thrownAt: thrown.thrownAt };
  }

  /** Emit one state — the single construction site (deterministic ordering is the caller's). */
  const states: LimitState[] = [];
  const emit = (kind: RiskLimitKind, scope: LimitScope, state: LimitStateValue, reason: LimitReason | null): void => {
    states.push(deepFreeze({ kind, scope, state, reason }));
  };
  const blockedBySwitch = (kind: RiskLimitKind, scope: LimitScope): void => {
    emit(kind, scope, 'blocked', throwEvidence === null ? null : { cause: 'kill_switch', switchId: throwEvidence.switchId, thrownAt: throwEvidence.thrownAt });
  };
  /** The exact comparison + structured breach reason (the totality law's per-kind check). */
  const checkBounded = (
    kind: RiskLimitKind,
    scope: LimitScope,
    observed: string,
    bound: string,
  ): RiskResult<'within' | 'breaching'> => {
    if (decCompare(observed, bound) <= 0) {
      emit(kind, scope, 'within', null);
      return { ok: true, value: 'within' };
    }
    emit(kind, scope, 'breaching', {
      cause: 'breach',
      bound: decNormalize(bound),
      observed: decNormalize(observed),
      excess: decSubtract(observed, bound),
    });
    return { ok: true, value: 'breaching' };
  };

  // --- The class kinds: order measures ---------------------------------------
  for (const order of exposure.orders) {
    const scope: LimitScope = deepFreeze({ kind: 'instrument', venue: order.venue, instrument: order.instrument, instrumentClass: order.assetClass });
    // The measure-record coherence precondition (defense-in-depth): the
    // evaluator re-proves the arithmetic before reasoning over a measure.
    const coherentNotional = decIsEqual(order.notional, decMultiply(order.quantity, order.referencePrice));
    if (!coherentNotional) {
      return {
        ok: false,
        errors: [{
          code: 'limit_unevaluable',
          path: `exposure.orders[${order.fillRef}]`,
          message: `the order measure for (${order.venue}, ${order.instrument}) is arithmetically incoherent (notional != quantity x referencePrice) — the evaluator never reasons over corrupted measures (kind order_notional/order_size)`,
        }],
      };
    }
    const record = classRecordOf(policy, order.assetClass);
    if (record === undefined) {
      // Fail-closed: no cap declared for this class (the '*' catch-all
      // included) — blocked with the structured reason, mirroring T019's
      // empty-collection semantics. NOT an error: the policy declared
      // the limits dimension; it declared no cap for THIS class.
      emit('order_size', scope, 'blocked', { cause: 'no_declared_limit', instrumentClass: order.assetClass });
      emit('order_notional', scope, 'blocked', { cause: 'no_declared_limit', instrumentClass: order.assetClass });
      continue;
    }
    if (switchState === 'thrown') {
      blockedBySwitch('order_size', scope);
      blockedBySwitch('order_notional', scope);
      continue;
    }
    const sizeCheck = checkBounded('order_size', scope, order.quantity, record.maxOrderSize);
    if (!sizeCheck.ok) return sizeCheck;
    const notionalCheck = checkBounded('order_notional', scope, order.notional, record.maxOrderNotional);
    if (!notionalCheck.ok) return notionalCheck;
  }

  // --- The class kinds: position measures --------------------------------------
  for (const position of exposure.positions) {
    const scope: LimitScope = deepFreeze({ kind: 'instrument', venue: position.venue, instrument: position.instrument, instrumentClass: position.assetClass });
    const coherentNotional = decIsEqual(position.notional, decMultiply(position.quantity, position.referencePrice));
    if (!coherentNotional) {
      return {
        ok: false,
        errors: [{
          code: 'limit_unevaluable',
          path: `exposure.positions[${position.venue}|${position.instrument}]`,
          message: `the position measure for (${position.venue}, ${position.instrument}) is arithmetically incoherent (notional != quantity x referencePrice) — the evaluator never reasons over corrupted measures (kind position_notional/position_size)`,
        }],
      };
    }
    const record = classRecordOf(policy, position.assetClass);
    if (record === undefined) {
      emit('position_size', scope, 'blocked', { cause: 'no_declared_limit', instrumentClass: position.assetClass });
      emit('position_notional', scope, 'blocked', { cause: 'no_declared_limit', instrumentClass: position.assetClass });
      continue;
    }
    if (switchState === 'thrown') {
      blockedBySwitch('position_size', scope);
      blockedBySwitch('position_notional', scope);
      continue;
    }
    const sizeCheck = checkBounded('position_size', scope, position.quantity, record.maxPositionSize);
    if (!sizeCheck.ok) return sizeCheck;
    const notionalCheck = checkBounded('position_notional', scope, position.notional, record.maxPositionNotional);
    if (!notionalCheck.ok) return notionalCheck;
  }

  // --- Concentration (per held instrument, exactly cross-multiplied) -------------
  if (policy.concentration !== null) {
    const gross = exposure.grossNotional;
    for (const position of exposure.positions) {
      const scope: LimitScope = deepFreeze({ kind: 'instrument', venue: position.venue, instrument: position.instrument, instrumentClass: position.assetClass });
      // The aggregate coherence precondition.
      if (decCompare(position.notional, gross) > 0) {
        return {
          ok: false,
          errors: [{
            code: 'limit_unevaluable',
            path: `exposure.positions[${position.venue}|${position.instrument}]`,
            message: `the instrument notional (${position.notional}) exceeds the gross (${gross}) — an incoherent aggregate cannot yield a concentration ratio (kind concentration)`,
          }],
        };
      }
      if (switchState === 'thrown') {
        blockedBySwitch('concentration', scope);
        continue;
      }
      if (decCompare(gross, '0') === 0) {
        // Nothing held: no concentration exists (vacuously within — the
        // measure is over what exists).
        emit('concentration', scope, 'within', null);
        continue;
      }
      // The EXACT comparison: notional/gross <= max iff notional <= max x gross
      // (cross-multiplication — never a rounded division decides a state).
      const boundProduct = decMultiply(policy.concentration.maxConcentrationRatio, gross);
      if (decCompare(position.notional, boundProduct) <= 0) {
        emit('concentration', scope, 'within', null);
      } else {
        // The REPORTED values: the observed ratio at the declared precision
        // (the comparison above was exact; these are the display forms).
        const observed = divideRoundHalfUp(position.notional, gross, policy.concentration.ratioPrecision);
        const bound = policy.concentration.maxConcentrationRatio;
        const excess = decCompare(observed, bound) >= 0 ? decSubtract(observed, bound) : '0';
        emit('concentration', scope, 'breaching', { cause: 'breach', bound: decNormalize(bound), observed, excess });
      }
    }
  }

  // --- Drawdown -------------------------------------------------------------------
  if (policy.drawdown !== null) {
    const scope: LimitScope = deepFreeze({ kind: 'portfolio' });
    // The high-water-mark coherence preconditions.
    if (signedCompare(exposure.peakEquity, exposure.equity) < 0 || !decIsEqual(exposure.drawdown, signedSubtract(exposure.peakEquity, exposure.equity))) {
      return {
        ok: false,
        errors: [{
          code: 'limit_unevaluable',
          path: 'exposure.drawdown',
          message: `the high-water mark is incoherent (peak ${exposure.peakEquity}, equity ${exposure.equity}, drawdown ${exposure.drawdown}) — the evaluator never reasons over corrupted measures (kind drawdown)`,
        }],
      };
    }
    if (switchState === 'thrown') {
      blockedBySwitch('drawdown', scope);
    } else {
      const check = checkBounded('drawdown', scope, exposure.drawdown, policy.drawdown.maxDrawdown);
      if (!check.ok) return check;
    }
  }

  // --- Leverage ---------------------------------------------------------------------
  if (policy.leverage !== null) {
    const scope: LimitScope = deepFreeze({ kind: 'portfolio' });
    // Equity coherence: equity == cash + grossNotional (SIGNED — margin
    // books carry negative cash; the unsigned `add` cannot fold it).
    if (signedCompare(exposure.equity, signedAdd(exposure.cash, exposure.grossNotional)) !== 0) {
      return {
        ok: false,
        errors: [{
          code: 'limit_unevaluable',
          path: 'exposure.equity',
          message: `equity (${exposure.equity}) != cash + grossNotional (${decAdd(exposure.cash, exposure.grossNotional)}) — the evaluator never reasons over corrupted measures (kind leverage)`,
        }],
      };
    }
    if (signedCompare(exposure.equity, '0') <= 0) {
      return {
        ok: false,
        errors: [{
          code: 'limit_unevaluable',
          path: 'exposure.equity',
          message: `leverage is undefined over non-positive equity (${exposure.equity}) — an undefined ratio is a typed error, never a silent pass (kind leverage)`,
        }],
      };
    }
    if (switchState === 'thrown') {
      blockedBySwitch('leverage', scope);
    } else {
      // The EXACT comparison: gross/equity <= max iff gross <= max x equity.
      const boundProduct = decMultiply(policy.leverage.maxLeverageRatio, exposure.equity);
      if (decCompare(exposure.grossNotional, boundProduct) <= 0) {
        emit('leverage', scope, 'within', null);
      } else {
        const observed = divideRoundHalfUp(exposure.grossNotional, exposure.equity, policy.leverage.ratioPrecision);
        const bound = policy.leverage.maxLeverageRatio;
        const excess = decCompare(observed, bound) >= 0 ? decSubtract(observed, bound) : '0';
        emit('leverage', scope, 'breaching', { cause: 'breach', bound: decNormalize(bound), observed, excess });
      }
    }
  }

  const payload: Omit<LimitEvaluationRecord, 'evaluationId'> = {
    policy: { policyId: policy.policyId, version: policy.version },
    exposureRef: exposure.exposureId,
    killSwitchState: switchState,
    states,
    lineage: deepFreeze({
      policy: { policyId: policy.policyId, version: policy.version },
      constraintSet: { id: policy.constraintSet.id, version: policy.constraintSet.version },
      goal: { goalId: policy.goal.goalId, version: policy.goal.version },
      portfolioState: exposure.lineage.portfolioState,
      marketState: exposure.lineage.marketState,
      seed: exposure.lineage.seed,
      tenant: policy.tenant,
      project: policy.project,
    }),
    asOf: exposure.asOf,
  };
  return ok(deepFreeze({ ...payload, evaluationId: mintLimitEvaluationId(stableDigest(evaluationContentTree(payload))) }));
}

// ---------------------------------------------------------------------------
// The T019 bridge (the execution-policy limit-check mirror)
// ---------------------------------------------------------------------------

/** The execution-policy limits-refusal mirror: T019's `RefusalReason` 'limits' variant shape. */
export interface ExecutionLimitRefusal {
  readonly dimension: 'limits';
  readonly limit: ClassLimitKind;
  readonly instrumentClass: string;
  readonly cap: string;
  readonly observed: string;
  readonly excess: string;
}

/**
 * The states the T019 gate consumes: every BREACHING class-kind limit
 * state, converted into the execution-policy limits-refusal mirror —
 * the same record T019's CheckMachine would emit for the breach
 * (`{ dimension: 'limits', limit, instrumentClass, cap, observed,
 * excess }`, all canonical decimal strings). The interop test proves
 * these records satisfy the REAL execution-policy `isRefusalReason`
 * guard — this lane FEEDS the gate; it never IS the gate (L8).
 */
export function executionLimitRefusals(evaluation: LimitEvaluationRecord): readonly ExecutionLimitRefusal[] {
  const refusals: ExecutionLimitRefusal[] = [];
  for (const state of evaluation.states) {
    if (state.state !== 'breaching') continue;
    if (state.reason === null || state.reason.cause !== 'breach') continue;
    if (state.scope.kind !== 'instrument') continue;
    if (state.kind !== 'order_size' && state.kind !== 'order_notional' && state.kind !== 'position_size' && state.kind !== 'position_notional') continue;
    refusals.push(deepFreeze({
      dimension: 'limits',
      limit: state.kind,
      instrumentClass: state.scope.instrumentClass,
      cap: state.reason.bound,
      observed: state.reason.observed,
      excess: state.reason.excess,
    }));
  }
  return refusals;
}

/** The human-audit summary of an evaluation (deterministic — audit-side convenience, never interpreted). */
export function describeEvaluation(evaluation: LimitEvaluationRecord): string {
  const within = evaluation.states.filter((state) => state.state === 'within').length;
  const breaching = evaluation.states.filter((state) => state.state === 'breaching').length;
  const blocked = evaluation.states.filter((state) => state.state === 'blocked').length;
  return `${evaluation.evaluationId} switch=${evaluation.killSwitchState} within=${within} breaching=${breaching} blocked=${blocked}`;
}
