// @tradrl/capability-provider — the LOCALIZE module: the L18
// local-import path and the T041 async-job projection.
//
// THE LAWS THIS MODULE SERVES:
// - L18 ("human artifacts localizable: imported expert artifacts become
//   independently versionable and locally usable",
//   spec/ARCHITECTURE-LOCK.md; spec/LEARNING-LOOP.md "Human
//   augmentation": artifact -> local import -> local evaluation -> next
//   learning experiment): a VERIFIED capability-artifact deliverable
//   becomes a T017-consumable imported-artifact SkillRecord draft —
//   "imported expertise enters as ordinary validated SkillRecords". The
//   draft's provenance grounds in the PLATFORM's verification report
//   (the attainment evidence IS the verification; a claim the platform
//   has not verified is never imported), and its lineage carries the
//   REQUEST's gap refs and evidence refs (L9: the full commissioning
//   chain — the gap -> the request -> the engagement -> the deliverable
//   -> the verification -> the skill).
// - Determinism: the draft is a PURE function of the exchange records —
//   content-addressed ids, no ambient clock (the extracted instant is
//   the verification instant), no ambient randomness (the seed is
//   derived from the engagement + deliverable content).
// - T041 (the API surface integration): provider request envelopes ride
//   the public jobs routes as OPAQUE specs — `capabilityRequestJobPayload`
//   wraps the envelope in an operation-tagged payload, and
//   `narrowCapabilityRequestJobPayload` is the typed narrowing back (an
//   unknown spec is a typed refusal, never a blind cast). The
//   idempotency key for the consequential jobs call derives with the
//   SAME function the SDK ships (the interop test pins byte-parity).

import { isRecord, stableDigestJson } from './primitives';
import type { ProviderResult } from './errors';
import { fail, ok } from './errors';
import type { CapabilityRequestId, EngagementId } from './ids';
import type { ProviderExchangeState } from './exchange';
import type { CapabilityRequest } from './engagement';
import { isCapabilityRequest } from './engagement';
import type { ProviderVerificationReport } from './verification';
import { canonicalJson } from './primitives';
import { deriveIdempotencyKeyMirror } from './mirrors';
import type { MeasuredEvidenceMirror, SkillApplicabilityMirror } from './mirrors';

// ---------------------------------------------------------------------------
// The import protocol version (the L9 lineage participant)
// ---------------------------------------------------------------------------

/**
 * The import protocol version — carried into the imported SkillRecord's
 * lineage (`extractionVersion`), so every locally-versioned import names
 * the exact protocol that produced it (L9: reproducible lineage).
 */
export const IMPORT_PROTOCOL_VERSION = 'capability-provider-import@1';

// ---------------------------------------------------------------------------
// The imported-artifact SkillRecord draft (the T017 shape, plain JSON)
// ---------------------------------------------------------------------------

/**
 * The T017-shaped SkillRecord draft the import path mints — PLAIN JSON
 * (the untrusted-input shape `createSkillRecord` validates). Field
 * names mirror @tradrl/skills' `SkillRecord` exactly; the interop test
 * drives the REAL T017 `createSkillRecord` with this draft and proves
 * the local import satisfies the REAL evidence law (L16a measured
 * evidence; the evidence-citation law; L9 lineage; L12 scope).
 */
