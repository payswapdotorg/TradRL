/**
 * @tradrl/adapter-arena — the documented Arena wire schemas.
 *
 * THE PROVIDER-SPECIFIC INBOUND CONTRACT (L2/L13 — all wire semantics
 * live here, never in the minted canonical envelopes): the documented
 * shapes of the three Arena wire channels, as total hand-rolled
 * guards. Unknown `messageKind` discriminators are typed
 * `unknown_message_kind` failures; malformed documented fields are
 * typed `malformed_payload` failures — never silent drops. Field
 * ACCOUNTING (the anti-silent-drop law) is the mapping engine's
 * ({@link ./contract/mapping.ts}); these guards validate the
 * DOCUMENTED SHAPES first (defense in depth, the sibling adapters'
 * discipline).
 *
 * Documented shapes (all SYNTHETIC opaque refs — no licensed content,
 * no credentials, no account-specific data; spec/ADAPTERS.md Licensing):
 *
 *   arenaCatalog — one full catalog publication:
 *     { messageKind: "ARENA_CATALOG", messageId, providerName, offers:
 *       [{ offerId, capability, summary, evidence[], scope:
 *       { environments[], instruments[] }, deliverableTypes[],
 *       verificationTypes[] }], catalogRevision, publishedAtMs }
 *
 *   arenaQuotes — one quote response:
 *     { messageKind: "ARENA_QUOTE", messageId, requestRef, offerRef,
 *       deliverableType, verificationEcho[], counterTerms,
 *       estimatedDeliveryMs | null, respondedAtMs }
 *
 *   arenaDeliveries — one submitted work item:
 *     { messageKind: "ARENA_DELIVERY", messageId, engagementRef,
 *       deliverableType, claims: [{ claimId, capability, evidence[] }],
 *       content, deliveredAtMs }
 */

import { isMeasuredEvidenceMirror, isTimestampMs } from './contract/provider';
import type { MeasuredEvidenceMirror, TimestampMs } from './contract/provider';
import { isVerificationRequirement } from './contract/provider-envelopes';
import type { VerificationRequirement } from './contract/provider-envelopes';
import { isNonEmptyString, isRecord } from './contract/fields';
import { failure, success, type SdkResult } from './contract/errors';
import type { JsonObject } from './contract/json';
import { isJsonValue } from './contract/json';
import { arenaProtocolError } from './protocol';
import { ARENA_DELIVERABLE_KIND_MAP, ARENA_VERIFICATION_KIND_MAP } from './descriptor';

/**
 * The documented Arena wire field names — the provider vocabulary the
 * neutrality test asserts NEVER appears in the minted canonical
 * envelopes (beyond the members the T045 contract itself shares — see
 * {@link ARENA_WIRE_NAMES_SHARED_WITH_CANONICAL}, the declared overlap).
 */
export const ARENA_WIRE_FIELD_NAMES: readonly string[] = [
  'messageKind',
  'messageId',
  'providerName',
  'offers',
  'offerId',
  'capability',
  'summary',
  'evidence',
  'scope',
  'environments',
  'instruments',
  'deliverableTypes',
  'verificationTypes',
  'catalogRevision',
  'publishedAtMs',
  'requestRef',
  'offerRef',
  'deliverableType',
  'verificationEcho',
  'counterTerms',
  'estimatedDeliveryMs',
  'respondedAtMs',
  'engagementRef',
  'claims',
  'claimId',
  'content',
  'deliveredAtMs',
];

/**
 * The documented wire field names that the T045 canonical contracts
 * themselves share — the declared CANONICAL OVERLAP. The wire's catalog
 * publishes an `offers` array (of `offerId`/`capability`/`summary`/…
 * members), the wire's quote names its `offerRef`, and the wire's
 * delivery carries `claims` — while the T045 declaration/quote/
 * deliverable drafts legitimately own the SAME names (`offers`,
 * `offerRef`, `summary`, `claims`) as canonical field names. The
 * inverse-neutrality trip-wires (the banned-name walk over the minted
 * envelopes) must therefore exclude these members from the banned list
 * — exactly the sibling adapters' discipline (adapters/brokers'
 * `canonicalOverlap = ['venue', 'side']`): every OTHER documented wire
 * field name is provider-only and banned from the minted canonical
 * envelopes.
 */
