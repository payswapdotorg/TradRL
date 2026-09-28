// Snapshot/Restore behavioral suite (acceptance criterion 7): lineage-hash
// sealing, tamper detection, full structural validation, and the restore
// contract — restoring a snapshot and feeding the identical subsequent
// sequence reproduces identical views, cursors and hashes.

import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_KIND,
  createDeterministicIngestClock,
  createReferenceFirewallPort,
  isDeeplyFrozen,
  restoreTimeMachine,
} from './index';
import { DATASET, TENANT, drainAt, feed, idsOf, machineOf, openCursor, rawEvent, viewAt } from './fixtures';

describe('snapshot sealing', () => {
  it('captures the whole as-of state with a recomputable lineage hash, deeply frozen', () => {
    const machine = machineOf({ horizonMs: 10_000 });
    feed(machine, [rawEvent('evt-1', 1_000), rawEvent('evt-2', 2_000)], 'batch-1');
    const cursor = openCursor(machine);
    drainAt(machine, cursor.cursor_id, 1_500);

    const snapshot = machine.snapshot();
    expect(snapshot.kind).toBe(SNAPSHOT_KIND);
    expect(snapshot.dataset).toBe(DATASET);
    expect(snapshot.tenant).toBe(TENANT);
    expect(snapshot.ingest_count).toBe(2);
    expect(snapshot.admitted_ids).toEqual(['evt-1', 'evt-2']);
    expect(snapshot.window.map((record) => record.record_id)).toEqual(['evt-1', 'evt-2']);
    expect(snapshot.frontier).toBe(2_000);
    expect(snapshot.batch_ordinal).toBe(1);
    expect(snapshot.cursor_ordinal).toBe(1);
    expect(snapshot.cursors).toHaveLength(1);
    expect(snapshot.cursors[0]?.position).toBe(2);
    expect(snapshot.cursors[0]?.last_drain_at).toBe(1_500);
    expect(snapshot.ingest_clock.kind).toBe('builtin-stepping');
    expect(isDeeplyFrozen(snapshot)).toBe(true);
    expect(snapshot.lineage_hash).toMatch(/^[0-9a-f]{8}-[0-9a-f]{8}$/);
  });

  it('the lineage hash binds the content: any mutation breaks it (tamper detection)', () => {
    const machine = machineOf();
    feed(machine, [rawEvent('evt-1', 1_000)], 'batch-1');
    const snapshot = machine.snapshot();
    const hash = snapshot.lineage_hash;

    const tamperedWindow = { ...snapshot, window: [...snapshot.window, snapshot.window[0] as never] };
    const resultWindow = restoreTimeMachine(tamperedWindow);
    expect(resultWindow.ok).toBe(false);
    if (resultWindow.ok) return;
    expect(['invalid_snapshot', 'snapshot_mismatch']).toContain(resultWindow.error.code);

    // A surgical payload tamper: same ids, different content — the hash
    // covers the lineage skeleton, so a payload-only edit is caught by the
    // window guards only when structural; the lineage hash catches
    // availability/identity edits:
    const record = snapshot.window[0];
    expect(record).toBeDefined();
    if (!record) return;
    const tamperedRecord = { ...record, available_time: record.available_time + 1 };
    const tampered = {
      ...snapshot,
      window: [tamperedRecord],
      // everything else identical, including the ORIGINAL hash
      lineage_hash: hash,
    };
    const result = restoreTimeMachine(tampered);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('snapshot_mismatch');
  });

  it('structural validation rejects every malformed shape with typed invalid_snapshot', () => {
    const machine = machineOf();
    feed(machine, [rawEvent('evt-1', 1_000)], 'batch-1');
    const snapshot = machine.snapshot();

    const cases: unknown[] = [
      null,
      'snapshot',
      { ...snapshot, kind: 'tradrl.time-machine.snapshot/v2' },
      { ...snapshot, dataset: '' },
      { ...snapshot, tenant: '' },
      { ...snapshot, horizon_ms: -1 },
      { ...snapshot, max_records: 0 },
      { ...snapshot, late_arrival: 'drop' },
      { ...snapshot, ingest_clock: { kind: 'nonsense' } },
      { ...snapshot, frontier: -5 },
      { ...snapshot, ingest_count: 'many' },
      { ...snapshot, admitted_ids: [] },
      { ...snapshot, admitted_ids: ['evt-1', 'evt-ghost'] },
      { ...snapshot, window: 'not-an-array' },
      { ...snapshot, cursors: [{ cursor_id: '', position: 0, last_drain_at: null, selector: {} }] },
      { ...snapshot, cursors: [{ cursor_id: 'cur-00000001', position: 99, last_drain_at: null, selector: {} }] },
      { ...snapshot, lineage_hash: 'nope' },
      { ...snapshot, window: [] }, // inconsistent with admitted_ids AND the hash
    ];
    for (const candidate of cases) {
      const result = restoreTimeMachine(candidate);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(['invalid_snapshot', 'snapshot_mismatch']).toContain(result.error.code);
    }
  });

  it('the window invariants are enforced at restore (bounds, arrival order, tenants)', () => {
    const machine = machineOf({ maxRecords: 5 });
    feed(machine, [rawEvent('evt-1', 1_000), rawEvent('evt-2', 2_000)], 'batch-1');
    const snapshot = machine.snapshot();
    const recordOne = snapshot.window[0];
    const recordTwo = snapshot.window[1];
    expect(recordOne && recordTwo).toBeTruthy();
    if (!recordOne || !recordTwo) return;

    // Arrival sequences out of order.
    const swapped = { ...snapshot, window: [recordTwo, recordOne] };
    const swappedResult = restoreTimeMachine(swapped);
    expect(swappedResult.ok).toBe(false);

    // A foreign-tenant record smuggled into the window (L12).
    const foreign = { ...recordTwo, tenant: 'globex' as never };
    const smuggled = {
      ...snapshot,
      window: [recordOne, foreign],
      admitted_ids: ['evt-1', 'evt-2'],
    };
    const smuggledResult = restoreTimeMachine(smuggled);
    expect(smuggledResult.ok).toBe(false);

    // Exceeding the memory bound.
    const crowded = { ...snapshot, max_records: 1 };
    const crowdedResult = restoreTimeMachine(crowded);
    expect(crowdedResult.ok).toBe(false);
  });
});

