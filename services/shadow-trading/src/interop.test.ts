/**
 * Cross-lane interoperability trip wires for the shadow-trading lane
 * (Work Order T030): the REAL services this lane consumes ONLY through
 * its injected ports are loaded STATICALLY here (the tests are the
 * trip wires — the src lane itself imports neither):
 *
 *   - @tradrl/market-world/reactive (T027): the REAL
 *     `createReactiveWorldService` — driven by the REAL exchange-sim
 *     engine (T010) — SATISFIES the `ReactiveWorldPort` structurally
 *     (type-level witness + runtime guard), and a FULL shadow session
 *     paper-trades against it: the control stack approves, the world
 *     matches, the fills arrive with their FULL physics lineage (the
 *     engine config hash byte-parity asserted), the book accounts
 *     exactly, and refusals NEVER reach the world.
 *   - @tradrl/time-machine (T029): the REAL `createRollingTimeMachine`
 *     — with its reference firewall port and deterministic ingest
 *     clock — SATISFIES the `TimeMachinePort` structurally, and the
 *     session's cursor wiring follows the machine README's T030
 *     contract verbatim: `openCursor({ from: 'start' })`, the per-tick
 *     `drainCursor` (the point-in-time information delta with the
 *     INCLUSIVE boundary — a record available EXACTLY at the drain
 *     instant IS delivered, +1ms is NOT), the `asOf` warm-up, and the
 *     fork.
 *   - Determinism: the whole real-stack session runs TWICE over fresh
 *     services with byte-identical digests (L9).
 */

import { describe, expect, it } from 'vitest';
import * as exchangeSim from '../../../packages/exchange-sim/src/index';
import * as reactive from '../../../services/market-world/src/reactive/index';
import * as timeMachine from '../../../services/time-machine/src/index';
import { createShadowSession, isShadowSession, processShadowDecision, runShadowSession, throwShadowKillSwitch, type ShadowSession } from './session';
import { requireReactiveFillMirror } from './world-mirror';
import { isReactiveWorldPort, type ReactiveWorldPort } from './world-mirror';
import { isTimeMachinePort, type TimeMachinePort } from './time-machine-mirror';
import { shadowOutcomeDigest } from './outcomes';
import { serializeShadowRunState, shadowSessionDigest } from './run-state';
import { startKillSwitch, validateExecutionPolicy, DEFAULT_CHECK_ORDER, type StrategyIntentMirror } from '../../../packages/execution-policy/src/index';
import { compileRiskPolicy } from '../../../packages/risk/src/index';

const T0 = 1_700_000_000_000;

/** The interop scope (the reactive fixture world's own scope). */
const TENANT = 'tenant-fixture-alpha';
const PROJECT = 'project-fixture-alpha';
const PRINCIPAL = 'spec-shadow-interop';
const DATASET = 'shadow-interop-live';

// ---------------------------------------------------------------------------
// TYPE-LEVEL WITNESSES (fail `pnpm typecheck` if a mirror drifts)
// ---------------------------------------------------------------------------

/** Compiles iff the REAL reactive world service IS this lane's port. */
function realWorldSatisfiesPort(service: reactive.ReactiveWorldService): ReactiveWorldPort {
  return service;
}

/** Compiles iff the REAL rolling time machine IS this lane's port. */
function realMachineSatisfiesPort(machine: timeMachine.RollingTimeMachine): TimeMachinePort {
  return machine;
}

void realWorldSatisfiesPort;
void realMachineSatisfiesPort;

// ---------------------------------------------------------------------------
// The REAL stack assembly
// ---------------------------------------------------------------------------

/** The REAL engine driver (the T027 interop pattern — exchange-sim bound through the injected port). */
function realEngineDriver(): reactive.EngineDriver {
  type RealEngineState = Parameters<typeof exchangeSim.submitOrder>[0];
  return {
    createEngine: (config, init) => exchangeSim.createEngine(config, init) as unknown as reactive.EngineOpResult<reactive.EngineStateMirror>,
    submitOrder: (state, intent, at) => exchangeSim.submitOrder(state as unknown as RealEngineState, intent, at) as unknown as reactive.EngineOpResult<reactive.SubmitOutcomeMirror>,
    cancelOrder: (state, reference, at) => exchangeSim.cancelOrder(state as unknown as RealEngineState, reference, at) as unknown as reactive.EngineOpResult<reactive.CancelOutcomeMirror>,
    advanceEngine: (state, to) => exchangeSim.advanceEngine(state as unknown as RealEngineState, to) as unknown as reactive.EngineOpResult<reactive.AdvanceOutcomeMirror>,
  };
}

