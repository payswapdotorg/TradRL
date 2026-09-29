/**
 * @tradrl/adapter-binance — the declared health thresholds.
 *
 * The SDK's health contract (mirrored in ./contract/health.ts) assesses
 * feed liveness over DECLARED thresholds against an INJECTED instant —
 * no wall clock. The Binance declaration below states the liveness
 * envelope this adapter commits to for the documented streams: the
 * depth streams push at (up to) 100 ms cadence, so a heartbeat interval
 * of one second with a three-second staleness limit is a conservative
 * declared floor for "the feed is keeping pace". Runtime hosts may
 * redeclare tighter thresholds; the assessment stays pure.
 */

import { validateHealthThresholds, type HealthThresholds } from './contract/health';

const declaration: HealthThresholds = {
  heartbeat_interval_ms: 1_000,
  staleness_limit_ms: 3_000,
};

const validation = validateHealthThresholds(declaration);
if (!validation.ok) {
  // Our own declaration — a validation failure is a programming error.
  throw new Error(`BINANCE_HEALTH_THRESHOLDS is invalid: ${validation.errors.map((error) => error.message).join('; ')}`);
}

/** The declared, validated, deep-frozen liveness thresholds of the Binance feeds. */
export const BINANCE_HEALTH_THRESHOLDS: HealthThresholds = validation.value;
