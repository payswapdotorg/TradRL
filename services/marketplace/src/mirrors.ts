// @tradrl/marketplace-service — the STRUCTURAL MIRRORS of the consumed
// lanes (D-003/D-004 law: this service NEVER imports them at runtime;
// src/interop.test.ts loads the REAL packages statically and pins
// every mirror member-for-member — drift is a loud test failure).
//
//   - T045 (packages/capability-provider) — THE EXCHANGE THIS LANE
//     BUILDS THE COMMERCIAL HALF ON: the engagement envelopes
//     (capability request -> provider quote -> engagement ->
//     deliverable -> verification report), the provider declaration
//     (the versioned capability catalogue listings snapshot from),
//     and the closed deliverable-kind / verification-kind
//     vocabularies. THE CONSIDERATION SLOT: T045 carries the
//     commercial terms as OPAQUE JSON (`consideration` on the request
//     and the quote terms — "T047 owns the semantics"); the typed
//     contract for that slot is THIS lane's consideration.ts.
//   - T017 (packages/skills — the capability language): the
//     MEASURED-evidence union (benchmark | measurement-record |
//     result-ref — a capability claim is NEVER a profession label,
//     L16a), the L16a label trip-wire vocabulary, the skill
//     applicability scope, and the capability-gap mirror (the
//     commissioning citations of a marketplace request).
//   - T041 (packages/sdk + services/api): the async job pattern, the
//     idempotency-key derivation ('idem:' + FNV-1a of canonical
//     parts), and the SDK error-family vocabulary (the boundary
//     projection of this lane's typed errors — shared surface with
//     @tradrl/entitlements' mirror).
//
// Mirror discipline: the mirror records use PLAIN primitive members
// (strings/numbers), exactly like T045's own JobRecordMirror — the
// REAL lanes' branded records are assignable to them, so the
// compile-time witnesses in interop.test.ts hold without imports.

import { canonicalJson, fnv1a32Hex, isCanonicalUnsignedDecimal, isMemberOf, isNonEmptyString, isRecord, isTimestampMs, stableDigestJson } from './imports';
import type { JsonValue } from './imports';

// ---------------------------------------------------------------------------
// The L16a label trip-wire (T017's law — mirror of @tradrl/skills'
// LABEL_EVIDENCE_KEYS and @tradrl/capability-provider's mirror)
// ---------------------------------------------------------------------------

/**
 * The closed L16a trip-wire vocabulary: the field names that make a
 * record cite a PROFESSION/ROLE LABEL. A marketplace record (or any
 * nested object within it) carrying one of these keys fails validation
 * with `label_as_evidence`: a listing describes a measured capability
 * CONTRACT, never what the vendor claims to BE (L19 — no professional
 * qualification inference).
 */
export const LABEL_EVIDENCE_KEYS_MIRROR = [
  'label',
  'roleLabel',
  'profession',
  'role',
  'title',
  'jobTitle',
  'vocation',
] as const;

/** A label-suspect field name (mirror). */
export type LabelEvidenceKeyMirror = (typeof LABEL_EVIDENCE_KEYS_MIRROR)[number];

/** Guard: `LabelEvidenceKeyMirror`. */
export function isLabelEvidenceKeyMirror(v: unknown): v is LabelEvidenceKeyMirror {
  return isMemberOf(LABEL_EVIDENCE_KEYS_MIRROR, v);
}

/**
 * Walks a JSON value and returns the dotted paths of every object key
 * in {@link LABEL_EVIDENCE_KEYS_MIRROR} it finds. Pure; used by every
 * guard and validator in this lane to make label smuggling a
 * machine-detected typed violation.
 */
