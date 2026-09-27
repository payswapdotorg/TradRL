import { describe, expect, it } from 'vitest';
import { Goal, isGoal, isGoalHorizon, isGoalSuccessCriteria, isPermittedAction } from './goal';
import { MarketScope, DataScope, isMarketScope, isDataScope } from './market-scope';
import { Timestamp } from './primitives';
import { ConstraintSetId, GoalId, InstrumentId, RiskPolicyId, VenueId } from './ids';

const ts = (s: string) => s as Timestamp;

const goalId = 'goal_1' as GoalId;
const constraintSetId = 'cs_goal_1' as ConstraintSetId;
const binance = 'venue_binance' as VenueId;
const coinbase = 'venue_coinbase' as VenueId;
const btcUsdt = 'instr_btc_usdt' as InstrumentId;
const riskPolicy = 'risk_policy_1' as RiskPolicyId;

function validGoal(): Goal {
  return {
    id: goalId,
    createdAt: ts('2027-01-02T08:00:00Z'),
    objective: 'Grow risk-adjusted returns on crypto majors while staying within hard risk limits.',
    horizon: {
      startsAt: ts('2027-01-04T00:00:00Z'),
      endsAt: ts('2027-04-04T00:00:00Z'),
      label: 'Q1 2027',
    },
    successCriteria: {
      constraintSet: { id: constraintSetId, version: 1 },
      requiredSatisfaction: 1,
    },
    marketScope: {
      venues: [binance, coinbase],
      instruments: [btcUsdt],
      assetClasses: ['crypto'],
    },
    dataScope: { categories: ['market-data', 'news'], feeds: ['feed_agg_trades'] },
    allowedActions: ['order.market', 'order.limit', 'order.cancel', 'data.request'],
    riskPolicyId: riskPolicy,
    description: 'Primary capital preservation goal.',
  };
}

describe('isGoal — acceptance', () => {
  it('accepts a fully valid goal', () => {
    expect(isGoal(validGoal())).toBe(true);
  });

  it('accepts research-only goals (no order permissions) as long as some action is allowed', () => {
    const goal: Goal = {
      ...validGoal(),
      allowedActions: ['data.request', 'report.publish'],
    };
    expect(isGoal(goal)).toBe(true);
  });
});

describe('isGoal — rejection', () => {
  it('rejects malformed goals', () => {
    const invalidGoals: unknown[] = [
    { ...validGoal(), id: '' },
    { ...validGoal(), objective: '' },
    { ...validGoal(), objective: 42 },
    { ...validGoal(), createdAt: '2027-01-02T08:00:00' }, // no offset
    { ...validGoal(), riskPolicyId: '' },
    { ...validGoal(), allowedActions: [] }, // at least one permission required
    { ...validGoal(), allowedActions: ['order.flash-crash'] }, // not a permitted action
    { ...validGoal(), allowedActions: 'order.limit' }, // not an array
    { ...validGoal(), horizon: { startsAt: ts('2027-04-04T00:00:00Z'), endsAt: ts('2027-01-04T00:00:00Z') } }, // inverted
    { ...validGoal(), horizon: { startsAt: ts('2027-01-04T00:00:00Z'), endsAt: ts('2027-01-04T00:00:00Z') } }, // empty horizon
    { ...validGoal(), horizon: { startsAt: ts('2027-01-04T00:00:00Z'), endsAt: ts('2027-01-04T00:00:00Z'), label: '' } },
    {
      ...validGoal(),
      successCriteria: { constraintSet: { id: 'cs_goal_1', version: 0 }, requiredSatisfaction: 1 },
    },
    {
      ...validGoal(),
      successCriteria: { constraintSet: { id: 'cs_goal_1', version: 1 }, requiredSatisfaction: 1.1 },
    },
    {
      ...validGoal(),
      successCriteria: { constraintSet: { id: 'cs_goal_1', version: 1 }, requiredSatisfaction: -0.1 },
    },
    { ...validGoal(), marketScope: { venues: [], instruments: [], assetClasses: [] } }, // universe must be explicit
    { ...validGoal(), marketScope: { venues: ['v'], instruments: [], assetClasses: ['cryptocurrency'] } }, // bad vocabulary
    { ...validGoal(), marketScope: { venues: 'venue_binance', instruments: [], assetClasses: ['crypto'] } },
    { ...validGoal(), dataScope: { categories: ['market'] } }, // bad vocabulary
    { ...validGoal(), dataScope: { categories: [], feeds: [''] } },
    { ...validGoal(), description: '' },
    null,
    'goal',
  ];
    for (const g of invalidGoals) expect(isGoal(g)).toBe(false);
  });
});

