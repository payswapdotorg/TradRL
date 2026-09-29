/**
 * @tradrl/adapter-equities — the declared health thresholds.
 *
 * The SDK's health contract (mirrored in ./contract/health.ts) assesses
 * feed liveness over DECLARED thresholds against an INJECTED instant —
 * no wall clock. The declaration below states the liveness envelope this
 * adapter commits to for the documented feed channels: intraday index
 * dissemination pushes at (up to) a 15-second cadence during the
 * declared trading session, so a heartbeat interval of 15 seconds with a
 * 60-second staleness limit is a conservative declared floor for "the
 * feed is keeping pace". Runtime hosts may redeclare tighter thresholds;
 * the assessment stays pure.
 */

import { validateHealthThresholds, type HealthThresholds } from './contract/health';

const declaration: HealthThresholds = {
  heartbeat_interval_ms: 15_000,
  staleness_limit_ms: 60_000,
};

const validation = validateHealthThresholds(declaration);
if (!validation.ok) {
  // Our own declaration — a validation failure is a programming error.
  throw new Error(`EQUITIES_HEALTH_THRESHOLDS is invalid: ${validation.errors.map((error) => error.message).join('; ')}`);
}

/** The declared, validated, deep-frozen liveness thresholds of the licensed index feed. */
export const EQUITIES_HEALTH_THRESHOLDS: HealthThresholds = validation.value;
