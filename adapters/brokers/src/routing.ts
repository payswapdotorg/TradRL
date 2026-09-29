/**
 * @tradrl/adapter-brokers — the L8 order-routing translation.
 *
 * THE LAST MILE OF L8 (spec/ARCHITECTURE-LOCK.md L8: "models cannot
 * bypass hard risk/authorization gates"; spec/ADAPTERS.md Execution:
 * "Every consequential order passes through internal execution
 * authority/risk gates"). THE ADAPTER TRANSLATES, THE GATE DECIDES:
 * {@link buildBrokerNewOrderSingle} is a PURE function from (an APPROVED
 * decision, the gated order intent, the injected kill-switch standing
 * state) to the broker gateway's documented NewOrderSingle message over
 * the gateway's channel. It NEVER decides anything — every input is
 * either authority (the decision, the switch state) or the object of
 * translation (the intent).
 *
 * THE REFUSAL ORDER (deterministic, first-failure-wins, each a typed
 * protocol error — the laws cite their own lines):
 *   1. Credential opacity FIRST (T019's law: "Credential VALUES never
 *      appear — opaque refs only"): the scan over the WHOLE routing
 *      bundle flags any credential-shaped key anywhere in its JSON tree
 *      (`credential_value_present`). The record is contaminated, so
 *      nothing else about it matters — the same first-refusal position
 *      the SDK's emitter takes for undeclared entitlements.
 *   2. Kill-switch honoring (the lane's law: "kill-switch-honoring,
 *      never authoritative"): a THROWN injected standing switch refuses
 *      the routing before any translation (`kill_switch_thrown`). The
 *      adapter never re-derives the switch — it honors the injected fact
 *      exactly as the gate read it (L16: distinct authority, distinct
 *      clocks).
 *   3. THE L8 EXISTENTIAL CHECK (the Work Order's exact words: "An
 *      adapter call path that could route an order without a valid
 *      APPROVED decision record is a typed error (design + negative
 *      tests)"): the decision must pass the mirrored
 *      `isApprovedDecisionMirror` guard — a REFUSAL decision, a malformed
 *      record or garbage is the typed `decision_not_approved` refusal.
 *      There is NO code path that builds an order message without this
 *      check (the builder's signature takes the decision as data and
 *      validates it before any field is translated).
 *   4. The intent must pass the mirrored `isOrderIntentMirror` guard
 *      (fail-closed — a malformed intent never reaches translation).
 *   5. The time conversions (documented RFC 3339 -> documented
 *      UTCTimestamp) must succeed (`invalid_time_field`).
 *   6. Defense in depth: the constructed message is re-validated through
 *      the documented NewOrderSingle schema guard before it is returned.
 *
 * TRANSLATION (pure, deterministic, FIXED key order — byte-determinism):
 * the canonical order vocabulary maps onto the gateway's documented code
 * domains (side buy->"1", sell->"2"; kind market->"1", limit->"2",
 * stop->"3", stop-limit->"4"; time-in-force day->"0", gtc->"1", ioc->"3",
 * fok->"4", gtt->"6"); the canonical decimal quantities/prices pass
 * through verbatim (both sides speak exact decimal strings); the
 * canonical RFC 3339 instants re-format as the documented UTCTimestamp
 * form. The decision's identity rides NOWHERE in the message — the
 * broker has no use for it; the audit trail that binds decision to
 * message is T019's audit log, and the execution-gateway lane (T040)
 * connects them.
 *
 * NO NETWORK: the message is BUILT, never sent. Sending is the session's
 * {@link ../session.ts routeOrder} (over the injected transport port) or
 * the runtime host's own port — a runtime concern outside this contract
 * package.
 */

import { failure, protocolError, success, type SdkResult } from './contract/errors';
import type { OutboundMessage } from './contract/transport';
import { deepFreeze } from './contract/freeze';
import {
  credentialValueViolations,
  isApprovedDecisionMirror,
  isCredentialRef,
  isKillSwitchStandingState,
  isOrderIntentMirror,
  type ApprovedDecisionMirror,
  type KillSwitchStandingState,
  type OrderIntentMirror,
} from './decision-mirror';
import { brokerProtocolError } from './protocol';

