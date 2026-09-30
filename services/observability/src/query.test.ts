/**
 * @tradrl/observability_service — the historical query tests.
 *
 * THE asOf DISCIPLINE (L4 — point-in-time truth): `queryTelemetry`
 * returns ONLY records with `recordedAt <= asOf` — INCLUSIVE at the
 * exact boundary. The tests pin the boundary precisely:
 *   - a record recorded at EXACTLY `asOf` IS returned;
 *   - at `asOf - 1` it is NOT (the exact-equality boundary);
 *   - a record 1ms PAST `asOf` is NOT returned (the 1ms-past
 *     exclusion).
 * Plus: the optional kind filter, the sequence-order guarantee, and
 * the cross-scope query rejection (typed `tenant_missing`, BOTH
 * directions — L12).
 */

import { describe, expect, it } from 'vitest';

import type { ObservedSeamRef, ProjectId, TelemetryActor, TelemetryRecord, TimestampMs, TenantId } from '../../../packages/observability/src/index';
import { isTelemetryQuery, queryTelemetry } from './query';
import { appendTelemetryRecord, startTelemetryLog, telemetryRecordAt, type TelemetryLog } from './log';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const T0 = 1_717_459_200_000 as TimestampMs;
const TENANT = 'tenant-query' as TenantId;
const PROJECT = 'project-query' as ProjectId;
const OTHER_TENANT = 'tenant-other' as TenantId;
const OTHER_PROJECT = 'project-other' as ProjectId;

/** Unwrap a fixture result or fail loudly. */
function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly { readonly message: string }[] }): T {
  if (result.ok) return result.value;
  throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
}

/**
 * A five-record log with UNAMBIGUOUS instants: metric@T0, span@T0+1,
 * log@T0+2, metric@T0+3, log@T0+4 — kinds interleaved so the kind
 * filter is provable.
 */
function fiveRecordLog(): TelemetryLog {
  let log = unwrap(startTelemetryLog(TENANT, PROJECT));
  const drafts = [
    { kind: 'metric' as const, at: 0, name: 'gateway.submissions', extra: { value: 1, unit: 'orders' } },
    { kind: 'trace-span' as const, at: 1, name: 'kernel.applyOperation', extra: { durationMs: 5, status: 'ok' as const } },
    { kind: 'log' as const, at: 2, name: 'signal-published', extra: { level: 'info' as const, message: 'researcher published' } },
    { kind: 'metric' as const, at: 3, name: 'risk.evaluations', extra: { value: 2, unit: null } },
    { kind: 'log' as const, at: 4, name: 'escalation-raised', extra: { level: 'warn' as const, message: 'limit utilization high' } },
  ];
  for (const draft of drafts) {
    const base = {
      tenant: TENANT,
      project: PROJECT,
      actor: { kind: 'service' as const, ref: 'execution-gateway' },
      seam: { kind: 'gateway-audit' as const, auditId: 'xga:0f1e2d3c', tenant: TENANT, project: PROJECT },
      recordedAt: (T0 + draft.at) as TimestampMs,
      attributes: {},
    };
    const minted = draft.kind === 'metric'
      ? unwrap(telemetryRecordAt(log, { ...base, kind: 'metric', name: draft.name, value: draft.extra.value, unit: draft.extra.unit }))
      : draft.kind === 'trace-span'
        ? unwrap(telemetryRecordAt(log, { ...base, kind: 'trace-span', name: draft.name, durationMs: draft.extra.durationMs, status: draft.extra.status }))
        : unwrap(telemetryRecordAt(log, { ...base, kind: 'log', level: draft.extra.level, message: draft.extra.message }));
    log = unwrap(appendTelemetryRecord(log, minted));
  }
  return log;
}

/**
 * A five-record log with DIVERSE actors and seam kinds (sequence order
 * preserved): 1) service/execution-gateway over gateway-audit, 2)
 * agent-instance/inst-director over kernel-operation, 3) agent-instance/
 * inst-researcher over agent-envelope, 4) operator/ops-oncall over
 * control-plane-audit, 5) service/event-store over event-store.
 */
