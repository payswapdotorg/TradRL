/**
 * @tradrl/market-world (service) — the reference implementation of the
 * historical replay World (Work Order T009).
 *
 * Public API (src/replay/):
 *   - `ReplayEventSource` / `isReplayEventSource` — the pure async-iterator
 *     event-source contract (NO I/O in this WO; fixture streams only).
 *   - Fixtures — deterministic synthetic history (quotes, trades, book
 *     snapshots mirroring market-protocol payload taxonomies + derived
 *     vwap aggregates) declaring RECORDED-HISTORICAL provenance explicitly.
 *   - `ReplayWorldService` — load the recorded stream, then drive episodes
 *     through the five Environment operations (structural), with
 *     `ReplayRunRecord` lineage (L9) and resumable `ReplayRunState`.
 *   - `createReplayWorldService` / `resumeReplayWorldService` — the two
 *     constructors (fresh run; resume from a serialized state with ingest-
 *     chain verification).
 *
 * The contract package `@tradrl/market-world` (packages/market-world) owns
 * every law this service enforces: the WorldEvent mirror (the stream IN),
 * the inclusive L4 boundary (the firewall OUT), the per-stream sequence
 * discipline, the anti-poisoning origin rule, and the L6 limitation —
 * actions are recorded as intents with typed receipts, NEVER matched.
 *
 * See README.md for how T010 (exchange sim), T026 (knowledge firewall) and
 * T013 (RL bridge) consume this world.
 */

// The pure event-source contract
export type { ReplayEventSource } from './replay/event-source';
export { isReplayEventSource, asReplayEventSource } from './replay/event-source';

// Deterministic fixture streams (recorded-historical provenance declared explicitly)
export type { FixtureStreamOptions } from './replay/fixtures';
export {
  fixtureOptions,
  fixtureEventBatches,
  fixtureEvents,
  createFixtureEventSource,
  fixtureLatestAvailability,
  fixtureWorldConfig,
  fixtureSpec,
  FIXTURE_ADAPTER,
} from './replay/fixtures';

// Run records + resumable run states
export type {
  ClockAdvance,
  RunRecordWorld,
  RunRecordEpisode,
  RunRecordIngestion,
  RunRecordObservations,
  ReplayRunRecord,
  ReplayRunLog,
  ReplayRunState,
} from './replay/run-state';
export {
  batchDigest,
  chainDigest,
  untrustedBatchDigest,
  isReplayRunRecord,
  emptyRunLog,
  isReplayRunLog,
  serializeReplayRunState,
  deserializeReplayRunState,
  streamsSeenOf,
  buildRunRecord,
} from './replay/run-state';

// The service itself
export type { LoadOutcome, LoadSummary, ReplayWorldService } from './replay/service';
export { createReplayWorldService, resumeReplayWorldService } from './replay/service';

/** Package identity and ownership (Work Order T009). */
export const packageInfo = {
  name: '@tradrl/market-world',
  owner: 'T009',
  status: 'implemented',
} as const;
