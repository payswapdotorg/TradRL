/**
 * @tradrl/benchmarks-platform — the CAPABILITY-SUITE DEFINITION (Work
 * Order T049).
 *
 * WHAT A SUITE IS: the declared, content-addressed design of one
 * benchmark — the platform machinery's own measured-evidence language
 * (CAPABILITY-DISCOVERY step 6: "Benchmark candidates on task-specific
 * capability suites"). A suite declares:
 * - its NAME (the stable identity T045's benchmark requirements cite —
 *   the content-addressed suite id changes with the axes, the name does
 *   not);
 * - its SUBJECT KIND (what gets measured: the platform's own reference
 *   slice, or a capability candidate running it);
 * - its AXES: the measured measurables with their kinds, exact scales and
 *   ATTAINMENT CRITERIA (bounds for counts/decimals, an exact expectation
 *   for digests/flags, or an open criterion that records without judging);
 * - its evidence class (simulation | live — never conflated);
 * - its evaluator version (L9);
 * - its scope (tenant/project — L12).
 *
 * THE AXIS LAWS (each typed, each negative-tested):
 * - `unknown_measurable` — an axis must reference a measurable of its
 *   subject kind's CLOSED vocabulary (a suite is DATA; it can only
 *   measure what the machinery extracts honestly).
 * - `axis_mismatch` — the axis's declared kind must equal the
 *   measurable's kind, and a decimal axis's declared scale must equal the
 *   measurable's scale.
 * - duplicate axis names are refused; at least one axis is required.
 * - An attainment criterion must match its kind (min/max/equals laws).
 *
 * The suite id is content-addressed (`cbms:<digest>` over the canonical
 * suite content) — identical designs address identically (L9).
 */

import { deepFreeze, isDigest, isMemberOf, isNonEmptyString, isNonNegativeInteger, isPositiveInteger, isRecord, stableDigestJson } from './primitives';
import type { JsonObject, JsonValue } from './primitives';
import { isEvaluatorVersionRef, isProjectId, isTenantId } from './ids';
import type { EvaluatorVersionRef, ProjectId, TenantId } from './ids';
import { isDecimalAtScale, compareDecimals, isSignedDecimal } from './decimals';
import type { DecimalString } from './decimals';
import { AXIS_KINDS, isAxisKind, sliceMeasurableOf } from './metrics';
import type { AxisKind } from './metrics';
import { isEvidenceClass } from './material';
import type { EvidenceClass } from './material';
import { fail, invalidField, invalidType, missingField, ok, type PlatformError, type PlatformResult } from './errors';

// ---------------------------------------------------------------------------
// The subject kinds
// ---------------------------------------------------------------------------

/** The subject kinds this machinery measures. */
export const SUBJECT_KINDS = ['reference-slice', 'capability-candidate'] as const;

/** One subject kind. */
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

/** Guard: a subject kind. */
export function isSubjectKind(v: unknown): v is SubjectKind {
  return isMemberOf(SUBJECT_KINDS, v);
}

// ---------------------------------------------------------------------------
// The subject binding (the L9 lineage block)
// ---------------------------------------------------------------------------

/** The closed subject-lineage ref kinds (the L9 binding vocabulary). */
export const SUBJECT_REF_KINDS = ['artifact', 'body', 'substrate', 'environment', 'runtime', 'config'] as const;

/** One subject-lineage ref kind. */
export type SubjectRefKind = (typeof SUBJECT_REF_KINDS)[number];

/** Guard: a subject-ref kind. */
export function isSubjectRefKind(v: unknown): v is SubjectRefKind {
  return isMemberOf(SUBJECT_REF_KINDS, v);
}

/**
 * The measured subject's full L9 binding: the artifact's content address
 * (what was measured) plus the complete lineage refs — the body, the
 * substrate, the environment, the runtime, the configuration. Every ref
 * is a content address into its owning store; the benchmark NEVER carries
 * the referenced material itself (that is the publication layer's law,
 * and the tenant's data stays the tenant's).
 */
export interface SubjectBinding {
  readonly kind: SubjectKind;
  /** The measured artifact (e.g. the SliceReport) — its ref and its content digest. */
  readonly artifacts: readonly { readonly ref: string; readonly digest: string }[];
  /** The body the subject ran as (L9; opaque ref, non-empty). */
  readonly body: string;
  /** The cognitive substrate that possessed the body (L9; opaque ref, non-empty). */
  readonly substrate: string;
  /** The environment profile the run used (L9; opaque ref, non-empty). */
  readonly environment: string;
  /** The runtime the run executed on (L9; opaque ref, non-empty). */
  readonly runtime: string;
  /** The configuration the run loaded (L9; opaque ref, non-empty). */
  readonly config: string;
}

