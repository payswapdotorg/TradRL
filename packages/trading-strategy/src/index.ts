/**
 * @tradrl/trading-strategy — the portfolio strategy domain contracts
 * (T018).
 *
 * Public API:
 *   - Structural primitives — the shared contract vocabulary (branding,
 *     guards, deep-freeze discipline, JSON model, canonical JSON, stable
 *     digests, seeded draws) and the `TimestampMs` mirror of the control
 *     plane, plus the exact-decimal arithmetic module mirroring
 *     exchange-sim's decimals law.
 *   - Ids — the strategy-lane identity spaces (`StrategySpecId`,
 *     `StrategyRunId`, `PortfolioStateId`, `BacktestRunId`,
 *     `BacktestCandidateId`) plus the opaque cross-lane mirrors (goal,
 *     constraint-set, project, tenant, organization, instrument, venue,
 *     risk-policy, attainment-evidence, trial/arm/trajectory, seed).
 *   - Authority trip wire — the L8 scan (authority-embedding keys and
 *     authority verbs; `authority_in_strategy` is the typed crime).
 *   - Control mirrors — `GoalStatementMirror` /
 *     `ConstraintSetStatementMirror` (the compile inputs) + the
 *     constraint GATE (domain-core's engine semantics, mirrored).
 *   - Market mirrors — the MarketEvent envelope mirrors (trade/quote)
 *     + the L4-bounded `ObservationWindow` + deterministic mark
 *     derivation.
 *   - Exchange mirrors — the OrderIntent mirror (field-for-field the
 *     exchange-sim shape), the `AccountFill` and `CorporateAction`
 *     transition inputs.
 *   - Spec — `StrategySpec` (universe, allocation policy, rebalancing
 *     policy, price discipline, risk-policy refs, seeded-generator
 *     declarations, organization binding) with the universe/authority
 *     laws.
 *   - Portfolio — `PortfolioState` (positions, weights, cash, the
 *     signed realized/unrealized split, lineage), the PURE transition
 *     `applyPortfolioEvents` (exact decimals; typed on the unsigned
 *     domain) and the append-only, chain-verified transition log.
 *   - Intent — `StrategyIntent` (order mirror + satisfied-predicate
 *     proof + full lineage + structured rationale) and the typed
 *     `IntentRefusal` (a RECORD naming the violated predicate, never an
 *     exception).
 *   - Run — `compileStrategyRun`: (spec, state, window, constraint
 *     set, goal, seed) -> intents + refusals + lineage; pure,
 *     deterministic; the constraint gate runs BEFORE intent emission.
 *   - Backtest — the append-only `BacktestRecord` trail (L11) with
 *     per-criterion attainment evidence bindings (the evaluation lane's
 *     `CriterionBinding` mirror + opaque evidence ref) and structured
 *     disposition reasons.
 *
 * Zero runtime dependencies; types, guards and pure functions only. No
 * ambient clock (`Date.now()` never appears) and no ambient randomness
 * — the same (spec, observation window, constraint set, portfolio
 * state, seed) always yields a byte-identical intent sequence.
 * Cross-lane shapes are STRUCTURAL MIRRORS (D-003/D-004) — never
 * imports; src/interop.test.ts is the drift trip wire.
 */

// Errors and results
export type { StrategyErrorCode, StrategyError, StrategyResult } from './errors';
export { fail, failures, ok, missingField, invalidField, invalidType } from './errors';

// Structural primitives
export type { Brand, Mutable, JsonValue, JsonObject, TimestampMs } from './primitives';
export {
  isRecord,
  isNonEmptyString,
  isFiniteNumber,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
  isNonNegativeInteger,
  isPositiveInteger,
  isUnitInterval,
  isMemberOf,
  isArrayOf,
  isIdentifierPath,
  deepFreeze,
  isDeeplyFrozen,
  isJsonValue,
  isJsonObject,
  canonicalJson,
  fnv1a32Hex,
  stableDigest,
  stableDigestJson,
  isDigest,
  MIN_TIMESTAMP_MS,
  MAX_TIMESTAMP_MS,
  isTimestampMs,
  isoFromEpochMs,
  createSeededRandom,
  seededDraw,
} from './primitives';

// Exact decimal arithmetic (exchange-sim decimals law, mirrored)
export {
  isUnsignedDecimal,
  isCanonicalDecimal,
  isCanonicalPositiveDecimal,
  isPositiveDecimal,
  isEqual,
  compare,
  isZero,
  add,
  subtract,
  multiply,
  normalize,
  roundHalfUp,
  divideRoundHalfUp,
  isAlignedToGrid,
  floorToGrid,
  ceilToGrid,
  isDecimalStringInput,
} from './decimals';

