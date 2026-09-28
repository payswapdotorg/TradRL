/**
 * @tradrl/data-ingestion behavioral suite (lives with the plane's contract
 * package so it runs inside the frozen `pnpm verify` gate — see
 * packages/provenance/README.md).
 *
 * Pipeline happy paths over the two deterministic example adapters, the
 * exact-match dead-letter report (nothing silently dropped), quartet
 * faithfulness end-to-end (available_time preserved; ingestion_time
 * stamped by the store), embargo acceptance (L4), custody + lineage of
 * derived events through the pipeline, provider neutrality (a third
 * inline adapter), and whole-pipeline determinism.
 *
 * The wiring itself is the trip wire: the REAL `@tradrl/event-store`
 * `EventStore` satisfies the pipeline's structural `EventCommitPort`
 * with no package dependency (law D-004) — this file typechecks because
 * the mirrors agree.
 */

import { describe, expect, it } from 'vitest';

import {
  createEventStore,
  createDeterministicCommitClock,
  commitIdFor,
  type EventStore,
  type StorableEvent,
} from '../../../services/event-store/src/index';
import {
  createIngestionPipeline,
  createSyntheticNewsAdapter,
  createSyntheticTickAdapter,
  type DeadLetter,
  type IngestionPipeline,
  type ProviderAdapter,
} from '../../../services/data-ingestion/src/index';

function freshStore(base: number): EventStore {
  return createEventStore({ clock: createDeterministicCommitClock(base, 1) });
}

function unwrapReceipt(result: { receipt: unknown; events_committed: number }): number {
  return result.events_committed;
}
void unwrapReceipt;

describe('synthetic tick pipeline (happy path + DLQ exact match)', () => {
  function run(): { pipeline: IngestionPipeline<SyntheticTickRawShim>; store: EventStore } {
    const store = freshStore(50_000);
    const pipeline = createIngestionPipeline({
      adapter: createSyntheticTickAdapter(),
      store,
    });
    return { pipeline, store };
  }

  it('discovers three batches and commits 11 events across 3 receipts', () => {
    const { pipeline, store } = run();
    const summary = pipeline.ingestAll();
    expect(summary.batches.map((report) => report.batch_id)).toEqual([
      'tick-batch-001',
      'tick-batch-002',
      'tick-batch-003',
    ]);
    expect(summary.total_committed).toBe(11);
    expect(summary.receipts.map((receipt) => receipt.commit_id)).toEqual([
      commitIdFor(1),
      commitIdFor(2),
      commitIdFor(3),
    ]);
    expect(store.stats()).toEqual({ events: 11, commits: 3, corrections: 0, streams: 2 });
    expect(store.stats().streams).toBe(2); // trade + ohlcv streams
  });

  it('the DLQ report matches EXACTLY what was rejected (2 letters, typed reasons)', () => {
    const { pipeline } = run();
    pipeline.ingestAll();
    const report = pipeline.deadLetterReport();
    expect(report.total).toBe(2);
    expect(report.by_kind).toEqual({ normalization_error: 1, validation_error: 0, store_rejection: 1 });

    const letters = report.letters;
    const normalization = letters[0] as Extract<DeadLetter, { kind: 'normalization_error' }>;
    expect(normalization.kind).toBe('normalization_error');
    expect(normalization.batch_id).toBe('tick-batch-002');
    expect(normalization.adapter_id).toBe('synthetic-tick-adapter');
    expect(normalization.raw_id).toBe('002-3');
    expect(normalization.errors[0]?.code).toBe('invalid_price');

    const rejection = letters[1] as Extract<DeadLetter, { kind: 'store_rejection' }>;
    expect(rejection.kind).toBe('store_rejection');
    expect(rejection.batch_id).toBe('tick-batch-003');
    expect(rejection.event_id).toBe('tick-001-1'); // the re-delivered tick id
    expect(rejection.errors[0]?.code).toBe('duplicate_event_id');

    // The exact-match property: the DLQ contents are precisely the rejected
    // records — nothing else, in rejection order.
    expect(pipeline.deadLetters().map((letter) => letter.kind)).toEqual([
      'normalization_error',
      'store_rejection',
    ]);
  });

  it('quartet faithfulness end-to-end: available_time preserved EXACTLY; ingestion_time is the store stamp', () => {
    const { pipeline, store } = run();
    pipeline.ingestAll();
    const stored = store.getEvent('tick-001-1');
    expect(stored).not.toBeNull();
    // The adapter's raw record: trade_ts 1_000_000, recv_ts 1_000_050 (advisory ingest 1_000_075).
    expect(stored?.event_time).toBe(1_000_000);
    expect(stored?.source_time).toBe(1_000_000);
    expect(stored?.available_time).toBe(1_000_050);
    expect(stored?.ingestion_time).toBe(50_000); // commit stamp, NOT the advisory 1_000_075
  });

  it('custody and lineage of the derived vwap flow through the pipeline', () => {
    const { pipeline, store } = run();
    pipeline.ingestAll();
    const vwap = store.getEvent('vwap-vwap-003');
    expect(vwap).not.toBeNull();
    expect(vwap?.event_type).toBe('ohlcv');
    expect(vwap?.provenance.transform).toBe('vwap-1m-aggregator');
    expect(vwap?.provenance.derived_from).toEqual(['tick-003-1', 'tick-003-2', 'tick-003-3']);
    expect(vwap?.provenance.custody.adapter).toEqual({ id: 'synthetic-tick-adapter', version: '1.0.0' });
    expect(vwap?.provenance.custody.batch.batch_id).toBe('tick-batch-003');
    expect(vwap?.provenance.custody.commit.commit_id).toBe(commitIdFor(3));
    // Derived availability honored: the bar is available at the last
    // parent's availability + the 60s aggregation delay.
    expect(vwap?.available_time).toBe(3_000_250 + 60_000);

    const lineage = store.lineageOf('vwap-vwap-003');
    expect(lineage?.depth).toBe(1);
    expect(lineage?.roots).toEqual(['tick-003-1', 'tick-003-2', 'tick-003-3']);
  });

  it('an unknown batch id ingests nothing (empty report, no DLQ letters)', () => {
    const store = freshStore(50_000);
    const pipeline = createIngestionPipeline({ adapter: createSyntheticTickAdapter(), store });
    const report = pipeline.ingestBatch({ batch_id: 'no-such-batch' });
    expect(report.raw_records).toBe(0);
    expect(report.receipt).toBeNull();
    expect(report.events_committed).toBe(0);
    expect(pipeline.deadLetters()).toEqual([]);
  });
});

