/**
 * @tradrl/adapter-arena — the L17 optional-path outbound routing.
 *
 * THE OPTIONAL-PATH LAW (spec/ARCHITECTURE-LOCK.md L1/L17: "core
 * runtime, simulation, learning, evaluation, body creation and
 * improvement work without Arena"; "Arena can augment but cannot be
 * required"; spec/ADAPTERS.md "Human expertise"): the adapter
 * TRANSLATES a platform-issued capability request onto the documented
 * Arena wire — it NEVER initiates, NEVER decides, NEVER verifies. The
 * request envelope is the platform's commissioning act (issued by the
 * platform's exchange); this module is the pure function from that
 * envelope to the wire frame.
 *
 * THE REFUSAL ORDER (deterministic, first-failure-wins, each a typed
 * protocol error — the laws cite their own lines):
 *   1. The request must pass the FULL T045 validation law (the mirror:
 *      structural shape, the L16a label scan, the evidence-citation
 *      law, the frozen verification contract, the deadline law, L12
 *      scope) — a malformed request is never routed.
 *   2. THE CATALOG-ENVELOPE LAW: the declared Arena catalog must SERVE
 *      the requested capability contract, PRODUCE the requested
 *      deliverable kind (through the offer's wire deliverable types)
 *      and ACCEPT every verification kind of the frozen contract —
 *      `arena_catalog_mismatch` (the provider cannot be surprised by a
 *      verification regime it did not declare; the same law the
 *      exchange's quote-match enforces, fail-fast at the boundary).
 *   3. The wire deliverable-type code must translate (the declared
 *      enum map covers the full ADAPTERS vocabulary — defense in
 *      depth).
 *
 * TRANSLATION (pure, deterministic, FIXED key order — byte-determinism):
 * the canonical request vocabulary maps onto the documented Arena wire
 * frame; the verification contract rides VERBATIM as the opaque
 * `goalposts` member (canonical bytes pinned by the guard on the
 * quote's echo — goalposts never move); the L12 scope rides NOWHERE
 * (the wire never carries tenant identity — the session injects scope
 * into the minted envelopes, never the reverse).
 *
 * NO NETWORK: the frame is BUILT, never sent. Sending is the session's
 * {@link ../session.ts routeRequest} (over the injected transport
 * port) — a runtime concern outside this module.
 */

import { failure, protocolError, success, type SdkResult } from './contract/errors';
import type { JsonObject } from './contract/json';
import type { OutboundMessage } from './contract/transport';
import { canonicalJson, deepFreeze } from './contract/provider';
import { validateCapabilityRequest } from './contract/provider-envelopes';
import type { CapabilityRequest } from './contract/provider-envelopes';
import { ARENA_CATALOG, ARENA_DELIVERABLE_KIND_MAP, ARENA_VERIFICATION_KIND_MAP } from './descriptor';
import { arenaProtocolError } from './protocol';

/** The Arena wire's outbound request channel (documented; not a consumed stream). */
export const ARENA_REQUEST_CHANNEL = 'arenaRequests';

/** The reverse deliverable-kind map: canonical kind -> wire code (deterministic, derived from the declared map). */
const WIRE_CODE_OF_KIND: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(ARENA_DELIVERABLE_KIND_MAP).map(([code, kind]) => [kind, code])),
);

/** The routing bundle: everything the translation reasons over. */
export interface ArenaRequestRouting {
  /** The platform-issued capability request (untrusted — validated through the T045 mirror first). */
  readonly request: unknown;
}

/** The resolved routing: the validated request + the declared offer that answers it + the wire frame. */
export interface ArenaRoutedRequest {
  readonly request: CapabilityRequest;
  /** The declared catalog offer that answers the request (deterministic: the FIRST match in catalog order). */
  readonly offerId: string;
  /** The documented wire frame (deep-frozen, FIXED key order). */
  readonly frame: JsonObject;
}

