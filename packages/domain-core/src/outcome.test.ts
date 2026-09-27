import { describe, expect, it } from 'vitest';
import { Outcome, isOutcome, isOutcomeVerdict } from './outcome';
import { DecimalString, Timestamp } from './primitives';
import { DecisionId, ExecutionId, OutcomeId, PostMortemId, ProjectId } from './ids';

const dec = (s: string) => s as DecimalString;
const ts = (s: string) => s as Timestamp;

const out1 = 'out_1' as OutcomeId;
const prj1 = 'prj_1' as ProjectId;
const dec1 = 'dec_1' as DecisionId;
const exec1 = 'exec_1' as ExecutionId;
const pm1 = 'pm_1' as PostMortemId;

function validOutcome(): Outcome {
  return {
    id: out1,
    projectId: prj1,
    decisionId: dec1,
    executionId: exec1,
    realizedAt: ts('2027-01-20T16:45:00Z'),
    verdict: 'met',
    realizedPnl: dec('186.40'),
    metrics: {
      'pnl.realized': 186.4,
      'constraints.satisfied': 9,
      'constraints.violated': 0,
      'slippage.bps': 1.7,
      'comment': 'Scale-in completed within risk limits.',
    },
    postMortemId: pm1,
    summary: 'Scale-in achieved objective with 9/9 constraints satisfied.',
  };
}

describe('isOutcome — acceptance', () => {
  it('accepts a fully valid outcome linked to decision and execution', () => {
    expect(isOutcome(validOutcome())).toBe(true);
  });

  it('accepts an outcome without execution (decision never reached the execution plane)', () => {
    expect(isOutcome({ ...validOutcome(), executionId: undefined })).toBe(true);
  });

  it('accepts an inconclusive outcome with empty metrics', () => {
    const inconclusive: Outcome = {
      ...validOutcome(),
      verdict: 'inconclusive',
      realizedPnl: undefined,
      metrics: {},
      postMortemId: undefined,
    };
    expect(isOutcome(inconclusive)).toBe(true);
  });
});

describe('isOutcome — rejection', () => {
  it('rejects malformed outcomes', () => {
    const invalid: unknown[] = [
    { ...validOutcome(), id: '' },
    { ...validOutcome(), projectId: '' },
    { ...validOutcome(), decisionId: '' }, // lineage to the decision is mandatory (L15)
    { ...validOutcome(), executionId: 42 },
    { ...validOutcome(), realizedAt: '2027-01-20T16:45:00' },
    { ...validOutcome(), verdict: 'good' },
    { ...validOutcome(), verdict: 'MET' },
    { ...validOutcome(), realizedPnl: '186.40 USD' },
    { ...validOutcome(), realizedPnl: 186.4 }, // number, not decimal string
    { ...validOutcome(), metrics: { 'bad key': 1 } },
    { ...validOutcome(), metrics: { 'ok.ok': '' } }, // empty string is not a metric value
    { ...validOutcome(), metrics: { 'ok.ok': Number.NaN } },
    { ...validOutcome(), metrics: { 'ok.ok': null } },
    { ...validOutcome(), metrics: [] },
    { ...validOutcome(), postMortemId: '' },
    { ...validOutcome(), summary: '' },
    null,
  ];
    for (const o of invalid) expect(isOutcome(o)).toBe(false);
  });
});

describe('verdict vocabulary', () => {
  it('verdicts are met/partially-met/missed/inconclusive', () => {
    for (const v of ['met', 'partially-met', 'missed', 'inconclusive']) {
      expect(isOutcomeVerdict(v)).toBe(true);
    }
    expect(isOutcomeVerdict('partial')).toBe(false);
    expect(isOutcomeVerdict('')).toBe(false);
  });
});
