/**
 * @tradrl/firm-memory — the contradiction record's mint laws: the
 * opposition law (the sides must oppose), the deterministic ordering
 * law (the incumbent/`fkr:` side first; batch-internal sides in
 * polarity-lexicographic order), the side coherence laws
 * (unit-interval confidences, evidence counts vs outcome refs,
 * `out:` prefixes, sorted-unique), and the content-address
 * determinism.
 */

import { describe, expect, it } from 'vitest';
import { mintContradictionRecord, type ContradictionRecord, type ContradictionSide } from './contradiction';
import { asTimestampMs, deepFreeze } from './primitives';

const T0 = 1_700_000_000_000;

/** A minimal VALID side (the mint's baseline fixture). */
function side(overrides: Record<string, unknown> = {}): ContradictionSide {
  return deepFreeze({
    knowledgeRef: null,
    polarity: 'adverse',
    confidence: '0.5',
    evidenceCount: 3,
    outcomeRefs: ['out:00000001', 'out:00000002', 'out:00000003'],
    ...overrides,
  } as ContradictionSide);
}

/** A minimal VALID contradiction record. */
function baseRecord(overrides: Record<string, unknown> = {}): Omit<ContradictionRecord, 'contradictionId'> {
  return deepFreeze({
    ordinal: 1,
    tenant: 'tenant-alpha',
    project: 'project-alpha',
    claimKey: '{"kind":"market_behavior","lagBand":null,"project":"project-alpha","tenant":"tenant-alpha","dimension":null}',
    sides: [side({ polarity: 'adverse' }), side({ polarity: 'favorable' })],
    asOf: asTimestampMs(T0),
    priorChainHead: '00000000',
    ...overrides,
  } as unknown as Omit<ContradictionRecord, 'contradictionId'>);
}

describe('the opposition law', () => {
  it('two agreeing sides are NOT a contradiction — the typed invalid_state', () => {
    const result = mintContradictionRecord(baseRecord({ sides: [side({ polarity: 'adverse' }), side({ polarity: 'adverse' })] }));
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('invalid_state');
  });
});

describe('the deterministic ordering law', () => {
  it('the incumbent (fkr:-ref) side must be sides[0]', () => {
    const incumbent = side({ knowledgeRef: 'fkr:aaaaaaaa', polarity: 'adverse' });
    const challenger = side({ polarity: 'favorable' });
    const wrongOrder = mintContradictionRecord(baseRecord({ sides: [challenger, incumbent] }));
    if (wrongOrder.ok) throw new Error('must fail');
    expect(wrongOrder.errors[0]?.code).toBe('invalid_state');

    const rightOrder = mintContradictionRecord(baseRecord({ sides: [incumbent, challenger] }));
    expect(rightOrder.ok).toBe(true);
  });

  it('batch-internal sides are polarity-lexicographic ascending', () => {
    const ascending = mintContradictionRecord(baseRecord({ sides: [side({ polarity: 'adverse' }), side({ polarity: 'favorable' })] }));
    expect(ascending.ok).toBe(true);
    const descending = mintContradictionRecord(baseRecord({ sides: [side({ polarity: 'favorable' }), side({ polarity: 'adverse' })] }));
    if (descending.ok) throw new Error('must fail');
    expect(descending.errors[0]?.code).toBe('invalid_state');
  });

  it('two fkr: refs on both sides is the typed invalid_state (a contest is one incumbent vs one candidate)', () => {
    const result = mintContradictionRecord(baseRecord({ sides: [side({ knowledgeRef: 'fkr:aaaaaaaa', polarity: 'adverse' }), side({ knowledgeRef: 'fkr:bbbbbbbb', polarity: 'favorable' })] }));
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('invalid_state');
  });
});

describe('the side coherence laws', () => {
  it('a JS-number confidence is decimal_imprecision; an out-of-interval one is confidence_incoherent', () => {
    const numeric = mintContradictionRecord(baseRecord({ sides: [side({ confidence: 0.5 }), side({ polarity: 'favorable' })] }));
    if (numeric.ok) throw new Error('must fail');
    expect(numeric.errors[0]?.code).toBe('decimal_imprecision');

    const incoherent = mintContradictionRecord(baseRecord({ sides: [side({ confidence: '1.5' }), side({ polarity: 'favorable' })] }));
    if (incoherent.ok) throw new Error('must fail');
    expect(incoherent.errors[0]?.code).toBe('confidence_incoherent');
  });

  it('evidenceCount must not exceed the side outcome refs; refs must be out:-prefixed and sorted-unique', () => {
    const over = mintContradictionRecord(baseRecord({ sides: [side({ evidenceCount: 4 }), side({ polarity: 'favorable' })] }));
    if (over.ok) throw new Error('must fail');
    expect(over.errors[0]?.code).toBe('invalid_state');

    const wrongPrefix = mintContradictionRecord(baseRecord({ sides: [side({ outcomeRefs: ['pmr:1', 'out:2', 'out:3'] }), side({ polarity: 'favorable' })] }));
    if (wrongPrefix.ok) throw new Error('must fail');
    expect(wrongPrefix.errors[0]?.code).toBe('invalid_field');

    const duplicated = mintContradictionRecord(baseRecord({ sides: [side({ outcomeRefs: ['out:2', 'out:1', 'out:2'] }), side({ polarity: 'favorable' })] }));
    if (duplicated.ok) throw new Error('must fail');
    expect(duplicated.errors[0]?.code).toBe('invalid_state');
  });

  it('a malformed knowledgeRef is the typed invalid_field (fkr: prefix discipline)', () => {
    const result = mintContradictionRecord(baseRecord({ sides: [side({ knowledgeRef: 'out:00000001' }), side({ polarity: 'favorable' })] }));
    if (result.ok) throw new Error('must fail');
    expect(result.errors[0]?.code).toBe('invalid_field');
  });
});

describe('the record-level laws', () => {
  it('missing scope/ordinal/instant/prior head/claimKey are typed invalid_field', () => {
    for (const [overrides, path] of [
      [{ tenant: '' }, 'tenant'],
      [{ ordinal: 0 }, 'ordinal'],
      [{ asOf: -1 }, 'asOf'],
      [{ priorChainHead: '' }, 'priorChainHead'],
      [{ claimKey: '' }, 'claimKey'],
    ] as const) {
      const result = mintContradictionRecord(baseRecord(overrides as Record<string, unknown>));
      if (result.ok) throw new Error('must fail');
      expect(result.errors[0]?.code).toBe('invalid_field');
      expect(result.errors[0]?.path).toBe(path);
    }
  });
});

describe('the content-address determinism', () => {
  it('identical content → identical fkc: id; the record is deeply frozen', () => {
    const first = mintContradictionRecord(baseRecord());
    const second = mintContradictionRecord(baseRecord());
    if (!first.ok || !second.ok) throw new Error('the baseline must mint');
    expect(first.value.contradictionId).toBe(second.value.contradictionId);
    expect(first.value.contradictionId).toMatch(/^fkc:[0-9a-f]{8}$/);
    expect(Object.isFrozen(first.value)).toBe(true);
    expect(Object.isFrozen(first.value.sides[0])).toBe(true);
  });
});
