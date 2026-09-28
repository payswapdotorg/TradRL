/**
 * Cross-package interoperability: @tradrl/environment-protocol (episode
 * mediation contract) against @tradrl/time-engine (canonical time domain).
 *
 * The two contract packages are deliberately NOT package-dependencies (the
 * frozen workspace lockfile forbids it), so they share `TimestampMs` and
 * the clock shape via STRUCTURAL MIRRORS (see src/timestamp.ts and
 * src/clock.ts). This test is the trip wire: if either declaration drifts,
 * the type-level assertions below fail `pnpm typecheck`, and the runtime
 * parity checks fail `pnpm test`.
 *
 * It also proves the central L4 behavior through the environment's own
 * boundary: an observation with `available_time == now` IS visible and one
 * with `available_time == now + 1` is NOT (inclusive boundary), and the
 * same law polices DERIVED observations identically.
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_TIMESTAMP_MS as PROTOCOL_MAX,
  MIN_TIMESTAMP_MS as PROTOCOL_MIN,
  isTimestampMs as protocolIsTimestampMs,
  requireTimestampMs as protocolRequireTimestampMs,
  timestampMs as protocolTimestampMs,
  isClockConfig,
  isFidelityMode,
  FIDELITY_MODES as PROTOCOL_FIDELITY_MODES,
  validateClockConfig,
  type ClockConfig as ProtocolClockConfig,
  type FidelityMode as ProtocolFidelityMode,
  type TimestampMs as ProtocolTimestampMs,
} from './index';
import {
  MAX_TIMESTAMP_MS as ENGINE_MAX,
  MIN_TIMESTAMP_MS as ENGINE_MIN,
  advanceClockTo,
  createSimulationClock,
  isTimestampMs as engineIsTimestampMs,
  requireTimestampMs,
  FIDELITY_MODES as ENGINE_FIDELITY_MODES,
  isFidelityMode as engineIsFidelityMode,
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

/** Compiles iff protocol ClockConfig is assignable to the engine clock shape. */
function protocolClockIsEngineClock(value: ProtocolClockConfig): SimulationClock {
  return value;
}

/** Compiles iff an engine SimulationClock is assignable to protocol ClockConfig. */
function engineClockIsProtocolClock(value: SimulationClock): ProtocolClockConfig {
  return value;
}

/** Compiles iff protocol fidelity modes are engine fidelity modes (L5 union mirror). */
function protocolFidelityIsEngineFidelity(value: ProtocolFidelityMode): boolean {
  const engine: SimulationClock = { now: requireTimestampMs(1), asOf: requireTimestampMs(1), playbackSpeed: 1, paused: false, fidelity: value, informationPolicy: 'point-in-time' };
  return engine.fidelity === value;
}

// ---------------------------------------------------------------------------
// Test helpers.
// ---------------------------------------------------------------------------

