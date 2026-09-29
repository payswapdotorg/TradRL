/**
 * @tradrl/skills — the evidence-backed skill record.
 *
 * THE LAW THIS MODULE SERVES: Work Order T017, Law "Skill extraction is
 * EVIDENCE-BACKED" — VERBATIM: "a SkillRecord cites its provenance
 * (trajectory refs, experiment refs, trial refs, attainment evidence refs —
 * mirrors); a skill claim with no evidence citation fails validation
 * (negative test). Skills are extracted FROM recorded experience — never
 * invented."
 *
 * Spec anchors:
 * - spec/LEARNING-LOOP.md — the loop's back half is this lane's:
 *   "failure analysis -> skill extraction -> Body Version -> compatibility
 *   -> shadow -> outcome -> next experiment"; "Failure-driven learning"
 *   (typed CapabilityGaps); "Human augmentation" (Arena OPTIONAL —
 *   imported expertise is locally versioned and validated, and enters as
 *   ordinary validated SkillRecords).
 * - spec/CAPABILITY-DISCOVERY.md — "Search reusable Skills and Agent
 *   Bodies" (step 4 — this record is the reusable skill); "Never equate
 *   model and profession" (L16a); Reproducibility — "Record candidate
 *   roles, bodies, models, benchmarks, datasets, configuration, cost,
 *   latency, environment, outcomes and rejected candidates."
 * - spec/ARCHITECTURE-LOCK.md L9 (reproducible lineage — the full lineage
 *   block below), L11 (search history retained), L12 (tenant/project on
 *   every record), L16a (labels never establish suitability), L18 (human
 *   artifacts localizable — imported expertise enters as ordinary
 *   validated SkillRecords).
 *
 * MIRROR DISCIPLINE (D-003/D-004): the capability descriptor's measured
 * evidence re-declares @tradrl/agent-body capability-registry's
 * `MeasuredEvidence` union (benchmark | measurement-record | result-ref)
 * field-for-field — mutually assignable at compile time (plain shapes,
 * string-keyed kinds). The provenance refs mirror @tradrl/trajectory
 * (TrajectoryId), @tradrl/experiments (ExperimentId/TrialId) and
 * @tradrl/evaluation (VerdictId / AttainmentEvidenceRef) brand tags. The
 * applicability refs mirror @tradrl/agent-body's
 * EnvironmentProfileRef. This package never imports those lanes; the trip
 * wires live in interop.test.ts.
 */

import {
  type AttainmentEvidenceRef,
  type CapabilityGapId,
  type CapabilityKey,
  type EnvironmentProfileRef,
  type EvidenceRef,
  type ExperimentId,
  type ExtractionVersionRef,
  type InstrumentClassRef,
  type JsonValue,
  type ProjectId,
  type SkillArtifactRef,
  type SkillRecordId,
  type TenantId,
  type TimestampMs,
  type TrajectoryId,
  type TrialId,
  canonicalJson,
  deepCloneJson,
  deepFreeze,
  isArrayOf,
  isAttainmentEvidenceRef,
  isCapabilityGapId,
  isCapabilityKey,
  isEnvironmentProfileRef,
  isEvidenceRef,
  isExperimentId,
  isExtractionVersionRef,
  isInstrumentClassRef,
  isMemberOf,
  isNonEmptyString,
  isNonNegativeInteger,
  isPositiveInteger,
  isProjectId,
  isRecord,
  isSkillArtifactRef,
  isSkillRecordId,
  isTenantId,
  isTimestampMs,
  isTrajectoryId,
  isTrialId,
} from './primitives';
import { type SkillError, type SkillResult, invalidField, invalidType, missingField, ok } from './errors';

// ---------------------------------------------------------------------------
// L16a trip-wire vocabulary: label keys NEVER establish suitability
// ---------------------------------------------------------------------------

/**
 * The closed set of field names that make a record cite a PROFESSION/ROLE
 * LABEL — the L16a / "Never equate model and profession" trip-wire,
 * mirrored from @tradrl/agent-body capability-registry's
 * `LABEL_EVIDENCE_KEYS` (same seven keys, same law). A skill record (or any
 * nested object within it) carrying one of these keys fails validation
 * with `label_as_evidence` and fails the structural guard outright:
 * `model -> mathematician` is not an evidence-backed architectural rule
 * (spec/CAPABILITY-DISCOVERY.md).
 */
