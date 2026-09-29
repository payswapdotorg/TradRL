// @tradrl/body-regime-researcher — the regime research publication record.
//
// Owning Work Order: T022, section 5: "ResearchReport — the publication
// record: readings + digests + a structured summary (no free-text
// conclusions — fields are enumerated)." (This lane's twins of readings
// and digests are classifications and changes.)
//
// A RegimeResearchReport is what the researcher PUBLISHES (through the
// agent-os envelope mirror port — the service lane). It embeds the
// complete classifications and changes (full lineage travels with the
// publication — L9), plus an ENUMERATED summary: counts, the dominant
// regime label, the exact mean net-move ratio, L4 coverage accounting
// (offered / admitted / deferred / unsupported / invalid — nothing
// silently dropped), and structured data gaps. There is no free-text
// conclusion field anywhere in this record: publication discipline is
// structural.
//
// Validation re-derives the summary from the embedded classifications and
// changes (report_composition_mismatch on drift), re-validates every
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
  type RegimeMethodId,
  type RegimeMethodVersionRef,
  type ProjectId,
  type RegimeResearchReportId,
  type TenantId,
  isBodyVersionRef,
  isRegimeMethodId,
  isRegimeMethodVersionRef,
  isProjectId,
  isTenantId,
} from './ids';
import {
  type RegimeMethodRegistry,
  type RegimeReportCompositionParameters,
  type RegimeClassificationParameters,
  resolveRegimeMethodCitation,
  findRegimeMethod,
} from './methods';
import {
  type RegimeClassification,
  isRegimeClassification,
  validateRegimeClassification,
} from './classification';
import { type RegimeChange, isRegimeChange, validateRegimeChange } from './change';
import { decimalMean } from './decimals';
import { type RegimeError, type RegimeResult, type RegimeValidation, invalidField, invalidType, validationOf } from './errors';

// ---------------------------------------------------------------------------
// Coverage accounting (L4 gate bookkeeping — nothing silently dropped)
// ---------------------------------------------------------------------------

/**
 * The intake accounting every publication carries: how many observations
 * were offered by the sources, and how each one was classified. The sum
 * of the buckets always equals `observationsOffered`.
 */
export interface IntakeCoverage {
  readonly observationsOffered: number;
  readonly observationsAdmitted: number;
  readonly observationsDeferred: number;
  readonly observationsUnsupported: number;
  readonly observationsInvalid: number;
}

