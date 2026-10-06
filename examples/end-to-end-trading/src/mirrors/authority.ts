// @tradrl/example-e2e-trading — STRUCTURAL MIRRORS of @tradrl/risk's limit
// evaluation (T020), @tradrl/execution-policy's seven-check gate machine
// (T019), @tradrl/execution-authority's decision/order-request/grant
// contracts (T040) and services/execution-gateway's submission/audit
// records (T040).
//
// D-003/D-004 law: this module imports NOTHING outside the example tree.
// The gate machine below runs the REAL declared law (kill_switch first,
// identity, authorization, limits, venue_permissions, rate_limits,
// credentials — in the policy's declared order, first failure wins) and the
// L8 existential law: an order request without a VALID APPROVED decision is
// the typed `decision_not_approved` error — the model NEVER bypasses.

import {
  canonicalJson,
  deepFreeze,
  fnv1a32Hex,
  isNonEmptyString,
  isPositiveInteger,
  isRecord,
  isTimestampMs,
} from '../primitives';
import { compareDecimal, decimalMultiply, decimalSubtract, decimalSum } from '../decimals';
import { mintApproveDecisionId, mintRefusalDecisionId } from '../ids';

// The 8-hex content digest used by gateway ids.
export function contentDigest8(content: unknown): string {
  return fnv1a32Hex(canonicalJson(content as Parameters<typeof canonicalJson>[0]));
}

// ---------------------------------------------------------------------------
// The seven pre-trade check kinds (T019 mirror — kill_switch first)
// ---------------------------------------------------------------------------

export const PRE_TRADE_CHECK_KINDS_MIRROR = [
  'kill_switch',
  'identity',
  'authorization',
  'limits',
  'venue_permissions',
  'rate_limits',
  'credentials',
] as const;
export type PreTradeCheckKindMirror = (typeof PRE_TRADE_CHECK_KINDS_MIRROR)[number];

export const DEFAULT_CHECK_ORDER_MIRROR: readonly PreTradeCheckKindMirror[] = [
  ...PRE_TRADE_CHECK_KINDS_MIRROR,
];

export type LimitKindMirror =
  | 'order_size'
  | 'order_notional'
  | 'position_size'
  | 'position_notional'
  | 'concentration'
  | 'drawdown'
  | 'leverage';

export type LimitStateValueMirror = 'within' | 'breaching' | 'blocked';

export interface LimitStateMirror {
  readonly kind: LimitKindMirror;
  readonly scope:
    | {
        readonly kind: 'instrument';
        readonly venue: string;
        readonly instrument: string;
        readonly instrumentClass: string;
      }
    | { readonly kind: 'portfolio' };
  readonly state: LimitStateValueMirror;
  readonly reason: unknown;
}

// ---------------------------------------------------------------------------
// The risk policy + limit evaluation (T020 mirror)
// ---------------------------------------------------------------------------

export interface ClassLimitRecordMirror {
  readonly instrumentClass: string;
  readonly maxOrderSize: string;
  readonly maxOrderNotional: string;
  readonly maxPositionSize: string;
  readonly maxPositionNotional: string;
}

export interface RiskPolicyMirror {
  readonly policyId: string; // 'rpol:'
  readonly version: number;
  readonly tenant: string;
  readonly project: string;
  readonly goal: { readonly goalId: string; readonly version: number };
  readonly constraintSet: { readonly id: string; readonly version: number };
  readonly classLimits: readonly ClassLimitRecordMirror[];
  readonly compiledFrom: readonly string[];
  readonly asOf: number;
}

export interface LimitEvaluationRecordMirror {
  readonly evaluationId: string; // 'rls:' + 8-hex
  readonly policy: { readonly policyId: string; readonly version: number };
  readonly exposureRef: string;
  readonly killSwitchState: 'standing' | 'thrown';
  readonly states: readonly LimitStateMirror[];
  readonly lineage: {
    readonly intentRef: string;
    readonly tenant: string;
    readonly project: string;
    readonly goal: { readonly goalId: string; readonly version: number };
  };
  readonly asOf: number;
}

