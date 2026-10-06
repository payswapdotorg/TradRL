// @tradrl/example-e2e-trading — the identity spaces the slice mints, plus
// the opaque cross-lane id mirrors. Plain strings with PREFIX LAWS (the
// execution-authority mirror style): the runtime guards check the prefix
// and shape; the real packages' branded ids remain mutually assignable at
// the mirror boundary because the guards are structural.
//
// Prefix map (mirroring the merged lanes):
//   dd-    DirectorDecisionId            (16-hex, two-lane digest)
//   esc-   EscalationRecordId            (16-hex)
//   rr-    research report id (sentiment + regime lanes)
//   frr-   fundamental report id
//   cmrr-  cross-market report id
//   sr-    sentiment reading id
//   ed-    event digest id
//   rc-    regime classification id
//   rx-    regime change id
//   fa-    fundamental assessment id
//   cad-   corporate action digest id
//   cmr-   cross-market relationship id
//   goal:  goal statement record
//   cs:    constraint-set record
//   rpol:  risk policy id                (8-hex content digest)
//   xpol:  execution policy id           (8-hex content digest)
//   xag:   authority grant id            (8-hex content digest)
//   grant: authority scope ref (join key)
//   xga:   gateway audit record id
//   xgs:   gateway submission id
//   gor:   gateway order request id
//   si:    strategy intent id            (8-hex content digest)
//   xd:    execution decision id         (8-hex content digest)
//   ps:    portfolio state id
//   strat: strategy run id
//   ol-    order lifecycle record id     (16-hex)
//   gwr-   gateway request id            (16-hex)
//   xf-    engine fill id (ordinal, 8-digit zero-padded)
//   xo-    engine order id (ordinal, 8-digit zero-padded)
//   swf-   shadow fill id (ordinal)
//   swo:   shadow outcome id
//   ep-    episode id
//   run-   reactive run id
//   cur-   time-machine cursor id
//   rec:   lineage stream record id
//   pos:   possession id
//   ai-    agent instance id

import { isDigest16, isDigest8 } from './primitives';

/** Guard helpers for prefix-shaped ids. */
function prefixed(prefix: string, v: unknown): v is string {
  return typeof v === 'string' && v.startsWith(prefix) && v.length > prefix.length;
}

// --- Record identities minted by the slice ---------------------------------

export type DirectorDecisionId = string;
export function isDirectorDecisionId(v: unknown): v is DirectorDecisionId {
  return prefixed('dd-', v) && isDigest16(v.slice(3));
}

export type EscalationRecordId = string;
export function isEscalationRecordId(v: unknown): v is EscalationRecordId {
  return prefixed('esc-', v) && isDigest16(v.slice(4));
}

export type ResearchReportId = string;
export function isResearchReportId(v: unknown): v is ResearchReportId {
  return (
    (prefixed('rr-', v) || prefixed('frr-', v) || prefixed('cmrr-', v)) &&
    (isDigest16(v.slice(3)) || isDigest16(v.slice(4)) || isDigest16(v.slice(5)))
  );
}

export type StrategyIntentId = string;
export function isStrategyIntentId(v: unknown): v is StrategyIntentId {
  return prefixed('si:', v) && isDigest8(v.slice(3));
}

export type ExecutionDecisionId = string;
export function isExecutionDecisionId(v: unknown): v is ExecutionDecisionId {
  return prefixed('xd:', v) && isDigest8(v.slice(3));
}

export type PortfolioStateId = string;
export function isPortfolioStateId(v: unknown): v is PortfolioStateId {
  return prefixed('ps:', v) && isDigest8(v.slice(3));
}

export type StrategyRunId = string;
export function isStrategyRunId(v: unknown): v is StrategyRunId {
  return prefixed('strat:', v) && isDigest8(v.slice(6));
}

export type RiskPolicyId = string;
export function isRiskPolicyId(v: unknown): v is RiskPolicyId {
  return prefixed('rpol:', v) && isDigest8(v.slice(5));
}

export type ExecutionPolicyId = string;
export function isExecutionPolicyId(v: unknown): v is ExecutionPolicyId {
  return prefixed('xpol:', v) && isDigest8(v.slice(5));
}

export type AuthorityGrantId = string;
export function isAuthorityGrantId(v: unknown): v is AuthorityGrantId {
  return prefixed('xag:', v) && isDigest8(v.slice(4));
}

export type AuthorityScopeRef = string;
export function isAuthorityScopeRef(v: unknown): v is AuthorityScopeRef {
  return prefixed('grant:', v);
}

export type GatewayAuditRecordId = string;
export function isGatewayAuditRecordId(v: unknown): v is GatewayAuditRecordId {
  return prefixed('xga:', v) && isDigest8(v.slice(4));
}

