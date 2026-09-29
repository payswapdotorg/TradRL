/**
 * @tradrl/skills — the certification record (certified | rejected).
 *
 * THE LAW THIS MODULE SERVES: Work Order T017 — "`CertificationRecord` —
 * the (candidate, evaluation-verdict-ref, compatibility-verdict-ref) ->
 * certified|rejected record with structured reasons; certification is
 * append-only."
 *
 * And the L3 law (the existential law): "a certified BodyVersion NEVER
 * mutates — the forge MINTS new versions; any API that could mutate a
 * certified version is a typed error (negative test). A forged candidate
 * is a distinct record kind until certified." Concretely here:
 * certification is TERMINAL per candidate — a second certification record
 * for an already-certified candidate is the typed error
 * `certified_version_mutation`, and a certified candidate can only move
 * forward by minting a NEW version (a new candidate) through the forge.
 *
 * Spec anchors:
 * - spec/LEARNING-LOOP.md — "Body Version -> compatibility -> shadow": a
 *   forged body version is a CANDIDATE until evaluation says otherwise;
 *   the certification record is the gate between the two.
 * - spec/ARCHITECTURE-LOCK.md L3 (certified versions never mutate), L7
 *   (constraint-aware evaluation — the verdict refs are the acceptance
 *   evidence), L9 (full lineage), L11 (append-only discipline), L12
 *   (tenant/project scope).
 * - spec/CAPABILITY-DISCOVERY.md Reproducibility — "Record candidate
 *   roles, bodies, ... and outcomes and rejected candidates": rejected
 *   certifications are RETAINED with structured reasons, never dropped.
 *
 * MIRROR DISCIPLINE (D-003/D-004): the evaluation verdict reference
 * mirrors @tradrl/evaluation's `VerdictId` (same brand tag); the
 * compatibility verdict reference is an opaque reference into the
 * compatibility testing run records (T003 compatibility shapes + T012
 * release gates); the candidate reference is a canonical agent-body
 * BodyVersion-shaped ref. No lane is imported; trip wires live in
 * interop.test.ts.
 */

import {
  type BodyVersionRef,
  type CapabilityGapId,
  type CertificationRecordId,
  type CompatibilityVerdictRef,
  type EvidenceRef,
  type ForgeVersionRef,
  type ProjectId,
  type TenantId,
  type TimestampMs,
  type VerdictId,
  deepCloneJson,
  deepFreeze,
  isArrayOf,
  isBodyVersionRef,
  isCapabilityGapId,
  isCertificationRecordId,
  isCompatibilityVerdictRef,
  isEvidenceRef,
  isForgeVersionRef,
  isMemberOf,
  isNonEmptyString,
  isProjectId,
  isRecord,
  isTenantId,
  isTimestampMs,
  isVerdictId,
} from './primitives';
import { type SkillError, type SkillResult, fail, invalidField, invalidType, missingField, ok } from './errors';

// ---------------------------------------------------------------------------
// The decision vocabulary
// ---------------------------------------------------------------------------

/** The closed certification decision vocabulary. */
export const CERTIFICATION_DECISIONS = ['certified', 'rejected'] as const;

/** One certification decision: `certified` or `rejected` (with structured reasons). */
export type CertificationDecision = (typeof CERTIFICATION_DECISIONS)[number];

/** Guard: `CertificationDecision`. */
export function isCertificationDecision(v: unknown): v is CertificationDecision {
  return isMemberOf(CERTIFICATION_DECISIONS, v);
}

/**
 * The closed structured-reason vocabulary. REJECTION reasons are the
 * machine-checkable refusals; ACCEPTANCE reasons record WHY the gate
 * passed (an unexplained acceptance is not an auditable record — the
 * mirror of the experiments lane's "an unexplained failure is not an
 * auditable record").
 */
export const CERTIFICATION_REASON_CODES = [
  /** Acceptance reason: the evaluation verdict is attained. */
  'evaluation_attained',
  /** Acceptance reason: the compatibility verdict is satisfied. */
  'compatibility_satisfied',
  /** Rejection reason: the evaluation verdict is NOT attained. */
  'evaluation_not_attained',
  /** Rejection reason: the compatibility verdict is NOT satisfied. */
  'compatibility_fail',
  /** Rejection reason: no passing substitution test is recorded for the candidate. */
  'no_passing_substitution_test',
  /** Rejection reason: the candidate record itself is invalid. */
  'invalid_candidate',
] as const;