/** Translate one canonical vocabulary value onto its documented code domain (null when undocumented). */
function documentedCode(value: string, map: Readonly<Record<string, string>>): string | null {
  for (const [code, canonical] of Object.entries(map)) {
    if (canonical === value) return code;
  }
  return null;
}
import { msToFixUtcTimestamp, rfc3339ToMs } from './time';
import { guardNewOrderSinglePayload } from './schemas';
import type { JsonObject } from './contract/json';

/** The broker gateway's outbound order-entry channel (the documented NewOrderSingle message kind). */
export const BROKER_ORDER_CHANNEL = 'newOrderSingle';

/** The routing bundle: everything the translation reasons over. */
export interface BrokerOrderRouting {
  /** The gate's decision record (untrusted — validated through the mirror guard; L8: only APPROVE is authority). */
  readonly decision: unknown;
  /** The gated order intent (untrusted — validated through the mirror guard). */
  readonly intent: unknown;
  /**
   * The injected standing kill-switch state (untrusted — validated
   * through the thin mirror guard; a THROWN switch refuses the routing).
   * The adapter honors the fact; it never re-derives it.
   */
  readonly kill_switch: unknown;
  /**
   * The opaque credential reference for the routing ('cred:'-prefixed),
   * when the session carries one. VALUES are forbidden everywhere in the
   * bundle (the opacity scan runs over the whole tree).
   */
  readonly credential_ref?: unknown;
}

/** The routing path's refusal constructor (L8). */
function refused(code: 'decision_not_approved' | 'kill_switch_thrown' | 'credential_value_present', message: string): SdkResult<never> {
  return failure(brokerProtocolError(code, message));
}

/**
 * Translate one APPROVED decision's order intent into the broker
 * gateway's documented NewOrderSingle message. Pure and total: every
 * refusal is a typed protocol error (see the module header for the
 * refusal order and its laws); the success value is a deep-frozen
 * OutboundMessage with a FIXED key order (byte-determinism — the same
 * routing inputs always produce the same message, byte-identically).
 */
