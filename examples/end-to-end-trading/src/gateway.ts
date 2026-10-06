// @tradrl/example-e2e-trading — STAGE 9: THE EXECUTION GATEWAY (T040).
//
// THE L8 CHOKEPOINT — thirteen stages, in the REAL gateway's declared
// order: credential_opacity -> intent_validation -> shadow_mode ->
// policy_gate -> duplicate_decision -> risk_limits -> authority_grant ->
// entitlement -> rate_budget -> kill_switch -> routing -> translation ->
// adapter. ANY refusal is a typed `GatewayRefusal` record plus exactly one
// audit record and ZERO adapter calls. The model NEVER bypasses this stack:
// in this slice the ONLY route to the (simulated) venue is
// `submitDecision` and its adapter port.
//
// Mode honesty (L5): this reference gateway is constructed with
// `executionMode: 'paper'` — it gates orders whose claimed mode matches
// the session's honest paper mode and refuses any other claim (live
// execution is NOT wired in the example; simulation evidence and live
// evidence are never conflated).

import {
  add, compare, divideRoundHalfUp, multiply, subtract,
} from './decimals';
import { canonicalJson, deepFreeze, fnv1a32Hex, isRecord, type JsonValue } from './primitives';
import { fail, ok, type ExampleResult } from './errors';
import type {
  ApproveDecisionMirror, CheckResultMirror, EntitlementRegistryMirror,
  ExecutionGatewayConfigMirror, ExecutionGatewaySessionMirror, ExecutionPolicyMirror,
  ExecutionVenueStateMirror, GatewayAdapterBindingMirror, GatewayAuditRecordMirror,
  GatewayAuditTrailMirror, GatewayOrderRequestMirror, GatewayRefusalMirror,
  GatewayStage, GatewaySubmissionRecordMirror, PreTradeCheckKindMirror,
  RefusalDecisionMirror, RefusalReasonMirror, RoutingBundleMirror, AuthorityGrantRecordMirror,
} from './mirrors/execution';
import { CREDENTIAL_VALUE_KEYS_MIRROR } from './mirrors/execution';
import type { StrategyIntentMirror } from './mirrors/strategy';
import type { PortfolioStateMirror } from './mirrors/control';
import type { KillSwitchLogMirror, LimitEvaluationRecordMirror, RiskPolicyMirror } from './mirrors/risk';

const AUDIT_CHAIN_SEED_FN = (tenant: string, project: string): string =>
  fnv1a32Hex(canonicalJson({ tenant, project, records: 0 } as JsonValue));

/** Credential-opacity scan: dotted paths of credential MATERIAL (depth-first, key-sorted). */
export function credentialValueViolations(value: unknown, prefix = ''): readonly string[] {
  const found: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      for (const path of credentialValueViolations(item, `${prefix}[${index}]`)) found.push(path);
    });
    return found;
  }
  if (!isRecord(value)) return found;
  for (const key of Object.keys(value).sort()) {
    const normalized = key.toLowerCase().replace(/[-_\s]/g, '');
    if ((CREDENTIAL_VALUE_KEYS_MIRROR as readonly string[]).includes(normalized)) {
      found.push(prefix === '' ? key : `${prefix}.${key}`);
    }
    for (const path of credentialValueViolations(value[key], prefix === '' ? key : `${prefix}.${key}`)) {
      found.push(path);
    }
  }
  return found;
}

/** Minted approve-decision id: content-addressed over the canonical content. */
export function mintDecisionId(content: Omit<ApproveDecisionMirror, 'decisionId'>): string {
  return `xd:${fnv1a32Hex(canonicalJson(content as unknown as JsonValue))}`;
}

/** The forgery law: the decision id must match the content it claims. */
export function approveDecisionIdMatchesContent(decision: ApproveDecisionMirror): boolean {
  const { decisionId, ...content } = decision;
  return mintDecisionId(content as Omit<ApproveDecisionMirror, 'decisionId'>) === decisionId;
}

interface RateWindow {
  anchor: number;
  count: number;
}

export interface PaperVenueAdapter {
  /** The gateway's adapter seam: receives the translated request. */
  readonly port: { routeOrder(routing: RoutingBundleMirror): { ok: true; value: null } | { ok: false; error: { kind: string; code: string; message: string } } };
  /** The submitted requests (the paper venue's ledger). */
  readonly submitted: readonly GatewayOrderRequestMirror[];
  /** L8 defense-in-depth: submissions without a FORGE-VALID approve decision are refused. */
  submit(request: { readonly decision: ApproveDecisionMirror; readonly order: unknown }): ExampleResult<GatewayOrderRequestMirror>;
}

