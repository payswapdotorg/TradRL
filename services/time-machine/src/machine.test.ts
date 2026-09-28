// The RollingTimeMachine behavioral suite: ingest dispositions (admitted /
// rejected / quarantined_late), late-arrival reconciliation on BOTH declared
// paths, eviction boundaries, as-of queries, quartet carrying, immutability.

import { describe, expect, it } from 'vitest';
import {
  createReferenceFirewallPort,
  isDeeplyFrozen,
  isTimeMachineRecord,
  recomputeViewHash,
} from './index';
import { DATASET, TENANT, derivedEvent, feed, idsOf, machineOf, rawEvent, viewAt } from './fixtures';
import type { KnowledgeRecordId, TimestampMs } from './index';

describe('machine construction', () => {
  it('rejects invalid configurations with typed invalid_config', () => {
    const cases: unknown[] = [
      null,
      {},
      { dataset: 'd', tenant: 't', horizon: {}, maxRecords: 0, lateArrival: 'recompute' },
      { dataset: '', tenant: 't', horizon: {}, maxRecords: 1, lateArrival: 'recompute' },
      { dataset: 'd', tenant: '', horizon: {}, maxRecords: 1, lateArrival: 'recompute' },
      { dataset: 'd', tenant: 't', horizon: { milliseconds: -1 }, maxRecords: 1, lateArrival: 'recompute' },
      { dataset: 'd', tenant: 't', horizon: {}, maxRecords: 1, lateArrival: 'drop' },
      { dataset: 'd', tenant: 't', horizon: {}, maxRecords: 1, lateArrival: 'recompute', firewall: { project: 5 } },
      { dataset: 'd', tenant: 't', horizon: {}, maxRecords: 1, lateArrival: 'recompute', ingestClock: { next: 'x' } },
    ];
    for (const config of cases) {
      const result = machineOf.__create(config);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe('invalid_config');
    }
  });

  it('exposes dataset, tenant and stats surface', () => {
    const machine = machineOf({ horizonMs: 5_000, maxRecords: 10, lateArrival: 'quarantine' });
    expect(machine.dataset).toBe(DATASET);
    expect(machine.tenant).toBe(TENANT);
    const stats = machine.stats();
    expect(stats.horizon_ms).toBe(5_000);
    expect(stats.max_records).toBe(10);
    expect(stats.late_arrival).toBe('quarantine');
    expect(stats.window_size).toBe(0);
    expect(stats.frontier).toBeNull();
    expect(stats.firewall_bound).toBe(true);
  });
});

