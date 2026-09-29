// @tradrl/body-trading-director — methods tests (the DECLARED-METHOD
// discipline: the versioned synthesis-method records, the declared
// quorum, stance map, lane weights, tilt/threshold parameters, conflict
// policy; the registry; citation resolution; the negatives).

import { describe, expect, it } from 'vitest';
import {
  CONFLICT_POLICIES,
  DIRECTOR_CONSERVATIVE_SYNTHESIS_METHOD,
  DIRECTOR_METHOD_REGISTRY,
  DIRECTOR_SYNTHESIS_METHOD,
  METHOD_KINDS,
  RESEARCH_LANES,
  SYNTHESIS_DIRECTIONS,
  createMethodRecord,
  createMethodRegistry,
  findMethod,
  isConflictPolicy,
  isMethodKind,
  isMethodRecord,
  isMethodRegistry,
  isResearchLane,
  isSynthesisDirection,
  resolveMethodCitation,
  type MethodRecord,
  type SynthesisParameters,
} from './methods';

describe('the research-lane enumeration (D-020)', () => {
  it('is exactly the four research bodies', () => {
    expect([...RESEARCH_LANES]).toEqual(['sentiment', 'regime', 'fundamental', 'cross-market']);
    expect(RESEARCH_LANES).toHaveLength(4);
    expect(isResearchLane('sentiment')).toBe(true);
    expect(isResearchLane('execution')).toBe(false);
    expect(isResearchLane('')).toBe(false);
  });
});

describe('the closed vocabularies', () => {
  it('synthesis directions and conflict policies', () => {
    expect([...SYNTHESIS_DIRECTIONS]).toEqual(['bullish', 'bearish', 'flat']);
    expect([...CONFLICT_POLICIES]).toEqual(['record-and-majority', 'escalate-on-no-majority', 'escalate-on-any']);
    expect([...METHOD_KINDS]).toEqual(['synthesis']);
    expect(isSynthesisDirection('bullish')).toBe(true);
    expect(isSynthesisDirection('bullishness')).toBe(false);
    expect(isConflictPolicy('escalate-on-any')).toBe(true);
    expect(isConflictPolicy('always')).toBe(false);
    expect(isMethodKind('synthesis')).toBe(true);
    expect(isMethodKind('aggregation')).toBe(false);
  });
});

describe('method record validation (collect-all)', () => {
  it('the canonical method record is valid', () => {
    expect(isMethodRecord(DIRECTOR_SYNTHESIS_METHOD)).toBe(true);
    const construction = createMethodRecord(DIRECTOR_SYNTHESIS_METHOD);
    expect(construction.ok).toBe(true);
  });

  it('THE QUORUM LAW: a synthesis method without a declared quorum is a typed error', () => {
    const draft = {
      ...DIRECTOR_SYNTHESIS_METHOD,
      parameters: { ...(DIRECTOR_SYNTHESIS_METHOD.parameters as SynthesisParameters), quorum: 0 },
    };
    const construction = createMethodRecord(draft);
    expect(construction.ok).toBe(false);
    if (!construction.ok) {
      expect(construction.errors.map((e) => e.code)).toContain('quorum_not_declared');
    }
  });

  it('a quorum above the lane count is refused', () => {
    const draft = {
      ...DIRECTOR_SYNTHESIS_METHOD,
      parameters: { ...(DIRECTOR_SYNTHESIS_METHOD.parameters as SynthesisParameters), quorum: 5 },
    };
    const construction = createMethodRecord(draft);
    expect(construction.ok).toBe(false);
  });

  it('lane weights must cover all four lanes exactly once', () => {
    const missing = {
      ...DIRECTOR_SYNTHESIS_METHOD,
      parameters: {
        ...(DIRECTOR_SYNTHESIS_METHOD.parameters as SynthesisParameters),
        laneWeights: [{ lane: 'sentiment', weight: '1' }],
      },
    };
    expect(createMethodRecord(missing).ok).toBe(false);

    const duplicated = {
      ...DIRECTOR_SYNTHESIS_METHOD,
      parameters: {
        ...(DIRECTOR_SYNTHESIS_METHOD.parameters as SynthesisParameters),
        laneWeights: [
          ...DIRECTOR_SYNTHESIS_METHOD.parameters.laneWeights,
          { lane: 'sentiment', weight: '2' },
        ],
      },
    };
    expect(createMethodRecord(duplicated).ok).toBe(false);
  });

  it('stance-map entries must be unique by (lane, category)', () => {
    const duplicated = {
      ...DIRECTOR_SYNTHESIS_METHOD,
      parameters: {
        ...(DIRECTOR_SYNTHESIS_METHOD.parameters as SynthesisParameters),
        stanceMap: [
          ...DIRECTOR_SYNTHESIS_METHOD.parameters.stanceMap,
          { lane: 'sentiment', category: 'positive', direction: 'bearish' },
        ],
      },
    };
    const construction = createMethodRecord(duplicated);
    expect(construction.ok).toBe(false);
  });

  it('malformed records are refused with typed errors (never throw)', () => {
    for (const hostile of [null, 42, 'x', {}, { methodId: 'x' }]) {
      const construction = createMethodRecord(hostile);
      expect(construction.ok).toBe(false);
    }
  });
});

