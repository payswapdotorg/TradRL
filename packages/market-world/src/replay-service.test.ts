/**
 * @tradrl/market-world — ReplayWorldService behavioral tests (the reference
 * implementation lives in services/market-world/src/replay/).
 *
 * WHY THIS FILE LIVES IN THE CONTRACT PACKAGE: the root vitest config (frozen
 * for this Work Order) collects tests from `packages/**` and `tests/**`
 * only — `tests/` is outside this Work Order's write surface — so the
 * service's tests live beside the contract tests here and import the service
 * by relative path (the same cross-package-import-in-tests exception as the
 * interop trip wires). The Lead may relocate them under services/ when the
 * root test config next changes.
 *
 * Covers the service-level acceptance criteria:
 *   - 3  Determinism: two runs from identical config+stream produce
 *        deeply-equal ReplayRunRecords (JSON.stringify comparison).
 *   - 4  The firewall end-to-end through the service (inclusive boundary).
 *   - 7  The intent log is complete and ordered in the run record.
 *   - 9  Resume: mid-episode and mid-ingest resumption finish with the
 *        identical record; a mismatched stream is rejected.
 *   - Service discipline: load-then-bind, phase errors, run-state export.
 */

import { describe, expect, it } from 'vitest';

import {
  createReplayWorldService,
  deserializeReplayRunState,
  fixtureEvents,
  fixtureSpec,
  fixtureWorldConfig,
  createFixtureEventSource,
  resumeReplayWorldService,
  serializeReplayRunState,
  type ReplayRunRecord,
  type ReplayWorldService,
} from '../../../services/market-world/src/index';
import type { FixtureStreamOptions } from '../../../services/market-world/src/index';
import { requireTimestampMs, type EpisodeId, type WorldResult } from './index';

const BASE = 1_700_000_000_000;
const t = (ms: number) => requireTimestampMs(ms);

function unwrap<T>(result: WorldResult<T>): T {
  if (result.ok) return result.value;
  throw new Error(`unexpected failure: ${JSON.stringify(result.errors)}`);
}

async function unwrapAsync<T>(promise: Promise<WorldResult<T>>): Promise<T> {
  const result = await promise;
  if (result.ok) return result.value;
  throw new Error(`unexpected failure: ${JSON.stringify(result.errors)}`);
}

const STREAM: Partial<FixtureStreamOptions> = { seed: 'determinism-seed-1', batches: 3, eventsPerBatch: 6, stepMs: 500 };

/**
 * The deterministic driver: the same scripted behavior for every run —
 * observe, advance, observe, submit, advance, observe, submit, finish.
 */
interface DriverStops {
  readonly firstAdvance: number;
  readonly secondAdvance: number;
}

const STOPS: DriverStops = { firstAdvance: BASE + 2_200, secondAdvance: BASE + 4_000 };

async function driveRun(stream: Partial<FixtureStreamOptions> = STREAM, stops: DriverStops = STOPS): Promise<ReplayRunRecord> {
  const service = unwrap(createReplayWorldService(fixtureWorldConfig(stream), createFixtureEventSource(stream)));
  await unwrapAsync(service.loadAll());
  const view = unwrap(service.start(fixtureSpec(stream)));
  const episode: EpisodeId = view.episode_id;

  // Step 1: observe at the stream start (nothing embargoed released yet).
  const first = unwrap(service.observe(episode, t(BASE)));
  expect(first.length).toBeGreaterThanOrEqual(0);

  // Step 2: advance and observe.
  unwrap(service.advance(episode, t(stops.firstAdvance)));
  unwrap(service.observe(episode, t(stops.firstAdvance)));

  // Step 3: an intent, recorded — never matched.
  unwrap(
    service.submit(episode, {
      action_id: 'intent-1',
      actor: 'agent-alpha',
      submitted_at: stops.firstAdvance,
      client_sequence: 1,
      payload: { kind: 'order_intent', side: 'buy', instrument: 'BTC-USDT', quantity: '0.010' },
    }),
  );

  // Step 4: advance, observe, second intent.
  unwrap(service.advance(episode, t(stops.secondAdvance)));
  unwrap(service.observe(episode, t(stops.secondAdvance)));
  unwrap(
    service.submit(episode, {
      action_id: 'intent-2',
      actor: 'agent-alpha',
      submitted_at: stops.secondAdvance,
      client_sequence: 2,
      payload: { kind: 'order_intent', side: 'sell', instrument: 'BTC-USDT', quantity: '0.005' },
    }),
  );

  // Step 5: finish at the anchor.
  const finished = unwrap(service.finish(episode, { code: 'completed', detail: 'driver finished the scripted run' }));
  expect(finished.episode.status).toBe('finished');

  return unwrap(service.runRecord(episode));
}

