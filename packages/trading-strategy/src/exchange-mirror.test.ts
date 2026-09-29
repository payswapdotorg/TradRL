/**
 * Behavioral tests for the exchange mirrors: the OrderIntent mirror's
 * field-presence matrix (law for law with exchange-sim), the account
 * fill, the corporate actions, the authority trip wire, and the
 * intent/refusal validation laws (L8/L9/L12 negative paths — the Work
 * Order's acceptance criteria 5, 6 and 11).
 */

import { describe, expect, it } from 'vitest';

import {
  authorityKeyPaths,
  authorityViolations,
  authorityVerbPaths,
  isAccountFill,
  isCorporateAction,
  isOrderIntentMirror,
  isStrategyIntent,
  isoTimestampOf,
  validateIntentRefusal,
  validateStrategyIntent,
  type AccountFill,
  type OrderIntentMirror,
} from './index';

const T0 = 1_700_000_000_000;
const ISO = '2023-11-14T22:13:20.000Z';

function order(overrides?: Record<string, unknown>): OrderIntentMirror {
  const base = {
    clientOrderId: 'si-1',
    instrumentId: 'BTC-USD',
    venueId: 'SIM',
    side: 'buy',
    kind: 'limit',
    quantity: '0.001',
    price: '50000.01',
    timeInForce: 'gtc',
    createdAt: ISO,
  } as unknown as Record<string, unknown>;
  return { ...base, ...overrides } as unknown as OrderIntentMirror;
}

describe('the OrderIntent mirror (exchange-sim shape, law for law)', () => {
  it('accepts a well-formed limit intent', () => {
    expect(isOrderIntentMirror(order())).toBe(true);
  });

  it('the core-kind price matrix: market carries no price; limit requires one; stop requires stopPrice', () => {
    expect(isOrderIntentMirror(order({ kind: 'market', price: undefined }))).toBe(true);
    expect(isOrderIntentMirror(order({ kind: 'market' }))).toBe(false); // price present on a market intent
    expect(isOrderIntentMirror(order({ kind: 'limit', price: undefined }))).toBe(false);
    expect(isOrderIntentMirror(order({ kind: 'stop', price: undefined, stopPrice: '49000' }))).toBe(true);
    expect(isOrderIntentMirror(order({ kind: 'stop' }))).toBe(false);
    expect(isOrderIntentMirror(order({ kind: 'stop-limit', stopPrice: '49000' }))).toBe(true);
    expect(isOrderIntentMirror(order({ kind: 'stop-limit', stopPrice: '49000', price: undefined }))).toBe(false);
  });

  it('the expiry matrix: gtt requires expiresAt; other core TIFs reject it', () => {
    expect(isOrderIntentMirror(order({ timeInForce: 'gtt', expiresAt: ISO }))).toBe(true);
    expect(isOrderIntentMirror(order({ timeInForce: 'gtt' }))).toBe(false);
    expect(isOrderIntentMirror(order({ timeInForce: 'gtc', expiresAt: ISO }))).toBe(false);
  });

  it('quantities and prices are strictly positive canonical decimals (no float forms)', () => {
    expect(isOrderIntentMirror(order({ quantity: '0' }))).toBe(false);
    expect(isOrderIntentMirror(order({ quantity: '01.5' }))).toBe(false);
    expect(isOrderIntentMirror(order({ quantity: '-1' }))).toBe(false);
    expect(isOrderIntentMirror(order({ price: '0.001' }))).toBe(true);
    expect(isOrderIntentMirror(order({ price: '50000.' }))).toBe(false);
  });

  it('isoTimestampOf is a pure deterministic conversion (no clock read)', () => {
    expect(isoTimestampOf(T0 as never)).toBe(ISO);
    expect(isoTimestampOf(T0 as never)).toBe(ISO); // twice: identical bytes
  });
});