export function labelKeyPaths(value: unknown, prefix = ''): readonly string[] {
  const found: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      for (const path of labelKeyPaths(item, `${prefix}[${index}]`)) found.push(path);
    });
    return found;
  }
  if (!isRecord(value)) return found;
  for (const key of Object.keys(value)) {
    if (isLabelEvidenceKeyMirror(key)) found.push(prefix === '' ? key : `${prefix}.${key}`);
    for (const path of labelKeyPaths(value[key], prefix === '' ? key : `${prefix}.${key}`)) {
      found.push(path);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// T017 mirrors — the capability/skill language (packages/skills)
// ---------------------------------------------------------------------------

/** The closed measured-evidence kind vocabulary — mirror of the skills lane's `CAPABILITY_EVIDENCE_KINDS`. */
export const CAPABILITY_EVIDENCE_KINDS_MIRROR = ['benchmark', 'measurement-record', 'result-ref'] as const;

/** One kind of measured evidence (mirror). */
export type CapabilityEvidenceKindMirror = (typeof CAPABILITY_EVIDENCE_KINDS_MIRROR)[number];

/** Guard: `CapabilityEvidenceKindMirror`. */
export function isCapabilityEvidenceKindMirror(v: unknown): v is CapabilityEvidenceKindMirror {
  return isMemberOf(CAPABILITY_EVIDENCE_KINDS_MIRROR, v);
}

/** The closed structured-metric vocabulary — mirror of the skills lane's `MEASUREMENT_METRICS`. */
export const MEASUREMENT_METRICS_MIRROR = ['benchmark-score', 'p50-latency-ms', 'p95-latency-ms', 'compute-units'] as const;

/** One structured measurement metric (mirror). */
export type MeasurementMetricMirror = (typeof MEASUREMENT_METRICS_MIRROR)[number];

/** Guard: `MeasurementMetricMirror`. */
export function isMeasurementMetricMirror(v: unknown): v is MeasurementMetricMirror {
  return isMemberOf(MEASUREMENT_METRICS_MIRROR, v);
}

/** Benchmark evidence (mirror of the skills lane's `BenchmarkEvidence`). */
export interface BenchmarkEvidenceMirror {
  readonly kind: 'benchmark';
  readonly benchmarkId: string;
  readonly resultRef: string;
}

/** A structured measurement record reference (mirror). */
export interface MeasurementRecordEvidenceMirror {
  readonly kind: 'measurement-record';
  readonly recordRef: string;
  readonly metric: MeasurementMetricMirror;
  readonly value: number;
}

/** An opaque result reference (mirror). */
export interface ResultRefEvidenceMirror {
  readonly kind: 'result-ref';
  readonly resultRef: string;
}

/**
 * One piece of MEASURED evidence backing a capability claim — mirror
 * of the skills lane's closed union. There is deliberately NO
 * label/profession member: L16a makes the illegal state unrepresentable
 * in valid records.
 */
export type MeasuredEvidenceMirror = BenchmarkEvidenceMirror | MeasurementRecordEvidenceMirror | ResultRefEvidenceMirror;

/** Guard: `MeasuredEvidenceMirror` (total over the closed union). */
export function isMeasuredEvidenceMirror(v: unknown): v is MeasuredEvidenceMirror {
  if (!isRecord(v)) return false;
  switch (v.kind) {
    case 'benchmark':
      return isNonEmptyString(v.benchmarkId) && isNonEmptyString(v.resultRef);
    case 'measurement-record':
      return isNonEmptyString(v.recordRef) && isMeasurementMetricMirror(v.metric) && typeof v.value === 'number' && Number.isFinite(v.value);
    case 'result-ref':
      return isNonEmptyString(v.resultRef);
    default:
      return false;
  }
}

/** Where a skill applies (opaque refs) — mirror of the skills lane's `SkillApplicability`. */
export interface SkillApplicabilityMirror {
  readonly environmentProfileRefs: readonly string[];
  readonly instrumentClassRefs: readonly string[];
}

/** Guard: `SkillApplicabilityMirror`. */
export function isSkillApplicabilityMirror(v: unknown): v is SkillApplicabilityMirror {
  if (!isRecord(v)) return false;
  return (
    Array.isArray(v.environmentProfileRefs) &&
    v.environmentProfileRefs.every(isNonEmptyString) &&
    Array.isArray(v.instrumentClassRefs) &&
    v.instrumentClassRefs.every(isNonEmptyString)
  );
}

/** The closed capability-gap failure-class vocabulary — mirror of the skills lane's `CAPABILITY_GAP_KINDS`. */
export const CAPABILITY_GAP_KINDS_MIRROR = ['regime', 'sentiment-event', 'liquidity', 'execution', 'risk', 'coordination'] as const;

/** One failure class (mirror). */
export type CapabilityGapKindMirror = (typeof CAPABILITY_GAP_KINDS_MIRROR)[number];

/** Guard: `CapabilityGapKindMirror`. */
export function isCapabilityGapKindMirror(v: unknown): v is CapabilityGapKindMirror {
  return isMemberOf(CAPABILITY_GAP_KINDS_MIRROR, v);
}

// ---------------------------------------------------------------------------
// T045 mirrors — the provider exchange (packages/capability-provider)
// ---------------------------------------------------------------------------

/** The closed deliverable-kind vocabulary — mirror of T045's `DELIVERABLE_KINDS` (spec/ADAPTERS.md "Human expertise"). */
export const DELIVERABLE_KINDS_MIRROR = ['expert-evidence', 'demonstration', 'annotation', 'evaluation', 'capability-artifact'] as const;

/** One deliverable kind (mirror). */
export type DeliverableKindMirror = (typeof DELIVERABLE_KINDS_MIRROR)[number];

/** Guard: `DeliverableKindMirror`. */
export function isDeliverableKindMirror(v: unknown): v is DeliverableKindMirror {
  return isMemberOf(DELIVERABLE_KINDS_MIRROR, v);
}

/** The closed verification-kind vocabulary — mirror of T045's `VERIFICATION_KINDS`. */
export const VERIFICATION_KINDS_MIRROR = ['benchmark', 'measurement', 'local-evaluation'] as const;

/** One verification kind (mirror). */
export type VerificationKindMirror = (typeof VERIFICATION_KINDS_MIRROR)[number];

/** Guard: `VerificationKindMirror`. */
export function isVerificationKindMirror(v: unknown): v is VerificationKindMirror {
  return isMemberOf(VERIFICATION_KINDS_MIRROR, v);
}

/**
 * ONE structured verification requirement — mirror of T045's
 * `VerificationRequirement` (the frozen goalposts; the closed
 * three-kind union with the per-kind members).
 */
export type VerificationRequirementMirror =
  | { readonly kind: 'benchmark'; readonly requirementRef: string; readonly benchmarkId: string }
  | { readonly kind: 'measurement'; readonly requirementRef: string; readonly metric: MeasurementMetricMirror; readonly min?: number; readonly max?: number }
  | { readonly kind: 'local-evaluation'; readonly requirementRef: string; readonly evaluationRef: string };

/** Guard: `VerificationRequirementMirror` (the closed union, per-kind members). */
export function isVerificationRequirementMirror(v: unknown): v is VerificationRequirementMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.requirementRef)) return false;
  switch (v.kind) {
    case 'benchmark':
      return isNonEmptyString(v.benchmarkId);
    case 'measurement': {
      if (!isMeasurementMetricMirror(v.metric)) return false;
      const hasMin = v.min !== undefined;
      const hasMax = v.max !== undefined;
      if (hasMin && (typeof v.min !== 'number' || !Number.isFinite(v.min))) return false;
      if (hasMax && (typeof v.max !== 'number' || !Number.isFinite(v.max))) return false;
      if (!hasMin && !hasMax) return false;
      if (hasMin && hasMax && (v.min as number) > (v.max as number)) return false;
      return true;
    }
    case 'local-evaluation':
      return isNonEmptyString(v.evaluationRef);
    default:
      return false;
  }
}

