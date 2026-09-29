// @tradrl/body-sentiment-researcher — the evidence-backed sentiment reading.
//
// Owning Work Order: T021, section 5: "SentimentReading — the
// evidence-backed output: instrument/event scope, polarity + intensity
// (declared-method records), confidence (declared method), evidence refs
// (observation ids + their provenance lineage), as-of (the L4 instant),
// body version, method version, tenant/project."
//
// LAWS HELD (violations = typed errors, tested negatively):
// - L4 (point-in-time): every cited observation's `available_time` must
//   be <= the reading's `asOf` — a reading citing future data is the
//   `future_evidence` typed error.
// - L9 (lineage): evidence is NEVER empty (`evidence_missing`), citation
//   ids are unique (`duplicate_observation_ref`), and every citation
//   carries the observation's provenance block (the T008 mirror).
// - Method honesty: polarity, intensity AND confidence each cite a
//   declared method (id + version) of the RIGHT kind; an undeclared id,
//   a stale version, or a wrong kind is a typed error.
// - L12: TenantId + ProjectId are required.
// - Determinism: `readingId` is DERIVED (`sr-<stableDigest>` over the
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
  type MethodId,
  type MethodVersionRef,
  type BodyVersionRef,
  type ProjectId,
  type SentimentReadingId,
  type TenantId,
  isBodyVersionRef,
  isMethodId,
  isMethodVersionRef,
  isProjectId,
  isTenantId,
} from './ids';
import { type MethodRegistry, resolveMethodCitation } from './methods';
import {
  type ObservationProvenance,
  isObservationProvenance,
  validateObservationProvenance,
} from './observations';
import { compareDecimal, isSignedDecimal, isUnsignedDecimal } from './decimals';
import { type ResearchError, type ResearchResult, type ResearchValidation, invalidField, invalidType, validationOf } from './errors';

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

/** The polarity directions a reading can declare. */
export const POLARITY_DIRECTIONS = ['positive', 'negative', 'neutral', 'mixed'] as const;

/** A polarity direction. */
export type PolarityDirection = (typeof POLARITY_DIRECTIONS)[number];

/** Guard: a polarity direction. */
export const isPolarityDirection = (v: unknown): v is PolarityDirection =>
  typeof v === 'string' && (POLARITY_DIRECTIONS as readonly string[]).includes(v);

/** The intensity levels a reading can declare. */
export const INTENSITY_LEVELS = ['low', 'moderate', 'high'] as const;

/** An intensity level. */
export type IntensityLevel = (typeof INTENSITY_LEVELS)[number];

/** Guard: an intensity level. */
export const isIntensityLevel = (v: unknown): v is IntensityLevel =>
  typeof v === 'string' && (INTENSITY_LEVELS as readonly string[]).includes(v);

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
// The declared-method assessment records
// ---------------------------------------------------------------------------

/**
 * The polarity assessment: direction + exact score, each citing the
 * declared aggregation method that produced them.
 */
export interface PolarityAssessment {
  readonly methodId: MethodId;
  readonly methodVersion: MethodVersionRef;
  readonly direction: PolarityDirection;
  /** Signed decimal in [-1, 1] (exact — the decimal-string discipline). */
  readonly score: string;
}

/** The intensity assessment: level + exact magnitude score. */
export interface IntensityAssessment {
  readonly methodId: MethodId;
  readonly methodVersion: MethodVersionRef;
  readonly level: IntensityLevel;
  /** Unsigned decimal in [0, 1]. */
  readonly score: string;
}

/**
 * The confidence assessment: a CATEGORY plus the two declared inputs it
 * was derived from (evidence count and dispersion). Never a naked guess.
 */
export interface ConfidenceAssessment {
  readonly methodId: MethodId;
  readonly methodVersion: MethodVersionRef;
  readonly level: ConfidenceLevel;
  /** How many observations the reading was computed from. */
  readonly evidenceCount: number;
  /** The exact dispersion of the evidence scores, or null below two. */
  readonly dispersion: string | null;
}

// ---------------------------------------------------------------------------
// Evidence lineage
// ---------------------------------------------------------------------------

/**
 * One observation citation: the observation id, the availability instant
 * it was legitimately knowable at (restated so the reading itself proves
 * point-in-time honesty — L4), and the observation's provenance block
 * (the T008 mirror — full lineage travels with the output — L9).
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
export function validateObservationCitation(v: unknown, path: string): readonly ResearchError[] {
  const errors: ResearchError[] = [];
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
// The reading scope
// ---------------------------------------------------------------------------

/** The instrument/event scope a reading covers. */
export interface ReadingScope {
  /** The instrument the reading is about (canonical instrument id). */
  readonly instrument: string;
  /** The venue scope of the aggregated observations. */
  readonly venue: string;
}

/** Guard: `ReadingScope`. */
export function isReadingScope(v: unknown): v is ReadingScope {
  if (!isRecord(v)) return false;
  return isNonEmptyString(v.instrument) && isNonEmptyString(v.venue);
}