/** Guard: `IntakeCoverage`. */
export function isIntakeCoverage(v: unknown): v is IntakeCoverage {
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
export const REGIME_DATA_GAP_KINDS = [
  'no-market-observations',
  'instrument-without-classification',
] as const;

/** A declared data gap. */
export type RegimeDataGapKind = (typeof REGIME_DATA_GAP_KINDS)[number];

/** A structured data gap: an enumerated kind plus the instrument scope. */
export interface RegimeDataGap {
  readonly kind: RegimeDataGapKind;
  /** The instrument the gap is about ('' when scope-wide). */
  readonly instrument: string;
}

/** Guard: `RegimeDataGap`. */
export function isRegimeDataGap(v: unknown): v is RegimeDataGap {
  if (!isRecord(v)) return false;
  return (
    typeof v.kind === 'string' &&
    (REGIME_DATA_GAP_KINDS as readonly string[]).includes(v.kind) &&
    typeof v.instrument === 'string'
  );
}

// ---------------------------------------------------------------------------
// The structured summary (enumerated fields only)
// ---------------------------------------------------------------------------

/** The dominant regime of a report — a declared label, or 'no-classification'. */
export type DominantRegime = string | 'no-classification';

/** Guard: `DominantRegime`. */
export function isDominantRegime(v: unknown): v is DominantRegime {
  return isNonEmptyString(v);
}

/**
 * THE structured summary: enumerated fields only. Counts, the dominant
 * regime label, the exact mean of the classifications' net-move ratios
 * (declared aggregation output — null when there are no classifications,
 * never a fabricated zero), the L4 coverage accounting, and the
 * structured data gaps. No free-text conclusions — the publication
 * discipline is structural.
 */
export interface RegimeSummary {
  readonly classificationCount: number;
  readonly changeCount: number;
  readonly instrumentCount: number;
  /** The number of distinct (scope, window) pairs classified. */
  readonly windowCount: number;
  readonly dominantRegime: DominantRegime;
  /** The exact mean of classification net-move ratios (null when none). */
  readonly meanNetMoveRatio: string | null;
  readonly coverage: IntakeCoverage;
  readonly dataGaps: readonly RegimeDataGap[];
}

/** Guard: `RegimeSummary` (structure only). */
export function isRegimeSummary(v: unknown): v is RegimeSummary {
  if (!isRecord(v)) return false;
  return (
    isNonNegativeInteger(v.classificationCount) &&
    isNonNegativeInteger(v.changeCount) &&
    isNonNegativeInteger(v.instrumentCount) &&
    isNonNegativeInteger(v.windowCount) &&
    isDominantRegime(v.dominantRegime) &&
    (v.meanNetMoveRatio === null || typeof v.meanNetMoveRatio === 'string') &&
    isIntakeCoverage(v.coverage) &&
    Array.isArray(v.dataGaps) &&
    (v.dataGaps as readonly unknown[]).every((gap) => isRegimeDataGap(gap))
  );
}

// ---------------------------------------------------------------------------
// RegimeResearchReport
// ---------------------------------------------------------------------------

/**
 * THE publication record: the complete classifications and changes it was
 * composed from, the enumerated summary, the as-of instant, the declared
 * report-composition method citation, the body version, tenant/project.
 * The id is DERIVED (`rr-<digest>`), never random.
 */
export interface RegimeResearchReport {
  readonly reportId: RegimeResearchReportId;
  /** The L4 instant the whole publication was computed as of. */
  readonly asOf: TimestampMs;
  readonly bodyVersion: BodyVersionRef;
  readonly methodId: RegimeMethodId;
  readonly methodVersion: RegimeMethodVersionRef;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
  readonly classifications: readonly RegimeClassification[];
  readonly changes: readonly RegimeChange[];
  readonly summary: RegimeSummary;
}

/** Derives the report id: `rr-<stableDigest16>` over the canonical form. */
export function deriveRegimeResearchReportId(
  report: Omit<RegimeResearchReport, 'reportId'>,
): RegimeResearchReportId {
  return `rr-${stableDigest(canonicalJson(report as unknown as JsonValue))}` as RegimeResearchReportId;
}

/** Guard: `RegimeResearchReport` (structure only — use `validateRegimeResearchReport` for the laws). */
export function isRegimeResearchReport(v: unknown): v is RegimeResearchReport {
  if (!isRecord(v)) return false;
  return (
    typeof v.reportId === 'string' &&
    v.reportId.startsWith('rr-') &&
    isTimestampMs(v.asOf) &&
    isBodyVersionRef(v.bodyVersion) &&
    isRegimeMethodId(v.methodId) &&
    isRegimeMethodVersionRef(v.methodVersion) &&
    isTenantId(v.tenantId) &&
    isProjectId(v.projectId) &&
    isNonEmptyString(v.seed) &&
    Array.isArray(v.classifications) &&
    (v.classifications as readonly unknown[]).every((c) => isRegimeClassification(c)) &&
    Array.isArray(v.changes) &&
    (v.changes as readonly unknown[]).every((c) => isRegimeChange(c)) &&
    isRegimeSummary(v.summary)
  );
}

// ---------------------------------------------------------------------------
// Summary derivation (deterministic — the declared composition method)
// ---------------------------------------------------------------------------

/**
 * Computes the dominant regime of classifications: highest count wins;
 * ties resolve by the method's declared taxonomy order (deterministic
 * bytes). 'no-classification' when there are no classifications.
 */
export function dominantRegimeOf(
  classifications: readonly RegimeClassification[],
  taxonomy: readonly string[],
): DominantRegime {
  if (classifications.length === 0) return 'no-classification';
  const counts = new Map<string, number>();
  for (const classification of classifications) {
    counts.set(classification.label, (counts.get(classification.label) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = -1;
  for (const label of taxonomy) {
    const count = counts.get(label) ?? 0;
    if (count > bestCount) {
      best = label;
      bestCount = count;
    }
  }
  // Labels outside the declared taxonomy order (a superset taxonomy may
  // carry unused labels, but classifications only ever carry declared
  // ones): count them after, in first-appearance order, deterministically.
  if (best === null || bestCount === 0) {
    for (const classification of classifications) {
      const count = counts.get(classification.label) ?? 0;
      if (count > bestCount) {
        best = classification.label;
        bestCount = count;
      }
    }
  }
  return best ?? 'no-classification';
}

/**
 * Computes the ENUMERATED summary from classifications, changes, coverage
 * and data gaps — the declared report-composition method's pure
 * function. Every input is already validated by the caller; the scale
 * and rounding of the aggregate statistic come from the composition
 * method's declared parameters, never an implicit constant.
 */
export function composeRegimeSummary(input: {
  readonly classifications: readonly RegimeClassification[];
  readonly changes: readonly RegimeChange[];
  readonly coverage: IntakeCoverage;
  readonly dataGaps: readonly RegimeDataGap[];
  readonly taxonomy: readonly string[];
  readonly outputScale: number;
  readonly rounding: 'half-even' | 'truncate';
}): RegimeSummary {
  const instruments = new Set<string>();
  const windows = new Set<string>();
  for (const classification of input.classifications) {
    instruments.add(classification.scope.instrument);
    windows.add(`${classification.scope.instrument}|${classification.scope.venue}|${classification.window.from}`);
  }
  for (const change of input.changes) instruments.add(change.scope.instrument);
  const mean =
    input.classifications.length === 0
      ? null
      : decimalMean(
          input.classifications.map((classification) => classification.netMoveRatio),
          input.outputScale,
          input.rounding,
        );
  return deepFreeze({
    classificationCount: input.classifications.length,
    changeCount: input.changes.length,
    instrumentCount: instruments.size,
    windowCount: windows.size,
    dominantRegime: dominantRegimeOf(input.classifications, input.taxonomy),
    meanNetMoveRatio: mean,
    coverage: input.coverage,
    dataGaps: input.dataGaps,
  });
}

// ---------------------------------------------------------------------------
// Validation (collect-all — every law, every violation)
// ---------------------------------------------------------------------------

/**
 * COLLECT-ALL validation of a regime research report: every embedded
 * classification and change is re-validated against its own laws; the
 * summary is re-derived and compared (report_composition_mismatch); the
 * as-of uniformity of the whole publication is enforced (as_of_mismatch);
 * method honesty ('report-composition'); tenant/project (L12);
 * derived-id law.
 */
export function validateRegimeResearchReport(v: unknown, registry: RegimeMethodRegistry): readonly RegimeError[] {
  const errors: RegimeError[] = [];
  if (!isRecord(v)) return [invalidType('report', 'a regime research report object')];
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
    ...resolveRegimeMethodCitation(registry, v.methodId, v.methodVersion, 'report-composition').map((e) => ({
      ...e,
      path: e.path.startsWith('method') ? e.path : `method.${e.path}`,
    })),
  );
  const compositionMethod = isRegimeMethodId(v.methodId) ? findRegimeMethod(registry, v.methodId) : null;
  const compositionParameters =
    compositionMethod !== null && compositionMethod.kind === 'report-composition'
      ? (compositionMethod.parameters as RegimeReportCompositionParameters)
      : null;
  let taxonomy: readonly string[] = [];
  if (compositionParameters !== null) {
    // the dominant-regime derivation needs the classification taxonomy —
    // resolve the registry's canonical classification method.
    const classificationMethod = findRegimeMethod(registry, 'method/regime/classification');
    if (classificationMethod !== null && classificationMethod.kind === 'regime-classification') {
      taxonomy = (classificationMethod.parameters as RegimeClassificationParameters).regimes;
    }
  }

  const classifications = Array.isArray(v.classifications) ? (v.classifications as readonly unknown[]) : null;
  if (classifications === null) {
    errors.push(invalidType('classifications', 'an array of regime classifications'));
  } else {
    classifications.forEach((classification: unknown, index: number) => {
      for (const error of validateRegimeClassification(classification, registry)) {
        errors.push({ ...error, path: `classifications[${index}].${error.path}` });
      }
      // as-of uniformity: a publication is one point-in-time cut.
      if (isRecord(classification) && asOfOk && isTimestampMs(classification.asOf) && (classification.asOf as number) !== (v.asOf as number)) {
        errors.push({
          code: 'as_of_mismatch',
          path: `classifications[${index}].asOf`,
          message: 'every embedded record must carry the publication as-of instant',
        });
      }
      if (isRecord(classification) && isBodyVersionRef(classification.bodyVersion) && isBodyVersionRef(v.bodyVersion) && classification.bodyVersion !== v.bodyVersion) {
        errors.push({
          code: 'lineage_missing',
          path: `classifications[${index}].bodyVersion`,
          message: 'embedded records must cite the publishing body version',
        });
      }
    });
  }

  const changes = Array.isArray(v.changes) ? (v.changes as readonly unknown[]) : null;
  if (changes === null) {
    errors.push(invalidType('changes', 'an array of regime changes'));
  } else {
    changes.forEach((change: unknown, index: number) => {
      for (const error of validateRegimeChange(change, registry)) {
        errors.push({ ...error, path: `changes[${index}].${error.path}` });
      }
      if (isRecord(change) && asOfOk && isTimestampMs(change.asOf) && (change.asOf as number) !== (v.asOf as number)) {
        errors.push({
          code: 'as_of_mismatch',
          path: `changes[${index}].asOf`,
          message: 'every embedded record must carry the publication as-of instant',
        });
      }
      if (isRecord(change) && isBodyVersionRef(change.bodyVersion) && isBodyVersionRef(v.bodyVersion) && change.bodyVersion !== v.bodyVersion) {
        errors.push({
          code: 'lineage_missing',
          path: `changes[${index}].bodyVersion`,
          message: 'embedded records must cite the publishing body version',
        });
      }
    });
  }

  // summary re-derivation (the composition law)
  if (!isRegimeSummary(v.summary)) {
    errors.push(invalidField('summary', 'must be an enumerated regime research summary'));
  } else if (classifications !== null && changes !== null) {
    const embeddedClassifications = classifications.filter((c): c is RegimeClassification => isRegimeClassification(c));
    const embeddedChanges = changes.filter((c): c is RegimeChange => isRegimeChange(c));
    const expected = composeRegimeSummary({
      classifications: embeddedClassifications,
      changes: embeddedChanges,
      coverage: v.summary.coverage,
      dataGaps: v.summary.dataGaps,
      taxonomy,
      outputScale: compositionParameters !== null ? compositionParameters.outputScale : 4,
      rounding: compositionParameters !== null ? compositionParameters.rounding : 'half-even',
    });
    const summary = v.summary as RegimeSummary;
    if (
      summary.classificationCount !== expected.classificationCount ||
      summary.changeCount !== expected.changeCount ||
      summary.instrumentCount !== expected.instrumentCount ||
      summary.windowCount !== expected.windowCount ||
      summary.dominantRegime !== expected.dominantRegime ||
      summary.meanNetMoveRatio !== expected.meanNetMoveRatio
    ) {
      errors.push({
        code: 'report_composition_mismatch',
        path: 'summary',
        message: 'the summary does not match its canonical derivation from the embedded records',
      });
    }
    if (!isIntakeCoverage(summary.coverage)) {
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
    const { reportId: _ignored, ...material } = v as unknown as RegimeResearchReport;
    void _ignored;
    if (deriveRegimeResearchReportId(material as Omit<RegimeResearchReport, 'reportId'>) !== v.reportId) {
      errors.push({
        code: 'digest_mismatch',
        path: 'reportId',
        message: 'the report id does not match its canonical content — the record was tampered with',
      });
    }
  }
  return errors;
}

/** Validation wrapper: `RegimeResearchReport`. */
export function validateRegimeResearchReportRecord(
  v: unknown,
  registry: RegimeMethodRegistry,
): RegimeValidation<RegimeResearchReport> {
  const errors = validateRegimeResearchReport(v, registry);
  return validationOf(errors.length === 0 ? (v as RegimeResearchReport) : null, errors);
}

/**
 * Creates a validated, deeply-frozen regime research report. The
 * `reportId` is DERIVED from the canonical form of the draft; the draft
 * (and every embedded record) must satisfy every research law. Refusal is
 * typed data.
 */
export function createRegimeResearchReport(
  draft: Omit<RegimeResearchReport, 'reportId'>,
  registry: RegimeMethodRegistry,
): RegimeResult<RegimeResearchReport> {
  const errors = validateRegimeResearchReport({ ...draft, reportId: 'rr-pending' }, registry).filter(
    (error) => error.path !== 'reportId',
  );
  if (errors.length > 0) return { ok: false, errors };
  const reportId = deriveRegimeResearchReportId(draft);
  return { ok: true, value: deepFreeze({ ...draft, reportId }) };
}

/** Canonical serialization of a report (byte-deterministic, L9). */
export function serializeRegimeResearchReport(report: RegimeResearchReport): string {
  return canonicalJson(report as unknown as JsonValue);
}