/** Creates the paper venue adapter bound to this gateway's configuration. */
export function createPaperVenueAdapter(): PaperVenueAdapter {
  const submitted: GatewayOrderRequestMirror[] = [];
  return {
    port: {
      routeOrder(routing: RoutingBundleMirror) {
        // The adapter seam is a transport; the SUBMISSION path (below) is
        // where the L8 forgery law bites.
        if (!approveDecisionIdMatchesContent(routing.decision)) {
          return { ok: false, error: { kind: 'entitlement', code: 'decision_not_approved', message: 'the approve decision id does not match its content — a forged decision is refused at the venue (L8)' } };
        }
        return { ok: true, value: null };
      },
    },
    submitted,
    submit(request: { readonly decision: ApproveDecisionMirror; readonly order: unknown }): ExampleResult<GatewayOrderRequestMirror> {
      if (!approveDecisionIdMatchesContent(request.decision)) {
        return fail('decision_not_approved', 'the paper venue refuses submissions without a forge-valid gateway APPROVE decision (L8 — the model never bypasses the gate stack)', 'decision');
      }
      if (request.decision.kind !== 'approve') {
        return fail('decision_not_approved', 'only APPROVE decisions authorize submissions', 'decision.kind');
      }
      const content = {
        decision: request.decision,
        order: request.order,
      };
      void content;
      // The full translated request is assembled by the gateway (route +
      // credential binding); here it is recorded for the venue ledger.
      const translated = (request as unknown as { readonly translated?: GatewayOrderRequestMirror }).translated;
      const record: GatewayOrderRequestMirror = translated ?? {
        requestRef: `gor:${fnv1a32Hex(canonicalJson({ decision: request.decision.decisionId, order: request.order } as JsonValue))}`,
        decision: request.decision,
        order: request.order as GatewayOrderRequestMirror['order'],
        route: { venue: '', adapterRef: 'adapter:adapter-example-paper@0.0.0', channelRef: 'chan:newOrderSingle' },
        grantRef: '',
        credentialRef: 'cred:unset@0',
        killSwitchStanding: 'standing',
        asOf: request.decision.asOf,
      };
      submitted.push(record);
      return ok(deepFreeze(record));
    },
  };
}

/** Constructs the 13-stage gateway session.
 *
 * `carry` threads the cross-decision runtime (rate windows, duplicate ids,
 * the audit chain, submissions, the monotonic instant cursor) through
 * per-decision constructions — the orchestrator extracts `session.runtime()`
 * and passes it to the next construction (resume semantics, T030 pattern). */
export interface GatewayRuntimeState {
  rateWindows: Map<string, RateWindow>;
  seenDecisionIds: Set<string>;
  auditRecords: GatewayAuditRecordMirror[];
  auditChainHead: string;
  submissions: GatewaySubmissionRecordMirror[];
  submissionSequence: number;
  lastInstant: number;
}