/** The T045 exchange id grammar — `<prefix>:<16-hex>` over the prefixes this lane cites. */
export const EXCHANGE_ID_PATTERN_MIRROR = /^(pvd|cpr|qte|eng|dlv|vrf):[0-9a-f]{16}$/;

/** Guard: a T045 exchange id with the given prefix (mirror). */
function isExchangeIdWithPrefix(prefix: string, v: unknown): boolean {
  return typeof v === 'string' && v.startsWith(`${prefix}:`) && /^[0-9a-f]{16}$/.test(v.slice(prefix.length + 1));
}

/** Guard: `pvd:` (provider declaration). */
export const isProviderDeclarationIdMirror = (v: unknown): v is string => isExchangeIdWithPrefix('pvd', v);
/** Guard: `cpr:` (capability request). */
export const isCapabilityRequestIdMirror = (v: unknown): v is string => isExchangeIdWithPrefix('cpr', v);
/** Guard: `qte:` (provider quote). */
export const isProviderQuoteIdMirror = (v: unknown): v is string => isExchangeIdWithPrefix('qte', v);
/** Guard: `eng:` (engagement). */
export const isEngagementIdMirror = (v: unknown): v is string => isExchangeIdWithPrefix('eng', v);
/** Guard: `dlv:` (deliverable). */
export const isDeliverableIdMirror = (v: unknown): v is string => isExchangeIdWithPrefix('dlv', v);
/** Guard: `vrf:` (verification report). */
export const isProviderVerificationReportIdMirror = (v: unknown): v is string => isExchangeIdWithPrefix('vrf', v);

