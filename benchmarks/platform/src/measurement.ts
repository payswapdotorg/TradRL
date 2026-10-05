/**
 * @tradrl/benchmarks-platform — the MEASUREMENT RUNNER (Work Order T049):
 * the platform machinery that MEASURES a subject against a capability
 * suite and compiles the content-addressed measurement record.
 *
 * Spec anchors: spec/CAPABILITY-DISCOVERY.md step 6 ("Benchmark candidates
 * on task-specific capability suites") + the Reproducibility section
 * ("Record candidate roles, bodies, models, benchmarks, datasets,
 * configuration, cost, latency, environment, outcomes and rejected
 * candidates"), spec/EVALUATION-PROTOCOL.md ("Simulation evidence and live
 * evidence are never conflated"; "Retain search histories and DISTINGUISH
 * IN-SEARCH PERFORMANCE FROM HOLDOUT PERFORMANCE"), ARCHITECTURE-LOCK
 * L4/L5/L7/L9/L11/L12/L15/L16/L16a/L20.
 *
 * THE RUN LAWS (each typed, fail-closed, each negative-tested):
 * 1. THE SUITE LAW — the suite verifies through the mirrored validator
 *    (structure + the axis laws + the content-address law; L9).
 * 2. THE SUBJECT LAW — the subject binding is the full L9 lineage
 *    (artifact address + body/substrate/environment/runtime/config refs)
 *    and its kind agrees with the suite's (`subject_kind_mismatch`).
 * 3. THE EVIDENCE LAW — the measured artifact IS the subject kind's
 *    evidence shape (the T048 SliceReport mirror; `invalid_evidence`), it
 *    is PIPELINE-COHERENT (the station invariants;
 *    `pipeline_incoherent`), and its content address equals the subject's
 *    pinned artifact digest (`evidence_mismatch` — the measurement never
 *    measures material it cannot name).
 * 4. THE CLASS LAW — the suite's evidence class agrees with the material
 *    (`live_claim_on_simulation` / `evidence_conflated`; L5/L6).
 * 5. THE PHASE LAWS (the T032 split discipline):
 *    - an 'in-search' measurement never measures reserved unseen material
 *      (`holdout_in_search`);
 *    - a 'holdout' measurement scores reserved material only
 *      (`search_material_in_holdout`), binds the search record it judges
 *      (`search_context_required`) with a verified chain
 *      (`chain_mismatch`), a logged trial (`unknown_trial`) and an
 *      agreeing classification (`classification_conflict`);
 *    - a holdout measurement NEVER draws its unseen material from a
 *      generative population (`synthetic_holdout` — the T031/T028 law:
 *      synthetic data is exploration, never unseen holdout evidence).
 * 6. THE MEASUREMENT LAW — every axis extracts from the closed measurable
 *    vocabulary (`unknown_measurable`), decimal values sit at their exact
 *    declared scale (`scale_mismatch`), and the attainment fold judges
 *    every criterion-carrying axis (attained = judged AND every judgment
 *    passed).
 *
 * DETERMINISM: the runner is pure and total — the same (suite, subject,
 * evidence, material, search context, plan, instant) always yields the
 * BYTE-IDENTICAL record (the publication layer's re-verification relies
 * on exactly this).
 */

