/**
 * @tradrl/market-world (service) — deterministic fixture event streams.
 *
 * THE PROVENANCE DISCIPLINE (acceptance criterion 10): the exact-replay
 * world accepts events whose provenance origin is `historical` ONLY. Fixture
 * streams are SYNTHETIC in the ordinary sense (generated, not observed), so
 * they DECLARE themselves as recorded history EXPLICITLY: every fixture
 * event carries `origin: 'historical'` with the adapter reference
 * `{ id: 'replay-fixture-adapter', version: '1.0.0' }`. The world cannot
 * (and need not) distinguish a fixture from a vendor feed — the discipline
 * is that the fixture generator only ever emits records that claim, honestly
 * within the laboratory, "this is the recorded history". Real recorded
 * history enters through T008's ingestion adapters with the same law.
 *
 * Determinism (L9): every choice (prices, sizes, sides, latencies, embargo
 * patterns, type interleaving) is driven by a SEEDED xorshift32 PRNG keyed
 * on the fixture seed — the same options always generate the byte-identical
 * stream, so two service runs from the same fixture produce deeply equal
 * run records.
 *
 * Payload taxonomies mirror @tradrl/market-protocol: decimal-string prices
 * and sizes; `trade` (price/size/side), `quote` (bid/ask price+size),
 * `book_snapshot` (bids/asks levels); plus one DERIVED `other:vwap_1m`
 * aggregate per batch (historical origin, explicit lineage and transform —
 * derived observations obey the same L4 boundary as primitive ones).
 */

import { fnv1a32Hex } from '../../../../packages/market-world/src/index';
import type { ReplayEventSource } from './event-source';

/** Options governing a deterministic fixture stream. */
export interface FixtureStreamOptions {
  /** Venue of the single fixture stream. Default 'BINANCE'. */
  readonly venue: string;
  /** Instrument of the single fixture stream. Default 'BTC-USDT'. */
  readonly instrument: string;
  /** Asset class of the fixture stream. Default 'crypto'. */
  readonly asset_class: string;
  /** The deterministic seed — EVERY choice in the stream derives from it. */
  readonly seed: string;
  /** Epoch-ms instant of the first event. Default 1_700_000_000_000. */
  readonly baseTime: number;
  /** Milliseconds between consecutive event times. Default 500. */
  readonly stepMs: number;
  /** Number of batches. Default 3. */
  readonly batches: number;
  /** Primitive events per batch (the derived vwap aggregate is extra). Default 6. */
  readonly eventsPerBatch: number;
}

const DEFAULTS = {
  venue: 'BINANCE',
  instrument: 'BTC-USDT',
  asset_class: 'crypto',
  baseTime: 1_700_000_000_000,
  stepMs: 500,
  batches: 3,
  eventsPerBatch: 6,
} as const;

/** Resolve options against defaults (explicit fields win). */
export function fixtureOptions(overrides: Partial<FixtureStreamOptions> = {}): FixtureStreamOptions {
  return {
    venue: overrides.venue ?? DEFAULTS.venue,
    instrument: overrides.instrument ?? DEFAULTS.instrument,
    asset_class: overrides.asset_class ?? DEFAULTS.asset_class,
    seed: overrides.seed ?? 'fixture-seed-alpha',
    baseTime: overrides.baseTime ?? DEFAULTS.baseTime,
    stepMs: overrides.stepMs ?? DEFAULTS.stepMs,
    batches: overrides.batches ?? DEFAULTS.batches,
    eventsPerBatch: overrides.eventsPerBatch ?? DEFAULTS.eventsPerBatch,
  };
}

/** A seeded xorshift32 PRNG in [0, 1) — deterministic across runs and processes. */
function createSeededRandom(seed: string): () => number {
  let state = Number.parseInt(fnv1a32Hex(seed), 16) || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x1_0000_0000;
  };
}

/** The fixture provenance block — the explicit recorded-historical declaration. */
export const FIXTURE_ADAPTER = { id: 'replay-fixture-adapter', version: '1.0.0' } as const;

