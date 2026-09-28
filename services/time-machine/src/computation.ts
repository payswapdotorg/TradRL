/**
 * @tradrl/time-machine — computation policy mirror (Work Order T029).
 *
 * STRUCTURAL MIRROR of the `ComputationPolicy` of
 * `@tradrl/time-engine`/`knowledge` (T026; law D-004 — the vendored
 * `src/t026-reference/mirrors.ts` is the trip wire). Derived knowledge
 * declares how it was computed and at what latency. At the time-machine
 * layer the declared delay is ZERO by construction: availability
 * propagation is the T008 store's admission law, enforced upstream before
 * an event ever reaches the rolling window — the availability quartet is
 * authoritative and is never re-derived here.
 */

import { isDuration, type Duration } from './duration';

/** How derived knowledge was computed (mirror of time-engine ComputationPolicy). */
export interface ComputationPolicy {
  readonly transform_id: string;
  readonly delay: Duration;
}

/** Runtime type guard for a computation policy (mirror). */
export function isComputationPolicy(value: unknown): value is ComputationPolicy {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.transform_id === 'string' &&
    candidate.transform_id.length > 0 &&
    isDuration(candidate.delay)
  );
}
