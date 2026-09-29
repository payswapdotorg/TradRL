/**
 * The ReactiveWorldService behavioral battery (work order T027).
 *
 * THE REAL ENGINE IS BOUND: every test drives this lane's service over the
 * REAL @tradrl/exchange-sim MatchingEngine through the injected
 * EngineDriver port (the binding helper below is the mirror seam — its
 * type-level witnesses prove the shapes align; the golden byte-identity
 * tests in fixtures.test.ts prove the behavior). No test doubles for the
 * engine: the reactive difference is only ever demonstrated against real
 * exchange physics.
 *
 * Behavioral coverage (the Work Order's acceptance criteria):
 *   - positive paths: load-then-bind, seeding, the five operations;
 *   - the reactive difference: a candidate intent is MATCHED (fills with
 *     full physics lineage — criterion 4's reactive half);
 *   - negative paths, one typed law per test:
 *     * L5 fidelity_claim_dishonest (criterion 5 — config, spec, record),
 *     * L4 l4_boundary_violation (criterion 6 — the delivery gate),
 *     * physics_lineage_missing / lineage_gap / tenant_missing (criteria
 *       7 + 10 — the fill and record guards),
 *     * interleaving_violation (criterion 8 — acting mid-stream-step),
 *     * anti-poisoning synthetic_event_rejected, stream_not_selected,
 *       event_beyond_as_of, sequence_regression, duplicate_event_id,
 *     * the episode lifecycle laws, the action causal laws;
 *   - immutability: every public record deeply frozen.
 */

import { describe, expect, it } from 'vitest';
import * as exchangeSim from '../../../../packages/exchange-sim/src/index';
import type { EngineDriver, EngineStateMirror, SubmitOutcomeMirror, CancelOutcomeMirror, AdvanceOutcomeMirror } from './exchange-mirror';
import type { EngineOpResult } from './exchange-mirror';
import { isEngineDriver, validateExchangePhysics, physicsHash } from './exchange-mirror';
import { createReactiveWorldService } from './service';
import type { ReactiveWorldService } from './service';
import {
  fixtureWorldConfig,
  fixtureSpec,
  fixturePhysics,
  createFixtureEventSource,
  createFixtureFeeds,
  fixtureRecordedBatches,
} from './fixtures';
import { validateReactiveWorldConfig, configHash } from './config';
import {
  admitObservation,
  requireReactiveFill,
  requireReactiveRunRecord,
} from './records';
import type { ReactiveFillRecord, ReactiveObservation } from './records';
import { createScriptedActionFeed } from './action-feed';
import { isDeeplyFrozen } from './primitives';
import type { ReactiveResult } from './errors';

const T0 = 1_700_000_000_000;

// ---------------------------------------------------------------------------
// The REAL engine binding (the mirror seam)
// ---------------------------------------------------------------------------

/** The real engine's state type (the canonical side of the mirror). */
type RealEngineState = Parameters<typeof exchangeSim.submitOrder>[0];

/**
 * Bind the REAL exchange-sim reducer to this lane's EngineDriver port.
 * The casts are the documented mirror seam (D-003/D-004): the REAL
 * EngineState is structurally the mirror (witness below compiles), and the
 * state object handed through the port IS the real engine's own value at
 * runtime — the cast re-brands nothing, it only satisfies the plain-string
 * mirror view. The byte-identity tests in fixtures.test.ts prove the
 * behavior end-to-end.
 */
function realEngineDriver(): EngineDriver {
  return {
    createEngine: (config, init) => exchangeSim.createEngine(config, init) as EngineOpResult<EngineStateMirror>,
    submitOrder: (state, intent, at) => exchangeSim.submitOrder(state as unknown as RealEngineState, intent, at) as EngineOpResult<SubmitOutcomeMirror>,
    cancelOrder: (state, reference, at) => exchangeSim.cancelOrder(state as unknown as RealEngineState, reference, at) as EngineOpResult<CancelOutcomeMirror>,
    advanceEngine: (state, to) => exchangeSim.advanceEngine(state as unknown as RealEngineState, to) as EngineOpResult<AdvanceOutcomeMirror>,
  };
}

/** Compiles iff the REAL engine state is structurally this lane's mirror (the seam is honest). */
function realEngineStateIsMirror(state: RealEngineState): EngineStateMirror {
  return state;
}

