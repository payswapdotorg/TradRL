/**
 * The GenerativeWorldService behavioral battery (work order T028).
 *
 * THE REAL ENGINE IS BOUND: every test drives this lane's service over the
 * REAL @tradrl/exchange-sim MatchingEngine through the injected
 * EngineDriver port (the binding helper below is the mirror seam — its
 * type-level witnesses prove the shapes align; the golden byte-identity
 * tests in fixtures.test.ts prove the behavior). No test doubles for the
 * engine: the generative difference is only ever demonstrated against real
 * exchange physics.
 *
 * Behavioral coverage (the Work Order's acceptance criteria):
 *   - positive paths: construction, arming, seeding, the five operations;
 *   - the generative difference: the generated population's intents AND
 *     the candidate's intents are MATCHED (fills with full physics
 *     lineage — criterion 4);
 *   - negative paths, one typed law per test:
 *     * L5 fidelity_claim_dishonest (criterion 5 — config, spec, record,
 *       and the exchange mode coherence),
 *     * process_undeclared (the generative existential law — unknown
 *       policy refs, missing anchor, orphan policies, unlineaged events),
 *     * synthetic_provenance_missing (criterion 5 — the L6 declaration),
 *     * L4 l4_boundary_violation (criterion 6 — the delivery gate),
 *     * physics_lineage_missing / lineage_gap / tenant_missing (criteria
 *       7 + 10 — the fill, event and record guards),
 *     * interleaving_violation (criterion 8 — acting mid-process-step),
 *     * the candidate law (actor_not_candidate / unknown_participant),
 *     * the episode lifecycle laws, the action causal laws;
 *   - immutability: every public record deeply frozen.
 */

import { describe, expect, it } from 'vitest';
import * as exchangeSim from '../../../../packages/exchange-sim/src/index';
import type { EngineDriver, EngineStateMirror, SubmitOutcomeMirror, CancelOutcomeMirror, AdvanceOutcomeMirror, EngineOpResult } from './exchange-mirror';
import { isEngineDriver, physicsHash, validateExchangePhysics } from './exchange-mirror';
import { createGenerativeWorldService } from './service';
import type { GenerativeWorldService } from './service';
import { fixturePhysics, fixtureSpec, fixtureWorldConfig } from './fixtures';
import { validateGenerativeWorldConfig, configHash } from './config';
import {
  SYNTHETIC_PROVENANCE_DECLARATION,
  admitObservation,
  requireGeneratedEvent,
  requireGenerativeFill,
  requireGenerativeRunRecord,
} from './records';
import type { GeneratedEventRecord, GenerativeFillRecord, GenerativeObservation } from './records';
import { isDeeplyFrozen } from './primitives';
import type { ProjectId, TenantId, TimestampMs } from './ids';

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

function unwrap<T>(result: { readonly ok: boolean; readonly value?: T; readonly errors?: readonly { readonly message: string }[] }): T {
  if (result.ok) return result.value as T;
  throw new Error(`operation failed: ${JSON.stringify(result.errors)}`);
}

function expectFailure(result: { readonly ok: boolean; readonly errors?: readonly { readonly code: string; readonly message: string }[] }, code: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('unreachable');
  expect(result.errors?.[0]?.code).toBe(code);
}

/** A started generative service over the REAL engine (the common fixture). */
function startedService(): { readonly service: GenerativeWorldService; readonly episode: string } {
  const service = unwrap(createGenerativeWorldService(fixtureWorldConfig(), { engine: realEngineDriver() }));
  const started = unwrap(service.start(fixtureSpec()));
  return { service, episode: started.episode_id };
}

/** A crossing candidate action envelope at `at` (sequence `seq`). */
function crossingAction(at: number, seq = 1): Record<string, unknown> {
  return {
    action_id: `gx-test-${String(seq).padStart(2, '0')}`,
    actor: 'agent-candidate-alpha',
    submitted_at: at,
    client_sequence: seq,
    payload: {
      type: 'submit_order',
      intent: { clientOrderId: `gx-test-${String(seq).padStart(2, '0')}`, instrumentId: 'BTC-USDT', venueId: 'BINANCE', side: 'buy', kind: 'limit', quantity: '1', price: '100.50', timeInForce: 'gtc', createdAt: '2026-01-01T00:00:00Z' },
    },
  };
}

// ---------------------------------------------------------------------------
// TYPE-LEVEL WITNESSES (fail `pnpm typecheck` if a mirror drifts)
// ---------------------------------------------------------------------------

/** Compiles iff the REAL engine state is structurally this lane's mirror. */
function realEngineStateIsMirror(state: Parameters<typeof exchangeSim.submitOrder>[0]): EngineStateMirror {
  return state;
}

