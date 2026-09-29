/**
 * @tradrl/risk-engine (service) — the reference engine's test suite
 * (Work Order T020).
 *
 * THE COVERAGE (the Work Order's acceptance surface, service half):
 *   - the golden scenario: the constraint-set compile, the exact
 *     exposure numbers (hand-computed literals — never the engine
 *     re-deriving its own output), every state, the threaded drawdown,
 *     the L11 supersession and the re-measurement under the new head;
 *   - one breach fixture per limit kind (the seven kinds), each pinned
 *     to its exact evidence triple, the class kinds bridged into the
 *     T019 refusal mirror (satisfying the REAL `isRefusalReason`
 *     guard);
 *   - the kill-switch interop: a hand-derived THROWN mirror log blocks
 *     everything, and a log produced by the REAL execution-policy API
 *     behaves identically (the interop law — the service consumes
 *     T019's records through the mirror only);
 *   - policy evolution (L11): superseded versions retained, structured
 *     reasons, the rewrite trip wires;
 *   - the resumable run state: serialize -> parse -> resume continues
 *     byte-identically with the uninterrupted run; tampered payloads
 *     fail typed;
 *   - the engine's own laws: idempotency, monotonic time, L12 scope,
 *     the exact-decimal trip wire, and the L7 opacity of every emitted
 *     record (the session tree carries measures only — no acceptance
 *     vocabulary anywhere).
 */

import { describe, expect, it } from 'vitest';

import {
  BTC,
  ETH,
  GOLDEN_DRAWDOWN_BREACH,
  PROJECT,
  REFERENCE_SUPERSESSION_REASON,
  SEED,
  T0,
  TENANT,
  btcEthMarket,
  btcOnlyMarket,
  compileReferencePolicyV1,
  compileReferencePolicyV2,
  createReferenceRun,
  driveReferenceScenario,
  goldenPortfolio,
  postStepOnePortfolio,
  processRiskStep,
  referenceScenarioSteps,
  resumeRiskRunState,
  serializeRiskRunState,
  singleStepBreachFixtures,
  supersedeRunPolicy,
  thrownSwitchLog,
  unwrap,
  goldenFill,
  referenceConstraintSetV2,
  type RiskStepOutcome,
  type RiskRunSession,
} from './index';
import {
  acceptanceViolations,
  canonicalPolicyJson,
  executionLimitRefusals,
  retainedPolicyVersions,
  validateRiskMeasureRecord,
  verifyRiskPolicyTrail,
} from '../../../packages/risk/src/index';
import { isRefusalReason, startKillSwitch, throwKillSwitch } from '../../../packages/execution-policy/src/index';

/** Unwrap or throw (the test fixtures are valid by construction). */
function must<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly message: string; readonly path: string }[] }): T {
  if (result.ok) return result.value;
  throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
}

/** Extract the typed error code of a failure (the negative probes' helper). */
function must_fail(result: { ok: boolean; errors?: readonly { code: string }[] }): string {
  if (result.ok) throw new Error('the probe must fail');
  return result.errors?.[0]?.code ?? 'no-code';
}

/** The mid-run reference state: steps 1-2 processed, the supersession applied (the resume tests' base). */
function midRunReference(): RiskRunSession {
  const steps = referenceScenarioSteps();
  const created = must(createReferenceRun());
  const first = must(processRiskStep(created, steps[0]));
  const second = must(processRiskStep(first.session, steps[1]));
  return must(
    supersedeRunPolicy(second.session, {
      constraintSet: referenceConstraintSetV2(),
      reason: REFERENCE_SUPERSESSION_REASON,
      asOf: (T0 + 119_000) as never,
      ratioPrecision: 6,
    }),
  );
}

// ---------------------------------------------------------------------------
// The golden scenario
// ---------------------------------------------------------------------------

