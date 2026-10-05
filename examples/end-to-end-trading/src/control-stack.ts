/**
 * T048 — the shared control stack (the REAL T019 gate declarations +
 * the REAL T020 risk policy): ONE scope, consumed by BOTH outbound
 * lanes — the live chokepoint (station 6, the execution gateway) and
 * the paper lane (station 7, the shadow session). The mode-separation
 * law (L5/R23): the same hard controls govern both; the gateway
 * additionally REFUSES shadow-mode intents outright (stage 3).
 *
 * Every declaration runs through the REAL validators
 * (`validateExecutionPolicy`, `compileRiskPolicy`, `startKillSwitch`) —
 * no hand-built policy objects anywhere.
 */

import {
  DEFAULT_CHECK_ORDER,
  startKillSwitch,
  throwKillSwitch,
  validateExecutionPolicy,
  type ExecutionPolicy,
  type KillSwitchLog,
} from '../../../packages/execution-policy/src/index';
import { compileRiskPolicy, type RiskPolicy } from '../../../packages/risk/src/index';

import { BTC, ETH, PRINCIPAL, PROJECT, T0, TENANT, VENUE, CREDENTIAL_REF, unwrap } from './scope';

// ---------------------------------------------------------------------------
// The kill switches (T019's chain-verified standing facts)
// ---------------------------------------------------------------------------

/** The slice's STANDING kill switch (genesis ten seconds before the stream opens). */
export function sliceKillSwitch(): KillSwitchLog {
  return unwrap(startKillSwitch(TENANT as never, PROJECT as never, (T0 - 10_000) as never), 'the kill switch must start');
}

/** The slice's THROWN kill switch (thrown at T0+5_000 — the negative paths' substrate). */
export function thrownSliceKillSwitch(): KillSwitchLog {
  const standing = sliceKillSwitch();
  return unwrap(throwKillSwitch(standing, 'risk desk circuit breaker: the e2e slice', (T0 + 5_000) as never), 'the kill switch must throw');
}

// ---------------------------------------------------------------------------
// The T019 execution policy (the hard-gate declaration)
// ---------------------------------------------------------------------------

/** The policy declaration input (overridable per station — the fixture discipline). */
export function slicePolicyInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const standingSwitch = sliceKillSwitch();
  return {
    version: 1,
    tenant: TENANT,
    project: PROJECT,
    identity: { principals: [PRINCIPAL] },
    authorization: [{ scopeRef: 'grant:e2e-limit@1', orderKinds: ['limit'] }],
    limits: [
      { instrumentClass: 'crypto', maxOrderSize: '20', maxOrderNotional: '60000', maxPositionSize: '25', maxPositionNotional: '110000' },
      { instrumentClass: '*', maxOrderSize: '10', maxOrderNotional: '30000', maxPositionSize: '12', maxPositionNotional: '60000' },
    ],
    venuePermissions: [
      { venue: VENUE, instrument: BTC, instrumentClass: 'crypto' },
      { venue: VENUE, instrument: ETH, instrumentClass: 'crypto' },
    ],
    rateLimits: [{ venue: VENUE, windowMs: 60_000, maxOrders: 10 }],
    credentials: [{ venue: VENUE, credentialRef: CREDENTIAL_REF }],
    killSwitch: { switchId: standingSwitch.switchId },
    audit: { emission: 'every_decision' },
    checkOrder: [...DEFAULT_CHECK_ORDER],
    learning: null,
    asOf: (T0 - 30_000) as never,
    ...overrides,
  };
}

/** The validated T019 execution policy of the slice's scope. */
export function sliceExecutionPolicy(): ExecutionPolicy {
  return unwrap(validateExecutionPolicy(slicePolicyInput()), 'the execution policy must validate') as ExecutionPolicy;
}

// ---------------------------------------------------------------------------
// The T020 risk policy (the constraint-set compilation)
// ---------------------------------------------------------------------------

/** The slice's risk constraint set (the compilation source — the T020 mirror shape). */
function sliceRiskConstraintSet(): Record<string, unknown> {
  return {
    id: 'cs-e2e-risk',
    version: 1,
    tenantId: TENANT,
    name: 'the e2e slice risk constraints',
    createdAt: (T0 - 60_000) as never,
    constraints: [
      { id: 'c-order-size', domain: 'action', subject: 'risk.order_size', predicate: { kind: 'limit.max', bound: 20 }, severity: 'blocking' },
      { id: 'c-order-notional', domain: 'action', subject: 'risk.order_notional', predicate: { kind: 'limit.max', bound: 60000 }, severity: 'blocking' },
      { id: 'c-position-size', domain: 'state', subject: 'risk.position_size', predicate: { kind: 'limit.max', bound: 25 }, severity: 'blocking' },
      { id: 'c-position-notional', domain: 'state', subject: 'risk.position_notional', predicate: { kind: 'limit.max', bound: 110000 }, severity: 'blocking' },
      { id: 'c-drawdown', domain: 'state', subject: 'risk.drawdown', predicate: { kind: 'limit.max', bound: 50000 }, severity: 'blocking' },
      { id: 'c-leverage', domain: 'state', subject: 'risk.leverage', predicate: { kind: 'limit.max', bound: 1.5 }, severity: 'blocking' },
    ],
  };
}

/** The compiled T020 risk policy of the slice's scope. */
export function sliceRiskPolicy(): RiskPolicy {
  return unwrap(
    compileRiskPolicy({
      constraintSet: sliceRiskConstraintSet(),
      goal: { goalId: 'goal-e2e-slice', version: 1 },
      tenant: TENANT as never,
      project: PROJECT as never,
      asOf: (T0 - 50_000) as never,
      ratioPrecision: 6,
    }),
    'the risk policy must compile',
  ) as RiskPolicy;
}
