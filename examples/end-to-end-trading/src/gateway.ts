/**
 * T048 — STATION 6: THE EXECUTION GATEWAY (T040) — THE CHOKEPOINT.
 *
 * The REAL `createExecutionGateway` over the REAL T019 gate + the REAL
 * T020 risk engine + the REAL T040 authority stack (grants minted by
 * the authority package's own minter, the entitlement registry, the
 * routing table) — the L8 law in code: `submitDecision` is the SINGLE
 * entry point, the 13-stage pipeline runs first-failure-wins, and ANY
 * refusal is a typed GatewayRefusal record + an audit record + ZERO
 * adapter calls.
 *
 * The venue seam is the gateway's injected `OrderRoutingPort` (the
 * T039 session/routing mirror): this slice binds the gateway's own
 * exported RECORDING PORT (the deterministic fake the T040 suite
 * ships for downstream lanes) — no network, no real venue; the T040
 * interop test drives the REAL broker/OMS-EMS sessions through the
 * same port shape.
 *
 * The submission plan (the slice's live lane, every instant scripted):
 *   POSITIVE  — both strategy intents (the BTC and ETH allocation
 *               buys) route through the pipeline to the port.
 *   NEGATIVE  — (a) the SAME decision submitted twice: the typed
 *               duplicate_decision refusal (the first stands);
 *               (b) an oversized notional: the REAL T019 gate's
 *               limits refusal (policy_gate);
 *               (c) a shadow-mode intent reaching the LIVE gateway:
 *               the mode-separation refusal (L5/R23);
 *               (d) a THROWN kill switch: the fail-closed refusal;
 *               (e) an EXPIRED authority grant: the Default-Deny
 *               authority_grant refusal.
 * Every refusal asserts ZERO port calls (the no-bypass law).
 */

import {
  createExecutionGateway,
  recordingPort,
  scriptedInstants,
  type ExecutionGatewaySession,
  type GatewayAdapterBinding,
  type GatewaySubmissionRecord,
  type RecordingPort,
} from '../../../services/execution-gateway/src/index';
import type { GatewayAuditRecord } from '../../../packages/execution-authority/src/index';
import {
  DEFAULT_CHECK_ORDER,
  validateExecutionPolicy,
  type ExecutionPolicy,
  type ExecutionVenueState,
  type PortfolioStateMirror,
  type StrategyIntentMirror,
} from '../../../packages/execution-policy/src/index';
import { computeExposure, deriveMarketState, type RiskPolicy } from '../../../packages/risk/src/index';
import {
  mintAuthorityGrant,
  validateEntitlementRegistry,
  validateRoutingTable,
  type AuthorityGrantRecord,
  type EntitlementRegistry,
  type RoutingTable,
} from '../../../packages/execution-authority/src/index';
import type { StrategyRun } from '../../../packages/trading-strategy/src/index';

import {
  ADAPTER_REF,
  BTC,
  CHANNEL_REF,
  CREDENTIAL_REF,
  ETH,
  GATEWAY_INSTANTS,
  PRINCIPAL,
  PROJECT,
  SEED,
  STRATEGY_DECISION_AT,
  SUBSTRATE_REF,
  T0,
  TENANT,
  VENUE,
  GENESIS_CASH,
  unwrap,
} from './scope';
import { sliceKillSwitch, sliceRiskPolicy, thrownSliceKillSwitch } from './control-stack';
import { CONSTRAINT_SET_ID, GOAL_ID, SPEC_ID, WINDOW_ID } from './strategy';

// ---------------------------------------------------------------------------
// The authority stack (grants -> registry; the routing table)
// ---------------------------------------------------------------------------

/** One slice grant's declaration (overridable — the T040 fixture discipline, re-scoped). */
export interface SliceGrantOverrides {
  readonly issuedAt?: number;
  readonly expiresAt?: number;
  readonly orderKinds?: readonly string[];
  readonly scopeRef?: string;
}