export const LABEL_EVIDENCE_KEYS = [
  'label',
  'roleLabel',
  'profession',
  'role',
  'title',
  'jobTitle',
  'vocation',
] as const;

/** A label-suspect field name. */
export type LabelEvidenceKey = (typeof LABEL_EVIDENCE_KEYS)[number];

/** Guard: `LabelEvidenceKey`. */
export function isLabelEvidenceKey(v: unknown): v is LabelEvidenceKey {
  return isMemberOf(LABEL_EVIDENCE_KEYS, v);
}

/**
 * Walks a JSON value and returns the dotted paths of every object key in
 * {@link LABEL_EVIDENCE_KEYS} it finds (breadth-limited to JSON data).
 * Pure; used by the guard and the validator to make label smuggling a
 * machine-detected, typed violation (mirror of the registry's
 * `labelKeyPaths`).
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
    if (isLabelEvidenceKey(key)) found.push(prefix === '' ? key : `${prefix}.${key}`);
    for (const path of labelKeyPaths(value[key], prefix === '' ? key : `${prefix}.${key}`)) {
      found.push(path);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Measured evidence (the only legal form of a capability claim — L16a)
// ---------------------------------------------------------------------------

/** The closed measured-evidence kind vocabulary (mirror of the registry's). */
export const CAPABILITY_EVIDENCE_KINDS = [
  'benchmark',
  'measurement-record',
  'result-ref',
] as const;

/** One kind of measured evidence. */
export type CapabilityEvidenceKind = (typeof CAPABILITY_EVIDENCE_KINDS)[number];

/** Guard: `CapabilityEvidenceKind`. */
export function isCapabilityEvidenceKind(v: unknown): v is CapabilityEvidenceKind {
  return isMemberOf(CAPABILITY_EVIDENCE_KINDS, v);
}

/** The closed structured-metric vocabulary (mirror of the registry's). */
export const MEASUREMENT_METRICS = [
  'benchmark-score',
  'p50-latency-ms',
  'p95-latency-ms',
  'compute-units',
] as const;

/** One structured measurement metric. */
export type MeasurementMetric = (typeof MEASUREMENT_METRICS)[number];

/** Guard: `MeasurementMetric`. */
export function isMeasurementMetric(v: unknown): v is MeasurementMetric {
  return isMemberOf(MEASUREMENT_METRICS, v);
}

/**
 * Benchmark evidence: a named benchmark run plus its opaque result
 * reference — STRUCTURAL MIRROR of @tradrl/agent-body capability-registry's
 * `BenchmarkEvidence` (field-for-field, no import).
 */
export interface BenchmarkEvidence {
  readonly kind: 'benchmark';
  /** Opaque benchmark-suite identity (the benchmark lane owns the referent). */
  readonly benchmarkId: string;
  /** Opaque reference to the recorded result of running the benchmark. */
  readonly resultRef: string;
}

/**
 * A structured measurement record reference with its metric and value —
 * STRUCTURAL MIRROR of the registry's `MeasurementRecordEvidence`.
 */
export interface MeasurementRecordEvidence {
  readonly kind: 'measurement-record';
  /** Opaque reference to the full measurement record (environment, config). */
  readonly recordRef: string;
  /** Which structured metric the value carries. */
  readonly metric: MeasurementMetric;
  /** The measured value (finite; interpretation is the reader's). */
  readonly value: number;
}

/**
 * An opaque result reference (raw evidence capsule, no structured metric) —
 * STRUCTURAL MIRROR of the registry's `ResultRefEvidence`.
 */
export interface ResultRefEvidence {
  readonly kind: 'result-ref';
  /** Opaque reference to the result capsule. */
  readonly resultRef: string;
}

/**
 * One piece of MEASURED evidence backing a skill's capability claim —
 * mirror of the registry's `MeasuredEvidence` closed union. There is
 * deliberately NO label/profession member: L16a ("labels alone never
 * establish suitability") makes the illegal state unrepresentable in valid
 * records, and `validateSkillRecord` turns smuggled labels into the typed
 * `label_as_evidence` violation.
 */
export type MeasuredEvidence =
  | BenchmarkEvidence
  | MeasurementRecordEvidence
  | ResultRefEvidence;

