/**
 * @tradrl/environment-runner — the deterministic reference EpisodeRunner.
 *
 * Public API:
 *   - `runEpisode(environment, spec, policy, options)` — drives ANY
 *     `Environment` through a complete episode under a pluggable PURE
 *     `Policy` and records the full JSON-serializable step trace.
 *   - `EpisodeTrace` / `StepRecord` / `Rejection` — the trace records
 *     (guards included; T011 trajectories and T013 RL consume them).
 *   - `createStubEnvironment()` — the tiny in-memory reference World used
 *     by the runner tests and the composition template for T009/T010
 *     implementers (EpisodeStore + seeded world dynamics).
 *   - `seededDraw` / `createSeededRandom` — deterministic seeded values.
 *
 * Zero runtime dependencies. The service consumes its own lane's contract
 * package, `@tradrl/environment-protocol`, via a relative source import —
 * the frozen workspace lockfile admits no new package dependency edges on
 * this branch (the same discipline the cross-package interop tests use);
 * linking the workspace packages is a merge-time concern for the Tech Lead.
 */

// Policy contract
export type { PolicyInput, PolicyProposal, Policy } from './policy';
export { isPolicyInput, isPolicyProposal, isPolicy } from './policy';

// Trace records
export type { Rejection, StepRecord, EpisodeTrace } from './trace';
export { isRejection, isStepRecord, isEpisodeTrace, makeStepRecord, makeEpisodeTrace, serializeTrace } from './trace';

// The runner
export type { RunOptions } from './runner';
export { isRunOptions, runEpisode } from './runner';

// The reference stub world
export { createStubEnvironment, STUB_RESULT_LATENCY_MS } from './stub';

// Deterministic seeded values
export type { SeededRandom } from './seeded';
export { createSeededRandom, seededDraw } from './seeded';

/** Package identity and ownership (Work Order T005). */
export const packageInfo = {
  name: '@tradrl/environment-runner',
  owner: 'T005',
  status: 'implemented',
} as const;
