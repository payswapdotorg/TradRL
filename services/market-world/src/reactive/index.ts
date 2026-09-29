/**
 * @tradrl/market-world (reactive service) — the REACTIVE REPLAY WORLD with
 * ENDOGENOUS PARTICIPANTS (work order T027).
 *
 * Public API (src/reactive/):
 *   - `ReactiveWorldConfig` / `InterleavingPolicy` / `ParticipantDeclaration`
 *     / `PhysicsRefs` — the mode-honest declaration (mode = 'reactive_replay'
 *     as a LITERAL TYPE; any other claim is `fidelity_claim_dishonest`),
 *     the participant roster (opaque instance refs + declared feed refs),
 *     the exchange-sim physics (structural mirror) + the physics lineage
 *     refs, and the declared interleaving policy — plus canonical config
 *     JSON + deterministic config hash (L9).
 *   - `ReactiveWorldService` — the five Environment operations
 *     (start/observe/submit/advance/finish + the Work Order's descriptive
 *     aliases startEpisode/emitObservations/submitAction/advanceEpisode/
 *     finishEpisode), the boundary step machine (ONE boundary per advance,
 *     ordered by the declared interleaving), the load-then-bind stream
 *     discipline (digest-chained), engine seeding from recorded snapshots,
 *     and the L9 lineage records.
 *   - `createReactiveWorldService` / `resumeReactiveWorldService` — the two
 *     constructors (fresh run over declared inputs; resume from a
 *     serialized state with ingest-chain + scripted-feed verification —
 *     tamper = `chain_mismatch`).
 *   - `ReactiveRunRecord` / `ReactiveRunState` — the L9 lineage block
 *     (config hash, chain head, spec hash, ENGINE STATE HASH, digest) and
 *     the resumable state (serialize/parse/resume).
 *   - `ReactiveFillRecord` / `requireReactiveFill` — engine fills with
 *     FULL PHYSICS LINEAGE (engine record refs + fee/latency/slippage/
 *     impact config refs + run ref + tenant/project); a fill without
 *     lineage is a typed error.
 *   - `admitObservation(s)` — the L4 delivery gate (an observation leaked
 *     past the boundary is `l4_boundary_violation`).
 *   - `asTrainerEnvironment` — the thin T013 bridge adapter (the
 *     EnvironmentPort mirror: view narrowing + `{ kind, body }` payload
 *     vocabulary).
 *   - Fixtures — the deterministic scripted stream + scripted action feeds
 *     + physics + the golden world evolution runner.
 *   - `EngineDriver` / the exchange-sim + environment-protocol + time-engine
 *     + market-protocol STRUCTURAL MIRRORS (zero imports across lanes; the
 *     interop trip-wire tests prove every mirror against the REAL packages
 *     present on this branch).
 *
 * THE REACTIVE DIFFERENCE (the existential law): endogenous participant
 * actions ARE matched against the engine (with declared physics configs),
 * while the exogenous recorded stream still flows in as events. In exact
 * replay (T009) an order is a receipt, never a match; HERE the market
 * fights back. Synthetic fills are `simulated`-origin observations — this
 * world NEVER asserts its fills are historical truth (L6: synthetic
 * worlds are stress/exploration instruments, not historical truth).
 */

import { deepFreeze } from './primitives';

// Errors and results
export type { ReactiveErrorCode, ReactiveError, ReactiveResult } from './errors';
export { fail, ok, missingField, invalidField, invalidType } from './errors';

// Structural primitives (deepFreeze discipline, branding, canonical JSON)
export type { Brand, JsonValue, JsonObject } from './primitives';
export {
  isRecord,
  isNonEmptyString,
  isFiniteNumber,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
  isJsonValue,
  isJsonObject,
  deepFreeze,
  isDeeplyFrozen,
  canonicalJson,
  fnv1a32Hex,
  createSeededRandom,
} from './primitives';

