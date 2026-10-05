/**
 * @tradrl/adapter-arena — the capability-provider ENVELOPE layer.
 *
 * STRUCTURAL MIRROR of @tradrl/capability-provider's envelope modules
 * (declaration.ts + engagement.ts + verification.ts + the exchange's
 * quote mint — Work Order T045, law D-003/D-004: structural mirrors,
 * NEVER imports). These are the envelopes the Arena adapter MINTS from
 * the documented wire and hands to the platform's exchange:
 *
 *   - the provider DECLARATION (the versioned capability catalogue —
 *     L16a measured evidence, never profession labels);
 *   - the CAPABILITY REQUEST (the platform-issued envelope the adapter
 *     routes onto the wire — validation is the routing's entry check);
 *   - the PROVIDER QUOTE (the wire's answer, the verification contract
 *     accepted VERBATIM — goalposts never move);
 *   - the ENGAGEMENT lifecycle vocabulary (the negotiated contract's
 *     closed transition table);
 *   - the DELIVERABLE (the wire's submitted work — claims evidence-
 *     backed, the opaque payload pinned by its content digest);
 *   - the VERIFICATION contract shapes (the frozen goalposts + the
 *     platform-supplied outcomes — the adapter CARRIES them, it never
 *     mints verdicts: the provider never verifies its own deliverable,
 *     L20).
 *
 * The interop test drives the REAL @tradrl/capability-provider exchange
 * with envelopes minted through THIS mirror and pins verdict parity on
 * a positive+negative battery — drift is a loud test failure.
 */

import {
  canonicalJson,
  deepCloneJson,
  deepFreeze,
  fail,
  invalidField,
  invalidType,
  isArrayOf,
  isCapabilityGapId,
  isCapabilityKey,
  isCapabilityRequestId,
  isDeliverableId,
  isEngagementId,
  isEnvironmentProfileRef,
  isEvidenceRef,
  isInstrumentClassRef,
  isJsonValue,
  isMeasuredEvidenceMirror,
  isMemberOf,
  isNonEmptyString,
  isPositiveInteger,
  isProjectId,
  isProviderDeclarationId,
  isProviderQuoteId,
  isProviderRef,
  isProviderVerificationReportId,
  isRecord,
  isSkillApplicabilityMirror,
  isTenantId,
  isTimestampMs,
  labelKeyPaths,
  missingField,
  ok,
  stableDigestJson,
  type MeasurementMetricMirror,
} from './provider';
import type {
  CapabilityGapId,
  CapabilityKey,
  CapabilityRequestId,
  DeliverableId,
  EngagementId,
  EnvironmentProfileRef,
  EvidenceRef,
  InstrumentClassRef,
  JsonValue,
  MeasuredEvidenceMirror,
  ProviderDeclarationId,
  ProviderError,
  ProviderQuoteId,
  ProviderRef,
  ProviderResult,
  ProviderVerificationReportId,
  ProjectId,
  SkillApplicabilityMirror,
  TenantId,
  TimestampMs,
} from './provider';

// Re-export the id guards + types for envelope consumers (single import site).
export {
  isCapabilityGapId,
  isCapabilityKey,
  isCapabilityRequestId,
  isDeliverableId,
  isEngagementId,
  isEnvironmentProfileRef,
  isEvidenceRef,
  isInstrumentClassRef,
  isProviderDeclarationId,
  isProviderVerificationReportId,
} from './provider';
export type {
  CapabilityGapId,
  CapabilityKey,
  CapabilityRequestId,
  DeliverableId,
  EngagementId,
  EnvironmentProfileRef,
  EvidenceRef,
  InstrumentClassRef,
  ProviderDeclarationId,
  ProviderQuoteId,
  ProviderRef,
  ProviderVerificationReportId,
  ProjectId,
  TenantId,
} from './provider';

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
// The verification requirement vocabulary (closed)
// ---------------------------------------------------------------------------

/** The closed verification-kind vocabulary. */
export const VERIFICATION_KINDS = ['benchmark', 'measurement', 'local-evaluation'] as const;

/** One verification kind. */
export type VerificationKind = (typeof VERIFICATION_KINDS)[number];

/** Guard: `VerificationKind`. */
export function isVerificationKind(v: unknown): v is VerificationKind {
  return isMemberOf(VERIFICATION_KINDS, v);
}

