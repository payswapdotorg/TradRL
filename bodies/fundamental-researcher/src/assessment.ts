// @tradrl/body-fundamental-researcher — the evidence-backed fundamental
// assessment.
//
// Owning Work Order: T023, section 5: "FundamentalAssessment — the
// evidence-backed output: instrument/scope, assessment kind (CLOSED
// taxonomy), polarity/stance (declared method), confidence, evidence refs
// + provenance lineage, as-of, body/method versions, tenant/project."
//
// LAWS HELD (violations = typed errors, tested negatively):
// - L4 (point-in-time): every cited observation's `available_time` must
//   be <= the assessment's `asOf` — an assessment citing future data is
//   the `future_evidence` typed error.
// - L9 (lineage): evidence is NEVER empty (`evidence_missing`), citation
//   ids are unique (`duplicate_observation_ref`), and every citation
//   carries the observation's provenance block (the T008 mirror).
// - Method honesty: the assessment kind is a member of the CLOSED
//   taxonomy, the stance cites a declared ASSESSMENT method (id + version)
//   whose parameters declare THIS assessment kind (`assessment_kind_mismatch`),
//   and the stance direction must equal the method's declared decision
//   function over the carried score — a stance that disagrees with its own
//   method is the `stance_direction_mismatch` typed error. Confidence
//   cites a declared confidence method of the right kind.
// - L12: TenantId + ProjectId are required.
// - Determinism: `assessmentId` is DERIVED (`fa-<stableDigest>` over the
//   canonical form of everything else) — never random; validation
//   recomputes it and refuses tampered ids (`digest_mismatch`).
// - Immutability: created records are deeply frozen (runtime half of L3
//   discipline for authored records).

import {
  type TimestampMs,
  canonicalJson,
  deepFreeze,
  isNonEmptyString,
  isNonNegativeInteger,
  isRecord,
  isTimestampMs,
  stableDigest,
  type JsonValue,
} from './primitives';
import {
  type FundamentalMethodId,
  type FundamentalMethodVersionRef,
  type BodyVersionRef,
  type ProjectId,
  type FundamentalAssessmentId,
  type TenantId,
  isBodyVersionRef,
  isFundamentalMethodId,
  isFundamentalMethodVersionRef,
  isProjectId,
  isTenantId,
} from './ids';
import {
  type FundamentalMethodRegistry,
  type AssessmentKind,
  type ValuationAssessmentParameters,
  type MacroSurpriseAssessmentParameters,
  type HealthAssessmentParameters,
  ASSESSMENT_KINDS,
  findFundamentalMethod,
  resolveAssessmentCitation,
} from './methods';
import {
  type ObservationProvenance,
  isObservationProvenance,
  validateObservationProvenance,
} from './observations';
import { compareDecimal, isSignedDecimal } from './decimals';
import { type FundamentalError, type FundamentalResult, type FundamentalValidation, invalidField, invalidType, validationOf } from './errors';

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

/**
 * The stance directions a fundamental assessment can declare (CLOSED
 * union). Semantics are DECLARED PER METHOD: for valuation-level,
 * 'positive' means the reported level is extended above its trailing
 * baseline; for macro-surprise, 'positive' means above consensus; for
 * health-indicator, 'positive' means the series rose over the window.
 * Every direction is derived by the method's declared decision function —
 * never asserted.
 */
export const STANCE_DIRECTIONS = ['positive', 'negative', 'neutral'] as const;

/** A stance direction. */
export type StanceDirection = (typeof STANCE_DIRECTIONS)[number];

/** Guard: a stance direction. */
export const isStanceDirection = (v: unknown): v is StanceDirection =>
  typeof v === 'string' && (STANCE_DIRECTIONS as readonly string[]).includes(v);

/**
 * The confidence levels — mirror of @tradrl/evaluation's
 * `VerdictConfidence` ('low' | 'moderate' | 'high'): a CATEGORY, never a
 * naked score. Confidence is a declared-method record, never a guess.
 */
export const CONFIDENCE_LEVELS = ['low', 'moderate', 'high'] as const;

/** A confidence level (category, not a score). */
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

/** Guard: a confidence level. */
export const isConfidenceLevel = (v: unknown): v is ConfidenceLevel =>
  typeof v === 'string' && (CONFIDENCE_LEVELS as readonly string[]).includes(v);

// ---------------------------------------------------------------------------
// The declared decision function (the assessment methods' shared stance law)
// ---------------------------------------------------------------------------