describe('synthetic news pipeline (L4 embargo + rejection paths)', () => {
  function run(): { pipeline: IngestionPipeline<ReturnType<typeof createSyntheticNewsAdapter> extends ProviderAdapter<infer R> ? R : never>; store: EventStore } {
    const store = freshStore(60_000);
    const pipeline = createIngestionPipeline({ adapter: createSyntheticNewsAdapter(), store });
    return { pipeline, store };
  }

  it('commits 3 events; the DLQ report matches EXACTLY the 3 rejected records with typed reasons', () => {
    const { pipeline, store } = run();
    const summary = pipeline.ingestAll();
    expect(summary.total_committed).toBe(3);
    expect(store.stats().events).toBe(3);

    const report = pipeline.deadLetterReport();
    expect(report.total).toBe(3);
    expect(report.by_kind).toEqual({ normalization_error: 1, validation_error: 2, store_rejection: 0 });

    const [n3, n4, n6] = report.letters as readonly [
      Extract<DeadLetter, { kind: 'normalization_error' }>,
      Extract<DeadLetter, { kind: 'validation_error' }>,
      Extract<DeadLetter, { kind: 'validation_error' }>,
    ];
    // n3: missing headline -> normalization error.
    expect(n3.raw_id).toBe('n3');
    expect(n3.errors[0]?.code).toBe('missing_headline');
    // n4: contradictory vendor clocks -> quartet validation error.
    expect(n4.event_id).toBe('news-n4');
    expect(n4.errors.some((error) => error.code === 'timestamp_order')).toBe(true);
    // n6: vendor sequence bug -> within-batch duplicate sequence.
    expect(n6.event_id).toBe('news-n6');
    expect(n6.errors.some((error) => error.code === 'sequence_violation')).toBe(true);
  });

  it('the EMBARGOED item is ingested (L4: ingest never rejects future availability)', () => {
    const { pipeline, store } = run();
    pipeline.ingestAll();
    const embargoed = store.getEvent('news-n2');
    expect(embargoed).not.toBeNull();
    expect(embargoed?.available_time).toBe(5_000_500 + 3_600_000);
    // Point-in-time: the embargoed item is invisible strictly before its release.
    expect(store.query({ to: 5_000_500 + 3_600_000 - 1 }).map((event) => event.event_id)).not.toContain('news-n2');
    expect(store.query({ from: 5_000_500 + 3_600_000 }).map((event) => event.event_id)).toContain('news-n2');
  });

  it('a null source_time survives the whole plane', () => {
    const { pipeline, store } = run();
    pipeline.ingestAll();
    expect(store.getEvent('news-n1')?.source_time).toBeNull();
  });
});