export const ARENA_WIRE_NAMES_SHARED_WITH_CANONICAL: readonly string[] = Object.freeze([
  'offers',
  'offerRef',
  'summary',
  'claims',
]);

/** The documented messageKind discriminators. */
export const ARENA_MESSAGE_KINDS: readonly string[] = ['ARENA_CATALOG', 'ARENA_QUOTE', 'ARENA_DELIVERY'];

/** One validated catalog publication message (the documented shape). */
export interface ArenaCatalogMessage {
  readonly messageKind: 'ARENA_CATALOG';
  readonly messageId: string;
  readonly providerName: string;
  readonly offers: readonly {
    readonly offerId: string;
    readonly capability: string;
    readonly summary: string;
    readonly evidence: readonly MeasuredEvidenceMirror[];
    readonly scope: { readonly environments: readonly string[]; readonly instruments: readonly string[] };
    readonly deliverableTypes: readonly string[];
    readonly verificationTypes: readonly string[];
  }[];
  readonly catalogRevision: number;
  readonly publishedAtMs: TimestampMs;
}

/** One validated quote-response message (the documented shape). */
export interface ArenaQuoteMessage {
  readonly messageKind: 'ARENA_QUOTE';
  readonly messageId: string;
  readonly requestRef: string;
  readonly offerRef: string;
  readonly deliverableType: string;
  readonly verificationEcho: readonly VerificationRequirement[];
  readonly counterTerms: unknown;
  readonly estimatedDeliveryMs: TimestampMs | null;
  readonly respondedAtMs: TimestampMs;
}

/** One validated delivery message (the documented shape). */
export interface ArenaDeliveryMessage {
  readonly messageKind: 'ARENA_DELIVERY';
  readonly messageId: string;
  readonly engagementRef: string;
  readonly deliverableType: string;
  readonly claims: readonly { readonly claimId: string; readonly capability: string; readonly evidence: readonly MeasuredEvidenceMirror[] }[];
  readonly content: unknown;
  readonly deliveredAtMs: TimestampMs;
}

// ---------------------------------------------------------------------------
// Shared field guards (documented shapes)
// ---------------------------------------------------------------------------

/** `true` iff the value is a documented wire deliverable-type code with a canonical translation. */
function isWireDeliverableType(value: unknown): value is string {
  return typeof value === 'string' && value in ARENA_DELIVERABLE_KIND_MAP;
}

/** `true` iff the value is a documented wire verification-type code with a canonical translation. */
function isWireVerificationType(value: unknown): value is string {
  return typeof value === 'string' && value in ARENA_VERIFICATION_KIND_MAP;
}

