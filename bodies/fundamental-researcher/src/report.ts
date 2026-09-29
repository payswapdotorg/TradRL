// @tradrl/body-fundamental-researcher — the research publication record.
//
// Owning Work Order: T023, section 5: "ResearchReport — the publication
// record: readings + digests + a structured summary (no free-text
// conclusions — fields are enumerated)."
//
// A FundamentalResearchReport is what the researcher PUBLISHES (through
// the agent-os envelope mirror port — the service lane). It embeds the
// complete assessments and corporate-action digests (full lineage travels
// with the publication — L9), plus an ENUMERATED summary: counts, the
// dominant stance category, the exact mean stance score, L4 coverage
// accounting (offered / admitted / deferred / unsupported / invalid —
// nothing silently dropped), and structured data gaps. There is no
// free-text conclusion field anywhere in this record: publication
// discipline is structural.
//
// Validation re-derives the summary from the embedded assessments and
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
  type FundamentalMethodId,
  type FundamentalMethodVersionRef,
  type ProjectId,
  type FundamentalResearchReportId,
  type TenantId,
  isBodyVersionRef,
  isFundamentalMethodId,
  isFundamentalMethodVersionRef,
  isProjectId,
  isTenantId,
} from './ids';
import { type FundamentalMethodRegistry, resolveFundamentalMethodCitation } from './methods';
import {
  type FundamentalAssessment,
  isFundamentalAssessment,
  validateFundamentalAssessment,
  STANCE_DIRECTIONS,
  type StanceDirection,
} from './assessment';
import { type CorporateActionDigest, isCorporateActionDigest, validateCorporateActionDigest } from './action-digest';
import { decimalMean } from './decimals';
import { type FundamentalError, type FundamentalResult, type FundamentalValidation, invalidField, invalidType, validationOf } from './errors';

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
  'no-fundamental-observations',
  'no-macro-observations',
  'no-corporate-action-observations',
  'unassessed-series',
] as const;

/** A declared data gap. */
export type FundamentalDataGapKind = (typeof DATA_GAP_KINDS)[number];

/** A structured data gap: an enumerated kind plus the series scope. */
export interface FundamentalDataGap {
  readonly kind: FundamentalDataGapKind;
  /** The instrument the gap is about ('' when scope-wide). */
  readonly instrument: string;
  /** The series the gap is about ('' when scope-wide). */
  readonly series: string;
}

/** Guard: `FundamentalDataGap`. */
export function isFundamentalDataGap(v: unknown): v is FundamentalDataGap {
  if (!isRecord(v)) return false;
  return (
    typeof v.kind === 'string' &&
    (DATA_GAP_KINDS as readonly string[]).includes(v.kind) &&
    typeof v.instrument === 'string' &&
    typeof v.series === 'string'
  );
}

// ---------------------------------------------------------------------------
// The structured summary (enumerated fields only)
// ---------------------------------------------------------------------------

/** The dominant stance of a report — a category, or 'no-assessment'. */
export type DominantStance = StanceDirection | 'no-assessment';

/** Guard: `DominantStance`. */
export function isDominantStance(v: unknown): v is DominantStance {
  return (
    typeof v === 'string' &&
    ([...STANCE_DIRECTIONS, 'no-assessment'] as readonly string[]).includes(v)
  );
}

/**
 * THE structured summary: enumerated fields only. Counts, the dominant
 * stance category, the exact mean stance score (declared assessment
 * output — null when there are no assessments, never a fabricated zero),
 * the L4 coverage accounting, and the structured data gaps. No free-text
 * conclusions — the publication discipline is structural.
 */
export interface FundamentalSummary {
  readonly assessmentCount: number;
  readonly actionDigestCount: number;
  readonly instrumentCount: number;
  readonly dominantStance: DominantStance;
  /** The exact mean of assessment stance scores (null when no assessments). */
  readonly meanStanceScore: string | null;
  readonly coverage: CoverageAccounting;
  readonly dataGaps: readonly FundamentalDataGap[];
}