describe('the account fill and corporate actions', () => {
  it('a well-formed account fill passes; bad sides and zero quantities fail', () => {
    const good = {
      fill_id: 'f1',
      instrument: 'BTC-USD',
      venue: 'SIM',
      side: 'buy',
      price: '50000',
      quantity: '0.001',
      fee: '0.25',
      event_time: T0,
    } as unknown as AccountFill;
    expect(isAccountFill(good)).toBe(true);
    expect(isAccountFill({ ...good, side: 'short' as never })).toBe(false);
    expect(isAccountFill({ ...good, quantity: '0' })).toBe(false);
    expect(isAccountFill({ ...good, fee: '-1' })).toBe(false);
    expect(isAccountFill({ ...good, price: '0' })).toBe(false);
  });

  it('corporate actions enforce their field-presence matrix', () => {
    expect(isCorporateAction({ action_id: 'd1', instrument: 'BTC-USD', kind: 'cash_dividend', cashPerUnit: '1.5', ex_time: T0 })).toBe(true);
    expect(isCorporateAction({ action_id: 'd1', instrument: 'BTC-USD', kind: 'cash_dividend', ex_time: T0 })).toBe(false); // no cashPerUnit
    expect(isCorporateAction({ action_id: 's1', instrument: 'BTC-USD', kind: 'split', splitRatio: '2', ex_time: T0 })).toBe(true);
    expect(isCorporateAction({ action_id: 's1', instrument: 'BTC-USD', kind: 'split', splitRatio: '2', cashPerUnit: '1', ex_time: T0 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The L8 authority trip wire (acceptance 5)
// ---------------------------------------------------------------------------

describe('the L8 authority trip wire', () => {
  it('authority-embedding keys are found at every depth with dotted paths', () => {
    const crime = { order: { venueId: 'SIM' }, venuePermission: 'BINANCE:trade' };
    expect(authorityKeyPaths(crime)).toEqual(['venuePermission']);
    const nested = { a: { b: [{ credential: 'x' }] } };
    expect(authorityKeyPaths(nested)).toEqual(['a.b[0].credential']);
  });

  it('authority verbs are caught as whole string values, not prose fragments', () => {
    expect(authorityVerbPaths({ notes: 'authorize' })).toEqual(['notes']);
    expect(authorityVerbPaths({ notes: 'the strategy may authorize nothing' })).toEqual([]); // prose is free
    expect(authorityVerbPaths({ a: { b: 'bypass-risk' } })).toEqual(['a.b']);
  });

  it('the combined scan reports both crimes', () => {
    expect([...authorityViolations({ token: 't', action: 'grant' })].sort()).toEqual(['action', 'token']);
  });

  it('an intent embedding a venue permission fails validation with authority_in_strategy (the negative test)', () => {
    const criminal = {
      intentId: 'si:00000000',
      sequence: 1,
      order: order(),
      constraintProof: {
        constraintSet: { id: 'cs-1', version: 1 },
        satisfied: [],
        advisoryViolations: [],
      },
      goal: { goalId: 'goal-1', version: 1 },
      strategy: { specId: 'spec-1', version: 1 },
      windowRefs: ['win-1'],
      seed: 'seed',
      tenant: 'tenant-alpha',
      project: 'project-one',
      riskPolicyRefs: [],
      rationale: { kind: 'rebalance_drift', instrumentId: 'BTC-USD', targetWeight: '0.5', currentWeight: '0.7', drift: '0.2' },
      asOf: T0,
      venuePermission: 'BINANCE:trade', // THE CRIME
    };
    expect(isStrategyIntent(criminal)).toBe(false);
    const result = validateStrategyIntent(criminal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const authority = result.errors.filter((error) => error.code === 'authority_in_strategy');
      expect(authority.length).toBeGreaterThanOrEqual(1);
      expect(authority[0]?.path).toBe('intent.venuePermission');
    }
  });

  it('an intent embedding a credential ref fails validation (L8)', () => {
    const criminal = {
      intentId: 'si:00000000',
      sequence: 1,
      order: order(),
      constraintProof: { constraintSet: { id: 'cs-1', version: 1 }, satisfied: [], advisoryViolations: [] },
      goal: { goalId: 'goal-1', version: 1 },
      strategy: { specId: 'spec-1', version: 1 },
      windowRefs: ['win-1'],
      seed: 'seed',
      tenant: 'tenant-alpha',
      project: 'project-one',
      riskPolicyRefs: [],
      rationale: { kind: 'initial_allocation', instrumentId: 'BTC-USD', targetWeight: '0.5', currentWeight: '0', drift: '0.5' },
      asOf: T0,
      executionGrant: 'grant-all', // THE CRIME (an authority verb as a key's sibling form)
    };
    const result = validateStrategyIntent(criminal);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.code === 'authority_in_strategy')).toBe(true);
  });

  it('an intent whose notes ASSERT an authority verb fails validation', () => {
    const criminal = {
      intentId: 'si:00000000',
      sequence: 1,
      order: order({ notes: 'force-execute' }), // the authority verb as the whole value
      constraintProof: { constraintSet: { id: 'cs-1', version: 1 }, satisfied: [], advisoryViolations: [] },
      goal: { goalId: 'goal-1', version: 1 },
      strategy: { specId: 'spec-1', version: 1 },
      windowRefs: ['win-1'],
      seed: 'seed',
      tenant: 'tenant-alpha',
      project: 'project-one',
      riskPolicyRefs: [],
      rationale: { kind: 'rebalance_drift', instrumentId: 'BTC-USD', targetWeight: '0.5', currentWeight: '0.7', drift: '0.2' },
      asOf: T0,
    };
    const result = validateStrategyIntent(criminal);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'authority_in_strategy' && error.path.includes('order.notes'))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The L9/L12 validation laws (acceptance 6 and 11)
// ---------------------------------------------------------------------------

describe('intent and refusal validation — lineage and tenant laws', () => {
  function baseIntent(): Record<string, unknown> {
    return {
      intentId: 'si:00000000',
      sequence: 1,
      order: order(),
      constraintProof: { constraintSet: { id: 'cs-1', version: 1 }, satisfied: [], advisoryViolations: [] },
      goal: { goalId: 'goal-1', version: 1 },
      strategy: { specId: 'spec-1', version: 1 },
      windowRefs: ['win-1'],
      seed: 'seed',
      tenant: 'tenant-alpha',
      project: 'project-one',
      riskPolicyRefs: [],
      rationale: { kind: 'rebalance_drift', instrumentId: 'BTC-USD', targetWeight: '0.5', currentWeight: '0.7', drift: '0.2' },
      asOf: T0,
    };
  }

  it('a lineage-stripped intent fails with lineage_gap codes naming every missing field (acceptance 6)', () => {
    const broken = baseIntent();
    delete broken.goal;
    delete broken.strategy;
    delete broken.windowRefs;
    delete broken.seed;
    const result = validateStrategyIntent(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map((error) => error.code);
      expect(codes).toContain('lineage_gap');
      const paths = result.errors.map((error) => error.path);
      expect(paths).toContain('intent.goal');
      expect(paths).toContain('intent.strategy');
      expect(paths).toContain('intent.windowRefs');
      expect(paths).toContain('intent.seed');
    }
  });

  it('a tenantless intent fails with tenant_missing (acceptance 11)', () => {
    const broken = baseIntent();
    delete broken.tenant;
    delete broken.project;
    const result = validateStrategyIntent(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map((error) => error.code);
      expect(codes).toContain('tenant_missing');
      expect(codes.filter((code) => code === 'tenant_missing').length).toBe(2);
    }
  });

  it('a refusal without violated predicates or lineage fails validation', () => {
    const result = validateIntentRefusal({
      sequence: 1,
      cause: 'constraint_refused',
      violated: [],
      candidate: { side: 'buy', instrumentId: 'BTC-USD', venueId: 'SIM', quantity: '1' },
      goal: { goalId: 'goal-1', version: 1 },
      strategy: { specId: 'spec-1', version: 1 },
      windowRefs: ['win-1'],
      seed: 'seed',
      tenant: 'tenant-alpha',
      project: 'project-one',
      asOf: T0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.path === 'refusal.violated')).toBe(true);
    }
  });

  it('a well-formed refusal validates and freezes', () => {
    const result = validateIntentRefusal({
      sequence: 1,
      cause: 'constraint_refused',
      violated: [
        {
          constraintId: 'max-positions',
          domain: 'state',
          subject: 'state.positions',
          severity: 'blocking',
          predicate: { kind: 'limit.max', bound: 0 },
          observed: 1,
        },
      ],
      candidate: { side: 'buy', instrumentId: 'BTC-USD', venueId: 'SIM', quantity: '1' },
      goal: { goalId: 'goal-1', version: 1 },
      strategy: { specId: 'spec-1', version: 1 },
      windowRefs: ['win-1'],
      seed: 'seed',
      tenant: 'tenant-alpha',
      project: 'project-one',
      asOf: T0,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.isFrozen(result.value)).toBe(true);
  });
});