import { canonicalJson, deepFreeze, isRecord, isTimestampMs, stableDigestJson } from './primitives';
import type { JsonObject, JsonValue, TimestampMs } from './primitives';
import { isProjectId, isTenantId } from './ids';
import type { EvaluatorVersionRef, ProjectId, TenantId } from './ids';
import { compareDecimals } from './decimals';
import type { DecimalString } from './decimals';
import { fail, invalidField, invalidType, missingField, ok, type PlatformError, type PlatformResult } from './errors';
import { validateSuiteDefinition, validateSubjectBinding, suiteDigest } from './suite';
import type { SuiteDefinition, SubjectBinding, SuiteAxis } from './suite';
import { isSliceReportShape, slicePipelineViolations } from './slice-mirror';
import type { SliceReportMirror } from './slice-mirror';
import { extractSliceMeasurable } from './metrics';
import type { AxisKind, AxisValue } from './metrics';
import { verifySearchRecordLineage } from './search-mirror';
import type { SearchRecordMirror } from './search-mirror';
import { verifySplitPlanMirror, splitPlanDigest } from './split-mirror';
import type { SplitPlanMirror } from './split-mirror';
import { checkEvidenceClass, isMaterialSource, materialDigest, materialKind, materialOrigin } from './material';
import type { EvidenceClass, MaterialSource, SourceKind, SourceOrigin } from './material';

// ---------------------------------------------------------------------------
// The measurement record
// ---------------------------------------------------------------------------

/** The measurement phases (the T031/T032 vocabulary). */
export const MEASUREMENT_PHASES = ['in-search', 'holdout'] as const;

/** One measurement phase. */
export type MeasurementPhase = (typeof MEASUREMENT_PHASES)[number];

/** Guard: a measurement phase. */
export function isMeasurementPhase(v: unknown): v is MeasurementPhase {
  return typeof v === 'string' && (MEASUREMENT_PHASES as readonly string[]).includes(v);
}

/** One measured axis: the extracted value + the attainment judgment (null = no criterion declared). */
export interface AxisMeasurement {
  readonly axis: string;
  readonly kind: AxisKind;
  /** count: number; decimal: exact string at the axis scale; digest: hex string; flag: boolean. */
  readonly value: string | number | boolean;
  /** The attainment judgment against the suite's criterion; null when the axis is open (record-only). */
  readonly attained: boolean | null;
}

/** The measurement's material binding (the content-addressed source block). */
export interface MeasurementMaterial {
  readonly source_id: string;
  readonly source_digest: string;
  readonly kind: SourceKind;
  readonly origin: SourceOrigin;
}

/** The measurement's search binding (holdout and in-search measurements that judge a search). */
export interface MeasurementSearchBinding {
  readonly record_id: string;
  readonly trial: string;
}