/**
 * THE DECLARED STANCE DECISION FUNCTION (shared by all three assessment
 * methods, each with its own declared thresholds): the direction a score
 * derives under the method's `polarityThresholds`. Pure and total; the
 * pipeline computes with it and validation re-derives with it — one
 * function, one law, so a carried direction can never disagree with the
 * method that supposedly produced it (`stance_direction_mismatch`).
 */
export function classifyStanceDirection(
  score: string,
  thresholds: { readonly positive: string; readonly negative: string },
): StanceDirection {
  if (compareDecimal(score, thresholds.positive) >= 0) return 'positive';
  if (compareDecimal(score, thresholds.negative) <= 0) return 'negative';
  return 'neutral';
}

// ---------------------------------------------------------------------------
// Evidence lineage
// ---------------------------------------------------------------------------

/**
 * One observation citation: the observation id, the availability instant
 * it was legitimately knowable at (restated so the assessment itself
 * proves point-in-time honesty — L4), and the observation's provenance
 * block (the T008 mirror — full lineage travels with the output — L9).
 */
export interface ObservationCitation {
  readonly observationId: string;
  readonly availableTime: TimestampMs;
  readonly provenance: ObservationProvenance;
}

/** Guard: `ObservationCitation`. */
export function isObservationCitation(v: unknown): v is ObservationCitation {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.observationId) &&
    isTimestampMs(v.availableTime) &&
    isObservationProvenance(v.provenance)
  );
}

/** COLLECT-ALL validation of one citation (structure + provenance laws). */
export function validateObservationCitation(v: unknown, path: string): readonly FundamentalError[] {
  const errors: FundamentalError[] = [];
  if (!isRecord(v)) return [invalidType(path, 'an observation citation object')];
  if (!isNonEmptyString(v.observationId)) {
    errors.push(invalidField(`${path}.observationId`, 'must be a non-empty observation id'));
  }
  if (!isTimestampMs(v.availableTime)) {
    errors.push(invalidField(`${path}.availableTime`, 'must be a valid epoch-millisecond instant'));
  }
  const citedId = isNonEmptyString(v.observationId) ? (v.observationId as string) : '';
  errors.push(
    ...validateObservationProvenance(v.provenance, citedId, `${path}.provenance`),
  );
  return errors;
}

// ---------------------------------------------------------------------------
// The assessment scope
// ---------------------------------------------------------------------------

/**
 * The instrument/series scope an assessment covers: the canonical
 * instrument the observations were reported for, plus the series
 * identity — the reported `field` for fundamental data (e.g.
 * "INDEX_LEVEL", "ACTIVE_RIG_COUNT") or the macro `indicator` for
 * economic releases.
 */
export interface AssessmentScope {
  /** The instrument the assessment is about (canonical instrument id). */
  readonly instrument: string;
  /** The series the assessment is about (field or indicator). */
  readonly series: string;
}

/** Guard: `AssessmentScope`. */
export function isAssessmentScope(v: unknown): v is AssessmentScope {
  if (!isRecord(v)) return false;
  return isNonEmptyString(v.instrument) && isNonEmptyString(v.series);
}

// ---------------------------------------------------------------------------
// The declared-method assessment records
// ---------------------------------------------------------------------------

/**
 * The stance assessment: direction + exact score, each citing the
 * declared assessment method that produced them. The score is the
 * method's declared measure (valuation: latest level over trailing
 * mean minus one; macro: mean surprise ratio; health: net-change ratio).
 */
export interface StanceAssessment {
  readonly methodId: FundamentalMethodId;
  readonly methodVersion: FundamentalMethodVersionRef;
  readonly direction: StanceDirection;
  /** The exact score under the declared measure (a signed decimal). */
  readonly score: string;
}

/**
 * The confidence assessment: a CATEGORY plus the two declared inputs it
 * was derived from (evidence count and the scale-free range ratio of the
 * assessed values). Never a naked guess.
 */
export interface ConfidenceAssessment {
  readonly methodId: FundamentalMethodId;
  readonly methodVersion: FundamentalMethodVersionRef;
  readonly level: ConfidenceLevel;
  /** How many observations the assessment was computed from. */
  readonly evidenceCount: number;
  /** The scale-free range ratio of the assessed values, or null below two. */
  readonly dispersion: string | null;
}

// ---------------------------------------------------------------------------
// FundamentalAssessment
// ---------------------------------------------------------------------------

/**
 * THE evidence-backed fundamental assessment. Every field is lineage:
 * scope, the CLOSED assessment kind, a declared-method stance, a
 * declared-method confidence, non-empty point-in-time evidence with
 * provenance, the as-of instant, the producing body version, tenant and
 * project. The id is derived (`fa-<digest>`), never random.
 */
