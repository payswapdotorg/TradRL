/**
 * @tradrl/execution_gateway (service) — the execution gateway: THE
 * CHOKEPOINT WHERE DECISIONS BECOME ORDERS (Work Order T040, the L8
 * last-mile completion).
 *
 * THE EXISTENTIAL LAW (invariant 6 / L8: "Execution authority is
 * outside the model" / "models cannot bypass hard
 * risk/authorization gates"): there is NO code path from a model-side
 * record (intent, decision, anything) to an outbound order that
 * bypasses the gate + authority + entitlement + kill-switch checks.
 * `submitDecision` is the SINGLE entry point; the adapters are
 * INJECTED ports called EXACTLY ONCE per submission and ONLY after
 * every pipeline stage passed; the translation runs through the
 * authority package's GatewayOrderRequest (whose guard refuses
 * non-approved decisions INEXPRESSIBLY); and the REAL T039 adapters
 * re-run their own L8 checks inside the injected session (the
 * negative tests prove direct routing calls, replayed approvals and
 * forged decision refs are typed errors at every layer).
 *
 * THE DECLARED PIPELINE (the Work Order's stage list, first-failure-
 * wins; ANY refusal at ANY stage produces a typed GatewayRefusal
 * record + an audit record + ZERO adapter calls):
 *   1. credential_opacity — the T019 trip wire over the WHOLE
 *      submitted intent (a contaminated record is refused before
 *      anything else matters — T039's first-refusal position);
 *   2. intent_validation — the REAL T019 mirror guard;
 *   3. shadow_mode — the consequential lane refuses shadow/paper
 *      intents (mode separation from T030's upstream paper lane);
 *   4. policy_gate — the REAL T019 `runExecutionGate` (kill switch
 *      first, identity, authorization, limits, venue permissions,
 *      rate limits, credentials — the eight-dimension hard gate);
 *   5. duplicate_decision — the same DecisionId submitted twice is
 *      the typed `duplicate_decision` refusal (the first stands; the
 *      second is a refusal record);
 *   6. risk_limits — the REAL T020 `evaluateLimits` +
 *      `executionLimitRefusals` (D-014: T020 refines the risk
 *      dimension T019's policy exposes);
 *   7. authority_grant — the resolved grant is valid, unrevoked and
 *      inside its [issuedAt, expiresAt) window, in the caller's
 *      scope, permitting the order kind;
 *   8. entitlement — the venue is permitted (registry + grant) and
 *      the credential ref is bound;
 *   9. rate_budget — the grant's per-venue budget against the
 *      gateway's own window-threaded counters (fail-closed when no
 *      budget is declared);
 *  10. kill_switch — the standing re-check (defense in depth: the
 *      gate already refused thrown switches first);
 *  11. routing — the (venue, instrument) pair resolves to a declared
 *      route + an injected adapter binding;
 *  12. translation — the GatewayOrderRequest build (the authority
 *      package's translation contract: opacity, approve-law,
 *      coherence);
 *  13. adapter — the injected port call (the REAL adapter's own L8
 *      checks run INSIDE the session; a typed adapter refusal
 *      propagates with ZERO sent messages).
 * Every submission — routed or refused — emits EXACTLY ONE
 * chain-verified GatewayAuditRecord carrying SECURITY.md's audit
 * contents (who/what, BodyVersion, substrate, policy, visible state,
 * risk checks, order, execution, outcome).
 *
 * THE IMPORT NOTE (the services/execution-sim precedent): the frozen
 * write surface permits no lockfile-touching workspace edge, so the
 * contract packages `@tradrl/execution-policy` (T019) and `@tradrl/risk`
 * (T020) are consumed via RELATIVE SOURCE IMPORTS — the Lead may
 * convert to `workspace:*` at the next serialized lockfile change.
 *
 * NO NETWORK this wave: the adapters are injected session ports
 * (scripted fakes in the tests; REAL T039 sessions in the interop
 * tests — real venue binding is post-T041). No credential values
 * anywhere (the trip wire runs over the whole request bundle). No
 * ambient clock (`Date.now()` never appears — the injected
 * InstantSource provides every instant; the golden test proves
 * byte-determinism).
 *
 * Spec anchors: spec/ARCHITECTURE.md Execution — VERBATIM:
 * "Consequential actions require hard controls outside prompts:
 * identity, authorization, limits, venue permissions, rate limits,
 * kill switch, credentials and audit."; spec/SECURITY.md (trust
 * zones: "... execution gateway -> credential boundary ..."; the
 * audit sentence); spec/ADAPTERS.md Execution — VERBATIM: "Every
 * consequential order passes through internal execution
 * authority/risk gates."; ARCHITECTURE-LOCK L7, L8, L9, L12, L14,
 * L16, L20.
 */

// --- execution-policy (T019, RELATIVE SOURCE IMPORT — the frozen-surface law) --
import {
  credentialValueViolations,
  isExecutionPolicy,
  isExecutionVenueState,
  isKillSwitchLog,
  isPortfolioStateMirror,
  isStrategyIntentMirror,
  killSwitchState,
  runExecutionGate,
  verifyKillSwitchChain,
  type ExecutionDecision,
  type ExecutionPolicy,
  type ExecutionPolicyResult,
  type ExecutionVenueState,
  type KillSwitchLog,
  type PortfolioStateMirror,
  type StrategyIntentMirror,
} from '../../../packages/execution-policy/src/index';

// --- risk (T020, RELATIVE SOURCE IMPORT — the frozen-surface law) --------------
import {
  evaluateLimits,
  executionLimitRefusals,
  isExposureRecord,
  isRiskPolicy,
  type ExecutionLimitRefusal,
  type LimitEvaluationRecord,
  type RiskPolicy,
} from '../../../packages/risk/src/index';

