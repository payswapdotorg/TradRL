// @tradrl/marketplace-service — the CATALOG: the listing registry and
// the discovery surface (the "listed and discovered" half of the Work
// Order).
//
// THE LAWS THIS MODULE SERVES:
// - THE SOURCE LAW: a listing is published FROM a provider declaration
//   (T045's versioned capability catalogue, mirrored): the offer is
//   resolved ON the declaration (`listing_mismatch` when absent) and
//   SNAPSHOTTED into the listing — the listing's `declaredAt` carries
//   the source instant and the L4 law requires the listing to postdate
//   it (a listing never predates its source).
// - THE PRICING LAW: the listing's pricing is a NON-NULL typed
//   consideration (a free listing prices at fixed-fee `"0"`); a `null`
//   consideration is the REQUEST's no-charge offer shape, never a
//   listing's price (listings are priced advertisements).
// - THE REVISION LAW: publishing an already-listed slot MINTS revision
//   version + 1 (chained id — T045's declaration-supersede discipline);
//   a retired slot never revises (`listing_retired` — retirement is
//   terminal); replaying the identical revision is an idempotent
//   replay.
// - THE DISCOVERY LAW (deterministic): the point-in-time active
//   listing set (the slot's revision current at the query instant,
//   retirement respected — L4), filtered by the query, ordered by
//   (pricing model: fixed-fee first, then price ascending by exact
//   decimal comparison, then listingRef) — identical inputs, identical
//   order, byte-stable.

import { isNonEmptyString, isRecord, isTimestampMs, signedCompare, stableDigestJson } from './imports';
import type { TimestampMs } from './imports';
import type { MarketplaceResult } from './errors';
import { fail, ok } from './errors';
import { validateConsideration } from './consideration';
import type { MarketplaceListing } from './listing';
import { deriveListingRef, isMarketplaceListing, validateMarketplaceListing } from './listing';
import type { MarketplaceState, MarketplaceOperationResult } from './state';
import { createMarketplace, requireInstant, tenantGate, withEntry } from './state';
import type { ProviderDeclarationMirror } from './mirrors';
import { isDeliverableKindMirror, isProviderDeclarationMirror, isVerificationKindMirror, labelKeyPaths } from './mirrors';

// ---------------------------------------------------------------------------
// Operation: publish (a new slot) / revise (an existing slot)
// ---------------------------------------------------------------------------

/**
 * Publishes (or revises) a listing: resolves the offer ON the
 * declaration, validates the typed pricing, and mints the listing
 * revision — version 1 for a NEW slot (provider + offer), version + 1
 * for an existing one (the supersede chain; a retired slot refuses).
 * The FIRST publication of a slot requires the marketplace to be
 * empty-of-that-slot; replaying the identical revision is an
 * idempotent replay. Returns the next state + the minted listing.
 */
