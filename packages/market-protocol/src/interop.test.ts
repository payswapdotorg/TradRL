/**
 * Cross-package interoperability: @tradrl/market-protocol (canonical event
 * envelope) against @tradrl/time-engine (canonical time domain).
 *
 * The two contract packages are deliberately NOT package-dependencies (the
 * frozen workspace lockfile forbids it), so they share the `TimestampMs`
 * type via a STRUCTURAL MIRROR (see src/timestamp.ts). This test is the trip
 * wire: if either declaration drifts, the type-level assertions below fail
 * `pnpm typecheck`, and the runtime parity checks fail `pnpm test`.
 *
 * It also proves the central L4 behavior end-to-end: a future-dated
 * `available_time` passes envelope validation (envelope validation is
 * timeless) but is withheld by the time-engine firewall until the clock
 * reaches it — and the leakage check catches any premature observation.
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_TIMESTAMP_MS as PROTOCOL_MAX,
  MIN_TIMESTAMP_MS as PROTOCOL_MIN,
  isTimestampMs as protocolIsTimestampMs,
  validateMarketEvent,
  type MarketEvent,
  type TimestampMs as ProtocolTimestampMs,
} from './index';
import {
  MAX_TIMESTAMP_MS as ENGINE_MAX,
  MIN_TIMESTAMP_MS as ENGINE_MIN,
  advanceClockBy,
  advanceClockTo,
  createSimulationClock,
  createVisibilityFilter,
  isTimestampMs as engineIsTimestampMs,
  leakageCheck,
  requireTimestampMs,
  timestampMs,
  type Observable,
  type SimulationClock,
  type TimeResult,
  type TimestampMs as EngineTimestampMs,
} from '../../time-engine/src/index';

// ---------------------------------------------------------------------------
// TYPE-LEVEL ASSERTIONS (fail `pnpm typecheck` if the mirror drifts).
// ---------------------------------------------------------------------------

/** Compiles iff protocol TimestampMs is assignable to engine TimestampMs. */
function protocolTimestampIsEngineTimestamp(value: ProtocolTimestampMs): EngineTimestampMs {
  return value;
}

/** Compiles iff engine TimestampMs is assignable to protocol TimestampMs. */
function engineTimestampIsProtocolTimestamp(value: EngineTimestampMs): ProtocolTimestampMs {
  return value;
}

/** Compiles iff MarketEvent structurally satisfies the firewall's Observable. */
function marketEventIsObservable(value: MarketEvent): Observable {
  return value;
}

/** Compiles iff a clock built from protocol quartet timestamps typechecks. */
function clockAcceptsProtocolTimestamps(value: ProtocolTimestampMs): TimeResult<SimulationClock> {
  return createSimulationClock({ asOf: value, fidelity: 'exact_replay' });
}

// ---------------------------------------------------------------------------
// Test helpers.
// ---------------------------------------------------------------------------

function unwrap<T>(result: TimeResult<T>): T {
  if (result.ok) return result.value;
  throw new Error(`unexpected failure: ${result.error.code}: ${result.error.message}`);
}

function historicalTrade(availableTime: number, sequence = 1): MarketEvent {
  const candidate = {
    event_id: `evt-${availableTime}-${sequence}`,
    venue: 'BINANCE',
    instrument: 'BTC-USDT',
    asset_class: 'crypto',
    event_type: 'trade',
    event_time: requireTimestampMs(availableTime - 50),
    source_time: requireTimestampMs(availableTime - 50),
    available_time: requireTimestampMs(availableTime),
    ingestion_time: requireTimestampMs(availableTime + 100),
    sequence,
    provider: 'binance',
    provenance: { origin: 'historical', adapter: { id: 'binance-adapter', version: '1.4.0' }, derived_from: [], transform: null },
    payload: { price: '43125.10', size: '0.017', side: 'buy' },
  };
  const result = validateMarketEvent(candidate);
  if (!result.ok) throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
  return result.value;
}

describe('TimestampMs structural mirror', () => {
  it('keeps the mirrored constants identical', () => {
    expect(PROTOCOL_MIN).toBe(ENGINE_MIN);
    expect(PROTOCOL_MAX).toBe(ENGINE_MAX);
  });

  it('keeps the mirrored guards behaviorally identical', () => {
    for (const sample of [0, 1, 1.5, -1, ENGINE_MAX, ENGINE_MAX + 1, Number.NaN, 'x', null]) {
      expect(protocolIsTimestampMs(sample)).toBe(engineIsTimestampMs(sample));
    }
  });

  it('exercises the type-level mirror functions (no-op at runtime, compile-time trip wire)', () => {
    const fromEngine = requireTimestampMs(42);
    const asProtocol: ProtocolTimestampMs = engineTimestampIsProtocolTimestamp(fromEngine);
    const asEngine: EngineTimestampMs = protocolTimestampIsEngineTimestamp(asProtocol);
    expect(asEngine).toBe(42);
    expect(clockAcceptsProtocolTimestamps(asProtocol).ok).toBe(true);
  });
});