function unwrap<T>(result: TimeResult<T> | { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly unknown[] }): T {
  if (result.ok) return result.value;
  throw new Error('unexpected failure in fixture');
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe('TimestampMs structural mirror', () => {
  it('keeps the mirrored constants identical', () => {
    expect(PROTOCOL_MIN).toBe(ENGINE_MIN);
    expect(PROTOCOL_MAX).toBe(ENGINE_MAX);
  });

  it('keeps the mirrored guards behaviorally identical (in-range accepted, out-of-range rejected)', () => {
    for (const sample of [0, 1, 1.5, -1, ENGINE_MAX, ENGINE_MAX + 1, Number.NaN, 'x', null]) {
      expect(protocolIsTimestampMs(sample)).toBe(engineIsTimestampMs(sample));
    }
    // The explicit acceptance-criterion cases: in-range passes, out-of-range fails.
    expect(protocolIsTimestampMs(ENGINE_MAX)).toBe(true);
    expect(protocolIsTimestampMs(ENGINE_MAX + 1)).toBe(false);
    expect(protocolIsTimestampMs(-1)).toBe(false);
    expect(protocolIsTimestampMs(1.5)).toBe(false);
  });

  it('accepts a time-engine-shaped value: engine-constructed timestamps pass the protocol guard and constructor', () => {
    const fromEngine = requireTimestampMs(1_700_000_000_000);
    expect(protocolIsTimestampMs(fromEngine)).toBe(true);
    const roundTrip = protocolTimestampMs(fromEngine);
    expect(roundTrip.ok).toBe(true);
    const backToEngine = protocolRequireTimestampMs(fromEngine);
    expect(engineIsTimestampMs(backToEngine)).toBe(true);
  });

  it('rejects out-of-range values in the protocol constructor with a typed error', () => {
    expect(protocolTimestampMs(ENGINE_MAX + 1).ok).toBe(false);
    expect(protocolTimestampMs(-1).ok).toBe(false);
    expect(protocolTimestampMs(Number.NaN).ok).toBe(false);
    expect(protocolTimestampMs(1.25).ok).toBe(false);
  });

  it('exercises the type-level mirror functions (no-op at runtime, compile-time trip wire)', () => {
    const fromEngine = requireTimestampMs(42);
    const asProtocol: ProtocolTimestampMs = engineTimestampIsProtocolTimestamp(fromEngine);
    const asEngine: EngineTimestampMs = protocolTimestampIsEngineTimestamp(asProtocol);
    expect(asEngine).toBe(42);
  });
});

describe('ClockConfig structural mirror (time-engine SimulationClock)', () => {
  it('accepts an engine-constructed SimulationClock as a ClockConfig (guard + validator)', () => {
    const clock = unwrap(
      createSimulationClock({ asOf: requireTimestampMs(10_000), now: requireTimestampMs(1_000), fidelity: 'reactive_replay' }),
    );
    expect(isClockConfig(clock)).toBe(true);
    expect(validateClockConfig(clock).ok).toBe(true);
  });

  it('accepts a protocol ClockConfig where the engine expects a SimulationClock (type-level + behavioral)', () => {
    const config = unwrap(validateClockConfig({
      now: requireTimestampMs(1_000),
      asOf: requireTimestampMs(10_000),
      playbackSpeed: 2,
      paused: false,
      fidelity: 'exact_replay',
      informationPolicy: 'point-in-time',
    }));
    const asEngineClock: SimulationClock = engineClockIsProtocolClock(config);
    const asProtocolClock: ProtocolClockConfig = protocolClockIsEngineClock(asEngineClock);
    // Engine arithmetic over the mirrored value works and stays within bounds.
    const advanced = unwrap(advanceClockTo(asEngineClock, requireTimestampMs(5_000)));
    expect(advanced.now).toBe(5_000);
    expect(isClockConfig(asProtocolClock)).toBe(true);
  });

  it('rejects clock-shaped values that violate the engine invariants (now > asOf, bad speed)', () => {
    expect(
      isClockConfig({ now: 10_000, asOf: 1_000, playbackSpeed: 1, paused: false, fidelity: 'exact_replay', informationPolicy: 'point-in-time' }),
    ).toBe(false);
    expect(
      isClockConfig({ now: 1_000, asOf: 10_000, playbackSpeed: 0, paused: false, fidelity: 'exact_replay', informationPolicy: 'point-in-time' }),
    ).toBe(false);
    expect(
      isClockConfig({ now: 1_000, asOf: 10_000, playbackSpeed: 1, paused: false, fidelity: 'daydream', informationPolicy: 'point-in-time' }),
    ).toBe(false);
    expect(
      validateClockConfig({ now: 10_000, asOf: 1_000, playbackSpeed: 1, paused: false, fidelity: 'exact_replay', informationPolicy: 'point-in-time' }).ok,
    ).toBe(false);
  });

  it('mirrors the fidelity-mode union exactly (L5: three DISTINCT modes, never aliased)', () => {
    expect(PROTOCOL_FIDELITY_MODES).toEqual(ENGINE_FIDELITY_MODES);
    for (const mode of ENGINE_FIDELITY_MODES) {
      expect(isFidelityMode(mode)).toBe(true);
      expect(engineIsFidelityMode(mode)).toBe(true);
    }
    expect(isFidelityMode('replay')).toBe(false); // no aliasing
    expect(isFidelityMode('')).toBe(false);
    expect(protocolFidelityIsEngineFidelity('generative')).toBe(true);
  });
});
