// @tradrl/marketplace-service — the COMMISSION: minting the T045-shaped
// capability-request draft from a recorded capability gap + an active
// listing + the offered consideration (the T017 + T045 + T047
// composition).
//
// THE LAWS THIS MODULE SERVES:
// - THE EVIDENCE LAW (T045's, composed): a capability request is
//   COMMISSIONED by recorded evidence — the typed capability gaps
//   and/or evidence-capsule refs that detected the deficit ("a request
//   with no citation is invented, not requested"); the commission
//   minter refuses an uncited draft (`evidence_missing` maps to the
//   marketplace's `invalid_field` with the same law named).
// - THE LISTING LAW: the commissioned listing is ACTIVE at the
//   commission instant; the requested deliverable kind and the
//   verification contract's kinds are ones the listing's offer
//   DECLARED (the provider cannot be surprised by a regime it did not
//   publish — the quote-match law's mirror on the commissioning side).
// - THE BUDGET-OFFER LAW: the offered consideration validates as the
//   typed contract AND is within the listing's published pricing (the
//   platform budgets at least the list price; a lower offer is the
//   typed `listing_mismatch` — you cannot commission at a published
//   listing while offering less than it prices).
// - THE FREEZE LAW (T045's): the verification contract is frozen at
//   request time — the commission carries it VERBATIM into the draft
//   (goalposts never move; the deadline postdates the request instant,
//   L4).
// - Determinism: the minter is PURE — the same inputs mint the same
//   draft (plain JSON, the untrusted-input shape T045's
//   `issueCapabilityRequest` validates; the interop test drives the
//   REAL exchange with it).

import { isNonEmptyString, isTimestampMs, signedCompare } from './imports';
import type { MarketplaceResult } from './errors';
import { fail, ok } from './errors';
import type { Consideration } from './consideration';
import { validateConsideration } from './consideration';
import { activeListingAt } from './catalog';
import type { MarketplaceListing } from './listing';
import type { MarketplaceState } from './state';
import { isDeliverableKindMirror, isVerificationRequirementMirror } from './mirrors';

// ---------------------------------------------------------------------------
// The commission input
// ---------------------------------------------------------------------------

/** The commission input: which listing, cited by what evidence, under what goalposts and offer. */
export interface CommissionInput {
  /** The listing SLOT being commissioned. */
  readonly listingRef: string;
  /** The requested deliverable kind (must be one the listing's offer declares). */
  readonly deliverableKind: string;
  /** What the platform asks for (human-readable summary; defaults to the offer's). */
  readonly summary?: string;
  /** The typed capability gaps that commissioned the request (the T017 gap language). */
  readonly gapRefs: readonly string[];
  /** Evidence-capsule references backing the request. */
  readonly evidenceRefs: readonly string[];
  /** The verification contract (frozen VERBATIM at request time — the goalposts). */
  readonly verification: readonly unknown[];
  /** The delivery deadline instant, or null for none (must postdate the request instant — L4). */
  readonly deadline: number | null;
  /** The offered consideration (the typed contract; within the listing's published pricing). */
  readonly offeredConsideration: unknown;
  /** Explicit request instant (epoch ms — never a wall clock). */
  readonly requestedAt: number;
}

/** The T045-shaped plain-JSON request draft the commission mints (the untrusted-input shape `issueCapabilityRequest` validates). */
export type CommissionedRequestDraft = Record<string, unknown>;

// ---------------------------------------------------------------------------
// The commission minter
// ---------------------------------------------------------------------------

/**
 * Mints the T045-shaped capability-request draft from (active listing,
 * commissioning evidence, frozen verification contract, offered
 * consideration). The draft is PLAIN JSON — the marketplace does not
 * mint the `cpr:` identity (that is T045's content-addressed mint; the
 * REAL exchange's `issueCapabilityRequest` runs the full law on this
 * draft, and the interop test proves it accepts).
 */
