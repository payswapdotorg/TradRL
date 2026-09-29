// @tradrl/body-trading-director — decision tests (the record laws: the
// four-lane coverage totality, input/coverage consistency, canonical
// ordering, the L16 directive scan, the derived-id tamper trip-wire,
// creation, deep freezing, byte-deterministic serialization, and the
// determinism golden run twice).

import { describe, expect, it } from 'vitest';
import {
  type DirectorDecision,
  type EscalationRecord,
  type TargetAllocationAdjustment,
  createDirectorDecision,
  createEscalationRecord,
  deriveDirectorDecisionId,
  deriveEscalationRecordId,
  isAllocationAdjustmentDirective,
  isDirectorDecision,
  isEscalationRecord,
  isInstrumentTilt,
  isLaneAbsence,
  isLaneConflict,
  isLaneCoverage,
  isNoChangeDirective,
  isPortfolioDirective,
  isQuorumDetail,
  isTargetAllocationAdjustment,
  serializeDirectorDecision,
  serializeEscalationRecord,
  validateDirectorDecision,
  validateEscalationRecord,
} from './decision';
import { canonicalJson, isDeeplyFrozen } from './primitives';
import {
  FIXTURE_GOLDEN_DECISION,
  FIXTURE_IRRECONCILABLE_ESCALATION,
  FIXTURE_QUORUM_UNMET_ESCALATION,
  FIXTURE_REGISTRY,
} from './fixtures';
import { composeDirectorDecision } from './synthesis';
import { FIXTURE_QUORUM_MET_INPUT, FIXTURE_QUORUM_UNMET_INPUT } from './fixtures';

const GOLDEN_DECISION: DirectorDecision =
  FIXTURE_GOLDEN_DECISION.kind === 'decision' ? FIXTURE_GOLDEN_DECISION.decision : (undefined as never);
const GOLDEN_ESCALATION: EscalationRecord =
  FIXTURE_QUORUM_UNMET_ESCALATION.kind === 'escalation' ? FIXTURE_QUORUM_UNMET_ESCALATION.escalation : (undefined as never);
const GOLDEN_IRRECONCILABLE: EscalationRecord =
  FIXTURE_IRRECONCILABLE_ESCALATION.kind === 'escalation' ? FIXTURE_IRRECONCILABLE_ESCALATION.escalation : (undefined as never);

describe('record guards', () => {
  it('the golden decision satisfies the guard', () => {
    expect(isDirectorDecision(GOLDEN_DECISION)).toBe(true);
    expect(isDirectorDecision(JSON.parse(JSON.stringify(GOLDEN_DECISION)))).toBe(true);
  });

  it('the golden escalations satisfy the guard', () => {
    expect(isEscalationRecord(GOLDEN_ESCALATION)).toBe(true);
    expect(isEscalationRecord(GOLDEN_IRRECONCILABLE)).toBe(true);
  });

  it('the directive sub-guards', () => {
    expect(isPortfolioDirective(GOLDEN_DECISION.directive)).toBe(true);
    expect(isAllocationAdjustmentDirective(GOLDEN_DECISION.directive)).toBe(true);
    expect(isNoChangeDirective({ kind: 'no-change', reason: 'insufficient-signal', instrumentTilts: [] })).toBe(true);
    expect(isNoChangeDirective({ kind: 'no-change', reason: 'whim', instrumentTilts: [] })).toBe(false);
    expect(isTargetAllocationAdjustment(GOLDEN_DECISION.directive.kind === 'allocation-adjustment' ? GOLDEN_DECISION.directive.adjustments[0] as TargetAllocationAdjustment : null)).toBe(true);
    expect(isInstrumentTilt({ instrumentId: 'X', netTilt: '1.0000' })).toBe(true);
    expect(isInstrumentTilt({ instrumentId: '', netTilt: '1.0000' })).toBe(false);
    expect(isQuorumDetail({ declaredQuorum: 3, presentLanes: 2, absentLanes: ['regime'] })).toBe(true);
    expect(isQuorumDetail({ declaredQuorum: 0, presentLanes: 2, absentLanes: [] })).toBe(false);
  });

  it('the coverage and conflict sub-guards', () => {
    expect(isLaneCoverage({ lane: 'sentiment', status: 'consumed', position: { lane: 'sentiment', direction: 'bullish', category: 'positive', mapped: true }, absence: null })).toBe(true);
    expect(isLaneCoverage({ lane: 'sentiment', status: 'absent', position: null, absence: null })).toBe(false);
    expect(isLaneCoverage({ lane: 'sentiment', status: 'absent', position: null, absence: { lane: 'sentiment', reason: 'no-report-received' } })).toBe(true);
    expect(isLaneAbsence({ lane: 'regime', reason: 'no-report-received' })).toBe(true);
    expect(isLaneAbsence({ lane: 'regime', reason: 'lazy' })).toBe(false);
    expect(isLaneConflict({ instrumentId: 'X', positions: [{ lane: 'sentiment', direction: 'bullish', reportId: 'rr-1' }], majorityDirection: 'bullish' })).toBe(false); // a conflict needs >= 2 positions
    expect(isLaneConflict({ instrumentId: 'X', positions: [{ lane: 'sentiment', direction: 'bullish', reportId: 'rr-1' }, { lane: 'regime', direction: 'bearish', reportId: 'rr-2' }], majorityDirection: null })).toBe(true);
  });

  it('THE L16 GUARD HALF: a directive shaped like order-level control fails the guard', () => {
    expect(isPortfolioDirective({ kind: 'order-placement', orders: [] })).toBe(false);
    expect(isPortfolioDirective({ kind: 'execution-ticket', ticket: 1 })).toBe(false);
    expect(isPortfolioDirective({ kind: 'allocation-adjustment', adjustments: [] })).toBe(false); // empty adjustment set is a no-change, not an adjustment directive
  });
});

