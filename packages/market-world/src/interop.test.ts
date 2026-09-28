/**
 * Cross-package interoperability trip wires for @tradrl/market-world.
 *
 * Lane 1 (present on this branch): @tradrl/market-protocol and
 * @tradrl/time-engine — statically imported. The market lane's canonical
 * `MarketEvent` must satisfy this package's `WorldEvent` mirror (the stream
 * IN), and the mirrored `ClockState` must stay mutually assignable with the
 * canonical `SimulationClock`. If either drifts, the type-level assertions
 * fail `pnpm typecheck` and the runtime parity checks fail `pnpm test`.
 *
 * Lane 2 (conditional): @tradrl/environment-protocol (T005) is merged in the
 * Lead's integration tree but NOT on this branch's GitHub main (credential
 * outage at dispatch). The trip wire against the REAL package loads it
 * DYNAMICALLY when present — on the integration tree it runs the full
 * battery (isEnvironment over the WorldAdapter and the service, the real
 * isObservation/isEpisodeState/isEpisodeFinish guards over the adapter's
 * outputs, and deriveEpisodeId parity); on this branch it is skipped with an
 * explicit notice and the MIRROR-based proofs below carry the guarantee.
 * The mechanism itself (computed dynamic import of a sibling package under
 * vitest) is proven by Lane 3 against time-engine, which IS present.
 */

import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  canonicalSpecJson,
  createClockState,
  createWorldAdapter,
  deriveEpisodeId,
  initReplayWorld,
  isClockState,
  advanceClockStateTo,
  validateEnvironmentSpec,
  validateWorldEvent,
  type ClockState,
  type WorldEvent,
} from './index';
import { ingestWorld } from './transition';
import {
  advanceClockTo,
  createSimulationClock,
  isTimestampMs as engineIsTimestampMs,
  MAX_TIMESTAMP_MS as ENGINE_MAX,
  MIN_TIMESTAMP_MS as ENGINE_MIN,
  requireTimestampMs,
  type SimulationClock,
  type TimestampMs as EngineTimestampMs,
} from '../../time-engine/src/index';
import {
  isTimestampMs as protocolIsTimestampMs,
  MAX_TIMESTAMP_MS as PROTOCOL_MAX,
  MIN_TIMESTAMP_MS as PROTOCOL_MIN,
  validateMarketEvent,
  type MarketEvent,
  type TimestampMs as MarketTimestampMs,
} from '../../market-protocol/src/index';

const T0 = 1_700_000_000_000;
const AS_OF = T0 + 10_000;

// ---------------------------------------------------------------------------
// TYPE-LEVEL ASSERTIONS (fail `pnpm typecheck` if a mirror drifts).
// ---------------------------------------------------------------------------

/**
 * Compiles iff every ENVELOPE field of a canonical MarketEvent satisfies the
 * WorldEvent mirror (all fields but `payload`, which the mirror deliberately
 * carries as opaque JSON — see src/event.ts: payload semantics belong to the
 * market lane; replay only persists and replays them). The runtime proof
 * that a canonical MarketEvent VALUE passes the mirror guard is below.
 */
function marketEventEnvelopeIsWorldEventEnvelope(value: MarketEvent): Omit<WorldEvent, 'payload'> {
  return value;
}

/** Compiles iff a time-engine SimulationClock is assignable to ClockState. */
function engineClockIsClockState(value: SimulationClock): ClockState {
  return value;
}

/** Compiles iff a ClockState is assignable to a time-engine SimulationClock. */
function clockStateIsEngineClock(value: ClockState): SimulationClock {
  return value;
}

/** Compiles iff mirrored timestamps are interchangeable with both lanes'. */
function timestampMirrorAssignability(value: MarketTimestampMs): EngineTimestampMs {
  return value;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function worldEventFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: 'evt-1',
    venue: 'BINANCE',
    instrument: 'BTC-USDT',
    asset_class: 'crypto',
    event_type: 'trade',
    event_time: T0,
    source_time: T0,
    available_time: T0 + 40,
    ingestion_time: T0 + 100,
    sequence: 1,
    provider: 'binance',
    provenance: { origin: 'historical', adapter: { id: 'binance-adapter', version: '1.4.0' }, derived_from: [], transform: null },
    payload: { price: '43125.10', size: '0.017', side: 'buy' },
    ...overrides,
  };
}