/**
 * One structured verification requirement — what the deliverable must
 * clear. `requirementRef` identifies the requirement within its
 * contract (unique; the outcomes answer by this ref).
 */
export type VerificationRequirement =
  | {
      readonly kind: 'benchmark';
      readonly requirementRef: string;
      /** The benchmark suite the deliverable's evidence must cite. */
      readonly benchmarkId: string;
    }
  | {
      readonly kind: 'measurement';
      readonly requirementRef: string;
      /** The structured metric the platform measures. */
      readonly metric: MeasurementMetricMirror;
      /** The inclusive lower bound (absent = unbounded below). */
      readonly min?: number;
      /** The inclusive upper bound (absent = unbounded above). */
      readonly max?: number;
    }
  | {
      readonly kind: 'local-evaluation';
      readonly requirementRef: string;
      /** Opaque reference to the platform's evaluation suite definition. */
      readonly evaluationRef: string;
    };

/** Guard: `VerificationRequirement`. */
export function isVerificationRequirement(v: unknown): v is VerificationRequirement {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.requirementRef)) return false;
  switch (v.kind) {
    case 'benchmark':
      return isNonEmptyString(v.benchmarkId);
    case 'measurement': {
      const metricOk =
        v.metric === 'benchmark-score' ||
        v.metric === 'p50-latency-ms' ||
        v.metric === 'p95-latency-ms' ||
        v.metric === 'compute-units';
      if (!metricOk) return false;
      const hasMin = v.min !== undefined;
      const hasMax = v.max !== undefined;
      if (hasMin && (typeof v.min !== 'number' || !Number.isFinite(v.min))) return false;
      if (hasMax && (typeof v.max !== 'number' || !Number.isFinite(v.max))) return false;
      if (!hasMin && !hasMax) return false; // at least one bound
      if (hasMin && hasMax && (v.min as number) > (v.max as number)) return false;
      return true;
    }
    case 'local-evaluation':
      return isNonEmptyString(v.evaluationRef);
    default:
      return false;
  }
}

/**
 * The requirement-list law: NON-EMPTY (a request without a verification
 * contract is unverifiable — `verification_required`) with unique
 * `requirementRef`s.
 */
export function verificationContractProblems(requirements: readonly unknown[], path: string): readonly string[] {
  const problems: string[] = [];
  if (requirements.length === 0) {
    problems.push(`${path}: the verification contract is NON-EMPTY — a request without verification requirements is unverifiable`);
    return problems;
  }
  const refs = new Set<string>();
  requirements.forEach((requirement, index) => {
    if (!isVerificationRequirement(requirement)) {
      problems.push(`${path}[${index}]: failed the closed VerificationRequirement union (benchmark | measurement | local-evaluation)`);
      return;
    }
    if (refs.has(requirement.requirementRef)) {
      problems.push(`${path}[${index}]: duplicate requirementRef "${requirement.requirementRef}" (unique within the contract)`);
    } else {
      refs.add(requirement.requirementRef);
    }
  });
  return problems;
}

// ---------------------------------------------------------------------------
// The verification outcome + report (the platform's typed verdict)
// ---------------------------------------------------------------------------

/** One requirement's checked outcome, as the platform's verification machinery measured it. */
export interface VerificationOutcome {
  /** The requirement this outcome answers (must exist in the engagement's contract). */
  readonly requirementRef: string;
  /** Whether the requirement was met. */
  readonly passed: boolean;
  /** The structured explanation (non-empty; what was measured/checked and where the record lives). */
  readonly detail: string;
}

/** Guard: `VerificationOutcome`. */
export function isVerificationOutcome(v: unknown): v is VerificationOutcome {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.requirementRef) &&
    typeof v.passed === 'boolean' &&
    isNonEmptyString(v.detail)
  );
}

/** The verdict: `verified` iff every outcome passed (the pure fold — L20). */
export type VerificationVerdict = 'verified' | 'rejected';

/** Guard: `VerificationVerdict`. */
export function isVerificationVerdict(v: unknown): v is VerificationVerdict {
  return v === 'verified' || v === 'rejected';
}

/**
 * The platform's typed verification verdict over one deliverable. The
 * adapter MIRRORS the shape (it carries platform reports); it never
 * mints one — the provider never verifies its own deliverable.
 */
