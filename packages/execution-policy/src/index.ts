/**
 * @tradrl/execution-policy — the execution-policy contract package
 * (Work Order T019): the hard gate between Strategy and Outcome.
 *
 * Spec anchors — spec/ARCHITECTURE.md Execution, VERBATIM:
 * "Consequential actions require hard controls outside prompts:
 * identity, authorization, limits, venue permissions, rate limits,
 * kill switch, credentials and audit." And spec/ADAPTERS.md Execution,
 * VERBATIM: "Broker, exchange-native API, paper venue and OMS/EMS
 * integrations. Every consequential order passes through internal
 * execution authority/risk gates."
 *
 * Public API:
 *   - Structural primitives — the shared contract vocabulary (branding,
 *     guards, deep-freeze discipline, JSON model, canonical JSON,
 *     stable digests, TimestampMs) and the exact-decimal arithmetic
 *     module mirroring exchange-sim's decimals law.
 *   - Ids — the execution-lane identity spaces (policy, decision, kill
 *     switch, audit record, simulated fill, simulation spec) plus the
 *     opaque cross-lane mirrors (tenant, project, goal, strategy,
 *     instrument, venue, risk-policy, trial/arm/trajectory, seed,
 *     credential, authority scope).
 *   - Strategy mirrors — `StrategyIntentMirror` (THE INPUT RECORD,
 *     field-for-field trading-strategy's shape), the order-intent
 *     mirror (the final request form — domain-core's Order via
 *     exchange-sim), the constraint-proof mirrors and the
 *     portfolio-state mirror.
 *   - Venue mirrors — the exchange-sim config mirrors (FeeSchedule,
 *     LatencyConfig, SlippageConfig, MarketImpactPolicy, the full
 *     VenueModelConfig) with `venueModelDigest` (byte-parity with
 *     exchange-sim's `configHash`), the book-seed mirror, the latency
 *     draw mirror, and the gate's `ExecutionVenueState`.
 *   - The credential-opacity trip wire — `credentialValueViolations`
 *     (embedding a credential VALUE anywhere is the typed
 *     `credential_value_present` error).
 *   - `ExecutionPolicy` — the versioned hard-gate declaration with
 *     MACHINE-ENUMERABLE check totality (the eight dimensions of the
 *     ARCHITECTURE sentence; a policy omitting any is the typed
 *     `check_dimension_missing`).
 *   - `CheckMachine` — `runExecutionGate`: the pure
 *     first-failure-wins gate over (intent, policy, portfolio state,
 *     venue state, standing kill switch) -> ApproveDecision |
 *     RefusalDecision (structured reasons: which check, which limit,
 *     by how much).
 *   - `KillSwitch` — the append-only, chain-verified standing switch
 *     log (thrown is forever in the log; rewriting history is the
 *     typed `killswitch_rewrite`).
 *   - `AuditRecord` / `AuditLog` — every decision emits one audit
 *     record; the trail is append-only and chain-verified.
 *   - `ExecutionSimulationSpec` / `SimulatedFill` — the honest
 *     simulator declaration (paper_venue | simulated_matching — NEVER
 *     live) and the simulated fills carrying their full venue lineage.
 *
 * Zero runtime dependencies; types, schemas and pure functions only.
 * No ambient clock (`Date.now()` never appears) and no ambient
 * randomness (the simulator's draws derive from the spec's seed).
 * Cross-lane shapes are STRUCTURAL MIRRORS (D-003/D-004) — never
 * imports; src/interop.test.ts is the drift trip wire.
 */

// Errors and results
export type { ExecutionPolicyErrorCode, ExecutionPolicyError, ExecutionPolicyResult } from './errors';
export { fail, failures, ok, missingField, invalidField, invalidType } from './errors';

// Structural primitives
export type { Brand, Mutable, JsonValue, JsonObject, TimestampMs } from './primitives';
export {
  isRecord,
  isNonEmptyString,
  isFiniteNumber,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
  isMemberOf,
  isArrayOf,
  deepFreeze,
  isDeeplyFrozen,
  isJsonValue,
  isJsonObject,
  canonicalJson,
  fnv1a32Hex,
  fnv1a32Int,
  stableDigest,
  isDigest,
  MIN_TIMESTAMP_MS,
  MAX_TIMESTAMP_MS,
  isTimestampMs,
} from './primitives';

// Exact decimal arithmetic (exchange-sim decimals law, mirrored)
export type { LimitKind } from './policy';
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
  isNonNegativeDecimalInput,
} from './decimals';

