/**
 * @tradrl/adapter-arena — the Arena adapter session.
 *
 * Work Order T046 (scope): "session" over an injected TransportPort.
 *
 * CONSTRUCTION: the session IS the normalized engine session (the
 * mirrored createAdapterSession) driven over the GUARD transport
 * (./guard-transport.ts) with the Arena declarations:
 *
 *   injected port -> [guard: documented wire schema validation,
 *   message dedup, correlation + goalpost pre-checks] -> normalized
 *   engine [lifecycle state machine, declared-capability
 *   cross-checks, unmangled request pass-through, mapping tables,
 *   T045 envelope minting] -> provider-neutral capability-provider
 *   envelopes (declarations, quotes, deliverables), each wrapped with
 *   its mapping provenance (L9) and the declared entitlement ref.
 *
 * THE OPTIONAL-PATH SEAM (L1/L17): {@link routeRequest} is the ONLY
 * way a platform request reaches the Arena wire — a pure translation
 * (./routing.ts) that validates the request through the T045 mirror
 * and cross-checks the declared Arena catalog BEFORE any frame is
 * sent; {@link announceEngagement} is the ONLY way the adapter learns
 * a platform engagement exists (the host announces the exchange's
 * record; the guard pre-checks deliveries against its frozen
 * contract). The adapter never initiates, never decides, never
 * verifies — the platform's exchange is the authority.
 *
 * L12: the session is constructed within ONE tenant/project scope;
 * every routed request must live inside it (a foreign request is the
 * typed refusal), and every minted envelope carries the scope
 * (injected — the wire never carries tenant identity).
 *
 * Determinism: no clock, no randomness — the same scripted transport
 * timeline always produces the same envelope stream, byte-identically.
 */

import { createAdapterSession, type SessionConstruction, type EmittedEnvelope, type AdapterSession } from './contract/session';
import type { SdkFieldError } from './contract/errors';
import type { EntitlementEnvelope } from './contract/entitlement';
import { isEntitlementEnvelope } from './contract/entitlement';
import type { TransportPort } from './contract/transport';
import { invalidField, isNonEmptyString, isRecord, missingField } from './contract/fields';
import { failure, protocolError, type SdkResult } from './contract/errors';
import type { CapabilityRequest, Engagement } from './contract/provider-envelopes';
import { isEngagement, validateCapabilityRequest } from './contract/provider-envelopes';
import { ARENA_ADAPTER, ARENA_SOURCE_DESCRIPTOR } from './descriptor';
import { ARENA_MAPPING_TABLES } from './mapping-tables';
import { createArenaGuardTransport, createArenaConversationState, type ArenaConversationState } from './guard-transport';
import { buildArenaCapabilityRequest, ARENA_REQUEST_CHANNEL, type ArenaRoutedRequest } from './routing';

/** The Arena adapter session's configuration (validated at construction). */
export interface ArenaSessionConfig {
  /** The injected transport port (the runtime host's real transport; tests script a fake). */
  readonly transport: TransportPort;
  /**
   * The declared entitlement envelope — the engagement tier (default)
   * or a host's own declaration. `null` or omitted = the refusal
   * path: every emission is a typed EntitlementError (the licensing
   * law — there is no code path that emits an entitlement-less
   * record).
   */
  readonly entitlement?: EntitlementEnvelope | null;
  /** The session's tenant scope (L12 — REQUIRED: the adapter routes within exactly one tenant). */
  readonly tenantId: string;
  /** The session's project scope (L12 — REQUIRED). */
  readonly projectId: string;
}

/** The constructed Arena session: the engine session + the optional-path seam. */
export interface ArenaAdapterSession {
  /** The normalized engine session (lifecycle, emission, provenance). */
  readonly engine: AdapterSession;
  /** The conversation state (routed requests + announced engagements; read-only views). */
  readonly conversation: ArenaConversationState;
  /**
   * THE OPTIONAL-PATH SEAM: route ONE platform-issued capability
   * request onto the documented Arena wire. Validates the request
   * through the T045 mirror, checks the L12 scope, cross-checks the
   * declared Arena catalog (the catalog-envelope law), sends the
   * documented frame through the transport (unmangled), and tracks
   * the correlation the wire echoes.
   */
  routeRequest(request: unknown): SdkResult<ArenaRoutedRequest>;
  /**
   * Announce a platform engagement (the host's exchange record) so the
   * guard can pre-check deliveries against its frozen contract. The
   * engagement must pass the T045 mirror guard and live inside the
   * session's L12 scope.
   */
  announceEngagement(engagement: unknown): SdkResult<Engagement>;
}