export interface ExecutionLimitRefusalMirror {
  readonly dimension: 'limits';
  readonly limit: 'order_size' | 'order_notional' | 'position_size' | 'position_notional';
  readonly instrumentClass: string;
  readonly cap: string;
  readonly observed: string;
  readonly excess: string;
}

/** Evaluates order/position limits against the risk policy (exact decimals). */
export function evaluateLimitsMirror(input: {
  readonly policy: RiskPolicyMirror;
  readonly killSwitchState: 'standing' | 'thrown';
  readonly order: { readonly instrumentClass: string; readonly quantity: string; readonly price: string; readonly side: 'buy' | 'sell' };
  readonly positionQuantity: string;
  readonly intentRef: string;
  readonly goal: { readonly goalId: string; readonly version: number };
  readonly tenant: string;
  readonly project: string;
  readonly asOf: number;
  readonly digest: string;
}): LimitEvaluationRecordMirror {
  const classLimit =
    input.policy.classLimits.find((limit) => limit.instrumentClass === input.order.instrumentClass) ??
    input.policy.classLimits.find((limit) => limit.instrumentClass === '*');
  const states: LimitStateMirror[] = [];
  const refusals: ExecutionLimitRefusalMirror[] = [];
  if (classLimit !== undefined) {
    const notional = decimalMultiply(input.order.quantity, input.order.price, 8, 'half-even');
    const positionAfter =
      input.order.side === 'buy'
        ? decimalSum([input.positionQuantity, input.order.quantity], 8, 'half-even')
        : decimalSubtract(input.positionQuantity, input.order.quantity, 8, 'half-even');
    const positionNotionalAfter = decimalMultiply(positionAfter, input.order.price, 8, 'half-even');
    const check = (
      kind: LimitKindMirror,
      cap: string,
      observed: string,
    ): void => {
      const state: LimitStateValueMirror = compareDecimal(observed, cap) > 0 ? 'blocked' : 'within';
      states.push({
        kind,
        scope: {
          kind: 'instrument',
          venue: 'REFSIM',
          instrument: input.intentRef,
          instrumentClass: input.order.instrumentClass,
        },
        state,
        reason: state === 'blocked' ? { cause: 'breach', bound: cap, observed, excess: decimalSubtract(observed, cap, 8, 'half-even') } : null,
      });
      if (state === 'blocked') {
        refusals.push({
          dimension: 'limits',
          limit: kind as ExecutionLimitRefusalMirror['limit'],
          instrumentClass: input.order.instrumentClass,
          cap,
          observed,
          excess: decimalSubtract(observed, cap, 8, 'half-even'),
        });
      }
    };
    check('order_size', classLimit.maxOrderSize, input.order.quantity);
    check('order_notional', classLimit.maxOrderNotional, notional);
    check('position_size', classLimit.maxPositionSize, positionAfter);
    check('position_notional', classLimit.maxPositionNotional, positionNotionalAfter);
  }
  const content = {
    policy: { policyId: input.policy.policyId, version: input.policy.version },
    exposureRef: `exp:${input.digest}`,
    killSwitchState: input.killSwitchState,
    states,
    lineage: {
      intentRef: input.intentRef,
      tenant: input.tenant,
      project: input.project,
      goal: input.goal,
    },
    asOf: input.asOf,
  };
  return deepFreeze({
    evaluationId: `rls:${input.digest}`,
    ...content,
  });
}
/** Extracts the execution limit refusals of an evaluation. */
export function executionLimitRefusalsOf(evaluation: LimitEvaluationRecordMirror): readonly ExecutionLimitRefusalMirror[] {
  const refusals: ExecutionLimitRefusalMirror[] = [];
  for (const state of evaluation.states) {
    if (state.state === 'blocked' && isRecord(state.reason)) {
      const reason = state.reason as { cause?: string; bound?: string; observed?: string };
      if (reason.cause === 'breach' && typeof reason.bound === 'string' && typeof reason.observed === 'string') {
        refusals.push({
          dimension: 'limits',
          limit: state.kind as ExecutionLimitRefusalMirror['limit'],
          instrumentClass: isRecord(state.scope) && 'instrumentClass' in state.scope ? String(state.scope.instrumentClass) : '*',
          cap: reason.bound,
          observed: reason.observed,
          excess: decimalSubtract(reason.observed, reason.bound, 8, 'half-even'),
        });
      }
    }
  }
  return deepFreeze(refusals);
}