// Ids and opaque cross-lane references
export type {
  StrategySpecId,
  StrategyRunId,
  PortfolioStateId,
  BacktestRunId,
  BacktestCandidateId,
  GoalRef,
  ConstraintSetRef,
  ProjectId,
  TenantId,
  OrganizationRef,
  BlueprintAssignmentRef,
  InstrumentId,
  VenueId,
  RiskPolicyRef,
  AttainmentEvidenceRef,
  TrialId,
  ArmId,
  TrajectoryId,
  Seed,
  StrategyVersionRef,
  GoalVersionRef,
  ConstraintSetVersionRef,
} from './ids';
export {
  isStrategySpecId,
  isStrategyRunId,
  isPortfolioStateId,
  isBacktestRunId,
  isBacktestCandidateId,
  isGoalRef,
  isConstraintSetRef,
  isProjectId,
  isTenantId,
  isOrganizationRef,
  isBlueprintAssignmentRef,
  isInstrumentId,
  isVenueId,
  isRiskPolicyRef,
  isAttainmentEvidenceRef,
  isTrialId,
  isArmId,
  isTrajectoryId,
  isSeed,
  isStrategyVersionRef,
  isGoalVersionRef,
  isConstraintSetVersionRef,
  mintStrategyRunId,
  mintPortfolioStateId,
  mintBacktestRunId,
  mintBacktestCandidateId,
} from './ids';

// The L8 authority trip wire
export type { AuthorityEmbeddingKey } from './authority';
export {
  AUTHORITY_EMBEDDING_KEYS,
  isAuthorityEmbeddingKey,
  authorityKeyPaths,
  AUTHORITY_VERBS,
  isAuthorityVerb,
  authorityVerbPaths,
  authorityViolations,
} from './authority';

// Control-plane mirrors + the constraint gate
export type {
  CriterionValueMirror,
  CriterionPredicateMirror,
  SuccessCriterionMirror,
  GoalSuccessCriteriaMirror,
  GoalHorizonMirror,
  GoalEvaluationPolicyMirror,
  GoalStatementMirror,
  ConstraintDomainMirror,
  ConstraintSeverityMirror,
  ConstraintStatementMirror,
  ConstraintSetStatementMirror,
  ConstraintCheckStatusMirror,
  ConstraintContextMirror,
  ConstraintCheckMirror,
  ConstraintGateReport,
} from './control-mirror';
export {
  CRITERION_PREDICATE_KINDS_MIRROR,
  isCriterionValueMirror,
  isCriterionPredicateMirror,
  evaluateCriterionPredicateMirror,
  isSuccessCriterionMirror,
  isGoalSuccessCriteriaMirror,
  isGoalHorizonMirror,
  isGoalEvaluationPolicyMirror,
  isGoalStatementMirror,
  CONSTRAINT_DOMAINS_MIRROR,
  isConstraintDomainMirror,
  CONSTRAINT_SEVERITIES_MIRROR,
  isConstraintSeverityMirror,
  isConstraintStatementMirror,
  isConstraintSetStatementMirror,
  isConstraintContextMirror,
  isConstraintCheckMirror,
  runConstraintGate,
} from './control-mirror';

// Market observation mirrors + the window
export type {
  EventOriginMirror,
  AdapterRefMirror,
  ProvenanceMirror,
  TradeSideMirror,
  TradePayloadMirror,
  QuotePayloadMirror,
  AssetClassMirror,
  StrategyEventTypeMirror,
  MarketEventMirror,
  ObservationWindow,
  MarkSource,
} from './market-mirror';
export {
  EVENT_ORIGINS_MIRROR,
  ASSET_CLASSES_MIRROR,
  STRATEGY_EVENT_TYPES_MIRROR,
  isEventOriginMirror,
  isAssetClassMirror,
  isAdapterRefMirror,
  isProvenanceMirror,
  isTradePayloadMirror,
  isQuotePayloadMirror,
  isMarketEventMirror,
  isObservationWindow,
  markPriceOf,
  markPricesOf,
  windowObservesInstrument,
  countEventsByType,
  isLockedQuote,
} from './market-mirror';

