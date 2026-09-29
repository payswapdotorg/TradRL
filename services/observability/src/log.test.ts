/**
 * @tradrl/observability_service — the TelemetryLog tests.
 *
 * Covers the append-only chain law (T040's `audit.ts` discipline,
 * mirrored law-for-law):
 *   - the three DISTINCT chain negatives — flip one byte in a
 *     record's content, drop the middle record, swap two adjacent
 *     records — each fails verification with the typed
 *     `audit_rewrite`;
 *   - duplicate append → `audit_rewrite` (one observation, one
 *     record);
 *   - cross-scope append → the typed `tenant_missing` error (BOTH
 *     directions — L12);
 *   - collect-all validation (every simultaneous violation reported);
 *   - `replayTelemetryLog(log)` deep-equals the live log AND
 *     reproduces it byte-identically (canonical JSON parity), while a
 *     tampered log fails to replay;
 *   - the append-only surface: append returns a NEW log (the original
 *     untouched) and the grown log's records are deeply frozen.
 */

import { describe, expect, it } from 'vitest';

import {
  deepFreeze,
  type ProjectId,
  type TelemetryRecord,
  type TimestampMs,
  type TenantId,
} from '../../../packages/observability/src/index';
import {
  appendTelemetryRecord,
  canonicalTelemetryLogJson,
  replayTelemetryLog,
  startTelemetryLog,
  telemetryRecordAt,
  validateTelemetryLog,
  verifyTelemetryLog,
  type TelemetryLog,
  type TelemetryRecordDraft,
} from './log';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const T0 = 1_717_459_200_000 as TimestampMs;
const TENANT = 'tenant-obs' as TenantId;
const PROJECT = 'project-obs' as ProjectId;
const OTHER_TENANT = 'tenant-other' as TenantId;
const OTHER_PROJECT = 'project-other' as ProjectId;

const GATEWAY_SEAM = { kind: 'gateway-audit', auditId: 'xga:0f1e2d3c', tenant: TENANT, project: PROJECT } as const;

/** Unwrap a fixture result or fail loudly. */
function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly { readonly message: string }[] }): T {
  if (result.ok) return result.value;
  throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
}

/** Build a grown three-record log (metric + span + log — one of each kind). */
function grownLog(): TelemetryLog {
  let log = unwrap(startTelemetryLog(TENANT, PROJECT));
  const drafts: TelemetryRecordDraft[] = [
    {
      kind: 'metric' as const,
      tenant: TENANT,
      project: PROJECT,
      actor: { kind: 'service' as const, ref: 'execution-gateway' },
      seam: GATEWAY_SEAM,
      recordedAt: T0,
      name: 'gateway.submissions',
      value: 3,
      unit: 'orders',
      attributes: { stage: 'routing' },
    },
    {
      kind: 'trace-span' as const,
      tenant: TENANT,
      project: PROJECT,
      actor: { kind: 'service' as const, ref: 'execution-gateway' },
      seam: { kind: 'kernel-operation' as const, opId: 'kop-0001', type: 'SPAWN', tenant: TENANT },
      recordedAt: (T0 + 1_000) as TimestampMs,
      name: 'kernel.applyOperation',
      durationMs: 12,
      status: 'ok' as const,
      attributes: {},
    },
    {
      kind: 'log' as const,
      tenant: TENANT,
      project: PROJECT,
      actor: { kind: 'agent-instance' as const, ref: 'inst-trading-director' },
      seam: { kind: 'agent-envelope' as const, messageId: 'msg-0001', topic: 'org.research.signals', tenant: TENANT },
      recordedAt: (T0 + 2_000) as TimestampMs,
      level: 'info' as const,
      message: 'regime researcher published a signal',
      attributes: {},
    },
  ];
  for (const draft of drafts) {
    const minted = unwrap(telemetryRecordAt(log, draft));
    log = unwrap(appendTelemetryRecord(log, minted));
  }
  return log;
}

/** A mutable deep copy of a log's records (the tampering substrate). */
function mutableRecords(log: TelemetryLog): TelemetryRecord[] {
  return log.records.map((record) => JSON.parse(JSON.stringify(record)) as TelemetryRecord);
}

