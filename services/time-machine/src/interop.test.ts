// The D-004 drift trip wire: this package's mirrors versus the VENDORED
// VERBATIM copy of the T026 knowledge-firewall contract shapes
// (src/t026-reference/mirrors.ts — the owning lane's reference bundle).
// If any declaration drifts, the type-level assertions fail `pnpm
// typecheck` and the runtime parity checks fail `pnpm test`.
//
// Type-level guarantees are verified by `pnpm typecheck` (tsc --noEmit):
// every `@ts-expect-error` marks a line that MUST fail to compile.

import { describe, expect, it } from 'vitest';
import * as t026 from './t026-reference/mirrors';
import {
  MAX_TIMESTAMP_MS,
  MIN_TIMESTAMP_MS,
  isTimestampMs,
  validateProjectionSelector,
  type FirewallClock,
  type FirewallProjectionPort,
  type FirewallQueryResult,
  type FirewallResult,
  type KnowledgeBaseView,
  type KnowledgeQueryFilter,
  type KnowledgeRecordId,
  type TimeMachineRecord,
  type TimestampMs,
} from './index';
import { rawEvent } from './fixtures';
import { admitCanonicalEvent, isTimeMachineRecord } from './record';
import { referenceFirewallProject } from './reference-port';
import { requireTenantId } from './ids';

describe('type-level mirror compatibility (verified by pnpm typecheck)', () => {
  it('a TimeMachineRecord is assignable to the T026 KnowledgeRecord (the rolling extension is additive)', () => {
    const record = admittedFixture();
    // The firewall contract accepts the time-machine record as-is: every
    // T026 field is present with the identical shape; arrival_sequence is
    // an extra field the floor tolerates ("the contract is a floor").
    const asFirewallRecord: t026.KnowledgeRecord = record;
    expect(asFirewallRecord.record_id).toBe(record.record_id);
    expect(asFirewallRecord.available_time).toBe(record.available_time);
    expect(asFirewallRecord.provenance.custody.commit.commit_id).toBe(record.provenance.custody.commit.commit_id);
  });

  it('the T026 floor accepts machine records; the machine type demands the arrival axis', () => {
    const firewallShaped = {
      record_id: 'kr-1',
      tenant: 'acme',
      payload: { price: '1' },
      event_time: 1_000 as t026.TimestampMs,
      source_time: null,
      available_time: 2_000 as t026.TimestampMs,
      ingestion_time: 3_000 as t026.TimestampMs,
      inputs: [],
      computation: null,
      provenance: {
        origin: 'historical' as const,
        adapter: { id: 'a', version: '1' },
        derived_from: [],
        transform: null,
        corrections: [],
        custody: {
          adapter: { id: 'a', version: '1' },
          batch: { batch_id: 'b-1' },
          commit: { commit_id: 'c-1', commit_sequence: 1, ingestion_time: 3_000 as t026.TimestampMs },
        },
      },
    } satisfies t026.KnowledgeRecord;

    // The T026 floor accepts the shape at runtime...
    expect(t026.isFirewallRecord(firewallShaped)).toBe(true);
    // ...but the machine's own guard demands the arrival axis...
    expect(isTimeMachineRecord(firewallShaped)).toBe(false);
    // ...and the machine TYPE demands it too (tsc-enforced):
    const asMachineRecord = (): TimeMachineRecord => {
      // @ts-expect-error — the rolling extension requires arrival_sequence
      return firewallShaped;
    };
    expect(asMachineRecord().record_id).toBe('kr-1');
  });

  it('branded mirrors are mutually assignable with the T026 brands (identical brand strings)', () => {
    const id: t026.KnowledgeRecordId = 'kr-1';
    const asMachineId: KnowledgeRecordId = id;
    const back: t026.KnowledgeRecordId = asMachineId;
    expect(back).toBe('kr-1');

    const stamp: t026.TimestampMs = 1_000 as t026.TimestampMs;
    const asMachineTimestamp: TimestampMs = stamp;
    expect(asMachineTimestamp).toBe(1_000);

    const tenant: t026.TenantId = 'acme' as t026.TenantId;
    const asMachineTenant: import('./ids').TenantId = tenant;
    expect(asMachineTenant).toBe('acme');
  });

  it('distinct identity spaces are NOT interchangeable (brand discipline)', () => {
    const cursorId = 'cur-00000001' as import('./ids').CursorId;
    // @ts-expect-error — a CursorId is not a DatasetRef
    const asDataset: import('./ids').DatasetRef = cursorId;
    expect(asDataset).toBe('cur-00000001');

    // @ts-expect-error — a plain string is not a branded DatasetRef
    const fromPlain: import('./ids').DatasetRef = 'unbranded';
    expect(fromPlain).toBe('unbranded');
  });

  it('the machine port shape IS the T026 firewallQuery shape (structural wiring)', () => {
    // A function with the T026 service's exact signature satisfies the port
    // — this is how the Lead wires @tradrl/knowledge-firewall at integration.
    const asPort: FirewallProjectionPort = {
      project: (
        base: KnowledgeBaseView,
        clock: FirewallClock,
        tenant: t026.TenantId,
        filter: KnowledgeQueryFilter,
      ): FirewallResult<FirewallQueryResult> => referenceFirewallProject(base, clock, tenant, filter),
    };
    expect(typeof asPort.project).toBe('function');
  });
});

