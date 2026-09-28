/**
 * @tradrl/event-store behavioral suite (lives with the plane's contract
 * package so it runs inside the frozen `pnpm verify` gate — see
 * packages/provenance/README.md).
 *
 * Append-only (structural + runtime), quartet faithfulness (ingestion
 * stamped at commit, never earlier), sequence discipline (T004 fixture
 * shapes), duplicate ids, lineage (cyclic rejected; 3-deep resolved),
 * derived-availability enforcement, point-in-time window boundaries on
 * available_time (inclusive, never event_time), corrections (append-only,
 * never rewrite), determinism (two stores deep-equal; commit-log replay
 * rebuilds identical state) and atomicity.
 */

import { describe, expect, it } from 'vitest';

import {
  commitIdFor,
  createDeterministicCommitClock,
  createEventStore,
  replayCommitLog,
  type CommitLogEntry,
  type EventStore,
  type StorableEvent,
  type StoredEvent,
} from '../../../services/event-store/src/index';
import { chainDepth, resolveRoots, type ChainNode } from './index';
import { requireTimestampMs } from '../../time-engine/src/index';

function ts(n: number): ReturnType<typeof requireTimestampMs> {
  return requireTimestampMs(n);
}

// ---------------------------------------------------------------------------
// TYPE-LEVEL APPEND-ONLY TRIP WIRE (acceptance 3, structural half).
// ---------------------------------------------------------------------------

/** The store's public surface must contain no history-mutating method. */
type StoreSurface = keyof EventStore;
type ForbiddenMutators = Extract<
  StoreSurface,
  | 'update' | 'delete' | 'remove' | 'patch' | 'replace' | 'amend' | 'mutate'
  | 'rewrite' | 'edit' | 'put' | 'set' | 'reset' | 'clear' | 'truncate'
  | 'insert' | 'push' | 'pop' | 'splice' | 'shift' | 'unshift' | 'reverse' | 'sort'
>;
type AssertNever<T extends never> = T;
// Compiles iff no forbidden mutator name exists on the store surface.
type NoMutatingSurface = AssertNever<ForbiddenMutators>;
const appendOnlyWitness: NoMutatingSurface = undefined as never;
void appendOnlyWitness;

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

let counter = 0;

interface TradeOverrides {
  id?: string;
  sequence?: number;
  eventTime?: number;
  availableTime?: number;
  venue?: string;
  instrument?: string;
  event_type?: StorableEvent['event_type'];
  payload?: object;
  provenance?: StorableEvent['provenance'];
  ingestionTime?: number;
}

function trade(overrides: TradeOverrides = {}): StorableEvent {
  counter += 1;
  return {
    event_id: overrides.id ?? `evt-${String(counter).padStart(6, '0')}`,
    venue: overrides.venue ?? 'BINANCE',
    instrument: overrides.instrument ?? 'BTC-USDT',
    asset_class: 'crypto',
    event_type: overrides.event_type ?? 'trade',
    event_time: ts(overrides.eventTime ?? 1_000 + counter),
    source_time: ts(overrides.eventTime ?? 1_000 + counter),
    available_time: ts(overrides.availableTime ?? 1_050 + counter),
    // ADVISORY on input — the store re-stamps at commit.
    ingestion_time: ts(overrides.ingestionTime ?? 1_200 + counter),
    sequence: overrides.sequence ?? 1,
    provider: 'binance',
    provenance:
      overrides.provenance ?? {
        origin: 'historical',
        adapter: { id: 'binance-adapter', version: '1.4.0' },
        derived_from: [],
        transform: null,
      },
    payload: overrides.payload ?? { price: '43125.10', size: '0.017', side: 'buy' },
  };
}

function newsEvent(id: string, sequence: number, eventTime: number, availableTime: number): StorableEvent {
  return {
    event_id: id,
    venue: 'SYNTH',
    instrument: 'BTC-USDT',
    asset_class: 'crypto',
    event_type: 'news',
    event_time: ts(eventTime),
    source_time: null,
    available_time: ts(availableTime),
    ingestion_time: ts(availableTime + 25),
    sequence,
    provider: 'synthetic',
    provenance: {
      origin: 'historical',
      adapter: { id: 'synthetic-news-adapter', version: '1.0.0' },
      derived_from: [],
      transform: null,
    },
    payload: { headline: `headline ${id}`, symbols: ['BTC-USDT'], source: 'synthetic-wire' },
  };
}