// Exchange mirrors (order intent, account fill, corporate actions)
export type {
  OrderSide,
  CoreOrderKind,
  OrderKind,
  CoreTimeInForce,
  TimeInForce,
  DecimalString,
  Timestamp as OrderTimestamp,
  OrderIntentMirror,
  AccountSide,
  AccountFill,
  CorporateActionKind,
  CorporateAction,
} from './exchange-mirror';
export {
  ORDER_SIDES,
  CORE_ORDER_KINDS,
  CORE_TIME_IN_FORCE,
  isOrderSide,
  isCoreOrderKind,
  isOrderKind,
  isCoreTimeInForce,
  isTimeInForce,
  isTimestamp,
  isDecimalString,
  isPositiveDecimalString,
  isoTimestampOf,
  isOrderIntentMirror,
  ACCOUNT_SIDES,
  isAccountFill,
  CORPORATE_ACTION_KINDS,
  isCorporateAction,
} from './exchange-mirror';

// The strategy spec
export type {
  UniverseEntry,
  AllocationPolicy,
  RebalanceTrigger,
  RebalancingPolicy,
  PriceAnchor,
  PriceDiscipline,
  GeneratorAlgorithm,
  SeedGeneratorDeclaration,
  OrganizationBinding,
  StrategySpec,
} from './spec';
export {
  ALLOCATION_POLICY_KINDS,
  isAllocationPolicy,
  REBALANCE_TRIGGERS,
  isRebalancingPolicy,
  PRICE_ANCHORS,
  PRICE_DISCIPLINE_KINDS,
  isPriceDiscipline,
  GENERATOR_ALGORITHMS,
  isSeedGeneratorDeclaration,
  isOrganizationBinding,
  isUniverseEntry,
  isStrategySpec,
  validateStrategySpec,
  specIdentity,
  targetWeights,
} from './spec';

// The portfolio state, transition and log
export type {
  StrategyLineage,
  PositionRecord,
  PortfolioWeight,
  PortfolioState,
  PortfolioEventBatch,
  PortfolioTransition,
  PortfolioTransitionLog,
} from './portfolio';
export {
  isSignedCanonicalDecimal,
  isNonNegativeDecimalInput,
  isStrategyLineage,
  isPositionRecord,
  isPortfolioWeight,
  isPortfolioState,
  portfolioStateTree,
  portfolioStateDigest,
  initialPortfolioState,
  computeWeights,
  isPortfolioEventBatch,
  applyPortfolioEvents,
  isPortfolioTransition,
  portfolioTransitionTree,
  isPortfolioTransitionLog,
  startTransitionLog,
  appendTransition,
  lineageEquals,
  verifyTransitionChain,
  validatePortfolioState,
} from './portfolio';

// The strategy intent and the typed refusal
export type {
  SatisfiedPredicateProof,
  ConstraintProof,
  IntentReasonKind,
  IntentRationale,
  StrategyIntent,
  RefusalCause,
  ViolatedPredicate,
  IntentRefusal,
} from './intent';
export {
  isSatisfiedPredicateProof,
  isConstraintProof,
  INTENT_REASON_KINDS,
  isIntentRationale,
  isStrategyIntent,
  REFUSAL_CAUSES,
  isViolatedPredicate,
  isIntentRefusal,
  validateStrategyIntent,
  validateIntentRefusal,
} from './intent';

// The compiled run
export type { StrategyRun, StrategyRunInput } from './run';
export { isStrategyRun, compileStrategyRun, validateStrategyRun, runsEqual } from './run';

// The backtest trail
export type {
  AttainmentEvidence,
  CandidateDisposition,
  DispositionReason,
  LearningLineage,
  BacktestCandidate,
  BacktestRecord,
} from './backtest';
export {
  isAttainmentEvidence,
  CANDIDATE_DISPOSITIONS,
  DISPOSITION_REASON_KINDS,
  isDispositionReason,
  isLearningLineage,
  isBacktestCandidate,
  isBacktestRecord,
  backtestRunIdOf,
  startBacktestRecord,
  appendBacktestCandidate,
  validateBacktestCandidate,
  validateBacktestRecord,
} from './backtest';

/** Package identity and ownership (governance surface). */
export const packageInfo = {
  name: '@tradrl/trading-strategy',
  owner: 'T018',
  status: 'implemented',
  concepts: [
    'StrategySpec',
    'PortfolioState',
    'applyPortfolioEvents',
    'StrategyIntent',
    'IntentRefusal',
    'compileStrategyRun',
    'BacktestRecord',
    'runConstraintGate',
    'authorityViolations',
  ],
} as const;
