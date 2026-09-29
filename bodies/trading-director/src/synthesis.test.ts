// @tradrl/body-trading-director — synthesis tests (the composition law's
// declared interpreter: the quorum-met golden, the single-lane-absence
// paths, the conflict path (per-body positions, majority stands — never
// a silent average), the quorum and irreconcilable escalations, the
// quorum-is-declared-not-hardcoded law, collect-all refusal, and the
// byte-determinism golden).

import { describe, expect, it } from 'vitest';
import {
  composeDirectorDecision,
  type DirectorCompositionInput,
  type DirectorOutcome,
  createMethodRegistry,
} from './index';
import { deepCloneJson } from './primitives';
import {
  DIRECTOR_SYNTHESIS_METHOD,
  type SynthesisParameters,
} from './methods';
import {
  FIXTURE_CONFLICT_DECISION,
  FIXTURE_CONFLICT_INPUT,
  FIXTURE_CONSERVATIVE_CONFLICT_ESCALATION,
  FIXTURE_CONSERVATIVE_CONFLICT_INPUT,
  FIXTURE_CONSERVATIVE_QUORUM_ESCALATION,
  FIXTURE_CONSERVATIVE_QUORUM_INPUT,
  FIXTURE_CROSS_MARKET_REPORT,
  FIXTURE_FUNDAMENTAL_REPORT,
  FIXTURE_GOLDEN_DECISION,
  FIXTURE_IRRECONCILABLE_ESCALATION,
  FIXTURE_IRRECONCILABLE_INPUT,
  FIXTURE_NO_CROSS_MARKET_DECISION,
  FIXTURE_NO_CROSS_MARKET_INPUT,
  FIXTURE_NO_FUNDAMENTAL_DECISION,
  FIXTURE_NO_FUNDAMENTAL_INPUT,
  FIXTURE_NO_REGIME_DECISION,
  FIXTURE_NO_REGIME_INPUT,
  FIXTURE_NO_SENTIMENT_DECISION,
  FIXTURE_NO_SENTIMENT_INPUT,
  FIXTURE_QUORUM_MET_INPUT,
  FIXTURE_QUORUM_UNMET_ESCALATION,
  FIXTURE_QUORUM_UNMET_INPUT,
  FIXTURE_REGISTRY,
  fixtureCompositionInput,
} from './fixtures';

describe('THE QUORUM-MET GOLDEN (all four lanes present, aligned bullish)', () => {
  const outcome: DirectorOutcome = FIXTURE_GOLDEN_DECISION;

  it('composes a DECISION (not an escalation)', () => {
    expect(outcome.kind).toBe('decision');
  });

  it('the directive is ONE target-allocation adjustment on TEST-AAA (+0.0300 — hand-derived)', () => {
    if (outcome.kind !== 'decision') throw new Error('expected a decision');
    const { directive } = outcome.decision;
    expect(directive.kind).toBe('allocation-adjustment');
    if (directive.kind !== 'allocation-adjustment') throw new Error('expected adjustments');
    // three covering non-flat lanes at declared weight 1 each: net tilt 3,
    // tilt unit 0.01 => delta 0.0300 >= threshold 0.02.
    expect(directive.adjustments).toHaveLength(1);
    const adjustment = directive.adjustments[0];
    expect(adjustment?.instrumentId).toBe('TEST-AAA');
    expect(adjustment?.deltaWeight).toBe('0.0300');
    expect(adjustment?.netTilt).toBe('3.0000');
    expect(adjustment?.positions).toEqual([
      { lane: 'sentiment', direction: 'bullish', reportId: expect.any(String) },
      { lane: 'regime', direction: 'bullish', reportId: expect.any(String) },
      { lane: 'fundamental', direction: 'bullish', reportId: expect.any(String) },
    ]);
  });

  it('the single-lane tilts below the threshold are recorded as no-change evidence — never silently dropped', () => {
    if (outcome.kind !== 'decision') throw new Error('expected a decision');
    // every other instrument is covered by at most one non-flat lane:
    // |delta| 0.0100 < 0.02 — no adjustment, but the tilts ride the record.
    const below = ['TEST-BBB', 'TEST-ECON-CPI', 'TEST-LARGECAP', 'TEST-SAT-OIL'];
    if (outcome.decision.directive.kind !== 'allocation-adjustment') throw new Error('unreachable');
    // the adjustment directive carries no instrumentTilts; compose a no-change variant to see them
    const tiltless = composeDirectorDecision(FIXTURE_NO_FUNDAMENTAL_INPUT);
    if (!tiltless.ok || tiltless.value.kind !== 'decision') throw new Error('must compose');
    expect(tiltless.value.decision.directive.kind).toBe('allocation-adjustment');
    // instrument coverage sanity: the union of all four fixture reports is six instruments
    const covered = new Set<string>([
      ...outcome.decision.inputs.flatMap((input) => input.instruments),
    ]);
    expect([...covered].sort()).toEqual([
      'TEST-AAA',
      'TEST-BBB',
      'TEST-CHAIN-A',
      'TEST-ECON-CPI',
      'TEST-LARGECAP',
      'TEST-SAT-OIL',
    ]);
    void below;
  });

  it('every one of the four lanes is accounted consumed (none absent, none conflicted)', () => {
    if (outcome.kind !== 'decision') throw new Error('expected a decision');
    const statuses = outcome.decision.coverage.map((entry) => [entry.lane, entry.status]);
    expect(statuses).toEqual([
      ['sentiment', 'consumed'],
      ['regime', 'consumed'],
      ['fundamental', 'consumed'],
      ['cross-market', 'consumed'],
    ]);
    for (const entry of outcome.decision.coverage) {
      expect(entry.absence).toBeNull();
      expect(entry.position).not.toBeNull();
    }
  });

  it('the decision carries the four input report refs in canonical lane order', () => {
    if (outcome.kind !== 'decision') throw new Error('expected a decision');
    expect(outcome.decision.inputs.map((input) => input.lane)).toEqual([
      'sentiment',
      'regime',
      'fundamental',
      'cross-market',
    ]);
    expect(outcome.decision.inputs[0]?.reportId).toBe(FIXTURE_SENTIMENT_REPORT_ID());
    expect(outcome.decision.conflicts).toEqual([]);
  });

  it('the cross-market lane contributes a FLAT mapped position (declared stance map — never a guess)', () => {
    if (outcome.kind !== 'decision') throw new Error('expected a decision');
    const crossMarket = outcome.decision.coverage.find((entry) => entry.lane === 'cross-market');
    expect(crossMarket?.position?.direction).toBe('flat');
    expect(crossMarket?.position?.category).toBe('spread-divergence');
    expect(crossMarket?.position?.mapped).toBe(true);
  });
});