/**
 * The platform's request for external capability — mirror of T045's
 * `CapabilityRequest`. THE CONSIDERATION SLOT (`consideration:
 * JsonValue`) is the opaque commercial-terms carrier THIS lane owns:
 * `consideration.ts` defines and validates the typed contract it must
 * satisfy (T045 deliberately validates only that it is JSON).
 */
export interface CapabilityRequestMirror {
  readonly requestId: string;
  readonly requestedCapability: string;
  readonly summary: string;
  readonly deliverableKind: DeliverableKindMirror;
  readonly gapRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly verification: readonly VerificationRequirementMirror[];
  readonly deadline: number | null;
  /** THE OPAQUE CONSIDERATION SLOT — T047 owns the semantics (consideration.ts). */
  readonly consideration: JsonValue;
  readonly tenantId: string;
  readonly projectId: string;
  readonly requestedAt: number;
}

/** Guard: `CapabilityRequestMirror` (structural totality including the L16a label scan). */
export function isCapabilityRequestMirror(v: unknown): v is CapabilityRequestMirror {
  if (!isRecord(v)) return false;
  if (!isCapabilityRequestIdMirror(v.requestId)) return false;
  if (!isNonEmptyString(v.requestedCapability)) return false;
  if (!isNonEmptyString(v.summary)) return false;
  if (!isDeliverableKindMirror(v.deliverableKind)) return false;
  if (!Array.isArray(v.gapRefs) || !v.gapRefs.every(isNonEmptyString)) return false;
  if (!Array.isArray(v.evidenceRefs) || !v.evidenceRefs.every(isNonEmptyString)) return false;
  if (!Array.isArray(v.verification) || v.verification.length === 0 || !v.verification.every(isVerificationRequirementMirror)) return false;
  if (v.deadline !== null && !isTimestampMs(v.deadline)) return false;
  if (typeof v.consideration === 'undefined') return false;
  if (!isNonEmptyString(v.tenantId) || !isNonEmptyString(v.projectId)) return false;
  if (!isTimestampMs(v.requestedAt)) return false;
  if (labelKeyPaths(v).length > 0) return false; // L16a
  return true;
}

/**
 * The provider's negotiated terms — mirror of T045's `ProviderTerms`.
 * The counter-consideration slot is the provider's asking price (the
 * same opaque carrier; this lane's budget law compares it against the
 * request's offered consideration).
 */
export interface ProviderTermsMirror {
  readonly deliverableKind: DeliverableKindMirror;
  readonly verification: readonly VerificationRequirementMirror[];
  /** The provider's counter-consideration (opaque JSON — T047 owns the semantics). */
  readonly consideration: JsonValue;
  readonly estimatedDeliveryAt: number | null;
}

/** Guard: `ProviderTermsMirror`. */
export function isProviderTermsMirror(v: unknown): v is ProviderTermsMirror {
  if (!isRecord(v)) return false;
  if (!isDeliverableKindMirror(v.deliverableKind)) return false;
  if (!Array.isArray(v.verification) || v.verification.length === 0 || !v.verification.every(isVerificationRequirementMirror)) return false;
  if (typeof v.consideration === 'undefined') return false;
  if (v.estimatedDeliveryAt !== null && !isTimestampMs(v.estimatedDeliveryAt)) return false;
  return true;
}

/** The provider's answer to a capability request — mirror of T045's `ProviderQuote`. */
export interface ProviderQuoteMirror {
  readonly quoteId: string;
  readonly requestId: string;
  readonly providerRef: string;
  readonly offerRef: string;
  readonly terms: ProviderTermsMirror;
  readonly quotedAt: number;
  readonly tenantId: string;
  readonly projectId: string;
}

