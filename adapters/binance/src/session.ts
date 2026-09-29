/**
 * @tradrl/adapter-binance — the Binance adapter session.
 *
 * Work Order T037: "BinanceAdapterSession — the SDK lifecycle over an
 * injected TransportPort: open (subscribe message construction), onEvent
 * (raw -> canonical emission via the emitter contract), close; typed
 * errors on protocol violations (sequence regressions, malformed levels,
 * use-after-close, double-close)."
 *
 * CONSTRUCTION: the session IS the normalized engine session (the
 * mirrored createAdapterSession) driven over the GUARD transport
 * (./guard-transport.ts) with the Binance declarations:
 *
 *   injected port -> [guard: documented schema validation, update-id
 *   sequencing, two-sided diff splitting, normalization] -> normalized
 *   engine [lifecycle state machine, declared-capability cross-checks,
 *   unmangled request pass-through, routing, canonical emission] ->
 *   provider-neutral canonical events (honest quartet, provenance,
 *   entitlement ref, mapping provenance).
 *
 * EVERY typed error the work order names is preserved:
 *   - use-after-close / double-close / subscribe-before-open /
 *     unknown channel / duplicate subscription  -> the engine's typed
 *     ProtocolErrors (the SDK's code set);
 *   - sequence regressions and gaps (documented update ids), unknown
 *     message types, malformed documented payloads -> the guard's typed
 *     protocol errors (adapter-namespace codes, ../protocol.ts);
 *   - unmapped raw fields -> typed MappingErrors (guard AND emitter —
 *     defense in depth);
 *   - emission without the declared entitlement -> typed
 *     EntitlementError (the emitter refuses first).
 *
 * Determinism: no clock, no randomness — the same scripted transport
 * timeline always produces the same canonical emission stream,
 * byte-identically.
 */

import { createAdapterSession, type SessionConstruction } from './contract/session';
import type { DerivationSpec } from './contract/emitter';
import type { EventOrigin } from './contract/provenance';
import { isRecord, missingField, invalidField } from './contract/fields';
import { isEntitlementEnvelope, type EntitlementEnvelope } from './contract/entitlement';
import type { TransportPort } from './contract/transport';
import { BINANCE_ADAPTER, BINANCE_SOURCE_DESCRIPTOR } from './descriptor';
import { BINANCE_MAPPING_TABLES } from './mapping-tables';
import { createBinanceGuardTransport } from './guard-transport';

/** The Binance adapter session's configuration (validated at construction). */
export interface BinanceSessionConfig {
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
 * Construct the Binance adapter session over an injected transport port.
 * The returned session satisfies the normalized AdapterSession contract
 * (structurally identical to the SDK's — the interop test drives the REAL
 * SDK contract suite through it).
 */
export function createBinanceAdapterSession(config: unknown): SessionConstruction {
  if (!isRecord(config)) {
    return { ok: false, errors: [invalidField('binance_session_config', 'must be an object')] };
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

  return createAdapterSession({
    descriptor: BINANCE_SOURCE_DESCRIPTOR,
    adapter: BINANCE_ADAPTER,
    transport: createBinanceGuardTransport(config.transport as TransportPort),
    mapping_tables: BINANCE_MAPPING_TABLES,
    entitlement: entitlement === null || entitlement === undefined ? undefined : (entitlement as EntitlementEnvelope),
    origin: config.origin,
    derivation: config.derivation,
    sequence_start: config.sequence_start,
  });
}

/** Convenience: the refusal-path session factory (no declared entitlement — typed EntitlementError at emission). */
export function createBinanceSessionWithoutEntitlement(transport: TransportPort): SessionConstruction {
  return createBinanceAdapterSession({ transport, entitlement: null });
}
