/**
 * @tradrl/marketplace-service — public API.
 *
 * Owning Work Order: T047 (frozen write surface:
 * services/marketplace).
 *
 * THE COMMERCIAL CAPABILITY MARKETPLACE — the layer where capability
 * offerings are listed, discovered, engaged commercially and consumed
 * under entitlements:
 *
 *   - THE CONSIDERATION (T047's core ownership): the typed commercial
 *     terms for the opaque JSON slot T045's exchange carries
 *     (`consideration` on the request and the quote terms — "T047 owns
 *     the semantics"): the closed pricing-model vocabulary
 *     (fixed-fee | usage-metered), exact canonical-decimal money, the
 *     collect-all validator, the exact charge computation
 *     (`rate x units`), and the negotiation laws (the BUDGET law —
 *     the counter never exceeds the offered budget, in the same
 *     commercial language and currency; the LISTING-PRICE law — the
 *     counter never exceeds the listing's published pricing);
 *   - THE LISTINGS: provider offers published from T045 declarations
 *     as immutable, versioned, offer-SNAPSHOTTED catalog entries
 *     (a later declaration supersession never rewrites what was
 *     listed) with typed pricing, plus the terminal retirement;
 *   - THE DISCOVERY: the point-in-time active-listing fold (L4) with
 *     deterministic ordering and exact-decimal price bounds;
 *   - THE COMMISSION: the T045-shaped capability-request draft minter
 *     (recorded capability gaps + the frozen verification contract +
 *     the offered consideration — the T017 + T045 + T047 composition);
 *   - THE PURCHASE (the engagement lifecycle's commercial half): the
 *     purchase binding (listing, request, quote) under the agreed
 *     consideration, the closed lifecycle (open -> engaged ->
 *     settled | voided), and THE SETTLEMENT — the payment gate:
 *     verified engagements charge the tenant's spend allowance
 *     through @tradrl/entitlements (exact decimals; the entitlements
 *     lane's typed refusals surface here), rejected and withdrawn
 *     engagements NEVER charge, and verified capability-artifacts
 *     mint the artifact-license entitlements that license the local
 *     L18 import (the license names the SAME `cpa:` artifact reference
 *     the T045 import path mints).
 *
 * Service laws (mirroring the merged sibling services):
 * - Zero runtime dependencies; pure data and pure functions only.
 * - No `any`; every exported shape has a hand-rolled total type guard.
 * - No ambient clock and no ambient randomness — content-addressed ids
 *   and injected instants only (L9).
 * - The service imports ITS OWN LANE's contract package
 *   (@tradrl/entitlements) via a relative source path (the
 *   firm-memory/body-forge precedent); every OTHER lane (T045, T017,
 *   T041) is consumed through STRUCTURAL MIRRORS (D-003/D-004) —
 *   src/interop.test.ts is the drift trip wire.
 * - The append-only, chain-verified per-tenant marketplace log (the
 *   commercial accounting truth: listings, retirements, purchases,
 *   settlements — all retained, tamper-evident).
 */

// Errors and results
export type { MarketplaceErrorCode, MarketplaceError, MarketplaceResult } from './errors';
export {
  MARKETPLACE_ERROR_CODES,
  API_BOUNDARY_ERROR_FAMILY_OF,
  isMarketplaceErrorCode,
  fail,
  failures,
  ok,
  missingField,
  invalidField,
  invalidType,
} from './errors';

// The consideration (T047's core ownership — the typed commercial terms)
export type { PricingModel, FixedFeeConsideration, UsageMeteredConsideration, Consideration } from './consideration';
export {
  PRICING_MODELS,
  CURRENCY_PATTERN,
  USAGE_UNIT_PATTERN,
  isPricingModel,
  isFixedFeeConsideration,
  isUsageMeteredConsideration,
  isConsideration,
  validateConsideration,
  considerationCharge,
  considerationWithin,
  withinListingPricing,
  describeConsideration,
} from './consideration';

// The listings (the commercial catalog entries)
export type { MarketplaceListing, ListingRetirement } from './listing';
export {
  isListingPricing,
  isMarketplaceListing,
  isListingRetirement,
  deriveListingRef,
  listingIdentityContent,
  deriveListingId,
  deriveListingRetirementId,
  validateMarketplaceListing,
} from './listing';

