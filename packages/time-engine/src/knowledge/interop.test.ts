/**
 * Cross-lane structural-mirror trip-wires for the knowledge firewall (T026,
 * acceptance criterion: structural mirrors — trip-wired against the ACTUAL
 * T008 reference shapes).
 *
 * The T008 reference bundle (re-provisioned by the Lead: tmpfiles.org,
 * SHA256 cb5bd0c149fed0d825debc6704ea5c446e88ee2fd5850550c8ada1c2c7d08f59)
 * is vendored VERBATIM in ./t008-reference/ (byte-identical copies of
 * `packages/provenance/src/{errors,fields,timestamp,custody,provenance}.ts`).
 * This file is the trip wire:
 *
 *   - TYPE-LEVEL: KnowledgeProvenance is mutually assignable with T008's
 *     `ProvenanceRecord`; the custody chains are mutually assignable; a
 *     KnowledgeProvenance IS a market-protocol `Provenance` (width
 *     subtyping, exactly the T008 discipline); a KnowledgeRecord satisfies
 *     the T004 `Observable` boundary.
 *   - RUNTIME: the knowledge guard/validator accept and reject EXACTLY what
 *     the vendored (≡ reference) T008 guard/validator accept and reject,
 *     over a corpus of T008-shaped fixtures.
 *   - LIVE: when /tmp/reference is present, every vendored file is asserted
 *     byte-identical to the reference bundle — proving the vendor copy is
 *     genuine. When the reference is absent, the parity trip-wires still
 *     run against the committed vendor copy.
 *
 * Cross-package imports in TEST files only (D-004 discipline: contract
 * modules stay zero-dependency; mirrors are asserted, never imported, in
 * production code) — the same pattern as
 * packages/market-protocol/src/interop.test.ts.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The knowledge subtree under test.
import {
  createKnowledgeRecord,
  isKnowledgeProvenance,
  isTenantId,
  validateKnowledgeProvenance,
  type CustodyChain,
  type KnowledgeOrigin,
  type KnowledgeProvenance,
  type KnowledgeRecord,
  type TenantId as KnowledgeTenantId,
} from './index';
import { isTimestampMs as engineIsTimestampMs, requireTimestampMs, type Observable, type TimestampMs } from '../index';

// The vendored VERBATIM T008 reference (byte-identical; see
// ./t008-reference/README.md — live-verified below when the bundle exists).
import {
  EVENT_ORIGINS as T008_EVENT_ORIGINS,
  isProvenanceRecord,
  validateProvenanceRecord,
  type EventOrigin as T008EventOrigin,
  type ProvenanceRecord,
} from './t008-reference/provenance';
import { isTimestampMs as t008IsTimestampMs, type TimestampMs as T008TimestampMs } from './t008-reference/timestamp';
import type { CustodyChain as T008CustodyChain } from './t008-reference/custody';

// The mirrored cross-lane contracts (repo-authoritative shapes on main).
import {
  EVENT_ORIGINS as PROTOCOL_EVENT_ORIGINS,
  isProvenance as protocolIsProvenance,
  isTimestampMs as protocolIsTimestampMs,
  validateProvenance,
  type EventOrigin,
  type Provenance as ProtocolProvenance,
} from '../../../market-protocol/src/index';
import type { TenantId as DomainCoreTenantId } from '../../../domain-core/src/index';

// ---------------------------------------------------------------------------
// TYPE-LEVEL ASSERTIONS (fail `pnpm typecheck` if a mirror drifts).
// ---------------------------------------------------------------------------

/** Compiles iff knowledge provenance is assignable to T008's ProvenanceRecord. */
function knowledgeProvenanceIsT008Record(value: KnowledgeProvenance): ProvenanceRecord {
  return value;
}

/** Compiles iff T008's ProvenanceRecord is assignable to knowledge provenance. */
function t008RecordIsKnowledgeProvenance(value: ProvenanceRecord): KnowledgeProvenance {
  return value;
}