/** Guard: `FundamentalSummary` (structure only). */
export function isFundamentalSummary(v: unknown): v is FundamentalSummary {
  if (!isRecord(v)) return false;
  return (
    isNonNegativeInteger(v.assessmentCount) &&
    isNonNegativeInteger(v.actionDigestCount) &&
    isNonNegativeInteger(v.instrumentCount) &&
    isDominantStance(v.dominantStance) &&
    (v.meanStanceScore === null || typeof v.meanStanceScore === 'string') &&
    isCoverageAccounting(v.coverage) &&
    Array.isArray(v.dataGaps) &&
    (v.dataGaps as readonly unknown[]).every((gap) => isFundamentalDataGap(gap))
  );
}

// ---------------------------------------------------------------------------
// FundamentalResearchReport
// ---------------------------------------------------------------------------

/**
 * THE publication record: the complete assessments and action digests it
 * was composed from, the enumerated summary, the as-of instant, the
 * declared report-composition method citation, the body version,
 * tenant/project. The id is DERIVED (`frr-<digest>`), never random.
 */
export interface FundamentalResearchReport {
  readonly reportId: FundamentalResearchReportId;
  /** The L4 instant the whole publication was computed as of. */
  readonly asOf: TimestampMs;
  readonly bodyVersion: BodyVersionRef;
  readonly methodId: FundamentalMethodId;
  readonly methodVersion: FundamentalMethodVersionRef;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
  readonly assessments: readonly FundamentalAssessment[];
  readonly actionDigests: readonly CorporateActionDigest[];
  readonly summary: FundamentalSummary;
}

/** Derives the report id: `frr-<stableDigest16>` over the canonical form. */
export function deriveFundamentalReportId(report: Omit<FundamentalResearchReport, 'reportId'>): FundamentalResearchReportId {
  return `frr-${stableDigest(canonicalJson(report as unknown as JsonValue))}` as FundamentalResearchReportId;
}

/** Guard: `FundamentalResearchReport` (structure only — use `validateFundamentalResearchReport` for the laws). */
export function isFundamentalResearchReport(v: unknown): v is FundamentalResearchReport {
  if (!isRecord(v)) return false;
  return (
    typeof v.reportId === 'string' &&
    v.reportId.startsWith('frr-') &&
    isTimestampMs(v.asOf) &&
    isBodyVersionRef(v.bodyVersion) &&
    isFundamentalMethodId(v.methodId) &&
    isFundamentalMethodVersionRef(v.methodVersion) &&
    isTenantId(v.tenantId) &&
    isProjectId(v.projectId) &&
    isNonEmptyString(v.seed) &&
    Array.isArray(v.assessments) &&
    (v.assessments as readonly unknown[]).every((r) => isFundamentalAssessment(r)) &&
    Array.isArray(v.actionDigests) &&
    (v.actionDigests as readonly unknown[]).every((d) => isCorporateActionDigest(d)) &&
    isFundamentalSummary(v.summary)
  );
}

// ---------------------------------------------------------------------------
// Summary derivation (deterministic — the declared composition method)
// ---------------------------------------------------------------------------

/**
 * The dominance precedence for stance categories: highest count wins;
 * ties resolve by this fixed order (deterministic bytes). 'neutral'
 * deliberately loses every tie — a neutral report is an absence of
 * signal, not a signal.
 */
const DOMINANCE_PRECEDENCE: readonly StanceDirection[] = ['positive', 'negative', 'neutral'];

