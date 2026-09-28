// The PointInTimeCursor behavioral suite (acceptance criterion 6):
// resumable positions, monotone advance, delta semantics under late arrivals
// and lagging consumers, fork/replay determinism, bound-selector streams.

import { describe, expect, it } from 'vitest';
import { drainAt, forkCursor, idsOf, machineOf, openCursor, rawEvent, viewAt } from './fixtures';
import { feed } from './fixtures';

describe('cursor lifecycle', () => {
  it('opens deterministic opaque cursors (start and tip origins)', () => {
    const machine = machineOf();
    feed(machine, [rawEvent('evt-1', 1_000)], 'batch-1');

    const start = openCursor(machine);
    expect(start.cursor_id).toBe('cur-00000001');
    expect(start.position).toBe(0);
    expect(start.last_drain_at).toBeNull();
    expect(start.dataset).toBe(machine.dataset);

    const tip = openCursor(machine, undefined, 'tip');
    expect(tip.cursor_id).toBe('cur-00000002');
    expect(tip.position).toBe(1); // the live edge (one record already admitted)

    const invalid = machine.openCursor({ from: 'middle' as never });
    expect(invalid.ok).toBe(false);
    if (invalid.ok) return;
    expect(invalid.error.code).toBe('invalid_cursor');

    const badSelector = machine.openCursor({ selector: { availableFrom: 10 as never, availableTo: 5 as never } });
    expect(badSelector.ok).toBe(false);
  });

  it('typed unknown_cursor for foreign ids; live cursor views are consistent', () => {
    const machine = machineOf();
    const missing = machine.getCursor('cur-99999999' as never);
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.error.code).toBe('unknown_cursor');

    const cursor = openCursor(machine);
    expect(machine.getCursor(cursor.cursor_id).ok).toBe(true);
    expect(machine.cursors()).toHaveLength(1);
    expect(machine.cursors()[0]?.cursor_id).toBe(cursor.cursor_id);
  });

  it('drain validates the instant with a typed invalid_query', () => {
    const machine = machineOf();
    const cursor = openCursor(machine);
    const result = machine.drainCursor(cursor.cursor_id, -1 as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid_query');
  });
});

