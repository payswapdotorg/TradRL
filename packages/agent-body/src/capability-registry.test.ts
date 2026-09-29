// @tradrl/agent-body — capability-registry behavioral tests (T016).
//
// Laws under test (see capability-registry.ts for spec anchors):
// - L16a / "Never equate model and profession": label-as-evidence is a
//   TYPED violation (negative paths), measured evidence passes (positive).
// - Snapshot set semantics + canonical digest (L9 lineage anchor).
// - Query-by-capability-contract is pure filtering.
// - Self-containment (additivity law, D-006/D-007): the registry module
//   imports NOTHING — asserted by a source scan.
// - The JSON examples in contracts/agent/capability-registry.md are
//   machine-validated: a documented example that fails its guard fails
//   `pnpm verify`.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  type CapabilityQuery,
  type CapabilityRecord,
  type RegistrySnapshot,
  CAPABILITY_EVIDENCE_KINDS,
  LABEL_EVIDENCE_KEYS,
  MEASUREMENT_METRICS,
  capabilityKey,
  capabilityRecordId,
  createCapabilityRecord,
  createRegistrySnapshot,
  isCapabilityQuery,
  isCapabilityRecord,
  isCapabilityRecordViolationCode,
  isRegistrySnapshot,
  isMeasuredEvidence,
  labelKeyPaths,
  queryByCapability,
  registryCanonicalJson,
  registryDigestOf,
  registryStableDigest,
  validateCapabilityRecord,
  validateRegistrySnapshot,
} from './capability-registry';

// ---------------------------------------------------------------------------
// Fixtures (measured evidence ONLY — the legal form of a capability claim)
// ---------------------------------------------------------------------------

const mathBodyRecord: CapabilityRecord = createCapabilityRecord({
  recordId: capabilityRecordId('capreg-body-mathresearcher-0001'),
  subject: { kind: 'body-version', bodyVersionRef: 'math-researcher@1.0.0' },
  descriptors: [
    {
      capability: capabilityKey('mathematical-reasoning'),
      evidence: [
        { kind: 'benchmark', benchmarkId: 'bench/olympiad-mix-v3', resultRef: 'result/bench/olympiad-mix-v3/math-researcher@1.0.0' },
        { kind: 'measurement-record', recordRef: 'meas/math-researcher/proof-depth-2026-02', metric: 'benchmark-score', value: 0.87 },
      ],
    },
    {
      capability: capabilityKey('stochastic-process-analysis'),
      evidence: [
        { kind: 'measurement-record', recordRef: 'meas/math-researcher/stochastic-2026-02', metric: 'benchmark-score', value: 0.79 },
      ],
    },
  ],
  compatibilityRefs: ['compat/math-researcher@1.0.0/frontier-reasoner'],
});

const substrateRecord: CapabilityRecord = createCapabilityRecord({
  recordId: capabilityRecordId('capreg-substrate-limite-0001'),
  subject: { kind: 'cognitive-substrate', substrateRef: 'limite-labs/limite-math@2026.01' },
  descriptors: [
    {
      capability: capabilityKey('mathematical-reasoning'),
      evidence: [
        { kind: 'benchmark', benchmarkId: 'bench/olympiad-mix-v3', resultRef: 'result/bench/olympiad-mix-v3/limite-math@2026.01' },
        { kind: 'measurement-record', recordRef: 'meas/limite-math/latency-2026-02', metric: 'p95-latency-ms', value: 1850 },
      ],
    },
  ],
  compatibilityRefs: [],
});

const fastSubstrateRecord: CapabilityRecord = createCapabilityRecord({
  recordId: capabilityRecordId('capreg-substrate-swift-0001'),
  subject: { kind: 'cognitive-substrate', substrateRef: 'delta-labs/swift-1@2026.02' },
  descriptors: [
    {
      capability: capabilityKey('regime-analysis'),
      evidence: [
        { kind: 'measurement-record', recordRef: 'meas/swift-1/regime-2026-02', metric: 'benchmark-score', value: 0.64 },
        { kind: 'measurement-record', recordRef: 'meas/swift-1/cost-2026-02', metric: 'compute-units', value: 3 },
      ],
    },
    {
      capability: capabilityKey('risk-assessment'),
      evidence: [{ kind: 'result-ref', resultRef: 'result/risk-suite/swift-1@2026.02' }],
    },
  ],
  compatibilityRefs: [],
});