/** Computes the dominant stance of assessments (or 'no-assessment'). */
export function dominantStanceOf(assessments: readonly FundamentalAssessment[]): DominantStance {
  if (assessments.length === 0) return 'no-assessment';
  const counts = new Map<StanceDirection, number>();
  for (const assessment of assessments) {
    counts.set(assessment.stance.direction, (counts.get(assessment.stance.direction) ?? 0) + 1);
  }
  let best: StanceDirection = DOMINANCE_PRECEDENCE[0] as StanceDirection;
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
 * Computes the ENUMERATED summary from assessments, action digests,
 * coverage and data gaps — the declared report-composition method's pure
 * function. Every input is already validated by the caller.
 */
export function composeFundamentalSummary(input: {
  readonly assessments: readonly FundamentalAssessment[];
  readonly actionDigests: readonly CorporateActionDigest[];
  readonly coverage: CoverageAccounting;
  readonly dataGaps: readonly FundamentalDataGap[];
}): FundamentalSummary {
  const instruments = new Set<string>();
  for (const assessment of input.assessments) instruments.add(assessment.scope.instrument);
  for (const digest of input.actionDigests) {
    for (const instrument of digest.instruments) instruments.add(instrument);
  }
  const mean =
    input.assessments.length === 0
      ? null
      : decimalMean(
          input.assessments.map((assessment) => assessment.stance.score),
          4,
          'half-even',
        );
  return deepFreeze({
    assessmentCount: input.assessments.length,
    actionDigestCount: input.actionDigests.length,
    instrumentCount: instruments.size,
    dominantStance: dominantStanceOf(input.assessments),
    meanStanceScore: mean,
    coverage: input.coverage,
    dataGaps: input.dataGaps,
  });
}

// ---------------------------------------------------------------------------
// Validation (collect-all — every law, every violation)
// ---------------------------------------------------------------------------

/**
 * COLLECT-ALL validation of a fundamental research report: every embedded
 * assessment and action digest is re-validated against its own laws; the
 * summary is re-derived and compared (report_composition_mismatch); the
 * as-of uniformity of the whole publication is enforced (as_of_mismatch);
 * method honesty ('report-composition'); tenant/project (L12); derived-id
 * law.
 */
export function validateFundamentalResearchReport(v: unknown, registry: FundamentalMethodRegistry): readonly FundamentalError[] {
  const errors: FundamentalError[] = [];
  if (!isRecord(v)) return [invalidType('report', 'a research report object')];
  if (typeof v.reportId !== 'string' || !v.reportId.startsWith('frr-')) {
    errors.push(invalidField('reportId', "must be a derived report id ('frr-<digest>')"));
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
    ...resolveFundamentalMethodCitation(registry, v.methodId, v.methodVersion, 'report-composition').map((e) => ({
      ...e,
      path: e.path.startsWith('method') ? e.path : `method.${e.path}`,
    })),
  );

  const assessments = Array.isArray(v.assessments) ? (v.assessments as readonly unknown[]) : null;
  if (assessments === null) {
    errors.push(invalidType('assessments', 'an array of fundamental assessments'));
  } else {
    assessments.forEach((assessment: unknown, index: number) => {
      for (const error of validateFundamentalAssessment(assessment, registry)) {
        errors.push({ ...error, path: `assessments[${index}].${error.path}` });
      }
      // as-of uniformity: a publication is one point-in-time cut.
      if (isRecord(assessment) && asOfOk && isTimestampMs(assessment.asOf) && (assessment.asOf as number) !== (v.asOf as number)) {
        errors.push({
          code: 'as_of_mismatch',
          path: `assessments[${index}].asOf`,
          message: 'every embedded record must carry the publication as-of instant',
        });
      }
      if (isRecord(assessment) && isBodyVersionRef(assessment.bodyVersion) && isBodyVersionRef(v.bodyVersion) && assessment.bodyVersion !== v.bodyVersion) {
        errors.push({
          code: 'lineage_missing',
          path: `assessments[${index}].bodyVersion`,
          message: 'embedded records must cite the publishing body version',
        });
      }
    });
  }

  const digests = Array.isArray(v.actionDigests) ? (v.actionDigests as readonly unknown[]) : null;
  if (digests === null) {
    errors.push(invalidType('actionDigests', 'an array of corporate-action digests'));
  } else {
    digests.forEach((digest: unknown, index: number) => {
      for (const error of validateCorporateActionDigest(digest, registry)) {
        errors.push({ ...error, path: `actionDigests[${index}].${error.path}` });
      }
      if (isRecord(digest) && asOfOk && isTimestampMs(digest.asOf) && (digest.asOf as number) !== (v.asOf as number)) {
        errors.push({
          code: 'as_of_mismatch',
          path: `actionDigests[${index}].asOf`,
          message: 'every embedded record must carry the publication as-of instant',
        });
      }
      if (isRecord(digest) && isBodyVersionRef(digest.bodyVersion) && isBodyVersionRef(v.bodyVersion) && digest.bodyVersion !== v.bodyVersion) {
        errors.push({
          code: 'lineage_missing',
          path: `actionDigests[${index}].bodyVersion`,
          message: 'embedded records must cite the publishing body version',
        });
      }
    });
  }

  // summary re-derivation (the composition law)
  if (!isFundamentalSummary(v.summary)) {
    errors.push(invalidField('summary', 'must be an enumerated fundamental research summary'));
  } else if (assessments !== null && digests !== null) {
    const embeddedAssessments = assessments.filter((r): r is FundamentalAssessment => isFundamentalAssessment(r));
    const embeddedDigests = digests.filter((d): d is CorporateActionDigest => isCorporateActionDigest(d));
    const expected = composeFundamentalSummary({
      assessments: embeddedAssessments,
      actionDigests: embeddedDigests,
      coverage: v.summary.coverage,
      dataGaps: v.summary.dataGaps,
    });
    const summary = v.summary as FundamentalSummary;
    if (
      summary.assessmentCount !== expected.assessmentCount ||
      summary.actionDigestCount !== expected.actionDigestCount ||
      summary.instrumentCount !== expected.instrumentCount ||
      summary.dominantStance !== expected.dominantStance ||
      summary.meanStanceScore !== expected.meanStanceScore
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
  if (typeof v.reportId === 'string' && v.reportId.startsWith('frr-') && errors.length === 0) {
    const { reportId: _ignored, ...material } = v as unknown as FundamentalResearchReport;
    void _ignored;
    if (deriveFundamentalReportId(material as Omit<FundamentalResearchReport, 'reportId'>) !== v.reportId) {
      errors.push({
        code: 'digest_mismatch',
        path: 'reportId',
        message: 'the report id does not match its canonical content — the record was tampered with',
      });
    }
  }
  return errors;
}

/** Validation wrapper: `FundamentalResearchReport`. */
export function validateFundamentalResearchReportRecord(v: unknown, registry: FundamentalMethodRegistry): FundamentalValidation<FundamentalResearchReport> {
  const errors = validateFundamentalResearchReport(v, registry);
  return validationOf(errors.length === 0 ? (v as FundamentalResearchReport) : null, errors);
}

/**
 * Creates a validated, deeply-frozen fundamental research report. The
 * `reportId` is DERIVED from the canonical form of the draft; the draft
 * (and every embedded record) must satisfy every research law. Refusal is
 * typed data.
 */
export function createFundamentalResearchReport(
  draft: Omit<FundamentalResearchReport, 'reportId'>,
  registry: FundamentalMethodRegistry,
): FundamentalResult<FundamentalResearchReport> {
  const errors = validateFundamentalResearchReport({ ...draft, reportId: 'frr-pending' }, registry).filter(
    (error) => error.path !== 'reportId',
  );
  if (errors.length > 0) return { ok: false, errors };
  const reportId = deriveFundamentalReportId(draft);
  return { ok: true, value: deepFreeze({ ...draft, reportId }) };
}

/** Canonical serialization of a report (byte-deterministic, L9). */
export function serializeFundamentalResearchReport(report: FundamentalResearchReport): string {
  return canonicalJson(report as unknown as JsonValue);
}