/** Guard: `ProviderQuoteMirror` (including the L16a label scan). */
export function isProviderQuoteMirror(v: unknown): v is ProviderQuoteMirror {
  if (!isRecord(v)) return false;
  if (!isProviderQuoteIdMirror(v.quoteId)) return false;
  if (!isCapabilityRequestIdMirror(v.requestId)) return false;
  if (!isNonEmptyString(v.providerRef)) return false;
  if (!isNonEmptyString(v.offerRef)) return false;
  if (!isProviderTermsMirror(v.terms)) return false;
  if (!isTimestampMs(v.quotedAt)) return false;
  if (!isNonEmptyString(v.tenantId) || !isNonEmptyString(v.projectId)) return false;
  if (labelKeyPaths(v).length > 0) return false; // L16a
  return true;
}

/** The engagement lifecycle statuses — mirror of T045's `EngagementStatus`. */
export const ENGAGEMENT_STATUSES_MIRROR = ['open', 'delivered', 'verified', 'rejected', 'withdrawn'] as const;

/** One engagement status (mirror). */
export type EngagementStatusMirror = (typeof ENGAGEMENT_STATUSES_MIRROR)[number];

/** Guard: `EngagementStatusMirror`. */
export function isEngagementStatusMirror(v: unknown): v is EngagementStatusMirror {
  return isMemberOf(ENGAGEMENT_STATUSES_MIRROR, v);
}

/**
 * The negotiated contract — mirror of T045's `Engagement` (the frozen
 * verification contract, the deadline, the snapshotted applicability,
 * the lifecycle status). The marketplace's commercial half binds
 * purchases to engagements and settles on their TERMINAL states.
 */
export interface EngagementMirror {
  readonly engagementId: string;
  readonly requestId: string;
  readonly quoteId: string;
  readonly providerRef: string;
  readonly deliverableKind: DeliverableKindMirror;
  readonly verification: readonly VerificationRequirementMirror[];
  readonly deadline: number | null;
  readonly applicability: SkillApplicabilityMirror;
  readonly status: EngagementStatusMirror;
  readonly openedAt: number;
  readonly tenantId: string;
  readonly projectId: string;
}

/** Guard: `EngagementMirror`. */
export function isEngagementMirror(v: unknown): v is EngagementMirror {
  if (!isRecord(v)) return false;
  if (!isEngagementIdMirror(v.engagementId)) return false;
  if (!isCapabilityRequestIdMirror(v.requestId)) return false;
  if (!isProviderQuoteIdMirror(v.quoteId)) return false;
  if (!isNonEmptyString(v.providerRef)) return false;
  if (!isDeliverableKindMirror(v.deliverableKind)) return false;
  if (!Array.isArray(v.verification) || v.verification.length === 0 || !v.verification.every(isVerificationRequirementMirror)) return false;
  if (v.deadline !== null && !isTimestampMs(v.deadline)) return false;
  if (!isSkillApplicabilityMirror(v.applicability)) return false;
  if (!isEngagementStatusMirror(v.status)) return false;
  if (!isTimestampMs(v.openedAt)) return false;
  if (!isNonEmptyString(v.tenantId) || !isNonEmptyString(v.projectId)) return false;
  if (labelKeyPaths(v).length > 0) return false; // L16a
  return true;
}

/** ONE provider claim — mirror of T045's `ProviderClaim` (capability + NON-EMPTY measured evidence, L16a). */
export interface ProviderClaimMirror {
  readonly claimRef: string;
  readonly capabilityKey: string;
  readonly measuredEvidence: readonly MeasuredEvidenceMirror[];
}

/** Guard: `ProviderClaimMirror`. */
export function isProviderClaimMirror(v: unknown): v is ProviderClaimMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.claimRef)) return false;
  if (!isNonEmptyString(v.capabilityKey)) return false;
  if (!Array.isArray(v.measuredEvidence) || v.measuredEvidence.length === 0 || !v.measuredEvidence.every(isMeasuredEvidenceMirror)) return false;
  if (labelKeyPaths(v).length > 0) return false; // L16a
  return true;
}

/**
 * The provider's submitted work — mirror of T045's `Deliverable`. The
 * `payloadDigest` pins the opaque payload; the marketplace's license
 * derivation mirrors T045's local-import artifact reference exactly
 * (`cpa:` over deliverable + payload digest) so a license names the
 * SAME artifact the L18 import path mints.
 */
export interface DeliverableMirror {
  readonly deliverableId: string;
  readonly engagementId: string;
  readonly kind: DeliverableKindMirror;
  readonly claims: readonly ProviderClaimMirror[];
  readonly payload: JsonValue;
  readonly payloadDigest: string;
  readonly submittedAt: number;
  readonly tenantId: string;
  readonly projectId: string;
}