function freshStore(base = 10_000): EventStore {
  return createEventStore({ clock: createDeterministicCommitClock(base, 1) });
}

function commitOk(store: EventStore, events: readonly StorableEvent[], batchId: string) {
  const result = store.commit(events, { batch_id: batchId });
  if (!result.ok) throw new Error(`fixture commit must succeed: ${JSON.stringify(result.rejection)}`);
  return result.receipt;
}

// ---------------------------------------------------------------------------
// Append-only.
// ---------------------------------------------------------------------------

describe('append-only (acceptance 3)', () => {
  it('the public surface exposes no mutating method (compile-time trip wire above)', () => {
    const store = freshStore();
    const surface: string[] = Object.keys(store);
    for (const forbidden of ['update', 'delete', 'remove', 'patch', 'replace', 'amend', 'rewrite', 'edit']) {
      expect(surface).not.toContain(forbidden);
    }
    expect(surface).toContain('commit');
    expect(surface).toContain('appendCorrections');
  });

  it('stored events are deep-frozen; mutation attempts throw', () => {
    const store = freshStore();
    commitOk(store, [trade({ id: 'evt-frozen-1', sequence: 1 })], 'b-frozen');
    const stored = store.getEvent('evt-frozen-1');
    expect(stored).not.toBeNull();
    const writable = stored as unknown as { payload: { price: string } };
    expect(() => {
      writable.payload.price = '0';
    }).toThrow(TypeError);
    expect(Object.isFrozen(stored?.provenance.custody)).toBe(true);
  });

  it('a REJECTED commit changes nothing (atomic all-or-nothing)', () => {
    const store = freshStore();
    commitOk(store, [trade({ id: 'evt-atomic-1', sequence: 1 })], 'b-atomic-1');
    const before = store.snapshot();
    const bad = [trade({ id: 'evt-atomic-2', sequence: 2 }), trade({ id: 'evt-atomic-3', sequence: 2 })];
    const result = store.commit(bad, { batch_id: 'b-atomic-2' });
    expect(result.ok).toBe(false);
    expect(store.snapshot()).toEqual(before);
    expect(store.getEvent('evt-atomic-2')).toBeNull();
    expect(store.stats().commits).toBe(1);
  });

  it('corrections never rewrite the corrected event', () => {
    const store = freshStore();
    commitOk(store, [trade({ id: 'evt-cor-1', sequence: 1 })], 'b-cor-1');
    const before = store.getEvent('evt-cor-1');
    const corrected = store.appendCorrections(
      [{ correction_id: 'fix-1', corrected_event_id: 'evt-cor-1', reason: 'restatement', amendment: { price: '43126.00' } }],
      { batch_id: 'b-cor-2' },
    );
    expect(corrected.ok).toBe(true);
    expect(store.getEvent('evt-cor-1')).toEqual(before);
    expect(store.query({})).toEqual([before]);
  });
});

// ---------------------------------------------------------------------------
// Quartet faithfulness (acceptance 4).
// ---------------------------------------------------------------------------