// ---------------------------------------------------------------------------
// SentimentReading
// ---------------------------------------------------------------------------

/**
 * THE evidence-backed sentiment reading. Every field is lineage: scope,
 * three declared-method assessments, non-empty point-in-time evidence
 * with provenance, the as-of instant, the producing body version, tenant
 * and project. The id is derived (`sr-<digest>`), never random.
 */
export interface SentimentReading {
  readonly readingId: SentimentReadingId;
  readonly scope: ReadingScope;
  readonly polarity: PolarityAssessment;
  readonly intensity: IntensityAssessment;
  readonly confidence: ConfidenceAssessment;
  readonly evidence: readonly ObservationCitation[];
  /** The L4 instant this reading was computed as of. */
  readonly asOf: TimestampMs;
  readonly bodyVersion: BodyVersionRef;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  /** The seed the run carried (lineage material — L9). */
  readonly seed: string;
}

/** The canonical JSON form of a reading minus its derived id. */
function readingIdentityMaterial(reading: Omit<SentimentReading, 'readingId'>): JsonValue {
  return reading as unknown as JsonValue;
}

/** Derives the reading id: `sr-<stableDigest16>` over the canonical form. */
export function deriveReadingId(reading: Omit<SentimentReading, 'readingId'>): SentimentReadingId {
  return `sr-${stableDigest(canonicalJson(readingIdentityMaterial(reading)))}` as SentimentReadingId;
}

// -- assessment guards -------------------------------------------------------

function assessmentCitationOk(v: Record<string, unknown>): boolean {
  return isMethodId(v.methodId) && isMethodVersionRef(v.methodVersion);
}

/** Guard: `PolarityAssessment`. */
export function isPolarityAssessment(v: unknown): v is PolarityAssessment {
  if (!isRecord(v)) return false;
  return (
    assessmentCitationOk(v) &&
    isPolarityDirection(v.direction) &&
    isSignedDecimal(v.score)
  );
}

/** Guard: `IntensityAssessment`. */
export function isIntensityAssessment(v: unknown): v is IntensityAssessment {
  if (!isRecord(v)) return false;
  return (
    assessmentCitationOk(v) &&
    isIntensityLevel(v.level) &&
    isUnsignedDecimal(v.score)
  );
}

/** Guard: `ConfidenceAssessment`. */
export function isConfidenceAssessment(v: unknown): v is ConfidenceAssessment {
  if (!isRecord(v)) return false;
  return (
    assessmentCitationOk(v) &&
    isConfidenceLevel(v.level) &&
    isNonNegativeInteger(v.evidenceCount) &&
    (v.dispersion === null || isUnsignedDecimal(v.dispersion))
  );
}