describe('cursor delta semantics', () => {
  it('delivers newly visible records once, in (available_time, record_id) order', () => {
    const machine = machineOf();
    const cursor = openCursor(machine);
    feed(machine, [rawEvent('evt-b', 2_000), rawEvent('evt-a', 1_000), rawEvent('evt-c', 3_000)], 'batch-1');

    const first = drainAt(machine, cursor.cursor_id, 1_500);
    expect(idsOf(first.records)).toEqual(['evt-a']);
    expect(first.position).toBe(3);
    expect(first.advanced).toBe(true);

    const second = drainAt(machine, cursor.cursor_id, 3_000);
    expect(idsOf(second.records)).toEqual(['evt-b', 'evt-c']);
    expect(second.position).toBe(3);
    expect(second.advanced).toBe(false);

    const third = drainAt(machine, cursor.cursor_id, 3_000);
    expect(third.records).toHaveLength(0); // nothing new — no re-delivery
  });

  it('a LAGGING consumer (T behind the frontier) still gets everything when its T catches up', () => {
    const machine = machineOf();
    const cursor = openCursor(machine);
    // Arrival order: avail 5_000 first, then a late 1_000 — visibility is NOT
    // monotone in arrival order; the cursor must not skip either record.
    feed(machine, [rawEvent('evt-new', 5_000)], 'batch-1');
    feed(machine, [rawEvent('evt-late', 1_000)], 'batch-2');

    const drainLow = drainAt(machine, cursor.cursor_id, 2_000);
    expect(idsOf(drainLow.records)).toEqual(['evt-late']);

    const drainHigh = drainAt(machine, cursor.cursor_id, 5_000);
    expect(idsOf(drainHigh.records)).toEqual(['evt-new']);
  });

  it('records that become visible BETWEEN drains are delivered at the later drain (no misses)', () => {
    const machine = machineOf();
    const cursor = openCursor(machine);
    feed(machine, [rawEvent('evt-future', 10_000), rawEvent('evt-now', 2_000)], 'batch-1');

    // First drain at a low T: the future record is scanned but not visible.
    const first = drainAt(machine, cursor.cursor_id, 3_000);
    expect(idsOf(first.records)).toEqual(['evt-now']);
    expect(first.position).toBe(2);

    // No new arrivals — but evt-future crossed the boundary since lastT.
    const second = drainAt(machine, cursor.cursor_id, 10_000);
    expect(idsOf(second.records)).toEqual(['evt-future']);
  });

  it('late arrivals AFTER a drain are delivered on the next drain (arrival-since-position)', () => {
    const machine = machineOf({ lateArrival: 'recompute' });
    feed(machine, [rawEvent('evt-1', 10_000)], 'batch-1');
    const cursor = openCursor(machine);
    drainAt(machine, cursor.cursor_id, 10_000);

    // A late record arrives with availability BELOW the last drain instant.
    feed(machine, [rawEvent('evt-late', 5_000)], 'batch-2');
    const drain = drainAt(machine, cursor.cursor_id, 10_000);
    expect(idsOf(drain.records)).toEqual(['evt-late']);
  });

  it('draining at a LOWER instant than before never regresses the position (monotone)', () => {
    const machine = machineOf();
    const cursor = openCursor(machine);
    feed(machine, [rawEvent('evt-1', 5_000), rawEvent('evt-2', 6_000)], 'batch-1');

    const high = drainAt(machine, cursor.cursor_id, 6_000);
    expect(high.position).toBe(2);
    const low = drainAt(machine, cursor.cursor_id, 1_000);
    expect(low.records).toHaveLength(0);
    expect(low.position).toBe(2);
    expect(low.advanced).toBe(false);

    const live = machine.getCursor(cursor.cursor_id);
    expect(live.ok).toBe(true);
    if (!live.ok) return;
    expect(live.value.position).toBe(2);
    expect(live.value.last_drain_at).toBe(1_000);
    expect(live.value.drains).toBe(2);
    expect(live.value.delivered).toBe(2);
  });

  it('a tip cursor delivers ONLY post-tip arrivals on its first drain', () => {
    const machine = machineOf();
    feed(machine, [rawEvent('evt-1', 1_000)], 'batch-1');
    const tip = openCursor(machine, undefined, 'tip');
    feed(machine, [rawEvent('evt-2', 2_000)], 'batch-2');

    const first = drainAt(machine, tip.cursor_id, 10_000);
    expect(idsOf(first.records)).toEqual(['evt-2']);
    // The pre-tip record is never delivered to this consumer.
    const second = drainAt(machine, tip.cursor_id, 10_000);
    expect(second.records).toHaveLength(0);
  });

  it('a start cursor replays the whole retained window on its first drain', () => {
    const machine = machineOf();
    feed(machine, [rawEvent('evt-1', 1_000), rawEvent('evt-2', 2_000)], 'batch-1');
    const start = openCursor(machine);
    const first = drainAt(machine, start.cursor_id, 10_000);
    expect(idsOf(first.records)).toEqual(['evt-1', 'evt-2']);
  });

  it('the bound selector shapes the stream (records outside it are not delivered)', () => {
    const machine = machineOf();
    const scoped = openCursor(machine, { ids: ['evt-a', 'evt-c'] });
    feed(machine, [rawEvent('evt-a', 1_000), rawEvent('evt-b', 2_000), rawEvent('evt-c', 3_000)], 'batch-1');
    const drain = drainAt(machine, scoped.cursor_id, 10_000);
    expect(idsOf(drain.records)).toEqual(['evt-a', 'evt-c']);
    // The selector is visible on the cursor's live view.
    const live = machine.getCursor(scoped.cursor_id);
    expect(live.ok).toBe(true);
    if (!live.ok) return;
    expect(live.value.selector.ids).toEqual(['evt-a', 'evt-c']);
  });

  it('every drain is firewall-passed: the audit log rides along', () => {
    const machine = machineOf();
    const cursor = openCursor(machine);
    feed(machine, [rawEvent('evt-1', 5_000)], 'batch-1');
    const drain = drainAt(machine, cursor.cursor_id, 4_999);
    expect(drain.records).toHaveLength(0);
    expect(drain.audit.at).toBe(4_999);
    expect(drain.audit.decisions[0]?.reason).toBe('not_yet_available');
  });
});

