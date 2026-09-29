// @tradrl/execution-authority — the GatewayOrderRequest: THE
// TRANSLATION CONTRACT between the gate's output and the adapters'
// routed order form.
//
// THE LAW (the Work Order: "GatewayOrderRequest: the translation
// contract — a validated APPROVED decision (T019 ApproveDecision
// mirror) + the routed order form. An order request without a valid
// approved-decision ref is INEXPRESSIBLE at the guard level (mirrors
// the brokers adapter's law, one lane upstream)."):
//
//   - The `decision` field's TYPE is {@link ApproveDecisionRecord} and
//     the guard {@link isGatewayOrderRequest} requires
//     `isApproveDecisionRecord` — kind 'approve', an 'xd:' decision id,
//     an intent ref, the policy version, the ALL-PASSED check list and
//     the full L9 lineage. A REFUSAL decision, a malformed record or
//     garbage fails the guard: the request does not exist as far as
//     this contract is concerned. INEXPRESSIBLE at the guard level.
//   - The builder {@link gatewayOrderRequest} is the only construction
//     site: it runs the credential-opacity trip wire over the WHOLE
//     input bundle FIRST (a contaminated bundle is refused before
//     anything else matters — T039's first-refusal position), then the
//     approved-decision law (`decision_not_approved`), then the routed
//     order form guard, then the route/grant/credential ref laws, then
//     the kill-switch standing law (`kill_switch_thrown` — a thrown
//     injected fact refuses the build), then the decision/order
//     COHERENCE laws (the decision's lineage must name the routed
//     venue; the order's venue must BE the routed venue — a request
//     that is not about what it claims is the typed
//     `request_incoherent` error).
//   - The request is content-addressed (`gor:` + digest) and deeply
//     frozen — the same inputs always produce the byte-identical
//     request (L9).
//
// THE OPACITY LAW: the guard AND the builder run the credential-value
// trip wire over the whole record (SECURITY.md's boundary in code).

import { deepFreeze, isRecord, isTimestampMs, type JsonValue, type TimestampMs } from './primitives';
import { canonicalJson, fnv1a32Hex } from './primitives';
import { credentialValueViolations } from './credentials';
import type { ApproveDecisionRecord, KillSwitchStandingFact, OrderIntentRecord } from './decision-mirror';
import { isApproveDecisionRecord, isKillSwitchStandingFact, isOrderIntentRecord } from './decision-mirror';
import type { AdapterDescriptorRef, AuthorityScopeRef, ChannelRef, CredentialRef, GatewayOrderRequestId, VenueId } from './ids';
import { isAdapterDescriptorRef, isAuthorityScopeRef, isChannelRef, isCredentialRef, isVenueId, mintGatewayOrderRequestId } from './ids';
import { type ExecutionAuthorityResult, fail, ok } from './errors';

// ---------------------------------------------------------------------------
// The request record
// ---------------------------------------------------------------------------

/**
 * The translation contract's record: a validated APPROVED decision +
 * the routed order form + the resolved route + the acting grant + the
 * opaque credential ref + the standing kill-switch fact + the request
 * instant. This is the SINGLE typed bridge from "the gate approved" to
 * "the adapter translates" — the gateway builds it, the audit record
 * carries its digest, and there is no other path to an outbound order.
 */
export interface GatewayOrderRequest {
  /** Content-addressed identity: `gor:` + digest of the canonical content. */
  readonly requestRef: GatewayOrderRequestId;
  /** THE AUTHORITY — a validated APPROVED decision (the guard refuses everything else; L8). */
  readonly decision: ApproveDecisionRecord;
  /** The routed order form (the gated intent's order — the T019/T039 OrderIntent shape). */
  readonly order: OrderIntentRecord;
  /** The resolved route: the venue, the adapter descriptor ref, the channel ref. */
  readonly route: {
    readonly venue: VenueId;
    readonly adapterRef: AdapterDescriptorRef;
    readonly channelRef: ChannelRef;
  };
  /** The opaque 'grant:' scope ref this request acts under (the resolved authority grant's join key). */
  readonly grantRef: AuthorityScopeRef;
  /** The opaque 'cred:' credential ref bound to the venue (never a value). */
  readonly credentialRef: CredentialRef;
  /** The injected standing kill-switch fact at request time ('standing' — a thrown fact refuses the build). */
  readonly killSwitchStanding: 'standing';
  /** The request instant (the gateway's submission instant — no ambient clock). */
  readonly asOf: TimestampMs;
}

