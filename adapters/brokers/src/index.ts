/**
 * @tradrl/adapter-brokers — the FIX-style broker gateway adapter.
 *
 * The broker/OMS lane's first package over the provider-neutral SDK
 * contracts (T036; spec/ADAPTERS.md: "External systems are substrates.
 * Canonical domain contracts remain provider-neutral" — and its
 * Execution section, VERBATIM: "Broker, exchange-native API, paper venue
 * and OMS/EMS integrations. Every consequential order passes through
 * internal execution authority/risk gates."). Public API:
 *
 *   - `BROKER_SOURCE_DESCRIPTOR` — the declared capability card
 *     (provider "fix-broker-gateway", the SDK's execution category,
 *     the documented order-entry/report channels, canonical event type
 *     `other`, realtime latency class, crypto spot universes).
 *   - Documented raw message SCHEMAS (./schemas.ts) — hand-rolled guards
 *     over the public FIX-dictionary field names for NewOrderSingle and
 *     ExecutionReport; unknown fields are typed MappingErrors (never
 *     silently dropped); the guard derives the canonical escape-hatch
 *     form with CANONICAL vocabulary keys only.
 *   - `BROKER_MAPPING_TABLES` — the derived `data` -> canonical `data`
 *     mapping with the declared source-time policy (documented
 *     TransactTime -> epoch milliseconds; availability at receive time,
 *     clamped).
 *   - `createBrokerAdapterSession` — the SDK lifecycle
 *     (open/subscribe/nextEvent/onEvent/pump/close) over an INJECTED
 *     transport port, with the provider guard pipeline (documented schema
 *     validation, CumQty/ExecID sequencing, canonical derivation) — PLUS
 *     `routeOrder`, the L8-gated order-routing call path (below).
 *   - `buildBrokerNewOrderSingle` (./routing.ts) — THE ORDER ROUTING
 *     TRANSLATION: an APPROVED decision (T019 mirror, validated) + the
 *     gated order intent + the injected kill-switch standing state ->
 *     the documented NewOrderSingle message. L8 ABSOLUTE: the adapter
 *     NEVER executes authority — it TRANSLATES approved decisions; a
 *     routing call path without a valid APPROVED decision record is a
 *     typed error (there is no code path around the check). Credential
 *     VALUES never appear — opaque 'cred:' refs only (T019's law,
 *     enforced by the mirrored opacity trip-wire over the whole routing
 *     bundle).
 *   - `BROKER_ENTITLEMENT` — the restricted execution-data declaration;
 *     every emitted record carries the entitlement ref, and emission
 *     without the declaration is a typed EntitlementError.
 *   - `BROKER_RATE_QUOTA` / `BROKER_RATE_QUOTA_SET` /
 *     `enforceBrokerRateQuota` — the documented session limits as
 *     declarative envelopes; enforcement is this adapter's duty.
 *   - `BROKER_HEALTH_THRESHOLDS` — the declared liveness envelope.
 *   - Deterministic time conversion (./time.ts) — the documented
 *     UTCTimestamp and RFC 3339 forms, hand-rolled (no Date.parse),
 *     truncated to milliseconds.
 *   - The full contract mirror (./contract) — the SDK's exported shapes,
 *     re-declared and implemented here (law D-004: structural mirrors,
 *     never imports), drift-checked against the real
 *     @tradrl/provider-sdk and @tradrl/market-protocol in the interop
 *     test (which also drives the REAL SDK's adapter contract suite
 *     against this adapter's session, and the REAL T019 gate's APPROVE
 *     decisions through this adapter's routing path).
 *
 * LAWS HELD (violations = rejection):
 *   - ZERO runtime dependencies; no `any`; total hand-rolled guards.
 *   - NO NETWORK: the transport is an injected port; all tests run over
 *     scripted fakes. No secrets, no API keys, no account-specific data
 *     (every fixture value is synthetic).
 *   - NO IMPORTS of @tradrl/provider-sdk or any other package in the
 *     sources (cross-package imports happen ONLY in tests, via relative
 *     paths — the repo's established pattern).
 *   - deepFreeze everything public; no ambient clock; byte-determinism.
 *   - L2 (inverse): every broker-gateway name and semantic lives ONLY in
 *     this package's provider layer; the emitted canonical events are
 *     provider-neutral market-protocol shapes (trip-wired).
 *   - L4 quartet honesty, L8 approved-decision/kill-switch/credential
 *     discipline, L9 lineage, entitlement declaration, rate quota
 *     enforcement — all typed, deterministic, tested.
 */

