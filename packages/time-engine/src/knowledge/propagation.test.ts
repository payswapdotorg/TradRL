/**
 * Behavioral tests for derived-knowledge availability propagation (T026):
 * multi-input canonical value, the legal floor, append-time rejection of
 * derived records dated before their latest input (L4), transitive
 * propagation over knowledge graphs, and derivation tenant isolation (L12).
 */

import { describe, expect, it } from 'vitest';

import { requireTimestampMs } from '../index';
import {
  createKnowledgeRecord,
  derivedKnowledgeAvailableTime,
  knowledgePropagationFloor,
  requireKnowledgeRecordId,
  validateKnowledgeRecord,
  type KnowledgeRecord,
} from './index';
import type { KnowledgeRecordId } from './ids';

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

function raw(id: string, available: number): Record<string, unknown> {
  return {
    record_id: id,
    tenant: 'acme',
    payload: { n: available },
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

function unwrap(value: ReturnType<typeof createKnowledgeRecord>): KnowledgeRecord {
  if (value.ok) return value.value;
  throw new Error(`unexpected failure: ${value.error.code}: ${value.error.message}`);
}

const VWAP_POLICY = { transform_id: 'vwap-1m-aggregator', delay: { milliseconds: 250 } } as const;

describe('derivedKnowledgeAvailableTime — multi-input propagation', () => {
  const t1 = unwrap(createKnowledgeRecord(raw('t1', 1_000)));
  const t2 = unwrap(createKnowledgeRecord(raw('t2', 3_000)));
  const t3 = unwrap(createKnowledgeRecord(raw('t3', 2_000)));

  it('equals the LATEST input available_time plus the policy delay', () => {
    const result = derivedKnowledgeAvailableTime([t1, t2, t3], VWAP_POLICY.transform_id, VWAP_POLICY.delay);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(3_250);
  });

  it('works for a single input and zero delay', () => {
    const single = derivedKnowledgeAvailableTime([t1], 'pass-through', {});
    expect(single.ok).toBe(true);
    if (single.ok) expect(single.value).toBe(1_000);
  });

  it('rejects empty inputs and malformed policies with typed errors', () => {
    const empty = derivedKnowledgeAvailableTime([], 'x', {});
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.code).toBe('no_inputs');

    const noTransform = derivedKnowledgeAvailableTime([t1], '', {});
    expect(noTransform.ok).toBe(false);
    if (!noTransform.ok) expect(noTransform.error.code).toBe('invalid_policy');

    const negativeDelay = derivedKnowledgeAvailableTime([t1], 'x', { minutes: -1 });
    expect(negativeDelay.ok).toBe(false);
    if (!negativeDelay.ok) expect(negativeDelay.error.code).toBe('invalid_duration');

    const notARecord = derivedKnowledgeAvailableTime([{ available_time: 1 } as unknown as KnowledgeRecord], 'x', {});
    expect(notARecord.ok).toBe(false);
    if (!notARecord.ok) expect(notARecord.error.code).toBe('invalid_record');
  });
});

describe('knowledgePropagationFloor — the legal floor', () => {
  it('is the max of input available_times', () => {
    const inputs = [unwrap(createKnowledgeRecord(raw('a', 100))), unwrap(createKnowledgeRecord(raw('b', 900))), unwrap(createKnowledgeRecord(raw('c', 500)))];
    const floor = knowledgePropagationFloor(inputs);
    expect(floor.ok).toBe(true);
    if (floor.ok) expect(floor.value).toBe(900);
  });

  it('requires at least one input', () => {
    const result = knowledgePropagationFloor([]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('no_inputs');
  });
});

describe('validateKnowledgeRecord — the append-time propagation law', () => {
  const t1 = unwrap(createKnowledgeRecord(raw('t1', 1_000)));
  const t2 = unwrap(createKnowledgeRecord(raw('t2', 3_000)));
  const parents = new Map<KnowledgeRecordId, KnowledgeRecord>([
    [requireKnowledgeRecordId('t1'), t1],
    [requireKnowledgeRecordId('t2'), t2],
  ]);

  it('accepts a derived record available at or after its latest input', () => {
    const atFloor = unwrap(createKnowledgeRecord(derived('f1', ['t1', 't2'], 3_000)));
    const beyond = unwrap(createKnowledgeRecord(derived('f2', ['t1', 't2'], 10_000)));
    expect(validateKnowledgeRecord(atFloor, parents).ok).toBe(true);
    expect(validateKnowledgeRecord(beyond, parents).ok).toBe(true);
  });

  it('REJECTS a derived record dated before its latest input (derived_before_inputs)', () => {
    const leaky = unwrap(createKnowledgeRecord(derived('leak', ['t1', 't2'], 2_999)));
    const result = validateKnowledgeRecord(leaky, parents);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('derived_before_inputs');
  });

  it('REJECTS unresolved inputs (unknown_input)', () => {
    const orphan = unwrap(createKnowledgeRecord(derived('orphan', ['t1', 'ghost'], 5_000)));
    const result = validateKnowledgeRecord(orphan, parents);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unknown_input');
  });

  it('REJECTS cross-tenant derivations (tenant_isolation, L12)', () => {
    const foreign = unwrap(createKnowledgeRecord(derived('foreign', ['t1'], 5_000, 'globex')));
    const result = validateKnowledgeRecord(foreign, parents);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('tenant_isolation');
  });

  it('accepts primitive records without cross-record checks', () => {
    expect(validateKnowledgeRecord(t1, new Map()).ok).toBe(true);
  });

  it('propagates TRANSITIVELY: raw -> feature -> aggregate floors chain', () => {
    const raw1 = unwrap(createKnowledgeRecord(raw('r1', 1_000)));
    const raw2 = unwrap(createKnowledgeRecord(raw('r2', 2_000)));
    const feature = unwrap(
      createKnowledgeRecord(
        derived('feat', ['r1', 'r2'], 2_250), // canonical: max(1_000, 2_000) + 250
      ),
    );
    const aggregate = unwrap(
      createKnowledgeRecord(derived('agg', ['feat', 'r2'], 3_250)), // floor is max(2_250, 2_000) = 2_250; 3_250 is beyond it (legitimate embargo)
    );

    const level1 = new Map<KnowledgeRecordId, KnowledgeRecord>([
      [requireKnowledgeRecordId('r1'), raw1],
      [requireKnowledgeRecordId('r2'), raw2],
    ]);
    const level2 = new Map<KnowledgeRecordId, KnowledgeRecord>([
      [requireKnowledgeRecordId('r1'), raw1],
      [requireKnowledgeRecordId('r2'), raw2],
      [requireKnowledgeRecordId('feat'), feature],
    ]);

    expect(validateKnowledgeRecord(feature, level1).ok).toBe(true);
    expect(validateKnowledgeRecord(aggregate, level2).ok).toBe(true);

    // Transitive law: the aggregate cannot precede the raw ancestor.
    const aggregateFloor = knowledgePropagationFloor([feature, raw2]);
    expect(aggregateFloor.ok).toBe(true);
    if (aggregateFloor.ok) {
      expect(aggregateFloor.value).toBe(2_250);
      expect(aggregate.available_time).toBeGreaterThanOrEqual(aggregateFloor.value);
    }
    expect(aggregate.available_time).toBeGreaterThanOrEqual(raw2.available_time);
    expect(feature.available_time).toBeGreaterThanOrEqual(raw2.available_time);
  });
});