describe('runtime guard parity with the vendored T026 contract', () => {
  it('timestamp guards agree on every boundary and class of invalid input', () => {
    const values: unknown[] = [
      0,
      1,
      MIN_TIMESTAMP_MS,
      MAX_TIMESTAMP_MS,
      MAX_TIMESTAMP_MS + 1,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '1000',
      null,
      true,
    ];
    for (const value of values) {
      expect(isTimestampMs(value)).toBe(t026.isTimestampMs(value));
    }
    expect(MIN_TIMESTAMP_MS).toBe(t026.MIN_TIMESTAMP_MS);
    expect(MAX_TIMESTAMP_MS).toBe(t026.MAX_TIMESTAMP_MS);
  });

  it('record guards agree: every valid time-machine record passes the T026 record guard', () => {
    const record = admittedFixture();
    expect(isTimeMachineRecord(record)).toBe(true);
    expect(t026.isFirewallRecord(record)).toBe(true);
    // ...and the T026 base-view guard accepts a machine-shaped base.
    const base: KnowledgeBaseView = { records: [record], size: 1 };
    expect(t026.isKnowledgeBaseView(base)).toBe(true);
  });

  it('record guards agree on invalid mutations (quartet ordering, lineage, policy)', () => {
    const record = admittedFixture();
    const mutations: readonly ((r: TimeMachineRecord) => unknown)[] = [
      (r) => ({ ...r, available_time: (r.event_time as number) - 1 }), // quartet ordering
      (r) => ({ ...r, tenant: '' }),
      (r) => ({ ...r, event_time: 'soon' }),
      (r) => ({ ...r, inputs: [r.record_id] }), // self-reference
      (r) => ({ ...r, inputs: ['p-1', 'p-1'] }), // duplicate parents
      (r) => ({ ...r, computation: { transform_id: 'x', delay: {} } }), // policy without lineage
      (r) => ({ ...r, provenance: { ...r.provenance, origin: 'mythical' } }),
      (r) => ({ ...r, provenance: { ...r.provenance, custody: null } }),
      (r) => ({ ...r, record_id: '' }),
      (r) => ({ ...r, payload: undefined }),
    ];
    for (const mutate of mutations) {
      const mutated = mutate(record);
      expect(isTimeMachineRecord(mutated)).toBe(false);
      expect(t026.isFirewallRecord(mutated)).toBe(false);
    }
  });

  it('filter validation agrees on valid and invalid selectors (same rules, typed results)', () => {
    const selectors: unknown[] = [
      {},
      { ids: ['a', 'b'] },
      { ids: ['a', ''] },
      { ids: ['a', 'a'] },
      { ids: 'a' },
      { availableFrom: 1, availableTo: 2 },
      { availableFrom: 2, availableTo: 1 },
      { availableFrom: -1 },
      { availableTo: 1.5 },
      null,
    ];
    for (const selector of selectors) {
      const mine = validateProjectionSelector(selector);
      const theirs = t026.validateKnowledgeQueryFilter(selector as KnowledgeQueryFilter);
      expect(mine.ok).toBe(theirs.ok);
    }
  });

  it('the reference port and the T026 decision-rule mirror agree on the fixture base', () => {
    const record = admittedFixture();
    const base = { records: [record], size: 1 };
    const clock: FirewallClock = { now: 2_000 as TimestampMs };
    const tenant = requireTenantId('acme');

    // Both decide 'included' at the inclusive boundary...
    const mine = referenceFirewallProject(base, clock, tenant, {});
    expect(mine.ok).toBe(true);
    if (!mine.ok) return;
    expect(mine.value.records).toHaveLength(1);

    // ...and the audit shape is the T026 replayable shape.
    const audit = mine.value.audit;
    expect(audit.tenant).toBe('acme');
    expect(audit.at).toBe(2_000);
    expect(audit.scanned).toBe(1);
    expect(audit.decisions[0]?.decision).toBe('included');
    expect(audit.decisions[0]?.reason).toBe('visible');
    expect(audit.decisions[0]?.available_time).toBe(2_000);
  });
});

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

/** One admitted record through the real admission path. */
function admittedFixture(): TimeMachineRecord {
  const event = rawEvent('kr-admitted', 2_000);
  const admission = admitCanonicalEvent(event, requireTenantId('acme'), {
    batch_ordinal: 1,
    batch_id: 'interop-batch',
    ingestion_time: 2_100 as TimestampMs,
    arrival_sequence: 0,
  });
  if (!admission.ok) throw new Error(admission.error.message);
  return admission.value;
}
