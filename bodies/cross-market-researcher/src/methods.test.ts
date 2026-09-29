// @tradrl/body-cross-market-researcher — the DECLARED-METHOD tests.
//
// Behavioral: the closed taxonomies (relation kinds, direction subsets),
// the canonical registry's structure and digest, method-record
// construction and validation, citation resolution (undeclared ids,
// stale versions, wrong kinds, relation-kind drift). Negative paths:
// empty registries, duplicate methods, malformed parameters (bad
// thresholds, zero minMove, wrong price basis, unknown band shapes).

import { describe, expect, it } from 'vitest';
import {
  CROSS_MARKET_METHOD_REGISTRY,
  CROSS_MARKET_CO_MOVEMENT_METHOD,
  CROSS_MARKET_LEAD_LAG_METHOD,
  CROSS_MARKET_SPREAD_DIVERGENCE_METHOD,
  CROSS_MARKET_CONFIDENCE_METHOD,
  CROSS_MARKET_REPORT_COMPOSITION_METHOD,
  DIRECTIONS_BY_KIND,
  METHOD_KINDS,
  RELATIONSHIP_DIRECTIONS,
  RELATIONSHIP_KINDS,
  createCrossMarketMethodRecord,
  createCrossMarketMethodRegistry,
  directionMatchesKind,
  findCrossMarketMethod,
  isCrossMarketMethodKind,
  isCrossMarketMethodRegistry,
  isCrossMarketMethodRecord,
  isRelationshipDirection,
  isRelationshipKind,
  resolveCrossMarketMethodCitation,
  resolveRelationshipCitation,
  validateCrossMarketMethodRecord,
  validateCrossMarketMethodRegistry,
} from './methods';
import { isDeeplyFrozen } from './primitives';

describe('the closed taxonomies', () => {
  it('declares the relation trichotomy (co-movement, lead-lag, spread-divergence)', () => {
    expect([...RELATIONSHIP_KINDS]).toEqual(['co-movement', 'lead-lag', 'spread-divergence']);
    expect(isRelationshipKind('co-movement')).toBe(true);
    expect(isRelationshipKind('correlation')).toBe(false);
    expect(isRelationshipKind(42)).toBe(false);
  });

  it('declares the nine directions with per-kind subsets', () => {
    expect(RELATIONSHIP_DIRECTIONS.length).toBe(9);
    expect([...DIRECTIONS_BY_KIND['co-movement']]).toEqual(['positive', 'negative', 'neutral']);
    expect([...DIRECTIONS_BY_KIND['lead-lag']]).toEqual(['left-leads', 'right-leads', 'no-lead']);
    expect([...DIRECTIONS_BY_KIND['spread-divergence']]).toEqual(['widening', 'narrowing', 'stable']);
    expect(directionMatchesKind('co-movement', 'positive')).toBe(true);
    expect(directionMatchesKind('co-movement', 'widening')).toBe(false);
    expect(directionMatchesKind('lead-lag', 'no-lead')).toBe(true);
    expect(directionMatchesKind('spread-divergence', 'left-leads')).toBe(false);
    expect(isRelationshipDirection('bullish')).toBe(false);
  });
});

