// @tradrl/body-sentiment-researcher — the research publication record.
//
// Owning Work Order: T021, section 5: "ResearchReport — the publication
// record: readings + digests + a structured summary (no free-text
// conclusions — fields are enumerated)."
//
// A ResearchReport is what the researcher PUBLISHES (through the agent-os
// envelope mirror port — the service lane). It embeds the complete
// readings and digests (full lineage travels with the publication — L9),
// plus an ENUMERATED summary: counts, the dominant polarity category, the
// exact mean polarity score, L4 coverage accounting (offered / admitted /
// deferred / unsupported / invalid — nothing silently dropped), and
// structured data gaps. There is no free-text conclusion field anywhere
// in this record: publication discipline is structural.
//
// Validation re-derives the summary from the embedded readings and
// digests (report_composition_mismatch on drift), re-validates every
// embedded record against its own laws, enforces the as-of uniformity of
// the whole publication (as_of_mismatch), and recomputes the derived
// report id (digest_mismatch — the tamper trip-wire).

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
  type BodyVersionRef,
  type MethodId,
  type MethodVersionRef,
  type ProjectId,
  type ResearchReportId,
  type TenantId,
  isBodyVersionRef,
  isMethodId,
  isMethodVersionRef,
  isProjectId,
  isTenantId,
} from './ids';
import { type MethodRegistry, resolveMethodCitation } from './methods';
import {
  type SentimentReading,
  isSentimentReading,
  validateSentimentReading,
  POLARITY_DIRECTIONS,
  type PolarityDirection,
} from './reading';
import { type EventDigest, isEventDigest, validateEventDigest } from './digest';
import { decimalMean } from './decimals';
import { type ResearchError, type ResearchResult, type ResearchValidation, invalidField, invalidType, validationOf } from './errors';

// ---------------------------------------------------------------------------
// Coverage accounting (L4 gate bookkeeping — nothing silently dropped)
// ---------------------------------------------------------------------------

/**
 * The intake accounting every publication carries: how many observations
 * were offered by the sources, and how each one was classified. The sum
 * of the buckets always equals `observationsOffered`.
 */
export interface CoverageAccounting {
  readonly observationsOffered: number;
  readonly observationsAdmitted: number;
  readonly observationsDeferred: number;
  readonly observationsUnsupported: number;
  readonly observationsInvalid: number;
}

/** Guard: `CoverageAccounting`. */
export function isCoverageAccounting(v: unknown): v is CoverageAccounting {
  if (!isRecord(v)) return false;
  return (
    isNonNegativeInteger(v.observationsOffered) &&
    isNonNegativeInteger(v.observationsAdmitted) &&
    isNonNegativeInteger(v.observationsDeferred) &&
    isNonNegativeInteger(v.observationsUnsupported) &&
    isNonNegativeInteger(v.observationsInvalid)
  );
}

// ---------------------------------------------------------------------------
// Data gaps (enumerated, never free text)
// ---------------------------------------------------------------------------

/** The declared data-gap kinds. */
export const DATA_GAP_KINDS = [
  'no-sentiment-observations',
  'no-news-observations',
  'instrument-without-sentiment',
] as const;

/** A declared data gap. */
export type DataGapKind = (typeof DATA_GAP_KINDS)[number];

/** A structured data gap: an enumerated kind plus the instrument scope. */
export interface DataGap {
  readonly kind: DataGapKind;
  /** The instrument the gap is about ('' when scope-wide). */
  readonly instrument: string;
}

/** Guard: `DataGap`. */
export function isDataGap(v: unknown): v is DataGap {
  if (!isRecord(v)) return false;
  return (
    typeof v.kind === 'string' &&
    (DATA_GAP_KINDS as readonly string[]).includes(v.kind) &&
    typeof v.instrument === 'string'
  );
}

// ---------------------------------------------------------------------------
// The structured summary (enumerated fields only)
// ---------------------------------------------------------------------------

/** The dominant polarity of a report — a category, or 'no-reading'. */
export type DominantPolarity = PolarityDirection | 'no-reading';

/** Guard: `DominantPolarity`. */
export function isDominantPolarity(v: unknown): v is DominantPolarity {
  return (
    typeof v === 'string' &&
    ([...POLARITY_DIRECTIONS, 'no-reading'] as readonly string[]).includes(v)
  );
}