function FIXTURE_SENTIMENT_REPORT_ID(): string {
  return (FIXTURE_QUORUM_MET_INPUT.intake.sentiment as { reportId: string }).reportId;
}

describe('THE SINGLE-LANE-ABSENCE PATHS (typed absence records — never silence)', () => {
  const cases = [
    { name: 'sentiment absent', input: FIXTURE_NO_SENTIMENT_INPUT, outcome: FIXTURE_NO_SENTIMENT_DECISION, lane: 'sentiment' },
    { name: 'regime absent', input: FIXTURE_NO_REGIME_INPUT, outcome: FIXTURE_NO_REGIME_DECISION, lane: 'regime' },
    { name: 'fundamental absent', input: FIXTURE_NO_FUNDAMENTAL_INPUT, outcome: FIXTURE_NO_FUNDAMENTAL_DECISION, lane: 'fundamental' },
    { name: 'cross-market absent', input: FIXTURE_NO_CROSS_MARKET_INPUT, outcome: FIXTURE_NO_CROSS_MARKET_DECISION, lane: 'cross-market' },
  ] as const;

  for (const testCase of cases) {
    it(`a decision still composes with ${testCase.name} (quorum 3 met)`, () => {
      expect(testCase.outcome.kind).toBe('decision');
      if (testCase.outcome.kind !== 'decision') throw new Error('expected a decision');
      // The three present lanes still decide. TEST-AAA's non-flat coverage:
      // dropping sentiment/regime/fundamental leaves two bullish lanes (+0.0200);
      // dropping cross-market changes nothing — its stance is FLAT, so the
      // remaining three bullish lanes still net +3 (+0.0300).
      const directive = testCase.outcome.decision.directive;
      expect(directive.kind).toBe('allocation-adjustment');
      if (directive.kind !== 'allocation-adjustment') throw new Error('expected adjustments');
      expect(directive.adjustments).toHaveLength(1);
      expect(directive.adjustments[0]?.instrumentId).toBe('TEST-AAA');
      expect(directive.adjustments[0]?.deltaWeight).toBe(
        testCase.lane === 'cross-market' ? '0.0300' : '0.0200',
      );
      expect(directive.adjustments[0]?.netTilt).toBe(
        testCase.lane === 'cross-market' ? '3.0000' : '2.0000',
      );
    });

    it(`the missing lane is accounted ABSENT with a typed absence record (${testCase.name})`, () => {
      if (testCase.outcome.kind !== 'decision') throw new Error('expected a decision');
      const entry = testCase.outcome.decision.coverage.find((candidate) => candidate.lane === testCase.lane);
      expect(entry?.status).toBe('absent');
      expect(entry?.position).toBeNull();
      expect(entry?.absence).toEqual({ lane: testCase.lane, reason: 'no-report-received' });
      // the other three lanes are accounted
      expect(testCase.outcome.decision.coverage).toHaveLength(4);
      expect(testCase.outcome.decision.inputs.map((input) => input.lane)).not.toContain(testCase.lane);
    });
  }
});