/** Compiles iff a REAL fill record is structurally this lane's FillMirror. */
function realFillIsMirror(fill: exchangeSim.Fill): Parameters<typeof import('./exchange-mirror').isFillMirror>[0] {
  return fill;
}

// ---------------------------------------------------------------------------
// Test plumbing
// ---------------------------------------------------------------------------

function unwrap<T>(result: ReactiveResult<T>): T {
  if (result.ok) return result.value;
  throw new Error(`operation failed: ${JSON.stringify(result.errors)}`);
}

function expectFailure(result: { readonly ok: boolean; readonly errors?: readonly { readonly code: string; readonly message: string }[] }, code: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('unreachable');
  const errors = result.errors ?? [];
  expect(errors.length).toBeGreaterThan(0);
  expect(errors[0]?.code).toBe(code);
}

function freshInputs(): { readonly source: ReturnType<typeof createFixtureEventSource>; readonly engine: EngineDriver; readonly feeds: ReturnType<typeof createFixtureFeeds> } {
  return { source: createFixtureEventSource(), engine: realEngineDriver(), feeds: createFixtureFeeds() };
}

async function startedService(): Promise<{ service: ReactiveWorldService; episode: string }> {
  const service = unwrap(createReactiveWorldService(fixtureWorldConfig(), freshInputs()));
  unwrap(await service.loadAll());
  const started = unwrap(service.start(fixtureSpec()));
  return { service, episode: started.episode_id };
}

/** The crossing candidate order used across the battery (the reactive-difference probe). */
function crossingAction(at: number, sequence = 1): Record<string, unknown> {
  return {
    action_id: `probe-${String(sequence).padStart(2, '0')}`,
    actor: 'agent-candidate-alpha',
    submitted_at: at,
    client_sequence: sequence,
    payload: {
      type: 'submit_order',
      intent: {
        clientOrderId: `probe-cli-${String(sequence).padStart(2, '0')}`,
        instrumentId: 'BTC-USDT',
        venueId: 'BINANCE',
        side: 'buy',
        kind: 'limit',
        quantity: '2',
        price: '100.50',
        timeInForce: 'gtc',
        createdAt: '2026-01-01T00:00:00Z',
      },
    },
  };
}

/** Advance until settled (the driver-side catch-up loop). */
function settle(service: ReactiveWorldService, episode: string, to: number): void {
  for (let iteration = 0; iteration < 10_000; iteration++) {
    const view = unwrap(service.advance(episode, to as never));
    if (view.settled) return;
  }
  throw new Error('settle loop did not converge');
}

// ---------------------------------------------------------------------------
// The battery
// ---------------------------------------------------------------------------

describe('the reactive world service — construction + load-then-bind', () => {
  it('rejects an invalid engine driver (the engine is a declared input)', () => {
    const broken = createReactiveWorldService(fixtureWorldConfig(), { source: createFixtureEventSource(), engine: {} as EngineDriver, feeds: createFixtureFeeds() });
    expectFailure(broken, 'invalid_engine_driver');
  });

  it('rejects a config whose engine physics the REAL engine refuses (fail-early probe)', () => {
    const config = fixtureWorldConfig();
    const physics = config.exchange as Record<string, unknown>;
    (physics as { impact: Record<string, unknown> }).impact = { kind: 'reactive_fade', declaration: 'x', limitation: 'y' };
    const created = createReactiveWorldService(config, freshInputs());
    expect(created.ok).toBe(false); // the mirror's fail-close OR the engine probe — either way, typed
  });

  it('the REAL engine driver satisfies the port guard', () => {
    expect(isEngineDriver(realEngineDriver())).toBe(true);
    void realEngineStateIsMirror;
    void realFillIsMirror;
  });

  it('start before loadAll fails (the load-then-bind discipline)', async () => {
    const service = unwrap(createReactiveWorldService(fixtureWorldConfig(), freshInputs()));
    const started = service.start(fixtureSpec());
    expectFailure(started, 'invalid_state');
  });

  it('loadAll digests the stream into a chain; a second service over the same source chains identically', async () => {
    const first = unwrap(createReactiveWorldService(fixtureWorldConfig(), freshInputs()));
    const summaryA = unwrap(await first.loadAll());
    const second = unwrap(createReactiveWorldService(fixtureWorldConfig(), freshInputs()));
    const summaryB = unwrap(await second.loadAll());
    expect(summaryA.batches).toBe(fixtureRecordedBatches().length);
    expect(summaryA.chain_head).toBe(summaryB.chain_head);
    expect(summaryA.events).toBe(summaryB.events);
  });
});

