/**
 * Behavioral tests for the knowledge leakage scan (T026): the clean fixture
 * produces no findings; the deliberately-leaky fixture produces a violation
 * report naming the offending chain; missing inputs and cross-tenant
 * derivation edges are reported; scans are deterministic and reports frozen.
 */

import { describe, expect, it } from 'vitest';

import { requireTimestampMs } from '../index';
import {
  appendKnowledgeRecord,
  createKnowledgeBase,
  createKnowledgeRecord,
  knowledgeLeakageScan,
  loadKnowledgeRecords,
  requireCleanKnowledgeBase,
  requireTenantId,
  type KnowledgeBase,
  type KnowledgeLeakageFinding,
  type KnowledgeRecord,
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

function unwrapBase(value: ReturnType<typeof loadKnowledgeRecords>): KnowledgeBase {
  if (value.ok) return value.value;
  throw new Error(`unexpected failure: ${value.error.code}: ${value.error.message}`);
}

function load(...records: Record<string, unknown>[]): KnowledgeBase {
  return unwrapBase(loadKnowledgeRecords(records.map((candidate) => unwrapRecord(createKnowledgeRecord(candidate)))));
}

function findingKind(finding: KnowledgeLeakageFinding | undefined): string | undefined {
  return finding?.kind;
}

describe('knowledgeLeakageScan — the clean fixture', () => {
  it('a correctly propagated graph (raw -> feature -> aggregate) produces NO findings', () => {
    const clean = load(
      raw('t1', 1_000),
      raw('t2', 2_000),
      raw('t3', 3_000),
      derived('f1', ['t1', 't2', 't3'], 3_250), // canonical: max(3_000) + 250
      derived('a1', ['f1', 't3'], 4_250), // beyond the floor (embargo) — legitimate
    );
    const report = knowledgeLeakageScan(clean);
    expect(report.clean).toBe(true);
    expect(report.findings).toEqual([]);
    expect(report.recordsChecked).toBe(5);
    expect(report.edgesChecked).toBe(5);
  });

  it('a base of primitive records is trivially clean', () => {
    const primitives = load(raw('t1', 1), raw('t2', 2));
    const report = knowledgeLeakageScan(primitives);
    expect(report.clean).toBe(true);
    expect(report.edgesChecked).toBe(0);
  });
});

describe('knowledgeLeakageScan — the deliberately-leaky fixture', () => {
  it('a record dated before its latest input is a LEAK naming the offending chain', () => {
    const leaky = load(
      raw('r1', 10_000),
      derived('d1', ['r1'], 9_000), // LEAK: 9_000 < 10_000
    );
    const report = knowledgeLeakageScan(leaky);
    expect(report.clean).toBe(false);
    expect(report.findings.length).toBe(1);

    const finding = report.findings[0];
    expect(findingKind(finding)).toBe('leaky_record');
    if (finding?.kind === 'leaky_record') {
      expect(finding.record_id).toBe('d1');
      expect(finding.available_time).toBe(9_000);
      expect(finding.floor).toBe(10_000);
      expect(finding.leadMs).toBe(1_000);
      expect(finding.offending_inputs).toEqual(['r1']);
      expect(finding.chain).toEqual(['d1', 'r1']); // the offending chain is named
    }
  });

  it('the leak is attributed to the LATEST input even when other inputs are older', () => {
    const leaky = load(
      raw('p1', 1_000),
      raw('p2', 5_000),
      derived('child', ['p1', 'p2'], 4_999), // precedes p2 (5_000), after p1 (1_000)
    );
    const report = knowledgeLeakageScan(leaky);
    const finding = report.findings[0];
    expect(findingKind(finding)).toBe('leaky_record');
    if (finding?.kind === 'leaky_record') {
      expect(finding.floor).toBe(5_000);
      expect(finding.offending_inputs).toEqual(['p2']);
      expect(finding.chain).toEqual(['child', 'p1', 'p2']);
    }
  });

  it('the append path REJECTS the leaky record, so guarded bases never leak', () => {
    const guardedParent = unwrapAppend(
      appendKnowledgeRecord(createKnowledgeBase(), unwrapRecord(createKnowledgeRecord(raw('r1', 10_000)))),
    );
    const rejected = appendKnowledgeRecord(guardedParent, unwrapRecord(createKnowledgeRecord(derived('d1', ['r1'], 9_000))));
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.code).toBe('derived_before_inputs');
  });
});