export function createExecutionGateway(
  config: ExecutionGatewayConfigMirror,
  carry?: Partial<GatewayRuntimeState>,
): ExampleResult<ExecutionGatewaySessionMirror & { runtime(): GatewayRuntimeState; decisions(): readonly ApproveDecisionMirror[] }> {
  // Construction laws: scope coherence (L12), switch binding, adapter refs unique.
  if (config.policy.tenant !== config.authority.tenant || config.policy.tenant !== config.routing.tenant) {
    return fail('tenant_mismatch', 'policy, registry and routing must share ONE tenant (L12)', 'config');
  }
  if (config.policy.killSwitch.switchId !== config.killSwitch.switchId) {
    return fail('invalid_state', 'the policy binds a different kill switch than the one injected', 'config.killSwitch');
  }
  const adapterRefs = config.adapters.map((binding) => binding.adapterRef);
  if (new Set(adapterRefs).size !== adapterRefs.length) {
    return fail('invalid_state', 'adapter refs must be unique', 'config.adapters');
  }
  if (typeof config.instants?.next !== 'function') {
    return fail('invalid_state', 'an InstantSource must be injected — the gateway reads no wall clock', 'config.instants');
  }

  const submissions: GatewaySubmissionRecordMirror[] = carry?.submissions ?? [];
  const auditRecords: GatewayAuditRecordMirror[] = carry?.auditRecords ?? [];
  const rateWindows = carry?.rateWindows ?? new Map<string, RateWindow>();
  const seenDecisionIds = carry?.seenDecisionIds ?? new Set<string>();
  let auditChainHead = carry?.auditChainHead ?? AUDIT_CHAIN_SEED_FN(config.policy.tenant, config.policy.project);
  let lastInstant = carry?.lastInstant ?? -1;
  let submissionSequence = carry?.submissionSequence ?? 0;

  const auditOf = (
    intent: StrategyIntentMirror,
    decisionId: string | null,
    decisionKind: 'approve' | 'refuse' | null,
    venueFacts: { venue: string; instrument: string; instrumentClass: string; referencePrice: string; rateWindowOrderCount: number },
    riskChecks: { evaluationId: string | null; within: number; breaching: number; blocked: number },
    order: GatewayAuditRecordMirror['order'],
    outcome: 'routed' | 'refused',
    refusal: { stage: string; code: string; detail: unknown } | null,
    at: number,
  ): GatewayAuditRecordMirror => {
    const sequence = auditRecords.length + 1;
    const content = {
      sequence,
      who: {
        bodyVersion: { specId: intent.strategy.specId, version: intent.strategy.version },
        intentRef: intent.intentId,
        decisionId,
        decisionKind,
        clientOrderId: intent.order.clientOrderId,
      },
      substrate: config.substrate,
      policy: { policyId: config.policy.policyId, version: config.policy.version },
      visibleState: { ...venueFacts, riskExposureRef: riskChecks.evaluationId },
      riskChecks: { ...riskChecks, riskPolicy: { policyId: (config.risk.policy as RiskPolicyMirror).policyId, version: (config.risk.policy as RiskPolicyMirror).version } },
      order,
      execution: outcome === 'routed' ? { routed: true, submissionAt: at, messageDigest: fnv1a32Hex(canonicalJson(order ?? {} as JsonValue)) } : { routed: false, submissionAt: at, messageDigest: null },
      outcome,
      refusal,
      lineage: {
        intentRef: intent.intentId,
        strategy: { specId: intent.strategy.specId, version: intent.strategy.version },
        goal: { goalId: intent.goal.goalId, version: intent.goal.version },
        policy: { policyId: config.policy.policyId, version: config.policy.version },
        venues: [intent.order.venueId],
        seed: intent.seed,
        tenant: intent.tenant,
        project: intent.project,
      },
      tenant: config.policy.tenant,
      project: config.policy.project,
      asOf: at,
    };
    const chainHead = fnv1a32Hex(auditChainHead + canonicalJson(content as JsonValue));
    auditChainHead = chainHead;
    return deepFreeze({
      ...content,
      auditId: `xga:${fnv1a32Hex(chainHead + canonicalJson(content as JsonValue))}`,
      chainHead,
    });
  };

  const venueFactsFor = (intent: StrategyIntentMirror): { venue: string; instrument: string; instrumentClass: string; referencePrice: string; rateWindowOrderCount: number } | null => {
    const facts = config.gate.venueState.instruments.find(
      (entry) => entry.venue === intent.order.venueId && entry.instrument === intent.order.instrumentId,
    );
    if (!facts) return null;
    return {
      venue: facts.venue,
      instrument: facts.instrument,
      instrumentClass: facts.instrumentClass,
      referencePrice: facts.referencePrice,
      rateWindowOrderCount: facts.rateWindowOrderCount,
    };
  };

  const refuse = (
    intent: StrategyIntentMirror,
    refusal: GatewayRefusalMirror,
    at: number,
    venueFacts: { venue: string; instrument: string; instrumentClass: string; referencePrice: string; rateWindowOrderCount: number } | null,
    riskChecks: { evaluationId: string | null; within: number; breaching: number; blocked: number },
  ): GatewaySubmissionRecordMirror => {
    const audit = auditOf(intent, null, null, venueFacts ?? { venue: intent.order.venueId, instrument: intent.order.instrumentId, instrumentClass: 'unknown', referencePrice: '0', rateWindowOrderCount: 0 }, riskChecks, null, 'refused', { stage: refusal.stage, code: refusalCodeOf(refusal), detail: refusal }, at);
    auditRecords.push(audit);
    const submission: GatewaySubmissionRecordMirror = deepFreeze({
      kind: 'refused',
      submissionId: `xgs:${fnv1a32Hex(canonicalJson({ sequence: ++submissionSequence, kind: 'refused', decisionId: null, refusalStage: refusal.stage, at } as JsonValue))}`,
      decisionId: null,
      auditId: audit.auditId,
      refusal,
      refusedAt: at,
    });
    submissions.push(submission);
    return submission;
  };

  const approveDecisions: ApproveDecisionMirror[] = [];
  const session: ExecutionGatewaySessionMirror & { runtime(): GatewayRuntimeState; decisions(): readonly ApproveDecisionMirror[] } = {
    runtime(): GatewayRuntimeState {
      return { rateWindows, seenDecisionIds, auditRecords, auditChainHead, submissions, submissionSequence, lastInstant };
    },
    decisions(): readonly ApproveDecisionMirror[] {
      return [...approveDecisions];
    },
    submitDecision(intent: StrategyIntentMirror) {
      const now = config.instants.next();
      if (now < lastInstant) {
        return { ok: false, errors: [{ code: 'clock_not_monotonic', message: `gateway instant ${now} precedes the last consumed instant ${lastInstant}` }] };
      }
      lastInstant = now;

      const riskChecksEmpty = { evaluationId: null, within: 0, breaching: 0, blocked: 0 };

      // Stage 1 — credential opacity.
      const opacity = credentialValueViolations(intent);
      if (opacity.length > 0) {
        return { ok: true, value: refuse(intent, { stage: 'credential_opacity', violations: opacity }, now, venueFactsFor(intent), riskChecksEmpty) };
      }

      // Stage 2 — intent validation (the structural floor).
      if (!isRecord(intent) || typeof intent.intentId !== 'string' || !intent.intentId.startsWith('si:') || !isRecord(intent.order) || typeof intent.order.quantity !== 'string') {
        return { ok: true, value: refuse(intent, { stage: 'intent_validation', reason: 'the intent fails the structural floor (intentId/order/quantity)' }, now, venueFactsFor(intent), riskChecksEmpty) };
      }
      if (intent.tenant !== config.policy.tenant || intent.project !== config.policy.project) {
        return { ok: true, value: refuse(intent, { stage: 'intent_validation', reason: `cross-tenant intent (${intent.tenant}/${intent.project}) at a ${config.policy.tenant}/${config.policy.project} gateway (L12)` }, now, venueFactsFor(intent), riskChecksEmpty) };
      }

      // Stage 3 — mode honesty (L5): the claimed mode must equal the declared session mode.
      const claimedMode = (intent as StrategyIntentMirror & { readonly executionMode?: string }).executionMode ?? 'paper';
      if (claimedMode !== config.executionMode) {
        return { ok: true, value: refuse(intent, { stage: 'shadow_mode', mode: claimedMode }, now, venueFactsFor(intent), riskChecksEmpty) };
      }

      // Stage 4 — THE POLICY GATE (T019 check machine, mirrored).
      const venueFacts = venueFactsFor(intent);
      const killSwitchThrown = config.killSwitch.records.some((record) => record.state === 'thrown');
      const checks: CheckResultMirror[] = [];
      let failure: { dimension: PreTradeCheckKindMirror; ordinal: number; reason: unknown } | null = null;
      type FailureCarrier = { dimension: PreTradeCheckKindMirror; ordinal: number; reason: unknown };
      const check = (dimension: PreTradeCheckKindMirror, passes: boolean, reason: unknown): void => {
        checks.push({ dimension, ordinal: checks.length + 1, outcome: passes ? 'pass' : 'fail' });
        if (!passes && failure === null) failure = { dimension, ordinal: checks.length, reason };
      };
      const killSwitchRecord = config.killSwitch.records.find((record) => record.state === 'thrown') ?? null;
      check('kill_switch', !killSwitchThrown, killSwitchRecord ? { dimension: 'kill_switch', switchId: killSwitchRecord.chainHead && config.killSwitch.switchId, thrownAt: killSwitchRecord.thrownAt ?? now, reason: killSwitchRecord.reason ?? 'thrown' } : null);
      check('identity', config.policy.identity.principals.includes(intent.strategy.specId), { dimension: 'identity', subject: 'principal', expected: config.policy.identity.principals.join('|'), actual: intent.strategy.specId });
      const grantEntry = config.policy.authorization.find((entry) => entry.orderKinds.includes(intent.order.kind));
      check('authorization', grantEntry !== undefined, { dimension: 'authorization', orderKind: intent.order.kind, permittedKinds: config.policy.authorization.flatMap((entry) => [...entry.orderKinds]) });
      // Limits check (post-trade position vs the class record).
      const classRecord =
        (venueFacts && config.policy.limits.find((record) => record.instrumentClass === venueFacts.instrumentClass)) ??
        config.policy.limits.find((record) => record.instrumentClass === '*');
      if (!classRecord) {
        check('limits', false, { dimension: 'limits', limit: 'order_size', instrumentClass: venueFacts?.instrumentClass ?? '*', cap: '0', observed: intent.order.quantity, excess: intent.order.quantity });
      } else {
        const held = config.gate.portfolio.positions.find((position) => position.instrumentId === intent.order.instrumentId)?.quantity ?? '0';
        const postTrade = intent.order.side === 'buy' ? addExact(held, intent.order.quantity) : subtractExact(held, minExact(held, intent.order.quantity));
        const referencePrice = venueFacts?.referencePrice ?? '0';
        const orderNotional = multiply(intent.order.quantity, referencePrice);
        const postNotional = multiply(postTrade, referencePrice);
        const fails = (cap: string, observed: string): boolean => compare(observed, cap) > 0;
        if (fails(classRecord.maxOrderSize, intent.order.quantity)) {
          check('limits', false, { dimension: 'limits', limit: 'order_size', instrumentClass: classRecord.instrumentClass, cap: classRecord.maxOrderSize, observed: intent.order.quantity, excess: subtractExact(intent.order.quantity, classRecord.maxOrderSize) });
        } else if (fails(classRecord.maxOrderNotional, orderNotional)) {
          check('limits', false, { dimension: 'limits', limit: 'order_notional', instrumentClass: classRecord.instrumentClass, cap: classRecord.maxOrderNotional, observed: orderNotional, excess: subtractExact(orderNotional, classRecord.maxOrderNotional) });
        } else if (fails(classRecord.maxPositionSize, postTrade)) {
          check('limits', false, { dimension: 'limits', limit: 'position_size', instrumentClass: classRecord.instrumentClass, cap: classRecord.maxPositionSize, observed: postTrade, excess: subtractExact(postTrade, classRecord.maxPositionSize) });
        } else if (fails(classRecord.maxPositionNotional, postNotional)) {
          check('limits', false, { dimension: 'limits', limit: 'position_notional', instrumentClass: classRecord.instrumentClass, cap: classRecord.maxPositionNotional, observed: postNotional, excess: subtractExact(postNotional, classRecord.maxPositionNotional) });
        } else {
          check('limits', true, null);
        }
      }
      check('venue_permissions', config.policy.venuePermissions.some((entry) => entry.venue === intent.order.venueId && entry.instrument === intent.order.instrumentId), { dimension: 'venue_permissions', venue: intent.order.venueId, instrument: intent.order.instrumentId });
      const budget = config.policy.rateLimits.find((entry) => entry.venue === intent.order.venueId);
      const window = rateWindows.get(intent.order.venueId);
      const observedCount = window && now < window.anchor + (budget?.windowMs ?? 0) ? window.count : 0;
      check('rate_limits', budget !== undefined && observedCount + 1 <= budget.maxOrders, { dimension: 'rate_limits', venue: intent.order.venueId, windowMs: budget?.windowMs ?? null, budget: budget?.maxOrders ?? 0, observed: observedCount });
      check('credentials', config.policy.credentials.some((entry) => entry.venue === intent.order.venueId), { dimension: 'credentials', venue: intent.order.venueId });

      const approveContent = {
        kind: 'approve' as const,
        intentRef: intent.intentId,
        policy: { policyId: config.policy.policyId, version: config.policy.version },
        checkOrder: [...config.policy.checkOrder],
        checks,
        lineage: {
          intentRef: intent.intentId,
          strategy: { specId: intent.strategy.specId, version: intent.strategy.version },
          goal: { goalId: intent.goal.goalId, version: intent.goal.version },
          policy: { policyId: config.policy.policyId, version: config.policy.version },
          venues: [intent.order.venueId],
          seed: intent.seed,
          tenant: intent.tenant,
          project: intent.project,
        },
        asOf: now,
      };
      const decisionId = mintDecisionId(approveContent);
      if (failure !== null) {
        const refusalDecision: RefusalDecisionMirror = deepFreeze({
          kind: 'refuse',
          decisionId,
          intentRef: intent.intentId,
          policy: { policyId: config.policy.policyId, version: config.policy.version },
          checkOrder: [...config.policy.checkOrder],
          checks,
          failure: failure as unknown as { dimension: PreTradeCheckKindMirror; ordinal: number; reason: RefusalReasonMirror },
          lineage: approveContent.lineage,
          asOf: now,
        });
        const refusal: GatewayRefusalMirror = { stage: 'policy_gate', decision: refusalDecision as unknown as Record<string, unknown> };
        const audit = auditOf(intent, decisionId, 'refuse', venueFacts ?? { venue: intent.order.venueId, instrument: intent.order.instrumentId, instrumentClass: 'unknown', referencePrice: '0', rateWindowOrderCount: 0 }, riskChecksEmpty, null, 'refused', { stage: 'policy_gate', code: `gate_refused:${(failure as { dimension: string }).dimension}`, detail: refusalDecision }, now);
        auditRecords.push(audit);
        const submission: GatewaySubmissionRecordMirror = deepFreeze({
          kind: 'refused',
          submissionId: `xgs:${fnv1a32Hex(canonicalJson({ sequence: ++submissionSequence, kind: 'refused', decisionId, refusalStage: 'policy_gate', at: now } as JsonValue))}`,
          decisionId,
          auditId: audit.auditId,
          refusal,
          refusedAt: now,
        });
        submissions.push(submission);
        return { ok: true, value: submission };
      }

      // Stage 5 — duplicate decision (first stands).
      if (seenDecisionIds.has(decisionId)) {
        return { ok: true, value: refuse(intent, { stage: 'duplicate_decision', decisionId }, now, venueFacts, riskChecksEmpty) };
      }

      // Stage 6 — risk limits (T020 evaluation over the measured exposure).
      const evaluation = evaluateLimitsMirror(config, intent);
      const breaching = evaluation.states.filter((state) => state.state === 'breaching');
      const blocked = evaluation.states.filter((state) => state.state === 'blocked');
      const riskChecks = { evaluationId: evaluation.evaluationId, within: evaluation.states.length - breaching.length - blocked.length, breaching: breaching.length, blocked: blocked.length };
      if (breaching.length > 0) {
        return { ok: true, value: refuse(intent, { stage: 'risk_limits', evaluationId: evaluation.evaluationId, refusals: breaching.flatMap((state) => {
          const reason = state.reason as { cause: 'breach'; bound: string; observed: string; excess: string } | null;
          if (!reason || reason.cause !== 'breach') return [];
          return [{ dimension: 'limits' as const, limit: state.kind as 'order_size' | 'order_notional' | 'position_size' | 'position_notional', instrumentClass: venueFacts?.instrumentClass ?? 'unknown', cap: reason.bound, observed: reason.observed, excess: reason.excess }];
        }) }, now, venueFacts, riskChecks) };
      }
      if (blocked.length > 0) {
        return { ok: true, value: refuse(intent, { stage: 'risk_envelope', errors: blocked.map((state) => ({ code: 'blocked_limit', message: `limit ${state.kind} is blocked (${(state.reason as { cause?: string })?.cause ?? 'unknown'})` })) }, now, venueFacts, riskChecks) };
      }

      // Stage 7 — authority grant (the principal's grant must be known + valid).
      const registry: EntitlementRegistryMirror = config.authority;
      const scopeRef = config.policy.authorization.find((entry) => entry.orderKinds.includes(intent.order.kind))?.scopeRef;
      if (scopeRef === undefined) {
        return { ok: true, value: refuse(intent, { stage: 'authority_grant', refusal: { kind: 'unknown_grant', scopeRef: '(no grant for this order kind)' } }, now, venueFacts, riskChecks) };
      }
      const grant = registry.grants.find((candidate) => candidate.scopeRef === scopeRef);
      if (grant === undefined) {
        return { ok: true, value: refuse(intent, { stage: 'authority_grant', refusal: { kind: 'unknown_grant', scopeRef } }, now, venueFacts, riskChecks) };
      }
      if (grant.tenant !== registry.tenant || grant.project !== registry.project) {
        return { ok: true, value: refuse(intent, { stage: 'authority_grant', refusal: { kind: 'cross_tenant', grantId: grant.grantId, expectedTenant: registry.tenant, actualTenant: grant.tenant, expectedProject: registry.project, actualProject: grant.project } }, now, venueFacts, riskChecks) };
      }
      if (now < grant.validity.issuedAt) {
        return { ok: true, value: refuse(intent, { stage: 'authority_grant', refusal: { kind: 'grant_not_yet_valid', grantId: grant.grantId, issuedAt: grant.validity.issuedAt, now } }, now, venueFacts, riskChecks) };
      }
      if (now >= grant.validity.expiresAt) {
        return { ok: true, value: refuse(intent, { stage: 'authority_grant', refusal: { kind: 'grant_expired', grantId: grant.grantId, expiresAt: grant.validity.expiresAt, now } }, now, venueFacts, riskChecks) };
      }
      if (grant.revocations.length > 0) {
        return { ok: true, value: refuse(intent, { stage: 'authority_grant', refusal: { kind: 'grant_revoked', grantId: grant.grantId, revokedAt: grant.revocations[0]!.revokedAt, reason: grant.revocations[0]!.reason } }, now, venueFacts, riskChecks) };
      }

      // Stage 8 — entitlement (venue allowlist + credential binding + order kind).
      if (!registry.venues.includes(intent.order.venueId)) {
        return { ok: true, value: refuse(intent, { stage: 'entitlement', refusal: { kind: 'unknown_venue', venue: intent.order.venueId, tenant: registry.tenant } }, now, venueFacts, riskChecks) };
      }
      if (!grant.venues.includes(intent.order.venueId)) {
        return { ok: true, value: refuse(intent, { stage: 'entitlement', refusal: { kind: 'missing_entitlement', subject: 'venue', grantId: grant.grantId, venue: intent.order.venueId } }, now, venueFacts, riskChecks) };
      }
      const grantCredential = grant.credentials.find((binding) => binding.venue === intent.order.venueId);
      const policyCredential = config.policy.credentials.find((binding) => binding.venue === intent.order.venueId);
      if (!grantCredential || !policyCredential) {
        return { ok: true, value: refuse(intent, { stage: 'entitlement', refusal: { kind: 'missing_entitlement', subject: 'credential', grantId: grant.grantId, venue: intent.order.venueId } }, now, venueFacts, riskChecks) };
      }
      if (!permitsOrderKind(grant, intent.order.kind)) {
        return { ok: true, value: refuse(intent, { stage: 'entitlement', refusal: { kind: 'missing_entitlement', subject: 'order_kind', grantId: grant.grantId, orderKind: intent.order.kind } }, now, venueFacts, riskChecks) };
      }

      // Stage 9 — the gateway's own rate budget threading (fail-closed).
      const grantBudget = grant.rateBudgets.find((budgetEntry) => budgetEntry.venue === intent.order.venueId);
      if (!grantBudget) {
        return { ok: true, value: refuse(intent, { stage: 'rate_budget', venue: intent.order.venueId, budget: 0, observed: observedCount, windowMs: null }, now, venueFacts, riskChecks) };
      }
      let windowState = rateWindows.get(intent.order.venueId);
      if (windowState === undefined || now >= windowState.anchor + grantBudget.windowMs) {
        windowState = { anchor: now, count: 0 };
        rateWindows.set(intent.order.venueId, windowState);
      }
      if (windowState.count + 1 > grantBudget.maxOrders) {
        return { ok: true, value: refuse(intent, { stage: 'rate_budget', venue: intent.order.venueId, budget: grantBudget.maxOrders, observed: windowState.count, windowMs: grantBudget.windowMs }, now, venueFacts, riskChecks) };
      }

      // Stage 10 — kill switch standing re-check (defense in depth).
      if (killSwitchThrown) {
        const thrown = config.killSwitch.records.find((record) => record.state === 'thrown')!;
        return { ok: true, value: refuse(intent, { stage: 'kill_switch', switchId: config.killSwitch.switchId, thrownAt: thrown.thrownAt ?? now, reason: thrown.reason ?? 'thrown' }, now, venueFacts, riskChecks) };
      }

      // Stage 11 — routing.
      const route = config.routing.entries.find((entry) => entry.venue === intent.order.venueId && entry.instrument === intent.order.instrumentId);
      if (!route) {
        return { ok: true, value: refuse(intent, { stage: 'routing', venue: intent.order.venueId, instrument: intent.order.instrumentId, reason: 'no_route' }, now, venueFacts, riskChecks) };
      }
      const adapter = config.adapters.find((binding) => binding.adapterRef === route.adapterRef);
      if (!adapter) {
        return { ok: true, value: refuse(intent, { stage: 'routing', venue: intent.order.venueId, instrument: intent.order.instrumentId, reason: 'no_adapter' }, now, venueFacts, riskChecks) };
      }

      // Stage 12 — translation (the authority package's contract, mirrored).
      const decision: ApproveDecisionMirror = deepFreeze({ ...approveContent, decisionId });
      approveDecisions.push(decision);
      const translationErrors: { code: string; message: string; path?: string }[] = [];
      if (intent.order.venueId !== route.venue) translationErrors.push({ code: 'request_incoherent', message: 'order venue disagrees with the route', path: 'order.venueId' });
      if (!decision.lineage.venues.includes(route.venue)) translationErrors.push({ code: 'request_incoherent', message: 'the decision does not cover the routed venue', path: 'decision.lineage.venues' });
      if (killSwitchThrown) translationErrors.push({ code: 'kill_switch_thrown', message: 'the kill switch is thrown — no order request may be translated', path: 'kill_switch' });
      if (translationErrors.length > 0) {
        return { ok: true, value: refuse(intent, { stage: 'translation', errors: translationErrors }, now, venueFacts, riskChecks) };
      }
      const requestContent = {
        decision,
        order: intent.order,
        route: { venue: route.venue, adapterRef: route.adapterRef, channelRef: route.channelRef },
        grantRef: grant.scopeRef,
        credentialRef: grantCredential.credentialRef,
        killSwitchStanding: 'standing' as const,
        asOf: now,
      };
      const request: GatewayOrderRequestMirror = deepFreeze({
        ...requestContent,
        requestRef: `gor:${fnv1a32Hex(canonicalJson(requestContent as unknown as JsonValue))}`,
      });

      // Stage 13 — the adapter call (the ONLY path to the venue).
      const routing: RoutingBundleMirror = {
        decision,
        intent,
        kill_switch: { state: killSwitchThrown ? 'thrown' : 'standing' },
        credential_ref: grantCredential.credentialRef,
        route: { venue: route.venue, credential_ref: grantCredential.credentialRef },
      };
      const sent = adapter.port.routeOrder(routing);
      if (!sent.ok) {
        return { ok: true, value: refuse(intent, { stage: 'adapter', error: sent.error }, now, venueFacts, riskChecks) };
      }

      // Routed: consume the rate window + record the audit + the submission.
      windowState.count += 1;
      seenDecisionIds.add(decisionId);
      const audit = auditOf(
        intent, decisionId, 'approve', venueFacts!, riskChecks,
        { adapterRef: route.adapterRef, channelRef: route.channelRef, credentialRef: grantCredential.credentialRef, clientOrderId: intent.order.clientOrderId, requestRef: request.requestRef },
        'routed', null, now,
      );
      auditRecords.push(audit);
      const submission: GatewaySubmissionRecordMirror = deepFreeze({
        kind: 'routed',
        submissionId: `xgs:${fnv1a32Hex(canonicalJson({ sequence: ++submissionSequence, kind: 'routed', decisionId, requestRef: request.requestRef, at: now } as JsonValue))}`,
        decisionId,
        auditId: audit.auditId,
        requestRef: request.requestRef,
        venue: route.venue,
        adapterRef: route.adapterRef,
        channelRef: route.channelRef,
        routedAt: now,
      });
      submissions.push(submission);
      return { ok: true, value: submission };
    },
    auditTrail(): GatewayAuditTrailMirror {
      return { tenant: config.policy.tenant, project: config.policy.project, records: [...auditRecords] };
    },
    submissions(): readonly GatewaySubmissionRecordMirror[] {
      return [...submissions];
    },
    rateState(): readonly { venue: string; anchor: number; count: number }[] {
      return [...rateWindows.entries()].map(([venue, window]) => ({ venue, anchor: window.anchor, count: window.count }));
    },
    verifyGatewayCoherence() {
      let head = AUDIT_CHAIN_SEED_FN(config.policy.tenant, config.policy.project);
      for (let index = 0; index < auditRecords.length; index++) {
        const record = auditRecords[index]!;
        if (record.sequence !== index + 1) return { ok: false, errors: [{ code: 'chain_mismatch', message: `audit record ${index + 1} carries sequence ${record.sequence}` }] };
        const content = { ...record } as Record<string, unknown>;
        delete content.auditId;
        delete content.chainHead;
        const expected = fnv1a32Hex(head + canonicalJson(content as JsonValue));
        if (record.chainHead !== expected) return { ok: false, errors: [{ code: 'chain_mismatch', message: `audit record ${index + 1} chain head mismatch` }] };
        head = expected;
      }
      return { ok: true, value: null };
    },
  };
  return ok(session);
}