/** A compiled measurement record: every axis value + full lineage, content-addressed. */
export interface MeasurementRecord {
  /** Derived identity: `cbmm:<digest over the canonical measurement content>`. */
  readonly measurement_id: string;
  readonly suite: string;
  /** The suite's stable name (what T045 benchmark requirements cite). */
  readonly suite_name: string;
  readonly suite_digest: string;
  /** The suite's versioned evaluator (L9 — rides the record so every consumer binds it). */
  readonly evaluator: EvaluatorVersionRef;
  readonly subject: SubjectBinding;
  readonly phase: MeasurementPhase;
  readonly evidence_class: EvidenceClass;
  readonly material: MeasurementMaterial;
  readonly plan: { readonly plan_id: string; readonly plan_digest: string } | null;
  readonly search: MeasurementSearchBinding | null;
  readonly axes: readonly AxisMeasurement[];
  /** The attainment fold: at least one criterion judged AND every judgment passed. */
  readonly attained: boolean;
  /** The INJECTED measurement instant (L4). */
  readonly recorded_at: TimestampMs;
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

/** The canonical measurement JSON (the content-addressing input; no `measurement_id`). */
export function measurementContentJson(record: Omit<MeasurementRecord, 'measurement_id'>): JsonObject {
  return {
    suite: record.suite,
    suite_name: record.suite_name,
    suite_digest: record.suite_digest,
    evaluator: record.evaluator,
    subject: record.subject as unknown as JsonObject,
    phase: record.phase,
    evidence_class: record.evidence_class,
    material: record.material as unknown as JsonObject,
    plan: record.plan as unknown as JsonObject | null,
    search: record.search as unknown as JsonObject | null,
    axes: record.axes as unknown as readonly JsonValue[],
    attained: record.attained,
    recorded_at: record.recorded_at,
    tenant: record.tenant,
    project: record.project,
  };
}

/** Compute the content address of a measurement: `cbmm:<digest>`. */
export function measurementId(content: Omit<MeasurementRecord, 'measurement_id'>): string {
  return `cbmm:${stableDigestJson(measurementContentJson(content))}`;
}

/** The canonical JSON bytes of a measurement record (the determinism + re-verification anchor). */
export function canonicalMeasurement(record: MeasurementRecord): string {
  return canonicalJson(record as unknown as JsonObject);
}

// ---------------------------------------------------------------------------
// The run input
// ---------------------------------------------------------------------------

/** The search context: the verified search record plus the trial this measurement belongs to. */
export interface SearchContext {
  readonly record: SearchRecordMirror;
  readonly trial: string;
}

/** The run input: the suite, the subject, the evidence, the material, the phase context and the injected instant. */
export interface MeasurementRunInput {
  readonly suite: SuiteDefinition;
  readonly subject: SubjectBinding;
  readonly evidence: SliceReportMirror;
  readonly material: MaterialSource;
  readonly phase: MeasurementPhase;
  readonly search: SearchContext | null;
  readonly plan: SplitPlanMirror | null;
  readonly measured_at: TimestampMs;
}

// ---------------------------------------------------------------------------
// The attainment judgment (pure)
// ---------------------------------------------------------------------------

/** Judge one axis value against its criterion. null when the axis is open. */
function judgeAxis(axis: SuiteAxis, value: AxisValue): boolean | null {
  const attainment = axis.attainment;
  const hasCriterion = attainment.min !== undefined || attainment.max !== undefined || attainment.equals !== undefined;
  if (!hasCriterion) return null;
  if (attainment.equals !== undefined) {
    if (value.kind === 'flag') return value.value === attainment.equals;
    if (value.kind === 'digest') return value.value === attainment.equals;
    return value.value === attainment.equals; // count: number === number; decimal: exact string equality at scale
  }
  if (value.kind === 'count') {
    const numeric = value.value;
    if (attainment.min !== undefined && numeric < (attainment.min as number)) return false;
    if (attainment.max !== undefined && numeric > (attainment.max as number)) return false;
    return true;
  }
  if (value.kind === 'decimal') {
    const decimal = value.value as DecimalString;
    if (attainment.min !== undefined && compareDecimals(decimal, attainment.min as string) < 0) return false;
    if (attainment.max !== undefined && compareDecimals(decimal, attainment.max as string) > 0) return false;
    return true;
  }
  return false; // digest/flag axes carry equals-or-open only (the suite validator enforces it)
}

// ---------------------------------------------------------------------------
// The phase/material intersection law
// ---------------------------------------------------------------------------

/** The material's coverage window (replay/live sources are windowed; populations are not). */
function materialWindow(material: MaterialSource): { readonly start: number; readonly end: number } | null {
  if (material.kind === 'replay-dataset') return (material as { coverage: { start: number; end: number } }).coverage;
  if (material.kind === 'live-session') return (material as { captured: { start: number; end: number } }).captured;
  return null;
}

/** Half-open window intersection. */
function windowsIntersect(a: { readonly start: number; readonly end: number }, b: { readonly start: number; readonly end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Is the material's window fully inside the union of the reserved segments' windows? */
function windowInsideReserved(window: { readonly start: number; readonly end: number }, plan: SplitPlanMirror): boolean {
  const reserved = plan.holdout?.segments ?? [];
  if (reserved.length === 0) return false;
  // Sort reserved windows by start; the material must be covered by their union.
  const sorted = [...reserved].sort((x, y) => x.start - y.start);
  let cursor = window.start;
  for (const segment of sorted) {
    if (segment.end <= cursor) continue;
    if (segment.start > cursor) return false; // a gap before coverage completes
    cursor = segment.end;
    if (cursor >= window.end) return true;
  }
  return cursor >= window.end;
}

// ---------------------------------------------------------------------------
// The runner (pure, total, fail-closed)
// ---------------------------------------------------------------------------

/**
 * RUN one capability-suite measurement: verify the suite, the subject, the
 * evidence, the class and the phase laws, extract every axis from the
 * evidence through the closed measurable vocabulary, judge the attainment
 * criteria, and compile the content-addressed measurement record with the
 * full L9/L12 lineage. Deterministic and pure: the same inputs always
 * yield the byte-identical record.
 */
export function runSuiteMeasurement(input: unknown): PlatformResult<MeasurementRecord> {
  if (!isRecord(input)) {
    return { ok: false, errors: [invalidType('measurement input must be an object')] };
  }

  // --- The suite law ----------------------------------------------------------
  if (input.suite === undefined) {
    return { ok: false, errors: [missingField('suite')] };
  }
  const suiteResult = validateSuiteDefinition(input.suite);
  if (!suiteResult.ok) return suiteResult;
  const suite = suiteResult.value;

  // --- The subject law ----------------------------------------------------------
  if (input.subject === undefined) {
    return { ok: false, errors: [missingField('subject')] };
  }
  const subjectResult = validateSubjectBinding(input.subject);
  if (!subjectResult.ok) return subjectResult;
  const subject = subjectResult.value;
  if (subject.kind !== suite.subject_kind) {
    return fail(
      'subject_kind_mismatch',
      `the subject binding's kind "${subject.kind}" disagrees with suite "${suite.name}"'s subject kind "${suite.subject_kind}" — a suite measures the kind it was designed for`,
      'subject.kind',
    );
  }

  // --- The evidence law ----------------------------------------------------------
  if (input.evidence === undefined) {
    return { ok: false, errors: [missingField('evidence')] };
  }
  if (!isSliceReportShape(input.evidence)) {
    return fail('invalid_evidence', 'the measured evidence must be a structurally valid reference-slice report (the T048 SliceReport mirror)', 'evidence');
  }
  const evidence = input.evidence as SliceReportMirror;
  const violations = slicePipelineViolations(evidence);
  if (violations.length > 0) {
    return fail(
      'pipeline_incoherent',
      `the reference-slice evidence violates its own station invariants: ${violations.join('; ')}`,
      'evidence',
    );
  }
  const evidenceDigest = stableDigestJson(evidence as unknown as JsonObject);
  const pinnedArtifact = subject.artifacts[0];
  if (pinnedArtifact === undefined || pinnedArtifact.digest !== evidenceDigest) {
    return fail(
      'evidence_mismatch',
      `the subject pins artifact digest "${pinnedArtifact?.digest ?? '<none>'}" but the evidence content addresses to "${evidenceDigest}" — the measurement never measures material it cannot name (L9)`,
      'subject.artifacts[0].digest',
    );
  }

  // --- The class law ----------------------------------------------------------
  if (input.material === undefined) {
    return { ok: false, errors: [missingField('material')] };
  }
  if (!isMaterialSource(input.material)) {
    return { ok: false, errors: [invalidField('material', 'must be a replay dataset, a generative regime population or a live session source')] };
  }
  const material = input.material as MaterialSource;
  const classCheck = checkEvidenceClass(suite.evidence_class, material);
  if (!classCheck.ok) {
    return fail(classCheck.code, classCheck.message, 'material');
  }

  // --- The instant law (L4) ------------------------------------------------------
  if (input.measured_at === undefined) {
    return { ok: false, errors: [missingField('measured_at')] };
  }
  if (!isTimestampMs(input.measured_at)) {
    return { ok: false, errors: [invalidField('measured_at', 'must be a valid TimestampMs (the injected measurement instant, L4)')] };
  }
  const measuredAt = input.measured_at as TimestampMs;

  // --- The phase laws (the T032 split discipline) --------------------------------
  if (input.phase === undefined) {
    return { ok: false, errors: [missingField('phase')] };
  }
  if (!isMeasurementPhase(input.phase)) {
    return { ok: false, errors: [invalidField('phase', `must be one of ${MEASUREMENT_PHASES.join(' | ')}`)] };
  }
  const phase = input.phase as MeasurementPhase;

  let search: MeasurementSearchBinding | null = null;
  if (input.search !== undefined && input.search !== null) {
    if (!isRecord(input.search)) {
      return { ok: false, errors: [invalidField('search', 'must be { record, trial } or null')] };
    }
    const verified = verifySearchRecordLineage(input.search.record);
    if (!verified.ok) return verified;
    const record = verified.value;
    if (input.search.trial === undefined || typeof input.search.trial !== 'string' || (input.search.trial as string).length === 0) {
      return { ok: false, errors: [missingField('search.trial')] };
    }
    const trial = input.search.trial as string;
    if (record.tenant !== suite.tenant || record.project !== suite.project) {
      return fail(
        'tenant_mismatch',
        `search record "${record.search_id}" is scoped to tenant "${record.tenant}"/project "${record.project}" but suite "${suite.name}" is scoped to "${suite.tenant}"/"${suite.project}" — a measurement never crosses tenants or projects (L12)`,
        'search.record',
      );
    }
    const entry = record.entries.find((candidate) => candidate.trial === trial);
    if (entry === undefined) {
      return fail('unknown_trial', `search record "${record.search_id}" does not log trial "${trial}" — the measurement cannot bind a trial the search never recorded`, 'search.trial');
    }
    if (entry.classification !== phase) {
      return fail(
        'classification_conflict',
        `measurement phase "${phase}" disagrees with the search record's classification of trial "${trial}" as "${entry.classification}" — the record is the authority on the in-search/holdout distinction (L11)`,
        'phase',
      );
    }
    search = deepFreeze({ record_id: record.search_id, trial });
  }

  let plan: SplitPlanMirror | null = null;
  if (input.plan !== undefined && input.plan !== null) {
    const planResult = verifySplitPlanMirror(input.plan);
    if (!planResult.ok) return planResult;
    plan = planResult.value;
  }

  if (phase === 'holdout') {
    if (search === null) {
      return fail(
        'search_context_required',
        `holdout measurement for suite "${suite.name}" carries no search context — holdout evidence always judges a search (L10/L11); bind the search record and trial it evaluates`,
        'search',
      );
    }
    if (plan === null) {
      return fail(
        'search_context_required',
        `holdout measurement for suite "${suite.name}" carries no split plan — unseen material must be RESERVED by a plan the search never touched; an unreserved holdout claim is not holdout evidence (R20/R21)`,
        'plan',
      );
    }
    if (material.kind === 'generative-population') {
      return fail(
        'synthetic_holdout',
        `holdout measurement for suite "${suite.name}" draws its unseen material from generative population "${material.source_id}" — generative worlds are exploration instruments, never unseen holdout evidence (L5; the T031/T028 complementary laws)`,
        'material',
      );
    }
    const window = materialWindow(material);
    if (window !== null && !windowInsideReserved(window, plan)) {
      return fail(
        'search_material_in_holdout',
        `holdout measurement for suite "${suite.name}" runs over material that is not reserved unseen material of plan "${plan.plan_id}" — a holdout measurement judges the reserved reservoir only`,
        'material',
      );
    }
  } else {
    if (plan !== null) {
      const window = materialWindow(material);
      if (window !== null) {
        const reserved = plan.holdout?.segments ?? [];
        for (const segment of reserved) {
          if (windowsIntersect(window, segment)) {
            return fail(
              'holdout_in_search',
              `in-search measurement for suite "${suite.name}" runs over material that intersects reserved unseen segment "${segment.ref}" — a benchmark run that scores a holdout window inside a search loop is a typed error (R20/R21)`,
              'material',
            );
          }
        }
      }
    }
  }

  // --- The measurement law --------------------------------------------------------
  const axes: AxisMeasurement[] = [];
  for (const axis of suite.axes) {
    const extracted = extractSliceMeasurable(evidence, axis.measurable);
    if (extracted === undefined) {
      return fail('unknown_measurable', `axis "${axis.axis}" references measurable "${axis.measurable}" outside the reference-slice vocabulary`, `axes[${axis.axis}]`);
    }
    if (extracted.kind !== axis.kind) {
      return fail('axis_mismatch', `axis "${axis.axis}" declared kind "${axis.kind}" but the measurable "${axis.measurable}" extracts kind "${extracted.kind}"`, `axes[${axis.axis}]`);
    }
    if (axis.kind === 'decimal') {
      // The axis's DECLARED exact scale (the suite validator guarantees a
      // non-negative integer here — the measurable's own scale when the
      // value's scale is a law of the artifact, the axis's declaration when
      // the scale is the artifact's own arithmetic, e.g. the book money).
      const scale = axis.scale ?? 0;
      const value = extracted.value as string;
      const dot = value.indexOf('.');
      const actualScale = dot === -1 ? 0 : value.length - dot - 1;
      if (actualScale !== scale) {
        return fail('scale_mismatch', `axis "${axis.axis}" measured decimal "${value}" at scale ${actualScale} but the axis's declared exact scale is ${scale}`, `axes[${axis.axis}]`);
      }
    }
    axes.push({ axis: axis.axis, kind: axis.kind, value: extracted.value, attained: judgeAxis(axis, extracted) });
  }
  const judged = axes.filter((axis) => axis.attained !== null);
  const attained = judged.length > 0 && judged.every((axis) => axis.attained === true);

  // --- The record --------------------------------------------------------------
  const content: Omit<MeasurementRecord, 'measurement_id'> = {
    suite: suite.suite_id,
    suite_name: suite.name,
    suite_digest: suiteDigest(suite),
    evaluator: suite.evaluator,
    subject,
    phase,
    evidence_class: suite.evidence_class,
    material: deepFreeze({
      source_id: material.source_id,
      source_digest: materialDigest(material),
      kind: materialKind(material),
      origin: materialOrigin(material),
    }),
    plan: plan === null ? null : deepFreeze({ plan_id: plan.plan_id, plan_digest: splitPlanDigest(plan) }),
    search,
    axes: deepFreeze(axes),
    attained,
    recorded_at: measuredAt,
    tenant: suite.tenant,
    project: suite.project,
  };
  return ok(deepFreeze({ measurement_id: measurementId(content), ...content } satisfies MeasurementRecord));
}

// ---------------------------------------------------------------------------
// The record verifier (the publication layer's gate + the log's append law)
// ---------------------------------------------------------------------------

/**
 * VERIFY a measurement record: the structural law plus the L9
 * content-address law (the recorded `measurement_id` must equal the digest
 * of the canonical content AS STORED — a mutated field breaks it). The
 * phase/evidence laws were enforced at the run and are NOT re-derived
 * here; this is the boundary check for records arriving from outside.
 */
export function verifyMeasurementRecord(value: unknown, path = 'measurement'): PlatformResult<MeasurementRecord> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: PlatformError[] = [];
  if (value.measurement_id === undefined) errors.push(missingField(`${path}.measurement_id`));
  else if (typeof value.measurement_id !== 'string' || !value.measurement_id.startsWith('cbmm:')) {
    errors.push(invalidField(`${path}.measurement_id`, 'must be a measurement id ("cbmm:<digest>")'));
  }
  if (value.suite === undefined || typeof value.suite !== 'string' || !value.suite.startsWith('cbms:')) {
    errors.push(invalidField(`${path}.suite`, 'must be a suite id ("cbms:<digest>")'));
  }
  if (value.suite_name === undefined || typeof value.suite_name !== 'string' || (value.suite_name as string).length === 0) {
    errors.push(invalidField(`${path}.suite_name`, 'must be a non-empty suite name'));
  }
  if (value.suite_digest === undefined || typeof value.suite_digest !== 'string') {
    errors.push(missingField(`${path}.suite_digest`));
  }
  if (value.evaluator === undefined || typeof value.evaluator !== 'string' || (value.evaluator as string).length === 0) {
    errors.push(invalidField(`${path}.evaluator`, 'must be a non-empty evaluator version ref (L9)'));
  }
  const subjectResult = validateSubjectBinding(value.subject, `${path}.subject`);
  if (!subjectResult.ok) errors.push(...subjectResult.errors);
  if (value.phase === undefined || !isMeasurementPhase(value.phase)) {
    errors.push(invalidField(`${path}.phase`, `must be one of ${MEASUREMENT_PHASES.join(' | ')}`));
  }
  if (value.evidence_class === undefined || (value.evidence_class !== 'simulation' && value.evidence_class !== 'live')) {
    errors.push(invalidField(`${path}.evidence_class`, "must be 'simulation' or 'live'"));
  }
  if (!isRecord(value.material) || typeof value.material.source_id !== 'string' || typeof value.material.source_digest !== 'string') {
    errors.push(invalidField(`${path}.material`, 'must carry source_id and source_digest'));
  }
  if (value.plan !== null && value.plan !== undefined && (!isRecord(value.plan) || typeof value.plan.plan_id !== 'string' || typeof value.plan.plan_digest !== 'string')) {
    errors.push(invalidField(`${path}.plan`, 'must be { plan_id, plan_digest } or null'));
  }
  if (value.search !== null && value.search !== undefined && (!isRecord(value.search) || typeof value.search.record_id !== 'string' || typeof value.search.trial !== 'string')) {
    errors.push(invalidField(`${path}.search`, 'must be { record_id, trial } or null'));
  }
  if (!Array.isArray(value.axes) || value.axes.length === 0) {
    errors.push(invalidField(`${path}.axes`, 'must be a non-empty array of axis measurements'));
  } else {
    for (let index = 0; index < (value.axes as readonly unknown[]).length; index++) {
      const axis = (value.axes as readonly unknown[])[index];
      if (!isRecord(axis) || typeof axis.axis !== 'string' || (axis.attained !== null && typeof axis.attained !== 'boolean')) {
        errors.push(invalidField(`${path}.axes[${index}]`, 'must carry axis, kind, value and attained'));
      }
    }
  }
  if (typeof value.attained !== 'boolean') {
    errors.push(invalidField(`${path}.attained`, 'must be a boolean (the attainment fold)'));
  }
  if (value.recorded_at === undefined || !isTimestampMs(value.recorded_at)) {
    errors.push(invalidField(`${path}.recorded_at`, 'must be a valid TimestampMs (L4)'));
  }
  if (value.tenant === undefined || !isTenantId(value.tenant)) {
    errors.push(invalidField(`${path}.tenant`, 'must be a non-empty tenant id (L12)'));
  }
  if (value.project === undefined || !isProjectId(value.project)) {
    errors.push(invalidField(`${path}.project`, 'must be a non-empty project id (L15)'));
  }
  if (errors.length > 0) return { ok: false, errors };

  const record = value as unknown as MeasurementRecord;
  const { measurement_id: _drop, ...content } = record;
  const derivedId = measurementId(content as Omit<MeasurementRecord, 'measurement_id'>);
  if (record.measurement_id !== derivedId) {
    return fail(
      'measurement_mismatch',
      `measurement id "${record.measurement_id}" does not match the content's address "${derivedId}" — content and address cannot disagree (L9)`,
      `${path}.measurement_id`,
    );
  }
  return ok(deepFreeze({ ...record } satisfies MeasurementRecord));
}
