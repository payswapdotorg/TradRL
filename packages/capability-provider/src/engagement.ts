// @tradrl/capability-provider — the ENGAGEMENT ENVELOPES: the typed
// request -> quote -> engagement -> deliverable conversation between
// the platform and an external capability provider.
//
// THE LAWS THIS MODULE SERVES:
// - The capability language (T017): a request names the capability
//   CONTRACT it needs (`CapabilityKey`), cites the typed capability
//   gaps that commissioned it ("persistent gap -> optional expertise
//   request", spec/LEARNING-LOOP.md "Human augmentation") and carries
//   the NON-EMPTY verification contract — the goalposts are fixed at
//   request time and NEVER move (the negotiation integrity law).
// - Provider-neutrality (spec/ADAPTERS.md "Human expertise"): the
//   deliverable-kind vocabulary is the ADAPTERS operation list minus
//   the request itself — expert-evidence | demonstration | annotation |
//   evaluation | capability-artifact — the same envelope shape for a
//   human expert, an arena (T046) and a marketplace vendor (T047).
// - The lifecycle law: the engagement status vocabulary and its
//   transition table are closed; every illegal transition is the typed
//   `invalid_transition`.
// - The deadline law (L4): an explicit deadline instant on the request
//   travels to the engagement; a deliverable submitted after it is the
//   typed `deadline_exceeded` (refused, retained as history).
// - L16a: a provider CLAIM (what the deliverable asserts it delivers)
//   carries NON-EMPTY measured evidence — a claim without evidence is
//   a label, and label keys anywhere are typed violations.
// - The payload law: the provider's opaque payload is UNTRUSTED input
//   (spec/SECURITY.md) — it is never interpreted, only pinned by its
//   content digest at the boundary (`payload_digest_mismatch` on any
//   divergence).
// - L12: every envelope carries tenant + project; L9: every envelope
//   identity is content-addressed (byte-deterministic mints).

import { deepCloneJson, deepFreeze, isArrayOf, isJsonValue, isMemberOf, isNonEmptyString, isPositiveInteger, isRecord, isTimestampMs } from './primitives';
import type { JsonValue, TimestampMs } from './primitives';
import type { ProviderResult } from './errors';
import { fail, invalidField, invalidType, ok } from './errors';
import {
  isCapabilityKey,
  isCapabilityRequestId,
  isCapabilityGapId,
  isDeliverableId,
  isEngagementId,
  isEvidenceRef,
  isProjectId,
  isProviderQuoteId,
  isProviderRef,
  isTenantId,
} from './ids';
import type {
  CapabilityGapId,
  CapabilityKey,
  CapabilityRequestId,
  DeliverableId,
  EngagementId,
  EvidenceRef,
  ProjectId,
  ProviderQuoteId,
  ProviderRef,
  TenantId,
} from './ids';
import {
  isMeasuredEvidenceMirror,
  isSkillApplicabilityMirror,
  labelKeyPaths,
} from './mirrors';
import type { MeasuredEvidenceMirror, SkillApplicabilityMirror } from './mirrors';
import {
  isVerificationRequirement,
  verificationContractProblems,
} from './verification';
import type { VerificationRequirement } from './verification';
import { canonicalJson, stableDigestJson } from './primitives';

// ---------------------------------------------------------------------------
// The deliverable-kind vocabulary (spec/ADAPTERS.md "Human expertise")
// ---------------------------------------------------------------------------

/**
 * The closed deliverable-kind vocabulary — the ADAPTERS operation list
 * ("request, expert evidence, demonstration, annotation, evaluation and
 * capability artifact") with `request` lifted to the request envelope
 * itself: the five kinds are what a provider DELIVERS.
 */
export const DELIVERABLE_KINDS = [
  'expert-evidence',
  'demonstration',
  'annotation',
  'evaluation',
  'capability-artifact',
] as const;

/** One deliverable kind. */
export type DeliverableKind = (typeof DELIVERABLE_KINDS)[number];

/** Guard: `DeliverableKind`. */
export function isDeliverableKind(v: unknown): v is DeliverableKind {
  return isMemberOf(DELIVERABLE_KINDS, v);
}

// ---------------------------------------------------------------------------
// The capability request (the platform's engagement request envelope)
// ---------------------------------------------------------------------------