/** Compiles iff the custody chains are mutually assignable (T008 -> knowledge). */
function t008CustodyIsKnowledgeCustody(value: T008CustodyChain): CustodyChain {
  return value;
}

/** Compiles iff the custody chains are mutually assignable (knowledge -> T008). */
function knowledgeCustodyIsT008Custody(value: CustodyChain): T008CustodyChain {
  return value;
}

/**
 * Compiles iff a KnowledgeProvenance IS a market-protocol Provenance (width
 * subtyping — the T008 discipline: the store-level extension is backward
 * compatible). The REVERSE does NOT hold: the bare market-protocol block
 * lacks corrections/custody and does not satisfy the full record contract.
 */
function knowledgeProvenanceIsProtocolProvenance(value: KnowledgeProvenance): ProtocolProvenance {
  return value;
}

/** Compiles iff the origin vocabularies are the same union. */
function originVocabulariesMatch(value: EventOrigin): KnowledgeOrigin {
  return value;
}

/** Compiles iff T008's TimestampMs mirror is mutually assignable with the canonical. */
function t008TimestampIsEngineTimestamp(value: T008TimestampMs): TimestampMs {
  return value;
}

/** Compiles iff domain-core TenantId is assignable to the knowledge mirror. */
function domainCoreTenantIsKnowledgeTenant(value: DomainCoreTenantId): KnowledgeTenantId {
  return value;
}

/** Compiles iff the knowledge TenantId mirror is assignable to domain-core's. */
function knowledgeTenantIsDomainCoreTenant(value: KnowledgeTenantId): DomainCoreTenantId {
  return value;
}

/** Compiles iff a KnowledgeRecord satisfies the T004 Observable boundary contract. */
function knowledgeRecordIsObservable(value: KnowledgeRecord): Observable {
  return value;
}

// ---------------------------------------------------------------------------
// The T008 provenance shape corpus (valid records + every violation family).
// ---------------------------------------------------------------------------

const CUSTODY = {
  adapter: { id: 'synthetic-tick-adapter', version: '1.0.0' },
  batch: { batch_id: 'tick-batch-001' },
  commit: { commit_id: 'cmt-00000001', commit_sequence: 1, ingestion_time: requireTimestampMs(10_000) },
};

const CUSTODY_NULL_ADAPTER = {
  adapter: null,
  batch: { batch_id: 'tick-batch-001' },
  commit: { commit_id: 'cmt-00000001', commit_sequence: 1, ingestion_time: requireTimestampMs(10_000) },
};

/** A full valid T008 store-level record (historical primitive). */
const FULL: ProvenanceRecord = {
  origin: 'historical',
  adapter: { id: 'binance-adapter', version: '1.4.0' },
  derived_from: [],
  transform: null,
  corrections: [],
  custody: CUSTODY,
};

/** market-protocol's own provenance fixtures (their interop.test.ts shapes). */
const PROTOCOL_HISTORICAL: ProtocolProvenance = {
  origin: 'historical',
  adapter: { id: 'binance-adapter', version: '1.4.0' },
  derived_from: [],
  transform: null,
};
const PROTOCOL_SIMULATED: ProtocolProvenance = {
  origin: 'simulated',
  adapter: null,
  derived_from: [],
  transform: null,
};