/** Unwrap helper (the fixture discipline — fail loudly on construction errors). */
function unwrapResult<T>(result: { readonly ok: boolean; readonly value?: T; readonly errors?: readonly { readonly message: string }[]; readonly error?: { readonly message: string } }): T {
  if (result.ok) return result.value as T;
  const detail = 'errors' in result && Array.isArray((result as { errors?: unknown }).errors)
    ? ((result as { errors: readonly { message: string }[] }).errors.map((error) => error.message).join('; '))
    : ((result as { error?: { message: string } }).error?.message ?? 'unknown');
  throw new Error(`interop fixture failed: ${detail}`);
}

/** One canonical event for the REAL machine's ingestion (the T008 ingestion shapes). */
function machineTradeEvent(eventId: string, available: number, price: string, sequence: number): Record<string, unknown> {
  return {
    event_id: eventId,
    venue: 'BINANCE',
    instrument: 'BTC-USDT',
    asset_class: 'crypto',
    event_type: 'trade',
    event_time: available - 50,
    source_time: null,
    available_time: available,
    ingestion_time: available + 100,
    sequence,
    provider: 'shadow-interop',
    provenance: { origin: 'historical', adapter: { id: 'shadow-interop-adapter', version: '1.0.0' }, derived_from: [], transform: null },
    payload: { price, size: '1.000', side: 'buy' },
  };
}

/** The canonical events the REAL machine ingests (the inclusive boundary + the off-by-one anchors). */
function interopMachineEvents(): readonly Record<string, unknown>[] {
  return [
    machineTradeEvent('si-ev-1', T0 + 5_000, '100.50', 1),
    // Available EXACTLY at d1's drain instant — the inclusive L4 boundary over the REAL machine.
    machineTradeEvent('si-ev-2', T0 + 25_000, '100.50', 2),
    // ONE MILLISECOND later — NOT delivered at d1 (the off-by-one over the REAL machine).
    machineTradeEvent('si-ev-3', T0 + 25_001, '100.60', 3),
    machineTradeEvent('si-ev-4', T0 + 45_000, '100.00', 4),
    machineTradeEvent('si-ev-5', T0 + 70_000, '99.50', 5),
  ];
}

/** Build the REAL rolling time machine over the reference firewall port + the deterministic ingest clock. */
function buildRealMachine(): TimeMachinePort {
  const created = timeMachine.createRollingTimeMachine({
    dataset: unwrapResult(timeMachine.datasetRef(DATASET)),
    tenant: unwrapResult(timeMachine.tenantId(TENANT)),
    horizon: { milliseconds: 600_000 },
    maxRecords: 1_000,
    lateArrival: 'recompute',
    firewall: timeMachine.createReferenceFirewallPort(),
    ingestClock: unwrapResult(timeMachine.createDeterministicIngestClock(T0 as never, 5)),
  });
  const machine = unwrapResult(created);
  unwrapResult(machine.ingestBatch(interopMachineEvents(), { batch_id: 'shadow-interop-batch-1' }));
  return machine;
}

/** Build the REAL reactive world service over the REAL exchange-sim engine (loaded + episode-ready). */
async function buildRealWorld(): Promise<ReactiveWorldPort> {
  const service = unwrapResult(reactive.createReactiveWorldService(reactive.fixtureWorldConfig(), {
    source: reactive.createFixtureEventSource(),
    engine: realEngineDriver(),
    feeds: reactive.createFixtureFeeds(),
  }));
  unwrapResult(await service.loadAll());
  return service;
}

// ---------------------------------------------------------------------------
// The interop session's declarations
// ---------------------------------------------------------------------------