// ---------------------------------------------------------------------------
// Construction + the declaration laws
// ---------------------------------------------------------------------------

describe('the generative world service — construction + the declaration laws', () => {
  it('rejects an invalid engine driver (the engine is a declared input)', () => {
    expectFailure(createGenerativeWorldService(fixtureWorldConfig(), { engine: {} as unknown as EngineDriver }), 'invalid_engine_driver');
  });

  it('the REAL engine driver satisfies the port guard', () => {
    expect(isEngineDriver(realEngineDriver())).toBe(true);
    void realEngineStateIsMirror;
  });

  it('rejects a config whose declared book the REAL engine refuses (fail-early probe — a crossed book)', () => {
    const config = fixtureWorldConfig() as Record<string, unknown>;
    const population = { ...(config.population as Record<string, unknown>) };
    population.initial_book = {
      bids: [{ price: '101.00', size: '3.000' }],
      asks: [{ price: '100.50', size: '3.000' }], // best bid crosses best ask
    };
    const crossed = { ...config, population };
    expectFailure(createGenerativeWorldService(crossed, { engine: realEngineDriver() }), 'engine_error');
  });

  it('L5 (criterion 5, config): a config claiming exact_replay fidelity fails fidelity_claim_dishonest', () => {
    const config = { ...(fixtureWorldConfig() as Record<string, unknown>), mode: 'exact_replay' };
    expectFailure(validateGenerativeWorldConfig(config), 'fidelity_claim_dishonest');
  });

  it('L5 (criterion 5, config): a config claiming reactive_replay fidelity fails fidelity_claim_dishonest (the THIRD class is never conflated)', () => {
    const config = { ...(fixtureWorldConfig() as Record<string, unknown>), mode: 'reactive_replay' };
    expectFailure(validateGenerativeWorldConfig(config), 'fidelity_claim_dishonest');
  });

  it('L5 (mode coherence): a generative config with reactive_replay exchange physics fails fidelity_claim_dishonest', () => {
    const config = fixtureWorldConfig() as Record<string, unknown>;
    const exchange = { ...(config.exchange as Record<string, unknown>), fidelity: 'reactive_replay' };
    expectFailure(validateGenerativeWorldConfig({ ...config, exchange }), 'fidelity_claim_dishonest');
  });

  it('the generative existential law: a cohort binding an UNDECLARED policy fails process_undeclared', () => {
    const config = fixtureWorldConfig() as Record<string, unknown>;
    const population = { ...(config.population as Record<string, unknown>) };
    const cohorts = [...(population.cohorts as readonly Record<string, unknown>[])];
    const tampered = [...cohorts];
    const first = tampered[0];
    if (first === undefined) throw new Error('unreachable');
    tampered[0] = { ...first, policy: 'proc-never-declared' };
    population.cohorts = tampered;
    expectFailure(validateGenerativeWorldConfig({ ...config, population }), 'process_undeclared');
  });

  it('the generative existential law: a missing reference walk fails process_undeclared', () => {
    const config = fixtureWorldConfig() as Record<string, unknown>;
    const processes = [...(config.processes as readonly Record<string, unknown>[])];
    const walkless = processes.slice(1); // drop the anchor walk
    // Also drop the cohorts (their policies are gone) so the SINGLE failing law is the missing walk.
    const population = { ...(config.population as Record<string, unknown>) };
    population.cohorts = [];
    const result = validateGenerativeWorldConfig({ ...config, processes: walkless, population });
    expectFailure(result, 'process_undeclared');
  });

  it('the generative existential law: an orphan behavior process (bound by no cohort) fails process_undeclared', () => {
    const config = fixtureWorldConfig() as Record<string, unknown>;
    const population = { ...(config.population as Record<string, unknown>) };
    const cohorts = [...(population.cohorts as readonly Record<string, unknown>[])];
    const orphaning = cohorts.filter((cohort) => cohort.policy !== 'proc-noise-nnn');
    population.cohorts = orphaning;
    expectFailure(validateGenerativeWorldConfig({ ...config, population }), 'process_undeclared');
  });

  it('the L4-honest context coherence law: an embargo longer than the fastest cadence fails', () => {
    const config = fixtureWorldConfig() as Record<string, unknown>;
    const processes = [...(config.processes as readonly Record<string, unknown>[])];
    const walk = { ...(processes[0] as Record<string, unknown>), params: { start_price: '100.00', step_ticks: 3, embargo_ms: 5_000 } };
    processes[0] = walk;
    expectFailure(validateGenerativeWorldConfig({ ...config, processes }), 'invalid_field');
  });

  it('an off-grid declared initial book fails the population guard (grid coherence)', () => {
    const config = fixtureWorldConfig() as Record<string, unknown>;
    const population = { ...(config.population as Record<string, unknown>) };
    population.initial_book = {
      bids: [{ price: '100.005', size: '3.000' }],
      asks: [{ price: '100.50', size: '3.000' }],
    };
    expectFailure(validateGenerativeWorldConfig({ ...config, population }), 'invalid_field');
  });

  it('a candidate colliding with a generated participant id fails (the candidate is driver-driven, never both)', () => {
    const config = fixtureWorldConfig() as Record<string, unknown>;
    const population = { ...(config.population as Record<string, unknown>) };
    population.candidate = { instance: 'pop-cohort-makers-1' };
    expectFailure(validateGenerativeWorldConfig({ ...config, population }), 'invalid_field');
  });

  it('the config digest is stable and seed-sensitive (L9 — the config alone binds the data declaration)', () => {
    const a = unwrap(validateGenerativeWorldConfig(fixtureWorldConfig()));
    const b = unwrap(validateGenerativeWorldConfig(fixtureWorldConfig()));
    const other = unwrap(validateGenerativeWorldConfig(fixtureWorldConfig({ seed: 'generative-fixture-beta' })));
    expect(configHash(a)).toBe(configHash(b));
    expect(configHash(a)).not.toBe(configHash(other));
  });
});