describe('ingest dispositions', () => {
  it('admits valid events with arrival sequences, stamped quartets and frozen records', () => {
    const machine = machineOf();
    const receipt = feed(machine, [rawEvent('evt-1', 1_000), rawEvent('evt-2', 2_000)], 'batch-1');
    expect(receipt.batch_ordinal).toBe(1);
    expect(receipt.admitted).toBe(2);
    expect(receipt.dispositions.map((d) => d.disposition)).toEqual(['admitted', 'admitted']);
    expect(receipt.dispositions[0]?.arrival_sequence).toBe(0);
    expect(receipt.dispositions[1]?.arrival_sequence).toBe(1);
    expect(receipt.frontier).toBe(2_000);
    expect(receipt.window.size).toBe(2);

    const view = viewAt(machine, 10_000);
    expect(idsOf(view.records)).toEqual(['evt-1', 'evt-2']);
    const record = view.records[0];
    expect(record).toBeDefined();
    if (!record) return;
    expect(record.event_time).toBe(950);
    expect(record.source_time).toBeNull();
    expect(record.available_time).toBe(1_000);
    expect(record.ingestion_time).toBe(0); // the built-in deterministic clock: base 0, step 1
    expect(record.tenant).toBe(TENANT);
    expect(record.arrival_sequence).toBe(0);
    expect(record.provenance.custody.batch.batch_id).toBe('batch-1');
    expect(record.provenance.custody.commit.commit_id).toBe('tmc-00000001');
    expect(record.provenance.custody.commit.commit_sequence).toBe(1);
    expect(isTimeMachineRecord(record)).toBe(true);
    expect(isDeeplyFrozen(record)).toBe(true);
  });

  it('rejects invalid envelopes with typed field errors and records them', () => {
    const machine = machineOf();
    const receipt = feed(machine, [{ event_id: 'bad' }, rawEvent('evt-1', 1_000)], 'batch-1');
    expect(receipt.admitted).toBe(1);
    expect(receipt.rejected).toBe(1);
    expect(machine.rejections()).toHaveLength(1);
    expect(machine.rejections()[0]?.code).toBe('invalid_event');
    expect(machine.rejections()[0]?.event_id).toBe('bad');
    expect(receipt.dispositions[0]?.rejection_code).toBe('invalid_event');
    expect(receipt.dispositions[0]?.errors.length).toBeGreaterThan(0);
  });

  it('rejects duplicate identities: across batches, within one batch, and after eviction', () => {
    const machine = machineOf({ horizonMs: 0 });
    feed(machine, [rawEvent('evt-1', 1_000)], 'batch-1');
    const receipt = feed(machine, [rawEvent('evt-1', 1_000)], 'batch-2');
    expect(receipt.dispositions[0]?.rejection_code).toBe('duplicate_event_id');

    const withinBatch = feed(machine, [rawEvent('evt-2', 2_000), rawEvent('evt-2', 3_000)], 'batch-3');
    expect(withinBatch.admitted).toBe(1);
    expect(withinBatch.dispositions[1]?.rejection_code).toBe('duplicate_event_id');

    // Identity outlives the window: horizon 0 evicts everything, but the id is dead forever.
    feed(machine, [rawEvent('evt-9', 9_000)], 'batch-4');
    const afterEviction = feed(machine, [rawEvent('evt-1', 1_500)], 'batch-5');
    expect(afterEviction.dispositions[0]?.rejection_code).toBe('duplicate_event_id');
    expect(afterEviction.admitted).toBe(0);
  });

  it('rejects derived events available before an in-window parent (T008 reconciliation)', () => {
    const machine = machineOf();
    feed(machine, [rawEvent('evt-parent', 2_000)], 'batch-1');
    const receipt = feed(machine, [derivedEvent('evt-child-early', ['evt-parent'], 1_999)], 'batch-2');
    expect(receipt.dispositions[0]?.rejection_code).toBe('derived_before_inputs');

    // Equal is the boundary (the parent is visible at the child's availability).
    const boundary = feed(machine, [derivedEvent('evt-child-equal', ['evt-parent'], 2_000)], 'batch-3');
    expect(boundary.admitted).toBe(1);

    // Dangling parents are external lineage — tolerated (T008 store discipline).
    const external = feed(machine, [derivedEvent('evt-child-external', ['evt-elsewhere'], 1_000)], 'batch-4');
    expect(external.admitted).toBe(1);
  });

  it('checks in-batch parents for the propagation floor too', () => {
    const machine = machineOf();
    const receipt = feed(
      machine,
      [rawEvent('evt-p', 5_000), derivedEvent('evt-c', ['evt-p'], 4_000)],
      'batch-1',
    );
    expect(receipt.admitted).toBe(1);
    expect(receipt.dispositions[1]?.rejection_code).toBe('derived_before_inputs');
  });

  it('rejects malformed batches and empty ingests with typed failures', () => {
    const machine = machineOf();
    const badBatch = machine.ingestBatch([rawEvent('evt-1', 1_000)], { batch_id: '' });
    expect(badBatch.ok).toBe(false);
    if (badBatch.ok) return;
    expect(badBatch.error.code).toBe('invalid_batch');

    const empty = machine.ingestBatch([], { batch_id: 'b' });
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.error.code).toBe('empty_ingest');

    // A rejected ingest does not consume a batch ordinal (determinism).
    feed(machine, [rawEvent('evt-1', 1_000)], 'batch-1');
    const receipt = feed(machine, [rawEvent('evt-2', 2_000)], 'batch-2');
    expect(receipt.batch_ordinal).toBe(2);
  });

  it('converts a broken injected clock into typed rejections without dropping silently', () => {
    const machine = machineOf();
    const receipt = machine.ingestBatch([rawEvent('evt-1', 1_000)], { batch_id: 'b' });
    expect(receipt.ok).toBe(true);
    // Now build a machine with a poisoned clock.
    const poisoned = machineOf({ firewall: createBrokenPort() });
    void poisoned;
    const broken = createMachineWithBrokenClock();
    const result = broken.ingestBatch([rawEvent('evt-x', 1_000)], { batch_id: 'b' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.admitted).toBe(0);
    expect(result.value.dispositions[0]?.rejection_code).toBe('invalid_ingest_clock');
    expect(broken.rejections()[0]?.code).toBe('invalid_ingest_clock');
  });
});

