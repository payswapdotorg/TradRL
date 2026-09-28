// @tradrl/agent-runtime — public API.
//
// Owning Work Order: T006 (frozen write surface: services/agent-runtime).
//
// The reference runtime around the @tradrl/agent-os kernel reducer:
// a deterministic operation-source driver, the materialized OperationLog /
// Mailboxes / instance registry, and the L9 replay-determinism proof.
// See README.md for how T016 (organization compiler) and T011 (trajectory
// protocol) consume this surface.

export * from './runtime';

import { packageInfo as kernelInfo } from '../../../packages/agent-os/src/index';

/** Package identity and ownership (governance surface). */
export const packageInfo = {
  name: '@tradrl/agent-runtime',
  owner: 'T006',
  status: 'implemented',
  kernel: kernelInfo,
  concepts: ['AgentRuntime', 'OperationSource', 'ScriptedSource', 'DeterminismReport'],
} as const;