/** Guard: `MeasuredEvidence` — total over the closed union (mirror). */
export function isMeasuredEvidence(v: unknown): v is MeasuredEvidence {
  if (!isRecord(v)) return false;
  switch (v.kind) {
    case 'benchmark':
      return isNonEmptyString(v.benchmarkId) && isNonEmptyString(v.resultRef);
    case 'measurement-record':
      return (
        isNonEmptyString(v.recordRef) &&
        isMeasurementMetric(v.metric) &&
        typeof v.value === 'number' &&
        Number.isFinite(v.value)
      );
    case 'result-ref':
      return isNonEmptyString(v.resultRef);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// The capability descriptor (what the skill does — L16a discipline)
// ---------------------------------------------------------------------------

/**
 * What the skill DEMONSTRABLY does: the capability contract it serves plus
 * a NON-EMPTY list of measured evidence (mirroring the registry's
 * `CapabilityDescriptor` discipline — a bare claim is a label, L16a).
 * Registry records whose subject demonstrates this capability contract are
 * cited via `capabilityRecordRefs`, so the registry discipline (measured
 * evidence per record) and the skill discipline (measured evidence per
 * claim) interlock.
 */
export interface SkillCapabilityDescriptor {
  /** The capability contract this skill serves (never a profession label — L16a). */
  readonly capabilityKey: CapabilityKey;
  /** What the skill does (human-readable summary). */
  readonly summary: string;
  /** Measured evidence backing the claim; NON-EMPTY (a bare claim is a label — L16a). */
  readonly measuredEvidence: readonly MeasuredEvidence[];
  /** Registry capability records demonstrating this contract (may be empty — the registry is one evidence source among several). */
  readonly capabilityRecordRefs: readonly string[];
}

/** Guard: `SkillCapabilityDescriptor`. */
export function isSkillCapabilityDescriptor(v: unknown): v is SkillCapabilityDescriptor {
  if (!isRecord(v)) return false;
  if (!isCapabilityKey(v.capabilityKey)) return false;
  if (!isNonEmptyString(v.summary)) return false;
  if (!Array.isArray(v.measuredEvidence) || v.measuredEvidence.length === 0) return false;
  if (!isArrayOf(v.measuredEvidence, isMeasuredEvidence)) return false;
  return isArrayOf(v.capabilityRecordRefs, isNonEmptyString);
}

// ---------------------------------------------------------------------------
// Provenance (the evidence citation law) and applicability
// ---------------------------------------------------------------------------

/** Where the skill was extracted from. */
export const SKILL_ORIGINS = ['recorded-experience', 'imported-artifact'] as const;

/**
 * The skill's origin:
 * - `recorded-experience` — extracted from the native learning loop's
 *   trajectory/trial/attainment evidence (spec/LEARNING-LOOP.md).
 * - `imported-artifact` — imported expertise, LOCALLY versioned and
 *   validated (spec/LEARNING-LOOP.md "Human augmentation"; L18 — Arena is
 *   optional; imported artifacts enter as ordinary validated records).
 * Both origins carry the same evidence-citation burden.
 */
export type SkillOrigin = (typeof SKILL_ORIGINS)[number];

/** Guard: `SkillOrigin`. */
export function isSkillOrigin(v: unknown): v is SkillOrigin {
  return isMemberOf(SKILL_ORIGINS, v);
}

/**
 * The provenance block — the EVIDENCE CITATION LAW lives here: at least
 * one reference across the four categories, or validation fails with
 * `evidence_missing`. Every category is a mirror of its owning lane's id
 * space (trajectory/experiments/evaluation).
 */
export interface SkillProvenance {
  /** Trajectories the skill was extracted from (T011 mirror; may be empty if other evidence exists). */
  readonly trajectoryRefs: readonly TrajectoryId[];
  /** Experiments whose trials produced the evidence (T011 mirror). */
  readonly experimentRefs: readonly ExperimentId[];
  /** Trials whose outcomes produced the evidence (T011 mirror). */
  readonly trialRefs: readonly TrialId[];
  /** Attainment-evidence references backing the claim (evaluation lane mirror). */
  readonly attainmentEvidenceRefs: readonly AttainmentEvidenceRef[];
  /** The skill's origin (native loop or locally-validated import). */
  readonly origin: SkillOrigin;
}

/** Guard: `SkillProvenance` (structural; the non-empty citation law is enforced by the record validator). */
export function isSkillProvenance(v: unknown): v is SkillProvenance {
  if (!isRecord(v)) return false;
  return (
    isArrayOf(v.trajectoryRefs, isTrajectoryId) &&
    isArrayOf(v.experimentRefs, isExperimentId) &&
    isArrayOf(v.trialRefs, isTrialId) &&
    isArrayOf(v.attainmentEvidenceRefs, isAttainmentEvidenceRef) &&
    isSkillOrigin(v.origin)
  );
}

/** Returns the TOTAL number of evidence citations in a provenance block. */
export function provenanceCitationCount(provenance: SkillProvenance): number {
  return (
    provenance.trajectoryRefs.length +
    provenance.experimentRefs.length +
    provenance.trialRefs.length +
    provenance.attainmentEvidenceRefs.length
  );
}

/**
 * Where the skill applies: environments and instrument classes, as OPAQUE
 * references (the environment lane owns the environment profiles; the
 * market/data lanes own instrument classes). Both may be empty — an empty
 * applicability block means "no declared scope restriction", never
 * "invented scope".
 */
export interface SkillApplicability {
  /** Opaque environment-profile references the skill was validated under. */
  readonly environmentProfileRefs: readonly EnvironmentProfileRef[];
  /** Opaque instrument-class references the skill applies to. */
  readonly instrumentClassRefs: readonly InstrumentClassRef[];
}

/** Guard: `SkillApplicability`. */
export function isSkillApplicability(v: unknown): v is SkillApplicability {
  if (!isRecord(v)) return false;
  return (
    isArrayOf(v.environmentProfileRefs, isEnvironmentProfileRef) &&
    isArrayOf(v.instrumentClassRefs, isInstrumentClassRef)
  );
}

// ---------------------------------------------------------------------------
// Lineage (L9 — full lineage on every skill record)
// ---------------------------------------------------------------------------

/**
 * The L9 lineage block of a skill record: the parent skill this skill
 * supersedes (or `null` for the first extraction of this contract), the
 * evidence capsules backing the record, the typed capability gaps whose
 * remediation produced it, the extraction protocol version, the seed (the
 * only randomness), and the tenant/project scope (L12). Missing pieces are
 * `lineage_gap` / `tenant_missing` typed errors.
 */
export interface SkillLineage {
  /** The skill this record supersedes, or `null` at the lineage root. */
  readonly parentSkillRef: SkillRecordId | null;
  /** Evidence-capsule references backing the record (T012 evidence lane). */
  readonly evidenceRefs: readonly EvidenceRef[];
  /** The typed capability gaps whose remediation produced this skill. */
  readonly gapRefs: readonly CapabilityGapId[];
  /** The extraction protocol version that produced this record (lineage participant, L9). */
  readonly extractionVersion: ExtractionVersionRef;
  /** The extraction seed — the ONLY randomness input (the determinism law). */
  readonly seed: string;
  /** Owning tenant (L12). */
  readonly tenantId: TenantId;
  /** Owning project (L12). */
  readonly projectId: ProjectId;
  /** Explicit extraction instant (epoch ms — carried, never read from a clock). */
  readonly extractedAt: TimestampMs;
}

/** Guard: `SkillLineage` (structural). */
export function isSkillLineage(v: unknown): v is SkillLineage {
  if (!isRecord(v)) return false;
  return (
    (v.parentSkillRef === null || isSkillRecordId(v.parentSkillRef)) &&
    isArrayOf(v.evidenceRefs, isEvidenceRef) &&
    isArrayOf(v.gapRefs, isCapabilityGapId) &&
    isExtractionVersionRef(v.extractionVersion) &&
    isNonEmptyString(v.seed) &&
    isTenantId(v.tenantId) &&
    isProjectId(v.projectId) &&
    isTimestampMs(v.extractedAt)
  );
}

// ---------------------------------------------------------------------------
// SkillRecord
// ---------------------------------------------------------------------------

/**
 * The evidence-backed skill: a capability descriptor (what it does, with
 * MEASURED evidence per the registry discipline — L16a), the provenance
 * citations (trajectory/experiment/trial/attainment mirrors — the evidence
 * law), the applicability scope (opaque refs), a version, the
 * `SkillArtifactRef` agent-body capabilities cite, and the full L9/L12
 * lineage block. Created ONLY from recorded experience or locally-validated
 * imports — never invented.
 */
export interface SkillRecord {
  /** Skill identity (registry-unique). */
  readonly skillId: SkillRecordId;
  /** The opaque artifact reference `BodyCapability.skillArtifactRefs` cite (T003 reserves the space; T017 mints it). */
  readonly artifactRef: SkillArtifactRef;
  /** The capability descriptor (what the skill does — L16a discipline). */
  readonly descriptor: SkillCapabilityDescriptor;
  /** The provenance citations (the evidence law — never empty in a valid record). */
  readonly provenance: SkillProvenance;
  /** The applicability scope (opaque refs). */
  readonly applicability: SkillApplicability;
  /** The skill's version within its lineage (monotonic; 1 at the root). */
  readonly version: number;
  /** The L9/L12 lineage block. */
  readonly lineage: SkillLineage;
}

/** Guard: `SkillRecord` — structural totality INCLUDING the L16a label scan. */
export function isSkillRecord(v: unknown): v is SkillRecord {
  if (!isRecord(v)) return false;
  if (!isSkillRecordId(v.skillId)) return false;
  if (!isSkillArtifactRef(v.artifactRef)) return false;
  if (!isSkillCapabilityDescriptor(v.descriptor)) return false;
  if (!isSkillProvenance(v.provenance)) return false;
  // THE EVIDENCE LAW is enforced by the GUARD as well, not only by the
  // validator: a skill claim with no evidence citation is not a skill
  // record on any code path (Work Order T017, evidence law).
  if (isSkillProvenance(v.provenance) && provenanceCitationCount(v.provenance) === 0) return false;
  if (!isSkillApplicability(v.applicability)) return false;
  if (!isPositiveInteger(v.version)) return false;
  if (!isSkillLineage(v.lineage)) return false;
  if (labelKeyPaths(v).length > 0) return false; // L16a: no label keys, anywhere
  return true;
}

/**
 * Collect-all validation of an untrusted skill record against the FULL law:
 * structural shape, the L16a label trip-wire (label field keys anywhere;
 * `kind: 'label'` evidence entries), the MEASURED-EVIDENCE law (descriptor
 * evidence non-empty), the EVIDENCE-CITATION law (provenance carries at
 * least one citation — `evidence_missing`), version sanity, the L12 tenant
 * law, and the L9 lineage block. On success the value is returned narrowed
 * and deeply frozen.
 */
export function validateSkillRecord(v: unknown, path = 'skill'): SkillResult<SkillRecord> {
  if (!isRecord(v)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: SkillError[] = [];

  // L16a trip-wire #1: label FIELD keys anywhere in the record's JSON tree.
  for (const labelPath of labelKeyPaths(v)) {
    errors.push({
      code: 'label_as_evidence',
      path: `${path}.${labelPath}`,
      message: `field "${labelPath}" cites a profession/role label — labels alone never establish suitability (L16a; spec/CAPABILITY-DISCOVERY.md "Never equate model and profession")`,
    });
  }
  // L16a trip-wire #2: a `kind: 'label'` evidence entry (the classic
  // `model -> mathematician` smuggle) is named precisely.
  if (isRecord(v.descriptor) && Array.isArray(v.descriptor.measuredEvidence)) {
    v.descriptor.measuredEvidence.forEach((entry: unknown, index: number) => {
      if (isRecord(entry) && entry.kind === 'label') {
        errors.push({
          code: 'label_as_evidence',
          path: `${path}.descriptor.measuredEvidence[${index}]`,
          message: 'evidence kind "label" is not a measured-evidence kind — `model -> measured capability -> candidate possession` is valid, `model -> mathematician` is not (spec/CAPABILITY-DISCOVERY.md)',
        });
      }
    });
  }

  if (v.skillId === undefined) {
    errors.push(missingField(`${path}.skillId`));
  } else if (!isSkillRecordId(v.skillId)) {
    errors.push(invalidField(`${path}.skillId`, 'invalid SkillRecordId'));
  }
  if (v.artifactRef === undefined) {
    errors.push(missingField(`${path}.artifactRef`));
  } else if (!isSkillArtifactRef(v.artifactRef)) {
    errors.push(invalidField(`${path}.artifactRef`, 'invalid SkillArtifactRef'));
  }

  if (v.descriptor === undefined) {
    errors.push(missingField(`${path}.descriptor`));
  } else if (!isRecord(v.descriptor)) {
    errors.push(invalidField(`${path}.descriptor`, 'must be an object'));
  } else {
    const descriptorPath = `${path}.descriptor`;
    if (!isCapabilityKey(v.descriptor.capabilityKey)) {
      errors.push(invalidField(`${descriptorPath}.capabilityKey`, 'invalid CapabilityKey (a capability CONTRACT, never a profession label — L16a)'));
    }
    if (!isNonEmptyString(v.descriptor.summary)) {
      errors.push(invalidField(`${descriptorPath}.summary`, 'must be a non-empty summary of what the skill does'));
    }
    if (!Array.isArray(v.descriptor.measuredEvidence)) {
      errors.push(invalidField(`${descriptorPath}.measuredEvidence`, 'must be an array of measured evidence'));
    } else if (v.descriptor.measuredEvidence.length === 0) {
      // A capability claim without measured evidence is exactly the
      // label-shaped claim L16a forbids.
      errors.push({
        code: 'label_as_evidence',
        path: `${descriptorPath}.measuredEvidence`,
        message: 'a capability claim must carry at least one measured-evidence entry (L16a: labels alone never establish suitability)',
      });
    } else {
      v.descriptor.measuredEvidence.forEach((entry: unknown, index: number) => {
        if (!isMeasuredEvidence(entry)) {
          errors.push(
            invalidField(
              `${descriptorPath}.measuredEvidence[${index}]`,
              'failed the closed MeasuredEvidence union (benchmark | measurement-record | result-ref)',
            ),
          );
        }
      });
    }
    if (!isArrayOf(v.descriptor.capabilityRecordRefs, isNonEmptyString)) {
      errors.push(invalidField(`${descriptorPath}.capabilityRecordRefs`, 'must be an array of opaque capability-record references'));
    }
  }

  if (v.provenance === undefined) {
    errors.push(missingField(`${path}.provenance`));
  } else if (!isRecord(v.provenance)) {
    errors.push(invalidField(`${path}.provenance`, 'must be an object'));
  } else {
    const provenancePath = `${path}.provenance`;
    if (!isArrayOf(v.provenance.trajectoryRefs, isTrajectoryId)) {
      errors.push(invalidField(`${provenancePath}.trajectoryRefs`, 'must be an array of trajectory references'));
    }
    if (!isArrayOf(v.provenance.experimentRefs, isExperimentId)) {
      errors.push(invalidField(`${provenancePath}.experimentRefs`, 'must be an array of experiment references'));
    }
    if (!isArrayOf(v.provenance.trialRefs, isTrialId)) {
      errors.push(invalidField(`${provenancePath}.trialRefs`, 'must be an array of trial references'));
    }
    if (!isArrayOf(v.provenance.attainmentEvidenceRefs, isAttainmentEvidenceRef)) {
      errors.push(invalidField(`${provenancePath}.attainmentEvidenceRefs`, 'must be an array of attainment-evidence references'));
    }
    if (!isSkillOrigin(v.provenance.origin)) {
      errors.push(invalidField(`${provenancePath}.origin`, `must be one of ${SKILL_ORIGINS.join(' | ')}`));
    }
    // THE EVIDENCE LAW: a skill claim with no evidence citation fails
    // validation. Skills are extracted FROM recorded experience — never
    // invented.
    if (
      isArrayOf(v.provenance.trajectoryRefs, isTrajectoryId) &&
      isArrayOf(v.provenance.experimentRefs, isExperimentId) &&
      isArrayOf(v.provenance.trialRefs, isTrialId) &&
      isArrayOf(v.provenance.attainmentEvidenceRefs, isAttainmentEvidenceRef) &&
      provenanceCitationCount(v.provenance as unknown as SkillProvenance) === 0
    ) {
      errors.push({
        code: 'evidence_missing',
        path: provenancePath,
        message: 'a skill claim with no evidence citation is invalid — skills are extracted FROM recorded experience, never invented (Work Order T017, evidence law)',
      });
    }
  }

  if (v.applicability === undefined) {
    errors.push(missingField(`${path}.applicability`));
  } else if (!isSkillApplicability(v.applicability)) {
    errors.push(invalidField(`${path}.applicability`, 'invalid SkillApplicability (opaque environment/instrument refs)'));
  }

  if (v.version === undefined) {
    errors.push(missingField(`${path}.version`));
  } else if (!isPositiveInteger(v.version)) {
    errors.push(invalidField(`${path}.version`, 'must be a positive integer (monotonic within the skill lineage)'));
  }

  if (v.lineage === undefined) {
    errors.push(missingField(`${path}.lineage`));
    errors.push({
      code: 'lineage_gap',
      path: `${path}.lineage`,
      message: 'every skill record carries its full L9 lineage block (parent skill, evidence refs, gap refs, extraction version, seed) and L12 scope',
    });
  } else if (!isRecord(v.lineage)) {
    errors.push(invalidField(`${path}.lineage`, 'must be an object'));
  } else {
    const lineagePath = `${path}.lineage`;
    if (v.lineage.parentSkillRef !== null && v.lineage.parentSkillRef !== undefined && !isSkillRecordId(v.lineage.parentSkillRef)) {
      errors.push(invalidField(`${lineagePath}.parentSkillRef`, 'invalid SkillRecordId (or null at the lineage root)'));
    }
    if (v.lineage.parentSkillRef === undefined) {
      errors.push(missingField(`${lineagePath}.parentSkillRef`));
    }
    if (!isArrayOf(v.lineage.evidenceRefs, isEvidenceRef)) {
      errors.push(invalidField(`${lineagePath}.evidenceRefs`, 'must be an array of evidence-capsule references'));
    }
    if (!isArrayOf(v.lineage.gapRefs, isCapabilityGapId)) {
      errors.push(invalidField(`${lineagePath}.gapRefs`, 'must be an array of capability-gap ids'));
    }
    if (!isExtractionVersionRef(v.lineage.extractionVersion)) {
      errors.push(invalidField(`${lineagePath}.extractionVersion`, 'invalid ExtractionVersionRef (L9: the extraction protocol version is a lineage participant)'));
    }
    if (!isNonEmptyString(v.lineage.seed)) {
      errors.push({
        code: 'unseeded_forge',
        path: `${lineagePath}.seed`,
        message: 'the extraction must be seeded — there is no ambient randomness; extraction without a seed cannot run (the determinism law)',
      });
    }
    if (!isTimestampMs(v.lineage.extractedAt)) {
      errors.push(invalidField(`${lineagePath}.extractedAt`, 'invalid TimestampMs (explicit instant — never a wall clock)'));
    }
    // L12: tenant/project scope is MANDATORY on every record.
    if (v.lineage.tenantId === undefined || !isTenantId(v.lineage.tenantId)) {
      errors.push({
        code: 'tenant_missing',
        path: `${lineagePath}.tenantId`,
        message: 'every skill record carries its owning tenant (L12)',
      });
    }
    if (v.lineage.projectId === undefined || !isProjectId(v.lineage.projectId)) {
      errors.push({
        code: 'tenant_missing',
        path: `${lineagePath}.projectId`,
        message: 'every skill record carries its owning project (L12)',
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: deepFreeze(deepCloneJson(v) as unknown as SkillRecord) };
}

/**
 * Constructs a deeply frozen `SkillRecord`, running the FULL validation law
 * first (collect-all). Throws `TypeError` (field-prefixed) on invalid
 * input. This is the ONLY sanctioned constructor for skill records.
 */
export function createSkillRecord(draft: unknown): SkillRecord {
  const result = validateSkillRecord(draft);
  if (!result.ok) {
    const problems = result.errors.map(
      (e) => `(${e.code}) ${e.path}: ${e.message}`,
    );
    throw new TypeError(`createSkillRecord: ${problems.join('; ')}`);
  }
  return result.value;
}

/**
 * Serializes a skill record to canonical JSON bytes (object keys sorted —
 * same record, same bytes; the determinism anchor, L9).
 */
export function serializeSkillRecord(record: SkillRecord): string {
  return canonicalJson(JSON.parse(JSON.stringify(record)) as JsonValue);
}
