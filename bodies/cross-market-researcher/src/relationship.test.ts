// @tradrl/body-cross-market-researcher — the CrossMarketRelationship tests.
//
// Behavioral: the golden relationships validate under every law; the
// derived ids are deterministic; the three declared decision functions
// derive directions from scores; creation deep-freezes and refuses bad
// drafts. Negative paths: evidence-less, one-legged, future-citation,
// undeclared method, stale version, relation-kind mismatch, direction
// subset mismatch, direction-measure mismatch, wrong-kind confidence,
// self-paired, tenant-less, duplicate evidence, tampered ids.

import { describe, expect, it } from 'vitest';
import {
  CONFIDENCE_LEVELS,
  classifyCoMovementDirection,
  classifyLeadLagDirection,
  classifySpreadDirection,
  createCrossMarketRelationship,
  deriveRelationshipId,
  isConfidenceLevel,
  isCrossMarketRelationship,
  isMarketLeg,
  isMarketPair,
  isRelationshipMeasure,
  marketLegKey,
  serializeCrossMarketRelationship,
  validateCrossMarketRelationship,
  validateCrossMarketRelationshipRecord,
} from './relationship';
import {
  FIXTURE_REGISTRY,
  FIXTURE_RELATIONSHIPS,
  directionMeasureMismatchDraft,
  directionSubsetMismatchDraft,
  duplicateEvidenceRelationshipDraft,
  evidenceLessRelationshipDraft,
  futureCitationRelationshipDraft,
  kindMismatchRelationshipDraft,
  oneLeggedRelationshipDraft,
  selfPairedRelationshipDraft,
  staleMethodVersionRelationshipDraft,
  tenantlessRelationshipDraft,
  undeclaredMethodRelationshipDraft,
  wrongKindConfidenceDraft,
} from './fixtures';
import { isDeeplyFrozen } from './primitives';

const codesOf = (draft: unknown): readonly string[] =>
  validateCrossMarketRelationship(draft, FIXTURE_REGISTRY).map((e) => e.code);

describe('the golden relationships', () => {
  it('validate cleanly under every law', () => {
    expect(FIXTURE_RELATIONSHIPS.length).toBe(5);
    for (const relationship of FIXTURE_RELATIONSHIPS) {
      expect(validateCrossMarketRelationship(relationship, FIXTURE_REGISTRY)).toEqual([]);
      expect(isCrossMarketRelationship(relationship)).toBe(true);
      expect(validateCrossMarketRelationshipRecord(relationship, FIXTURE_REGISTRY).ok).toBe(true);
    }
  });

  it('carry the expected golden measures (the declared methods over the golden windows)', () => {
    const [pair1Spread, pair2Spread, pair3Co, pair3Lag, pair3Spread] = FIXTURE_RELATIONSHIPS;
    expect(pair1Spread?.relationKind).toBe('spread-divergence');
    expect(pair1Spread?.measure.score).toBe('-0.0300');
    expect(pair1Spread?.measure.direction).toBe('narrowing');
    expect(pair2Spread?.measure.score).toBe('-0.0600');
    expect(pair2Spread?.measure.direction).toBe('narrowing');
    expect(pair3Co?.relationKind).toBe('co-movement');
    expect(pair3Co?.measure.score).toBe('1.0000');
    expect(pair3Co?.measure.direction).toBe('positive');
    expect(pair3Lag?.relationKind).toBe('lead-lag');
    expect(pair3Lag?.measure.score).toBe('0.0000');
    expect(pair3Lag?.measure.direction).toBe('no-lead');
    expect(pair3Spread?.measure.score).toBe('-0.0300');
    expect(pair3Spread?.measure.direction).toBe('narrowing');
  });

  it('are deeply frozen with derived cmr- ids and BOTH-LEGS evidence', () => {
    for (const relationship of FIXTURE_RELATIONSHIPS) {
      expect(relationship.relationshipId.startsWith('cmr-')).toBe(true);
      expect(isDeeplyFrozen(relationship)).toBe(true);
      const left = relationship.evidence.filter((c) => c.leg === 'left').length;
      const right = relationship.evidence.filter((c) => c.leg === 'right').length;
      expect(left).toBe(4);
      expect(right).toBe(4);
      expect(relationship.confidence.evidenceCount).toBe(8);
      expect(relationship.confidence.legImbalance).toBe(0);
      expect(relationship.confidence.level).toBe('high');
    }
  });

  it('serialize byte-deterministically (same input, same bytes, twice)', () => {
    expect(serializeCrossMarketRelationship(FIXTURE_RELATIONSHIPS[2]!)).toBe(
      serializeCrossMarketRelationship(FIXTURE_RELATIONSHIPS[2]!),
    );
  });
});

