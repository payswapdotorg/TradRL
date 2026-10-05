/**
 * T050 — the observability plane's chain-work laws (the deterministic
 * performance surface).
 *
 * THE LAW (R40 audit/observability + ARCHITECTURE-LOCK L4/L9/L12,
 * pinned AT SCALE as operation-count and byte-budget laws — never
 * wall clock): the telemetry plane's work is EXACTLY linear in its
 * observations — one record, one instant, one sink delivery each; the
 * chain verifies totally at any scale; every record's serialized
 * bytes stay under a recorded budget (log volume is predictable); a
 * point-in-time query returns EXACTLY its prefix (bounded by the
 * prefix, never the whole log); filtered queries return EXACTLY their
 * matching count (result work proportional to matches); and the whole
 * log reproduces + rebuilds byte-identically (L9 — reproducibility is
 * the reliability property).
 *
 * THE METHOD (the tests/performance/README.md discipline): drive the
 * REAL collector (services/observability — the same injected-instant
 * + injected-sink machinery its own suite uses) through a scripted
 * 500-observation workload and assert counts and bytes. No network,
 * no clock, no randomness. The read laws share ONE drive (the log is
 * a frozen snapshot); the sink + determinism laws drive their own.
 *
 * HONEST COST NOTE (recorded, not asserted): the append discipline is
 * immutable-copy (each append re-copies the record array), so the
 * compute cost of growing a log is quadratic in its length. At
 * production demo scope (hundreds of records per tenant/project) this
 * is irrelevant; the laws below pin the WORK contract (counts, bytes,
 * prefixes — exactly linear), never the machine's compute time.
 *
 * Relation to services/observability/src/*.test.ts: the per-record
 * laws (one instant, one delivery, the asOf boundary) are pinned
 * there at 3-5 records; THIS suite pins the same laws at 500 records
 * as SCALING laws — the shapes a long-running production scope
 * actually accumulates.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import {
  canonicalJson,
  type ProjectId,
  type TelemetryRecord,
  type TimestampMs,
  type TenantId,
} from '../../packages/observability/src/index';
import { createObservabilityCollector, type ObservabilityCollector } from '../../services/observability/src/collector';
import { scriptedInstants, type ScriptedInstants, type TelemetrySink } from '../../services/observability/src/ports';
import {
  canonicalTelemetryLogJson,
  latestRecordedAt,
  replayTelemetryLog,
  telemetryRecordTree,
  verifyTelemetryLog,
  type TelemetryLog,
} from '../../services/observability/src/log';
import { queryTelemetry } from '../../services/observability/src/query';

// ---------------------------------------------------------------------------
// The scripted workload (deterministic at every scale)
// ---------------------------------------------------------------------------

const T0 = 1_717_459_200_000 as TimestampMs;
const TENANT = 'tenant-perf-observability' as TenantId;
const PROJECT = 'project-perf-observability' as ProjectId;
const N = 500;

/** One scripted instant per observation, one second apart (the prefix law's exact ruler). */
function workloadInstants(): readonly number[] {
  return Array.from({ length: N }, (_, index) => T0 + index * 1_000);
}

const GATEWAY_SEAM = { kind: 'gateway-audit', auditId: 'xga:0f1e2d3c', tenant: TENANT, project: PROJECT } as const;
const SERVICE_ACTOR = { kind: 'service', ref: 'execution-gateway' } as const;
const BOUNDARY_ACTOR = { kind: 'service', ref: 'api-boundary' } as const;
const OPERATOR_ACTOR = { kind: 'operator', ref: 'lead' } as const;

/** The observation script: i%2===0 -> metric; i%4===1 -> trace-span; i%4===3 -> log. */
function recordOne(collector: ObservabilityCollector, index: number): { ok: boolean } {
  if (index % 2 === 0) {
    return collector.metric({ actor: SERVICE_ACTOR, seam: GATEWAY_SEAM, name: `gateway.submissions.${index % 10}`, value: index });
  }
  if (index % 4 === 1) {
    return collector.traceSpan({ actor: BOUNDARY_ACTOR, seam: GATEWAY_SEAM, name: `pipeline.request.${index % 10}`, durationMs: 3, status: 'ok' });
  }
  return collector.logEntry({ actor: OPERATOR_ACTOR, seam: GATEWAY_SEAM, level: 'info', message: `observation ${index}` });
}

