/**
 * @tradrl/market-world — the historical replay World contract package
 * (Work Order T009).
 *
 * Public API:
 *   - `ReplayWorldConfig` / `WorldMode` / `StreamSelection` — the world
 *     config (fidelity, information policy, seed, stream selection by
 *     opaque venue/instrument ids, `as_of` anchor) + canonical config JSON
 *     and deterministic config hash (L9).
 *   - `WorldEvent` — the event envelope mirror of market-protocol's
 *     MarketEvent (validated by this package's own mirrored guards; the
 *     stream IN, the firewall OUT).
 *   - `ClockState` — the structural mirror of time-engine's SimulationClock.
 *   - `ReplayWorldState` — the immutable value object (clock, history,
 *     applied-event cursor, recorded snapshot refs, per-stream sequence
 *     trackers, intent log) + total guards and serialize/deserialize.
 *   - `ingestWorld` / `observeWorld` / `advanceWorld` / `finishWorld` — the
 *     PURE ReplayTransition protocol (quartet ordering, sequence
 *     discipline, duplicate ids, stream selection, `as_of` anchor,
 *     anti-poisoning, the inclusive L4 boundary, monotonic anchored time).
 *   - `WorldAdapter` — the structural implementation of
 *     environment-protocol's Environment five-operation surface
 *     (start/observe/submit/advance/finish) over a ReplayWorldState;
 *     actions are recorded as intents with typed receipts, never matched.
 *   - Environment-protocol shape MIRRORS (`EnvironmentSpec`,
 *     `ObservationMirror`, `ActionMirror`, `EpisodeStateMirror`, ...) —
 *     D-004 structural mirrors; never imports the environment lane.
 *   - `deriveEpisodeId` / `canonicalJson` / `fnv1a32Hex` — the mirrored
 *     deterministic derivation (same spec, same episode id, both packages).
 *
 * Zero runtime dependencies; types, schemas and pure functions only.
 * `TimestampMs` and `ClockState` are structural mirrors of
 * `@tradrl/time-engine` (canonical owner); the event envelope mirrors
 * `@tradrl/market-protocol`; the episode shapes mirror
 * `@tradrl/environment-protocol` — see src/timestamp.ts, src/clock.ts,
 * src/event.ts and src/env-mirror.ts for the mirror discipline.
 *
 * L6 LIMITATION (declared): in exact replay, execution fidelity is bounded
 * by recorded history. There are NO synthetic fills in this mode — submitted
 * actions are recorded as intents (typed receipts) and that is where the
 * world stops; matching is T010 (exchange simulation) / T027 (reactive
 * participants) territory.
 */

// Errors and results
export type { WorldErrorCode, WorldError, WorldResult } from './errors';
export { fail, failures, ok, missingField, invalidField, invalidType } from './errors';

// Structural primitives (deepFreeze discipline, branding)
export type { Brand } from './primitives';
export {
  isRecord,
  isNonEmptyString,
  isFiniteNumber,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
  deepFreeze,
  isDeeplyFrozen,
} from './primitives';

// JSON value model (opaque payloads)
export type { JsonValue, JsonObject } from './json';
export { isJsonValue, isJsonObject } from './json';

// Timestamp mirror (canonical owner: @tradrl/time-engine)
export type { TimestampMs } from './timestamp';
export { MIN_TIMESTAMP_MS, MAX_TIMESTAMP_MS, isTimestampMs, requireTimestampMs } from './timestamp';

// Branded ids and opaque cross-lane references
export type {
  WorldSnapshotRef,
  IntentReceiptId,
  WorldId,
  EnvironmentId,
  EpisodeId,
  ObservationId,
  ActionId,
  RewardId,
  AgentInstanceId,
  VenueId,
  InstrumentId,
  LatencyPolicyId,
  FeePolicyId,
  Seed,
} from './ids';
export {
  isWorldSnapshotRef,
  isIntentReceiptId,
  isWorldId,
  isEnvironmentId,
  isEpisodeId,
  isObservationId,
  isActionId,
  isRewardId,
  isAgentInstanceId,
  isVenueId,
  isInstrumentId,
  isLatencyPolicyId,
  isFeePolicyId,
  isSeed,
  requireObservationId,
  requireVenueId,
  requireInstrumentId,
} from './ids';

