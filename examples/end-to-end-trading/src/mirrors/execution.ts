// @tradrl/example-e2e-trading — EXECUTION GATEWAY MIRRORS.
//
// Structural mirrors of the execution plane: the pre-trade check machine
// (packages/execution-policy — T019), the execution-authority contracts
// (packages/execution-authority — T040: grants, registry, routing,
// translation, audit) and the 13-stage gateway chokepoint
// (services/execution-gateway — T040). THE L8 LAW: the model NEVER
// bypasses the gate stack — in this slice every order reaches the venue
// ONLY through `submitDecision` and its thirteen stages.
// tests/end-to-end-trading/interop.test.ts feeds this slice's gate
// decisions through the REAL `gatewayOrderRequest` translation contract.

import type {
  TenantId, ProjectId, VenueId, InstrumentId, CredentialRef,
  AdapterDescriptorRef, ChannelRef, Seed,
} from '../ids';
import type { StrategyIntentMirror } from './strategy';
import type { OrderIntentRecordMirror } from './market';
import type {
  GoalVersionRefMirror,
  ConstraintSetVersionRefMirror,
  StrategyVersionRefMirror,
  PortfolioStateMirror,
} from './control';
import type { ExecutionLimitRefusalMirror, LimitEvaluationRecordMirror, KillSwitchLogMirror } from './risk';

// ---------------------------------------------------------------------------
// Pre-trade check machine (packages/execution-policy)
// ---------------------------------------------------------------------------

export const PRE_TRADE_CHECK_KINDS_MIRROR = [
  'kill_switch', 'identity', 'authorization', 'limits',
  'venue_permissions', 'rate_limits', 'credentials',
] as const;

export type PreTradeCheckKindMirror = (typeof PRE_TRADE_CHECK_KINDS_MIRROR)[number];

export interface CheckResultMirror {
  readonly dimension: PreTradeCheckKindMirror;
  readonly ordinal: number;
  readonly outcome: 'pass' | 'fail';
}

export type RefusalReasonMirror =
  | { readonly dimension: 'kill_switch'; readonly switchId: string; readonly thrownAt: number; readonly reason: string }
  | { readonly dimension: 'identity'; readonly subject: 'tenant' | 'project' | 'principal'; readonly expected: string; readonly actual: string }
  | { readonly dimension: 'authorization'; readonly orderKind: string; readonly permittedKinds: readonly string[] }
  | { readonly dimension: 'limits'; readonly limit: string; readonly instrumentClass: string; readonly cap: string; readonly observed: string; readonly excess: string }
  | { readonly dimension: 'venue_permissions'; readonly venue: string; readonly instrument: string }
  | { readonly dimension: 'rate_limits'; readonly venue: string; readonly windowMs: number | null; readonly budget: number; readonly observed: number }
  | { readonly dimension: 'credentials'; readonly venue: string };

export interface CheckFailureMirror {
  readonly dimension: PreTradeCheckKindMirror;
  readonly ordinal: number;
  readonly reason: RefusalReasonMirror;
}

export interface ExecutionLineageMirror {
  readonly intentRef: string;
  readonly strategy: { readonly specId: string; readonly version: number };
  readonly goal: { readonly goalId: string; readonly version: number };
  readonly policy: { readonly policyId: string; readonly version: number };
  readonly venues: readonly string[];
  readonly seed: string;
  readonly tenant: string;
  readonly project: string;
}

export interface ApproveDecisionMirror {
  readonly kind: 'approve';
  readonly decisionId: string;
  readonly intentRef: string;
  readonly policy: { readonly policyId: string; readonly version: number };
  readonly checkOrder: readonly PreTradeCheckKindMirror[];
  readonly checks: readonly CheckResultMirror[];
  readonly lineage: ExecutionLineageMirror;
  readonly asOf: number;
}

export interface RefusalDecisionMirror {
  readonly kind: 'refuse';
  readonly decisionId: string;
  readonly intentRef: string;
  readonly policy: { readonly policyId: string; readonly version: number };
  readonly checkOrder: readonly PreTradeCheckKindMirror[];
  readonly checks: readonly CheckResultMirror[];
  readonly failure: CheckFailureMirror;
  readonly lineage: ExecutionLineageMirror;
  readonly asOf: number;
}

export type ExecutionDecisionMirror = ApproveDecisionMirror | RefusalDecisionMirror;

// ---------------------------------------------------------------------------
// ExecutionPolicy (packages/execution-policy policy.ts)
// ---------------------------------------------------------------------------

export interface LimitRecordMirror {
  readonly instrumentClass: string;
  readonly maxOrderSize: string;
  readonly maxOrderNotional: string;
  readonly maxPositionSize: string;
  readonly maxPositionNotional: string;
}

export interface VenuePermissionMirror {
  readonly venue: VenueId;
  readonly instrument: InstrumentId;
  readonly instrumentClass: string;
}

