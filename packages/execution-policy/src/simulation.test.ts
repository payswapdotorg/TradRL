/**
 * @tradrl/execution-policy — the simulation tests: the honesty law
 * (L5/L6), the venue-lineage law and the fill-validation laws.
 */

import { describe, expect, it } from 'vitest';

import {
  SIMULATION_FIDELITY,
  SIMULATION_FIDELITY_MODES,
  isExecutionSimulationSpec,
  isSimulatedFill,
  validateExecutionSimulationSpec,
  validateSimulatedFill,
  validateVenueModelConfig,
  venueModelDigest,
  type ExecutionSimulationSpec,
  type SimulatedFill,
} from './index';
import { T0, fixtureIntent, unwrap } from './test-fixtures';

/** A valid venue model config (the exchange-sim config mirror). */
function venueModel() {
  return unwrap(
    validateVenueModelConfig({
      venue: 'REFSIM',
      instrument: 'BTC-USD',
      asset_class: 'crypto',
      tick_size: '0.01',
      lot_size: '0.001',
      max_book_depth: 10,
      seed: 't019-seed',
      fidelity: 'reactive_replay',
      fees: { tiers: [{ up_to_notional: null, maker_bps: '1', taker_bps: '2' }], fee_decimals: 8 },
      latency: { kind: 'fixed', fixed_ms: 250 },
      slippage: { kind: 'book_walk' },
      impact: { kind: 'none', declaration: 'no endogenous impact', limitation: 'T027 owns endogenous reaction' },
    }),
  );
}

/** A valid simulation spec input (the content minus the derived id). */
function specInput() {
  const config = venueModel();
  return {
    fidelity: 'simulated_matching' as const,
    venueModels: [{ config, configDigest: venueModelDigest(config), engineRef: 'engine:refsim-btc@1' }],
    seed: 't019-seed',
    tenant: 'tenant-alpha',
    project: 'project-one',
  };
}

/** A valid simulated fill (overridable per test — the fixture discipline). */
function fill(overrides: Record<string, unknown> = {}): SimulatedFill {
  const intent = fixtureIntent();
  const base = {
    fillId: 'xsf-00000001',
    sequence: 1,
    venue: 'REFSIM',
    instrument: 'BTC-USD',
    side: 'buy',
    price: '50000.00',
    aggressorPrice: '50000.00',
    quantity: '0.5',
    fee: '0.5',
    latencyMs: 250,
    decisionId: 'xd:abc12345',
    intentRef: intent.intentId,
    fidelity: 'simulated_matching',
    venueLineage: {
      configDigest: venueModelDigest(venueModel()),
      engineOrderRef: 'xo-00000001',
      engineFillRef: 'xf-00000001',
      feesRef: 'fees:refsim@1',
      latencyRef: 'latency:refsim@1',
      slippageRef: 'slippage:refsim@1',
      impactRef: 'impact:refsim@1',
    },
    lineage: {
      intentRef: intent.intentId,
      strategy: { specId: 'spec-fixture', version: 1 },
      goal: { goalId: 'goal-fixture', version: 1 },
      policy: { policyId: 'xpol:abc12345', version: 1 },
      venues: ['REFSIM'],
      seed: 't019-seed',
      tenant: 'tenant-alpha',
      project: 'project-one',
    },
    tenant: 'tenant-alpha',
    project: 'project-one',
    asOf: T0,
  } as unknown as SimulatedFill;
  return { ...base, ...overrides } as unknown as SimulatedFill;
}