describe('the reactive world service — episode lifecycle laws', () => {
  it('starts an episode with the engine seeded from the latest recorded snapshot available at the start instant', async () => {
    const { service, episode } = await startedService();
    const view = unwrap(service.observe(episode, T0 as never));
    // The seed snapshot (rf-000001, available AT T0) is observable at T0.
    expect(view.some((observation) => observation.observation_id === 'rf-000001')).toBe(true);
    // The engine carries the seeded book.
    const engine = unwrap(service.engineState(episode));
    expect(engine.book.asks.length).toBeGreaterThan(0);
    expect(engine.book.bids.length).toBeGreaterThan(0);
    expect(engine.now).toBe(T0);
  });

  it('rejects a spec claiming exact_replay fidelity (L5 — the mode is a first-class honesty field)', async () => {
    const service = unwrap(createReactiveWorldService(fixtureWorldConfig(), freshInputs()));
    unwrap(await service.loadAll());
    const spec = fixtureSpec();
    const dishonest = JSON.parse(JSON.stringify(spec)) as Record<string, unknown>;
    const profile = dishonest.profile as Record<string, unknown>;
    profile.fidelity = 'exact_replay';
    (profile.clock as Record<string, unknown>).fidelity = 'exact_replay';
    expectFailure(service.start(dishonest), 'fidelity_claim_dishonest');
  });

  it('rejects a spec bound to another world (world_binding_mismatch)', async () => {
    const service = unwrap(createReactiveWorldService(fixtureWorldConfig(), freshInputs()));
    unwrap(await service.loadAll());
    const spec = JSON.parse(JSON.stringify(fixtureSpec())) as Record<string, unknown>;
    (spec.world as Record<string, unknown>).world_id = 'world-somewhere-else';
    expectFailure(service.start(spec), 'world_binding_mismatch');
  });

  it('rejects a duplicate episode (an episode id is a unique run)', async () => {
    const service = unwrap(createReactiveWorldService(fixtureWorldConfig(), freshInputs()));
    unwrap(await service.loadAll());
    unwrap(service.start(fixtureSpec()));
    expectFailure(service.start(fixtureSpec()), 'duplicate_episode');
  });

  it('observe beyond now fails (L4 — observation_beyond_now)', async () => {
    const { service, episode } = await startedService();
    expectFailure(service.observe(episode, (T0 + 1) as never), 'observation_beyond_now');
  });

  it('advance refuses regressions and beyond-asOf targets', async () => {
    const { service, episode } = await startedService();
    expectFailure(service.advance(episode, -1 as never), 'invalid_timestamp');
    expectFailure(service.advance(episode, (T0 - 1) as never), 'clock_regression');
    expectFailure(service.advance(episode, (T0 + 10_000_000) as never), 'beyond_as_of');
  });

  it('finish requires a valid termination reason; double finish is typed', async () => {
    const { service, episode } = await startedService();
    expectFailure(service.finish(episode, { code: 'nope', detail: 'x' }), 'invalid_termination');
    unwrap(service.finish(episode, { code: 'completed', detail: 'done' }));
    expectFailure(service.finish(episode, { code: 'completed', detail: 'again' }), 'episode_finished');
    expectFailure(service.submit(episode, crossingAction(T0)), 'episode_finished');
  });

  it('the run record is available only for a FINISHED episode', async () => {
    const { service, episode } = await startedService();
    expectFailure(service.runRecord(episode), 'episode_not_finished');
    unwrap(service.finish(episode, { code: 'completed', detail: 'done' }));
    const record = unwrap(service.runRecord(episode));
    expect(record.schema).toBe('tradrl/reactive-run-record@1');
    expect(record.world.mode).toBe('reactive_replay');
  });
});