// ---------------------------------------------------------------------------
// The execution policy + gate machine (T019 mirror)
// ---------------------------------------------------------------------------

export interface LimitRecordMirror {
  readonly instrumentClass: string;
  readonly maxOrderSize: string;
  readonly maxOrderNotional: string;
  readonly maxPositionSize: string;
  readonly maxPositionNotional: string;
}

export interface VenuePermissionMirror {
  readonly venue: string;
  readonly instrument: string;
  readonly instrumentClass: string;
}

export interface RateBudgetMirror {
  readonly venue: string;
  readonly windowMs: number;
  readonly maxOrders: number;
}

export interface CredentialBindingMirror {
  readonly venue: string;
  readonly credentialRef: string;
}

export interface AuthorityGrantMirror {
  readonly scopeRef: string; // 'grant:'-prefixed
  readonly orderKinds: readonly string[];
}

export interface ExecutionPolicyMirror {
  readonly policyId: string; // 'xpol:'
  readonly version: number;
  readonly tenant: string;
  readonly project: string;
  readonly identity: { readonly principals: readonly string[] };
  readonly authorization: readonly AuthorityGrantMirror[];
  readonly limits: readonly LimitRecordMirror[];
  readonly venuePermissions: readonly VenuePermissionMirror[];
  readonly rateLimits: readonly RateBudgetMirror[];
  readonly credentials: readonly CredentialBindingMirror[];
  readonly killSwitch: { readonly switchId: string };
  readonly audit: { readonly emission: 'every_decision' };
  readonly checkOrder: readonly PreTradeCheckKindMirror[];
  readonly asOf: number;
}

export type RefusalReasonMirror =
  | { readonly dimension: 'kill_switch'; readonly switchId: string; readonly thrownAt: number; readonly reason: string }
  | { readonly dimension: 'identity'; readonly subject: 'tenant' | 'project' | 'principal'; readonly expected: string; readonly actual: string }
  | { readonly dimension: 'authorization'; readonly orderKind: string; readonly permittedKinds: readonly string[] }
  | { readonly dimension: 'limits'; readonly limit: string; readonly instrumentClass: string; readonly cap: string; readonly observed: string; readonly excess: string }
  | { readonly dimension: 'venue_permissions'; readonly venue: string; readonly instrument: string }
  | { readonly dimension: 'rate_limits'; readonly venue: string; readonly windowMs: number | null; readonly budget: number; readonly observed: number }
  | { readonly dimension: 'credentials'; readonly venue: string };

export interface CheckResultMirror {
  readonly dimension: PreTradeCheckKindMirror;
  readonly ordinal: number;
  readonly outcome: 'pass' | 'fail';
}

export interface CheckFailureMirror {
  readonly dimension: PreTradeCheckKindMirror;
  readonly ordinal: number;
  readonly reason: RefusalReasonMirror;
}

export interface ExecutionLineageMirror {
  readonly intentRef: string;
  readonly strategy: { readonly specId: string; readonly version: number };
  readonly goal: { readonly goalId: string; readonly version: number };
  readonly policy: { readonly policyId: string; readonly version: number };
  readonly venues: readonly string[];
  readonly seed: string;
  readonly tenant: string;
  readonly project: string;
}

export interface ApproveDecisionMirror {
  readonly kind: 'approve';
  readonly decisionId: string; // 'xd:' + 8-hex
  readonly intentRef: string;
  readonly policy: { readonly policyId: string; readonly version: number };
  readonly checkOrder: readonly string[];
  readonly checks: readonly CheckResultMirror[];
  readonly lineage: ExecutionLineageMirror;
  readonly asOf: number;
}

