/**
 * @tradrl/execution_gateway (service) — the reference fixtures (Work
 * Order T040).
 *
 * Hand-assembled declarations that are VALID by construction (the
 * unwrap helpers fail loudly on drift), built over the REAL T019 and
 * T020 functions: the reference policy through the REAL
 * `validateExecutionPolicy`, the risk context through the REAL
 * `compileRiskPolicy` + `deriveMarketState` + `computeExposure`, the
 * kill switches through the REAL `startKillSwitch`/`throwKillSwitch`,
 * and the authority grants through this lane's own `mintAuthorityGrant`.
 *
 * THE REFERENCE SCENE: one tenant/project scope; a strategy principal
 * ('spec-gateway-director'); THREE venues — BROKER-FIX and OMS-EMS
 * (routed through the T039 adapter identities) plus VENUE-PENDING
 * (covered by the policy but absent from the registry's allowlist —
 * the Default-Deny unknown_venue fixture's substrate); two authority
 * grants (limit + market order kinds) with per-venue rate budgets
 * (10 per minute at the reference budget, 3 per minute at the tight
 * fixture) and opaque credential bindings; a routing table over the
 * REAL T039 adapter descriptor refs and channel refs.
 *
 * Zero runtime dependencies. No ambient clock — every instant is an
 * explicit fixture literal. No credential VALUES — opaque refs only.
 */

import {
  DEFAULT_CHECK_ORDER,
  startKillSwitch,
  throwKillSwitch,
  validateExecutionPolicy,
  type ExecutionPolicy,
  type ExecutionVenueState,
  type KillSwitchLog,
  type PortfolioStateMirror,
  type StrategyIntentMirror,
} from '../../../packages/execution-policy/src/index';
import {
  compileRiskPolicy,
  computeExposure,
  deriveMarketState,
  type RiskPolicy,
} from '../../../packages/risk/src/index';
import {
  deepFreeze,
  isRecord,
  mintAuthorityGrant,
  validateEntitlementRegistry,
  validateRoutingTable,
  type AuthorityGrantRecord,
  type EntitlementRegistry,
  type RoutingTable,
} from '../../../packages/execution-authority/src/index';

// ---------------------------------------------------------------------------
// The reference scope (explicit literals — no ambient anything)
// ---------------------------------------------------------------------------

/** The fixture clock base (epoch ms — 2024-06-04T00:00:00Z). */
export const T0 = 1_717_459_200_000;

/** The fixture ISO instant of T0 (the intents' createdAt). */
export const ISO_T0 = '2024-06-04T00:00:00.000Z';

/** The reference scope (L12/L15). */
export const TENANT = 'tenant-gateway';
export const PROJECT = 'project-gateway';

/** The reference principal (the acting strategy spec). */
export const PRINCIPAL = 'spec-gateway-director';

/** The reference venues (BROKER-FIX/OMS-EMS are the REAL T039 venue labels). */
export const VENUE_BROKER = 'BROKER-FIX';
export const VENUE_OMS = 'OMS-EMS';
/** VENUE-PENDING: covered by the policy but NOT the registry (the unknown_venue fixture's substrate). */
export const VENUE_PENDING = 'VENUE-PENDING';

/** The reference instruments. */
export const BTC = 'BTC-USDT';
export const ETH = 'ETH-USDT';

/** The grant scope refs (the policy's authorization declarations' join keys). */
export const SCOPE_LIMIT = 'grant:gateway-execute-limit@1';
export const SCOPE_MARKET = 'grant:gateway-execute-market@1';

/** The opaque credential refs (never values). */
export const CRED_BROKER = 'cred:gw-broker-main@1';
export const CRED_OMS = 'cred:gw-oms-main@1';
export const CRED_PENDING = 'cred:gw-pending-main@1';

/** The opaque substrate ref (SECURITY.md's audit contents). */
export const SUBSTRATE = 'substrate:t040-gateway-reference@1';

/** Unwrap helper (fixtures are valid by construction). */
function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly { readonly message: string }[] }): T {
  if (result.ok) return result.value;
  throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
}

