// @tradrl/marketplace-service — the PURCHASE: the commercial half of
// the engagement lifecycle (the "engaged commercially and consumed
// under entitlements" half of the Work Order).
//
// THE LAWS THIS MODULE SERVES:
// - THE BINDING LAW: a purchase binds (listing slot, capability
//   request, provider quote) — the listing must be the slot ACTIVE at
//   the purchase instant (a retired slot never trades); the quote must
//   name the listing's provider + offer; the request and the quote
//   must agree on scope (L12) and the quote must postdate the request
//   (L4).
// - THE NEGOTIATION LAW: the quote's counter-consideration is the
//   AGREED price — validated against the typed consideration contract,
//   within the platform's offered budget (`consideration_exceeds_budget`)
//   AND within the listing's published pricing (`listing_mismatch`).
// - THE LIFECYCLE LAW (closed table):
//     open --bind--> engaged --settle--> settled (terminal)
//     open --void--> voided (terminal)
//   Every illegal transition is the typed `invalid_transition`. One
//   LIVE purchase per request (`purchase_exists` — the commercial
//   mirror of T045's one-live-engagement law).
// - THE SETTLEMENT LAW (THE PAYMENT GATE): settlement happens ONLY on
//   a TERMINAL engagement:
//     - `verified`  -> CHARGE: the exact charge from the agreed
//       consideration (fixed-fee -> the amount; usage-metered -> rate x
//       declared usage, exact decimals) drawn from the tenant's
//       spend-allowance through the entitlements ledger (the
//       entitlements lane's typed refusals surface here — enforcement
//       is code, L20); a `capability-artifact` deliverable ALSO mints
//       the artifact-license entitlement (the local-use right the L18
//       import path carries);
//     - `rejected`  -> NO CHARGE (never pay for rejected work);
//     - `withdrawn` -> NO CHARGE.
//   Content-addressed idempotence: an identical settlement replays
//   (never a double charge).
// - THE LICENSE LAW: the artifact license names the SAME artifact
//   reference T045's local-import path mints (`cpa:` over the
//   deliverable id + payload digest — the derivation mirrors localize
//   byte-for-byte, pinned by the interop test); the license's scope is
//   the purchase's project; `licenseCoversImport` is the pure check
//   the import path composes with.
// - L12/L9/L4 on every record: tenant + project scoping, content
//   addressed ids, explicit instants, chain-pinned history.

import { canonicalJson, deepCloneJson, deepFreeze, isNonEmptyString, isRecord, isTimestampMs, stableDigestJson } from './imports';
import type { ConsumptionRecord, EntitlementGrant, EntitlementLedgerState, EntitlementResult, JsonValue, LedgerOperationResult, TimestampMs } from './imports';
import { consumeEntitlement, issueEntitlementGrant } from './imports';
import type { MarketplaceError, MarketplaceResult } from './errors';
import { fail, isMarketplaceErrorCode, ok } from './errors';
import type { Consideration } from './consideration';
import { considerationCharge, considerationWithin, validateConsideration, withinListingPricing } from './consideration';
import { activeListingAt } from './catalog';
import type { MarketplaceListing } from './listing';
import type { MarketplaceState, MarketplaceOperationResult } from './state';
import { requireInstant, tenantGate, withEntry } from './state';
import type { DeliverableMirror, EngagementMirror, ProviderQuoteMirror, ProviderVerificationReportMirror } from './mirrors';
import { isCapabilityRequestMirror, isDeliverableMirror, isEngagementMirror, isProviderQuoteMirror, isProviderVerificationReportMirror, labelKeyPaths, licensedArtifactRef } from './mirrors';

// ---------------------------------------------------------------------------
// The purchase order (the commercial record of an engagement)
// ---------------------------------------------------------------------------

/** The purchase lifecycle — closed status vocabulary, closed transition table. */
export type PurchaseStatus = 'open' | 'engaged' | 'settled' | 'voided';

/** The closed transition table (from -> allowed to). */
export const PURCHASE_TRANSITIONS: Readonly<Record<PurchaseStatus, readonly PurchaseStatus[]>> = Object.freeze({
  open: ['engaged', 'voided'],
  engaged: ['settled'],
  settled: [],
  voided: [],
});

/** Guard: `PurchaseStatus`. */
export function isPurchaseStatus(v: unknown): v is PurchaseStatus {
  return v === 'open' || v === 'engaged' || v === 'settled' || v === 'voided';
}

/**
 * The commercial record binding (listing slot, capability request,
 * provider quote) under the AGREED consideration — the quote's
 * counter, validated within the offered budget AND the listing's
 * published pricing. The purchase tracks the T045 engagement (bound at
 * engagement open) and settles on its terminal state.
 */