/** Mint one slice authority grant through the authority package's own minting path. */
export function sliceGrant(overrides: SliceGrantOverrides = {}): AuthorityGrantRecord {
  return unwrap(
    mintAuthorityGrant({
      version: 1,
      supersedes: null,
      tenant: TENANT as never,
      project: PROJECT as never,
      principal: { specId: PRINCIPAL, version: 1 },
      scopeRef: (overrides.scopeRef ?? 'grant:e2e-limit@1') as never,
      orderKinds: overrides.orderKinds ?? ['limit'],
      venues: [VENUE] as never,
      rateBudgets: [{ venue: VENUE, windowMs: 60_000, maxOrders: 10 }] as never,
      credentials: [{ venue: VENUE, credentialRef: CREDENTIAL_REF }] as never,
      validity: {
        issuedAt: (overrides.issuedAt ?? T0 - 3_600_000) as never,
        expiresAt: (overrides.expiresAt ?? T0 + 86_400_000) as never,
      },
      revocations: [] as never,
      asOf: (T0 - 3_600_000) as never,
    } as never),
    'the slice grant must mint',
  );
}

/** The slice's entitlement registry (one limit-order grant over the BINANCE venue). */
export function sliceRegistry(grant: AuthorityGrantRecord = sliceGrant()): EntitlementRegistry {
  return unwrap(
    validateEntitlementRegistry({
      tenant: TENANT as never,
      project: PROJECT as never,
      grants: [grant] as never,
      venues: [VENUE] as never,
    } as never),
    'the slice registry must validate',
  );
}

/** The slice's routing table: both instruments route to the one venue binding. */
export function sliceRoutingTable(): RoutingTable {
  return unwrap(
    validateRoutingTable({
      tenant: TENANT as never,
      project: PROJECT as never,
      entries: [
        { venue: VENUE, instrument: BTC, adapterRef: ADAPTER_REF, channelRef: CHANNEL_REF },
        { venue: VENUE, instrument: ETH, adapterRef: ADAPTER_REF, channelRef: CHANNEL_REF },
      ] as never,
    } as never),
    'the slice routing table must validate',
  );
}

// ---------------------------------------------------------------------------
// The gate + risk facts
// ---------------------------------------------------------------------------

/** The genesis portfolio mirror (the T019 gate's fact — the pre-execution book). */
export function sliceGatePortfolio(): PortfolioStateMirror {
  return {
    stateId: 'ps:e2e-genesis',
    positions: [],
    weights: [],
    cash: GENESIS_CASH,
    realizedPnl: '0',
    unrealizedPnl: '0',
    asOf: STRATEGY_DECISION_AT as never,
    lineage: {
      strategy: { specId: SPEC_ID, version: 1 },
      goal: { goalId: GOAL_ID, version: 1 },
      constraintSet: { id: CONSTRAINT_SET_ID, version: 1 },
      windowId: WINDOW_ID,
      seed: SEED,
      tenant: TENANT,
      project: PROJECT,
    },
  } as unknown as PortfolioStateMirror;
}

/** The venue state (the marks the adapter stream printed; the rate counters at zero). */
export function sliceVenueState(): ExecutionVenueState {
  return {
    asOf: STRATEGY_DECISION_AT as never,
    instruments: [
      { venue: VENUE, instrument: BTC, instrumentClass: 'crypto', referencePrice: '50100.00', rateWindowOrderCount: 0 },
      { venue: VENUE, instrument: ETH, instrumentClass: 'crypto', referencePrice: '3000.00', rateWindowOrderCount: 0 },
    ],
  } as unknown as ExecutionVenueState;
}

