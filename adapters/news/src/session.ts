/**
 * @tradrl/adapter-news — the news adapter session.
 *
 * Work Order T038 (scope): "session" over an injected TransportPort.
 *
 * CONSTRUCTION: the session IS the normalized engine session (the
 * mirrored createAdapterSession) driven over the GUARD transport
 * (./guard-transport.ts) with the news declarations:
 *
 *   injected port -> [guard: documented schema validation, item dedup,
 *   embargo hold-and-release at the lift instant] -> normalized engine
 *   [lifecycle state machine, declared-capability cross-checks,
 *   unmangled request pass-through, routing, canonical emission] ->
 *   provider-neutral canonical news events (honest quartet — the
 *   publication instant as event_time, the receive instant (or the
 *   embargo lift instant) as available_time, provenance, entitlement
 *   ref, mapping provenance).
 *
 * EVERY typed error the work order names is preserved:
 *   - use-after-close / double-close / subscribe-before-open /
 *     unknown channel / duplicate subscription  -> the engine's typed
 *     ProtocolErrors (the SDK's code set);
 *   - duplicate item ids, embargoed items that never lift, unknown
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
import { NEWS_ADAPTER, NEWS_SOURCE_DESCRIPTOR } from './descriptor';
import { NEWS_MAPPING_TABLES } from './mapping-tables';
import { createNewsGuardTransport } from './guard-transport';

/** The news adapter session's configuration (validated at construction). */
export interface NewsSessionConfig {
  /** The injected transport port (the runtime host's real transport; tests script a fake). */
  readonly transport: TransportPort;
  /**
   * The declared entitlement envelope — either tier (public or
   * wire-service) or a host's own declaration. `null` or omitted = the
   * refusal path: every emission is a typed EntitlementError (the
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
 * Construct the news adapter session over an injected transport port.
 * The returned session satisfies the normalized AdapterSession contract
 * (structurally identical to the SDK's — the interop test drives the REAL
 * SDK contract suite through it).
 */
export function createNewsAdapterSession(config: unknown): SessionConstruction {
  if (!isRecord(config)) {
    return { ok: false, errors: [invalidField('news_session_config', 'must be an object')] };
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
    descriptor: NEWS_SOURCE_DESCRIPTOR,
    adapter: NEWS_ADAPTER,
    transport: createNewsGuardTransport(config.transport as TransportPort),
    mapping_tables: NEWS_MAPPING_TABLES,
    entitlement: entitlement === null || entitlement === undefined ? undefined : (entitlement as EntitlementEnvelope),
    origin: config.origin,
    derivation: config.derivation,
    sequence_start: config.sequence_start,
  });
}

/** Convenience: the refusal-path session factory (no declared entitlement — typed EntitlementError at emission). */
export function createNewsSessionWithoutEntitlement(transport: TransportPort): SessionConstruction {
  return createNewsAdapterSession({ transport, entitlement: null });
}