// Branded ids + the timestamp mirror
export type {
  TimestampMs,
  TenantId,
  ProjectId,
  AgentInstanceId,
  EpisodeId,
  ObservationId,
  ActionId,
  VenueId,
  InstrumentId,
  Seed,
  ExchangeOrderId,
  FillId,
  RunId,
  ReceiptId,
  FeedRef,
} from './ids';
export {
  MIN_TIMESTAMP_MS,
  MAX_TIMESTAMP_MS,
  isTimestampMs,
  isTenantId,
  isProjectId,
  isAgentInstanceId,
  isEpisodeId,
  isObservationId,
  isActionId,
  isVenueId,
  isInstrumentId,
  isSeed,
  isExchangeOrderId,
  isFillId,
  isRunId,
  isReceiptId,
  isFeedRef,
  deriveRunId,
  deriveReceiptId,
} from './ids';

// Environment-protocol + time-engine structural mirrors (D-003/D-004)
export type {
  TerminationCode,
  TerminationReason,
  FidelityMode,
  InformationPolicy,
  ClockState,
  WorldRef,
  EnvironmentProfile,
  EnvironmentSpec,
  ObservationOrigin,
  ObservationProvenance,
  ObservationEnvelope,
  ActionEnvelope,
  RewardSignalMirror,
  EpisodeStatus,
  EpisodeStateMirror,
  EpisodeResultMirror,
  EpisodeFinishMirror,
  EnvironmentSurface,
} from './env-mirror';
export {
  TERMINATION_CODES,
  isTerminationCode,
  isTerminationReason,
  FIDELITY_MODES,
  isFidelityMode,
  isInformationPolicy,
  isClockState,
  isWorldRef,
  isEnvironmentProfile,
  isEnvironmentSpec,
  validateEnvironmentSpec,
  canonicalSpecJson,
  deriveEpisodeId,
  isObservationOrigin,
  isObservationProvenance,
  isObservationEnvelope,
  isActionEnvelope,
  isEpisodeStateMirror,
  isEnvironmentSurface,
} from './env-mirror';

// Exchange-sim structural mirrors + the injected engine driver port
export type {
  FeeTierMirror,
  FeeScheduleMirror,
  LatencyConfigMirror,
  SlippageConfigMirror,
  MarketImpactPolicyMirror,
  ExchangeFidelity,
  ExchangePhysicsMirror,
  OrderIntentMirror,
  AvailabilityQuartetMirror,
  FillMirror,
  OrderAckMirror,
  OrderRejectMirror,
  OrderCancelMirror,
  RestingOrderMirror,
  RestingLevelMirror,
  BookStateMirror,
  EngineStateMirror,
  SubmitOutcomeMirror,
  CancelOutcomeMirror,
  AdvanceOutcomeMirror,
  EngineOpResult,
  EngineInitMirror,
  EngineDriver,
  BookTopView,
} from './exchange-mirror';
export {
  isCanonicalDecimal,
  isCanonicalPositiveDecimal,
  isUnsignedDecimal,
  EXCHANGE_FIDELITY_MODES,
  isExchangeFidelity,
  isFeeSchedule,
  isLatencyConfig,
  isSlippageConfig,
  isMarketImpactPolicy,
  ASSET_CLASSES,
  isAssetClassOfMarket,
  validateExchangePhysics,
  canonicalPhysicsJson,
  physicsHash,
  isAvailabilityQuartet,
  isFillMirror,
  isOrderAckMirror,
  isOrderRejectMirror,
  isOrderCancelMirror,
  isEngineDriver,
  bookTopView,
  bookTopKey,
  engineStateHash,
} from './exchange-mirror';

// The recorded stream (the WorldEvent mirror) + the source port + the chain
export type { AssetClass, EventType, EventOrigin, AdapterRefMirror, EventProvenanceMirror, RecordedEvent, RecordedEventSource } from './stream';
export {
  ASSET_CLASSES as STREAM_ASSET_CLASSES,
  isAssetClass,
  EVENT_TYPES,
  isEventType,
  isEventOrigin,
  validateRecordedEvent,
  isRecordedEvent,
  isRecordedEventSource,
  asRecordedEventSource,
  batchDigest,
  chainDigest,
  untrustedBatchDigest,
} from './stream';

// The scripted participant action feeds
export type { ScriptedAction, ParticipantActionFeed } from './action-feed';
export { isScriptedAction, isParticipantActionFeed, createScriptedActionFeed } from './action-feed';

