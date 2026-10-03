/**
 * @tradrl/firm-memory — the firm-knowledge record's mint laws: the
 * exact-decimal trip wires, the confidence unit-interval law, the L9
 * provenance laws (non-empty, prefix-checked, sorted-unique), the
 * evidence-count coherence law, the validity-window laws, the scope
 * and chain-witness laws, and the content-address determinism.
 */

import { describe, expect, it } from 'vitest';
import { fail } from './errors';
import { canonicalJson, deepFreeze } from './primitives';
import { firmKnowledgeContentTree, mintFirmKnowledgeRecord, sortedUniqueRefs, windowCovers, type FirmKnowledgeRecord } from './record';
import { asTimestampMs } from './primitives';

const T0 = 1_700_000_000_000;

/** A minimal VALID record (the mint's baseline fixture). */
function baseRecord(overrides: Record<string, unknown> = {}): Omit<FirmKnowledgeRecord, 'knowledgeId'> {
  return deepFreeze({
    ordinal: 1,
    tenant: 'tenant-alpha',
    project: 'project-alpha',
    claim: { kind: 'market_behavior', polarity: 'adverse', dimension: null, lagBand: null },
    confidence: '0.5',
    evidenceCount: 3,
    provenance: {
      postMortemRefs: ['pmr:00000001', 'pmr:00000002', 'pmr:00000003'],
      outcomeRefs: ['out:00000001', 'out:00000002', 'out:00000003'],
      experimentRefs: [],
      trialRefs: [],
      trajectoryRefs: [],
      sessionRefs: ['shs:aaaa0001'],
    },
    validity: { from: asTimestampMs(T0), to: asTimestampMs(T0 + 2_592_000_000) },
    asOf: asTimestampMs(T0),
    priorChainHead: '00000000',
    ...overrides,
  } as unknown as Omit<FirmKnowledgeRecord, 'knowledgeId'>);
}

describe('the exact-decimal trip wires', () => {
  it('a JS number on the confidence path is the typed decimal_imprecision', () => {
    const result = mintFirmKnowledgeRecord(baseRecord({ confidence: 0.5 }));
    if (result.ok) throw new Error('a numeric confidence must fail');
    expect(result.errors[0]?.code).toBe('decimal_imprecision');
    expect(result.errors[0]?.path).toBe('confidence');
  });

  it('a confidence outside the unit interval is the typed confidence_incoherent', () => {
    for (const bad of ['1.5', '2', '-0.1', '0.4.5', '']) {
      const result = mintFirmKnowledgeRecord(baseRecord({ confidence: bad }));
      if (result.ok) throw new Error(`confidence ${JSON.stringify(bad)} must fail`);
      expect(result.errors[0]?.code).toBe('confidence_incoherent');
    }
  });
});