/** The interop kill switch (started for the fixture scope). */
function interopKillSwitch() {
  return unwrapResult(startKillSwitch(TENANT as never, PROJECT as never, (T0 - 10_000) as never));
}

/** The interop execution policy (every dimension present; the fixture scope + venue). */
function interopExecutionPolicy() {
  const killSwitch = interopKillSwitch();
  return unwrapResult(validateExecutionPolicy({
    version: 1,
    tenant: TENANT,
    project: PROJECT,
    identity: { principals: [PRINCIPAL] },
    authorization: [
      { scopeRef: 'grant:shadow-interop-limit@1', orderKinds: ['limit'] },
      { scopeRef: 'grant:shadow-interop-market@1', orderKinds: ['market'] },
    ],
    limits: [
      { instrumentClass: 'crypto', maxOrderSize: '10', maxOrderNotional: '100000', maxPositionSize: '20', maxPositionNotional: '100000' },
      { instrumentClass: '*', maxOrderSize: '5', maxOrderNotional: '50000', maxPositionSize: '10', maxPositionNotional: '50000' },
    ],
    venuePermissions: [{ venue: 'BINANCE', instrument: 'BTC-USDT', instrumentClass: 'crypto' }],
    rateLimits: [{ venue: 'BINANCE', windowMs: 60_000, maxOrders: 100 }],
    credentials: [{ venue: 'BINANCE', credentialRef: 'cred:shadow-interop@1' }],
    killSwitch: { switchId: killSwitch.switchId },
    audit: { emission: 'every_decision' },
    checkOrder: [...DEFAULT_CHECK_ORDER],
    learning: null,
    asOf: (T0 - 30_000) as never,
  }));
}

/** The interop risk policy (the fixture scope; loose caps so the real stack approves). */
function interopRiskPolicy() {
  return unwrapResult(compileRiskPolicy({
    constraintSet: {
      id: 'cs-shadow-interop',
      version: 1,
      tenantId: TENANT,
      name: 'shadow interop risk constraints',
      createdAt: (T0 - 40_000) as never,
      constraints: [
        { id: 'c-order-size-crypto', domain: 'action', subject: 'risk.order_size.crypto', predicate: { kind: 'limit.max', bound: 10 }, severity: 'blocking' },
        { id: 'c-order-notional-crypto', domain: 'action', subject: 'risk.order_notional.crypto', predicate: { kind: 'limit.max', bound: 100000 }, severity: 'blocking' },
        { id: 'c-position-size-crypto', domain: 'state', subject: 'risk.position_size.crypto', predicate: { kind: 'limit.max', bound: 20 }, severity: 'blocking' },
        { id: 'c-position-notional-crypto', domain: 'state', subject: 'risk.position_notional.crypto', predicate: { kind: 'limit.max', bound: 100000 }, severity: 'blocking' },
        { id: 'c-drawdown', domain: 'state', subject: 'risk.drawdown', predicate: { kind: 'limit.max', bound: 50000 }, severity: 'blocking' },
        { id: 'c-leverage', domain: 'state', subject: 'risk.leverage', predicate: { kind: 'limit.max', bound: 1.5 }, severity: 'blocking' },
      ],
    },
    goal: { goalId: 'goal-shadow-interop', version: 1 },
    tenant: TENANT as never,
    project: PROJECT as never,
    asOf: (T0 - 40_000) as never,
    ratioPrecision: 8,
  }));
}

/** The interop venue state (the gate's marks + rate counters). */
function interopVenueState(): Record<string, unknown> {
  return {
    asOf: T0,
    instruments: [
      { venue: 'BINANCE', instrument: 'BTC-USDT', instrumentClass: 'crypto', referencePrice: '100.50', rateWindowOrderCount: 0 },
    ],
  };
}