// ---------------------------------------------------------------------------
// The kill switches
// ---------------------------------------------------------------------------

/** The standing kill switch of the reference scope (genesis at T0 - 10s). */
export function referenceKillSwitch(): KillSwitchLog {
  return unwrap(startKillSwitch(TENANT as never, PROJECT as never, (T0 - 10_000) as never));
}

/** A THROWN kill switch of the reference scope (the throw at T0 + 5s). */
export function thrownReferenceKillSwitch(): KillSwitchLog {
  const standing = referenceKillSwitch();
  return unwrap(throwKillSwitch(standing, 'risk desk circuit breaker: reference fixture', (T0 + 5_000) as never));
}

// ---------------------------------------------------------------------------
// The reference execution policy (the T019 hard-gate declaration)
// ---------------------------------------------------------------------------

/** The policy declaration input (overridable per test — the fixture discipline). */
export function referencePolicyInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const standingSwitch = referenceKillSwitch();
  return deepFreeze({
    version: 1,
    tenant: TENANT,
    project: PROJECT,
    identity: { principals: [PRINCIPAL] },
    authorization: [
      { scopeRef: SCOPE_LIMIT, orderKinds: ['limit'] },
      { scopeRef: SCOPE_MARKET, orderKinds: ['market'] },
    ],
    limits: [
      { instrumentClass: 'crypto', maxOrderSize: '1', maxOrderNotional: '60000', maxPositionSize: '2', maxPositionNotional: '110000' },
      { instrumentClass: '*', maxOrderSize: '0.5', maxOrderNotional: '30000', maxPositionSize: '1', maxPositionNotional: '55000' },
    ],
    venuePermissions: [
      { venue: VENUE_BROKER, instrument: BTC, instrumentClass: 'crypto' },
      { venue: VENUE_BROKER, instrument: ETH, instrumentClass: 'crypto' },
      { venue: VENUE_OMS, instrument: BTC, instrumentClass: 'crypto' },
      { venue: VENUE_OMS, instrument: ETH, instrumentClass: 'crypto' },
      { venue: VENUE_PENDING, instrument: BTC, instrumentClass: 'crypto' },
    ],
    rateLimits: [
      { venue: VENUE_BROKER, windowMs: 60_000, maxOrders: 10 },
      { venue: VENUE_OMS, windowMs: 60_000, maxOrders: 10 },
      { venue: VENUE_PENDING, windowMs: 60_000, maxOrders: 10 },
    ],
    credentials: [
      { venue: VENUE_BROKER, credentialRef: CRED_BROKER },
      { venue: VENUE_OMS, credentialRef: CRED_OMS },
      { venue: VENUE_PENDING, credentialRef: CRED_PENDING },
    ],
    killSwitch: { switchId: standingSwitch.switchId },
    audit: { emission: 'every_decision' },
    checkOrder: [...DEFAULT_CHECK_ORDER],
    learning: null,
    asOf: (T0 - 30_000) as never,
    ...overrides,
  });
}

/** The validated reference execution policy. */
export function referencePolicy(): ExecutionPolicy {
  return unwrap(validateExecutionPolicy(referencePolicyInput())) as ExecutionPolicy;
}

// ---------------------------------------------------------------------------
// The gate facts (the T019 gate's portfolio + venue state)
// ---------------------------------------------------------------------------

/** The reference genesis portfolio: 100000 quote cash, no positions. */
export function referencePortfolio(): PortfolioStateMirror {
  return {
    stateId: 'ps:t040genesis',
    positions: [],
    weights: [],
    cash: '100000',
    realizedPnl: '0',
    unrealizedPnl: '0',
    asOf: (T0 - 5_000) as never,
    lineage: {
      strategy: { specId: PRINCIPAL, version: 1 },
      goal: { goalId: 'goal-gateway-1', version: 1 },
      constraintSet: { id: 'cs-gateway-1', version: 1 },
      windowId: 'win-gateway-1',
      seed: 't040-gateway-seed',
      tenant: TENANT,
      project: PROJECT,
    },
  } as unknown as PortfolioStateMirror;
}