export function publishListing(
  state: MarketplaceState,
  input: {
    /** The source provider declaration (a REAL T045 declaration satisfies this mirror; untrusted input is validated). */
    readonly declaration: unknown;
    /** The offer on the declaration being published. */
    readonly offerRef: string;
    /** The typed pricing (a NON-NULL consideration; free = fixed-fee "0"). */
    readonly pricing: unknown;
    /** Explicit publication instant (epoch ms — never a wall clock). */
    readonly listedAt: number;
  },
): MarketplaceResult<MarketplaceOperationResult<MarketplaceListing>> {
  const instant = requireInstant(input.listedAt, 'listedAt');
  if (!instant.ok) return instant;
  // THE L16a TRIP-WIRE FIRST (the typed error contract): a smuggled
  // profession/role label inside the declaration is the typed
  // `label_as_evidence` — never a bare "failed the mirror" (the machine
  // must be able to SEE which law refused).
  if (isRecord(input.declaration)) {
    const labelPaths = labelKeyPaths(input.declaration);
    if (labelPaths.length > 0) {
      return { ok: false, errors: labelPaths.map((labelPath) => ({
        code: 'label_as_evidence',
        path: `declaration.${labelPath}`,
        message: `field "${labelPath}" cites a profession/role label — a listing publishes a measured capability CONTRACT, never what anyone claims to BE (L16a/L19)`,
      })) };
    }
  }
  if (!isRecord(input.declaration) || !isProviderDeclarationMirror(input.declaration)) {
    return fail('invalid_type', 'the declaration failed the ProviderDeclaration mirror (the versioned capability catalogue T045 mints)', 'declaration');
  }
  const declaration = input.declaration as unknown as ProviderDeclarationMirror;
  const gate = tenantGate(state, declaration, 'declaration');
  if (!gate.ok) return gate;
  if (!isNonEmptyString(input.offerRef)) {
    return fail('invalid_field', 'the offerRef must be a non-empty offer reference', 'offerRef');
  }
  const offer = declaration.offers.find((candidate) => candidate.offerRef === input.offerRef);
  if (offer === undefined) {
    return fail('listing_mismatch', `the offer "${input.offerRef}" does not exist on the declaration ${declaration.declarationId} (provider ${declaration.providerRef})`, 'offerRef');
  }

  // THE PRICING LAW: the listing's pricing is a NON-NULL typed consideration.
  const pricing = validateConsideration(input.pricing, 'pricing');
  if (!pricing.ok) return pricing;
  if (pricing.value === null) {
    return fail('consideration_invalid', 'a listing\'s pricing is a NON-NULL typed consideration (free = fixed-fee "0") — null is the REQUEST\'s no-charge offer shape, never a priced advertisement', 'pricing');
  }

  // THE SLOT: (tenant, provider, offer) — stable across revisions.
  const listingRef = deriveListingRef({ tenantId: state.tenantId, providerRef: declaration.providerRef, offerRef: input.offerRef });
  const prior = state.listingsBySlot.get(listingRef);
  let version = 1;
  let supersedes: string | null = null;
  if (prior !== undefined) {
    const retirement = state.retirements.get(listingRef);
    if (retirement !== undefined) {
      // Content-addressed replay: re-publishing the identical retired revision at the identical instant replays.
      if (prior.listedAt === input.listedAt) {
        return ok({ state, record: prior, replayed: true });
      }
      return fail('listing_retired', `the listing slot ${listingRef} (provider ${prior.providerRef}, offer ${prior.offerRef}) was retired at ${retirement.retiredAt} — a retired slot never revises (publish a NEW offer reference)`, 'offerRef');
    }
    // THE RE-PUBLICATION REPLAY LAW: re-submitting the IDENTICAL
    // publication inputs (offer snapshot + pricing + instant) that
    // minted the CURRENT revision is the SAME operation — the current
    // revision replays (`replayed: true`, no new log entry). The
    // derived members (version, supersedes, listingId) are functions of
    // the slot's history, not of the caller's intent.
    if (
      stableDigestJson(offer) === stableDigestJson(prior.offer) &&
      stableDigestJson(pricing.value) === stableDigestJson(prior.pricing) &&
      prior.listedAt === input.listedAt
    ) {
      return ok({ state, record: prior, replayed: true });
    }
    version = prior.version + 1;
    supersedes = prior.listingId;
  }

  // L4: the listing postdates its source declaration.
  if (input.listedAt < declaration.declaredAt) {
    return fail('l4_boundary_violation', `the listing instant (${input.listedAt}) predates the source declaration (${declaration.declaredAt}) — a listing never predates what it publishes`, 'listedAt');
  }

  const assembled: Omit<MarketplaceListing, 'listingId'> = {
    listingRef,
    providerRef: declaration.providerRef,
    offerRef: input.offerRef,
    providerName: declaration.displayName,
    offer,
    pricing: pricing.value,
    version,
    supersedes,
    declaredAt: declaration.declaredAt as TimestampMs,
    listedAt: input.listedAt as TimestampMs,
    tenantId: declaration.tenantId,
    projectId: declaration.projectId,
  };
  const validated = validateMarketplaceListing(assembled);
  if (!validated.ok) return validated;
  const listing = validated.value;

  // Idempotent replay: the identical revision already minted.
  const existing = state.listingsById.get(listing.listingId);
  if (existing !== undefined) {
    return ok({ state, record: existing, replayed: true });
  }

  const kind = version === 1 ? 'listing-published' : 'listing-revised';
  const next = withEntry(state, kind, listing.listingId, listing, listing.listedAt, (maps) => {
    maps.listingsBySlot.set(listing.listingRef, listing);
    maps.listingsById.set(listing.listingId, listing);
    maps.listingHistory.push(listing);
  });
  return ok({ state: next, record: listing, replayed: false });
}

// ---------------------------------------------------------------------------
// Operation: retire (the terminal catalog event)
// ---------------------------------------------------------------------------

/**
 * Revises an existing listing slot — the EXPLICIT name for
 * {@link publishListing} over an already-listed slot (version + 1,
 * the supersede chain; a retired slot refuses). Same law, same op.
 */
export const reviseListing = publishListing;

/**
 * Retires a listing slot: the terminal catalog event. The revisions
 * are never mutated (L3); the retirement is retained and chain-pinned.
 * A retired slot never trades and never revises. Replaying the
 * identical retirement (same revision, same instant) is idempotent.
 */
