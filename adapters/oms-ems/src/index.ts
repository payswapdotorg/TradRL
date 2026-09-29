/**
 * @tradrl/adapter-oms-ems — the headless OMS/EMS gateway adapter.
 *
 * The broker/OMS lane's second package over the provider-neutral SDK
 * contracts (T036; spec/ADAPTERS.md: "External systems are substrates.
 * Canonical domain contracts remain provider-neutral" — and its
 * Execution section, VERBATIM: "Broker, exchange-native API, paper venue
 * and OMS/EMS integrations. Every consequential order passes through
 * internal execution authority/risk gates."). Public API:
 *
 *   - `OMS_EMS_SOURCE_DESCRIPTOR` — the declared capability card
 *     (provider "oms-ems-gateway", the SDK's execution category, the
 *     documented routing-instruction/order-state channels, canonical
 *     event type `other`, realtime latency class, crypto spot
 *     universes).
 *   - Documented raw message SCHEMAS (./schemas.ts) — hand-rolled guards
 *     over the public camelCase JSON API field names for ROUTE_ORDER and
 *     ORDER_STATE; unknown fields are typed MappingErrors (never
 *     silently dropped); the guard derives the canonical escape-hatch
 *     form with CANONICAL vocabulary keys only.
 *   - `OMS_EMS_MAPPING_TABLES` — the derived `data` -> canonical `data`
 *     mapping with the declared source-time policy (documented updatedAt
 *     -> epoch milliseconds; availability at receive time, clamped).
 *   - `createOmsEmsAdapterSession` — the SDK lifecycle
 *     (open/subscribe/nextEvent/onEvent/pump/close) over an INJECTED
 *     transport port, with the provider guard pipeline (documented schema
 *     validation, per-order state sequencing, canonical derivation) —
 *     PLUS `routeOrder`, the L8-gated order-routing call path (below).
 *   - `buildOmsEmsRoutingInstruction` (./routing.ts) — THE ORDER ROUTING
 *     TRANSLATION: an APPROVED decision (T019 mirror, validated) + the
 *     gated order intent + the opaque routing target + the injected
 *     kill-switch standing state -> the documented ROUTE_ORDER
 *     instruction. L8 ABSOLUTE: the adapter NEVER executes authority —
 *     it TRANSLATES approved decisions; a routing call path without a
 *     valid APPROVED decision record is a typed error (there is no code
 *     path around the check). Credential VALUES never appear — opaque
 *     'cred:' refs only (T019's law, enforced by the mirrored opacity
 *     trip-wire over the whole routing bundle).
 *   - `reconcileOrderState` (./reconcile.ts) — THE OMS STATE
 *     RECONCILIATION: the OMS's order-state record vs the broker lane's
 *     execution reports, under five exact-arithmetic laws (report
 *     sequence, cumulative progression, open quantity, volume-weighted
 *     average price, state agreement) — every mismatch is a typed
 *     protocol error naming the disagreement; the success is a
 *     deep-frozen agreement record.
 *   - `OMS_EMS_ENTITLEMENT` — the restricted order-state declaration;
 *     every emitted record carries the entitlement ref, and emission
 *     without the declaration is a typed EntitlementError.
 *   - `OMS_EMS_RATE_QUOTA` / `OMS_EMS_RATE_QUOTA_SET` /
 *     `enforceOmsEmsRateQuota` — the documented session limits as
 *     declarative envelopes; enforcement is this adapter's duty.
 *   - `OMS_EMS_HEALTH_THRESHOLDS` — the declared liveness envelope.
 *   - Deterministic time conversion (./time.ts) — the documented
 *     ISO-8601 UTC and RFC 3339 forms, hand-rolled (no Date.parse),
 *     truncated to milliseconds.
 *   - The full contract mirror (./contract) — the SDK's exported shapes,
 *     re-declared and implemented here (law D-004: structural mirrors,
 *     never imports), drift-checked against the real
 *     @tradrl/provider-sdk and @tradrl/market-protocol in the interop
 *     test (which also drives the REAL SDK's adapter contract suite
 *     against this adapter's session, the REAL T019 gate's APPROVE
 *     decisions through this adapter's routing path, and the sibling
 *     broker adapter's emitted reports through this adapter's
 *     reconciliation — the cross-adapter flow, all in canonical shapes).
 *
 * LAWS HELD (violations = rejection):
 *   - ZERO runtime dependencies; no `any`; total hand-rolled guards.
 *   - NO NETWORK: the transport is an injected port; all tests run over
 *     scripted fakes. No secrets, no API keys, no tenant-specific data
 *     (every fixture value is synthetic).
 *   - NO IMPORTS of @tradrl/provider-sdk or any other package in the
 *     sources (cross-package imports happen ONLY in tests, via relative
 *     paths — the repo's established pattern).
 *   - deepFreeze everything public; no ambient clock; byte-determinism.
 *   - L2 (inverse): every OMS/EMS name and semantic lives ONLY in this
 *     package's provider layer; the emitted canonical events are
 *     provider-neutral market-protocol shapes (trip-wired).
 *   - L4 quartet honesty, L8 approved-decision/kill-switch/credential
 *     discipline, L9 lineage, entitlement declaration, rate quota
 *     enforcement, exact-decimal reconciliation — all typed,
 *     deterministic, tested.
 */