/**
 * THE structured summary: enumerated fields only. Counts, the dominant
 * polarity category, the exact mean polarity score (declared aggregation
 * output — null when there are no readings, never a fabricated zero),
 * the L4 coverage accounting, and the structured data gaps. No free-text
 * conclusions — the publication discipline is structural.
 */
export interface ResearchSummary {
  readonly readingCount: number;
  readonly digestCount: number;
  readonly instrumentCount: number;
  readonly dominantPolarity: DominantPolarity;
  /** The exact mean of reading polarity scores (null when no readings). */
  readonly meanPolarityScore: string | null;
  readonly coverage: CoverageAccounting;
  readonly dataGaps: readonly DataGap[];
}

/** Guard: `ResearchSummary` (structure only). */
export function isResearchSummary(v: unknown): v is ResearchSummary {
  if (!isRecord(v)) return false;
  return (
    isNonNegativeInteger(v.readingCount) &&
    isNonNegativeInteger(v.digestCount) &&
    isNonNegativeInteger(v.instrumentCount) &&
    isDominantPolarity(v.dominantPolarity) &&
    (v.meanPolarityScore === null || typeof v.meanPolarityScore === 'string') &&
    isCoverageAccounting(v.coverage) &&
    Array.isArray(v.dataGaps) &&
    (v.dataGaps as readonly unknown[]).every((gap) => isDataGap(gap))
  );
}

// ---------------------------------------------------------------------------
// ResearchReport
// ---------------------------------------------------------------------------

/**
 * THE publication record: the complete readings and digests it was
 * composed from, the enumerated summary, the as-of instant, the declared
 * report-composition method citation, the body version, tenant/project.
 * The id is DERIVED (`rr-<digest>`), never random.
 */
export interface ResearchReport {
  readonly reportId: ResearchReportId;
  /** The L4 instant the whole publication was computed as of. */
  readonly asOf: TimestampMs;
  readonly bodyVersion: BodyVersionRef;
  readonly methodId: MethodId;
  readonly methodVersion: MethodVersionRef;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
  readonly readings: readonly SentimentReading[];
  readonly digests: readonly EventDigest[];
  readonly summary: ResearchSummary;
}

/** Derives the report id: `rr-<stableDigest16>` over the canonical form. */
export function deriveResearchReportId(report: Omit<ResearchReport, 'reportId'>): ResearchReportId {
  return `rr-${stableDigest(canonicalJson(report as unknown as JsonValue))}` as ResearchReportId;
}

/** Guard: `ResearchReport` (structure only — use `validateResearchReport` for the laws). */
export function isResearchReport(v: unknown): v is ResearchReport {
  if (!isRecord(v)) return false;
  return (
    typeof v.reportId === 'string' &&
    v.reportId.startsWith('rr-') &&
    isTimestampMs(v.asOf) &&
    isBodyVersionRef(v.bodyVersion) &&
    isMethodId(v.methodId) &&
    isMethodVersionRef(v.methodVersion) &&
    isTenantId(v.tenantId) &&
    isProjectId(v.projectId) &&
    isNonEmptyString(v.seed) &&
    Array.isArray(v.readings) &&
    (v.readings as readonly unknown[]).every((r) => isSentimentReading(r)) &&
    Array.isArray(v.digests) &&
    (v.digests as readonly unknown[]).every((d) => isEventDigest(d)) &&
    isResearchSummary(v.summary)
  );
}

// ---------------------------------------------------------------------------
// Summary derivation (deterministic — the declared composition method)
// ---------------------------------------------------------------------------

/**
 * The dominance precedence for polarity categories: highest count wins;
 * ties resolve by this fixed order (deterministic bytes). 'neutral'
 * deliberately loses every tie — a neutral report is an absence of
 * signal, not a signal.
 */
const DOMINANCE_PRECEDENCE: readonly PolarityDirection[] = ['positive', 'negative', 'mixed', 'neutral'];

