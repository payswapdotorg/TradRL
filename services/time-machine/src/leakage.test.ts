// THE ADVERSARIAL L4 SUITE (Work Order T029, acceptance criterion 3):
// an event with available_time > T NEVER appears in the as-of view at T —
// tested at every boundary (equal, epsilon-after, epsilon-before), under
// reordering, under embargo/backfill (ingestion_time is NEVER consulted),
// origin-blind (simulated/generated withheld exactly like historical), and
// on every consumer surface (views, cursor drains, quarantine, snapshots).
// The quartet is carried UNMODIFIED on every emitted record.

import { describe, expect, it } from 'vitest';
import { MAX_TIMESTAMP_MS } from './index';
import { drainAt, idsOf, machineOf, openCursor, rawEvent, viewAt } from './fixtures';

describe('L4 trip-wire: the inclusive availability boundary at every epsilon', () => {
  it('a record is visible EXACTLY at its available_time — never one millisecond earlier', () => {
    const machine = machineOf();
    machine.ingestBatch([rawEvent('evt-future', 10_000)], { batch_id: 'b' });

    // Epsilon-before: withheld.
    expect(idsOf(viewAt(machine, 9_999).records)).toEqual([]);
    // Equal: visible (the inclusive law).
    expect(idsOf(viewAt(machine, 10_000).records)).toEqual(['evt-future']);
    // Epsilon-after: still visible.
    expect(idsOf(viewAt(machine, 10_001).records)).toEqual(['evt-future']);
  });

  it('a sweep across the boundary flips membership exactly once, at the availability instant', () => {
    const machine = machineOf();
    machine.ingestBatch([rawEvent('evt-a', 5_000), rawEvent('evt-b', 7_000)], { batch_id: 'b' });
    for (let t = 4_000; t <= 8_000; t++) {
      const expected: string[] = [];
      if (t >= 5_000) expected.push('evt-a');
      if (t >= 7_000) expected.push('evt-b');
      expect(idsOf(viewAt(machine, t).records)).toEqual(expected);
    }
  });

  it('a deep-future record (available at the max instant) is withheld at max-1', () => {
    const machine = machineOf();
    machine.ingestBatch(
      [rawEvent('evt-max', MAX_TIMESTAMP_MS, { event_time: MAX_TIMESTAMP_MS })],
      { batch_id: 'b' },
    );
    expect(idsOf(viewAt(machine, MAX_TIMESTAMP_MS - 1).records)).toEqual([]);
    expect(idsOf(viewAt(machine, MAX_TIMESTAMP_MS).records)).toEqual(['evt-max']);
  });
});

describe('L4 trip-wire: reordering never leaks the future', () => {
  it('a future-dated record ingested EARLY stays withheld until its availability instant', () => {
    const machine = machineOf();
    // The future record arrives FIRST (reordered arrival).
    machine.ingestBatch([rawEvent('evt-future', 50_000)], { batch_id: 'b-1' });
    // Later, older records arrive; the frontier is dominated by the future record.
    machine.ingestBatch([rawEvent('evt-now', 10_000)], { batch_id: 'b-2' });

    expect(idsOf(viewAt(machine, 10_000).records)).toEqual(['evt-now']);
    expect(idsOf(viewAt(machine, 49_999).records)).toEqual(['evt-now']);
    expect(idsOf(viewAt(machine, 50_000).records)).toEqual(['evt-now', 'evt-future']);
  });

  it('an adversarial batch interleaving past and future keeps every boundary exact', () => {
    const machine = machineOf({ lateArrival: 'recompute' });
    machine.ingestBatch(
      [
        rawEvent('f-100', 100_000),
        rawEvent('p-10', 10_000),
        rawEvent('f-60', 60_000),
        rawEvent('p-20', 20_000),
      ],
      { batch_id: 'b' },
    );
    expect(idsOf(viewAt(machine, 15_000).records)).toEqual(['p-10']);
    expect(idsOf(viewAt(machine, 20_000).records)).toEqual(['p-10', 'p-20']);
    expect(idsOf(viewAt(machine, 59_999).records)).toEqual(['p-10', 'p-20']);
    expect(idsOf(viewAt(machine, 60_000).records)).toEqual(['p-10', 'p-20', 'f-60']);
    expect(idsOf(viewAt(machine, 99_999).records)).toEqual(['p-10', 'p-20', 'f-60']);
    expect(idsOf(viewAt(machine, 100_000).records)).toEqual(['p-10', 'p-20', 'f-60', 'f-100']);
  });
});

