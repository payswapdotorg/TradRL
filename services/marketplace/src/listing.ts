// @tradrl/marketplace-service — the LISTING: the commercial catalog
// entry that publishes a provider's declared offer to the tenant's
// marketplace with typed pricing.
//
// THE LAWS THIS MODULE SERVES:
// - THE SNAPSHOT LAW (T045's self-containedness discipline): a listing
//   SNAPSHOTS the provider's declared offer (capability key, summary,
//   measured evidence, applicability, deliverable kinds, verification
//   kinds) plus the provider's display name — a later declaration
//   supersession can NEVER retro-actively rewrite what was listed; the
//   listing is the commercial record of what was advertised.
// - THE PRICING LAW: the listing's pricing is a NON-NULL typed
//   consideration (fixed-fee | usage-metered; a free listing prices at
//   fixed-fee `"0"` — the marketplace does not force payment).
// - THE VERSIONING LAW (L3 discipline): listings are IMMUTABLE; a
//   re-publication MINTS revision version + 1 that supersedes the
//   prior one (chained id). The catalog retains the full history.
// - L16a/L19: a listing describes a measured capability CONTRACT —
//   the L16a label trip-wire runs over the whole listing tree; the
//   provider's display name is a NAME, never a qualification.
// - L12: the listing carries its tenant/project scope (the scope of
//   the declaration it published from).
// - Determinism: content-addressed ids — `listingRef` (`ml:`) over the
//   SLOT identity (tenant + provider + offer — stable across
//   revisions), `listingId` (`mkl:`) over the full revision content.

import { deepCloneJson, deepFreeze, isNonEmptyString, isPositiveInteger, isRecord, isTimestampMs, stableDigestJson } from './imports';
import type { JsonValue, TimestampMs } from './imports';
import type { MarketplaceError, MarketplaceResult } from './errors';
import { failures, invalidField, invalidType, missingField, ok } from './errors';
import { isCanonicalUnsignedDecimal } from './imports';
import type { FixedFeeConsideration, UsageMeteredConsideration } from './consideration';
import { CURRENCY_PATTERN, USAGE_UNIT_PATTERN } from './consideration';
import type { ProviderCapabilityOfferMirror } from './mirrors';
import { isProviderCapabilityOfferMirror, labelKeyPaths } from './mirrors';

// ---------------------------------------------------------------------------
// The listing record (versioned, immutable)
// ---------------------------------------------------------------------------

/**
 * ONE marketplace listing revision: the provider's declared offer
 * SNAPSHOTTED (never rewritten by later supersessions) plus the typed
 * pricing. The `listingRef` is the stable SLOT identity
 * (tenant + provider + offer); the `listingId` is the revision's own
 * content-addressed identity.
 */
export interface MarketplaceListing {
  /** Revision identity (`mkl:<digest>` — content-addressed over the revision content). */
  readonly listingId: string;
  /** The stable slot identity (`ml:<digest>` — tenant + provider + offer; constant across revisions). */
  readonly listingRef: string;
  /** The publishing provider (an identity, never a qualification). */
  readonly providerRef: string;
  /** The published offer (unique within the provider's declaration). */
  readonly offerRef: string;
  /** The provider's display name at publication (a NAME — L16a/L19). */
  readonly providerName: string;
  /** The offer SNAPSHOT (measured evidence, applicability, kinds — the snapshot law). */
  readonly offer: ProviderCapabilityOfferMirror;
  /** The published pricing (NON-NULL; free = fixed-fee `"0"`). */
  readonly pricing: FixedFeeConsideration | UsageMeteredConsideration;
  /** The revision's version within the slot's history (monotonic; 1 at publish). */
  readonly version: number;
  /** The prior revision this one supersedes, or `null` at the history root. */
  readonly supersedes: string | null;
  /** The source declaration's instant (the provenance of the snapshot). */
  readonly declaredAt: TimestampMs;
  /** The listing's own explicit instant (epoch ms — never a wall clock). */
  readonly listedAt: TimestampMs;
  /** Owning tenant (L12). */
  readonly tenantId: string;
  /** Owning project (L12). */
  readonly projectId: string;
}

/** Guard: the listing's pricing block (NON-NULL typed consideration). */
export function isListingPricing(v: unknown): v is FixedFeeConsideration | UsageMeteredConsideration {
  if (!isRecord(v)) return false;
  if (v.kind === 'fixed-fee') {
    return typeof v.currency === 'string' && CURRENCY_PATTERN.test(v.currency) && isCanonicalUnsignedDecimal(v.amount);
  }
  if (v.kind === 'usage-metered') {
    return typeof v.currency === 'string' && CURRENCY_PATTERN.test(v.currency) && isCanonicalUnsignedDecimal(v.rate) && typeof v.unit === 'string' && USAGE_UNIT_PATTERN.test(v.unit);
  }
  return false;
}