/** Guard: `SubjectBinding`. */
export function isSubjectBinding(v: unknown): v is SubjectBinding {
  if (!isRecord(v)) return false;
  if (!isSubjectKind(v.kind)) return false;
  if (!Array.isArray(v.artifacts) || v.artifacts.length === 0) return false;
  for (const artifact of v.artifacts as readonly unknown[]) {
    if (!isRecord(artifact)) return false;
    if (!isNonEmptyString(artifact.ref) || !isDigest(artifact.digest)) return false;
  }
  const refs = (v.artifacts as readonly { ref: string }[]).map((artifact) => artifact.ref);
  if (new Set(refs).size !== refs.length) return false;
  return isNonEmptyString(v.body) && isNonEmptyString(v.substrate) && isNonEmptyString(v.environment) && isNonEmptyString(v.runtime) && isNonEmptyString(v.config);
}

/** Collect-all validation of an untrusted subject binding. */
export function validateSubjectBinding(value: unknown, path = 'subject'): PlatformResult<SubjectBinding> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: PlatformError[] = [];
  if (value.kind === undefined) errors.push(missingField(`${path}.kind`));
  else if (!isSubjectKind(value.kind)) errors.push(invalidField(`${path}.kind`, `must be one of ${SUBJECT_KINDS.join(' | ')}`));
  if (value.artifacts === undefined) errors.push(missingField(`${path}.artifacts`));
  else if (!Array.isArray(value.artifacts) || value.artifacts.length === 0) {
    errors.push(invalidField(`${path}.artifacts`, 'must be a non-empty array of { ref, digest } artifact addresses'));
  } else {
    for (let index = 0; index < (value.artifacts as readonly unknown[]).length; index++) {
      const artifact = (value.artifacts as readonly unknown[])[index];
      if (!isRecord(artifact) || !isNonEmptyString(artifact.ref) || !isDigest(artifact.digest)) {
        errors.push(invalidField(`${path}.artifacts[${index}]`, 'must carry a non-empty ref and a 16-hex digest'));
      }
    }
    const refs = (value.artifacts as readonly { ref?: unknown }[]).filter((a) => isNonEmptyString(a.ref)).map((a) => a.ref as string);
    if (refs.length > 0 && new Set(refs).size !== refs.length) {
      errors.push(invalidField(`${path}.artifacts`, 'must not repeat an artifact ref'));
    }
  }
  for (const field of ['body', 'substrate', 'environment', 'runtime', 'config'] as const) {
    if (value[field] === undefined) errors.push(missingField(`${path}.${field}`));
    else if (!isNonEmptyString(value[field])) errors.push(invalidField(`${path}.${field}`, 'must be a non-empty lineage ref (L9)'));
  }
  if (errors.length > 0) return { ok: false, errors };
  return ok(deepFreeze({ ...(value as object) } as SubjectBinding));
}

// ---------------------------------------------------------------------------
// The suite axes
// ---------------------------------------------------------------------------

/** The attainment criterion of one axis: bounds, an exact expectation, or open (record-only). */
export interface AxisAttainment {
  /** Inclusive lower bound (count/decimal kinds). */
  readonly min?: DecimalString | number;
  /** Inclusive upper bound (count/decimal kinds). */
  readonly max?: DecimalString | number;
  /** The exact expected value (digest: hex string; flag: boolean; count/decimal: exact value). */
  readonly equals?: string | number | boolean;
}

/** One suite axis: the measured measurable, its kind/scale and its attainment criterion. */
export interface SuiteAxis {
  /** The axis's identity within the suite (unique, non-empty). */
  readonly axis: string;
  /** The measurable this axis extracts (the subject kind's closed vocabulary). */
  readonly measurable: string;
  /** The axis kind — must equal the measurable's kind. */
  readonly kind: AxisKind;
  /** The decimal scale (decimal axes only; must equal the measurable's scale). */
  readonly scale: number | null;
  /** The attainment criterion (absent fields = unbounded/open on that dimension). */
  readonly attainment: AxisAttainment;
}