describe('THE COVERAGE LAW (collect-all validation)', () => {
  it('the golden decision validates cleanly', () => {
    expect(validateDirectorDecision(GOLDEN_DECISION, FIXTURE_REGISTRY)).toEqual([]);
  });

  it('A MISSING LANE COVERAGE ENTRY FAILS (lane_not_accounted — never silence)', () => {
    const broken = {
      ...GOLDEN_DECISION,
      coverage: GOLDEN_DECISION.coverage.filter((entry) => entry.lane !== 'cross-market'),
    };
    const errors = validateDirectorDecision(broken, FIXTURE_REGISTRY);
    expect(errors.map((e) => e.code)).toContain('lane_not_accounted');
    expect(errors.map((e) => e.message)).toEqual(expect.arrayContaining([expect.stringContaining('cross-market')]));
  });

  it('A MISSING LANE WITHOUT ITS ABSENCE RECORD FAILS (lane_absence_record_missing)', () => {
    const broken = {
      ...GOLDEN_DECISION,
      coverage: GOLDEN_DECISION.coverage.map((entry) =>
        entry.lane === 'cross-market'
          ? { lane: 'cross-market', status: 'absent', position: null, absence: null }
          : entry,
      ),
      inputs: GOLDEN_DECISION.inputs.filter((input) => input.lane !== 'cross-market'),
    };
    const errors = validateDirectorDecision(broken, FIXTURE_REGISTRY);
    expect(errors.map((e) => e.code)).toContain('lane_absence_record_missing');
  });

  it('a lane with a cited input but absent coverage status fails (coverage_status_mismatch)', () => {
    const broken = {
      ...GOLDEN_DECISION,
      coverage: GOLDEN_DECISION.coverage.map((entry) =>
        entry.lane === 'fundamental'
          ? { ...entry, status: 'absent' as const, position: null, absence: { lane: 'fundamental', reason: 'no-report-received' as const } }
          : entry,
      ),
    };
    const errors = validateDirectorDecision(broken, FIXTURE_REGISTRY);
    expect(errors.map((e) => e.code)).toContain('coverage_status_mismatch');
  });

  it('a lane accounted conflicted without a conflict record position fails (conflict_record_mismatch)', () => {
    const broken = {
      ...GOLDEN_DECISION,
      coverage: GOLDEN_DECISION.coverage.map((entry) =>
        entry.lane === 'fundamental' ? { ...entry, status: 'conflicted' as const } : entry,
      ),
    };
    const errors = validateDirectorDecision(broken, FIXTURE_REGISTRY);
    expect(errors.map((e) => e.code)).toContain('conflict_record_mismatch');
  });

  it('input lanes out of canonical order fail validation', () => {
    const broken = {
      ...GOLDEN_DECISION,
      inputs: [...GOLDEN_DECISION.inputs].reverse(),
    };
    const errors = validateDirectorDecision(broken, FIXTURE_REGISTRY);
    expect(errors.map((e) => e.code)).toContain('invalid_field');
    expect(errors.map((e) => e.message)).toEqual(expect.arrayContaining([expect.stringContaining('canonical lane order')]));
  });

  it('the same report cited as two lanes fails (duplicate_input_report)', () => {
    const broken = {
      ...GOLDEN_DECISION,
      inputs: GOLDEN_DECISION.inputs.map((input) =>
        input.lane === 'regime' ? { ...input, reportId: GOLDEN_DECISION.inputs[0]?.reportId } : input,
      ),
    };
    const errors = validateDirectorDecision(broken, FIXTURE_REGISTRY);
    expect(errors.map((e) => e.code)).toContain('duplicate_input_report');
  });
});

describe('THE L16 DIRECTIVE LAW (order-level control refusal)', () => {
  it('an order-shaped directive draft is the order_level_control typed error', () => {
    const broken = {
      ...GOLDEN_DECISION,
      directive: { kind: 'order-placement', orders: [{ instrument: 'TEST-AAA', side: 'buy', quantity: '100' }] },
    };
    const errors = validateDirectorDecision(broken, FIXTURE_REGISTRY);
    expect(errors.map((e) => e.code)).toContain('order_level_control');
    expect(errors[0]?.message).toContain('T025');
  });

  it('an adjustment without per-lane positions is refused (never an unexplained delta)', () => {
    const broken = {
      ...GOLDEN_DECISION,
      directive: {
        kind: 'allocation-adjustment',
        adjustments: [{ instrumentId: 'TEST-AAA', deltaWeight: '0.0300', netTilt: '3.0000', positions: [] }],
      },
    };
    const errors = validateDirectorDecision(broken, FIXTURE_REGISTRY);
    expect(errors.map((e) => e.code)).toContain('directive_shape_mismatch');
  });
});