/** Unwrap a result or fail loudly. */
function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly { readonly message: string }[] }): T {
  if (result.ok) return result.value;
  throw new Error(`must succeed: ${JSON.stringify(result.errors)}`);
}

/** A recording sink (captures every ingested record). */
function recordingSink(): { sink: TelemetrySink; records: TelemetryRecord[] } {
  const records: TelemetryRecord[] = [];
  return { sink: { ingest: (record) => { records.push(record); } }, records };
}

/** Drive the full scripted workload once. */
function driveWorkload(sinks: readonly TelemetrySink[] = []): { instants: ScriptedInstants; collector: ObservabilityCollector; log: TelemetryLog } {
  const instants = scriptedInstants([...workloadInstants()]);
  const collector = unwrap(createObservabilityCollector({ tenant: TENANT, project: PROJECT, instants, sinks }));
  for (let index = 0; index < N; index++) {
    const result = recordOne(collector, index);
    if (!result.ok) throw new Error(`observation ${index} failed`);
  }
  return { instants, collector, log: collector.currentLog() };
}

// ---------------------------------------------------------------------------
// The read laws over the SHARED 500-record log (one drive, frozen snapshot)
// ---------------------------------------------------------------------------

describe('the 500-record scripted workload — the read laws (one shared drive)', () => {
  let instants: ScriptedInstants;
  let log: TelemetryLog;

  beforeAll(() => {
    ({ instants, log } = driveWorkload());
  });

  // LAW 1 — append linearity (one record, one instant — at 500)
  it('500 observations produce EXACTLY 500 records with contiguous 1-based sequences, consuming EXACTLY 500 instants', () => {
    expect(log.records.length).toBe(N);
    expect(log.records.map((record) => record.sequence)).toEqual(Array.from({ length: N }, (_, index) => index + 1)); // 1..N, contiguous, no gaps
    expect(instants.remaining()).toBe(0); // exactly one instant per record — the clock never double-burns
    expect(log.tenant).toBe(TENANT);
    expect(log.project).toBe(PROJECT);
  });

  it('the chain verifies TOTALLY at N=500 (the fold is complete at scale)', () => {
    expect(unwrap(verifyTelemetryLog(log)).records.length).toBe(N);
  });

  it('the last recorded instant is the 500th scripted instant (the workload is total)', () => {
    expect(latestRecordedAt(log)).toBe(T0 + (N - 1) * 1_000);
  });

  // LAW 2 — the per-record byte budget (log volume is predictable)
  it('every one of the 500 records serializes under the 2 KiB budget (and the measurement is real, not zero)', () => {
    const sizes = log.records.map((record) => canonicalJson(telemetryRecordTree(record)).length);
    const max = Math.max(...sizes);
    expect(max).toBeLessThanOrEqual(2_048); // the budget law — a breach fails the release gate
    expect(max).toBeGreaterThan(100); // the teeth: the sizes are real measurements, never a vacuous zero
    expect(sizes.length).toBe(N);
  });

  // LAW 3 — the point-in-time prefix law (query work is bounded by the prefix, never the whole log)
  it('asOf at the 250th record\'s instant returns EXACTLY 250 records; 1 ms earlier EXACTLY 249; at the first instant EXACTLY 1; at the latest EXACTLY 500', () => {
    const at250 = (T0 + 249 * 1_000) as TimestampMs;
    expect(unwrap(queryTelemetry(log, { tenant: TENANT, project: PROJECT, asOf: at250 })).length).toBe(250); // INCLUSIVE at the boundary
    expect(unwrap(queryTelemetry(log, { tenant: TENANT, project: PROJECT, asOf: (at250 - 1) as TimestampMs })).length).toBe(249); // 1 ms before
    expect(unwrap(queryTelemetry(log, { tenant: TENANT, project: PROJECT, asOf: T0 })).length).toBe(1); // the first record only
    expect(unwrap(queryTelemetry(log, { tenant: TENANT, project: PROJECT, asOf: latestRecordedAt(log) as TimestampMs })).length).toBe(N); // the whole prefix
    // The returned prefix is EXACTLY the first k records, in sequence order — never a post-asOf leak.
    const prefix = unwrap(queryTelemetry(log, { tenant: TENANT, project: PROJECT, asOf: at250 }));
    expect(prefix.map((record) => record.sequence)).toEqual(Array.from({ length: 250 }, (_, index) => index + 1));
  });

  // LAW 4 — filter-proportional queries (result work proportional to matches, exactly)
  it('the kind/actor filters return EXACTLY their matching counts over the 500-record log', () => {
    const asOf = latestRecordedAt(log) as TimestampMs;
    const scope = { tenant: TENANT, project: PROJECT, asOf } as const;
    // The workload's shape: 250 metrics (even i), 125 trace-spans (i%4===1), 125 logs (i%4===3).
    expect(unwrap(queryTelemetry(log, { ...scope, kinds: ['metric'] })).length).toBe(250);
    expect(unwrap(queryTelemetry(log, { ...scope, kinds: ['trace-span'] })).length).toBe(125);
    expect(unwrap(queryTelemetry(log, { ...scope, kinds: ['log'] })).length).toBe(125);
    // The actor-kind and exact-actor filters fold the same way.
    expect(unwrap(queryTelemetry(log, { ...scope, actorKinds: ['service'] })).length).toBe(375);
    expect(unwrap(queryTelemetry(log, { ...scope, actorKinds: ['operator'] })).length).toBe(125);
    expect(unwrap(queryTelemetry(log, { ...scope, actors: [OPERATOR_ACTOR] })).length).toBe(125);
    // Combined filters are the exact INTERSECTION (an empty intersection is a deterministic empty result).
    expect(unwrap(queryTelemetry(log, { ...scope, kinds: ['metric'], actorKinds: ['operator'] })).length).toBe(0);
    expect(unwrap(queryTelemetry(log, { ...scope, kinds: ['log'], actors: [OPERATOR_ACTOR] })).length).toBe(125);
  });

  // LAW 5 — the total replay law (the log rebuilds byte-identically)
  it('the log REBUILDS byte-identically through the total replay (the fold is re-derivable at any scale)', () => {
    const rebuilt = unwrap(replayTelemetryLog(log));
    expect(canonicalTelemetryLogJson(rebuilt)).toBe(canonicalTelemetryLogJson(log)); // the replay is the log, byte for byte
    expect(unwrap(verifyTelemetryLog(rebuilt)).records.length).toBe(N);
  });
});