function diverseLog(): TelemetryLog {
  let log = unwrap(startTelemetryLog(TENANT, PROJECT));
  const drafts: readonly { actor: TelemetryActor; seam: ObservedSeamRef }[] = [
    {
      actor: { kind: 'service', ref: 'execution-gateway' },
      seam: { kind: 'gateway-audit', auditId: 'xga:0f1e2d3c', tenant: TENANT, project: PROJECT },
    },
    {
      actor: { kind: 'agent-instance', ref: 'inst-director' },
      seam: { kind: 'kernel-operation', opId: 'kop-0001', type: 'SPAWN', tenant: TENANT },
    },
    {
      actor: { kind: 'agent-instance', ref: 'inst-researcher' },
      seam: { kind: 'agent-envelope', messageId: 'msg-0001', topic: 'org.research.signals', tenant: TENANT },
    },
    {
      actor: { kind: 'operator', ref: 'ops-oncall' },
      seam: { kind: 'control-plane-audit', sequence: 4, tenant: TENANT, project: PROJECT },
    },
    {
      actor: { kind: 'service', ref: 'event-store' },
      seam: { kind: 'event-store', eventId: 'evt-0001', venue: 'BINANCE' },
    },
  ];
  for (let index = 0; index < drafts.length; index++) {
    const draft = drafts[index] as { actor: TelemetryActor; seam: ObservedSeamRef };
    const minted = unwrap(telemetryRecordAt(log, {
      kind: 'log',
      tenant: TENANT,
      project: PROJECT,
      actor: draft.actor,
      seam: draft.seam,
      recordedAt: (T0 + index) as TimestampMs,
      level: 'info',
      message: `observation ${index + 1}`,
      attributes: {},
    }));
    log = unwrap(appendTelemetryRecord(log, minted));
  }
  return log;
}

// ---------------------------------------------------------------------------
// The asOf boundary discipline (L4)
// ---------------------------------------------------------------------------