/** One structured certification reason. */
export type CertificationReasonCode = (typeof CERTIFICATION_REASON_CODES)[number];

/** Guard: `CertificationReasonCode`. */
export function isCertificationReasonCode(v: unknown): v is CertificationReasonCode {
  return isMemberOf(CERTIFICATION_REASON_CODES, v);
}

/** One structured reason carried by a certification record. */
export interface CertificationReason {
  /** The reason code. */
  readonly code: CertificationReasonCode;
  /** Human-readable explanation of the reason. */
  readonly message: string;
}

/** Guard: `CertificationReason`. */
export function isCertificationReason(v: unknown): v is CertificationReason {
  if (!isRecord(v)) return false;
  return isCertificationReasonCode(v.code) && isNonEmptyString(v.message);
}

// ---------------------------------------------------------------------------
// Lineage (L9 — full lineage on every certification)
// ---------------------------------------------------------------------------

/**
 * The L9 lineage block of a certification record: the candidate's parent
 * version ref, the evidence capsules, the typed gaps the candidate
 * addresses, the forge version, the seed, and the tenant/project scope
 * (L12). Missing pieces are `lineage_gap` / `tenant_missing` typed errors.
 */
export interface CertificationLineage {
  /** The candidate's parent BodyVersion (canonical ref). */
  readonly parentVersionRef: BodyVersionRef;
  /** Evidence-capsule references backing the certification decision. */
  readonly evidenceRefs: readonly EvidenceRef[];
  /** The typed capability gaps the certified candidate addresses. */
  readonly gapRefs: readonly CapabilityGapId[];
  /** The body-forge version that minted the candidate (lineage participant, L9). */
  readonly forgeVersion: ForgeVersionRef;
  /** The forge seed — the ONLY randomness input (the determinism law). */
  readonly seed: string;
  /** Owning tenant (L12). */
  readonly tenantId: TenantId;
  /** Owning project (L12). */
  readonly projectId: ProjectId;
}

/** Guard: `CertificationLineage`. */
export function isCertificationLineage(v: unknown): v is CertificationLineage {
  if (!isRecord(v)) return false;
  return (
    isBodyVersionRef(v.parentVersionRef) &&
    isArrayOf(v.evidenceRefs, isEvidenceRef) &&
    isArrayOf(v.gapRefs, isCapabilityGapId) &&
    isForgeVersionRef(v.forgeVersion) &&
    isNonEmptyString(v.seed) &&
    isTenantId(v.tenantId) &&
    isProjectId(v.projectId)
  );
}

// ---------------------------------------------------------------------------
// The decision input + the decision compilation (pure, fail-closed)
// ---------------------------------------------------------------------------

/**
 * The decision inputs: the candidate ref plus the two verdict references
 * the decision cites — the evaluation verdict (T012 attainment) and the
 * compatibility verdict (the substrate-compatibility testing outcome) —
 * with their outcomes, and whether a PASSING substitution test is recorded
 * (agent-body's certification precondition, mirrored: a certified body
 * must be possessable). Everything is caller-declared data; this module
 * compiles the decision, it never invents outcomes.
 */
export interface CertificationDecisionInput {
  /** The forged candidate's canonical ref (`${bodyId}@${semver}`). */
  readonly candidateRef: BodyVersionRef;
  /** The evaluation verdict's identity (T012 lane mirror). */
  readonly evaluationVerdictRef: VerdictId;
  /** The evaluation verdict's attained flag. */
  readonly evaluationAttained: boolean;
  /** The compatibility verdict's opaque reference. */
  readonly compatibilityVerdictRef: CompatibilityVerdictRef;
  /** The compatibility verdict's satisfied flag. */
  readonly compatibilitySatisfied: boolean;
  /** Whether a `pass` substitution test is recorded for the candidate (agent-body certification law). */
  readonly hasPassingSubstitutionTest: boolean;
}

