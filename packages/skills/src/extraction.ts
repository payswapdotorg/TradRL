/**
 * @tradrl/skills — the extraction protocol.
 *
 * THE LAW THIS MODULE SERVES: Work Order T017 — "`ExtractionProtocol` —
 * (trajectory evidence, gap records, attainment evidence) -> candidate
 * SkillRecords (pure; deterministic; the extraction RANKS candidate skills
 * by declared evidence strength — the ranking function is a declared,
 * versioned record)."
 *
 * Spec anchors:
 * - spec/LEARNING-LOOP.md — the loop's back half: "failure analysis ->
 *   skill extraction -> Body Version -> compatibility -> shadow -> outcome
 *   -> next experiment"; "Failure-driven learning" ("Failures create typed
 *   CapabilityGaps such as regime, sentiment/event, liquidity, execution,
 *   risk or coordination failure").
 * - spec/CAPABILITY-DISCOVERY.md — the discovery loop is deficit-driven
 *   ("Detect capability deficit from task/project evidence") and its
 *   Reproducibility law ("Record candidate roles, bodies, models,
 *   benchmarks, datasets, configuration, cost, latency, environment,
 *   outcomes and rejected candidates") — the extraction output RETAINS
 *   skipped gaps (gaps with no evidence) instead of hiding them.
 * - spec/ARCHITECTURE-LOCK.md L9 (reproducible lineage), L11 (history
 *   retained), L12 (tenant isolation), L16a (measured evidence only).
 *
 * MIRROR DISCIPLINE (D-003/D-004): the evidence inputs are STRUCTURAL
 * MIRRORS of their owning lanes — `CapabilityGapMirror` re-declares the
 * organization lane's `CapabilityGap` field-for-field (T016, same brand
 * tags, mutually assignable); `TrajectoryMetadataMirror` re-declares the
 * trajectory lane's identity+lineage subset (T011); `TrialOutcomeMirror`
 * re-declares the experiments lane's `TrialRecord` subset (T011, exact
 * snake_case field names, status invariants mirrored);
 * `VerdictEvidenceMirror` re-declares the evaluation lane's
 * `AttainmentVerdict` subset (T012). This package never imports those
 * lanes; the trip wires live in interop.test.ts.
 *
 * THE EVIDENCE LAW (enforced here): extraction only emits EVIDENCE-BACKED
 * candidates — a gap with no evidence binding is SKIPPED and the skip is
 * RETAINED in the output (`skippedGapIds` — never hidden, L11's spirit);
 * a binding that names no evidence at all is invalid (a binding that binds
 * nothing is not a record). No candidate is ever invented: its
 * `measuredEvidence` and `provenance` are DERIVED from the bound evidence
 * only.
 *
 * Determinism law: `runExtraction` is a pure function of (input,
 * protocol). Same inputs -> byte-identical output (inputDigest and
 * outputDigest witness it). No ambient clock, no ambient randomness — the
 * seed is the only entropy input, and it only keys DERIVED identities.
 */

import {
  type ArmId,
  type AttainmentEvidenceRef,
  type CapabilityGapId,
  type CapabilityKey,
  type EvidenceRef,
  type ExperimentId,
  type ExtractionVersionRef,
  type JsonValue,
  type ProjectId,
  type SkillArtifactRef,
  type SkillRecordId,
  type SubstrateRef,
  type TenantId,
  type TimestampMs,
  type TrajectoryId,
  type TrialId,
  type VerdictId,
  type BodyVersionRef,
  canonicalJson,
  deepCloneJson,
  deepFreeze,
  fnv1a32,
  isArrayOf,
  isArmId,
  isAttainmentEvidenceRef,
  isCapabilityGapId,
  isCapabilityKey,
  isExperimentId,
  isExtractionVersionRef,
  isFiniteNumber,
  isMemberOf,
  isNonEmptyString,
  isNonNegativeInteger,
  isPositiveInteger,
  isProjectId,
  isRecord,
  isSkillRecordId,
  isSubstrateRef,
  isTenantId,
  isTimestampMs,
  isTrajectoryId,
  isTrialId,
  isVerdictId,
  isBodyVersionRef,
  stableDigest,
} from './primitives';
import { type SkillError, type SkillResult, fail, invalidField, invalidType, missingField, ok } from './errors';
import { type MeasuredEvidence, type SkillRecord, createSkillRecord } from './record';

// ---------------------------------------------------------------------------
// The capability-gap mirror (organization lane, T016 — DO NOT DIVERGE)
// ---------------------------------------------------------------------------

/**
 * The closed capability-gap kind vocabulary — the six failure classes of
 * spec/LEARNING-LOOP.md, VERBATIM: "Failures create typed CapabilityGaps
 * such as regime, sentiment/event, liquidity, execution, risk or
 * coordination failure." Spelled exactly as the organization lane spells
 * them (the interop test asserts the parity kind-for-kind).
 */
export const CAPABILITY_GAP_KINDS = [
  'regime',
  'sentiment-event',
  'liquidity',
  'execution',
  'risk',
  'coordination',
] as const;

