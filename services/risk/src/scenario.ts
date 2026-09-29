/**
 * @tradrl/risk-engine (service) — the reference scenario (Work Order
 * T020): the golden three-step run the whole service suite reasons
 * over, plus the policy-compile helpers the engine tests and the
 * golden fixtures share.
 *
 * THE RUN (every number hand-computed exactly — see fixtures.ts's
 * header for the arithmetic):
 *   create  — policy v1 (compiled from the reference constraint set)
 *             + the standing switch log; clock T0-50000.
 *   step 1  'step-genesis' @ T0 — the golden portfolio/market/fill:
 *             equity 145978, peak 145978, drawdown 0 — every limit
 *             WITHIN (10 states).
 *   step 2  'step-drawdown-breach' @ T0+60000 — the post-step-1 book
 *             at BTC 40000 / ETH 2400: equity 134778, peak threads to
 *             145978, drawdown 11200 — the drawdown limit BREACHES by
 *             1200 (the only breaching kind; 8 states).
 *   supersede — policy v2 (drawdown 15000) at T0+119000 (L11: v1
 *             RETAINED in the trail).
 *   step 3  'step-under-v2' @ T0+120000 — the same facts as step 2
 *             under the current head: drawdown 11200 <= 15000 — every
 *             limit WITHIN again (8 states).
 *
 * Zero runtime dependencies; no ambient clock; every instant an
 * explicit literal.
 */

import { compileRiskPolicy, ok, type RiskPolicy, type RiskResult } from '../../../packages/risk/src/index';
import { createRiskRun, processRiskStep, supersedeRunPolicy, type RiskRunSession, type RiskStep } from './engine';
import {
  GOAL,
  PROJECT,
  SEED,
  T0,
  TENANT,
  btcEthMarket,
  goldenFill,
  goldenPortfolio,
  postStepOnePortfolio,
  referenceConstraintSetV1,
  referenceConstraintSetV2,
  standingSwitchLog,
  unwrap,
} from './fixtures';

/** The reference compile parameters (shared by v1 and v2). */
export const REFERENCE_RATIO_PRECISION = 6;
export const REFERENCE_QUOTE_PRECISION = 8;

/** Compile the reference genesis policy (version 1) from the v1 constraint set. */
export function compileReferencePolicyV1(): RiskPolicy {
  return unwrap(
    compileRiskPolicy({
      constraintSet: referenceConstraintSetV1(),
      goal: GOAL,
      tenant: TENANT as never,
      project: PROJECT as never,
      asOf: (T0 - 50_000) as never,
      ratioPrecision: REFERENCE_RATIO_PRECISION,
    }),
  );
}

/** Compile the reference supersession (version 2, drawdown loosened to 15000) naming `supersedes`. */
export function compileReferencePolicyV2(supersedes: { readonly policyId: string; readonly version: number }): RiskPolicy {
  return unwrap(
    compileRiskPolicy({
      constraintSet: referenceConstraintSetV2(),
      goal: GOAL,
      tenant: TENANT as never,
      project: PROJECT as never,
      asOf: (T0 + 119_000) as never,
      ratioPrecision: REFERENCE_RATIO_PRECISION,
      supersedes: supersedes as never,
    }),
  );
}

/** The reason the reference supersession carries (L11 — structured, non-empty). */
export const REFERENCE_SUPERSESSION_REASON = 'drawdown cap loosened from 10000 to 15000 after the step-2 breach review';

/** Create the reference run session: policy v1 + the standing switch, clock at the policy declaration. */
export function createReferenceRun(): RiskResult<RiskRunSession> {
  return createRiskRun({
    tenant: TENANT as never,
    project: PROJECT as never,
    seed: SEED as never,
    genesisPolicy: compileReferencePolicyV1(),
    killSwitch: standingSwitchLog(),
    startAt: (T0 - 50_000) as never,
  });
}

/** The golden scenario's three steps (the driver folds the supersession between steps 2 and 3). */
export function referenceScenarioSteps(): readonly RiskStep[] {
  return [
    {
      stepId: 'step-genesis',
      portfolio: goldenPortfolio(),
      marketEvents: btcEthMarket('50000.00', '3000.00', T0 - 500),
      fills: [goldenFill()],
      asOf: T0 as never,
      quotePrecision: REFERENCE_QUOTE_PRECISION,
    },
    {
      stepId: 'step-drawdown-breach',
      portfolio: postStepOnePortfolio('ps:t020-s2', T0 + 59_000),
      marketEvents: btcEthMarket('40000.00', '2400.00', T0 + 59_500),
      fills: [],
      asOf: (T0 + 60_000) as never,
      quotePrecision: REFERENCE_QUOTE_PRECISION,
    },
    {
      stepId: 'step-under-v2',
      portfolio: postStepOnePortfolio('ps:t020-s3', T0 + 119_000, 2),
      marketEvents: btcEthMarket('40000.00', '2400.00', T0 + 119_500),
      fills: [],
      asOf: (T0 + 120_000) as never,
      quotePrecision: REFERENCE_QUOTE_PRECISION,
    },
  ];
}

/**
 * Drive the whole reference scenario: the three steps with the L11
 * supersession folded between steps 2 and 3. Deterministic — the same
 * call always produces the byte-identical session (the golden test's
 * subject).
 */
export function driveReferenceScenario(): RiskResult<RiskRunSession> {
  const created = createReferenceRun();
  if (!created.ok) return created;
  const steps = referenceScenarioSteps();
  const step1 = processRiskStep(created.value, steps[0]);
  if (!step1.ok) return step1;
  const step2 = processRiskStep(step1.value.session, steps[1]);
  if (!step2.ok) return step2;
  const superseded = supersedeRunPolicy(step2.value.session, {
    constraintSet: referenceConstraintSetV2(),
    reason: REFERENCE_SUPERSESSION_REASON,
    asOf: (T0 + 119_000) as never,
    ratioPrecision: REFERENCE_RATIO_PRECISION,
  });
  if (!superseded.ok) return superseded;
  const step3 = processRiskStep(superseded.value, steps[2]);
  if (!step3.ok) return step3;
  return ok(step3.value.session);
}