/**
 * The reference venue state: BTC marked at 50000 and ETH at 3000 on
 * each routed venue; SOL-USDT covered but NOT allowlisted (the
 * venue-permission fixture's substrate); rate counters 0.
 */
export function referenceVenueState(rateWindowOrderCount = 0): ExecutionVenueState {
  return {
    asOf: T0 as never,
    instruments: [
      { venue: VENUE_BROKER, instrument: BTC, instrumentClass: 'crypto', referencePrice: '50000.00', rateWindowOrderCount },
      { venue: VENUE_BROKER, instrument: ETH, instrumentClass: 'crypto', referencePrice: '3000.00', rateWindowOrderCount },
      { venue: VENUE_OMS, instrument: BTC, instrumentClass: 'crypto', referencePrice: '50000.00', rateWindowOrderCount },
      { venue: VENUE_OMS, instrument: ETH, instrumentClass: 'crypto', referencePrice: '3000.00', rateWindowOrderCount },
      { venue: VENUE_PENDING, instrument: BTC, instrumentClass: 'crypto', referencePrice: '50000.00', rateWindowOrderCount },
      { venue: VENUE_BROKER, instrument: 'SOL-USDT', instrumentClass: 'crypto', referencePrice: '100.00', rateWindowOrderCount },
    ],
  } as unknown as ExecutionVenueState;
}

// ---------------------------------------------------------------------------
// The risk facts (the T020 risk stage's policy + exposure)
// ---------------------------------------------------------------------------

/** The reference constraint set (the risk policy's compilation source — the T020 mirror shape). */
function referenceConstraintSet(): Record<string, unknown> {
  return deepFreeze({
    id: 'cs-gateway-risk',
    version: 1,
    tenantId: TENANT,
    name: 'reference gateway risk constraints',
    createdAt: (T0 - 60_000) as never,
    constraints: [
      { id: 'c-order-size-all', domain: 'action', subject: 'risk.order_size', predicate: { kind: 'limit.max', bound: 1 }, severity: 'blocking' },
      { id: 'c-order-notional-all', domain: 'action', subject: 'risk.order_notional', predicate: { kind: 'limit.max', bound: 60000 }, severity: 'blocking' },
      { id: 'c-position-size-all', domain: 'state', subject: 'risk.position_size', predicate: { kind: 'limit.max', bound: 2 }, severity: 'blocking' },
      { id: 'c-position-notional-all', domain: 'state', subject: 'risk.position_notional', predicate: { kind: 'limit.max', bound: 110000 }, severity: 'blocking' },
      { id: 'c-order-size-crypto', domain: 'action', subject: 'risk.order_size.crypto', predicate: { kind: 'limit.max', bound: 2 }, severity: 'blocking' },
      { id: 'c-order-notional-crypto', domain: 'action', subject: 'risk.order_notional.crypto', predicate: { kind: 'limit.max', bound: 120000 }, severity: 'blocking' },
      { id: 'c-position-size-crypto', domain: 'state', subject: 'risk.position_size.crypto', predicate: { kind: 'limit.max', bound: 3 }, severity: 'blocking' },
      { id: 'c-position-notional-crypto', domain: 'state', subject: 'risk.position_notional.crypto', predicate: { kind: 'limit.max', bound: 150000 }, severity: 'blocking' },
    ],
  });
}

/** The compiled reference risk policy (the REAL T020 compiler). */
export function referenceRiskPolicy(): RiskPolicy {
  return unwrap(
    compileRiskPolicy({
      constraintSet: referenceConstraintSet(),
      goal: { goalId: 'goal-gateway-1', version: 1 },
      tenant: TENANT as never,
      project: PROJECT as never,
      asOf: (T0 - 50_000) as never,
      ratioPrecision: 6,
    }),
  ) as RiskPolicy;
}

