// @tradrl/example-e2e-trading — STAGE 1: THE GOAL/CONSTRAINT COMPILER.
//
// User -> Goal/Constraint Compiler (ARCHITECTURE.md core flow). The
// scenario's goal statement and constraint set are validated, and the
// risk constraints are COMPILED into the risk policy (T020's
// compileRiskPolicy law: only blocking `limit.max` predicates over
// `risk.*` subjects compile; everything else is a typed
// `risk_constraint_uncompilable`). The execution policy (T019) is
// content-addressed from the scenario declarations. L7 trip-wire: no
// acceptance threshold is embedded anywhere in the policies.

import {
  deepFreeze, isNonEmptyString, isRecord, isUnitInterval, stableDigest8Json,
  type JsonValue,
} from './primitives';
import { isCanonicalDecimal, isUnsignedDecimal } from './decimals';
import { fail, ok, type ExampleResult, type ExampleError } from './errors';
import type {
  ConstraintSetStatementMirror, GoalStatementMirror,
} from './mirrors/control';
import type {
  ClassLimitRecordMirror, RiskPolicyMirror,
} from './mirrors/risk';
import type {
  ExecutionPolicyMirror, PreTradeCheckKindMirror,
} from './mirrors/execution';
import type { TradingScenario } from './scenario';

// ---------------------------------------------------------------------------
// Structural validation of the goal + constraint set
// ---------------------------------------------------------------------------

export function validateGoalStatement(goal: unknown): ExampleResult<GoalStatementMirror> {
  if (!isRecord(goal)) return fail('invalid_type', 'goal must be an object', 'goal');
  const g = goal as unknown as GoalStatementMirror;
  const errors: ExampleError[] = [];
  if (!isNonEmptyString(g.id)) errors.push({ code: 'missing_field', path: 'goal.id', message: 'goal id required' });
  if (!Number.isInteger(g.version) || g.version < 1) errors.push({ code: 'invalid_field', path: 'goal.version', message: 'version must be an integer >= 1' });
  if (!isNonEmptyString(g.tenantId)) errors.push({ code: 'tenant_missing', path: 'goal.tenantId', message: 'goal is tenant-scoped (L12)' });
  if (!isNonEmptyString(g.objective)) errors.push({ code: 'missing_field', path: 'goal.objective', message: 'objective statement required' });
  if (!isRecord(g.horizon) || typeof g.horizon.startsAt !== 'number' || typeof g.horizon.endsAt !== 'number' || g.horizon.startsAt >= g.horizon.endsAt) {
    errors.push({ code: 'invalid_field', path: 'goal.horizon', message: 'horizon must be a non-empty [startsAt, endsAt) window' });
  }
  if (!isRecord(g.successCriteria) || !Array.isArray(g.successCriteria.criteria) || g.successCriteria.criteria.length === 0) {
    errors.push({ code: 'invalid_field', path: 'goal.successCriteria', message: 'at least one success criterion required' });
  } else if (!isUnitInterval(g.successCriteria.requiredSatisfaction)) {
    errors.push({ code: 'invalid_field', path: 'goal.successCriteria.requiredSatisfaction', message: 'requiredSatisfaction must be in [0, 1]' });
  }
  if (!isRecord(g.evaluation) || !isNonEmptyString(g.evaluation.blindRef) || !isNonEmptyString(g.evaluation.walkForwardRef) || !isNonEmptyString(g.evaluation.regimeRef)) {
    errors.push({ code: 'invalid_field', path: 'goal.evaluation', message: 'evaluation policy refs required (blind/walk-forward/regime)' });
  }
  if (typeof g.createdAt !== 'number') errors.push({ code: 'invalid_field', path: 'goal.createdAt', message: 'createdAt instant required' });
  if (errors.length > 0) return { ok: false, errors };
  return ok(deepFreeze(g));
}