export interface ProviderVerificationReport {
  /** Report identity (`vrf:<digest>` — content-addressed). */
  readonly reportId: ProviderVerificationReportId;
  /** The engagement whose frozen contract was verified. */
  readonly engagementId: EngagementId;
  /** The deliverable that was verified. */
  readonly deliverableId: DeliverableId;
  /** The fold verdict (`verified` iff every outcome passed). */
  readonly verdict: VerificationVerdict;
  /** The outcomes; EXACTLY one per contract requirement (the coverage law). */
  readonly outcomes: readonly VerificationOutcome[];
  /** Explicit verification instant (epoch ms — never a wall clock). */
  readonly verifiedAt: TimestampMs;
  /** Owning tenant (L12). */
  readonly tenantId: TenantId;
  /** Owning project (L12). */
  readonly projectId: ProjectId;
}

/** Guard: `ProviderVerificationReport`. */
export function isProviderVerificationReport(v: unknown): v is ProviderVerificationReport {
  if (!isRecord(v)) return false;
  if (!isProviderVerificationReportId(v.reportId)) return false;
  if (!isEngagementId(v.engagementId)) return false;
  if (!isDeliverableId(v.deliverableId)) return false;
  if (!isVerificationVerdict(v.verdict)) return false;
  if (!Array.isArray(v.outcomes) || v.outcomes.length === 0) return false;
  if (!v.outcomes.every(isVerificationOutcome)) return false;
  if (!isTimestampMs(v.verifiedAt)) return false;
  if (!isTenantId(v.tenantId) || !isProjectId(v.projectId)) return false;
  return true;
}

/**
 * The pure verdict fold: `verified` iff every outcome passed. This is
 * the ONLY verdict computation — never a prompt, never a judgment call
 * (L20). The adapter exposes the mirror for parity; verdicts are the
 * PLATFORM's, always.
 */
export function verdictOf(outcomes: readonly VerificationOutcome[]): VerificationVerdict {
  return outcomes.every((outcome) => outcome.passed) ? 'verified' : 'rejected';
}

/**
 * The EXACT-coverage law: the outcomes must answer every requirement of
 * the contract EXACTLY once, and invent no requirements. Returns the
 * typed failure list (empty when coverage is exact).
 */