/** Guard: `DeliverableMirror`. */
export function isDeliverableMirror(v: unknown): v is DeliverableMirror {
  if (!isRecord(v)) return false;
  if (!isDeliverableIdMirror(v.deliverableId)) return false;
  if (!isEngagementIdMirror(v.engagementId)) return false;
  if (!isDeliverableKindMirror(v.kind)) return false;
  if (!Array.isArray(v.claims) || v.claims.length === 0 || !v.claims.every(isProviderClaimMirror)) return false;
  if (typeof v.payloadDigest !== 'string' || !/^[0-9a-f]{16}$/.test(v.payloadDigest)) return false;
  if (!isTimestampMs(v.submittedAt)) return false;
  if (!isNonEmptyString(v.tenantId) || !isNonEmptyString(v.projectId)) return false;
  if (labelKeyPaths(v).length > 0) return false; // L16a
  return true;
}

/** The verification verdict — mirror of T045's `VerificationVerdict`. */
export type VerificationVerdictMirror = 'verified' | 'rejected';

/** Guard: `VerificationVerdictMirror`. */
export function isVerificationVerdictMirror(v: unknown): v is VerificationVerdictMirror {
  return v === 'verified' || v === 'rejected';
}

/** ONE typed outcome — mirror of T045's `VerificationOutcome`. */
export interface VerificationOutcomeMirror {
  readonly requirementRef: string;
  readonly passed: boolean;
  readonly detail: string;
}

/** Guard: `VerificationOutcomeMirror`. */
export function isVerificationOutcomeMirror(v: unknown): v is VerificationOutcomeMirror {
  if (!isRecord(v)) return false;
  return isNonEmptyString(v.requirementRef) && typeof v.passed === 'boolean' && isNonEmptyString(v.detail);
}

/**
 * The platform's typed verification verdict — mirror of T045's
 * `ProviderVerificationReport`. The verified verdict is THE PAYMENT
 * GATE of the marketplace's settlement (a verified engagement charges;
 * a rejected one never does — "never pay for rejected work").
 */
export interface ProviderVerificationReportMirror {
  readonly reportId: string;
  readonly engagementId: string;
  readonly deliverableId: string;
  readonly verdict: VerificationVerdictMirror;
  readonly outcomes: readonly VerificationOutcomeMirror[];
  readonly verifiedAt: number;
  readonly tenantId: string;
  readonly projectId: string;
}

/** Guard: `ProviderVerificationReportMirror`. */
export function isProviderVerificationReportMirror(v: unknown): v is ProviderVerificationReportMirror {
  if (!isRecord(v)) return false;
  if (!isProviderVerificationReportIdMirror(v.reportId)) return false;
  if (!isEngagementIdMirror(v.engagementId)) return false;
  if (!isDeliverableIdMirror(v.deliverableId)) return false;
  if (!isVerificationVerdictMirror(v.verdict)) return false;
  if (!Array.isArray(v.outcomes) || v.outcomes.length === 0 || !v.outcomes.every(isVerificationOutcomeMirror)) return false;
  if (!isTimestampMs(v.verifiedAt)) return false;
  if (!isNonEmptyString(v.tenantId) || !isNonEmptyString(v.projectId)) return false;
  return true;
}

/**
 * ONE offered capability — mirror of T045's
 * `ProviderCapabilityOffer`. A marketplace listing SNAPSHOTS exactly
 * this shape (plus pricing), so a later declaration supersession can
 * never retro-actively rewrite what was listed.
 */
export interface ProviderCapabilityOfferMirror {
  readonly offerRef: string;
  readonly capabilityKey: string;
  readonly summary: string;
  readonly measuredEvidence: readonly MeasuredEvidenceMirror[];
  readonly applicability: SkillApplicabilityMirror;
  readonly deliverableKinds: readonly DeliverableKindMirror[];
  readonly verificationKinds: readonly VerificationKindMirror[];
}