describe('the declared decision functions', () => {
  it('co-movement directions derive from the declared thresholds', () => {
    const thresholds = { positive: '0.2', negative: '-0.2' };
    expect(classifyCoMovementDirection('1.0000', thresholds)).toBe('positive');
    expect(classifyCoMovementDirection('0.2', thresholds)).toBe('positive');
    expect(classifyCoMovementDirection('-0.5', thresholds)).toBe('negative');
    expect(classifyCoMovementDirection('0', thresholds)).toBe('neutral');
    expect(classifyCoMovementDirection('0.19', thresholds)).toBe('neutral');
  });

  it('lead-lag directions derive from the declared thresholds', () => {
    const thresholds = { leftLeads: '0.5', rightLeads: '-0.5' };
    expect(classifyLeadLagDirection('1.0000', thresholds)).toBe('left-leads');
    expect(classifyLeadLagDirection('-0.75', thresholds)).toBe('right-leads');
    expect(classifyLeadLagDirection('0', thresholds)).toBe('no-lead');
    expect(classifyLeadLagDirection('0.4999', thresholds)).toBe('no-lead');
  });

  it('spread directions derive from the declared thresholds', () => {
    const thresholds = { widening: '0.02', narrowing: '-0.02' };
    expect(classifySpreadDirection('0.0300', thresholds)).toBe('widening');
    expect(classifySpreadDirection('-0.0300', thresholds)).toBe('narrowing');
    expect(classifySpreadDirection('0', thresholds)).toBe('stable');
    expect(classifySpreadDirection('0.0199', thresholds)).toBe('stable');
  });
});

describe('guards', () => {
  it('market legs and pairs guard by their four-part identity', () => {
    const leg = { venue: 'CHAINX', instrument: 'TEST-CHAIN-A', assetClass: 'crypto', series: 'trade' };
    expect(isMarketLeg(leg)).toBe(true);
    expect(isMarketLeg({ venue: '', instrument: 'X', assetClass: 'crypto', series: 'trade' })).toBe(false);
    expect(marketLegKey(leg)).toBe('CHAINX|TEST-CHAIN-A|crypto|trade');
    expect(isMarketPair({ left: leg, right: leg })).toBe(true);
    expect(isMarketPair({ left: leg, right: null })).toBe(false);
  });

  it('the confidence levels are a closed category union', () => {
    expect([...CONFIDENCE_LEVELS]).toEqual(['low', 'moderate', 'high']);
    expect(isConfidenceLevel('very-sure')).toBe(false);
    expect(isRelationshipMeasure(FIXTURE_RELATIONSHIPS[0]!.measure)).toBe(true);
  });
});

describe('creation', () => {
  it('creates a validated, deeply-frozen record with a derived id', () => {
    const draft = { ...FIXTURE_RELATIONSHIPS[2]! };
    const { relationshipId: _ignored, ...material } = draft;
    void _ignored;
    const created = createCrossMarketRelationship(material, FIXTURE_REGISTRY);
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.value.relationshipId).toBe(FIXTURE_RELATIONSHIPS[2]!.relationshipId);
      expect(isDeeplyFrozen(created.value)).toBe(true);
    }
  });

  it('refuses a bad draft with typed data (never throws)', () => {
    const refused = createCrossMarketRelationship(evidenceLessRelationshipDraft(), FIXTURE_REGISTRY);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.errors[0]?.code).toBe('evidence_missing');
    }
  });

  it('the derived id is a pure function of the canonical content', () => {
    const { relationshipId: _ignored, ...material } = FIXTURE_RELATIONSHIPS[4]!;
    void _ignored;
    expect(deriveRelationshipId(material)).toBe(FIXTURE_RELATIONSHIPS[4]!.relationshipId);
  });
});