// ---------------------------------------------------------------------------
// LAW 6 — exactly-once ordered sink fan-out (its own drive, with the sink)
// ---------------------------------------------------------------------------

describe('the exactly-once ordered sink fan-out law', () => {
  it('the sink receives EXACTLY 500 records, each EXACTLY ONCE, in append order, identical to the log', () => {
    const { sink, records } = recordingSink();
    const { log } = driveWorkload([sink]);
    expect(records.length).toBe(N); // exactly once per record — never a duplicate delivery, never a loss
    expect(records.map((record) => record.sequence)).toEqual(log.records.map((record) => record.sequence)); // in append order
    expect(records.map((record) => record.recordId)).toEqual(log.records.map((record) => record.recordId)); // the same records, id for id
  });
});

// ---------------------------------------------------------------------------
// LAW 7 — byte-determinism at scale (two drives, one comparison)
// ---------------------------------------------------------------------------

describe('the byte-determinism law at N=500', () => {
  it('two identically-scripted collectors produce byte-identical whole-log canonical JSON', () => {
    const first = driveWorkload();
    const second = driveWorkload();
    const bytesA = canonicalTelemetryLogJson(first.log);
    const bytesB = canonicalTelemetryLogJson(second.log);
    expect(bytesB.length).toBe(bytesA.length);
    expect(bytesB).toBe(bytesA); // L9 at scale: the same observations + the same instants = the same bytes
  });
});