// Ids and opaque cross-lane references
export type {
  ExecutionPolicyId,
  DecisionId,
  KillSwitchId,
  KillSwitchRecordId,
  AuditRecordId,
  SimulatedFillId,
  SimulationSpecId,
  GoalRef,
  ProjectId,
  TenantId,
  StrategySpecId,
  PortfolioStateId,
  ConstraintSetRef,
  InstrumentId,
  VenueId,
  RiskPolicyRef,
  TrialId,
  ArmId,
  TrajectoryId,
  CredentialRef,
  AuthorityScopeRef,
  Seed,
  PolicyVersionRef,
  GoalVersionRef,
  ConstraintSetVersionRef,
  StrategyVersionRef,
} from './ids';
export {
  isExecutionPolicyId,
  isDecisionId,
  isKillSwitchId,
  isKillSwitchRecordId,
  isAuditRecordId,
  isSimulatedFillId,
  isSimulationSpecId,
  isGoalRef,
  isConstraintSetRef,
  isProjectId,
  isTenantId,
  isStrategySpecId,
  isPortfolioStateId,
  isInstrumentId,
  isVenueId,
  isRiskPolicyRef,
  isTrialId,
  isArmId,
  isTrajectoryId,
  isCredentialRef,
  isAuthorityScopeRef,
  isSeed,
  isPolicyVersionRef,
  isGoalVersionRef,
  isConstraintSetVersionRef,
  isStrategyVersionRef,
  mintExecutionPolicyId,
  mintDecisionId,
  mintKillSwitchId,
  mintKillSwitchRecordId,
  mintAuditRecordId,
  mintSimulatedFillId,
  mintSimulationSpecId,
} from './ids';

// The strategy-lane mirrors (the input record)
export type {
  OrderSide,
  CoreOrderKind,
  OrderKind,
  CoreTimeInForce,
  TimeInForce,
  DecimalString,
  Timestamp,
  OrderIntentMirror,
  CriterionValueMirror,
  CriterionPredicateMirror,
  ConstraintDomainMirror,
  ConstraintSeverityMirror,
  ConstraintCheckStatusMirror,
  ConstraintCheckMirror,
  SatisfiedPredicateProofMirror,
  ConstraintProofMirror,
  IntentReasonKind,
  IntentRationaleMirror,
  StrategyIntentMirror,
  StrategyLineageMirror,
  MarkSourceMirror,
  PositionRecordMirror,
  PortfolioWeightMirror,
  PortfolioStateMirror,
} from './strategy-mirror';
export {
  ORDER_SIDES,
  CORE_ORDER_KINDS,
  CORE_TIME_IN_FORCE,
  isTimestamp,
  isDecimalString,
  isPositiveDecimalString,
  isOrderSide,
  isCoreOrderKind,
  isOrderKind,
  isCoreTimeInForce,
  isTimeInForce,
  isOrderIntentMirror,
  isCriterionValueMirror,
  isCriterionPredicateMirror,
  CRITERION_PREDICATE_KINDS_MIRROR,
  CONSTRAINT_DOMAINS_MIRROR,
  CONSTRAINT_SEVERITIES_MIRROR,
  CONSTRAINT_CHECK_STATUSES_MIRROR,
  isConstraintDomainMirror,
  isConstraintSeverityMirror,
  isConstraintCheckStatusMirror,
  isConstraintCheckMirror,
  isSatisfiedPredicateProofMirror,
  isConstraintProofMirror,
  INTENT_REASON_KINDS,
  isIntentRationaleMirror,
  INTENT_AUTHORITY_EMBEDDING_KEYS,
  intentAuthorityViolations,
  isStrategyIntentMirror,
  isStrategyLineageMirror,
  isPositionRecordMirror,
  isPortfolioWeightMirror,
  isPortfolioStateMirror,
  isSignedCanonicalDecimal,
} from './strategy-mirror';

