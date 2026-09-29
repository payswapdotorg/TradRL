/**
 * @tradrl/adapter-brokers — the declared health thresholds.
 *
 * The SDK's health contract (mirrored in ./contract/health.ts) assesses
 * feed liveness over DECLARED thresholds against an INJECTED instant —
 * no wall clock. The declaration below states the liveness envelope this
 * adapter commits to for the broker gateway's execution-report stream:
 * reports arrive on execution (not on a fixed cadence like book
 * streams), so a heartbeat interval of five seconds with a thirty-second
 * staleness limit is a conservative declared floor for "the session is
 * keeping pace" (a quiet session with no working orders reports nothing
 * by design; the runtime host redeclares tighter thresholds when it
 * knows an order is working). The assessment stays pure.
 */

import { validateHealthThresholds, type HealthThresholds } from './contract/health';

const declaration: HealthThresholds = {
  heartbeat_interval_ms: 5_000,
  staleness_limit_ms: 30_000,
};

const validation = validateHealthThresholds(declaration);
if (!validation.ok) {
  // Our own declaration — a validation failure is a programming error.
  throw new Error(`BROKER_HEALTH_THRESHOLDS is invalid: ${validation.errors.map((error) => error.message).join('; ')}`);
}

/** The declared, validated, deep-frozen liveness thresholds of the broker execution-report stream. */
export const BROKER_HEALTH_THRESHOLDS: HealthThresholds = validation.value;