describe('the derived-id tamper trip-wire', () => {
  it('a tampered decision id is the digest_mismatch typed error', () => {
    const tampered = { ...GOLDEN_DECISION, directive: { ...GOLDEN_DECISION.directive } };
    const errors = validateDirectorDecision(
      { ...tampered, decisionId: `dd-${'0'.repeat(16)}` } as never,
      FIXTURE_REGISTRY,
    );
    expect(errors.map((e) => e.code)).toContain('digest_mismatch');
  });

  it('a tampered escalation id is the digest_mismatch typed error', () => {
    const errors = validateEscalationRecord(
      { ...GOLDEN_ESCALATION, escalationId: `esc-${'0'.repeat(16)}` } as never,
      FIXTURE_REGISTRY,
    );
    expect(errors.map((e) => e.code)).toContain('digest_mismatch');
  });

  it('the derivation is deterministic and content-bound', () => {
    const { decisionId: _ignored, ...material } = GOLDEN_DECISION;
    void _ignored;
    expect(deriveDirectorDecisionId(material)).toBe(GOLDEN_DECISION.decisionId);
    const { escalationId: _ignoredEscalation, ...escalationMaterial } = GOLDEN_ESCALATION;
    void _ignoredEscalation;
    expect(deriveEscalationRecordId(escalationMaterial)).toBe(GOLDEN_ESCALATION.escalationId);
  });
});

describe('creation + immutability', () => {
  it('createDirectorDecision mints a frozen record with a derived id', () => {
    const { decisionId: _ignored, ...draft } = GOLDEN_DECISION;
    void _ignored;
    const construction = createDirectorDecision(draft, FIXTURE_REGISTRY);
    expect(construction.ok).toBe(true);
    if (construction.ok) {
      expect(construction.value.decisionId).toBe(GOLDEN_DECISION.decisionId);
      expect(isDeeplyFrozen(construction.value)).toBe(true);
    }
  });

  it('createEscalationRecord mints a frozen record with a derived id', () => {
    const { escalationId: _ignored, ...draft } = GOLDEN_ESCALATION;
    void _ignored;
    const construction = createEscalationRecord(draft, FIXTURE_REGISTRY);
    expect(construction.ok).toBe(true);
    if (construction.ok) {
      expect(construction.value.escalationId).toBe(GOLDEN_ESCALATION.escalationId);
      expect(isDeeplyFrozen(construction.value)).toBe(true);
    }
  });

  it('the golden records are deeply frozen', () => {
    expect(isDeeplyFrozen(GOLDEN_DECISION)).toBe(true);
    expect(isDeeplyFrozen(GOLDEN_ESCALATION)).toBe(true);
    expect(() => {
      (GOLDEN_DECISION as { tampered?: unknown }).tampered = 1;
    }).toThrow();
  });
});

describe('THE DETERMINISM GOLDEN (byte-identical, run twice)', () => {
  it('composing the golden scenario twice yields byte-identical serialized decisions', () => {
    const first = composeDirectorDecision(FIXTURE_QUORUM_MET_INPUT);
    const second = composeDirectorDecision(FIXTURE_QUORUM_MET_INPUT);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('must compose');
    if (first.value.kind !== 'decision' || second.value.kind !== 'decision') throw new Error('must decide');
    const firstBytes = serializeDirectorDecision(first.value.decision);
    const secondBytes = serializeDirectorDecision(second.value.decision);
    expect(firstBytes).toBe(secondBytes);
    expect(firstBytes).toBe(serializeDirectorDecision(GOLDEN_DECISION));
    expect(first.value.decision.decisionId).toBe(second.value.decision.decisionId);
  });

  it('the serialized decision is the canonical JSON form (sorted keys, stable bytes)', () => {
    const bytes = serializeDirectorDecision(GOLDEN_DECISION);
    expect(bytes).toBe(canonicalJson(GOLDEN_DECISION as never));
    // canonical bytes round-trip to the identical record
    expect(JSON.parse(bytes)).toEqual(JSON.parse(JSON.stringify(GOLDEN_DECISION)));
    // keys are sorted at every level (spot checks)
    expect(bytes.startsWith('{"asOf":')).toBe(true);
    expect(bytes).toContain('"coverage":[{"absence":null,');
  });

  it('the escalation serialization is byte-deterministic too', () => {
    const first = composeDirectorDecision(FIXTURE_QUORUM_UNMET_INPUT);
    expect(first.ok).toBe(true);
    if (first.ok && first.value.kind === 'escalation') {
      expect(serializeEscalationRecord(first.value.escalation)).toBe(serializeEscalationRecord(GOLDEN_ESCALATION));
    }
  });
});
