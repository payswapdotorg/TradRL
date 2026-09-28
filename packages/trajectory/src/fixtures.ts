/**
 * @tradrl/trajectory — shared test fixtures.
 *
 * Valid, guard-passing records used as the base case of every test; each
 * test then mutates one field to explore the negative paths. All timestamps
 * are trusted literals (requireTimestampMs), never wall-clock reads.
 */

import { requireTimestampMs } from './timestamp';
import type { TrajectoryMetadata } from './metadata';
import type { TrajectoryStep } from './step';
import { createTrajectory, type Trajectory } from './record';

/** A valid lineage block: every L9 ref present, lists non-empty and unique. */
export function validMetadata(): TrajectoryMetadata {
  return {
    episodeRef: 'episode-0192-ALPHA',
    environmentConfigRef: 'envcfg:sha256:9f2c',
    bodyVersionRefs: ['bodyv-researcher-3', 'bodyv-director-1'],
    substrateRefs: ['substrate-gpt-x', 'substrate-claude-y'],
    runtimeRef: 'runtime-env-runner-042',
    dataRefs: ['dataset-binance-trades-2024', 'dataset-seed-scenario-7'],
    tenantRef: 'tenant-acme',
    projectRef: 'project-alpha',
    fidelity: 'exact_replay',
  };
}

/** A valid step at simulated instant `now` (default 1_700_000_000_000). */
export function validStep(now = 1_700_000_000_000, sequence = 1): TrajectoryStep {
  return {
    id: `step-${sequence}`,
    observations: [
      { ref: `obs-trade-${sequence}`, availableTime: requireTimestampMs(now - 500) },
      { ref: `obs-vwap-${sequence}`, availableTime: requireTimestampMs(now - 100) },
    ],
    action: {
      actorId: 'agent-instance-director',
      payload: { kind: 'order.intention', instrument: 'BTC-USDT', side: 'buy', notional: '1000' },
    },
    environmentResultRef: `envres-${sequence}`,
    reward: { value: 0.25, dimension: 'pnl' },
    toolOutcomeRefs: [`toolout-chart-${sequence}`],
    clock: { now: requireTimestampMs(now), asOf: requireTimestampMs(now + 60_000) },
    causalityId: 'causality-decision-1',
  };
}

/** A valid trajectory with `count` steps at successive instants. */
export function validTrajectory(count = 3): Trajectory {
  const result = createTrajectory({
    id: 'traj-0192',
    metadata: validMetadata(),
    steps: Array.from({ length: count }, (_, i) => validStep(1_700_000_000_000 + i * 1_000, i + 1)),
  });
  if (!result.ok) throw new Error(`fixture must be valid: ${result.error.message}`);
  return result.value;
}