export type GatewaySubmissionId = string;
export function isGatewaySubmissionId(v: unknown): v is GatewaySubmissionId {
  return prefixed('xgs:', v) && isDigest8(v.slice(4));
}

export type GatewayOrderRequestId = string;
export function isGatewayOrderRequestId(v: unknown): v is GatewayOrderRequestId {
  return prefixed('gor:', v) && isDigest8(v.slice(4));
}

export type OrderLifecycleId = string;
export function isOrderLifecycleId(v: unknown): v is OrderLifecycleId {
  return prefixed('ol-', v) && isDigest16(v.slice(3));
}

export type GatewayRequestRef = string;
export function isGatewayRequestRef(v: unknown): v is GatewayRequestRef {
  return prefixed('gwr-', v) && isDigest16(v.slice(4));
}

export type FillId = string;
export function isFillId(v: unknown): v is FillId {
  return (
    (prefixed('xf-', v) || prefixed('xsf-', v) || prefixed('swf-', v)) && /^\d{8}$/.test(v.slice(v.indexOf('-') + 1))
  );
}

export type ExchangeOrderId = string;
export function isExchangeOrderId(v: unknown): v is ExchangeOrderId {
  return typeof v === 'string' && /^xo-(\d{8}|seed-(bid|ask)-\d+)$/.test(v);
}

export type ShadowOutcomeId = string;
export function isShadowOutcomeId(v: unknown): v is ShadowOutcomeId {
  return prefixed('swo:', v) && isDigest8(v.slice(4));
}

export type LineageRecordId = string;
export function isLineageRecordId(v: unknown): v is LineageRecordId {
  return prefixed('rec:', v);
}

export type PossessionId = string;
export function isPossessionId(v: unknown): v is PossessionId {
  return prefixed('pos:', v);
}

export type EpisodeId = string;
export function isEpisodeId(v: unknown): v is EpisodeId {
  return prefixed('ep-', v) && isDigest8(v.slice(3));
}

// --- Opaque cross-lane references (plain non-empty strings) ------------------

export type TenantId = string;
export type ProjectId = string;
export type GoalRef = string;
export type ConstraintSetRef = string;
export type OrganizationRef = string;
export type InstrumentId = string;
export type VenueId = string;
export type TopicName = string;
export type AgentInstanceId = string;
export type BodyVersionRef = string;
export type SubstrateRef = string;
export type CapabilityKey = string;
export type CapabilityRecordId = string;
export type RegistryDigest = string;
export type CredentialRef = string;
export type AdapterDescriptorRef = string;
export type ChannelRef = string;
export type Seed = string;
export type MethodId = string;
export type MethodVersionRef = string;
export type RiskPolicyRef = string;

/** Guard: opaque non-empty string reference. */
export function isNonEmptyRef(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** Guard: `adapter:<id>@<version>` (the adapter-lane descriptor grammar). */
export function isAdapterDescriptorRef(v: unknown): v is AdapterDescriptorRef {
  return typeof v === 'string' && /^adapter:[^@\s]+@[\w.]+$/.test(v);
}

/** Guard: `chan:<channel>` (the routing channel grammar). */
export function isChannelRef(v: unknown): v is ChannelRef {
  return typeof v === 'string' && /^chan:[\w.-]+$/.test(v);
}

/** Guard: `cred:<id>@<version>` — a credential REFERENCE, never a value (L8). */
export function isCredentialRef(v: unknown): v is CredentialRef {
  return typeof v === 'string' && /^cred:[^@\s]+@\d+$/.test(v);
}

/** Guard: canonical body-version ref `bodyId@X.Y.Z`. */
export function isBodyVersionRef(v: unknown): v is BodyVersionRef {
  return (
    typeof v === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}@(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
      v,
    )
  );
}

/** Guard: a topic name (identifier path; `kernel.*` reserved). */
export function isTopicName(v: unknown): v is TopicName {
  return typeof v === 'string' && /^[a-z0-9][a-z0-9.-]{0,127}(.[a-z0-9-]+)*$/.test(v);
}

/** Guard: an agent instance id. */
export function isAgentInstanceId(v: unknown): v is AgentInstanceId {
  return typeof v === 'string' && /^ai-[a-z0-9][a-z0-9-]{0,63}$/.test(v);
}

/** Guard: `ksw:` kill-switch id. */
export function isKillSwitchId(v: unknown): v is string {
  return prefixed('ksw:', v) && isDigest8(v.slice(4));
}

/** Guard: `ksw:`-referencing risk-policy ref `risk-policy:rpol:<digest>@<version>`. */
export function isRiskPolicyRef(v: unknown): v is RiskPolicyRef {
  return typeof v === 'string' && /^risk-policy:rpol:[0-9a-f]{8}@\d+$/.test(v);
}