/** Guard: `ProviderCapabilityOfferMirror` (including the L16a label scan). */
export function isProviderCapabilityOfferMirror(v: unknown): v is ProviderCapabilityOfferMirror {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.offerRef) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(v.offerRef)) return false;
  if (!isNonEmptyString(v.capabilityKey)) return false;
  if (!isNonEmptyString(v.summary)) return false;
  if (!Array.isArray(v.measuredEvidence) || v.measuredEvidence.length === 0 || !v.measuredEvidence.every(isMeasuredEvidenceMirror)) return false;
  if (!isSkillApplicabilityMirror(v.applicability)) return false;
  if (!Array.isArray(v.deliverableKinds) || v.deliverableKinds.length === 0 || !v.deliverableKinds.every(isDeliverableKindMirror) || new Set(v.deliverableKinds).size !== v.deliverableKinds.length) return false;
  if (!Array.isArray(v.verificationKinds) || v.verificationKinds.length === 0 || !v.verificationKinds.every(isVerificationKindMirror) || new Set(v.verificationKinds).size !== v.verificationKinds.length) return false;
  if (labelKeyPaths(v).length > 0) return false; // L16a
  return true;
}

/**
 * The provider's versioned capability catalogue — mirror of T045's
 * `ProviderDeclaration`. The marketplace publishes listings FROM
 * declarations (the offer snapshot law); the declaration is untrusted
 * input validated by this mirror's guard.
 */
export interface ProviderDeclarationMirror {
  readonly declarationId: string;
  readonly providerRef: string;
  readonly displayName: string;
  readonly offers: readonly ProviderCapabilityOfferMirror[];
  readonly version: number;
  readonly supersedes: string | null;
  readonly declaredAt: number;
  readonly tenantId: string;
  readonly projectId: string;
}

/** Guard: `ProviderDeclarationMirror`. */
export function isProviderDeclarationMirror(v: unknown): v is ProviderDeclarationMirror {
  if (!isRecord(v)) return false;
  if (!isProviderDeclarationIdMirror(v.declarationId)) return false;
  if (!isNonEmptyString(v.providerRef)) return false;
  if (!isNonEmptyString(v.displayName)) return false;
  if (!Array.isArray(v.offers) || v.offers.length === 0 || !v.offers.every(isProviderCapabilityOfferMirror)) return false;
  if (!(typeof v.version === 'number' && Number.isInteger(v.version) && v.version > 0)) return false;
  if (v.supersedes !== null && !isProviderDeclarationIdMirror(v.supersedes)) return false;
  if (!isTimestampMs(v.declaredAt)) return false;
  if (!isNonEmptyString(v.tenantId) || !isNonEmptyString(v.projectId)) return false;
  if (labelKeyPaths(v).length > 0) return false; // L16a
  return true;
}

// ---------------------------------------------------------------------------
// T041 mirrors — the API/SDK surface (shared with @tradrl/entitlements)
// ---------------------------------------------------------------------------

/**
 * The DETERMINISTIC idempotency-key derivation — STRUCTURAL MIRROR of
 * the SDK's `deriveIdempotencyKey` (and @tradrl/capability-provider's
 * mirror): 'idem:' + FNV-1a of the canonical JSON of the parts. The
 * interop test pins byte-parity with the REAL SDK derivation; the
 * marketplace derives its API-boundary idempotency keys with THIS
 * function.
 */
export function deriveIdempotencyKeyMirror(parts: unknown): string {
  return `idem:${fnv1a32Hex(canonicalJson(parts))}`;
}

/** The idempotency-key grammar — mirror of the SDK's `IDEMPOTENCY_KEY_PATTERN`. */
export const IDEMPOTENCY_KEY_PATTERN_MIRROR = /^idem:[0-9a-f]{8}$/;

// ---------------------------------------------------------------------------
// The licensed-artifact derivation (mirrors T045's localize.ts EXACTLY)
// ---------------------------------------------------------------------------

/**
 * The licensed artifact reference — the SAME derivation T045's
 * local-import path mints (`cpa:` over the deliverable id + payload
 * digest): a settlement's artifact license names the artifact the L18
 * import carries, byte-for-byte. The interop test pins the agreement
 * against the REAL `importAsSkillRecordDraft`.
 */
export function licensedArtifactRef(deliverable: DeliverableMirror): string {
  return `cpa:${stableDigestJson({ deliverableId: deliverable.deliverableId, payloadDigest: deliverable.payloadDigest })}`;
}

/** `true` iff the canonical-unsigned-decimal guard holds (re-exported convenience for pricing law sites). */
export const isCanonicalPrice = isCanonicalUnsignedDecimal;