/** The risk stage's measured exposure over the adapter marks (the genesis book — every limit WITHIN). */
export function sliceExposure(): unknown {
  const mark = (eventId: string, instrument: string, price: string, sequence: number, at: number): Record<string, unknown> => ({
    event_id: eventId,
    venue: VENUE,
    instrument,
    asset_class: 'crypto',
    event_type: 'trade',
    event_time: at,
    source_time: null,
    available_time: at,
    ingestion_time: at,
    sequence,
    provider: 'adapter-binance',
    provenance: { origin: 'historical', adapter: { id: 'adapter-binance', version: '0.0.0' }, derived_from: [], transform: null },
    payload: { price, size: '0.25', side: 'buy' },
  });
  const market = deriveMarketState(
    [
      mark('e2e-mk-btc', BTC, '50100.00', 1, STRATEGY_DECISION_AT - 1_000),
      mark('e2e-mk-eth', ETH, '3000.00', 1, STRATEGY_DECISION_AT - 1_000),
    ],
    (STRATEGY_DECISION_AT - 1_000) as never,
    2,
  );
  const marketState = unwrap(market, 'the market state must derive');
  return unwrap(
    computeExposure({
      portfolio: sliceGatePortfolio(),
      marketState,
      fills: [],
      priorPeakEquity: null,
      seed: SEED,
    }),
    'the exposure must compute',
  );
}

// ---------------------------------------------------------------------------
// The gateway construction
// ---------------------------------------------------------------------------

/** The construction options (the negative paths' substrates). */
export interface SliceGatewayOptions {
  /** Override the authority grant (e.g. an EXPIRED one — the authority denial path). */
  readonly grant?: AuthorityGrantRecord;
  /** Bind the THROWN kill switch (the fail-closed path). */
  readonly thrownKillSwitch?: boolean;
  /** Extra policy input overrides (the T040 fixture discipline). */
  readonly policyOverrides?: Record<string, unknown>;
}

/** The built gateway pair: the session + its recording port (the venue seam). */
export interface SliceGateway {
  readonly gateway: ExecutionGatewaySession;
  readonly port: RecordingPort;
}

/** Build one slice gateway (the chokepoint over the whole control + authority stack). */
export function buildSliceGateway(options: SliceGatewayOptions = {}): SliceGateway {
  const killSwitch = options.thrownKillSwitch === true ? thrownSliceKillSwitch() : sliceKillSwitch();
  const policy: ExecutionPolicy = unwrap(
    validateExecutionPolicy({
      ...{
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
        killSwitch: { switchId: killSwitch.switchId },
        audit: { emission: 'every_decision' },
        checkOrder: [...DEFAULT_CHECK_ORDER],
        learning: null,
        asOf: (T0 - 30_000) as never,
      },
      ...options.policyOverrides,
    }),
    'the slice gateway policy must validate',
  ) as ExecutionPolicy;
  const riskPolicy: RiskPolicy = sliceRiskPolicy();
  const port = recordingPort();
  const adapters: readonly GatewayAdapterBinding[] = [{ adapterRef: ADAPTER_REF as never, port }];
  const construction = createExecutionGateway({
    policy,
    gate: { portfolio: sliceGatePortfolio(), venueState: sliceVenueState() },
    risk: { policy: riskPolicy, exposure: sliceExposure() },
    authority: sliceRegistry(options.grant),
    routing: sliceRoutingTable(),
    adapters,
    killSwitch,
    instants: scriptedInstants([...GATEWAY_INSTANTS]),
    substrate: SUBSTRATE_REF,
  });
  if (!construction.ok) {
    throw new Error(`the slice gateway must construct: ${construction.errors.map((error) => error.message).join('; ')}`);
  }
  return { gateway: construction.gateway, port };
}

// ---------------------------------------------------------------------------
// The submission plan (the live lane)
// ---------------------------------------------------------------------------

/** The live lane's outcome: every submission record + the ports' call logs. */
export interface GatewayLaneResult {
  /** The submissions in order: the three ROUTED positives, then the typed refusals. */
  readonly submissions: readonly GatewaySubmissionRecord[];
  /** The main gateway's recording port (the venue seam — the zero-calls evidence). */
  readonly port: RecordingPort;
  /** The main gateway's chain-verified audit records (1:1 with the submissions; the L15 lineage carriers). */
  readonly audit: readonly GatewayAuditRecord[];
  /** The main gateway's chain-verified audit record count (1:1 with the submissions). */
  readonly auditRecords: number;
  /** The main gateway's whole-session coherence verdict (the audit chain + the 1:1 law). */
  readonly coherent: boolean;
  /** The thrown-switch gateway's refusal (its own port — zero calls). */
  readonly killSwitchRefusal: GatewaySubmissionRecord;
  /** The expired-grant gateway's refusal (its own port — zero calls). */
  readonly expiredGrantRefusal: GatewaySubmissionRecord;
}