describe('the canonical registry', () => {
  it('ships five methods — one per relation kind, confidence, composition', () => {
    expect(CROSS_MARKET_METHOD_REGISTRY.methods.length).toBe(5);
    const kinds = CROSS_MARKET_METHOD_REGISTRY.methods.map((m) => m.kind).sort();
    expect(kinds).toEqual(['confidence-estimation', 'relationship-analysis', 'relationship-analysis', 'relationship-analysis', 'report-composition']);
    for (const method of CROSS_MARKET_METHOD_REGISTRY.methods) {
      expect(method.version).toBe('1.0.0');
      expect(method.declaredBy).toBe('tradrl-research-declaration/1');
    }
  });

  it('is a valid, deeply-frozen registry whose digest binds its canonical form', () => {
    expect(isCrossMarketMethodRegistry(CROSS_MARKET_METHOD_REGISTRY)).toBe(true);
    expect(isDeeplyFrozen(CROSS_MARKET_METHOD_REGISTRY)).toBe(true);
    expect(CROSS_MARKET_METHOD_REGISTRY.digest).toMatch(/^[0-9a-f]{16}$/);
  });

  it('declares every parameter knob (no implicit constants)', () => {
    const co = CROSS_MARKET_CO_MOVEMENT_METHOD.parameters;
    if (co.kind !== 'relationship-analysis' || co.relationKind !== 'co-movement') throw new Error('unreachable');
    expect(co.windowMs).toBe(60_000);
    expect(co.priceBasis).toBe('trade-price-or-quote-mid-or-reported-value');
    expect(co.minMove).toBe('0.005');
    expect(co.minComparedWindows).toBe(2);
    expect(co.minObservationsPerLeg).toBe(2);
    expect(co.directionThresholds).toEqual({ positive: '0.2', negative: '-0.2' });

    const lag = CROSS_MARKET_LEAD_LAG_METHOD.parameters;
    if (lag.kind !== 'relationship-analysis' || lag.relationKind !== 'lead-lag') throw new Error('unreachable');
    expect(lag.minDecisiveWindows).toBe(1);
    expect(lag.directionThresholds).toEqual({ leftLeads: '0.5', rightLeads: '-0.5' });

    const spread = CROSS_MARKET_SPREAD_DIVERGENCE_METHOD.parameters;
    if (spread.kind !== 'relationship-analysis' || spread.relationKind !== 'spread-divergence') throw new Error('unreachable');
    expect(spread.directionThresholds).toEqual({ widening: '0.02', narrowing: '-0.02' });

    const confidence = CROSS_MARKET_CONFIDENCE_METHOD.parameters;
    if (confidence.kind !== 'confidence-estimation') throw new Error('unreachable');
    expect(confidence.basis).toBe('evidence-count-and-leg-balance');
    expect(confidence.high).toEqual({ minEvidence: 8, maxLegImbalance: 2 });
    expect(confidence.moderate).toEqual({ minEvidence: 4, maxLegImbalance: 4 });

    expect(CROSS_MARKET_REPORT_COMPOSITION_METHOD.kind).toBe('report-composition');
  });

  it('stores methods in canonical (canonical-JSON) order — shuffles digest identically', () => {
    const methods = CROSS_MARKET_METHOD_REGISTRY.methods;
    const once = createCrossMarketMethodRegistry([...methods].reverse());
    expect(once.ok).toBe(true);
    if (once.ok) {
      expect(once.value.methods.map((m) => m.methodId)).toEqual(methods.map((m) => m.methodId));
      expect(once.value.digest).toBe(CROSS_MARKET_METHOD_REGISTRY.digest);
    }
  });
});

describe('method-record validation', () => {
  it('accepts the canonical records and round-trips them through the factory', () => {
    for (const method of CROSS_MARKET_METHOD_REGISTRY.methods) {
      expect(isCrossMarketMethodRecord(method)).toBe(true);
      expect(validateCrossMarketMethodRecord(method)).toEqual([]);
      const built = createCrossMarketMethodRecord(JSON.parse(JSON.stringify(method)));
      expect(built.ok).toBe(true);
      if (built.ok) {
        expect(built.value.methodId).toBe(method.methodId);
      }
    }
  });

  it('rejects a malformed record (collect-all, typed)', () => {
    const errors = validateCrossMarketMethodRecord({
      methodId: '',
      kind: 'relationship-analysis',
      version: '1.0',
      parameters: { kind: 'relationship-analysis' },
      declaredBy: '',
      declaredAt: -1,
    });
    const codes = errors.map((e) => e.code);
    expect(codes).toContain('invalid_field');
    expect(errors.length).toBeGreaterThanOrEqual(5);
  });

  it('rejects an unknown method kind and input class', () => {
    const errors = validateCrossMarketMethodRecord({
      methodId: 'method/x',
      kind: 'magic',
      version: '1.0.0',
      parameters: { kind: 'magic' },
      declaredBy: 'x',
      declaredAt: 0,
    });
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors.every((e) => e.code === 'invalid_field')).toBe(true);
    expect(METHOD_KINDS).toContain('relationship-analysis');
    expect(isCrossMarketMethodKind('relationship-analysis')).toBe(true);
  });

  it('rejects a zero minMove (a zero-threshold move detector is always-on noise)', () => {
    const errors = validateCrossMarketMethodRecord({
      ...CROSS_MARKET_CO_MOVEMENT_METHOD,
      parameters: { ...CROSS_MARKET_CO_MOVEMENT_METHOD.parameters, minMove: '0' },
    });
    expect(errors.map((e) => e.message)).toEqual(
      expect.arrayContaining([expect.stringContaining('must be strictly positive')]),
    );
  });

  it('rejects thresholds that are not decimals', () => {
    const errors = validateCrossMarketMethodRecord({
      ...CROSS_MARKET_LEAD_LAG_METHOD,
      parameters: { ...CROSS_MARKET_LEAD_LAG_METHOD.parameters, directionThresholds: { leftLeads: 'strong', rightLeads: 'weak' } },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a wrong price basis', () => {
    const errors = validateCrossMarketMethodRecord({
      ...CROSS_MARKET_SPREAD_DIVERGENCE_METHOD,
      parameters: { ...CROSS_MARKET_SPREAD_DIVERGENCE_METHOD.parameters, priceBasis: 'vwap' },
    });
    expect(errors.map((e) => e.message)).toEqual(
      expect.arrayContaining([expect.stringContaining("priceBasis: must be 'trade-price-or-quote-mid-or-reported-value'")]),
    );
  });

  it('rejects a confidence method with malformed bands', () => {
    const errors = validateCrossMarketMethodRecord({
      ...CROSS_MARKET_CONFIDENCE_METHOD,
      parameters: { ...CROSS_MARKET_CONFIDENCE_METHOD.parameters, high: { minEvidence: 0 } },
    });
    expect(errors.map((e) => e.message)).toEqual(
      expect.arrayContaining([expect.stringContaining('must be { minEvidence, maxLegImbalance }')]),
    );
  });

  it('rejects an input-class drift on relationship methods', () => {
    const errors = validateCrossMarketMethodRecord({
      ...CROSS_MARKET_CO_MOVEMENT_METHOD,
      parameters: { ...CROSS_MARKET_CO_MOVEMENT_METHOD.parameters, input: 'research-records' },
    });
    expect(errors.map((e) => e.message)).toEqual(
      expect.arrayContaining([expect.stringContaining('relationship analysis consumes market-observations')]),
    );
  });
});

describe('registry construction', () => {
  it('refuses an empty registry (method_registry_empty)', () => {
    const result = createCrossMarketMethodRegistry([]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe('method_registry_empty');
    }
  });

  it('refuses duplicate method ids (duplicate_method)', () => {
    const result = createCrossMarketMethodRegistry([CROSS_MARKET_CO_MOVEMENT_METHOD, CROSS_MARKET_CO_MOVEMENT_METHOD]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e: { code: string }) => e.code)).toContain('duplicate_method');
    }
  });
});

