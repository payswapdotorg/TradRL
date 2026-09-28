// Rolling determinism (acceptance criteria 4): replaying the SAME event
// sequence (same ingestion order) through the rolling window produces
// byte-identical as-of states, cursor positions, receipts and view hashes
// (deep-equal); late/reordered arrivals and the quarantine path included.
// A DIFFERENT order is declared different (order is lineage), never
// accidentally equal.

import { describe, expect, it } from 'vitest';
import { createReferenceFirewallPort, recomputeViewHash } from './index';
import { drainAt, feed, idsOf, machineOf, openCursor, rawEvent, viewAt } from './fixtures';

/** The canonical adversarial feed: out-of-order arrivals, duplicates, garbage, a future-dated record. */
const FEED: readonly (readonly unknown[])[] = [
  [rawEvent('evt-1', 5_000), rawEvent('evt-2', 2_000)],
  ['garbage', rawEvent('evt-1', 5_000)], // a rejected candidate + a duplicate id
  [rawEvent('evt-future', 50_000)],
  [rawEvent('evt-late', 1_000)],
  [rawEvent('evt-3', 6_000), rawEvent('evt-2x', 2_500)],
];

/** Drive a machine through the canonical feed with fixed batch ids. */
function drive(machine: ReturnType<typeof machineOf>): void {
  FEED.forEach((events, index) => {
    feed(machine, events, `batch-${index + 1}`);
  });
}

describe('byte-identical replay (same sequence, same order)', () => {
  it('two machines fed the identical sequence produce deep-equal receipts at every step', () => {
    const a = machineOf({ horizonMs: 100_000 });
    const b = machineOf({ horizonMs: 100_000 });
    FEED.forEach((events, index) => {
      const receiptA = feed(a, events, `batch-${index + 1}`);
      const receiptB = feed(b, events, `batch-${index + 1}`);
      expect(receiptB).toEqual(receiptA);
    });
  });

  it('identical views and hashes at a dense sweep of instants', () => {
    const a = machineOf({ horizonMs: 100_000 });
    const b = machineOf({ horizonMs: 100_000 });
    drive(a);
    drive(b);
    for (let t = 0; t <= 60_000; t += 250) {
      const viewA = viewAt(a, t);
      const viewB = viewAt(b, t);
      expect(viewB).toEqual(viewA);
      expect(viewB.hash).toBe(viewA.hash);
      expect(viewB.hash).toBe(recomputeViewHash(viewB));
    }
  });

  it('identical cursor positions and drain streams', () => {
    const a = machineOf({ horizonMs: 100_000 });
    const b = machineOf({ horizonMs: 100_000 });
    const cursorA = openCursor(a);
    const cursorB = openCursor(b);

    // Interleave drains with feeds — the position stream must match exactly.
    for (let index = 0; index < FEED.length; index++) {
      feed(a, FEED[index] as readonly unknown[], `batch-${index + 1}`);
      feed(b, FEED[index] as readonly unknown[], `batch-${index + 1}`);
      for (const t of [1_000, 3_000, 5_000, 20_000]) {
        const drainA = drainAt(a, cursorA.cursor_id, t);
        const drainB = drainAt(b, cursorB.cursor_id, t);
        expect(drainB).toEqual(drainA);
      }
      expect(b.getCursor(cursorB.cursor_id)).toEqual(a.getCursor(cursorA.cursor_id));
    }
    expect(a.getCursor(cursorA.cursor_id)).toEqual(b.getCursor(cursorB.cursor_id));
  });

  it('identical whole-machine snapshots (the deep determinism proof)', () => {
    const a = machineOf({ horizonMs: 100_000 });
    const b = machineOf({ horizonMs: 100_000 });
    drive(a);
    drive(b);
    const cursorA = openCursor(a);
    const cursorB = openCursor(b);
    drainAt(a, cursorA.cursor_id, 10_000);
    drainAt(b, cursorB.cursor_id, 10_000);
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(b.stats()).toEqual(a.stats());
    expect(b.quarantine()).toEqual(a.quarantine());
    expect(b.rejections()).toEqual(a.rejections());
  });

  it('deterministic under the QUARANTINE path too', () => {
    const a = machineOf({ horizonMs: 100_000, lateArrival: 'quarantine' });
    const b = machineOf({ horizonMs: 100_000, lateArrival: 'quarantine' });
    drive(a);
    drive(b);
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(b.quarantine()).toEqual(a.quarantine());
    // The quarantined event never leaked into either machine's views.
    expect(idsOf(viewAt(a, 1_000_000).records)).toEqual(idsOf(viewAt(b, 1_000_000).records));
  });

  it('deterministic under rolling eviction pressure (horizon + capacity)', () => {
    const options = { horizonMs: 4_000, maxRecords: 3 } as const;
    const a = machineOf(options);
    const b = machineOf(options);
    for (let step = 0; step < 20; step++) {
      const events = [rawEvent(`evt-${step}`, 10_000 + step * 2_000), rawEvent(`alt-${step}`, 10_000 + step * 2_000)];
      expect(feed(b, events, `batch-${step}`)).toEqual(feed(a, events, `batch-${step}`));
    }
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(viewAt(b, 100_000)).toEqual(viewAt(a, 100_000));
  });

  it('fresh port instances do not leak state into results (pure projections)', () => {
    const a = machineOf({ firewall: createReferenceFirewallPort() });
    const b = machineOf({ firewall: createReferenceFirewallPort() });
    drive(a);
    drive(b);
    expect(viewAt(b, 50_000)).toEqual(viewAt(a, 50_000));
  });
});

