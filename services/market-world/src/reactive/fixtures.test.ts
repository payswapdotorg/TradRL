/**
 * The GOLDEN WORLD EVOLUTION battery (work order T027, acceptance
 * criteria 3, 8, 9): byte-identical determinism (twice), the interleaving
 * contrasts (the declared policy is part of the deterministic function),
 * and resumability (serialize -> parse -> resume continues identically;
 * tamper = chain_mismatch) — all over the REAL exchange-sim engine bound
 * through the injected driver port.
 */

import { describe, expect, it } from 'vitest';
import * as exchangeSim from '../../../../packages/exchange-sim/src/index';
import type { EngineDriver, EngineStateMirror, SubmitOutcomeMirror, CancelOutcomeMirror, AdvanceOutcomeMirror, EngineOpResult } from './exchange-mirror';
import { runReactiveFixture, resumeReactiveFixture } from './fixtures';
import type { ReactiveFixtureRun } from './fixtures';
import { serializeReactiveRunState, deserializeReactiveRunState, requireReactiveFill } from './records';
import type { ReactiveRunRecord } from './records';

const T0 = 1_700_000_000_000;

/** The REAL engine binding (the mirror seam — see service.test.ts for the witnesses). */
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

function expectFailure(result: { readonly ok: boolean; readonly errors?: readonly { readonly code: string; readonly message: string }[] }, code: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('unreachable');
  expect(result.errors?.[0]?.code).toBe(code);
}

// ---------------------------------------------------------------------------
// Criterion 3 — the golden determinism (byte-identical, twice)
// ---------------------------------------------------------------------------

const runA: ReactiveFixtureRun = await runReactiveFixture(realEngineDriver());
const runB: ReactiveFixtureRun = await runReactiveFixture(realEngineDriver());

describe('the golden world evolution (criterion 3 — deterministic, byte-identical, twice)', () => {

  it('the full scenario exercises the engine: fills exist from the candidate AND the scripted participants', () => {
    expect(runA.fills.length).toBeGreaterThanOrEqual(4);
    const participants = new Set(runA.fills.map((fill) => fill.taker_participant));
    expect(participants.has('agent-candidate-alpha')).toBe(true);
    expect(participants.has('agent-adversary-beta')).toBe(true);
    expect(participants.has('agent-maker-gamma')).toBe(false); // the maker only rests/cancels/expires in this scenario — no taker fill
  });

  it('every fill passes the total physics-lineage guard', () => {
    for (const fill of runA.fills) {
      expect(unwrap(requireReactiveFill(fill))).toBe(fill);
    }
  });

  it('same inputs -> BYTE-IDENTICAL evolution: engine state, fills, observations (deep-equal, twice)', () => {
    expect(runA.evolutionJson).toBe(runB.evolutionJson);
    expect(runA.engineState).toEqual(runB.engineState);
    expect(runA.fills).toEqual(runB.fills);
    expect(runA.observations).toEqual(runB.observations);
  });

  it('the engine state hash is stable across runs (the byte-identity anchor)', () => {
    const a = unwrap(runA.service.engineStateHash(runA.episodeId));
    const b = unwrap(runB.service.engineStateHash(runB.episodeId));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });

  it('the run records are deeply equal with identical digests (L9 — identical runs, identical records)', () => {
    const recordA = runA.record as ReactiveRunRecord;
    const recordB = runB.record as ReactiveRunRecord;
    expect(recordA).toEqual(recordB);
    expect(recordA.digest).toBe(recordB.digest);
    expect(recordA.engine.engine_state_hash).toBe(recordB.engine.engine_state_hash);
    expect(recordA.world.mode).toBe('reactive_replay');
    expect(recordA.ingestion.chain_head).toBe(recordB.ingestion.chain_head);
  });

  it('the engine state hash inside the record equals the live engine state hash', () => {
    const record = runA.record as ReactiveRunRecord;
    expect(record.engine.engine_state_hash).toBe(unwrap(runA.service.engineStateHash(runA.episodeId)));
  });

  it('a DIFFERENT seed changes the evolution (the golden run is a function of its inputs, not a constant)', async () => {
    const other = await runReactiveFixture(realEngineDriver(), { seed: 'reactive-fixture-delta' });
    expect(other.evolutionJson).not.toBe(runA.evolutionJson);
  });
});

// ---------------------------------------------------------------------------
// Criterion 8 — the interleaving contrasts (the policy is enforced + material)
// ---------------------------------------------------------------------------

