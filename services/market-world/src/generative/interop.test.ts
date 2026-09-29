/**
 * Cross-lane interoperability trip wires for the generative world (work
 * order T028, acceptance criterion 11 + the replay half of criterion 4).
 *
 * Every REAL package this lane mirrors is present on this branch and
 * loaded STATICALLY here (the tests are the trip wires — the src lane
 * itself imports nothing across lanes):
 *
 *   - @tradrl/exchange-sim (T010): the REAL MatchingEngine satisfies the
 *     injected EngineDriver port (structural binding + a full generative
 *     episode driven through it), the physics hash parity holds (this
 *     lane's mirrored canonicalization === the real configHash), and the
 *     real Fill records ARE this lane's FillMirror.
 *   - @tradrl/environment-protocol (T005): the service passes the REAL
 *     isEnvironment guard; its outputs pass the REAL observation / action
 *     / episode-state / episode-finish guards; the mirrored spec
 *     validation, canonical spec JSON and episode-id derivation agree with
 *     the REAL ones byte-for-byte.
 *   - @tradrl/rl-protocol (T013): the REAL EpisodeDriver drives a full
 *     generative episode through the asTrainerEnvironment adapter (the
 *     bridge consumption contract), the service itself satisfies the REAL
 *     isEnvironmentPort guard, and the step log records real observation
 *     refs and accepted actions.
 *   - THE REPLAY CONTRAST (criterion 4): the SAME order intent submitted
 *     to T009's exact-replay world produces ONLY a receipt (disposition
 *     'recorded_as_intent' — a fill is inexpressible there), while in THIS
 *     world it is MATCHED by the real engine (fills with full physics
 *     lineage, disposition 'engine_matched'). The contrast is asserted
 *     directly, service against service, on this branch — and the L5
 *     distinctness is trip-wired both ways (the replay world rejects a
 *     generative spec; this world rejects a replay spec).
 */

import { describe, expect, it } from 'vitest';
import * as exchangeSim from '../../../../packages/exchange-sim/src/index';
import * as envProtocol from '../../../../packages/environment-protocol/src/index';
import * as rlProtocol from '../../../../packages/rl-protocol/src/index';
import type { EngineDriver, EngineStateMirror, SubmitOutcomeMirror, CancelOutcomeMirror, AdvanceOutcomeMirror, EngineOpResult } from './exchange-mirror';
import { isEngineDriver, validateExchangePhysics, physicsHash } from './exchange-mirror';
import { validateEnvironmentSpec, canonicalSpecJson, deriveEpisodeId } from './env-mirror';
import type { EpisodeStateMirror, ObservationEnvelope } from './env-mirror';
import { createGenerativeWorldService } from './service';
import type { GenerativeWorldService } from './service';
import { asTrainerEnvironment } from './adapter';
import type { TrainerEnvironmentPort } from './adapter';
import { fixtureSpec, fixtureWorldConfig, fixturePhysics } from './fixtures';
import type { GenerativeObservation } from './records';
import type { TimestampMs } from './ids';

// The REAL replay world (T009) for the contrast — importable on this branch.
import { createReplayWorldService } from '../replay/service';
import { createFixtureEventSource as createReplayFixtureSource, fixtureSpec as replayFixtureSpec, fixtureWorldConfig as replayFixtureWorldConfig } from '../replay/fixtures';

const T0 = 1_700_000_000_000;

// ---------------------------------------------------------------------------
// TYPE-LEVEL WITNESSES (fail `pnpm typecheck` if a mirror drifts)
// ---------------------------------------------------------------------------

/** Compiles iff the REAL engine state is structurally this lane's mirror. */
function realEngineStateIsMirror(state: Parameters<typeof exchangeSim.submitOrder>[0]): EngineStateMirror {
  return state;
}

/** Compiles iff a REAL fill is structurally this lane's FillMirror. */
function realFillIsMirror(fill: exchangeSim.Fill): Parameters<typeof import('./exchange-mirror').isFillMirror>[0] {
  return fill;
}