describe('the reference scenario — the compile', () => {
  it('compiles the genesis policy FROM the constraint-set mirror (constraint -> limit records)', () => {
    const policy = compileReferencePolicyV1();
    expect(policy.version).toBe(1);
    expect(policy.supersedes).toBeNull();
    expect(policy.tenant).toBe(TENANT);
    expect(policy.project).toBe(PROJECT);
    expect(policy.classLimits).toEqual([
      { instrumentClass: '*', maxOrderSize: '1', maxOrderNotional: '60000', maxPositionSize: '2', maxPositionNotional: '110000' },
      { instrumentClass: 'crypto', maxOrderSize: '2', maxOrderNotional: '120000', maxPositionSize: '3', maxPositionNotional: '150000' },
    ]);
    expect(policy.concentration).toEqual({ maxConcentrationRatio: '0.9', ratioPrecision: 6 });
    expect(policy.drawdown).toEqual({ maxDrawdown: '10000' });
    expect(policy.leverage).toEqual({ maxLeverageRatio: '1.5', ratioPrecision: 6 });
    expect(policy.compiledFrom).toHaveLength(11);
  });

  it('the compile is PURE: the same set compiles to the byte-identical policy', () => {
    const first = compileReferencePolicyV1();
    const second = compileReferencePolicyV1();
    expect(first).toEqual(second);
    expect(canonicalPolicyJson(first)).toBe(canonicalPolicyJson(second));
    expect(first.policyId).toBe(second.policyId);
  });
});