/** One failure class (LEARNING-LOOP, verbatim). */
export type CapabilityGapKind = (typeof CAPABILITY_GAP_KINDS)[number];

/** Guard: `CapabilityGapKind`. */
export function isCapabilityGapKind(v: unknown): v is CapabilityGapKind {
  return isMemberOf(CAPABILITY_GAP_KINDS, v);
}

/**
 * One typed capability gap — STRUCTURAL MIRROR of the organization lane's
 * `CapabilityGap` (T016, packages/organization/src/gap.ts): field-for-field
 * with the same brand tags (`CapabilityGapId`, `CapabilityKey`,
 * `AttainmentEvidenceRef`, `TradRL.TimestampMs`) and plain-string tenant/
 * project fields, so a REAL organization gap record IS an extraction-lane
 * gap record (mutually assignable — the compile-time trip wire) and
 * satisfies this guard (the runtime trip wire). The gap is the forge's
 * commission input: gap records drive what the forge attempts next
 * (services/learning curriculum + T016's "new body spec required" records).
 */
export interface CapabilityGapMirror {
  /** Gap identity (unique within the extraction input's gap list). */
  readonly gapId: CapabilityGapId;
  /** The failure class (closed six-kind vocabulary above). */
  readonly kind: CapabilityGapKind;
  /** The capability contract whose absence the failure evidences (never a profession label — L16a). */
  readonly capabilityKey: CapabilityKey;
  /** Opaque reference to the failure evidence that detected the deficit. */
  readonly evidenceRef: AttainmentEvidenceRef;
  /** Explicit detection instant (epoch ms — carried, never read from a clock). */
  readonly detectedAt: TimestampMs;
  /** Owning tenant (L12 — plain string, mirroring the organization lane's exact field type). */
  readonly tenantId: string;
  /** Owning project (L12 — plain string, mirroring the organization lane's exact field type). */
  readonly projectId: string;
}

/** Guard: `CapabilityGapMirror` (total, hand-rolled; mirrors the organization guard). */
export function isCapabilityGapMirror(v: unknown): v is CapabilityGapMirror {
  if (!isRecord(v)) return false;
  return (
    isCapabilityGapId(v.gapId) &&
    isCapabilityGapKind(v.kind) &&
    isCapabilityKey(v.capabilityKey) &&
    isAttainmentEvidenceRef(v.evidenceRef) &&
    isTimestampMs(v.detectedAt) &&
    isNonEmptyString(v.tenantId) &&
    isNonEmptyString(v.projectId)
  );
}

// ---------------------------------------------------------------------------
// The trajectory evidence mirror (trajectory lane, T011 — DO NOT DIVERGE)
// ---------------------------------------------------------------------------

/**
 * The trajectory's identity+lineage subset — STRUCTURAL MIRROR of
 * @tradrl/trajectory's `TrajectoryMetadata` (snake_case field names, same
 * brand tags). A REAL `TrajectoryMetadata` is assignable to this mirror
 * (the compile-time trip wire) and satisfies the guard (the runtime trip
 * wire). The body-version refs are the PRODUCERS of the experience the
 * skill is extracted from — L9 lineage.
 */
export interface TrajectoryMetadataMirror {
  /** Trajectory identity (T011 lane). */
  readonly trajectory_id: TrajectoryId;
  /** Tenant scope (L12). */
  readonly tenant: TenantId;
  /** Project continuity root (L15). */
  readonly project: ProjectId;
  /** Body versions of the producing organization (non-empty — the stream's producers). */
  readonly body_versions: readonly BodyVersionRef[];
  /** Cognitive substrates those bodies ran on (non-empty). */
  readonly substrates: readonly SubstrateRef[];
}

/** Guard: `TrajectoryMetadataMirror` (non-empty producer sets — the trajectory law). */
export function isTrajectoryMetadataMirror(v: unknown): v is TrajectoryMetadataMirror {
  if (!isRecord(v)) return false;
  return (
    isTrajectoryId(v.trajectory_id) &&
    isTenantId(v.tenant) &&
    isProjectId(v.project) &&
    Array.isArray(v.body_versions) &&
    v.body_versions.length > 0 &&
    isArrayOf(v.body_versions, isBodyVersionRef) &&
    Array.isArray(v.substrates) &&
    v.substrates.length > 0 &&
    isArrayOf(v.substrates, isSubstrateRef)
  );
}

/**
 * One trajectory in the evidence pool: its metadata mirror plus the
 * step count (the volume of recorded experience — a ranking input).
 */
export interface TrajectoryEvidenceMirror {
  /** The trajectory's identity + lineage (T011 mirror). */
  readonly trajectory: TrajectoryMetadataMirror;
  /** How many steps the recorded experience carries (positive). */
  readonly stepCount: number;
}

/** Guard: `TrajectoryEvidenceMirror`. */
export function isTrajectoryEvidenceMirror(v: unknown): v is TrajectoryEvidenceMirror {
  if (!isRecord(v)) return false;
  return isTrajectoryMetadataMirror(v.trajectory) && isPositiveInteger(v.stepCount);
}