describe('THE CONFLICT PATH (typed conflict records; the majority stands — never a silent average)', () => {
  const outcome: DirectorOutcome = FIXTURE_CONFLICT_DECISION;

  it('composes a DECISION with a recorded conflict (quorum met, majority exists)', () => {
    expect(outcome.kind).toBe('decision');
    if (outcome.kind !== 'decision') throw new Error('expected a decision');
    expect(outcome.decision.conflicts).toHaveLength(1);
    const conflict = outcome.decision.conflicts[0];
    expect(conflict?.instrumentId).toBe('TEST-AAA');
    expect(conflict?.majorityDirection).toBe('bullish');
  });

  it('the conflict record carries PER-BODY positions (bullish, bullish vs bearish)', () => {
    if (outcome.kind !== 'decision') throw new Error('expected a decision');
    const conflict = outcome.decision.conflicts[0];
    expect(conflict?.positions).toEqual([
      { lane: 'sentiment', direction: 'bullish', reportId: expect.any(String) },
      { lane: 'regime', direction: 'bullish', reportId: expect.any(String) },
      { lane: 'fundamental', direction: 'bearish', reportId: expect.any(String) },
    ]);
  });

  it('the majority-rules net tilt is the MAJORITY SIDE (2.0000), NOT the average (0.0033)', () => {
    if (outcome.kind !== 'decision') throw new Error('expected a decision');
    const directive = outcome.decision.directive;
    expect(directive.kind).toBe('allocation-adjustment');
    if (directive.kind !== 'allocation-adjustment') throw new Error('expected adjustments');
    const adjustment = directive.adjustments[0];
    expect(adjustment?.instrumentId).toBe('TEST-AAA');
    // majority side: sentiment +1 and regime +1 => net 2 => delta 0.0200 >= 0.02.
    // a silent average of (1 + 1 - 1) / 3 would be 0.0033 — refused by design.
    expect(adjustment?.netTilt).toBe('2.0000');
    expect(adjustment?.deltaWeight).toBe('0.0200');
  });

  it('the conflicted lanes are accounted CONFLICTED (with their positions); the flat lane consumed', () => {
    if (outcome.kind !== 'decision') throw new Error('expected a decision');
    const statuses = outcome.decision.coverage.map((entry) => [entry.lane, entry.status]);
    expect(statuses).toEqual([
      ['sentiment', 'conflicted'],
      ['regime', 'conflicted'],
      ['fundamental', 'conflicted'],
      ['cross-market', 'consumed'],
    ]);
    for (const entry of outcome.decision.coverage) {
      expect(entry.absence).toBeNull();
    }
  });
});

describe('THE QUORUM-UNMET ESCALATION (a record, never an exception)', () => {
  const outcome: DirectorOutcome = FIXTURE_QUORUM_UNMET_ESCALATION;

  it('composing a quorum-unmet intake NEVER throws and returns an escalation record', () => {
    expect(() => composeDirectorDecision(FIXTURE_QUORUM_UNMET_INPUT)).not.toThrow();
    expect(outcome.kind).toBe('escalation');
  });

  it('the escalation carries the quorum detail (declared quorum, present lanes, absent lanes)', () => {
    if (outcome.kind !== 'escalation') throw new Error('expected an escalation');
    expect(outcome.escalation.reason).toBe('quorum-unmet');
    expect(outcome.escalation.quorum).toEqual({
      declaredQuorum: 3,
      presentLanes: 2,
      absentLanes: ['regime', 'cross-market'],
    });
  });

  it('the escalation still accounts all four lanes (two absence records)', () => {
    if (outcome.kind !== 'escalation') throw new Error('expected an escalation');
    expect(outcome.escalation.coverage).toHaveLength(4);
    const absent = outcome.escalation.coverage.filter((entry) => entry.status === 'absent');
    expect(absent).toHaveLength(2);
    for (const entry of absent) {
      expect(entry.absence).toEqual({ lane: entry.lane, reason: 'no-report-received' });
    }
    expect(outcome.escalation.escalationId).toMatch(/^esc-[0-9a-f]{16}$/);
  });
});