/** A simulated-origin trade print on (venue, instrument) at `price` (the market-event mirror). */
function tradeEvent(overrides: { readonly eventId: string; readonly venue: string; readonly instrument: string; readonly price: string; readonly sequence: number; readonly eventTime: number }): Record<string, unknown> {
  return deepFreeze({
    event_id: overrides.eventId,
    venue: overrides.venue,
    instrument: overrides.instrument,
    asset_class: 'crypto',
    event_type: 'trade',
    event_time: overrides.eventTime,
    source_time: null,
    available_time: overrides.eventTime,
    ingestion_time: overrides.eventTime,
    sequence: overrides.sequence,
    provider: 'gateway-fixture-feed',
    provenance: { origin: 'simulated', adapter: null, derived_from: [], transform: null },
    payload: { price: overrides.price, size: '0.1', side: 'buy' },
  });
}

/**
 * The reference exposure: the genesis portfolio over an observed BTC
 * mark (50000) on BROKER-FIX — no positions held, so every limit is
 * WITHIN (the all-clear risk stage).
 */
export function referenceExposure(): unknown {
  const market = deriveMarketState(
    [tradeEvent({ eventId: 'ev-gw-btc-1', venue: VENUE_BROKER, instrument: BTC, price: '50000.00', sequence: 1, eventTime: T0 - 1_000 })],
    (T0 - 1_000) as never,
    2,
  );
  if (!market.ok) throw new Error(`the reference market state must derive: ${JSON.stringify(market.errors)}`);
  return unwrap(
    computeExposure({
      portfolio: referencePortfolio(),
      marketState: market.value,
      fills: [],
      priorPeakEquity: null,
      seed: 't040-gateway-seed',
    }),
  );
}

/**
 * The BREACHING exposure: a portfolio holding 3.5 BTC (over the
 * crypto position-size cap 3; the notional 175000 also breaches the
 * 150000 cap) — the risk_limits refusal fixture's substrate.
 */
export function breachingExposure(): unknown {
  const portfolio: PortfolioStateMirror = {
    stateId: 'ps:t040breach',
    positions: [
      { instrumentId: BTC, venueId: VENUE_BROKER, quantity: '3.5', costBasis: '140000', openedAt: (T0 - 100_000) as never },
    ],
    weights: [{ instrumentId: BTC, weight: '1', markSource: 'last_trade' }],
    cash: '100000',
    realizedPnl: '0',
    unrealizedPnl: '0',
    asOf: (T0 - 2_000) as never,
    lineage: {
      strategy: { specId: PRINCIPAL, version: 1 },
      goal: { goalId: 'goal-gateway-1', version: 1 },
      constraintSet: { id: 'cs-gateway-risk', version: 1 },
      windowId: 'win-gateway-1',
      seed: 't040-gateway-seed',
      tenant: TENANT,
      project: PROJECT,
    },
  } as unknown as PortfolioStateMirror;
  const market = deriveMarketState(
    [tradeEvent({ eventId: 'ev-gw-btc-breach', venue: VENUE_BROKER, instrument: BTC, price: '50000.00', sequence: 1, eventTime: T0 - 1_000 })],
    (T0 - 1_000) as never,
    2,
  );
  if (!market.ok) throw new Error(`the breach market state must derive: ${JSON.stringify(market.errors)}`);
  return unwrap(
    computeExposure({
      portfolio,
      marketState: market.value,
      fills: [],
      priorPeakEquity: null,
      seed: 't040-gateway-seed',
    }),
  );
}

// ---------------------------------------------------------------------------
// The authority grants + the entitlement registry
// ---------------------------------------------------------------------------

/** The reference grant's declaration overrides (the fixture discipline). */
export interface GrantDeclarationOverrides {
  readonly scopeRef?: string;
  readonly orderKinds?: readonly string[];
  readonly venues?: readonly string[];
  readonly rateBudgets?: readonly { readonly venue: string; readonly windowMs: number; readonly maxOrders: number }[];
  readonly issuedAt?: number;
  readonly expiresAt?: number;
  readonly revocations?: readonly { readonly revokedAt: number; readonly reason: string; readonly revokedBy: string }[];
  readonly tenant?: string;
  readonly project?: string;
  readonly credentials?: readonly { readonly venue: string; readonly credentialRef: string }[];
}

