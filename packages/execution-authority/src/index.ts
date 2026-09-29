/**
 * @tradrl/execution-authority — the execution-authority contract
 * package (Work Order T040): the L8 last-mile completion's AUTHORITY
 * HALF. D-019 authorized this lane as the chokepoint where decisions
 * become orders; this package owns the contracts that make the
 * chokepoint's authority ENFORCEABLE IN CODE (L20: "Safety outside
 * prompts: security, risk and authorization are implemented in
 * code/infrastructure").
 *
 * Spec anchors — spec/ARCHITECTURE.md Execution, VERBATIM:
 * "Consequential actions require hard controls outside prompts:
 * identity, authorization, limits, venue permissions, rate limits,
 * kill switch, credentials and audit." spec/SECURITY.md Secrets,
 * VERBATIM: "Never commit provider credentials. Inject them through
 * secure runtime boundaries." spec/ADAPTERS.md Execution, VERBATIM:
 * "Every consequential order passes through internal execution
 * authority/risk gates."
 *
 * Public API:
 *   - Structural primitives — the shared contract vocabulary (branding,
 *     hand-rolled guards, deep-freeze discipline, JSON model, canonical
 *     JSON, stable FNV-1a digests, TimestampMs) mirrored from
 *     @tradrl/execution-policy (T019) law-for-law.
 *   - Ids — the authority identity spaces owned here (the authority
 *     grant, the gateway order request, the gateway submission, the
 *     gateway audit record, the opaque adapter/channel refs over the
 *     T039 descriptors) plus the opaque cross-lane mirrors (tenant,
 *     project, strategy spec, instrument, venue, 'cred:' credential
 *     refs, 'grant:' authority scope refs, 'xd:' decisions, 'xpol:'
 *     policies, 'ksw:' switches).
 *   - The credential-opacity trip wire — `credentialValueViolations`
 *     (the T019 mirror): a credential VALUE anywhere in ANY record this
 *     package emits is the typed `credential_value_present` error.
 *   - The execution-lane structural mirrors — the APPROVE/REFUSE
 *     decision records, the L9 lineage block, the routed order form
 *     (the T019 OrderIntent mirror), the injected kill-switch standing
 *     fact, and the shadow/live execution-mode marker.
 *   - `AuthorityGrantRecord` — WHO may do WHAT: the versioned,
 *     content-addressed referent of the 'grant:' scope refs T019's
 *     ExecutionPolicy declares (principal, order kinds, venues, rate
 *     budgets, opaque credential bindings, the explicit validity
 *     window [issuedAt, expiresAt), the append-only revocation log).
 *   - `EntitlementRegistry` + the entitlement predicates — the
 *     Default-Deny answer to "may this tenant route to venue V? use
 *     credential ref C?": unknown venue, unknown grant, missing
 *     entitlement are typed `EntitlementRefusal` records; nothing
 *     routes by default.
 *   - `RoutingTable` — WHERE: venue/instrument -> the opaque adapter
 *     descriptor ref + channel ref over the T039 descriptors
 *     (mirrored; the interop test proves the decomposition).
 *   - `GatewayOrderRequest` — THE TRANSLATION CONTRACT: a validated
 *     APPROVED decision + the routed order form. An order request
 *     without a valid approved decision is INEXPRESSIBLE at the guard
 *     level (the brokers adapter's law, one lane upstream).
 *   - `GatewayAuditRecord` / `GatewayAuditTrail` — SECURITY.md's audit
 *     contents as typed data (who/what acted, BodyVersion, substrate,
 *     policy, visible market/data state, risk checks, order, execution
 *     and outcome), append-only and chain-verified (the T019 AuditLog
 *     discipline).
 *
 * Zero runtime dependencies; types, schemas and pure functions only.
 * No ambient clock (`Date.now()` never appears) and no ambient
 * randomness. Cross-lane shapes are STRUCTURAL MIRRORS (D-003/D-004) —
 * never imports; src/interop.test.ts is the drift trip wire. The
 * gateway SERVICE (services/execution-gateway) consumes this package
 * and the contract packages @tradrl/execution-policy and @tradrl/risk
 * via relative source imports (the services/execution-sim precedent).
 */

// Errors and results
export type { ExecutionAuthorityErrorCode, ExecutionAuthorityError, ExecutionAuthorityResult } from './errors';
export { errorOf, fail, failures, ok, missingField, invalidField, invalidType, isExecutionAuthorityError } from './errors';

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