describe('the registry', () => {
  it('the canonical registry is valid with a stable digest', () => {
    expect(isMethodRegistry(DIRECTOR_METHOD_REGISTRY)).toBe(true);
    expect(DIRECTOR_METHOD_REGISTRY.digest).toMatch(/^[0-9a-f]{16}$/);
    expect(DIRECTOR_METHOD_REGISTRY.methods).toHaveLength(2);
  });

  it('the registry stores methods in canonical order', () => {
    const ids = DIRECTOR_METHOD_REGISTRY.methods.map((method) => method.methodId);
    expect([...ids].sort()).toEqual([...ids]);
  });

  it('an empty registry is refused', () => {
    const construction = createMethodRegistry([]);
    expect(construction.ok).toBe(false);
    if (!construction.ok) {
      expect(construction.errors.map((e) => e.code)).toContain('method_registry_empty');
    }
  });

  it('duplicate method ids are refused', () => {
    const construction = createMethodRegistry([DIRECTOR_SYNTHESIS_METHOD, DIRECTOR_SYNTHESIS_METHOD]);
    expect(construction.ok).toBe(false);
    if (!construction.ok) {
      expect(construction.errors.map((e) => e.code)).toContain('duplicate_method');
    }
  });

  it('findMethod resolves and rejects', () => {
    expect(findMethod(DIRECTOR_METHOD_REGISTRY, 'method/director/synthesis')).not.toBeNull();
    expect(findMethod(DIRECTOR_METHOD_REGISTRY, 'method/director/magic')).toBeNull();
  });
});

describe('citation resolution (typed errors on drift)', () => {
  it('the canonical citation resolves cleanly', () => {
    const errors = resolveMethodCitation(DIRECTOR_METHOD_REGISTRY, 'method/director/synthesis', '1.0.0', 'synthesis');
    expect(errors).toEqual([]);
  });

  it('an undeclared method is the undeclared_method typed error', () => {
    const errors = resolveMethodCitation(DIRECTOR_METHOD_REGISTRY, 'method/director/magic', '1.0.0', 'synthesis');
    expect(errors.map((e) => e.code)).toContain('undeclared_method');
  });

  it('a stale version is the method_version_mismatch typed error', () => {
    const errors = resolveMethodCitation(DIRECTOR_METHOD_REGISTRY, 'method/director/synthesis', '0.9.0', 'synthesis');
    expect(errors.map((e) => e.code)).toContain('method_version_mismatch');
  });

  it('a malformed version is a typed invalid_field', () => {
    const errors = resolveMethodCitation(DIRECTOR_METHOD_REGISTRY, 'method/director/synthesis', '1.0', 'synthesis');
    expect(errors.map((e) => e.code)).toContain('invalid_field');
  });
});

describe('the canonical declared methods', () => {
  it('the canonical method declares quorum 3 and escalate-on-no-majority', () => {
    const parameters = DIRECTOR_SYNTHESIS_METHOD.parameters as SynthesisParameters;
    expect(parameters.quorum).toBe(3);
    expect(parameters.conflictPolicy).toBe('escalate-on-no-majority');
    expect(parameters.tiltUnit).toBe('0.01');
    expect(parameters.adjustmentThreshold).toBe('0.02');
    expect(parameters.outputScale).toBe(4);
    expect(parameters.rounding).toBe('half-even');
    expect(parameters.unmappedCategory).toBe('flat');
  });

  it('the conservative method declares quorum 4 and escalate-on-any', () => {
    const parameters = DIRECTOR_CONSERVATIVE_SYNTHESIS_METHOD.parameters as SynthesisParameters;
    expect(parameters.quorum).toBe(4);
    expect(parameters.conflictPolicy).toBe('escalate-on-any');
  });

  it('the stance maps cover the report-level categories of all four lanes', () => {
    for (const method of DIRECTOR_METHOD_REGISTRY.methods as readonly MethodRecord[]) {
      const parameters = method.parameters as SynthesisParameters;
      for (const lane of RESEARCH_LANES) {
        expect(parameters.stanceMap.some((entry) => entry.lane === lane)).toBe(true);
      }
    }
    const canonical = DIRECTOR_SYNTHESIS_METHOD.parameters as SynthesisParameters;
    expect(canonical.stanceMap.filter((entry) => entry.lane === 'sentiment').map((entry) => entry.category)).toEqual(
      expect.arrayContaining(['positive', 'negative', 'neutral', 'mixed', 'no-reading']),
    );
    expect(canonical.stanceMap.filter((entry) => entry.lane === 'regime').map((entry) => entry.category)).toEqual(
      expect.arrayContaining(['trending-up', 'trending-down', 'no-classification']),
    );
    expect(canonical.stanceMap.filter((entry) => entry.lane === 'fundamental').map((entry) => entry.category)).toEqual(
      expect.arrayContaining(['positive', 'negative', 'no-assessment']),
    );
    expect(canonical.stanceMap.filter((entry) => entry.lane === 'cross-market').map((entry) => entry.category)).toEqual(
      expect.arrayContaining(['co-movement', 'lead-lag', 'spread-divergence', 'no-relationship']),
    );
  });
});