/** One reference grant's declaration (overridable per test). */
function grantDeclaration(overrides: GrantDeclarationOverrides = {}): Record<string, unknown> {
  const venues = overrides.venues ?? [VENUE_BROKER, VENUE_OMS, VENUE_PENDING];
  return deepFreeze({
    version: 1,
    supersedes: null,
    tenant: (overrides.tenant ?? TENANT) as never,
    project: (overrides.project ?? PROJECT) as never,
    principal: { specId: PRINCIPAL, version: 1 },
    scopeRef: (overrides.scopeRef ?? SCOPE_LIMIT) as never,
    orderKinds: overrides.orderKinds ?? ['limit'],
    venues: venues as never,
    rateBudgets: (overrides.rateBudgets ?? [
      { venue: VENUE_BROKER, windowMs: 60_000, maxOrders: 10 },
      { venue: VENUE_OMS, windowMs: 60_000, maxOrders: 10 },
      { venue: VENUE_PENDING, windowMs: 60_000, maxOrders: 10 },
    ]) as never,
    credentials: (overrides.credentials ?? [
      { venue: VENUE_BROKER, credentialRef: CRED_BROKER },
      { venue: VENUE_OMS, credentialRef: CRED_OMS },
      { venue: VENUE_PENDING, credentialRef: CRED_PENDING },
    ]) as never,
    validity: {
      issuedAt: (overrides.issuedAt ?? T0 - 3_600_000) as never,
      expiresAt: (overrides.expiresAt ?? T0 + 86_400_000) as never,
    },
    revocations: (overrides.revocations ?? []) as never,
    asOf: (T0 - 3_600_000) as never,
  });
}

/** Mint one reference grant (the authority package's own minting path). */
export function referenceGrant(overrides: GrantDeclarationOverrides = {}): AuthorityGrantRecord {
  return unwrap(mintAuthorityGrant(grantDeclaration(overrides) as never));
}

/** The reference entitlement registry (VENUE-PENDING deliberately absent — Default-Deny). */
export function referenceRegistry(grantsOverrides: readonly GrantDeclarationOverrides[] = [], venuesOverrides?: readonly string[]): EntitlementRegistry {
  // An override with a default's scopeRef REPLACES it (the fixture discipline:
  // variant grants, not duplicates); foreign scope refs append.
  const defaults: readonly GrantDeclarationOverrides[] = [
    { scopeRef: SCOPE_LIMIT, orderKinds: ['limit'] },
    { scopeRef: SCOPE_MARKET, orderKinds: ['market'] },
  ];
  const merged: GrantDeclarationOverrides[] = defaults.map(
    (declaration) => grantsOverrides.find((override) => override.scopeRef === declaration.scopeRef) ?? declaration,
  );
  const extras = grantsOverrides.filter((override) => !defaults.some((declaration) => declaration.scopeRef === override.scopeRef));
  const grants: readonly AuthorityGrantRecord[] = [...merged, ...extras].map((declaration) => referenceGrant(declaration));
  return unwrap(
    validateEntitlementRegistry({
      tenant: TENANT,
      project: PROJECT,
      grants,
      venues: venuesOverrides ?? [VENUE_BROKER, VENUE_OMS],
    }),
  );
}

// ---------------------------------------------------------------------------
// The routing table (over the REAL T039 descriptor identities)
// ---------------------------------------------------------------------------

/** The reference routing table: the two routed venues over the REAL T039 adapter/channel identities. */
export function referenceRoutingTable(entriesOverrides?: readonly Record<string, unknown>[]): RoutingTable {
  return unwrap(
    validateRoutingTable({
      tenant: TENANT,
      project: PROJECT,
      entries: entriesOverrides ?? [
        { venue: VENUE_BROKER, instrument: BTC, adapterRef: 'adapter:adapter-brokers@0.0.0', channelRef: 'chan:newOrderSingle' },
        { venue: VENUE_BROKER, instrument: ETH, adapterRef: 'adapter:adapter-brokers@0.0.0', channelRef: 'chan:newOrderSingle' },
        { venue: VENUE_OMS, instrument: BTC, adapterRef: 'adapter:adapter-oms-ems@0.0.0', channelRef: 'chan:routingInstruction' },
      ],
    }),
  );
}