/** Resolve the declared offer that serves the request's capability, kinds and goalposts (the catalog-envelope law). */
function catalogMatchProblems(request: CapabilityRequest): { readonly offerId: string | null; readonly problems: readonly string[] } {
  const problems: string[] = [];
  const serving = ARENA_CATALOG.filter((offer) => offer.capability === request.requestedCapability);
  if (serving.length === 0) {
    problems.push(`the declared Arena catalog serves no offer for the capability contract "${request.requestedCapability}"`);
    return { offerId: null, problems };
  }
  const deliverableCode = WIRE_CODE_OF_KIND[request.deliverableKind];
  const kindMatched = serving.filter((offer) => offer.deliverableTypes.includes(deliverableCode));
  if (kindMatched.length === 0) {
    problems.push(`no offer for "${request.requestedCapability}" produces the deliverable kind "${request.deliverableKind}" (wire code ${JSON.stringify(deliverableCode)})`);
    return { offerId: null, problems };
  }
  const acceptedKinds = new Set<string>();
  for (const requirement of request.verification) {
    acceptedKinds.add(requirement.kind);
  }
  const fullyAccepting = kindMatched.filter((offer) => {
    for (const kind of acceptedKinds) {
      const wireCode = Object.entries(ARENA_VERIFICATION_KIND_MAP).find(([, canonical]) => canonical === kind)?.[0];
      if (wireCode === undefined || !offer.verificationTypes.includes(wireCode)) return false;
    }
    return true;
  });
  if (fullyAccepting.length === 0) {
    for (const kind of [...acceptedKinds].sort()) {
      problems.push(`no offer for "${request.requestedCapability}" accepts the verification kind "${kind}"`);
    }
    return { offerId: null, problems };
  }
  return { offerId: fullyAccepting[0]?.offerId ?? null, problems };
}

/**
 * Translate ONE platform-issued capability request into the documented
 * Arena wire frame. Pure and total: every refusal is a typed protocol
 * error (see the module header for the refusal order and its laws);
 * the success value carries the validated request, the answering
 * declared offer and the deep-frozen wire frame with a FIXED key order
 * (byte-determinism — the same routing inputs always produce the same
 * frame, byte-identically).
 */
export function buildArenaCapabilityRequest(routing: ArenaRequestRouting): SdkResult<ArenaRoutedRequest> {
  // 1. The full T045 validation law (the mirror — never a blind cast).
  const validated = validateCapabilityRequest(routing.request);
  if (!validated.ok) {
    return failure(
      protocolError(
        'invalid_configuration',
        `the routed request failed the CapabilityRequest law (the platform's exchange would refuse it; the adapter never routes what the exchange would not accept): ${validated.errors.map((error) => `(${error.code}) ${error.path}: ${error.message}`).join('; ')}`,
      ),
    );
  }
  const request = validated.value;

  // 2. THE CATALOG-ENVELOPE LAW (fail-fast at the boundary).
  const match = catalogMatchProblems(request);
  if (match.offerId === null) {
    return failure(
      arenaProtocolError(
        'arena_catalog_mismatch',
        `the declared Arena catalog cannot answer the request — ${match.problems.join('; ')} (the provider cannot be surprised by a capability, deliverable kind or verification regime it did not declare)`,
      ),
    );
  }

  // 3. The deliverable-type code translation (defense in depth).
  const deliverableCode = WIRE_CODE_OF_KIND[request.deliverableKind];
  if (deliverableCode === undefined) {
    return failure(
      protocolError('invalid_configuration', `the deliverable kind "${request.deliverableKind}" has no documented wire code`),
    );
  }

  // The translation itself: canonical request -> the documented wire
  // frame. FIXED key order (byte-determinism); the verification
  // contract rides VERBATIM as the opaque goalposts; the L12 scope
  // rides nowhere.
  const frame = deepFreeze({
    action: 'CAPABILITY_REQUEST',
    requestRef: request.requestId,
    capability: request.requestedCapability,
    brief: request.summary,
    deliverableType: deliverableCode,
    goalposts: request.verification,
    deadlineMs: request.deadline,
    terms: request.consideration,
    requestedAtMs: request.requestedAt,
    gapRefs: [...request.gapRefs],
    evidenceRefs: [...request.evidenceRefs],
  }) as unknown as JsonObject;

  return success({
    request,
    offerId: match.offerId,
    frame,
  });
}

/**
 * The canonical bytes of the frozen goalposts a routed request carries
 * (the pin the guard compares every echoed contract against — exported
 * for tests and for the session's goalpost law).
 */
export function goalpostBytes(request: CapabilityRequest): string {
  return canonicalJson(request.verification);
}