export function commissionCapabilityRequest(
  state: MarketplaceState,
  input: CommissionInput,
): MarketplaceResult<{ readonly draft: CommissionedRequestDraft; readonly listing: MarketplaceListing }> {
  if (!isTimestampMs(input.requestedAt)) {
    return fail('invalid_timestamp', 'the request instant must be a TimestampMs (explicit — never a wall clock)', 'requestedAt');
  }
  const listing = activeListingAt(state, input.listingRef, input.requestedAt);
  if (!listing.ok) return listing;
  const active = listing.value;

  // THE EVIDENCE LAW: a request with no citation is invented, not requested.
  const gapRefs = [...input.gapRefs];
  const evidenceRefs = [...input.evidenceRefs];
  if (gapRefs.length + evidenceRefs.length === 0) {
    return fail('invalid_field', 'a capability request with no evidence citation is invalid — requests are commissioned by recorded capability gaps, never invented (the T045 evidence law, composed here)', 'gapRefs');
  }
  if (!gapRefs.every(isNonEmptyString)) {
    return fail('invalid_field', 'every gapRef must be a non-empty capability-gap reference', 'gapRefs');
  }
  if (!evidenceRefs.every(isNonEmptyString)) {
    return fail('invalid_field', 'every evidenceRef must be a non-empty evidence-capsule reference', 'evidenceRefs');
  }

  // THE LISTING LAW: the deliverable kind and every verification kind
  // are ones the offer declared.
  if (!isDeliverableKindMirror(input.deliverableKind)) {
    return fail('invalid_field', `invalid deliverableKind (the closed T045 vocabulary)`, 'deliverableKind');
  }
  if (!active.offer.deliverableKinds.includes(input.deliverableKind as never)) {
    return fail('listing_mismatch', `the listing's offer does not produce deliverable kind "${input.deliverableKind}" (it produces ${active.offer.deliverableKinds.join(' | ')})`, 'deliverableKind');
  }
  if (!Array.isArray(input.verification) || input.verification.length === 0) {
    return fail('invalid_field', 'the verification contract is required and NON-EMPTY — the goalposts are frozen at request time (the T045 freeze law)', 'verification');
  }
  const verification = [];
  for (let index = 0; index < input.verification.length; index++) {
    const requirement = input.verification[index];
    if (!isVerificationRequirementMirror(requirement)) {
      return fail('invalid_field', `verification[${index}] failed the VerificationRequirement mirror (the closed three-kind union)`, `verification[${index}]`);
    }
    if (!active.offer.verificationKinds.includes(requirement.kind)) {
      return fail('listing_mismatch', `the listing's offer does not accept verification kind "${requirement.kind}" (requirement ${requirement.requirementRef}; the offer accepts ${active.offer.verificationKinds.join(' | ')}) — the provider cannot be surprised by a regime it did not publish`, `verification[${index}]`);
    }
    verification.push(requirement);
  }
  const requirementRefs = new Set<string>();
  for (const requirement of verification) {
    if (requirementRefs.has(requirement.requirementRef)) {
      return fail('invalid_field', `duplicate requirementRef "${requirement.requirementRef}" (unique within the contract)`, 'verification');
    }
    requirementRefs.add(requirement.requirementRef);
  }

  // L4: the deadline postdates the request instant.
  if (input.deadline !== null && (!isTimestampMs(input.deadline) || input.deadline < input.requestedAt)) {
    return fail('l4_boundary_violation', 'the deadline must be a TimestampMs that postdates the request instant — deadlines are set when the request is issued', 'deadline');
  }

  // THE BUDGET-OFFER LAW: the offered consideration validates as the
  // typed contract, answers the listing's pricing model in the
  // listing's currency, and budgets AT LEAST the list price (an offer
  // below the list price could never accept the quote the listing
  // advertises — the commission would be dead on arrival).
  const offered = validateConsideration(input.offeredConsideration, 'offeredConsideration');
  if (!offered.ok) return offered;
  if (offered.value === null) {
    return fail('listing_mismatch', 'a published listing prices a consideration — commission with the offered budget the listing\'s pricing defines (null is the NO-CHARGE offer shape; a free listing is fixed-fee "0")', 'offeredConsideration');
  }
  const offer = offered.value;
  const list = active.pricing;
  if (offer.kind !== list.kind) {
    return fail('consideration_incomparable', `the listing prices ${list.kind} but the offered consideration is ${offer.kind} — the negotiation stays in ONE pricing model`, 'offeredConsideration');
  }
  if (offer.currency !== list.currency) {
    return fail('currency_mismatch', `the listing's currency is "${list.currency}" but the offered consideration's is "${offer.currency}" — one commercial vocabulary per negotiation`, 'offeredConsideration');
  }
  if (offer.kind === 'fixed-fee' && list.kind === 'fixed-fee') {
    if (signedCompare(offer.amount, list.amount) < 0) {
      return fail('listing_mismatch', `the offered budget ${offer.amount} ${offer.currency} is below the listing's published price ${list.amount} ${list.currency} — the platform budgets AT LEAST the list price`, 'offeredConsideration');
    }
  }
  if (offer.kind === 'usage-metered' && list.kind === 'usage-metered') {
    if (offer.unit !== list.unit) {
      return fail('consideration_incomparable', `the listing meters "${list.unit}" but the offered consideration meters "${offer.unit}" — the metered unit is part of the commercial language`, 'offeredConsideration');
    }
    if (signedCompare(offer.rate, list.rate) < 0) {
      return fail('listing_mismatch', `the offered budget rate ${offer.rate} ${offer.currency}/${offer.unit} is below the listing's published rate ${list.rate} ${list.currency}/${list.unit} — the platform budgets AT LEAST the list rate`, 'offeredConsideration');
    }
  }

  // THE DRAFT (plain JSON — T045's untrusted-input shape).
  const offeredConsideration: Consideration = offer;
  const draft: CommissionedRequestDraft = {
    requestedCapability: active.offer.capabilityKey,
    summary: input.summary !== undefined && isNonEmptyString(input.summary) ? input.summary : active.offer.summary,
    deliverableKind: input.deliverableKind,
    gapRefs,
    evidenceRefs,
    verification,
    deadline: input.deadline,
    consideration: offeredConsideration as unknown as Record<string, unknown> | null,
    tenantId: state.tenantId,
    projectId: active.projectId,
    requestedAt: input.requestedAt,
  };
  return ok({ draft, listing: active });
}
