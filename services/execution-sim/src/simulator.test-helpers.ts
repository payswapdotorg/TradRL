/**
 * @tradrl/execution_sim (service) — the shared test helpers (internal
 * test support; NOT exported from the service index).
 */

import type { ExecutionPolicy } from '../../../packages/execution-policy/src/index';
import type { ExecutionSimSession } from './simulator';
import {
  createExecutionSimSession,
  referenceBtcBook,
  referenceEthBook,
  referenceExecutionPolicy,
  referenceGenesisPortfolio,
  referenceKillSwitch,
  referenceSimulationSpec,
  referenceVenueState,
} from './index';

/** Build the reference session (the simulator over the reference declarations). */
export function referenceSession(
  options: { readonly policy?: ExecutionPolicy; readonly venueState?: ReturnType<typeof referenceVenueState> } = {},
): ExecutionSimSession {
  const spec = referenceSimulationSpec();
  const policy = options.policy ?? referenceExecutionPolicy();
  const result = createExecutionSimSession(
    spec,
    policy,
    referenceKillSwitch(),
    referenceGenesisPortfolio(),
    options.venueState ?? referenceVenueState(),
    [
      { key: 'REFSIM|BTC-USD', bids: referenceBtcBook().bids, asks: referenceBtcBook().asks },
      { key: 'REFSIM|ETH-USD', bids: referenceEthBook().bids, asks: referenceEthBook().asks },
    ],
  );
  if (!result.ok) throw new Error(`the reference session must initialize: ${JSON.stringify(result.errors)}`);
  return result.value;
}
