/**
 * @tradrl/adapter-arena — the declared health thresholds.
 *
 * The health contract (mirrored in ./contract/health.ts) assesses wire
 * liveness over DECLARED thresholds against an INJECTED instant — no
 * wall clock. The declaration below states the liveness envelope this
 * adapter commits to for the documented Arena wire channels:
 * human-expertise engagements are DELAYED by nature (the descriptor's
 * honest latency class) — quote responses arrive in hours, not
 * milliseconds — so a heartbeat interval of 10 minutes with a
 * 4-hour staleness limit is the conservative declared floor for "the
 * wire is keeping pace". Runtime hosts may redeclare tighter
 * thresholds; the assessment stays pure.
 */

import { validateHealthThresholds, type HealthThresholds } from './contract/health';

const declaration: HealthThresholds = {
  heartbeat_interval_ms: 600_000,
  staleness_limit_ms: 14_400_000,
};

const validation = validateHealthThresholds(declaration);
if (!validation.ok) {
  // Our own declaration — a validation failure is a programming error.
  throw new Error(`ARENA_HEALTH_THRESHOLDS is invalid: ${validation.errors.map((error) => error.message).join('; ')}`);
}

/** The declared, validated, deep-frozen liveness thresholds of the Arena wire channels. */
export const ARENA_HEALTH_THRESHOLDS: HealthThresholds = validation.value;
