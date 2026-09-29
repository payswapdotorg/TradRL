/**
 * @tradrl/adapter-alternative-data — the declared health thresholds.
 *
 * The SDK's health contract (mirrored in ./contract/health.ts) assesses
 * feed liveness over DECLARED thresholds against an INJECTED instant —
 * no wall clock. The declaration below states the liveness envelope
 * this adapter commits to for the documented observation channels:
 * alternative data is BATCH-released (the descriptor declares latency
 * class "batch" — daily/weekly windows with declared release instants),
 * so a heartbeat interval of one hour with a 24-hour staleness limit is
 * a conservative declared floor for "the vendor is releasing on
 * schedule". Runtime hosts may redeclare tighter thresholds; the
 * assessment stays pure.
 */

import { validateHealthThresholds, type HealthThresholds } from './contract/health';

const declaration: HealthThresholds = {
  heartbeat_interval_ms: 3_600_000,
  staleness_limit_ms: 86_400_000,
};

const validation = validateHealthThresholds(declaration);
if (!validation.ok) {
  // Our own declaration — a validation failure is a programming error.
  throw new Error(`ALTDATA_HEALTH_THRESHOLDS is invalid: ${validation.errors.map((error) => error.message).join('; ')}`);
}

/** The declared, validated, deep-frozen liveness thresholds of the alternative-data vendor channels. */
export const ALTDATA_HEALTH_THRESHOLDS: HealthThresholds = validation.value;