describe('the provenance laws (L9)', () => {
  it('knowledge without post-mortems/outcomes/sessions dangles — the typed lineage_gap', () => {
    const noPostMortems = mintFirmKnowledgeRecord(baseRecord({ provenance: { postMortemRefs: [], outcomeRefs: ['out:1'], experimentRefs: [], trialRefs: [], trajectoryRefs: [], sessionRefs: ['shs:1'] } }));
    if (noPostMortems.ok) throw new Error('must fail');
    expect(noPostMortems.errors[0]?.code).toBe('lineage_gap');

    const noOutcomes = mintFirmKnowledgeRecord(baseRecord({ provenance: { postMortemRefs: ['pmr:1'], outcomeRefs: [], experimentRefs: [], trialRefs: [], trajectoryRefs: [], sessionRefs: ['shs:1'] } }));
    if (noOutcomes.ok) throw new Error('must fail');
    expect(noOutcomes.errors[0]?.code).toBe('lineage_gap');

    const noSessions = mintFirmKnowledgeRecord(baseRecord({ provenance: { postMortemRefs: ['pmr:1'], outcomeRefs: ['out:1'], experimentRefs: [], trialRefs: [], trajectoryRefs: [], sessionRefs: [] } }));
    if (noSessions.ok) throw new Error('must fail');
    expect(noSessions.errors[0]?.code).toBe('lineage_gap');
  });

  it('prefix-discipline violations are typed invalid_field', () => {
    const result = mintFirmKnowledgeRecord(baseRecord({ provenance: { postMortemRefs: ['out:00000001'], outcomeRefs: ['out:00000001'], experimentRefs: [], trialRefs: [], trajectoryRefs: [], sessionRefs: ['shs:aaaa0001'] } }));
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('invalid_field');
    expect(result.errors[0]?.path).toBe('provenance.postMortemRefs');
  });

  it('duplicate refs are the typed invalid_state (sorted-unique is a construction law)', () => {
    const result = mintFirmKnowledgeRecord(baseRecord({ provenance: { postMortemRefs: ['pmr:00000002', 'pmr:00000001', 'pmr:00000002'], outcomeRefs: ['out:1', 'out:2', 'out:3'], experimentRefs: [], trialRefs: [], trajectoryRefs: [], sessionRefs: ['shs:1'] } }));
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('invalid_state');
  });

  it('sortedUniqueRefs normalizes byte-stably', () => {
    expect(sortedUniqueRefs(['b', 'a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(sortedUniqueRefs([])).toEqual([]);
  });
});

describe('the evidence-count coherence law', () => {
  it('evidenceCount cannot exceed the distinct outcome refs; cannot be below 1', () => {
    const over = mintFirmKnowledgeRecord(baseRecord({ evidenceCount: 4 }));
    if (over.ok) throw new Error('must fail');
    expect(over.errors[0]?.code).toBe('invalid_state');
    const under = mintFirmKnowledgeRecord(baseRecord({ evidenceCount: 0 }));
    if (under.ok) throw new Error('must fail');
    expect(under.errors[0]?.code).toBe('invalid_field');
  });
});

describe('the validity-window laws (L4)', () => {
  it('a non-positive window is the typed invalid_state', () => {
    const result = mintFirmKnowledgeRecord(baseRecord({ validity: { from: asTimestampMs(T0), to: asTimestampMs(T0) } }));
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('invalid_state');
  });

  it('the window opens EXACTLY at the promotion instant (the coherence law)', () => {
    const result = mintFirmKnowledgeRecord(baseRecord({ validity: { from: asTimestampMs(T0 + 1), to: asTimestampMs(T0 + 2_592_000_000) } }));
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('invalid_state');
    expect(result.errors[0]?.path).toBe('validity.from');
  });

  it('windowCovers is [from, to) — half-open', () => {
    const window = { from: asTimestampMs(T0), to: asTimestampMs(T0 + 1000) };
    expect(windowCovers(window, asTimestampMs(T0))).toBe(true);
    expect(windowCovers(window, asTimestampMs(T0 + 999))).toBe(true);
    expect(windowCovers(window, asTimestampMs(T0 + 1000))).toBe(false);
    expect(windowCovers(window, asTimestampMs(T0 - 1))).toBe(false);
  });
});

describe('the scope + chain-witness laws', () => {
  it('missing tenant/project/ordinal/asOf/priorChainHead are typed invalid_field', () => {
    for (const [overrides, path] of [
      [{ tenant: '' }, 'tenant'],
      [{ project: '' }, 'tenant'],
      [{ ordinal: 0 }, 'ordinal'],
      [{ asOf: -1 }, 'asOf'],
      [{ priorChainHead: '' }, 'priorChainHead'],
    ] as const) {
      const result = mintFirmKnowledgeRecord(baseRecord(overrides as Record<string, unknown>));
      if (result.ok) throw new Error('must fail');
      expect(result.errors[0]?.code).toBe('invalid_field');
      expect(result.errors[0]?.path).toBe(path);
    }
  });
});

describe('the content-address determinism (L9)', () => {
  it('identical content → identical fkr: id; any field change → different id', () => {
    const first = mintFirmKnowledgeRecord(baseRecord());
    const second = mintFirmKnowledgeRecord(baseRecord());
    if (!first.ok || !second.ok) throw new Error('the baseline must mint');
    expect(first.value.knowledgeId).toBe(second.value.knowledgeId);
    expect(first.value.knowledgeId).toMatch(/^fkr:[0-9a-f]{8}$/);

    const changed = mintFirmKnowledgeRecord(baseRecord({ evidenceCount: 2, provenance: { postMortemRefs: ['pmr:00000001', 'pmr:00000002'], outcomeRefs: ['out:00000001', 'out:00000002'], experimentRefs: [], trialRefs: [], trajectoryRefs: [], sessionRefs: ['shs:aaaa0001'] } }));
    if (!changed.ok) throw new Error('must mint');
    expect(changed.value.knowledgeId).not.toBe(first.value.knowledgeId);
  });

  it('the minted record is deeply frozen and JSON-serializable', () => {
    const minted = mintFirmKnowledgeRecord(baseRecord());
    if (!minted.ok) throw new Error('must mint');
    expect(Object.isFrozen(minted.value)).toBe(true);
    expect(Object.isFrozen(minted.value.provenance)).toBe(true);
    expect(Object.isFrozen(minted.value.claim)).toBe(true);
    expect(() => JSON.stringify(minted.value)).not.toThrow();
    expect(() => (minted.value as { confidence: string }).confidence = '0.9').toThrow();
  });

  it('the content tree is the canonical derivation basis (no id self-reference)', () => {
    const minted = mintFirmKnowledgeRecord(baseRecord());
    if (!minted.ok) throw new Error('must mint');
    const tree = canonicalJson(firmKnowledgeContentTree(minted.value));
    expect(tree).not.toContain('fkr:');
    expect(tree).toContain('"ordinal":1');
  });
});
