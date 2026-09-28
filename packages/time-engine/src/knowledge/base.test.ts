/**
 * Behavioral tests for the KnowledgeBase (T026): append-only purity, the
 * full write contract (identity, parent resolution, tenant isolation of
 * derivations, propagation), the INCLUSIVE visibility boundary
 * (available_time == now IS visible; == now+1 is NOT), tenant-scoped reads
 * with typed cross-tenant rejection, and determinism.
 */

import { describe, expect, it } from 'vitest';

import { requireTimestampMs } from '../index';
import {
  appendKnowledgeRecord,
  createKnowledgeBase,
  createKnowledgeRecord,
  getKnowledgeRecord,
  isKnowledgeBase,
  loadKnowledgeRecords,
  requireKnowledgeRecordId,
  requireTenantId,
  visible,
  visibleKnowledgeSlice,
  visibleSlice,
  type KnowledgeBase,
  type KnowledgeRecord,
  type KnowledgeResult,
} from './index';
import { isDeeplyFrozen } from './freeze';

const T = (ms: number) => requireTimestampMs(ms);

/** The T008 store-layer extension fields (corrections + custody). */
const STORE_LEVEL = {
  corrections: [],
  custody: {
    adapter: { id: 'kb-ingest-adapter', version: '1.0.0' },
    batch: { batch_id: 'kb-batch-001' },
    commit: { commit_id: 'kb-commit-00000001', commit_sequence: 1, ingestion_time: T(10_000) },
  },
};

function raw(id: string, available: number, tenant = 'acme'): Record<string, unknown> {
  return {
    record_id: id,
    tenant,
    payload: { available },
    event_time: T(available - 50),
    source_time: null,
    available_time: T(available),
    ingestion_time: T(available + 100),
    inputs: [],
    computation: null,
    provenance: {
      origin: 'historical',
      adapter: { id: 'binance-adapter', version: '1.4.0' },
      derived_from: [],
      transform: null,
      ...STORE_LEVEL,
    },
  };
}

function derived(id: string, inputs: readonly string[], available: number, tenant = 'acme'): Record<string, unknown> {
  return {
    record_id: id,
    tenant,
    payload: { value: available },
    event_time: T(available - 25),
    source_time: null,
    available_time: T(available),
    ingestion_time: T(available + 10),
    inputs: [...inputs],
    computation: { transform_id: 'test-transform', delay: { milliseconds: 250 } },
    provenance: {
      origin: 'simulated',
      adapter: null,
      derived_from: inputs.map((input) => `evt-${input}`),
      transform: 'test-transform',
      ...STORE_LEVEL,
    },
  };
}

function unwrapRecord(value: ReturnType<typeof createKnowledgeRecord>): KnowledgeRecord {
  if (value.ok) return value.value;
  throw new Error(`unexpected failure: ${value.error.code}: ${value.error.message}`);
}

function unwrap<T>(value: KnowledgeResult<T>): T {
  if (value.ok) return value.value;
  throw new Error(`unexpected failure: ${value.error.code}: ${value.error.message}`);
}

function buildGraph(): KnowledgeBase {
  let base = createKnowledgeBase();
  base = unwrap(appendKnowledgeRecord(base, unwrapRecord(createKnowledgeRecord(raw('t1', 1_000)))));
  base = unwrap(appendKnowledgeRecord(base, unwrapRecord(createKnowledgeRecord(raw('t2', 2_000)))));
  base = unwrap(appendKnowledgeRecord(base, unwrapRecord(createKnowledgeRecord(raw('t3', 3_000)))));
  base = unwrap(
    appendKnowledgeRecord(base, unwrapRecord(createKnowledgeRecord(derived('f1', ['t1', 't2', 't3'], 3_250)))),
  );
  return base;
}