/** Guard: `CertificationDecisionInput`. */
export function isCertificationDecisionInput(v: unknown): v is CertificationDecisionInput {
  if (!isRecord(v)) return false;
  return (
    isBodyVersionRef(v.candidateRef) &&
    isVerdictId(v.evaluationVerdictRef) &&
    typeof v.evaluationAttained === 'boolean' &&
    isCompatibilityVerdictRef(v.compatibilityVerdictRef) &&
    typeof v.compatibilitySatisfied === 'boolean' &&
    typeof v.hasPassingSubstitutionTest === 'boolean'
  );
}

/**
 * Compiles the certification decision (PURE, fail-closed): `certified`
 * ONLY when the evaluation verdict is attained AND the compatibility
 * verdict is satisfied AND a passing substitution test is recorded; every
 * refusal carries its structured reason(s). Rejections are RETAINED by
 * the caller with these reasons — never dropped (L11's spirit).
 */
export function decideCertification(input: CertificationDecisionInput): {
  readonly decision: CertificationDecision;
  readonly reasons: readonly CertificationReason[];
} {
  const reasons: CertificationReason[] = [];
  if (input.evaluationAttained) {
    reasons.push({
      code: 'evaluation_attained',
      message: `the evaluation verdict "${input.evaluationVerdictRef}" is attained — every criterion attained in every split with no limitations`,
    });
  } else {
    reasons.push({
      code: 'evaluation_not_attained',
      message: `the evaluation verdict "${input.evaluationVerdictRef}" is NOT attained — a candidate is certified only when evaluation says so (spec/LEARNING-LOOP.md "Body Version -> compatibility -> shadow")`,
    });
  }
  if (input.compatibilitySatisfied) {
    reasons.push({
      code: 'compatibility_satisfied',
      message: `the compatibility verdict "${input.compatibilityVerdictRef}" is satisfied — the candidate's substrate-compatibility refs pass the agent-body mirror shapes`,
    });
  } else {
    reasons.push({
      code: 'compatibility_fail',
      message: `the compatibility verdict "${input.compatibilityVerdictRef}" is NOT satisfied — minting/ certifying a body whose substrate compatibility fails is a typed error (L2: a model upgrade triggers compatibility testing, not body redevelopment)`,
    });
  }
  if (!input.hasPassingSubstitutionTest) {
    reasons.push({
      code: 'no_passing_substitution_test',
      message: 'no passing substitution test is recorded for the candidate — a certified body must be possessable (agent-body certification precondition)',
    });
  }
  const certified =
    input.evaluationAttained && input.compatibilitySatisfied && input.hasPassingSubstitutionTest;
  return { decision: certified ? 'certified' : 'rejected', reasons };
}

// ---------------------------------------------------------------------------
// CertificationRecord
// ---------------------------------------------------------------------------

/**
 * The certification record: the (candidate, evaluation-verdict-ref,
 * compatibility-verdict-ref) -> certified|rejected decision with
 * structured reasons and the full L9/L12 lineage. Certification is
 * APPEND-ONLY: the log-level validation (`validateCertificationLog`)
 * makes re-deciding an already-certified candidate the typed error
 * `certified_version_mutation` (L3 — certification is terminal; the only
 * way forward is a NEW forged candidate).
 */
export interface CertificationRecord {
  /** Certification identity. */
  readonly certificationId: CertificationRecordId;
  /** The candidate this record decides (canonical `${bodyId}@${semver}`). */
  readonly candidateRef: BodyVersionRef;
  /** The decision. */
  readonly decision: CertificationDecision;
  /** The evaluation verdict reference (T012 lane mirror). */
  readonly evaluationVerdictRef: VerdictId;
  /** The compatibility verdict reference. */
  readonly compatibilityVerdictRef: CompatibilityVerdictRef;
  /** Structured reasons (non-empty: an unexplained decision is not an auditable record). */
  readonly reasons: readonly CertificationReason[];
  /** Who certified (person, service or pipeline). */
  readonly certifiedBy: string;
  /** Explicit decision instant (epoch ms — carried, never read from a clock). */
  readonly certifiedAt: TimestampMs;
  /** The L9/L12 lineage block. */
  readonly lineage: CertificationLineage;
}