describe('the reactive difference — participant intents are MATCHED (criterion 4, reactive half)', () => {
  it('a crossing candidate order produces engine fills with FULL physics lineage + an engine_matched receipt', async () => {
    const { service, episode } = await startedService();
    const submitted = unwrap(service.submit(episode, crossingAction(T0)));
    expect(submitted.receipt.disposition).toBe('engine_matched');
    expect(submitted.receipt.engine.kind).toBe('ack');
    expect(submitted.receipt.engine.fill_ids.length).toBe(1);

    const fills = unwrap(service.fills(episode));
    expect(fills.length).toBe(1);
    const fill = fills[0] as ReactiveFillRecord;
    // The engine's own record, verbatim: the print, the aggressor price, both fees, the latency.
    expect(fill.fill.price).toBe('100.5'); // canonical decimal ('100.50' normalizes)
    expect(fill.fill.quantity).toBe('2');
    expect(fill.fill.taker_fee).toMatch(/^\d+(\.\d+)?$/);
    expect(fill.fill.maker_fee).toMatch(/^\d+(\.\d+)?$/);
    expect(fill.fill.latency_ms).toBeGreaterThanOrEqual(0);
    // The physics lineage: engine config hash + all four policy refs + run ref + tenant/project.
    const physics = unwrap(validateExchangePhysics(fixturePhysics()));
    expect(fill.physics.engine_config_hash).toBe(physicsHash(physics));
    expect(fill.physics.fee_policy).toMatch(/^fees:/);
    expect(fill.physics.latency_policy).toMatch(/^latency:/);
    expect(fill.physics.slippage_policy).toMatch(/^slippage:/);
    expect(fill.physics.impact_policy).toMatch(/^impact:/);
    expect(fill.physics.run_ref).toBe(service.run_id);
    expect(fill.physics.tenant).toBe('tenant-fixture-alpha');
    expect(fill.physics.project).toBe('project-fixture-alpha');
    expect(fill.taker_participant).toBe('agent-candidate-alpha');
    // The total fill guard passes (the law, not just the shape).
    expect(unwrap(requireReactiveFill(fill))).toBe(fill);
  });

  it('the fill moves the book: the engine state records the consumption', async () => {
    const { service, episode } = await startedService();
    const before = unwrap(service.engineState(episode));
    unwrap(service.submit(episode, crossingAction(T0)));
    const after = unwrap(service.engineState(episode));
    expect(after.fills.length).toBe(before.fills.length + 1);
    expect(after.orders.length).toBe(before.orders.length + 1);
    // The 100.50 ask level shrank from 4 to 2 (canonical decimals).
    const ask = after.book.asks[0];
    expect(ask?.price).toBe('100.5');
    expect(ask?.orders[0]?.remaining).toBe('2');
  });

  it('the embargoed fill is NOT observable before its latency window elapses (L4 over engine outcomes)', async () => {
    const { service, episode } = await startedService();
    const submitted = unwrap(service.submit(episode, crossingAction(T0)));
    const fill = (unwrap(service.fills(episode))[0] as ReactiveFillRecord).fill;
    // Advance the clock past the fill's availability (the clock must cover the query).
    settle(service, episode, fill.quartet.available_time as number);
    // The fill observation carries the engine's fill record in its payload
    // (observation ids are minted rmo-*; the fill id rides the payload).
    const isFillObservation = (observation: ReactiveObservation): boolean => {
      if (typeof observation.payload !== 'object' || observation.payload === null || Array.isArray(observation.payload)) return false;
      const payload = observation.payload as { readonly [key: string]: unknown };
      if (payload.kind !== 'fill') return false;
      const data = payload.data as { readonly fill_id?: unknown } | undefined;
      return data?.fill_id === submitted.receipt.engine.fill_ids[0];
    };
    const beforeAvailable = (fill.quartet.available_time - 1) as number;
    const atBefore = unwrap(service.observe(episode, beforeAvailable as never));
    expect(atBefore.some(isFillObservation)).toBe(false);
    const atAvailable = unwrap(service.observe(episode, fill.quartet.available_time));
    expect(atAvailable.some(isFillObservation)).toBe(true);
  });
});

