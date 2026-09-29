/**
 * @tradrl/market-world (generative service) — deterministic fixture
 * scenarios (work order T028): declared population specs (cohorts +
 * behavior policies), declared stochastic processes, physics configs, and
 * the GOLDEN WORLD EVOLUTION runner.
 *
 * DETERMINISM (L9 — the acceptance law): "same (population spec,
 * processes, seed, action script, physics, clock) -> byte-identical world
 * evolution — engine state, fills, generated events, observations
 * (deep-equal, twice)". Every fixture value derives from the seed (the
 * seeded xorshift32 discipline — the process runtimes' own states) or is
 * hand-declared at fixed offsets from T0; the runner drives the world
 * through a FIXED driver script. Two runs of {@link runGenerativeFixture}
 * produce byte-identical canonical evolution JSON and identical
 * run-record digests — proven in fixtures.test.ts, with the REAL
 * exchange-sim engine bound through the injected driver port.
 *
 * THE POPULATION (the Work Order's named cohorts): one market maker
 * (two-sided self-expiring quotes), one momentum taker (trend follower),
 * one mean reverter (book-vs-anchor fader), one noise trader (seeded
 * random offsets) — plus the ANCHOR walk (the world process) and the
 * candidate organization (driver-driven). THE SCENARIO deliberately
 * exercises the full path space: the walk's embargoed quotes (L4 at the
 * generation seam), maker quote rotation through the engine's own gtt
 * expiry physics, momentum crossings, reverter fades, noise accumulation,
 * a candidate crossing fill, and a candidate resting sell — so the
 * byte-identity claim covers every outcome kind the engine emits and both
 * observation origins (generated + simulated).
 */

import { canonicalJson, deepFreeze } from './primitives';
import type { JsonValue } from './primitives';
import type { TimestampMs } from './ids';
import type { EngineDriver, EngineStateMirror } from './exchange-mirror';
import { physicsHash, validateExchangePhysics } from './exchange-mirror';
import type { GenerativeWorldConfig, InterleavingPolicy } from './config';
import { configHash, validateGenerativeWorldConfig } from './config';
import type { GenerativeFillRecord, GenerativeObservation, GenerativeRunRecord, GenerativeRunState, GeneratedEventRecord } from './records';
import type { GenerativeWorldInputs, GenerativeWorldService } from './service';
import { createGenerativeWorldService, resumeGenerativeWorldService } from './service';

const T0 = 1_700_000_000_000;

// ---------------------------------------------------------------------------
// Fixture options
// ---------------------------------------------------------------------------

/** Fixture options: everything derives from the seed and these knobs. */
export interface GenerativeFixtureOptions {
  /** The deterministic seed (process draw sequences, ids). Default 'generative-fixture-alpha'. */
  readonly seed: string;
  /** The episode's asOf anchor (ms after T0). Default 100_000. */
  readonly horizonMs: number;
  /** The declared interleaving policy (the ordering law under test). Default 'processes_first'. */
  readonly interleaving: 'processes_first' | 'population_first' | 'unrestricted';
  /** Stop the driver script after N steps (resume tests); null = full run. Default null. */
  readonly stopAfterDriverStep: number | null;
}

const DEFAULTS: GenerativeFixtureOptions = { seed: 'generative-fixture-alpha', horizonMs: 100_000, interleaving: 'processes_first', stopAfterDriverStep: null };

/** Resolve options against defaults (explicit fields win). */
export function fixtureOptions(overrides: Partial<GenerativeFixtureOptions> = {}): GenerativeFixtureOptions {
  return {
    seed: overrides.seed ?? DEFAULTS.seed,
    horizonMs: overrides.horizonMs ?? DEFAULTS.horizonMs,
    interleaving: overrides.interleaving ?? DEFAULTS.interleaving,
    stopAfterDriverStep: overrides.stopAfterDriverStep ?? DEFAULTS.stopAfterDriverStep,
  };
}

// ---------------------------------------------------------------------------
// The physics configuration (grid-aligned with the declared population)
// ---------------------------------------------------------------------------