describe('knowledgeLeakageScan — lineage and tenant forensics', () => {
  it('reports unresolved input ids (missing_input)', () => {
    const broken = load(
      raw('t1', 1_000),
      derived('orphan', ['t1', 'ghost'], 5_000), // 'ghost' never present
    );
    const report = knowledgeLeakageScan(broken);
    expect(report.clean).toBe(false);
    const finding = report.findings[0];
    expect(findingKind(finding)).toBe('missing_input');
    if (finding?.kind === 'missing_input') {
      expect(finding.record_id).toBe('orphan');
      expect(finding.input_id).toBe('ghost');
    }
    // The resolvable edge does not leak, so no leaky_record finding.
    expect(report.findings.filter((f) => f.kind === 'leaky_record')).toEqual([]);
  });

  it('reports cross-tenant derivation edges (tenant_boundary_crossing, L12)', () => {
    const crossing = load(
      raw('acme-1', 1_000, 'acme'),
      raw('globex-1', 2_000, 'globex'),
      derived('globex-derived', ['globex-1', 'acme-1'], 3_000, 'globex'), // derives from acme-1
    );
    const report = knowledgeLeakageScan(crossing);
    expect(report.clean).toBe(false);
    const finding = report.findings[0];
    expect(findingKind(finding)).toBe('tenant_boundary_crossing');
    if (finding?.kind === 'tenant_boundary_crossing') {
      expect(finding.record_id).toBe('globex-derived');
      expect(finding.input_id).toBe('acme-1');
      expect(finding.input_tenant).toBe('acme');
    }
  });

  it('scopes the scan to one tenant when requested', () => {
    const mixed = load(
      raw('acme-leak-parent', 5_000, 'acme'),
      derived('acme-leak', ['acme-leak-parent'], 4_000, 'acme'),
      raw('globex-parent', 9_000, 'globex'),
      derived('globex-leak', ['globex-parent'], 8_000, 'globex'),
    );
    const acmeReport = knowledgeLeakageScan(mixed, requireTenantId('acme'));
    expect(acmeReport.clean).toBe(false);
    expect(acmeReport.recordsChecked).toBe(2); // only acme records
    const finding = acmeReport.findings[0];
    if (finding?.kind === 'leaky_record') expect(finding.record_id).toBe('acme-leak');

    const globexReport = knowledgeLeakageScan(mixed, requireTenantId('globex'));
    const globexFinding = globexReport.findings[0];
    if (globexFinding?.kind === 'leaky_record') expect(globexFinding.record_id).toBe('globex-leak');
  });
});

describe('knowledgeLeakageScan — determinism and immutability of reports', () => {
  it('scanning the same base twice produces deep-equal reports, frozen', () => {
    const leaky = load(
      raw('r1', 10_000),
      derived('d1', ['r1'], 9_000),
    );
    const first = knowledgeLeakageScan(leaky);
    const second = knowledgeLeakageScan(leaky);
    expect(first).toEqual(second);
    expect(isDeeplyFrozen(first)).toBe(true);
    const mutable = first as unknown as { clean: boolean };
    expect(() => {
      mutable.clean = true;
    }).toThrow();
  });
});

describe('requireCleanKnowledgeBase — the typed gate', () => {
  it('passes clean bases and surfaces typed errors for leaky ones', () => {
    const clean = load(raw('t1', 1_000), derived('f1', ['t1'], 1_500));
    expect(requireCleanKnowledgeBase(clean).ok).toBe(true);

    const leaky = load(raw('r1', 10_000), derived('d1', ['r1'], 9_000));
    const gate = requireCleanKnowledgeBase(leaky);
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.error.code).toBe('derived_before_inputs');

    const crossing = load(raw('a', 1_000, 'acme'), raw('g', 2_000, 'globex'), derived('gd', ['g', 'a'], 5_000, 'globex'));
    const crossingGate = requireCleanKnowledgeBase(crossing);
    expect(crossingGate.ok).toBe(false);
    if (!crossingGate.ok) expect(crossingGate.error.code).toBe('tenant_isolation');

    const missing = load(raw('t1', 1_000), derived('orphan', ['ghost'], 5_000));
    const missingGate = requireCleanKnowledgeBase(missing);
    expect(missingGate.ok).toBe(false);
    if (!missingGate.ok) expect(missingGate.error.code).toBe('unknown_input');
  });
});

/** Local unwrappers to keep this file self-contained. */
function unwrapAppend(value: ReturnType<typeof appendKnowledgeRecord>): KnowledgeBase {
  if (value.ok) return value.value;
  throw new Error(`unexpected failure: ${value.error.code}: ${value.error.message}`);
}
