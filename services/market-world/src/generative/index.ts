/**
 * @tradrl/market-world (generative service) — the COUNTERFACTUAL/
 * GENERATIVE WORLD (work order T028): the THIRD L5 fidelity class.
 *
 * Public API (src/generative/):
 *   - `GenerativeWorldConfig` / `InterleavingPolicy` — the mode-honest
 *     declaration (mode = 'generative' as a LITERAL TYPE; any other claim
 *     is `fidelity_claim_dishonest`), the POPULATION spec (the declared
 *     initial book, the candidate organization, the participant cohorts
 *     with behavior-policy refs), the STOCHASTIC-PROCESS declarations
 *     (versioned, seeded, cadenced — there IS no recorded stream), the
 *     exchange-sim physics (structural mirror) + the physics lineage
 *     refs, and the declared interleaving policy — plus canonical config
 *     JSON + deterministic config hash (L9).
 *   - `ProcessDeclaration` / `stepProcess` / `armProcess` /
 *     `ProcessRuntimeState` / `processStateHash` — the declared seeded
 *     stochastic processes (the generative core): the anchor walk
 *     (reference_price_walk) and the behavior policies (market_maker,
 *     momentum_taker, mean_reverter, noise_trader). Every draw is a pure
 *     function of the declared seed; the runtime states serialize, so the
 *     stochastic processes RESUME mid-stream deterministically.
 *   - `GenerativeWorldService` — the five Environment operations
 *     (start/observe/submit/advance/finish + the Work Order's descriptive
 *     aliases startEpisode/emitObservations/submitAction/advanceEpisode/
 *     finishEpisode), the boundary step machine (ONE boundary per advance,
 *     ordered by the declared interleaving), engine seeding from the
 *     declared initial book, process arming, and the L9 lineage records.
 *   - `createGenerativeWorldService` / `resumeGenerativeWorldService` —
 *     the two constructors (fresh run over the declared config; resume
 *     from a serialized state with generation-chain + PROCESS STATE HASH
 *     + engine-state-hash verification — tamper = `chain_mismatch`).
 *   - `GenerativeRunRecord` / `GenerativeRunState` — the L9 lineage block
 *     (config hash, generation-chain head, spec hash, ENGINE STATE HASH,
 *     PROCESS STATE HASH, digest) and the resumable state
 *     (serialize/parse/resume).
 *   - `GenerativeFillRecord` / `requireGenerativeFill` — engine fills with
 *     FULL PHYSICS LINEAGE (engine record refs + fee/latency/slippage/
 *     impact config refs + run ref + tenant/project); a fill without
 *     lineage is a typed error.
 *   - `GeneratedEventRecord` / `requireGeneratedEvent` — generated events
 *     with FULL PROCESS LINEAGE (process ref, instance, version, seed,
 *     step) + the SYNTHETIC-PROVENANCE declaration; an event without
 *     lineage or without the declaration is a typed error
 *     (`process_undeclared` / `synthetic_provenance_missing`).
 *   - `admitObservation(s)` — the L4 delivery gate (an observation leaked
 *     past the boundary is `l4_boundary_violation`).
 *   - `asTrainerEnvironment` — the thin T013 bridge adapter (the
 *     EnvironmentPort mirror: view narrowing + `{ kind, body }` payload
 *     vocabulary).
 *   - Fixtures — the declared population/process/physics scenario and the
 *     golden world evolution runner.
 *   - `EngineDriver` / the exchange-sim + environment-protocol structural
 *     MIRRORS (zero imports across lanes; the interop trip-wire tests
 *     prove every mirror against the REAL packages present on this
 *     branch).
 *
 * THE GENERATIVE DIFFERENCE (the existential law): there IS no recorded
 * stream — entire market POPULATIONS are generated from declared seeded
 * stochastic processes, for stress/exploration regimes history never
 * provided. Every generated event carries its process lineage; every
 * emitted record carries the synthetic-provenance declaration; a record
 * passing as historical is unrepresentable (L6: synthetic worlds are
 * stress/exploration instruments, not historical truth). Endogenous
 * candidate-organization actions are matched by the REAL engine with full
 * physics lineage (T027's discipline, verbatim).
 */

import { deepFreeze } from './primitives';

// Errors and results
export type { GenerativeErrorCode, GenerativeError, GenerativeResult } from './errors';
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
  seededState,
  xorshift32,
  drawUnit,
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
  ProcessRef,
  CohortId,
  GeneratedEventId,
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
  isProcessRef,
  isCohortId,
  isGeneratedEventId,
  deriveRunId,
  deriveReceiptId,
  deriveGeneratedEventId,
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