export interface FundamentalAssessment {
  readonly assessmentId: FundamentalAssessmentId;
  readonly scope: AssessmentScope;
  readonly assessmentKind: AssessmentKind;
  readonly stance: StanceAssessment;
  readonly confidence: ConfidenceAssessment;
  readonly evidence: readonly ObservationCitation[];
  /** The L4 instant this assessment was computed as of. */
  readonly asOf: TimestampMs;
  readonly bodyVersion: BodyVersionRef;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  /** The seed the run carried (lineage material — L9). */
  readonly seed: string;
}

/** Derives the assessment id: `fa-<stableDigest16>` over the canonical form. */
export function deriveAssessmentId(assessment: Omit<FundamentalAssessment, 'assessmentId'>): FundamentalAssessmentId {
  return `fa-${stableDigest(canonicalJson(assessment as unknown as JsonValue))}` as FundamentalAssessmentId;
}

// -- assessment guards -------------------------------------------------------

function assessmentCitationOk(v: Record<string, unknown>): boolean {
  return isFundamentalMethodId(v.methodId) && isFundamentalMethodVersionRef(v.methodVersion);
}

/** Guard: `StanceAssessment`. */
export function isStanceAssessment(v: unknown): v is StanceAssessment {
  if (!isRecord(v)) return false;
  return (
    assessmentCitationOk(v) &&
    isStanceDirection(v.direction) &&
    isSignedDecimal(v.score)
  );
}

/** Guard: `ConfidenceAssessment`. */
export function isConfidenceAssessment(v: unknown): v is ConfidenceAssessment {
  if (!isRecord(v)) return false;
  return (
    assessmentCitationOk(v) &&
    isConfidenceLevel(v.level) &&
    isNonNegativeInteger(v.evidenceCount) &&
    (v.dispersion === null || isSignedDecimal(v.dispersion))
  );
}

/** Guard: `FundamentalAssessment` (structure only — use `validateFundamentalAssessment` for the laws). */
export function isFundamentalAssessment(v: unknown): v is FundamentalAssessment {
  if (!isRecord(v)) return false;
  return (
    typeof v.assessmentId === 'string' &&
    v.assessmentId.startsWith('fa-') &&
    isAssessmentScope(v.scope) &&
    typeof v.assessmentKind === 'string' &&
    (ASSESSMENT_KINDS as readonly string[]).includes(v.assessmentKind) &&
    isStanceAssessment(v.stance) &&
    isConfidenceAssessment(v.confidence) &&
    Array.isArray(v.evidence) &&
    v.evidence.every((citation) => isObservationCitation(citation)) &&
    isTimestampMs(v.asOf) &&
    isBodyVersionRef(v.bodyVersion) &&
    isTenantId(v.tenantId) &&
    isProjectId(v.projectId) &&
    isNonEmptyString(v.seed)
  );
}

// ---------------------------------------------------------------------------
// Validation (collect-all — every law, every violation)
// ---------------------------------------------------------------------------

/**
 * COLLECT-ALL validation of a fundamental assessment against every
 * research law: structure, the CLOSED assessment taxonomy, evidence
 * completeness (L9), point-in-time citations (L4), method honesty (the
 * stance method must declare THIS assessment kind, and the direction must
 * equal the method's declared decision function over the carried score;
 * confidence must cite the confidence-estimation kind), tenant/project
 * presence (L12), and the derived-id law.
 */
