import { describe, expect, it } from 'vitest';
import { Decision, isDecision, isDecisionAlternative } from './decision';
import { Timestamp } from './primitives';
import { AgentInstanceId, DecisionId, EvidenceCapsuleId, ProjectId } from './ids';

const ts = (s: string) => s as Timestamp;

const dec1 = 'dec_1' as DecisionId;
const prj1 = 'prj_1' as ProjectId;
const instDirector = 'inst_director_1' as AgentInstanceId;
const ev1 = 'ev_1' as EvidenceCapsuleId;

function validDecision(): Decision {
  return {
    id: dec1,
    projectId: prj1,
    agentInstanceId: instDirector,
    madeAt: ts('2027-01-15T09:29:59.900Z'),
    summary: 'Scale into BTC long via limit orders on a momentum regime confirmation.',
    evidenceCapsuleId: ev1,
    alternatives: [
      {
        summary: 'Wait for pullback confirmation before scaling in.',
        rationale: 'Expected regime confirmation is already above threshold.',
      },
      { summary: 'Enter immediately with market orders.' },
    ],
    confidence: 0.72,
  };
}

describe('isDecision — acceptance', () => {
  it('accepts a fully valid decision record', () => {
    expect(isDecision(validDecision())).toBe(true);
  });

  it('accepts boundary confidence values 0 and 1', () => {
    expect(isDecision({ ...validDecision(), confidence: 0 })).toBe(true);
    expect(isDecision({ ...validDecision(), confidence: 1 })).toBe(true);
  });

  it('accepts a forced decision with no alternatives', () => {
    expect(isDecision({ ...validDecision(), alternatives: [] })).toBe(true);
  });
});

describe('isDecision — rejection', () => {
  it('rejects malformed decisions', () => {
    const invalid: unknown[] = [
    { ...validDecision(), id: '' },
    { ...validDecision(), projectId: '' },
    { ...validDecision(), agentInstanceId: null },
    { ...validDecision(), madeAt: '2027-01-15T09:29:59' }, // no offset
    { ...validDecision(), summary: '' },
    { ...validDecision(), evidenceCapsuleId: '' },
    { ...validDecision(), alternatives: [{ summary: '' }] },
    { ...validDecision(), alternatives: [{ summary: 'ok', rationale: '' }] },
    { ...validDecision(), alternatives: 'none' },
    { ...validDecision(), confidence: -0.01 },
    { ...validDecision(), confidence: 1.01 },
    { ...validDecision(), confidence: Number.NaN },
    { ...validDecision(), confidence: 'high' },
    null,
    42,
  ];
    for (const d of invalid) expect(isDecision(d)).toBe(false);
  });
});

describe('isDecisionAlternative', () => {
  it('requires a non-empty summary; rationale optional', () => {
    expect(isDecisionAlternative({ summary: 'Hold cash.' })).toBe(true);
    expect(isDecisionAlternative({ summary: 'Hold cash.', rationale: 'Regime unclear.' })).toBe(true);
    expect(isDecisionAlternative({ summary: '' })).toBe(false);
    expect(isDecisionAlternative({ rationale: 'no summary' })).toBe(false);
    expect(isDecisionAlternative(null)).toBe(false);
  });
});