export interface ImportedSkillRecordDraft {
  /** Skill identity (`cpi-<16-hex>` — content-addressed over the import lineage). */
  readonly skillId: string;
  /** The opaque artifact reference agent-body capabilities cite (`cpa:<16-hex>`). */
  readonly artifactRef: string;
  readonly descriptor: {
    /** The capability contract the verified artifact serves (from the request). */
    readonly capabilityKey: string;
    /** What the skill does (the request's summary). */
    readonly summary: string;
    /** The deliverable claims' measured evidence, deduplicated in canonical order (NON-EMPTY — L16a). */
    readonly measuredEvidence: readonly MeasuredEvidenceMirror[];
    /** Registry capability records demonstrating this contract (none at import time). */
    readonly capabilityRecordRefs: readonly string[];
  };
  readonly provenance: {
    readonly trajectoryRefs: readonly string[];
    readonly experimentRefs: readonly string[];
    readonly trialRefs: readonly string[];
    /** The platform's verification report + deliverable digest — THE attainment evidence of the import. */
    readonly attainmentEvidenceRefs: readonly string[];
    /** L18: the imported-artifact origin. */
    readonly origin: 'imported-artifact';
  };
  /** The engagement's snapshotted applicability scope (L18 — the scope travels with the artifact). */
  readonly applicability: SkillApplicabilityMirror;
  /** The import's version within its lineage (1 at the root). */
  readonly version: number;
  readonly lineage: {
    readonly parentSkillRef: null;
    /** The request's evidence-capsule refs (the commissioning evidence). */
    readonly evidenceRefs: readonly string[];
    /** The request's capability-gap refs (the gap -> expertise request chain closes here — L9). */
    readonly gapRefs: readonly string[];
    readonly extractionVersion: string;
    /** The derived seed — content-addressed over the engagement + deliverable (no ambient randomness). */
    readonly seed: string;
    readonly tenantId: string;
    readonly projectId: string;
    /** The import instant = the verification instant (the artifact becomes usable when verified). */
    readonly extractedAt: number;
  };
}

/**
 * The L18 local-import path: mints the T017-shaped imported-artifact
 * SkillRecord draft from a VERIFIED capability-artifact engagement.
 *
 * Laws enforced (typed refusals):
 * - the engagement must exist and be `verified` (`verification_missing`
 *   — nothing unverified is ever imported; "local evaluation" precedes
 *   use, spec/LEARNING-LOOP.md);
 * - the deliverable kind must be `capability-artifact`
 *   (`deliverable_not_importable` — expert evidence/annotations are
 *   consumed as knowledge, not as skills);
 * - the deliverable's claims' measured evidence is the descriptor's
 *   evidence (NON-EMPTY by the claim law — L16a).
 *
 * Pure + byte-deterministic: the same exchange records mint the same
 * draft, twice.
 */
export function importAsSkillRecordDraft(
  state: ProviderExchangeState,
  engagementId: string,
): ProviderResult<ImportedSkillRecordDraft> {
  const engagement = state.engagements.get(engagementId as EngagementId);
  if (engagement === undefined) {
    return fail('engagement_unknown', `the engagement ${engagementId} is not in this exchange`, 'engagementId');
  }
  if (engagement.status !== 'verified') {
    return fail('verification_missing', `the engagement ${engagement.engagementId} is ${engagement.status} — only a VERIFIED engagement's artifact is imported (L18: local evaluation precedes use)`, 'engagementId');
  }
  if (engagement.deliverableKind !== 'capability-artifact') {
    return fail('deliverable_not_importable', `the engagement's deliverable kind is "${engagement.deliverableKind}" — only a capability-artifact imports as a SkillRecord (other kinds are consumed as knowledge)`, 'engagementId');
  }
  const request = state.requests.get(engagement.requestId as CapabilityRequestId);
  if (request === undefined) {
    return fail('request_unknown', `the engagement's request ${engagement.requestId} is not in this exchange`, 'engagementId');
  }
  // The verification report that closed the engagement (its verdict is 'verified').
  let report: ProviderVerificationReport | undefined = undefined;
  for (const candidate of state.verificationReports.values()) {
    if (candidate.engagementId === engagement.engagementId && candidate.verdict === 'verified') {
      report = candidate;
    }
  }
  if (report === undefined) {
    return fail('verification_missing', `no verification report closed the engagement ${engagement.engagementId} as verified — the import's attainment evidence is missing`, 'engagementId');
  }
  const deliverable = state.deliverables.get(report.deliverableId);
  if (deliverable === undefined) {
    return fail('deliverable_unknown', `the verified deliverable ${report.deliverableId} is not in this exchange`, 'engagementId');
  }

  // The claims' measured evidence, deduplicated by canonical bytes, in
  // first-occurrence order (deterministic).
  const seen = new Set<string>();
  const measuredEvidence: MeasuredEvidenceMirror[] = [];
  for (const claim of deliverable.claims) {
    for (const evidence of claim.measuredEvidence) {
      const key = canonicalJson(evidence);
      if (!seen.has(key)) {
        seen.add(key);
        measuredEvidence.push(evidence);
      }
    }
  }

  const identityContent = {
    engagementId: engagement.engagementId,
    deliverableId: deliverable.deliverableId,
    reportId: report.reportId,
    importProtocol: IMPORT_PROTOCOL_VERSION,
  };
  const identityDigest = stableDigestJson(identityContent);

  const draft: ImportedSkillRecordDraft = {
    skillId: `cpi-${identityDigest}`,
    artifactRef: `cpa:${stableDigestJson({ deliverableId: deliverable.deliverableId, payloadDigest: deliverable.payloadDigest })}`,
    descriptor: {
      capabilityKey: request.requestedCapability,
      summary: request.summary,
      measuredEvidence,
      capabilityRecordRefs: [],
    },
    provenance: {
      trajectoryRefs: [],
      experimentRefs: [],
      trialRefs: [],
      attainmentEvidenceRefs: [report.reportId, `dlv-payload:${deliverable.payloadDigest}`],
      origin: 'imported-artifact',
    },
    applicability: engagement.applicability,
    version: 1,
    lineage: {
      parentSkillRef: null,
      evidenceRefs: [...request.evidenceRefs],
      gapRefs: [...request.gapRefs],
      extractionVersion: IMPORT_PROTOCOL_VERSION,
      seed: `cpv-seed:${stableDigestJson({ engagementId: engagement.engagementId, deliverableId: deliverable.deliverableId })}`,
      tenantId: engagement.tenantId,
      projectId: engagement.projectId,
      extractedAt: report.verifiedAt,
    },
  };
  return ok(draft);
}

