/**
 * @tradrl/time-engine — the point-in-time information boundary for TradRL.
 *
 * Public API. This package is the canonical owner of the time domain:
 *   - `TimestampMs` — the canonical branded timestamp type (epoch ms).
 *   - `Duration` + clock arithmetic — all time comparisons and offsets.
 *   - `SimulationClock` — now, asOf, playback speed, pause/resume, fidelity.
 *   - `Observable` / `createVisibilityFilter` — the L4 information firewall:
 *     an observation is visible iff `available_time <= now` (inclusive).
 *   - `leakageCheck` — forensic scan of recorded (clock, observed) samples.
 *   - `DerivedAvailability` / `derivedAvailableTime` — the timestamp contract
 *     for derived features, aggregates, labels and cached data.
 *
 * Zero runtime dependencies; types, schemas and pure functions only. There is
 * deliberately NO wall-clock coupling here (`Date.now()` never appears) —
 * runtime services drive clocks, contract code only validates and transforms.
 */

// Errors and results
export type { TimeErrorCode, TimeError, TimeResult } from './errors';
export { fail, ok } from './errors';

// Timestamp domain (canonical)
export type { TimestampMs } from './timestamp';
export {
  MIN_TIMESTAMP_MS,
  MAX_TIMESTAMP_MS,
  isTimestampMs,
  timestampMs,
  requireTimestampMs,
  fromIso,
  toIso,
  compareTimestamps,
  isBefore,
  isAfter,
  isBeforeOrEqual,
  isAfterOrEqual,
  maxTimestamps,
  minTimestamps,
  anchorAt,
  anchorFromIso,
} from './timestamp';

// Durations
export type { Duration } from './duration';
export {
  isDuration,
  durationToMs,
  durationMilliseconds,
  durationSeconds,
  durationMinutes,
  durationHours,
  durationDays,
} from './duration';

// SimulationClock
export type { FidelityMode, InformationPolicy, SimulationClock, SimulationClockSpec } from './clock';
export {
  FIDELITY_MODES,
  isFidelityMode,
  isSimulationClock,
  createSimulationClock,
  advanceClockTo,
  advanceClockBy,
  withPlaybackSpeed,
  pauseClock,
  resumeClock,
} from './clock';

// Information boundary (firewall)
export type { Observable, VisibilityFilter } from './boundary';
export { isVisibleAt, observableAt, createVisibilityFilter } from './boundary';

// Leakage forensics
export type { TrajectorySample, FutureObservationFinding, ClockRegressionFinding, LeakageFinding, LeakageReport } from './leakage';
export { leakageCheck } from './leakage';

// Derived-state availability contract
export type { ComputationPolicy, DerivedAvailability } from './derived';
export { isComputationPolicy, isDerivedAvailability, derivedAvailableTime, validateDerivedAvailability } from './derived';

/** Package identity and ownership (Work Order T004). */
export const packageInfo = {
  name: '@tradrl/time-engine',
  owner: 'T004',
  status: 'implemented',
} as const;