export interface RefusalDecisionMirror {
  readonly kind: 'refuse';
  readonly decisionId: string;
  readonly intentRef: string;
  readonly policy: { readonly policyId: string; readonly version: number };
  readonly checkOrder: readonly string[];
  readonly checks: readonly CheckResultMirror[];
  readonly failure: CheckFailureMirror;
  readonly lineage: ExecutionLineageMirror;
  readonly asOf: number;
}

export type ExecutionDecisionMirror = ApproveDecisionMirror | RefusalDecisionMirror;

export interface KillSwitchStandingStateMirror {
  readonly state: 'standing' | 'thrown';
  readonly switchId: string | null;
  readonly thrownAt: number | null;
  readonly reason: string | null;
}

/** The gate input (the T019 mirror bundle). */
export interface ExecutionGateInputMirror {
  readonly intent: {
    readonly intentId: string;
    readonly tenant: string;
    readonly project: string;
    readonly order: {
      readonly instrumentId: string;
      readonly venueId: string;
      readonly side: 'buy' | 'sell';
      readonly kind: string;
      readonly quantity: string;
      readonly price?: string;
    };
    readonly strategy: { readonly specId: string; readonly version: number };
    readonly goal: { readonly goalId: string; readonly version: number };
    readonly seed: string;
  };
  readonly policy: ExecutionPolicyMirror;
  readonly portfolio: { readonly positionOf: (instrumentId: string) => string; readonly equity: string };
  readonly venueState: {
    readonly asOf: number;
    readonly instruments: readonly {
      readonly venue: string;
      readonly instrument: string;
      readonly instrumentClass: string;
      readonly referencePrice: string;
      readonly rateWindowOrderCount: number;
    }[];
  };
  readonly killSwitch: KillSwitchStandingStateMirror;
  readonly digestOf: (seed: string) => string;
}

/**
 * The seven-check gate machine (mirror of T019's runExecutionGate): checks
 * run in the policy's DECLARED order, the first failure wins, and the
 * decision id is content-addressed (`xd:` + fnv over the canonical tree).
 * Pure: same inputs, byte-identical decision.
 */