// ---------------------------------------------------------------------------
// The trial-outcome mirror (experiments lane, T011 — DO NOT DIVERGE)
// ---------------------------------------------------------------------------

/**
 * The closed trial-status vocabulary — STRUCTURAL MIRROR of
 * @tradrl/experiments' `TrialStatus` (`planned | running | succeeded |
 * failed | rejected`).
 */
export const TRIAL_STATUSES_MIRROR = [
  'planned',
  'running',
  'succeeded',
  'failed',
  'rejected',
] as const;

/** One trial status (mirror). */
export type TrialStatusMirror = (typeof TRIAL_STATUSES_MIRROR)[number];

/** Guard: `TrialStatusMirror`. */
export function isTrialStatusMirror(v: unknown): v is TrialStatusMirror {
  return isMemberOf(TRIAL_STATUSES_MIRROR, v);
}

/**
 * One trial outcome — STRUCTURAL MIRROR of @tradrl/experiments'
 * `TrialRecord` subset (exact snake_case field names, same brand tags): a
 * REAL `TrialRecord` is assignable to this mirror. Only the fields the
 * extraction consumes are mirrored: identity, arm, terminal status, the
 * trajectory the trial produced (REQUIRED for `succeeded` — a success
 * without evidence is inexpressible), and the failure reason (REQUIRED for
 * `failed`/`rejected` — an unexplained failure is not an auditable
 * record). The status invariants are the experiments lane's own.
 */
export interface TrialOutcomeMirror {
  readonly trial_id: TrialId;
  readonly arm: ArmId;
  readonly status: TrialStatusMirror;
  readonly trajectory: TrajectoryId | null;
  readonly failure_reason: string | null;
}