describe('determinism (criterion 3)', () => {
  it('two runs from identical config+stream produce deeply-equal run records (JSON.stringify)', async () => {
    const recordA = await driveRun();
    const recordB = await driveRun();
    expect(JSON.stringify(recordA)).toBe(JSON.stringify(recordB));
    expect(recordA).toEqual(recordB);
  });

  it('the record is a well-formed L9 lineage: config hash, streams, event count, clock timeline, intent log, digest', async () => {
    const record = await driveRun();
    const events = fixtureEvents(STREAM);
    expect(record.schema).toBe('tradrl/replay-run-record@1');
    expect(record.world.config_hash).toMatch(/^[0-9a-f]{8}$/);
    expect(record.world.seed).toBe('determinism-seed-1');
    expect(record.world.fidelity).toBe('exact_replay');
    expect(record.world.streams).toEqual(['BINANCE|BTC-USDT']);
    expect(record.ingestion.batches).toBe(3);
    expect(record.ingestion.events).toBe(events.length);
    expect(record.ingestion.snapshot_count).toBeGreaterThan(0);
    expect(record.ingestion.streams_seen.length).toBeGreaterThan(0);
    expect(record.ingestion.chain_head).toMatch(/^[0-9a-f]{8}$/);
    expect(record.clock_timeline).toEqual([
      { from: BASE, to: STOPS.firstAdvance },
      { from: STOPS.firstAdvance, to: STOPS.secondAdvance },
    ]);
    expect(record.intent_log.map((receipt) => receipt.action_id)).toEqual(['intent-1', 'intent-2']);
    expect(record.intent_log.every((receipt) => receipt.disposition === 'recorded_as_intent')).toBe(true);
    expect(record.episode.termination.code).toBe('completed');
    expect(record.episode.final_now).toBe(STOPS.secondAdvance);
    expect(record.observations.queries).toBe(3);
    expect(record.observations.served).toBeGreaterThan(0);
    expect(record.digest).toMatch(/^[0-9a-f]{8}$/);
  });

  it('a different seed produces a different record (the lineage binds the config and the stream)', async () => {
    const recordA = await driveRun(STREAM);
    const recordB = await driveRun({ ...STREAM, seed: 'determinism-seed-2' });
    expect(JSON.stringify(recordA)).not.toBe(JSON.stringify(recordB));
    expect(recordA.world.config_hash).not.toBe(recordB.world.config_hash);
    expect(recordA.ingestion.chain_head).not.toBe(recordB.ingestion.chain_head);
  });

  it('a different driver behavior produces a different timeline in the record', async () => {
    const recordA = await driveRun(STREAM, STOPS);
    const recordB = await driveRun(STREAM, { firstAdvance: BASE + 1_500, secondAdvance: BASE + 5_000 });
    expect(JSON.stringify(recordA)).not.toBe(JSON.stringify(recordB));
    expect(recordB.clock_timeline[0]?.to).toBe(BASE + 1_500); // sanity: the first stop's own timeline entry
    expect(recordB.clock_timeline[1]?.to).toBe(BASE + 5_000);
  });
});