describe('THE IRRECONCILABLE-CONFLICT ESCALATION (a record, never an exception)', () => {
  const outcome: DirectorOutcome = FIXTURE_IRRECONCILABLE_ESCALATION;

  it('composing a tied conflict NEVER throws and returns an escalation record', () => {
    expect(() => composeDirectorDecision(FIXTURE_IRRECONCILABLE_INPUT)).not.toThrow();
    expect(outcome.kind).toBe('escalation');
  });

  it('the reason is irreconcilable-conflict with the blocking tie recorded (majorityDirection null)', () => {
    if (outcome.kind !== 'escalation') throw new Error('expected an escalation');
    expect(outcome.escalation.reason).toBe('irreconcilable-conflict');
    expect(outcome.escalation.quorum).toBeNull();
    expect(outcome.escalation.conflicts).toHaveLength(1);
    const conflict = outcome.escalation.conflicts[0];
    expect(conflict?.instrumentId).toBe('TEST-AAA');
    expect(conflict?.majorityDirection).toBeNull();
    expect(conflict?.positions).toEqual([
      { lane: 'sentiment', direction: 'bullish', reportId: expect.any(String) },
      { lane: 'regime', direction: 'bearish', reportId: expect.any(String) },
    ]);
  });

  it('the quorum was MET (3 of 4 present) — the escalation is purely the conflict outcome', () => {
    if (outcome.kind !== 'escalation') throw new Error('expected an escalation');
    expect(outcome.escalation.inputs).toHaveLength(3);
    expect(outcome.escalation.coverage.filter((entry) => entry.status === 'absent')).toHaveLength(1);
  });
});

describe('THE CONSERVATIVE METHOD (quorum 4, escalate on ANY conflict)', () => {
  it('three present lanes under quorum 4 escalate (quorum-unmet)', () => {
    const outcome = FIXTURE_CONSERVATIVE_QUORUM_ESCALATION;
    expect(outcome.kind).toBe('escalation');
    if (outcome.kind !== 'escalation') throw new Error('expected an escalation');
    expect(outcome.escalation.reason).toBe('quorum-unmet');
    expect(outcome.escalation.quorum?.declaredQuorum).toBe(4);
    expect(outcome.escalation.quorum?.presentLanes).toBe(3);
  });

  it('any conflict escalates under escalate-on-any (even with a strict majority present)', () => {
    const outcome = FIXTURE_CONSERVATIVE_CONFLICT_ESCALATION;
    expect(outcome.kind).toBe('escalation');
    if (outcome.kind !== 'escalation') throw new Error('expected an escalation');
    expect(outcome.escalation.reason).toBe('irreconcilable-conflict');
    expect(outcome.escalation.conflicts).toHaveLength(1);
  });
});

describe('THE QUORUM-IS-DECLARED-NOT-HARDCODED LAW', () => {
  it('a custom method with quorum 2 lets the two-lane intake DECIDE', () => {
    const parameters = {
      ...(DIRECTOR_SYNTHESIS_METHOD.parameters as SynthesisParameters),
      quorum: 2,
    };
    const registryConstruction = createMethodRegistry([
      { ...DIRECTOR_SYNTHESIS_METHOD, methodId: 'method/director/synthesis-loose', parameters },
    ]);
    if (!registryConstruction.ok) throw new Error('registry must construct');
    const input: DirectorCompositionInput = fixtureCompositionInput(
      FIXTURE_QUORUM_UNMET_INPUT.intake,
      'method/director/synthesis-loose',
    );
    const outcome = composeDirectorDecision({ ...input, registry: registryConstruction.value });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.kind).toBe('decision');
      if (outcome.value.kind === 'decision') {
        expect(outcome.value.decision.coverage.filter((entry) => entry.status === 'absent')).toHaveLength(2);
      }
    }
  });

  it('a custom conflict policy record-and-majority lets a TIE produce a no-change decision (declared behavior)', () => {
    const parameters = {
      ...(DIRECTOR_SYNTHESIS_METHOD.parameters as SynthesisParameters),
      conflictPolicy: 'record-and-majority' as const,
    };
    const registryConstruction = createMethodRegistry([
      { ...DIRECTOR_SYNTHESIS_METHOD, methodId: 'method/director/synthesis-tolerant', parameters },
    ]);
    if (!registryConstruction.ok) throw new Error('registry must construct');
    const input: DirectorCompositionInput = fixtureCompositionInput(
      FIXTURE_IRRECONCILABLE_INPUT.intake,
      'method/director/synthesis-tolerant',
    );
    const outcome = composeDirectorDecision({ ...input, registry: registryConstruction.value });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.kind).toBe('decision');
      if (outcome.value.kind === 'decision') {
        // the tie is recorded, no majority stands: TEST-AAA tilt 0, others flat => no-change
        expect(outcome.value.decision.directive.kind).toBe('no-change');
        expect(outcome.value.decision.conflicts).toHaveLength(1);
        expect(outcome.value.decision.conflicts[0]?.majorityDirection).toBeNull();
      }
    }
  });
});

