/**
 * @tradrl/adapter-alternative-data — the alternative-data adapter session.
 *
 * Work Order T038 (scope): "session" over an injected TransportPort.
 *
 * CONSTRUCTION: the session IS the normalized engine session (the
 * mirrored createAdapterSession) driven over the GUARD transport
 * (./guard-transport.ts) with the alternative-data declarations:
 *
 *   injected port -> [guard: documented schema validation, the stateless
 *   window laws (reversed windows, mid-window releases), the per-series
 *   window-overlap sequencing] -> normalized engine [lifecycle state
 *   machine, declared-capability cross-checks, unmangled request
 *   pass-through, routing, canonical emission] -> provider-neutral
 *   canonical events (the window->release quartet — available_time IS
 *   the declared release instant — plus provenance, entitlement ref,
 *   mapping provenance).
 *
 * EVERY typed error the work order names is preserved:
 *   - use-after-close / double-close / subscribe-before-open /
 *     unknown channel / duplicate subscription  -> the engine's typed
 *     ProtocolErrors (the SDK's code set);
 *   - mid-window releases, overlapping observation windows, unknown
 *     record types, malformed documented payloads -> the guard's typed
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
import { ALTDATA_ADAPTER, ALTDATA_SOURCE_DESCRIPTOR } from './descriptor';
import { ALTDATA_MAPPING_TABLES } from './mapping-tables';
import { createAltDataGuardTransport } from './guard-transport';

/** The alternative-data adapter session's configuration (validated at construction). */
export interface AltDataSessionConfig {
  /** The injected transport port (the runtime host's real transport; tests script a fake). */
  readonly transport: TransportPort;
  /**
   * The declared entitlement envelope — either tier (public or
   * vendor-licensed) or a host's own declaration. `null` or omitted =
   * the refusal path: every emission is a typed EntitlementError (the
   * licensing law — there is no code path that emits an entitlement-less
   * record).
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
 * Construct the alternative-data adapter session over an injected
 * transport port. The returned session satisfies the normalized
 * AdapterSession contract (structurally identical to the SDK's — the
 * interop test drives the REAL SDK contract suite through it).
 */
export function createAltDataAdapterSession(config: unknown): SessionConstruction {
  if (!isRecord(config)) {
    return { ok: false, errors: [invalidField('altdata_session_config', 'must be an object')] };
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
    descriptor: ALTDATA_SOURCE_DESCRIPTOR,
    adapter: ALTDATA_ADAPTER,
    transport: createAltDataGuardTransport(config.transport as TransportPort),
    mapping_tables: ALTDATA_MAPPING_TABLES,
    entitlement: entitlement === null || entitlement === undefined ? undefined : (entitlement as EntitlementEnvelope),
    origin: config.origin,
    derivation: config.derivation,
    sequence_start: config.sequence_start,
  });
}

/** Convenience: the refusal-path session factory (no declared entitlement — typed EntitlementError at emission). */
export function createAltDataSessionWithoutEntitlement(transport: TransportPort): SessionConstruction {
  return createAltDataAdapterSession({ transport, entitlement: null });
}
