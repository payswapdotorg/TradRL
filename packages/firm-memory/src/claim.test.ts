/**
 * @tradrl/firm-memory — the claim + vocabulary laws: the closed
 * kind/polarity/lag-band vocabularies (typed errors on unknown), the
 * kind↔polarity/discriminator coherence laws, the family key's
 * byte-stability, the contradiction predicate, the deterministic
 * claim ordering, the outcome-class → harm-polarity derivation and
 * the exact lag-band derivation.
 */

import { describe, expect, it } from 'vitest';
import { claimFamilyKey, claimOrder, claimsContradict, describeClaim, mintKnowledgeClaim, oppositeOf, type KnowledgeClaim } from './claim';
import { fail } from './errors';
import { deriveLagBand, harmPolarityOfOutcome, oppositePolarity, polaritiesForKind, requireKnowledgeKind, requireLagBand, requirePolarityForKind, type KnowledgeKind } from './vocabulary';

const SCOPE = { tenant: 'tenant-alpha', project: 'project-alpha' };

/** A minimal valid claim per kind (the mint's coherence laws' fixtures). */
function claimFor(kind: KnowledgeKind, polarity: string, overrides: Partial<KnowledgeClaim> = {}): KnowledgeClaim {
  const base: KnowledgeClaim = kind === 'decision_pattern'
    ? { kind, polarity: polarity as KnowledgeClaim['polarity'], dimension: 'unresolved', lagBand: null }
    : kind === 'data_latency'
      ? { kind, polarity: polarity as KnowledgeClaim['polarity'], dimension: null, lagBand: 'sub_second' }
      : { kind, polarity: polarity as KnowledgeClaim['polarity'], dimension: null, lagBand: null };
  return { ...base, ...overrides };
}