/** Guard: `GatewayOrderRequest` — the translation contract enforced at the GUARD level. */
export function isGatewayOrderRequest(v: unknown): v is GatewayOrderRequest {
  if (!isRecord(v)) return false;
  if (typeof v.requestRef !== 'string' || !v.requestRef.startsWith('gor:')) return false;
  // THE L8 EXISTENTIAL LAW: only a valid APPROVE decision is authority —
  // an order request without one is INEXPRESSIBLE at the guard level.
  if (!isApproveDecisionRecord(v.decision)) return false;
  if (!isOrderIntentRecord(v.order)) return false;
  const route = v.route;
  if (
    !isRecord(route) ||
    !isVenueId(route.venue) ||
    !isAdapterDescriptorRef(route.adapterRef) ||
    !isChannelRef(route.channelRef)
  ) {
    return false;
  }
  if (!isAuthorityScopeRef(v.grantRef)) return false;
  if (!isCredentialRef(v.credentialRef)) return false;
  if (v.killSwitchStanding !== 'standing') return false;
  if (!isTimestampMs(v.asOf)) return false;
  // The opacity trip wire (the guard half).
  if (credentialValueViolations(v).length > 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Content addressing (L9)
// ---------------------------------------------------------------------------

/** The canonical JSON tree of a request's CONTENT (everything except the content-addressed `requestRef`). */
export function orderRequestContentTree(request: Omit<GatewayOrderRequest, 'requestRef'>): JsonValue {
  return {
    decision: {
      kind: request.decision.kind,
      decisionId: request.decision.decisionId,
      intentRef: request.decision.intentRef,
      policy: { policyId: request.decision.policy.policyId, version: request.decision.policy.version },
    },
    order: { ...request.order } as unknown as JsonValue,
    route: { venue: request.route.venue, adapterRef: request.route.adapterRef, channelRef: request.route.channelRef },
    grantRef: request.grantRef,
    credentialRef: request.credentialRef,
    killSwitchStanding: request.killSwitchStanding,
    asOf: request.asOf,
  };
}

/** The L9 anchor: the canonical JSON of a validated request's content. */
export function canonicalOrderRequestJson(request: GatewayOrderRequest): string {
  return canonicalJson(orderRequestContentTree(request));
}

// ---------------------------------------------------------------------------
// The builder (the only construction site)
// ---------------------------------------------------------------------------

/** The builder's input bundle: everything the translation reasons over (all untrusted). */
export interface GatewayOrderRequestInput {
  /** The gate's decision (untrusted — ONLY a valid APPROVE decision is authority; L8). */
  readonly decision: unknown;
  /** The gated order form (untrusted — validated through the mirror guard). */
  readonly order: unknown;
  /** The resolved route (untrusted — validated through the ref guards). */
  readonly route: unknown;
  /** The acting grant's scope ref (untrusted — 'grant:'-prefixed). */
  readonly grantRef: unknown;
  /** The venue's opaque credential ref (untrusted — 'cred:'-prefixed). */
  readonly credentialRef: unknown;
  /**
   * The injected standing kill-switch fact (untrusted — validated
   * through the thin mirror guard; a THROWN fact refuses the build,
   * mirroring the T039 routing law one lane upstream).
   */
  readonly kill_switch: unknown;
  /** The request instant (the submission instant — no ambient clock). */
  readonly asOf: unknown;
}

/**
 * Build one gateway order request — the translation contract's ONLY
 * construction site. Refusal order (deterministic, first-failure-wins,
 * each a typed error):
 *   1. Credential opacity FIRST — the scan over the WHOLE input bundle
 *      (`credential_value_present`).
 *   2. THE L8 EXISTENTIAL LAW — only a valid APPROVE decision is
 *      authority (`decision_not_approved`).
 *   3. The routed order form guard (fail-closed).
 *   4. The route/ref laws (venue, adapter ref, channel ref, grant ref,
 *      credential ref, the request instant).
 *   5. The kill-switch standing law (`kill_switch_thrown`).
 *   6. The COHERENCE laws: the order's venue IS the routed venue, and
 *      the decision's lineage names the routed venue (a request that
 *      is not about what it claims is `request_incoherent`).
 * On success the request is deeply frozen with its content-addressed
 * id (L9): the same inputs always produce the byte-identical request.
 */
export function gatewayOrderRequest(input: GatewayOrderRequestInput): ExecutionAuthorityResult<GatewayOrderRequest> {
  // 1. Credential opacity — the bundle is scanned WHOLE (SECURITY.md's boundary).
  const violations = credentialValueViolations(input);
  if (violations.length > 0) {
    return fail(
      'credential_value_present',
      `the order-request bundle embeds credential MATERIAL under credential-shaped key(s) ${violations.join(', ')} — this lane carries opaque 'cred:'-prefixed refs only, never values`,
    );
  }

  // 2. THE L8 EXISTENTIAL LAW — only a valid APPROVE decision is authority.
  if (!isApproveDecisionRecord(input.decision)) {
    const description =
      input.decision !== null && typeof input.decision === 'object' && (input.decision as Record<string, unknown>).kind === 'refuse'
        ? 'a REFUSAL decision (the gate refused this intent — a refusal is a record, never authority to route)'
        : 'not a valid APPROVE decision record (kind "approve", decision id, intent ref, policy version, passed checks, L9 lineage, decision instant)';
    return fail(
      'decision_not_approved',
      `the order-request decision is ${description} — the gateway TRANSLATES approved decisions, it never executes authority (L8)`,
      'decision',
    );
  }
  const decision = input.decision;

  // 3. The routed order form guard (fail-closed).
  if (!isOrderIntentRecord(input.order)) {
    return fail(
      'invalid_field',
      'the order-request order form must be a structurally valid order intent (client order id, instrument, venue, side, kind, quantity, time-in-force, creation instant)',
      'order',
    );
  }
  const order = input.order;

  // 4. The route/ref laws.
  const route = input.route;
  if (
    !isRecord(route) ||
    !isVenueId(route.venue) ||
    !isAdapterDescriptorRef(route.adapterRef) ||
    !isChannelRef(route.channelRef)
  ) {
    return fail('invalid_field', 'the order-request route must be { venue, adapterRef, channelRef } with opaque adapter:/chan: refs', 'route');
  }
  if (!isAuthorityScopeRef(input.grantRef)) {
    return fail('invalid_field', "the order-request grantRef must be an opaque 'grant:'-prefixed scope ref", 'grantRef');
  }
  if (!isCredentialRef(input.credentialRef)) {
    return fail('invalid_field', "the order-request credentialRef must be an opaque 'cred:'-prefixed reference (never a value)", 'credentialRef');
  }
  if (!isTimestampMs(input.asOf)) {
    return fail('invalid_field', 'the order-request asOf must be an epoch-ms instant (no ambient clock)', 'asOf');
  }

  // 5. The kill-switch standing law — the injected fact, honored never re-derived.
  if (!isKillSwitchStandingFact(input.kill_switch)) {
    return fail('invalid_field', 'the order-request bundle must carry the injected kill-switch standing fact ({ state: standing | thrown })', 'kill_switch');
  }
  if (input.kill_switch.state === 'thrown') {
    return fail(
      'kill_switch_thrown',
      "the standing kill switch is thrown — the order request refuses to build (it honors the injected switch state; the switch is the gate's, never re-derived here)",
    );
  }

  // 6. The COHERENCE laws — the request must be about what it claims.
  if (order.venueId !== route.venue) {
    return fail(
      'request_incoherent',
      `the order form's venue (${order.venueId}) is not the routed venue (${route.venue}) — a request that is not about what it claims is inexpressible`,
      'order.venueId',
    );
  }
  if (!decision.lineage.venues.includes(route.venue)) {
    return fail(
      'request_incoherent',
      `the decision's lineage does not name the routed venue (${route.venue}) — the decision must be FOR the order it authorizes`,
      'decision.lineage.venues',
    );
  }

  const content: Omit<GatewayOrderRequest, 'requestRef'> = {
    decision,
    order,
    route: { venue: route.venue, adapterRef: route.adapterRef, channelRef: route.channelRef },
    grantRef: input.grantRef,
    credentialRef: input.credentialRef,
    killSwitchStanding: 'standing',
    asOf: input.asOf,
  };
  const requestRef = mintGatewayOrderRequestId(fnv1a32Hex(canonicalJson(orderRequestContentTree(content))));
  return ok(deepFreeze({ ...content, requestRef }));
}
