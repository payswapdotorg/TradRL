/**
 * @tradrl/time-machine — the ingest clock (Work Order T029).
 *
 * L9 (reproducible lineage) + the T029 law "no wall-clock: time advances by
 * injected events only": the machine NEVER consults a wall clock. The one
 * place a timestamp is ADDED by the machine is the quartet's
 * `ingestion_time` (advisory on input, stamped at admission — mirroring the
 * T008 store's commit stamping), and that stamp comes from an INJECTED
 * deterministic clock, exactly like T008's `createDeterministicCommitClock`.
 *
 * The default is the built-in deterministic stepping clock
 * (base, base+step, base+2*step, ...): same config -> same stamps -> same
 * machine state for the same event sequence (the determinism law). The
 * clock STATE is pure data (base, stepMs, consumed) so snapshots can
 * transfer it and restores reproduce identical subsequent stamps.
 */

import { fail, ok, type TimeMachineResult } from './errors';
import { isTimestampMs, type TimestampMs } from './timestamp';
import { isNonNegativeSafeInteger } from './canonical-event';

/**
 * The ingest clock port: supplies admission ingestion timestamps, one per
 * admitted record, in admission order. Injected; deterministic by contract.
 */
export interface IngestClock {
  next(): TimestampMs;
}

/** Serializable state of the built-in deterministic stepping clock. */
export interface DeterministicClockState {
  readonly kind: 'builtin-stepping';
  readonly base: TimestampMs;
  readonly step_ms: number;
  /** Stamps already consumed (the tick is one past this on the next call). */
  readonly consumed: number;
}

/** A deterministic stepping clock with pure-data, transferable state. */
export interface DeterministicIngestClock extends IngestClock {
  /** The clock's serializable state (snapshot/restore transfer). */
  state(): DeterministicClockState;
}

/**
 * Create a deterministic ingest clock: base, base+step, base+2*step, ...
 * `consumed` pre-advances the tick (used by snapshot restore to reproduce
 * the original machine's future stamps exactly). The base must be a valid
 * timestamp and the step a positive safe integer (typed failures; the clock
 * is configuration, not trusted literal).
 */
export function createDeterministicIngestClock(
  base: number,
  stepMs = 1,
  consumed = 0,
): TimeMachineResult<DeterministicIngestClock> {
  if (!isTimestampMs(base)) {
    return fail('invalid_config', `the ingest clock base is not a valid epoch-millisecond timestamp: ${base}`);
  }
  if (typeof stepMs !== 'number' || !Number.isSafeInteger(stepMs) || stepMs < 1) {
    return fail('invalid_config', `the ingest clock step must be a positive safe integer: ${stepMs}`);
  }
  if (!isNonNegativeSafeInteger(consumed)) {
    return fail('invalid_config', `the ingest clock consumed count must be a non-negative safe integer: ${consumed}`);
  }
  let tick = consumed;
  const clock: DeterministicIngestClock = {
    next(): TimestampMs {
      const stamp = base + tick * stepMs;
      tick += 1;
      if (!isTimestampMs(stamp)) {
        // A deterministic clock that ran off the representable range is a
        // configuration error surfaced as a thrown programming error — the
        // machine catches it and converts it to a typed ingest failure.
        throw new RangeError(`the deterministic ingest clock produced an out-of-range timestamp: ${stamp}`);
      }
      return stamp;
    },
    state(): DeterministicClockState {
      return { kind: 'builtin-stepping', base, step_ms: stepMs, consumed: tick };
    },
  };
  return ok(clock);
}

/** Guard for the serializable clock state. */
export function isDeterministicClockState(value: unknown): value is DeterministicClockState {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== 'builtin-stepping') return false;
  if (!isTimestampMs(candidate.base)) return false;
  if (typeof candidate.step_ms !== 'number' || !Number.isSafeInteger(candidate.step_ms) || candidate.step_ms < 1) {
    return false;
  }
  return isNonNegativeSafeInteger(candidate.consumed);
}

/**
 * Pull one stamp out of an injected clock, converting programming errors
 * (thrown RangeError) and invalid stamps into the machine's typed failure.
 */
export function nextIngestStamp(clock: IngestClock): TimeMachineResult<TimestampMs> {
  let stamp: unknown;
  try {
    stamp = clock.next();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail('invalid_ingest_clock', `the injected ingest clock threw: ${message}`);
  }
  if (!isTimestampMs(stamp)) {
    return fail('invalid_ingest_clock', `the injected ingest clock produced an invalid timestamp: ${String(stamp)}`);
  }
  return ok(stamp);
}