/** The fixture exchange physics: seeded uniform latency + book_walk slippage + a two-tier fee schedule. */
export function fixturePhysics(): Record<string, unknown> {
  return {
    venue: 'BINANCE',
    instrument: 'BTC-USDT',
    asset_class: 'crypto',
    tick_size: '0.01',
    lot_size: '0.001',
    max_book_depth: 10,
    seed: 'generative-fixture-alpha',
    fidelity: 'generative',
    fees: {
      tiers: [
        { up_to_notional: '1000', maker_bps: '1', taker_bps: '2' },
        { up_to_notional: null, maker_bps: '0.5', taker_bps: '1' },
      ],
      fee_decimals: 8,
    },
    latency: { kind: 'uniform', min_ms: 50, max_ms: 500 },
    slippage: { kind: 'book_walk' },
    impact: {
      kind: 'none',
      declaration: 'no endogenous impact beyond the book walk (fixture) — the engine matches the visible book only',
      limitation: 'endogenous reaction around the engine is composed by the declared stochastic processes (the anchor walk + the behavior policies); the fixture declares the engine as-is',
    },
  };
}

/** The fixture physics lineage refs (versioned policy refs bound into every fill). */
export function fixturePhysicsRefs(): Record<string, string> {
  const validated = validateExchangePhysics(fixturePhysics());
  if (!validated.ok) throw new Error(`fixture physics invalid: ${JSON.stringify(validated.errors)}`);
  const hash = physicsHash(validated.value);
  return {
    fee_policy: `fees:${hash}`,
    latency_policy: `latency:${hash}`,
    slippage_policy: `slippage:${hash}`,
    impact_policy: `impact:${hash}`,
  };
}

// ---------------------------------------------------------------------------
// The declared stochastic processes (versioned, seeded, cadenced)
// ---------------------------------------------------------------------------

/**
 * The fixture process declarations: THE ANCHOR WALK (5s cadence, ±3 ticks
 * per draw, 400ms availability embargo — shorter than the fastest
 * cadence, the L4-honest context law) plus the four behavior policies
 * the cohorts bind. Every seed derives from the options seed, so a
 * different fixture seed draws a different world (the golden run is a
 * function of its inputs, not a constant).
 */
export function fixtureProcesses(seed = DEFAULTS.seed): readonly Record<string, unknown>[] {
  return [
    {
      process_id: 'proc-anchor-walk',
      version: '1.0.0',
      kind: 'reference_price_walk',
      seed: `${seed}/walk`,
      step_ms: 5_000,
      params: { start_price: '100.00', step_ticks: 3, embargo_ms: 400 },
    },
    {
      process_id: 'proc-maker-mmm',
      version: '1.0.0',
      kind: 'market_maker',
      seed: `${seed}/maker`,
      step_ms: 10_000,
      params: { half_spread_ticks: 2, extra_spread_ticks: 1, quantity: '0.5' },
    },
    {
      process_id: 'proc-momentum-ttt',
      version: '1.0.0',
      kind: 'momentum_taker',
      seed: `${seed}/momentum`,
      step_ms: 10_000,
      params: { quantity: '0.4', threshold_ticks: 2, max_size_mult: 2 },
    },
    {
      process_id: 'proc-reverter-rrr',
      version: '1.0.0',
      kind: 'mean_reverter',
      seed: `${seed}/reverter`,
      step_ms: 10_000,
      params: { quantity: '0.3', threshold_ticks: 3, max_size_mult: 2 },
    },
    {
      process_id: 'proc-noise-nnn',
      version: '1.0.0',
      kind: 'noise_trader',
      seed: `${seed}/noise`,
      step_ms: 7_000,
      params: { quantity: '0.2', max_offset_ticks: 4 },
    },
  ];
}

// ---------------------------------------------------------------------------
// The declared population (cohorts + behavior-policy refs + initial state)
// ---------------------------------------------------------------------------

/** The fixture population: a two-sided initial book, the candidate, and the four cohorts. */
export function fixturePopulation(): Record<string, unknown> {
  return {
    initial_book: {
      bids: [
        { price: '100.00', size: '3.000' },
        { price: '99.50', size: '2.000' },
      ],
      asks: [
        { price: '100.50', size: '3.000' },
        { price: '101.00', size: '2.000' },
      ],
    },
    candidate: { instance: 'agent-candidate-alpha' },
    cohorts: [
      { cohort_id: 'cohort-makers', label: 'two-sided quoting market makers', policy: 'proc-maker-mmm', size: 1 },
      { cohort_id: 'cohort-momentum', label: 'trend-following momentum takers', policy: 'proc-momentum-ttt', size: 1 },
      { cohort_id: 'cohort-reverters', label: 'book-vs-anchor mean reverters', policy: 'proc-reverter-rrr', size: 1 },
      { cohort_id: 'cohort-noise', label: 'seeded random-offset noise traders', policy: 'proc-noise-nnn', size: 1 },
    ],
  };
}