const T008_SAMPLES: readonly { label: string; value: unknown }[] = [
  { label: 'historical primitive, full record', value: FULL },
  { label: 'simulated primitive, null custody adapter', value: { origin: 'simulated', adapter: null, derived_from: [], transform: null, corrections: [], custody: CUSTODY_NULL_ADAPTER } },
  { label: 'derived with transform', value: { origin: 'simulated', adapter: null, derived_from: ['evt-1', 'evt-2'], transform: 'vwap-1m-aggregator', corrections: [], custody: CUSTODY } },
  { label: 'historical derived', value: { origin: 'historical', adapter: { id: 'replay-file-adapter', version: '2.0.1' }, derived_from: ['evt-9'], transform: 'resample-1m', corrections: [], custody: CUSTODY } },
  { label: 'with corrections (amended record)', value: { origin: 'historical', adapter: { id: 'binance-adapter', version: '1.4.0' }, derived_from: [], transform: null, corrections: [{ correction_id: 'crt-00000001', reason: 'vendor restatement' }], custody: CUSTODY } },
  { label: 'bare market-protocol block (stricter contract rejects)', value: PROTOCOL_HISTORICAL },
  { label: 'bare simulated block (stricter contract rejects)', value: PROTOCOL_SIMULATED },
  { label: 'orphan history (adapter null)', value: { origin: 'historical', adapter: null, derived_from: [], transform: null, corrections: [], custody: CUSTODY } },
  { label: 'derived without transform', value: { origin: 'simulated', adapter: null, derived_from: ['evt-1'], transform: null, corrections: [], custody: CUSTODY } },
  { label: 'transform without lineage', value: { origin: 'simulated', adapter: null, derived_from: [], transform: 'xform', corrections: [], custody: CUSTODY } },
  { label: 'self reference', value: { origin: 'simulated', adapter: null, derived_from: ['the-record'], transform: 'xform', corrections: [], custody: CUSTODY } },
  { label: 'duplicate parents', value: { origin: 'simulated', adapter: null, derived_from: ['evt-1', 'evt-1'], transform: 'xform', corrections: [], custody: CUSTODY } },
  { label: 'empty parent id', value: { origin: 'simulated', adapter: null, derived_from: [''], transform: 'xform', corrections: [], custody: CUSTODY } },
  { label: 'unknown origin', value: { origin: 'mythic', adapter: null, derived_from: [], transform: null, corrections: [], custody: CUSTODY } },
  { label: 'missing corrections', value: { origin: 'historical', adapter: { id: 'a', version: '1' }, derived_from: [], transform: null, custody: CUSTODY } },
  { label: 'corrections not an array', value: { origin: 'historical', adapter: { id: 'a', version: '1' }, derived_from: [], transform: null, corrections: 'nope', custody: CUSTODY } },
  { label: 'correction entry without id', value: { origin: 'historical', adapter: { id: 'a', version: '1' }, derived_from: [], transform: null, corrections: [{ reason: 'x' }], custody: CUSTODY } },
  { label: 'correction entry with empty id', value: { origin: 'historical', adapter: { id: 'a', version: '1' }, derived_from: [], transform: null, corrections: [{ correction_id: '', reason: 'x' }], custody: CUSTODY } },
  { label: 'correction entry without reason', value: { origin: 'historical', adapter: { id: 'a', version: '1' }, derived_from: [], transform: null, corrections: [{ correction_id: 'crt-1' }], custody: CUSTODY } },
  { label: 'missing custody', value: { origin: 'historical', adapter: { id: 'a', version: '1' }, derived_from: [], transform: null, corrections: [] } },
  { label: 'custody not an object', value: { origin: 'historical', adapter: { id: 'a', version: '1' }, derived_from: [], transform: null, corrections: [], custody: 42 } },
  { label: 'custody adapter invalid', value: { origin: 'historical', adapter: { id: 'a', version: '1' }, derived_from: [], transform: null, corrections: [], custody: { ...CUSTODY, adapter: { id: '', version: '1' } } } },
  { label: 'custody batch missing', value: { origin: 'historical', adapter: { id: 'a', version: '1' }, derived_from: [], transform: null, corrections: [], custody: { adapter: null, commit: CUSTODY.commit } } },
  { label: 'custody batch id empty', value: { origin: 'historical', adapter: { id: 'a', version: '1' }, derived_from: [], transform: null, corrections: [], custody: { ...CUSTODY, batch: { batch_id: '' } } } },
  { label: 'custody commit missing', value: { origin: 'historical', adapter: { id: 'a', version: '1' }, derived_from: [], transform: null, corrections: [], custody: { adapter: null, batch: CUSTODY.batch } } },
  { label: 'commit id empty', value: { origin: 'historical', adapter: { id: 'a', version: '1' }, derived_from: [], transform: null, corrections: [], custody: { ...CUSTODY, commit: { commit_id: '', commit_sequence: 1, ingestion_time: requireTimestampMs(10_000) } } } },
  { label: 'commit sequence 0', value: { origin: 'historical', adapter: { id: 'a', version: '1' }, derived_from: [], transform: null, corrections: [], custody: { ...CUSTODY, commit: { commit_id: 'cmt-1', commit_sequence: 0, ingestion_time: requireTimestampMs(10_000) } } } },
  { label: 'commit sequence negative', value: { origin: 'historical', adapter: { id: 'a', version: '1' }, derived_from: [], transform: null, corrections: [], custody: { ...CUSTODY, commit: { commit_id: 'cmt-1', commit_sequence: -1, ingestion_time: requireTimestampMs(10_000) } } } },
  { label: 'commit sequence fractional', value: { origin: 'historical', adapter: { id: 'a', version: '1' }, derived_from: [], transform: null, corrections: [], custody: { ...CUSTODY, commit: { commit_id: 'cmt-1', commit_sequence: 1.5, ingestion_time: requireTimestampMs(10_000) } } } },
  { label: 'commit ingestion_time negative', value: { origin: 'historical', adapter: { id: 'a', version: '1' }, derived_from: [], transform: null, corrections: [], custody: { ...CUSTODY, commit: { commit_id: 'cmt-1', commit_sequence: 1, ingestion_time: -1 } } } },
  { label: 'commit ingestion_time out of range', value: { origin: 'historical', adapter: { id: 'a', version: '1' }, derived_from: [], transform: null, corrections: [], custody: { ...CUSTODY, commit: { commit_id: 'cmt-1', commit_sequence: 1, ingestion_time: 8_640_000_000_000_000 } } } },
  { label: 'not an object', value: 42 },
  { label: 'null', value: null },
];