describe('fork / replay-from-cursor determinism', () => {
  it('a fork inherits the delta anchors and produces the IDENTICAL subsequent stream', () => {
    const machine = machineOf();
    feed(machine, [rawEvent('evt-1', 5_000), rawEvent('evt-2', 8_000)], 'batch-1');
    const original = openCursor(machine);
    drainAt(machine, original.cursor_id, 6_000); // delivers evt-1; lastT 6_000

    const fork = forkCursor(machine, original.cursor_id);
    expect(fork.cursor_id).not.toBe(original.cursor_id);
    // The fork copies the ORIGINAL's LIVE position (not the stale openCursor view).
    const liveOriginal = machine.getCursor(original.cursor_id);
    expect(liveOriginal.ok).toBe(true);
    if (!liveOriginal.ok) return;
    expect(fork.position).toBe(liveOriginal.value.position);
    expect(fork.last_drain_at).toBe(6_000);

    // Identical subsequent feeds and drains -> identical streams.
    feed(machine, [rawEvent('evt-late', 4_000), rawEvent('evt-3', 12_000)], 'batch-2');
    const originalStream = [
      drainAt(machine, original.cursor_id, 10_000),
      drainAt(machine, original.cursor_id, 12_000),
    ];
    const forkStream = [drainAt(machine, fork.cursor_id, 10_000), drainAt(machine, fork.cursor_id, 12_000)];
    expect(originalStream.map((drain) => idsOf(drain.records))).toEqual(
      forkStream.map((drain) => idsOf(drain.records)),
    );
    expect(originalStream.map((drain) => idsOf(drain.records))).toEqual([['evt-late', 'evt-2'], ['evt-3']]);
    // The fork's counters are its own (a fresh consumer).
    const forkLive = machine.getCursor(fork.cursor_id);
    expect(forkLive.ok && forkLive.value.drains).toBe(2);
  });

  it('forking a foreign cursor is a typed unknown_cursor', () => {
    const machine = machineOf();
    const result = machine.forkCursor('cur-00000042' as never);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unknown_cursor');
  });
});

describe('cursor + rolling window interaction', () => {
  it('records evicted before a drain are not delivered (the rolling contract)', () => {
    const machine = machineOf({ horizonMs: 1_000 });
    feed(machine, [rawEvent('evt-old', 1_000)], 'batch-1');
    const cursor = openCursor(machine);
    // The frontier jumps: evt-old (1_000 < floor 4_000) is evicted before the drain.
    feed(machine, [rawEvent('evt-new', 5_000)], 'batch-2');
    const drain = drainAt(machine, cursor.cursor_id, 5_000);
    expect(idsOf(drain.records)).toEqual(['evt-new']);
    // The view at 1_000 cannot resurrect it either.
    expect(idsOf(viewAt(machine, 1_000).records)).toEqual([]);
  });

  it('a healthy consumer that keeps up sees the full stream', () => {
    const machine = machineOf({ horizonMs: 1_000_000 });
    const cursor = openCursor(machine);
    const expected: string[] = [];
    for (let step = 0; step < 10; step++) {
      const id = `evt-${step}`;
      expected.push(id);
      feed(machine, [rawEvent(id, 10_000 + step * 1_000)], `batch-${step}`);
      const drain = drainAt(machine, cursor.cursor_id, 10_000 + step * 1_000);
      expect(idsOf(drain.records)).toEqual([id]);
    }
    // The whole stream, exactly once each.
    const total = machine.getCursor(cursor.cursor_id);
    expect(total.ok && total.value.delivered).toBe(10);
  });
});