export interface RateBudgetMirror {
  readonly venue: VenueId;
  readonly windowMs: number;
  readonly maxOrders: number;
}

export interface CredentialBindingMirror {
  readonly venue: VenueId;
  readonly credentialRef: CredentialRef;
}

export interface ExecutionPolicyMirror {
  readonly policyId: string;
  readonly version: number;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly identity: { readonly principals: readonly string[] };
  readonly authorization: readonly {
    readonly scopeRef: string;
    readonly orderKinds: readonly string[];
  }[];
  readonly limits: readonly LimitRecordMirror[];
  readonly venuePermissions: readonly VenuePermissionMirror[];
  readonly rateLimits: readonly RateBudgetMirror[];
  readonly credentials: readonly CredentialBindingMirror[];
  readonly killSwitch: { readonly switchId: string };
  readonly audit: { readonly emission: 'every_decision' };
  readonly checkOrder: readonly PreTradeCheckKindMirror[];
  readonly learning: null;
  readonly asOf: number;
}

/** The gate's venue facts (execution-policy venue-mirror `ExecutionVenueState`). */
export interface ExecutionVenueStateMirror {
  readonly asOf: number;
  readonly instruments: readonly {
    readonly venue: VenueId;
    readonly instrument: InstrumentId;
    readonly instrumentClass: string;
    readonly referencePrice: string;
    readonly rateWindowOrderCount: number;
  }[];
}

// ---------------------------------------------------------------------------
// Execution authority (packages/execution-authority)
// ---------------------------------------------------------------------------

export interface AuthorityGrantRecordMirror {
  readonly grantId: string;
  readonly version: number;
  readonly supersedes: { readonly grantId: string; readonly version: number } | null;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly principal: { readonly specId: string; readonly version: number };
  readonly scopeRef: string;
  readonly orderKinds: readonly string[];
  readonly venues: readonly VenueId[];
  readonly rateBudgets: readonly { readonly venue: VenueId; readonly windowMs: number; readonly maxOrders: number }[];
  readonly credentials: readonly { readonly venue: VenueId; readonly credentialRef: CredentialRef }[];
  readonly validity: { readonly issuedAt: number; readonly expiresAt: number };
  readonly revocations: readonly { readonly revokedAt: number; readonly reason: string; readonly revokedBy: string }[];
  readonly asOf: number;
}

export type EntitlementRefusalMirror =
  | { readonly kind: 'unknown_grant'; readonly scopeRef: string }
  | { readonly kind: 'unknown_venue'; readonly venue: string; readonly tenant: string }
  | {
      readonly kind: 'missing_entitlement';
      readonly subject: 'venue' | 'credential' | 'rate' | 'order_kind';
      readonly grantId: string;
      readonly venue?: string;
      readonly credentialRef?: string;
      readonly orderKind?: string;
    }
  | { readonly kind: 'grant_not_yet_valid'; readonly grantId: string; readonly issuedAt: number; readonly now: number }
  | { readonly kind: 'grant_expired'; readonly grantId: string; readonly expiresAt: number; readonly now: number }
  | { readonly kind: 'grant_revoked'; readonly grantId: string; readonly revokedAt: number; readonly reason: string }
  | { readonly kind: 'cross_tenant'; readonly grantId: string; readonly expectedTenant: string; readonly actualTenant: string; readonly expectedProject: string; readonly actualProject: string };

export interface EntitlementRegistryMirror {
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly grants: readonly AuthorityGrantRecordMirror[];
  readonly venues: readonly VenueId[];
}

export interface RouteEntryMirror {
  readonly venue: VenueId;
  readonly instrument: InstrumentId;
  readonly adapterRef: AdapterDescriptorRef;
  readonly channelRef: ChannelRef;
}

export interface RoutingTableMirror {
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly entries: readonly RouteEntryMirror[];
}

/** Credential opacity trip-wire vocabulary (execution-authority credentials.ts). */
export const CREDENTIAL_VALUE_KEYS_MIRROR = [
  'secret', 'apikey', 'privatekey', 'password', 'passphrase',
  'token', 'mnemonic', 'seedphrase', 'credential',
] as const;

// ---------------------------------------------------------------------------
// Gateway translation (execution-authority order-request.ts)
// ---------------------------------------------------------------------------

export interface GatewayOrderRequestMirror {
  readonly requestRef: string;
  readonly decision: ApproveDecisionMirror;
  readonly order: OrderIntentRecordMirror;
  readonly route: {
    readonly venue: VenueId;
    readonly adapterRef: AdapterDescriptorRef;
    readonly channelRef: ChannelRef;
  };
  readonly grantRef: string;
  readonly credentialRef: CredentialRef;
  readonly killSwitchStanding: 'standing';
  readonly asOf: number;
}