const streamFirst: ReactiveFixtureRun = await runReactiveFixture(realEngineDriver(), { interleaving: 'stream_first' });
const actionsFirst: ReactiveFixtureRun = await runReactiveFixture(realEngineDriver(), { interleaving: 'actions_first' });
const unrestricted: ReactiveFixtureRun = await runReactiveFixture(realEngineDriver(), { interleaving: 'unrestricted' });

describe('the declared interleaving policy (criterion 8 — the order is part of the deterministic function)', () => {

  it('the collision instant orders differently under stream_first vs actions_first (the policy is material)', () => {
    // At T0+30_000 the recorded quote (rf-000004) becomes available exactly
    // when the adversary's market sell fires. stream_first emits the
    // historical observation BEFORE the engine outcomes; actions_first
    // after. The OBSERVATION ORDER differs — the policy is material.
    const idsOf = (run: ReactiveFixtureRun): readonly string[] => run.observations.map((observation) => observation.observation_id);
    expect(idsOf(streamFirst)).not.toEqual(idsOf(actionsFirst));
    // Crisply: in stream_first the quote (rf-000004) precedes the engine
    // outcomes of the collision instant; in actions_first it follows them.
    // (The collision anchor: the market sell's bid-sweep fill, printed at
    // '100' — unique to the collision instant.)
    const indexOf = (run: ReactiveFixtureRun, id: string): number => idsOf(run).indexOf(id);
    const sellSweepObservationId = idsOf(actionsFirst).find((id) => {
      const observation = actionsFirst.observations.find((candidate) => candidate.observation_id === id);
      if (observation === undefined) return false;
      const payload = observation.payload as { readonly [key: string]: unknown };
      if (payload.kind !== 'fill') return false;
      const data = payload.data as { readonly price?: unknown };
      return data.price === '100';
    }) as string;
    expect(indexOf(streamFirst, 'rf-000004')).toBeGreaterThan(-1);
    expect(indexOf(streamFirst, 'rf-000004')).toBeLessThan(indexOf(streamFirst, sellSweepObservationId));
    expect(indexOf(actionsFirst, 'rf-000004')).toBeGreaterThan(indexOf(actionsFirst, sellSweepObservationId));
  });

  it('unrestricted ties break like stream_first (the declared tie-break)', () => {
    // The PURE ENGINE evolution is identical (book, orders, fills — the physics)...
    expect(unrestricted.engineState).toEqual(streamFirst.engineState);
    expect(unrestricted.fills.map((fill) => fill.fill)).toEqual(streamFirst.fills.map((fill) => fill.fill));
    expect(unrestricted.record?.engine.engine_state_hash).toBe(streamFirst.record?.engine.engine_state_hash);
    // ...while every lineage-bearing record honestly names its own run: the
    // config IS lineage (L9), so the run ids — and therefore the run refs on
    // fills/receipts/observations — differ because the declared policies differ.
    expect(unrestricted.record?.world.interleaving).toBe('unrestricted');
    expect(streamFirst.record?.world.interleaving).toBe('stream_first');
    expect(unrestricted.fills[0]?.physics.run_ref).not.toBe(streamFirst.fills[0]?.physics.run_ref);
  });

  it('the ENGINE evolution is policy-invariant here (the policies order observations, not physics)', () => {
    // In this scenario the stream step never touches the engine, so all
    // three policies produce the identical engine state — the ordering
    // difference lives entirely in the observation stream.
    expect(actionsFirst.engineState).toEqual(streamFirst.engineState);
    expect(unrestricted.engineState).toEqual(streamFirst.engineState);
  });

  it('each policy still produces a fully-physics-lined fill log (the policy orders, never drops, the physics)', () => {
    for (const run of [streamFirst, actionsFirst, unrestricted]) {
      expect(run.fills.length).toBeGreaterThan(0);
      for (const fill of run.fills) {
        expect(unwrap(requireReactiveFill(fill))).toBe(fill);
      }
      expect((run.record as ReactiveRunRecord).world.interleaving).toBeDefined();
    }
  });

  it('the same policy run twice is byte-identical (each policy is individually deterministic)', async () => {
    const actionsFirstAgain = await runReactiveFixture(realEngineDriver(), { interleaving: 'actions_first' });
    expect(actionsFirstAgain.evolutionJson).toBe(actionsFirst.evolutionJson);
  });
});

// ---------------------------------------------------------------------------
// Criterion 9 — resumability (identical continuation; tamper = chain_mismatch)
// ---------------------------------------------------------------------------

const full: ReactiveFixtureRun = await runReactiveFixture(realEngineDriver());
const stopped: ReactiveFixtureRun = await runReactiveFixture(realEngineDriver(), { stopAfterDriverStep: 2 });