// The provider-neutral contract layer (the SDK's exported shapes, mirrored).
export * from './contract';

// The provider-namespace protocol error extension.
export type { OmsEmsProtocolErrorCode } from './protocol';
export {
  OMS_EMS_PROTOCOL_CODES,
  omsEmsProtocolError,
  omsEmsProtocolCodeOf,
  isOmsEmsProtocolError,
} from './protocol';

// The declared source descriptor and identity.
export {
  OMS_EMS_PROVIDER_ID,
  OMS_EMS_VENUE,
  OMS_EMS_ADAPTER,
  OMS_EMS_CHANNELS,
  OMS_EMS_EVENT_TYPES,
  OMS_EMS_SYMBOL_UNIVERSES,
  OMS_EMS_SOURCE_DESCRIPTOR,
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
export { isoUtcToMs, rfc3339ToMs, msToIsoUtc } from './time';

// The documented raw payload schemas (guard + derivation + status domains).
export {
  OMS_EMS_RAW_FIELD_NAMES,
  CANONICAL_ORDER_STATUSES,
  STATUS_MAP,
  ORDER_TYPE_MAP,
  TIME_IN_FORCE_MAP,
  guardOrderStatePayload,
  guardRoutingInstructionPayload,
  deriveOrderStatePayload,
  isNormalizedOrderState,
} from './schemas';
export type { NormalizedOrderState, NormalizedRoutingInstruction } from './schemas';

// The declared mapping tables.
export {
  OMS_EMS_CHANNEL_TABLE_IDS,
  OMS_EMS_ORDER_STATE_TABLE,
  OMS_EMS_MAPPING_TABLES,
} from './mapping-tables';

// The declared entitlement.
export { OMS_EMS_ENTITLEMENT } from './entitlement';

// The declarative rate quotas + enforcement.
export {
  OMS_EMS_RATE_QUOTA,
  OMS_EMS_RATE_QUOTA_SET,
  enforceOmsEmsRateQuota,
} from './rate-quota';

// The declared health thresholds.
export { OMS_EMS_HEALTH_THRESHOLDS } from './health';

// The documented subscription request construction.
export type { OmsEmsChannel } from './requests';
export {
  omsEmsStateSubject,
  omsEmsSubscribeRequest,
  omsEmsOrderStateSubscription,
} from './requests';

// The L8 order-routing translation.
export type { OmsEmsOrderRouting, OmsEmsRoutingTarget } from './routing';
export { OMS_EMS_ORDER_CHANNEL, buildOmsEmsRoutingInstruction } from './routing';

// The order-state reconciliation engine (exact decimal arithmetic).
export type { ExecutionReportData, OrderStateData, OrderStateAgreement } from './reconcile';
export {
  RECONCILIATION_LAWS,
  isExecutionReportData,
  isOrderStateData,
  reconcileOrderState,
} from './reconcile';

// The guard transport (the provider inbound pipeline).
export type { OmsEmsGuardTransport } from './guard-transport';
export { createOmsEmsGuardTransport } from './guard-transport';

// The adapter session.
export type { OmsEmsSessionConfig, OmsEmsAdapterSession, OmsEmsSessionConstruction } from './session';
export {
  createOmsEmsAdapterSession,
  createOmsEmsSessionWithoutEntitlement,
} from './session';

/** Package identity and ownership (Work Order T039). */
export const packageInfo = {
  name: '@tradrl/adapter-oms-ems',
  owner: 'T039',
  status: 'implemented',
} as const;