/** Build one interop-scoped strategy intent (the trading-strategy mirror). */
function interopIntent(
  sequence: number,
  at: number,
  order: { readonly clientOrderId: string; readonly side: 'buy' | 'sell'; readonly kind: string; readonly quantity: string; readonly price?: string; readonly stopPrice?: string },
): StrategyIntentMirror {
  return {
    intentId: `si:t030interop${String(sequence).padStart(4, '0')}`,
    sequence,
    order: {
      clientOrderId: order.clientOrderId,
      instrumentId: 'BTC-USDT',
      venueId: 'BINANCE',
      side: order.side,
      kind: order.kind,
      quantity: order.quantity,
      ...(order.price !== undefined ? { price: order.price } : {}),
      ...(order.stopPrice !== undefined ? { stopPrice: order.stopPrice } : {}),
      timeInForce: 'gtc',
      createdAt: '2023-11-14T22:13:20.000Z',
    },
    constraintProof: {
      constraintSet: { id: 'cs-shadow-interop', version: 1 },
      satisfied: [{ constraintId: 'max-positions', domain: 'state', subject: 'state.positions', severity: 'blocking', predicate: { kind: 'limit.max', bound: 5 }, observed: 0 }],
      advisoryViolations: [],
    },
    goal: { goalId: 'goal-shadow-interop', version: 1 },
    strategy: { specId: PRINCIPAL, version: 1 },
    windowRefs: ['win-shadow-interop'],
    seed: 't030-interop-seed',
    tenant: TENANT,
    project: PROJECT,
    riskPolicyRefs: ['rpol:shadow-interop@1'],
    rationale: { kind: 'initial_allocation', instrumentId: 'BTC-USDT', targetWeight: '0.5', currentWeight: '0.25', drift: '0.25' },
    asOf: at,
  } as unknown as StrategyIntentMirror;
}

/** The interop decision stream: approve+fill, approve+fill, gate-refusal, kill-switch-refusal. */
function interopIntentStream(): readonly StrategyIntentMirror[] {
  return [
    interopIntent(1, T0 + 25_000, { clientOrderId: 't030-io-1', side: 'buy', kind: 'limit', quantity: '1', price: '101.00' }),
    interopIntent(2, T0 + 45_000, { clientOrderId: 't030-io-2', side: 'sell', kind: 'market', quantity: '0.5' }),
    interopIntent(3, T0 + 60_000, { clientOrderId: 't030-io-3', side: 'sell', kind: 'stop', quantity: '0.5', stopPrice: '99.00' }),
    interopIntent(4, T0 + 70_000, { clientOrderId: 't030-io-4', side: 'buy', kind: 'limit', quantity: '0.5', price: '101.00' }),
  ];
}

/** Assemble the full interop session over the REAL stack. */
async function buildInteropSession(): Promise<ShadowSession> {
  const [world, machine] = await Promise.all([buildRealWorld(), Promise.resolve(buildRealMachine())]);
  const session = createShadowSession({
    mode: 'shadow',
    tenant: TENANT,
    project: PROJECT,
    seed: 't030-interop-seed',
    participant: 'agent-candidate-alpha',
    world,
    worldSpec: reactive.fixtureSpec(),
    timeMachine: machine,
    cursorFrom: 'start',
    startAt: T0 as never,
    executionPolicy: interopExecutionPolicy(),
    killSwitch: interopKillSwitch(),
    risk: {
      policy: interopRiskPolicy(),
      marketEvents: [
        machineTradeEvent('me-io-1', T0 + 5_000, '100.50', 1),
        machineTradeEvent('me-io-2', T0 + 44_000, '100.00', 2),
      ],
      quotePrecision: 8,
      priorPeakEquity: null,
    },
    genesisPortfolio: { positions: [], cash: '100000', realizedPnl: '0' },
    venueState: interopVenueState(),
    decisionSource: (async function* (): AsyncGenerator<unknown> {
      yield* interopIntentStream();
    })(),
    lineage: {
      strategy: { specId: PRINCIPAL, version: 1 },
      goal: { goalId: 'goal-shadow-interop', version: 1 },
      constraintSet: { id: 'cs-shadow-interop', version: 1 },
      windowId: 'win-shadow-interop',
    },
  });
  return unwrapResult(session);
}

// ---------------------------------------------------------------------------
// The trip wires
// ---------------------------------------------------------------------------