/**
 * The platform's request for external capability: the capability
 * contract needed, the citation law (the typed gaps and/or evidence
 * refs that commissioned it — requests are extracted from recorded
 * deficits, never invented), the NON-EMPTY verification contract, the
 * explicit deadline instant, and the structured consideration (opaque
 * JSON — commercial semantics are T047's). Content-addressed (`cpr:`).
 */
export interface CapabilityRequest {
  /** Request identity (`cpr:<digest>` — content-addressed over the request content). */
  readonly requestId: CapabilityRequestId;
  /** The capability contract requested (the T017 language, never a profession label — L16a). */
  readonly requestedCapability: CapabilityKey;
  /** What the platform asks for (human-readable summary). */
  readonly summary: string;
  /** The deliverable kind the platform requests. */
  readonly deliverableKind: DeliverableKind;
  /** The typed capability gaps that commissioned the request (T017 gap mirrors). */
  readonly gapRefs: readonly CapabilityGapId[];
  /** Evidence-capsule references backing the request. */
  readonly evidenceRefs: readonly EvidenceRef[];
  /** The verification contract; NON-EMPTY (the goalposts, frozen at request time). */
  readonly verification: readonly VerificationRequirement[];
  /** The delivery deadline instant, or `null` for no deadline. */
  readonly deadline: TimestampMs | null;
  /** The structured consideration the platform offers (opaque JSON; T047 owns the semantics). */
  readonly consideration: JsonValue;
  /** Owning tenant (L12). */
  readonly tenantId: TenantId;
  /** Owning project (L12). */
  readonly projectId: ProjectId;
  /** Explicit request instant (epoch ms — never a wall clock). */
  readonly requestedAt: TimestampMs;
}

/** Guard: `CapabilityRequest` — structural totality INCLUDING the L16a label scan. */
export function isCapabilityRequest(v: unknown): v is CapabilityRequest {
  if (!isRecord(v)) return false;
  if (!isCapabilityRequestId(v.requestId)) return false;
  if (!isCapabilityKey(v.requestedCapability)) return false;
  if (!isNonEmptyString(v.summary)) return false;
  if (!isDeliverableKind(v.deliverableKind)) return false;
  if (!isArrayOf(v.gapRefs, isCapabilityGapId)) return false;
  if (!isArrayOf(v.evidenceRefs, isEvidenceRef)) return false;
  if (!Array.isArray(v.verification) || v.verification.length === 0) return false;
  if (!isArrayOf(v.verification, isVerificationRequirement)) return false;
  if (v.deadline !== null && !isTimestampMs(v.deadline)) return false;
  if (!isJsonValue(v.consideration)) return false;
  if (!isTenantId(v.tenantId) || !isProjectId(v.projectId)) return false;
  if (!isTimestampMs(v.requestedAt)) return false;
  if (labelKeyPaths(v).length > 0) return false; // L16a: no label keys, anywhere
  return true;
}

/** The request draft — everything EXCEPT the derived identity. */
export interface CapabilityRequestDraft {
  readonly requestedCapability: string;
  readonly summary: string;
  readonly deliverableKind: DeliverableKind;
  readonly gapRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly verification: readonly VerificationRequirement[];
  readonly deadline: number | null;
  readonly consideration: JsonValue;
  readonly tenantId: string;
  readonly projectId: string;
  readonly requestedAt: number;
}

/**
 * Collect-all validation of an untrusted capability request against the
 * FULL law, minting the content-addressed identity. The evidence law:
 * at least one citation across `gapRefs` + `evidenceRefs`
 * (`evidence_missing`); the verification law: NON-EMPTY contract with
 * unique refs (`verification_required`).
 */