/** Guard one wire evidence array (the measured-evidence union). */
function guardWireEvidence(value: unknown, path: string): string | null {
  if (!Array.isArray(value) || value.length === 0) {
    return `${path}: must be a NON-EMPTY array of measured evidence (L16a — a bare claim is a label)`;
  }
  for (let index = 0; index < value.length; index++) {
    if (!isMeasuredEvidenceMirror(value[index])) {
      return `${path}[${index}]: failed the closed MeasuredEvidence union (benchmark | measurement-record | result-ref)`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// The channel guards
// ---------------------------------------------------------------------------

/**
 * Guard an arenaCatalog message payload. The wire offers' deliverable
 * and verification type codes must be documented (they carry canonical
 * translations); unknown messageKind discriminators and malformed
 * documented fields are typed failures.
 */
export function guardArenaCatalogPayload(payload: JsonObject): SdkResult<ArenaCatalogMessage> {
  if (payload.messageKind !== 'ARENA_CATALOG') {
    return failure(
      arenaProtocolError(
        'unknown_message_kind',
        `the documented messageKind discriminator is ${JSON.stringify(payload.messageKind)} but the catalog channel carries "ARENA_CATALOG"`,
      ),
    );
  }
  if (!isNonEmptyString(payload.messageId)) return malformed('messageId', 'must be a non-empty wire message id');
  if (!isNonEmptyString(payload.providerName)) return malformed('providerName', 'must be a non-empty provider display name');
  if (!Array.isArray(payload.offers) || payload.offers.length === 0) return malformed('offers', 'must be a NON-EMPTY array of wire offers');
  for (let index = 0; index < payload.offers.length; index++) {
    const offer = payload.offers[index];
    const path = `offers[${index}]`;
    if (!isRecord(offer)) return malformed(path, 'each wire offer must be an object');
    if (!isNonEmptyString(offer.offerId)) return malformed(`${path}.offerId`, 'must be a non-empty offer id');
    if (!isNonEmptyString(offer.capability)) return malformed(`${path}.capability`, 'must be a non-empty capability-contract key');
    if (!isNonEmptyString(offer.summary)) return malformed(`${path}.summary`, 'must be a non-empty summary');
    const evidenceProblem = guardWireEvidence(offer.evidence, `${path}.evidence`);
    if (evidenceProblem !== null) return failure(arenaProtocolError('malformed_payload', evidenceProblem));
    if (!isRecord(offer.scope) || !Array.isArray(offer.scope.environments) || !Array.isArray(offer.scope.instruments)) {
      return malformed(`${path}.scope`, 'must carry environments[] and instruments[]');
    }
    if (!Array.isArray(offer.deliverableTypes) || offer.deliverableTypes.length === 0) {
      return malformed(`${path}.deliverableTypes`, 'must be a NON-EMPTY array of wire deliverable-type codes');
    }
    for (const code of offer.deliverableTypes) {
      if (!isWireDeliverableType(code)) {
        return malformed(`${path}.deliverableTypes`, `wire code ${JSON.stringify(code)} is not a documented deliverable type`);
      }
    }
    if (!Array.isArray(offer.verificationTypes) || offer.verificationTypes.length === 0) {
      return malformed(`${path}.verificationTypes`, 'must be a NON-EMPTY array of wire verification-type codes');
    }
    for (const code of offer.verificationTypes) {
      if (!isWireVerificationType(code)) {
        return malformed(`${path}.verificationTypes`, `wire code ${JSON.stringify(code)} is not a documented verification type`);
      }
    }
  }
  if (typeof payload.catalogRevision !== 'number' || !Number.isSafeInteger(payload.catalogRevision) || payload.catalogRevision < 1) {
    return malformed('catalogRevision', 'must be a positive safe integer (the catalog publication revision)');
  }
  if (!isTimestampMs(payload.publishedAtMs)) return malformed('publishedAtMs', 'must be a valid epoch-millisecond instant');
  return success(payload as unknown as ArenaCatalogMessage);
}

/**
 * Guard an arenaQuotes message payload. The verification echo must be
 * the closed requirement union; the counter-terms must be a JSON value;
 * the instants must be valid (estimated delivery may be null).
 */
export function guardArenaQuotePayload(payload: JsonObject): SdkResult<ArenaQuoteMessage> {
  if (payload.messageKind !== 'ARENA_QUOTE') {
    return failure(
      arenaProtocolError(
        'unknown_message_kind',
        `the documented messageKind discriminator is ${JSON.stringify(payload.messageKind)} but the quotes channel carries "ARENA_QUOTE"`,
      ),
    );
  }
  if (!isNonEmptyString(payload.messageId)) return malformed('messageId', 'must be a non-empty wire message id');
  if (!isNonEmptyString(payload.requestRef)) return malformed('requestRef', 'must be a non-empty correlation ref (the routed request id)');
  if (!isNonEmptyString(payload.offerRef)) return malformed('offerRef', 'must be a non-empty offer ref');
  if (!isWireDeliverableType(payload.deliverableType)) return malformed('deliverableType', 'must be a documented wire deliverable-type code');
  if (!Array.isArray(payload.verificationEcho) || payload.verificationEcho.length === 0) {
    return malformed('verificationEcho', 'must be a NON-EMPTY array of verification requirements (the frozen goalposts, echoed)');
  }
  for (let index = 0; index < payload.verificationEcho.length; index++) {
    if (!isVerificationRequirement(payload.verificationEcho[index])) {
      return malformed(`verificationEcho[${index}]`, 'failed the closed VerificationRequirement union');
    }
  }
  if (!isJsonValue(payload.counterTerms)) return malformed('counterTerms', 'must be a JSON value (the structured counter-consideration)');
  if (payload.estimatedDeliveryMs !== null && !isTimestampMs(payload.estimatedDeliveryMs)) {
    return malformed('estimatedDeliveryMs', 'must be a valid epoch-millisecond instant or null');
  }
  if (!isTimestampMs(payload.respondedAtMs)) return malformed('respondedAtMs', 'must be a valid epoch-millisecond instant');
  return success(payload as unknown as ArenaQuoteMessage);
}

/**
 * Guard an arenaDeliveries message payload. The claims must each carry
 * NON-EMPTY measured evidence (L16a); the content must be a JSON value
 * (the opaque provider payload — untrusted, pinned by digest at the
 * mapping boundary).
 */
export function guardArenaDeliveryPayload(payload: JsonObject): SdkResult<ArenaDeliveryMessage> {
  if (payload.messageKind !== 'ARENA_DELIVERY') {
    return failure(
      arenaProtocolError(
        'unknown_message_kind',
        `the documented messageKind discriminator is ${JSON.stringify(payload.messageKind)} but the deliveries channel carries "ARENA_DELIVERY"`,
      ),
    );
  }
  if (!isNonEmptyString(payload.messageId)) return malformed('messageId', 'must be a non-empty wire message id');
  if (!isNonEmptyString(payload.engagementRef)) return malformed('engagementRef', 'must be a non-empty correlation ref (the platform engagement id)');
  if (!isWireDeliverableType(payload.deliverableType)) return malformed('deliverableType', 'must be a documented wire deliverable-type code');
  if (!Array.isArray(payload.claims) || payload.claims.length === 0) {
    return malformed('claims', 'must be a NON-EMPTY array of wire claims');
  }
  for (let index = 0; index < payload.claims.length; index++) {
    const claim = payload.claims[index];
    const path = `claims[${index}]`;
    if (!isRecord(claim)) return malformed(path, 'each wire claim must be an object');
    if (!isNonEmptyString(claim.claimId)) return malformed(`${path}.claimId`, 'must be a non-empty claim id');
    if (!isNonEmptyString(claim.capability)) return malformed(`${path}.capability`, 'must be a non-empty capability-contract key');
    const evidenceProblem = guardWireEvidence(claim.evidence, `${path}.evidence`);
    if (evidenceProblem !== null) return failure(arenaProtocolError('malformed_payload', evidenceProblem));
  }
  if (!isJsonValue(payload.content)) return malformed('content', 'must be a JSON value (the opaque provider payload)');
  if (!isTimestampMs(payload.deliveredAtMs)) return malformed('deliveredAtMs', 'must be a valid epoch-millisecond instant');
  return success(payload as unknown as ArenaDeliveryMessage);
}

/** Convenience constructor for a typed malformed-payload failure. */
function malformed(field: string, detail: string): SdkResult<never> {
  return failure(arenaProtocolError('malformed_payload', `the wire field "${field}": ${detail}`));
}
