// @tradrl/execution_gateway (service) — the injected ports.
//
// THE ADAPTER PORTS (the Work Order: "the adapters arrive as INJECTED
// session ports (structural mirrors of the T039 session/routing
// shapes)"): {@link OrderRoutingPort} is the structural mirror of the
// T039 `BrokerAdapterSession.routeOrder` /
// `OmsEmsAdapterSession.routeOrder` call paths — the interop test
// proves a REAL T039 session IS an OrderRoutingPort with ZERO CASTS
// (method bivariance over the widened bundle shape; the result shape
// is the widened SdkResult mirror). NO NETWORK this wave: every
// injected port is a scripted fake over the SDK's FakeTransport in the
// tests; real venue binding is post-T041.
//
// THE INSTANT SOURCE (the no-ambient-clock law): the gateway never
// reads `Date.now()`; time arrives through {@link InstantSource} — a
// host-injected sequence. The tests script deterministic instant
// lists; the runtime host injects its own clock at the secure
// boundary. Each submission consumes EXACTLY ONE instant (the
// submission instant — the anchor for the grant-window check, the rate
// window threading and the audit record).
//
// THE CREDENTIAL LAW (SECURITY.md): no credential values anywhere —
// the routing bundle carries the opaque 'cred:' ref only, and the
// opacity trip wire runs over the whole bundle before any port call.

import type { AdapterDescriptorRef } from '../../../packages/execution-authority/src/index';

// ---------------------------------------------------------------------------
// The injected order-routing port (the T039 session/routing mirror)
// ---------------------------------------------------------------------------

/**
 * The routing bundle mirror — the widened shape both T039 routing
 * bundles satisfy: the decision, the gated order intent, the injected
 * kill-switch standing fact, the optional opaque credential ref and
 * the optional OMS/EMS routing target. The REAL adapters validate
 * every field through their own guards (their L8 checks run INSIDE
// the real session code — that is the interop point).
 */
export interface RoutingBundleMirror {
  /** The gate's APPROVED decision record (the REAL adapters re-check it — L8). */
  readonly decision: unknown;
  /** The gated order intent (the routed order form). */
  readonly intent: unknown;
  /** The injected standing kill-switch fact ({ state: standing | thrown }). */
  readonly kill_switch: unknown;
  /** The opaque 'cred:'-prefixed credential ref (never a value). */
  readonly credential_ref?: unknown;
  /** The OMS/EMS routing target ({ venue, credential_ref? }) — ignored by the broker lane. */
  readonly route?: unknown;
}

/** The widened typed-failure mirror of the SDK's AdapterError (the port never interprets it). */
export interface RoutingSendFailure {
  /** The error family (the SDK's AdapterErrorKind: transport/mapping/entitlement/protocol/timeout). */
  readonly kind: string;
  /** The typed error code (e.g. decision_not_approved, kill_switch_thrown, credential_value_present). */
  readonly code: string;
  readonly message: string;
}

/** The widened SdkResult<null> mirror. */
export type RoutingSendResult =
  | { readonly ok: true; readonly value: null }
  | { readonly ok: false; readonly error: RoutingSendFailure };

/**
 * The injected order-routing port: the structural mirror of the T039
 * sessions' `routeOrder` call path. The gateway calls it EXACTLY ONCE
 * per submission, ONLY after every pipeline stage passed; the port
 * itself re-runs the adapter's own L8 checks (the REAL session code).
 */
export interface OrderRoutingPort {
  routeOrder(routing: RoutingBundleMirror): RoutingSendResult;
}

/** One injected adapter binding: the descriptor ref the routing table resolves to, over its session port. */
export interface GatewayAdapterBinding {
  /** The opaque 'adapter:'-prefixed descriptor ref (matches the routing table's entries). */
  readonly adapterRef: AdapterDescriptorRef;
  /** The injected session port (a REAL T039 session in production; a scripted fake in tests). */
  readonly port: OrderRoutingPort;
}

// ---------------------------------------------------------------------------
// The injected instant source (the no-ambient-clock law)
// ---------------------------------------------------------------------------

/** The host-injected instant source: each submission consumes exactly ONE instant. */
export interface InstantSource {
  /** The next submission instant (epoch ms; monotonic — a regression is a typed error). */
  next(): number;
}

/**
 * The scripted instant source (the deterministic tests' clock): a
 * fixed list consumed in order; exhaustion fails loudly (a scripted
 * scenario that under-provisions instants is a test-authoring error,
 * never a silent reuse).
 */
export interface ScriptedInstants extends InstantSource {
  /** How many instants remain unconsumed. */
  remaining(): number;
}

/** Build a scripted instant source over an explicit, monotonic list. */
export function scriptedInstants(instants: readonly number[]): ScriptedInstants {
  if (instants.length === 0) throw new Error('scriptedInstants requires at least one instant');
  for (let index = 1; index < instants.length; index++) {
    if (instants[index] < instants[index - 1]) {
      throw new Error(`scriptedInstants requires a non-decreasing sequence (position ${index} regresses)`);
    }
  }
  let cursor = 0;
  return {
    next(): number {
      if (cursor >= instants.length) {
        throw new Error(`scriptedInstants exhausted after ${instants.length} instants — the scenario under-provisions the clock`);
      }
      const value = instants[cursor] as number;
      cursor += 1;
      return value;
    },
    remaining(): number {
      return instants.length - cursor;
    },
  };
}
