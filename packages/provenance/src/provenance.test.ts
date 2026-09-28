/**
 * @tradrl/provenance — store-level provenance record contracts.
 *
 * Behavioral suite: collect-all validation (positive and negative
 * paths), guard totality, custody-chain validation, syntheticity, and
 * deepFreeze immutability.
 */

import { describe, expect, it } from 'vitest';

import {
  EVENT_ORIGINS,
  deepFreeze,
  isCustodyChain,
  isProvenanceRecord,
  isSyntheticRecord,
  recordOrigin,
  validateCustodyChain,
  validateProvenanceRecord,
  type ProvenanceError,
  type ProvenanceRecord,
} from './index';

const CUSTODY = {
  adapter: { id: 'synthetic-tick-adapter', version: '1.0.0' },
  batch: { batch_id: 'tick-batch-001' },
  commit: { commit_id: 'cmt-00000001', commit_sequence: 1, ingestion_time: 10_000 },
} as const;

const HISTORICAL: ProvenanceRecord = {
  origin: 'historical',
  adapter: { id: 'synthetic-tick-adapter', version: '1.0.0' },
  derived_from: [],
  transform: null,
  corrections: [],
  custody: CUSTODY,
};

const SIMULATED: ProvenanceRecord = {
  origin: 'simulated',
  adapter: null,
  derived_from: [],
  transform: null,
  corrections: [],
  custody: CUSTODY,
};

const GENERATED: ProvenanceRecord = {
  origin: 'generated',
  adapter: { id: 'worldgen', version: '0.3.0' },
  derived_from: [],
  transform: null,
  corrections: [],
  custody: CUSTODY,
};

const DERIVED: ProvenanceRecord = {
  origin: 'historical',
  adapter: { id: 'feature-adapter', version: '0.2.0' },
  derived_from: ['evt-0', 'evt-1'],
  transform: 'vwap-1m-aggregator',
  corrections: [],
  custody: CUSTODY,
};

function codes(errors: readonly ProvenanceError[]): string[] {
  return errors.map((error) => error.code);
}

describe('origin taxonomy', () => {
  it('exposes exactly the three canonical origins', () => {
    expect([...EVENT_ORIGINS]).toEqual(['historical', 'simulated', 'generated']);
  });

  it('isSyntheticRecord is false only for historical origin', () => {
    expect(isSyntheticRecord({ provenance: HISTORICAL })).toBe(false);
    expect(isSyntheticRecord({ provenance: SIMULATED })).toBe(true);
    expect(isSyntheticRecord({ provenance: GENERATED })).toBe(true);
    expect(recordOrigin({ provenance: DERIVED })).toBe('historical');
  });
});

describe('ProvenanceRecord validation (collect-all)', () => {
  it('accepts well-formed records of every origin', () => {
    expect(validateProvenanceRecord(HISTORICAL, 'evt-1')).toEqual([]);
    expect(validateProvenanceRecord(SIMULATED, 'evt-1')).toEqual([]);
    expect(validateProvenanceRecord(GENERATED, 'evt-1')).toEqual([]);
    expect(validateProvenanceRecord(DERIVED, 'evt-2')).toEqual([]);
  });

  it('historical records REQUIRE an adapter reference', () => {
    const noAdapter: ProvenanceRecord = { ...HISTORICAL, adapter: null };
    expect(codes(validateProvenanceRecord(noAdapter, 'evt-1'))).toContain('provenance_adapter_required');
  });

  it('rejects unknown origins', () => {
    expect(codes(validateProvenanceRecord({ ...SIMULATED, origin: 'dreamed' as never }, 'e'))).toContain(
      'invalid_field',
    );
  });

  it('derived records REQUIRE a transform', () => {
    expect(codes(validateProvenanceRecord({ ...DERIVED, transform: null }, 'evt-2'))).toContain(
      'provenance_transform_required',
    );
  });

  it('a transform without parents is meaningless', () => {
    expect(codes(validateProvenanceRecord({ ...HISTORICAL, transform: 'vwap' }, 'evt-2'))).toContain(
      'provenance_transform_without_parents',
    );
  });

  it('a record may not appear in its own lineage', () => {
    expect(codes(validateProvenanceRecord({ ...DERIVED, derived_from: ['evt-2'] }, 'evt-2'))).toContain(
      'provenance_self_reference',
    );
  });

  it('duplicate parents are rejected', () => {
    expect(codes(validateProvenanceRecord({ ...DERIVED, derived_from: ['evt-0', 'evt-0'] }, 'evt-2'))).toContain(
      'provenance_duplicate_parent',
    );
  });

  it('corrections refs are validated: id and reason required', () => {
    const badRef = { ...HISTORICAL, corrections: [{ correction_id: '', reason: 'r' }] };
    expect(codes(validateProvenanceRecord(badRef, 'evt-1'))).toContain('invalid_field');
    const noReason = { ...HISTORICAL, corrections: [{ correction_id: 'c-1' } as { correction_id: string }] };
    expect(codes(validateProvenanceRecord(noReason, 'evt-1'))).toContain('missing_field');
  });

  it('custody is required: absent custody is a missing_field on the custody path', () => {
    const noCustody = { ...HISTORICAL, custody: undefined } as unknown as ProvenanceRecord;
    const errors = validateProvenanceRecord(noCustody, 'evt-1');
    expect(codes(errors)).toContain('missing_field');
    expect(errors.some((error) => error.path === 'custody')).toBe(true);
  });

  it('collects EVERY violation at once (never throws, never stops early)', () => {
    const broken = {
      origin: 'historical',
      adapter: null,
      derived_from: 'nope',
      transform: 't',
      corrections: 'nope',
      custody: 42,
    };
    const errors = validateProvenanceRecord(broken, 'evt-1');
    expect(errors.length).toBeGreaterThanOrEqual(5);
    expect(codes(errors)).toContain('provenance_adapter_required');
    expect(codes(errors)).toContain('invalid_field');
    expect(errors.some((error) => error.path === 'custody')).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(validateProvenanceRecord(null, 'e').length).toBe(1);
    expect(validateProvenanceRecord(42, 'e').length).toBe(1);
    expect(codes(validateProvenanceRecord('x', 'e'))).toEqual(['invalid_field']);
  });
});