/** Guard: `MarketplaceListing` — structural totality INCLUDING the L16a label scan. */
export function isMarketplaceListing(v: unknown): v is MarketplaceListing {
  if (!isRecord(v)) return false;
  if (typeof v.listingId !== 'string' || !/^mkl:[0-9a-f]{16}$/.test(v.listingId)) return false;
  if (typeof v.listingRef !== 'string' || !/^ml:[0-9a-f]{16}$/.test(v.listingRef)) return false;
  if (!isNonEmptyString(v.providerRef) || !isNonEmptyString(v.offerRef)) return false;
  if (!isNonEmptyString(v.providerName)) return false;
  if (!isProviderCapabilityOfferMirror(v.offer)) return false;
  if (v.offer.offerRef !== v.offerRef) return false; // the snapshot names its own offer
  if (!isListingPricing(v.pricing)) return false;
  if (!isPositiveInteger(v.version)) return false;
  if (v.supersedes !== null && !(typeof v.supersedes === 'string' && /^mkl:[0-9a-f]{16}$/.test(v.supersedes))) return false;
  if (v.version === 1 && v.supersedes !== null) return false;
  if (v.version > 1 && v.supersedes === null) return false;
  if (!isTimestampMs(v.declaredAt) || !isTimestampMs(v.listedAt)) return false;
  if (!isNonEmptyString(v.tenantId) || !isNonEmptyString(v.projectId)) return false;
  if (labelKeyPaths(v).length > 0) return false; // L16a: no label keys, anywhere
  return true;
}

// ---------------------------------------------------------------------------
// The id derivations (content-addressed — the ONLY minting path)
// ---------------------------------------------------------------------------

/** Mints `ml:<digest>` — the stable SLOT identity over (tenant, provider, offer). */
export function deriveListingRef(slot: { readonly tenantId: string; readonly providerRef: string; readonly offerRef: string }): string {
  return `ml:${stableDigestJson({ tenantId: slot.tenantId, providerRef: slot.providerRef, offerRef: slot.offerRef })}`;
}

/** The identity content of a listing revision — everything EXCEPT the derived `listingId`. */
export function listingIdentityContent(listing: Omit<MarketplaceListing, 'listingId'>): Record<string, unknown> {
  return {
    listingRef: listing.listingRef,
    providerRef: listing.providerRef,
    offerRef: listing.offerRef,
    providerName: listing.providerName,
    offer: listing.offer,
    pricing: listing.pricing,
    version: listing.version,
    supersedes: listing.supersedes,
    declaredAt: listing.declaredAt,
    listedAt: listing.listedAt,
    tenantId: listing.tenantId,
    projectId: listing.projectId,
  };
}

/** Mints `mkl:<digest>` — the listing revision id over its canonical identifying content. */
export function deriveListingId(content: unknown): string {
  return `mkl:${stableDigestJson(content)}`;
}

// ---------------------------------------------------------------------------
// The collect-all validator (assembled listings — the catalog ops call it)
// ---------------------------------------------------------------------------

/**
 * Collect-all validation of an assembled listing revision against the
 * FULL law (the catalog ops assemble from a declaration + pricing;
 * this validator is the gate every assembled revision passes). Returns
 * the deeply frozen listing with its content-addressed `listingId`.
 */