const snapshot: RegistrySnapshot = createRegistrySnapshot([
  fastSubstrateRecord,
  mathBodyRecord,
  substrateRecord,
]);

// ---------------------------------------------------------------------------
// Positive paths: measured evidence is the ONLY legal capability claim
// ---------------------------------------------------------------------------

describe('measured-evidence records pass the full law (L16a positive)', () => {
  it('the fixture records pass their guards and validation', () => {
    for (const record of [mathBodyRecord, substrateRecord, fastSubstrateRecord]) {
      expect(isCapabilityRecord(record)).toBe(true);
      expect(validateCapabilityRecord(record).valid).toBe(true);
    }
  });

  it('every evidence kind in the closed union is individually guarded', () => {
    expect(CAPABILITY_EVIDENCE_KINDS).toEqual(['benchmark', 'measurement-record', 'result-ref']);
    expect(isMeasuredEvidence({ kind: 'benchmark', benchmarkId: 'b', resultRef: 'r' })).toBe(true);
    expect(isMeasuredEvidence({ kind: 'measurement-record', recordRef: 'm', metric: 'compute-units', value: 2 })).toBe(true);
    expect(isMeasuredEvidence({ kind: 'result-ref', resultRef: 'r' })).toBe(true);
  });

  it('every structured metric in the closed vocabulary is accepted', () => {
    expect(MEASUREMENT_METRICS).toContain('p50-latency-ms');
    for (const metric of MEASUREMENT_METRICS) {
      expect(
        isMeasuredEvidence({ kind: 'measurement-record', recordRef: 'm', metric, value: 1 }),
      ).toBe(true);
    }
    expect(isMeasuredEvidence({ kind: 'measurement-record', recordRef: 'm', metric: 'vibes', value: 1 })).toBe(false);
  });

  it('records are deeply frozen by the factory', () => {
    expect(Object.isFrozen(mathBodyRecord)).toBe(true);
    expect(Object.isFrozen(mathBodyRecord.descriptors[0])).toBe(true);
    expect(() => {
      (mathBodyRecord as unknown as { compatibilityRefs: string[] }).compatibilityRefs.push('x');
    }).toThrow();
  });

  it('records survive a JSON round-trip unchanged (INV-0.1)', () => {
    const roundTrip: unknown = JSON.parse(JSON.stringify(mathBodyRecord));
    expect(isCapabilityRecord(roundTrip)).toBe(true);
    expect(roundTrip).toEqual(mathBodyRecord);
  });
});

// ---------------------------------------------------------------------------
// L16a trip-wires: label-as-evidence is a TYPED error
// ---------------------------------------------------------------------------

