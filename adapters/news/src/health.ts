/**
 * @tradrl/adapter-news — the declared health thresholds.
 *
 * The SDK's health contract (mirrored in ./contract/health.ts) assesses
 * feed liveness over DECLARED thresholds against an INJECTED instant —
 * no wall clock. The declaration below states the liveness envelope this
 * adapter commits to for the documented wire channels: news wires are
 * bursty by nature (itemless minutes are normal), so a heartbeat
 * interval of 30 seconds with a 120-second staleness limit is a
 * conservative declared floor for "the wire is keeping pace". Runtime
 * hosts may redeclare tighter thresholds; the assessment stays pure.
 */

import { validateHealthThresholds, type HealthThresholds } from './contract/health';

const declaration: HealthThresholds = {
  heartbeat_interval_ms: 30_000,
  staleness_limit_ms: 120_000,
};

const validation = validateHealthThresholds(declaration);
if (!validation.ok) {
  // Our own declaration — a validation failure is a programming error.
  throw new Error(`NEWS_HEALTH_THRESHOLDS is invalid: ${validation.errors.map((error) => error.message).join('; ')}`);
}

/** The declared, validated, deep-frozen liveness thresholds of the news wire channels. */
export const NEWS_HEALTH_THRESHOLDS: HealthThresholds = validation.value;