describe('order is lineage: a DIFFERENT ingestion order is declared different', () => {
  it('reordering the same multiset changes receipts, views and hashes (honestly, not accidentally equal)', () => {
    const inOrder = machineOf({ horizonMs: 100_000 });
    const reordered = machineOf({ horizonMs: 100_000 });
    feed(inOrder, [rawEvent('evt-1', 1_000), rawEvent('evt-2', 2_000)], 'batch-1');
    feed(reordered, [rawEvent('evt-2', 2_000), rawEvent('evt-1', 1_000)], 'batch-1');

    // Availability-ordered views agree (the as-of STATE is availability-driven)...
    expect(idsOf(viewAt(reordered, 10_000).records)).toEqual(idsOf(viewAt(inOrder, 10_000).records));
    // ...but arrival order is lineage: stamps, arrival sequences and hashes differ.
    const recordIn = viewAt(inOrder, 10_000).records.find((r) => r.record_id === 'evt-1');
    const recordRe = viewAt(reordered, 10_000).records.find((r) => r.record_id === 'evt-1');
    expect(recordIn?.arrival_sequence).toBe(0);
    expect(recordRe?.arrival_sequence).toBe(1);
    expect(recordIn?.ingestion_time).not.toBe(recordRe?.ingestion_time);
    expect(viewAt(reordered, 10_000).hash).not.toBe(viewAt(inOrder, 10_000).hash);
    expect(reordered.snapshot()).not.toEqual(inOrder.snapshot());
  });

  it('replaying the reordered sequence twice is still self-consistent (determinism is per-sequence)', () => {
    const first = machineOf({ horizonMs: 100_000 });
    const second = machineOf({ horizonMs: 100_000 });
    const sequence: readonly (readonly unknown[])[] = [
      [rawEvent('evt-b', 2_000), rawEvent('evt-a', 1_000)],
      [rawEvent('evt-d', 4_000), rawEvent('evt-c', 3_000)],
    ];
    for (const machine of [first, second]) {
      for (const [index, events] of sequence.entries()) {
        feed(machine, events, `batch-${index + 1}`);
      }
    }
    expect(second.snapshot()).toEqual(first.snapshot());
    expect(viewAt(second, 4_000)).toEqual(viewAt(first, 4_000));
  });
});