describe('queryTelemetry: the asOf discipline (L4 — INCLUSIVE bound)', () => {
  it('returns a record recorded at EXACTLY asOf (the exact-equality boundary)', () => {
    const log = fiveRecordLog();
    const third = log.records[2] as { recordedAt: TimestampMs };
    const results = unwrap(queryTelemetry(log, { tenant: TENANT, project: PROJECT, asOf: third.recordedAt }));
    // Records at T0, T0+1, T0+2 — the record AT asOf IS included.
    expect(results).toHaveLength(3);
    expect(results.map((record) => record.sequence)).toEqual([1, 2, 3]);
  });

  it('at asOf - 1 the exactly-at record is NOT returned (1ms before the boundary)', () => {
    const log = fiveRecordLog();
    const third = log.records[2] as { recordedAt: TimestampMs };
    const results = unwrap(queryTelemetry(log, { tenant: TENANT, project: PROJECT, asOf: (third.recordedAt - 1) as TimestampMs }));
    expect(results).toHaveLength(2);
    expect(results.map((record) => record.sequence)).toEqual([1, 2]);
  });

  it('a record 1ms PAST asOf is NOT returned (the 1ms-past exclusion)', () => {
    const log = fiveRecordLog();
    const third = log.records[2] as TelemetryRecord;
    const fourth = log.records[3] as TelemetryRecord;
    expect(fourth.recordedAt - third.recordedAt).toBe(1);
    const results = unwrap(queryTelemetry(log, { tenant: TENANT, project: PROJECT, asOf: third.recordedAt }));
    const ids = results.map((record) => record.recordId);
    expect(ids).not.toContain(fourth.recordId);
  });

  it('asOf before every record returns nothing; asOf at the last record returns everything', () => {
    const log = fiveRecordLog();
    const first = log.records[0] as { recordedAt: TimestampMs };
    const last = log.records[4] as { recordedAt: TimestampMs };
    expect(unwrap(queryTelemetry(log, { tenant: TENANT, project: PROJECT, asOf: (first.recordedAt - 1) as TimestampMs }))).toEqual([]);
    const all = unwrap(queryTelemetry(log, { tenant: TENANT, project: PROJECT, asOf: last.recordedAt }));
    expect(all).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// The kind filter + ordering
// ---------------------------------------------------------------------------

describe('queryTelemetry: the kind filter and the sequence-order guarantee', () => {
  it('filters by kind while preserving sequence order', () => {
    const log = fiveRecordLog();
    const metrics = unwrap(queryTelemetry(log, { tenant: TENANT, project: PROJECT, asOf: (T0 + 10_000) as TimestampMs, kinds: ['metric'] }));
    expect(metrics.map((record) => record.sequence)).toEqual([1, 4]);
    expect(metrics.every((record) => record.kind === 'metric')).toBe(true);

    const logsAndSpans = unwrap(queryTelemetry(log, { tenant: TENANT, project: PROJECT, asOf: (T0 + 10_000) as TimestampMs, kinds: ['log', 'trace-span'] }));
    expect(logsAndSpans.map((record) => record.sequence)).toEqual([2, 3, 5]);
  });

  it('returns results in sequence order regardless of instants (the log\u2019s append order is the truth)', () => {
    const log = fiveRecordLog();
    const results = unwrap(queryTelemetry(log, { tenant: TENANT, project: PROJECT, asOf: (T0 + 10_000) as TimestampMs }));
    const sequences = results.map((record) => record.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(sequences).toEqual([1, 2, 3, 4, 5]);
  });
});

// ---------------------------------------------------------------------------
// The scope discipline (L12)
// ---------------------------------------------------------------------------

describe('queryTelemetry: the cross-scope rejection (L12, both directions)', () => {
  it('rejects a query whose tenant does not match the log\u2019s (direction 1)', () => {
    const log = fiveRecordLog();
    const foreign = queryTelemetry(log, { tenant: OTHER_TENANT, project: PROJECT, asOf: T0 });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.errors[0]?.code).toBe('tenant_missing');
  });

  it('rejects a query whose project does not match the log\u2019s (direction 2)', () => {
    const log = fiveRecordLog();
    const foreign = queryTelemetry(log, { tenant: TENANT, project: OTHER_PROJECT, asOf: T0 });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.errors[0]?.code).toBe('tenant_missing');
  });

  it('rejects an invalid asOf instant with the typed invalid_field error', () => {
    const log = fiveRecordLog();
    const bad = queryTelemetry(log, { tenant: TENANT, project: PROJECT, asOf: Number.NaN as unknown as TimestampMs });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]?.code).toBe('invalid_field');
    const badKinds = queryTelemetry(log, { tenant: TENANT, project: PROJECT, asOf: T0, kinds: ['histogram' as never] });
    expect(badKinds.ok).toBe(false);
    if (!badKinds.ok) expect(badKinds.errors[0]?.code).toBe('invalid_field');
  });
});

// ---------------------------------------------------------------------------
// The WHO/WHICH filter surface (actors, actorKinds, seamKinds)
// ---------------------------------------------------------------------------

describe('queryTelemetry: the actor and seam-kind filter surface', () => {
  it('filters by actor KIND (WHO\u2019s kind) while preserving sequence order', () => {
    const log = diverseLog();
    const agents = unwrap(queryTelemetry(log, { tenant: TENANT, project: PROJECT, asOf: (T0 + 10_000) as TimestampMs, actorKinds: ['agent-instance'] }));
    expect(agents.map((record) => record.sequence)).toEqual([2, 3]);
    expect(agents.every((record) => record.actor.kind === 'agent-instance')).toBe(true);

    const humans = unwrap(queryTelemetry(log, { tenant: TENANT, project: PROJECT, asOf: (T0 + 10_000) as TimestampMs, actorKinds: ['operator'] }));
    expect(humans.map((record) => record.sequence)).toEqual([4]);
  });

  it('filters by EXACT actor (kind AND ref) — the full WHO identity', () => {
    const log = diverseLog();
    const director = unwrap(queryTelemetry(log, {
      tenant: TENANT, project: PROJECT, asOf: (T0 + 10_000) as TimestampMs,
      actors: [{ kind: 'agent-instance', ref: 'inst-director' }],
    }));
    expect(director.map((record) => record.sequence)).toEqual([2]);

    // Two exact actors at once — the union, sequence order preserved.
    const pair = unwrap(queryTelemetry(log, {
      tenant: TENANT, project: PROJECT, asOf: (T0 + 10_000) as TimestampMs,
      actors: [{ kind: 'service', ref: 'execution-gateway' }, { kind: 'agent-instance', ref: 'inst-researcher' }],
    }));
    expect(pair.map((record) => record.sequence)).toEqual([1, 3]);

    // The SAME ref under a DIFFERENT kind does not match (kind AND ref).
    const wrongKind = unwrap(queryTelemetry(log, {
      tenant: TENANT, project: PROJECT, asOf: (T0 + 10_000) as TimestampMs,
      actors: [{ kind: 'principal', ref: 'inst-director' }],
    }));
    expect(wrongKind).toEqual([]);
  });

  it('filters by OBSERVED SEAM KIND (WHICH merged seam the record observes)', () => {
    const log = diverseLog();
    const agentPlane = unwrap(queryTelemetry(log, {
      tenant: TENANT, project: PROJECT, asOf: (T0 + 10_000) as TimestampMs,
      seamKinds: ['agent-envelope', 'kernel-operation'],
    }));
    expect(agentPlane.map((record) => record.sequence)).toEqual([2, 3]);

    const executionPlane = unwrap(queryTelemetry(log, {
      tenant: TENANT, project: PROJECT, asOf: (T0 + 10_000) as TimestampMs,
      seamKinds: ['gateway-audit'],
    }));
    expect(executionPlane.map((record) => record.sequence)).toEqual([1]);
  });

  it('COMPOSES the filters with the asOf discipline (kind + actorKind + seamKind + asOf)', () => {
    const log = diverseLog();
    // Everything by agent-instances over the agent plane, before the envelope existed.
    const beforeEnvelope = unwrap(queryTelemetry(log, {
      tenant: TENANT, project: PROJECT,
      asOf: (T0 + 1) as TimestampMs, // records 1 and 2 only (inclusive)
      actorKinds: ['agent-instance'],
      seamKinds: ['agent-envelope', 'kernel-operation'],
      kinds: ['log'],
    }));
    expect(beforeEnvelope.map((record) => record.sequence)).toEqual([2]); // record 3 is 1ms past asOf
  });

  it('rejects malformed filter arrays with typed invalid_field errors at the filter\u2019s path', () => {
    const log = diverseLog();
    const badActorKind = queryTelemetry(log, { tenant: TENANT, project: PROJECT, asOf: T0, actorKinds: ['robot' as never] });
    expect(badActorKind.ok).toBe(false);
    if (!badActorKind.ok) {
      expect(badActorKind.errors[0]?.code).toBe('invalid_field');
      expect(badActorKind.errors[0]?.path).toBe('actorKinds');
    }
    const badActor = queryTelemetry(log, { tenant: TENANT, project: PROJECT, asOf: T0, actors: [{ kind: 'robot', ref: 'x' } as never] });
    expect(badActor.ok).toBe(false);
    if (!badActor.ok) {
      expect(badActor.errors[0]?.code).toBe('invalid_field');
      expect(badActor.errors[0]?.path).toBe('actors');
    }
    const badSeamKind = queryTelemetry(log, { tenant: TENANT, project: PROJECT, asOf: T0, seamKinds: ['wormhole' as never] });
    expect(badSeamKind.ok).toBe(false);
    if (!badSeamKind.ok) {
      expect(badSeamKind.errors[0]?.code).toBe('invalid_field');
      expect(badSeamKind.errors[0]?.path).toBe('seamKinds');
    }
  });

  it('isTelemetryQuery guards the full query shape (positive and negative)', () => {
    const base = { tenant: TENANT, project: PROJECT, asOf: T0 };
    expect(isTelemetryQuery(base)).toBe(true);
    expect(isTelemetryQuery({ ...base, kinds: ['metric'] })).toBe(true);
    expect(isTelemetryQuery({ ...base, actorKinds: ['operator'] })).toBe(true);
    expect(isTelemetryQuery({ ...base, actors: [{ kind: 'service', ref: 'x' }] })).toBe(true);
    expect(isTelemetryQuery({ ...base, seamKinds: ['gateway-audit'] })).toBe(true);
    expect(isTelemetryQuery({ ...base, seamKinds: ['wormhole'] })).toBe(false);
    expect(isTelemetryQuery({ ...base, actors: [{ kind: 'service' }] })).toBe(false);
    expect(isTelemetryQuery({ ...base, actorKinds: ['robot'] })).toBe(false);
    expect(isTelemetryQuery({ ...base, asOf: -1 })).toBe(false);
    expect(isTelemetryQuery(null)).toBe(false);
  });
});