describe('provider neutrality (L13/L14)', () => {
  it('the pipeline works with ANY adapter — a third inline fixture', () => {
    interface InlineRaw {
      readonly p: number;
    }
    const inlineAdapter: ProviderAdapter<InlineRaw> = {
      descriptor: { id: 'inline-test-adapter', version: '0.1.0', provider: 'test' },
      discover: () => ({ batches: [{ batch_id: 'inline-batch-001', description: 'one synthetic print' }] }),
      fetch: () => ({ records: [{ p: 42 }] }),
      normalize: (raw: InlineRaw) => ({
        events: [
          {
            event_id: `inline-${raw.p}`,
            venue: 'TEST',
            instrument: 'TEST-USD',
            asset_class: 'other',
            event_type: 'other',
            event_time: 1_000,
            source_time: null,
            available_time: 1_050,
            ingestion_time: 1_100,
            sequence: 1,
            provider: 'test',
            provenance: {
              origin: 'simulated',
              adapter: { id: 'inline-test-adapter', version: '0.1.0' },
              derived_from: [],
              transform: null,
            },
            payload: { kind: 'inline-print', data: { p: raw.p } },
          },
        ],
        errors: [],
      }),
    };

    const store = freshStore(70_000);
    const pipeline = createIngestionPipeline({ adapter: inlineAdapter, store });
    const summary = pipeline.ingestAll();
    expect(summary.total_committed).toBe(1);
    expect(store.getEvent('inline-42')?.event_type).toBe('other');
    expect(pipeline.deadLetterReport().total).toBe(0);
  });
});

describe('whole-pipeline determinism (acceptance 8)', () => {
  it('two pipelines over fresh stores produce deeply-equal stores and equal DLQ reports', () => {
    const runTick = () => {
      const store = freshStore(80_000);
      const pipeline = createIngestionPipeline({ adapter: createSyntheticTickAdapter(), store });
      const summary = pipeline.ingestAll();
      return { snapshot: store.snapshot(), log: store.commitLog(), report: pipeline.deadLetterReport(), summary };
    };
    const a = runTick();
    const b = runTick();
    expect(a.snapshot).toEqual(b.snapshot);
    expect(a.log).toEqual(b.log);
    expect(a.report).toEqual(b.report);
    expect(a.summary.receipts).toEqual(b.summary.receipts);

    const runNews = () => {
      const store = freshStore(90_000);
      const pipeline = createIngestionPipeline({ adapter: createSyntheticNewsAdapter(), store });
      pipeline.ingestAll();
      return { snapshot: store.snapshot(), report: pipeline.deadLetterReport() };
    };
    expect(runNews().snapshot).toEqual(runNews().snapshot);
  });
});

/** Shim: the tick adapter's raw union (kept local to avoid importing the concrete type twice). */
type SyntheticTickRawShim = Parameters<ReturnType<typeof createSyntheticTickAdapter>['normalize']>[0];

/** Structural check used above: a StoredEvent satisfies the pipeline event shape implicitly. */
function storedEventShim(event: StorableEvent): object {
  return event.payload;
}
void storedEventShim;
