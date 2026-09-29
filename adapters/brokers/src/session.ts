/**
 * @tradrl/adapter-brokers — the broker adapter session.
 *
 * Work Order T039 (following the T037 shape): "the SDK lifecycle over an
 * injected TransportPort: open (subscribe message construction), onEvent
 * (raw -> canonical emission via the emitter contract), close; typed
 * errors on protocol violations (sequence regressions, malformed fields,
 * use-after-close, double-close)" — PLUS this lane's existential method:
 * {@link BrokerAdapterSession.routeOrder}, the L8-gated order-routing
 * call path.
 *
 * CONSTRUCTION: the session IS the normalized engine session (the
 * mirrored createAdapterSession) driven over the GUARD transport
 * (./guard-transport.ts) with the broker declarations:
 *
 *   injected port -> [guard: documented schema validation,
 *   execution-report sequencing, canonical derivation] -> normalized
 *   engine [lifecycle state machine, declared-capability cross-checks,
 *   unmangled request pass-through, routing, canonical emission] ->
 *   provider-neutral canonical events (honest quartet, provenance,
 *   entitlement ref, mapping provenance).
 *
 * ROUTING (the last mile of L8): routeOrder(routing) delegates to the
 * PURE translation {@link buildBrokerNewOrderSingle} (./routing.ts — the
 * approved-decision check, the kill-switch honoring, the
 * credential-opacity scan, the documented-code translation) and sends
 * the built message through the guard transport UNMANGLED. Every typed
 * refusal the routing module owns propagates unchanged: an order message
 * cannot exist, let alone travel, without a valid APPROVED decision
 * record — by construction, not by convention.
 *
 * EVERY typed error the work order names is preserved:
 *   - use-after-close / double-close / subscribe-before-open /
 *     unknown channel / duplicate subscription  -> the engine's typed
 *     ProtocolErrors (the SDK's code set);
 *   - routing before open / after close          -> the wrapper's typed
 *     ProtocolErrors (the SDK's neutral lifecycle codes);
 *   - sequencing regressions (documented CumQty), duplicate execution
 *     ids, unknown message types, malformed documented payloads,
 *     unconvertible documented times -> the guard's typed protocol
 *     errors (adapter-namespace codes, ../protocol.ts);
 *   - unmapped raw fields -> typed MappingErrors (guard AND emitter —
 *     defense in depth);
 *   - emission without the declared entitlement -> typed
 *     EntitlementError (the emitter refuses first);
 *   - routing without a valid APPROVED decision / under a thrown kill
 *     switch / with embedded credential material -> the routing module's
 *     typed L8 refusals.
 *
 * Determinism: no clock, no randomness — the same scripted transport
 * timeline always produces the same canonical emission stream,
 * byte-identically, and the same routing inputs always produce the same
 * order message, byte-identically.
 */

import { createAdapterSession, type AdapterSession, type SessionState } from './contract/session';
import type { DerivationSpec } from './contract/emitter';
import type { EventOrigin } from './contract/provenance';
import { isRecord, missingField, invalidField } from './contract/fields';
import { isEntitlementEnvelope, type EntitlementEnvelope } from './contract/entitlement';
import type { TransportPort } from './contract/transport';
import { failure, protocolError, type SdkFieldError, type SdkResult } from './contract/errors';
import { BROKER_ADAPTER, BROKER_SOURCE_DESCRIPTOR } from './descriptor';
import { BROKER_MAPPING_TABLES } from './mapping-tables';
import { createBrokerGuardTransport } from './guard-transport';
import { buildBrokerNewOrderSingle, type BrokerOrderRouting } from './routing';

/** Constructed-result type of {@link createBrokerAdapterSession}. */
export type BrokerSessionConstruction =
  | { readonly ok: true; readonly session: BrokerAdapterSession }
  | { readonly ok: false; readonly errors: readonly SdkFieldError[] };

/** The broker adapter session's configuration (validated at construction). */
export interface BrokerSessionConfig {
  /** The injected transport port (the runtime host's real transport; tests script a fake). */
  readonly transport: TransportPort;
  /**
   * The declared entitlement envelope. `null` or omitted = the refusal
   * path: every emission is a typed EntitlementError (the licensing law —
   * there is no code path that emits an entitlement-less record).
   */
  readonly entitlement?: EntitlementEnvelope | null;
  /** Origin of emitted records (default historical). */
  readonly origin?: EventOrigin;
  /** Optional derivation lineage. */
  readonly derivation?: DerivationSpec | null;
  /** First sequence number per canonical stream (default 0). */
  readonly sequence_start?: number;
}