describe('citation resolution', () => {
  it('resolves a correct citation with no errors', () => {
    expect(
      resolveCrossMarketMethodCitation(
        CROSS_MARKET_METHOD_REGISTRY,
        'method/crossmarket/co-movement',
        '1.0.0',
        'relationship-analysis',
      ),
    ).toEqual([]);
  });

  it('an undeclared method is a typed error (the naked-statistic law)', () => {
    const errors = resolveCrossMarketMethodCitation(
      CROSS_MARKET_METHOD_REGISTRY,
      'method/crossmarket/magic-statistic',
      '1.0.0',
      'relationship-analysis',
    );
    expect(errors[0]?.code).toBe('undeclared_method');
    expect(errors[0]?.message).toContain('naked statistic');
  });

  it('a stale version is a typed error', () => {
    const errors = resolveCrossMarketMethodCitation(
      CROSS_MARKET_METHOD_REGISTRY,
      'method/crossmarket/lead-lag',
      '0.9.0',
      'relationship-analysis',
    );
    expect(errors[0]?.code).toBe('method_version_mismatch');
  });

  it('a wrong-kind use is a typed error', () => {
    const errors = resolveCrossMarketMethodCitation(
      CROSS_MARKET_METHOD_REGISTRY,
      'method/crossmarket/confidence',
      '1.0.0',
      'relationship-analysis',
    );
    expect(errors[0]?.code).toBe('method_kind_mismatch');
  });

  it('relation-kind drift is a typed error (relationship_kind_mismatch)', () => {
    const errors = resolveRelationshipCitation(
      CROSS_MARKET_METHOD_REGISTRY,
      'method/crossmarket/co-movement',
      '1.0.0',
      'lead-lag',
    );
    expect(errors[0]?.code).toBe('relationship_kind_mismatch');
  });

  it('a correct relation-kind citation resolves clean', () => {
    expect(
      resolveRelationshipCitation(CROSS_MARKET_METHOD_REGISTRY, 'method/crossmarket/spread-divergence', '1.0.0', 'spread-divergence'),
    ).toEqual([]);
  });

  it('findCrossMarketMethod returns null for unknown ids', () => {
    expect(findCrossMarketMethod(CROSS_MARKET_METHOD_REGISTRY, 'method/none')).toBeNull();
  });

  it('validateCrossMarketMethodRegistry accepts the canonical registry', () => {
    expect(validateCrossMarketMethodRegistry(CROSS_MARKET_METHOD_REGISTRY)).toEqual([]);
  });
});
