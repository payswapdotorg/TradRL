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
 *
 * ADDITIVE (T027): the reactive replay world with endogenous participants
 * lives at src/reactive/ and is re-exported below — the second Market World
 * mode (L5), where the recorded stream flows in as exogenous events while
 * declared participants trade against a real matching engine.
 *
 * ADDITIVE (T028): the counterfactual/generative world lives at
 * src/generative/ and is re-exported below — the THIRD Market World mode
 * (L5), where there is no recorded stream at all: entire market
 * populations are generated from declared seeded stochastic processes
 * (stress/exploration instruments, never historical truth).
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

// ---------------------------------------------------------------------------
// The reactive replay world (T027) — additive re-exports of src/reactive/.
// The historical replay lane (src/replay/, T009) and the exchange lane
// (src/exchange/, T010) above are UNTOUCHED; this block only ADDS the
// reactive lane's public surface.
// ---------------------------------------------------------------------------

export type {
  ReactiveErrorCode,
  ReactiveError,
  ReactiveResult,
  InterleavingPolicy,
  ParticipantRole,
  ParticipantDeclaration,
  StreamSelection,
  PhysicsRefs,
  ReactiveWorldConfig,
  PhysicsLineage,
  ReactiveFillRecord,
  ReactiveObservation,
  ActionReceipt,
  ReactiveRunRecord,
  ReactiveRunState,
  ReactiveWorldInputs,
  ReactiveEpisodeView,
  ReactiveSubmission,
  ReactiveEpisodeFinish,
  ReactiveWorldService,
  EngineDriver,
  RecordedEvent,
  RecordedEventSource,
  ScriptedAction,
  ParticipantActionFeed,
  TrainerEnvironmentPort,
} from './reactive/index';
export {
  validateReactiveWorldConfig,
  canonicalConfigJson,
  configHash as reactiveConfigHash,
  policyRequiresSettled,
  isEngineDriver,
  physicsHash,
  validateExchangePhysics,
  engineStateHash,
  validateRecordedEvent,
  isRecordedEventSource,
  batchDigest as reactiveBatchDigest,
  chainDigest as reactiveChainDigest,
  createScriptedActionFeed,
  requireReactiveFill,
  admitObservation,
  admitObservations,
  requireReactiveRunRecord,
  serializeReactiveRunState,
  deserializeReactiveRunState,
  createReactiveWorldService,
  resumeReactiveWorldService,
  asTrainerEnvironment,
  isTrainerEnvironmentPort,
  runReactiveFixture,
  resumeReactiveFixture,
  fixtureWorldConfig as reactiveFixtureWorldConfig,
  fixtureSpec as reactiveFixtureSpec,
  fixturePhysics as reactiveFixturePhysics,
  createFixtureEventSource as createReactiveFixtureEventSource,
  createFixtureFeeds as createReactiveFixtureFeeds,
  fixtureDriverScript as reactiveFixtureDriverScript,
  reactivePackageInfo,
} from './reactive/index';

// ---------------------------------------------------------------------------
// The counterfactual/generative world (T028) — additive re-exports of
// src/generative/. The historical replay lane (src/replay/, T009), the
// exchange lane (src/exchange/, T010) and the reactive lane (src/reactive/,
// T027) above are UNTOUCHED; this block only ADDS the generative lane's
// public surface.
// ---------------------------------------------------------------------------

export type {
  GenerativeErrorCode,
  GenerativeError,
  GenerativeResult,
  InterleavingPolicy as GenerativeInterleavingPolicy,
  PhysicsRefs as GenerativePhysicsRefs,
  GenerativeWorldConfig,
  PhysicsLineage as GenerativePhysicsLineage,
  SyntheticProvenance,
  GeneratedEventRecord,
  GenerativeFillRecord,
  GenerativeObservation,
  ActionReceipt as GenerativeActionReceipt,
  GenerativeRunRecord,
  GenerativeRunState,
  GenerativeWorldInputs,
  GenerativeEpisodeView,
  GenerativeSubmission,
  GenerativeEpisodeFinish,
  GenerativeWorldService,
  EngineDriver as GenerativeEngineDriver,
  ProcessKind,
  ProcessDeclaration,
  ProcessRuntimeState,
  ProcessLineage,
  ProcessEmission,
  PopulationSpec,
  CohortDeclaration,
  CandidateDeclaration,
  InitialBook,
  TrainerEnvironmentPort as GenerativeTrainerEnvironmentPort,
} from './generative/index';
export {
  validateGenerativeWorldConfig,
  canonicalConfigJson as generativeCanonicalConfigJson,
  configHash as generativeConfigHash,
  policyRequiresSettled as generativePolicyRequiresSettled,
  isEngineDriver as isGenerativeEngineDriver,
  physicsHash as generativePhysicsHash,
  validateExchangePhysics as validateGenerativeExchangePhysics,
  engineStateHash as generativeEngineStateHash,
  validateProcessDeclaration,
  processHash,
  armProcess,
  processStateHash,
  validatePopulationSpec,
  cohortInstances,
  SYNTHETIC_PROVENANCE_DECLARATION,
  requireGeneratedEvent,
  requireGenerativeFill,
  admitObservation as admitGenerativeObservation,
  admitObservations as admitGenerativeObservations,
  requireGenerativeRunRecord,
  serializeGenerativeRunState,
  deserializeGenerativeRunState,
  createGenerativeWorldService,
  resumeGenerativeWorldService,
  asTrainerEnvironment as asGenerativeTrainerEnvironment,
  isTrainerEnvironmentPort as isGenerativeTrainerEnvironmentPort,
  runGenerativeFixture,
  resumeGenerativeFixture,
  fixtureWorldConfig as generativeFixtureWorldConfig,
  fixtureSpec as generativeFixtureSpec,
  fixturePhysics as generativeFixturePhysics,
  fixtureProcesses,
  fixturePopulation,
  fixtureDriverScript as generativeFixtureDriverScript,
  GENERATIVE_FIDELITY_DECLARATION,
  generativePackageInfo,
} from './generative/index';

/** Package identity and ownership (Work Order T009). */
export const packageInfo = {
  name: '@tradrl/market-world',
  owner: 'T009',
  status: 'implemented',
} as const;