describe('late arrival — BOTH declared reconciliation paths', () => {
  it('recompute: a late event is admitted and updates the as-of state FROM its available_time onward', () => {
    const machine = machineOf({ lateArrival: 'recompute' });
    feed(machine, [rawEvent('evt-a', 5_000)], 'batch-1');
    // Before the late event: views at 3_000 are empty.
    expect(idsOf(viewAt(machine, 3_000).records)).toEqual([]);

    // The late arrival (available 3_000, arrived after the 5_000 frontier).
    const receipt = feed(machine, [rawEvent('evt-late', 3_000)], 'batch-2');
    expect(receipt.admitted).toBe(1);
    expect(receipt.dispositions[0]?.disposition).toBe('admitted');
    expect(receipt.dispositions[0]?.late_by).toBeNull();

    // The as-of state NOW includes it from its available_time onward...
    expect(idsOf(viewAt(machine, 3_000).records)).toEqual(['evt-late']);
    expect(idsOf(viewAt(machine, 2_999).records)).toEqual([]);
    // ...and the earlier view is unchanged where it was already defined.
    expect(idsOf(viewAt(machine, 5_000).records)).toEqual(['evt-late', 'evt-a']);
  });

  it('quarantine: a late event is held with DECLARED lateness and never enters any view', () => {
    const machine = machineOf({ lateArrival: 'quarantine' });
    feed(machine, [rawEvent('evt-a', 5_000)], 'batch-1');
    const receipt = feed(machine, [rawEvent('evt-late', 3_000)], 'batch-2');
    expect(receipt.admitted).toBe(0);
    expect(receipt.quarantined).toBe(1);
    expect(receipt.dispositions[0]?.disposition).toBe('quarantined_late');
    expect(receipt.dispositions[0]?.late_by).toBe(2_000);

    const quarantined = machine.quarantine();
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]?.reason).toBe('late_arrival');
    expect(quarantined[0]?.late_by).toBe(2_000);
    expect(quarantined[0]?.frontier_at_quarantine).toBe(5_000);
    expect(quarantined[0]?.event.event_id).toBe('evt-late');
    expect(quarantined[0]?.batch_id).toBe('batch-2');

    // Never in any view — not even far in the future.
    expect(idsOf(viewAt(machine, 100_000).records)).toEqual(['evt-a']);
  });

  it('within-batch reordering counts as lateness (the frontier includes batch-so-far)', () => {
    const recompute = machineOf({ lateArrival: 'recompute' });
    const receipt = feed(recompute, [rawEvent('evt-1', 10_000), rawEvent('evt-2', 4_000)], 'batch-1');
    expect(receipt.admitted).toBe(2);
    expect(idsOf(viewAt(recompute, 10_000).records)).toEqual(['evt-2', 'evt-1']);

    const quarantine = machineOf({ lateArrival: 'quarantine' });
    const qReceipt = feed(quarantine, [rawEvent('evt-1', 10_000), rawEvent('evt-2', 4_000)], 'batch-1');
    expect(qReceipt.admitted).toBe(1);
    expect(qReceipt.quarantined).toBe(1);
    expect(qReceipt.dispositions[1]?.disposition).toBe('quarantined_late');
  });

  it('an event exactly AT the frontier is NOT late (strictly-below semantics)', () => {
    const machine = machineOf({ lateArrival: 'quarantine' });
    feed(machine, [rawEvent('evt-1', 5_000)], 'batch-1');
    const receipt = feed(machine, [rawEvent('evt-2', 5_000)], 'batch-2');
    expect(receipt.admitted).toBe(1);
    expect(receipt.quarantined).toBe(0);
    // The first event of an empty machine is never late.
    const fresh = machineOf({ lateArrival: 'quarantine' });
    expect(feed(fresh, [rawEvent('evt-x', 1)], 'b').quarantined).toBe(0);
  });

  it('silent drop is unrepresentable: every disposition is one of three declared kinds', () => {
    const machine = machineOf({ lateArrival: 'quarantine' });
    const receipt = feed(
      machine,
      [rawEvent('evt-1', 5_000), 'garbage', rawEvent('evt-late', 1_000), rawEvent('evt-2', 6_000)],
      'batch-1',
    );
    const kinds = receipt.dispositions.map((d) => d.disposition);
    expect(kinds).toEqual(['admitted', 'rejected', 'quarantined_late', 'admitted']);
    expect(receipt.admitted + receipt.rejected + receipt.quarantined).toBe(4);
    expect(machine.quarantine().length + machine.rejections().length).toBe(2);
  });
});