// The exchange-lane mirrors (the venue-side physics)
export type {
  FeeRole,
  FeeTierMirror,
  FeeScheduleMirror,
  LatencyConfigMirror,
  SlippageConfigMirror,
  MarketImpactPolicyMirror,
  ExchangeFidelityMirror,
  VenueModelConfigMirror,
  BookLevelMirror,
  BookSnapshotSeedMirror,
  VenueInstrumentState,
  ExecutionVenueState,
} from './venue-mirror';
export {
  isFeeRole,
  isFeeTierMirror,
  isFeeScheduleMirror,
  validateFeeScheduleMirror,
  isLatencyConfigMirror,
  latencyDelayMsMirror,
  isSlippageConfigMirror,
  isMarketImpactPolicyMirror,
  ENGINE_IMPACT_KINDS_MIRROR,
  EXCHANGE_FIDELITY_MODES_MIRROR,
  isExchangeFidelityMirror,
  isVenueModelConfigMirror,
  validateVenueModelConfig,
  venueModelJson,
  venueModelDigest,
  isBookLevelMirror,
  isBookSnapshotSeedMirror,
  isVenueInstrumentState,
  isExecutionVenueState,
  ASSET_CLASSES_MIRROR,
  isAssetClassMirror,
} from './venue-mirror';

// The credential-opacity trip wire
export { CREDENTIAL_VALUE_KEYS, isCredentialValueKey, credentialValueViolations } from './credentials';

// The execution policy (the hard-gate declaration)
export type {
  CheckDimension,
  PreTradeCheckKind,
  IdentityRequirement,
  AuthorityGrant,
  LimitRecord,
  VenuePermission,
  RateBudget,
  CredentialBinding,
  AuditDeclaration,
  KillSwitchBinding,
  PolicyLearningLineage,
  ExecutionPolicy,
} from './policy';
export {
  CHECK_DIMENSIONS,
  PRE_TRADE_CHECK_KINDS,
  DEFAULT_CHECK_ORDER,
  isCheckDimension,
  isPreTradeCheckKind,
  isIdentityRequirement,
  isAuthorityGrant,
  LIMIT_KINDS,
  isLimitKind,
  isLimitRecord,
  isVenuePermission,
  isRateBudget,
  isCredentialBinding,
  isAuditDeclaration,
  isKillSwitchBinding,
  isPolicyLearningLineage,
  isExecutionPolicy,
  policyContentTree,
  policyContentDigest,
  validateExecutionPolicy,
  canonicalPolicyJson,
  describePolicyCoverage,
} from './policy';

// The kill switch (append-only, chain-verified)
export type { KillSwitchState, KillSwitchRecord, KillSwitchLog } from './kill-switch';
export {
  KILL_SWITCH_STATES,
  isKillSwitchState,
  isKillSwitchRecord,
  isKillSwitchLog,
  startKillSwitch,
  throwKillSwitch,
  restoreKillSwitch,
  killSwitchState,
  currentThrowEvidence,
  verifyKillSwitchChain,
  validateKillSwitchLog,
} from './kill-switch';

// The check machine (the pure gate)
export type {
  RefusalReason,
  CheckResult,
  CheckFailure,
  ApproveDecision,
  RefusalDecision,
  ExecutionDecision,
  ExecutionLineage,
  ExecutionGateInput,
} from './check-machine';
export {
  isRefusalReason,
  isCheckResult,
  isCheckFailure,
  isApproveDecision,
  isRefusalDecision,
  isExecutionDecision,
  isExecutionLineage,
  isExecutionGateInput,
  runExecutionGate,
  describeDecision,
} from './check-machine';

// The audit trail (append-only, chain-verified)
export type { AuditRecord, AuditLog } from './audit';
export {
  isAuditRecord,
  isAuditLog,
  startAuditLog,
  auditRecordOf,
  appendDecision,
  appendAuditRecord,
  verifyAuditChain,
  validateAuditLog,
} from './audit';

// The simulation spec and the simulated fills (honest by construction)
export type {
  SimulationFidelity,
  VenueModelRef,
  ExecutionSimulationSpec,
  SimulatedFillVenueLineage,
  SimulatedFill,
} from './simulation';
export {
  SIMULATION_FIDELITY_MODES,
  isSimulationFidelity,
  SIMULATION_FIDELITY,
  isVenueModelRef,
  isExecutionSimulationSpec,
  simulationSpecContentTree,
  validateExecutionSimulationSpec,
  isSimulatedFillVenueLineage,
  isSimulatedFill,
  validateSimulatedFill,
  canonicalSimulationSpecJson,
} from './simulation';

/** Package identity and ownership (governance surface). */
export const packageInfo = {
  name: '@tradrl/execution-policy',
  owner: 'T019',
  status: 'implemented',
  concepts: [
    'ExecutionPolicy',
    'runExecutionGate',
    'CHECK_DIMENSIONS',
    'KillSwitchLog',
    'AuditRecord',
    'ExecutionSimulationSpec',
    'SimulatedFill',
    'credentialValueViolations',
  ],
} as const;