export function buildBrokerNewOrderSingle(routing: BrokerOrderRouting): SdkResult<OutboundMessage> {
  // 1. Credential opacity — the bundle is scanned WHOLE (T019's law).
  const violations = credentialValueViolations(routing);
  if (violations.length > 0) {
    return refused(
      'credential_value_present',
      `the routing bundle embeds credential MATERIAL under credential-shaped key(s) ${violations.join(', ')} — this lane carries opaque 'cred:'-prefixed refs only, never values (T019's credential-opacity law)`,
    );
  }

  // 2. Kill-switch honoring — the injected standing fact (never re-derived).
  if (!isKillSwitchStandingState(routing.kill_switch)) {
    return failure(
      protocolError('invalid_configuration', 'the routing bundle must carry the injected kill-switch standing state ({ state: standing | thrown })'),
    );
  }
  if (routing.kill_switch.state === 'thrown') {
    return refused(
      'kill_switch_thrown',
      'the standing kill switch is thrown — the adapter refuses to translate the order (it honors the injected switch state; the switch is the gate\'s, never re-derived here)',
    );
  }

  // 3. THE L8 EXISTENTIAL CHECK — only a valid APPROVE decision is authority.
  if (!isApprovedDecisionMirror(routing.decision)) {
    const description =
      routing.decision !== null && typeof routing.decision === 'object' && (routing.decision as Record<string, unknown>).kind === 'refuse'
        ? 'a REFUSAL decision (the gate refused this intent — a refusal is a record, never authority to route)'
        : 'not a valid APPROVE decision record (kind "approve", decision id, intent ref, policy version, passed checks, L9 lineage, decision instant)';
    return refused(
      'decision_not_approved',
      `the routing decision is ${description} — the adapter TRANSLATES approved decisions, it never executes authority (L8)`,
    );
  }
  const decision: ApprovedDecisionMirror = routing.decision;

  // 4. The order intent mirror guard (fail-closed).
  if (!isOrderIntentMirror(routing.intent)) {
    return failure(
      protocolError('invalid_configuration', 'the routing intent must be a structurally valid order intent (the mirrored OrderIntent contract: client order id, instrument, venue, side, kind, quantity, time-in-force, creation instant)'),
    );
  }
  const intent: OrderIntentMirror = routing.intent;

  // The optional credential ref: opaque and 'cred:'-prefixed when present.
  if (routing.credential_ref !== undefined && routing.credential_ref !== null && !isCredentialRef(routing.credential_ref)) {
    return failure(
      protocolError('invalid_configuration', 'the routing credential ref must be an opaque \'cred:\'-prefixed reference (never a value)'),
    );
  }

  // 5. Time conversion: the canonical RFC 3339 instants -> the documented
  // UTCTimestamp form (deterministic, hand-rolled, exact to the millisecond).
  const createdAtMs = rfc3339ToMs(intent.createdAt);
  if (!createdAtMs.ok) return createdAtMs;
  const transactTime = msToFixUtcTimestamp(createdAtMs.value);
  if (!transactTime.ok) return transactTime;

  let expireTime: string | undefined;
  if (intent.expiresAt !== undefined) {
    const expiresAtMs = rfc3339ToMs(intent.expiresAt);
    if (!expiresAtMs.ok) return expiresAtMs;
    const formatted = msToFixUtcTimestamp(expiresAtMs.value);
    if (!formatted.ok) return formatted;
    expireTime = formatted.value;
  }

  // 6. The translation itself: canonical vocabulary -> documented code domains.
  const side = intent.side === 'buy' ? '1' : '2';
  const ordType = documentedCode(intent.kind, {
    '1': 'market',
    '2': 'limit',
    '3': 'stop',
    '4': 'stop-limit',
  });
  if (ordType === null) {
    // A registered extension kind: the gateway's documented domain covers
    // exactly the four core codes — an extension cannot be translated and
    // is a typed refusal, never a silent drop.
    return failure(
      protocolError('invalid_configuration', `order kind "${intent.kind}" has no documented OrdType code (the gateway documents 1=market, 2=limit, 3=stop, 4=stop-limit)`),
    );
  }
  const timeInForce = documentedCode(intent.timeInForce, {
    '0': 'day',
    '1': 'gtc',
    '3': 'ioc',
    '4': 'fok',
    '6': 'gtt',
  });
  if (timeInForce === null) {
    return failure(
      protocolError('invalid_configuration', `time-in-force "${intent.timeInForce}" has no documented TimeInForce code (the gateway documents 0=day, 1=gtc, 3=ioc, 4=fok, 6=gtt)`),
    );
  }

  // FIXED key order (byte-determinism); conditional fields only when present.
  const payload: Record<string, unknown> = {
    MsgType: 'D',
    ClOrdID: intent.clientOrderId,
    Symbol: intent.instrumentId,
    Side: side,
    TransactTime: transactTime.value,
    OrdType: ordType,
    OrderQty: intent.quantity,
  };
  if (intent.price !== undefined) payload.Price = intent.price;
  if (intent.stopPrice !== undefined) payload.StopPx = intent.stopPrice;
  payload.TimeInForce = timeInForce;
  if (expireTime !== undefined) payload.ExpireTime = expireTime;

  // 7. Defense in depth: the constructed message is re-validated through
  // the documented NewOrderSingle schema guard before it is returned.
  const guarded = guardNewOrderSinglePayload(payload as JsonObject);
  if (!guarded.ok) return guarded;

  const message: OutboundMessage = {
    channel: BROKER_ORDER_CHANNEL,
    payload: deepFreeze(payload) as JsonObject,
  };
  return success(message);
}