/** The constructed Arena session: the engine session + the optional-path seam, or every construction violation. */
export type ArenaSessionConstruction =
  | { readonly ok: true; readonly session: ArenaAdapterSession }
  | { readonly ok: false; readonly errors: readonly SdkFieldError[] };

/**
 * Construct the Arena adapter session over an injected transport port,
 * within one tenant/project scope (L12). The returned session drives
 * the normalized engine contract (open/subscribe/nextEnvelope/pump/
 * close) plus the optional-path seam (routeRequest/announceEngagement).
 */
export function createArenaAdapterSession(config: unknown): ArenaSessionConstruction {
  if (!isRecord(config)) {
    return { ok: false, errors: [invalidField('arena_session_config', 'must be an object')] };
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
  if (!isNonEmptyString(config.tenantId) || !isNonEmptyString(config.projectId)) {
    return { ok: false, errors: [invalidField('tenantId', 'the Arena session is constructed within exactly one tenant/project scope (L12 — both required)')] };
  }

  const entitlement: unknown = config.entitlement;
  if (entitlement !== undefined && entitlement !== null) {
    if (!isEntitlementEnvelope(entitlement)) {
      return { ok: false, errors: [invalidField('entitlement', 'must be a declared entitlement envelope or null (the refusal path)')] };
    }
  }

  const conversation = createArenaConversationState(config.tenantId as string, config.projectId as string);
  const construction = createAdapterSession({
    descriptor: ARENA_SOURCE_DESCRIPTOR,
    adapter: ARENA_ADAPTER,
    transport: createArenaGuardTransport(config.transport as TransportPort, conversation),
    mapping_tables: ARENA_MAPPING_TABLES,
    entitlement: entitlement === null || entitlement === undefined ? undefined : (entitlement as EntitlementEnvelope),
    tenantId: config.tenantId as string,
    projectId: config.projectId as string,
  });
  if (!construction.ok) return construction;
  const engine = construction.session;

  const session: ArenaAdapterSession = {
    engine,
    conversation,
    routeRequest(request: unknown): SdkResult<ArenaRoutedRequest> {
      // 1. The full T045 validation law (the mirror — never a blind cast).
      const validated = validateCapabilityRequest(request);
      if (!validated.ok) {
        return failure(
          protocolError(
            'invalid_configuration',
            `the routed request failed the CapabilityRequest law: ${validated.errors.map((error) => `(${error.code}) ${error.path}: ${error.message}`).join('; ')}`,
          ),
        );
      }
      const capabilityRequest: CapabilityRequest = validated.value;
      // 2. L12: the request lives inside the session's scope.
      if (capabilityRequest.tenantId !== conversation.tenantId || capabilityRequest.projectId !== conversation.projectId) {
        return failure(
          protocolError(
            'invalid_configuration',
            `the routed request's tenant/project scope ("${capabilityRequest.tenantId}"/"${capabilityRequest.projectId}") is not the session's ("${conversation.tenantId}"/"${conversation.projectId}") — the adapter routes within exactly one tenant (L12)`,
          ),
        );
      }
      // 3. The pure translation (the catalog-envelope law included).
      const routed = buildArenaCapabilityRequest({ request: capabilityRequest });
      if (!routed.ok) return routed;
      // 4. Send the documented frame through the transport (unmangled).
      const sent = engine.sendRequest({ channel: ARENA_REQUEST_CHANNEL, payload: routed.value.frame });
      if (!sent.ok) return sent;
      // 5. Track the correlation the wire echoes.
      conversation.routedRequests.set(capabilityRequest.requestId, capabilityRequest);
      return routed;
    },
    announceEngagement(engagement: unknown): SdkResult<Engagement> {
      if (!isEngagement(engagement)) {
        return failure(
          protocolError('invalid_configuration', 'the announced engagement failed the Engagement guard (the mirrored T045 record: request, quote, frozen verification, applicability snapshot, lifecycle status, L12 scope)'),
        );
      }
      if (engagement.tenantId !== conversation.tenantId || engagement.projectId !== conversation.projectId) {
        return failure(
          protocolError(
            'invalid_configuration',
            `the announced engagement's tenant/project scope is not the session's — the adapter operates within exactly one tenant (L12)`,
          ),
        );
      }
      conversation.announcedEngagements.set(engagement.engagementId, engagement);
      return { ok: true, value: engagement };
    },
  };

  return { ok: true, session };
}

/** Convenience: the refusal-path session factory (no declared entitlement — typed EntitlementError at emission). */
export function createArenaSessionWithoutEntitlement(transport: TransportPort, tenantId: string, projectId: string): ArenaSessionConstruction {
  return createArenaAdapterSession({ transport, entitlement: null, tenantId, projectId });
}

/** Re-export the emission type for consumers. */
export type { EmittedEnvelope };