describe('the firewall end-to-end through the service (criterion 4)', () => {
  it('delivers available_time == now and withholds available_time == now + 1 (inclusive boundary)', async () => {
    const stream = { seed: 'boundary-seed', batches: 1, eventsPerBatch: 4, stepMs: 100 };
    const service = unwrap(createReplayWorldService(fixtureWorldConfig(stream), createFixtureEventSource(stream)));
    await unwrapAsync(service.loadAll());
    const view = unwrap(service.start(fixtureSpec(stream)));

    // Walk the stream to find an event with a distinct availability instant.
    const events = fixtureEvents(stream);
    const withAvailability = events
      .map((event) => ({ id: event.event_id as string, available: event.available_time as number }))
      .sort((a, b) => a.available - b.available);
    const target = withAvailability[withAvailability.length - 2]; // second-to-last availability
    const last = withAvailability[withAvailability.length - 1];
    if (target === undefined || last === undefined) throw new Error('fixture too small');

    // Stand exactly at the target's availability: it IS delivered.
    unwrap(service.advance(view.episode_id, t(target.available)));
    const atNow = unwrap(service.observe(view.episode_id, t(target.available)));
    expect(atNow.some((observation) => observation.observation_id === target.id)).toBe(true);
    // One millisecond earlier: it is NOT.
    const before = unwrap(service.observe(view.episode_id, t(target.available - 1)));
    expect(before.some((observation) => observation.observation_id === target.id)).toBe(false);

    // The last event (strictly later availability) is still embargoed at target.available.
    if (last.available > target.available) {
      expect(atNow.some((observation) => observation.observation_id === last.id)).toBe(false);
      unwrap(service.advance(view.episode_id, t(last.available)));
      const atLast = unwrap(service.observe(view.episode_id, t(last.available)));
      expect(atLast.some((observation) => observation.observation_id === last.id)).toBe(true);
    }
  });

  it('the derived vwap observations obey the same law (delivered exactly at their availability)', async () => {
    const stream = { seed: 'boundary-seed', batches: 2, eventsPerBatch: 4, stepMs: 100 };
    const service = unwrap(createReplayWorldService(fixtureWorldConfig(stream), createFixtureEventSource(stream)));
    await unwrapAsync(service.loadAll());
    const view = unwrap(service.start(fixtureSpec(stream)));
    const derived = fixtureEvents(stream).find((event) => event.event_type === 'other');
    if (derived === undefined) throw new Error('fixture must carry a derived event');
    const available = derived.available_time as number;

    unwrap(service.advance(view.episode_id, t(available - 1)));
    const before = unwrap(service.observe(view.episode_id, t(available - 1)));
    expect(before.some((observation) => observation.observation_id === derived.event_id)).toBe(false);

    unwrap(service.advance(view.episode_id, t(available)));
    const atNow = unwrap(service.observe(view.episode_id, t(available)));
    const found = atNow.find((observation) => observation.observation_id === derived.event_id);
    expect(found).toBeDefined();
    // The derived observation carries its lineage (same law, visible provenance).
    expect(found?.provenance.derived_from.length).toBeGreaterThan(0);
  });
});