describe('resumability (criterion 9 — serialize -> parse -> resume, the T009 discipline)', () => {

  it('the stopped run exports a parseable run state mid-episode', () => {
    const exported = stopped.exportedState;
    expect(exported).not.toBeNull();
    const serialized = unwrap(serializeReactiveRunState(exported as never));
    const parsed = unwrap(deserializeReactiveRunState(JSON.parse(JSON.stringify(serialized))));
    expect(parsed.phase).toBe('episode');
  });

  it('resume continues identically: the resumed run finishes with the IDENTICAL run record', async () => {
    const resumed = await resumeReactiveFixture(realEngineDriver(), stopped.exportedState as never, { stopAfterDriverStep: 2 });
    const resumedRecord = resumed.record as ReactiveRunRecord;
    const fullRecord = full.record as ReactiveRunRecord;
    expect(resumedRecord).toEqual(fullRecord);
    expect(resumed.evolutionJson).toBe(full.evolutionJson);
  });

  it('resume with a TAMPERED serialized stream fails chain_mismatch (the state, not just the source, is verified)', async () => {
    const serialized = unwrap(serializeReactiveRunState(stopped.exportedState as never));
    const json = JSON.parse(JSON.stringify(serialized)) as Record<string, unknown>;
    const stream = json.stream as Record<string, unknown>[];
    (stream[1] as Record<string, unknown>).available_time = T0 + 19_999; // tamper: move a quote's availability
    const { resumeReactiveWorldService } = await import('./service');
    const { createFixtureEventSource, createFixtureFeeds } = await import('./fixtures');
    const result = await resumeReactiveWorldService(json, { source: createFixtureEventSource(), engine: realEngineDriver(), feeds: createFixtureFeeds() });
    expectFailure(result, 'chain_mismatch');
  });

  it('resume with a MISMATCHED source fails (a different stream cannot impersonate the recorded one)', async () => {
    const { resumeReactiveWorldService } = await import('./service');
    const { createFixtureFeeds } = await import('./fixtures');
    const wrongStream = {
      async *[Symbol.asyncIterator](): AsyncIterator<readonly unknown[], void, undefined> {
        yield [{ event_id: 'rf-000001', venue: 'BINANCE', instrument: 'BTC-USDT', asset_class: 'crypto', event_type: 'book_snapshot', event_time: T0, source_time: T0, available_time: T0, ingestion_time: T0, sequence: 1, provider: 'x', provenance: { origin: 'historical', adapter: { id: 'a', version: '1' }, derived_from: [], transform: null }, payload: { bids: [], asks: [] } }];
      },
    };
    const result = await resumeReactiveWorldService(stopped.exportedState as never, { source: wrongStream, engine: realEngineDriver(), feeds: createFixtureFeeds() });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const code = result.errors[0]?.code;
      expect(code === 'chain_mismatch' || code === 'resume_stream_mismatch').toBe(true);
    }
  });

  it('resume with a DIVERGING scripted feed fails chain_mismatch (the scripts are verified, not trusted)', async () => {
    const { resumeReactiveWorldService } = await import('./service');
    const { createFixtureEventSource, createFixtureFeeds, fixtureAdversaryScript } = await import('./fixtures');
    const { createScriptedActionFeed: buildFeed } = await import('./action-feed');
    // The adversary's script with the first action id rewritten — the
    // divergence from the recorded scripted log must be caught.
    const feeds = createFixtureFeeds();
    const adversaryFeed = feeds[0]?.feed as { peek(): { readonly action: { readonly action_id: string } } | null };
    const firstActionId = adversaryFeed.peek()?.action.action_id as string;
    const divergingScript = fixtureAdversaryScript().map((entry): Record<string, unknown> => {
      const copy = JSON.parse(JSON.stringify(entry)) as Record<string, unknown>;
      const action = copy.action as Record<string, unknown>;
      if (action.action_id === firstActionId) action.action_id = 'not-the-recorded-id';
      return copy;
    });
    const diverging = buildFeed('agent-adversary-beta' as never, divergingScript);
    if (!diverging.ok) throw new Error('diverging feed invalid');
    const result = await resumeReactiveWorldService(stopped.exportedState as never, {
      source: createFixtureEventSource(),
      engine: realEngineDriver(),
      feeds: [
        { ref: 'feed-adversary-beta', feed: diverging.value },
        { ref: 'feed-maker-gamma', feed: feeds[1]?.feed as never },
      ],
    });
    expectFailure(result, 'chain_mismatch');
  });
});