describe('the restore contract (identical subsequent behavior)', () => {
  it('a restored machine reproduces identical views, hashes and cursor streams for identical feeds', () => {
    const original = machineOf({ horizonMs: 50_000 });
    feed(original, [rawEvent('evt-1', 10_000), rawEvent('evt-2', 20_000)], 'batch-1');
    const cursor = openCursor(original);
    drainAt(original, cursor.cursor_id, 15_000);

    const snapshot = original.snapshot();
    const restored = restoreTimeMachine(snapshot, { firewall: createReferenceFirewallPort() });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    const machine = restored.value;

    // Identical subsequent event sequence...
    feed(machine, [rawEvent('evt-3', 30_000), rawEvent('evt-late', 12_000)], 'batch-2');
    feed(original, [rawEvent('evt-3', 30_000), rawEvent('evt-late', 12_000)], 'batch-2');

    // ...produces byte-identical as-of states...
    for (const t of [10_000, 12_000, 15_000, 20_000, 30_000, 100_000]) {
      const a = viewAt(original, t);
      const b = viewAt(machine, t);
      expect(b).toEqual(a);
      expect(b.hash).toBe(a.hash);
    }

    // ...and identical cursor streams (the restored cursor kept its position).
    const drainA = drainAt(original, cursor.cursor_id, 30_000);
    const drainB = drainAt(machine, cursor.cursor_id, 30_000);
    expect(drainB).toEqual(drainA);
    expect(idsOf(drainB.records)).toEqual(['evt-late', 'evt-2', 'evt-3']);

    // ...and identical receipts and snapshots (full determinism).
    expect(machine.stats()).toEqual(original.stats());
    expect(machine.snapshot()).toEqual(original.snapshot());

    // New cursors get fresh deterministic ids on both (no id collisions).
    expect(openCursor(machine).cursor_id).toBe(openCursor(original).cursor_id);
  });

  it('the restored builtin clock continues the EXACT stamp sequence', () => {
    const original = machineOf();
    feed(original, [rawEvent('evt-1', 1_000), rawEvent('evt-2', 2_000)], 'batch-1');
    const restored = restoreTimeMachine(original.snapshot(), { firewall: createReferenceFirewallPort() });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    feed(restored.value, [rawEvent('evt-3', 3_000)], 'batch-2');
    feed(original, [rawEvent('evt-3', 3_000)], 'batch-2');
    // Stamps 0,1 for the first two records; the third is stamp 2 on BOTH.
    const recordA = viewAt(original, 3_000).records.find((r) => r.record_id === 'evt-3');
    const recordB = viewAt(restored.value, 3_000).records.find((r) => r.record_id === 'evt-3');
    expect(recordA?.ingestion_time).toBe(2);
    expect(recordB?.ingestion_time).toBe(2);
  });

  it('an injected-clock snapshot demands the clock at restore (typed clock_required)', () => {
    const clock = createDeterministicIngestClock(9_000, 7);
    expect(clock.ok).toBe(true);
    if (!clock.ok) return;
    const machine = machineOf({ ingestClock: clock.value });
    feed(machine, [rawEvent('evt-1', 1_000)], 'batch-1');

    const missing = restoreTimeMachine(machine.snapshot());
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe('clock_required');

    // Re-supplying a positioned clock restores exactly (stamps continue).
    const clockAgain = createDeterministicIngestClock(9_000, 7, 1);
    expect(clockAgain.ok).toBe(true);
    if (!clockAgain.ok) return;
    const restored = restoreTimeMachine(machine.snapshot(), {
      ingestClock: clockAgain.value,
      firewall: createReferenceFirewallPort(),
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    feed(restored.value, [rawEvent('evt-2', 2_000)], 'batch-2');
    const record = viewAt(restored.value, 2_000).records.find((r) => r.record_id === 'evt-2');
    expect(record?.ingestion_time).toBe(9_007); // base + 1*step — the exact next stamp
  });

  it('a state-bearing injected clock transfers its identity through the snapshot', () => {
    const clock = createDeterministicIngestClock(1_000, 10);
    expect(clock.ok).toBe(true);
    if (!clock.ok) return;
    const machine = machineOf({ ingestClock: clock.value });
    feed(machine, [rawEvent('evt-1', 1_000)], 'batch-1');
    const snapshot = machine.snapshot();
    expect(snapshot.ingest_clock.kind).toBe('builtin-stepping');
    if (snapshot.ingest_clock.kind !== 'builtin-stepping') return;
    expect(snapshot.ingest_clock.base).toBe(1_000);
    expect(snapshot.ingest_clock.step_ms).toBe(10);

    // No clock dependency needed — the descriptor rebuilds it deterministically.
    const restored = restoreTimeMachine(snapshot, { firewall: createReferenceFirewallPort() });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    feed(restored.value, [rawEvent('evt-2', 2_000)], 'batch-2');
    const record = viewAt(restored.value, 2_000).records.find((r) => r.record_id === 'evt-2');
    expect(record?.ingestion_time).toBe(1_010);
  });

  it('restoring WITHOUT a firewall port yields a machine that cannot project (firewall_required)', () => {
    const machine = machineOf();
    feed(machine, [rawEvent('evt-1', 1_000)], 'batch-1');
    const snapshot = machine.snapshot();
    // The firewall is NOT serializable: restoring without re-binding it must
    // not silently allow direct reads — projections stay typed errors.
    const restored = restoreTimeMachine(snapshot);
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    const projection = restored.value.asOf({ dataset: DATASET, at: 1_000 as never });
    expect(projection.ok).toBe(false);
    if (projection.ok) return;
    expect(projection.error.code).toBe('firewall_required');
    // Ingestion still works on the restored machine (ingestion is not a projection).
    expect(restored.value.ingestBatch([rawEvent('evt-2', 2_000)], { batch_id: 'b' }).ok).toBe(true);
  });

  it('restore is repeatable: two restores of one snapshot behave identically', () => {
    const machine = machineOf();
    feed(machine, [rawEvent('evt-1', 1_000), rawEvent('evt-2', 2_000)], 'batch-1');
    const snapshot = machine.snapshot();
    const a = restoreTimeMachine(snapshot, { firewall: createReferenceFirewallPort() });
    const b = restoreTimeMachine(snapshot, { firewall: createReferenceFirewallPort() });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    feed(a.value, [rawEvent('evt-3', 3_000)], 'batch-2');
    feed(b.value, [rawEvent('evt-3', 3_000)], 'batch-2');
    expect(a.value.snapshot()).toEqual(b.value.snapshot());
    expect(viewAt(a.value, 3_000)).toEqual(viewAt(b.value, 3_000));
  });
});