export function validateFundamentalAssessment(v: unknown, registry: FundamentalMethodRegistry): readonly FundamentalError[] {
  const errors: FundamentalError[] = [];
  if (!isRecord(v)) return [invalidType('assessment', 'a fundamental assessment object')];
  if (typeof v.assessmentId !== 'string' || !v.assessmentId.startsWith('fa-')) {
    errors.push(invalidField('assessmentId', "must be a derived assessment id ('fa-<digest>')"));
  }
  if (!isAssessmentScope(v.scope)) {
    errors.push(invalidField('scope', 'must be { instrument, series } non-empty strings'));
  }
  if (typeof v.assessmentKind !== 'string' || !(ASSESSMENT_KINDS as readonly string[]).includes(v.assessmentKind)) {
    errors.push({
      code: 'unknown_assessment_kind',
      path: 'assessmentKind',
      message: `must be one of the declared assessment kinds (${ASSESSMENT_KINDS.join('|')}) — the taxonomy is CLOSED`,
    });
  }
  const asOfOk = isTimestampMs(v.asOf);
  if (!asOfOk) errors.push(invalidField('asOf', 'must be a valid epoch-millisecond instant'));
  if (!isBodyVersionRef(v.bodyVersion)) {
    errors.push(invalidField('bodyVersion', 'must be a canonical body-version reference'));
  }
  if (!isTenantId(v.tenantId)) {
    errors.push({ code: 'tenant_missing', path: 'tenantId', message: 'every research record carries a TenantId (L12)' });
  }
  if (!isProjectId(v.projectId)) {
    errors.push({ code: 'project_missing', path: 'projectId', message: 'every research record carries a ProjectId (L12)' });
  }
  if (!isNonEmptyString(v.seed)) errors.push(invalidField('seed', 'must be a non-empty seed string'));

  // stance assessment (method honesty: assessment kind + declared decision function)
  if (!isRecord(v.stance)) {
    errors.push(invalidType('stance', 'a stance assessment object'));
  } else {
    errors.push(
      ...resolveAssessmentCitation(registry, v.stance.methodId, v.stance.methodVersion, v.assessmentKind).map(
        (e) => ({ ...e, path: `stance.${e.path}` }),
      ),
    );
    if (!isStanceDirection(v.stance.direction)) {
      errors.push(invalidField('stance.direction', `must be one of ${STANCE_DIRECTIONS.join('|')}`));
    }
    if (!isSignedDecimal(v.stance.score)) {
      errors.push(invalidField('stance.score', 'must be a signed decimal string'));
    } else if (
      isStanceDirection(v.stance.direction) &&
      typeof v.assessmentKind === 'string' &&
      (ASSESSMENT_KINDS as readonly string[]).includes(v.assessmentKind)
    ) {
      const method = isFundamentalMethodId(v.stance.methodId)
        ? findFundamentalMethod(registry, v.stance.methodId)
        : null;
      if (
        method !== null &&
        method.parameters.kind === 'assessment' &&
        method.parameters.assessmentKind === v.assessmentKind
      ) {
        const expected = classifyStanceDirection(v.stance.score, method.parameters.polarityThresholds);
        if (expected !== v.stance.direction) {
          // THE declared decision function law: the direction must be
          // derivable from the score under the method's own thresholds.
          errors.push({
            code: 'stance_direction_mismatch',
            path: 'stance.direction',
            message: `the stance direction must equal the declared decision function over the score (expected '${expected}')`,
          });
        }
      }
    }
  }

  // confidence assessment
  if (!isRecord(v.confidence)) {
    errors.push(invalidType('confidence', 'a confidence assessment object'));
  } else {
    const method = isFundamentalMethodId(v.confidence.methodId)
      ? findFundamentalMethod(registry, v.confidence.methodId)
      : null;
    if (method !== null && method.kind !== 'confidence-estimation') {
      errors.push({
        code: 'method_kind_mismatch',
        path: 'confidence.methodId',
        message: `method ${method.methodId} is declared as '${method.kind}', used as 'confidence-estimation'`,
      });
    }
    errors.push(
      ...resolveCitationStrict(registry, v.confidence.methodId, v.confidence.methodVersion, 'confidence-estimation').map(
        (e) => ({ ...e, path: `confidence.${e.path}` }),
      ),
    );
    if (!isConfidenceLevel(v.confidence.level)) {
      errors.push(invalidField('confidence.level', `must be one of ${CONFIDENCE_LEVELS.join('|')} (a category, never a score)`));
    }
    if (!isNonNegativeInteger(v.confidence.evidenceCount)) {
      errors.push(invalidField('confidence.evidenceCount', 'must be a non-negative integer'));
    }
    if (v.confidence.dispersion !== null && !isSignedDecimal(v.confidence.dispersion)) {
      errors.push(invalidField('confidence.dispersion', 'must be a decimal string or null'));
    }
    if (isNonNegativeInteger(v.confidence.evidenceCount)) {
      const count = v.confidence.evidenceCount as number;
      if (count < 2 && v.confidence.dispersion !== null) {
        errors.push(invalidField('confidence.dispersion', 'the range ratio of fewer than two observations is null, not a fabricated zero'));
      }
    }
  }

  // evidence lineage
  if (!Array.isArray(v.evidence)) {
    errors.push(invalidType('evidence', 'an array of observation citations'));
  } else {
    if (v.evidence.length === 0) {
      // THE evidence law: an evidence-less research output fails validation.
      errors.push({
        code: 'evidence_missing',
        path: 'evidence',
        message: 'a fundamental assessment without observation citations is an unsupported claim',
      });
    }
    const ids: string[] = [];
    (v.evidence as readonly unknown[]).forEach((citation: unknown, index: number) => {
      errors.push(...validateObservationCitation(citation, `evidence[${index}]`));
      if (isRecord(citation) && isNonEmptyString(citation.observationId)) {
        ids.push(citation.observationId as string);
      }
      if (
        isRecord(citation) &&
        isTimestampMs(citation.availableTime) &&
        asOfOk &&
        (citation.availableTime as number) > (v.asOf as number)
      ) {
        // THE L4 law: citing future data is a typed error.
        errors.push({
          code: 'future_evidence',
          path: `evidence[${index}].availableTime`,
          message: `observation ${JSON.stringify(citation.observationId)} is not knowable at the declared as-of instant`,
        });
      }
    });
    if (new Set(ids).size !== ids.length) {
      errors.push({
        code: 'duplicate_observation_ref',
        path: 'evidence',
        message: 'evidence citations must be unique observation ids',
      });
    }
  }

  // derived-id law (tamper trip-wire)
  if (typeof v.assessmentId === 'string' && v.assessmentId.startsWith('fa-') && errors.length === 0) {
    const { assessmentId: _ignored, ...material } = v as unknown as FundamentalAssessment;
    void _ignored;
    if (deriveAssessmentId(material as Omit<FundamentalAssessment, 'assessmentId'>) !== v.assessmentId) {
      errors.push({
        code: 'digest_mismatch',
        path: 'assessmentId',
        message: 'the assessment id does not match its canonical content — the record was tampered with',
      });
    }
  }
  return errors;
}