/** Rebuild a log shell over (possibly tampered) records. */
function shellOver(records: readonly TelemetryRecord[]): TelemetryLog {
  return deepFreeze({ tenant: TENANT, project: PROJECT, records: [...records] }) as TelemetryLog;
}

// ---------------------------------------------------------------------------
// Construction and growth
// ---------------------------------------------------------------------------

describe('startTelemetryLog', () => {
  it('creates an empty log for a valid tenant/project scope', () => {
    const log = unwrap(startTelemetryLog(TENANT, PROJECT));
    expect(log.tenant).toBe(TENANT);
    expect(log.project).toBe(PROJECT);
    expect(log.records).toEqual([]);
    expect(verifyTelemetryLog(log).ok).toBe(true);
  });

  it('rejects an invalid scope with the typed tenant_missing error', () => {
    const badTenant = startTelemetryLog('' as TenantId, PROJECT);
    expect(badTenant.ok).toBe(false);
    if (!badTenant.ok) expect(badTenant.errors[0]?.code).toBe('tenant_missing');
    const badProject = startTelemetryLog(TENANT, '' as ProjectId);
    expect(badProject.ok).toBe(false);
    if (!badProject.ok) expect(badProject.errors[0]?.code).toBe('tenant_missing');
  });
});

describe('appendTelemetryRecord (the only growth path)', () => {
  it('mints and appends records with contiguous sequences and verifies green', () => {
    const log = grownLog();
    expect(log.records).toHaveLength(3);
    expect(log.records.map((record) => record.sequence)).toEqual([1, 2, 3]);
    expect(verifyTelemetryLog(log).ok).toBe(true);
  });

  it('returns a NEW log; the original is untouched (no in-place mutation)', () => {
    const before = grownLog();
    const minted = unwrap(telemetryRecordAt(before, {
      kind: 'metric',
      tenant: TENANT,
      project: PROJECT,
      actor: { kind: 'service', ref: 'risk-engine' },
      seam: GATEWAY_SEAM,
      recordedAt: (T0 + 3_000) as TimestampMs,
      name: 'risk.evaluations',
      value: 7,
      unit: null,
      attributes: {},
    }));
    const after = unwrap(appendTelemetryRecord(before, minted));
    expect(before.records).toHaveLength(3);
    expect(after.records).toHaveLength(4);
    expect(after.records[3]?.recordId).toBe(minted.recordId);
  });

  it('rejects a duplicate append with the typed audit_rewrite (one observation, one record)', () => {
    const log = grownLog();
    const duplicate = log.records[1] as TelemetryRecord;
    const appended = appendTelemetryRecord(log, duplicate);
    expect(appended.ok).toBe(false);
    if (!appended.ok) {
      expect(appended.errors[0]?.code).toBe('audit_rewrite');
      expect(appended.errors[0]?.path).toBe('sequence');
    }
  });

  it('rejects a re-minted duplicate (same content, same position) with audit_rewrite', () => {
    const log = grownLog();
    const first = log.records[0] as TelemetryRecord;
    const { recordId, chainHead, sequence, ...content } = first;
    void recordId;
    void chainHead;
    void sequence;
    const reMinted = unwrap(telemetryRecordAt(shellOver([]), content));
    // Position 1 minted onto an EMPTY log equals the original record.
    expect(reMinted.recordId).toBe(first.recordId);
    const appended = appendTelemetryRecord(log, reMinted);
    expect(appended.ok).toBe(false);
    if (!appended.ok) expect(appended.errors.map((error) => error.code)).toContain('audit_rewrite');
  });

  it('rejects a cross-scope append in BOTH directions with the typed tenant_missing error (L12)', () => {
    const ownLog = grownLog();
    // Direction 1: an other-tenant record into this log.
    const foreign = unwrap(telemetryRecordAt(unwrap(startTelemetryLog(OTHER_TENANT, PROJECT)), {
      kind: 'metric',
      tenant: OTHER_TENANT,
      project: PROJECT,
      actor: { kind: 'service', ref: 'execution-gateway' },
      seam: GATEWAY_SEAM,
      recordedAt: T0,
      name: 'gateway.submissions',
      value: 1,
      unit: null,
      attributes: {},
    }));
    const appendForeign = appendTelemetryRecord(ownLog, foreign);
    expect(appendForeign.ok).toBe(false);
    if (!appendForeign.ok) expect(appendForeign.errors[0]?.code).toBe('tenant_missing');

    // Direction 2: this tenant's record into an other-tenant log.
    const foreignLog = (() => {
      let log = unwrap(startTelemetryLog(OTHER_TENANT, OTHER_PROJECT));
      const minted = unwrap(telemetryRecordAt(log, {
        kind: 'metric',
        tenant: OTHER_TENANT,
        project: OTHER_PROJECT,
        actor: { kind: 'service', ref: 'execution-gateway' },
        seam: { kind: 'gateway-audit', auditId: 'xga:0f1e2d3c', tenant: OTHER_TENANT, project: OTHER_PROJECT },
        recordedAt: T0,
        name: 'gateway.submissions',
        value: 1,
        unit: null,
        attributes: {},
      }));
      return unwrap(appendTelemetryRecord(log, minted));
    })();
    const own = ownLog.records[0] as TelemetryRecord;
    const appendOwn = appendTelemetryRecord(foreignLog, own);
    expect(appendOwn.ok).toBe(false);
    if (!appendOwn.ok) expect(appendOwn.errors[0]?.code).toBe('tenant_missing');
  });

  it('rejects a non-contiguous sequence with audit_rewrite', () => {
    const log = grownLog();
    const minted = unwrap(telemetryRecordAt(log, {
      kind: 'metric',
      tenant: TENANT,
      project: PROJECT,
      actor: { kind: 'service', ref: 'risk-engine' },
      seam: GATEWAY_SEAM,
      recordedAt: (T0 + 3_000) as TimestampMs,
      name: 'risk.evaluations',
      value: 7,
      unit: null,
      attributes: {},
    }));
    const forged = { ...minted, sequence: 9 } as TelemetryRecord;
    const appended = appendTelemetryRecord(log, forged);
    expect(appended.ok).toBe(false);
    if (!appended.ok) expect(appended.errors[0]?.code).toBe('audit_rewrite');
  });
});