// ---------------------------------------------------------------------------
// Gateway audit (execution-authority audit.ts)
// ---------------------------------------------------------------------------

export interface GatewayAuditRecordMirror {
  readonly auditId: string;
  readonly sequence: number;
  readonly who: {
    readonly bodyVersion: { readonly specId: string; readonly version: number };
    readonly intentRef: string;
    readonly decisionId: string | null;
    readonly decisionKind: 'approve' | 'refuse' | null;
    readonly clientOrderId: string;
  };
  readonly substrate: string;
  readonly policy: { readonly policyId: string; readonly version: number };
  readonly visibleState: {
    readonly venue: string;
    readonly instrument: string;
    readonly instrumentClass: string;
    readonly referencePrice: string;
    readonly rateWindowOrderCount: number;
    readonly riskExposureRef: string | null;
  };
  readonly riskChecks: {
    readonly evaluationId: string | null;
    readonly riskPolicy: { readonly policyId: string; readonly version: number };
    readonly within: number;
    readonly breaching: number;
    readonly blocked: number;
  };
  readonly order: {
    readonly adapterRef: AdapterDescriptorRef;
    readonly channelRef: ChannelRef;
    readonly credentialRef: CredentialRef;
    readonly clientOrderId: string;
    readonly requestRef: string;
  } | null;
  readonly execution: { readonly routed: boolean; readonly submissionAt: number; readonly messageDigest: string | null } | null;
  readonly outcome: 'routed' | 'refused';
  readonly refusal: { readonly stage: string; readonly code: string; readonly detail: unknown } | null;
  readonly lineage: ExecutionLineageMirror;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly asOf: number;
  readonly chainHead: string;
}

export interface GatewayAuditTrailMirror {
  readonly tenant: TenantId;
  readonly project: ProjectId;
  readonly records: readonly GatewayAuditRecordMirror[];
}

// ---------------------------------------------------------------------------
// The 13-stage gateway (services/execution-gateway gateway.ts)
// ---------------------------------------------------------------------------

export const GATEWAY_STAGES = [
  'credential_opacity', 'intent_validation', 'shadow_mode', 'policy_gate',
  'duplicate_decision', 'risk_limits', 'authority_grant', 'entitlement',
  'rate_budget', 'kill_switch', 'routing', 'translation', 'adapter',
] as const;

export type GatewayStage = (typeof GATEWAY_STAGES)[number];

export type GatewayRefusalMirror =
  | { readonly stage: 'credential_opacity'; readonly violations: readonly string[] }
  | { readonly stage: 'intent_validation'; readonly reason: string }
  | { readonly stage: 'shadow_mode'; readonly mode: string }
  | { readonly stage: 'policy_gate'; readonly decision: Record<string, unknown> }
  | { readonly stage: 'gate_envelope'; readonly errors: readonly { readonly code: string; readonly message: string }[] }
  | { readonly stage: 'duplicate_decision'; readonly decisionId: string }
  | { readonly stage: 'risk_limits'; readonly evaluationId: string; readonly refusals: readonly ExecutionLimitRefusalMirror[] }
  | { readonly stage: 'risk_envelope'; readonly errors: readonly { readonly code: string; readonly message: string }[] }
  | { readonly stage: 'authority_grant'; readonly refusal: EntitlementRefusalMirror }
  | { readonly stage: 'entitlement'; readonly refusal: EntitlementRefusalMirror }
  | { readonly stage: 'rate_budget'; readonly venue: string; readonly budget: number; readonly observed: number; readonly windowMs: number | null }
  | { readonly stage: 'kill_switch'; readonly switchId: string; readonly thrownAt: number; readonly reason: string }
  | { readonly stage: 'routing'; readonly venue: string; readonly instrument: string; readonly reason: 'no_route' | 'no_adapter' }
  | { readonly stage: 'translation'; readonly errors: readonly { readonly code: string; readonly message: string; readonly path?: string }[] }
  | { readonly stage: 'adapter'; readonly error: { readonly kind: string; readonly code: string; readonly message: string } };

export type GatewaySubmissionRecordMirror =
  | {
      readonly kind: 'routed';
      readonly submissionId: string;
      readonly decisionId: string;
      readonly auditId: string;
      readonly requestRef: string;
      readonly venue: string;
      readonly adapterRef: string;
      readonly channelRef: string;
      readonly routedAt: number;
    }
  | {
      readonly kind: 'refused';
      readonly submissionId: string;
      readonly decisionId: string | null;
      readonly auditId: string;
      readonly refusal: GatewayRefusalMirror;
      readonly refusedAt: number;
    };

/** The injected venue adapter seam (execution-gateway ports.ts `OrderRoutingPort`). */
export interface RoutingBundleMirror {
  readonly decision: ApproveDecisionMirror;
  readonly intent: StrategyIntentMirror;
  readonly kill_switch: { readonly state: 'standing' | 'thrown' };
  readonly credential_ref?: CredentialRef;
  readonly route?: { readonly venue: string; readonly credential_ref?: string };
}