describe('the action causal laws (both channels: driver + scripted feeds)', () => {
  it('an undeclared actor is rejected (endogenous actors are declared, never ambient)', async () => {
    const { service, episode } = await startedService();
    const action = crossingAction(T0);
    (action as Record<string, unknown>).actor = 'agent-who-was-never-declared';
    expectFailure(service.submit(episode, action), 'unknown_participant');
  });

  it('a stale client_sequence is rejected (per-actor request ordering)', async () => {
    const { service, episode } = await startedService();
    unwrap(service.submit(episode, crossingAction(T0, 5)));
    expectFailure(service.submit(episode, crossingAction(T0, 5)), 'stale_sequence');
    expectFailure(service.submit(episode, crossingAction(T0, 4)), 'stale_sequence');
  });

  it('a duplicate action id is rejected (unique per episode, across both channels)', async () => {
    const { service, episode } = await startedService();
    unwrap(service.submit(episode, crossingAction(T0, 1)));
    // The SAME action id with a fresh (valid) sequence: the id is the violation.
    const replayed = crossingAction(T0, 2);
    (replayed as Record<string, unknown>).action_id = 'probe-01';
    expectFailure(service.submit(episode, replayed), 'duplicate_action');
  });

  it('an action claiming a future instant is rejected (action_from_future)', async () => {
    const { service, episode } = await startedService();
    expectFailure(service.submit(episode, crossingAction(T0 + 10_000, 1)), 'action_from_future');
  });

  it('an action claiming an instant the engine has passed is rejected (arrival_before_engine)', async () => {
    const { service, episode } = await startedService();
    settle(service, episode, T0 + 35_000);
    // The engine clock is at 35_000; an action claiming 25_000 cannot retro-match.
    expectFailure(service.submit(episode, crossingAction((T0 + 25_000) as number, 1)), 'arrival_before_engine');
  });
});

describe('the declared interleaving (criterion 8 — the order IS the deterministic function)', () => {
  it('under stream_first, submitting while a recorded event at/before now is unabsorbed is a typed interleaving_violation', async () => {
    const { service, episode } = await startedService();
    // ONE advance to 25_000: the boundary machine processes the FIRST
    // boundary only (the adversary's 10_000 action) — the 20_000 quote is
    // still pending while the clock already stands at 25_000.
    const view = unwrap(service.advance(episode, (T0 + 25_000) as never));
    expect(view.clock.now).toBe(T0 + 25_000);
    expect(view.pending_stream_events).toBe(1);
    expect(view.settled).toBe(false);
    // Acting mid-stream-step: the typed error (the law, not a queue jump).
    expectFailure(service.submit(episode, crossingAction((T0 + 25_000) as number, 1)), 'interleaving_violation');
    // After settling, the SAME action is legal — the error was the policy, not the action.
    settle(service, episode, T0 + 25_000);
    unwrap(service.submit(episode, crossingAction((T0 + 25_000) as number, 1)));
  });

  it('under unrestricted, the same submit is legal at the rest point (the policy is a declaration, not a universal)', async () => {
    const service = unwrap(createReactiveWorldService(fixtureWorldConfig({ interleaving: 'unrestricted' }), freshInputs()));
    unwrap(await service.loadAll());
    const started = unwrap(service.start(fixtureSpec({ interleaving: 'unrestricted' })));
    const episode = started.episode_id;
    unwrap(service.advance(episode, (T0 + 25_000) as never));
    const submitted = unwrap(service.submit(episode, crossingAction((T0 + 25_000) as number, 1)));
    expect(submitted.receipt.disposition).toBe('engine_matched');
  });
});

describe('the L4 delivery gate (criterion 6 — defense in depth)', () => {
  it('admitObservation fails l4_boundary_violation for an observation leaked past the boundary', () => {
    const observation: ReactiveObservation = {
      observation_id: 'leaked-1',
      available_time: (T0 + 1_000) as never,
      venue: 'BINANCE',
      instrument: 'BTC-USDT',
      payload: { probe: true },
      provenance: { origin: 'simulated', source: 'probe', derived_from: [] },
      run_ref: 'run-probe',
      tenant: 'tenant-fixture-alpha' as never,
      project: 'project-fixture-alpha' as never,
    };
    expectFailure(admitObservation(observation, T0 as never), 'l4_boundary_violation');
    // The INCLUSIVE boundary: available_time == at is legal.
    expect(unwrap(admitObservation(observation, (T0 + 1_000) as never))).toBe(observation);
  });

  it('the recorded embargo holds: the 40ms-embargoed trade is invisible at event_time and visible at availability', async () => {
    const { service, episode } = await startedService();
    settle(service, episode, T0 + 26_000);
    const before = unwrap(service.observe(episode, (T0 + 25_020) as never));
    expect(before.some((observation) => observation.observation_id === 'rf-000003')).toBe(false);
    const after = unwrap(service.observe(episode, (T0 + 25_040) as never));
    expect(after.some((observation) => observation.observation_id === 'rf-000003')).toBe(true);
  });

  it('recorded observations carry historical origin; engine outcomes carry simulated origin (L5/L6 anti-conflation)', async () => {
    const { service, episode } = await startedService();
    unwrap(service.submit(episode, crossingAction(T0)));
    settle(service, episode, T0 + 26_000);
    const observations = unwrap(service.observe(episode, (T0 + 26_000) as never));
    const historical = observations.filter((observation) => observation.provenance.origin === 'historical');
    const simulated = observations.filter((observation) => observation.provenance.origin === 'simulated');
    expect(historical.length).toBeGreaterThan(0);
    expect(simulated.length).toBeGreaterThan(0);
    for (const observation of observations) {
      expect(observation.run_ref).toBe(service.run_id);
      expect(observation.tenant).toBe('tenant-fixture-alpha');
      expect(observation.project).toBe('project-fixture-alpha');
    }
  });
});