describe('resume (criterion 9)', () => {
  it('mid-EPISODE resume: the serialized state continues to the identical final record', async () => {
    // The uninterrupted reference run.
    const reference = await driveRun();

    // The interrupted run: load, start, first advance + observe + intent, export.
    const service1 = unwrap(createReplayWorldService(fixtureWorldConfig(STREAM), createFixtureEventSource(STREAM)));
    await unwrapAsync(service1.loadAll());
    const view = unwrap(service1.start(fixtureSpec(STREAM)));
    unwrap(service1.observe(view.episode_id, t(BASE)));
    unwrap(service1.advance(view.episode_id, t(STOPS.firstAdvance)));
    unwrap(service1.observe(view.episode_id, t(STOPS.firstAdvance)));
    unwrap(
      service1.submit(view.episode_id, {
        action_id: 'intent-1',
        actor: 'agent-alpha',
        submitted_at: STOPS.firstAdvance,
        client_sequence: 1,
        payload: { kind: 'order_intent', side: 'buy', instrument: 'BTC-USDT', quantity: '0.010' },
      }),
    );
    const exported = unwrap(service1.exportRunState(view.episode_id));

    // Round-trip through JSON (the artifact is portable).
    const serialized = unwrap(serializeReplayRunState(exported));
    const restoredRunState = unwrap(deserializeReplayRunState(JSON.parse(JSON.stringify(serialized))));

    // Resume with a fresh source over the same stream (fast-forward + verify).
    const service2 = unwrap(await resumeReplayWorldService(restoredRunState, createFixtureEventSource(STREAM)));

    // Drive the remainder exactly as the reference driver does.
    unwrap(service2.advance(view.episode_id, t(STOPS.secondAdvance)));
    unwrap(service2.observe(view.episode_id, t(STOPS.secondAdvance)));
    unwrap(
      service2.submit(view.episode_id, {
        action_id: 'intent-2',
        actor: 'agent-alpha',
        submitted_at: STOPS.secondAdvance,
        client_sequence: 2,
        payload: { kind: 'order_intent', side: 'sell', instrument: 'BTC-USDT', quantity: '0.005' },
      }),
    );
    unwrap(service2.finish(view.episode_id, { code: 'completed', detail: 'driver finished the scripted run' }));
    const resumed = unwrap(service2.runRecord(view.episode_id));

    expect(JSON.stringify(resumed)).toBe(JSON.stringify(reference));
  });

  it('mid-INGEST resume: a state exported between batches continues to the identical final record', async () => {
    const reference = await driveRun();

    // Consume only ONE of the three batches, then export the loading state.
    const service1 = unwrap(createReplayWorldService(fixtureWorldConfig(STREAM), createFixtureEventSource(STREAM)));
    const first = await unwrapAsync(service1.loadNextBatch());
    expect(first.done).toBe(false);
    expect(first.batches_consumed).toBe(1);
    const exported = unwrap(service1.exportRunState());
    expect(exported.phase).toBe('loading');

    const serialized = unwrap(serializeReplayRunState(exported));
    const restored = unwrap(deserializeReplayRunState(JSON.parse(JSON.stringify(serialized))));

    // Resume with a fresh source: the fast-forward verifies batch 0's digest
    // against the recorded chain, then ingestion continues with batches 1-2.
    const service2 = unwrap(await resumeReplayWorldService(restored, createFixtureEventSource(STREAM)));
    const summary = await unwrapAsync(service2.loadAll());
    expect(summary.batches).toBe(3);

    // Drive the full episode exactly as the reference driver.
    const view = unwrap(service2.start(fixtureSpec(STREAM)));
    unwrap(service2.observe(view.episode_id, t(BASE)));
    unwrap(service2.advance(view.episode_id, t(STOPS.firstAdvance)));
    unwrap(service2.observe(view.episode_id, t(STOPS.firstAdvance)));
    unwrap(
      service2.submit(view.episode_id, {
        action_id: 'intent-1',
        actor: 'agent-alpha',
        submitted_at: STOPS.firstAdvance,
        client_sequence: 1,
        payload: { kind: 'order_intent', side: 'buy', instrument: 'BTC-USDT', quantity: '0.010' },
      }),
    );
    unwrap(service2.advance(view.episode_id, t(STOPS.secondAdvance)));
    unwrap(service2.observe(view.episode_id, t(STOPS.secondAdvance)));
    unwrap(
      service2.submit(view.episode_id, {
        action_id: 'intent-2',
        actor: 'agent-alpha',
        submitted_at: STOPS.secondAdvance,
        client_sequence: 2,
        payload: { kind: 'order_intent', side: 'sell', instrument: 'BTC-USDT', quantity: '0.005' },
      }),
    );
    unwrap(service2.finish(view.episode_id, { code: 'completed', detail: 'driver finished the scripted run' }));
    const resumed = unwrap(service2.runRecord(view.episode_id));

    expect(JSON.stringify(resumed)).toBe(JSON.stringify(reference));
  });

  it('rejects resuming against a MISMATCHED stream (resume_stream_mismatch)', async () => {
    const service1 = unwrap(createReplayWorldService(fixtureWorldConfig(STREAM), createFixtureEventSource(STREAM)));
    await unwrapAsync(service1.loadNextBatch());
    const exported = unwrap(service1.exportRunState());
    const serialized = unwrap(serializeReplayRunState(exported));
    const restored = unwrap(deserializeReplayRunState(JSON.parse(JSON.stringify(serialized))));

    // A DIFFERENT seed = a different stream = digest mismatch on fast-forward.
    const mismatched = await resumeReplayRunStateSafe(restored, createFixtureEventSource({ ...STREAM, seed: 'a-different-seed' }));
    expect(mismatched.ok).toBe(false);
    if (mismatched.ok) return;
    expect(mismatched.errors[0]?.code).toBe('resume_stream_mismatch');
  });

  it('rejects a tampered run state with typed errors (never silently)', async () => {
    const service1 = unwrap(createReplayWorldService(fixtureWorldConfig(STREAM), createFixtureEventSource(STREAM)));
    await unwrapAsync(service1.loadNextBatch());
    const exported = unwrap(service1.exportRunState());
    const serialized = unwrap(serializeReplayRunState(exported)) as Record<string, unknown>;
    const tampered = { ...serialized, batches_consumed: 99 };
    const result = await resumeReplayRunStateSafe(tampered, createFixtureEventSource(STREAM));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((error) => error.code === 'invalid_state')).toBe(true);
  });
});