// ---------------------------------------------------------------------------
// The world config + the episode spec
// ---------------------------------------------------------------------------

/** A world config that matches the fixture population and processes. */
export function fixtureWorldConfig(overrides: Partial<GenerativeFixtureOptions> = {}): Record<string, unknown> {
  const options = fixtureOptions(overrides);
  const physics = fixturePhysics();
  const physicsResult = validateExchangePhysics(physics);
  if (!physicsResult.ok) throw new Error(`fixture physics invalid: ${JSON.stringify(physicsResult.errors)}`);
  const hash = physicsHash(physicsResult.value);
  return {
    world_id: `world-generative-fixture-${options.seed}`,
    mode: 'generative',
    information_policy: 'point-in-time',
    tenant: 'tenant-fixture-alpha',
    project: 'project-fixture-alpha',
    seed: options.seed,
    horizon: T0 + 120_000,
    population: fixturePopulation(),
    processes: fixtureProcesses(options.seed).map((declaration) => ({ ...declaration })),
    exchange: physics,
    physics_refs: {
      fee_policy: `fees:${hash}`,
      latency_policy: `latency:${hash}`,
      slippage_policy: `slippage:${hash}`,
      impact_policy: `impact:${hash}`,
    },
    interleaving: { kind: options.interleaving },
    playback_speed: 1,
  };
}

/** The fixture episode spec: binds to the fixture world, clock anchored at T0. */
export function fixtureSpec(overrides: Partial<GenerativeFixtureOptions> = {}): Record<string, unknown> {
  const options = fixtureOptions(overrides);
  const config = fixtureWorldConfig(options);
  const physicsResult = validateExchangePhysics(fixturePhysics());
  if (!physicsResult.ok) throw new Error('fixture physics invalid (impossible)');
  const hash = physicsHash(physicsResult.value);
  return {
    profile: {
      environment_id: `env-generative-fixture-${options.seed}`,
      fidelity: 'generative',
      clock: { now: T0, asOf: T0 + options.horizonMs, playbackSpeed: 1, paused: false, fidelity: 'generative', informationPolicy: 'point-in-time' },
      seed: options.seed,
      venue_scope: ['BINANCE'],
      instrument_scope: ['BTC-USDT'],
      latency_policy: `latency:${hash}`,
      fee_policy: `fees:${hash}`,
    },
    world: { world_id: config.world_id, kind: 'generative' },
    information_policy: 'point-in-time',
  };
}

// ---------------------------------------------------------------------------
// The driver script (the candidate's actions — part of the deterministic function)
// ---------------------------------------------------------------------------