// The world config (the mode-honest declaration)
export type { InterleavingPolicy, ParticipantRole, ParticipantDeclaration, StreamSelection, PhysicsRefs, ReactiveWorldConfig } from './config';
export {
  INTERLEAVING_KINDS,
  isInterleavingPolicy,
  policyRequiresSettled,
  PARTICIPANT_ROLES,
  isParticipantRole,
  isParticipantDeclaration,
  isStreamSelection,
  streamSelectionKey,
  isPhysicsRefs,
  validateReactiveWorldConfig,
  canonicalConfigJson,
  configHash,
} from './config';

// The lineage records (L9/L12 + the physics-lineage law + the L4 gate)
export type {
  PhysicsLineage,
  ReactiveFillRecord,
  ReactiveObservation,
  ReactiveDisposition,
  ReceiptEngineOutcome,
  ActionReceipt,
  ScriptedLogEntry,
  ClockAdvance,
  RunRecordWorld,
  RunRecordEpisode,
  RunRecordIngestion,
  RunRecordEngine,
  RunRecordParticipants,
  RunRecordObservations,
  ReactiveRunRecord,
  ReactiveRunLog,
  EpisodeLineState,
  ReactiveRunState,
  RunRecordInputs,
} from './records';
export {
  isPhysicsLineage,
  requireReactiveFill,
  isReactiveFill,
  admitObservation,
  admitObservations,
  isReactiveObservation,
  isActionReceipt,
  isScriptedLogEntry,
  requireReactiveRunRecord,
  isReactiveRunRecord,
  emptyRunLog,
  isReactiveRunLog,
  isReactiveRunStateShape,
  serializeReactiveRunState,
  deserializeReactiveRunState,
  buildRunRecord,
} from './records';

// The service (the five operations + the step machine + resume)
export type {
  ReactiveWorldInputs,
  LoadOutcome,
  LoadSummary,
  ReactiveEpisodeView,
  ReactiveSubmission,
  ReactiveEpisodeFinish,
  ReactiveWorldService,
} from './service';
export { createReactiveWorldService, resumeReactiveWorldService } from './service';

// The T013 bridge adapter (the EnvironmentPort mirror)
export type {
  EpisodeViewMirror,
  ObservationViewMirror,
  EpisodeFinishViewMirror,
  TrainerEnvironmentError,
  TrainerEnvironmentResult,
  TrainerEnvironmentPort,
} from './adapter';
export { isTrainerEnvironmentPort, asTrainerEnvironment, observationIsView, episodeViewIsView } from './adapter';

// Fixtures (the golden world evolution)
export type { ReactiveFixtureOptions, ReactiveFixtureRun, FixtureDriverStep } from './fixtures';
export {
  fixtureOptions,
  fixturePhysics,
  fixturePhysicsRefs,
  FIXTURE_ADAPTER,
  fixtureRecordedBatches,
  createFixtureEventSource,
  fixtureParticipants,
  fixtureAdversaryScript,
  fixtureMakerScript,
  createFixtureFeeds,
  fixtureDriverScript,
  fixtureWorldConfig,
  fixtureSpec,
  createFixtureInputs,
  runReactiveFixture,
  resumeReactiveFixture,
  fixtureConfigHash,
} from './fixtures';

/** The reactive lane's fidelity declaration (L5/L6): a synthetic instrument, never historical truth. */
export const REACTIVE_FIDELITY_DECLARATION = deepFreeze({
  mode: 'reactive_replay' as const,
  declaration: 'reactive replay with endogenous participants: recorded history flows in as exogenous events while declared participants trade against a real matching engine (fees, latency, slippage and visible-book impact all live)',
  limitation: 'engine-driven fills are SIMULATED outcomes, not historical trades — this world is a stress/exploration instrument, never historical truth (L6); exact replay is T009, generative worlds are T028',
});

/** Package identity and ownership (Work Order T027). */
export const reactivePackageInfo = {
  name: '@tradrl/market-world (reactive)',
  owner: 'T027',
  status: 'implemented',
} as const;
