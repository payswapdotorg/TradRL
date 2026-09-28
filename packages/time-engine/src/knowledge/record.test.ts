/**
 * Behavioral tests for the KnowledgeRecord contract (T026 knowledge layer):
 * structural guards, negative validation paths, quartet ordering (D-003),
 * computation-iff-lineage consistency, provenance rules (T008 mirror),
 * immutability (deep freeze).
 */

import { describe, expect, it } from 'vitest';

import { requireTimestampMs } from '../index';
import {
  createKnowledgeRecord,
  isKnowledgeRecord,
  isSyntheticKnowledge,
  type KnowledgeRecord,
} from './index';
import { isDeeplyFrozen } from './freeze';

const T = (ms: number) => requireTimestampMs(ms);

/**
 * The T008 store-layer extension fields every valid provenance carries
 * (corrections + custody — see provenance.ts and ./t008-reference/).
 */
const STORE_LEVEL = {
  corrections: [],
  custody: {
    adapter: { id: 'kb-ingest-adapter', version: '1.0.0' },
    batch: { batch_id: 'kb-batch-001' },
    commit: { commit_id: 'kb-commit-00000001', commit_sequence: 1, ingestion_time: T(10_000) },
  },
};

/** A structurally valid primitive (raw) record fixture. */
function rawRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    record_id: 'kr-raw-1',
    tenant: 'acme',
    payload: { price: '43125.10', size: '0.017' },
    event_time: T(950),
    source_time: T(940),
    available_time: T(1_000),
    ingestion_time: T(1_050),
    inputs: [],
    computation: null,
    provenance: { origin: 'historical', adapter: { id: 'binance-adapter', version: '1.4.0' }, derived_from: [], transform: null, ...STORE_LEVEL },
    ...overrides,
  };
}

/** A structurally valid derived record fixture (over kr-raw-1). */
function derivedRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return rawRecord({
    record_id: 'kr-feature-1',
    payload: { vwap: '43120.55' },
    event_time: T(3_000),
    source_time: null,
    available_time: T(3_250),
    ingestion_time: T(3_300),
    inputs: ['kr-raw-1'],
    computation: { transform_id: 'vwap-1m-aggregator', delay: { milliseconds: 250 } },
    provenance: {
      origin: 'simulated',
      adapter: null,
      derived_from: ['evt-raw-1'],
      transform: 'vwap-1m-aggregator',
      ...STORE_LEVEL,
    },
    ...overrides,
  });
}

/** A full valid T008-shaped provenance with overridable fields (test support). */
function validProvenance(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    origin: 'historical',
    adapter: { id: 'binance-adapter', version: '1.4.0' },
    derived_from: [],
    transform: null,
    corrections: [],
    custody: { ...STORE_LEVEL.custody },
    ...overrides,
  };
}

function unwrap(value: ReturnType<typeof createKnowledgeRecord>): KnowledgeRecord {
  if (value.ok) return value.value;
  throw new Error(`unexpected failure: ${value.error.code}: ${value.error.message}`);
}

describe('createKnowledgeRecord — the record contract', () => {
  it('accepts a valid primitive record and deeply freezes it', () => {
    const record = unwrap(createKnowledgeRecord(rawRecord()));
    expect(record.record_id).toBe('kr-raw-1');
    expect(record.available_time).toBe(1_000);
    expect(record.computation).toBeNull();
    expect(isDeeplyFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.inputs)).toBe(true);
  });

  it('accepts a valid derived record with lineage and computation policy', () => {
    const record = unwrap(createKnowledgeRecord(derivedRecord()));
    expect(record.inputs).toEqual(['kr-raw-1']);
    expect(record.computation?.transform_id).toBe('vwap-1m-aggregator');
    expect(record.provenance.transform).toBe('vwap-1m-aggregator');
    expect(isSyntheticKnowledge(record.provenance)).toBe(true); // simulated
  });

  it('rejects non-objects and missing required fields with typed errors', () => {
    const notObject = createKnowledgeRecord(42);
    expect(notObject.ok).toBe(false);
    if (!notObject.ok) expect(notObject.error.code).toBe('invalid_record');

    for (const field of ['record_id', 'tenant', 'payload', 'event_time', 'source_time', 'available_time', 'ingestion_time', 'inputs', 'computation', 'provenance']) {
      const candidate = rawRecord();
      delete (candidate as Record<string, unknown>)[field];
      const result = createKnowledgeRecord(candidate);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('invalid_record');
    }
  });

  it('rejects empty record/tenant ids and non-JSON-representable payloads', () => {
    const emptyId = createKnowledgeRecord(rawRecord({ record_id: '' }));
    expect(emptyId.ok).toBe(false);

    const emptyTenant = createKnowledgeRecord(rawRecord({ tenant: '' }));
    expect(emptyTenant.ok).toBe(false);

    const functionPayload = createKnowledgeRecord(rawRecord({ payload: () => 'oops' }));
    expect(functionPayload.ok).toBe(false);
    if (!functionPayload.ok) expect(functionPayload.error.code).toBe('invalid_record');

    // null, booleans, numbers, strings, arrays and objects are all legitimate opaque payloads.
    for (const payload of [null, true, 42, 'note', [1, 2], { deep: { value: 1 } }]) {
      expect(createKnowledgeRecord(rawRecord({ payload })).ok).toBe(true);
    }
  });
});