describe('L16a trip-wire: labels never establish suitability (negative paths)', () => {
  it('a profession label as evidence field fails the guard and validation with label-as-evidence', () => {
    // The classic smuggle: `model -> mathematician`.
    const labeled: unknown = {
      recordId: 'capreg-substrate-bad-0001',
      subject: { kind: 'cognitive-substrate', substrateRef: 'acme-models/reasoner-2@2026.03' },
      descriptors: [
        {
          capability: 'mathematical-reasoning',
          evidence: [{ kind: 'result-ref', resultRef: 'result/x' }],
          profession: 'mathematician',
        },
      ],
      compatibilityRefs: [],
    };
    expect(isCapabilityRecord(labeled)).toBe(false);
    const validation = validateCapabilityRecord(labeled);
    expect(validation.valid).toBe(false);
    expect(
      validation.violations.some(
        (v) => v.code === 'label-as-evidence' && v.path.includes('profession'),
      ),
    ).toBe(true);
    expect(() => createCapabilityRecord(labeled)).toThrow(/label-as-evidence/);
  });

  it('a `kind: "label"` evidence entry is rejected as label-as-evidence (not generic invalid)', () => {
    const labelEvidence: unknown = {
      recordId: 'capreg-substrate-bad-0002',
      subject: { kind: 'cognitive-substrate', substrateRef: 'acme-models/reasoner-2@2026.03' },
      descriptors: [
        {
          capability: 'mathematical-reasoning',
          evidence: [{ kind: 'label', label: 'mathematician' }],
        },
      ],
      compatibilityRefs: [],
    };
    const validation = validateCapabilityRecord(labelEvidence);
    expect(validation.valid).toBe(false);
    expect(validation.violations.some((v) => v.code === 'label-as-evidence')).toBe(true);
    expect(isCapabilityRecord(labelEvidence)).toBe(false);
  });

  it('a record-level role label is rejected anywhere in the JSON tree', () => {
    const roleLabeled: unknown = {
      recordId: 'capreg-substrate-bad-0003',
      subject: { kind: 'cognitive-substrate', substrateRef: 'acme-models/reasoner-2@2026.03' },
      descriptors: [
        {
          capability: 'regime-analysis',
          evidence: [{ kind: 'result-ref', resultRef: 'result/y' }],
        },
      ],
      compatibilityRefs: [],
      role: 'regime-analyst',
    };
    expect(labelKeyPaths(roleLabeled)).toEqual(['role']);
    expect(isCapabilityRecord(roleLabeled)).toBe(false);
    expect(validateCapabilityRecord(roleLabeled).violations.some((v) => v.code === 'label-as-evidence')).toBe(true);
  });

  it('the label key vocabulary is closed and guarded', () => {
    expect(LABEL_EVIDENCE_KEYS).toContain('label');
    expect(LABEL_EVIDENCE_KEYS).toContain('profession');
    expect(LABEL_EVIDENCE_KEYS).toContain('role');
    for (const key of LABEL_EVIDENCE_KEYS) {
      expect(labelKeyPaths({ [key]: 'x' })).toEqual([key]);
    }
  });

  it('a descriptor with NO evidence is the no-measured-evidence violation', () => {
    const bare: unknown = {
      recordId: 'capreg-substrate-bad-0004',
      subject: { kind: 'cognitive-substrate', substrateRef: 'acme-models/reasoner-2@2026.03' },
      descriptors: [{ capability: 'mathematical-reasoning', evidence: [] }],
      compatibilityRefs: [],
    };
    const validation = validateCapabilityRecord(bare);
    expect(validation.valid).toBe(false);
    expect(validation.violations.some((v) => v.code === 'no-measured-evidence')).toBe(true);
    expect(() => createCapabilityRecord(bare)).toThrow(/no-measured-evidence/);
  });

  it('duplicate capability keys within one record are a typed violation', () => {
    const duplicated: unknown = {
      recordId: 'capreg-substrate-bad-0005',
      subject: { kind: 'cognitive-substrate', substrateRef: 'acme-models/reasoner-2@2026.03' },
      descriptors: [
        { capability: 'regime-analysis', evidence: [{ kind: 'result-ref', resultRef: 'r1' }] },
        { capability: 'regime-analysis', evidence: [{ kind: 'result-ref', resultRef: 'r2' }] },
      ],
      compatibilityRefs: [],
    };
    expect(validateCapabilityRecord(duplicated).violations.some((v) => v.code === 'duplicate-capability')).toBe(true);
    expect(isCapabilityRecord(duplicated)).toBe(false);
  });

  it('malformed subjects and ids are invalid-field violations (collect-all)', () => {
    const malformed: unknown = {
      recordId: 'not a valid id!',
      subject: { kind: 'body', ref: 'x' },
      descriptors: [],
      compatibilityRefs: 'nope',
    };
    const validation = validateCapabilityRecord(malformed);
    expect(validation.valid).toBe(false);
    expect(validation.violations.length).toBeGreaterThanOrEqual(4);
    expect(validation.violations.every((v) => v.code === 'invalid-field')).toBe(true);
  });

  it('the violation-code vocabulary is closed and guarded', () => {
    expect(isCapabilityRecordViolationCode('label-as-evidence')).toBe(true);
    expect(isCapabilityRecordViolationCode('no-measured-evidence')).toBe(true);
    expect(isCapabilityRecordViolationCode('duplicate-capability')).toBe(true);
    expect(isCapabilityRecordViolationCode('invalid-field')).toBe(true);
    expect(isCapabilityRecordViolationCode('totally-fine')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Snapshot: immutable set + canonical digest (L9)
// ---------------------------------------------------------------------------

describe('registry snapshots (set semantics + canonical digest)', () => {
  it('the snapshot is deeply frozen and structurally valid', () => {
    expect(isRegistrySnapshot(snapshot)).toBe(true);
    expect(validateRegistrySnapshot(snapshot).valid).toBe(true);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.records)).toBe(true);
  });

  it('set semantics: input order does not change the snapshot (deep-equal, same digest)', () => {
    const other = createRegistrySnapshot([mathBodyRecord, substrateRecord, fastSubstrateRecord]);
    expect(other).toEqual(snapshot);
    expect(other.digest).toBe(snapshot.digest);
  });

  it('the digest is deterministic across JSON round-trips', () => {
    const roundTrip = JSON.parse(JSON.stringify(snapshot)) as unknown;
    const result = validateRegistrySnapshot(roundTrip);
    expect(result.valid).toBe(true);
    expect(result.digestMismatch).toBe(false);
  });

  it('the digest changes when the record set changes', () => {
    const other = createRegistrySnapshot([mathBodyRecord, substrateRecord]);
    expect(other.digest).not.toBe(snapshot.digest);
    expect(registryDigestOf([mathBodyRecord])).not.toBe(registryDigestOf([substrateRecord]));
  });

  it('duplicate record ids are rejected at construction', () => {
    expect(() =>
      createRegistrySnapshot([mathBodyRecord, mathBodyRecord]),
    ).toThrow(/duplicate record id/);
  });

  it('a doctored digest is a lineage forgery (L9) — digest-mismatch', () => {
    const doctored: unknown = {
      records: snapshot.records,
      digest: '0000000000000000',
    };
    const result = validateRegistrySnapshot(doctored);
    expect(result.valid).toBe(false);
    expect(result.digestMismatch).toBe(true);
  });

  it('a snapshot containing a labeled record fails validation (L16a at snapshot level)', () => {
    const labeled: unknown = {
      recordId: 'capreg-substrate-bad-0006',
      subject: { kind: 'cognitive-substrate', substrateRef: 'acme-models/reasoner-2@2026.03' },
      descriptors: [
        { capability: 'risk-assessment', evidence: [{ kind: 'result-ref', resultRef: 'r' }], roleLabel: 'risk officer' },
      ],
      compatibilityRefs: [],
    };
    const result = validateRegistrySnapshot({ records: [labeled, mathBodyRecord], digest: 'aaaaaaaaaaaaaaaa' });
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.code === 'label-as-evidence')).toBe(true);
    expect(() => createRegistrySnapshot([labeled])).toThrow(/label-as-evidence/);
  });
});

// ---------------------------------------------------------------------------
// Query-by-capability-contract (pure filtering)
// ---------------------------------------------------------------------------

describe('queryByCapability (pure filtering)', () => {
  it('matches records that demonstrate every required key', () => {
    const query: CapabilityQuery = {
      requires: [capabilityKey('mathematical-reasoning')],
    };
    expect(isCapabilityQuery(query)).toBe(true);
    const matches = queryByCapability(snapshot, query);
    expect(matches.map((record) => record.recordId).sort()).toEqual(
      ['capreg-body-mathresearcher-0001', 'capreg-substrate-limite-0001'].sort(),
    );
  });

  it('a multi-key contract requires ALL keys on one record', () => {
    const query: CapabilityQuery = {
      requires: [capabilityKey('mathematical-reasoning'), capabilityKey('stochastic-process-analysis')],
    };
    const matches = queryByCapability(snapshot, query);
    expect(matches.map((record) => record.recordId)).toEqual(['capreg-body-mathresearcher-0001']);
  });

  it('an unknown capability key matches nothing', () => {
    const matches = queryByCapability(snapshot, {
      requires: [capabilityKey('sentiment-event-analysis')],
    });
    expect(matches).toHaveLength(0);
  });

  it('the query guard rejects empty, duplicate and malformed requires', () => {
    expect(isCapabilityQuery({ requires: [] })).toBe(false);
    expect(isCapabilityQuery({ requires: [capabilityKey('x'), capabilityKey('x')] })).toBe(false);
    expect(isCapabilityQuery({ requires: [capabilityKey('x'), 'not a key!'] })).toBe(false);
    expect(isCapabilityQuery({ requires: 'mathematical-reasoning' })).toBe(false);
  });

  it('querying is pure: the snapshot is unchanged', () => {
    const before = JSON.stringify(snapshot);
    queryByCapability(snapshot, { requires: [capabilityKey('regime-analysis')] });
    queryByCapability(snapshot, { requires: [capabilityKey('risk-assessment')] });
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Canonical serialization + digest stability (byte-determinism)
// ---------------------------------------------------------------------------

describe('canonical JSON and stable digests', () => {
  it('canonical JSON sorts object keys recursively', () => {
    expect(registryCanonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(registryCanonicalJson([3, 1, { z: 1, a: 2 }])).toBe('[3,1,{"a":2,"z":1}]');
    expect(registryCanonicalJson(null)).toBe('null');
    expect(registryCanonicalJson('x')).toBe('"x"');
    expect(registryCanonicalJson(true)).toBe('true');
  });

  it('equal records with different key insertion order canonicalize identically', () => {
    const a = registryCanonicalJson({ x: { y: 1, z: 2 }, w: 3 });
    const b = registryCanonicalJson({ w: 3, x: { z: 2, y: 1 } });
    expect(a).toBe(b);
  });

  it('stable digests are deterministic and change-detecting', () => {
    expect(registryStableDigest('{"a":1}')).toBe(registryStableDigest('{"a":1}'));
    expect(registryStableDigest('{"a":1}')).not.toBe(registryStableDigest('{"a":2}'));
    expect(registryStableDigest('{"a":1}')).not.toBe(registryStableDigest('{"a":1,"b":2}'));
    expect(registryStableDigest('')).toMatch(/^[0-9a-f]{16}$/);
  });
});

// ---------------------------------------------------------------------------
// Additivity trip-wire: the registry module is SELF-CONTAINED
// ---------------------------------------------------------------------------

describe('additivity trip-wire (D-006/D-007): self-containment', () => {
  it('capability-registry.ts contains no import statements at all', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./capability-registry.ts', import.meta.url)),
      'utf8',
    );
    // No static imports, no re-exports from other modules, no dynamic imports.
    expect(/^import\s/m.test(source)).toBe(false);
    expect(/^export\s+.*\bfrom\b/m.test(source)).toBe(false);
    expect(/^export\s*\*\s*from\b/m.test(source)).toBe(false);
    expect(/\brequire\s*\(/.test(source)).toBe(false);
    expect(/\bimport\s*\(/.test(source)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Contract document law: contracts/agent/capability-registry.md examples are
// machine-validated (a documented example that fails its guard fails verify)
// ---------------------------------------------------------------------------

describe('contracts/agent/capability-registry.md examples are machine-validated', () => {
  const DOC = fileURLToPath(new URL('../../../contracts/agent/capability-registry.md', import.meta.url));

  function extractJsonBlocks(markdown: string): string[] {
    const blocks: string[] = [];
    const pattern = /```json\s*\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(markdown)) !== null) blocks.push(match[1] as string);
    return blocks;
  }

  it('every documented JSON example passes its guard', () => {
    const markdown = readFileSync(DOC, 'utf8');
    const blocks = extractJsonBlocks(markdown);
    expect(blocks.length).toBe(3); // two capability records + one query
    const parsed = blocks.map((block) => JSON.parse(block) as unknown);
    expect(validateCapabilityRecord(parsed[0]).valid).toBe(true);
    expect(isCapabilityRecord(parsed[0])).toBe(true);
    expect(validateCapabilityRecord(parsed[1]).valid).toBe(true);
    expect(isCapabilityRecord(parsed[1])).toBe(true);
    expect(isCapabilityQuery(parsed[2])).toBe(true);
  });

  it('the documented examples round-trip through the registry snapshot law', () => {
    const markdown = readFileSync(DOC, 'utf8');
    const blocks = extractJsonBlocks(markdown).map((block) => JSON.parse(block) as unknown);
    const recordA = blocks[0] as CapabilityRecord;
    const recordB = blocks[1] as CapabilityRecord;
    const docSnapshot = createRegistrySnapshot([recordA, recordB]);
    expect(validateRegistrySnapshot(JSON.parse(JSON.stringify(docSnapshot))).valid).toBe(true);
  });

  it('the document map in contracts/agent/README.md carries the capability-registry row', () => {
    const readme = readFileSync(
      fileURLToPath(new URL('../../../contracts/agent/README.md', import.meta.url)),
      'utf8',
    );
    expect(readme).toMatch(/\[capability-registry\.md\]\(capability-registry\.md\)/);
  });

  it('the documented L16a negative example (a text block, never json) cites the law', () => {
    const markdown = readFileSync(DOC, 'utf8');
    expect(markdown).toContain('label-as-evidence');
    expect(markdown).toContain('Never equate model and profession');
    // The rejected shape is documented but NOT as a validatable json block.
    const jsonBlocks = extractJsonBlocks(markdown);
    for (const block of jsonBlocks) {
      const parsed: unknown = JSON.parse(block);
      expect(validateCapabilityRecord(parsed).valid || isCapabilityQuery(parsed)).toBe(true);
    }
  });
});