/** Guard: `AxisAttainment` (the kind laws). */
export function isAxisAttainment(v: unknown, kind: AxisKind): v is AxisAttainment {
  if (!isRecord(v)) return false;
  const hasMin = v.min !== undefined;
  const hasMax = v.max !== undefined;
  const hasEquals = v.equals !== undefined;
  if (hasEquals && hasMin) return false;
  if (hasEquals && hasMax) return false;
  if (hasEquals) {
    if (kind === 'flag') return typeof v.equals === 'boolean';
    if (kind === 'digest') return typeof v.equals === 'string' && /^[0-9a-f]{8,16}$/.test(v.equals);
    if (kind === 'count') return typeof v.equals === 'number' && Number.isInteger(v.equals) && v.equals >= 0;
    return isSignedDecimal(v.equals);
  }
  if (hasMin) {
    if (kind === 'count' && !(typeof v.min === 'number' && Number.isInteger(v.min) && v.min >= 0)) return false;
    if (kind === 'decimal' && !isSignedDecimal(v.min)) return false;
    if (kind === 'digest' || kind === 'flag') return false;
  }
  if (hasMax) {
    if (kind === 'count' && !(typeof v.max === 'number' && Number.isInteger(v.max) && v.max >= 0)) return false;
    if (kind === 'decimal' && !isSignedDecimal(v.max)) return false;
    if (kind === 'digest' || kind === 'flag') return false;
  }
  if (hasMin && hasMax) {
    if (kind === 'count' && (v.min as number) > (v.max as number)) return false;
    if (kind === 'decimal' && compareDecimals(v.min as string, v.max as string) > 0) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// The suite definition
// ---------------------------------------------------------------------------

/**
 * The capability-suite definition — content-addressed (`cbms:<digest>`).
 * The stable NAME is what T045 benchmark requirements cite; the id pins
 * the exact design.
 */
export interface SuiteDefinition {
  /** Derived identity: `cbms:<digest over the canonical suite content>`. */
  readonly suite_id: string;
  /** The stable suite identity (e.g. 'reference-slice-platform-v1') — cited by T045 benchmark requirements. */
  readonly name: string;
  readonly subject_kind: SubjectKind;
  /** The suite's ONE evidence class (never conflated with the material's). */
  readonly evidence_class: EvidenceClass;
  readonly evaluator: EvaluatorVersionRef;
  readonly axes: readonly SuiteAxis[];
  /** The declaring scope (L12) — a suite never crosses tenants. */
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

/** The canonical suite JSON (the content-addressing input; no `suite_id`). */
export function suiteContentJson(suite: Omit<SuiteDefinition, 'suite_id'>): JsonObject {
  return {
    name: suite.name,
    subject_kind: suite.subject_kind,
    evidence_class: suite.evidence_class,
    evaluator: suite.evaluator,
    axes: suite.axes as unknown as readonly JsonValue[],
    tenant: suite.tenant,
    project: suite.project,
  };
}

/** Compute the content address of a suite: `cbms:<digest>`. */
export function suiteId(content: Omit<SuiteDefinition, 'suite_id'>): string {
  return `cbms:${stableDigestJson(suiteContentJson(content))}`;
}

/** The content digest of a suite (measurement lineage binding). */
export function suiteDigest(suite: SuiteDefinition): string {
  return stableDigestJson(suiteContentJson(suite));
}

// ---------------------------------------------------------------------------
// The suite validator (the axis laws, collect-all)
// ---------------------------------------------------------------------------

/**
 * Collect-all validation of an untrusted suite definition: the structural
 * laws, the axis laws (closed measurable vocabulary, kind agreement,
 * scale agreement, unique axis names, coherent attainment criteria) and
 * the content-address law (the recorded `suite_id` must equal the digest
 * of the canonical suite content — L9).
 */
export function validateSuiteDefinition(value: unknown, path = 'suite'): PlatformResult<SuiteDefinition> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: PlatformError[] = [];
  if (value.suite_id === undefined) errors.push(missingField(`${path}.suite_id`));
  else if (typeof value.suite_id !== 'string' || !value.suite_id.startsWith('cbms:')) {
    errors.push(invalidField(`${path}.suite_id`, 'must be a suite id ("cbms:<digest>")'));
  }
  if (value.name === undefined) errors.push(missingField(`${path}.name`));
  else if (!isNonEmptyString(value.name)) errors.push(invalidField(`${path}.name`, 'must be a non-empty suite name (the stable identity T045 requirements cite)'));
  if (value.subject_kind === undefined) errors.push(missingField(`${path}.subject_kind`));
  else if (!isSubjectKind(value.subject_kind)) errors.push(invalidField(`${path}.subject_kind`, `must be one of ${SUBJECT_KINDS.join(' | ')}`));
  if (value.evidence_class === undefined) errors.push(missingField(`${path}.evidence_class`));
  else if (!isEvidenceClass(value.evidence_class)) errors.push(invalidField(`${path}.evidence_class`, "must be 'simulation' or 'live'"));
  if (value.evaluator === undefined) errors.push(missingField(`${path}.evaluator`));
  else if (!isEvaluatorVersionRef(value.evaluator)) errors.push(invalidField(`${path}.evaluator`, 'must be a non-empty evaluator version ref (L9)'));
  if (value.tenant === undefined) errors.push(missingField(`${path}.tenant`));
  else if (!isTenantId(value.tenant)) errors.push(invalidField(`${path}.tenant`, 'must be a non-empty tenant id (L12)'));
  if (value.project === undefined) errors.push(missingField(`${path}.project`));
  else if (!isProjectId(value.project)) errors.push(invalidField(`${path}.project`, 'must be a non-empty project id (L15)'));

  if (value.axes === undefined) {
    errors.push(missingField(`${path}.axes`));
  } else if (!Array.isArray(value.axes) || value.axes.length === 0) {
    errors.push(invalidField(`${path}.axes`, 'must be a non-empty array of suite axes'));
  } else {
    const axisNames = new Set<string>();
    for (let index = 0; index < (value.axes as readonly unknown[]).length; index++) {
      const axis = (value.axes as readonly unknown[])[index];
      if (!isRecord(axis)) {
        errors.push(invalidField(`${path}.axes[${index}]`, 'must be an object'));
        continue;
      }
      const axisPath = `${path}.axes[${index}]`;
      if (axis.axis === undefined || !isNonEmptyString(axis.axis)) {
        errors.push(invalidField(axisPath, 'must carry a non-empty axis name'));
        continue;
      }
      if (axisNames.has(axis.axis as string)) {
        errors.push(invalidField(`${axisPath}.axis`, `axis name "${axis.axis as string}" is declared twice`));
      }
      axisNames.add(axis.axis as string);

      // The closed-vocabulary law + the kind/scale agreement laws.
      const measurable = sliceMeasurableOf(axis.measurable as string);
      if (axis.measurable === undefined || !isNonEmptyString(axis.measurable)) {
        errors.push(invalidField(`${axisPath}.measurable`, 'must be a measurable path of the subject kind'));
      } else if (measurable === undefined) {
        errors.push(invalidField(`${axisPath}.measurable`, `"${axis.measurable as string}" is not a measurable of the reference-slice vocabulary (the closed set; unknown measurables are never silently coerced)`));
      } else {
        if (axis.kind === undefined || !isAxisKind(axis.kind)) {
          errors.push(invalidField(`${axisPath}.kind`, `must be one of ${AXIS_KINDS.join(' | ')}`));
        } else if (axis.kind !== measurable.kind) {
          errors.push(invalidField(`${axisPath}.kind`, `must equal the measurable's kind ("${measurable.kind}")`));
        }
        if (measurable.kind === 'decimal') {
          if (measurable.scale === null) {
            // FLEXIBLE-SCALE decimal (the value's scale is the measured artifact's
            // own arithmetic — the book money): the AXIS declares the exact scale
            // it expects, and the runner refuses any value off it.
            if (axis.scale === undefined || axis.scale === null || !isNonNegativeInteger(axis.scale)) {
              errors.push(invalidField(`${axisPath}.scale`, 'must declare the exact decimal scale of the measured values (a non-negative integer — the book money\'s scale is the report\'s own)'));
            }
          } else if (axis.scale === undefined || axis.scale !== measurable.scale) {
            errors.push(invalidField(`${axisPath}.scale`, `must equal the measurable's exact scale (${measurable.scale})`));
          }
        } else if (axis.scale !== null && axis.scale !== undefined) {
          errors.push(invalidField(`${axisPath}.scale`, 'must be null for non-decimal axes'));
        }
      }

      if (axis.attainment === undefined) {
        errors.push(missingField(`${axisPath}.attainment`));
      } else if (isAxisKind(axis.kind) && !isAxisAttainment(axis.attainment, axis.kind)) {
        errors.push(invalidField(`${axisPath}.attainment`, 'must be a coherent attainment criterion for the axis kind (min/max for count/decimal, equals for any kind, never mixed)'));
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  const content: Omit<SuiteDefinition, 'suite_id'> = {
    name: value.name as string,
    subject_kind: value.subject_kind as SubjectKind,
    evidence_class: value.evidence_class as EvidenceClass,
    evaluator: value.evaluator as EvaluatorVersionRef,
    axes: value.axes as readonly SuiteAxis[],
    tenant: value.tenant as TenantId,
    project: value.project as ProjectId,
  };
  const derivedId = suiteId(content);
  if (value.suite_id !== derivedId) {
    return fail(
      'invalid_field',
      `suite id "${value.suite_id as string}" does not match the content's address "${derivedId}" — content and address cannot disagree (L9)`,
      `${path}.suite_id`,
    );
  }
  return ok(deepFreeze({ suite_id: derivedId, ...content } satisfies SuiteDefinition));
}