describe('the physics-lineage law (criteria 7 + 10 — the guards are total)', () => {
  const goldenFill = (): Record<string, unknown> => ({
    fill: {
      fill_id: 'xo-fill-00000001',
      trade_id: 'xo-fill-00000001',
      venue: 'BINANCE',
      instrument: 'BTC-USDT',
      quartet: { event_time: T0, source_time: null, available_time: T0, ingestion_time: T0 },
      sequence: 1,
      taker_order_id: 'xo-order-00000001',
      maker_order_id: 'xo-seed-ask-0',
      aggressor_side: 'buy',
      price: '100.50',
      aggressor_price: '100.50',
      quantity: '2',
      taker_fee: '0.02',
      maker_fee: '0.01',
      latency_ms: 120,
    },
    fill_id: 'xo-fill-00000001',
    episode_id: 'ep-probe',
    run_ref: 'run-probe',
    taker_participant: 'agent-candidate-alpha',
    taker_order_id: 'xo-order-00000001',
    maker_order_id: 'xo-seed-ask-0',
    physics: {
      engine_config_hash: 'deadbeef',
      fee_policy: 'fees:deadbeef',
      latency_policy: 'latency:deadbeef',
      slippage_policy: 'slippage:deadbeef',
      impact_policy: 'impact:deadbeef',
      run_ref: 'run-probe',
      tenant: 'tenant-fixture-alpha',
      project: 'project-fixture-alpha',
    },
  });

  it('a fill without a physics lineage block fails physics_lineage_missing', () => {
    const fill = goldenFill();
    delete fill.physics;
    expectFailure(requireReactiveFill(fill), 'physics_lineage_missing');
  });

  it('a fill missing one policy ref fails physics_lineage_missing (each ref is lineage)', () => {
    for (const field of ['fee_policy', 'latency_policy', 'slippage_policy', 'impact_policy', 'engine_config_hash']) {
      const fill = goldenFill();
      delete (fill.physics as Record<string, unknown>)[field];
      expectFailure(requireReactiveFill(fill), 'physics_lineage_missing');
    }
  });

  it('a fill without its run binding fails lineage_gap (criterion 10)', () => {
    const fill = goldenFill();
    delete fill.run_ref;
    expectFailure(requireReactiveFill(fill), 'lineage_gap');
  });

  it('a fill without the engine record refs fails lineage_gap', () => {
    const fill = goldenFill();
    delete fill.taker_order_id;
    expectFailure(requireReactiveFill(fill), 'lineage_gap');
  });

  it('a fill without tenant/project fails tenant_missing (criterion 10 — L12)', () => {
    const noTenant = goldenFill();
    delete (noTenant.physics as Record<string, unknown>).tenant;
    expectFailure(requireReactiveFill(noTenant), 'tenant_missing');
    const noProject = goldenFill();
    delete (noProject.physics as Record<string, unknown>).project;
    expectFailure(requireReactiveFill(noProject), 'tenant_missing');
  });

  it('a run record claiming exact_replay fidelity fails fidelity_claim_dishonest (criterion 5 — the record-level trip-wire)', async () => {
    const { service, episode } = await startedService();
    unwrap(service.finish(episode, { code: 'completed', detail: 'probe' }));
    const record = unwrap(service.runRecord(episode));
    const honest = unwrap(requireReactiveRunRecord(record));
    expect(honest.world.mode).toBe('reactive_replay');
    const liar = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
    (liar.world as Record<string, unknown>).mode = 'exact_replay';
    expectFailure(requireReactiveRunRecord(liar), 'fidelity_claim_dishonest');
  });

  it('a run record without tenant/project or run id fails its guard (criterion 10)', async () => {
    const { service, episode } = await startedService();
    unwrap(service.finish(episode, { code: 'completed', detail: 'probe' }));
    const record = unwrap(service.runRecord(episode));
    const noTenant = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
    delete (noTenant.world as Record<string, unknown>).tenant;
    expectFailure(requireReactiveRunRecord(noTenant), 'tenant_missing');
    const noRun = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
    delete noRun.run_id;
    expectFailure(requireReactiveRunRecord(noRun), 'lineage_gap');
  });
});