describe('rolling eviction', () => {
  it('evicts on the horizon boundary: exactly at the floor retained, one below evicted', () => {
    const machine = machineOf({ horizonMs: 1_000 });
    feed(machine, [rawEvent('evt-1', 1_000), rawEvent('evt-2', 2_000)], 'batch-1');
    // frontier 2_000, floor 1_000: evt-1 (avail 1_000 == floor) retained INCLUSIVE.
    expect(idsOf(viewAt(machine, 10_000).records)).toEqual(['evt-1', 'evt-2']);

    // The frontier advances to 3_000: floor 2_000 — evt-1 (1_000 < 2_000) evicted.
    const receipt = feed(machine, [rawEvent('evt-3', 3_000)], 'batch-2');
    expect(receipt.evicted).toEqual([{ record_id: 'evt-1', available_time: 1_000, reason: 'horizon' }]);
    expect(idsOf(viewAt(machine, 10_000).records)).toEqual(['evt-2', 'evt-3']);
  });

  it('evicts on the hard capacity bound with the deterministic (available_time, record_id) victim', () => {
    const machine = machineOf({ maxRecords: 2, horizonMs: 1_000_000 });
    feed(machine, [rawEvent('b-1', 1_000), rawEvent('a-1', 2_000)], 'batch-1');
    expect(machine.stats().window_size).toBe(2);

    // Availability tie: record_id breaks it ('a-2' < 'b-1').
    const receipt = feed(machine, [rawEvent('a-2', 2_000)], 'batch-2');
    expect(receipt.evicted).toEqual([{ record_id: 'b-1', available_time: 1_000, reason: 'capacity' }]);
    expect(machine.stats().window_size).toBe(2);

    // Oldest availability is the victim when ids would not tie.
    const receipt2 = feed(machine, [rawEvent('z-9', 3_000)], 'batch-3');
    expect(receipt2.evicted[0]?.record_id).toBe('a-1');
    expect(receipt2.evicted[0]?.reason).toBe('capacity');
    expect(machine.stats().window_size).toBe(2);
  });

  it('a late-below-floor event under recompute is admitted then immediately horizon-evicted (declared)', () => {
    const machine = machineOf({ horizonMs: 1_000, lateArrival: 'recompute' });
    feed(machine, [rawEvent('evt-1', 10_000)], 'batch-1');
    const receipt = feed(machine, [rawEvent('evt-old', 1_000)], 'batch-2');
    expect(receipt.admitted).toBe(1);
    expect(receipt.evicted).toEqual([{ record_id: 'evt-old', available_time: 1_000, reason: 'horizon' }]);
    expect(idsOf(viewAt(machine, 100_000).records)).toEqual(['evt-1']);
  });

  it('the window invariant holds across mixed feeds (bounded by horizon AND capacity)', () => {
    const machine = machineOf({ horizonMs: 5_000, maxRecords: 3 });
    for (let batch = 0; batch < 12; batch++) {
      feed(machine, [rawEvent(`evt-${batch}`, 10_000 + batch * 3_000), rawEvent(`late-${batch}`, 10_000 + batch * 1_000)], `batch-${batch}`);
      const stats = machine.stats();
      expect(stats.window_size).toBeLessThanOrEqual(3);
      if (stats.oldest_available !== null && stats.frontier !== null) {
        expect(stats.oldest_available).toBeGreaterThanOrEqual(Math.max(0, stats.frontier - 5_000));
      }
    }
  });
});