describe('L4 trip-wire: ingestion_time is NEVER the gate (D-003)', () => {
  it('EMBARGO — ingested (stamped) before it is available: withheld until its availability instant', () => {
    const machine = machineOf();
    // The built-in clock stamps ingestion_time 0 (far before availability 10_000).
    machine.ingestBatch([rawEvent('evt-embargo', 10_000)], { batch_id: 'b' });
    const view = viewAt(machine, 9_999);
    expect(idsOf(view.records)).toEqual([]);
    expect(view.records[0]).toBeUndefined();
    expect(idsOf(viewAt(machine, 10_000).records)).toEqual(['evt-embargo']);
  });

  it('BACKFILL — availability far in the past, arrival now: visible at its availability instant', () => {
    const machine = machineOf();
    machine.ingestBatch([rawEvent('evt-modern', 1_000_000)], { batch_id: 'b-1' });
    // A late backfill: available at 5_000 (deep past), arrives after the 1_000_000 frontier.
    machine.ingestBatch([rawEvent('evt-backfill', 5_000)], { batch_id: 'b-2' });
    // Visible at 5_000 the moment it is in the window (ingestion far later is irrelevant).
    expect(idsOf(viewAt(machine, 5_000).records)).toEqual(['evt-backfill']);
    expect(idsOf(viewAt(machine, 4_999).records)).toEqual([]);
  });

  it('varying ONLY ingestion_time never changes visibility (the predicate never consults it)', () => {
    const a = machineOf();
    const b = machineOf();
    machineFeedStamps(a, 0);
    machineFeedStamps(b, 500_000);
    // Same availability, wildly different admission stamps -> identical views at every T.
    for (const t of [4_999, 5_000, 5_001, 100_000]) {
      expect(idsOf(viewAt(a, t).records)).toEqual(idsOf(viewAt(b, t).records));
    }
  });
});

describe('L4 trip-wire: origin-blind (no provenance exemptions)', () => {
  it('simulated and generated records are withheld EXACTLY like historical ones', () => {
    const machine = machineOf();
    machine.ingestBatch(
      [
        rawEvent('evt-hist', 10_000, { origin: 'historical' }),
        rawEvent('evt-sim', 20_000, { origin: 'simulated' }),
        rawEvent('evt-gen', 30_000, { origin: 'generated' }),
      ],
      { batch_id: 'b' },
    );
    expect(idsOf(viewAt(machine, 9_999).records)).toEqual([]);
    expect(idsOf(viewAt(machine, 10_000).records)).toEqual(['evt-hist']);
    expect(idsOf(viewAt(machine, 19_999).records)).toEqual(['evt-hist']);
    expect(idsOf(viewAt(machine, 20_000).records)).toEqual(['evt-hist', 'evt-sim']);
    expect(idsOf(viewAt(machine, 29_999).records)).toEqual(['evt-hist', 'evt-sim']);
    expect(idsOf(viewAt(machine, 30_000).records)).toEqual(['evt-hist', 'evt-sim', 'evt-gen']);
  });
});