export function validateConstraintSet(set: unknown): ExampleResult<ConstraintSetStatementMirror> {
  if (!isRecord(set)) return fail('invalid_type', 'constraint set must be an object', 'constraintSet');
  const s = set as unknown as ConstraintSetStatementMirror;
  const errors: ExampleError[] = [];
  if (!isNonEmptyString(s.id)) errors.push({ code: 'missing_field', path: 'constraintSet.id', message: 'constraint set id required' });
  if (!Number.isInteger(s.version) || s.version < 1) errors.push({ code: 'invalid_field', path: 'constraintSet.version', message: 'version must be an integer >= 1' });
  if (!isNonEmptyString(s.tenantId)) errors.push({ code: 'tenant_missing', path: 'constraintSet.tenantId', message: 'constraint set is tenant-scoped (L12)' });
  if (!Array.isArray(s.constraints)) errors.push({ code: 'invalid_field', path: 'constraintSet.constraints', message: 'constraints array required' });
  else {
    const seen = new Set<string>();
    for (const constraint of s.constraints) {
      if (!isNonEmptyString(constraint.id) || seen.has(constraint.id)) {
        errors.push({ code: 'invalid_field', path: 'constraintSet.constraints', message: `constraint ids must be unique non-empty (duplicate/empty at "${constraint.id}")` });
      }
      seen.add(constraint.id);
      if (!['observation', 'state', 'action', 'outcome'].includes(constraint.domain)) {
        errors.push({ code: 'invalid_field', path: `constraintSet.constraints[${constraint.id}].domain`, message: `unknown domain "${constraint.domain}"` });
      }
      if (!['advisory', 'blocking'].includes(constraint.severity)) {
        errors.push({ code: 'invalid_field', path: `constraintSet.constraints[${constraint.id}].severity`, message: `unknown severity "${constraint.severity}"` });
      }
      if (!isNonEmptyString(constraint.subject)) {
        errors.push({ code: 'missing_field', path: `constraintSet.constraints[${constraint.id}].subject`, message: 'subject identifier path required' });
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return ok(deepFreeze(s));
}

// ---------------------------------------------------------------------------
// Risk policy compilation (T020 compileRiskPolicy law)
// ---------------------------------------------------------------------------

const CLASS_LIMIT_KINDS = ['order_size', 'order_notional', 'position_size', 'position_notional'] as const;
type ClassLimitKind = (typeof CLASS_LIMIT_KINDS)[number];

function classLimitOf(
  compiled: Map<string, Map<string, { bound: string }>>,
  instrumentClass: string,
): ClassLimitRecordMirror | null {
  const caps: Partial<Record<ClassLimitKind, string>> = {};
  for (const kind of CLASS_LIMIT_KINDS) {
    const named = compiled.get(`risk.${kind}.${instrumentClass}`)?.get('limit.max');
    const wildcard = compiled.get(`risk.${kind}`)?.get('limit.max');
    const bound = named ?? wildcard;
    if (!bound) return null;
    caps[kind] = bound.bound;
  }
  return {
    instrumentClass,
    maxOrderSize: caps.order_size!,
    maxOrderNotional: caps.order_notional!,
    maxPositionSize: caps.position_size!,
    maxPositionNotional: caps.position_notional!,
  };
}

/**
 * Compiles the risk policy from the constraint set's `risk.*` constraints
 * (mirror of T020 `compileRiskPolicy`): only BLOCKING `limit.max`
 * predicates compile; a class record needs all four caps; zero caps are
 * inexpressible. Returns the content-addressed `rpol:` policy.
 */
export function compileRiskPolicy(input: {
  readonly scenario: TradingScenario;
  readonly asOf: number;
}): ExampleResult<RiskPolicyMirror> {
  const { scenario } = input;
  const goalValidation = validateGoalStatement(scenario.goal);
  if (!goalValidation.ok) return goalValidation;
  const constraintValidation = validateConstraintSet(scenario.constraintSet);
  if (!constraintValidation.ok) return constraintValidation;
  const goal = goalValidation.value;
  const constraints = constraintValidation.value;
  if (goal.tenantId !== constraints.tenantId || goal.tenantId !== scenario.tenant) {
    return fail('tenant_mismatch', 'goal, constraint set and scenario must share ONE tenant (L12)', 'tenant');
  }

  // Collect risk.* limit.max bindings.
  const compiled = new Map<string, Map<string, { bound: string }>>();
  const compiledFrom: string[] = [];
  for (const constraint of constraints.constraints) {
    if (!constraint.subject.startsWith('risk.')) continue; // non-risk subjects are not risk policy (L16)
    if (constraint.severity !== 'blocking') {
      return fail('invalid_field', `risk constraint ${constraint.id} must be blocking to compile (advisory risk is not a policy)`, `constraints[${constraint.id}]`);
    }
    if (constraint.predicate.kind !== 'limit.max') {
      return fail('invalid_field', `risk constraint ${constraint.id} must be a limit.max predicate (risk_constraint_uncompilable)`, `constraints[${constraint.id}].predicate`);
    }
    if (typeof constraint.predicate.bound !== 'number' || !Number.isFinite(constraint.predicate.bound) || constraint.predicate.bound <= 0) {
      return fail('invalid_field', `risk constraint ${constraint.id} bound must be a positive finite number`, `constraints[${constraint.id}].predicate.bound`);
    }
    const bound = canonicalDecimalOfFiniteNumber(constraint.predicate.bound);
    const lane = compiled.get(constraint.subject) ?? new Map<string, { bound: string }>();
    lane.set('limit.max', { bound });
    compiled.set(constraint.subject, lane);
    compiledFrom.push(constraint.id);
  }

  // Class records: the catch-all '*' plus every named class.
  const classes = new Set<string>(['*']);
  for (const subject of compiled.keys()) {
    const parts = subject.split('.');
    if (parts.length === 3 && parts[0] === 'risk') classes.add(parts[2]!);
  }
  const classLimits: ClassLimitRecordMirror[] = [];
  for (const instrumentClass of [...classes].sort()) {
    const record = classLimitOf(compiled, instrumentClass);
    if (!record) {
      return fail('invalid_field', `class "${instrumentClass}" needs all four caps (order_size, order_notional, position_size, position_notional) — risk_constraint_uncompilable`, 'classLimits');
    }
    classLimits.push(record);
  }

  const concentration = compiled.get('risk.concentration')?.get('limit.max');
  const drawdown = compiled.get('risk.drawdown')?.get('limit.max');
  const leverage = compiled.get('risk.leverage')?.get('limit.max');

  const content = {
    version: 1,
    supersedes: null,
    tenant: scenario.tenant,
    project: scenario.project,
    goal: { goalId: goal.id, version: goal.version },
    constraintSet: { id: constraints.id, version: constraints.version },
    classLimits,
    concentration: concentration ? { maxConcentrationRatio: concentration.bound, ratioPrecision: 8 } : null,
    drawdown: drawdown ? { maxDrawdown: drawdown.bound } : null,
    leverage: leverage ? { maxLeverageRatio: leverage.bound, ratioPrecision: 8 } : null,
    compiledFrom: [...compiledFrom].sort(),
    asOf: input.asOf,
  };
  const policy: RiskPolicyMirror = deepFreeze({
    ...content,
    policyId: `rpol:${stableDigest8Json(content as unknown as JsonValue)}`,
  });
  return ok(policy);
}

/** Shortest round-trip canonical decimal of a finite number (the T020 bridge). */
export function canonicalDecimalOfFiniteNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error('canonicalDecimalOfFiniteNumber: non-finite number');
  if (Number.isInteger(value)) return String(value); // integers are canonical
  const expanded = value.toFixed(18).replace(/0+$/, '').replace(/\.$/, '');
  return isCanonicalDecimal(expanded) ? expanded : String(value);
}

// ---------------------------------------------------------------------------
// Execution policy compilation (T019 shape, content-addressed)
// ---------------------------------------------------------------------------

/** Compiles the execution policy from the scenario declarations + the
 * compiled risk class limits (the T019 gate's stage-4 limit records). */
export function compileExecutionPolicy(input: {
  readonly scenario: TradingScenario;
  readonly killSwitchId: string;
  readonly riskPolicyRef: string;
  readonly riskClassLimits: readonly ClassLimitRecordMirror[];
  readonly asOf: number;
}): ExampleResult<ExecutionPolicyMirror> {
  const { scenario } = input;
  const declarations = scenario.policies.execution;
  const checkOrder: readonly PreTradeCheckKindMirror[] = [
    'kill_switch', 'identity', 'authorization', 'limits',
    'venue_permissions', 'rate_limits', 'credentials',
  ];
  const content = {
    version: 1,
    tenant: scenario.tenant,
    project: scenario.project,
    identity: { principals: [declarations.principal] },
    authorization: [{ scopeRef: declarations.grantScopeRef, orderKinds: [...declarations.orderKinds] }],
    limits: input.riskClassLimits.map((record) => ({ ...record })),
    venuePermissions: scenario.universe.map((entry) => ({
      venue: entry.venue,
      instrument: entry.instrument,
      instrumentClass: entry.assetClass,
    })),
    rateLimits: scenario.universe.map((entry) => ({
      venue: entry.venue,
      windowMs: declarations.rateBudget.windowMs,
      maxOrders: declarations.rateBudget.maxOrders,
    })),
    credentials: [...new Set(scenario.universe.map((entry) => entry.venue))].map((venue) => ({
      venue,
      credentialRef: declarations.credentialRef,
    })),
    killSwitch: { switchId: input.killSwitchId },
    audit: { emission: 'every_decision' as const },
    checkOrder,
    learning: null,
    asOf: input.asOf,
  };
  const policy: ExecutionPolicyMirror = deepFreeze({
    ...content,
    policyId: `xpol:${stableDigest8Json(content as unknown as JsonValue)}`,
  });
  void input.riskPolicyRef;
  return ok(policy);
}

export function riskPolicyRefOf(policy: RiskPolicyMirror): string {
  return `risk-policy:${policy.policyId}@${policy.version}`;
}