/** Compiles iff the timestamp brand matches the canonical owner's (time-engine, via both lanes). */
function timestampBrandParity(value: TimestampMs): exchangeSim.TimestampMs {
  return value;
}

/** Compiles iff a generative observation is an environment-protocol Observation (extra fields tolerated structurally). */
function observationSatisfiesT005(value: GenerativeObservation): ObservationEnvelope {
  return value;
}

/** Compiles iff a generative episode view satisfies the T005 episode-state mirror. */
function episodeViewSatisfiesT005(value: import('./service').GenerativeEpisodeView): EpisodeStateMirror {
  return value;
}

/** Compiles iff the REAL T005 spec is this lane's mirror spec (mutual structural identity). */
function realSpecIsMirrorSpec(value: envProtocol.EnvironmentSpec): import('./env-mirror').EnvironmentSpec {
  return value;
}

// ---------------------------------------------------------------------------
// The REAL engine binding (the mirror seam under test)
// ---------------------------------------------------------------------------

function realEngineDriver(): EngineDriver {
  type RealEngineState = Parameters<typeof exchangeSim.submitOrder>[0];
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

/** A FRESH generative service over the REAL engine (episode not yet started). */
function freshService(): GenerativeWorldService {
  return unwrap(createGenerativeWorldService(fixtureWorldConfig(), { engine: realEngineDriver() }));
}

/** A STARTED generative service over the REAL engine. */
function generativeService(): GenerativeWorldService {
  const service = freshService();
  unwrap(service.start(fixtureSpec()));
  return service;
}

/** The shared probe intent: a crossing buy against the declared opening book. */
function probeIntent(): Record<string, unknown> {
  return {
    clientOrderId: 'contrast-probe-1',
    instrumentId: 'BTC-USDT',
    venueId: 'BINANCE',
    side: 'buy',
    kind: 'limit',
    quantity: '2',
    price: '100.50',
    timeInForce: 'gtc',
    createdAt: '2026-01-01T00:00:00Z',
  };
}

// ---------------------------------------------------------------------------
// exchange-sim (T010) trip wires
// ---------------------------------------------------------------------------

describe('exchange-sim interop (T010 — the engine this world DRIVES)', () => {
  it('the REAL engine satisfies the injected EngineDriver port', () => {
    expect(isEngineDriver(realEngineDriver())).toBe(true);
    void realEngineStateIsMirror;
    void realFillIsMirror;
    void timestampBrandParity;
  });

  it('physics hash parity: this lane\u2019s mirrored canonicalization EQUALS the real configHash (generative mode)', () => {
    const physics = fixturePhysics();
    const mirrored = unwrap(validateExchangePhysics(physics));
    const real = unwrap(exchangeSim.validateExchangeConfig(physics));
    expect(physicsHash(mirrored)).toBe(exchangeSim.configHash(real));
  });

  it('the REAL engine seeds the declared population book (createEngine accepts the generative config + seed)', () => {
    const physics = unwrap(validateExchangePhysics(fixturePhysics()));
    const seeded = unwrap(exchangeSim.createEngine({ ...physics }, { book_seed: { bids: [{ price: '100.00', size: '3.000' }], asks: [{ price: '100.50', size: '3.000' }] }, start_at: T0 }));
    expect(seeded.now).toBe(T0);
    expect(seeded.book.bids[0]?.price).toBe('100');
  });

  it('a full generative episode over the REAL engine: the population trades, hashes are stable', async () => {
    const { runGenerativeFixture } = await import('./fixtures');
    const run = await runGenerativeFixture(realEngineDriver());
    expect(run.fills.length).toBeGreaterThan(0);
    // The engine state the service carries IS the real engine's product.
    const engine = unwrap(run.service.engineState(run.episodeId));
    for (const fill of engine.fills) {
      expect(exchangeSim.isFill(fill)).toBe(true);
    }
    // Determinism: a second identical run produces the identical engine hash.
    const second = await runGenerativeFixture(realEngineDriver());
    expect(unwrap(second.service.engineStateHash(second.episodeId))).toBe(unwrap(run.service.engineStateHash(run.episodeId)));
  });
});

// ---------------------------------------------------------------------------
// environment-protocol (T005) trip wires
// ---------------------------------------------------------------------------

describe('environment-protocol interop (T005 — the five-operation contract)', () => {
  it('the GenerativeWorldService passes the REAL isEnvironment guard', () => {
    expect(envProtocol.isEnvironment(generativeService())).toBe(true);
  });

  it('the REAL spec validation accepts the fixture spec; the mirrored validation agrees; derivations match byte-for-byte', () => {
    const spec = fixtureSpec();
    const realValidated = unwrap(envProtocol.validateEnvironmentSpec(spec) as { ok: boolean; value?: envProtocol.EnvironmentSpec; errors?: { message: string }[] });
    const mirrorValidated = unwrap(validateEnvironmentSpec(spec));
    expect(envProtocol.isEnvironmentSpec(mirrorValidated)).toBe(true);
    expect(realValidated).toEqual(mirrorValidated);
    expect(canonicalSpecJson(mirrorValidated)).toBe(envProtocol.canonicalSpecJson(realValidated));
    expect(deriveEpisodeId(mirrorValidated)).toBe(envProtocol.deriveEpisodeId(realValidated));
    void realSpecIsMirrorSpec;
  });

  it('the service\u2019s outputs pass the REAL observation / action / episode-state / finish guards', () => {
    const service = generativeService();
    const episode = service.episodes[0];
    if (episode === undefined) throw new Error('unreachable');
    const startedView = unwrap(service.observe(episode, T0 as TimestampMs));
    expect(startedView.length).toBeGreaterThan(0);

    const submitted = unwrap(service.submit(episode, {
      action_id: 'interop-guard-1',
      actor: 'agent-candidate-alpha',
      submitted_at: T0,
      client_sequence: 1,
      payload: { type: 'submit_order', intent: probeIntent() },
    }));
    expect(envProtocol.isAction(submitted.accepted_actions[0])).toBe(true);

    // Advance through several boundaries; observe; finish.
    for (let iteration = 0; iteration < 100; iteration++) {
      const view = unwrap(service.advance(episode, (T0 + 25_000) as TimestampMs));
      if (view.settled) break;
    }
    const observed = unwrap(service.observe(episode, (T0 + 25_000) as TimestampMs));
    expect(observed.length).toBeGreaterThan(0);
    for (const observation of observed) {
      expect(envProtocol.isObservation(observation)).toBe(true);
    }
    void observationSatisfiesT005;
    void episodeViewSatisfiesT005;

    const finished = unwrap(service.finish(episode, { code: 'completed', detail: 'interop trip wire' }));
    expect(envProtocol.isEpisodeFinish(finished)).toBe(true);
    expect(envProtocol.isEpisodeState(finished.episode)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// rl-protocol (T013) trip wires — the trainer bridge consumption
// ---------------------------------------------------------------------------

describe('rl-protocol interop (T013 — the trainer bridge drives THIS world)', () => {
  it('the service satisfies the REAL isEnvironmentPort guard directly (five operations)', () => {
    expect(rlProtocol.isEnvironmentPort(generativeService())).toBe(true);
  });

  it('the adapter satisfies the port; the REAL EpisodeDriver drives a full generative episode through it', () => {
    // A FRESH service: the driver's start binds the episode itself.
    const service = freshService();
    const port: TrainerEnvironmentPort = asTrainerEnvironment(service);
    expect(rlProtocol.isEnvironmentPort(port)).toBe(true);

    // The REAL driver, real seeds, real budget.
    let driver = unwrap(rlProtocol.createEpisodeDriver({ seed: 't028-interop-bridge', actor: 'agent-candidate-alpha', step_budget: 500 }) as { ok: boolean; value?: rlProtocol.DriverState; errors?: { message: string }[] });
    driver = unwrap(rlProtocol.driverStart(driver, port, fixtureSpec()));
    expect(driver.episode).not.toBeNull();

    // Observe at the start instant (the declared opening book is visible).
    driver = unwrap(rlProtocol.driverObserve(driver, port, T0 as TimestampMs));

    // Advance to the candidate's crossing instant (the adapter settles the window).
    driver = unwrap(rlProtocol.driverAdvance(driver, port, (T0 + 25_000) as TimestampMs));

    // Act: the bridge proposal vocabulary { kind, payload } -> the engine intent.
    driver = unwrap(rlProtocol.driverAct(driver, port, [
      { kind: 'submit_order', payload: { clientOrderId: 'bridge-cross-1', instrumentId: 'BTC-USDT', venueId: 'BINANCE', side: 'buy', kind: 'limit', quantity: '2', price: '100.50', timeInForce: 'gtc', createdAt: '2026-01-01T00:00:00Z' } },
    ]));

    // Advance through the population's rotation; observe; finish.
    driver = unwrap(rlProtocol.driverAdvance(driver, port, (T0 + 60_000) as TimestampMs));
    driver = unwrap(rlProtocol.driverObserve(driver, port, (T0 + 60_000) as TimestampMs));
    driver = unwrap(rlProtocol.driverFinish(driver, port, { code: 'completed', detail: 'bridge trip wire complete' }));

    expect(driver.status).toBe('finished');
    expect(driver.finish_result?.termination.code).toBe('completed');
    // The step log recorded real observation refs and the accepted action.
    const steps = rlProtocol.driverSteps(driver);
    expect(steps.length).toBeGreaterThan(0);
    const observedRefs = steps.flatMap((step) => step.observations.map((ref) => ref.observation_id));
    expect(observedRefs.length).toBeGreaterThan(0);
    const actions = steps.flatMap((step) => step.actions);
    expect(actions.length).toBe(1);
    // The world matched the bridged action: fills exist with physics lineage.
    const episode = driver.episode as string;
    const fills = unwrap(service.fills(episode));
    expect(fills.length).toBeGreaterThan(0);
    expect(fills.some((fill) => fill.taker_participant === 'agent-candidate-alpha')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// THE REPLAY CONTRAST (criterion 4 — the same intent: a receipt there, a match here)
// + the L5 distinctness trip-wires (both directions)
// ---------------------------------------------------------------------------

describe('the replay contrast (criterion 4 — the same intent: a receipt there, a match here)', () => {
  it('in EXACT REPLAY (T009, real service) the intent is recorded ONLY — a fill is inexpressible', async () => {
    const replay = unwrap(createReplayWorldService(replayFixtureWorldConfig(), createReplayFixtureSource()));
    unwrap(await replay.loadAll());
    const started = unwrap(replay.start(replayFixtureSpec()));
    const submitted = unwrap(replay.submit(started.episode_id, {
      action_id: 'contrast-1',
      actor: 'agent-candidate-alpha',
      submitted_at: started.clock.now,
      client_sequence: 1,
      payload: { type: 'submit_order', intent: probeIntent() },
    }));
    // THE REPLAY LAW (L6, T009): the disposition union has exactly one
    // member — recorded_as_intent. No fill, no match, no consequence.
    expect(submitted.receipt.disposition).toBe('recorded_as_intent');
    unwrap(replay.finish(started.episode_id, { code: 'completed', detail: 'contrast probe' }));
    const record = unwrap(replay.runRecord(started.episode_id));
    expect(record.intent_log.length).toBe(1);
    expect(record.intent_log[0]?.disposition).toBe('recorded_as_intent');
  });

  it('in the GENERATIVE world (this world, real engine) the SAME intent is MATCHED — fills with full physics lineage', () => {
    const service = generativeService();
    const episode = service.episodes[0];
    if (episode === undefined) throw new Error('unreachable');
    const submitted = unwrap(service.submit(episode, {
      action_id: 'contrast-1',
      actor: 'agent-candidate-alpha',
      submitted_at: T0,
      client_sequence: 1,
      payload: { type: 'submit_order', intent: probeIntent() },
    }));
    expect(submitted.receipt.disposition).toBe('engine_matched');
    const fills = unwrap(service.fills(episode));
    expect(fills.length).toBe(1);
    const fill = fills[0];
    if (fill === undefined) throw new Error('unreachable');
    expect(fill.fill.price).toBe('100.5'); // canonical decimal ('100.50' normalizes)
    expect(fill.fill.quantity).toBe('2');
    expect(fill.physics.engine_config_hash).toBe(physicsHash(unwrap(validateExchangePhysics(fixturePhysics()))));
    expect(fill.physics.run_ref).toBe(service.run_id);
  });

  it('the contrast, stated plainly: same intent, different worlds, different dispositions — the modes are never conflated (L5)', async () => {
    const replay = unwrap(createReplayWorldService(replayFixtureWorldConfig(), createReplayFixtureSource()));
    unwrap(await replay.loadAll());
    const replayStarted = unwrap(replay.start(replayFixtureSpec()));
    const replaySubmitted = unwrap(replay.submit(replayStarted.episode_id, {
      action_id: 'contrast-2',
      actor: 'agent-candidate-alpha',
      submitted_at: replayStarted.clock.now,
      client_sequence: 1,
      payload: { type: 'submit_order', intent: probeIntent() },
    }));

    const generative = generativeService();
    const episode = generative.episodes[0];
    if (episode === undefined) throw new Error('unreachable');
    const generativeSubmitted = unwrap(generative.submit(episode, {
      action_id: 'contrast-2',
      actor: 'agent-candidate-alpha',
      submitted_at: T0,
      client_sequence: 1,
      payload: { type: 'submit_order', intent: probeIntent() },
    }));

    expect(replaySubmitted.receipt.disposition).toBe('recorded_as_intent');
    expect(generativeSubmitted.receipt.disposition).toBe('engine_matched');
    expect(generativeSubmitted.receipt.engine.fill_ids.length).toBeGreaterThan(0);
    expect(unwrap(generative.fills(episode)).length).toBeGreaterThan(0);
  });

  it('L5 distinctness, both directions: the replay world rejects a GENERATIVE spec; this world rejects a replay spec', async () => {
    // The replay world (fidelity 'exact_replay') refuses a generative spec.
    const replay = unwrap(createReplayWorldService(replayFixtureWorldConfig(), createReplayFixtureSource()));
    unwrap(await replay.loadAll());
    const generativeSpecAsRecord = fixtureSpec() as Record<string, unknown>;
    const profile: Record<string, unknown> = { ...(generativeSpecAsRecord.profile as Record<string, unknown>) };
    profile.clock = { ...((profile.clock as Record<string, unknown>)), fidelity: 'generative' };
    const replayResult = replay.start({ ...generativeSpecAsRecord, profile, world: { world_id: (generativeSpecAsRecord.world as Record<string, unknown>).world_id, kind: 'generative' } });
    expect(replayResult.ok).toBe(false);

    // This world (fidelity 'generative') refuses a reactive spec — already
    // the service battery's law; the trip-wire here binds the direction.
    const service = unwrap(createGenerativeWorldService(fixtureWorldConfig(), { engine: realEngineDriver() }));
    const reactiveSpec = fixtureSpec() as Record<string, unknown>;
    const reactiveProfile: Record<string, unknown> = { ...(reactiveSpec.profile as Record<string, unknown>), fidelity: 'reactive_replay' };
    reactiveProfile.clock = { ...((reactiveProfile.clock as Record<string, unknown>)), fidelity: 'reactive_replay' };
    const generativeResult = service.start({ ...reactiveSpec, profile: reactiveProfile });
    expect(generativeResult.ok).toBe(false);
    if (!generativeResult.ok) {
      expect(generativeResult.errors[0]?.code).toBe('fidelity_claim_dishonest');
    }
  });
});