describe('appendKnowledgeRecord — the guarded write path', () => {
  it('appends in order, returns a NEW frozen base, never mutates the original', () => {
    const base = buildGraph();
    expect(base.size).toBe(4);
    expect(base.records.map((record) => record.record_id)).toEqual(['t1', 't2', 't3', 'f1']);
    expect(isKnowledgeBase(base)).toBe(true);
    expect(isDeeplyFrozen(base)).toBe(true);

    const before = base.records.length;
    const next = unwrap(
      appendKnowledgeRecord(base, unwrapRecord(createKnowledgeRecord(derived('a1', ['f1'], 4_250)))),
    );
    expect(next.size).toBe(5);
    expect(base.size).toBe(4); // original unchanged
    expect(base.records.length).toBe(before);
    expect(next.records.slice(0, 4)).toEqual(base.records);
  });

  it('REJECTS a derived record dated before its latest input (negative propagation test)', () => {
    let base = buildGraph();
    const leaky = unwrapRecord(createKnowledgeRecord(derived('leak', ['t3'], 2_999))); // t3 available at 3_000
    const result = appendKnowledgeRecord(base, leaky);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('derived_before_inputs');
    expect(base.size).toBe(4); // rejected appends leave the base untouched

    // Correctly-dated derived records pass.
    const correct = unwrapRecord(createKnowledgeRecord(derived('ok', ['t3'], 3_000)));
    base = unwrap(appendKnowledgeRecord(base, correct));
    expect(base.size).toBe(5);
  });

  it('REJECTS duplicate record ids (append-only identity)', () => {
    const base = buildGraph();
    const duplicate = unwrapRecord(createKnowledgeRecord(raw('t1', 5_000)));
    const result = appendKnowledgeRecord(base, duplicate);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('duplicate_record');
  });

  it('REJECTS unresolved inputs and self/cyclic lineage (unknown_input)', () => {
    const base = buildGraph();
    const orphan = unwrapRecord(createKnowledgeRecord(derived('orphan', ['ghost'], 9_000)));
    const orphanResult = appendKnowledgeRecord(base, orphan);
    expect(orphanResult.ok).toBe(false);
    if (!orphanResult.ok) expect(orphanResult.error.code).toBe('unknown_input');

    // Self-reference is rejected by the record contract itself, and cycles
    // are inexpressible through the guarded append path: a parent must
    // already be present when its child is appended, so the append order is
    // a topological order of the knowledge graph.
    const selfRef = createKnowledgeRecord(derived('f1', ['f1'], 9_000));
    expect(selfRef.ok).toBe(false);
    if (!selfRef.ok) expect(selfRef.error.code).toBe('invalid_record');
  });

  it('REJECTS cross-tenant derivations (tenant_isolation, L12)', () => {
    const base = buildGraph();
    const foreign = unwrapRecord(createKnowledgeRecord(derived('spy', ['t1'], 5_000, 'globex')));
    const result = appendKnowledgeRecord(base, foreign);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('tenant_isolation');
  });

  it('REJECTS structurally invalid appended records and bases', () => {
    const base = buildGraph();
    const invalid = appendKnowledgeRecord(base, { record_id: 'x' } as unknown as KnowledgeRecord);
    expect(invalid.ok).toBe(false);

    const invalidBase = appendKnowledgeRecord({ records: 'nope', size: 0 } as unknown as KnowledgeBase, unwrapRecord(createKnowledgeRecord(raw('t9', 1_000))));
    expect(invalidBase.ok).toBe(false);
  });
});

describe('visible / visibleSlice — the INCLUSIVE L4 boundary at the knowledge layer', () => {
  const record = unwrapRecord(createKnowledgeRecord(raw('t3', 3_000)));

  it('available_time == at IS visible (inclusive boundary)', () => {
    expect(visible(record, T(3_000))).toBe(true);
  });

  it('available_time == at + 1 is NOT visible one millisecond before', () => {
    expect(visible(record, T(2_999))).toBe(false);
    expect(visible(record, T(0))).toBe(false);
  });

  it('visibleSlice preserves order and polices every member', () => {
    const base = buildGraph();
    const slice = visibleSlice(base.records, T(2_000));
    expect(slice.map((r) => r.record_id)).toEqual(['t1', 't2']);
    const all = visibleSlice(base.records, T(4_000));
    expect(all.map((r) => r.record_id)).toEqual(['t1', 't2', 't3', 'f1']);
  });

  it('the boundary is ORIGIN-BLIND: simulated knowledge is withheld exactly like historical', () => {
    // A simulated record with future availability is withheld identically to
    // a historical one — no origin-based exemptions (L4 law).
    const simulatedFuture = unwrapRecord(
      createKnowledgeRecord({
        record_id: 'sim-future',
        tenant: 'acme',
        payload: { synthetic: true },
        event_time: T(4_950),
        source_time: null,
        available_time: T(5_000),
        ingestion_time: T(5_050),
        inputs: [],
        computation: null,
        provenance: { origin: 'simulated', adapter: null, derived_from: [], transform: null, ...STORE_LEVEL },
      }),
    );
    const historicalFuture = unwrapRecord(createKnowledgeRecord(raw('hist-future', 5_000)));
    expect(visible(simulatedFuture, T(4_999))).toBe(false);
    expect(visible(historicalFuture, T(4_999))).toBe(false);
    expect(visible(simulatedFuture, T(5_000))).toBe(true);
    expect(visible(historicalFuture, T(5_000))).toBe(true);
  });
});