// ---------------------------------------------------------------------------
// T008 parity trip-wires.
// ---------------------------------------------------------------------------

describe('provenance structural mirror (knowledge <-> T008 ProvenanceRecord)', () => {
  it('the guard agrees with the vendored T008 guard on EVERY fixture shape', () => {
    for (const sample of T008_SAMPLES) {
      expect(
        isKnowledgeProvenance(sample.value),
        `isKnowledgeProvenance disagrees with T008 isProvenanceRecord on "${sample.label}"`,
      ).toBe(isProvenanceRecord(sample.value));
    }
  });

  it('the validator agrees with the vendored T008 validator on accept/reject for EVERY fixture shape', () => {
    for (const sample of T008_SAMPLES) {
      const t008Errors = validateProvenanceRecord(sample.value, 'the-record');
      const knowledgeResult = validateKnowledgeProvenance(sample.value, 'the-record');
      expect(
        knowledgeResult.ok,
        `validateKnowledgeProvenance disagrees with T008 validateProvenanceRecord on "${sample.label}"`,
      ).toBe(t008Errors.length === 0);
    }
  });

  it('exercises the type-level mirror functions (compile-time trip wire)', () => {
    const asT008 = knowledgeProvenanceIsT008Record(FULL);
    const backToKnowledge = t008RecordIsKnowledgeProvenance(asT008);
    expect(backToKnowledge.origin).toBe('historical');
    expect(knowledgeCustodyIsT008Custody(backToKnowledge.custody).commit.commit_sequence).toBe(1);
    expect(t008CustodyIsKnowledgeCustody(FULL.custody).batch.batch_id).toBe('tick-batch-001');
    expect(originVocabulariesMatch('generated')).toBe('generated');
    expect(t008TimestampIsEngineTimestamp(requireTimestampMs(42))).toBe(42);
  });

  it('the origin vocabularies are identical to T008 and market-protocol', () => {
    expect(T008_EVENT_ORIGINS).toEqual(PROTOCOL_EVENT_ORIGINS);
    expect(T008_EVENT_ORIGINS).toEqual(['historical', 'simulated', 'generated']);
  });
});