describe('as-of queries', () => {
  it('validates the query: dataset match, instant, selector', () => {
    const machine = machineOf();
    feed(machine, [rawEvent('evt-1', 1_000)], 'batch-1');

    const wrongDataset = machine.asOf({ dataset: 'other-dataset' as never, at:(5_000) as TimestampMs });
    expect(wrongDataset.ok).toBe(false);
    if (wrongDataset.ok) return;
    expect(wrongDataset.error.code).toBe('unknown_dataset');

    const badAt = machine.asOf({ dataset: DATASET, at: -1 });
    expect(badAt.ok).toBe(false);
    if (badAt.ok) return;
    expect(badAt.error.code).toBe('invalid_query');

    const badSelector = machine.asOf({ dataset: DATASET, at:(5_000) as TimestampMs, selector: { availableFrom:(10) as TimestampMs, availableTo:(5) as TimestampMs } });
    expect(badSelector.ok).toBe(false);
    if (badSelector.ok) return;
    expect(badSelector.error.code).toBe('invalid_query');

    const nonObject = machine.asOf(null);
    expect(nonObject.ok).toBe(false);
  });

  it('orders records by (available_time, record_id) independent of arrival order', () => {
    const machine = machineOf();
    feed(machine, [rawEvent('evt-c', 3_000), rawEvent('evt-a', 1_000), rawEvent('evt-b', 2_000)], 'batch-1');
    expect(idsOf(viewAt(machine, 10_000).records)).toEqual(['evt-a', 'evt-b', 'evt-c']);
  });

  it('applies the selector through the firewall passage (ids / availableFrom / availableTo)', () => {
    const machine = machineOf();
    feed(machine, [rawEvent('evt-1', 1_000), rawEvent('evt-2', 2_000), rawEvent('evt-3', 3_000)], 'batch-1');
    expect(idsOf(viewAt(machine, 10_000, { ids: ['evt-2' as KnowledgeRecordId] }).records)).toEqual(['evt-2']);
    expect(idsOf(viewAt(machine, 10_000, { availableFrom:(2_000) as TimestampMs }).records)).toEqual(['evt-2', 'evt-3']);
    expect(idsOf(viewAt(machine, 10_000, { availableTo:(2_000) as TimestampMs }).records)).toEqual(['evt-1', 'evt-2']);
  });

  it('the view is deeply frozen, hash-recomputable, and audit-carrying', () => {
    const machine = machineOf();
    feed(machine, [rawEvent('evt-1', 1_000)], 'batch-1');
    const view = viewAt(machine, 10_000);
    expect(isDeeplyFrozen(view)).toBe(true);
    expect(view.hash).toBe(recomputeViewHash(view));
    expect(view.audit.tenant).toBe(TENANT);
    expect(view.audit.at).toBe(10_000);
    expect(view.audit.scanned).toBe(1);
    expect(view.audit.decisions[0]?.decision).toBe('included');
    expect(view.selector).toEqual({});
  });

  it('the firewall audit explains exclusions (not_yet_available evidence, no payload)', () => {
    const machine = machineOf();
    feed(machine, [rawEvent('evt-1', 5_000)], 'batch-1');
    const view = viewAt(machine, 4_999);
    expect(view.records).toHaveLength(0);
    const decision = view.audit.decisions[0];
    expect(decision?.decision).toBe('excluded');
    expect(decision?.reason).toBe('not_yet_available');
    expect(decision?.available_time).toBe(5_000);
  });
});

// ---------------------------------------------------------------------------
// Test-local helpers.
// ---------------------------------------------------------------------------

/** A machine whose injected clock throws (typed failure path). */
function createMachineWithBrokenClock(): ReturnType<typeof machineOf> {
  const { createRollingTimeMachine } = require('./machine') as typeof import('./machine');
  const result = createRollingTimeMachine({
    dataset: DATASET,
    tenant: TENANT,
    horizon: { milliseconds: 10_000 },
    maxRecords: 10,
    lateArrival: 'recompute',
    firewall: createReferenceFirewallPort(),
    ingestClock: {
      next(): number {
        throw new Error('clock exploded');
      },
    },
  });
  if (result.ok) return result.value;
  throw new Error(result.error.message);
}

/** A valid port (used to keep MachineOptions typing honest in the poisoned-clock test). */
function createBrokenPort(): ReturnType<typeof createReferenceFirewallPort> {
  return createReferenceFirewallPort();
}

// Expose the raw constructor for the invalid-config suite without leaking it
// through the public fixture surface.
machineOf.__create = undefined as unknown as ((config: unknown) => { ok: boolean; error?: { code: string } }) | undefined;