/** Local strict citation resolver (single typed error per drift). */
function resolveCitationStrict(
  registry: FundamentalMethodRegistry,
  methodId: unknown,
  version: unknown,
  expectedKind: 'confidence-estimation',
): readonly FundamentalError[] {
  if (!isFundamentalMethodId(methodId) || !isFundamentalMethodVersionRef(version)) {
    return [invalidField('methodId', 'must cite a declared method (id + strict X.Y.Z version)')];
  }
  const method = findFundamentalMethod(registry, methodId);
  if (method === null) {
    return [{
      code: 'undeclared_method',
      path: 'methodId',
      message: `method ${JSON.stringify(methodId)} is not declared in the method registry — confidence without a declared method is a naked guess`,
    }];
  }
  if (method.version !== version) {
    return [{
      code: 'method_version_mismatch',
      path: 'methodVersion',
      message: `method ${methodId} is declared at version ${method.version}, cited at ${version}`,
    }];
  }
  if (method.kind !== expectedKind) {
    return [{
      code: 'method_kind_mismatch',
      path: 'methodId',
      message: `method ${methodId} is declared as '${method.kind}', used as '${expectedKind}'`,
    }];
  }
  return [];
}

/** Validation wrapper: `FundamentalAssessment`. */
export function validateFundamentalAssessmentRecord(v: unknown, registry: FundamentalMethodRegistry): FundamentalValidation<FundamentalAssessment> {
  const errors = validateFundamentalAssessment(v, registry);
  return validationOf(errors.length === 0 ? (v as FundamentalAssessment) : null, errors);
}

/**
 * Creates a validated, deeply-frozen fundamental assessment. The
 * `assessmentId` is DERIVED from the canonical form of the draft (never
 * accepted); the draft must satisfy every research law. Refusal is typed
 * data.
 */
export function createFundamentalAssessment(
  draft: Omit<FundamentalAssessment, 'assessmentId'>,
  registry: FundamentalMethodRegistry,
): FundamentalResult<FundamentalAssessment> {
  const errors = validateFundamentalAssessment({ ...draft, assessmentId: 'fa-pending' }, registry)
    // the placeholder id is expected to fail the prefix/digest checks only
    // when real content problems exist; strip id-specific errors here.
    .filter((error) => !(error.path === 'assessmentId'));
  if (errors.length > 0) return { ok: false, errors };
  const assessmentId = deriveAssessmentId(draft);
  return { ok: true, value: deepFreeze({ ...draft, assessmentId }) };
}

/** Canonical serialization of an assessment (byte-deterministic, L9). */
export function serializeFundamentalAssessment(assessment: FundamentalAssessment): string {
  return canonicalJson(assessment as unknown as JsonValue);
}

// ---------------------------------------------------------------------------
// Re-exported parameter types (pipeline convenience)
// ---------------------------------------------------------------------------

export type { ValuationAssessmentParameters, MacroSurpriseAssessmentParameters, HealthAssessmentParameters };