export interface PurchaseOrder {
  /** Purchase identity (`po:<digest>` — content-addressed over (listing, request, quote, openedAt)). */
  readonly purchaseId: string;
  /** The listing SLOT the purchase trades on (stable across revisions). */
  readonly listingRef: string;
  /** The EXACT listing revision whose pricing was agreed. */
  readonly listingId: string;
  /** The commissioned capability request (T045 `cpr:`). */
  readonly requestId: string;
  /** The accepted provider quote (T045 `qte:`). */
  readonly quoteId: string;
  /** The engaged provider. */
  readonly providerRef: string;
  /** The published offer. */
  readonly offerRef: string;
  /** The deliverable kind (frozen from the request). */
  readonly deliverableKind: string;
  /** The AGREED consideration (the quote's counter — the typed terms this purchase settles under). */
  readonly agreedConsideration: Consideration;
  /** The bound T045 engagement, once opened (`eng:` or null while open). */
  readonly engagementId: string | null;
  /** The lifecycle status. */
  readonly status: PurchaseStatus;
  /** Explicit purchase-open instant (epoch ms — never a wall clock). */
  readonly openedAt: number;
  /** The engagement-binding instant, once bound. */
  readonly engagedAt: number | null;
  /** The settlement instant, once settled. */
  readonly settledAt: number | null;
  /** The void instant, once voided. */
  readonly voidedAt: number | null;
  /** Owning tenant (L12). */
  readonly tenantId: string;
  /** Owning project (L12). */
  readonly projectId: string;
}

/** Guard: `PurchaseOrder`. */
export function isPurchaseOrder(v: unknown): v is PurchaseOrder {
  if (!isRecord(v)) return false;
  if (typeof v.purchaseId !== 'string' || !/^po:[0-9a-f]{16}$/.test(v.purchaseId)) return false;
  if (typeof v.listingRef !== 'string' || !/^ml:[0-9a-f]{16}$/.test(v.listingRef)) return false;
  if (typeof v.listingId !== 'string' || !/^mkl:[0-9a-f]{16}$/.test(v.listingId)) return false;
  if (typeof v.requestId !== 'string' || !/^cpr:[0-9a-f]{16}$/.test(v.requestId)) return false;
  if (typeof v.quoteId !== 'string' || !/^qte:[0-9a-f]{16}$/.test(v.quoteId)) return false;
  if (!isNonEmptyString(v.providerRef) || !isNonEmptyString(v.offerRef)) return false;
  if (!isNonEmptyString(v.deliverableKind)) return false;
  if (v.agreedConsideration === undefined) return false; // the typed terms (incl. null = no charge)
  if (v.engagementId !== null && !(typeof v.engagementId === 'string' && /^eng:[0-9a-f]{16}$/.test(v.engagementId))) return false;
  if (!isPurchaseStatus(v.status)) return false;
  if (!isTimestampMs(v.openedAt)) return false;
  if (v.engagedAt !== null && !isTimestampMs(v.engagedAt)) return false;
  if (v.settledAt !== null && !isTimestampMs(v.settledAt)) return false;
  if (v.voidedAt !== null && !isTimestampMs(v.voidedAt)) return false;
  if (!isNonEmptyString(v.tenantId) || !isNonEmptyString(v.projectId)) return false;
  if (labelKeyPaths(v).length > 0) return false; // L16a
  return true;
}

// ---------------------------------------------------------------------------
// The settlement (the terminal commercial event)
// ---------------------------------------------------------------------------

/** The T045 engagement statuses that settle a purchase. */
export const SETTLEABLE_ENGAGEMENT_STATUSES = ['verified', 'rejected', 'withdrawn'] as const;

/** One settleable engagement status (the terminal set). */
export type SettleableEngagementStatus = (typeof SETTLEABLE_ENGAGEMENT_STATUSES)[number];

/** Guard: `SettleableEngagementStatus`. */
export function isSettleableEngagementStatus(v: unknown): v is SettleableEngagementStatus {
  return v === 'verified' || v === 'rejected' || v === 'withdrawn';
}

/**
 * The terminal commercial event: what the engagement's outcome COST.
 * A `verified` engagement charges (the exact consideration charge,
 * drawn from the spend allowance; `capability-artifact` deliverables
 * also mint the artifact license); `rejected` and `withdrawn` settle
 * at no charge. Content-addressed (`stl:`); retained always — the
 * commercial accounting truth (no-charge settlements included).
 */