export function validateCapabilityRequest(v: unknown, path = 'request'): ProviderResult<CapabilityRequest> {
  if (!isRecord(v)) return { ok: false, errors: [invalidType(path, `${path} must be an object`)] };
  const errors: ReturnType<typeof invalidField>[] = [];

  for (const labelPath of labelKeyPaths(v)) {
    errors.push({
      code: 'label_as_evidence',
      path: `${path}.${labelPath}`,
      message: `field "${labelPath}" cites a profession/role label — labels alone never establish suitability (L16a)`,
    });
  }

  if (v.requestedCapability === undefined) errors.push({ code: 'missing_field', path: `${path}.requestedCapability`, message: `"${path}.requestedCapability" is required` });
  else if (!isCapabilityKey(v.requestedCapability)) errors.push(invalidField(`${path}.requestedCapability`, 'invalid CapabilityKey (a capability CONTRACT, never a profession label — L16a)'));
  if (v.summary === undefined) errors.push({ code: 'missing_field', path: `${path}.summary`, message: `"${path}.summary" is required` });
  else if (!isNonEmptyString(v.summary)) errors.push(invalidField(`${path}.summary`, 'must be a non-empty summary of what is requested'));
  if (v.deliverableKind === undefined) errors.push({ code: 'missing_field', path: `${path}.deliverableKind`, message: `"${path}.deliverableKind" is required` });
  else if (!isDeliverableKind(v.deliverableKind)) errors.push(invalidField(`${path}.deliverableKind`, `must be one of ${DELIVERABLE_KINDS.join(' | ')}`));
  if (v.gapRefs === undefined) errors.push({ code: 'missing_field', path: `${path}.gapRefs`, message: `"${path}.gapRefs" is required` });
  else if (!isArrayOf(v.gapRefs, isCapabilityGapId)) errors.push(invalidField(`${path}.gapRefs`, 'must be an array of capability-gap references'));
  if (v.evidenceRefs === undefined) errors.push({ code: 'missing_field', path: `${path}.evidenceRefs`, message: `"${path}.evidenceRefs" is required` });
  else if (!isArrayOf(v.evidenceRefs, isEvidenceRef)) errors.push(invalidField(`${path}.evidenceRefs`, 'must be an array of evidence-capsule references'));
  if (v.verification === undefined) errors.push({ code: 'missing_field', path: `${path}.verification`, message: `"${path}.verification" is required` });
  else if (Array.isArray(v.verification)) {
    for (const problem of verificationContractProblems(v.verification, `${path}.verification`)) {
      errors.push({
        code: 'verification_required',
        path: problem.split(':')[0],
        message: problem,
      });
    }
  }
  if (v.deadline === undefined) errors.push({ code: 'missing_field', path: `${path}.deadline`, message: `"${path}.deadline" is required (or null for no deadline)` });
  else if (v.deadline !== null && !isTimestampMs(v.deadline)) errors.push(invalidField(`${path}.deadline`, 'invalid TimestampMs (or null for no deadline)'));
  if (v.consideration === undefined) errors.push({ code: 'missing_field', path: `${path}.consideration`, message: `"${path}.consideration" is required (use null for none)` });
  else if (!isJsonValue(v.consideration)) errors.push(invalidField(`${path}.consideration`, 'must be a JSON value (the structured terms; T047 owns the semantics)'));
  if (v.tenantId === undefined || !isTenantId(v.tenantId)) errors.push({ code: 'tenant_missing', path: `${path}.tenantId`, message: 'every capability request carries its owning tenant (L12)' });
  if (v.projectId === undefined || !isProjectId(v.projectId)) errors.push({ code: 'tenant_missing', path: `${path}.projectId`, message: 'every capability request carries its owning project (L12)' });
  if (v.requestedAt === undefined) errors.push({ code: 'missing_field', path: `${path}.requestedAt`, message: `"${path}.requestedAt" is required` });
  else if (!isTimestampMs(v.requestedAt)) errors.push(invalidField(`${path}.requestedAt`, 'invalid TimestampMs (explicit instant — never a wall clock)'));

  // THE EVIDENCE LAW: a request with no citation is invented, not requested.
  if (
    isArrayOf(v.gapRefs, isCapabilityGapId) &&
    isArrayOf(v.evidenceRefs, isEvidenceRef) &&
    (v.gapRefs as readonly string[]).length + (v.evidenceRefs as readonly string[]).length === 0
  ) {
    errors.push({
      code: 'evidence_missing',
      path: `${path}.gapRefs`,
      message: 'a capability request with no evidence citation is invalid — requests are commissioned by recorded capability gaps, never invented (Work Order T045, evidence law)',
    });
  }
  // L4: the deadline must postdate the request instant.
  if (v.deadline !== null && v.deadline !== undefined && isTimestampMs(v.deadline) && isTimestampMs(v.requestedAt) && v.deadline < v.requestedAt) {
    errors.push({
      code: 'l4_boundary_violation',
      path: `${path}.deadline`,
      message: `the deadline (${v.deadline}) predates the request instant (${v.requestedAt}) — deadlines are set when the request is issued`,
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  const draft = v as unknown as CapabilityRequestDraft;
  const identityContent = requestIdentityContent(draft);
  // Clone-then-freeze: the minted record NEVER aliases the caller's draft
  // (freezing untrusted input in place would be an observable side effect —
  // the pure-data law; the declaration lane disciplines the same way).
  const request: CapabilityRequest = deepFreeze(deepCloneJson({
    requestId: `cpr:${stableDigestJson(identityContent)}` as CapabilityRequestId,
    requestedCapability: draft.requestedCapability,
    summary: draft.summary,
    deliverableKind: draft.deliverableKind,
    gapRefs: draft.gapRefs,
    evidenceRefs: draft.evidenceRefs,
    verification: draft.verification,
    deadline: draft.deadline,
    consideration: draft.consideration,
    tenantId: draft.tenantId,
    projectId: draft.projectId,
    requestedAt: draft.requestedAt,
  } as unknown as JsonValue) as unknown as CapabilityRequest);
  if (!isCapabilityRequest(request)) {
    return fail('invalid_field', 'the minted request failed its own structural guard', path);
  }
  return ok(request);
}

/** The identity content of a request — everything EXCEPT the derived id. */
export function requestIdentityContent(draft: CapabilityRequestDraft): Record<string, unknown> {
  return {
    requestedCapability: draft.requestedCapability,
    summary: draft.summary,
    deliverableKind: draft.deliverableKind,
    gapRefs: draft.gapRefs,
    evidenceRefs: draft.evidenceRefs,
    verification: draft.verification,
    deadline: draft.deadline,
    consideration: JSON.parse(JSON.stringify(draft.consideration)) as JsonValue,
    tenantId: draft.tenantId,
    projectId: draft.projectId,
    requestedAt: draft.requestedAt,
  };
}

// ---------------------------------------------------------------------------
// The provider quote (the provider's answer)
// ---------------------------------------------------------------------------

/** The provider's negotiated terms: the deliverable kind and verification contract ACCEPTED VERBATIM, plus counter-consideration. */
export interface ProviderTerms {
  /** MUST equal the request's deliverableKind (the quote answers what was asked). */
  readonly deliverableKind: DeliverableKind;
  /** MUST equal the request's verification contract VERBATIM (canonical bytes) — goalposts never move. */
  readonly verification: readonly VerificationRequirement[];
  /** The provider's counter-consideration (opaque JSON; T047 owns the semantics). */
  readonly consideration: JsonValue;
  /** The provider's estimated delivery instant, or `null` for no estimate. */
  readonly estimatedDeliveryAt: TimestampMs | null;
}

/** Guard: `ProviderTerms`. */
export function isProviderTerms(v: unknown): v is ProviderTerms {
  if (!isRecord(v)) return false;
  if (!isDeliverableKind(v.deliverableKind)) return false;
  if (!Array.isArray(v.verification) || v.verification.length === 0) return false;
  if (!isArrayOf(v.verification, isVerificationRequirement)) return false;
  if (!isJsonValue(v.consideration)) return false;
  if (v.estimatedDeliveryAt !== null && !isTimestampMs(v.estimatedDeliveryAt)) return false;
  return true;
}

/**
 * The provider's answer to a capability request: which declared offer
 * answers it, under what terms. Content-addressed (`qte:`). The
 * exchange enforces the match laws (`quote_mismatch`): the offer
 * exists on the provider's CURRENT declaration, its capabilityKey is
 * the requested one, the terms accept the deliverable kind and the
 * verification contract VERBATIM, and the quote postdates the request.
 */
export interface ProviderQuote {
  /** Quote identity (`qte:<digest>` — content-addressed). */
  readonly quoteId: ProviderQuoteId;
  /** The request being answered. */
  readonly requestId: CapabilityRequestId;
  /** The quoting provider. */
  readonly providerRef: ProviderRef;
  /** The declared offer that answers the request. */
  readonly offerRef: string;
  /** The negotiated terms (kind + verification accepted verbatim). */
  readonly terms: ProviderTerms;
  /** Explicit quote instant (epoch ms — never a wall clock). */
  readonly quotedAt: TimestampMs;
  /** Owning tenant (L12). */
  readonly tenantId: TenantId;
  /** Owning project (L12). */
  readonly projectId: ProjectId;
}

/** Guard: `ProviderQuote`. */
export function isProviderQuote(v: unknown): v is ProviderQuote {
  if (!isRecord(v)) return false;
  if (!isProviderQuoteId(v.quoteId)) return false;
  if (!isCapabilityRequestId(v.requestId)) return false;
  if (!isProviderRef(v.providerRef)) return false;
  if (!isNonEmptyString(v.offerRef)) return false;
  if (!isProviderTerms(v.terms)) return false;
  if (!isTimestampMs(v.quotedAt)) return false;
  if (!isTenantId(v.tenantId) || !isProjectId(v.projectId)) return false;
  if (labelKeyPaths(v).length > 0) return false; // L16a
  return true;
}

/** The registry view of a provider declaration the quote-match law needs (the exchange passes the CURRENT declaration). */
export interface DeclarationQuoteView {
  readonly providerRef: ProviderRef;
  readonly offers: readonly {
    readonly offerRef: string;
    readonly capabilityKey: CapabilityKey;
    readonly deliverableKinds: readonly DeliverableKind[];
    readonly verificationKinds: readonly string[];
  }[];
}

/**
 * The QUOTE-MATCH LAW: a quote answers its request — same deliverable
 * kind, the verification contract accepted VERBATIM (canonical bytes),
 * the quote postdates the request, and the offer resolves on the
 * provider's current declaration to an offer serving the requested
 * capability. Returns the typed `quote_mismatch` failure list (empty
 * on match).
 */
export function quoteMatchProblems(
  request: CapabilityRequest,
  quote: ProviderQuote,
  declaration: DeclarationQuoteView | undefined,
): readonly string[] {
  const problems: string[] = [];
  if (quote.requestId !== request.requestId) {
    problems.push(`the quote answers request ${quote.requestId} but was submitted against ${request.requestId}`);
  }
  if (quote.tenantId !== request.tenantId || quote.projectId !== request.projectId) {
    problems.push('the quote\'s tenant/project scope disagrees with the request\'s (L12)');
  }
  if (quote.quotedAt < request.requestedAt) {
    problems.push(`the quote instant (${quote.quotedAt}) predates the request instant (${request.requestedAt}) (L4)`);
  }
  if (quote.terms.deliverableKind !== request.deliverableKind) {
    problems.push(`the quote offers deliverable kind "${quote.terms.deliverableKind}" but the request asked for "${request.deliverableKind}"`);
  }
  if (canonicalJson(quote.terms.verification) !== canonicalJson(request.verification)) {
    problems.push('the quote\'s verification contract is not the request\'s VERBATIM — goalposts never move (the negotiation integrity law)');
  }
  if (declaration !== undefined) {
    if (declaration.providerRef !== quote.providerRef) {
      problems.push(`the quote names provider ${quote.providerRef} but the registry declaration is ${declaration.providerRef}`);
    }
    const offer = declaration.offers.find((candidate) => candidate.offerRef === quote.offerRef);
    if (offer === undefined) {
      problems.push(`the offer "${quote.offerRef}" does not exist on the provider's current declaration`);
    } else {
      if (offer.capabilityKey !== request.requestedCapability) {
        problems.push(`the offer serves capability "${offer.capabilityKey}" but the request asked for "${request.requestedCapability}"`);
      }
      if (!offer.deliverableKinds.includes(request.deliverableKind)) {
        problems.push(`the offer does not produce deliverable kind "${request.deliverableKind}"`);
      }
      for (const requirement of request.verification) {
        if (!offer.verificationKinds.includes(requirement.kind)) {
          problems.push(`the offer does not accept verification kind "${requirement.kind}" (requirement ${requirement.requirementRef})`);
        }
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// The engagement (the negotiated contract)
// ---------------------------------------------------------------------------

/**
 * The engagement lifecycle — closed status vocabulary, closed
 * transition table:
 *
 *   open --deliver--> delivered --deliver--> delivered
 *   delivered --verify--> verified | rejected
 *   open | delivered --withdraw--> withdrawn
 *   verified | rejected | withdrawn are TERMINAL.
 */
export type EngagementStatus = 'open' | 'delivered' | 'verified' | 'rejected' | 'withdrawn';

/** The closed transition table (from -> allowed to). */
export const ENGAGEMENT_TRANSITIONS: Readonly<Record<EngagementStatus, readonly EngagementStatus[]>> = Object.freeze({
  open: ['delivered', 'withdrawn'],
  delivered: ['delivered', 'verified', 'rejected', 'withdrawn'],
  verified: [],
  rejected: [],
  withdrawn: [],
});

/** Guard: `EngagementStatus`. */
export function isEngagementStatus(v: unknown): v is EngagementStatus {
  return v === 'open' || v === 'delivered' || v === 'verified' || v === 'rejected' || v === 'withdrawn';
}

/** `true` iff `to` is a legal successor of `from` (the closed table). */
export function isLegalTransition(from: EngagementStatus, to: EngagementStatus): boolean {
  return ENGAGEMENT_TRANSITIONS[from].includes(to);
}

/**
 * The negotiated contract: the request + the accepted quote, with the
 * verification contract FROZEN (it travels verbatim from the request
 * through the quote into the engagement), the deadline, and the
 * applicability scope SNAPSHOTTED from the provider's declared offer
 * at open time (the engagement is self-contained: later declaration
 * supersessions cannot retro-actively change what was negotiated —
 * L18's localizability). Content-addressed (`eng:`).
 */
export interface Engagement {
  /** Engagement identity (`eng:<digest>` — content-addressed over the request+quote pair). */
  readonly engagementId: EngagementId;
  /** The commissioned request. */
  readonly requestId: CapabilityRequestId;
  /** The accepted quote. */
  readonly quoteId: ProviderQuoteId;
  /** The engaged provider. */
  readonly providerRef: ProviderRef;
  /** The deliverable kind (frozen from the request). */
  readonly deliverableKind: DeliverableKind;
  /** The verification contract (frozen VERBATIM from the request). */
  readonly verification: readonly VerificationRequirement[];
  /** The delivery deadline (frozen from the request; `null` for none). */
  readonly deadline: TimestampMs | null;
  /** The applicability scope snapshotted from the provider's offer at open time. */
  readonly applicability: SkillApplicabilityMirror;
  /** The lifecycle status. */
  readonly status: EngagementStatus;
  /** Explicit open instant (epoch ms — never a wall clock). */
  readonly openedAt: TimestampMs;
  /** Owning tenant (L12). */
  readonly tenantId: TenantId;
  /** Owning project (L12). */
  readonly projectId: ProjectId;
}

/** Guard: `Engagement`. */
export function isEngagement(v: unknown): v is Engagement {
  if (!isRecord(v)) return false;
  if (!isEngagementId(v.engagementId)) return false;
  if (!isCapabilityRequestId(v.requestId)) return false;
  if (!isProviderQuoteId(v.quoteId)) return false;
  if (!isProviderRef(v.providerRef)) return false;
  if (!isDeliverableKind(v.deliverableKind)) return false;
  if (!Array.isArray(v.verification) || v.verification.length === 0) return false;
  if (!isArrayOf(v.verification, isVerificationRequirement)) return false;
  if (v.deadline !== null && !isTimestampMs(v.deadline)) return false;
  if (!isSkillApplicabilityMirror(v.applicability)) return false;
  if (!isEngagementStatus(v.status)) return false;
  if (!isTimestampMs(v.openedAt)) return false;
  if (!isTenantId(v.tenantId) || !isProjectId(v.projectId)) return false;
  if (labelKeyPaths(v).length > 0) return false; // L16a
  return true;
}

// ---------------------------------------------------------------------------
// The provider claim + the deliverable
// ---------------------------------------------------------------------------

/**
 * ONE provider claim: what the deliverable asserts it delivers — a
 * capability contract plus the NON-EMPTY measured evidence backing the
 * assertion (L16a: a claim without evidence is a label). Claims are
 * the import path's currency: a verified capability-artifact's claims
 * become the imported SkillRecord's measured evidence.
 */
export interface ProviderClaim {
  /** Claim identity (unique within the deliverable). */
  readonly claimRef: string;
  /** The capability contract this claim asserts. */
  readonly capabilityKey: CapabilityKey;
  /** Measured evidence backing the claim; NON-EMPTY (L16a). */
  readonly measuredEvidence: readonly MeasuredEvidenceMirror[];
}

/** Guard: `ProviderClaim`. */
export function isProviderClaim(v: unknown): v is ProviderClaim {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.claimRef)) return false;
  if (!isCapabilityKey(v.capabilityKey)) return false;
  if (!Array.isArray(v.measuredEvidence) || v.measuredEvidence.length === 0) return false;
  if (!isArrayOf(v.measuredEvidence, isMeasuredEvidenceMirror)) return false;
  if (labelKeyPaths(v).length > 0) return false; // L16a
  return true;
}

/**
 * The provider's submitted work: the deliverable kind, the NON-EMPTY
 * claim list, and the OPAQUE payload — untrusted input pinned by its
 * content digest (the payload is never interpreted by the exchange;
 * verification machinery + the import path decide what it means).
 * Content-addressed (`dlv:`).
 */
export interface Deliverable {
  /** Deliverable identity (`dlv:<digest>` — content-addressed). */
  readonly deliverableId: DeliverableId;
  /** The engagement this deliverable answers. */
  readonly engagementId: EngagementId;
  /** The deliverable kind (MUST equal the engagement's). */
  readonly kind: DeliverableKind;
  /** What the deliverable asserts; NON-EMPTY, each claim evidence-backed (L16a). */
  readonly claims: readonly ProviderClaim[];
  /** The opaque provider payload — UNTRUSTED (spec/SECURITY.md); pinned by `payloadDigest`. */
  readonly payload: JsonValue;
  /** The content digest of `payload` (canonical bytes — tamper-evident at the boundary). */
  readonly payloadDigest: string;
  /** Explicit submission instant (epoch ms — never a wall clock). */
  readonly submittedAt: TimestampMs;
  /** Owning tenant (L12). */
  readonly tenantId: TenantId;
  /** Owning project (L12). */
  readonly projectId: ProjectId;
}

/** Guard: `Deliverable` — structural totality INCLUDING the L16a label scan. */
export function isDeliverable(v: unknown): v is Deliverable {
  if (!isRecord(v)) return false;
  if (!isDeliverableId(v.deliverableId)) return false;
  if (!isEngagementId(v.engagementId)) return false;
  if (!isDeliverableKind(v.kind)) return false;
  if (!Array.isArray(v.claims) || v.claims.length === 0) return false;
  if (!isArrayOf(v.claims, isProviderClaim)) return false;
  if (!isJsonValue(v.payload)) return false;
  if (typeof v.payloadDigest !== 'string' || !/^[0-9a-f]{16}$/.test(v.payloadDigest)) return false;
  if (!isTimestampMs(v.submittedAt)) return false;
  if (!isTenantId(v.tenantId) || !isProjectId(v.projectId)) return false;
  if (labelKeyPaths(v).length > 0) return false; // L16a
  return true;
}

/**
 * Collect-all validation of an untrusted deliverable draft, minting
 * the content-addressed identity AND enforcing the payload law
 * (`payloadDigest` must equal the stable digest of the payload's
 * canonical bytes — `payload_digest_mismatch`).
 */
export function validateDeliverable(v: unknown, path = 'deliverable'): ProviderResult<Deliverable> {
  if (!isRecord(v)) return { ok: false, errors: [invalidType(path, `${path} must be an object`)] };
  const errors: ReturnType<typeof invalidField>[] = [];

  for (const labelPath of labelKeyPaths(v)) {
    errors.push({
      code: 'label_as_evidence',
      path: `${path}.${labelPath}`,
      message: `field "${labelPath}" cites a profession/role label — labels alone never establish suitability (L16a)`,
    });
  }

  if (v.engagementId === undefined) errors.push({ code: 'missing_field', path: `${path}.engagementId`, message: `"${path}.engagementId" is required` });
  else if (!isEngagementId(v.engagementId)) errors.push(invalidField(`${path}.engagementId`, 'invalid EngagementId'));
  if (v.kind === undefined) errors.push({ code: 'missing_field', path: `${path}.kind`, message: `"${path}.kind" is required` });
  else if (!isDeliverableKind(v.kind)) errors.push(invalidField(`${path}.kind`, `must be one of ${DELIVERABLE_KINDS.join(' | ')}`));
  if (v.claims === undefined) errors.push({ code: 'missing_field', path: `${path}.claims`, message: `"${path}.claims" is required` });
  else if (Array.isArray(v.claims)) {
    if (v.claims.length === 0) {
      errors.push({
        code: 'label_as_evidence',
        path: `${path}.claims`,
        message: 'a deliverable carries at least one provider claim — a claim-less deliverable asserts nothing verifiable (L16a discipline)',
      });
    } else {
      const claimRefs = new Set<string>();
      v.claims.forEach((claim: unknown, index: number) => {
        const claimPath = `${path}.claims[${index}]`;
        if (!isProviderClaim(claim)) {
          errors.push(invalidField(claimPath, 'failed the ProviderClaim shape (claimRef + capabilityKey + NON-EMPTY measured evidence — L16a)'));
          return;
        }
        if (claimRefs.has(claim.claimRef)) {
          errors.push(invalidField(claimPath, `duplicate claimRef "${claim.claimRef}" (unique within the deliverable)`));
        } else {
          claimRefs.add(claim.claimRef);
        }
      });
    }
  }
  if (v.payload === undefined) errors.push({ code: 'missing_field', path: `${path}.payload`, message: `"${path}.payload" is required (the opaque provider content)` });
  else if (!isJsonValue(v.payload)) errors.push(invalidField(`${path}.payload`, 'must be a JSON value (the opaque untrusted payload)'));
  if (v.payloadDigest === undefined) errors.push({ code: 'missing_field', path: `${path}.payloadDigest`, message: `"${path}.payloadDigest" is required` });
  else if (typeof v.payloadDigest !== 'string' || !/^[0-9a-f]{16}$/.test(v.payloadDigest)) {
    errors.push(invalidField(`${path}.payloadDigest`, 'must be a 16-hex stable digest of the payload'));
  }
  if (v.submittedAt === undefined) errors.push({ code: 'missing_field', path: `${path}.submittedAt`, message: `"${path}.submittedAt" is required` });
  else if (!isTimestampMs(v.submittedAt)) errors.push(invalidField(`${path}.submittedAt`, 'invalid TimestampMs (explicit instant — never a wall clock)'));
  if (v.tenantId === undefined || !isTenantId(v.tenantId)) errors.push({ code: 'tenant_missing', path: `${path}.tenantId`, message: 'every deliverable carries its owning tenant (L12)' });
  if (v.projectId === undefined || !isProjectId(v.projectId)) errors.push({ code: 'tenant_missing', path: `${path}.projectId`, message: 'every deliverable carries its owning project (L12)' });

  // THE PAYLOAD LAW: the digest pins the payload's canonical bytes.
  if (isJsonValue(v.payload) && typeof v.payloadDigest === 'string' && /^[0-9a-f]{16}$/.test(v.payloadDigest)) {
    const actual = stableDigestJson(v.payload);
    if (actual !== v.payloadDigest) {
      errors.push({
        code: 'payload_digest_mismatch',
        path: `${path}.payloadDigest`,
        message: `the payload digest is ${v.payloadDigest} but the payload's canonical bytes digest to ${actual} — the opaque payload is pinned at the boundary (tamper-evident)`,
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  const draft = v as unknown as Omit<Deliverable, 'deliverableId'>;
  const identityContent = {
    engagementId: draft.engagementId,
    kind: draft.kind,
    claims: draft.claims,
    payload: draft.payload,
    payloadDigest: draft.payloadDigest,
    submittedAt: draft.submittedAt,
    tenantId: draft.tenantId,
    projectId: draft.projectId,
  };
  // Clone-then-freeze: the minted record never aliases (nor freezes in
  // place) the caller's untrusted draft — pure in, pure out.
  const deliverable: Deliverable = deepFreeze(deepCloneJson({
    ...identityContent,
    deliverableId: `dlv:${stableDigestJson(identityContent)}` as DeliverableId,
  } as unknown as JsonValue) as unknown as Deliverable);
  if (!isDeliverable(deliverable)) {
    return fail('invalid_field', 'the minted deliverable failed its own structural guard', path);
  }
  return ok(deliverable);
}