export type RoutingSendResultMirror =
  | { readonly ok: true; readonly value: null }
  | { readonly ok: false; readonly error: { readonly kind: string; readonly code: string; readonly message: string } };

export interface OrderRoutingPortMirror {
  routeOrder(routing: RoutingBundleMirror): RoutingSendResultMirror;
}

export interface GatewayAdapterBindingMirror {
  readonly adapterRef: AdapterDescriptorRef;
  readonly port: OrderRoutingPortMirror;
}

export interface InstantSourceMirror {
  next(): number;
}

/** The gateway construction input (execution-gateway ExecutionGatewayConfig). */
export interface ExecutionGatewayConfigMirror {
  readonly policy: ExecutionPolicyMirror;
  readonly gate: {
    readonly portfolio: PortfolioStateMirror;
    readonly venueState: ExecutionVenueStateMirror;
  };
  readonly risk: {
    readonly policy: import('./risk').RiskPolicyMirror;
    readonly exposure: unknown;
  };
  readonly authority: EntitlementRegistryMirror;
  readonly routing: RoutingTableMirror;
  readonly adapters: readonly GatewayAdapterBindingMirror[];
  readonly killSwitch: KillSwitchLogMirror;
  readonly instants: InstantSourceMirror;
  readonly substrate: string;
  /** Mode honesty (L5): this reference gateway is the PAPER venue's gate. */
  readonly executionMode: 'paper';
}

export interface ExecutionGatewaySessionMirror {
  submitDecision(intent: StrategyIntentMirror): { readonly ok: true; readonly value: GatewaySubmissionRecordMirror } | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly message: string; readonly path?: string }[] };
  auditTrail(): GatewayAuditTrailMirror;
  submissions(): readonly GatewaySubmissionRecordMirror[];
  rateState(): readonly { readonly venue: string; readonly anchor: number; readonly count: number }[];
  verifyGatewayCoherence(): { readonly ok: true; readonly value: null } | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly message: string }[] };
}

// ---------------------------------------------------------------------------
// Execution body (bodies/execution — T025) lifecycle records
// ---------------------------------------------------------------------------

export const ORDER_STATES_MIRROR = [
  'prepared', 'submitted', 'acknowledged', 'partially_filled', 'filled',
  'cancelled', 'rejected', 'expired', 'stuck',
] as const;

export type OrderStateMirror = (typeof ORDER_STATES_MIRROR)[number];

export const ORDER_LIFECYCLE_TRANSITIONS_MIRROR: readonly {
  readonly from: OrderStateMirror | null;
  readonly event: string;
  readonly to: OrderStateMirror;
}[] = [
  { from: null, event: 'prepare', to: 'prepared' },
  { from: 'prepared', event: 'submit', to: 'submitted' },
  { from: 'submitted', event: 'acknowledge', to: 'acknowledged' },
  { from: 'acknowledged', event: 'partial-fill', to: 'partially_filled' },
  { from: 'acknowledged', event: 'fill-complete', to: 'filled' },
  { from: 'partially_filled', event: 'fill-complete', to: 'filled' },
];

export interface FillEvidenceMirror {
  readonly fillRef: string;
  readonly quantity: string;
  readonly orderClock: number;
}

export interface OrderLifecycleRecordMirror {
  readonly lifecycleId: string;
  readonly sequence: number;
  readonly decisionRef: string;
  readonly intentRef: string;
  readonly directorDecisionRef: string | null;
  readonly orderRef: string;
  readonly venue: string;
  readonly instrument: string;
  readonly side: 'buy' | 'sell';
  readonly orderKind: string;
  readonly quantity: string;
  readonly from: OrderStateMirror | null;
  readonly to: OrderStateMirror;
  readonly event: string;
  readonly orderClock: number;
  readonly decisionAsOf: number;
  readonly fills: readonly FillEvidenceMirror[];
  readonly cancelConfirmationRef: string | null;
  readonly escalationRef: string | null;
  readonly methodId: string;
  readonly methodVersion: string;
  readonly tenant: string;
  readonly project: string;
  readonly chainHead: string;
}

export interface OrderLifecycleLogMirror {
  readonly orderRef: string;
  readonly records: readonly OrderLifecycleRecordMirror[];
}

export const LIFECYCLE_CHAIN_SEED_MIRROR = 'ol-genesis';

export interface GatewayRequestMirror {
  readonly kind: 'order-submission';
  readonly orderRef: string;
  readonly decisionRef: string;
  readonly record: OrderLifecycleRecordMirror;
  readonly orderClock: number;
  readonly tenant: string;
  readonly project: string;
  readonly requestRef: string;
}