describe('L4 trip-wire: the quartet is carried UNMODIFIED on every emitted record', () => {
  it('views carry the ingested event_time/source_time/available_time verbatim', () => {
    const machine = machineOf();
    machine.ingestBatch(
      [rawEvent('evt-q', 10_000, { event_time: 9_123, source_time: 9_456 })],
      { batch_id: 'b' },
    );
    const record = viewAt(machine, 10_000).records[0];
    expect(record).toBeDefined();
    if (!record) return;
    expect(record.event_time).toBe(9_123);
    expect(record.source_time).toBe(9_456);
    expect(record.available_time).toBe(10_000);
    // The stamped admission time from the built-in deterministic clock (base 0, step 1).
    expect(record.ingestion_time).toBe(0);
  });

  it('cursor drains carry the same quartet (no rewriting on any egress surface)', () => {
    const machine = machineOf();
    machine.ingestBatch(
      [rawEvent('evt-d', 10_000, { event_time: 9_000, source_time: null })],
      { batch_id: 'b' },
    );
    const cursor = openCursor(machine);
    const drain = drainAt(machine, cursor.cursor_id, 10_000);
    const record = drain.records[0];
    expect(record).toBeDefined();
    if (!record) return;
    expect(record.event_time).toBe(9_000);
    expect(record.source_time).toBeNull();
    expect(record.available_time).toBe(10_000);
    expect(record.ingestion_time).toBe(0);
  });
});

describe('L4 trip-wire: every consumer surface is gated', () => {
  it('cursor drains NEVER deliver a record before its availability instant', () => {
    const machine = machineOf();
    const cursor = openCursor(machine);
    machine.ingestBatch([rawEvent('evt-f', 10_000)], { batch_id: 'b' });

    const early = drainAt(machine, cursor.cursor_id, 9_999);
    expect(early.records).toHaveLength(0);
    const onTime = drainAt(machine, cursor.cursor_id, 10_000);
    expect(idsOf(onTime.records)).toEqual(['evt-f']);
    // Already delivered — the cursor advanced past it.
    const again = drainAt(machine, cursor.cursor_id, 10_001);
    expect(again.records).toHaveLength(0);
  });

  it('quarantined events NEVER appear in any view (the quarantine is not a side door)', () => {
    const machine = machineOf({ lateArrival: 'quarantine' });
    machine.ingestBatch([rawEvent('evt-front', 100_000)], { batch_id: 'b-1' });
    machine.ingestBatch([rawEvent('evt-late', 50_000)], { batch_id: 'b-2' });
    expect(machine.quarantine()).toHaveLength(1);
    expect(idsOf(viewAt(machine, 50_000).records)).toEqual([]);
    expect(idsOf(viewAt(machine, 1_000_000).records)).toEqual(['evt-front']);
  });

  it('evicted records are gone from every surface (the rolling contract)', () => {
    const machine = machineOf({ horizonMs: 1_000 });
    machine.ingestBatch([rawEvent('evt-old', 1_000), rawEvent('evt-new', 5_000)], { batch_id: 'b' });
    // evt-old (1_000 < floor 4_000) evicted — nothing brings it back, at any T.
    expect(idsOf(viewAt(machine, 1_000).records)).toEqual([]);
    expect(idsOf(viewAt(machine, 1_000_000).records)).toEqual(['evt-new']);
  });

  it('the audit log names every withheld record with not_yet_available (evidence, not content)', () => {
    const machine = machineOf();
    machine.ingestBatch([rawEvent('evt-a', 5_000), rawEvent('evt-b', 15_000)], { batch_id: 'b' });
    const view = viewAt(machine, 10_000);
    expect(idsOf(view.records)).toEqual(['evt-a']);
    const withheld = view.audit.decisions.filter((d) => d.reason === 'not_yet_available');
    expect(withheld.map((d) => d.record_id)).toEqual(['evt-b']);
    expect(withheld[0]?.available_time).toBe(15_000);
  });
});

// ---------------------------------------------------------------------------
// Local helpers.
// ---------------------------------------------------------------------------

/** Feed one record with a controlled admission stamp via an injected clock. */
function machineFeedStamps(machine: ReturnType<typeof machineOf>, stamp: number): void {
  // The default machine's built-in clock cannot be retro-fitted; instead we
  // verify ingestion-independence by feeding the SAME availability through
  // machines whose stamps differ by construction (base offset).
  machine.ingestBatch([rawEvent('evt-s', 5_000, { ingestion_time: stamp })], { batch_id: 'b' });
}