function historicalProvenance(derivedFrom: readonly string[] = [], transform: string | null = null): Record<string, unknown> {
  return { origin: 'historical', adapter: { ...FIXTURE_ADAPTER }, derived_from: derivedFrom, transform };
}

/**
 * The full deterministic event history of a fixture stream, as UNTRUSTED
 * records (the world validates them through its own guards). Events are
 * grouped per batch in arrival order; each batch ends with a derived
 * `other:vwap_1m` aggregate over that batch's trades.
 */
export function fixtureEventBatches(options: Partial<FixtureStreamOptions> = {}): readonly (readonly Record<string, unknown>[])[] {
  const opts = fixtureOptions(options);
  const random = createSeededRandom(opts.seed);
  const sequence = new Map<string, number>();
  const nextSequence = (stream: string): number => {
    const next = (sequence.get(stream) ?? 0) + 1;
    sequence.set(stream, next);
    return next;
  };

  let price = 43_000;
  const walk = (magnitude: number): string => {
    price += (random() - 0.5) * magnitude;
    return price.toFixed(2);
  };
  const size = (scale: number): string => (0.001 + random() * scale).toFixed(3);
  const side = (): 'buy' | 'sell' => (random() < 0.5 ? 'buy' : 'sell');
  const latency = (): number => {
    const roll = random();
    if (roll < 0.2) return 500; // embargoed: available 500ms after event_time
    if (roll < 0.6) return 40;
    return 120;
  };

  const batches: Record<string, unknown>[][] = [];
  let globalIndex = 0;
  for (let batchIndex = 0; batchIndex < opts.batches; batchIndex++) {
    const batch: Record<string, unknown>[] = [];
    const tradeIds: string[] = [];
    let latestAvailable = opts.baseTime;

    for (let within = 0; within < opts.eventsPerBatch; within++) {
      const eventTime = opts.baseTime + globalIndex * opts.stepMs;
      const availableTime = eventTime + latency();
      // Embargoed records are ingested BEFORE they become available; the
      // rest after (ingestion_time is deliberately unordered — D-003).
      const ingestionTime = availableTime > eventTime + 250 ? eventTime + 10 : availableTime + Math.floor(random() * 60);
      const id = `fx-${String(globalIndex).padStart(6, '0')}`;
      const kind = globalIndex % 4;
      latestAvailable = Math.max(latestAvailable, availableTime);

      if (kind === 0) {
        // Top-of-book quote (decimal strings, market-protocol taxonomy).
        const bid = walk(80);
        const ask = (Number(bid) + 1 + random() * 4).toFixed(2);
        batch.push({
          event_id: id,
          venue: opts.venue,
          instrument: opts.instrument,
          asset_class: opts.asset_class,
          event_type: 'quote',
          event_time: eventTime,
          source_time: eventTime,
          available_time: availableTime,
          ingestion_time: ingestionTime,
          sequence: nextSequence('quote'),
          provider: 'replay-fixtures',
          provenance: historicalProvenance(),
          payload: { bid_price: bid, bid_size: size(2), ask_price: ask, ask_size: size(2) },
        });
      } else if (kind === 1 || kind === 2) {
        // Executed trade print.
        batch.push({
          event_id: id,
          venue: opts.venue,
          instrument: opts.instrument,
          asset_class: opts.asset_class,
          event_type: 'trade',
          event_time: eventTime,
          source_time: eventTime,
          available_time: availableTime,
          ingestion_time: ingestionTime,
          sequence: nextSequence('trade'),
          provider: 'replay-fixtures',
          provenance: historicalProvenance(),
          payload: { price: walk(120), size: size(1), side: side() },
        });
        tradeIds.push(id);
      } else {
        // Full book snapshot (replaces prior state; recorded world-state snapshot).
        const mid = Number(walk(60));
        batch.push({
          event_id: id,
          venue: opts.venue,
          instrument: opts.instrument,
          asset_class: opts.asset_class,
          event_type: 'book_snapshot',
          event_time: eventTime,
          source_time: eventTime,
          available_time: availableTime,
          ingestion_time: ingestionTime,
          sequence: nextSequence('book_snapshot'),
          provider: 'replay-fixtures',
          provenance: historicalProvenance(),
          payload: {
            bids: [
              { price: mid.toFixed(2), size: size(3) },
              { price: (mid - 2).toFixed(2), size: size(3) },
            ],
            asks: [
              { price: (mid + 2).toFixed(2), size: size(3) },
              { price: (mid + 4).toFixed(2), size: size(3) },
            ],
          },
        });
      }
      globalIndex += 1;
    }

    // The derived aggregate: historical origin, explicit lineage + transform
    // (derived observations obey the same L4 boundary as primitive ones),
    // available AT the earliest legal instant (after its latest input).
    if (tradeIds.length > 0) {
      batch.push({
        event_id: `fx-vwap-${String(batchIndex).padStart(6, '0')}`,
        venue: opts.venue,
        instrument: opts.instrument,
        asset_class: opts.asset_class,
        event_type: 'other',
        event_time: latestAvailable,
        source_time: null,
        available_time: latestAvailable + 1,
        ingestion_time: latestAvailable + 2,
        sequence: nextSequence('other:vwap_1m'),
        provider: 'replay-fixtures',
        provenance: historicalProvenance(tradeIds, 'fixture-vwap-1m'),
        payload: { kind: 'vwap_1m', data: { window_ms: 60_000, over_trades: tradeIds.length } },
      });
    }

    batches.push(batch);
  }

  return batches;
}

