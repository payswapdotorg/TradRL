/**
 * @tradrl/market-world (exchange service) — the reference implementation
 * of the exchange/order-book simulation driver (Work Order T010).
 *
 * Public API (this subtree, `services/market-world/src/exchange/` — the
 * reference market-world service's replay/ subtree is T009's, untouched):
 *   - `createExchangeService` — build a service over an exchange config
 *     and a book seed; the service exposes the five-operation
 *     Environment surface (start/observe/submit/advance/finish — T005
 *     shapes, structurally mirrored in env-mirror.ts).
 *   - `ExchangeService` / `ExchangeEpisodeView` / `ExchangeSubmission` /
 *     `ExchangeEpisodeFinish` — the episode protocol products.
 *   - `SessionRecord` — the L9 lineage record (config hash, order/fill
 *     log, outcome stream hash, clock timeline, digest).
 *   - `ExchangeEvent` + constructors — the market-protocol envelope
 *     mirror every emitted outcome rides (trade/quote/other events).
 *   - Fixtures — the scripted order-flow + book-seed scenario that
 *     replays byte-identically (two runs -> identical hashes).
 *   - env-mirror — the T005 episode-shape mirrors (self-contained; the
 *     T009 contract package is not on this branch's base).
 *
 * See README.md for how T027 (reactive world), T013 (RL bridge) and T019
 * (execution policy) consume this engine.
 */

// The episode mirrors (T005 shapes)
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
  ObservationMirror,
  ActionMirror,
  RewardSignalMirror,
  EpisodeStatus,
  EpisodeStateMirror,
  EpisodeResultMirror,
  EpisodeFinishMirror,
  JsonValue,
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
  canonicalJson,
  canonicalSpecJson,
  deriveEpisodeId,
  fnv1a32Hex,
  isObservationMirror,
  isActionMirror,
  isJsonValue,
  isEpisodeStateMirror,
} from './env-mirror';

// The event envelope mirror (market-protocol MarketEvent shapes)
export type { AssetClass, EventType, EventOrigin, AdapterRef, EventProvenance, ExchangeEvent, ExchangeOtherKind, EventEnvelopeContext } from './event';
export {
  ASSET_CLASSES,
  CANONICAL_EVENT_TYPES,
  EVENT_ORIGINS,
  EXCHANGE_SIM_COMPONENT,
  EXCHANGE_OTHER_KINDS,
  isAssetClass,
  isEventType,
  isEventOrigin,
  sequenceStream,
  sequenceKeyOf,
  otherEventKind,
  validateExchangeEvent,
  isExchangeEvent,
  tradeEventOf,
  quoteEventOf,
  orderAckEventOf,
  orderRejectEventOf,
  orderCancelEventOf,
  orderExpiredEventOf,
} from './event';

// The service + the session record (L9 lineage)
export type {
  ExchangeActionPayload,
  ExchangeObservation,
  ExchangeEpisodeView,
  ExchangeSubmission,
  ExchangeReceipt,
  ExchangeEpisodeFinish,
  ExchangeEpisodeResult,
  ClockAdvance,
  OrderLogEntry,
  SessionRecord,
  ExchangeService,
} from './session';
export { createExchangeService } from './session';

// Deterministic fixtures (scripted order-flow + book-seed scenario)
export type { ExchangeFixtureOptions, FixtureStep, ExchangeFixtureRun } from './fixtures';
export {
  fixtureExchangeConfig,
  fixtureBookSeed,
  fixtureSpec,
  fixtureScript,
  runExchangeFixture,
} from './fixtures';

/** Package identity and ownership (Work Order T010). */
export const packageInfo = {
  name: '@tradrl/market-world/exchange',
  owner: 'T010',
  status: 'implemented',
} as const;
