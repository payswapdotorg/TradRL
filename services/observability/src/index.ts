/**
 * @tradrl/observability_service — the observability collector service
 * (Work Order T043): the operational visibility layer's COLLECTION
 * half.
 *
 * Public API:
 *   - `createObservabilityCollector` — the collector over INJECTED
 *     instants (the scriptedInstants pattern) and INJECTED consumer
 *     sinks; one growing TelemetryLog per tenant/project scope; the
 *     `observe` path validates REAL seam records through the contract
 *     package's mirror guards and emits identity-referencing
 *     telemetry (never payload copies).
 *   - `TelemetryLog` + `startTelemetryLog` / `telemetryRecordAt` /
 *     `appendTelemetryRecord` / `verifyTelemetryLog` /
 *     `validateTelemetryLog` — the append-only, chain-verified log
 *     (T040's GatewayAuditTrail discipline, mirrored law-for-law).
 *   - `replayTelemetryLog` — the determinism proof: the re-append
 *     fold reproduces the log byte-identically.
 *   - `queryTelemetry` — the historical query with the L4 asOf
 *     discipline (INCLUSIVE bound) and the L12 scope check.
 *   - The injected ports: `InstantSource` / `ScriptedInstants` /
 *     `scriptedInstants` (the no-ambient-clock law) and
 *     `TelemetrySink` (the consumer port).
 *
 * The contract package `@tradrl/observability` is consumed via
 * RELATIVE SOURCE IMPORTS (the services/execution-gateway precedent —
 * no lockfile-touching workspace edge).
 *
 * Zero runtime dependencies. No ambient clock. No network. No
 * credential values anywhere (the opacity trip wire runs over every
 * record through the contract guards).
 */

// The telemetry log (append-only, chain-verified)
export type { TelemetryLog, TelemetryRecordDraft } from './log';
export {
  isTelemetryLog,
  telemetryRecordTree,
  canonicalTelemetryLogJson,
  startTelemetryLog,
  telemetryRecordAt,
  appendTelemetryRecord,
  verifyTelemetryLog,
  validateTelemetryLog,
  replayTelemetryLog,
  latestRecordedAt,
} from './log';

// The historical query (the L4 asOf discipline)
export type { TelemetryQuery } from './query';
export { isTelemetryQuery, queryTelemetry } from './query';

// The collector
export type {
  ObservabilityCollectorConfig,
  TelemetryScopeInput,
  MetricInput,
  TraceSpanInput,
  LogInput,
  ObserveOptions,
  ObservabilityCollector,
} from './collector';
export { createObservabilityCollector } from './collector';

// The injected ports
export type { InstantSource, ScriptedInstants, TelemetrySink } from './ports';
export { scriptedInstants, isTelemetrySink } from './ports';

/** Service identity and ownership (governance surface). */
export const packageInfo = {
  name: '@tradrl/observability_service',
  owner: 'T043',
  status: 'implemented',
  concepts: [
    'createObservabilityCollector',
    'TelemetryLog',
    'replayTelemetryLog',
    'queryTelemetry',
    'scriptedInstants',
  ],
} as const;
