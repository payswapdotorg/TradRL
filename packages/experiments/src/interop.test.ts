/**
 * Cross-package interoperability for @tradrl/experiments:
 *
 * 1. `TimestampMs` structural mirror against @tradrl/time-engine (canonical
 *    owner) — the market-protocol trip-wire pattern.
 * 2. Trial/lineage reference mirrors against @tradrl/trajectory (the OTHER
 *    T011 package): contract packages never import each other at runtime,
 *    but the brand tags (`TrajectoryId`, `EnvironmentConfigRef`, `DataRef`)
 *    are re-declared identically so the references stay mutually assignable —
 *    the type-level assertions below fail `pnpm typecheck` if either
 *    declaration drifts.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  MAX_TIMESTAMP_MS as EXPERIMENTS_MAX,
  MIN_TIMESTAMP_MS as EXPERIMENTS_MIN,
  isTimestampMs as experimentsIsTimestampMs,
  requireTimestampMs as experimentsRequireTimestampMs,
  timestampMs as experimentsTimestampMs,
  type DataRef as ExperimentsDataRef,
  type EnvironmentConfigRef as ExperimentsEnvironmentConfigRef,
  type TimestampMs as ExperimentsTimestampMs,
  type TrajectoryId as ExperimentsTrajectoryId,
} from './index';
import {
  MAX_TIMESTAMP_MS as ENGINE_MAX,
  MIN_TIMESTAMP_MS as ENGINE_MIN,
  isTimestampMs as engineIsTimestampMs,
  requireTimestampMs,
  type TimestampMs as EngineTimestampMs,
} from '../../time-engine/src/index';
import {
  type DataRef as TrajectoryDataRef,
  type EnvironmentConfigRef as TrajectoryEnvironmentConfigRef,
  type TrajectoryId as TrajectoryTrajectoryId,
} from '../../trajectory/src/index';

// ---------------------------------------------------------------------------
// TYPE-LEVEL ASSERTIONS (fail `pnpm typecheck` if a mirror drifts).
// ---------------------------------------------------------------------------

/** Compiles iff experiments TimestampMs is assignable to engine TimestampMs. */
function experimentsTimestampIsEngineTimestamp(value: ExperimentsTimestampMs): EngineTimestampMs {
  return value;
}

/** Compiles iff engine TimestampMs is assignable to experiments TimestampMs. */
function engineTimestampIsExperimentsTimestamp(value: EngineTimestampMs): ExperimentsTimestampMs {
  return value;
}

/** Compiles iff an experiments TrajectoryId ref is assignable to the trajectory package's TrajectoryId. */
function experimentsTrajectoryRefIsTrajectoryId(value: ExperimentsTrajectoryId): TrajectoryTrajectoryId {
  return value;
}

/** Compiles iff a trajectory package TrajectoryId is assignable to an experiments ref. */
function trajectoryIdIsExperimentsTrajectoryRef(value: TrajectoryTrajectoryId): ExperimentsTrajectoryId {
  return value;
}

/** Compiles iff the environment-config ref brands coincide across the two T011 packages. */
function experimentsEnvConfigIsTrajectoryEnvConfig(value: ExperimentsEnvironmentConfigRef): TrajectoryEnvironmentConfigRef {
  return value;
}

/** Compiles iff the data-ref brands coincide across the two T011 packages. */
function experimentsDataRefIsTrajectoryDataRef(value: ExperimentsDataRef): TrajectoryDataRef {
  return value;
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe('TimestampMs structural mirror (time-engine trip wire)', () => {
  it('keeps the mirrored constants identical', () => {
    expect(EXPERIMENTS_MIN).toBe(ENGINE_MIN);
    expect(EXPERIMENTS_MAX).toBe(ENGINE_MAX);
  });

  it('keeps the mirrored guards behaviorally identical', () => {
    for (const sample of [0, 1, 1.5, -1, ENGINE_MAX, ENGINE_MAX + 1, Number.NaN, 'x', null]) {
      expect(experimentsIsTimestampMs(sample)).toBe(engineIsTimestampMs(sample));
    }
  });

  it('accepts a time-engine-shaped value and rejects out-of-range values with typed errors', () => {
    const fromEngine = requireTimestampMs(1_700_000_000_000);
    expect(experimentsIsTimestampMs(fromEngine)).toBe(true);
    expect(experimentsTimestampMs(fromEngine).ok).toBe(true);
    const roundTrip = experimentsRequireTimestampMs(fromEngine);
    expect(engineIsTimestampMs(roundTrip)).toBe(true);
    expect(experimentsTimestampMs(ENGINE_MAX + 1).ok).toBe(false);
    expect(experimentsTimestampMs(-1).ok).toBe(false);
    expect(experimentsTimestampMs(Number.NaN).ok).toBe(false);
  });

  it('exercises the type-level mirror functions (compile-time trip wire)', () => {
    const fromEngine = requireTimestampMs(42);
    const asExperiments: ExperimentsTimestampMs = engineTimestampIsExperimentsTimestamp(fromEngine);
    const asEngine: EngineTimestampMs = experimentsTimestampIsEngineTimestamp(asExperiments);
    expect(asEngine).toBe(42);
    expectTypeOf<ExperimentsTimestampMs>().toEqualTypeOf<EngineTimestampMs>();
  });
});

describe('trajectory reference mirrors (cross-T011 trip wire)', () => {
  it('TrajectoryId / EnvironmentConfigRef / DataRef are mutually assignable across the two packages', () => {
    const trajectoryId: ExperimentsTrajectoryId = 'traj-1' as ExperimentsTrajectoryId;
    const asTrajectoryPackageId: TrajectoryTrajectoryId = experimentsTrajectoryRefIsTrajectoryId(trajectoryId);
    const backToExperimentsRef: ExperimentsTrajectoryId = trajectoryIdIsExperimentsTrajectoryRef(asTrajectoryPackageId);
    expect(backToExperimentsRef).toBe('traj-1');

    const envConfig: ExperimentsEnvironmentConfigRef = 'envcfg-5d3e8f21' as ExperimentsEnvironmentConfigRef;
    expect(experimentsEnvConfigIsTrajectoryEnvConfig(envConfig)).toBe('envcfg-5d3e8f21');

    const dataRef: ExperimentsDataRef = 'dataset-x' as ExperimentsDataRef;
    expect(experimentsDataRefIsTrajectoryDataRef(dataRef)).toBe('dataset-x');

    expectTypeOf<ExperimentsTrajectoryId>().toEqualTypeOf<TrajectoryTrajectoryId>();
    expectTypeOf<ExperimentsEnvironmentConfigRef>().toEqualTypeOf<TrajectoryEnvironmentConfigRef>();
    expectTypeOf<ExperimentsDataRef>().toEqualTypeOf<TrajectoryDataRef>();
  });
});