describe('the stream ingestion laws (anti-poisoning + the recorded disciplines)', () => {
  async function loadServiceWithBatch(batch: readonly Record<string, unknown>[]): Promise<ReactiveWorldService> {
    const source = {
      async *[Symbol.asyncIterator](): AsyncIterator<readonly unknown[], void, undefined> {
        yield [...batch];
      },
    };
    const service = unwrap(createReactiveWorldService(fixtureWorldConfig(), { source, engine: realEngineDriver(), feeds: createFixtureFeeds() }));
    return service;
  }

  it('a synthetic-origin event is rejected (anti-poisoning — the recorded stream is history only)', async () => {
    const batches = fixtureRecordedBatches();
    const poisoned = JSON.parse(JSON.stringify(batches[0])) as Record<string, unknown>[];
    ((poisoned[1] as Record<string, unknown>).provenance as Record<string, unknown>).origin = 'simulated';
    const service = await loadServiceWithBatch(poisoned);
    expectFailure(await service.loadNextBatch(), 'synthetic_event_rejected');
  });

  it('an event from an unselected stream is rejected', async () => {
    const batches = fixtureRecordedBatches();
    const stray = JSON.parse(JSON.stringify(batches[0])) as Record<string, unknown>[];
    (stray[1] as Record<string, unknown>).venue = 'COINBASE';
    const service = await loadServiceWithBatch(stray);
    expectFailure(await service.loadNextBatch(), 'stream_not_selected');
  });

  it('an event beyond the as_of anchor is rejected', async () => {
    const batches = fixtureRecordedBatches();
    const late = JSON.parse(JSON.stringify(batches[0])) as Record<string, unknown>[];
    (late[1] as Record<string, unknown>).available_time = T0 + 10_000_000;
    const service = await loadServiceWithBatch(late);
    expectFailure(await service.loadNextBatch(), 'event_beyond_as_of');
  });

  it('a per-stream sequence regression is rejected', async () => {
    const batches = fixtureRecordedBatches();
    const regressed2 = JSON.parse(JSON.stringify(batches[1])) as Record<string, unknown>[];
    (regressed2[0] as Record<string, unknown>).sequence = 1; // the quote stream: the previous quote carried sequence 1
    const firstBatch = JSON.parse(JSON.stringify(batches[0])) as Record<string, unknown>[];
    const source = {
      async *[Symbol.asyncIterator](): AsyncIterator<readonly unknown[], void, undefined> {
        // A clean first batch: the seed snapshot + the first quote (quote stream sequence 1).
        yield [firstBatch[0] as unknown, firstBatch[1] as unknown];
        // Then a quote regressing the quote stream's sequence (1 <= 1).
        yield [regressed2[0] as unknown];
      },
    };
    const service = unwrap(createReactiveWorldService(fixtureWorldConfig(), { source, engine: realEngineDriver(), feeds: createFixtureFeeds() }));
    unwrap(await service.loadNextBatch());
    expectFailure(await service.loadNextBatch(), 'sequence_regression');
  });

  it('a duplicate event id is rejected across batches', async () => {
    const batches = fixtureRecordedBatches();
    const first = batches[0] as readonly Record<string, unknown>[];
    const clone = JSON.parse(JSON.stringify(first[0])) as Record<string, unknown>;
    clone.sequence = 2; // pass the sequence discipline so the DUPLICATE ID check bites
    const source = {
      async *[Symbol.asyncIterator](): AsyncIterator<readonly unknown[], void, undefined> {
        yield [...first];
        yield [clone];
      },
    };
    const service = unwrap(createReactiveWorldService(fixtureWorldConfig(), { source, engine: realEngineDriver(), feeds: createFixtureFeeds() }));
    unwrap(await service.loadNextBatch());
    expectFailure(await service.loadNextBatch(), 'duplicate_event_id');
  });
});