/** A canonical MarketEvent built by the MARKET package's own validator. */
function canonicalMarketEvent(overrides: Record<string, unknown> = {}): MarketEvent {
  const result = validateMarketEvent(worldEventFixture(overrides));
  if (!result.ok) throw new Error(`market fixture must be valid: ${JSON.stringify(result.errors)}`);
  return result.value;
}

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false }): T {
  if (result.ok) return result.value;
  throw new Error('unexpected failure in fixture');
}

// ---------------------------------------------------------------------------
// Lane 1a: market-protocol <-> market-world (the event envelope mirror)
// ---------------------------------------------------------------------------

describe('MarketEvent <-> WorldEvent structural mirror', () => {
  it('a canonical MarketEvent (market-protocol-validated) passes the WorldEvent mirror guard', () => {
    const canonical = canonicalMarketEvent();
    expect(validateWorldEvent(canonical).ok).toBe(true);
    // And the envelope type-level witness compiles (payload deliberately opaque).
    const envelope: Omit<WorldEvent, 'payload'> = marketEventEnvelopeIsWorldEventEnvelope(canonical);
    expect(envelope.event_id).toBe('evt-1');
  });

  it('canonical events across the taxonomy (trade, quote, other) all pass the mirror guard', () => {
    const trade = canonicalMarketEvent();
    const quote = canonicalMarketEvent({
      event_id: 'q1',
      event_type: 'quote',
      sequence: 2,
      payload: { bid_price: '43100.00', bid_size: '1.5', ask_price: '43150.00', ask_size: '2.0' },
    });
    const other = canonicalMarketEvent({
      event_id: 'o1',
      event_type: 'other',
      sequence: 3,
      payload: { kind: 'vwap_1m', data: { window_ms: 60_000, value: '43125.10' } },
    });
    for (const canonical of [trade, quote, other]) {
      const result = validateWorldEvent(canonical);
      expect(result.ok, JSON.stringify(result.ok ? null : result.errors)).toBe(true);
    }
  });

  it('the mirrored guards agree on accept/reject across a boundary sample', () => {
    const samples: readonly unknown[] = [
      worldEventFixture(),
      worldEventFixture({ available_time: T0 - 1, event_time: T0 }), // quartet violation
      worldEventFixture({ event_type: 'nope' }),
      worldEventFixture({ sequence: -3 }),
      worldEventFixture({ provenance: { origin: 'historical', adapter: null, derived_from: [], transform: null } }),
      { not: 'an event' },
      null,
    ];
    for (const sample of samples) {
      expect(validateWorldEvent(sample).ok).toBe(validateMarketEvent(sample).ok);
    }
  });

  it('an event REJECTED by market-protocol (extra non-JSON field) is rejected by the mirror (documented divergence)', () => {
    const poisoned = { ...worldEventFixture(), vendor_extra: () => 'not JSON' };
    expect(validateMarketEvent(poisoned).ok).toBe(true); // market-protocol tolerates excess fields
    expect(validateWorldEvent(poisoned).ok).toBe(false); // the replay world persists history — JSON only
  });

  it('timestamp guards and constants are at parity with BOTH canonical packages', () => {
    expect(PROTOCOL_MIN).toBe(ENGINE_MIN);
    expect(PROTOCOL_MAX).toBe(ENGINE_MAX);
    for (const sample of [0, 1, 1.5, -1, ENGINE_MAX, ENGINE_MAX + 1, Number.NaN, 'x', null]) {
      expect(protocolIsTimestampMs(sample)).toBe(engineIsTimestampMs(sample));
    }
    const fromEngine = requireTimestampMs(42);
    expect(fromEngine).toBe(42);
    expect(timestampMirrorAssignability(fromEngine)).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// Lane 1b: time-engine <-> market-world (the clock mirror)
// ---------------------------------------------------------------------------

describe('ClockState <-> SimulationClock structural mirror', () => {
  it('an engine-constructed SimulationClock is a valid ClockState and vice versa', () => {
    const engineClock = unwrap(createSimulationClock({ asOf: requireTimestampMs(AS_OF), now: requireTimestampMs(T0), fidelity: 'exact_replay' }));
    expect(isClockState(engineClock)).toBe(true);
    const asClockState: ClockState = engineClockIsClockState(engineClock);
    const backToEngine: SimulationClock = clockStateIsEngineClock(asClockState);
    expect(backToEngine.now).toBe(T0);

    const mirrored = unwrap(createClockState({ asOf: requireTimestampMs(AS_OF), now: requireTimestampMs(T0), fidelity: 'exact_replay' }));
    const asEngine: SimulationClock = clockStateIsEngineClock(mirrored);
    expect(unwrap(advanceClockTo(asEngine, requireTimestampMs(T0 + 5))).now).toBe(T0 + 5);
  });

  it('the advance laws behave identically (monotonic, anchored, typed errors)', () => {
    const engineClock = unwrap(createSimulationClock({ asOf: requireTimestampMs(AS_OF), now: requireTimestampMs(T0), fidelity: 'exact_replay' }));
    const mirrorClock = unwrap(createClockState({ asOf: requireTimestampMs(AS_OF), now: requireTimestampMs(T0), fidelity: 'exact_replay' }));

    expect(advanceClockTo(engineClock, requireTimestampMs(T0 - 1)).ok).toBe(advanceClockStateTo(mirrorClock, requireTimestampMs(T0 - 1)).ok);
    expect(advanceClockTo(engineClock, requireTimestampMs(AS_OF + 1)).ok).toBe(advanceClockStateTo(mirrorClock, requireTimestampMs(AS_OF + 1)).ok);
    expect(unwrap(advanceClockTo(engineClock, requireTimestampMs(T0 + 100))).now).toBe(unwrap(advanceClockStateTo(mirrorClock, requireTimestampMs(T0 + 100))).now);
  });
});

// ---------------------------------------------------------------------------
// Lane 2: environment-protocol (conditional — activates on the integration
// tree where T005 is merged; skipped with a notice on this branch)
// ---------------------------------------------------------------------------

const PROTOCOL_ENTRY = fileURLToPath(new URL('../../environment-protocol/src/index.ts', import.meta.url));
const protocolPresent = existsSync(PROTOCOL_ENTRY);

/**
 * The narrowed shape of the dynamically loaded environment-protocol module —
 * only the guards and derivations the trip wire exercises, hand-checked.
 */
interface ProtocolModuleShape {
  readonly isEnvironment: (value: unknown) => boolean;
  readonly isObservation: (value: unknown) => boolean;
  readonly isEpisodeState: (value: unknown) => boolean;
  readonly isEpisodeFinish: (value: unknown) => boolean;
  readonly isEnvironmentSpec: (value: unknown) => boolean;
  readonly validateEnvironmentSpec: (value: unknown) => { readonly ok: boolean } ;
  readonly deriveEpisodeId: (spec: unknown) => string;
  readonly canonicalSpecJson: (spec: unknown) => string;
  readonly isAction: (value: unknown) => boolean;
}

function isProtocolModule(value: unknown): value is ProtocolModuleShape {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.isEnvironment === 'function' &&
    typeof candidate.isObservation === 'function' &&
    typeof candidate.isEpisodeState === 'function' &&
    typeof candidate.isEpisodeFinish === 'function' &&
    typeof candidate.isEnvironmentSpec === 'function' &&
    typeof candidate.validateEnvironmentSpec === 'function' &&
    typeof candidate.deriveEpisodeId === 'function' &&
    typeof candidate.canonicalSpecJson === 'function' &&
    typeof candidate.isAction === 'function'
  );
}

describe.skipIf(!protocolPresent)('environment-protocol interop (T005 merged on the integration tree)', () => {
  it('the REAL package loads and satisfies the trip-wire module shape', async () => {
    const specifier = '../../environment-protocol/src/index';
    const loaded: unknown = await import(/* @vite-ignore */ specifier);
    expect(isProtocolModule(loaded)).toBe(true);
  });

  it('the WorldAdapter passes the REAL isEnvironment guard and its outputs pass the REAL observation/episode guards', async () => {
    const protocolSpecifier = '../../environment-protocol/src/index';
    const loaded: unknown = await import(/* @vite-ignore */ protocolSpecifier);
    if (!isProtocolModule(loaded)) throw new Error('environment-protocol module shape mismatch');

    const world = unwrap(initReplayWorld({
      world_id: 'world-replay-fixture',
      fidelity: 'exact_replay',
      information_policy: 'point-in-time',
      seed: 'seed-alpha',
      as_of: AS_OF,
      streams: [{ venue: 'BINANCE', instrument: 'BTC-USDT' }],
    }));
    const loaded2 = unwrap(ingestWorld(world, [worldEventFixture({ event_id: 't1' }), worldEventFixture({ event_id: 't2', event_time: T0 + 200, available_time: T0 + 200, sequence: 2 })]));
    const adapter = createWorldAdapter(loaded2);
    expect(loaded.isEnvironment(adapter)).toBe(true);

    const spec = {
      profile: {
        environment_id: 'env-replay-1',
        fidelity: 'exact_replay',
        clock: { now: T0, asOf: AS_OF, playbackSpeed: 1, paused: false, fidelity: 'exact_replay', informationPolicy: 'point-in-time' },
        seed: 'seed-alpha',
        venue_scope: [],
        instrument_scope: [],
        latency_policy: null,
        fee_policy: null,
      },
      world: { world_id: 'world-replay-fixture', kind: 'replay' },
      information_policy: 'point-in-time',
    };
    expect(loaded.isEnvironmentSpec(spec)).toBe(true);

    const view = unwrap(adapter.start(spec));
    expect(loaded.isEpisodeState(view)).toBe(true);
    unwrap(adapter.advance(view.episode_id, requireTimestampMs(T0 + 200)));
    const observation = unwrap(adapter.observe(view.episode_id, requireTimestampMs(T0 + 200)));
    expect(observation.length).toBe(2); // both fixture events are available by T0+200
    expect(observation.every((item) => loaded.isObservation(item))).toBe(true);

    const submission = unwrap(adapter.submit(view.episode_id, { action_id: 'act-1', actor: 'agent-alpha', submitted_at: T0 + 200, client_sequence: 1, payload: null }));
    expect(loaded.isEpisodeState(submission)).toBe(true); // the submission is an episode state + receipt
    expect(loaded.isAction(submission.accepted_actions[0])).toBe(true);

    const finished = unwrap(adapter.finish(view.episode_id, { code: 'completed', detail: 'integration trip wire' }));
    expect(loaded.isEpisodeFinish(finished)).toBe(true);
    expect(loaded.isEpisodeState(finished.episode)).toBe(true);
  });

  it('the ReplayWorldService (services/market-world) also passes the REAL isEnvironment guard', async () => {
    const protocolSpecifier = '../../environment-protocol/src/index';
    const loaded: unknown = await import(/* @vite-ignore */ protocolSpecifier);
    if (!isProtocolModule(loaded)) throw new Error('environment-protocol module shape mismatch');

    const { createReplayWorldService, createFixtureEventSource, fixtureSpec, fixtureWorldConfig } =
      await import(/* @vite-ignore */ '../../../services/market-world/src/index');
    const serviceResult = createReplayWorldService(fixtureWorldConfig({ seed: 'interop-seed' }), createFixtureEventSource({ seed: 'interop-seed' }));
    if (!serviceResult.ok) throw new Error('service fixture failed');
    const service = serviceResult.value;
    expect(loaded.isEnvironment(service)).toBe(true);

    // A full episode through the service: every output passes the REAL guards.
    const loadAll = await service.loadAll();
    if (!loadAll.ok) throw new Error('loadAll failed');
    const started = service.start(fixtureSpec({ seed: 'interop-seed' }));
    if (!started.ok) throw new Error('start failed');
    expect(loaded.isEpisodeState(started.value)).toBe(true);
    const advanced = service.advance(started.value.episode_id, requireTimestampMs(T0 + 2_000));
    if (!advanced.ok) throw new Error('advance failed');
    expect(loaded.isEpisodeState(advanced.value)).toBe(true);
    const observed = service.observe(started.value.episode_id, requireTimestampMs(T0 + 2_000));
    if (!observed.ok) throw new Error('observe failed');
    expect(observed.value.every((observation) => loaded.isObservation(observation))).toBe(true);
    const submitted = service.submit(started.value.episode_id, {
      action_id: 'interop-1',
      actor: 'agent-interop',
      submitted_at: T0 + 2_000,
      client_sequence: 1,
      payload: null,
    });
    if (!submitted.ok) throw new Error('submit failed');
    expect(loaded.isEpisodeState(submitted.value)).toBe(true);
    const finished = service.finish(started.value.episode_id, { code: 'completed', detail: 'interop trip wire' });
    if (!finished.ok) throw new Error('finish failed');
    expect(loaded.isEpisodeFinish(finished.value)).toBe(true);
  });

  it('deriveEpisodeId parity: the mirrored derivation equals the REAL one for the same spec', async () => {
    const protocolSpecifier = '../../environment-protocol/src/index';
    const loaded: unknown = await import(/* @vite-ignore */ protocolSpecifier);
    if (!isProtocolModule(loaded)) throw new Error('environment-protocol module shape mismatch');
    const spec = {
      profile: {
        environment_id: 'env-parity',
        fidelity: 'exact_replay',
        clock: { now: T0, asOf: AS_OF, playbackSpeed: 1, paused: false, fidelity: 'exact_replay', informationPolicy: 'point-in-time' },
        seed: 'seed-parity',
        venue_scope: ['BINANCE'],
        instrument_scope: ['BTC-USDT'],
        latency_policy: null,
        fee_policy: null,
      },
      world: { world_id: 'world-replay-fixture', kind: 'replay' },
      information_policy: 'point-in-time',
    };
    // The mirrored validation accepts exactly what the real one accepts.
    const mirrorValidated = unwrap(validateEnvironmentSpec(spec));
    expect(loaded.validateEnvironmentSpec(spec).ok).toBe(true);
    expect(loaded.deriveEpisodeId(mirrorValidated)).toBe(deriveEpisodeId(mirrorValidated));
    expect(loaded.canonicalSpecJson(mirrorValidated)).toBe(canonicalSpecJson(mirrorValidated));
  });
});

// Mirror-compatible imports used by the conditional trip wire above.

describe('environment-protocol trip-wire status', () => {
  it('makes the trip-wire state explicit in the test log (never fails)', () => {
    if (!protocolPresent) {
      // eslint-disable-next-line no-console
      console.info(
        '[T009 interop] packages/environment-protocol is NOT present on this branch (T005 merged in the Lead tree only) — structural compatibility is proven by the local mirrors (env-mirror.ts type witnesses + guards); the REAL-package trip wire above activates automatically once T005 lands on main.',
      );
    } else {
      // eslint-disable-next-line no-console
      console.info('[T009 interop] packages/environment-protocol IS present — the full trip wire is active.');
    }
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Lane 3: the conditional mechanism itself (proven against a package that IS
// present, so the Lane-2 dynamic import is trustworthy on the integration
// tree)
// ---------------------------------------------------------------------------

describe('conditional dynamic-import mechanism (proven against time-engine)', () => {
  it('a computed dynamic import of a sibling package resolves and type-narrows under vitest', async () => {
    const specifier = '../../time-engine/src/index';
    const loaded: unknown = await import(/* @vite-ignore */ specifier);
    const candidate = loaded as Record<string, unknown>;
    expect(typeof candidate.isTimestampMs).toBe('function');
    const isTimestamp = candidate.isTimestampMs as (value: unknown) => boolean;
    expect(isTimestamp(42)).toBe(true);
    expect(isTimestamp('nope')).toBe(false);
  });
});