describe('quartet faithfulness (acceptance 4)', () => {
  it('event_time/source_time/available_time survive EXACTLY; ingestion_time is the commit stamp, not earlier', () => {
    const store = freshStore(10_000);
    const input = trade({
      id: 'evt-quartet-1',
      sequence: 1,
      eventTime: 1_000,
      availableTime: 1_050,
      ingestionTime: 999, // early advisory input — must NOT survive
    });
    const receipt = commitOk(store, [input], 'b-quartet-1');
    const stored = store.getEvent('evt-quartet-1');
    expect(stored).not.toBeNull();
    expect(stored?.event_time).toBe(1_000);
    expect(stored?.source_time).toBe(1_000);
    expect(stored?.available_time).toBe(1_050);
    expect(stored?.ingestion_time).toBe(10_000);
    expect(stored?.ingestion_time).not.toBe(999);
    expect(receipt.ingestion_times).toEqual([10_000]);
    expect(receipt.committed_event_ids).toEqual(['evt-quartet-1']);
    expect(stored?.provenance.custody.commit.ingestion_time).toBe(10_000);
  });

  it('a null source_time survives exactly; ingestion stamps advance per event, position-aligned', () => {
    const store = freshStore(20_000);
    const receipt = commitOk(
      store,
      [
        newsEvent('evt-quartet-2', 1, 5_000, 5_100),
        newsEvent('evt-quartet-3', 2, 5_200, 5_300),
        trade({ id: 'evt-quartet-4', sequence: 1, eventTime: 5_400, availableTime: 5_500, ingestionTime: 1 }),
      ],
      'b-quartet-2',
    );
    expect(store.getEvent('evt-quartet-2')?.source_time).toBeNull();
    expect(receipt.ingestion_times).toEqual([20_000, 20_001, 20_002]);
    expect(store.getEvent('evt-quartet-3')?.ingestion_time).toBe(20_001);
    expect(store.getEvent('evt-quartet-4')?.ingestion_time).toBe(20_002);
  });

  it('custody is stamped at commit: adapter from the input provenance, batch from batchMeta', () => {
    const store = freshStore();
    commitOk(store, [trade({ id: 'evt-custody-1', sequence: 1 })], 'b-custody-1');
    const stored = store.getEvent('evt-custody-1');
    expect(stored?.provenance.custody.adapter).toEqual({ id: 'binance-adapter', version: '1.4.0' });
    expect(stored?.provenance.custody.batch.batch_id).toBe('b-custody-1');
    expect(stored?.provenance.custody.commit.commit_id).toBe(commitIdFor(1));
    expect(stored?.provenance.custody.commit.commit_sequence).toBe(1);
  });

  it('available_time regressed below event_time is rejected with a typed timestamp_order error', () => {
    const store = freshStore();
    const result = store.commit([trade({ id: 'evt-bad-quartet', sequence: 1, eventTime: 2_000, availableTime: 1_500 })], {
      batch_id: 'b-bad-quartet',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const error = result.rejection.errors[0];
      expect(error?.code).toBe('invalid_event');
      expect(error?.details.some((detail) => detail.code === 'timestamp_order')).toBe(true);
    }
  });

  it('a missing available_time is a typed missing_field (the quartet stays complete)', () => {
    const store = freshStore();
    const broken = { ...trade({ id: 'evt-missing-quartet', sequence: 1 }) };
    delete (broken as { available_time?: number }).available_time;
    const result = store.commit([broken], { batch_id: 'b-missing-quartet' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.errors[0]?.details.some((detail) => detail.code === 'missing_field' && detail.path === 'available_time')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Sequence discipline (acceptance 5, T004 fixture shapes).
// ---------------------------------------------------------------------------

describe('sequence discipline (acceptance 5)', () => {
  it('rejects a duplicate sequence within one batch (T004 fixture shape 1, 2, 2)', () => {
    const store = freshStore();
    const result = store.commit(
      [trade({ sequence: 1 }), trade({ sequence: 2 }), trade({ sequence: 2 })],
      { batch_id: 'b-seq-dup' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const violation = result.rejection.errors.find((error) => error.code === 'sequence_violation');
      expect(violation).toBeDefined();
      expect(violation?.message).toContain('duplicate_sequence');
      expect(violation?.message).toContain('BINANCE|BTC-USDT|trade');
    }
  });

  it('rejects a regressed sequence within one batch (T004 fixture shape 5, 6, 4)', () => {
    const store = freshStore();
    const result = store.commit(
      [trade({ sequence: 5 }), trade({ sequence: 6 }), trade({ sequence: 4 })],
      { batch_id: 'b-seq-reg' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const violation = result.rejection.errors.find((error) => error.code === 'sequence_violation');
      expect(violation?.message).toContain('regressed_sequence');
    }
  });

  it('gaps are fine; streams are independent across venue/instrument/event type', () => {
    const store = freshStore();
    const events = [
      trade({ sequence: 1, venue: 'BINANCE', instrument: 'BTC-USDT' }),
      trade({ sequence: 1, venue: 'COINBASE', instrument: 'BTC-USD' }),
      trade({ sequence: 2, venue: 'BINANCE', instrument: 'ETH-USDT' }),
      newsEvent('evt-seq-news-1', 1, 1_000, 1_100), // different stream (news)
      trade({ sequence: 5, venue: 'BINANCE', instrument: 'BTC-USDT' }), // gap is fine
    ];
    expect(store.commit(events, { batch_id: 'b-seq-ok' }).ok).toBe(true);
  });

  it('other-events scope their stream by payload kind (same kind collides, different kinds do not)', () => {
    const differentKinds = freshStore();
    expect(
      differentKinds
        .commit(
          [
            trade({ sequence: 1, event_type: 'other', payload: { kind: 'liquidation', data: {} } }),
            trade({ sequence: 1, event_type: 'other', payload: { kind: 'funding_rate', data: {} } }),
          ],
          { batch_id: 'b-other-1' },
        )
        .ok,
    ).toBe(true);

    const sameKind = freshStore();
    const result = sameKind.commit(
      [
        trade({ sequence: 1, event_type: 'other', payload: { kind: 'liquidation', data: {} } }),
        trade({ sequence: 1, event_type: 'other', payload: { kind: 'liquidation', data: {} } }),
      ],
      { batch_id: 'b-other-2' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const violation = result.rejection.errors.find((error) => error.code === 'sequence_violation');
      expect(violation?.message).toContain('other:liquidation');
    }
  });

  it('rejects duplicates/regressions against COMMITTED state across batches', () => {
    const store = freshStore();
    commitOk(store, [trade({ sequence: 1 }), trade({ sequence: 2 })], 'b-cross-1');

    const duplicate = store.commit([trade({ sequence: 2 })], { batch_id: 'b-cross-2' });
    expect(duplicate.ok).toBe(false);

    const regressed = store.commit([trade({ sequence: 1 })], { batch_id: 'b-cross-3' });
    expect(regressed.ok).toBe(false);

    expect(store.commit([trade({ sequence: 3 })], { batch_id: 'b-cross-4' }).ok).toBe(true);
  });

  it('sequence 0: the first event of a stream is legal, a second 0 is a duplicate', () => {
    const store = freshStore();
    expect(store.commit([trade({ sequence: 0, venue: 'ZERO' })], { batch_id: 'b-zero-1' }).ok).toBe(true);
    const result = store.commit([trade({ sequence: 0, venue: 'ZERO' })], { batch_id: 'b-zero-2' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.errors.some((error) => error.code === 'sequence_violation')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Duplicate ids, empty commits, batch meta.
// ---------------------------------------------------------------------------

describe('duplicate event ids and batch guards', () => {
  it('rejects duplicate ids within one batch', () => {
    const store = freshStore();
    const result = store.commit([trade({ id: 'evt-dup-1', sequence: 1 }), trade({ id: 'evt-dup-1', sequence: 2 })], {
      batch_id: 'b-dup-1',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.errors.some((error) => error.code === 'duplicate_event_id')).toBe(true);
    }
  });

  it('rejects ids already committed', () => {
    const store = freshStore();
    commitOk(store, [trade({ id: 'evt-dup-2', sequence: 1 })], 'b-dup-2');
    const result = store.commit([trade({ id: 'evt-dup-2', sequence: 2 })], { batch_id: 'b-dup-3' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.errors[0]?.code).toBe('duplicate_event_id');
    }
  });

  it('rejects empty commits and malformed batch meta', () => {
    const store = freshStore();
    const empty = store.commit([], { batch_id: 'b-empty' });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.rejection.errors[0]?.code).toBe('empty_commit');

    const badMeta = store.commit([trade({ sequence: 1 })], { batch_id: '' });
    expect(badMeta.ok).toBe(false);
    if (!badMeta.ok) expect(badMeta.rejection.errors[0]?.code).toBe('invalid_batch_meta');
  });
});

// ---------------------------------------------------------------------------
// Lineage (acceptance 6).
// ---------------------------------------------------------------------------

describe('lineage (acceptance 6)', () => {
  function derived(id: string, sequence: number, availableTime: number, parents: readonly string[]): StorableEvent {
    return trade({
      id,
      sequence,
      eventTime: availableTime - 50,
      availableTime,
      provenance: {
        origin: 'historical',
        adapter: { id: 'feature-adapter', version: '0.2.0' },
        derived_from: parents,
        transform: 'vwap-1m-aggregator',
      },
    });
  }

  it('a derived event whose chain would be CYCLIC is rejected', () => {
    const store = freshStore();
    // A is already committed and derives from B (dangling parent — allowed).
    commitOk(store, [derived('evt-cyc-a', 1, 1_100, ['evt-cyc-b'])], 'b-cyc-1');
    // Now B arrives deriving from A: A -> B -> A is a cycle.
    const result = store.commit([derived('evt-cyc-b', 2, 1_200, ['evt-cyc-a'])], { batch_id: 'b-cyc-2' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.errors[0]?.code).toBe('lineage_cycle');
    }
  });

  it('a batch-internal cycle is rejected atomically', () => {
    const store = freshStore();
    const result = store.commit(
      [derived('evt-cyc-c', 1, 1_100, ['evt-cyc-d']), derived('evt-cyc-d', 2, 1_200, ['evt-cyc-c'])],
      { batch_id: 'b-cyc-3' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.errors.some((error) => error.code === 'lineage_cycle')).toBe(true);
    }
  });

  it('a 3-deep chain resolves to its roots; depth counts derivation edges', () => {
    const store = freshStore();
    commitOk(
      store,
      [
        trade({ id: 'n-r', sequence: 1, eventTime: 100, availableTime: 100 }),
        derived('n-e1', 2, 150, ['n-r']),
        derived('n-e2', 3, 200, ['n-e1']),
        derived('n-e3', 4, 250, ['n-e2']),
      ],
      'b-chain-1',
    );
    const view = store.lineageOf('n-e3');
    expect(view).not.toBeNull();
    expect(view?.depth).toBe(3);
    expect(view?.roots).toEqual(['n-r']);
    expect(view?.ancestors).toEqual(['n-e1', 'n-e2', 'n-r']);
    expect(view?.external_parents).toEqual([]);
    expect(store.lineageOf('n-r')?.depth).toBe(0);
    expect(store.lineageOf('missing')).toBeNull();

    // Parity with the provenance package's chain queries over the same graph.
    const nodes: ChainNode[] = store.events().map((event) => ({ id: event.event_id, derived_from: event.provenance.derived_from }));
    expect(chainDepth('n-e3', nodes)).toEqual({ ok: true, value: view?.depth ?? -1 });
    expect(resolveRoots('n-e3', nodes)).toEqual({ ok: true, value: view?.roots ?? [] });
  });

  it('dangling parents are external roots (reported, not rejected)', () => {
    const store = freshStore();
    commitOk(store, [derived('n-x', 1, 1_100, ['ext-1', 'ext-2'])], 'b-chain-2');
    const view = store.lineageOf('n-x');
    expect(view?.depth).toBe(1);
    expect(view?.roots).toEqual(['ext-1', 'ext-2']);
    expect(view?.external_parents).toEqual(['ext-1', 'ext-2']);
    expect(view?.ancestors).toEqual(['ext-1', 'ext-2']);
  });

  it('a derived event available BEFORE its in-store parent is rejected (derived_before_inputs)', () => {
    const store = freshStore();
    commitOk(store, [trade({ id: 'evt-par-1', sequence: 1, eventTime: 1_900, availableTime: 2_000 })], 'b-par-1');
    const early = derived('evt-early', 2, 1_500, ['evt-par-1']);
    const result = store.commit([early], { batch_id: 'b-par-2' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.rejection.errors[0]?.code).toBe('derived_before_inputs');
    }
    // At/after the parent's availability is accepted.
    const onTime = derived('evt-ontime', 3, 2_000, ['evt-par-1']);
    expect(store.commit([onTime], { batch_id: 'b-par-3' }).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Point-in-time queries (acceptance 10).
// ---------------------------------------------------------------------------

describe('point-in-time window queries (acceptance 10)', () => {
  function windowStore(): EventStore {
    const store = freshStore();
    commitOk(
      store,
      [
        trade({ id: 'w-a', sequence: 1, eventTime: 100, availableTime: 200 }),
        trade({ id: 'w-b', sequence: 2, eventTime: 220, availableTime: 120 }),
        trade({ id: 'w-c', sequence: 3, eventTime: 100, availableTime: 150 }),
        trade({ id: 'w-d', sequence: 4, eventTime: 100, availableTime: 250 }),
        trade({ id: 'w-e', sequence: 5, eventTime: 100, availableTime: 149 }),
        trade({ id: 'w-f', sequence: 6, eventTime: 100, availableTime: 251 }),
        newsEvent('w-n', 1, 100, 200),
      ],
      'b-window',
    );
    return store;
  }

  it('filters on available_time with INCLUSIVE bounds — tested at the exact boundary', () => {
    const store = windowStore();
    const ids = store.query({ from: 150, to: 250 }).map((event) => event.event_id);
    // 150 (w-c) and 250 (w-d) are IN; 149 and 251 are OUT.
    expect(ids).toEqual(['w-c', 'w-a', 'w-d']);
  });

  it('never filters on event_time: an event INSIDE the window by event_time but OUTSIDE by available_time is excluded', () => {
    const store = windowStore();
    const ids = store.query({ from: 150, to: 250 }).map((event) => event.event_id);
    expect(ids).not.toContain('w-b'); // event_time 220 in window; available_time 120 out
  });

  it('half-open windows and unbounded ends', () => {
    const store = windowStore();
    expect(store.query({ from: 200 }).map((event) => event.event_id)).toEqual(['w-a', 'w-n', 'w-d', 'w-f']);
    expect(store.query({ to: 150 }).map((event) => event.event_id)).toEqual(['w-b', 'w-e', 'w-c']);
    expect(store.query({}).length).toBe(7);
  });

  it('venue/instrument/event_type filters combine with the window', () => {
    const store = windowStore();
    expect(store.query({ instrument: 'BTC-USDT', event_type: 'news', from: 150, to: 250 }).map((e) => e.event_id)).toEqual(['w-n']);
    expect(store.query({ venue: 'BINANCE', from: 150, to: 250 }).map((e) => e.event_id)).toEqual(['w-c', 'w-a', 'w-d']);
  });

  it('results are sorted by (available_time, event_id) — deterministic', () => {
    const store = windowStore();
    const results = store.query({});
    for (let i = 1; i < results.length; i++) {
      const previous = results[i - 1] as StoredEvent;
      const current = results[i] as StoredEvent;
      expect(previous.available_time <= current.available_time).toBe(true);
      if (previous.available_time === current.available_time) {
        expect(previous.event_id < current.event_id).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Corrections.
// ---------------------------------------------------------------------------

describe('corrections (append-only amendments)', () => {
  it('appends corrections with receipts and custody; ids are unique; targets must exist', () => {
    const store = freshStore(30_000);
    commitOk(store, [trade({ id: 'evt-fix-1', sequence: 1 })], 'b-fix-1');

    const receipt = store.appendCorrections(
      [{ correction_id: 'fix-1', corrected_event_id: 'evt-fix-1', reason: 'restatement', amendment: { price: '43126.00' } }],
      { batch_id: 'b-fix-2' },
    );
    expect(receipt.ok).toBe(true);
    if (receipt.ok) {
      expect(receipt.receipt.commit_id).toBe(commitIdFor(2));
      expect(receipt.receipt.correction_ids).toEqual(['fix-1']);
    }
    const stored = store.corrections()[0];
    expect(stored?.custody.batch.batch_id).toBe('b-fix-2');
    expect(stored?.custody.commit.commit_sequence).toBe(2);
    expect(stored?.custody.commit.ingestion_time).toBe(30_000);

    const duplicateId = store.appendCorrections(
      [{ correction_id: 'fix-1', corrected_event_id: 'evt-fix-1', reason: 'again', amendment: {} }],
      { batch_id: 'b-fix-3' },
    );
    expect(duplicateId.ok).toBe(false);

    const missingTarget = store.appendCorrections(
      [{ correction_id: 'fix-2', corrected_event_id: 'evt-nope', reason: 'orphan', amendment: {} }],
      { batch_id: 'b-fix-4' },
    );
    expect(missingTarget.ok).toBe(false);
    if (!missingTarget.ok) {
      expect(missingTarget.rejection.errors[0]?.code).toBe('correction_target_not_found');
    }
  });

  it('latest correction status per event (view over the log, never a rewrite)', () => {
    const store = freshStore();
    commitOk(store, [trade({ id: 'evt-fix-2', sequence: 1 })], 'b-fix-5');
    expect(store.correctionStatus('evt-fix-2')).toEqual({
      event_id: 'evt-fix-2',
      status: 'uncorrected',
      count: 0,
      latest: null,
      history: [],
    });

    store.appendCorrections(
      [{ correction_id: 'fix-a', corrected_event_id: 'evt-fix-2', reason: 'first', amendment: { v: 1 } }],
      { batch_id: 'b-fix-6' },
    );
    store.appendCorrections(
      [{ correction_id: 'fix-b', corrected_event_id: 'evt-fix-2', reason: 'second', amendment: { v: 2 } }],
      { batch_id: 'b-fix-7' },
    );

    const status = store.correctionStatus('evt-fix-2');
    expect(status.status).toBe('corrected');
    expect(status.count).toBe(2);
    expect(status.latest?.correction_id).toBe('fix-b');
    expect(status.history.map((entry) => entry.correction_id)).toEqual(['fix-a', 'fix-b']);
  });

  it('the full provenance record materializes correction refs onto the view', () => {
    const store = freshStore();
    commitOk(store, [trade({ id: 'evt-fix-3', sequence: 1 })], 'b-fix-8');
    store.appendCorrections(
      [{ correction_id: 'fix-c', corrected_event_id: 'evt-fix-3', reason: 'why', amendment: { x: 1 } }],
      { batch_id: 'b-fix-9' },
    );
    const record = store.getProvenanceRecord('evt-fix-3');
    expect(record).not.toBeNull();
    expect(record?.origin).toBe('historical');
    expect(record?.adapter).toEqual({ id: 'binance-adapter', version: '1.4.0' });
    expect(record?.corrections).toEqual([{ correction_id: 'fix-c', reason: 'why' }]);
    expect(record?.custody.commit.commit_id).toBe(commitIdFor(1));
    expect(store.getProvenanceRecord('missing')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Determinism and replay (acceptance 8).
// ---------------------------------------------------------------------------

describe('determinism and replay (acceptance 8)', () => {
  const BATCHES: ReadonlyArray<readonly StorableEvent[]> = [
    [
      trade({ id: 'd-1', sequence: 1, eventTime: 1_000, availableTime: 1_050 }),
      trade({ id: 'd-2', sequence: 2, eventTime: 1_100, availableTime: 1_150 }),
    ],
    [
      newsEvent('d-3', 1, 2_000, 2_100),
      trade({ id: 'd-4', sequence: 3, eventTime: 2_200, availableTime: 2_250 }),
    ],
  ];
  const CORRECTIONS = [{ correction_id: 'd-fix-1', corrected_event_id: 'd-1', reason: 'r', amendment: { v: 1 } }];

  function filledStore(): EventStore {
    const store = createEventStore({ clock: createDeterministicCommitClock(50_000, 1) });
    commitOk(store, BATCHES[0] ?? [], 'd-batch-1');
    commitOk(store, BATCHES[1] ?? [], 'd-batch-2');
    const correction = store.appendCorrections(CORRECTIONS, { batch_id: 'd-batch-3' });
    if (!correction.ok) throw new Error('correction fixture must succeed');
    return store;
  }

  it('two stores fed the same batches (same order, same config) are deeply equal', () => {
    const a = filledStore();
    const b = filledStore();
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.commitLog()).toEqual(b.commitLog());
    expect(a.query({})).toEqual(b.query({}));
    expect(a.lineageOf('d-4')).toEqual(b.lineageOf('d-4'));
  });

  it('commit-log replay (through a JSON round trip) rebuilds IDENTICAL state', () => {
    const original = filledStore();
    const log = JSON.parse(JSON.stringify(original.commitLog())) as CommitLogEntry[];
    const replayed = replayCommitLog(log, { clock: createDeterministicCommitClock(60_000, 1) });
    expect(replayed.ok).toBe(true);
    if (replayed.ok) {
      expect(replayed.store.snapshot()).toEqual(original.snapshot());
      expect(replayed.store.commitLog()).toEqual(original.commitLog());
      expect(replayed.store.query({ from: 1_000, to: 2_500 })).toEqual(original.query({ from: 1_000, to: 2_500 }));
      expect(replayed.store.correctionStatus('d-1')).toEqual(original.correctionStatus('d-1'));
      expect(replayed.store.stats()).toEqual(original.stats());
    }
  });

  it('a tampered log is rejected with a typed error', () => {
    const original = filledStore();
    const log = JSON.parse(JSON.stringify(original.commitLog())) as CommitLogEntry[];

    // Tamper 1: duplicate an event id across entries.
    const dupLog = JSON.parse(JSON.stringify(log)) as CommitLogEntry[];
    const secondEntry = dupLog[1];
    if (secondEntry?.events !== undefined && secondEntry.events[0] !== undefined) {
      (secondEntry.events[0] as { event_id: string }).event_id = 'd-1';
      const replay = replayCommitLog(dupLog);
      expect(replay.ok).toBe(false);
      if (!replay.ok) expect(replay.error.code).toBe('replay_inconsistent');
    }

    // Tamper 2: break the ingestion stamp / custody consistency.
    const stampLog = JSON.parse(JSON.stringify(log)) as CommitLogEntry[];
    const firstEntry = stampLog[0];
    if (firstEntry?.events !== undefined && firstEntry.events[0] !== undefined) {
      (firstEntry.events[0] as { ingestion_time: number }).ingestion_time = 1;
      const replay = replayCommitLog(stampLog);
      expect(replay.ok).toBe(false);
    }

    // Tamper 3: malformed entry shape.
    const malformed = replayCommitLog([{ kind: 'nonsense' } as unknown as CommitLogEntry]);
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.error.code).toBe('replay_log_malformed');
  });

  it('an empty log replays to an empty store', () => {
    const replay = replayCommitLog([]);
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.store.stats()).toEqual({ events: 0, commits: 0, corrections: 0, streams: 0 });
  });
});

// ---------------------------------------------------------------------------
// Clock discipline.
// ---------------------------------------------------------------------------

describe('commit clock discipline', () => {
  it('a regressing clock throws (programming error) and the store state is unchanged', () => {
    const stamps = [100, 50];
    const store = createEventStore({ clock: { next: () => ts(stamps.shift() ?? 100) } });
    expect(() => {
      store.commit(
        [trade({ id: 'evt-clock-1', sequence: 1 }), trade({ id: 'evt-clock-2', sequence: 2 })],
        { batch_id: 'b-clock-1' },
      );
    }).toThrow(RangeError);
    expect(store.events().length).toBe(0);
    expect(store.snapshot().next_commit_sequence).toBe(1);
  });

  it('stats counts events, commits, corrections and streams', () => {
    const store = freshStore();
    commitOk(store, [trade({ sequence: 1 }), newsEvent('s-n', 1, 1_000, 1_100)], 'b-stats-1');
    expect(store.stats()).toEqual({ events: 2, commits: 1, corrections: 0, streams: 2 });
  });
});