describe('quartet ordering (D-003: available_time >= event_time is the one enforced ordering)', () => {
  it('rejects available_time preceding event_time with timestamp_order', () => {
    const result = createKnowledgeRecord(rawRecord({ event_time: T(1_500), available_time: T(1_000) }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('timestamp_order');
  });

  it('tolerates ingestion_time BEFORE available_time (embargo) and AFTER it (backfill)', () => {
    const embargo = createKnowledgeRecord(rawRecord({ ingestion_time: T(500) }));
    const backfill = createKnowledgeRecord(rawRecord({ ingestion_time: T(500_000) }));
    expect(embargo.ok).toBe(true);
    expect(backfill.ok).toBe(true);
  });

  it('accepts null source_time (the source does not say) and valid timestamps otherwise', () => {
    expect(createKnowledgeRecord(rawRecord({ source_time: null })).ok).toBe(true);
    expect(createKnowledgeRecord(rawRecord({ source_time: 'not-a-timestamp' })).ok).toBe(false);
  });
});

describe('computation policy consistency (policy iff lineage)', () => {
  it('rejects derived records without a computation policy', () => {
    const result = createKnowledgeRecord(derivedRecord({ computation: null }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('derived_without_policy');
  });

  it('rejects primitive records carrying a policy (policy_without_lineage)', () => {
    const result = createKnowledgeRecord(rawRecord({ computation: { transform_id: 'x', delay: {} } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('policy_without_lineage');
  });

  it('rejects lineage with self-reference or duplicate inputs', () => {
    const selfRef = createKnowledgeRecord(derivedRecord({ inputs: ['kr-feature-1'] }));
    expect(selfRef.ok).toBe(false);
    if (!selfRef.ok) expect(selfRef.error.code).toBe('invalid_record');

    const duplicate = createKnowledgeRecord(derivedRecord({ inputs: ['kr-raw-1', 'kr-raw-1'] }));
    expect(duplicate.ok).toBe(false);
  });
});

describe('provenance rules (T008 shapes, mirrored)', () => {
  it('rejects historical knowledge without an adapter reference', () => {
    const orphan = createKnowledgeRecord(rawRecord({ provenance: { origin: 'historical', adapter: null, derived_from: [], transform: null } }));
    expect(orphan.ok).toBe(false);
    if (!orphan.ok) expect(orphan.error.code).toBe('invalid_provenance');
  });

  it('rejects transform without event lineage and lineage without transform', () => {
    const transformWithoutParents = createKnowledgeRecord(
      rawRecord({ provenance: { origin: 'historical', adapter: { id: 'a', version: '1' }, derived_from: [], transform: 'xform' } }),
    );
    expect(transformWithoutParents.ok).toBe(false);
    if (!transformWithoutParents.ok) expect(transformWithoutParents.error.code).toBe('invalid_provenance');

    const parentsWithoutTransform = createKnowledgeRecord(
      rawRecord({ provenance: { origin: 'historical', adapter: { id: 'a', version: '1' }, derived_from: ['evt-1'], transform: null } }),
    );
    expect(parentsWithoutTransform.ok).toBe(false);
    if (!parentsWithoutTransform.ok) expect(parentsWithoutTransform.error.code).toBe('invalid_provenance');
  });

  it('rejects unknown origins, self-referential event lineage and duplicate parents', () => {
    const badOrigin = createKnowledgeRecord(rawRecord({ provenance: { origin: 'mythic', adapter: null, derived_from: [], transform: null } }));
    expect(badOrigin.ok).toBe(false);

    const selfLineage = createKnowledgeRecord(
      rawRecord({ provenance: { origin: 'historical', adapter: { id: 'a', version: '1' }, derived_from: ['kr-raw-1'], transform: 'xform' } }),
    );
    expect(selfLineage.ok).toBe(false);
    if (!selfLineage.ok) expect(selfLineage.error.code).toBe('invalid_provenance');

    const duplicateLineage = createKnowledgeRecord(
      rawRecord({ provenance: { origin: 'historical', adapter: { id: 'a', version: '1' }, derived_from: ['evt-1', 'evt-1'], transform: 'xform' } }),
    );
    expect(duplicateLineage.ok).toBe(false);
  });
});

describe('isKnowledgeRecord guard', () => {
  it('accepts the valid fixtures and rejects corrupted shapes', () => {
    expect(isKnowledgeRecord(unwrap(createKnowledgeRecord(rawRecord())))).toBe(true);
    expect(isKnowledgeRecord(unwrap(createKnowledgeRecord(derivedRecord())))).toBe(true);
    for (const corrupt of [null, 42, 'x', {}, rawRecord({ available_time: -1 }), rawRecord({ tenant: 7 }), rawRecord({ inputs: 'kr-raw-1' })]) {
      expect(isKnowledgeRecord(corrupt)).toBe(false);
    }
  });
});

describe('immutability — records never mutate after validation', () => {
  it('mutation attempts throw (deeply frozen)', () => {
    const record = unwrap(createKnowledgeRecord(derivedRecord()));
    const mutable = record as unknown as { available_time: number; payload: { vwap: string } };
    expect(() => {
      mutable.available_time = 1;
    }).toThrow();
    expect(() => {
      mutable.payload.vwap = '0';
    }).toThrow();
    expect(record.available_time).toBe(3_250);
    expect(record.payload).toEqual({ vwap: '43120.55' });
  });
});