// ---------------------------------------------------------------------------
// The three DISTINCT chain negatives (tamper / truncate / reorder)
// ---------------------------------------------------------------------------

describe('verifyTelemetryLog: the chain negatives (each typed audit_rewrite)', () => {
  it('NEGATIVE 1 — flipping one byte in a record\u2019s content breaks the chain (audit_rewrite)', () => {
    const log = grownLog();
    const records = mutableRecords(log);
    const victim = records[1] as TelemetryRecord;
    // Flip one byte of the span's name: 'kernel.applyOperation' -> 'kernel.applyOperatioN'.
    const flipped: TelemetryRecord = { ...victim, name: 'kernel.applyOperatioN' } as TelemetryRecord;
    records[1] = flipped;
    const tampered = shellOver(records);
    const verified = verifyTelemetryLog(tampered);
    expect(verified.ok).toBe(false);
    if (!verified.ok) {
      expect(verified.errors[0]?.code).toBe('audit_rewrite');
      expect(verified.errors[0]?.path).toContain('chainHead');
    }
  });

  it('NEGATIVE 2 — dropping the middle record breaks the chain (audit_rewrite)', () => {
    const log = grownLog();
    const records = mutableRecords(log);
    records.splice(1, 1); // drop the middle record
    const truncated = shellOver(records);
    const verified = verifyTelemetryLog(truncated);
    expect(verified.ok).toBe(false);
    if (!verified.ok) {
      expect(verified.errors[0]?.code).toBe('audit_rewrite');
      expect(verified.errors[0]?.path).toContain('sequence');
    }
  });

  it('NEGATIVE 3 — swapping two adjacent records breaks the chain (audit_rewrite)', () => {
    const log = grownLog();
    const records = mutableRecords(log);
    const first = records[0] as TelemetryRecord;
    records[0] = records[1] as TelemetryRecord;
    records[1] = first;
    const reordered = shellOver(records);
    const verified = verifyTelemetryLog(reordered);
    expect(verified.ok).toBe(false);
    if (!verified.ok) {
      expect(verified.errors[0]?.code).toBe('audit_rewrite');
      expect(verified.errors[0]?.path).toContain('sequence');
    }
  });

  it('a forged chain head on the LAST record also fails (the fold reaches the tail)', () => {
    const log = grownLog();
    const records = mutableRecords(log);
    const victim = records[2] as TelemetryRecord;
    records[2] = { ...victim, chainHead: 'ffffffff' } as TelemetryRecord;
    const verified = verifyTelemetryLog(shellOver(records));
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.errors[0]?.code).toBe('audit_rewrite');
  });
});