// ---------------------------------------------------------------------------
// The episode lifecycle laws
// ---------------------------------------------------------------------------

describe('the generative world service — episode lifecycle laws', () => {
  it('starts an episode with the engine seeded from the DECLARED initial book and every process armed', () => {
    const { service, episode } = startedService();
    const engine = unwrap(service.engineState(episode));
    expect(engine.now).toBe(T0);
    expect(engine.book.bids[0]?.price).toBe('100');
    expect(engine.book.asks[0]?.price).toBe('100.5');
    const states = unwrap(service.processStates(episode));
    expect(states.length).toBe(5); // the walk + four cohort participants
    expect(states[0]?.instance).toBe('world');
    expect(states[1]?.instance).toBe('pop-cohort-makers-1');
    // The opening book-top observation is the world's honest opening view.
    const observed = unwrap(service.observe(episode, T0 as TimestampMs));
    expect(observed.length).toBe(1);
    expect(observed[0]?.provenance.origin).toBe('simulated');
  });

  it('L5 (criterion 5, spec): a spec claiming exact_replay fidelity fails fidelity_claim_dishonest', () => {
    const service = unwrap(createGenerativeWorldService(fixtureWorldConfig(), { engine: realEngineDriver() }));
    const spec = fixtureSpec() as Record<string, unknown>;
    const profile: Record<string, unknown> = { ...(spec.profile as Record<string, unknown>), fidelity: 'exact_replay' };
    profile.clock = { ...((profile.clock as Record<string, unknown>)), fidelity: 'exact_replay' };
    expectFailure(service.start({ ...spec, profile }), 'fidelity_claim_dishonest');
  });

  it('L5 (criterion 5, spec): a spec claiming reactive_replay fidelity fails fidelity_claim_dishonest', () => {
    const service = unwrap(createGenerativeWorldService(fixtureWorldConfig(), { engine: realEngineDriver() }));
    const spec = fixtureSpec() as Record<string, unknown>;
    const profile: Record<string, unknown> = { ...(spec.profile as Record<string, unknown>), fidelity: 'reactive_replay' };
    profile.clock = { ...((profile.clock as Record<string, unknown>)), fidelity: 'reactive_replay' };
    expectFailure(service.start({ ...spec, profile }), 'fidelity_claim_dishonest');
  });

  it('rejects a spec bound to another world (world_binding_mismatch)', () => {
    const service = unwrap(createGenerativeWorldService(fixtureWorldConfig(), { engine: realEngineDriver() }));
    const spec = fixtureSpec() as Record<string, unknown>;
    const world = { ...(spec.world as Record<string, unknown>), world_id: 'world-somewhere-else' };
    expectFailure(service.start({ ...spec, world }), 'world_binding_mismatch');
  });

  it('rejects a spec whose asOf exceeds the declared horizon (beyond_as_of)', () => {
    const service = unwrap(createGenerativeWorldService(fixtureWorldConfig(), { engine: realEngineDriver() }));
    const spec = fixtureSpec() as Record<string, unknown>;
    const profile: Record<string, unknown> = { ...(spec.profile as Record<string, unknown>) };
    profile.clock = { ...((profile.clock as Record<string, unknown>)), asOf: T0 + 500_000 };
    expectFailure(service.start({ ...spec, profile }), 'beyond_as_of');
  });

  it('rejects a duplicate episode (an episode id is a unique run)', () => {
    const { service } = startedService();
    expectFailure(service.start(fixtureSpec()), 'duplicate_episode');
  });

  it('observe beyond now fails (L4 — observation_beyond_now)', () => {
    const { service, episode } = startedService();
    expectFailure(service.observe(episode, (T0 + 1) as TimestampMs), 'observation_beyond_now');
  });

  it('advance refuses regressions and beyond-asOf targets', () => {
    const { service, episode } = startedService();
    expectFailure(service.advance(episode, (T0 - 1) as TimestampMs), 'clock_regression');
    expectFailure(service.advance(episode, (T0 + 200_000) as TimestampMs), 'beyond_as_of');
  });

  it('finish requires a valid termination reason; double finish and post-finish actions are typed', () => {
    const { service, episode } = startedService();
    expectFailure(service.finish(episode, { code: 'mysterious', detail: 'x' }), 'invalid_termination');
    unwrap(service.finish(episode, { code: 'completed', detail: 'test' }));
    expectFailure(service.finish(episode, { code: 'completed', detail: 'again' }), 'episode_finished');
    expectFailure(service.submit(episode, crossingAction(T0)), 'episode_finished');
  });

  it('the run record is available only for a FINISHED episode', () => {
    const { service, episode } = startedService();
    expectFailure(service.runRecord(episode), 'episode_not_finished');
  });
});