// Clock mirror (canonical owner: @tradrl/time-engine)
export type { FidelityMode, InformationPolicy, ClockState } from './clock';
export {
  FIDELITY_MODES,
  isFidelityMode,
  isInformationPolicy,
  isClockState,
  createClockState,
  validateClockState,
  advanceClockStateTo,
} from './clock';

// Environment-protocol shape mirrors (canonical owner: @tradrl/environment-protocol)
export type {
  TerminationCode,
  TerminationReason,
  WorldRef,
  EnvironmentProfile,
  EnvironmentSpec,
  ObservationOrigin,
  ObservationProvenance,
  ObservationMirror,
  Available,
  ActionMirror,
  RewardSignalMirror,
  EpisodeStatus,
  EpisodeStateMirror,
  EpisodeResultMirror,
  EpisodeFinishMirror,
} from './env-mirror';
export {
  TERMINATION_CODES,
  isTerminationCode,
  isTerminationReason,
  validateTerminationReason,
  isWorldRef,
  isEnvironmentProfile,
  validateEnvironmentProfile,
  isEnvironmentSpec,
  validateEnvironmentSpec,
  canonicalJson,
  fnv1a32Hex,
  canonicalSpecJson,
  deriveEpisodeId,
  OBSERVATION_ORIGINS,
  isObservationOrigin,
  isObservationProvenance,
  isObservationMirror,
  isActionMirror,
  validateActionMirror,
  isRewardSignalMirror,
  EPISODE_STATUSES,
  isEpisodeStatus,
  isEpisodeStateMirror,
  isEpisodeResultMirror,
  isEpisodeFinishMirror,
} from './env-mirror';

// World event envelope mirror (canonical owner: @tradrl/market-protocol)
export type { AssetClass, EventType, EventOrigin, AdapterRef, EventProvenance, WorldEvent } from './event';
export {
  ASSET_CLASSES,
  isAssetClass,
  EVENT_TYPES,
  isEventType,
  EVENT_ORIGINS,
  isEventOrigin,
  isAdapterRef,
  isEventProvenance,
  validateEventProvenance,
  sequenceStream,
  sequenceKeyOf,
  otherEventKind,
  validateWorldEvent,
  isWorldEvent,
  validateWorldEvents,
} from './event';

// World mode + config
export type { WorldMode, StreamSelection, ReplayWorldConfig } from './config';
export {
  isWorldMode,
  isStreamSelection,
  streamSelectionKey,
  validateWorldConfig,
  isReplayWorldConfig,
  canonicalConfigJson,
  configHash,
  worldModeOf,
} from './config';

// World state
export type {
  StreamSequenceState,
  IntentDisposition,
  IntentReceipt,
  IntentRecord,
  WorldRunStatus,
  ReplayWorldState,
} from './state';
export {
  isStreamSequenceState,
  streamSequenceKey,
  isIntentReceipt,
  isIntentRecord,
  isWorldRunStatus,
  initReplayWorld,
  isReplayWorldState,
  serializeReplayWorldState,
  deserializeReplayWorldState,
  replayBaseStateFrom,
  sequenceTrackersOf,
} from './state';

// The pure ReplayTransition protocol
export { ingestWorld, observeWorld, advanceWorld, finishWorld, requireWorldState } from './transition';

// The WorldAdapter (structural Environment implementation)
export type {
  WorldObservation,
  ReplayEpisodeView,
  ReplaySubmission,
  ReplayEpisodeResult,
  ReplayEpisodeFinish,
  WorldAdapter,
} from './adapter';
export {
  observationOf,
  pendingObservations,
  createWorldAdapter,
} from './adapter';

/** Package identity and ownership (Work Order T009). */
export const packageInfo = {
  name: '@tradrl/market-world',
  owner: 'T009',
  status: 'implemented',
} as const;