describe('the reference scenario — the measurement pipeline', () => {
  it('step 1 measures the golden exposure EXACTLY and every limit is within', () => {
    const steps = referenceScenarioSteps();
    const outcome = must(processRiskStep(must(createReferenceRun()), steps[0]));
    const exposure = outcome.exposure;
    // The hand-computed golden numbers (fixtures.ts's header).
    expect(exposure.cash).toBe('89978');
    expect(exposure.positions).toEqual([
      { venue: 'REFSIM', instrument: BTC, assetClass: 'crypto', referencePrice: '50000', quantity: '1', notional: '50000' },
      { venue: 'REFSIM', instrument: ETH, assetClass: 'crypto', referencePrice: '3000', quantity: '2', notional: '6000' },
    ]);
    expect(exposure.orders).toEqual([
      { venue: 'REFSIM', instrument: BTC, assetClass: 'crypto', referencePrice: '50000', quantity: '0.2', notional: '10000', fillRef: 'xsf-r-00000001' },
    ]);
    expect(exposure.grossNotional).toBe('56000');
    expect(exposure.netNotional).toBe('56000');
    expect(exposure.equity).toBe('145978');
    expect(exposure.peakEquity).toBe('145978');
    expect(exposure.drawdown).toBe('0');
    expect(exposure.lineage).toMatchObject({ seed: SEED, tenant: TENANT, project: PROJECT });
    // Every declared limit is within; the genesis carries the full 10 states.
    expect(outcome.evaluation.killSwitchState).toBe('standing');
    expect(outcome.evaluation.states).toHaveLength(10);
    expect(outcome.evaluation.states.every((state) => state.state === 'within')).toBe(true);
    // The audit trail, the drawdown series and the measures.
    expect(outcome.session.auditTrail.records).toHaveLength(1);
    expect(outcome.session.drawdownSeries).toEqual([{ asOf: T0, equity: '145978', peakEquity: '145978', drawdown: '0' }]);
    expect(outcome.measures).toHaveLength(2);
    expect(outcome.measures[0]?.kind).toBe('exposure');
    expect(outcome.measures[1]?.kind).toBe('risk_adjusted');
  });

  it('step 2 threads the high-water mark and BREACHES the drawdown limit exactly', () => {
    const steps = referenceScenarioSteps();
    const first = must(processRiskStep(must(createReferenceRun()), steps[0]));
    const second = must(processRiskStep(first.session, steps[1]));
    const exposure = second.exposure;
    expect(exposure.cash).toBe('89978');
    expect(exposure.grossNotional).toBe('44800');
    expect(exposure.equity).toBe('134778');
    expect(exposure.peakEquity).toBe('145978'); // the threaded high-water mark
    expect(exposure.drawdown).toBe('11200');
    // The ONE breaching state, with the exact evidence triple.
    const breaching = second.evaluation.states.filter((state) => state.state === 'breaching');
    expect(breaching).toHaveLength(1);
    const state = breaching[0];
    expect(state?.kind).toBe(GOLDEN_DRAWDOWN_BREACH.kind);
    expect(state?.scope).toEqual({ kind: 'portfolio' });
    expect(state?.reason).toEqual({ cause: 'breach', bound: GOLDEN_DRAWDOWN_BREACH.bound, observed: GOLDEN_DRAWDOWN_BREACH.observed, excess: GOLDEN_DRAWDOWN_BREACH.excess });
    // The audit record carries the breach as structured data.
    expect(second.auditRecord.breachingCount).toBe(1);
    expect(second.auditRecord.breaches).toEqual([{ kind: 'drawdown', venue: null, instrument: null, instrumentClass: null, bound: '10000', observed: '11200', excess: '1200' }]);
  });

  it('the supersession (L11) compiles v2, RETAINS v1, and the same facts measure WITHIN under the new head', () => {
    const run = must(driveReferenceScenario());
    // The trail retains both versions with the structured reason.
    const retained = retainedPolicyVersions(run.policyTrail);
    expect(retained).toHaveLength(2);
    expect(retained[0]?.version).toBe(1);
    expect(retained[1]?.version).toBe(2);
    expect(run.policyTrail.entries[1]?.reason).toBe(REFERENCE_SUPERSESSION_REASON);
    expect(verifyRiskPolicyTrail(run.policyTrail).ok).toBe(true);
    // The evaluations attribute to the version that produced them: v1, v1, v2.
    expect(run.evaluations.map((evaluation) => evaluation.lineage.policy.version)).toEqual([1, 1, 2]);
    // Step 3 (the same facts as step 2) measures all within under v2.
    const last = run.evaluations[2];
    expect(last?.states).toHaveLength(8);
    expect(last?.states.every((state) => state.state === 'within')).toBe(true);
    expect(run.drawdownSeries.map((point) => point.drawdown)).toEqual(['0', '11200', '11200']);
    expect(run.auditTrail.records).toHaveLength(3);
    expect(run.measures).toHaveLength(6);
  });

  it('the class-kind breach maps to the T019 refusal mirror (the gate consumes these states)', () => {
    // The order_size fixture: 2.5 BTC over the crypto cap 2.
    const fixture = singleStepBreachFixtures().find((candidate) => candidate.kind === 'order_size');
    if (fixture === undefined) throw new Error('the order_size fixture is missing');
    const outcome = must(
      processRiskStep(must(createReferenceRun()), {
        stepId: 'refusal-bridge',
        portfolio: fixture.portfolio,
        marketEvents: fixture.marketEvents,
        fills: fixture.fills,
        asOf: fixture.asOf as never,
        quotePrecision: 8,
      }),
    );
    const refusals = executionLimitRefusals(outcome.evaluation);
    const orderSize = refusals.find((refusal) => refusal.limit === 'order_size');
    expect(orderSize).toEqual({ dimension: 'limits', limit: 'order_size', instrumentClass: 'crypto', cap: '2', observed: '2.5', excess: '0.5' });
    // Every refusal satisfies the REAL execution-policy guard — the gate's own shape.
    for (const refusal of refusals) {
      expect(isRefusalReason(refusal)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The per-kind breach fixtures (the totality surface — every kind has one)
// ---------------------------------------------------------------------------

describe('the per-kind breach fixtures', () => {
  for (const fixture of singleStepBreachFixtures()) {
    it(`${fixture.name} — the ${fixture.kind} state breaches with the exact evidence`, () => {
      const outcome = must(
        processRiskStep(must(createReferenceRun()), {
          stepId: `breach-${fixture.kind}`,
          portfolio: fixture.portfolio,
          marketEvents: fixture.marketEvents,
          fills: fixture.fills,
          asOf: fixture.asOf as never,
          quotePrecision: 8,
        }),
      );
      const target = outcome.evaluation.states.find(
        (state) => state.kind === fixture.kind && (fixture.scopeInstrument === null || (state.scope.kind === 'instrument' && state.scope.instrument === fixture.scopeInstrument)),
      );
      expect(target).toBeDefined();
      expect(target?.state).toBe('breaching');
      expect(target?.reason).toEqual({ cause: 'breach', bound: fixture.bound, observed: fixture.observed, excess: fixture.excess });
      // The class kinds surface through the T019 refusal bridge as well.
      if (fixture.kind === 'order_size' || fixture.kind === 'order_notional' || fixture.kind === 'position_size' || fixture.kind === 'position_notional') {
        const refusal = executionLimitRefusals(outcome.evaluation).find((candidate) => candidate.limit === fixture.kind);
        expect(refusal).toMatchObject({ dimension: 'limits', limit: fixture.kind, instrumentClass: 'crypto', cap: fixture.bound, observed: fixture.observed, excess: fixture.excess });
      }
    });
  }

  it('the concentration and leverage fixtures isolate their kind (the only breaching state)', () => {
    for (const kind of ['concentration', 'leverage'] as const) {
      const fixture = singleStepBreachFixtures().find((candidate) => candidate.kind === kind);
      if (fixture === undefined) throw new Error(`the ${kind} fixture is missing`);
      const outcome = must(
        processRiskStep(must(createReferenceRun()), {
          stepId: `isolated-${kind}`,
          portfolio: fixture.portfolio,
          marketEvents: fixture.marketEvents,
          fills: fixture.fills,
          asOf: fixture.asOf as never,
          quotePrecision: 8,
        }),
      );
      expect(outcome.evaluation.states.filter((state) => state.state === 'breaching')).toHaveLength(1);
    }
  });

  it('the drawdown breach (the threaded high-water mark) is the golden step 2', () => {
    const steps = referenceScenarioSteps();
    const first = must(processRiskStep(must(createReferenceRun()), steps[0]));
    const second = must(processRiskStep(first.session, steps[1]));
    const drawdown = second.evaluation.states.find((state) => state.kind === 'drawdown');
    expect(drawdown?.state).toBe('breaching');
    expect(drawdown?.reason).toEqual({ cause: 'breach', bound: '10000', observed: '11200', excess: '1200' });
  });
});

// ---------------------------------------------------------------------------
// The kill-switch interop (the Work Order's interop law)
// ---------------------------------------------------------------------------

describe('the kill-switch interop', () => {
  /** One step of the golden shape, honoring `switchLog`. */
  const stepUnder = (switchLog: unknown): RiskStepOutcome =>
    must(
      processRiskStep(must(createReferenceRun()), {
        stepId: 'switch-probe',
        portfolio: goldenPortfolio(),
        marketEvents: btcEthMarket('50000.00', '3000.00', T0 - 500),
        fills: [goldenFill()],
        asOf: T0 as never,
        quotePrecision: 8,
        killSwitch: switchLog,
      }),
    );

  it('a THROWN mirror log blocks EVERY limit state with the structured evidence', () => {
    const thrown = thrownSwitchLog('risk desk circuit breaker', T0 - 100);
    const outcome = stepUnder(thrown);
    expect(outcome.evaluation.killSwitchState).toBe('thrown');
    expect(outcome.evaluation.states).toHaveLength(10);
    expect(outcome.evaluation.states.every((state) => state.state === 'blocked')).toBe(true);
    for (const state of outcome.evaluation.states) {
      expect(state.reason).toEqual({ cause: 'kill_switch', switchId: thrown.switchId, thrownAt: T0 - 100 });
    }
    // The audit record carries the blocked counts — structured, never silent.
    expect(outcome.auditRecord.blockedCount).toBe(10);
    expect(outcome.auditRecord.withinCount).toBe(0);
  });

  it('a REAL T019 thrown log (the execution-policy API) blocks identically — the interop law', () => {
    const standing = must(startKillSwitch(TENANT as never, PROJECT as never, (T0 - 2_000) as never));
    const realThrown = must(throwKillSwitch(standing, 'interop circuit breaker', (T0 - 100) as never));
    const outcome = stepUnder(realThrown);
    expect(outcome.evaluation.killSwitchState).toBe('thrown');
    expect(outcome.evaluation.states.every((state) => state.state === 'blocked')).toBe(true);
    for (const state of outcome.evaluation.states) {
      expect(state.reason).toEqual({ cause: 'kill_switch', switchId: realThrown.switchId, thrownAt: T0 - 100 });
    }
  });

  it('a REAL standing log does NOT block (the armed genesis)', () => {
    const standing = must(startKillSwitch(TENANT as never, PROJECT as never, (T0 - 2_000) as never));
    const outcome = stepUnder(standing);
    expect(outcome.evaluation.states.every((state) => state.state === 'within')).toBe(true);
  });

  it('a mid-run switch change threads the honored log forward', () => {
    const steps = referenceScenarioSteps();
    const first = must(processRiskStep(must(createReferenceRun()), steps[0]));
    const thrown = thrownSwitchLog();
    const switched = must(processRiskStep(first.session, { ...steps[1], stepId: 'step-switched', killSwitch: thrown }));
    expect(switched.evaluation.killSwitchState).toBe('thrown');
    expect(switched.session.killSwitch).toBe(thrown); // the session's honored log threads forward
    expect(switched.evaluation.states.every((state) => state.state === 'blocked')).toBe(true);
    // ...and the standing prefix of the run stays standing in the audit history.
    expect(first.evaluation.killSwitchState).toBe('standing');
  });

  it('a switch log from ANOTHER scope is the typed tenant_missing crime (L12)', () => {
    const created = must(createReferenceRun());
    const foreign = must(startKillSwitch('tenant-beta' as never, PROJECT as never, (T0 - 2_000) as never));
    const outcome = processRiskStep(created, {
      stepId: 'foreign-switch',
      portfolio: goldenPortfolio(),
      marketEvents: btcEthMarket('50000.00', '3000.00', T0 - 500),
      fills: [],
      asOf: T0 as never,
      quotePrecision: 8,
      killSwitch: foreign,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.errors[0]?.code).toBe('tenant_missing');
  });
});

// ---------------------------------------------------------------------------
// Policy evolution (L11)
// ---------------------------------------------------------------------------

describe('policy evolution (L11 — the append-only trail)', () => {
  it('the supersession path compiles v2 from the constraint-set mirror naming the head', () => {
    const genesis = compileReferencePolicyV1();
    const v2 = compileReferencePolicyV2({ policyId: genesis.policyId, version: genesis.version });
    expect(v2.version).toBe(2);
    expect(v2.supersedes).toEqual({ policyId: genesis.policyId, version: 1 });
    expect(v2.drawdown).toEqual({ maxDrawdown: '15000' });
    expect(v2.constraintSet).toEqual({ id: 'cs-risk-reference', version: 2 });
    // The v2 compile is pure too.
    expect(canonicalPolicyJson(v2)).toBe(canonicalPolicyJson(compileReferencePolicyV2({ policyId: genesis.policyId, version: genesis.version })));
  });

  it('a SPLICED policy trail fails at resume (a skip is a rewrite — the L11 trip wire)', () => {
    const bytes = must(serializeRiskRunState(midRunReference()));
    const parsed = JSON.parse(bytes) as { session: { policyTrail: { entries: unknown[] } } };
    parsed.session.policyTrail.entries.shift(); // remove the genesis — versions no longer chain from 1
    const result = resumeRiskRunState(JSON.stringify(parsed));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('policy_history_rewrite');
  });

  it('a supersession without a structured reason fails (unauditable history)', () => {
    const run = must(createReferenceRun());
    const result = supersedeRunPolicy(run, {
      constraintSet: referenceConstraintSetV2(),
      reason: '',
      asOf: (T0 + 10_000) as never,
      ratioPrecision: 6,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('invalid_field');
  });

  it('an EDITED trail fails chain verification (the rewrite trip wire)', () => {
    const run = must(driveReferenceScenario());
    const edited = {
      ...run.policyTrail,
      entries: [
        run.policyTrail.entries[0] as never,
        { ...(run.policyTrail.entries[1] as unknown as Record<string, unknown>), reason: 'rewritten history' } as never,
      ],
    };
    const result = verifyRiskPolicyTrail(edited);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('policy_history_rewrite');
  });

  it('a supersession instant before the session clock fails (monotonic time)', () => {
    const run = must(createReferenceRun()); // clock T0-50000
    const result = supersedeRunPolicy(run, {
      constraintSet: referenceConstraintSetV2(),
      reason: 'backdated supersession',
      asOf: (T0 - 60_000) as never,
      ratioPrecision: 6,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('invalid_state');
  });
});

// ---------------------------------------------------------------------------
// The resumable run state (serialize -> parse -> resume)
// ---------------------------------------------------------------------------

describe('the resumable run state', () => {
  /** The mid-run state: steps 1-2 processed, the supersession applied. */
  const midRun = midRunReference;

  it('serialize -> parse -> resume continues IDENTICALLY with the uninterrupted run (byte-equal)', () => {
    const uninterrupted = must(driveReferenceScenario());
    const bytes = must(serializeRiskRunState(midRun()));
    const resumed = must(resumeRiskRunState(bytes));
    const steps = referenceScenarioSteps();
    const continued = must(processRiskStep(resumed, steps[2]));
    expect(continued.session).toEqual(uninterrupted);
    expect(must(serializeRiskRunState(continued.session))).toBe(must(serializeRiskRunState(uninterrupted)));
  });

  it('serialization is byte-deterministic (the same session, twice)', () => {
    const session = midRun();
    expect(must(serializeRiskRunState(session))).toBe(must(serializeRiskRunState(session)));
  });

  it('a resumed session re-verifies: the switch chain, the policy trail, the audit chain, the outcome chain', () => {
    const bytes = must(serializeRiskRunState(midRun()));
    const resumed = must(resumeRiskRunState(bytes));
    expect(resumed.processedStepIds).toEqual(['step-genesis', 'step-drawdown-breach']);
    expect(verifyRiskPolicyTrail(resumed.policyTrail).ok).toBe(true);
  });

  it('an EDITED evaluation fails the outcome chain (the tamper anchor)', () => {
    const bytes = must(serializeRiskRunState(midRun()));
    const parsed = JSON.parse(bytes) as { session: { evaluations: { killSwitchState: string }[] } };
    parsed.session.evaluations[0]!.killSwitchState = 'thrown';
    const result = resumeRiskRunState(JSON.stringify(parsed));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('invalid_state');
  });

  it('a TRUNCATED audit trail fails coherence (one evaluation, one record)', () => {
    const bytes = must(serializeRiskRunState(midRun()));
    const parsed = JSON.parse(bytes) as { session: { auditTrail: { records: unknown[] } } };
    parsed.session.auditTrail.records.pop();
    const result = resumeRiskRunState(JSON.stringify(parsed));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('risk_audit_rewrite');
  });

  it('an EDITED audit record fails the audit chain', () => {
    const bytes = must(serializeRiskRunState(midRun()));
    const parsed = JSON.parse(bytes) as { session: { auditTrail: { records: { withinCount: number }[] } } };
    parsed.session.auditTrail.records[0]!.withinCount = 42;
    const result = resumeRiskRunState(JSON.stringify(parsed));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]?.code).toBe('risk_audit_rewrite');
  });

  it('a wrong schema marker and invalid JSON fail typed', () => {
    const wrongSchema = JSON.stringify({ schema: 'tradrl/other@9', session: midRun() });
    expect(must_fail(resumeRiskRunState(wrongSchema))).toBe('invalid_state');
    expect(must_fail(resumeRiskRunState('not json'))).toBe('invalid_json');
  });

  it('a tampered STEP (a removed processed id) fails the outcome chain', () => {
    const bytes = must(serializeRiskRunState(midRun()));
    const parsed = JSON.parse(bytes) as { session: { processedStepIds: string[] } };
    parsed.session.processedStepIds.pop();
    const result = resumeRiskRunState(JSON.stringify(parsed));
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The engine's own laws
// ---------------------------------------------------------------------------

describe("the engine's own laws", () => {
  it('a DUPLICATE step id is invalid_state (one step, one evaluation)', () => {
    const steps = referenceScenarioSteps();
    const created = must(createReferenceRun());
    const first = must(processRiskStep(created, steps[0]));
    const replay = processRiskStep(first.session, { ...steps[0], marketEvents: [] });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.errors[0]?.code).toBe('invalid_state');
  });

  it('a step BEFORE the session clock fails (monotonic time)', () => {
    const created = must(createReferenceRun()); // clock T0-50000
    const backdated = processRiskStep(created, {
      stepId: 'backdated',
      portfolio: goldenPortfolio(),
      marketEvents: btcEthMarket('50000.00', '3000.00', T0 - 100_500),
      fills: [],
      asOf: (T0 - 50_001) as never,
      quotePrecision: 8,
    });
    expect(backdated.ok).toBe(false);
    if (!backdated.ok) expect(backdated.errors[0]?.code).toBe('invalid_state');
  });

  it('a step at the drawdown series\' LAST instant fails (strictly increasing)', () => {
    const steps = referenceScenarioSteps();
    const created = must(createReferenceRun());
    const first = must(processRiskStep(created, steps[0])); // asOf T0
    const sameInstant = processRiskStep(first.session, {
      stepId: 'same-instant',
      portfolio: postStepOnePortfolio('ps:t020-same', T0),
      marketEvents: btcEthMarket('40000.00', '2400.00', T0 - 500),
      fills: [],
      asOf: T0 as never,
      quotePrecision: 8,
    });
    expect(sameInstant.ok).toBe(false);
    if (!sameInstant.ok) expect(sameInstant.errors[0]?.code).toBe('invalid_state');
  });

  it('a JS NUMBER in a money path surfaces the typed decimal_imprecision (never coerced)', () => {
    const created = must(createReferenceRun());
    const float = processRiskStep(created, {
      stepId: 'float-crime',
      portfolio: { ...goldenPortfolio(), cash: 100000 },
      marketEvents: btcEthMarket('50000.00', '3000.00', T0 - 500),
      fills: [],
      asOf: T0 as never,
      quotePrecision: 8,
    });
    expect(float.ok).toBe(false);
    if (!float.ok) expect(float.errors[0]?.code).toBe('decimal_imprecision');
  });

  it('L7: the whole session tree carries MEASURES only — no acceptance vocabulary anywhere', () => {
    const run = must(driveReferenceScenario());
    expect(acceptanceViolations(run)).toEqual([]);
    // And every emitted measure passes the contract's own validation
    // (the collect-all L7 trip wires included).
    for (const measure of run.measures) {
      const validated = validateRiskMeasureRecord(measure);
      expect(validated.ok).toBe(true);
      if (measure.kind === 'risk_adjusted') {
        expect('value' in measure).toBe(false);
        expect('figureValue' in measure).toBe(false);
        expect('result' in measure).toBe(false);
        expect(measure.figureRef.startsWith('rfig:')).toBe(true);
        expect(measure.method).toBe('reference/gross-over-equity');
        expect(measure.methodVersion).toBe(1);
        expect(measure.declaredLimitation.length).toBeGreaterThan(0);
      }
    }
  });

  it('the run consumes only declared inputs: an uncovered instrument is the typed market_state_gap', () => {
    const created = must(createReferenceRun());
    const gap = processRiskStep(created, {
      stepId: 'gap-crime',
      portfolio: goldenPortfolio(),
      marketEvents: btcOnlyMarket('50000.00', T0 - 500), // ETH never observed
      fills: [],
      asOf: T0 as never,
      quotePrecision: 8,
    });
    expect(gap.ok).toBe(false);
    if (!gap.ok) expect(gap.errors[0]?.code).toBe('market_state_gap');
  });
});