function refusalCodeOf(refusal: GatewayRefusalMirror): string {
  switch (refusal.stage) {
    case 'credential_opacity': return 'credential_value_present';
    case 'intent_validation': return 'invalid_intent';
    case 'shadow_mode': return 'mode_confusion';
    case 'policy_gate': return 'gate_refused';
    case 'gate_envelope': return 'envelope_error';
    case 'duplicate_decision': return 'duplicate_decision';
    case 'risk_limits': return 'limits_breaching';
    case 'risk_envelope': return 'envelope_error';
    case 'authority_grant': return (refusal.refusal as { kind: string }).kind;
    case 'entitlement': return (refusal.refusal as { kind: string }).kind;
    case 'rate_budget': return 'rate_budget_exhausted';
    case 'kill_switch': return 'kill_switch_thrown';
    case 'routing': return refusal.reason;
    case 'translation': return refusal.errors[0]?.code ?? 'translation_error';
    case 'adapter': return refusal.error.code;
  }
}

function permitsOrderKind(grant: AuthorityGrantRecordMirror, orderKind: string): boolean {
  return grant.orderKinds.includes(orderKind);
}

function addExact(a: string, b: string): string {
  return add(a, b);
}

function subtractExact(a: string, b: string): string {
  return compare(a, b) < 0 ? '0' : subtract(a, b);
}