/** Guard: `SentimentReading` (structure only — use `validateSentimentReading` for the laws). */
export function isSentimentReading(v: unknown): v is SentimentReading {
  if (!isRecord(v)) return false;
  return (
    typeof v.readingId === 'string' &&
    v.readingId.startsWith('sr-') &&
    isReadingScope(v.scope) &&
    isPolarityAssessment(v.polarity) &&
    isIntensityAssessment(v.intensity) &&
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
 * COLLECT-ALL validation of a sentiment reading against every research
 * law: structure, evidence completeness (L9), point-in-time citations
 * (L4), method honesty (aggregation for polarity/intensity,
 * confidence-estimation for confidence), score ranges and direction
 * consistency, tenant/project presence (L12), and the derived-id law.
 */
export function validateSentimentReading(v: unknown, registry: MethodRegistry): readonly ResearchError[] {
  const errors: ResearchError[] = [];
  if (!isRecord(v)) return [invalidType('reading', 'a sentiment reading object')];
  if (typeof v.readingId !== 'string' || !v.readingId.startsWith('sr-')) {
    errors.push(invalidField('readingId', "must be a derived reading id ('sr-<digest>')"));
  }
  if (!isReadingScope(v.scope)) {
    errors.push(invalidField('scope', 'must be { instrument, venue } non-empty strings'));
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

  // polarity assessment
  if (!isRecord(v.polarity)) {
    errors.push(invalidType('polarity', 'a polarity assessment object'));
  } else {
    errors.push(...resolveMethodCitation(registry, v.polarity.methodId, v.polarity.methodVersion, 'aggregation').map((e) => ({ ...e, path: `polarity.${e.path}` })));
    if (!isPolarityDirection(v.polarity.direction)) {
      errors.push(invalidField('polarity.direction', `must be one of ${POLARITY_DIRECTIONS.join('|')}`));
    }
    if (!isSignedDecimal(v.polarity.score)) {
      errors.push(invalidField('polarity.score', 'must be a signed decimal string'));
    } else {
      if (compareDecimal(v.polarity.score, '1') === 1 || compareDecimal(v.polarity.score, '-1') === -1) {
        errors.push(invalidField('polarity.score', 'must lie in [-1, 1]'));
      }
      if (isPolarityDirection(v.polarity.direction)) {
        const versusZero = compareDecimal(v.polarity.score, '0');
        const direction = v.polarity.direction;
        if (direction === 'positive' && versusZero !== 1) {
          errors.push({ code: 'polarity_direction_mismatch', path: 'polarity.direction', message: "a 'positive' reading must have a strictly positive score" });
        }
        if (direction === 'negative' && versusZero !== -1) {
          errors.push({ code: 'polarity_direction_mismatch', path: 'polarity.direction', message: "a 'negative' reading must have a strictly negative score" });
        }
        if (direction === 'neutral' && versusZero !== 0) {
          errors.push({ code: 'polarity_direction_mismatch', path: 'polarity.direction', message: "a 'neutral' reading must have a zero score" });
        }
      }
    }
  }

  // intensity assessment
  if (!isRecord(v.intensity)) {
    errors.push(invalidType('intensity', 'an intensity assessment object'));
  } else {
    errors.push(...resolveMethodCitation(registry, v.intensity.methodId, v.intensity.methodVersion, 'aggregation').map((e) => ({ ...e, path: `intensity.${e.path}` })));
    if (!isIntensityLevel(v.intensity.level)) {
      errors.push(invalidField('intensity.level', `must be one of ${INTENSITY_LEVELS.join('|')}`));
    }
    if (!isUnsignedDecimal(v.intensity.score)) {
      errors.push(invalidField('intensity.score', 'must be an unsigned decimal string'));
    } else if (compareDecimal(v.intensity.score, '1') === 1) {
      errors.push(invalidField('intensity.score', 'must lie in [0, 1]'));
    }
  }

  // confidence assessment
  if (!isRecord(v.confidence)) {
    errors.push(invalidType('confidence', 'a confidence assessment object'));
  } else {
    errors.push(...resolveMethodCitation(registry, v.confidence.methodId, v.confidence.methodVersion, 'confidence-estimation').map((e) => ({ ...e, path: `confidence.${e.path}` })));
    if (!isConfidenceLevel(v.confidence.level)) {
      errors.push(invalidField('confidence.level', `must be one of ${CONFIDENCE_LEVELS.join('|')} (a category, never a score)`));
    }
    if (!isNonNegativeInteger(v.confidence.evidenceCount)) {
      errors.push(invalidField('confidence.evidenceCount', 'must be a non-negative integer'));
    }
    if (v.confidence.dispersion !== null && !isUnsignedDecimal(v.confidence.dispersion)) {
      errors.push(invalidField('confidence.dispersion', 'must be an unsigned decimal string or null'));
    }
    if (isNonNegativeInteger(v.confidence.evidenceCount)) {
      const count = v.confidence.evidenceCount as number;
      if (count < 2 && v.confidence.dispersion !== null) {
        errors.push(invalidField('confidence.dispersion', 'dispersion of fewer than two observations is null, not a fabricated zero'));
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
        message: 'a sentiment reading without observation citations is an unsupported claim',
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
  if (typeof v.readingId === 'string' && v.readingId.startsWith('sr-') && errors.length === 0) {
    const { readingId: _ignored, ...material } = v as unknown as SentimentReading;
    void _ignored;
    if (deriveReadingId(material as Omit<SentimentReading, 'readingId'>) !== v.readingId) {
      errors.push({
        code: 'digest_mismatch',
        path: 'readingId',
        message: 'the reading id does not match its canonical content — the record was tampered with',
      });
    }
  }
  return errors;
}

/** Validation wrapper: `SentimentReading`. */
export function validateSentimentReadingRecord(v: unknown, registry: MethodRegistry): ResearchValidation<SentimentReading> {
  const errors = validateSentimentReading(v, registry);
  return validationOf(errors.length === 0 ? (v as SentimentReading) : null, errors);
}

/**
 * Creates a validated, deeply-frozen sentiment reading. The `readingId`
 * is DERIVED from the canonical form of the draft (never accepted); the
 * draft must satisfy every research law. Refusal is typed data.
 */
export function createSentimentReading(
  draft: Omit<SentimentReading, 'readingId'>,
  registry: MethodRegistry,
): ResearchResult<SentimentReading> {
  const errors = validateSentimentReading({ ...draft, readingId: 'sr-pending' }, registry)
    // the placeholder id is expected to fail the prefix/digest checks only
    // when real content problems exist; strip id-specific errors here.
    .filter((error) => !(error.path === 'readingId'));
  if (errors.length > 0) return { ok: false, errors };
  const readingId = deriveReadingId(draft);
  return { ok: true, value: deepFreeze({ ...draft, readingId }) };
}

/** Canonical serialization of a reading (byte-deterministic, L9). */
export function serializeSentimentReading(reading: SentimentReading): string {
  return canonicalJson(reading as unknown as JsonValue);
}