describe('market-protocol compatibility (width subtyping, the T008 discipline)', () => {
  it('a full KnowledgeProvenance IS a market-protocol Provenance (type-level + runtime tolerance)', () => {
    const asProtocol: ProtocolProvenance = knowledgeProvenanceIsProtocolProvenance(FULL);
    expect(asProtocol.origin).toBe('historical');
    // market-protocol's own validator tolerates the store-level extension.
    expect(protocolValidateProvenance(FULL, 'evt-1')).toEqual([]);
    // ... and their loose guard accepts the extended record (extra fields ignored).
    expect(protocolIsProvenance(FULL)).toBe(true);
  });

  it('the full record is a STRICTER contract: bare market-protocol provenance lacks corrections/custody', () => {
    // Mirrors T008's own interop.test.ts assertion of the same discipline.
    expect(validateProvenanceRecord(PROTOCOL_HISTORICAL, 'evt-1').length).toBeGreaterThan(0);
    expect(validateProvenanceRecord(FULL, 'evt-1')).toEqual([]);
    expect(isKnowledgeProvenance(PROTOCOL_HISTORICAL)).toBe(false);
    expect(validateKnowledgeProvenance(PROTOCOL_HISTORICAL, 'evt-1').ok).toBe(false);
    expect(isProvenanceRecord(PROTOCOL_HISTORICAL)).toBe(false);
  });
});

describe('timestamp structural mirrors (canonical engine, T008 mirror, market-protocol mirror)', () => {
  it('every mirrored guard is behaviorally identical', () => {
    for (const sample of [0, 1, 1.5, -1, 8_639_999_999_999_999, 8_640_000_000_000_000, Number.NaN, 'x', null, undefined]) {
      const expected = engineIsTimestampMs(sample);
      expect(t008IsTimestampMs(sample)).toBe(expected);
      expect(protocolIsTimestampMs(sample)).toBe(expected);
    }
  });
});

describe('live T008 reference verification (when the reference bundle is present)', () => {
  const REFERENCE_DIR = '/tmp/reference/packages/provenance/src';
  const VENDOR_DIR = `${fileURLToPath(new URL('.', import.meta.url))}t008-reference`;
  const VENDORED_FILES = ['errors.ts', 'fields.ts', 'timestamp.ts', 'custody.ts', 'provenance.ts'] as const;

  it.skipIf(!existsSync(REFERENCE_DIR))('the vendored copy is byte-identical to the reference bundle', () => {
    for (const file of VENDORED_FILES) {
      const vendored = readFileSync(`${VENDOR_DIR}/${file}`);
      const reference = readFileSync(`${REFERENCE_DIR}/${file}`);
      expect(Buffer.compare(vendored, reference), `${file} diverged from the T008 reference bundle`).toBe(0);
    }
  });
});

describe('tenant identity structural mirror (knowledge <-> domain-core)', () => {
  it('exercises the type-level mirror functions (compile-time trip wire)', () => {
    const fromDomainCore: DomainCoreTenantId = 'acme' as DomainCoreTenantId;
    const asKnowledge = domainCoreTenantIsKnowledgeTenant(fromDomainCore);
    const back = knowledgeTenantIsDomainCoreTenant(asKnowledge);
    expect(back).toBe('acme');
    expect(isTenantId('acme')).toBe(true);
    expect(isTenantId('')).toBe(false);
  });
});

describe('KnowledgeRecord satisfies the T004 Observable boundary', () => {
  it('is assignable at the type level and exposes available_time at runtime', () => {
    const recordResult = createKnowledgeRecord({
      record_id: 'kr-1',
      tenant: 'acme',
      payload: { v: 1 },
      event_time: requireTimestampMs(950),
      source_time: null,
      available_time: requireTimestampMs(1_000),
      ingestion_time: requireTimestampMs(1_050),
      inputs: [],
      computation: null,
      provenance: FULL,
    });
    if (!recordResult.ok) throw new Error('fixture must be valid');
    const witness: Observable = knowledgeRecordIsObservable(recordResult.value);
    expect(witness.available_time).toBe(1_000);
  });
});