// The provider-neutral contract layer (the SDK's exported shapes, mirrored).
export * from './contract';

// The provider-namespace protocol error extension.
export type { BrokerProtocolErrorCode } from './protocol';
export {
  BROKER_PROTOCOL_CODES,
  brokerProtocolError,
  brokerProtocolCodeOf,
  isBrokerProtocolError,
} from './protocol';

// The declared source descriptor and identity.
export {
  BROKER_PROVIDER_ID,
  BROKER_VENUE,
  BROKER_ADAPTER,
  BROKER_CHANNELS,
  BROKER_EVENT_TYPES,
  BROKER_SYMBOL_UNIVERSES,
  BROKER_SOURCE_DESCRIPTOR,
} from './descriptor';

// The execution-lane structural mirrors (T019 — the L8 input records).
export type {
  OrderSide,
  OrderKind,
  CoreOrderKind,
  TimeInForce,
  CoreTimeInForce,
  OrderIntentMirror,
  PolicyVersionRefMirror,
  ExecutionLineageMirror,
  CheckResultMirror,
  ApprovedDecisionMirror,
  RefusalDecisionMirror,
  ExecutionDecisionMirror,
  KillSwitchStateMirror,
  KillSwitchStandingState,
} from './decision-mirror';
export {
  ORDER_SIDES,
  CORE_ORDER_KINDS,
  CORE_TIME_IN_FORCE,
  isOrderSide,
  isCoreOrderKind,
  isOrderKind,
  isCoreTimeInForce,
  isTimeInForce,
  isCanonicalDecimal,
  isCanonicalPositiveDecimal,
  isTimestampMirror,
  isOrderIntentMirror,
  isPolicyVersionRefMirror,
  isExecutionLineageMirror,
  PRE_TRADE_CHECK_KINDS,
  isPreTradeCheckKind,
  isCheckResultMirror,
  isDecisionId,
  isApprovedDecisionMirror,
  isRefusalDecisionMirror,
  isExecutionDecisionMirror,
  KILL_SWITCH_STATES,
  isKillSwitchStateMirror,
  isKillSwitchStandingState,
  CREDENTIAL_VALUE_KEYS,
  isCredentialValueKey,
  credentialValueViolations,
  isCredentialRef,
} from './decision-mirror';

// Deterministic documented time conversion.
export { fixUtcTimestampToMs, rfc3339ToMs, msToFixUtcTimestamp } from './time';

// The documented raw payload schemas (guard + derivation + code domains).
export {
  BROKER_RAW_FIELD_NAMES,
  CANONICAL_ORDER_STATUSES,
  ORD_TYPE_MAP,
  TIME_IN_FORCE_MAP,
  guardExecutionReportPayload,
  guardNewOrderSinglePayload,
  deriveExecutionReportPayload,
  isNormalizedExecutionReport,
} from './schemas';
export type { NormalizedExecutionReport, NormalizedNewOrderSingle } from './schemas';

// The declared mapping tables.
export {
  BROKER_CHANNEL_TABLE_IDS,
  BROKER_EXECUTION_REPORT_TABLE,
  BROKER_MAPPING_TABLES,
} from './mapping-tables';

// The declared entitlement.
export { BROKER_ENTITLEMENT } from './entitlement';

// The declarative rate quotas + enforcement.
export {
  BROKER_RATE_QUOTA,
  BROKER_RATE_QUOTA_SET,
  enforceBrokerRateQuota,
} from './rate-quota';

// The declared health thresholds.
export { BROKER_HEALTH_THRESHOLDS } from './health';

// The documented subscription request construction.
export type { BrokerChannel } from './requests';
export {
  brokerReportSubject,
  brokerSubscribeRequest,
  brokerExecutionReportSubscription,
} from './requests';

// The L8 order-routing translation.
export type { BrokerOrderRouting } from './routing';
export { BROKER_ORDER_CHANNEL, buildBrokerNewOrderSingle } from './routing';

// The guard transport (the provider inbound pipeline).
export type { BrokerGuardTransport, BrokerOrderSequencing } from './guard-transport';
export { createBrokerGuardTransport } from './guard-transport';

// The adapter session.
export type { BrokerSessionConfig, BrokerAdapterSession, BrokerSessionConstruction } from './session';
export {
  createBrokerAdapterSession,
  createBrokerSessionWithoutEntitlement,
} from './session';

/** Package identity and ownership (Work Order T039). */
export const packageInfo = {
  name: '@tradrl/adapter-brokers',
  owner: 'T039',
  status: 'implemented',
} as const;