/** await-friendly wrapper that never throws (for negative-path assertions). */
async function resumeReplayRunStateSafe(state: unknown, source: Parameters<typeof resumeReplayWorldService>[1]): Promise<WorldResult<ReplayWorldService>> {
  return resumeReplayWorldService(state, source);
}

describe('service discipline (load-then-bind, phase errors)', () => {
  it('rejects start before the stream is fully loaded (ingestion_pending)', async () => {
    const service = unwrap(createReplayWorldService(fixtureWorldConfig(STREAM), createFixtureEventSource(STREAM)));
    const one = await unwrapAsync(service.loadNextBatch());
    expect(one.done).toBe(false);
    const result = service.start(fixtureSpec(STREAM));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('ingestion_pending');
  });

  it('rejects ingestion after an episode bound (ingestion_closed) and exportRunState() then requires an episode id', async () => {
    const service = unwrap(createReplayWorldService(fixtureWorldConfig(STREAM), createFixtureEventSource(STREAM)));
    await unwrapAsync(service.loadAll());
    const view = unwrap(service.start(fixtureSpec(STREAM)));
    const result = await service.loadNextBatch();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('ingestion_closed');
    expect(service.exportRunState().ok).toBe(false);
    expect(service.exportRunState(view.episode_id).ok).toBe(true);
  });

  it('loadNextBatch is idempotent once the source is exhausted', async () => {
    const service = unwrap(createReplayWorldService(fixtureWorldConfig(STREAM), createFixtureEventSource(STREAM)));
    const summary = await unwrapAsync(service.loadAll());
    expect(summary.batches).toBe(3);
    const again = await unwrapAsync(service.loadNextBatch());
    expect(again.done).toBe(true);
    expect(again.batches_consumed).toBe(3);
  });

  it('rejects runRecord before finish (episode_not_finished) and unknown episodes (unknown_episode)', async () => {
    const service = unwrap(createReplayWorldService(fixtureWorldConfig(STREAM), createFixtureEventSource(STREAM)));
    await unwrapAsync(service.loadAll());
    const view = unwrap(service.start(fixtureSpec(STREAM)));

    const early = service.runRecord(view.episode_id);
    expect(early.ok).toBe(false);
    if (early.ok) return;
    expect(early.errors[0]?.code).toBe('episode_not_finished');

    const unknown = service.observe('ep-nope' as EpisodeId, t(BASE));
    expect(unknown.ok).toBe(false);
    if (unknown.ok) return;
    expect(unknown.errors[0]?.code).toBe('unknown_episode');
  });

  it('rejects a non-async-iterable source at construction (invalid_source)', () => {
    const result = createReplayWorldService(fixtureWorldConfig(STREAM), { not: 'iterable' } as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('invalid_source');
  });

  it('propagates the stream-in laws: a batch violating the sequence discipline fails the load with the world error', async () => {
    // Build a fixture stream, then corrupt a sequence in the LAST batch.
    const batches = [
      [
        {
          event_id: 'x-1', venue: 'BINANCE', instrument: 'BTC-USDT', asset_class: 'crypto', event_type: 'trade',
          event_time: BASE, source_time: BASE, available_time: BASE + 10, ingestion_time: BASE + 20,
          sequence: 5, provider: 'replay-fixtures',
          provenance: { origin: 'historical', adapter: { id: 'replay-fixture-adapter', version: '1.0.0' }, derived_from: [], transform: null },
          payload: { price: '100.00', size: '1.000', side: 'buy' },
        },
        {
          event_id: 'x-2', venue: 'BINANCE', instrument: 'BTC-USDT', asset_class: 'crypto', event_type: 'trade',
          event_time: BASE + 100, source_time: BASE + 100, available_time: BASE + 110, ingestion_time: BASE + 120,
          sequence: 3, provider: 'replay-fixtures', // REGRESSION against sequence 5
          provenance: { origin: 'historical', adapter: { id: 'replay-fixture-adapter', version: '1.0.0' }, derived_from: [], transform: null },
          payload: { price: '101.00', size: '1.000', side: 'sell' },
        },
      ],
    ];
    async function* poisoned(): AsyncGenerator<readonly unknown[], void, undefined> {
      for (const batch of batches) yield batch;
    }
    const config = { ...fixtureWorldConfig(STREAM), streams: [{ venue: 'BINANCE', instrument: 'BTC-USDT' }] };
    const service = unwrap(createReplayWorldService(config, poisoned()));
    const result = await service.loadAll();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.code).toBe('sequence_regression');
  });
});