export function runExecutionGateMirror(input: ExecutionGateInputMirror): ExecutionDecisionMirror {
  const { intent, policy } = input;
  const instrumentState = input.venueState.instruments.find(
    (state) => state.instrument === intent.order.instrumentId && state.venue === intent.order.venueId,
  );
  const referencePrice = instrumentState?.referencePrice ?? '0';
  const instrumentClass = instrumentState?.instrumentClass ?? 'crypto';
  const notional = decimalMultiply(intent.order.quantity, intent.order.price ?? referencePrice, 8, 'half-even');

  const checks: CheckResultMirror[] = [];
  let failure: CheckFailureMirror | null = null;
  const fail = (dimension: PreTradeCheckKindMirror, reason: RefusalReasonMirror): void => {
    if (failure !== null) return;
    failure = { dimension, ordinal: checks.length + 1, reason };
  };

  for (const dimension of policy.checkOrder) {
    const ordinal = checks.length + 1;
    if (failure !== null) {
      break;
    }
    switch (dimension) {
      case 'kill_switch':
        if (input.killSwitch.state === 'thrown') {
          fail('kill_switch', {
            dimension: 'kill_switch',
            switchId: input.killSwitch.switchId ?? policy.killSwitch.switchId,
            thrownAt: input.killSwitch.thrownAt ?? 0,
            reason: input.killSwitch.reason ?? 'thrown',
          });
        }
        break;
      case 'identity':
        if (intent.tenant !== policy.tenant) {
          fail('identity', { dimension: 'identity', subject: 'tenant', expected: policy.tenant, actual: intent.tenant });
        } else if (intent.project !== policy.project) {
          fail('identity', { dimension: 'identity', subject: 'project', expected: policy.project, actual: intent.project });
        } else if (!policy.identity.principals.includes(intent.strategy.specId)) {
          fail('identity', { dimension: 'identity', subject: 'principal', expected: policy.identity.principals.join('|'), actual: intent.strategy.specId });
        }
        break;
      case 'authorization': {
        const grant = policy.authorization.find((g) => g.orderKinds.includes(intent.order.kind));
        if (grant === undefined) {
          const all = policy.authorization.flatMap((g) => [...g.orderKinds]);
          fail('authorization', { dimension: 'authorization', orderKind: intent.order.kind, permittedKinds: all });
        }
        break;
      }
      case 'limits': {
        const limit =
          policy.limits.find((l) => l.instrumentClass === instrumentClass) ??
          policy.limits.find((l) => l.instrumentClass === '*');
        if (limit !== undefined) {
          const positionNow = input.portfolio.positionOf(intent.order.instrumentId);
          const positionAfter =
            intent.order.side === 'buy'
              ? decimalSum([positionNow, intent.order.quantity], 8, 'half-even')
              : decimalSubtract(positionNow, intent.order.quantity, 8, 'half-even');
          const positionNotionalAfter = decimalMultiply(positionAfter, referencePrice, 8, 'half-even');
          if (compareDecimal(intent.order.quantity, limit.maxOrderSize) > 0) {
            fail('limits', {
              dimension: 'limits',
              limit: 'order_size',
              instrumentClass,
              cap: limit.maxOrderSize,
              observed: intent.order.quantity,
              excess: decimalSubtract(intent.order.quantity, limit.maxOrderSize, 8, 'half-even'),
            });
          } else if (compareDecimal(notional, limit.maxOrderNotional) > 0) {
            fail('limits', {
              dimension: 'limits',
              limit: 'order_notional',
              instrumentClass,
              cap: limit.maxOrderNotional,
              observed: notional,
              excess: decimalSubtract(notional, limit.maxOrderNotional, 8, 'half-even'),
            });
          } else if (compareDecimal(positionAfter, limit.maxPositionSize) > 0) {
            fail('limits', {
              dimension: 'limits',
              limit: 'position_size',
              instrumentClass,
              cap: limit.maxPositionSize,
              observed: positionAfter,
              excess: decimalSubtract(positionAfter, limit.maxPositionSize, 8, 'half-even'),
            });
          } else if (compareDecimal(positionNotionalAfter, limit.maxPositionNotional) > 0) {
            fail('limits', {
              dimension: 'limits',
              limit: 'position_notional',
              instrumentClass,
              cap: limit.maxPositionNotional,
              observed: positionNotionalAfter,
              excess: decimalSubtract(positionNotionalAfter, limit.maxPositionNotional, 8, 'half-even'),
            });
          }
        }
        break;
      }
      case 'venue_permissions': {
        const permitted = policy.venuePermissions.some(
          (permission) => permission.venue === intent.order.venueId && permission.instrument === intent.order.instrumentId,
        );
        if (!permitted) {
          fail('venue_permissions', { dimension: 'venue_permissions', venue: intent.order.venueId, instrument: intent.order.instrumentId });
        }
        break;
      }
      case 'rate_limits': {
        const budget = policy.rateLimits.find((b) => b.venue === intent.order.venueId);
        const observed = instrumentState?.rateWindowOrderCount ?? 0;
        if (budget === undefined || observed + 1 > budget.maxOrders) {
          fail('rate_limits', {
            dimension: 'rate_limits',
            venue: intent.order.venueId,
            windowMs: budget?.windowMs ?? null,
            budget: budget?.maxOrders ?? 0,
            observed: observed + 1,
          });
        }
        break;
      }
      case 'credentials': {
        const binding = policy.credentials.find((c) => c.venue === intent.order.venueId);
        if (binding === undefined) {
          fail('credentials', { dimension: 'credentials', venue: intent.order.venueId });
        }
        break;
      }
    }
    const failed = failure !== null && (failure as CheckFailureMirror).dimension === dimension;
    checks.push({ dimension, ordinal, outcome: failed ? ('fail' as const) : ('pass' as const) });
  }

  const lineage: ExecutionLineageMirror = {
    intentRef: intent.intentId,
    strategy: intent.strategy,
    goal: intent.goal,
    policy: { policyId: policy.policyId, version: policy.version },
    venues: [intent.order.venueId],
    seed: intent.seed,
    tenant: intent.tenant,
    project: intent.project,
  };
  const common = {
    intentRef: intent.intentId,
    policy: { policyId: policy.policyId, version: policy.version },
    checkOrder: [...policy.checkOrder],
    checks,
    lineage,
    asOf: input.venueState.asOf,
  };
  if (failure !== null) {
    const content = { kind: 'refuse' as const, ...common, failure };
    return deepFreeze({
      ...content,
      decisionId: mintRefusalDecisionId(content as unknown as Parameters<typeof canonicalJson>[0]),
    });
  }
  return deepFreeze({ kind: 'approve', ...common, decisionId: mintApproveDecisionId(common) });
}

