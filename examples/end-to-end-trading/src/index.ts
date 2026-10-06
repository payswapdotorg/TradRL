// @tradrl/example-e2e-trading — the public surface.
//
// The REFERENCE END-TO-END TRADING SLICE (Work Order T048, R44): one
// deterministic, fully-wired demonstration of the whole trading
// pipeline — user goal + constraints + budget -> organization ->
// bodies + possessions -> Agent OS -> reactive market world -> research
// -> Trading Director -> strategy/portfolio -> risk + authorization
// through the 13-stage execution gateway (L8) -> paper/shadow execution
// in the simulated exchange -> outcomes with full L15 lineage.
//
// THE MIRROR LAW (D-003/D-004): this package imports NO sibling workspace
// package. Every cross-package shape is a structural mirror; the drift
// trip-wires live in tests/end-to-end-trading/interop.test.ts.
//
// Quick start:
//   import { runReferenceSlice, REFERENCE_SCENARIO } from '@tradrl/example-e2e-trading';
//   const result = runReferenceSlice();           // -> { ok: true, value: EndToEndRunResult }
//   result.value.digest                          // the run's deterministic digest
//   result.value.lineage.records                 // the L15 lineage stream
//   result.value.goalProgress                    // the goal attainment verdict

export * from './primitives';
export * from './decimals';
export * from './errors';
export * from './ids';
export * from './scenario';
export * from './lineage';
export * from './control-plane';
export * from './organization';
export * from './bodies';
export * from './kernel';
export * from './engine';
export * from './world';
export * from './research';
export * from './director';
export * from './strategy';
export * from './gateway';
export * from './execution-body';
export * from './outcomes';
export * from './run';
export * from './reference-scenario';

export { REFERENCE_SCENARIO, T0 } from './reference-scenario';
export { runEndToEndTradingScenario, type EndToEndRunResult, type RunOptions } from './run';

import { ok, type ExampleResult } from './errors';
import type { EndToEndRunResult } from './run';
import { runEndToEndTradingScenario } from './run';
import { REFERENCE_SCENARIO } from './reference-scenario';

/** Runs the reference slice over the built-in scenario. */
export function runReferenceSlice(): ExampleResult<EndToEndRunResult> {
  return runEndToEndTradingScenario(REFERENCE_SCENARIO);
}

/** Package identity and ownership (the governance surface). */
export const packageInfo = {
  name: '@tradrl/example-e2e-trading',
  owner: 'T048',
  status: 'implemented',
  concepts: [
    'TradingScenario',
    'runEndToEndTradingScenario',
    'LineageStream',
    'referenceEngine (EngineDriverMirror)',
    'ReactiveWorld',
    'composeDirectorDecision',
    'compileStrategyRun',
    'createExecutionGateway (13 stages)',
    'prepareOrder (lifecycle)',
    'ShadowOutcomeLog',
    'GoalProgressRecord',
  ],
} as const;

export { ok };