describe('custody chain validation', () => {
  it('accepts the canonical custody shape', () => {
    expect(validateCustodyChain(CUSTODY)).toEqual([]);
    expect(isCustodyChain(CUSTODY)).toBe(true);
  });

  it('rejects a bad commit sequence, batch id and ingestion stamp', () => {
    expect(codes(validateCustodyChain({ ...CUSTODY, commit: { ...CUSTODY.commit, commit_sequence: 0 } }))).toContain(
      'invalid_field',
    );
    expect(codes(validateCustodyChain({ ...CUSTODY, batch: { batch_id: '' } }))).toContain('invalid_field');
    expect(
      codes(validateCustodyChain({ ...CUSTODY, commit: { ...CUSTODY.commit, ingestion_time: -1 } })),
    ).toContain('invalid_field');
    expect(isCustodyChain({ ...CUSTODY, commit: { ...CUSTODY.commit, commit_id: '' } })).toBe(false);
  });

  it('adapter may be null (simulated/generated records)', () => {
    expect(validateCustodyChain({ ...CUSTODY, adapter: null })).toEqual([]);
  });
});

describe('isProvenanceRecord structural guard (total)', () => {
  it('accepts well-formed records and rejects malformed', () => {
    expect(isProvenanceRecord(HISTORICAL)).toBe(true);
    expect(isProvenanceRecord(SIMULATED)).toBe(true);
    expect(isProvenanceRecord(DERIVED)).toBe(true);
    // Missing store-layer extensions.
    expect(isProvenanceRecord({ origin: 'historical', adapter: HISTORICAL.adapter, derived_from: [], transform: null })).toBe(false);
    // Historical without adapter.
    expect(isProvenanceRecord({ ...SIMULATED, origin: 'historical' })).toBe(false);
    // Unknown origin.
    expect(isProvenanceRecord({ ...SIMULATED, origin: 'unknown' as never })).toBe(false);
    // Bad corrections list.
    expect(isProvenanceRecord({ ...HISTORICAL, corrections: 'nope' as never })).toBe(false);
    // Bad custody.
    expect(isProvenanceRecord({ ...HISTORICAL, custody: null })).toBe(false);
    expect(isProvenanceRecord(null)).toBe(false);
    expect(isProvenanceRecord(42)).toBe(false);
  });
});

describe('deepFreeze (defensive immutability)', () => {
  it('freezes records deeply, including nested custody and payload-like values', () => {
    const frozen = deepFreeze({ ...HISTORICAL, derived_from: ['a', 'b'] });
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.custody)).toBe(true);
    expect(Object.isFrozen(frozen.custody.commit)).toBe(true);
    expect(Object.isFrozen(frozen.derived_from)).toBe(true);
  });

  it('mutation attempts throw in strict mode', () => {
    const frozen = deepFreeze({ ...HISTORICAL });
    const writable = frozen as unknown as { origin: string };
    expect(() => {
      writable.origin = 'simulated';
    }).toThrow(TypeError);
    const nested = frozen as unknown as { custody: { commit: { ingestion_time: number } } };
    expect(() => {
      nested.custody.commit.ingestion_time = 1;
    }).toThrow(TypeError);
  });

  it('handles cyclic structures and is idempotent', () => {
    const cyclic: Record<string, unknown> = { name: 'cycle' };
    cyclic.self = cyclic;
    expect(() => deepFreeze(cyclic)).not.toThrow();
    expect(() => deepFreeze(cyclic)).not.toThrow();
    expect(Object.isFrozen(cyclic)).toBe(true);
  });

  it('passes primitives through', () => {
    expect(deepFreeze(42)).toBe(42);
    expect(deepFreeze('x')).toBe('x');
    expect(deepFreeze(null)).toBe(null);
  });
});