/** The flattened fixture history (all batches, arrival order). */
export function fixtureEvents(options: Partial<FixtureStreamOptions> = {}): readonly Record<string, unknown>[] {
  return fixtureEventBatches(options).flat();
}

/**
 * A fresh {@link ReplayEventSource} over the fixture stream. Call again for a
 * second, identical source (resume re-pulls and verifies the digest chain).
 */
export function createFixtureEventSource(options: Partial<FixtureStreamOptions> = {}): ReplayEventSource {
  const batches = fixtureEventBatches(options);
  async function* generate(): AsyncGenerator<readonly unknown[], void, undefined> {
    for (const batch of batches) {
      yield batch;
    }
  }
  return generate() as ReplayEventSource;
}

/** The latest instant the fixture stream can make anything available (for as_of). */
export function fixtureLatestAvailability(options: Partial<FixtureStreamOptions> = {}): number {
  const events = fixtureEvents(options);
  let latest = 0;
  for (const event of events) {
    const available = event.available_time;
    if (typeof available === 'number' && available > latest) latest = available;
  }
  return latest;
}

/**
 * A world config that matches a fixture stream (stream selected, as_of anchor
 * covering the whole stream with margin, deterministic seed bound).
 */
export function fixtureWorldConfig(options: Partial<FixtureStreamOptions> = {}): Record<string, unknown> {
  const opts = fixtureOptions(options);
  return {
    world_id: `world-replay-fixture-${opts.seed}`,
    fidelity: 'exact_replay',
    information_policy: 'point-in-time',
    seed: opts.seed,
    as_of: fixtureLatestAvailability(opts) + 60_000,
    streams: [{ venue: opts.venue, instrument: opts.instrument }],
    playback_speed: 1,
  };
}

/**
 * An episode spec that binds to {@link fixtureWorldConfig}: the clock stands
 * at the stream start and anchors at the world's as_of.
 */
export function fixtureSpec(options: Partial<FixtureStreamOptions> = {}): Record<string, unknown> {
  const opts = fixtureOptions(options);
  const config = fixtureWorldConfig(opts);
  const asOf = config.as_of as number;
  return {
    profile: {
      environment_id: `env-replay-fixture-${opts.seed}`,
      fidelity: 'exact_replay',
      clock: { now: opts.baseTime, asOf, playbackSpeed: 1, paused: false, fidelity: 'exact_replay', informationPolicy: 'point-in-time' },
      seed: opts.seed,
      venue_scope: [],
      instrument_scope: [],
      latency_policy: null,
      fee_policy: null,
    },
    world: { world_id: config.world_id, kind: 'replay' },
    information_policy: 'point-in-time',
  };
}