describe('L4 end-to-end: future-dated availability passes the envelope, is withheld by the firewall', () => {
  const RELEASE_AT = 4_102_444_800_000; // 2100-01-01T00:00:00Z — far future
  const event = historicalTrade(RELEASE_AT);

  it('the envelope accepts the future-dated event (validation is timeless)', () => {
    expect(validateMarketEvent(event).ok).toBe(true);
    expect(event.available_time).toBe(RELEASE_AT);
  });

  it('the firewall withholds it at any clock now before the release instant', () => {
    const clock = unwrap(createSimulationClock({ asOf: requireTimestampMs(RELEASE_AT), now: requireTimestampMs(1_700_000_000_000), fidelity: 'exact_replay' }));
    const filter = createVisibilityFilter<MarketEvent>(clock);
    expect(filter.isVisible(event)).toBe(false);
    expect(filter.filter([event])).toEqual([]);
    expect(filter.withheld([event])).toEqual([event]);

    // One millisecond before release — still withheld.
    const justBefore = unwrap(advanceClockTo(clock, requireTimestampMs(RELEASE_AT - 1)));
    expect(createVisibilityFilter<MarketEvent>(justBefore).isVisible(event)).toBe(false);
  });

  it('the firewall reveals it EXACTLY at the release instant — not one millisecond earlier', () => {
    const clock = unwrap(createSimulationClock({ asOf: requireTimestampMs(RELEASE_AT), now: requireTimestampMs(1_700_000_000_000), fidelity: 'exact_replay' }));
    const atRelease = unwrap(advanceClockTo(clock, requireTimestampMs(RELEASE_AT)));
    const filter = createVisibilityFilter<MarketEvent>(atRelease);
    expect(filter.isVisible(event)).toBe(true);
    expect(filter.filter([event])).toEqual([event]);

    // A leak attempt recorded one millisecond early is caught by the leakage check.
    const oneMsEarly = unwrap(advanceClockTo(clock, requireTimestampMs(RELEASE_AT - 1)));
    const report = leakageCheck([{ clock: oneMsEarly, observed: [event], label: 'premature-observation' }]);
    expect(report.clean).toBe(false);
    expect(report.findings[0]?.kind).toBe('future_observation');
  });

  it('the leakage check certifies a trajectory that only observed the event at/after release', () => {
    const clock = unwrap(
      createSimulationClock({
        asOf: requireTimestampMs(RELEASE_AT + 60_000),
        now: requireTimestampMs(1_700_000_000_000),
        fidelity: 'exact_replay',
      }),
    );
    const before = unwrap(advanceClockTo(clock, requireTimestampMs(RELEASE_AT - 1_000)));
    const at = unwrap(advanceClockTo(clock, requireTimestampMs(RELEASE_AT)));
    const after = unwrap(advanceClockBy(at, { minutes: 1 }));
    const report = leakageCheck([
      { clock: before, observed: [] },
      { clock: at, observed: [event] },
      { clock: after, observed: [event] },
    ]);
    expect(report.clean).toBe(true);
    expect(report.observationsChecked).toBe(2);
  });

  it('MarketEvent structurally satisfies Observable (compile-time) and filters at runtime', () => {
    const events = [historicalTrade(1_000, 1), historicalTrade(2_000, 2), historicalTrade(3_000, 3)];
    const witness: Observable = marketEventIsObservable(events[0] as MarketEvent);
    expect(witness.available_time).toBe(1_000);
    const clock = unwrap(createSimulationClock({ asOf: requireTimestampMs(10_000), now: requireTimestampMs(2_000), fidelity: 'reactive_replay' }));
    const filter = createVisibilityFilter<MarketEvent>(clock);
    expect(filter.filter(events).map((event) => event.event_id)).toEqual(['evt-1000-1', 'evt-2000-2']);
    expect(filter.withheld(events).map((event) => event.event_id)).toEqual(['evt-3000-3']);
  });
});

describe('clock arithmetic over event timestamps', () => {
  it('T - x minutes anchors historical queries through the engine', () => {
    const event = historicalTrade(1_700_000_000_050);
    const fiveMinutesBefore = timestampMs(event.available_time - 5 * 60_000);
    expect(fiveMinutesBefore.ok).toBe(true);
    if (!fiveMinutesBefore.ok) throw new Error('bad fixture');

    // Start the clock five minutes before the event's availability.
    const clock = unwrap(
      createSimulationClock({ asOf: event.available_time, now: fiveMinutesBefore.value, fidelity: 'exact_replay' }),
    );
    expect(createVisibilityFilter<MarketEvent>(clock).isVisible(event)).toBe(false);

    // Advance exactly five minutes — the event releases precisely then.
    const atRelease = unwrap(advanceClockBy(clock, { minutes: 5 }));
    expect(atRelease.now).toBe(event.available_time);
    expect(createVisibilityFilter<MarketEvent>(atRelease).isVisible(event)).toBe(true);
  });
});