describe('THE NEGATIVE PATHS (every law, every typed error)', () => {
  it('an evidence-less relationship fails (evidence_missing)', () => {
    expect(codesOf(evidenceLessRelationshipDraft())).toContain('evidence_missing');
  });

  it('a one-legged relationship fails (leg_coverage_missing)', () => {
    expect(codesOf(oneLeggedRelationshipDraft())).toContain('leg_coverage_missing');
  });

  it('a future citation fails (future_evidence)', () => {
    expect(codesOf(futureCitationRelationshipDraft())).toContain('future_evidence');
  });

  it('an undeclared method fails (undeclared_method)', () => {
    expect(codesOf(undeclaredMethodRelationshipDraft())).toContain('undeclared_method');
  });

  it('a stale method version fails (method_version_mismatch)', () => {
    expect(codesOf(staleMethodVersionRelationshipDraft())).toContain('method_version_mismatch');
  });

  it('a relation kind that disagrees with the cited method fails (relationship_kind_mismatch)', () => {
    expect(codesOf(kindMismatchRelationshipDraft())).toContain('relationship_kind_mismatch');
  });

  it('a direction outside its relation kind fails (relationship_direction_mismatch)', () => {
    expect(codesOf(directionSubsetMismatchDraft())).toContain('relationship_direction_mismatch');
  });

  it('a direction inconsistent with the declared decision function fails (direction_measure_mismatch)', () => {
    expect(codesOf(directionMeasureMismatchDraft())).toContain('direction_measure_mismatch');
  });

  it('a wrong-kind confidence method fails (method_kind_mismatch)', () => {
    expect(codesOf(wrongKindConfidenceDraft())).toContain('method_kind_mismatch');
  });

  it('a self-paired relationship fails (pair_not_distinct)', () => {
    expect(codesOf(selfPairedRelationshipDraft())).toContain('pair_not_distinct');
  });

  it('missing tenant/project fails (tenant_missing, project_missing)', () => {
    const codes = codesOf(tenantlessRelationshipDraft());
    expect(codes).toContain('tenant_missing');
    expect(codes).toContain('project_missing');
  });

  it('duplicate citations fail (duplicate_observation_ref)', () => {
    expect(codesOf(duplicateEvidenceRelationshipDraft())).toContain('duplicate_observation_ref');
  });

  it('an unknown relation kind fails (unknown_relation_kind)', () => {
    expect(codesOf({ ...FIXTURE_RELATIONSHIPS[2]!, relationKind: 'correlation' })).toContain('unknown_relation_kind');
  });

  it('a tampered id fails (digest_mismatch)', () => {
    const tampered = {
      ...FIXTURE_RELATIONSHIPS[2]!,
      relationshipId: `cmr-${'0'.repeat(16)}` as never,
    };
    expect(codesOf(tampered)).toContain('digest_mismatch');
  });

  it('a tampered body (mutated after creation) fails re-validation', () => {
    // Deep-freeze prevents mutation in strict mode; emulate tampering via
    // a JSON clone with an edited score (id now stale).
    const cloned = JSON.parse(JSON.stringify(FIXTURE_RELATIONSHIPS[2])) as Record<string, unknown>;
    const measure = cloned.measure as Record<string, unknown>;
    measure.score = '0.5';
    expect(codesOf(cloned)).toContain('digest_mismatch');
  });

  it('an inverted window fails', () => {
    const inverted = { ...FIXTURE_RELATIONSHIPS[2]!, window: { from: 2_000_000_000_000, to: 1_000_000_000_000 } };
    expect(codesOf(inverted).length).toBeGreaterThan(0);
  });
});