/** Guard: `TrialOutcomeMirror` (the mirrored status invariants, total). */
export function isTrialOutcomeMirror(v: unknown): v is TrialOutcomeMirror {
  if (!isRecord(v)) return false;
  if (!isTrialId(v.trial_id)) return false;
  if (!isArmId(v.arm)) return false;
  if (!isTrialStatusMirror(v.status)) return false;
  if (v.trajectory !== null && !isTrajectoryId(v.trajectory)) return false;
  if (v.failure_reason !== null && !isNonEmptyString(v.failure_reason)) return false;
  switch (v.status) {
    case 'succeeded':
      return v.trajectory !== null;
    case 'failed':
    case 'rejected':
      return v.failure_reason !== null;
    case 'planned':
    case 'running':
      return true;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// The verdict evidence mirror (evaluation lane, T012 — DO NOT DIVERGE)
// ---------------------------------------------------------------------------

/**
 * One attainment verdict — STRUCTURAL MIRROR of @tradrl/evaluation's
 * `AttainmentVerdict` subset: the verdict identity, the decision, and the
 * lineage refs (criteria, suite, evaluator — opaque strings; a REAL
 * `AttainmentVerdict` is assignable to this mirror because its branded id
 * fields narrow to plain strings). Attainment verdicts are the
 * strongest evidence a skill claim can cite (spec/LEARNING-LOOP.md
 * "evaluation -> verification -> ...").
 */
export interface VerdictEvidenceMirror {
  /** The verdict identity (T012 lane). */
  readonly verdictId: VerdictId;
  /** True iff every criterion attained in every split with no limitations. */
  readonly attained: boolean;
  /** Lineage: the compiled criteria this verdict decided (opaque). */
  readonly criteriaId: string;
  /** Lineage: the suite that produced the reports (opaque). */
  readonly suite: string;
  /** Lineage: the evaluator that scored the splits (opaque). */
  readonly evaluatorVersion: string;
}

/** Guard: `VerdictEvidenceMirror`. */
export function isVerdictEvidenceMirror(v: unknown): v is VerdictEvidenceMirror {
  if (!isRecord(v)) return false;
  return (
    isVerdictId(v.verdictId) &&
    typeof v.attained === 'boolean' &&
    isNonEmptyString(v.criteriaId) &&
    isNonEmptyString(v.suite) &&
    isNonEmptyString(v.evaluatorVersion)
  );
}

// ---------------------------------------------------------------------------
// Gap-evidence bindings (the extraction lane's own association record)
// ---------------------------------------------------------------------------

/**
 * The association between one typed gap and the recorded evidence that
 * addresses it — produced by upstream failure analysis (the loop's
 * "failure analysis" step; T012 verification outputs + T011 trial logs).
 * The TOTAL citation count across all categories must be POSITIVE: a
 * binding that binds nothing is not a record (invalid), and a gap with no
 * binding at all is SKIPPED by extraction (retained in the output — never
 * hidden).
 */
export interface GapEvidenceBinding {
  /** The gap this binding addresses (must exist in the input's gap list). */
  readonly gapId: CapabilityGapId;
  /** Trajectories whose recorded experience addresses the gap. */
  readonly trajectoryRefs: readonly TrajectoryId[];
  /** Experiments whose trials produced the evidence. */
  readonly experimentRefs: readonly ExperimentId[];
  /** Trials whose outcomes produced the evidence. */
  readonly trialRefs: readonly TrialId[];
  /** Attainment verdicts backing the claim. */
  readonly verdictRefs: readonly VerdictId[];
  /** Additional opaque attainment-evidence references. */
  readonly attainmentEvidenceRefs: readonly AttainmentEvidenceRef[];
}

/** Guard: `GapEvidenceBinding` (structural; the non-empty law is enforced by the validator). */
export function isGapEvidenceBinding(v: unknown): v is GapEvidenceBinding {
  if (!isRecord(v)) return false;
  return (
    isCapabilityGapId(v.gapId) &&
    isArrayOf(v.trajectoryRefs, isTrajectoryId) &&
    isArrayOf(v.experimentRefs, isExperimentId) &&
    isArrayOf(v.trialRefs, isTrialId) &&
    isArrayOf(v.verdictRefs, isVerdictId) &&
    isArrayOf(v.attainmentEvidenceRefs, isAttainmentEvidenceRef)
  );
}

/** Returns the TOTAL citation count of a binding. */
export function bindingCitationCount(binding: GapEvidenceBinding): number {
  return (
    binding.trajectoryRefs.length +
    binding.experimentRefs.length +
    binding.trialRefs.length +
    binding.verdictRefs.length +
    binding.attainmentEvidenceRefs.length
  );
}

// ---------------------------------------------------------------------------
// The declared, versioned ranking function
// ---------------------------------------------------------------------------

/**
 * The declared weights of the evidence-strength ranking — the ranking
 * function is a DECLARED, VERSIONED RECORD (Work Order T017): nothing
 * about how candidates are ranked is hidden. All weights are non-negative
 * finite numbers; the strength of a candidate is the weighted sum of its
 * bound evidence volume (see {@link runExtraction}).
 */
export interface ExtractionRankingWeights {
  /** Weight per recorded trajectory STEP (experience volume). */
  readonly trajectoryStep: number;
  /** Weight per SUCCEEDED trial (terminal success with a trajectory). */
  readonly succeededTrial: number;
  /** Weight per ATTAINED verdict (the strongest evidence class). */
  readonly attainedVerdict: number;
  /** Weight per distinct corroborating evidence CATEGORY (0..5). */
  readonly corroboration: number;
}

/** Guard: `ExtractionRankingWeights` (non-negative finite, declared). */
export function isExtractionRankingWeights(v: unknown): v is ExtractionRankingWeights {
  if (!isRecord(v)) return false;
  return (
    isFiniteNumber(v.trajectoryStep) &&
    v.trajectoryStep >= 0 &&
    isFiniteNumber(v.succeededTrial) &&
    v.succeededTrial >= 0 &&
    isFiniteNumber(v.attainedVerdict) &&
    v.attainedVerdict >= 0 &&
    isFiniteNumber(v.corroboration) &&
    v.corroboration >= 0
  );
}

/**
 * The declared, versioned ranking function: a version string plus the
 * weight record. The version participates in derived skill identities and
 * lineage (L9) — changing the ranking changes the identities, by design.
 */
export interface ExtractionRankingFunction {
  /** The ranking function's version (e.g. `evidence-strength/1`). */
  readonly rankingVersion: string;
  /** The declared weights. */
  readonly weights: ExtractionRankingWeights;
}

/** Guard: `ExtractionRankingFunction`. */
export function isExtractionRankingFunction(v: unknown): v is ExtractionRankingFunction {
  if (!isRecord(v)) return false;
  return isNonEmptyString(v.rankingVersion) && isExtractionRankingWeights(v.weights);
}

/**
 * The extraction protocol: the versioned protocol identity plus its
 * declared ranking function. `runExtraction` enforces that the input's
 * `extractionVersion` equals the protocol's — lineage coherence (L9).
 */
export interface ExtractionProtocol {
  /** The protocol's version identity (lineage participant, L9). */
  readonly extractionVersion: ExtractionVersionRef;
  /** The declared, versioned ranking function. */
  readonly ranking: ExtractionRankingFunction;
}

/** Guard: `ExtractionProtocol` (structural). */
export function isExtractionProtocol(v: unknown): v is ExtractionProtocol {
  if (!isRecord(v)) return false;
  return isExtractionVersionRef(v.extractionVersion) && isExtractionRankingFunction(v.ranking);
}

// ---------------------------------------------------------------------------
// The extraction input
// ---------------------------------------------------------------------------

/**
 * The extraction input — the evidence streams the protocol mines
 * (trajectory evidence, trial outcomes, attainment verdicts), the typed
 * gap records that drive it (failure-driven; NON-EMPTY), the
 * gap-evidence bindings from upstream failure analysis, and the explicit
 * scope (version, seed, tenant/project, instant). Every instant is an
 * explicit parameter; there is NO ambient clock or randomness anywhere.
 */
export interface ExtractionInput {
  /** The typed capability gaps (failure-driven input; NON-EMPTY). */
  readonly gapRecords: readonly CapabilityGapMirror[];
  /** The trajectory evidence pool. */
  readonly trajectories: readonly TrajectoryEvidenceMirror[];
  /** The trial-outcome evidence pool. */
  readonly trialOutcomes: readonly TrialOutcomeMirror[];
  /** The attainment-verdict evidence pool. */
  readonly verdictEvidence: readonly VerdictEvidenceMirror[];
  /** Gap -> evidence associations (upstream failure analysis output). */
  readonly bindings: readonly GapEvidenceBinding[];
  /** The extraction protocol version that will run (must equal the protocol's own version). */
  readonly extractionVersion: ExtractionVersionRef;
  /** The extraction seed — the ONLY randomness input (the determinism law). */
  readonly seed: string;
  /** The extraction tenant scope (L12) — must match every gap record's scope. */
  readonly tenantId: TenantId;
  /** The extraction project scope (L12). */
  readonly projectId: ProjectId;
  /** Explicit extraction instant (epoch ms — carried, never read from a clock). */
  readonly extractedAt: TimestampMs;
}

// ---------------------------------------------------------------------------
// The extraction output
// ---------------------------------------------------------------------------

/**
 * One ranked candidate skill: the evidence-backed record plus its declared
 * evidence strength and its 1-based rank in the output ordering (strength
 * DESC, then capabilityKey ASC — the deterministic tie-break).
 */
export interface RankedSkillCandidate {
  /** The evidence-backed candidate skill record. */
  readonly skill: SkillRecord;
  /** The declared-weight evidence-strength score. */
  readonly evidenceStrength: number;
  /** 1-based rank in the output ordering. */
  readonly rank: number;
}

/** Guard: `RankedSkillCandidate`. */
export function isRankedSkillCandidate(v: unknown): v is RankedSkillCandidate {
  if (!isRecord(v)) return false;
  if (!isSkillRecordId((v.skill as { skillId?: unknown } | undefined)?.skillId)) return false;
  if (!isFiniteNumber(v.evidenceStrength)) return false;
  if (!isPositiveInteger(v.rank)) return false;
  return true;
}

/**
 * The extraction output: the RANKED candidates (deterministic order), the
 * RETAINED skipped gap ids (gaps with no evidence binding — never hidden;
 * CAPABILITY-DISCOVERY Reproducibility: "Record ... rejected candidates"),
 * and the digests witnessing byte-determinism (L9): `inputDigest` binds
 * the input, `outputDigest` binds the candidates + skips.
 */
export interface ExtractionOutput {
  /** The ranked candidate skills (strength DESC, capabilityKey ASC). */
  readonly candidates: readonly RankedSkillCandidate[];
  /** Gaps with no evidence binding — skipped and RETAINED (never hidden). */
  readonly skippedGapIds: readonly CapabilityGapId[];
  /** Digest over the canonical JSON of the full input (any mutation changes it). */
  readonly inputDigest: string;
  /** Digest over the canonical JSON of the candidates + skips. */
  readonly outputDigest: string;
}

// ---------------------------------------------------------------------------
// Deterministic identity derivation (pure FNV-1a — L9)
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit hash rendered as 8 lowercase hex characters. */
function fnv1a32Hex(text: string): string {
  return fnv1a32(text).toString(16).padStart(8, '0');
}

/**
 * Derives a candidate skill's record id: a pure FNV-1a function of
 * (extraction version, seed, gap id). Same inputs -> same id, forever.
 */
export function deriveSkillRecordId(
  extractionVersion: ExtractionVersionRef,
  seed: string,
  gapId: CapabilityGapId,
): SkillRecordId {
  return `skill-${fnv1a32Hex(`${extractionVersion}|${seed}|${gapId}`)}` as SkillRecordId;
}

/**
 * Derives the candidate skill's artifact ref (the opaque handle
 * agent-body's `BodyCapability.skillArtifactRefs` cite): a pure FNV-1a
 * function of (extraction version, seed, gap id).
 */
export function deriveSkillArtifactRef(
  extractionVersion: ExtractionVersionRef,
  seed: string,
  gapId: CapabilityGapId,
): SkillArtifactRef {
  return `skill-artifact:${fnv1a32Hex(`${extractionVersion}|${seed}|${gapId}|artifact`)}` as SkillArtifactRef;
}

// ---------------------------------------------------------------------------
// The deterministic extraction run
// ---------------------------------------------------------------------------

/** Canonical JSON of an extraction input (module-local adapter). */
function canonicalExtractionInput(input: ExtractionInput): string {
  return canonicalJson(deepCloneJson(input) as unknown as JsonValue);
}

/**
 * Validates an extraction input against the typed laws (collect-all):
 * non-empty failure-driven gap list with unique gap ids; every gap is a
 * valid `CapabilityGapMirror`; every pool entry passes its mirror guard;
 * every binding names an existing gap and carries at least ONE citation;
 * scope coherence (every gap's tenant/project equals the input's — L12);
 * version + seed present (the determinism law). On success the value is
 * returned narrowed and deeply frozen.
 */
export function validateExtractionInput(v: unknown, path = 'extractionInput'): SkillResult<ExtractionInput> {
  if (!isRecord(v)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: SkillError[] = [];
  if (!Array.isArray(v.gapRecords)) {
    errors.push(invalidField(`${path}.gapRecords`, 'must be an array of typed capability gaps'));
  } else if (v.gapRecords.length === 0) {
    errors.push(
      invalidField(`${path}.gapRecords`, 'must be NON-EMPTY — extraction is failure-driven (spec/CAPABILITY-DISCOVERY.md step 1: "Detect capability deficit")'),
    );
  } else {
    const seenGapIds = new Set<string>();
    v.gapRecords.forEach((gap: unknown, index: number) => {
      const gapPath = `${path}.gapRecords[${index}]`;
      if (!isCapabilityGapMirror(gap)) {
        errors.push(invalidField(gapPath, 'failed the CapabilityGapMirror guard (organization-lane mirror)'));
        return;
      }
      if (seenGapIds.has(gap.gapId)) {
        errors.push({ code: 'duplicate_record', path: `${gapPath}.gapId`, message: `duplicate gap id "${gap.gapId}"` });
      } else {
        seenGapIds.add(gap.gapId);
      }
    });
  }
  if (!Array.isArray(v.trajectories)) {
    errors.push(invalidField(`${path}.trajectories`, 'must be an array of trajectory evidence entries'));
  } else if (!isArrayOf(v.trajectories, isTrajectoryEvidenceMirror)) {
    errors.push(invalidField(`${path}.trajectories`, 'every entry must be a valid TrajectoryEvidenceMirror'));
  }
  if (!Array.isArray(v.trialOutcomes)) {
    errors.push(invalidField(`${path}.trialOutcomes`, 'must be an array of trial outcome entries'));
  } else if (!isArrayOf(v.trialOutcomes, isTrialOutcomeMirror)) {
    errors.push(invalidField(`${path}.trialOutcomes`, 'every entry must be a valid TrialOutcomeMirror (experiments-lane mirror)'));
  }
  if (!Array.isArray(v.verdictEvidence)) {
    errors.push(invalidField(`${path}.verdictEvidence`, 'must be an array of verdict evidence entries'));
  } else if (!isArrayOf(v.verdictEvidence, isVerdictEvidenceMirror)) {
    errors.push(invalidField(`${path}.verdictEvidence`, 'every entry must be a valid VerdictEvidenceMirror (evaluation-lane mirror)'));
  }
  if (Array.isArray(v.bindings)) {
    const gapIds = new Set<string>(
      Array.isArray(v.gapRecords)
        ? v.gapRecords.filter(isCapabilityGapMirror).map((gap) => gap.gapId)
        : [],
    );
    const seenBindingGapIds = new Set<string>();
    v.bindings.forEach((binding: unknown, index: number) => {
      const bindingPath = `${path}.bindings[${index}]`;
      if (!isGapEvidenceBinding(binding)) {
        errors.push(invalidField(bindingPath, 'failed the GapEvidenceBinding guard'));
        return;
      }
      if (seenBindingGapIds.has(binding.gapId)) {
        errors.push({
          code: 'duplicate_record',
          path: `${bindingPath}.gapId`,
          message: `gap "${binding.gapId}" is bound more than once — one binding per gap`,
        });
      } else {
        seenBindingGapIds.add(binding.gapId);
      }
      if (!gapIds.has(binding.gapId)) {
        errors.push(invalidField(`${bindingPath}.gapId`, `gap "${binding.gapId}" does not exist in gapRecords`));
      }
      if (bindingCitationCount(binding) === 0) {
        errors.push({
          code: 'evidence_missing',
          path: bindingPath,
          message: 'a binding that cites no evidence is not a record — the evidence law travels with every binding',
        });
      }
    });
  } else {
    errors.push(invalidField(`${path}.bindings`, 'must be an array of gap-evidence bindings'));
  }
  if (!isExtractionVersionRef(v.extractionVersion)) {
    errors.push(invalidField(`${path}.extractionVersion`, 'invalid ExtractionVersionRef (L9: the protocol version is a lineage participant)'));
  }
  if (typeof v.seed !== 'string' || v.seed.trim().length === 0) {
    errors.push({
      code: 'unseeded_forge',
      path: `${path}.seed`,
      message: 'the extraction must be seeded — there is no ambient randomness; extraction without a seed cannot run (the determinism law)',
    });
  }
  if (!isTenantId(v.tenantId)) {
    errors.push({ code: 'tenant_missing', path: `${path}.tenantId`, message: 'the extraction input carries its owning tenant (L12)' });
  }
  if (!isProjectId(v.projectId)) {
    errors.push({ code: 'tenant_missing', path: `${path}.projectId`, message: 'the extraction input carries its owning project (L12)' });
  }
  if (v.extractedAt === undefined) {
    errors.push(missingField(`${path}.extractedAt`));
  } else if (!isTimestampMs(v.extractedAt)) {
    errors.push(invalidField(`${path}.extractedAt`, 'invalid TimestampMs (explicit instant — never a wall clock)'));
  }
  if (errors.length > 0) return { ok: false, errors };

  const input = v as unknown as ExtractionInput;
  // L12 scope coherence: every gap record shares the input's tenant/project.
  for (const gap of input.gapRecords) {
    if (gap.tenantId !== input.tenantId || gap.projectId !== input.projectId) {
      return fail(
        'tenant_mismatch',
        `gap "${gap.gapId}" carries tenant "${gap.tenantId}"/project "${gap.projectId}" but the extraction scope is "${input.tenantId}"/"${input.projectId}" — one tenant per lineage chain (L12)`,
        `gapRecords.gapId:${gap.gapId}`,
      );
    }
  }
  return { ok: true, value: deepFreeze(deepCloneJson(input)) };
}

/**
 * Computes the declared evidence strength of one gap's bound evidence.
 * PURE: the weighted sum of (trajectory steps, succeeded trials, attained
 * verdicts, corroborating categories) under the ranking function's
 * declared weights.
 */
export function evidenceStrengthOf(
  binding: GapEvidenceBinding,
  trajectories: readonly TrajectoryEvidenceMirror[],
  trialOutcomes: readonly TrialOutcomeMirror[],
  verdictEvidence: readonly VerdictEvidenceMirror[],
  ranking: ExtractionRankingFunction,
): number {
  const trajectoryMap = new Map<string, TrajectoryEvidenceMirror>(
    trajectories.map((entry) => [entry.trajectory.trajectory_id, entry]),
  );
  const trialMap = new Map<string, TrialOutcomeMirror>(trialOutcomes.map((entry) => [entry.trial_id, entry]));
  const verdictMap = new Map<string, VerdictEvidenceMirror>(verdictEvidence.map((entry) => [entry.verdictId, entry]));

  let steps = 0;
  for (const ref of binding.trajectoryRefs) {
    const entry = trajectoryMap.get(ref);
    if (entry !== undefined) steps += entry.stepCount;
  }
  let succeededTrials = 0;
  for (const ref of binding.trialRefs) {
    const entry = trialMap.get(ref);
    if (entry !== undefined && entry.status === 'succeeded') succeededTrials += 1;
  }
  let attainedVerdicts = 0;
  for (const ref of binding.verdictRefs) {
    const entry = verdictMap.get(ref);
    if (entry !== undefined && entry.attained) attainedVerdicts += 1;
  }
  let categories = 0;
  if (binding.trajectoryRefs.length > 0) categories += 1;
  if (binding.experimentRefs.length > 0) categories += 1;
  if (binding.trialRefs.length > 0) categories += 1;
  if (binding.verdictRefs.length > 0) categories += 1;
  if (binding.attainmentEvidenceRefs.length > 0) categories += 1;

  const { weights } = ranking;
  return (
    weights.trajectoryStep * steps +
    weights.succeededTrial * succeededTrials +
    weights.attainedVerdict * attainedVerdicts +
    weights.corroboration * categories
  );
}

/**
 * Runs the extraction protocol: (trajectory evidence, gap records,
 * attainment evidence) -> RANKED candidate SkillRecords. PURE and
 * DETERMINISTIC — same (input, protocol) -> byte-identical output.
 *
 * THE EVIDENCE LAW here: only gaps with an evidence binding produce
 * candidates; gaps without bindings are skipped and the skip is RETAINED
 * (`skippedGapIds`). Every candidate's `measuredEvidence` and provenance
 * are DERIVED from the bound evidence (result-ref entries citing the
 * trajectories/trials/verdicts) — nothing is invented. Candidate order:
 * evidence strength DESC, then capabilityKey ASC (the deterministic
 * tie-break); ranks are 1-based positions in that order.
 */
export function runExtraction(input: unknown, protocol: ExtractionProtocol): SkillResult<ExtractionOutput> {
  if (!isExtractionProtocol(protocol)) {
    return { ok: false, errors: [invalidType('extraction protocol must satisfy the ExtractionProtocol contract (declared, versioned ranking)')] };
  }
  const inputResult = validateExtractionInput(input);
  if (!inputResult.ok) return inputResult;
  const validated = inputResult.value;
  if (validated.extractionVersion !== protocol.extractionVersion) {
    return fail(
      'invalid_field',
      `the extraction input pins protocol version "${validated.extractionVersion}" but the protocol declares "${protocol.extractionVersion}" — lineage coherence (L9)`,
      'extractionVersion',
    );
  }

  const bindingByGap = new Map<string, GapEvidenceBinding>();
  for (const binding of validated.bindings) bindingByGap.set(binding.gapId, binding);

  const skippedGapIds: CapabilityGapId[] = [];
  const ranked: readonly { skill: SkillRecord; strength: number }[] = (() => {
    const built: { skill: SkillRecord; strength: number }[] = [];
    for (const gap of validated.gapRecords) {
      const binding = bindingByGap.get(gap.gapId);
      if (binding === undefined) {
        // THE EVIDENCE LAW: no binding -> no candidate. The skip is RETAINED.
        skippedGapIds.push(gap.gapId);
        continue;
      }
      const strength = evidenceStrengthOf(
        binding,
        validated.trajectories,
        validated.trialOutcomes,
        validated.verdictEvidence,
        protocol.ranking,
      );
      const skill = buildCandidateSkill(validated, gap, binding);
      if (skill === null) continue; // unreachable: the draft is valid by construction; guarded defensively
      built.push({ skill, strength });
    }
    return built;
  })();

  // Deterministic ordering: strength DESC, then capabilityKey ASC, then id ASC.
  const ordered = [...ranked].sort((a, b) => {
    if (a.strength !== b.strength) return a.strength > b.strength ? -1 : 1;
    const keyA = a.skill.descriptor.capabilityKey;
    const keyB = b.skill.descriptor.capabilityKey;
    if (keyA !== keyB) return keyA < keyB ? -1 : 1;
    const idA = a.skill.skillId;
    const idB = b.skill.skillId;
    return idA < idB ? -1 : idA > idB ? 1 : 0;
  });
  const candidates: RankedSkillCandidate[] = ordered.map((entry, index) => ({
    skill: entry.skill,
    evidenceStrength: entry.strength,
    rank: index + 1,
  }));

  const inputDigest = stableDigest(canonicalExtractionInput(validated));
  const outputPayload = {
    candidates: candidates.map((candidate) => deepCloneJson(candidate.skill) as unknown as JsonValue),
    skippedGapIds: [...skippedGapIds],
  };
  const outputDigest = stableDigest(canonicalJson(outputPayload));
  return {
    ok: true,
    value: deepFreeze({
      candidates: deepFreeze([...candidates]),
      skippedGapIds: deepFreeze([...skippedGapIds]),
      inputDigest,
      outputDigest,
    }),
  };
}

/**
 * Builds one candidate skill record from a gap and its binding. The draft
 * is valid BY CONSTRUCTION (derived evidence, full lineage); the guarded
 * factory is still run so the record law is enforced on every code path.
 * Returns `null` only if the internally constructed draft somehow fails
 * validation (defensive — unreachable).
 */
function buildCandidateSkill(
  validated: ExtractionInput,
  gap: CapabilityGapMirror,
  binding: GapEvidenceBinding,
): SkillRecord | null {
  // The derived measured evidence (result-refs citing the bound streams):
  // L16a-clean (no labels), deterministic (bound order).
  const measured: MeasuredEvidence[] = [];
  for (const ref of binding.trajectoryRefs) {
    measured.push({ kind: 'result-ref', resultRef: `trajectory:${ref}` });
  }
  for (const ref of binding.trialRefs) {
    measured.push({ kind: 'result-ref', resultRef: `trial:${ref}` });
  }
  for (const ref of binding.verdictRefs) {
    measured.push({ kind: 'result-ref', resultRef: `verdict:${ref}` });
  }
  for (const ref of binding.attainmentEvidenceRefs) {
    measured.push({ kind: 'result-ref', resultRef: `attainment:${ref}` });
  }

  // The lineage evidence refs: the gap's own failure evidence + the
  // binding's attainment refs (both opaque evidence-capsule refs).
  const evidenceRefs: EvidenceRef[] = [
    gap.evidenceRef as unknown as EvidenceRef,
    ...binding.attainmentEvidenceRefs.map((ref) => ref as unknown as EvidenceRef),
  ];

  try {
    return createSkillRecord({
      skillId: deriveSkillRecordId(validated.extractionVersion, validated.seed, gap.gapId),
      artifactRef: deriveSkillArtifactRef(validated.extractionVersion, validated.seed, gap.gapId),
      descriptor: {
        capabilityKey: gap.capabilityKey,
        summary: `Skill addressing the ${gap.kind} failure class for the "${gap.capabilityKey}" capability contract, extracted from recorded evidence (trajectories, trials and attainment verdicts bound by upstream failure analysis).`,
        measuredEvidence: measured,
        capabilityRecordRefs: [],
      },
      provenance: {
        trajectoryRefs: [...binding.trajectoryRefs],
        experimentRefs: [...binding.experimentRefs],
        trialRefs: [...binding.trialRefs],
        attainmentEvidenceRefs: [
          ...binding.attainmentEvidenceRefs,
          ...binding.verdictRefs.map((ref) => `verdict:${ref}` as unknown as AttainmentEvidenceRef),
        ],
        origin: 'recorded-experience',
      },
      applicability: {
        environmentProfileRefs: [],
        instrumentClassRefs: [],
      },
      version: 1,
      lineage: {
        parentSkillRef: null,
        evidenceRefs,
        gapRefs: [gap.gapId],
        extractionVersion: validated.extractionVersion,
        seed: validated.seed,
        tenantId: validated.tenantId,
        projectId: validated.projectId,
        extractedAt: validated.extractedAt,
      },
    });
  } catch {
    return null;
  }
}