describe('ExecutionSimulationSpec — the honesty law (L5/L6)', () => {
  it('the fidelity declaration exists and names the modeled and unmodeled behaviors', () => {
    expect(SIMULATION_FIDELITY.modeled.length).toBeGreaterThan(0);
    expect(SIMULATION_FIDELITY.declared_limitations.length).toBeGreaterThan(0);
    expect(SIMULATION_FIDELITY.declared_limitations.join(' ')).toContain('live');
    expect(SIMULATION_FIDELITY_MODES).toEqual(['paper_venue', 'simulated_matching']);
  });

  it('a valid spec validates with a content-addressed identity', () => {
    const spec = unwrap(validateExecutionSimulationSpec(specInput()));
    expect(spec.specId).toMatch(/^xsim:[0-9a-f]{8}$/);
    expect(isExecutionSimulationSpec(spec)).toBe(true);
    expect(Object.isFrozen(spec)).toBe(true);
    // Determinism: the same declaration yields the same identity.
    const again = unwrap(validateExecutionSimulationSpec(specInput()));
    expect(again.specId).toBe(spec.specId);
  });

  it('NEGATIVE — a spec claiming LIVE fidelity fails with fidelity_claim_dishonest', () => {
    const result = validateExecutionSimulationSpec({ ...specInput(), fidelity: 'live' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'fidelity_claim_dishonest')).toBe(true);
    }
    // Every alias of "real" fails identically.
    for (const alias of ['real', 'paper', 'production', 'exact_replay']) {
      const aliased = validateExecutionSimulationSpec({ ...specInput(), fidelity: alias });
      expect(aliased.ok).toBe(false);
    }
  });

  it('NEGATIVE — a drifted config digest fails with lineage_gap (forged lineage anchor)', () => {
    const input = specInput();
    const model = input.venueModels[0];
    if (model === undefined) throw new Error('unreachable');
    const broken = { ...input, venueModels: [{ ...model, configDigest: 'deadbeef' }] };
    const result = validateExecutionSimulationSpec(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'lineage_gap' && error.path.includes('configDigest'))).toBe(true);
    }
  });

  it('NEGATIVE — a spec missing its seed or scope fails (L9/L12)', () => {
    const noSeed = specInput() as Record<string, unknown>;
    delete noSeed.seed;
    expect(validateExecutionSimulationSpec(noSeed).ok).toBe(false);
    const noTenant = specInput() as Record<string, unknown>;
    delete noTenant.tenant;
    const result = validateExecutionSimulationSpec(noTenant);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.code === 'tenant_missing')).toBe(true);
  });

  it('NEGATIVE — an impact policy the engine does not implement fails closed', () => {
    const input = specInput();
    const model = input.venueModels[0];
    if (model === undefined) throw new Error('unreachable');
    const result = validateVenueModelConfig({ ...model.config, impact: { kind: 'square-root', declaration: 'x', limitation: 'y' } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'fidelity_claim_dishonest')).toBe(true);
    }
  });
});

describe('SimulatedFill — honest by construction', () => {
  it('a valid fill passes validation deeply frozen', () => {
    const validated = unwrap(validateSimulatedFill(fill()));
    expect(isSimulatedFill(validated)).toBe(true);
    expect(Object.isFrozen(validated)).toBe(true);
    // The venue lineage is carried: config digest + engine refs + the
    // four physics config refs.
    expect(validated.venueLineage.configDigest).toMatch(/^[0-9a-f]{8}$/);
    expect(validated.venueLineage.engineOrderRef).toBe('xo-00000001');
    expect(validated.venueLineage.engineFillRef).toBe('xf-00000001');
    expect(validated.venueLineage.feesRef).toMatch(/^fees:/);
    expect(validated.venueLineage.latencyRef).toMatch(/^latency:/);
    expect(validated.venueLineage.slippageRef).toMatch(/^slippage:/);
    expect(validated.venueLineage.impactRef).toMatch(/^impact:/);
  });

  it('NEGATIVE — a simulated fill claiming LIVE fidelity fails with fidelity_claim_dishonest', () => {
    const result = validateSimulatedFill(fill({ fidelity: 'live' as never }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'fidelity_claim_dishonest')).toBe(true);
    }
    for (const alias of ['real', 'production', 'exact_replay']) {
      expect(validateSimulatedFill(fill({ fidelity: alias as never })).ok).toBe(false);
    }
  });

  it('NEGATIVE — a fill without venue lineage fails with lineage_gap (not evidence of anything)', () => {
    const broken = fill() as unknown as Record<string, unknown>;
    delete broken.venueLineage;
    const result = validateSimulatedFill(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'lineage_gap' && error.path.includes('venueLineage'))).toBe(true);
    }
  });

  it('NEGATIVE — a fill whose lineage binds a different intent fails with lineage_gap (incoherent)', () => {
    const mismatch = fill();
    const lineage = { ...mismatch.lineage, intentRef: 'si:someother' };
    const result = validateSimulatedFill({ ...mismatch, lineage });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'lineage_gap' && error.message.includes('incoherent'))).toBe(true);
    }
  });

  it('NEGATIVE — a fill missing its decision ref or tenant/project scope fails (L9/L12)', () => {
    const noDecision = fill() as unknown as Record<string, unknown>;
    delete noDecision.decisionId;
    expect(validateSimulatedFill(noDecision).ok).toBe(false);
    const noTenant = fill() as unknown as Record<string, unknown>;
    delete noTenant.tenant;
    const result = validateSimulatedFill(noTenant);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((error) => error.code === 'tenant_missing')).toBe(true);
  });

  it('NEGATIVE — a fill without an approving xd: decision ref fails (refused intents never fill)', () => {
    const result = validateSimulatedFill(fill({ decisionId: 'not-a-decision-id' }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.code === 'lineage_gap' && error.path.includes('decisionId'))).toBe(true);
    }
  });

  it('the paper_venue mode is equally expressible and equally honest', () => {
    const paperSpec = unwrap(validateExecutionSimulationSpec({ ...specInput(), fidelity: 'paper_venue' }));
    expect(paperSpec.fidelity).toBe('paper_venue');
    const paperFill = unwrap(validateSimulatedFill(fill({ fidelity: 'paper_venue' })));
    expect(paperFill.fidelity).toBe('paper_venue');
  });
});