export interface Settlement {
  /** Settlement identity (`stl:<digest>` — content-addressed over the settlement content). */
  readonly settlementId: string;
  /** The settled purchase. */
  readonly purchaseId: string;
  /** The T045 engagement whose terminal state settled the purchase. */
  readonly engagementId: string;
  /** The engagement's terminal status (the settlement's cause). */
  readonly engagementStatus: SettleableEngagementStatus;
  /** `charged` when the settlement drew the spend allowance; `no-charge` otherwise. */
  readonly outcome: 'charged' | 'no-charge';
  /** The exact charge (canonical decimal; "0" when no-charge). */
  readonly charge: string;
  /** The charge's currency (null only when the agreed consideration is null). */
  readonly currency: string | null;
  /** The metered usage settled (canonical decimal; null for fixed-fee / no-charge). */
  readonly usageUnits: string | null;
  /** The entitlements consumption record (`cns:`), when charged. */
  readonly consumptionId: string | null;
  /** The artifact-license grant (`eg:`), when a verified capability-artifact licensed. */
  readonly licenseGrantId: string | null;
  /** The verification report that grounded a verified settlement (`vrf:`). */
  readonly verificationReportId: string | null;
  /** The settled deliverable (`dlv:`), when one was submitted. */
  readonly deliverableId: string | null;
  /** Explicit settlement instant (epoch ms — never a wall clock). */
  readonly settledAt: number;
  /** Owning tenant (L12). */
  readonly tenantId: string;
  /** Owning project (L12). */
  readonly projectId: string;
}