// ---------------------------------------------------------------------------
// The intents (the T018 strategy-lane mirrors)
// ---------------------------------------------------------------------------

/** Build one reference-scoped strategy intent (the trading-strategy mirror). */
export function intent(
  sequence: number,
  order: {
    readonly clientOrderId: string;
    readonly instrumentId: string;
    readonly venueId: string;
    readonly side: 'buy' | 'sell';
    readonly kind: string;
    readonly quantity: string;
    readonly price?: string;
    readonly stopPrice?: string;
  },
  overrides: Record<string, unknown> = {},
): StrategyIntentMirror {
  const base = {
    intentId: `si:t040gw${String(sequence).padStart(4, '0')}`,
    sequence,
    order: {
      clientOrderId: order.clientOrderId,
      instrumentId: order.instrumentId,
      venueId: order.venueId,
      side: order.side,
      kind: order.kind,
      quantity: order.quantity,
      ...(order.price !== undefined ? { price: order.price } : {}),
      ...(order.stopPrice !== undefined ? { stopPrice: order.stopPrice } : {}),
      timeInForce: 'gtc',
      createdAt: ISO_T0,
    },
    constraintProof: {
      constraintSet: { id: 'cs-gateway-1', version: 1 },
      satisfied: [
        {
          constraintId: 'max-positions',
          domain: 'state',
          subject: 'state.positions',
          severity: 'blocking',
          predicate: { kind: 'limit.max', bound: 5 },
          observed: 0,
        },
      ],
      advisoryViolations: [],
    },
    goal: { goalId: 'goal-gateway-1', version: 1 },
    strategy: { specId: PRINCIPAL, version: 1 },
    windowRefs: ['win-gateway-1'],
    seed: 't040-gateway-seed',
    tenant: TENANT,
    project: PROJECT,
    riskPolicyRefs: ['risk-policy:gateway-core@1'],
    rationale: {
      kind: sequence === 1 ? 'initial_allocation' : 'rebalance_drift',
      instrumentId: order.instrumentId,
      targetWeight: '0.5',
      currentWeight: '0.25',
      drift: '0.25',
    },
    asOf: T0,
    ...overrides,
  } as unknown as StrategyIntentMirror;
  return base;
}

/**
 * The APPROVE batch (the golden scenario): (1) a limit buy of 0.5 BTC
 * at 50100 on BROKER-FIX (routes the brokers lane), (2) the same buy
 * on OMS-EMS (routes the OMS/EMS lane), (3) a market sell of 0.2 BTC
 * on BROKER-FIX (the market-kind grant).
 */
export function referenceApproveBatch(): readonly StrategyIntentMirror[] {
  return [
    intent(1, { clientOrderId: 't040-batch-1', instrumentId: BTC, venueId: VENUE_BROKER, side: 'buy', kind: 'limit', quantity: '0.5', price: '50100.00' }),
    intent(2, { clientOrderId: 't040-batch-2', instrumentId: BTC, venueId: VENUE_OMS, side: 'buy', kind: 'limit', quantity: '0.5', price: '50100.00' }),
    intent(3, { clientOrderId: 't040-batch-3', instrumentId: BTC, venueId: VENUE_BROKER, side: 'sell', kind: 'market', quantity: '0.2' }),
  ];
}

// --- The refusal-path fixtures (each trips exactly ONE gateway stage) --------

/** PATH (credential opacity) — an intent embedding credential MATERIAL. */
export function contaminatedIntent(): Record<string, unknown> {
  return { ...intent(1, { clientOrderId: 't040-opacity', instrumentId: BTC, venueId: VENUE_BROKER, side: 'buy', kind: 'limit', quantity: '0.5', price: '50100.00' }), apiKey: 'synthetic-secret-value' };
}

/** PATH (intent validation) — a malformed intent (the quantity is not a positive decimal). */
export function malformedIntent(): Record<string, unknown> {
  return { ...intent(2, { clientOrderId: 't040-malformed', instrumentId: BTC, venueId: VENUE_BROKER, side: 'buy', kind: 'limit', quantity: '0.5', price: '50100.00' }), order: { clientOrderId: 't040-malformed', instrumentId: BTC, venueId: VENUE_BROKER, side: 'buy', kind: 'limit', quantity: 'abc', price: '50100.00', timeInForce: 'gtc', createdAt: ISO_T0 } };
}