/** The order-intent builder (the domain-core Order mirror vocabulary). */
function intent(clientOrderId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const built: Record<string, unknown> = {
    clientOrderId,
    instrumentId: 'BTC-USDT',
    venueId: 'BINANCE',
    side: 'buy',
    kind: 'limit',
    quantity: '1',
    price: '100.50',
    timeInForce: 'gtc',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
  // The action payload must be a JSON value: undefined fields (the
  // presence matrix) are dropped.
  for (const key of Object.keys(built)) {
    if (built[key] === undefined) delete built[key];
  }
  return built;
}

/** One driver step: settle the world at an instant, then (maybe) submit the candidate's action. */
export type FixtureDriverStep =
  | { readonly kind: 'settle'; readonly to: number }
  | { readonly kind: 'action'; readonly at: number; readonly action: Record<string, unknown> };

/** The candidate's driving script: a crossing buy into the opening ask, then a resting sell into the evolved book. */
export function fixtureDriverScript(): readonly FixtureDriverStep[] {
  return [
    // T0+8_000: settle past the first walk quotes and the first noise
    // order, then a crossing candidate buy at the opening ask.
    { kind: 'action', at: T0 + 8_000, action: { action_id: 'gx-cand-01', actor: 'agent-candidate-alpha', submitted_at: T0 + 8_000, client_sequence: 1, payload: { type: 'submit_order', intent: intent('gx-cand-cross', { price: '100.50', quantity: '1' }) } } },
    // T0+45_000: settle through the population's rotation (maker quote
    // refreshes, momentum crossings, reverter fades, noise churn).
    { kind: 'settle', to: T0 + 45_000 },
    // T0+50_000: a candidate sell at the bid side of the evolved book.
    { kind: 'action', at: T0 + 50_000, action: { action_id: 'gx-cand-02', actor: 'agent-candidate-alpha', submitted_at: T0 + 50_000, client_sequence: 2, payload: { type: 'submit_order', intent: intent('gx-cand-sell', { side: 'sell', price: '100.00', quantity: '0.5' }) } } },
  ];
}

// ---------------------------------------------------------------------------
// The runner (the golden world evolution)
// ---------------------------------------------------------------------------

/** The products of one fixture run. */
export interface GenerativeFixtureRun {
  readonly service: GenerativeWorldService;
  readonly episodeId: string;
  /** The L9 run record (null when the run stopped mid-script for resume tests). */
  readonly record: GenerativeRunRecord | null;
  readonly engineState: EngineStateMirror;
  readonly fills: readonly GenerativeFillRecord[];
  readonly generatedEvents: readonly GeneratedEventRecord[];
  readonly observations: readonly GenerativeObservation[];
  /** Canonical JSON of the whole evolution (the byte-identity comparator). */
  readonly evolutionJson: string;
  /** The exported run state when the run stopped mid-script (resume tests); null on a full run. */
  readonly exportedState: GenerativeRunState | null;
}

/** Unwrap helper for fixture plumbing (a fixture step failing is a fixture bug, not a test outcome). */
function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly { readonly message: string }[] }): T {
  if (result.ok) return result.value;
  throw new Error(`fixture step failed: ${JSON.stringify(result.errors)}`);
}

/** Build fresh fixture inputs over the given engine driver. */
export function createFixtureInputs(engine: EngineDriver): GenerativeWorldInputs {
  return { engine };
}

/**
 * Run the fixture scenario once: create the service (with the INJECTED
 * engine driver), start the episode (processes armed, engine seeded from
 * the declared book), drive the scripted flow (settle-then-act per driver
 * step; the step machine processes one boundary per advance), optionally
 * stop mid-script (resume tests), finish (full runs), and collect the
 * lineage record plus the canonical evolution. Deterministic: identical
 * options + engine -> byte-identical `evolutionJson` and identical
 * `record.digest`.
 */
export async function runGenerativeFixture(engine: EngineDriver, overrides: Partial<GenerativeFixtureOptions> = {}): Promise<GenerativeFixtureRun> {
  const options = fixtureOptions(overrides);
  const inputs: GenerativeWorldInputs = { engine };
  const service = unwrap(createGenerativeWorldService(fixtureWorldConfig(options), inputs));

  const started = unwrap(service.start(fixtureSpec(options)));
  const episodeId = started.episode_id;

  const script = fixtureDriverScript();
  const stopAfter = options.stopAfterDriverStep;
  const limit = stopAfter === null ? script.length : Math.min(stopAfter, script.length);
  let stopped = false;

  for (let index = 0; index < limit; index++) {
    const step = script[index];
    if (step === undefined) break;
    if (step.kind === 'settle') {
      settleAt(service, episodeId, step.to as TimestampMs);
    } else {
      settleAt(service, episodeId, step.at as TimestampMs);
      unwrap(service.submit(episodeId, step.action));
    }
  }
  if (stopAfter !== null && limit < script.length) {
    stopped = true;
  }

  if (stopped) {
    // Export BEFORE any observe call (the counters must match the
    // uninterrupted run's — the resume-identity law).
    const exported = unwrap(service.exportRunState(episodeId));
    return {
      service,
      episodeId,
      record: null,
      engineState: unwrap(service.engineState(episodeId)),
      fills: unwrap(service.fills(episodeId)),
      generatedEvents: unwrap(service.generatedEvents(episodeId)),
      observations: [],
      evolutionJson: '',
      exportedState: exported,
    };
  }

  // Absorb the whole window (every cadence fires; every boundary
  // processes), then finish and record.
  const horizon = (T0 + options.horizonMs - 1_000) as TimestampMs;
  settleAt(service, episodeId, horizon);
  unwrap(service.finish(episodeId, { code: 'completed', detail: 'fixture scenario complete' }));
  const record = unwrap(service.runRecord(episodeId));
  const evolutionJson = evolutionJsonOf(service, episodeId, record, horizon);
  return {
    service,
    episodeId,
    record,
    engineState: unwrap(service.engineState(episodeId)),
    fills: unwrap(service.fills(episodeId)),
    generatedEvents: unwrap(service.generatedEvents(episodeId)),
    observations: unwrap(service.observe(episodeId, horizon)),
    evolutionJson,
    exportedState: null,
  };
}