export function coverageProblems(
  contract: readonly VerificationRequirement[],
  outcomes: readonly VerificationOutcome[],
): readonly string[] {
  const problems: string[] = [];
  const requiredRefs = new Set(contract.map((requirement) => requirement.requirementRef));
  const answeredRefs = new Set<string>();
  outcomes.forEach((outcome, index) => {
    if (!requiredRefs.has(outcome.requirementRef)) {
      problems.push(`outcomes[${index}]: answers requirementRef "${outcome.requirementRef}" which is not in the engagement's verification contract`);
    } else if (answeredRefs.has(outcome.requirementRef)) {
      problems.push(`outcomes[${index}]: duplicate answer for requirementRef "${outcome.requirementRef}"`);
    } else {
      answeredRefs.add(outcome.requirementRef);
    }
  });
  for (const requirement of contract) {
    if (!answeredRefs.has(requirement.requirementRef)) {
      problems.push(`the requirement "${requirement.requirementRef}" (${requirement.kind}) has no outcome — the contract must be covered EXACTLY`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// The provider capability offer + declaration
// ---------------------------------------------------------------------------

/**
 * ONE offered capability: the capability contract it serves (never a
 * profession label — L16a), what it does, the NON-EMPTY measured
 * evidence backing the offer, the applicability scope (opaque refs),
 * the deliverable kinds this offer produces, and the verification kinds
 * this offer accepts.
 */
export interface ProviderCapabilityOffer {
  /** Offer identity (unique within the declaration; identifier pattern). */
  readonly offerRef: string;
  /** The capability contract this offer serves (the T017 language). */
  readonly capabilityKey: CapabilityKey;
  /** What the offer delivers (human-readable summary). */
  readonly summary: string;
  /** Measured evidence backing the offer; NON-EMPTY (a bare claim is a label — L16a). */
  readonly measuredEvidence: readonly MeasuredEvidenceMirror[];
  /** The applicability scope the offer was validated under (opaque refs). */
  readonly applicability: SkillApplicabilityMirror;
  /** The deliverable kinds this offer produces; NON-EMPTY, unique. */
  readonly deliverableKinds: readonly DeliverableKind[];
  /** The verification kinds this offer accepts; NON-EMPTY, unique. */
  readonly verificationKinds: readonly VerificationKind[];
}

/** Guard: `ProviderCapabilityOffer` — structural totality INCLUDING the L16a label scan. */
export function isProviderCapabilityOffer(v: unknown): v is ProviderCapabilityOffer {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.offerRef) || !ID_LIKE.test(v.offerRef)) return false;
  if (!isCapabilityKey(v.capabilityKey)) return false;
  if (!isNonEmptyString(v.summary)) return false;
  if (!Array.isArray(v.measuredEvidence) || v.measuredEvidence.length === 0) return false;
  if (!isArrayOf(v.measuredEvidence, isMeasuredEvidenceMirror)) return false;
  if (!isSkillApplicabilityMirror(v.applicability)) return false;
  if (!Array.isArray(v.deliverableKinds) || v.deliverableKinds.length === 0) return false;
  if (!v.deliverableKinds.every(isDeliverableKind)) return false;
  if (new Set(v.deliverableKinds).size !== v.deliverableKinds.length) return false;
  if (!Array.isArray(v.verificationKinds) || v.verificationKinds.length === 0) return false;
  if (!v.verificationKinds.every(isVerificationKind)) return false;
  if (new Set(v.verificationKinds).size !== v.verificationKinds.length) return false;
  if (labelKeyPaths(v).length > 0) return false; // L16a: no label keys, anywhere
  return true;
}

/** Identifier pattern for offer references (mirror of the lane's id grammar). */
const ID_LIKE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

/**
 * The provider's versioned capability catalogue: who (the stable
 * provider reference — an identity, never a qualification), what (the
 * NON-EMPTY offer list), the version (monotonic; a re-declaration
 * supersedes), and the L12 scope. Declarations are content-addressed
 * (`pvd:` ids) and append-only — supersede MINTS, never mutates.
 */
export interface ProviderDeclaration {
  /** Declaration identity (`pvd:<digest>` — content-addressed over the declaration content). */
  readonly declarationId: ProviderDeclarationId;
  /** The provider's stable identity (unique within the exchange registry). */
  readonly providerRef: ProviderRef;
  /** Human-readable display name (a NAME, never a professional qualification — L16a/L19). */
  readonly displayName: string;
  /** The offered capabilities; NON-EMPTY, unique by `offerRef`. */
  readonly offers: readonly ProviderCapabilityOffer[];
  /** The declaration's version within the provider's supersede history (monotonic; 1 at the root). */
  readonly version: number;
  /** The declaration this one supersedes, or `null` at the history root. */
  readonly supersedes: ProviderDeclarationId | null;
  /** Explicit declaration instant (epoch ms — carried, never read from a clock). */
  readonly declaredAt: TimestampMs;
  /** Owning tenant (L12). */
  readonly tenantId: TenantId;
  /** Owning project (L12). */
  readonly projectId: ProjectId;
}

/** Guard: `ProviderDeclaration` — structural totality INCLUDING the L16a label scan. */
export function isProviderDeclaration(v: unknown): v is ProviderDeclaration {
  if (!isRecord(v)) return false;
  if (!isProviderDeclarationId(v.declarationId)) return false;
  if (!isProviderRef(v.providerRef)) return false;
  if (!isNonEmptyString(v.displayName)) return false;
  if (!Array.isArray(v.offers) || v.offers.length === 0) return false;
  if (!isArrayOf(v.offers, isProviderCapabilityOffer)) return false;
  if (!isPositiveInteger(v.version)) return false;
  if (v.supersedes !== null && !isProviderDeclarationId(v.supersedes)) return false;
  if (!isTimestampMs(v.declaredAt)) return false;
  if (!isTenantId(v.tenantId) || !isProjectId(v.projectId)) return false;
  if (labelKeyPaths(v).length > 0) return false; // L16a: no label keys, anywhere
  return true;
}

/** The declaration draft — everything EXCEPT the derived identity. */
export interface ProviderDeclarationDraft {
  readonly providerRef: string;
  readonly displayName: string;
  readonly offers: readonly ProviderCapabilityOffer[];
  readonly version: number;
  readonly supersedes: string | null;
  readonly declaredAt: number;
  readonly tenantId: string;
  readonly projectId: string;
}

/**
 * Collect-all validation of an untrusted provider declaration against
 * the FULL law: structural shape, the L16a label trip-wire, the
 * MEASURED-evidence law (non-empty per offer), the non-empty offer list
 * with unique `offerRef`s, version sanity, and the L12 tenant/project
 * law. On success the value is returned narrowed and deeply frozen,
 * with the content-addressed `declarationId` minted.
 */
export function validateProviderDeclaration(v: unknown, path = 'declaration'): ProviderResult<ProviderDeclaration> {
  if (!isRecord(v)) {
    return { ok: false, errors: [invalidType(path, `${path} must be an object`)] };
  }
  const errors: ProviderError[] = [];

  // L16a trip-wire: label FIELD keys anywhere in the declaration's JSON tree.
  for (const labelPath of labelKeyPaths(v)) {
    errors.push({
      code: 'label_as_evidence',
      path: `${path}.${labelPath}`,
      message: `field "${labelPath}" cites a profession/role label — labels alone never establish suitability (L16a; spec/CAPABILITY-DISCOVERY.md "Never equate model and profession")`,
    });
  }

  if (v.providerRef === undefined) {
    errors.push(missingField(`${path}.providerRef`));
  } else if (!isProviderRef(v.providerRef)) {
    errors.push(invalidField(`${path}.providerRef`, 'invalid ProviderRef (identifier pattern; a provider identity, never a qualification)'));
  }
  if (v.displayName === undefined) {
    errors.push(missingField(`${path}.displayName`));
  } else if (!isNonEmptyString(v.displayName)) {
    errors.push(invalidField(`${path}.displayName`, 'must be a non-empty display name'));
  }

  if (v.offers === undefined) {
    errors.push(missingField(`${path}.offers`));
  } else if (!Array.isArray(v.offers) || v.offers.length === 0) {
    errors.push(invalidField(`${path}.offers`, 'must be a NON-EMPTY array of provider capability offers'));
  } else {
    const offerRefs = new Set<string>();
    v.offers.forEach((offer: unknown, index: number) => {
      const offerPath = `${path}.offers[${index}]`;
      if (!isRecord(offer)) {
        errors.push(invalidType(offerPath, `${offerPath} must be an object`));
        return;
      }
      if (offer.offerRef === undefined) {
        errors.push(missingField(`${offerPath}.offerRef`));
      } else if (typeof offer.offerRef !== 'string' || !ID_LIKE.test(offer.offerRef)) {
        errors.push(invalidField(`${offerPath}.offerRef`, 'invalid offer reference (identifier pattern)'));
      } else if (offerRefs.has(offer.offerRef)) {
        errors.push(invalidField(`${offerPath}.offerRef`, `duplicate offer reference "${offer.offerRef}" (unique within the declaration)`));
      } else {
        offerRefs.add(offer.offerRef);
      }
      if (offer.capabilityKey === undefined) {
        errors.push(missingField(`${offerPath}.capabilityKey`));
      } else if (!isCapabilityKey(offer.capabilityKey)) {
        errors.push(invalidField(`${offerPath}.capabilityKey`, 'invalid CapabilityKey (a capability CONTRACT, never a profession label — L16a)'));
      }
      if (offer.summary === undefined) {
        errors.push(missingField(`${offerPath}.summary`));
      } else if (!isNonEmptyString(offer.summary)) {
        errors.push(invalidField(`${offerPath}.summary`, 'must be a non-empty summary of what the offer delivers'));
      }
      if (offer.measuredEvidence === undefined) {
        errors.push(missingField(`${offerPath}.measuredEvidence`));
      } else if (!Array.isArray(offer.measuredEvidence) || offer.measuredEvidence.length === 0) {
        // A capability offer without measured evidence is exactly the
        // label-shaped claim L16a forbids.
        errors.push({
          code: 'label_as_evidence',
          path: `${offerPath}.measuredEvidence`,
          message: 'an offered capability must carry at least one measured-evidence entry (L16a: labels alone never establish suitability)',
        });
      } else if (!isArrayOf(offer.measuredEvidence, isMeasuredEvidenceMirror)) {
        errors.push(invalidField(`${offerPath}.measuredEvidence`, 'failed the closed MeasuredEvidence union (benchmark | measurement-record | result-ref)'));
      }
      if (offer.applicability === undefined) {
        errors.push(missingField(`${offerPath}.applicability`));
      } else if (!isSkillApplicabilityMirror(offer.applicability)) {
        errors.push(invalidField(`${offerPath}.applicability`, 'invalid SkillApplicability (opaque environment/instrument refs)'));
      }
      if (offer.deliverableKinds === undefined) {
        errors.push(missingField(`${offerPath}.deliverableKinds`));
      } else if (!Array.isArray(offer.deliverableKinds) || offer.deliverableKinds.length === 0 || !offer.deliverableKinds.every(isDeliverableKind) || new Set(offer.deliverableKinds).size !== offer.deliverableKinds.length) {
        errors.push(invalidField(`${offerPath}.deliverableKinds`, `must be a non-empty duplicate-free array over ${DELIVERABLE_KINDS.join(' | ')}`));
      }
      if (offer.verificationKinds === undefined) {
        errors.push(missingField(`${offerPath}.verificationKinds`));
      } else if (!Array.isArray(offer.verificationKinds) || offer.verificationKinds.length === 0 || !offer.verificationKinds.every(isVerificationKind) || new Set(offer.verificationKinds).size !== offer.verificationKinds.length) {
        errors.push(invalidField(`${offerPath}.verificationKinds`, `must be a non-empty duplicate-free array over ${VERIFICATION_KINDS.join(' | ')}`));
      }
    });
  }

  if (v.version === undefined) {
    errors.push(missingField(`${path}.version`));
  } else if (!isPositiveInteger(v.version)) {
    errors.push(invalidField(`${path}.version`, 'must be a positive integer (monotonic within the provider\'s supersede history)'));
  }
  if (v.supersedes === undefined) {
    errors.push(missingField(`${path}.supersedes`));
  } else if (v.supersedes !== null && !isProviderDeclarationId(v.supersedes)) {
    errors.push(invalidField(`${path}.supersedes`, 'invalid ProviderDeclarationId (or null at the history root)'));
  }
  if (v.declaredAt === undefined) {
    errors.push(missingField(`${path}.declaredAt`));
  } else if (!isTimestampMs(v.declaredAt)) {
    errors.push(invalidField(`${path}.declaredAt`, 'invalid TimestampMs (explicit instant — never a wall clock)'));
  }
  // L12: tenant/project scope is MANDATORY on every record.
  if (v.tenantId === undefined || !isTenantId(v.tenantId)) {
    errors.push({
      code: 'tenant_missing',
      path: `${path}.tenantId`,
      message: 'every provider declaration carries its owning tenant (L12)',
    });
  }
  if (v.projectId === undefined || !isProjectId(v.projectId)) {
    errors.push({
      code: 'tenant_missing',
      path: `${path}.projectId`,
      message: 'every provider declaration carries its owning project (L12)',
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  const draft = v as unknown as ProviderDeclarationDraft;
  const identityContent = declarationIdentityContent(draft);
  const declaration: ProviderDeclaration = deepFreeze(deepCloneJson({
    declarationId: `pvd:${stableDigestJson(identityContent)}`,
    providerRef: draft.providerRef,
    displayName: draft.displayName,
    offers: draft.offers,
    version: draft.version,
    supersedes: draft.supersedes,
    declaredAt: draft.declaredAt,
    tenantId: draft.tenantId,
    projectId: draft.projectId,
  } as unknown as JsonValue) as unknown as ProviderDeclaration);
  if (!isProviderDeclaration(declaration)) {
    return fail('invalid_field', 'the minted declaration failed its own structural guard', path);
  }
  return ok(declaration);
}

/** The identity content of a declaration — everything EXCEPT the derived id. */
export function declarationIdentityContent(draft: ProviderDeclarationDraft): Record<string, unknown> {
  return {
    providerRef: draft.providerRef,
    displayName: draft.displayName,
    offers: draft.offers,
    version: draft.version,
    supersedes: draft.supersedes,
    declaredAt: draft.declaredAt,
    tenantId: draft.tenantId,
    projectId: draft.projectId,
  };
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
  const errors: ProviderError[] = [];

  for (const labelPath of labelKeyPaths(v)) {
    errors.push({
      code: 'label_as_evidence',
      path: `${path}.${labelPath}`,
      message: `field "${labelPath}" cites a profession/role label — labels alone never establish suitability (L16a)`,
    });
  }

  if (v.requestedCapability === undefined) errors.push(missingField(`${path}.requestedCapability`));
  else if (!isCapabilityKey(v.requestedCapability)) errors.push(invalidField(`${path}.requestedCapability`, 'invalid CapabilityKey (a capability CONTRACT, never a profession label — L16a)'));
  if (v.summary === undefined) errors.push(missingField(`${path}.summary`));
  else if (!isNonEmptyString(v.summary)) errors.push(invalidField(`${path}.summary`, 'must be a non-empty summary of what is requested'));
  if (v.deliverableKind === undefined) errors.push(missingField(`${path}.deliverableKind`));
  else if (!isDeliverableKind(v.deliverableKind)) errors.push(invalidField(`${path}.deliverableKind`, `must be one of ${DELIVERABLE_KINDS.join(' | ')}`));
  if (v.gapRefs === undefined) errors.push(missingField(`${path}.gapRefs`));
  else if (!isArrayOf(v.gapRefs, isCapabilityGapId)) errors.push(invalidField(`${path}.gapRefs`, 'must be an array of capability-gap references'));
  if (v.evidenceRefs === undefined) errors.push(missingField(`${path}.evidenceRefs`));
  else if (!isArrayOf(v.evidenceRefs, isEvidenceRef)) errors.push(invalidField(`${path}.evidenceRefs`, 'must be an array of evidence-capsule references'));
  if (v.verification === undefined) errors.push(missingField(`${path}.verification`));
  else if (Array.isArray(v.verification)) {
    for (const problem of verificationContractProblems(v.verification, `${path}.verification`)) {
      errors.push({
        code: 'verification_required',
        path: problem.split(':')[0],
        message: problem,
      });
    }
  }
  if (v.deadline === undefined) errors.push(missingField(`${path}.deadline`));
  else if (v.deadline !== null && !isTimestampMs(v.deadline)) errors.push(invalidField(`${path}.deadline`, 'invalid TimestampMs (or null for no deadline)'));
  if (v.consideration === undefined) errors.push(missingField(`${path}.consideration`));
  else if (!isJsonValue(v.consideration)) errors.push(invalidField(`${path}.consideration`, 'must be a JSON value (the structured terms; T047 owns the semantics)'));
  if (v.tenantId === undefined || !isTenantId(v.tenantId)) errors.push({ code: 'tenant_missing', path: `${path}.tenantId`, message: 'every capability request carries its owning tenant (L12)' });
  if (v.projectId === undefined || !isProjectId(v.projectId)) errors.push({ code: 'tenant_missing', path: `${path}.projectId`, message: 'every capability request carries its owning project (L12)' });
  if (v.requestedAt === undefined) errors.push(missingField(`${path}.requestedAt`));
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
  // Clone-then-freeze: the minted record NEVER aliases the caller's draft.
  const request: CapabilityRequest = deepFreeze(deepCloneJson({
    requestId: `cpr:${stableDigestJson(identityContent)}`,
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
 * exchange enforces the match laws (`quote_mismatch`).
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

/** The registry view of a provider declaration the quote-match law needs. */
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

/**
 * Collect-all validation of an untrusted provider-quote draft, minting
 * the content-addressed identity — the mirror of the REAL exchange's
 * quote-mint lane (the full law: the structural shape, the L16a label
 * scan, and the L12 scope; the match laws are `quoteMatchProblems`).
 */
export function validateProviderQuoteDraft(v: unknown): ProviderResult<ProviderQuote> {
  if (!isRecord(v)) return fail('invalid_type', 'the quote must be an object', 'quote');
  const errors: ProviderError[] = [];

  // L16a trip-wire: label FIELD keys anywhere in the quote's JSON tree.
  for (const labelPath of labelKeyPaths(v)) {
    errors.push({
      code: 'label_as_evidence',
      path: `quote.${labelPath}`,
      message: `field "${labelPath}" cites a profession/role label — labels alone never establish suitability (L16a)`,
    });
  }

  if (v.requestId === undefined) errors.push(missingField('quote.requestId'));
  else if (!isCapabilityRequestId(v.requestId)) errors.push(invalidField('quote.requestId', 'invalid CapabilityRequestId (cpr:<16-hex>)'));
  if (v.providerRef === undefined) errors.push(missingField('quote.providerRef'));
  else if (!isProviderRef(v.providerRef)) errors.push(invalidField('quote.providerRef', 'invalid ProviderRef (identifier pattern; a provider identity, never a qualification)'));
  if (v.offerRef === undefined) errors.push(missingField('quote.offerRef'));
  else if (!isNonEmptyString(v.offerRef)) errors.push(invalidField('quote.offerRef', 'must be a non-empty offer reference'));
  if (v.terms === undefined) errors.push(missingField('quote.terms'));
  else if (!isProviderTerms(v.terms)) errors.push(invalidField('quote.terms', 'failed the ProviderTerms shape (deliverableKind + NON-EMPTY verification contract + JSON consideration + estimatedDeliveryAt)'));
  if (v.quotedAt === undefined) errors.push(missingField('quote.quotedAt'));
  else if (!isTimestampMs(v.quotedAt)) errors.push(invalidField('quote.quotedAt', 'invalid TimestampMs (explicit instant — never a wall clock)'));
  if (v.tenantId === undefined || !isTenantId(v.tenantId)) errors.push({ code: 'tenant_missing', path: 'quote.tenantId', message: 'every quote carries its owning tenant (L12)' });
  if (v.projectId === undefined || !isProjectId(v.projectId)) errors.push({ code: 'tenant_missing', path: 'quote.projectId', message: 'every quote carries its owning project (L12)' });

  if (errors.length > 0) return { ok: false, errors };
  const draft = v as unknown as Omit<ProviderQuote, 'quoteId'>;
  const identityContent = {
    requestId: draft.requestId,
    providerRef: draft.providerRef,
    offerRef: draft.offerRef,
    terms: draft.terms,
    quotedAt: draft.quotedAt,
    tenantId: draft.tenantId,
    projectId: draft.projectId,
  };
  // Clone-then-freeze (the minted record never aliases the caller's draft).
  const quote: ProviderQuote = deepFreeze(deepCloneJson({
    quoteId: `qte:${stableDigestJson(identityContent)}`,
    ...identityContent,
  } as unknown as JsonValue) as unknown as ProviderQuote);
  if (!isProviderQuote(quote)) {
    return fail('invalid_field', 'the minted quote failed its own structural guard', 'quote');
  }
  return ok(quote);
}

// ---------------------------------------------------------------------------
// The engagement lifecycle vocabulary
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
 * at open time. Content-addressed (`eng:`).
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
 * assertion (L16a: a claim without evidence is a label).
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
 * content digest. Content-addressed (`dlv:`).
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
  /** The opaque provider payload — UNTRUSTED; pinned by `payloadDigest`. */
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
  const errors: ProviderError[] = [];

  for (const labelPath of labelKeyPaths(v)) {
    errors.push({
      code: 'label_as_evidence',
      path: `${path}.${labelPath}`,
      message: `field "${labelPath}" cites a profession/role label — labels alone never establish suitability (L16a)`,
    });
  }

  if (v.engagementId === undefined) errors.push(missingField(`${path}.engagementId`));
  else if (!isEngagementId(v.engagementId)) errors.push(invalidField(`${path}.engagementId`, 'invalid EngagementId'));
  if (v.kind === undefined) errors.push(missingField(`${path}.kind`));
  else if (!isDeliverableKind(v.kind)) errors.push(invalidField(`${path}.kind`, `must be one of ${DELIVERABLE_KINDS.join(' | ')}`));
  if (v.claims === undefined) errors.push(missingField(`${path}.claims`));
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
  if (v.payload === undefined) errors.push(missingField(`${path}.payload`));
  else if (!isJsonValue(v.payload)) errors.push(invalidField(`${path}.payload`, 'must be a JSON value (the opaque untrusted payload)'));
  if (v.payloadDigest === undefined) errors.push(missingField(`${path}.payloadDigest`));
  else if (typeof v.payloadDigest !== 'string' || !/^[0-9a-f]{16}$/.test(v.payloadDigest)) {
    errors.push(invalidField(`${path}.payloadDigest`, 'must be a 16-hex stable digest of the payload'));
  }
  if (v.submittedAt === undefined) errors.push(missingField(`${path}.submittedAt`));
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
    deliverableId: `dlv:${stableDigestJson(identityContent)}`,
  } as unknown as JsonValue) as unknown as Deliverable);
  if (!isDeliverable(deliverable)) {
    return fail('invalid_field', 'the minted deliverable failed its own structural guard', path);
  }
  return ok(deliverable);
}