export function retireListing(
  state: MarketplaceState,
  input: { readonly listingRef: string; readonly retiredAt: number },
): MarketplaceResult<MarketplaceOperationResult<{ readonly retirementId: string; readonly listingRef: string; readonly listingId: string; readonly tenantId: string; readonly retiredAt: number }>> {
  const instant = requireInstant(input.retiredAt, 'retiredAt');
  if (!instant.ok) return instant;
  if (typeof input.listingRef !== 'string' || !/^ml:[0-9a-f]{16}$/.test(input.listingRef)) {
    return fail('invalid_field', 'invalid listingRef (ml:<16-hex>)', 'listingRef');
  }
  const current = state.listingsBySlot.get(input.listingRef);
  if (current === undefined) {
    return fail('listing_unknown', `the listing slot ${input.listingRef} is not in this marketplace`, 'listingRef');
  }
  const existing = state.retirements.get(input.listingRef);
  if (existing !== undefined) {
    if (existing.listingId === current.listingId && existing.retiredAt === input.retiredAt) {
      return ok({ state, record: existing, replayed: true });
    }
    return fail('listing_retired', `the listing slot ${input.listingRef} is already retired (at ${existing.retiredAt}) — retirement is terminal`, 'listingRef');
  }
  if (input.retiredAt < current.listedAt) {
    return fail('l4_boundary_violation', `the retirement instant (${input.retiredAt}) predates the current revision's publication (${current.listedAt})`, 'retiredAt');
  }
  const identityContent = { listingRef: current.listingRef, listingId: current.listingId, tenantId: state.tenantId, retiredAt: input.retiredAt };
  const retirementId = `mlr:${stableDigestJson(identityContent)}`;
  const retirement = Object.freeze({ retirementId, ...identityContent });
  const next = withEntry(state, 'listing-retired', retirement.retirementId, retirement, input.retiredAt, (maps) => {
    maps.retirements.set(current.listingRef, retirement as never);
  });
  return ok({ state: next, record: retirement, replayed: false });
}

// ---------------------------------------------------------------------------
// The point-in-time discovery surface (deterministic)
// ---------------------------------------------------------------------------

/** The discovery query — every member optional except the instant; empty filters match everything active. */
export interface DiscoveryQuery {
  /** Match the offer's capability CONTRACT (never a profession label — L16a). */
  readonly capabilityKey?: string;
  /** Match offers producing this deliverable kind. */
  readonly deliverableKind?: string;
  /** Match offers accepting this verification kind. */
  readonly verificationKind?: string;
  /** Match the pricing currency. */
  readonly currency?: string;
  /** Fixed-fee prices / metered rates at or below this bound (canonical decimal). */
  readonly maxPrice?: string;
  /** THE QUERY INSTANT (required — L4: discovery is point-in-time). */
  readonly at: number;
}

/**
 * THE DISCOVERY FOLD: the point-in-time ACTIVE listings matching the
 * query. Active at `at` = the slot's latest revision published at or
 * before `at`, with no retirement at or before `at`. Ordering (the
 * determinism law): pricing model (fixed-fee first), then the exact
 * price (fixed amount / metered rate) ascending by exact decimal
 * comparison, then listingRef ascending. Pure.
 */
