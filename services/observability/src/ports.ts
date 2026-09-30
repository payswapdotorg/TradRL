// @tradrl/observability_service — the injected ports.
//
// THE INSTANT SOURCE (the no-ambient-clock law, mirrored from
// services/execution-gateway/src/ports.ts — T040's `scriptedInstants`
// pattern): the collector never reads `Date.now()`; time arrives
// through {@link InstantSource} — a host-injected sequence. The tests
// script deterministic instant lists; the runtime host injects its
// own clock at the secure boundary. Each recorded telemetry consumes
// EXACTLY ONE instant (the `recordedAt` instant — L4's explicit
// point-in-time law).
//
// THE CONSUMER PORTS: "no network/real I/O; consumers arrive as
// injected ports" — {@link TelemetrySink} is the consumer surface. A
// sink receives every record the collector successfully appends, in
// append order. Sinks are host-owned: a throwing sink aborts the
// dispatch loop but never the append (the record is already durably
// in the log); hosts wanting isolation wrap their own sinks.

import type { TelemetryRecord } from '../../../packages/observability/src/index';

// ---------------------------------------------------------------------------
// The injected instant source (the no-ambient-clock law)
// ---------------------------------------------------------------------------

/** The host-injected instant source: each recorded telemetry consumes exactly ONE instant. */
export interface InstantSource {
  /** The next recording instant (epoch ms; non-decreasing — a regression is a typed error). */
  next(): number;
}

/**
 * The scripted instant source (the deterministic tests' clock): a
 * fixed list consumed in order; exhaustion fails loudly (a scripted
 * scenario that under-provisions instants is a test-authoring error,
 * never a silent reuse). Mirror of T040's `scriptedInstants`.
 */
export interface ScriptedInstants extends InstantSource {
  /** How many instants remain unconsumed. */
  remaining(): number;
}

/** Build a scripted instant source over an explicit, non-decreasing list. */
export function scriptedInstants(instants: readonly number[]): ScriptedInstants {
  if (instants.length === 0) throw new Error('scriptedInstants requires at least one instant');
  for (let index = 1; index < instants.length; index++) {
    if (instants[index] < instants[index - 1]) {
      throw new Error(`scriptedInstants requires a non-decreasing sequence (position ${index} regresses)`);
    }
  }
  let cursor = 0;
  return {
    next(): number {
      if (cursor >= instants.length) {
        throw new Error(`scriptedInstants exhausted after ${instants.length} instants — the scenario under-provisions the clock`);
      }
      const value = instants[cursor] as number;
      cursor += 1;
      return value;
    },
    remaining(): number {
      return instants.length - cursor;
    },
  };
}

// ---------------------------------------------------------------------------
// The injected consumer port (the emission surface)
// ---------------------------------------------------------------------------

/**
 * The telemetry consumer port: receives every successfully-appended
 * telemetry record, in append order. Hosts inject sinks (exporters,
 * indexers, alerters); the collector performs no I/O of its own.
 */
export interface TelemetrySink {
  /** Receive one appended record (never called for a record that failed to append). */
  ingest(record: TelemetryRecord): void;
}

/** Guard: a structurally valid telemetry sink (an ingest function). */
export function isTelemetrySink(v: unknown): v is TelemetrySink {
  return typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>).ingest === 'function';
}
