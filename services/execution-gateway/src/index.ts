/**
 * @tradrl/execution_gateway — the execution gateway service (Work
 * Order T040): the L8 last-mile completion. THE CHOKEPOINT WHERE
 * DECISIONS BECOME ORDERS.
 *
 * Public API:
 *   - `createExecutionGateway` / `submitDecision` — the single entry
 *     point and the declared 13-stage pipeline (credential opacity ->
 *     intent validation -> shadow-mode separation -> the REAL T019
 *     gate -> decision-replay guard -> the REAL T020 risk engine ->
 *     authority grant -> entitlement -> rate budget -> standing kill
 *     switch -> routing -> the translation contract -> the injected
 *     adapter port). ANY refusal at ANY stage: a typed GatewayRefusal
 *     record + an audit record + ZERO adapter calls.
 *   - `GatewayRefusal` / `GatewaySubmissionRecord` — the typed
 *     outcome vocabulary (refusals are records, never exceptions).
 *   - `ExecutionGatewaySession` — the session surface: the outcome
 *     log, the chain-verified audit trail (SECURITY.md's audit
 *     contents), the rate-window accounting and the whole-session
 *     coherence verification.
 *   - The injected ports (`OrderRoutingPort`, `InstantSource`,
 *     `GatewayAdapterBinding`) — the T039 session/routing structural
 *     mirrors; the interop tests drive the REAL brokers and OMS/EMS
 *     sessions through the gateway with zero casts.
 *   - The reference fixtures (the reference policy/grants/registry/
 *     routing table/intents over the REAL T019/T020 functions) and
 *     the recording fake port (test support).
 *
 * The contract packages `@tradrl/execution-policy` (T019) and
 * `@tradrl/risk` (T020) are consumed via RELATIVE SOURCE IMPORTS (the
 * services/execution-sim precedent — the frozen write surface permits
 * no lockfile-touching workspace edge; the Lead may convert to
 * `workspace:*` at the next serialized lockfile change).
 * `@tradrl/execution-authority` (T040's own contract package) is
 * consumed the same way.
 *
 * Zero runtime dependencies. No ambient clock (`Date.now()` never
 * appears). No network (the adapters are injected ports — real venue
 * binding is post-T041). No credential values anywhere (the opacity
 * trip wire runs over the whole request bundle).
 */

// The gateway core
export type { GatewayRefusal, GatewaySubmissionRecord, ExecutionGatewayConfig, ExecutionGatewaySession, GatewayConstruction } from './gateway';
export { createExecutionGateway, isGatewayRefusal } from './gateway';

// The injected ports
export type { GatewayAdapterBinding, InstantSource, OrderRoutingPort, RoutingBundleMirror, RoutingSendFailure, ScriptedInstants } from './ports';
export { scriptedInstants } from './ports';

// The recording fake port (test support)
export type { PortScriptedFailure, RecordingPort } from './fake-port';
export { recordingPort } from './fake-port';

// The reference fixtures
export {
  T0,
  ISO_T0,
  TENANT,
  PROJECT,
  PRINCIPAL,
  VENUE_BROKER,
  VENUE_OMS,
  VENUE_PENDING,
  BTC,
  ETH,
  SCOPE_LIMIT,
  SCOPE_MARKET,
  CRED_BROKER,
  CRED_OMS,
  CRED_PENDING,
  SUBSTRATE,
  referenceKillSwitch,
  thrownReferenceKillSwitch,
  referencePolicyInput,
  referencePolicy,
  referencePortfolio,
  referenceVenueState,
  referenceRiskPolicy,
  referenceExposure,
  breachingExposure,
  referenceGrant,
  referenceRegistry,
  referenceRoutingTable,
  intent,
  referenceApproveBatch,
  contaminatedIntent,
  malformedIntent,
  shadowModeIntent,
  identityFailIntent,
  authorizationFailIntent,
  limitFailIntent,
  venueFailIntent,
  unknownVenueIntent,
  pendingVenueIntent,
  unroutedIntent,
  unroutableRoutingTable,
  ghostAdapterRoutingTable,
  rateWindowSaturatedVenueState,
  policyWithoutBrokerCredential,
  policyWithGhostGrant,
  compliantIntent,
} from './fixtures';
export type { GrantDeclarationOverrides } from './fixtures';

/** Package identity and ownership (governance surface). */
export const packageInfo = {
  name: '@tradrl/execution_gateway',
  owner: 'T040',
  status: 'implemented',
  concepts: [
    'createExecutionGateway',
    'submitDecision',
    'GatewayRefusal',
    'GatewayOrderRequest',
    'GatewayAuditRecord',
    'OrderRoutingPort',
    'duplicate_decision',
  ],
} as const;