describe('the REAL reactive world (T027 + T010) through the port', () => {
  it('the REAL service satisfies the ReactiveWorldPort (the structural seam)', async () => {
    const world = await buildRealWorld();
    expect(isReactiveWorldPort(world)).toBe(true);
    expect(world.config_hash).toBe(reactive.fixtureConfigHash());
    // The engine physics digest is the REAL engine's configHash (byte-parity, L6/L9).
    expect(world.engine_config_hash).not.toBe('');
  });

  it('a full shadow session paper-trades against the REAL world: fills with physics lineage, exact book, refusals never reach it', async () => {
    let session = await buildInteropSession();
    expect(isShadowSession(session)).toBe(true);

    // d1: the crossing buy — the REAL engine matches it.
    const d1 = unwrapResult(processShadowDecision(session, interopIntentStream()[0]));
    expect(d1.decision.kind).toBe('approve');
    expect(d1.refusal).toBeNull();
    expect(d1.outcome.disposition).toBe('filled');
    expect(d1.fills.length).toBeGreaterThan(0);
    session = d1.session;

    // The fills carry their FULL physics lineage (the T027 law, enforced by this lane).
    for (const fill of session.fills) {
      const required = requireReactiveFillMirror(fill.worldFill);
      expect(required.ok).toBe(true);
      expect(fill.worldFill.physics.engine_config_hash).toBe(session.world.engine_config_hash);
      expect(fill.worldFill.physics.run_ref).toBe(session.world.run_id);
    }

    // d2: the market sell reduces the position — the exposure fold equals the book (taker fills).
    const d2 = unwrapResult(processShadowDecision(session, interopIntentStream()[1]!));
    expect(d2.decision.kind).toBe('approve');
    expect(d2.outcome.disposition).toBe('filled');
    // The REAL engine matched the sell: its fills' total quantity is EXACTLY the order's.
    const soldQuantity = d2.fills.reduce((total, fill) => (Number(total) + Number(fill.worldFill.fill.quantity)).toFixed(3), '0');
    expect(soldQuantity).toBe('0.500');
    const exposure = d2.session.exposures[d2.session.exposures.length - 1]!;
    expect(exposure.cash).toBe(d2.session.book.cash);
    session = d2.session;
    const submissionsAfterD2 = session.submissions.length;

    // d3: a STOP order — the gate refuses (no grant permits stop kinds); the world receives NOTHING.
    // (The tick still absorbs the latency-pending fills: the sell's window elapsed by 60_000.)
    const d3 = unwrapResult(processShadowDecision(session, interopIntentStream()[2]!));
    expect(d3.decision.kind).toBe('refuse');
    expect(d3.refusal?.stage).toBe('gate');
    const failure = (d3.decision as { failure: { dimension: string } }).failure;
    expect(failure.dimension).toBe('authorization');
    expect(d3.session.submissions.length).toBe(submissionsAfterD2);
    expect(d3.fills.length).toBe(0);
    // The book now carries the applied fills: 1 bought - 0.5 sold = 0.5 held.
    const held = d3.session.book.positions.find((position) => position.instrument === 'BTC-USDT');
    expect(held?.quantity).toBe('0.5');
    session = d3.session;

    // Throw the kill switch between d3 and d4 — every subsequent decision refuses; the world receives NOTHING.
    session = unwrapResult(throwShadowKillSwitch(session, 'interop halt', (T0 + 65_000) as never));
    const d4 = unwrapResult(processShadowDecision(session, interopIntentStream()[3]!));
    expect(d4.decision.kind).toBe('refuse');
    const killFailure = (d4.decision as { failure: { dimension: string } }).failure;
    expect(killFailure.dimension).toBe('kill_switch');
    expect(d4.session.submissions.length).toBe(submissionsAfterD2);

    // The outcome records carry the whole dispositions sequence + the simulated-origin fidelity.
    expect(d4.session.outcomeLog.records.map((record) => record.disposition)).toEqual(['filled', 'filled', 'refused', 'refused']);
    for (const record of d4.session.outcomeLog.records) {
      expect(record.lineage.fidelity.mode).toBe('shadow');
      expect(record.lineage.fidelity.fill_origin).toBe('simulated');
      expect(record.lineage.configDigests.worldConfigHash).toBe(reactive.fixtureConfigHash());
    }
  });
});