/** Advance (one boundary per call) until the world is settled at `to` (the full-catch-up loop). */
function settleAt(service: GenerativeWorldService, episodeId: string, to: TimestampMs): void {
  for (let iteration = 0; iteration < 100_000; iteration++) {
    const view = unwrap(service.advance(episodeId, to));
    if (view.settled) return;
  }
  throw new Error('fixture settle loop did not converge (infinite catch-up is impossible by construction)');
}

/** The canonical evolution JSON: engine state + fills + generated events + observations (+ record) — the byte-identity comparator. */
function evolutionJsonOf(service: GenerativeWorldService, episodeId: string, record: GenerativeRunRecord | null, at: TimestampMs): string {
  const engineState = unwrap(service.engineState(episodeId));
  const fills = unwrap(service.fills(episodeId));
  const generatedEvents = unwrap(service.generatedEvents(episodeId));
  const observations = unwrap(service.observe(episodeId, at));
  const tree: JsonValue = {
    engine_state: engineState as unknown as JsonValue,
    fills: fills as unknown as JsonValue,
    generated_events: generatedEvents as unknown as JsonValue,
    observations: observations as unknown as JsonValue,
    record: record === null ? null : (record as unknown as JsonValue),
  };
  return canonicalJson(tree);
}

/**
 * Resume a stopped fixture run and drive the REMAINING script: the
 * exported state is verified against the restored world (the generation
 * chain, the process state hash, the engine state hash), then the rest of
 * the driver script runs, the episode finishes, and the run record is
 * collected. A resumed run finishes with the IDENTICAL record as an
 * uninterrupted run — proven in fixtures.test.ts.
 */
export async function resumeGenerativeFixture(
  engine: EngineDriver,
  exported: GenerativeRunState,
  overrides: Partial<GenerativeFixtureOptions> = {},
): Promise<GenerativeFixtureRun> {
  const options = fixtureOptions(overrides);
  const inputs: GenerativeWorldInputs = { engine };
  const resumed = resumeGenerativeWorldService(exported, inputs);
  const service = unwrap(resumed);
  const episodeId = service.episodes[0];
  if (episodeId === undefined) throw new Error('resumed service carries no episode');

  const script = fixtureDriverScript();
  const stopAfter = options.stopAfterDriverStep;
  const from = stopAfter === null ? 0 : stopAfter;
  for (let index = from; index < script.length; index++) {
    const step = script[index];
    if (step === undefined) break;
    if (step.kind === 'settle') {
      settleAt(service, episodeId, step.to as TimestampMs);
    } else {
      settleAt(service, episodeId, step.at as TimestampMs);
      unwrap(service.submit(episodeId, step.action));
    }
  }
  const horizon = (T0 + options.horizonMs - 1_000) as TimestampMs;
  settleAt(service, episodeId, horizon);
  unwrap(service.finish(episodeId, { code: 'completed', detail: 'fixture scenario complete' }));
  const record = unwrap(service.runRecord(episodeId));
  const evolutionJson = evolutionJsonOf(service, episodeId, record, horizon);
  return {
    service,
    episodeId,
    record,
    engineState: unwrap(service.engineState(episodeId)),
    fills: unwrap(service.fills(episodeId)),
    generatedEvents: unwrap(service.generatedEvents(episodeId)),
    observations: unwrap(service.observe(episodeId, horizon)),
    evolutionJson,
    exportedState: null,
  };
}

/** The fixture config hash (deterministic; computed through the full config validator — no engine needed). */
export function fixtureConfigHash(overrides: Partial<GenerativeFixtureOptions> = {}): string {
  const validated = validateGenerativeWorldConfig(fixtureWorldConfig(overrides));
  if (!validated.ok) throw new Error(`fixture config invalid: ${JSON.stringify(validated.errors)}`);
  return configHash(validated.value);
}

/** Re-export for consumers (the interleaving policy literal of the fixture). */
export type { InterleavingPolicy, GenerativeWorldConfig };

/** The frozen fixture constants (deeply frozen — the immutability discipline). */
export const FIXTURE_CONSTANTS = deepFreeze({ T0 });