/** PATH (shadow mode) — a shadow-mode intent reaching the LIVE gateway. */
export function shadowModeIntent(mode: 'shadow' | 'paper' = 'shadow'): Record<string, unknown> {
  return { ...intent(3, { clientOrderId: `t040-${mode}`, instrumentId: BTC, venueId: VENUE_BROKER, side: 'buy', kind: 'limit', quantity: '0.5', price: '50100.00' }), executionMode: mode };
}

/** PATH (gate: identity) — the intent comes from an undeclared principal. */
export function identityFailIntent(): StrategyIntentMirror {
  return intent(4, { clientOrderId: 't040-identity-fail', instrumentId: BTC, venueId: VENUE_BROKER, side: 'buy', kind: 'limit', quantity: '0.5', price: '50100.00' }, { strategy: { specId: 'spec-intruder', version: 1 } });
}

/** PATH (gate: authorization) — a stop order (no grant permits stop kinds). */
export function authorizationFailIntent(): StrategyIntentMirror {
  return intent(5, { clientOrderId: 't040-auth-fail', instrumentId: BTC, venueId: VENUE_BROKER, side: 'sell', kind: 'stop', quantity: '0.5', stopPrice: '48000.00' });
}

/** PATH (gate: limits) — a 1.5 BTC order breaches the crypto maxOrderSize of 1. */
export function limitFailIntent(): StrategyIntentMirror {
  return intent(6, { clientOrderId: 't040-limit-fail', instrumentId: BTC, venueId: VENUE_BROKER, side: 'buy', kind: 'limit', quantity: '1.5', price: '50100.00' });
}

/** PATH (gate: venue permissions) — SOL-USDT is covered but not allowlisted. */
export function venueFailIntent(): StrategyIntentMirror {
  return intent(7, { clientOrderId: 't040-venue-fail', instrumentId: 'SOL-USDT', venueId: VENUE_BROKER, side: 'buy', kind: 'limit', quantity: '0.5', price: '101.00' });
}

/** PATH (gate: envelope) — the intent's venue is absent from the venue state. */
export function unknownVenueIntent(): StrategyIntentMirror {
  return intent(8, { clientOrderId: 't040-unknown-venue', instrumentId: BTC, venueId: 'VENUE-NOWHERE', side: 'buy', kind: 'limit', quantity: '0.5', price: '50100.00' });
}

/** PATH (entitlement: unknown venue) — VENUE-PENDING is policy-covered but registry-absent. */
export function pendingVenueIntent(): StrategyIntentMirror {
  return intent(9, { clientOrderId: 't040-pending-venue', instrumentId: BTC, venueId: VENUE_PENDING, side: 'buy', kind: 'limit', quantity: '0.5', price: '50100.00' });
}

/** PATH (routing: no route) — (OMS-EMS, ETH-USDT) is permitted but unrouted (the tight routing table's substrate). */
export function unroutedIntent(): StrategyIntentMirror {
  return intent(10, { clientOrderId: 't040-no-route', instrumentId: ETH, venueId: VENUE_OMS, side: 'buy', kind: 'limit', quantity: '0.5', price: '3010.00' });
}

/** The unroutable-pair routing table (the no_route fixture's substrate). */
export function unroutableRoutingTable(): RoutingTable {
  return referenceRoutingTable([
    { venue: VENUE_BROKER, instrument: BTC, adapterRef: 'adapter:adapter-brokers@0.0.0', channelRef: 'chan:newOrderSingle' },
    { venue: VENUE_BROKER, instrument: ETH, adapterRef: 'adapter:adapter-brokers@0.0.0', channelRef: 'chan:newOrderSingle' },
    { venue: VENUE_OMS, instrument: BTC, adapterRef: 'adapter:adapter-oms-ems@0.0.0', channelRef: 'chan:routingInstruction' },
    // (OMS-EMS, ETH-USDT) deliberately UNROUTED: permitted everywhere, routed nowhere.
  ]);
}