// ---------------------------------------------------------------------------
// The generative difference — the generated population + the candidate are MATCHED (criterion 4)
// ---------------------------------------------------------------------------

describe('the generative difference — generated intents are MATCHED with full physics lineage (criterion 4)', () => {
  it('the generated population TRADES: fills exist whose taker is a GENERATED participant', async () => {
    const { runGenerativeFixture } = await import('./fixtures');
    const run = await runGenerativeFixture(realEngineDriver());
    expect(run.fills.length).toBeGreaterThan(0);
    const takers = new Set(run.fills.map((fill) => fill.taker_participant));
    expect(takers.has('agent-candidate-alpha')).toBe(true); // the candidate matched
    const generatedTakers = [...takers].filter((taker) => taker.startsWith('pop-'));
    expect(generatedTakers.length).toBeGreaterThan(0); // the POPULATION matched — the generative difference
  });

  it('a crossing candidate order produces engine fills with FULL physics lineage + an engine_matched receipt', () => {
    const { service, episode } = startedService();
    const submitted = unwrap(service.submit(episode, crossingAction(T0)));
    expect(submitted.receipt.disposition).toBe('engine_matched');
    expect(submitted.receipt.engine.fill_ids.length).toBe(1);
    const fills = unwrap(service.fills(episode));
    expect(fills.length).toBe(1);
    const fill = fills[0];
    if (fill === undefined) throw new Error('unreachable');
    expect(fill.fill.price).toBe('100.5'); // canonical decimal ('100.50' normalizes)
    expect(fill.fill.quantity).toBe('1');
    expect(fill.taker_participant).toBe('agent-candidate-alpha');
    expect(fill.physics.engine_config_hash).toBe(physicsHash(unwrap(validateExchangePhysics(fixturePhysics()))));
    expect(fill.physics.run_ref).toBe(service.run_id);
  });

  it('the fill MOVES the book: the engine state records the consumption', () => {
    const { service, episode } = startedService();
    unwrap(service.submit(episode, crossingAction(T0)));
    const engine = unwrap(service.engineState(episode));
    expect(engine.fills.length).toBe(1);
    // The seeded ask 3.000 lost 1: 2.000 remains.
    expect(engine.book.asks[0]?.price).toBe('100.5');
    expect(engine.book.asks[0]?.orders[0]?.remaining).toBe('2');
  });

  it('every generated event carries its process lineage + synthetic provenance (criterion 5, positive half)', async () => {
    const { runGenerativeFixture } = await import('./fixtures');
    const run = await runGenerativeFixture(realEngineDriver());
    expect(run.generatedEvents.length).toBeGreaterThan(0);
    for (const event of run.generatedEvents) {
      const guarded = unwrap(requireGeneratedEvent(event));
      expect(guarded).toBe(event);
      expect(event.synthetic.generated).toBe(true);
      expect(event.synthetic.declaration).toBe(SYNTHETIC_PROVENANCE_DECLARATION);
      expect(event.run_ref).toBe(run.service.run_id);
    }
    const quotes = run.generatedEvents.filter((event) => event.kind === 'market_quote');
    const intents = run.generatedEvents.filter((event) => event.kind === 'population_intent');
    expect(quotes.length).toBeGreaterThan(0);
    expect(intents.length).toBeGreaterThan(0);
  });

  it('observations carry generated/simulated origins — NEVER historical (L5/L6 anti-conflation)', async () => {
    const { runGenerativeFixture } = await import('./fixtures');
    const run = await runGenerativeFixture(realEngineDriver());
    expect(run.observations.length).toBeGreaterThan(0);
    for (const observation of run.observations) {
      expect(observation.provenance.origin === 'historical').toBe(false);
    }
    expect(run.observations.some((observation) => observation.provenance.origin === 'generated')).toBe(true);
    expect(run.observations.some((observation) => observation.provenance.origin === 'simulated')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The candidate law + the action causal laws
// ---------------------------------------------------------------------------

describe('the candidate law + the action causal laws (both channels: driver + generated)', () => {
  it('a driver submission in a GENERATED participant\u2019s name fails actor_not_candidate (ambient participants are forbidden)', () => {
    const { service, episode } = startedService();
    const action = { ...crossingAction(T0), actor: 'pop-cohort-makers-1' };
    expectFailure(service.submit(episode, action), 'actor_not_candidate');
  });

  it('an undeclared actor is rejected (unknown_participant)', () => {
    const { service, episode } = startedService();
    const action = { ...crossingAction(T0), actor: 'agent-nobody-zeta' };
    expectFailure(service.submit(episode, action), 'unknown_participant');
  });

  it('a stale client_sequence is rejected (per-actor request ordering)', () => {
    const { service, episode } = startedService();
    unwrap(service.submit(episode, crossingAction(T0, 5)));
    expectFailure(service.submit(episode, crossingAction(T0, 5)), 'stale_sequence');
    expectFailure(service.submit(episode, crossingAction(T0, 4)), 'stale_sequence');
  });

  it('a duplicate action id is rejected (unique per episode, across both channels)', () => {
    const { service, episode } = startedService();
    unwrap(service.submit(episode, crossingAction(T0, 1)));
    const replayed = { ...crossingAction(T0, 2), action_id: 'gx-test-01' };
    expectFailure(service.submit(episode, replayed), 'duplicate_action');
  });

  it('an action claiming a future instant is rejected (action_from_future)', () => {
    const { service, episode } = startedService();
    expectFailure(service.submit(episode, crossingAction(T0 + 10_000, 1)), 'action_from_future');
  });

  it('an action claiming an instant the engine has passed is rejected (arrival_before_engine)', () => {
    const { service, episode } = startedService();
    // Advance one boundary (the walk at T0+5_000) — the engine clock moves there.
    unwrap(service.advance(episode, (T0 + 5_000) as TimestampMs));
    expectFailure(service.submit(episode, crossingAction((T0 + 3_000) as number, 1)), 'arrival_before_engine');
  });

  it('a malformed action payload is rejected (invalid_action)', () => {
    const { service, episode } = startedService();
    const action = { ...crossingAction(T0), payload: { type: 'summon_liquidity' } };
    expectFailure(service.submit(episode, action), 'invalid_action');
  });
});

// ---------------------------------------------------------------------------
// The declared interleaving (criterion 8 — the order IS the deterministic function)
// ---------------------------------------------------------------------------

describe('the declared interleaving (criterion 8 — the order is part of the deterministic function)', () => {
  it('under processes_first, submitting while a process step is due at/before now is a typed interleaving_violation', () => {
    const service = unwrap(createGenerativeWorldService(fixtureWorldConfig(), { engine: realEngineDriver() }));
    const started = unwrap(service.start(fixtureSpec()));
    const episode = started.episode_id;
    // ONE advance past several due instants: exactly ONE boundary processes
    // (the walk at T0+5_000); the noise (7_000) and the 10_000 cadences are
    // still pending at the clock's now — the world is mid-catch-up.
    const view = unwrap(service.advance(episode, (T0 + 12_000) as TimestampMs));
    expect(view.settled).toBe(false);
    expect(view.pending_process_steps).toBeGreaterThan(0);
    expectFailure(service.submit(episode, crossingAction((T0 + 12_000) as number, 1)), 'interleaving_violation');
    // Settle the window, then the same submit is legal.
    for (let iteration = 0; iteration < 100; iteration++) {
      const settled = unwrap(service.advance(episode, (T0 + 12_000) as TimestampMs));
      if (settled.settled) break;
    }
    const submitted = unwrap(service.submit(episode, crossingAction((T0 + 12_000) as number, 1)));
    expect(submitted.receipt.disposition).toBe('engine_matched');
  });

  it('under unrestricted, the same submit is legal at the rest point (the policy is a declaration, not a universal)', () => {
    const service = unwrap(createGenerativeWorldService(fixtureWorldConfig({ interleaving: 'unrestricted' }), { engine: realEngineDriver() }));
    const started = unwrap(service.start(fixtureSpec({ interleaving: 'unrestricted' })));
    const episode = started.episode_id;
    unwrap(service.advance(episode, (T0 + 12_000) as TimestampMs));
    const submitted = unwrap(service.submit(episode, crossingAction((T0 + 12_000) as number, 1)));
    expect(submitted.receipt.disposition).toBe('engine_matched');
  });
});

// ---------------------------------------------------------------------------
// The L4 delivery gate (criterion 6 — defense in depth)
// ---------------------------------------------------------------------------

describe('the L4 delivery gate (criterion 6 — the embargo holds at the generation seam)', () => {
  it('admitObservation fails l4_boundary_violation for an observation leaked past the boundary', () => {
    const observation: GenerativeObservation = {
      observation_id: 'gmo-test-embargo',
      available_time: (T0 + 1_000) as TimestampMs,
      venue: 'BINANCE',
      instrument: 'BTC-USDT',
      payload: { kind: 'market_quote', data: {} },
      provenance: { origin: 'generated', source: 'generative-process:proc-anchor-walk', derived_from: [] },
      run_ref: 'run-test',
      tenant: 'tenant-fixture-alpha' as TenantId,
      project: 'project-fixture-alpha' as ProjectId,
    };
    expectFailure(admitObservation(observation, T0 as TimestampMs), 'l4_boundary_violation');
    expect(unwrap(admitObservation(observation, (T0 + 1_000) as TimestampMs))).toBe(observation);
  });

  it('the walk\u2019s quote is NOT observable before its embargo elapses, and IS after (the generator obeys L4)', () => {
    const { service, episode } = startedService();
    // One boundary: the walk fires at T0+5_000, its quote embargoed 400ms.
    unwrap(service.advance(episode, (T0 + 5_000) as TimestampMs));
    const before = unwrap(service.observe(episode, (T0 + 5_000) as TimestampMs));
    expect(before.some((observation) => observation.provenance.origin === 'generated')).toBe(false);
    // Advance past the embargo; the quote becomes visible.
    unwrap(service.advance(episode, (T0 + 5_400) as TimestampMs));
    const after = unwrap(service.observe(episode, (T0 + 5_400) as TimestampMs));
    const quotes = after.filter((observation) => observation.provenance.origin === 'generated');
    expect(quotes.length).toBe(1);
    expect(quotes[0]?.available_time).toBe(T0 + 5_400);
  });
});

// ---------------------------------------------------------------------------
// The physics-lineage + generated-event laws (criteria 5, 7, 10 — total guards)
// ---------------------------------------------------------------------------

describe('the physics-lineage law (criterion 7 — the guards are total)', () => {
  it('a fill without a physics lineage block fails physics_lineage_missing', () => {
    const fill: Record<string, unknown> = {
      fill: { fill_id: 'f1', trade_id: 't1', venue: 'BINANCE', instrument: 'BTC-USDT', quartet: { event_time: T0, source_time: null, available_time: T0, ingestion_time: T0 }, sequence: 1, taker_order_id: 'o1', maker_order_id: 'o2', aggressor_side: 'buy', price: '100.5', aggressor_price: '100.5', quantity: '1', taker_fee: '0', maker_fee: '0', latency_ms: 5 },
      fill_id: 'f1',
      episode_id: 'ep1',
      run_ref: 'run-1',
      taker_participant: 'agent-candidate-alpha',
      taker_order_id: 'o1',
      maker_order_id: 'o2',
      physics: undefined,
    };
    expectFailure(requireGenerativeFill(fill), 'physics_lineage_missing');
  });

  it('a fill missing one policy ref fails physics_lineage_missing (each ref is lineage)', () => {
    const complete = unwrap(requireGenerativeFill({
      fill: { fill_id: 'f1', trade_id: 't1', venue: 'BINANCE', instrument: 'BTC-USDT', quartet: { event_time: T0, source_time: null, available_time: T0, ingestion_time: T0 }, sequence: 1, taker_order_id: 'o1', maker_order_id: 'o2', aggressor_side: 'buy', price: '100.5', aggressor_price: '100.5', quantity: '1', taker_fee: '0', maker_fee: '0', latency_ms: 5 },
      fill_id: 'f1',
      episode_id: 'ep1',
      run_ref: 'run-1',
      taker_participant: 'agent-candidate-alpha',
      taker_order_id: 'o1',
      maker_order_id: 'o2',
      physics: { engine_config_hash: 'abcd1234', fee_policy: 'fees:x', latency_policy: 'latency:x', slippage_policy: 'slippage:x', impact_policy: 'impact:x', run_ref: 'run-1', tenant: 'tenant-fixture-alpha', project: 'project-fixture-alpha' },
    })) as GenerativeFillRecord;
    const tampered = { ...(complete as unknown as Record<string, unknown>), physics: { ...(complete.physics as unknown as Record<string, unknown>), impact_policy: '' } };
    expectFailure(requireGenerativeFill(tampered), 'physics_lineage_missing');
  });

  it('a fill without its run binding fails lineage_gap (criterion 10)', () => {
    const complete = {
      fill: { fill_id: 'f1', trade_id: 't1', venue: 'BINANCE', instrument: 'BTC-USDT', quartet: { event_time: T0, source_time: null, available_time: T0, ingestion_time: T0 }, sequence: 1, taker_order_id: 'o1', maker_order_id: 'o2', aggressor_side: 'buy', price: '100.5', aggressor_price: '100.5', quantity: '1', taker_fee: '0', maker_fee: '0', latency_ms: 5 },
      fill_id: 'f1',
      episode_id: 'ep1',
      run_ref: 'run-1',
      taker_participant: 'agent-candidate-alpha',
      taker_order_id: 'o1',
      maker_order_id: 'o2',
      physics: { engine_config_hash: 'abcd1234', fee_policy: 'fees:x', latency_policy: 'latency:x', slippage_policy: 'slippage:x', impact_policy: 'impact:x', run_ref: 'run-1', tenant: 'tenant-fixture-alpha', project: 'project-fixture-alpha' },
    };
    const tampered = { ...(complete as Record<string, unknown>), episode_id: '' };
    expectFailure(requireGenerativeFill(tampered), 'lineage_gap');
  });

  it('a fill without tenant/project fails tenant_missing (criterion 10 — L12)', () => {
    const complete = {
      fill: { fill_id: 'f1', trade_id: 't1', venue: 'BINANCE', instrument: 'BTC-USDT', quartet: { event_time: T0, source_time: null, available_time: T0, ingestion_time: T0 }, sequence: 1, taker_order_id: 'o1', maker_order_id: 'o2', aggressor_side: 'buy', price: '100.5', aggressor_price: '100.5', quantity: '1', taker_fee: '0', maker_fee: '0', latency_ms: 5 },
      fill_id: 'f1',
      episode_id: 'ep1',
      run_ref: 'run-1',
      taker_participant: 'agent-candidate-alpha',
      taker_order_id: 'o1',
      maker_order_id: 'o2',
      physics: { engine_config_hash: 'abcd1234', fee_policy: 'fees:x', latency_policy: 'latency:x', slippage_policy: 'slippage:x', impact_policy: 'impact:x', run_ref: 'run-1', tenant: '', project: 'project-fixture-alpha' },
    };
    expectFailure(requireGenerativeFill(complete), 'tenant_missing');
  });
});

describe('the generated-event lineage laws (criteria 5 + 10 — the guards are total)', () => {
  /** A minimal VALID generated event (the tampering base). */
  function validEvent(): GeneratedEventRecord {
    return {
      event_id: 'gev-proc-anchor-walk:world:1:quote',
      kind: 'market_quote',
      at: T0 as TimestampMs,
      available_time: (T0 + 400) as TimestampMs,
      actor: null,
      payload: { anchor_price: '100.03', move_ticks: 3 },
      process: { process: 'proc-anchor-walk', instance: 'world', version: '1.0.0', seed: 'generative-fixture-alpha/walk', step: 1 },
      synthetic: { generated: true, declaration: SYNTHETIC_PROVENANCE_DECLARATION },
      run_ref: 'run-1',
      tenant: 'tenant-fixture-alpha' as TenantId,
      project: 'project-fixture-alpha' as ProjectId,
    };
  }

  it('a generated event without its process lineage fails process_undeclared (the existential law)', () => {
    const tampered = { ...(validEvent() as unknown as Record<string, unknown>), process: undefined };
    expectFailure(requireGeneratedEvent(tampered), 'process_undeclared');
  });

  it('a generated event with an incomplete process lineage fails process_undeclared', () => {
    const event = validEvent() as unknown as Record<string, unknown>;
    const process = { ...(event.process as Record<string, unknown>), seed: '' };
    expectFailure(requireGeneratedEvent({ ...event, process }), 'process_undeclared');
  });

  it('a generated event without the synthetic-provenance declaration fails synthetic_provenance_missing (criterion 5)', () => {
    const event = validEvent() as unknown as Record<string, unknown>;
    expectFailure(requireGeneratedEvent({ ...event, synthetic: undefined }), 'synthetic_provenance_missing');
    expectFailure(requireGeneratedEvent({ ...event, synthetic: { generated: false, declaration: 'not really' } }), 'synthetic_provenance_missing');
  });

  it('a generated event claiming HISTORICAL origin fails fidelity_claim_dishonest (a record passing as historical is unrepresentable)', () => {
    const event = validEvent() as unknown as Record<string, unknown>;
    const lying = { ...event, origin: { origin: 'historical' } };
    expectFailure(requireGeneratedEvent(lying), 'fidelity_claim_dishonest');
  });

  it('a generated event without its run binding or tenant fails lineage_gap / tenant_missing (criterion 10)', () => {
    const event = validEvent() as unknown as Record<string, unknown>;
    expectFailure(requireGeneratedEvent({ ...event, run_ref: '' }), 'lineage_gap');
    expectFailure(requireGeneratedEvent({ ...event, tenant: '' }), 'tenant_missing');
    expectFailure(requireGeneratedEvent({ ...event, project: '' }), 'tenant_missing');
  });

  it('a generated event available BEFORE its own instant fails l4_boundary_violation (availability cannot precede occurrence)', () => {
    const event = validEvent() as unknown as Record<string, unknown>;
    expectFailure(requireGeneratedEvent({ ...event, available_time: (T0 - 1) as number }), 'l4_boundary_violation');
  });
});

// ---------------------------------------------------------------------------
// The run-record guards (criteria 5 + 10, record-level trip-wires)
// ---------------------------------------------------------------------------

describe('the run-record guards (criteria 5 + 10)', () => {
  it('a run record claiming reactive_replay fidelity fails fidelity_claim_dishonest (criterion 5 — the record-level trip-wire)', async () => {
    const { runGenerativeFixture } = await import('./fixtures');
    const run = await runGenerativeFixture(realEngineDriver());
    const record = run.record;
    if (record === null) throw new Error('unreachable');
    const tampered = { ...(record as unknown as Record<string, unknown>), world: { ...(record.world as unknown as Record<string, unknown>), mode: 'reactive_replay' } };
    expectFailure(requireGenerativeRunRecord(tampered), 'fidelity_claim_dishonest');
    const exact = { ...(record as unknown as Record<string, unknown>), world: { ...(record.world as unknown as Record<string, unknown>), mode: 'exact_replay' } };
    expectFailure(requireGenerativeRunRecord(exact), 'fidelity_claim_dishonest');
  });

  it('a run record without tenant/project or run id fails its guard (criterion 10)', async () => {
    const { runGenerativeFixture } = await import('./fixtures');
    const run = await runGenerativeFixture(realEngineDriver());
    const record = run.record;
    if (record === null) throw new Error('unreachable');
    const noTenant = { ...(record as unknown as Record<string, unknown>), world: { ...(record.world as unknown as Record<string, unknown>), tenant: '' } };
    expectFailure(requireGenerativeRunRecord(noTenant), 'tenant_missing');
    const noRun = { ...(record as unknown as Record<string, unknown>), run_id: '' };
    expectFailure(requireGenerativeRunRecord(noRun), 'lineage_gap');
  });

  it('a run record whose generated log carries an unlineaged event fails through the record guard', async () => {
    const { runGenerativeFixture } = await import('./fixtures');
    const run = await runGenerativeFixture(realEngineDriver());
    const record = run.record;
    if (record === null) throw new Error('unreachable');
    const stripped = run.generatedEvents.map((event) => {
      const entry = { ...(event as unknown as Record<string, unknown>) };
      delete entry.process;
      return entry;
    });
    const tampered = { ...(record as unknown as Record<string, unknown>), generated_log: stripped };
    expectFailure(requireGenerativeRunRecord(tampered), 'process_undeclared');
  });
});

// ---------------------------------------------------------------------------
// Immutability (deepFreeze discipline)
// ---------------------------------------------------------------------------

describe('immutability — every public record deeply frozen', () => {
  it('the config, the views, the fills, the generated events and the record are deeply frozen', async () => {
    const { runGenerativeFixture } = await import('./fixtures');
    const run = await runGenerativeFixture(realEngineDriver());
    expect(isDeeplyFrozen(run.service.config)).toBe(true);
    expect(isDeeplyFrozen(run.generatedEvents)).toBe(true);
    expect(isDeeplyFrozen(run.fills)).toBe(true);
    expect(isDeeplyFrozen(run.observations)).toBe(true);
    const record = run.record;
    if (record === null) throw new Error('unreachable');
    expect(isDeeplyFrozen(record)).toBe(true);
    const states = unwrap(run.service.processStates(run.episodeId));
    expect(isDeeplyFrozen(states)).toBe(true);
  });
});