// ---------------------------------------------------------------------------
// Collect-all validation
// ---------------------------------------------------------------------------

describe('validateTelemetryLog (collect-all)', () => {
  it('collects every violation across the log shape and EACH record', () => {
    const broken = {
      tenant: '',
      project: '',
      records: [
        { kind: 'metric', bad: true }, // many missing fields
        { recordId: 'tel:zzzz', sequence: 0, kind: 'histogram', tenant: 't', project: 'p', actor: { kind: 'robot', ref: '' }, seam: { kind: 'nope' }, recordedAt: -1, chainHead: 'xx' },
      ],
    };
    const validation = validateTelemetryLog(broken);
    expect(validation.ok).toBe(false);
    if (!validation.ok) {
      const paths = validation.errors.map((error) => `${error.code}@${error.path}`);
      expect(paths).toContain('invalid_field@telemetryLog.tenant');
      expect(paths).toContain('invalid_field@telemetryLog.project');
      expect(validation.errors.length).toBeGreaterThanOrEqual(12); // both records' full violation sets collected
    }
  });

  it('accepts and deeply freezes a valid log', () => {
    const log = grownLog();
    const json = JSON.parse(JSON.stringify(log)) as unknown;
    const validation = validateTelemetryLog(json);
    expect(validation.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Replay (the determinism proof)
// ---------------------------------------------------------------------------

describe('replayTelemetryLog (the determinism proof)', () => {
  it('reproduces the log byte-identically (canonical JSON parity)', () => {
    const log = grownLog();
    const replayed = unwrap(replayTelemetryLog(log));
    expect(canonicalTelemetryLogJson(replayed)).toBe(canonicalTelemetryLogJson(log));
  });

  it('deep-equals the live log', () => {
    const log = grownLog();
    const replayed = unwrap(replayTelemetryLog(log));
    expect(replayed).toEqual(log);
    expect(replayed.records).toHaveLength(log.records.length);
    for (let index = 0; index < log.records.length; index++) {
      expect(replayed.records[index]).toEqual(log.records[index]);
    }
  });

  it('replaying twice yields the same log (idempotence of the fold)', () => {
    const log = grownLog();
    const once = unwrap(replayTelemetryLog(log));
    const twice = unwrap(replayTelemetryLog(once));
    expect(canonicalTelemetryLogJson(twice)).toBe(canonicalTelemetryLogJson(log));
  });

  it('a tampered log fails to replay (the fold enforces the law)', () => {
    const log = grownLog();
    const records = mutableRecords(log);
    const victim = records[0] as TelemetryRecord;
    records[0] = { ...victim, value: 999 } as TelemetryRecord;
    const replayed = replayTelemetryLog(shellOver(records));
    expect(replayed.ok).toBe(false);
    if (!replayed.ok) expect(replayed.errors[0]?.code).toBe('audit_rewrite');
  });
});

// ---------------------------------------------------------------------------
// The append-only surface
// ---------------------------------------------------------------------------

describe('the append-only surface (no removal, no update)', () => {
  it('the grown log and every record are deeply frozen', () => {
    const log = grownLog();
    expect(Object.isFrozen(log)).toBe(true);
    expect(Object.isFrozen(log.records)).toBe(true);
    for (const record of log.records) {
      expect(Object.isFrozen(record)).toBe(true);
      expect(Object.isFrozen(record.actor)).toBe(true);
      expect(Object.isFrozen(record.seam)).toBe(true);
      expect(Object.isFrozen(record.attributes)).toBe(true);
    }
    expect(() => {
      (log.records as unknown as TelemetryRecord[]).pop();
    }).toThrow();
  });
});