// ---------------------------------------------------------------------------
// The gateway translation contract (T040 mirror — the L8 chokepoint)
// ---------------------------------------------------------------------------

export type ExecutionAuthorityErrorCode =
  | 'invalid_type'
  | 'invalid_field'
  | 'missing_field'
  | 'credential_value_present'
  | 'decision_not_approved'
  | 'kill_switch_thrown'
  | 'audit_rewrite'
  | 'tenant_missing'
  | 'request_incoherent';

export interface ExecutionAuthorityError {
  readonly code: ExecutionAuthorityErrorCode;
  readonly message: string;
  readonly path?: string;
}

export type ExecutionAuthorityResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly ExecutionAuthorityError[] };

/** The credential-opacity trip wire (SECURITY.md's boundary, enforced in code). */
export const CREDENTIAL_VALUE_KEYS = [
  'secret',
  'apikey',
  'privatekey',
  'password',
  'passphrase',
  'token',
  'mnemonic',
  'seedphrase',
  'credential',
] as const;

/** Scans a JSON tree for credential MATERIAL under credential-shaped keys. */
export function credentialValueViolations(value: unknown, path = '$'): readonly string[] {
  const violations: string[] = [];
  const visit = (node: unknown, at: string): void => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${at}[${String(index)}]`));
      return;
    }
    if (isRecord(node)) {
      for (const [key, child] of Object.entries(node)) {
        const normalized = key.toLowerCase().replace(/[-_]/g, '');
        if ((CREDENTIAL_VALUE_KEYS as readonly string[]).some((k) => normalized === k || normalized.includes(k))) {
          if (typeof child === 'string' && child.length > 0 && !child.startsWith('cred:')) {
            violations.push(`${at}.${key}`);
          }
        }
        visit(child, `${at}.${key}`);
      }
    }
  };
  visit(value, path);
  return deepFreeze(violations);
}

/** The forgery law: an approve decision id must match its content. */
export function approveDecisionIdMatchesContentMirror(decision: ApproveDecisionMirror): boolean {
  const { decisionId: _id, ...content } = decision;
  return mintApproveDecisionId(content) === decision.decisionId;
}

/** The routed order request (mirror of T040's GatewayOrderRequest). */
export interface GatewayOrderRequestMirror {
  readonly requestRef: string; // 'gor:' + 8-hex
  readonly decision: ApproveDecisionMirror;
  readonly order: {
    readonly clientOrderId: string;
    readonly instrumentId: string;
    readonly venueId: string;
    readonly side: 'buy' | 'sell';
    readonly kind: string;
    readonly quantity: string;
    readonly price?: string;
    readonly timeInForce: string;
    readonly createdAt: string;
  };
  readonly route: { readonly venue: string; readonly adapterRef: string; readonly channelRef: string };
  readonly grantRef: string;
  readonly credentialRef: string;
  readonly killSwitchStanding: 'standing';
  readonly asOf: number;
}

/**
 * The translation contract (mirror of T040's `gatewayOrderRequest`):
 * opacity trip wire -> approve law (L8: a non-approve record, a refusal, or
 * a FORGED id is the typed `decision_not_approved`) -> order guard ->
 * kill-switch (fail-closed) -> coherence. THE MODEL NEVER BYPASSES.
 */
export function gatewayOrderRequestMirror(input: {
  readonly decision: unknown;
  readonly order: unknown;
  readonly route: { readonly venue: string; readonly adapterRef: string; readonly channelRef: string };
  readonly grantRef: string;
  readonly credentialRef: string;
  readonly killSwitch: KillSwitchStandingStateMirror;
  readonly asOf: number;
}): ExecutionAuthorityResult<GatewayOrderRequestMirror> {
  const errors: ExecutionAuthorityError[] = [];
  const opacity = [...credentialValueViolations(input.decision, 'decision'), ...credentialValueViolations(input.order, 'order')];
  if (opacity.length > 0) {
    errors.push({ code: 'credential_value_present', message: `credential material present at ${opacity.join(', ')}` });
  }
  const decision = input.decision;
  if (
    !isRecord(decision) ||
    decision.kind !== 'approve' ||
    !isNonEmptyString(decision.decisionId) ||
    !(decision.decisionId as string).startsWith('xd:') ||
    !approveDecisionIdMatchesContentMirror(decision as unknown as ApproveDecisionMirror)
  ) {
    errors.push({
      code: 'decision_not_approved',
      message: 'an order request requires a VALID APPROVED decision (xd: id matching its content) — L8: the model never bypasses the gate',
    });
  }
  const order = input.order;
  if (
    !isRecord(order) ||
    !isNonEmptyString(order.clientOrderId) ||
    !isNonEmptyString(order.instrumentId) ||
    !isNonEmptyString(order.venueId) ||
    (order.side !== 'buy' && order.side !== 'sell') ||
    !isNonEmptyString(order.kind) ||
    typeof order.quantity !== 'string'
  ) {
    errors.push({ code: 'invalid_field', message: 'the routed order form is malformed', path: 'order' });
  }
  if (errors.length === 0) {
    if (input.killSwitch.state === 'thrown') {
      errors.push({ code: 'kill_switch_thrown', message: 'a standing kill switch was thrown at request-build time (fail-closed)' });
    } else {
      const approve = decision as unknown as ApproveDecisionMirror;
      const orderRecord = order as unknown as GatewayOrderRequestMirror['order'];
      if (orderRecord.venueId !== input.route.venue || !approve.lineage.venues.includes(input.route.venue)) {
        errors.push({ code: 'request_incoherent', message: 'the order venue must match the route and the decision lineage' });
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors: deepFreeze(errors) };
  const approve = decision as unknown as ApproveDecisionMirror;
  const orderRecord = order as unknown as GatewayOrderRequestMirror['order'];
  const content = {
    decision: approve,
    order: orderRecord,
    route: input.route,
    grantRef: input.grantRef,
    credentialRef: input.credentialRef,
    killSwitchStanding: 'standing' as const,
    asOf: input.asOf,
  };
  const digestOf = (value: unknown): string => {
    const { requestRef: _ref, ...rest } = value as Record<string, unknown>;
    void _ref;
    return contentDigest8(rest);
  };
  return { ok: true, value: deepFreeze({ ...content, requestRef: `gor:${digestOf(content)}` }) };
}

/** Guard: an approve decision. */
export function isApproveDecisionMirror(v: unknown): v is ApproveDecisionMirror {
  return (
    isRecord(v) &&
    v.kind === 'approve' &&
    isNonEmptyString(v.decisionId) &&
    (v.decisionId as string).startsWith('xd:') &&
    isNonEmptyString(v.intentRef) &&
    (v.intentRef as string).startsWith('si:') &&
    isRecord(v.policy) &&
    isPositiveInteger(v.policy.version) &&
    Array.isArray(v.checkOrder) &&
    Array.isArray(v.checks) &&
    v.checks.every(
      (check) =>
        isRecord(check) &&
        (check as Record<string, unknown>).outcome === 'pass' &&
        isPositiveInteger((check as Record<string, unknown>).ordinal),
    ) &&
    isRecord(v.lineage) &&
    isTimestampMs(v.asOf)
  );
}

/** Guard: a refusal decision. */
export function isRefusalDecisionMirror(v: unknown): v is RefusalDecisionMirror {
  return (
    isRecord(v) &&
    v.kind === 'refuse' &&
    isNonEmptyString(v.decisionId) &&
    (v.decisionId as string).startsWith('xd:') &&
    isRecord(v.failure)
  );
}

// ---------------------------------------------------------------------------
// The gateway submission + audit records (T040 mirror)
// ---------------------------------------------------------------------------

export type GatewayRefusalStage =
  | 'credential_opacity'
  | 'intent_validation'
  | 'shadow_mode'
  | 'policy_gate'
  | 'duplicate_decision'
  | 'risk_limits'
  | 'authority_grant'
  | 'entitlement'
  | 'rate_budget'
  | 'kill_switch'
  | 'routing'
  | 'translation'
  | 'adapter';

export interface GatewayRefusalMirror {
  readonly stage: GatewayRefusalStage;
  readonly detail: unknown;
}

export interface GatewayAuditRecordMirror {
  readonly auditId: string; // 'xga:' + 8-hex
  readonly sequence: number;
  readonly who: {
    readonly bodyVersion: { readonly specId: string; readonly version: number };
    readonly intentRef: string;
    readonly decisionId: string | null;
    readonly decisionKind: 'approve' | 'refuse' | null;
    readonly clientOrderId: string;
  };
  readonly substrate: string;
  readonly policy: { readonly policyId: string; readonly version: number };
  readonly visibleState: {
    readonly venue: string;
    readonly instrument: string;
    readonly instrumentClass: string;
    readonly referencePrice: string;
    readonly rateWindowOrderCount: number;
    readonly riskExposureRef: string | null;
  };
  readonly riskChecks: {
    readonly evaluationId: string | null;
    readonly riskPolicy: { readonly policyId: string; readonly version: number };
    readonly within: number;
    readonly breaching: number;
    readonly blocked: number;
  };
  readonly order: {
    readonly adapterRef: string;
    readonly channelRef: string;
    readonly credentialRef: string;
    readonly clientOrderId: string;
    readonly requestRef: string;
  } | null;
  readonly execution: { readonly routed: boolean; readonly submissionAt: number; readonly messageDigest: string | null } | null;
  readonly outcome: 'routed' | 'refused';
  readonly refusal: { readonly stage: GatewayRefusalStage; readonly code: string; readonly detail: unknown } | null;
  readonly lineage: ExecutionLineageMirror;
  readonly tenant: string;
  readonly project: string;
  readonly asOf: number;
  readonly chainHead: string;
}

export type GatewaySubmissionRecordMirror =
  | {
      readonly kind: 'routed';
      readonly submissionId: string; // 'xgs:' + 8-hex
      readonly decisionId: string;
      readonly auditId: string;
      readonly requestRef: string;
      readonly venue: string;
      readonly adapterRef: string;
      readonly channelRef: string;
      readonly routedAt: number;
    }
  | {
      readonly kind: 'refused';
      readonly submissionId: string;
      readonly decisionId: string | null;
      readonly auditId: string;
      readonly refusal: GatewayRefusalMirror;
      readonly refusedAt: number;
    };

/** The injected routing port (T039/T040 mirror — the adapter seam). */
export interface RoutingBundleMirror {
  readonly decision: unknown;
  readonly intent: unknown;
  readonly kill_switch: unknown;
  readonly credential_ref?: unknown;
  readonly route?: unknown;
}

export interface RoutingSendFailureMirror {
  readonly kind: string;
  readonly code: string;
  readonly message: string;
}

export type RoutingSendResult =
  | { readonly ok: true; readonly value: null }
  | { readonly ok: false; readonly error: RoutingSendFailureMirror };

export interface OrderRoutingPortMirror {
  routeOrder(routing: RoutingBundleMirror): RoutingSendResult;
}