// Ids and opaque cross-lane references
export type {
  AuthorityGrantId,
  GatewayOrderRequestId,
  GatewaySubmissionId,
  GatewayAuditRecordId,
  AdapterDescriptorRef,
  ChannelRef,
  TenantId,
  ProjectId,
  StrategySpecId,
  InstrumentId,
  VenueId,
  CredentialRef,
  AuthorityScopeRef,
  DecisionId,
  ExecutionPolicyId,
  KillSwitchId,
  SubstrateRef,
  GrantVersionRef,
  StrategyVersionRefMirror,
  PolicyVersionRefMirror,
} from './ids';
export {
  isAuthorityGrantId,
  isGatewayOrderRequestId,
  isGatewaySubmissionId,
  isGatewayAuditRecordId,
  isAdapterDescriptorRef,
  isChannelRef,
  isTenantId,
  isProjectId,
  isStrategySpecId,
  isInstrumentId,
  isVenueId,
  isCredentialRef,
  isAuthorityScopeRef,
  isDecisionId,
  isExecutionPolicyId,
  isKillSwitchId,
  isSubstrateRef,
  isGrantVersionRef,
  isStrategyVersionRefMirror,
  isPolicyVersionRefMirror,
  mintAuthorityGrantId,
  mintGatewayOrderRequestId,
  mintGatewaySubmissionId,
  mintGatewayAuditRecordId,
  mintAdapterDescriptorRef,
  mintChannelRef,
  adapterDescriptorOf,
  channelOf,
} from './ids';

// The credential-opacity trip wire
export { CREDENTIAL_VALUE_KEYS, isCredentialValueKey, credentialValueViolations } from './credentials';

// The execution-lane structural mirrors (T019's records + the mode marker)
export type {
  OrderSide,
  CoreOrderKind,
  CoreTimeInForce,
  OrderIntentRecord,
  ExecutionLineageRecord,
  CheckResultRecord,
  ApproveDecisionRecord,
  RefusalDecisionRecord,
  ExecutionDecisionRecord,
  KillSwitchStandingState,
  KillSwitchStandingFact,
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
  isTimestampMirror,
  isCanonicalPositiveDecimal,
  isOrderIntentRecord,
  isExecutionLineageRecord,
  PRE_TRADE_CHECK_KINDS,
  isPreTradeCheckKind,
  isCheckResultRecord,
  isApproveDecisionRecord,
  approveDecisionIdMatchesContent,
  mintApproveDecisionId,
  isRefusalDecisionRecord,
  isExecutionDecisionRecord,
  KILL_SWITCH_STANDING_STATES,
  isKillSwitchStandingFact,
  EXECUTION_MODES,
  isExecutionMode,
  intentExecutionMode,
} from './decision-mirror';

// The authority grant (who may do what)
export type { RevocationRecord, GrantRateBudget, GrantCredentialBinding, AuthorityGrantRecord, GrantStatusRefusal } from './grant';
export {
  isRevocationRecord,
  isGrantRateBudget,
  isGrantCredentialBinding,
  isAuthorityGrantRecord,
  grantContentTree,
  canonicalGrantJson,
  validateAuthorityGrant,
  mintAuthorityGrant,
  grantStatus,
} from './grant';

// The entitlement registry (Default-Deny predicates)
export type { EntitlementRefusal, EntitlementRegistry } from './registry';
export {
  isEntitlementRefusal,
  isEntitlementRegistry,
  validateEntitlementRegistry,
  grantForScopeRef,
  grantScopeRefusal,
  mayRouteToVenue,
  mayUseCredential,
  rateBudgetFor,
  permitsOrderKind,
} from './registry';

// The routing table (where approved orders go)
export type { RouteEntry, RoutingTable } from './routing';
export {
  isRouteEntry,
  isRoutingTable,
  validateRoutingTable,
  routeFor,
} from './routing';

// The translation contract (approved decision + routed order form)
export type { GatewayOrderRequest, GatewayOrderRequestInput } from './order-request';
export {
  isGatewayOrderRequest,
  orderRequestContentTree,
  canonicalOrderRequestJson,
  gatewayOrderRequest,
} from './order-request';

// The gateway audit trail (SECURITY.md's audit contents, chain-verified)
export type {
  AuditWhoWhat,
  AuditVisibleState,
  AuditRiskChecks,
  AuditOrderBlock,
  AuditExecutionBlock,
  AuditRefusalSummary,
  GatewayAuditRecord,
  GatewayAuditTrail,
} from './audit';
export {
  isAuditWhoWhat,
  isAuditVisibleState,
  isAuditRiskChecks,
  isAuditOrderBlock,
  isAuditExecutionBlock,
  isAuditRefusalSummary,
  isGatewayAuditRecord,
  isGatewayAuditTrail,
  startGatewayAuditTrail,
  appendGatewayAuditRecord,
  gatewayAuditRecordAt,
  verifyGatewayAuditChain,
  validateGatewayAuditTrail,
} from './audit';

/** Package identity and ownership (governance surface). */
export const packageInfo = {
  name: '@tradrl/execution-authority',
  owner: 'T040',
  status: 'implemented',
  concepts: [
    'AuthorityGrantRecord',
    'EntitlementRegistry',
    'EntitlementRefusal',
    'RoutingTable',
    'GatewayOrderRequest',
    'GatewayAuditRecord',
    'credentialValueViolations',
  ],
} as const;