// --- execution-authority (T040's own contract package) --------------------------
import {
  canonicalJson,
  deepFreeze,
  fail as authorityFail,
  fnv1a32Hex,
  gatewayAuditRecordAt,
  gatewayOrderRequest,
  grantForScopeRef,
  grantScopeRefusal,
  intentExecutionMode,
  isEntitlementRegistry,
  isRecord,
  isRoutingTable,
  mayRouteToVenue,
  mayUseCredential,
  mintGatewaySubmissionId,
  ok as authorityOk,
  permitsOrderKind,
  rateBudgetFor,
  routeFor,
  startGatewayAuditTrail,
  verifyGatewayAuditChain,
  appendGatewayAuditRecord,
  type EntitlementRegistry,
  type EntitlementRefusal,
  type ExecutionAuthorityResult,
  type GatewayAuditRecord,
  type GatewayAuditTrail,
  type GatewayOrderRequest,
  type GatewaySubmissionId,
  type RoutingTable,
  type TimestampMs,
} from '../../../packages/execution-authority/src/index';

import { type GatewayAdapterBinding, type InstantSource, type RoutingBundleMirror, type RoutingSendFailure } from './ports';

export { scriptedInstants } from './ports';
export type { GatewayAdapterBinding, InstantSource, RoutingBundleMirror, RoutingSendFailure, ScriptedInstants } from './ports';

// ---------------------------------------------------------------------------
// The typed refusal (enumerated data, never free text)
// ---------------------------------------------------------------------------

/**
 * The gateway refusal — the closed stage-discriminated union. Every
 * variant names its PIPELINE STAGE and carries the structured facts
 * of the refusal. A refusal is a RECORD (the T019 law), never an
 * exception: `submitDecision` returns a successful 'refused'
 * submission carrying this record.
 */
export type GatewayRefusal =
  /** Stage 1 — the submitted intent embeds credential MATERIAL (the dotted violation paths). */
  | { readonly stage: 'credential_opacity'; readonly violations: readonly string[] }
  /** Stage 2 — the intent fails the REAL T019 mirror guard. */
  | { readonly stage: 'intent_validation'; readonly reason: string }
  /** Stage 3 — a shadow/paper-mode intent reached the LIVE gateway (mode separation). */
  | { readonly stage: 'shadow_mode'; readonly mode: string }
  /** Stage 4 — the REAL T019 gate refused (the gate's own RefusalDecision, verbatim). */
  | { readonly stage: 'policy_gate'; readonly decision: Record<string, unknown> }
  /** Stage 4 (envelope) — the gate refused to reason over a malformed envelope (portfolio/venue-state/switch gaps). */
  | { readonly stage: 'gate_envelope'; readonly errors: readonly { readonly code: string; readonly message: string }[] }
  /** Stage 5 — the same DecisionId was already submitted (the first stands). */
  | { readonly stage: 'duplicate_decision'; readonly decisionId: string }
  /** Stage 6 — the REAL T020 risk engine reports BREACHING class-kind limits. */
  | { readonly stage: 'risk_limits'; readonly evaluationId: string; readonly refusals: readonly ExecutionLimitRefusal[] }
  /** Stage 6 (envelope) — the risk engine refused to reason over the provided facts. */
  | { readonly stage: 'risk_envelope'; readonly errors: readonly { readonly code: string; readonly message: string }[] }
  /** Stage 7 — the resolved authority grant is unknown / expired / revoked / cross-tenant / not-yet-valid / kind-denied. */
  | { readonly stage: 'authority_grant'; readonly refusal: EntitlementRefusal }
  /** Stage 8 — the venue is not permitted or the credential ref is not bound. */
  | { readonly stage: 'entitlement'; readonly refusal: EntitlementRefusal }
  /** Stage 9 — the venue's rate budget would be exceeded (or none is declared — fail-closed). */
  | {
      readonly stage: 'rate_budget';
      readonly venue: string;
      readonly budget: number;
      readonly observed: number;
      readonly windowMs: number | null;
    }
  /** Stage 10 — the standing kill switch is thrown (the defense-in-depth re-check). */
  | { readonly stage: 'kill_switch'; readonly switchId: string; readonly thrownAt: number; readonly reason: string }
  /** Stage 11 — the (venue, instrument) pair has no declared route / no injected adapter. */
  | { readonly stage: 'routing'; readonly venue: string; readonly instrument: string; readonly reason: 'no_route' | 'no_adapter' }
  /** Stage 12 — the translation contract refused (the authority package's typed errors). */
  | { readonly stage: 'translation'; readonly errors: readonly { readonly code: string; readonly message: string; readonly path?: string }[] }
  /** Stage 13 — the injected adapter refused (its own typed L8/protocol error; ZERO messages sent). */
  | { readonly stage: 'adapter'; readonly error: RoutingSendFailure };