describe('the scripted action feed laws', () => {
  it('a script that goes back in time is rejected up front (interleaving_violation)', () => {
    const script = [
      { at: T0 + 10_000, action: { action_id: 'a1', actor: 'agent-adversary-beta', submitted_at: T0 + 10_000, client_sequence: 1, payload: {} } },
      { at: T0 + 5_000, action: { action_id: 'a2', actor: 'agent-adversary-beta', submitted_at: T0 + 5_000, client_sequence: 2, payload: {} } },
    ];
    expectFailure(createScriptedActionFeed('agent-adversary-beta' as never, script), 'interleaving_violation');
  });

  it('a feed may not act as someone else', () => {
    const script = [
      { at: T0 + 10_000, action: { action_id: 'a1', actor: 'agent-someone-else', submitted_at: T0 + 10_000, client_sequence: 1, payload: {} } },
    ];
    const result = createScriptedActionFeed('agent-adversary-beta' as never, script);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('invalid_field');
  });

  it('scripted participants trade against the engine through the boundary machine (their fills carry lineage too)', async () => {
    const { service, episode } = await startedService();
    settle(service, episode, T0 + 35_000);
    const fills = unwrap(service.fills(episode));
    const adversaryFills = fills.filter((fill) => fill.taker_participant === 'agent-adversary-beta');
    expect(adversaryFills.length).toBeGreaterThan(0);
    for (const fill of adversaryFills) {
      expect(unwrap(requireReactiveFill(fill))).toBe(fill);
    }
  });
});

describe('the L5 config law + L9 config lineage', () => {
  it('a config claiming mode exact_replay fails fidelity_claim_dishonest (the config-level trip-wire)', () => {
    const config = JSON.parse(JSON.stringify(fixtureWorldConfig())) as Record<string, unknown>;
    config.mode = 'exact_replay';
    const result = validateReactiveWorldConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('fidelity_claim_dishonest');
  });

  it('a config missing tenant/project fails validation (L12)', () => {
    const config = JSON.parse(JSON.stringify(fixtureWorldConfig())) as Record<string, unknown>;
    delete config.tenant;
    const result = validateReactiveWorldConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('missing_field');
  });

  it('a roster without exactly one candidate fails validation', () => {
    const config = JSON.parse(JSON.stringify(fixtureWorldConfig())) as Record<string, unknown>;
    (config.participants as Record<string, unknown>[])[0] = { instance: 'agent-extra', role: 'adversary', feed: 'feed-extra' };
    const result = validateReactiveWorldConfig(config);
    expect(result.ok).toBe(false);
  });

  it('equal configs hash identically regardless of field order (L9 canonical form)', () => {
    const a = unwrap(validateReactiveWorldConfig(fixtureWorldConfig()));
    const reordered = JSON.parse(JSON.stringify(fixtureWorldConfig())) as Record<string, unknown>;
    const streams = reordered.streams as Record<string, unknown>[];
    streams.reverse();
    const b = unwrap(validateReactiveWorldConfig(reordered));
    expect(configHash(a)).toBe(configHash(b));
  });
});

describe('immutability (L3 — everything public is deeply frozen)', () => {
  it('the views, fills, observations and run record are deeply frozen', async () => {
    const { service, episode } = await startedService();
    unwrap(service.submit(episode, crossingAction(T0)));
    settle(service, episode, T0 + 35_000);
    const view = unwrap(service.advance(episode, (T0 + 35_000) as never));
    expect(isDeeplyFrozen(view)).toBe(true);
    expect(isDeeplyFrozen(unwrap(service.fills(episode)))).toBe(true);
    expect(isDeeplyFrozen(unwrap(service.observe(episode, (T0 + 35_000) as never)))).toBe(true);
    unwrap(service.finish(episode, { code: 'completed', detail: 'freeze probe' }));
    expect(isDeeplyFrozen(unwrap(service.runRecord(episode)))).toBe(true);
    expect(isDeeplyFrozen(unwrap(service.exportRunState(episode)))).toBe(true);
  });

  it('returned arrays are frozen: mutation throws and the world is untouched (fresh, frozen copies out)', async () => {
    const { service, episode } = await startedService();
    const fillsBefore = unwrap(service.fills(episode)).length;
    const returned = unwrap(service.fills(episode)) as unknown[] as ReactiveFillRecord[];
    expect(() => returned.pop()).toThrow(); // the copy itself is deeply frozen (L3)
    expect(unwrap(service.fills(episode)).length).toBe(fillsBefore);
  });
});