describe('the closed kind vocabulary (typed error on unknown)', () => {
  it('admits exactly the four kinds; a fifth is the typed unknown_knowledge_kind', () => {
    for (const kind of ['decision_pattern', 'market_behavior', 'model_calibration', 'data_latency'] as const) {
      const result = requireKnowledgeKind(kind);
      expect(result.ok).toBe(true);
    }
    const unknown = requireKnowledgeKind('behavioral_edge');
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.errors[0]?.code).toBe('unknown_knowledge_kind');
  });

  it('the mint rejects a foreign kind through the claim path', () => {
    const result = mintKnowledgeClaim({ kind: 'gut_feeling', polarity: 'harmful', dimension: null, lagBand: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('unknown_knowledge_kind');
  });
});

describe('the polarity law (two opposing values per kind)', () => {
  it('kind↔polarity pairs: each kind admits exactly its own pair', () => {
    expect(polaritiesForKind('decision_pattern')).toEqual(['harmful', 'helpful']);
    expect(polaritiesForKind('data_latency')).toEqual(['harmful', 'helpful']);
    expect(polaritiesForKind('market_behavior')).toEqual(['adverse', 'favorable']);
    expect(polaritiesForKind('model_calibration')).toEqual(['over_projection', 'under_projection']);
  });

  it('a foreign polarity string is the typed unknown_polarity; a cross-kind polarity is the typed invalid_state', () => {
    const foreign = requirePolarityForKind('market_behavior', 'harmful' as string);
    // 'harmful' IS a polarity in the union — but not for market_behavior → invalid_state
    if (foreign.ok) throw new Error('harmful must not be legal for market_behavior');
    expect(foreign.errors[0]?.code).toBe('invalid_state');

    const unknown = requirePolarityForKind('market_behavior', 'bullish');
    if (unknown.ok) throw new Error('bullish must be rejected');
    expect(unknown.errors[0]?.code).toBe('unknown_polarity');
  });

  it('oppositePolarity inverts within the kind pair', () => {
    expect(oppositePolarity('market_behavior', 'adverse')).toBe('favorable');
    expect(oppositePolarity('market_behavior', 'favorable')).toBe('adverse');
    expect(oppositePolarity('model_calibration', 'over_projection')).toBe('under_projection');
    expect(oppositePolarity('decision_pattern', 'harmful')).toBe('helpful');
    expect(oppositePolarity('data_latency', 'helpful')).toBe('harmful');
  });
});

describe('the discriminator coherence laws (the claim mint)', () => {
  it('decision_pattern requires a dimension and forbids a lag band', () => {
    const good = mintKnowledgeClaim({ kind: 'decision_pattern', polarity: 'harmful', dimension: 'timing', lagBand: null });
    expect(good.ok).toBe(true);
    const missing = mintKnowledgeClaim({ kind: 'decision_pattern', polarity: 'harmful', dimension: null, lagBand: null });
    if (missing.ok) throw new Error('a dimensionless decision_pattern must fail');
    expect(missing.errors[0]?.code).toBe('invalid_field');
    const wrong = mintKnowledgeClaim({ kind: 'decision_pattern', polarity: 'harmful', dimension: 'timing', lagBand: 'seconds' });
    if (wrong.ok) throw new Error('a banded decision_pattern must fail');
    expect(wrong.errors[0]?.code).toBe('invalid_state');
  });

  it('data_latency requires a lag band and forbids a dimension; the band vocabulary is closed', () => {
    const good = mintKnowledgeClaim({ kind: 'data_latency', polarity: 'harmful', dimension: null, lagBand: 'seconds' });
    expect(good.ok).toBe(true);
    const missing = mintKnowledgeClaim({ kind: 'data_latency', polarity: 'harmful', dimension: null, lagBand: null });
    if (missing.ok) throw new Error('a bandless data_latency must fail');
    expect(missing.errors[0]?.code).toBe('invalid_field');
    const foreign = mintKnowledgeClaim({ kind: 'data_latency', polarity: 'harmful', dimension: null, lagBand: 'sub_minute' });
    if (foreign.ok) throw new Error('a foreign band must fail');
    expect(foreign.errors[0]?.code).toBe('invalid_field');
  });

  it('market_behavior and model_calibration carry NO discriminator; any is the typed invalid_state', () => {
    for (const kind of ['market_behavior', 'model_calibration'] as const) {
      const polarity = kind === 'market_behavior' ? 'adverse' : 'over_projection';
      const withDimension = mintKnowledgeClaim({ kind, polarity, dimension: 'timing', lagBand: null });
      if (withDimension.ok) throw new Error('a dimensioned market/model claim must fail');
      expect(withDimension.errors[0]?.code).toBe('invalid_state');
      const withBand = mintKnowledgeClaim({ kind, polarity, dimension: null, lagBand: 'minutes' });
      if (withBand.ok) throw new Error('a banded market/model claim must fail');
      expect(withBand.errors[0]?.code).toBe('invalid_state');
    }
  });

  it('requireLagBand fires unknown_lag_band on a foreign band', () => {
    const result = requireLagBand('hours');
    if (result.ok) throw new Error('hours must be rejected');
    expect(result.errors[0]?.code).toBe('unknown_lag_band');
  });
});

describe('the family key (byte-stable, polarity-excluded)', () => {
  it('same discriminating fields → same key; the polarity is EXCLUDED', () => {
    const adverse = claimFor('market_behavior', 'adverse');
    const favorable = claimFor('market_behavior', 'favorable');
    expect(claimFamilyKey(adverse, SCOPE)).toBe(claimFamilyKey(favorable, SCOPE));
    expect(claimFamilyKey(adverse, SCOPE)).toBe('{"dimension":null,"kind":"market_behavior","lagBand":null,"project":"project-alpha","tenant":"tenant-alpha"}');
  });

  it('scope, kind, dimension and lag band all discriminate', () => {
    const a = claimFamilyKey(claimFor('decision_pattern', 'harmful', { dimension: 'timing' }), SCOPE);
    const b = claimFamilyKey(claimFor('decision_pattern', 'harmful', { dimension: 'sizing' }), SCOPE);
    const c = claimFamilyKey(claimFor('decision_pattern', 'harmful', { dimension: 'timing' }), { tenant: 'tenant-beta', project: 'project-alpha' });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    const lagA = claimFamilyKey(claimFor('data_latency', 'harmful', { lagBand: 'seconds' }), SCOPE);
    const lagB = claimFamilyKey(claimFor('data_latency', 'harmful', { lagBand: 'minutes' }), SCOPE);
    expect(lagA).not.toBe(lagB);
  });
});

describe('the contradiction predicate', () => {
  it('same family + opposite polarity = contradiction; everything else is not', () => {
    expect(claimsContradict(claimFor('market_behavior', 'adverse'), claimFor('market_behavior', 'favorable'))).toBe(true);
    expect(claimsContradict(claimFor('market_behavior', 'adverse'), claimFor('market_behavior', 'adverse'))).toBe(false);
    expect(claimsContradict(claimFor('market_behavior', 'adverse'), claimFor('model_calibration', 'over_projection'))).toBe(false);
    expect(claimsContradict(claimFor('decision_pattern', 'harmful', { dimension: 'timing' }), claimFor('decision_pattern', 'helpful', { dimension: 'sizing' }))).toBe(false);
    expect(claimsContradict(claimFor('decision_pattern', 'harmful', { dimension: 'timing' }), claimFor('decision_pattern', 'helpful', { dimension: 'timing' }))).toBe(true);
    expect(claimsContradict(claimFor('data_latency', 'harmful', { lagBand: 'seconds' }), claimFor('data_latency', 'helpful', { lagBand: 'seconds' }))).toBe(true);
  });

  it('oppositeOf complements a valid claim polarity', () => {
    expect(oppositeOf(claimFor('model_calibration', 'under_projection'))).toBe('over_projection');
  });
});

describe('the deterministic claim ordering', () => {
  it('orders by kind, then dimension, then lagBand, then polarity — total and stable', () => {
    const claims: KnowledgeClaim[] = [
      claimFor('market_behavior', 'favorable'),
      claimFor('model_calibration', 'over_projection'),
      claimFor('decision_pattern', 'harmful', { dimension: 'timing' }),
      claimFor('decision_pattern', 'harmful', { dimension: 'sizing' }),
      claimFor('data_latency', 'harmful', { lagBand: 'seconds' }),
      claimFor('market_behavior', 'adverse'),
    ];
    const sorted = [...claims].sort(claimOrder);
    expect(sorted.map((claim) => describeClaim(claim))).toEqual([
      'data_latency/seconds:harmful',
      'decision_pattern/sizing:harmful',
      'decision_pattern/timing:harmful',
      'market_behavior:adverse',
      'market_behavior:favorable',
      'model_calibration:over_projection',
    ]);
    // Stability: re-sorting is idempotent.
    expect([...sorted].sort(claimOrder)).toEqual(sorted);
  });
});

describe('the derivations (deterministic, typed)', () => {
  it('harmPolarityOfOutcome follows the declared interpretation exactly', () => {
    expect(harmPolarityOfOutcome('adverse_gap')).toBe('harmful');
    expect(harmPolarityOfOutcome('execution_shortfall')).toBe('harmful');
    expect(harmPolarityOfOutcome('no_execution')).toBe('harmful');
    expect(harmPolarityOfOutcome('favorable_gap')).toBe('helpful');
    expect(harmPolarityOfOutcome('as_expected')).toBeNull();
    expect(harmPolarityOfOutcome('averted')).toBeNull();
    expect(harmPolarityOfOutcome('unbenchmarked_fill')).toBeNull();
  });

  it('deriveLagBand maps exact milliseconds to the closed bands', () => {
    expect(deriveLagBand(0)).toBe('sub_second');
    expect(deriveLagBand(999)).toBe('sub_second');
    expect(deriveLagBand(1000)).toBe('seconds');
    expect(deriveLagBand(59_999)).toBe('seconds');
    expect(deriveLagBand(60_000)).toBe('minutes');
    expect(deriveLagBand(3_599_999)).toBe('minutes');
    expect(deriveLagBand(3_600_000)).toBe('hours_plus');
    expect(deriveLagBand(86_400_000)).toBe('hours_plus');
  });
});

describe('the error taxonomy plumbing', () => {
  it('fail() builds the typed envelope deterministically', () => {
    const failure = fail('unknown_knowledge_kind', 'message', 'path');
    expect(failure.ok).toBe(false);
    if (!failure.ok) {
      expect(failure.errors).toHaveLength(1);
      expect(failure.errors[0]?.code).toBe('unknown_knowledge_kind');
      expect(failure.errors[0]?.path).toBe('path');
    }
  });
});