/** Guard: `GatewayRefusal` (stage-discriminated structural check). */
export function isGatewayRefusal(v: unknown): v is GatewayRefusal {
  if (!isRecord(v)) return false;
  switch (v.stage) {
    case 'credential_opacity':
      return Array.isArray(v.violations) && v.violations.every((x: unknown) => typeof x === 'string');
    case 'intent_validation':
      return typeof v.reason === 'string' && v.reason !== '';
    case 'shadow_mode':
      return typeof v.mode === 'string' && v.mode !== '';
    case 'policy_gate':
      return isRecord(v.decision);
    case 'gate_envelope':
    case 'risk_envelope':
      return Array.isArray(v.errors) && v.errors.every((x: unknown) => isRecord(x) && typeof (x as Record<string, unknown>).code === 'string');
    case 'duplicate_decision':
      return typeof v.decisionId === 'string' && v.decisionId !== '';
    case 'risk_limits':
      return typeof v.evaluationId === 'string' && v.evaluationId !== '' && Array.isArray(v.refusals) && v.refusals.length > 0;
    case 'authority_grant':
    case 'entitlement':
      return isRecord(v.refusal);
    case 'rate_budget':
      return (
        typeof v.venue === 'string' &&
        v.venue !== '' &&
        typeof v.budget === 'number' &&
        typeof v.observed === 'number' &&
        (v.windowMs === null || typeof v.windowMs === 'number')
      );
    case 'kill_switch':
      return typeof v.switchId === 'string' && typeof v.thrownAt === 'number' && typeof v.reason === 'string';
    case 'routing':
      return typeof v.venue === 'string' && typeof v.instrument === 'string' && (v.reason === 'no_route' || v.reason === 'no_adapter');
    case 'translation':
      return Array.isArray(v.errors) && v.errors.every((x: unknown) => isRecord(x) && typeof (x as Record<string, unknown>).code === 'string');
    case 'adapter':
      return isRecord(v.error) && typeof (v.error as Record<string, unknown>).code === 'string';
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// The submission record (the outcome log)
// ---------------------------------------------------------------------------

/** One submission's outcome: routed (an order went to the adapter) or refused (the typed record). */
export type GatewaySubmissionRecord =
  | {
      readonly kind: 'routed';
      readonly submissionId: GatewaySubmissionId;
      readonly decisionId: string;
      readonly auditId: string;
      readonly requestRef: string;
      readonly venue: string;
      readonly adapterRef: string;
      readonly channelRef: string;
      readonly routedAt: TimestampMs;
    }
  | {
      readonly kind: 'refused';
      readonly submissionId: GatewaySubmissionId;
      readonly decisionId: string | null;
      readonly auditId: string;
      readonly refusal: GatewayRefusal;
      readonly refusedAt: TimestampMs;
    };

// ---------------------------------------------------------------------------
// The gateway configuration
// ---------------------------------------------------------------------------

/**
 * The gateway's construction bundle. The six Work-Order-named
 * injections (`policy`, `authority`, `routing`, `adapters`,
 * `killSwitch`, `instants`) plus the declared pipeline's required
 * context: the T019 gate's facts (`gate` — portfolio + venue state),
 * the T020 risk stage's facts (`risk` — the risk policy + the
 * measured exposure) and the audit substrate ref (SECURITY.md's audit
 * contents name the substrate explicitly). Every piece is validated
 * at construction — a gateway over malformed facts is inexpressible.
 */
export interface ExecutionGatewayConfig {
  /** The VALIDATED T019 ExecutionPolicy (the hard-gate declaration). */
  readonly policy: ExecutionPolicy;
  /** The T019 gate's fact bundle: the portfolio state + the venue state. */
  readonly gate: {
    readonly portfolio: PortfolioStateMirror;
    readonly venueState: ExecutionVenueState;
  };
  /** The T020 risk stage's fact bundle: the risk policy + the measured exposure. */
  readonly risk: {
    readonly policy: RiskPolicy;
    readonly exposure: unknown;
  };
  /** The entitlement registry (the Default-Deny authority stage's facts). */
  readonly authority: unknown;
  /** The routing table (venue/instrument -> adapter/channel). */
  readonly routing: unknown;
  /** The injected adapter session ports (structural mirrors of the T039 sessions). */
  readonly adapters: readonly GatewayAdapterBinding[];
  /** The standing kill-switch log (T019's; chain-verified at construction). */
  readonly killSwitch: KillSwitchLog;
  /** The injected instant source (no ambient clock — every instant arrives here). */
  readonly instants: InstantSource;
  /** The opaque substrate ref of the cognitive substrate computing the intents (audit contents). */
  readonly substrate: string;
}

// ---------------------------------------------------------------------------
// The gateway session
// ---------------------------------------------------------------------------

/** One per-venue rate window's mutable accounting (internal state; the snapshot is exposed). */
interface RateWindow {
  anchor: number;
  count: number;
}

/** The execution gateway session: the chokepoint itself. */
export interface ExecutionGatewaySession {
  /** The single entry point: submit one strategy intent through the whole pipeline. */
  submitDecision(intent: unknown): ExecutionAuthorityResult<GatewaySubmissionRecord>;
  /** The append-only, chain-verified audit trail (SECURITY.md's audit contents). */
  auditTrail(): GatewayAuditTrail;
  /** The outcome log: every submission's record, in order. */
  submissions(): readonly GatewaySubmissionRecord[];
  /** The per-venue rate-window accounting (deterministic snapshot). */
  rateState(): readonly { readonly venue: string; readonly anchor: number; readonly count: number }[];
  /** Re-verify the whole session's coherence: the audit chain, the 1:1 submission<->audit law and the seen-decision set. */
  verifyGatewayCoherence(): ExecutionAuthorityResult<null>;
}

/** The gateway construction result. */
export type GatewayConstruction =
  | { readonly ok: true; readonly gateway: ExecutionGatewaySession }
  | { readonly ok: false; readonly errors: readonly { readonly code: string; readonly message: string; readonly path?: string }[] };

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * Construct the execution gateway — the chokepoint. Construction
 * validates EVERY injected piece (fail-closed: a gateway over
 * malformed facts is inexpressible):
 *   - the policy passes the REAL T019 guard;
 *   - the gate facts pass the REAL T019 mirror guards;
 *   - the risk policy passes the REAL T020 guard and the exposure the
 *     REAL T020 exposure guard;
 *   - the authority registry and routing table pass the authority
 *     validators (the opacity trip wire included);
 *   - the kill-switch log chain-verifies under the REAL T019 verifier;
 *   - the adapters are well-formed bindings with unique adapter refs;
 *   - the instant source and the substrate ref are present;
 *   - the SCOPE COHERENCE law (L12): the policy, the registry and the
 *     routing table share ONE tenant/project scope — a gateway whose
 *     lanes disagree about the tenant is inexpressible (the
 *     cross-tenant grant-reuse crime dies at construction).
 */
export function createExecutionGateway(config: unknown): GatewayConstruction {
  if (!isRecord(config)) {
    return { ok: false, errors: [{ code: 'invalid_type', message: 'createExecutionGateway requires a configuration object' }] };
  }
  const errors: { code: string; message: string; path?: string }[] = [];

  // --- The policy (T019's guard). ---
  if (!isExecutionPolicy(config.policy)) {
    errors.push({ code: 'invalid_field', message: 'config.policy must be a validated T019 ExecutionPolicy (see validateExecutionPolicy)', path: 'policy' });
  }
  const policy = config.policy as ExecutionPolicy;

  // --- The gate facts (T019's guards). ---
  const gate = config.gate;
  if (!isRecord(gate)) {
    errors.push({ code: 'missing_field', message: 'config.gate is required (the T019 gate facts: portfolio + venue state)', path: 'gate' });
  } else {
    if (!isPortfolioStateMirror(gate.portfolio)) {
      errors.push({ code: 'invalid_field', message: 'config.gate.portfolio must be a valid portfolio-state mirror', path: 'gate.portfolio' });
    }
    if (!isExecutionVenueState(gate.venueState)) {
      errors.push({ code: 'invalid_field', message: 'config.gate.venueState must be a valid execution venue state', path: 'gate.venueState' });
    }
  }

  // --- The risk facts (T020's guards). ---
  const risk = config.risk;
  if (!isRecord(risk)) {
    errors.push({ code: 'missing_field', message: 'config.risk is required (the T020 risk stage facts: policy + exposure)', path: 'risk' });
  } else {
    if (!isRiskPolicy(risk.policy)) {
      errors.push({ code: 'invalid_field', message: 'config.risk.policy must be a validated T020 RiskPolicy (see validateRiskPolicy/compileRiskPolicy)', path: 'risk.policy' });
    }
    if (!isExposureRecord(risk.exposure)) {
      errors.push({ code: 'invalid_field', message: 'config.risk.exposure must be a valid T020 ExposureRecord (see computeExposure)', path: 'risk.exposure' });
    }
  }

  // --- The authority registry + the routing table (the authority validators). ---
  if (!isEntitlementRegistry(config.authority)) {
    errors.push({ code: 'invalid_field', message: 'config.authority must be a valid EntitlementRegistry (see validateEntitlementRegistry)', path: 'authority' });
  }
  if (!isRoutingTable(config.routing)) {
    errors.push({ code: 'invalid_field', message: 'config.routing must be a valid RoutingTable (see validateRoutingTable)', path: 'routing' });
  }
  const registry = config.authority as unknown as EntitlementRegistry;
  const routing = config.routing as unknown as RoutingTable;

  // --- The scope-coherence law (L12). ---
  if (isExecutionPolicy(config.policy) && isEntitlementRegistry(config.authority) && isRoutingTable(config.routing)) {
    if (registry.tenant !== policy.tenant || registry.project !== policy.project) {
      errors.push({
        code: 'tenant_missing',
        message: `the authority registry's scope (${registry.tenant}/${registry.project}) does not match the policy's (${policy.tenant}/${policy.project}) — a gateway whose lanes disagree about the tenant is inexpressible (L12: cross-tenant grant reuse dies at construction)`,
        path: 'authority',
      });
    }
    if (routing.tenant !== policy.tenant || routing.project !== policy.project) {
      errors.push({
        code: 'tenant_missing',
        message: `the routing table's scope (${routing.tenant}/${routing.project}) does not match the policy's (${policy.tenant}/${policy.project}) — L12 scope coherence`,
        path: 'routing',
      });
    }
  }

  // --- The adapters (the injected ports). ---
  if (!Array.isArray(config.adapters)) {
    errors.push({ code: 'missing_field', message: 'config.adapters is required (the injected adapter session ports)', path: 'adapters' });
  } else {
    const seen = new Set<string>();
    for (let index = 0; index < config.adapters.length; index++) {
      const binding: unknown = config.adapters[index];
      if (
        !isRecord(binding) ||
        typeof binding.adapterRef !== 'string' ||
        !binding.adapterRef.startsWith('adapter:') ||
        !isRecord(binding.port) ||
        typeof (binding.port as Record<string, unknown>).routeOrder !== 'function'
      ) {
        errors.push({ code: 'invalid_field', message: `config.adapters[${index}] must be { adapterRef, port } with an opaque adapter: ref and a routeOrder port`, path: `adapters[${index}]` });
        continue;
      }
      const ref = binding.adapterRef as string;
      if (seen.has(ref)) {
        errors.push({ code: 'invalid_field', message: `config.adapters[${index}] repeats adapter ref ${ref} — one binding per adapter`, path: `adapters[${index}]` });
      }
      seen.add(ref);
    }
  }

  // --- The kill switch (T019's chain verifier). ---
  const killSwitchCandidate: unknown = config.killSwitch;
  if (!isKillSwitchLog(killSwitchCandidate)) {
    errors.push({ code: 'invalid_field', message: 'config.killSwitch must be a valid T019 KillSwitchLog', path: 'killSwitch' });
  } else if (isExecutionPolicy(config.policy) && killSwitchCandidate.switchId !== policy.killSwitch.switchId) {
    errors.push({
      code: 'invalid_field',
      message: `the kill-switch log (${killSwitchCandidate.switchId}) is not the policy's declared switch (${policy.killSwitch.switchId}) — the policy enforces exactly one standing switch`,
      path: 'killSwitch',
    });
  } else {
    const verified = verifyKillSwitchChain(killSwitchCandidate);
    if (!verified.ok) {
      errors.push({ code: 'killswitch_rewrite', message: 'config.killSwitch fails chain verification — the gateway never enforces a tampered switch', path: 'killSwitch' });
    }
  }

  // --- The instant source + the substrate ref. ---
  if (!isRecord(config.instants) || typeof (config.instants as Record<string, unknown>).next !== 'function') {
    errors.push({ code: 'invalid_field', message: 'config.instants must be an injected InstantSource (next() -> epoch ms; no ambient clock)', path: 'instants' });
  }
  if (typeof config.substrate !== 'string' || (config.substrate as string).trim() === '') {
    errors.push({ code: 'invalid_field', message: 'config.substrate must be a non-empty opaque substrate ref (SECURITY.md audit contents)', path: 'substrate' });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // --- The internal state (the chokepoint's ledger). ---
  const adapters: readonly GatewayAdapterBinding[] = config.adapters as readonly GatewayAdapterBinding[];
  const killSwitch = config.killSwitch as KillSwitchLog;
  const instants = config.instants as InstantSource;
  const gateFacts = (config.gate as { portfolio: PortfolioStateMirror; venueState: ExecutionVenueState });
  const riskFacts = (config.risk as { policy: RiskPolicy; exposure: unknown });
  const substrateRef = config.substrate as string;

  let audit = startTrail(policy);
  let submissionLog: GatewaySubmissionRecord[] = [];
  const seenDecisions = new Set<string>();
  const rateWindows = new Map<string, RateWindow>();
  let lastInstant: number | null = null;

  function startTrail(thePolicy: ExecutionPolicy): GatewayAuditTrail {
    const started = startGatewayAuditTrail(thePolicy.tenant, thePolicy.project);
    if (!started.ok) throw new Error(`the audit trail must start: ${JSON.stringify(started.errors)}`);
    return started.value;
  }

  // -------------------------------------------------------------------------
  // submitDecision — the single entry point (the declared pipeline)
  // -------------------------------------------------------------------------

  function submitDecision(intent: unknown): ExecutionAuthorityResult<GatewaySubmissionRecord> {
    // The submission instant: consumed EXACTLY ONCE, monotonicity-checked.
    const now: number = instants.next();
    if (typeof now !== 'number' || !Number.isSafeInteger(now) || now < 0) {
      return authorityFail('invalid_field', 'the injected instant source produced a non-epoch-ms instant — the gateway never invents time');
    }
    if (lastInstant !== null && now < lastInstant) {
      return authorityFail('invalid_field', `the injected instant source regressed (${now} < ${lastInstant}) — a broken clock is a typed error, never silently accepted`);
    }
    lastInstant = now;

    // ---- Stage 1: credential opacity (FIRST — T039's law). ------------------
    const violations = credentialValueViolations(intent);
    if (violations.length > 0) {
      return refuseNow(now, null, { stage: 'credential_opacity', violations });
    }

    // ---- Stage 2: intent validation (the REAL T019 mirror guard). -----------
    if (!isStrategyIntentMirror(intent)) {
      return refuseNow(now, null, {
        stage: 'intent_validation',
        reason: 'the submitted intent fails the T019 StrategyIntentMirror guard (the gateway never reasons over a malformed request)',
      });
    }
    const theIntent: StrategyIntentMirror = intent;

    // ---- Stage 3: shadow/live mode separation (T030's lane is upstream). ----
    const mode = intentExecutionMode(theIntent);
    if (mode !== null && mode !== 'live') {
      return refuseNow(now, null, { stage: 'shadow_mode', mode });
    }

    // ---- Stage 4: the REAL T019 gate. ----------------------------------------
    const gateResult = runExecutionGate({
      intent: theIntent,
      policy,
      portfolio: gateFacts.portfolio,
      venueState: gateFacts.venueState,
      killSwitch,
    });
    if (!gateResult.ok) {
      // The gate refused to REASON (a malformed envelope — portfolio/venue-state/switch facts).
      return refuseNow(now, null, {
        stage: 'gate_envelope',
        errors: gateResult.errors.map((error) => ({ code: error.code, message: error.message })),
      });
    }
    const decision: ExecutionDecision = gateResult.value;
    if (decision.kind === 'refuse') {
      // The gate REFUSED — its own structured record, carried verbatim.
      return refuseNow(now, decision.decisionId, {
        stage: 'policy_gate',
        decision: decision as unknown as Record<string, unknown>,
      });
    }

    // ---- Stage 5: approval replay (one decision, one submission). ------------
    // The replayed decision is already audited under ITS record (one decision,
    // one audit record): the refusal's audit entry carries a NULL decision id
    // while the refusal record itself carries the replayed id (the evidence).
    if (seenDecisions.has(decision.decisionId)) {
      return refuseNow(now, null, { stage: 'duplicate_decision', decisionId: decision.decisionId });
    }

    // ---- Stage 6: the REAL T020 risk engine. ---------------------------------
    const riskResult = evaluateLimits({ exposure: riskFacts.exposure, policy: riskFacts.policy, killSwitch });
    if (!riskResult.ok) {
      return refuseNow(now, decision.decisionId, {
        stage: 'risk_envelope',
        errors: riskResult.errors.map((error) => ({ code: error.code, message: error.message })),
      });
    }
    const evaluation: LimitEvaluationRecord = riskResult.value;
    const limitRefusals = executionLimitRefusals(evaluation);
    if (limitRefusals.length > 0) {
      return refuseNow(now, decision.decisionId, {
        stage: 'risk_limits',
        evaluationId: evaluation.evaluationId,
        refusals: limitRefusals,
      });
    }

    // ---- Stage 7: the authority grant (valid, unrevoked, inside its window). --
    const venue = theIntent.order.venueId;
    const instrument = theIntent.order.instrumentId;
    const orderKind = theIntent.order.kind;
    const declared = policy.authorization.find((grant) => grant.orderKinds.includes(orderKind));
    if (declared === undefined) {
      // Defense in depth: the gate's authorization check already refused
      // undeclared kinds; a gap here is a policy/registry drift, refused closed.
      return refuseNow(now, decision.decisionId, {
        stage: 'authority_grant',
        refusal: { kind: 'missing_entitlement', subject: 'order_kind', grantId: '(undeclared)', orderKind },
      });
    }
    const grant = grantForScopeRef(registry, declared.scopeRef);
    if (grant === null) {
      return refuseNow(now, decision.decisionId, {
        stage: 'authority_grant',
        refusal: { kind: 'unknown_grant', scopeRef: declared.scopeRef },
      });
    }
    const scopeRefusal = grantScopeRefusal(grant, policy.tenant, policy.project, now as TimestampMs);
    if (scopeRefusal !== null) {
      return refuseNow(now, decision.decisionId, { stage: 'authority_grant', refusal: scopeRefusal });
    }
    const kindRefusal = permitsOrderKind(grant, orderKind);
    if (kindRefusal !== null) {
      return refuseNow(now, decision.decisionId, { stage: 'authority_grant', refusal: kindRefusal });
    }

    // ---- Stage 8: entitlement (venue permitted + credential bound). ----------
    const venueRefusal = mayRouteToVenue(registry, grant, venue);
    if (venueRefusal !== null) {
      return refuseNow(now, decision.decisionId, { stage: 'entitlement', refusal: venueRefusal });
    }
    const binding = policy.credentials.find((entry) => entry.venue === venue);
    if (binding === undefined) {
      // Defense in depth: the gate's credentials check already refused
      // unbound venues; a gap here is drift, refused closed.
      return refuseNow(now, decision.decisionId, {
        stage: 'entitlement',
        refusal: { kind: 'missing_entitlement', subject: 'credential', grantId: grant.grantId, venue },
      });
    }
    const credentialRefusal = mayUseCredential(grant, venue, binding.credentialRef);
    if (credentialRefusal !== null) {
      return refuseNow(now, decision.decisionId, { stage: 'entitlement', refusal: credentialRefusal });
    }

    // ---- Stage 9: the rate budget (the gateway's own window threading). ------
    const budget = rateBudgetFor(grant, venue);
    if (budget === null) {
      return refuseNow(now, decision.decisionId, {
        stage: 'rate_budget',
        venue,
        budget: 0,
        observed: 0,
        windowMs: null,
      });
    }
    let window = rateWindows.get(venue);
    if (window === undefined || now >= window.anchor + budget.windowMs) {
      window = { anchor: now, count: 0 };
      rateWindows.set(venue, window);
    }
    const projected = window.count + 1;
    if (projected > budget.maxOrders) {
      return refuseNow(now, decision.decisionId, {
        stage: 'rate_budget',
        venue,
        budget: budget.maxOrders,
        observed: window.count,
        windowMs: budget.windowMs,
      });
    }

    // ---- Stage 10: the standing kill switch (defense in depth). --------------
    if (killSwitchState(killSwitch) === 'thrown') {
      const thrownRecord = [...killSwitch.records].reverse().find((record) => record.state === 'thrown');
      const thrownAt = thrownRecord?.thrownAt ?? now;
      const reason = thrownRecord?.reason ?? '(unreadable throw evidence)';
      return refuseNow(now, decision.decisionId, {
        stage: 'kill_switch',
        switchId: policy.killSwitch.switchId,
        thrownAt,
        reason,
      });
    }

    // ---- Stage 11: routing (the declared route + the injected adapter). ------
    const route = routeFor(routing, venue, instrument);
    if (route === null) {
      return refuseNow(now, decision.decisionId, { stage: 'routing', venue, instrument, reason: 'no_route' });
    }
    const adapterBinding = adapters.find((entry) => entry.adapterRef === route.adapterRef);
    if (adapterBinding === undefined) {
      return refuseNow(now, decision.decisionId, { stage: 'routing', venue, instrument, reason: 'no_adapter' });
    }

    // ---- Stage 12: the translation contract (the authority package). ---------
    const requestResult = gatewayOrderRequest({
      decision,
      order: theIntent.order,
      route: { venue: route.venue, adapterRef: route.adapterRef, channelRef: route.channelRef },
      grantRef: declared.scopeRef,
      credentialRef: binding.credentialRef,
      kill_switch: { state: 'standing' },
      asOf: now as TimestampMs,
    });
    if (!requestResult.ok) {
      return refuseNow(now, decision.decisionId, {
        stage: 'translation',
        errors: requestResult.errors.map((error) => ({ code: error.code, message: error.message, ...(error.path === undefined ? {} : { path: error.path }) })),
      });
    }
    const request: GatewayOrderRequest = requestResult.value;

    // ---- Stage 13: the adapter call (the injected port; ZERO prior calls). ---
    const bundle: RoutingBundleMirror = deepFreeze({
      decision,
      intent: theIntent.order,
      kill_switch: { state: 'standing' },
      credential_ref: binding.credentialRef,
      route: { venue: route.venue, credential_ref: binding.credentialRef },
    });
    const sent = adapterBinding.port.routeOrder(bundle);
    if (!sent.ok) {
      return refuseNow(now, decision.decisionId, {
        stage: 'adapter',
        error: { kind: sent.error.kind, code: sent.error.code, message: sent.error.message },
      });
    }

    // ---- The routed outcome: the rate window consumes. -----------------------
    window.count = projected;
    return routedNow(now, request);
  }

  // -------------------------------------------------------------------------
  // The emission sites (the single construction discipline for both outcomes)
  // -------------------------------------------------------------------------

  /** The audit-visible venue facts for the intent's (venue, instrument) pair (best-effort pre-validation). */
  function visibleFactsOf(intent: unknown): {
    readonly venue: string;
    readonly instrument: string;
    readonly instrumentClass: string;
    readonly referencePrice: string;
    readonly rateWindowOrderCount: number;
  } {
    const unreadable = '(unreadable)';
    let venue = unreadable;
    let instrument = unreadable;
    if (isRecord(intent)) {
      const order = intent.order;
      if (isRecord(order)) {
        if (typeof order.venueId === 'string' && order.venueId !== '') venue = order.venueId;
        if (typeof order.instrumentId === 'string' && order.instrumentId !== '') instrument = order.instrumentId;
      }
    }
    const covered = isRecord(gateFacts.venueState)
      ? (gateFacts.venueState.instruments as readonly { venue: string; instrument: string; instrumentClass: string; referencePrice: string; rateWindowOrderCount: number }[]).find(
          (entry) => entry.venue === venue && entry.instrument === instrument,
        )
      : undefined;
    return {
      venue,
      instrument,
      instrumentClass: covered === undefined ? '(unresolved)' : covered.instrumentClass,
      referencePrice: covered === undefined ? '(unresolved)' : covered.referencePrice,
      rateWindowOrderCount: covered === undefined ? 0 : covered.rateWindowOrderCount,
    };
  }

  /** The audit lineage block (the intent's facts; identical to the decision's own lineage by the gate's construction). */
  function lineageOf(intent: unknown) {
    const unreadable = '(unreadable)';
    if (isRecord(intent) && isStrategyIntentMirror(intent)) {
      return {
        intentRef: intent.intentId,
        strategy: { specId: intent.strategy.specId, version: intent.strategy.version },
        goal: { goalId: intent.goal.goalId, version: intent.goal.version },
        policy: { policyId: policy.policyId, version: policy.version },
        venues: [intent.order.venueId],
        seed: intent.seed,
        tenant: intent.tenant,
        project: intent.project,
      };
    }
    return {
      intentRef: unreadable,
      strategy: { specId: unreadable, version: 1 },
      goal: { goalId: unreadable, version: 1 },
      policy: { policyId: policy.policyId, version: policy.version },
      venues: [unreadable],
      seed: unreadable,
      tenant: policy.tenant,
      project: policy.project,
    };
  }

  /** The refusal summary (the lane-agnostic audit block). */
  function refusalSummaryOf(refusal: GatewayRefusal): { stage: string; code: string; detail: unknown } {
    switch (refusal.stage) {
      case 'credential_opacity':
        return { stage: refusal.stage, code: 'credential_value_present', detail: { violations: refusal.violations } };
      case 'intent_validation':
        return { stage: refusal.stage, code: 'invalid_intent', detail: { reason: refusal.reason } };
      case 'shadow_mode':
        return { stage: refusal.stage, code: 'shadow_mode_refused', detail: { mode: refusal.mode } };
      case 'policy_gate':
        return { stage: refusal.stage, code: 'gate_refused', detail: { failure: (refusal.decision as Record<string, unknown>).failure ?? null } };
      case 'gate_envelope':
      case 'risk_envelope':
        return { stage: refusal.stage, code: 'envelope_error', detail: { errors: refusal.errors } };
      case 'duplicate_decision':
        return { stage: refusal.stage, code: 'duplicate_decision', detail: { decisionId: refusal.decisionId } };
      case 'risk_limits':
        return { stage: refusal.stage, code: 'limits_breaching', detail: { evaluationId: refusal.evaluationId, refusals: refusal.refusals } };
      case 'authority_grant':
      case 'entitlement':
        return { stage: refusal.stage, code: refusal.refusal.kind, detail: refusal.refusal };
      case 'rate_budget':
        return { stage: refusal.stage, code: 'rate_budget_exhausted', detail: { venue: refusal.venue, budget: refusal.budget, observed: refusal.observed, windowMs: refusal.windowMs } };
      case 'kill_switch':
        return { stage: refusal.stage, code: 'kill_switch_thrown', detail: { switchId: refusal.switchId, thrownAt: refusal.thrownAt } };
      case 'routing':
        return { stage: refusal.stage, code: refusal.reason, detail: { venue: refusal.venue, instrument: refusal.instrument } };
      case 'translation':
        return { stage: refusal.stage, code: refusal.errors[0]?.code ?? 'translation_refused', detail: { errors: refusal.errors } };
      case 'adapter':
        return { stage: refusal.stage, code: refusal.error.code, detail: { kind: refusal.error.kind, message: refusal.error.message } };
    }
  }

  /** Build + append the audit record, mint the submission record, and return the outcome. */
  function emit(
    now: number,
    intent: unknown,
    decisionId: string | null,
    decisionKind: 'approve' | 'refuse' | null,
    outcome:
      | { readonly kind: 'routed'; readonly request: GatewayOrderRequest }
      | { readonly kind: 'refused'; readonly refusal: GatewayRefusal; readonly adapterCalled: boolean },
  ): ExecutionAuthorityResult<GatewaySubmissionRecord> {
    const facts = visibleFactsOf(intent);
    const riskFactsRecord = riskFacts.exposure as { exposureId?: unknown };
    const summary = outcome.kind === 'routed' ? null : refusalSummaryOf(outcome.refusal);
    const content = {
      who: {
        bodyVersion: whoBodyVersionOf(intent, decisionKind),
        intentRef: whoIntentRefOf(intent),
        decisionId,
        decisionKind,
        clientOrderId: whoClientOrderIdOf(intent),
      },
      substrate: substrateRef,
      policy: { policyId: policy.policyId, version: policy.version },
      visibleState: {
        venue: facts.venue,
        instrument: facts.instrument,
        instrumentClass: facts.instrumentClass,
        referencePrice: facts.referencePrice,
        rateWindowOrderCount: facts.rateWindowOrderCount,
        riskExposureRef: typeof riskFactsRecord?.exposureId === 'string' ? riskFactsRecord.exposureId : null,
      },
      riskChecks: riskChecksOf(outcome.kind),
      order:
        outcome.kind === 'routed'
          ? {
              adapterRef: outcome.request.route.adapterRef,
              channelRef: outcome.request.route.channelRef,
              credentialRef: outcome.request.credentialRef,
              clientOrderId: outcome.request.order.clientOrderId,
              requestRef: outcome.request.requestRef,
            }
          : null,
      execution:
        outcome.kind === 'routed'
          ? { routed: true, submissionAt: now as TimestampMs, messageDigest: bundleDigestOf(outcome.request) }
          : outcome.adapterCalled
            ? { routed: false, submissionAt: now as TimestampMs, messageDigest: null }
            : null,
      outcome: outcome.kind === 'routed' ? ('routed' as const) : ('refused' as const),
      refusal: summary === null ? null : { stage: summary.stage, code: summary.code, detail: summary.detail as never },
      lineage: lineageOf(intent),
      tenant: policy.tenant,
      project: policy.project,
      asOf: now as TimestampMs,
    };
    const minted = gatewayAuditRecordAt(audit, content as never);
    if (!minted.ok) {
      return authorityFail('invalid_type', `the audit record failed its own guard: ${JSON.stringify(minted.errors)}`);
    }
    const appended = appendGatewayAuditRecord(audit, minted.value);
    if (!appended.ok) {
      return authorityFail('audit_rewrite', `the audit trail refused the append: ${JSON.stringify(appended.errors)}`);
    }
    audit = appended.value;
    // One decision, one audit record: every audited decision id is seen from
    // now on (routed OR refused post-gate — a replay is a replay either way).
    if (decisionId !== null) {
      seenDecisions.add(decisionId);
    }

    // The submission record (content-addressed; deterministic).
    const submissionContent = {
      sequence: submissionLog.length + 1,
      kind: outcome.kind,
      decisionId,
      refusalStage: outcome.kind === 'refused' ? outcome.refusal.stage : null,
      refusalCode: outcome.kind === 'refused' ? refusalSummaryOf(outcome.refusal).code : null,
      requestRef: outcome.kind === 'routed' ? outcome.request.requestRef : null,
      at: now,
    };
    const submissionId = mintGatewaySubmissionId(fnv1a32Hex(canonicalJson(submissionContent as never)));
    if (outcome.kind === 'routed') {
      const record: GatewaySubmissionRecord = deepFreeze({
        kind: 'routed',
        submissionId,
        decisionId: decisionId as string,
        auditId: minted.value.auditId,
        requestRef: outcome.request.requestRef,
        venue: outcome.request.route.venue,
        adapterRef: outcome.request.route.adapterRef,
        channelRef: outcome.request.route.channelRef,
        routedAt: now as TimestampMs,
      });
      submissionLog = [...submissionLog, record];
      return authorityOk(record);
    }
    const refused: GatewaySubmissionRecord = deepFreeze({
      kind: 'refused',
      submissionId,
      decisionId,
      auditId: minted.value.auditId,
      refusal: outcome.refusal,
      refusedAt: now as TimestampMs,
    });
    submissionLog = [...submissionLog, refused];
    return authorityOk(refused);
  }

  function whoBodyVersionOf(intent: unknown, decisionKind: 'approve' | 'refuse' | null): { specId: string; version: number } {
    if (isStrategyIntentMirror(intent)) {
      return { specId: intent.strategy.specId, version: intent.strategy.version };
    }
    void decisionKind;
    return { specId: '(unreadable)', version: 1 };
  }

  function whoIntentRefOf(intent: unknown): string {
    if (isStrategyIntentMirror(intent)) return intent.intentId;
    if (isRecord(intent) && typeof intent.intentId === 'string' && intent.intentId !== '') return intent.intentId;
    return '(unreadable)';
  }

  function whoClientOrderIdOf(intent: unknown): string {
    if (isStrategyIntentMirror(intent)) return intent.order.clientOrderId;
    if (isRecord(intent) && isRecord(intent.order) && typeof intent.order.clientOrderId === 'string' && intent.order.clientOrderId !== '') {
      return intent.order.clientOrderId;
    }
    return '(unreadable)';
  }

  function riskChecksOf(outcomeKind: 'routed' | 'refused'): { evaluationId: string | null; riskPolicy: { policyId: string; version: number }; within: number; breaching: number; blocked: number } {
    const riskPolicy = riskFacts.policy as RiskPolicy;
    if (outcomeKind === 'refused') {
      // The risk stage may or may not have run; the counts are honest zeros
      // when it did not (the refusal summary carries the stage facts).
      return { evaluationId: null, riskPolicy: { policyId: riskPolicy.policyId, version: riskPolicy.version }, within: 0, breaching: 0, blocked: 0 };
    }
    // For routed submissions the risk stage ran and reported no breaching
    // class kinds; re-derive the counts deterministically from the evaluation.
    const evaluation = evaluateLimits({ exposure: riskFacts.exposure, policy: riskFacts.policy, killSwitch });
    if (!evaluation.ok) {
      return { evaluationId: null, riskPolicy: { policyId: riskPolicy.policyId, version: riskPolicy.version }, within: 0, breaching: 0, blocked: 0 };
    }
    const states = evaluation.value.states;
    return {
      evaluationId: evaluation.value.evaluationId,
      riskPolicy: { policyId: riskPolicy.policyId, version: riskPolicy.version },
      within: states.filter((state) => state.state === 'within').length,
      breaching: states.filter((state) => state.state === 'breaching').length,
      blocked: states.filter((state) => state.state === 'blocked').length,
    };
  }

  /** The routed bundle's stable digest (the audit's execution evidence). */
  function bundleDigestOf(request: GatewayOrderRequest): string {
    return fnv1a32Hex(canonicalJson({
      decision: { decisionId: request.decision.decisionId, intentRef: request.decision.intentRef },
      order: { clientOrderId: request.order.clientOrderId, instrumentId: request.order.instrumentId, venueId: request.order.venueId },
      route: { venue: request.route.venue, adapterRef: request.route.adapterRef, channelRef: request.route.channelRef },
      credentialRef: request.credentialRef,
      grantRef: request.grantRef,
      asOf: request.asOf,
    } as never));
  }

  /** The refusal emission path (stage facts + audit; ZERO adapter calls by construction). */
  function refuseNow(
    now: number,
    decisionId: string | null,
    refusal: GatewayRefusal,
  ): ExecutionAuthorityResult<GatewaySubmissionRecord> {
    const decisionKind: 'approve' | 'refuse' | null = decisionId === null ? null : refusal.stage === 'policy_gate' ? 'refuse' : 'approve';
    // The policy_gate refusal's decisionId belongs to the gate's refusal decision.
    return emit(now, currentIntent, decisionId, decisionKind, { kind: 'refused', refusal, adapterCalled: refusal.stage === 'adapter' });
  }

  /** The routed emission path. */
  function routedNow(now: number, request: GatewayOrderRequest): ExecutionAuthorityResult<GatewaySubmissionRecord> {
    return emit(now, currentIntent, request.decision.decisionId, 'approve', { kind: 'routed', request });
  }

  // The submission-scoped intent handle (set at submitDecision entry; the
  // emission sites read it — a deliberately simple single-threaded design;
  // the gateway is one chokepoint, not a concurrency arena).
  let currentIntent: unknown = null;

  // Wrap submitDecision to set the handle around the pipeline.
  const submitDecisionInner = submitDecision;
  function submitDecisionOuter(intent: unknown): ExecutionAuthorityResult<GatewaySubmissionRecord> {
    currentIntent = intent;
    try {
      return submitDecisionInner(intent);
    } finally {
      currentIntent = null;
    }
  }

  // -------------------------------------------------------------------------
  // The session surface
  // -------------------------------------------------------------------------

  const session: ExecutionGatewaySession = deepFreeze({
    submitDecision: submitDecisionOuter,
    auditTrail(): GatewayAuditTrail {
      return audit;
    },
    submissions(): readonly GatewaySubmissionRecord[] {
      return submissionLog;
    },
    rateState(): readonly { venue: string; anchor: number; count: number }[] {
      return [...rateWindows.entries()]
        .map(([venue, window]) => ({ venue, anchor: window.anchor, count: window.count }))
        .sort((a, b) => (a.venue < b.venue ? -1 : a.venue > b.venue ? 1 : 0));
    },
    verifyGatewayCoherence(): ExecutionAuthorityResult<null> {
      const verified = verifyGatewayAuditChain(audit);
      if (!verified.ok) return verified;
      if (audit.records.length !== submissionLog.length) {
        return authorityFail('audit_rewrite', `the audit trail carries ${audit.records.length} records but the outcome log carries ${submissionLog.length} submissions — one submission, one audit record (a tail truncation is a rewrite)`);
      }
      for (let index = 0; index < submissionLog.length; index++) {
        const submission = submissionLog[index] as GatewaySubmissionRecord;
        const record = audit.records[index] as GatewayAuditRecord;
        if (submission.auditId !== record.auditId) {
          return authorityFail('audit_rewrite', `submission ${index}'s audit id (${submission.auditId}) is not the trail's record ${index} (${record.auditId}) — the trail and the outcome log diverged`);
        }
        if (submission.decisionId !== record.who.decisionId) {
          return authorityFail('audit_rewrite', `submission ${index}'s decision id does not match its audit record's — the logs diverged`);
        }
      }
      return authorityOk(null);
    },
  }) as ExecutionGatewaySession;

  return { ok: true, gateway: session };
}