// ---------------------------------------------------------------------------
// The T041 async-job projection (the public API surface integration)
// ---------------------------------------------------------------------------

/** The operation tag a provider request carries when it rides the public jobs routes. */
export const CAPABILITY_REQUEST_JOB_OPERATION = 'capability-provider.request';

/** The operation-tagged job payload: { operation, request } — the jobs route's OPAQUE spec. */
export interface CapabilityRequestJobPayload {
  readonly operation: typeof CAPABILITY_REQUEST_JOB_OPERATION;
  readonly request: CapabilityRequest;
}

/** Wraps a capability request as the opaque job-spec payload for `POST /v1/jobs/research`. */
export function capabilityRequestJobPayload(request: CapabilityRequest): CapabilityRequestJobPayload {
  return { operation: CAPABILITY_REQUEST_JOB_OPERATION, request };
}

/**
 * The typed narrowing BACK from an opaque job spec: validates the
 * operation tag and the full request shape (the L16a scan included) —
 * an unknown spec is the typed refusal, never a blind cast (the jobs
 * machinery owns execution semantics; this lane owns the spec's
 * contract).
 */
export function narrowCapabilityRequestJobPayload(spec: unknown): ProviderResult<CapabilityRequest> {
  if (!isRecord(spec)) {
    return fail('invalid_type', 'the job spec is not an object — not a capability-provider payload', 'spec');
  }
  if (spec.operation !== CAPABILITY_REQUEST_JOB_OPERATION) {
    return fail('invalid_field', `the job spec's operation is ${JSON.stringify(spec.operation)} but this narrowing accepts only "${CAPABILITY_REQUEST_JOB_OPERATION}"`, 'spec.operation');
  }
  if (spec.request === undefined) {
    return fail('invalid_field', 'the job spec carries no request envelope', 'spec.request');
  }
  if (!isCapabilityRequest(spec.request)) {
    return fail('invalid_field', 'the job spec\'s request failed the CapabilityRequest guard (the full exchange law incl. the L16a label scan)', 'spec.request');
  }
  return ok(spec.request);
}

/**
 * The idempotency key for the consequential jobs call that submits a
 * provider request through the T041 boundary — derived with the SAME
 * function the SDK ships (`deriveIdempotencyKey` — the interop test
 * pins byte-parity), so a retry of the same envelope can never
 * double-submit.
 */
export function capabilityRequestJobIdempotencyKey(request: CapabilityRequest): string {
  return deriveIdempotencyKeyMirror([CAPABILITY_REQUEST_JOB_OPERATION, request.requestId]);
}