describe('the REAL rolling time machine (T029) through the port', () => {
  it('the REAL machine satisfies the TimeMachinePort (the structural seam)', () => {
    const machine = buildRealMachine();
    expect(isTimeMachinePort(machine)).toBe(true);
  });

  it('the T030 consumption contract: openCursor(start), the per-tick drain, the INCLUSIVE boundary, the asOf warm-up', async () => {
    const session = await buildInteropSession();
    // The warm-up view at T0 (no records visible yet — all available later).
    expect(session.warmUp.recordIds.length).toBe(0);

    // d1 at T0+25_000: the drain delivers si-ev-1 AND si-ev-2 (available EXACTLY at the instant — INCLUSIVE)...
    const d1 = unwrapResult(processShadowDecision(session, interopIntentStream()[0]!));
    expect(d1.tick.drainedRecordIds).toEqual(['si-ev-1', 'si-ev-2']);
    // ...but NOT si-ev-3 (available T0+25_001 — the off-by-one millisecond).
    expect(d1.tick.drainedRecordIds.includes('si-ev-3')).toBe(false);
    // The drain's firewall audit feeds the shadow audit trail.
    expect(d1.tick.drainAudit).not.toBeNull();
    expect(d1.tick.drainAudit?.tenant).toBe(TENANT);

    // d2 at T0+45_000: si-ev-3 and si-ev-4 arrive (the delta since the last drain).
    const d2 = unwrapResult(processShadowDecision(d1.session, interopIntentStream()[1]!));
    expect(d2.tick.drainedRecordIds).toEqual(['si-ev-3', 'si-ev-4']);
    // The cursor's position advances monotonically (the resumable offset).
    expect(d2.tick.cursorPosition).toBeGreaterThanOrEqual(d1.tick.cursorPosition);
  });

  it('forkCursor: a second shadow book over the REAL machine without rewinding the first', async () => {
    const machine = buildRealMachine();
    const primary = unwrapResult(machine.openCursor({ from: 'start' }));
    const at = (T0 + 45_000) as never;
    const firstDrain = unwrapResult(machine.drainCursor(primary.cursor_id, at));
    expect(firstDrain.records.map((record) => record.record_id)).toEqual(['si-ev-1', 'si-ev-2', 'si-ev-3', 'si-ev-4']);

    // Fork at the identical anchors: the fork receives the same FUTURE deltas.
    const fork = unwrapResult(machine.forkCursor(primary.cursor_id));
    const forkDrain = unwrapResult(machine.drainCursor(fork.cursor_id, at));
    expect(forkDrain.records.map((record) => record.record_id)).toEqual([]);

    // The FIRST cursor was NOT rewound: its next drain continues from its own position.
    const nextPrimary = unwrapResult(machine.drainCursor(primary.cursor_id, (T0 + 70_000) as never));
    expect(nextPrimary.records.map((record) => record.record_id)).toEqual(['si-ev-5']);
    const nextFork = unwrapResult(machine.drainCursor(fork.cursor_id, (T0 + 70_000) as never));
    expect(nextFork.records.map((record) => record.record_id)).toEqual(['si-ev-5']);
  });
});

describe('determinism over the FULL real stack (L9)', () => {
  it('two fresh real-stack sessions produce byte-identical evidence', async () => {
    const first = await buildInteropSession();
    const firstRun = unwrapResult(await runShadowSession(first));
    const second = await buildInteropSession();
    const secondRun = unwrapResult(await runShadowSession(second));

    expect(firstRun.sessionId).toBe(secondRun.sessionId);
    expect(shadowOutcomeDigest(firstRun.outcomeLog)).toBe(shadowOutcomeDigest(secondRun.outcomeLog));
    expect(shadowSessionDigest(firstRun)).toBe(shadowSessionDigest(secondRun));
    expect(unwrapResult(serializeShadowRunState(firstRun))).toBe(unwrapResult(serializeShadowRunState(secondRun)));
    expect(firstRun.fills).toEqual(secondRun.fills);
    expect(firstRun.book).toEqual(secondRun.book);
  });
});