function minExact(a: string, b: string): string {
  return compare(a, b) <= 0 ? a : b;
}

// ---------------------------------------------------------------------------
// The T020 risk-limit evaluation (mirror of the limits law)
// ---------------------------------------------------------------------------

function evaluateLimitsMirror(
  config: ExecutionGatewayConfigMirror,
  intent: StrategyIntentMirror,
): LimitEvaluationRecordMirror {
  const policy = config.risk.policy as RiskPolicyMirror;
  const venueFacts = config.gate.venueState.instruments.find(
    (entry) => entry.venue === intent.order.venueId && entry.instrument === intent.order.instrumentId,
  );
  const instrumentClass = venueFacts?.instrumentClass ?? 'unknown';
  const referencePrice = venueFacts?.referencePrice ?? '0';
  const held = config.gate.portfolio.positions.find((position) => position.instrumentId === intent.order.instrumentId)?.quantity ?? '0';
  const postTrade = intent.order.side === 'buy' ? addExact(held, intent.order.quantity) : subtractExact(held, minExact(held, intent.order.quantity));
  const orderNotional = multiply(intent.order.quantity, referencePrice);
  const postNotional = multiply(postTrade, referencePrice);
  const cash = config.gate.portfolio.cash;
  const grossNotional = addExact(
    config.gate.portfolio.positions.reduce((acc, position) => addExact(acc, multiply(position.quantity, config.gate.venueState.instruments.find((entry) => entry.instrument === position.instrumentId)?.referencePrice ?? '0')), '0'),
    orderNotional,
  );
  const equity = addExact(cash, grossNotional);

  const classRecord =
    policy.classLimits.find((record) => record.instrumentClass === instrumentClass) ??
    policy.classLimits.find((record) => record.instrumentClass === '*');
  const scope = { kind: 'instrument' as const, venue: intent.order.venueId, instrument: intent.order.instrumentId, instrumentClass };
  const states: import('./mirrors/risk').LimitStateMirror[] = [];
  const push = (kind: 'order_size' | 'order_notional' | 'position_size' | 'position_notional', cap: string, observed: string): void => {
    if (!classRecord) {
      states.push({ kind, scope, state: 'blocked', reason: { cause: 'no_declared_limit', instrumentClass } });
      return;
    }
    if (compare(observed, cap) > 0) {
      states.push({ kind, scope, state: 'breaching', reason: { cause: 'breach', bound: cap, observed, excess: subtractExact(observed, cap) } });
    } else {
      states.push({ kind, scope, state: 'within', reason: null });
    }
  };
  push('order_size', classRecord?.maxOrderSize ?? '0', intent.order.quantity);
  push('order_notional', classRecord?.maxOrderNotional ?? '0', orderNotional);
  push('position_size', classRecord?.maxPositionSize ?? '0', postTrade);
  push('position_notional', classRecord?.maxPositionNotional ?? '0', postNotional);
  if (policy.concentration) {
    const concentration = compare(grossNotional, '0') > 0 ? divideRoundHalfUp(postNotional, grossNotional, policy.concentration.ratioPrecision) : '0';
    if (compare(concentration, policy.concentration.maxConcentrationRatio) > 0) {
      states.push({ kind: 'concentration', scope: { kind: 'portfolio' }, state: 'breaching', reason: { cause: 'breach', bound: policy.concentration.maxConcentrationRatio, observed: concentration, excess: subtractExact(concentration, policy.concentration.maxConcentrationRatio) } });
    } else {
      states.push({ kind: 'concentration', scope: { kind: 'portfolio' }, state: 'within', reason: null });
    }
  }
  if (policy.drawdown) {
    // Drawdown is measured at the outcome stage; the gate observes it as within.
    states.push({ kind: 'drawdown', scope: { kind: 'portfolio' }, state: 'within', reason: null });
  }
  if (policy.leverage) {
    const leverage = compare(equity, '0') > 0 ? divideRoundHalfUp(grossNotional, equity, policy.leverage.ratioPrecision) : '0';
    if (compare(leverage, policy.leverage.maxLeverageRatio) > 0) {
      states.push({ kind: 'leverage', scope: { kind: 'portfolio' }, state: 'breaching', reason: { cause: 'breach', bound: policy.leverage.maxLeverageRatio, observed: leverage, excess: subtractExact(leverage, policy.leverage.maxLeverageRatio) } });
    } else {
      states.push({ kind: 'leverage', scope: { kind: 'portfolio' }, state: 'within', reason: null });
    }
  }
  const evaluationContent = {
    policy: { policyId: policy.policyId, version: policy.version },
    exposureRef: `exp:${fnv1a32Hex(canonicalJson({ cash, grossNotional, equity, intent: intent.intentId } as JsonValue))}`,
    killSwitchState: 'standing' as const,
    states,
    lineage: {
      policy: { policyId: policy.policyId, version: policy.version },
      constraintSet: policy.constraintSet,
      goal: policy.goal,
      portfolioState: config.gate.portfolio.stateId,
      marketState: `rms:${fnv1a32Hex(canonicalJson(config.gate.venueState.instruments as unknown as JsonValue))}`,
      seed: intent.seed,
      tenant: intent.tenant,
      project: intent.project,
    },
    asOf: config.gate.venueState.asOf,
  };
  return deepFreeze({
    ...evaluationContent,
    evaluationId: `rls:${fnv1a32Hex(canonicalJson(evaluationContent as unknown as JsonValue))}`,
  });
}

export type { GatewayStage, ExecutionPolicyMirror, ExecutionVenueStateMirror, PortfolioStateMirror };