/** Guard: `CertificationRecord` (structural). */
export function isCertificationRecord(v: unknown): v is CertificationRecord {
  if (!isRecord(v)) return false;
  return (
    isCertificationRecordId(v.certificationId) &&
    isBodyVersionRef(v.candidateRef) &&
    isCertificationDecision(v.decision) &&
    isVerdictId(v.evaluationVerdictRef) &&
    isCompatibilityVerdictRef(v.compatibilityVerdictRef) &&
    Array.isArray(v.reasons) &&
    v.reasons.length > 0 &&
    isArrayOf(v.reasons, isCertificationReason) &&
    isNonEmptyString(v.certifiedBy) &&
    isTimestampMs(v.certifiedAt) &&
    isCertificationLineage(v.lineage)
  );
}

/**
 * Collect-all validation of an untrusted certification record: structural
 * shape, non-empty structured reasons, the L12 scope, and the L9 lineage
 * block. On success the value is returned narrowed and deeply frozen.
 */
export function validateCertificationRecord(v: unknown, path = 'certification'): SkillResult<CertificationRecord> {
  if (!isRecord(v)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: SkillError[] = [];
  if (v.certificationId === undefined) {
    errors.push(missingField(`${path}.certificationId`));
  } else if (!isCertificationRecordId(v.certificationId)) {
    errors.push(invalidField(`${path}.certificationId`, 'invalid CertificationRecordId'));
  }
  if (v.candidateRef === undefined) {
    errors.push(missingField(`${path}.candidateRef`));
  } else if (!isBodyVersionRef(v.candidateRef)) {
    errors.push(invalidField(`${path}.candidateRef`, 'invalid canonical BodyVersionRef'));
  }
  if (v.decision === undefined) {
    errors.push(missingField(`${path}.decision`));
  } else if (!isCertificationDecision(v.decision)) {
    errors.push(invalidField(`${path}.decision`, `must be one of ${CERTIFICATION_DECISIONS.join(' | ')}`));
  }
  if (v.evaluationVerdictRef === undefined) {
    errors.push(missingField(`${path}.evaluationVerdictRef`));
  } else if (!isVerdictId(v.evaluationVerdictRef)) {
    errors.push(invalidField(`${path}.evaluationVerdictRef`, 'invalid VerdictId (evaluation-lane mirror)'));
  }
  if (v.compatibilityVerdictRef === undefined) {
    errors.push(missingField(`${path}.compatibilityVerdictRef`));
  } else if (!isCompatibilityVerdictRef(v.compatibilityVerdictRef)) {
    errors.push(invalidField(`${path}.compatibilityVerdictRef`, 'invalid CompatibilityVerdictRef'));
  }
  if (v.reasons === undefined) {
    errors.push(missingField(`${path}.reasons`));
    errors.push({
      code: 'evidence_missing',
      path: `${path}.reasons`,
      message: 'an unexplained certification decision is not an auditable record — structured reasons are required (non-empty)',
    });
  } else if (!Array.isArray(v.reasons) || v.reasons.length === 0) {
    errors.push({
      code: 'evidence_missing',
      path: `${path}.reasons`,
      message: 'an unexplained certification decision is not an auditable record — structured reasons are required (non-empty)',
    });
  } else if (!isArrayOf(v.reasons, isCertificationReason)) {
    errors.push(invalidField(`${path}.reasons`, 'every entry must be a valid CertificationReason'));
  }
  if (v.certifiedBy === undefined || !isNonEmptyString(v.certifiedBy)) {
    errors.push(invalidField(`${path}.certifiedBy`, 'must be a non-empty certifying authority (person, service or pipeline)'));
  }
  if (v.certifiedAt === undefined) {
    errors.push(missingField(`${path}.certifiedAt`));
  } else if (!isTimestampMs(v.certifiedAt)) {
    errors.push(invalidField(`${path}.certifiedAt`, 'invalid TimestampMs (explicit instant — never a wall clock)'));
  }
  if (v.lineage === undefined) {
    errors.push(missingField(`${path}.lineage`));
    errors.push({
      code: 'lineage_gap',
      path: `${path}.lineage`,
      message: 'every certification record carries its full L9 lineage block (parent version ref, evidence refs, gap refs, forge version, seed) and L12 scope',
    });
  } else if (!isCertificationLineage(v.lineage)) {
    const lineagePath = `${path}.lineage`;
    if (!isRecord(v.lineage)) {
      errors.push(invalidField(lineagePath, 'must be an object'));
    } else {
      if (!isBodyVersionRef(v.lineage.parentVersionRef)) {
        errors.push(invalidField(`${lineagePath}.parentVersionRef`, 'invalid canonical BodyVersionRef (the candidate\'s parent)'));
      }
      if (!isForgeVersionRef(v.lineage.forgeVersion)) {
        errors.push(invalidField(`${lineagePath}.forgeVersion`, 'invalid ForgeVersionRef (L9: the forge version is a lineage participant)'));
      }
      if (typeof v.lineage.seed !== 'string' || v.lineage.seed.trim().length === 0) {
        errors.push({
          code: 'unseeded_forge',
          path: `${lineagePath}.seed`,
          message: 'the certification lineage must carry the forge seed — there is no ambient randomness (the determinism law)',
        });
      }
      if (v.lineage.tenantId === undefined || !isTenantId(v.lineage.tenantId)) {
        errors.push({ code: 'tenant_missing', path: `${lineagePath}.tenantId`, message: 'every certification record carries its owning tenant (L12)' });
      }
      if (v.lineage.projectId === undefined || !isProjectId(v.lineage.projectId)) {
        errors.push({ code: 'tenant_missing', path: `${lineagePath}.projectId`, message: 'every certification record carries its owning project (L12)' });
      }
      if (!isArrayOf(v.lineage.evidenceRefs, isEvidenceRef)) {
        errors.push(invalidField(`${lineagePath}.evidenceRefs`, 'must be an array of evidence-capsule references'));
      }
      if (!isArrayOf(v.lineage.gapRefs, isCapabilityGapId)) {
        errors.push(invalidField(`${lineagePath}.gapRefs`, 'must be an array of capability-gap ids'));
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: deepFreeze(deepCloneJson(v) as unknown as CertificationRecord) };
}

/**
 * Constructs a deeply frozen `CertificationRecord` from the decision
 * inputs: compiles the decision (`decideCertification`, pure fail-closed),
 * then validates the full record law. Throws `TypeError` on invalid input.
 * Both parameters are untrusted values — the record draft (everything
 * except the computed decision/reasons) and the decision input.
 */
export function createCertificationRecord(record: unknown, decisionInput: unknown): CertificationRecord {
  if (!isCertificationDecisionInput(decisionInput)) {
    throw new TypeError(
      'createCertificationRecord: decision input failed the CertificationDecisionInput guard (candidate + verdict refs + outcomes)',
    );
  }
  const { decision, reasons } = decideCertification(decisionInput);
  const full = isRecord(record) ? { ...record, decision, reasons } : { decision, reasons };
  const result = validateCertificationRecord(full);
  if (!result.ok) {
    const problems = result.errors.map((e) => `(${e.code}) ${e.path}: ${e.message}`);
    throw new TypeError(`createCertificationRecord: ${problems.join('; ')}`);
  }
  return result.value;
}

// ---------------------------------------------------------------------------
// The append-only certification log (L3 + L11)
// ---------------------------------------------------------------------------

/**
 * Validates the append-only certification log:
 * - every record passes the full record law;
 * - certification ids are unique;
 * - ONE decision per candidate: a second record for the same candidate is
 *   `certification_conflict` in general, and the L3 typed error
 *   `certified_version_mutation` when the prior decision was `certified`
 *   (certification is terminal — the only way forward is a NEW candidate);
 * - every record shares one tenant/project scope (L12).
 */
export function validateCertificationLog(v: unknown, path = 'certificationLog'): SkillResult<readonly CertificationRecord[]> {
  if (!Array.isArray(v)) {
    return { ok: false, errors: [invalidType(`${path} must be an array of certification records (append-only)`)] };
  }
  const errors: SkillError[] = [];
  const seenIds = new Set<string>();
  const decidedCandidates = new Map<string, CertificationDecision>();
  const records: CertificationRecord[] = [];
  v.forEach((record, index) => {
    const result = validateCertificationRecord(record, `${path}[${index}]`);
    if (!result.ok) {
      errors.push(...result.errors);
      return;
    }
    const certified = result.value;
    if (seenIds.has(certified.certificationId)) {
      errors.push({
        code: 'duplicate_record',
        path: `${path}[${index}].certificationId`,
        message: `duplicate certification id "${certified.certificationId}"`,
      });
    } else {
      seenIds.add(certified.certificationId);
    }
    const priorDecision = decidedCandidates.get(certified.candidateRef);
    if (priorDecision !== undefined) {
      // Certification is append-only and TERMINAL per candidate: re-deciding
      // an already-decided candidate is a conflict; re-deciding a CERTIFIED
      // candidate is the L3 existential error (certified versions never
      // mutate — the only way forward is a NEW forged candidate).
      errors.push(
        priorDecision === 'certified'
          ? {
              code: 'certified_version_mutation',
              path: `${path}[${index}].candidateRef`,
              message: `candidate "${certified.candidateRef}" is already certified — certification is terminal; the only forward path is minting a NEW BodyVersion through the forge (L3: certified versions never mutate)`,
            }
          : {
              code: 'certification_conflict',
              path: `${path}[${index}].candidateRef`,
              message: `candidate "${certified.candidateRef}" is already decided ("${priorDecision}") — one certification record per candidate (append-only); re-attempts mint new candidates`,
            },
      );
    } else {
      decidedCandidates.set(certified.candidateRef, certified.decision);
    }
    records.push(certified);
  });
  // L12: one tenant/project scope across the whole log.
  const scope = records[0]?.lineage;
  if (scope !== undefined) {
    for (let index = 1; index < records.length; index += 1) {
      const record = records[index] as CertificationRecord;
      if (record.lineage.tenantId !== scope.tenantId || record.lineage.projectId !== scope.projectId) {
        errors.push({
          code: 'tenant_mismatch',
          path: `${path}[${index}].lineage`,
          message: `certification records must share one tenant/project scope (L12) — record ${index} carries "${record.lineage.tenantId}"/"${record.lineage.projectId}" but the log scope is "${scope.tenantId}"/"${scope.projectId}"`,
        });
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: deepFreeze([...records]) };
}

/**
 * APPENDS one certification record to a log — the ONLY sanctioned way a
 * log grows. Returns a NEW frozen log (the input log is never mutated);
 * refuses when the record would violate the append-only law
 * (`certified_version_mutation` / `certification_conflict` /
 * `duplicate_record` / `tenant_mismatch`).
 */
export function appendCertificationRecord(
  log: readonly CertificationRecord[],
  record: CertificationRecord,
): SkillResult<readonly CertificationRecord[]> {
  const recordResult = validateCertificationRecord(record, 'record');
  if (!recordResult.ok) return recordResult;
  const validated = recordResult.value;
  const prior = log.find((entry) => entry.candidateRef === validated.candidateRef);
  if (prior !== undefined) {
    return prior.decision === 'certified'
      ? fail(
          'certified_version_mutation',
          `candidate "${validated.candidateRef}" is already certified — certification is terminal; the only forward path is minting a NEW BodyVersion through the forge (L3: certified versions never mutate)`,
          'candidateRef',
        )
      : fail(
          'certification_conflict',
          `candidate "${validated.candidateRef}" is already decided ("${prior.decision}") — one certification record per candidate (append-only); re-attempts mint new candidates`,
          'candidateRef',
        );
  }
  const duplicateId = log.find((entry) => entry.certificationId === validated.certificationId);
  if (duplicateId !== undefined) {
    return fail('duplicate_record', `duplicate certification id "${validated.certificationId}"`, 'certificationId');
  }
  const scope = log[0];
  if (scope !== undefined && (validated.lineage.tenantId !== scope.lineage.tenantId || validated.lineage.projectId !== scope.lineage.projectId)) {
    return fail(
      'tenant_mismatch',
      `certification records must share one tenant/project scope (L12) — the new record carries "${validated.lineage.tenantId}"/"${validated.lineage.projectId}" but the log scope is "${scope.lineage.tenantId}"/"${scope.lineage.projectId}"`,
      'lineage',
    );
  }
  return { ok: true, value: deepFreeze([...log, validated]) };
}