/** The ghost-adapter routing table (the no_adapter fixture's substrate). */
export function ghostAdapterRoutingTable(): RoutingTable {
  return referenceRoutingTable([
    { venue: VENUE_BROKER, instrument: BTC, adapterRef: 'adapter:adapter-ghost@0.0.0', channelRef: 'chan:newOrderSingle' },
    { venue: VENUE_OMS, instrument: BTC, adapterRef: 'adapter:adapter-oms-ems@0.0.0', channelRef: 'chan:routingInstruction' },
  ]);
}

/** PATH (gate: rate limits) — a compliant intent against a venue state already at the budget. */
export function rateWindowSaturatedVenueState(): ExecutionVenueState {
  return referenceVenueState(10);
}

/** PATH (gate: credentials) — the policy variant without the BROKER-FIX credential binding. */
export function policyWithoutBrokerCredential(): ExecutionPolicy {
  return unwrap(
    validateExecutionPolicy(
      referencePolicyInput({
        credentials: [
          { venue: VENUE_OMS, credentialRef: CRED_OMS },
          { venue: VENUE_PENDING, credentialRef: CRED_PENDING },
        ],
      }),
    ),
  ) as ExecutionPolicy;
}

/** PATH (authority: unknown grant) — the policy variant declaring a GHOST scope ref. */
export function policyWithGhostGrant(): ExecutionPolicy {
  return unwrap(
    validateExecutionPolicy(
      referencePolicyInput({
        authorization: [{ scopeRef: 'grant:ghost-nobody-registered@1', orderKinds: ['limit', 'market'] }],
      }),
    ),
  ) as ExecutionPolicy;
}

/** The intent for the gateway-level kill-switch/rate/risk/authority fixtures (a compliant limit buy on BROKER-FIX). */
export function compliantIntent(sequence = 11): StrategyIntentMirror {
  return intent(sequence, { clientOrderId: `t040-compliant-${sequence}`, instrumentId: BTC, venueId: VENUE_BROKER, side: 'buy', kind: 'limit', quantity: '0.5', price: '50100.00' });
}

// ---------------------------------------------------------------------------
// The SECURITY.md audit-sentence checker (test support)
// ---------------------------------------------------------------------------

/**
 * Check one gateway audit record against SECURITY.md's audit sentence —
 * VERBATIM: "Record who/what acted, BodyVersion, substrate, policy,
 * visible market/data state, risk checks, order, execution and outcome
 * for consequential actions." Returns the missing-field list (empty =
 * the record carries the full sentence).
 */
export function auditTrailSatisfiesSecuritySentence(record: {
  readonly who?: unknown;
  readonly substrate?: unknown;
  readonly policy?: unknown;
  readonly visibleState?: unknown;
  readonly riskChecks?: unknown;
  readonly order?: unknown;
  readonly execution?: unknown;
  readonly outcome?: unknown;
  readonly lineage?: unknown;
}): { readonly errors: readonly string[] } {
  const errors: string[] = [];
  if (!isRecord(record.who) || !isRecord((record.who as Record<string, unknown>).bodyVersion)) {
    errors.push('who/what acted (tenant/project/principal/intent/decision/client order) is absent');
  }
  if (typeof record.substrate !== 'string' || (record.substrate as string) === '') {
    errors.push('substrate is absent');
  }
  if (!isRecord(record.policy)) {
    errors.push('policy is absent');
  }
  if (!isRecord(record.visibleState)) {
    errors.push('visible market/data state is absent');
  }
  if (!isRecord(record.riskChecks)) {
    errors.push('risk checks are absent');
  }
  if (record.order !== null && !isRecord(record.order)) {
    errors.push('order is malformed');
  }
  if (record.execution !== null && !isRecord(record.execution)) {
    errors.push('execution is malformed');
  }
  if (record.outcome !== 'routed' && record.outcome !== 'refused') {
    errors.push('outcome is absent');
  }
  if (!isRecord(record.lineage)) {
    errors.push('the L9 lineage block is absent');
  }
  return { errors: deepFreeze(errors) };
}