export function validateMarketplaceListing(v: unknown, path = 'listing'): MarketplaceResult<MarketplaceListing> {
  if (!isRecord(v)) {
    return { ok: false, errors: [invalidType(path, `${path} must be an object`)] };
  }
  const errors: MarketplaceError[] = [];

  // L16a trip-wire over the whole listing tree.
  for (const labelPath of labelKeyPaths(v)) {
    errors.push({
      code: 'label_as_evidence',
      path: `${path}.${labelPath}`,
      message: `field "${labelPath}" cites a profession/role label — a listing describes a measured capability CONTRACT, never what anyone claims to BE (L16a/L19)`,
    });
  }

  if (v.listingRef === undefined) errors.push(missingField(`${path}.listingRef`));
  else if (typeof v.listingRef !== 'string' || !/^ml:[0-9a-f]{16}$/.test(v.listingRef)) errors.push(invalidField(`${path}.listingRef`, 'invalid listingRef (ml:<16-hex> — the slot identity)'));
  if (v.providerRef === undefined) errors.push(missingField(`${path}.providerRef`));
  else if (!isNonEmptyString(v.providerRef)) errors.push(invalidField(`${path}.providerRef`, 'invalid ProviderRef (an identity, never a qualification)'));
  if (v.offerRef === undefined) errors.push(missingField(`${path}.offerRef`));
  else if (!isNonEmptyString(v.offerRef)) errors.push(invalidField(`${path}.offerRef`, 'must be a non-empty offer reference'));
  if (v.providerName === undefined) errors.push(missingField(`${path}.providerName`));
  else if (!isNonEmptyString(v.providerName)) errors.push(invalidField(`${path}.providerName`, 'must be a non-empty display name (a NAME — L16a/L19)'));
  if (v.offer === undefined) errors.push(missingField(`${path}.offer`));
  else if (!isProviderCapabilityOfferMirror(v.offer)) errors.push(invalidField(`${path}.offer`, 'failed the offer snapshot shape (capabilityKey + summary + NON-EMPTY measured evidence + applicability + kinds — L16a)'));
  if (v.pricing === undefined) errors.push(missingField(`${path}.pricing`));
  else if (!isListingPricing(v.pricing)) errors.push(invalidField(`${path}.pricing`, 'invalid pricing (the NON-NULL typed consideration: {kind: fixed-fee, currency, amount} | {kind: usage-metered, currency, rate, unit}; free = fixed-fee "0")'));
  if (v.version === undefined) errors.push(missingField(`${path}.version`));
  else if (!isPositiveInteger(v.version)) errors.push(invalidField(`${path}.version`, 'must be a positive integer (monotonic within the slot\'s history)'));
  if (v.supersedes === undefined) errors.push(missingField(`${path}.supersedes`));
  else if (v.supersedes !== null && !(typeof v.supersedes === 'string' && /^mkl:[0-9a-f]{16}$/.test(v.supersedes))) errors.push(invalidField(`${path}.supersedes`, 'invalid prior listingId (mkl:<16-hex>) or null at the history root'));
  if (v.declaredAt === undefined) errors.push(missingField(`${path}.declaredAt`));
  else if (!isTimestampMs(v.declaredAt)) errors.push(invalidField(`${path}.declaredAt`, 'invalid TimestampMs (the source declaration\'s instant)'));
  if (v.listedAt === undefined) errors.push(missingField(`${path}.listedAt`));
  else if (!isTimestampMs(v.listedAt)) errors.push(invalidField(`${path}.listedAt`, 'invalid TimestampMs (explicit — never a wall clock)'));
  if (v.tenantId === undefined || !isNonEmptyString(v.tenantId)) errors.push({ code: 'tenant_missing', path: `${path}.tenantId`, message: 'every listing carries its owning tenant (L12)' });
  if (v.projectId === undefined || !isNonEmptyString(v.projectId)) errors.push({ code: 'tenant_missing', path: `${path}.projectId`, message: 'every listing carries its owning project (L12)' });

  // The versioning law.
  if (isPositiveInteger(v.version) && ((v.version === 1 && v.supersedes !== null) || (v.version > 1 && v.supersedes === null))) {
    errors.push(invalidField(`${path}.version`, 'version 1 is the slot history root (supersedes null); every later revision supersedes the prior'));
  }
  // The snapshot-coherence law: the snapshot names its own offer.
  if (isProviderCapabilityOfferMirror(v.offer) && v.offerRef !== undefined && v.offer.offerRef !== v.offerRef) {
    errors.push(invalidField(`${path}.offer.offerRef`, `the snapshot names offer "${v.offer.offerRef}" but the listing publishes "${v.offerRef}"`));
  }

  if (errors.length > 0) return failures(errors);
  const draft = v as unknown as Omit<MarketplaceListing, 'listingId'>;
  const identityContent = listingIdentityContent(draft);
  // Clone-then-freeze: the minted listing never aliases the caller's draft.
  const listing: MarketplaceListing = deepFreeze(deepCloneJson({
    listingId: deriveListingId(identityContent),
    ...identityContent,
  } as unknown as JsonValue) as unknown as MarketplaceListing);
  if (!isMarketplaceListing(listing)) {
    return { ok: false, errors: [{ code: 'invalid_field', path, message: 'the minted listing failed its own structural guard' }] };
  }
  return ok(listing);
}

// ---------------------------------------------------------------------------
// The retirement record (the terminal catalog event)
// ---------------------------------------------------------------------------

/**
 * ONE listing retirement: the terminal catalog event. The listing
 * revisions are never mutated (L3) — retirement is a retained,
 * chain-pinned record; a retired slot never trades and never revises.
 */
export interface ListingRetirement {
  /** Retirement identity (`mlr:<digest>` — content-addressed). */
  readonly retirementId: string;
  /** The retired slot. */
  readonly listingRef: string;
  /** The retired revision (the slot's current version at retirement). */
  readonly listingId: string;
  /** Owning tenant (L12). */
  readonly tenantId: string;
  /** Explicit retirement instant (epoch ms — never a wall clock). */
  readonly retiredAt: TimestampMs;
}

/** Guard: `ListingRetirement`. */
export function isListingRetirement(v: unknown): v is ListingRetirement {
  if (!isRecord(v)) return false;
  if (typeof v.retirementId !== 'string' || !/^mlr:[0-9a-f]{16}$/.test(v.retirementId)) return false;
  if (typeof v.listingRef !== 'string' || !/^ml:[0-9a-f]{16}$/.test(v.listingRef)) return false;
  if (typeof v.listingId !== 'string' || !/^mkl:[0-9a-f]{16}$/.test(v.listingId)) return false;
  if (!isNonEmptyString(v.tenantId)) return false;
  if (!isTimestampMs(v.retiredAt)) return false;
  return true;
}

/** Mints `mlr:<digest>` — the retirement id over its canonical identifying content. */
export function deriveListingRetirementId(content: unknown): string {
  return `mlr:${stableDigestJson(content)}`;
}