/** Guard: `Settlement`. */
export function isSettlement(v: unknown): v is Settlement {
  if (!isRecord(v)) return false;
  if (typeof v.settlementId !== 'string' || !/^stl:[0-9a-f]{16}$/.test(v.settlementId)) return false;
  if (typeof v.purchaseId !== 'string' || !/^po:[0-9a-f]{16}$/.test(v.purchaseId)) return false;
  if (typeof v.engagementId !== 'string' || !/^eng:[0-9a-f]{16}$/.test(v.engagementId)) return false;
  if (!isSettleableEngagementStatus(v.engagementStatus)) return false;
  if (v.outcome !== 'charged' && v.outcome !== 'no-charge') return false;
  if (typeof v.charge !== 'string' || !/^(0|[1-9]\d*)(\.\d+)?$/.test(v.charge)) return false;
  if (v.currency !== null && !isNonEmptyString(v.currency)) return false;
  if (v.usageUnits !== null && !(typeof v.usageUnits === 'string' && /^(0|[1-9]\d*)(\.\d+)?$/.test(v.usageUnits))) return false;
  if (v.consumptionId !== null && !(typeof v.consumptionId === 'string' && /^cns:[0-9a-f]{16}$/.test(v.consumptionId))) return false;
  if (v.licenseGrantId !== null && !(typeof v.licenseGrantId === 'string' && /^eg:[0-9a-f]{16}$/.test(v.licenseGrantId))) return false;
  if (v.verificationReportId !== null && !(typeof v.verificationReportId === 'string' && /^vrf:[0-9a-f]{16}$/.test(v.verificationReportId))) return false;
  if (v.deliverableId !== null && !(typeof v.deliverableId === 'string' && /^dlv:[0-9a-f]{16}$/.test(v.deliverableId))) return false;
  if (!isTimestampMs(v.settledAt)) return false;
  if (!isNonEmptyString(v.tenantId) || !isNonEmptyString(v.projectId)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Operation: open a purchase (bind listing + request + quote)
// ---------------------------------------------------------------------------

/**
 * Opens the commercial record of an accepted quote: binds (listing
 * slot, capability request, provider quote) under the AGREED
 * consideration. Laws enforced (typed refusals):
 * - the listing slot is ACTIVE at the open instant (`listing_retired` /
 *   `listing_unknown`) and is the quote's own provider + offer
 *   (`listing_mismatch`);
 * - the request and quote satisfy their mirror guards (the full T045
 *   law, L16a included) and agree on tenant/project (L12) with the
 *   marketplace;
 * - the quote postdates the request (L4) and the purchase postdates
 *   the quote (L4);
 * - the quote's counter-consideration validates as the typed contract
 *   (`consideration_invalid`), is within the offered budget
 *   (`consideration_exceeds_budget` / `consideration_incomparable` /
 *   `currency_mismatch`) and within the listing's published pricing
 *   (`listing_mismatch`);
 * - no LIVE purchase exists for the request (`purchase_exists` — one
 *   commercial record per live engagement).
 * Content-addressed idempotence: the identical (listing, request,
 * quote, instant) replays.
 */
export function openPurchase(
  state: MarketplaceState,
  input: {
    /** The listing SLOT being traded. */
    readonly listingRef: string;
    /** The commissioned capability request (a REAL T045 request satisfies the mirror). */
    readonly request: unknown;
    /** The accepted provider quote (a REAL T045 quote satisfies the mirror). */
    readonly quote: unknown;
    /** Explicit open instant (epoch ms — never a wall clock). */
    readonly openedAt: number;
  },
): MarketplaceResult<MarketplaceOperationResult<PurchaseOrder>> {
  const instant = requireInstant(input.openedAt, 'openedAt');
  if (!instant.ok) return instant;

  if (!isRecord(input.request) || !isCapabilityRequestMirror(input.request)) {
    return fail('invalid_type', 'the request failed the CapabilityRequest mirror (the T045 envelope the marketplace commissions)', 'request');
  }
  const request = input.request;
  const requestGate = tenantGate(state, request, 'request');
  if (!requestGate.ok) return requestGate;

  if (!isRecord(input.quote) || !isProviderQuoteMirror(input.quote)) {
    return fail('invalid_type', 'the quote failed the ProviderQuote mirror (the T045 envelope the provider answered with)', 'quote');
  }
  const quote = input.quote as unknown as ProviderQuoteMirror;
  const quoteGate = tenantGate(state, quote, 'quote');
  if (!quoteGate.ok) return quoteGate;

  // THE BINDING LAW.
  if (quote.requestId !== request.requestId) {
    return fail('purchase_mismatch', `the quote answers request ${quote.requestId} but was submitted against ${request.requestId}`, 'quote.requestId');
  }
  if (quote.tenantId !== request.tenantId || quote.projectId !== request.projectId) {
    return fail('purchase_mismatch', 'the quote\'s tenant/project scope disagrees with the request\'s (L12)', 'quote');
  }
  const listing = activeListingAt(state, input.listingRef, input.openedAt);
  if (!listing.ok) return listing;
  const active = listing.value as MarketplaceListing;
  if (active.providerRef !== quote.providerRef || active.offerRef !== quote.offerRef) {
    return fail('listing_mismatch', `the quote names provider ${quote.providerRef} / offer ${quote.offerRef} but the listing slot ${input.listingRef} publishes ${active.providerRef} / ${active.offerRef}`, 'quote.offerRef');
  }
  if (quote.terms.deliverableKind !== request.deliverableKind) {
    return fail('purchase_mismatch', `the quote offers deliverable kind "${quote.terms.deliverableKind}" but the request asked for "${request.deliverableKind}"`, 'quote.terms.deliverableKind');
  }
  // THE FREEZE LAW (composed): the quote accepts the request's
  // verification contract VERBATIM (canonical bytes) — goalposts never
  // move; the marketplace re-checks what T045's quote-match law pinned.
  if (canonicalJson(quote.terms.verification) !== canonicalJson(request.verification)) {
    return fail('purchase_mismatch', 'the quote\'s verification contract is not the request\'s VERBATIM — goalposts never move (the negotiation integrity law, composed from T045)', 'quote.terms.verification');
  }
  if (quote.quotedAt < request.requestedAt) {
    return fail('l4_boundary_violation', `the quote instant (${quote.quotedAt}) predates the request instant (${request.requestedAt})`, 'quote.quotedAt');
  }
  if (input.openedAt < quote.quotedAt) {
    return fail('l4_boundary_violation', `the purchase open instant (${input.openedAt}) predates the quote instant (${quote.quotedAt})`, 'openedAt');
  }

  // THE NEGOTIATION LAW: the counter validates, is within the offered
  // budget, and is within the listing's published pricing.
  const offered = validateConsideration(request.consideration, 'request.consideration');
  if (!offered.ok) return offered;
  const counter = validateConsideration(quote.terms.consideration, 'quote.terms.consideration');
  if (!counter.ok) return counter;
  const budget = considerationWithin(offered.value, counter.value, 'quote.terms.consideration');
  if (!budget.ok) return budget;
  const listLaw = withinListingPricing(active.pricing, counter.value, 'quote.terms.consideration');
  if (!listLaw.ok) return listLaw;

  // THE ONE-LIVE-PURCHASE LAW.
  const identityContent = {
    listingRef: active.listingRef,
    listingId: active.listingId,
    requestId: request.requestId,
    quoteId: quote.quoteId,
    openedAt: input.openedAt,
    tenantId: state.tenantId,
    projectId: request.projectId,
  };
  const purchaseId = `po:${stableDigestJson({ listingRef: identityContent.listingRef, requestId: identityContent.requestId, quoteId: identityContent.quoteId, openedAt: identityContent.openedAt })}`;
  const existing = state.purchases.get(purchaseId);
  if (existing !== undefined) {
    return ok({ state, record: existing, replayed: true });
  }
  for (const purchase of state.purchases.values()) {
    if (purchase.requestId === request.requestId && (purchase.status === 'open' || purchase.status === 'engaged')) {
      return fail('purchase_exists', `the request ${request.requestId} already has a LIVE purchase (${purchase.purchaseId}, status ${purchase.status}) — one commercial record per live engagement`, 'request.requestId');
    }
  }

  const purchase: PurchaseOrder = deepFreeze(deepCloneJson({
    purchaseId,
    ...identityContent,
    providerRef: quote.providerRef,
    offerRef: quote.offerRef,
    deliverableKind: request.deliverableKind,
    agreedConsideration: counter.value as unknown as JsonValue,
    engagementId: null,
    status: 'open',
    openedAt: input.openedAt,
    engagedAt: null,
    settledAt: null,
    voidedAt: null,
  } as unknown as JsonValue) as unknown as PurchaseOrder);
  if (!isPurchaseOrder(purchase)) {
    return fail('invalid_field', 'the minted purchase failed its own structural guard', 'purchase');
  }
  const next = withEntry(state, 'purchase-opened', purchase.purchaseId, purchase, purchase.openedAt, (maps) => {
    maps.purchases.set(purchase.purchaseId, purchase);
    maps.purchaseVersions.set(purchase.purchaseId, [purchase]);
  });
  return ok({ state: next, record: purchase, replayed: false });
}

// ---------------------------------------------------------------------------
// Operation: bind the T045 engagement
// ---------------------------------------------------------------------------

/**
 * Binds the purchase to its T045 engagement (open -> engaged): the
 * engagement must be the purchase's OWN (request + quote pair), LIVE
 * (open | delivered), in the marketplace's scope (L12), and the
 * binding instant postdates both the purchase open and the engagement
 * open (L4).
 */
export function bindEngagement(
  state: MarketplaceState,
  input: { readonly purchaseId: string; readonly engagement: unknown; readonly engagedAt: number },
): MarketplaceResult<MarketplaceOperationResult<PurchaseOrder>> {
  const instant = requireInstant(input.engagedAt, 'engagedAt');
  if (!instant.ok) return instant;
  const purchase = state.purchases.get(input.purchaseId);
  if (purchase === undefined) {
    return fail('purchase_unknown', `the purchase ${input.purchaseId} is not in this marketplace`, 'purchaseId');
  }
  if (purchase.status !== 'open') {
    return fail('invalid_transition', `the purchase ${purchase.purchaseId} is ${purchase.status} — only an OPEN purchase binds an engagement`, 'purchaseId');
  }
  if (!isRecord(input.engagement) || !isEngagementMirror(input.engagement)) {
    return fail('invalid_type', 'the engagement failed the Engagement mirror (the T045 record the commercial half tracks)', 'engagement');
  }
  const engagement = input.engagement as unknown as EngagementMirror;
  const gate = tenantGate(state, engagement, 'engagement');
  if (!gate.ok) return gate;
  if (engagement.requestId !== purchase.requestId || engagement.quoteId !== purchase.quoteId) {
    return fail('purchase_mismatch', `the engagement ${engagement.engagementId} binds request ${engagement.requestId} / quote ${engagement.quoteId} but the purchase bound ${purchase.requestId} / ${purchase.quoteId}`, 'engagement.engagementId');
  }
  if (engagement.status !== 'open' && engagement.status !== 'delivered') {
    return fail('invalid_transition', `the engagement ${engagement.engagementId} is ${engagement.status} (terminal) — the commercial half tracks a LIVE engagement`, 'engagement.status');
  }
  if (input.engagedAt < purchase.openedAt || input.engagedAt < engagement.openedAt) {
    return fail('l4_boundary_violation', `the binding instant (${input.engagedAt}) predates the purchase open (${purchase.openedAt}) or the engagement open (${engagement.openedAt})`, 'engagedAt');
  }

  const bound: PurchaseOrder = deepFreeze({ ...purchase, engagementId: engagement.engagementId, status: 'engaged', engagedAt: input.engagedAt }) as PurchaseOrder;
  const versions = [...(state.purchaseVersions.get(purchase.purchaseId) ?? []), bound];
  const next = withEntry(state, 'purchase-bound', bound.purchaseId, bound, input.engagedAt, (maps) => {
    maps.purchases.set(bound.purchaseId, bound);
    maps.purchaseVersions.set(bound.purchaseId, versions);
  });
  return ok({ state: next, record: bound, replayed: false });
}

// ---------------------------------------------------------------------------
// Operation: settle (THE PAYMENT GATE)
// ---------------------------------------------------------------------------

/** The settlement operation's result: BOTH next states + the settlement record. */
export interface SettlementOperationResult {
  readonly marketplace: MarketplaceState;
  readonly entitlements: EntitlementLedgerState;
  readonly settlement: Settlement;
  readonly purchase: PurchaseOrder;
  /** The minted artifact-license grant, when one was licensed (else null). */
  readonly licenseGrant: unknown;
  /** `true` when the identical settlement was already appended (content-addressed idempotence — never a double charge). */
  readonly replayed: boolean;
}

/**
 * Settles the purchase on its engagement's TERMINAL state — THE
 * PAYMENT GATE:
 * - `verified` -> CHARGE: the exact charge from the agreed
 *   consideration (metered pricing requires the declared usage) drawn
 *   from the tenant's spend allowance through the entitlements ledger
 *   (the entitlements lane's typed refusals surface here); a
 *   `capability-artifact` deliverable ALSO licenses the artifact
 *   (the artifact-license entitlement, named by the SAME `cpa:` ref
 *   the T045 import path mints);
 * - `rejected` -> NO CHARGE (never pay for rejected work — the
 *   verification report with the failing verdict must be present);
 * - `withdrawn` -> NO CHARGE.
 * The purchase must be `engaged` and the settlement instant must
 * postdate the engagement's open and the verification (L4).
 * Content-addressed idempotence: an identical settlement replays
 * without re-charging.
 */
export function settlePurchase(
  marketplaceState: MarketplaceState,
  entitlementState: EntitlementLedgerState,
  input: {
    readonly purchaseId: string;
    /** The engagement's CURRENT record (terminal). */
    readonly engagement: unknown;
    /** The verification report that closed the engagement (required for verified | rejected). */
    readonly verificationReport?: unknown;
    /** The deliverable submitted against the engagement (required for the artifact license). */
    readonly deliverable?: unknown;
    /** The declared usage (canonical decimal) — required for metered pricing. */
    readonly usageUnits?: string | null;
    /** The spend-allowance grant to draw (eg: id), or null to auto-select the first covering allowance. */
    readonly grantId?: string | null;
    /** Explicit settlement instant (epoch ms — never a wall clock). */
    readonly settledAt: number;
  },
): MarketplaceResult<SettlementOperationResult> {
  const instant = requireInstant(input.settledAt, 'settledAt');
  if (!instant.ok) return instant;
  // THE LEDGER-SCOPE GATE (L12): the settlement draws THE PURCHASING
  // TENANT's spend allowance and mints ITS license — a supplied
  // entitlements ledger of a foreign tenant is the typed refusal (the
  // charge must never bill another tenant's allowance).
  if (entitlementState.tenantId !== marketplaceState.tenantId) {
    return fail('cross_tenant_access', `the settlement draws the marketplace of tenant "${marketplaceState.tenantId}" but the supplied entitlements ledger belongs to tenant "${entitlementState.tenantId}" — the charge and the license stay inside the purchasing tenant's ledger (L12)`, 'entitlements');
  }
  const purchase = marketplaceState.purchases.get(input.purchaseId);
  if (purchase === undefined) {
    return fail('purchase_unknown', `the purchase ${input.purchaseId} is not in this marketplace`, 'purchaseId');
  }
  if (purchase.status === 'open') {
    return fail('invalid_transition', `the purchase ${purchase.purchaseId} is still OPEN — bind its engagement before settling`, 'purchaseId');
  }
  if (purchase.status !== 'engaged') {
    // Content-addressed replay: settling the ALREADY-SETTLED purchase at the SAME instant replays.
    if (purchase.status === 'settled' && purchase.settledAt === input.settledAt) {
      const existing = findSettlementOf(marketplaceState, purchase.purchaseId);
      if (existing !== undefined) {
        return ok({ marketplace: marketplaceState, entitlements: entitlementState, settlement: existing, purchase, licenseGrant: null, replayed: true });
      }
    }
    return fail('invalid_transition', `the purchase ${purchase.purchaseId} is ${purchase.status} (terminal) — its settlement is closed`, 'purchaseId');
  }
  if (!isRecord(input.engagement) || !isEngagementMirror(input.engagement)) {
    return fail('invalid_type', 'the engagement failed the Engagement mirror', 'engagement');
  }
  const engagement = input.engagement as unknown as EngagementMirror;
  const gate = tenantGate(marketplaceState, engagement, 'engagement');
  if (!gate.ok) return gate;
  if (engagement.engagementId !== purchase.engagementId) {
    return fail('purchase_mismatch', `the engagement ${engagement.engagementId} is not the purchase's bound engagement (${purchase.engagementId})`, 'engagement.engagementId');
  }
  if (!isSettleableEngagementStatus(engagement.status)) {
    return fail('invalid_transition', `the engagement ${engagement.engagementId} is ${engagement.status} — settlement awaits a TERMINAL state (verified | rejected | withdrawn)`, 'engagement.status');
  }
  if (input.settledAt < engagement.openedAt) {
    return fail('l4_boundary_violation', `the settlement instant (${input.settledAt}) predates the engagement open (${engagement.openedAt})`, 'settledAt');
  }

  // The verification law: verified and rejected settlements cite the
  // report that closed the engagement (matched + verdict-checked).
  let report: ProviderVerificationReportMirror | undefined = undefined;
  if (engagement.status === 'verified' || engagement.status === 'rejected') {
    if (input.verificationReport === undefined || input.verificationReport === null || !isProviderVerificationReportMirror(input.verificationReport)) {
      return fail('verification_missing', `the engagement settled as ${engagement.status} — the verification report that closed it must be cited (a ${engagement.status} settlement without its report settles nothing)`, 'verificationReport');
    }
    report = input.verificationReport as ProviderVerificationReportMirror;
    if (report.engagementId !== engagement.engagementId) {
      return fail('purchase_mismatch', `the verification report ${report.reportId} closed engagement ${report.engagementId}, not ${engagement.engagementId}`, 'verificationReport.reportId');
    }
    if (report.verdict !== engagement.status) {
      return fail('purchase_mismatch', `the verification report's verdict is "${report.verdict}" but the engagement is "${engagement.status}" — the report and the engagement disagree`, 'verificationReport.verdict');
    }
    if (input.settledAt < report.verifiedAt) {
      return fail('l4_boundary_violation', `the settlement instant (${input.settledAt}) predates the verification (${report.verifiedAt})`, 'settledAt');
    }
  }

  // THE CHARGE: verified charges; rejected and withdrawn never do.
  let charge = '0';
  let currency: string | null = null;
  let usageUnits: string | null = null;
  if (engagement.status === 'verified') {
    const computed = considerationCharge(purchase.agreedConsideration, input.usageUnits ?? null, 'agreedConsideration');
    if (!computed.ok) return computed;
    charge = computed.value;
    currency = purchase.agreedConsideration === null ? null : purchase.agreedConsideration.currency;
    usageUnits = purchase.agreedConsideration !== null && purchase.agreedConsideration.kind === 'usage-metered' ? (input.usageUnits ?? null) : null;
  }

  // The deliverable (the license law's source).
  let deliverable: DeliverableMirror | undefined = undefined;
  if (engagement.status === 'verified' && purchase.deliverableKind === 'capability-artifact') {
    if (input.deliverable === undefined || input.deliverable === null || !isDeliverableMirror(input.deliverable)) {
      return fail('verification_missing', 'a verified capability-artifact settlement licenses the delivered artifact — the deliverable must be cited (the license names its content-addressed artifact reference)', 'deliverable');
    }
    deliverable = input.deliverable as DeliverableMirror;
    if (deliverable.engagementId !== engagement.engagementId) {
      return fail('purchase_mismatch', `the deliverable ${deliverable.deliverableId} belongs to engagement ${deliverable.engagementId}, not ${engagement.engagementId}`, 'deliverable.deliverableId');
    }
    if (report !== undefined && deliverable.deliverableId !== report.deliverableId) {
      return fail('purchase_mismatch', `the deliverable ${deliverable.deliverableId} is not the one the verification report verified (${report.deliverableId})`, 'deliverable.deliverableId');
    }
  }

  // The settlement identity (content-addressed; the consumption/license
  // refs derive from it — deterministic).
  const identityContent = {
    purchaseId: purchase.purchaseId,
    engagementId: engagement.engagementId,
    engagementStatus: engagement.status,
    outcome: engagement.status === 'verified' && charge !== '0' ? 'charged' : 'no-charge',
    charge,
    currency,
    usageUnits,
    verificationReportId: report?.reportId ?? null,
    deliverableId: deliverable?.deliverableId ?? null,
    settledAt: input.settledAt,
    tenantId: marketplaceState.tenantId,
    projectId: purchase.projectId,
  };
  const settlementId = `stl:${stableDigestJson(identityContent)}`;
  const existingSettlement = marketplaceState.settlements.get(settlementId);
  if (existingSettlement !== undefined) {
    return ok({ marketplace: marketplaceState, entitlements: entitlementState, settlement: existingSettlement, purchase, licenseGrant: null, replayed: true });
  }

  // THE DRAW: charge the spend allowance through the entitlements
  // ledger (auto-select or the named grant). The entitlements lane's
  // typed refusals surface here under their own codes (L20).
  let nextEntitlements = entitlementState;
  let consumptionId: string | null = null;
  if (charge !== '0') {
    const drawn = consumeEntitlement(entitlementState, {
      grantId: input.grantId ?? null,
      projectId: purchase.projectId,
      currency: currency as string,
      amount: charge,
      cause: 'marketplace-charge',
      refs: [purchase.purchaseId, settlementId],
      at: input.settledAt as TimestampMs,
    });
    if (!drawn.ok) return mapEntitlementFailure(drawn);
    nextEntitlements = drawn.value.state;
    consumptionId = drawn.value.record.consumptionId;
  }

  // THE LICENSE: a verified capability-artifact mints the local-use
  // entitlement (the artifact-license; the L18 import path's gate).
  let licenseGrant: unknown = null;
  let licenseGrantId: string | null = null;
  if (engagement.status === 'verified' && deliverable !== undefined) {
    const licensed = issueEntitlementGrant(nextEntitlements, {
      tenantId: marketplaceState.tenantId,
      projectId: purchase.projectId,
      kind: 'artifact-license',
      terms: { kind: 'artifact-license', artifactRef: licensedArtifactRef(deliverable), usageScope: 'project' },
      version: 1,
      supersedes: null,
      sourceRef: purchase.purchaseId,
      issuedAt: input.settledAt,
      effectiveFrom: input.settledAt,
      effectiveUntil: null,
    });
    if (!licensed.ok) return mapEntitlementFailure(licensed);
    nextEntitlements = licensed.value.state;
    licenseGrant = licensed.value.record;
    licenseGrantId = licensed.value.record.grantId;
  }

  const settlement: Settlement = deepFreeze(deepCloneJson({
    settlementId,
    ...identityContent,
    outcome: identityContent.outcome,
    consumptionId,
    licenseGrantId,
  } as unknown as JsonValue) as unknown as Settlement);
  if (!isSettlement(settlement)) {
    return fail('invalid_field', 'the minted settlement failed its own structural guard', 'settlement');
  }

  const settledPurchase: PurchaseOrder = deepFreeze({ ...purchase, status: 'settled', settledAt: input.settledAt }) as PurchaseOrder;
  const versions = [...(marketplaceState.purchaseVersions.get(purchase.purchaseId) ?? []), settledPurchase];
  const nextMarketplace = withEntry(marketplaceState, 'purchase-settled', settlement.settlementId, settlement, settlement.settledAt, (maps) => {
    maps.settlements.set(settlement.settlementId, settlement);
    maps.purchases.set(settledPurchase.purchaseId, settledPurchase);
    maps.purchaseVersions.set(settledPurchase.purchaseId, versions);
  });
  return ok({ marketplace: nextMarketplace, entitlements: nextEntitlements, settlement, purchase: settledPurchase, licenseGrant, replayed: false });
}

/** Maps an entitlements-lane failure onto this lane's typed surface (the shared codes keep their semantics — L20). */
function mapEntitlementFailure<T>(result: EntitlementResult<T>): MarketplaceResult<T> {
  if (result.ok) return ok(result.value);
  const errors: MarketplaceError[] = result.errors.map((error) => ({
    code: isMarketplaceErrorCode(error.code) ? error.code : 'invalid_field',
    path: error.path,
    message: `${error.message} (the entitlements lane's gate — enforcement is code, L20)`,
  }));
  return { ok: false, errors };
}

/** The purchase's settlement, if any (the replay key). */
function findSettlementOf(state: MarketplaceState, purchaseId: string): Settlement | undefined {
  for (const settlement of state.settlements.values()) {
    if (settlement.purchaseId === purchaseId) return settlement;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Operation: void (the pre-engagement exit)
// ---------------------------------------------------------------------------

/**
 * Voids an OPEN purchase (the platform's pre-engagement exit — the
 * commercial mirror of never opening the engagement). An engaged
 * purchase never voids (the engagement's withdrawal is the T045
 * lane's record; the marketplace settles it at no charge instead).
 */
export function voidPurchase(
  state: MarketplaceState,
  input: { readonly purchaseId: string; readonly voidedAt: number },
): MarketplaceResult<MarketplaceOperationResult<PurchaseOrder>> {
  const instant = requireInstant(input.voidedAt, 'voidedAt');
  if (!instant.ok) return instant;
  const purchase = state.purchases.get(input.purchaseId);
  if (purchase === undefined) {
    return fail('purchase_unknown', `the purchase ${input.purchaseId} is not in this marketplace`, 'purchaseId');
  }
  if (purchase.status !== 'open') {
    return fail('invalid_transition', `the purchase ${purchase.purchaseId} is ${purchase.status} — only an OPEN purchase voids (an engaged purchase settles through its engagement's terminal state)`, 'purchaseId');
  }
  if (input.voidedAt < purchase.openedAt) {
    return fail('l4_boundary_violation', `the void instant (${input.voidedAt}) predates the purchase open (${purchase.openedAt})`, 'voidedAt');
  }
  const voided: PurchaseOrder = deepFreeze({ ...purchase, status: 'voided', voidedAt: input.voidedAt }) as PurchaseOrder;
  const versions = [...(state.purchaseVersions.get(purchase.purchaseId) ?? []), voided];
  const next = withEntry(state, 'purchase-voided', voided.purchaseId, voided, input.voidedAt, (maps) => {
    maps.purchases.set(voided.purchaseId, voided);
    maps.purchaseVersions.set(voided.purchaseId, versions);
  });
  return ok({ state: next, record: voided, replayed: false });
}

// ---------------------------------------------------------------------------
// The license law (the L18 import path's gate)
// ---------------------------------------------------------------------------

/** The artifact-license grant view the import check composes with. */
export interface LicenseGrantView {
  readonly grantId: string;
  readonly tenantId: string;
  readonly projectId: string | null;
  readonly kind: 'artifact-license';
  readonly terms: { readonly kind: 'artifact-license'; readonly artifactRef: string; readonly usageScope: 'project' | 'tenant' };
}

/**
 * THE LICENSE CHECK: may the licensed import proceed? The license
 * names the SAME content-addressed artifact reference the import
 * carries (`cpa:` — T045's derivation, mirrored), belongs to the
 * importing tenant (L12), and its usage scope covers the importing
 * project (a project license covers exactly its project; a tenant
 * license covers every project). Pure; the L18 import path composes
 * this check before localizing a purchased artifact.
 */
export function licenseCoversImport(
  license: LicenseGrantView,
  imported: { readonly artifactRef: string; readonly tenantId: string; readonly projectId: string },
): boolean {
  if (license.kind !== 'artifact-license') return false;
  if (license.tenantId !== imported.tenantId) return false; // L12
  if (license.terms.artifactRef !== imported.artifactRef) return false; // the licensed artifact IS the imported artifact
  if (license.terms.usageScope === 'project') return license.projectId === imported.projectId;
  return license.projectId === null; // a tenant-wide license
}