/**
 * Drive the whole live lane: the step-1 allocation buys (BTC + ETH) and
 * the step-2 drift-correction sell through the main gateway (routed),
 * then the duplicate / oversized / shadow-mode negatives on the same
 * gateway, then the kill-switch and expired-grant gateways (fresh
 * instances — their own instants and ports).
 */
export function submitThroughGateway(run: StrategyRun, step2Run: StrategyRun): GatewayLaneResult {
  const intents: readonly StrategyIntentMirror[] = [...run.intents, ...step2Run.intents];
  const btcIntent = intents.find((intent) => intent.order.instrumentId === BTC && intent.order.side === 'buy');
  const ethIntent = intents.find((intent) => intent.order.instrumentId === ETH);
  const sellIntent = intents.find((intent) => intent.order.instrumentId === BTC && intent.order.side === 'sell');
  if (btcIntent === undefined || ethIntent === undefined || sellIntent === undefined) {
    throw new Error('the slice runs must emit the BTC buy, the ETH buy and the BTC sell');
  }

  // --- The main gateway: two positives + three negatives ---------------------
  const main = buildSliceGateway();
  const submissions: GatewaySubmissionRecord[] = [];
  const submit = (intent: unknown): GatewaySubmissionRecord => {
    const outcome = main.gateway.submitDecision(intent);
    return unwrap(outcome, 'submitDecision must produce a submission record');
  };

  // POSITIVE: the allocation buys + the drift-correction sell route to the venue seam.
  submissions.push(submit(btcIntent));
  submissions.push(submit(ethIntent));
  submissions.push(submit(sellIntent));

  // NEGATIVE (duplicate): the same decision submitted twice — the first stands.
  submissions.push(submit(btcIntent));

  // NEGATIVE (policy gate): the oversized notional (30 BTC x 50100 >> the 60000 cap).
  const oversized = { ...btcIntent, intentId: 'si:e2e-oversized-notional', order: { ...btcIntent.order, clientOrderId: 'e2e-oversized', quantity: '30' } };
  submissions.push(submit(oversized));

  // NEGATIVE (mode separation): a shadow-mode intent reaching the LIVE gateway.
  const shadowMode = { ...btcIntent, executionMode: 'shadow' };
  submissions.push(submit(shadowMode));

  // --- The thrown-switch gateway (fail-closed) --------------------------------
  const thrownSwitch = buildSliceGateway({ thrownKillSwitch: true });
  const killSwitchOutcome = thrownSwitch.gateway.submitDecision(btcIntent);
  const killSwitchRefusal = unwrap(killSwitchOutcome, 'the thrown-switch submission must produce a record');
  unwrap(thrownSwitch.gateway.verifyGatewayCoherence(), 'the thrown-switch gateway must stay coherent');

  // --- The expired-grant gateway (Default-Deny authority) ---------------------
  const expired = buildSliceGateway({
    grant: sliceGrant({ issuedAt: T0 - 7_200_000, expiresAt: T0 - 3_600_000 }),
  });
  const expiredOutcome = expired.gateway.submitDecision(btcIntent);
  const expiredGrantRefusal = unwrap(expiredOutcome, 'the expired-grant submission must produce a record');
  unwrap(expired.gateway.verifyGatewayCoherence(), 'the expired-grant gateway must stay coherent');

  // --- The whole main session's coherence (the chain + the 1:1 law) -----------
  unwrap(main.gateway.verifyGatewayCoherence(), 'the main gateway must stay coherent');
  const audit = [...main.gateway.auditTrail().records];
  if (audit.length !== submissions.length) {
    throw new Error(`every submission must emit exactly one audit record (submissions ${submissions.length}, audit ${audit.length})`);
  }

  return { submissions, port: main.port, audit, auditRecords: audit.length, coherent: true, killSwitchRefusal, expiredGrantRefusal };
}