describe('getKnowledgeRecord / visibleKnowledgeSlice — tenant scoping (L12)', () => {
  it('serves same-tenant reads and REJECTS cross-tenant reads with a typed error', () => {
    let base = createKnowledgeBase();
    base = unwrap(appendKnowledgeRecord(base, unwrapRecord(createKnowledgeRecord(raw('acme-1', 1_000, 'acme')))));
    base = unwrap(appendKnowledgeRecord(base, unwrapRecord(createKnowledgeRecord(raw('globex-1', 1_000, 'globex')))));

    const acmeRead = unwrap(getKnowledgeRecord(base, requireTenantId('acme'), requireKnowledgeRecordId('acme-1')));
    expect(acmeRead.record_id).toBe('acme-1');

    const crossTenant = getKnowledgeRecord(base, requireTenantId('globex'), requireKnowledgeRecordId('acme-1'));
    expect(crossTenant.ok).toBe(false);
    if (!crossTenant.ok) {
      expect(crossTenant.error.code).toBe('tenant_isolation');
      expect(crossTenant.error.message).toContain('L12');
    }

    const absent = getKnowledgeRecord(base, requireTenantId('acme'), requireKnowledgeRecordId('nope'));
    expect(absent.ok).toBe(false);
    if (!absent.ok) expect(absent.error.code).toBe('unknown_record');
  });

  it('visibleKnowledgeSlice scopes to the reading tenant and the clock', () => {
    let base = createKnowledgeBase();
    base = unwrap(appendKnowledgeRecord(base, unwrapRecord(createKnowledgeRecord(raw('acme-a', 1_000, 'acme')))));
    base = unwrap(appendKnowledgeRecord(base, unwrapRecord(createKnowledgeRecord(raw('acme-b', 2_000, 'acme')))));
    base = unwrap(appendKnowledgeRecord(base, unwrapRecord(createKnowledgeRecord(raw('globex-a', 1_500, 'globex')))));

    const slice = unwrap(visibleKnowledgeSlice(base, requireTenantId('acme'), T(1_500)));
    expect(slice.map((r) => r.record_id)).toEqual(['acme-a']); // acme-b not yet available; globex-a out of scope
  });
});

describe('loadKnowledgeRecords — the forensic/loading path', () => {
  it('validates structure and uniqueness but PERMITS graph violations (the scan audits them)', () => {
    const leaky = unwrapRecord(createKnowledgeRecord(derived('leak', ['t3'], 2_999)));
    const parent = unwrapRecord(createKnowledgeRecord(raw('t3', 3_000)));
    // Structurally valid, propagation-leaky: loading must accept it.
    const loaded = loadKnowledgeRecords([parent, leaky]);
    expect(loaded.ok).toBe(true);

    const duplicate = loadKnowledgeRecords([parent, parent]);
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.error.code).toBe('duplicate_record');

    const structural = loadKnowledgeRecords([{ record_id: 'x' }]);
    expect(structural.ok).toBe(false);
  });
});

describe('determinism — identical appends produce identical bases', () => {
  it('two independently built graphs are deep-equal and frozen', () => {
    const a = buildGraph();
    const b = buildGraph();
    expect(a).toEqual(b);
    expect(isDeeplyFrozen(a)).toBe(true);

    const mutable = a as unknown as { size: number };
    expect(() => {
      mutable.size = 99;
    }).toThrow();
  });
});