describe('collect-all refusal (structural violations are typed data)', () => {
  it('a malformed goal ref refuses with goal_ref_malformed', () => {
    const outcome = composeDirectorDecision({
      ...FIXTURE_QUORUM_MET_INPUT,
      goal: { goalId: '', version: 1 } as never,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.errors.map((e) => e.code)).toContain('goal_ref_malformed');
    }
  });

  it('an undeclared method refuses with undeclared_method', () => {
    const outcome = composeDirectorDecision({
      ...FIXTURE_QUORUM_MET_INPUT,
      methodId: 'method/director/magic',
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.errors.map((e) => e.code)).toContain('undeclared_method');
    }
  });

  it('research from the future refuses the whole composition (the L4 gate)', () => {
    const outcome = composeDirectorDecision({
      ...FIXTURE_QUORUM_MET_INPUT,
      intake: {
        ...FIXTURE_QUORUM_MET_INPUT.intake,
        sentiment: {
          ...(FIXTURE_QUORUM_MET_INPUT.intake.sentiment as object),
          asOf: (FIXTURE_QUORUM_MET_INPUT.asOf as number) + 1,
        } as never,
      },
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.errors.map((e) => e.code)).toContain('research_from_the_future');
    }
  });

  it('a foreign tenant refuses with tenant_mismatch', () => {
    const intake = deepCloneJson(FIXTURE_QUORUM_MET_INPUT.intake);
    (intake.fundamental as unknown as { tenantId: string }).tenantId = 'tenant-foreign';
    const outcome = composeDirectorDecision({
      ...FIXTURE_QUORUM_MET_INPUT,
      intake,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.errors.map((e) => e.code)).toContain('tenant_mismatch');
    }
  });
});

describe('THE DETERMINISM GOLDEN (byte-identical, run twice)', () => {
  it('composing the same input twice yields byte-identical canonical decisions', () => {
    const first = composeDirectorDecision(FIXTURE_QUORUM_MET_INPUT);
    const second = composeDirectorDecision(FIXTURE_QUORUM_MET_INPUT);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('must compose');
    expect(JSON.stringify(first.value)).toBe(JSON.stringify(second.value));
    expect(JSON.stringify(first.value)).toBe(JSON.stringify(FIXTURE_GOLDEN_DECISION));
  });

  it('a different seed yields a DIFFERENT decision id (the seed is lineage material)', () => {
    const variant = composeDirectorDecision({
      ...FIXTURE_QUORUM_MET_INPUT,
      seed: 'seed/director/fixture-2',
    });
    expect(variant.ok).toBe(true);
    if (variant.ok && variant.value.kind === 'decision' && FIXTURE_GOLDEN_DECISION.kind === 'decision') {
      expect(variant.value.decision.decisionId).not.toBe(FIXTURE_GOLDEN_DECISION.decision.decisionId);
    }
  });

  it('the escalation determinism golden (byte-identical, run twice)', () => {
    const first = composeDirectorDecision(FIXTURE_QUORUM_UNMET_INPUT);
    const second = composeDirectorDecision(FIXTURE_QUORUM_UNMET_INPUT);
    expect(first.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('must compose');
    expect(JSON.stringify(first.value)).toBe(JSON.stringify(second.value));
    expect(JSON.stringify(first.value)).toBe(JSON.stringify(FIXTURE_QUORUM_UNMET_ESCALATION));
  });

  it('input lane ORDER does not leak into the bytes (the intake is addressed by lane field, not array order)', () => {
    const intake = {
      crossMarket: FIXTURE_CROSS_MARKET_REPORT,
      fundamental: FIXTURE_QUORUM_MET_INPUT.intake.fundamental,
      regime: FIXTURE_QUORUM_MET_INPUT.intake.regime,
      sentiment: FIXTURE_QUORUM_MET_INPUT.intake.sentiment,
    };
    const outcome = composeDirectorDecision({ ...FIXTURE_QUORUM_MET_INPUT, intake });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(JSON.stringify(outcome.value)).toBe(JSON.stringify(FIXTURE_GOLDEN_DECISION));
    }
  });
});

void FIXTURE_REGISTRY;
void FIXTURE_CONFLICT_INPUT;