/** Computes the dominant polarity of readings (or 'no-reading'). */
export function dominantPolarityOf(readings: readonly SentimentReading[]): DominantPolarity {
  if (readings.length === 0) return 'no-reading';
  const counts = new Map<PolarityDirection, number>();
  for (const reading of readings) {
    counts.set(reading.polarity.direction, (counts.get(reading.polarity.direction) ?? 0) + 1);
  }
  let best: PolarityDirection = DOMINANCE_PRECEDENCE[0] as PolarityDirection;
  let bestCount = -1;
  for (const direction of DOMINANCE_PRECEDENCE) {
    const count = counts.get(direction) ?? 0;
    if (count > bestCount) {
      best = direction;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Computes the ENUMERATED summary from readings, digests, coverage and
 * data gaps — the declared report-composition method's pure function.
 * Every input is already validated by the caller.
 */
export function composeResearchSummary(input: {
  readonly readings: readonly SentimentReading[];
  readonly digests: readonly EventDigest[];
  readonly coverage: CoverageAccounting;
  readonly dataGaps: readonly DataGap[];
}): ResearchSummary {
  const instruments = new Set<string>();
  for (const reading of input.readings) instruments.add(reading.scope.instrument);
  for (const digest of input.digests) {
    for (const instrument of digest.instruments) instruments.add(instrument);
  }
  const mean =
    input.readings.length === 0
      ? null
      : decimalMean(
          input.readings.map((reading) => reading.polarity.score),
          4,
          'half-even',
        );
  return deepFreeze({
    readingCount: input.readings.length,
    digestCount: input.digests.length,
    instrumentCount: instruments.size,
    dominantPolarity: dominantPolarityOf(input.readings),
    meanPolarityScore: mean,
    coverage: input.coverage,
    dataGaps: input.dataGaps,
  });
}

// ---------------------------------------------------------------------------
// Validation (collect-all — every law, every violation)
// ---------------------------------------------------------------------------

/**
 * COLLECT-ALL validation of a research report: every embedded reading and
 * digest is re-validated against its own laws; the summary is re-derived
 * and compared (report_composition_mismatch); the as-of uniformity of the
 * whole publication is enforced (as_of_mismatch); method honesty
 * ('report-composition'); tenant/project (L12); derived-id law.
 */
export function validateResearchReport(v: unknown, registry: MethodRegistry): readonly ResearchError[] {
  const errors: ResearchError[] = [];
  if (!isRecord(v)) return [invalidType('report', 'a research report object')];
  if (typeof v.reportId !== 'string' || !v.reportId.startsWith('rr-')) {
    errors.push(invalidField('reportId', "must be a derived report id ('rr-<digest>')"));
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
  errors.push(
    ...resolveMethodCitation(registry, v.methodId, v.methodVersion, 'report-composition').map((e) => ({
      ...e,
      path: e.path.startsWith('method') ? e.path : `method.${e.path}`,
    })),
  );

  const readings = Array.isArray(v.readings) ? (v.readings as readonly unknown[]) : null;
  if (readings === null) {
    errors.push(invalidType('readings', 'an array of sentiment readings'));
  } else {
    readings.forEach((reading: unknown, index: number) => {
      for (const error of validateSentimentReading(reading, registry)) {
        errors.push({ ...error, path: `readings[${index}].${error.path}` });
      }
      // as-of uniformity: a publication is one point-in-time cut.
      if (isRecord(reading) && asOfOk && isTimestampMs(reading.asOf) && (reading.asOf as number) !== (v.asOf as number)) {
        errors.push({
          code: 'as_of_mismatch',
          path: `readings[${index}].asOf`,
          message: 'every embedded record must carry the publication as-of instant',
        });
      }
      if (isRecord(reading) && isBodyVersionRef(reading.bodyVersion) && isBodyVersionRef(v.bodyVersion) && reading.bodyVersion !== v.bodyVersion) {
        errors.push({
          code: 'lineage_missing',
          path: `readings[${index}].bodyVersion`,
          message: 'embedded records must cite the publishing body version',
        });
      }
    });
  }

  const digests = Array.isArray(v.digests) ? (v.digests as readonly unknown[]) : null;
  if (digests === null) {
    errors.push(invalidType('digests', 'an array of event digests'));
  } else {
    digests.forEach((digest: unknown, index: number) => {
      for (const error of validateEventDigest(digest, registry)) {
        errors.push({ ...error, path: `digests[${index}].${error.path}` });
      }
      if (isRecord(digest) && asOfOk && isTimestampMs(digest.asOf) && (digest.asOf as number) !== (v.asOf as number)) {
        errors.push({
          code: 'as_of_mismatch',
          path: `digests[${index}].asOf`,
          message: 'every embedded record must carry the publication as-of instant',
        });
      }
      if (isRecord(digest) && isBodyVersionRef(digest.bodyVersion) && isBodyVersionRef(v.bodyVersion) && digest.bodyVersion !== v.bodyVersion) {
        errors.push({
          code: 'lineage_missing',
          path: `digests[${index}].bodyVersion`,
          message: 'embedded records must cite the publishing body version',
        });
      }
    });
  }

  // summary re-derivation (the composition law)
  if (!isResearchSummary(v.summary)) {
    errors.push(invalidField('summary', 'must be an enumerated research summary'));
  } else if (readings !== null && digests !== null) {
    const embeddedReadings = readings.filter((r): r is SentimentReading => isSentimentReading(r));
    const embeddedDigests = digests.filter((d): d is EventDigest => isEventDigest(d));
    const expected = composeResearchSummary({
      readings: embeddedReadings,
      digests: embeddedDigests,
      coverage: v.summary.coverage,
      dataGaps: v.summary.dataGaps,
    });
    const summary = v.summary as ResearchSummary;
    if (
      summary.readingCount !== expected.readingCount ||
      summary.digestCount !== expected.digestCount ||
      summary.instrumentCount !== expected.instrumentCount ||
      summary.dominantPolarity !== expected.dominantPolarity ||
      summary.meanPolarityScore !== expected.meanPolarityScore
    ) {
      errors.push({
        code: 'report_composition_mismatch',
        path: 'summary',
        message: 'the summary does not match its canonical derivation from the embedded records',
      });
    }
    if (!isCoverageAccounting(summary.coverage)) {
      errors.push(invalidField('summary.coverage', 'must be non-negative counts'));
    } else {
      const coverage = summary.coverage;
      const buckets =
        coverage.observationsAdmitted +
        coverage.observationsDeferred +
        coverage.observationsUnsupported +
        coverage.observationsInvalid;
      if (buckets !== coverage.observationsOffered) {
        errors.push({
          code: 'report_composition_mismatch',
          path: 'summary.coverage',
          message: 'the coverage buckets must sum to observationsOffered (nothing silently dropped)',
        });
      }
    }
  }

  // derived-id law (tamper trip-wire)
  if (typeof v.reportId === 'string' && v.reportId.startsWith('rr-') && errors.length === 0) {
    const { reportId: _ignored, ...material } = v as unknown as ResearchReport;
    void _ignored;
    if (deriveResearchReportId(material as Omit<ResearchReport, 'reportId'>) !== v.reportId) {
      errors.push({
        code: 'digest_mismatch',
        path: 'reportId',
        message: 'the report id does not match its canonical content — the record was tampered with',
      });
    }
  }
  return errors;
}

/** Validation wrapper: `ResearchReport`. */
export function validateResearchReportRecord(v: unknown, registry: MethodRegistry): ResearchValidation<ResearchReport> {
  const errors = validateResearchReport(v, registry);
  return validationOf(errors.length === 0 ? (v as ResearchReport) : null, errors);
}

/**
 * Creates a validated, deeply-frozen research report. The `reportId` is
 * DERIVED from the canonical form of the draft; the draft (and every
 * embedded record) must satisfy every research law. Refusal is typed
 * data.
 */
export function createResearchReport(
  draft: Omit<ResearchReport, 'reportId'>,
  registry: MethodRegistry,
): ResearchResult<ResearchReport> {
  const errors = validateResearchReport({ ...draft, reportId: 'rr-pending' }, registry).filter(
    (error) => error.path !== 'reportId',
  );
  if (errors.length > 0) return { ok: false, errors };
  const reportId = deriveResearchReportId(draft);
  return { ok: true, value: deepFreeze({ ...draft, reportId }) };
}

/** Canonical serialization of a report (byte-deterministic, L9). */
export function serializeResearchReport(report: ResearchReport): string {
  return canonicalJson(report as unknown as JsonValue);
}