// The state + the chain (the append-only commercial ledger)
export type { MarketplaceLogKind, MarketplaceLogEntry, MarketplaceState, MarketplaceView, MarketplaceOperationResult } from './state';
export {
  MARKETPLACE_LOG_KINDS,
  GENESIS_CHAIN_HEAD,
  createMarketplace,
  verifyMarketplaceChain,
  marketplaceView,
  serializeMarketplace,
  marketplaceDigest,
} from './state';

// The catalog (publish / revise / retire / discover)
export type { DiscoveryQuery } from './catalog';
export { publishListing, reviseListing, retireListing, discoverListings, activeListingAt } from './catalog';

// The commission (the T045-shaped request draft minter)
export type { CommissionInput, CommissionedRequestDraft } from './commission';
export { commissionCapabilityRequest } from './commission';

// The purchase (the commercial half of the engagement lifecycle)
export type {
  PurchaseStatus,
  PurchaseOrder,
  SettleableEngagementStatus,
  Settlement,
  SettlementOperationResult,
  LicenseGrantView,
} from './purchase';
export {
  PURCHASE_TRANSITIONS,
  isPurchaseStatus,
  isPurchaseOrder,
  SETTLEABLE_ENGAGEMENT_STATUSES,
  isSettleableEngagementStatus,
  isSettlement,
  openPurchase,
  bindEngagement,
  settlePurchase,
  voidPurchase,
  licenseCoversImport,
} from './purchase';

// The structural mirrors (T045 + T017 + T041 — D-003/D-004)
export type {
  LabelEvidenceKeyMirror,
  CapabilityEvidenceKindMirror,
  MeasurementMetricMirror,
  BenchmarkEvidenceMirror,
  MeasurementRecordEvidenceMirror,
  ResultRefEvidenceMirror,
  MeasuredEvidenceMirror,
  SkillApplicabilityMirror,
  CapabilityGapKindMirror,
  DeliverableKindMirror,
  VerificationKindMirror,
  VerificationRequirementMirror,
  CapabilityRequestMirror,
  ProviderTermsMirror,
  ProviderQuoteMirror,
  EngagementStatusMirror,
  EngagementMirror,
  ProviderClaimMirror,
  DeliverableMirror,
  VerificationVerdictMirror,
  VerificationOutcomeMirror,
  ProviderVerificationReportMirror,
  ProviderCapabilityOfferMirror,
  ProviderDeclarationMirror,
} from './mirrors';
export {
  LABEL_EVIDENCE_KEYS_MIRROR,
  CAPABILITY_EVIDENCE_KINDS_MIRROR,
  MEASUREMENT_METRICS_MIRROR,
  CAPABILITY_GAP_KINDS_MIRROR,
  DELIVERABLE_KINDS_MIRROR,
  VERIFICATION_KINDS_MIRROR,
  ENGAGEMENT_STATUSES_MIRROR,
  EXCHANGE_ID_PATTERN_MIRROR,
  isLabelEvidenceKeyMirror,
  labelKeyPaths,
  isCapabilityEvidenceKindMirror,
  isMeasurementMetricMirror,
  isMeasuredEvidenceMirror,
  isSkillApplicabilityMirror,
  isCapabilityGapKindMirror,
  isDeliverableKindMirror,
  isVerificationKindMirror,
  isVerificationRequirementMirror,
  isCapabilityRequestIdMirror,
  isProviderQuoteIdMirror,
  isEngagementIdMirror,
  isDeliverableIdMirror,
  isProviderVerificationReportIdMirror,
  isCapabilityRequestMirror,
  isProviderTermsMirror,
  isProviderQuoteMirror,
  isEngagementStatusMirror,
  isEngagementMirror,
  isProviderClaimMirror,
  isDeliverableMirror,
  isVerificationVerdictMirror,
  isVerificationOutcomeMirror,
  isProviderVerificationReportMirror,
  isProviderCapabilityOfferMirror,
  isProviderDeclarationMirror,
  deriveIdempotencyKeyMirror,
  IDEMPOTENCY_KEY_PATTERN_MIRROR,
  licensedArtifactRef,
  isCanonicalPrice,
} from './mirrors';

// The entitlements contract package (this lane's own — relative source import)
export * from './imports';

/** Service identity and ownership (governance surface). */
export const packageInfo = {
  name: '@tradrl/marketplace-service',
  owner: 'T047',
  status: 'implemented',
  concepts: [
    'Consideration',
    'MarketplaceListing',
    'ListingRetirement',
    'DiscoveryQuery',
    'CommissionedRequestDraft',
    'PurchaseOrder',
    'Settlement',
    'MarketplaceState',
    'licenseCoversImport',
  ],
} as const;