/**
 * The broker adapter session: the normalized AdapterSession contract
 * (structurally identical to the SDK's — the interop test drives the REAL
 * SDK contract suite through it) EXTENDED with the L8-gated order-routing
 * call path {@link routeOrder}.
 */
export interface BrokerAdapterSession extends AdapterSession {
  /**
   * Translate one APPROVED decision's order intent into the gateway's
   * documented NewOrderSingle message and send it through the injected
   * transport port, UNMANGLED. Requires the open or subscribed state;
   * every L8 refusal (decision not approved, thrown kill switch,
   * embedded credential material) and every translation refusal
   * propagates as a typed error. The ADAPTER translates; the GATE
   * decided.
   */
  routeOrder(routing: BrokerOrderRouting): SdkResult<null>;
}

/**
 * Construct the broker adapter session over an injected transport port.
 * The returned session satisfies the normalized AdapterSession contract
 * (structurally identical to the SDK's — the interop test drives the REAL
 * SDK contract suite through it).
 */
export function createBrokerAdapterSession(config: unknown): BrokerSessionConstruction {
  if (!isRecord(config)) {
    return { ok: false, errors: [invalidField('broker_session_config', 'must be an object')] };
  }
  if (config.transport === undefined) {
    return { ok: false, errors: [missingField('transport')] };
  }
  const transport = config.transport;
  if (
    !isRecord(transport) ||
    typeof transport.send !== 'function' ||
    typeof transport.recv !== 'function' ||
    typeof transport.close !== 'function'
  ) {
    return { ok: false, errors: [invalidField('transport', 'must be an injected transport port (send/recv/close)')] };
  }

  const entitlement: unknown = config.entitlement;
  if (entitlement !== undefined && entitlement !== null) {
    if (!isEntitlementEnvelope(entitlement)) {
      return { ok: false, errors: [invalidField('entitlement', 'must be a declared entitlement envelope or null (the refusal path)')] };
    }
  }

  const guard = createBrokerGuardTransport(config.transport as TransportPort);
  const construction = createAdapterSession({
    descriptor: BROKER_SOURCE_DESCRIPTOR,
    adapter: BROKER_ADAPTER,
    transport: guard,
    mapping_tables: BROKER_MAPPING_TABLES,
    entitlement: entitlement === null || entitlement === undefined ? undefined : (entitlement as EntitlementEnvelope),
    origin: config.origin,
    derivation: config.derivation,
    sequence_start: config.sequence_start,
  });
  if (!construction.ok) {
    return { ok: false, errors: construction.errors };
  }
  const inner: AdapterSession = construction.session;

  const session: BrokerAdapterSession = {
    config: inner.config,
    state(): SessionState {
      return inner.state();
    },
    lastMessageAt() {
      return inner.lastMessageAt();
    },
    open() {
      return inner.open();
    },
    subscribe(spec) {
      return inner.subscribe(spec);
    },
    nextEvent() {
      return inner.nextEvent();
    },
    onEvent(handler) {
      inner.onEvent(handler);
    },
    pump() {
      return inner.pump();
    },
    close() {
      return inner.close();
    },
    routeOrder(routing: BrokerOrderRouting): SdkResult<null> {
      const state = inner.state();
      if (state === 'closed') {
        return failure(
          protocolError('use_after_close', 'cannot route an order on a closed session — every operation on a closed session is a typed error'),
        );
      }
      if (state !== 'open' && state !== 'subscribed') {
        return failure(
          protocolError('invalid_transition', `routeOrder() requires the open or subscribed state (current: ${state}) — open the session first`),
        );
      }
      const built = buildBrokerNewOrderSingle(routing);
      if (!built.ok) return built;
      const sent = guard.send(built.value);
      if (!sent.ok) return sent;
      return { ok: true, value: null };
    },
  };

  return { ok: true, session };
}

/** Convenience: the refusal-path session factory (no declared entitlement — typed EntitlementError at emission). */
export function createBrokerSessionWithoutEntitlement(transport: TransportPort): BrokerSessionConstruction {
  return createBrokerAdapterSession({ transport, entitlement: null });
}