// The declared stochastic processes (the generative core)
export type {
  ProcessKind,
  ProcessDeclaration,
  ProcessRuntimeState,
  ProcessStepContext,
  ProcessLineage,
  ProcessEmission,
  ProcessStepOutcome,
} from './process';
export {
  PROCESS_KINDS,
  isProcessKind,
  BEHAVIOR_KINDS,
  isBehaviorKind,
  WORLD_PROCESS_INSTANCE,
  validateProcessDeclaration,
  canonicalProcessJson,
  processHash,
  isProcessRuntimeState,
  armProcess,
  processStateHash,
  isProcessLineage,
  ticksBetween,
  scaleQuantity,
} from './process';

// The declared population (cohorts + behavior-policy refs + initial state)
export type {
  InitialBookLevel,
  InitialBook,
  CandidateDeclaration,
  CohortDeclaration,
  PopulationSpec,
} from './population';
export {
  isInitialBook,
  isCandidateDeclaration,
  isCohortDeclaration,
  cohortInstances,
  validatePopulationSpec,
  populationSize,
} from './population';

// The world config (the mode-honest declaration)
export type { InterleavingPolicy, PhysicsRefs, GenerativeWorldConfig } from './config';
export {
  INTERLEAVING_KINDS,
  isInterleavingPolicy,
  policyRequiresSettled,
  isPhysicsRefs,
  validateGenerativeWorldConfig,
  canonicalConfigJson,
  configHash,
} from './config';

// The lineage records (L6/L9/L12 + the physics-lineage + process-lineage + L4 laws)
export type {
  PhysicsLineage,
  SyntheticProvenance,
  GeneratedEventRecord,
  GenerativeFillRecord,
  GenerativeObservation,
  GenerativeDisposition,
  ReceiptEngineOutcome,
  ActionReceipt,
  ClockAdvance,
  RunRecordWorld,
  RunRecordEpisode,
  RunRecordGeneration,
  RunRecordEngine,
  RunRecordPopulation,
  RunRecordObservations,
  GenerativeRunRecord,
  GenerativeRunLog,
  GenerativeRunState,
  EpisodeLineState,
} from './records';
export {
  SYNTHETIC_PROVENANCE_DECLARATION,
  isPhysicsLineage,
  requireGeneratedEvent,
  isGeneratedEvent,
  requireGenerativeFill,
  isGenerativeFill,
  admitObservation,
  admitObservations,
  isGenerativeObservation,
  isActionReceipt,
  requireGenerativeRunRecord,
  isGenerativeRunRecord,
  emptyRunLog,
  isGenerativeRunLog,
  generatedEventDigest,
  chainDigest,
  isGenerativeRunStateShape,
  serializeGenerativeRunState,
  deserializeGenerativeRunState,
  buildRunRecord,
} from './records';

// The service (the five operations + the step machine + resume)
export type {
  GenerativeWorldInputs,
  GenerativeEpisodeView,
  GenerativeSubmission,
  GenerativeEpisodeFinish,
  GenerativeWorldService,
} from './service';
export { createGenerativeWorldService, resumeGenerativeWorldService } from './service';

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
export type { GenerativeFixtureOptions, GenerativeFixtureRun, FixtureDriverStep } from './fixtures';
export {
  fixtureOptions,
  fixturePhysics,
  fixturePhysicsRefs,
  fixtureProcesses,
  fixturePopulation,
  fixtureWorldConfig,
  fixtureSpec,
  fixtureDriverScript,
  createFixtureInputs,
  runGenerativeFixture,
  resumeGenerativeFixture,
  fixtureConfigHash,
  FIXTURE_CONSTANTS,
} from './fixtures';

/** The generative lane's fidelity declaration (L5/L6): a synthetic instrument, never historical truth. */
export const GENERATIVE_FIDELITY_DECLARATION = deepFreeze({
  mode: 'generative' as const,
  declaration: 'counterfactual/generative simulation: the entire market population is generated from declared seeded stochastic processes — no recorded stream exists at all',
  limitation: 'every generated record is synthetic exploration data, never historical truth (L6) — this world exists for stress/exploration regimes history never provided; exact replay is T009, reactive replay is T027',
});

/** Package identity and ownership (Work Order T028). */
export const generativePackageInfo = {
  name: '@tradrl/market-world (generative)',
  owner: 'T028',
  status: 'implemented',
} as const;