export function discoverListings(state: MarketplaceState, query: DiscoveryQuery): MarketplaceResult<readonly MarketplaceListing[]> {
  if (!isTimestampMs(query.at)) {
    return fail('invalid_timestamp', 'the discovery instant must be a TimestampMs (explicit — never a wall clock)', 'at');
  }
  if (query.capabilityKey !== undefined && !isNonEmptyString(query.capabilityKey)) {
    return fail('invalid_field', 'invalid capabilityKey (a capability CONTRACT, never a profession label — L16a)', 'capabilityKey');
  }
  if (query.deliverableKind !== undefined && !isDeliverableKindMirror(query.deliverableKind)) {
    return fail('invalid_field', 'invalid deliverableKind (the closed T045 vocabulary)', 'deliverableKind');
  }
  if (query.verificationKind !== undefined && !isVerificationKindMirror(query.verificationKind)) {
    return fail('invalid_field', 'invalid verificationKind (the closed T045 vocabulary)', 'verificationKind');
  }
  if (query.maxPrice !== undefined && !/^(0|[1-9]\d*)(\.\d+)?$/.test(query.maxPrice)) {
    return { ok: false, errors: [{ code: 'invalid_decimal', path: 'maxPrice', message: `the maxPrice must be a canonical unsigned decimal string (got ${JSON.stringify(query.maxPrice)})` }] };
  }

  const matches: MarketplaceListing[] = [];
  for (const [listingRef, revisions] of revisionsBySlot(state)) {
    // The slot's revision CURRENT at the query instant (L4).
    let currentAt: MarketplaceListing | undefined = undefined;
    for (const revision of revisions) {
      if (revision.listedAt <= query.at) currentAt = revision;
    }
    if (currentAt === undefined) continue; // not yet listed at `at`
    const retirement = state.retirements.get(listingRef);
    if (retirement !== undefined && retirement.retiredAt <= query.at) continue; // retired at `at`

    const listing = currentAt;
    if (query.capabilityKey !== undefined && listing.offer.capabilityKey !== query.capabilityKey) continue;
    if (query.deliverableKind !== undefined && !listing.offer.deliverableKinds.includes(query.deliverableKind as never)) continue;
    if (query.verificationKind !== undefined && !listing.offer.verificationKinds.includes(query.verificationKind as never)) continue;
    if (query.currency !== undefined && listing.pricing.currency !== query.currency) continue;
    if (query.maxPrice !== undefined) {
      const bound = listing.pricing.kind === 'fixed-fee' ? listing.pricing.amount : listing.pricing.rate;
      if (signedCompare(bound, query.maxPrice) > 0) continue;
    }
    matches.push(listing);
  }

  // THE ORDERING LAW: model, then exact price, then listingRef — deterministic.
  matches.sort((left, right) => {
    const leftModel = left.pricing.kind === 'fixed-fee' ? 0 : 1;
    const rightModel = right.pricing.kind === 'fixed-fee' ? 0 : 1;
    if (leftModel !== rightModel) return leftModel - rightModel;
    const leftPrice = left.pricing.kind === 'fixed-fee' ? left.pricing.amount : left.pricing.rate;
    const rightPrice = right.pricing.kind === 'fixed-fee' ? right.pricing.amount : right.pricing.rate;
    const byPrice = signedCompare(leftPrice, rightPrice);
    if (byPrice !== 0) return byPrice;
    return left.listingRef < right.listingRef ? -1 : 1;
  });
  return ok(Object.freeze(matches));
}

/** Groups the append-only revision history by slot (deterministic: history order). */
function revisionsBySlot(state: MarketplaceState): Map<string, MarketplaceListing[]> {
  const bySlot = new Map<string, MarketplaceListing[]>();
  for (const revision of state.listingHistory) {
    const list = bySlot.get(revision.listingRef) ?? [];
    list.push(revision);
    bySlot.set(revision.listingRef, list);
  }
  return bySlot;
}

// ---------------------------------------------------------------------------
// The active-listing lookup (the purchase path's gate)
// ---------------------------------------------------------------------------

/**
 * The slot's ACTIVE listing at `at` (the revision current at `at`, not
 * retired by `at`), or the typed refusal (`listing_unknown` when the
 * slot does not exist; `listing_retired` when it was retired by `at`).
 */
export function activeListingAt(state: MarketplaceState, listingRef: string, at: number): MarketplaceResult<MarketplaceListing> {
  if (typeof listingRef !== 'string' || !/^ml:[0-9a-f]{16}$/.test(listingRef)) {
    return fail('invalid_field', 'invalid listingRef (ml:<16-hex>)', 'listingRef');
  }
  if (!isTimestampMs(at)) {
    return fail('invalid_timestamp', 'the instant must be a TimestampMs (explicit — never a wall clock)', 'at');
  }
  const revisions = state.listingHistory.filter((revision) => revision.listingRef === listingRef);
  if (revisions.length === 0) {
    return fail('listing_unknown', `the listing slot ${listingRef} is not in this marketplace`, 'listingRef');
  }
  let currentAt: MarketplaceListing | undefined = undefined;
  for (const revision of revisions) {
    if (revision.listedAt <= at) currentAt = revision;
  }
  if (currentAt === undefined) {
    return fail('listing_unknown', `the listing slot ${listingRef} was not yet published at ${at}`, 'listingRef');
  }
  const retirement = state.retirements.get(listingRef);
  if (retirement !== undefined && retirement.retiredAt <= at) {
    return fail('listing_retired', `the listing slot ${listingRef} was retired at ${retirement.retiredAt} (before ${at}) — a retired slot never trades`, 'listingRef');
  }
  if (!isMarketplaceListing(currentAt)) {
    return fail('chain_mismatch', `the listing slot ${listingRef}'s current revision failed its own guard — the catalog was tampered with`, 'listingRef');
  }
  return ok(currentAt);
}

/** Creates the GENESIS marketplace (re-exported for the lane's consumers). */
export { createMarketplace };