describe('component guards', () => {
  it('isGoalHorizon requires a strictly positive, well-ordered window', () => {
    expect(isGoalHorizon(validGoal().horizon)).toBe(true);
    expect(isGoalHorizon({ startsAt: ts('2027-01-04T00:00:00Z'), endsAt: ts('2027-01-05T00:00:00Z') })).toBe(true);
    expect(isGoalHorizon({ startsAt: ts('2027-01-05T00:00:00Z'), endsAt: ts('2027-01-04T00:00:00Z') })).toBe(false);
    expect(isGoalHorizon({ startsAt: ts('2027-01-04T00:00:00Z') })).toBe(false);
    // Equivalent instants with different offsets still form an empty horizon.
    expect(
      isGoalHorizon({ startsAt: ts('2027-01-04T00:00:00Z'), endsAt: ts('2027-01-04T01:00:00+01:00') }),
    ).toBe(false);
  });

  it('isGoalSuccessCriteria requires a valid constraint-set ref and a [0,1] ratio', () => {
    expect(isGoalSuccessCriteria(validGoal().successCriteria)).toBe(true);
    expect(isGoalSuccessCriteria({ constraintSet: { id: 'cs', version: 1 }, requiredSatisfaction: 0 })).toBe(true);
    expect(isGoalSuccessCriteria({ constraintSet: { id: '', version: 1 }, requiredSatisfaction: 1 })).toBe(false);
    expect(isGoalSuccessCriteria({ constraintSet: { id: 'cs', version: 2.5 }, requiredSatisfaction: 1 })).toBe(false);
    expect(isGoalSuccessCriteria({ constraintSet: { id: 'cs', version: 1 }, requiredSatisfaction: 1.5 })).toBe(false);
  });

  it('isMarketScope requires at least one explicit selector', () => {
    const scope = { venues: [binance], instruments: [], assetClasses: [] };
    expect(isMarketScope(scope)).toBe(true);
    expect(isMarketScope({ venues: [], instruments: ['i1'], assetClasses: [] })).toBe(true);
    expect(isMarketScope({ venues: [], instruments: [], assetClasses: ['crypto'] })).toBe(true);
    expect(isMarketScope({ venues: [], instruments: [], assetClasses: [] })).toBe(false);
    expect(isMarketScope({ venues: [''], instruments: [], assetClasses: [] })).toBe(false);
    expect(isMarketScope({})).toBe(false);
  });

  it('isDataScope allows empty categories (no external data) but validates vocabulary', () => {
    const empty: DataScope = { categories: [] };
    expect(isDataScope(empty)).toBe(true);
    expect(isDataScope({ categories: ['macro', 'social'] })).toBe(true);
    expect(isDataScope({ categories: [], feeds: ['feed_1'] })).toBe(true);
    expect(isDataScope({ categories: ['tweets'] })).toBe(false);
    expect(isDataScope({ categories: [], feeds: [] })).toBe(true); // explicit empty feeds
    expect(isDataScope({ categories: [], feeds: [''] })).toBe(false);
    expect(isDataScope(null)).toBe(false);
  });

  it('isPermittedAction validates against the closed permission vocabulary', () => {
    expect(isPermittedAction('order.limit')).toBe(true);
    expect(isPermittedAction('report.publish')).toBe(true);
    expect(isPermittedAction('order.flash')).toBe(false); // closed: no ad-hoc permissions
    expect(isPermittedAction('')).toBe(false);
  });
});
