// @tradrl/capability-provider — the provider DECLARATION: what an
// external capability provider (a human expert, a specialist firm, a
// T046 arena adapter, a T047 marketplace vendor) declares it offers.
//
// THE LAWS THIS MODULE SERVES:
// - L16a ("labels alone never establish suitability",
//   spec/CAPABILITY-DISCOVERY.md "Never equate model and profession"):
//   every offered capability carries a NON-EMPTY list of MEASURED
//   evidence (the T017 union: benchmark | measurement-record |
//   result-ref); a profession/role label key anywhere in the declaration
//   is the typed `label_as_evidence` violation and fails the structural
//   guard outright. L19: no professional-qualification inference — a
//   provider is identified by its reference + measured capability
//   contracts, never by what it claims to BE.
// - The T017 capability language: an offer names a `CapabilityKey` (a
//   capability CONTRACT), the deliverable kinds it produces, and the
//   verification kinds it accepts (spec/ADAPTERS.md "Human expertise":
//   Arena is ONE optional capability provider — the declaration shape
//   is provider-neutral so any external source plugs in identically).
// - Versioned, immutable, append-only (the L3 discipline): re-declaring
//   a provider MINTS a new declaration version that supersedes the prior
//   one — a declaration never mutates in place; the exchange's registry
//   keeps the supersede history (chain-verified).
// - L12: a declaration is registered within a tenant/project scope; L4:
//   the declared instant is explicit (never a wall clock).
// - L18 ("human artifacts localizable"): the declaration travels with
//   the applicability scope its offers were validated under, so an
//   imported artifact carries its scope forward into the local import.

import { deepCloneJson, deepFreeze, isArrayOf, isNonEmptyString, isPositiveInteger, isRecord, isTimestampMs } from './primitives';
import type { JsonValue, TimestampMs } from './primitives';
import type { ProviderResult, ProviderError } from './errors';
import { fail, failures, invalidField, invalidType, missingField, ok } from './errors';
import {
  isCapabilityKey,
  isProviderDeclarationId,
  isProviderRef,
  isProjectId,
  isTenantId,
  deriveProviderDeclarationId,
} from './ids';
import type { ProviderDeclarationId, ProviderRef, ProjectId, TenantId, CapabilityKey } from './ids';
import {
  isMeasuredEvidenceMirror,
  isSkillApplicabilityMirror,
  labelKeyPaths,
} from './mirrors';
import type { MeasuredEvidenceMirror, SkillApplicabilityMirror } from './mirrors';
import { DELIVERABLE_KINDS, isDeliverableKind } from './engagement';
import type { DeliverableKind } from './engagement';
import { VERIFICATION_KINDS, isVerificationKind } from './verification';
import type { VerificationKind } from './verification';

// ---------------------------------------------------------------------------
// The provider capability offer
// ---------------------------------------------------------------------------

/**
 * ONE offered capability: the capability contract it serves (never a
 * profession label — L16a), what it does, the NON-EMPTY measured
 * evidence backing the offer, the applicability scope (opaque refs),
 * the deliverable kinds this offer produces (spec/ADAPTERS.md's
 * vocabulary), and the verification kinds this offer accepts (a quote
 * against a request whose verification uses an unaccepted kind is the
 * typed `quote_mismatch` — the provider cannot be surprised by a
 * verification regime it did not declare).
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

// ---------------------------------------------------------------------------
// The provider declaration (versioned, immutable)
// ---------------------------------------------------------------------------

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

/**
 * The declaration draft — everything EXCEPT the derived identity (the
 * content-addressed `declarationId` is minted by validation; supplying
 * it is unnecessary, and the mint is deterministic).
 */
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
 * the FULL law: structural shape, the L16a label trip-wire (label field
 * keys anywhere), the MEASURED-evidence law (non-empty per offer), the
 * non-empty offer list with unique `offerRef`s, version sanity, and the
 * L12 tenant/project law. On success the value is returned narrowed and
 * deeply frozen, with the content-addressed `declarationId` minted.
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

  if (errors.length > 0) return failures(errors);
  const draft = v as unknown as ProviderDeclarationDraft;
  const identityContent = declarationIdentityContent(draft);
  const declaration: ProviderDeclaration = deepFreeze(deepCloneJson({
    declarationId: deriveProviderDeclarationId(identityContent),
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

/**
 * The identity content of a declaration — everything EXCEPT the derived
 * id (the content-addressed mint input; byte-deterministic).
 */
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

/**
 * Constructs a deeply frozen `ProviderDeclaration`, running the FULL
 * validation law first (collect-all). Throws `TypeError` on invalid
 * input. This is the ONLY sanctioned constructor for declarations.
 */
export function createProviderDeclaration(draft: unknown): ProviderDeclaration {
  const result = validateProviderDeclaration(draft);
  if (!result.ok) {
    const problems = result.errors.map((e) => `(${e.code}) ${e.path}: ${e.message}`);
    throw new TypeError(`createProviderDeclaration: ${problems.join('; ')}`);
  }
  return result.value;
}

/**
 * The supersede law: mints the NEXT declaration version over a prior
 * one — version + 1, supersedes = the prior id, declaredAt must not
 * predate the prior declaration (L4). Pure: never touches the prior
 * record (L3 — declarations are immutable; supersede MINTS).
 */
export function supersedeProviderDeclaration(
  prior: ProviderDeclaration,
  next: { readonly displayName: string; readonly offers: readonly ProviderCapabilityOffer[]; readonly declaredAt: number },
): ProviderResult<ProviderDeclaration> {
  if (!isProviderDeclaration(prior)) return fail('invalid_type', 'the prior declaration is not a valid ProviderDeclaration', 'prior');
  if (next.declaredAt < prior.declaredAt) {
    return fail('l4_boundary_violation', `the superseding declaration instant (${next.declaredAt}) predates the prior declaration (${prior.declaredAt}) — history never runs backwards`, 'next.declaredAt');
  }
  return validateProviderDeclaration({
    providerRef: prior.providerRef,
    displayName: next.displayName,
    offers: next.offers,
    version: prior.version + 1,
    supersedes: prior.declarationId,
    declaredAt: next.declaredAt,
    tenantId: prior.tenantId,
    projectId: prior.projectId,
  });
}
