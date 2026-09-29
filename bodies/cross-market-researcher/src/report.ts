// @tradrl/body-cross-market-researcher — the research publication record.
//
// Owning Work Order: T023, section 5: "ResearchReport — the publication
// record: readings + ... a structured summary (no free-text conclusions —
// fields are enumerated)." (the cross-market twin).
//
// A CrossMarketResearchReport is what the researcher PUBLISHES (through
// the agent-os envelope mirror port — the service lane). It embeds the
// complete relationships (full lineage travels with the publication —
// L9), plus an ENUMERATED summary: counts, the dominant relation kind,
// the exact mean measure score, L4 coverage accounting (offered /
// admitted / deferred / unsupported / invalid — nothing silently
// dropped), and structured data gaps. There is no free-text conclusion
// field anywhere in this record: publication discipline is structural.
//
// Validation re-derives the summary from the embedded relationships
// (report_composition_mismatch on drift), re-validates every embedded
// record against its own laws, enforces the as-of uniformity of the
// whole publication (as_of_mismatch), and recomputes the derived report
// id (digest_mismatch — the tamper trip-wire).

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
  type CrossMarketMethodId,
  type CrossMarketMethodVersionRef,
  type ProjectId,
  type CrossMarketResearchReportId,
  type TenantId,
  isBodyVersionRef,
  isCrossMarketMethodId,
  isCrossMarketMethodVersionRef,
  isProjectId,
  isTenantId,
} from './ids';
import { type CrossMarketMethodRegistry, resolveCrossMarketMethodCitation, RELATIONSHIP_KINDS, type RelationshipKind } from './methods';
import {
  type CrossMarketRelationship,
  isCrossMarketRelationship,
  validateCrossMarketRelationship,
} from './relationship';
import { decimalMean } from './decimals';
import { type CrossMarketError, type CrossMarketResult, type CrossMarketValidation, invalidField, invalidType, validationOf } from './errors';

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
export const CROSS_MARKET_DATA_GAP_KINDS = [
  'no-observations',
  'insufficient-leg-observations',
  'insufficient-compared-windows',
  'insufficient-decisive-windows',
] as const;

/** A declared data gap. */
export type CrossMarketDataGapKind = (typeof CROSS_MARKET_DATA_GAP_KINDS)[number];

/**
 * A structured data gap: an enumerated kind plus the pair scope (the two
 * legs' instruments the gap is about; '' when scope-wide).
 */
export interface CrossMarketDataGap {
  readonly kind: CrossMarketDataGapKind;
  readonly leftInstrument: string;
  readonly rightInstrument: string;
}

/** Guard: `CrossMarketDataGap`. */
export function isCrossMarketDataGap(v: unknown): v is CrossMarketDataGap {
  if (!isRecord(v)) return false;
  return (
    typeof v.kind === 'string' &&
    (CROSS_MARKET_DATA_GAP_KINDS as readonly string[]).includes(v.kind) &&
    typeof v.leftInstrument === 'string' &&
    typeof v.rightInstrument === 'string'
  );
}

// ---------------------------------------------------------------------------
// The structured summary (enumerated fields only)
// ---------------------------------------------------------------------------

/** The dominant relation kind of a report — a kind, or 'no-relationship'. */
export type DominantRelationKind = RelationshipKind | 'no-relationship';

/** Guard: `DominantRelationKind`. */
export function isDominantRelationKind(v: unknown): v is DominantRelationKind {
  return (
    typeof v === 'string' &&
    ([...RELATIONSHIP_KINDS, 'no-relationship'] as readonly string[]).includes(v)
  );
}

/**
 * THE structured summary: enumerated fields only. Counts, the dominant
 * relation kind, the exact mean measure score (declared analysis output —
 * null when there are no relationships, never a fabricated zero), the L4
 * coverage accounting, and the structured data gaps. No free-text
 * conclusions — the publication discipline is structural.
 */
export interface CrossMarketSummary {
  readonly relationshipCount: number;
  readonly pairCount: number;
  readonly instrumentCount: number;
  readonly dominantRelationKind: DominantRelationKind;
  /** The exact mean of relationship measure scores (null when none). */
  readonly meanMeasureScore: string | null;
  readonly coverage: CoverageAccounting;
  readonly dataGaps: readonly CrossMarketDataGap[];
}

/** Guard: `CrossMarketSummary` (structure only). */
export function isCrossMarketSummary(v: unknown): v is CrossMarketSummary {
  if (!isRecord(v)) return false;
  return (
    isNonNegativeInteger(v.relationshipCount) &&
    isNonNegativeInteger(v.pairCount) &&
    isNonNegativeInteger(v.instrumentCount) &&
    isDominantRelationKind(v.dominantRelationKind) &&
    (v.meanMeasureScore === null || typeof v.meanMeasureScore === 'string') &&
    isCoverageAccounting(v.coverage) &&
    Array.isArray(v.dataGaps) &&
    (v.dataGaps as readonly unknown[]).every((gap) => isCrossMarketDataGap(gap))
  );
}

// ---------------------------------------------------------------------------
// CrossMarketResearchReport
// ---------------------------------------------------------------------------

/**
 * THE publication record: the complete relationships it was composed
 * from, the enumerated summary, the as-of instant, the declared
 * report-composition method citation, the body version, tenant/project.
 * The id is DERIVED (`cmrr-<digest>`), never random.
 */
export interface CrossMarketResearchReport {
  readonly reportId: CrossMarketResearchReportId;
  /** The L4 instant the whole publication was computed as of. */
  readonly asOf: TimestampMs;
  readonly bodyVersion: BodyVersionRef;
  readonly methodId: CrossMarketMethodId;
  readonly methodVersion: CrossMarketMethodVersionRef;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
  readonly relationships: readonly CrossMarketRelationship[];
  readonly summary: CrossMarketSummary;
}

/** Derives the report id: `cmrr-<stableDigest16>` over the canonical form. */
export function deriveCrossMarketReportId(report: Omit<CrossMarketResearchReport, 'reportId'>): CrossMarketResearchReportId {
  return `cmrr-${stableDigest(canonicalJson(report as unknown as JsonValue))}` as CrossMarketResearchReportId;
}

/** Guard: `CrossMarketResearchReport` (structure only — use `validateCrossMarketResearchReport` for the laws). */
export function isCrossMarketResearchReport(v: unknown): v is CrossMarketResearchReport {
  if (!isRecord(v)) return false;
  return (
    typeof v.reportId === 'string' &&
    v.reportId.startsWith('cmrr-') &&
    isTimestampMs(v.asOf) &&
    isBodyVersionRef(v.bodyVersion) &&
    isCrossMarketMethodId(v.methodId) &&
    isCrossMarketMethodVersionRef(v.methodVersion) &&
    isTenantId(v.tenantId) &&
    isProjectId(v.projectId) &&
    isNonEmptyString(v.seed) &&
    Array.isArray(v.relationships) &&
    (v.relationships as readonly unknown[]).every((r) => isCrossMarketRelationship(r)) &&
    isCrossMarketSummary(v.summary)
  );
}

// ---------------------------------------------------------------------------
// Summary derivation (deterministic — the declared composition method)
// ---------------------------------------------------------------------------

/**
 * The dominance precedence for relation kinds: highest count wins; ties
 * resolve by this fixed order (deterministic bytes). 'co-movement'
 * deliberately wins ties — agreement is the strongest cross-market
 * statement a pair can make.
 */
const DOMINANCE_PRECEDENCE: readonly RelationshipKind[] = [
  'co-movement',
  'lead-lag',
  'spread-divergence',
];

/** Computes the dominant relation kind of relationships (or 'no-relationship'). */
export function dominantRelationKindOf(relationships: readonly CrossMarketRelationship[]): DominantRelationKind {
  if (relationships.length === 0) return 'no-relationship';
  const counts = new Map<RelationshipKind, number>();
  for (const relationship of relationships) {
    counts.set(relationship.relationKind, (counts.get(relationship.relationKind) ?? 0) + 1);
  }
  let best: RelationshipKind = DOMINANCE_PRECEDENCE[0] as RelationshipKind;
  let bestCount = -1;
  for (const kind of DOMINANCE_PRECEDENCE) {
    const count = counts.get(kind) ?? 0;
    if (count > bestCount) {
      best = kind;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Computes the ENUMERATED summary from relationships, coverage and data
 * gaps — the declared report-composition method's pure function. Every
 * input is already validated by the caller.
 */
export function composeCrossMarketSummary(input: {
  readonly relationships: readonly CrossMarketRelationship[];
  readonly coverage: CoverageAccounting;
  readonly dataGaps: readonly CrossMarketDataGap[];
}): CrossMarketSummary {
  const instruments = new Set<string>();
  const pairKeys = new Set<string>();
  for (const relationship of input.relationships) {
    instruments.add(relationship.pair.left.instrument);
    instruments.add(relationship.pair.right.instrument);
    pairKeys.add(`${relationship.pair.left.instrument}|${relationship.pair.right.instrument}`);
  }
  const mean =
    input.relationships.length === 0
      ? null
      : decimalMean(
          input.relationships.map((relationship) => relationship.measure.score),
          4,
          'half-even',
        );
  return deepFreeze({
    relationshipCount: input.relationships.length,
    pairCount: pairKeys.size,
    instrumentCount: instruments.size,
    dominantRelationKind: dominantRelationKindOf(input.relationships),
    meanMeasureScore: mean,
    coverage: input.coverage,
    dataGaps: input.dataGaps,
  });
}

// ---------------------------------------------------------------------------
// Validation (collect-all — every law, every violation)
// ---------------------------------------------------------------------------

/**
 * COLLECT-ALL validation of a cross-market research report: every
 * embedded relationship is re-validated against its own laws; the summary
 * is re-derived and compared (report_composition_mismatch); the as-of
 * uniformity of the whole publication is enforced (as_of_mismatch);
 * method honesty ('report-composition'); tenant/project (L12); derived-id
 * law.
 */
export function validateCrossMarketResearchReport(v: unknown, registry: CrossMarketMethodRegistry): readonly CrossMarketError[] {
  const errors: CrossMarketError[] = [];
  if (!isRecord(v)) return [invalidType('report', 'a research report object')];
  if (typeof v.reportId !== 'string' || !v.reportId.startsWith('cmrr-')) {
    errors.push(invalidField('reportId', "must be a derived report id ('cmrr-<digest>')"));
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
    ...resolveCrossMarketMethodCitation(registry, v.methodId, v.methodVersion, 'report-composition').map((e) => ({
      ...e,
      path: e.path.startsWith('method') ? e.path : `method.${e.path}`,
    })),
  );

  const relationships = Array.isArray(v.relationships) ? (v.relationships as readonly unknown[]) : null;
  if (relationships === null) {
    errors.push(invalidType('relationships', 'an array of cross-market relationships'));
  } else {
    relationships.forEach((relationship: unknown, index: number) => {
      for (const error of validateCrossMarketRelationship(relationship, registry)) {
        errors.push({ ...error, path: `relationships[${index}].${error.path}` });
      }
      // as-of uniformity: a publication is one point-in-time cut.
      if (isRecord(relationship) && asOfOk && isTimestampMs(relationship.asOf) && (relationship.asOf as number) !== (v.asOf as number)) {
        errors.push({
          code: 'as_of_mismatch',
          path: `relationships[${index}].asOf`,
          message: 'every embedded record must carry the publication as-of instant',
        });
      }
      if (isRecord(relationship) && isBodyVersionRef(relationship.bodyVersion) && isBodyVersionRef(v.bodyVersion) && relationship.bodyVersion !== v.bodyVersion) {
        errors.push({
          code: 'lineage_missing',
          path: `relationships[${index}].bodyVersion`,
          message: 'embedded records must cite the publishing body version',
        });
      }
    });
  }

  // summary re-derivation (the composition law)
  if (!isCrossMarketSummary(v.summary)) {
    errors.push(invalidField('summary', 'must be an enumerated cross-market research summary'));
  } else if (relationships !== null) {
    const embeddedRelationships = relationships.filter((r): r is CrossMarketRelationship => isCrossMarketRelationship(r));
    const expected = composeCrossMarketSummary({
      relationships: embeddedRelationships,
      coverage: v.summary.coverage,
      dataGaps: v.summary.dataGaps,
    });
    const summary = v.summary as CrossMarketSummary;
    if (
      summary.relationshipCount !== expected.relationshipCount ||
      summary.pairCount !== expected.pairCount ||
      summary.instrumentCount !== expected.instrumentCount ||
      summary.dominantRelationKind !== expected.dominantRelationKind ||
      summary.meanMeasureScore !== expected.meanMeasureScore
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
  if (typeof v.reportId === 'string' && v.reportId.startsWith('cmrr-') && errors.length === 0) {
    const { reportId: _ignored, ...material } = v as unknown as CrossMarketResearchReport;
    void _ignored;
    if (deriveCrossMarketReportId(material as Omit<CrossMarketResearchReport, 'reportId'>) !== v.reportId) {
      errors.push({
        code: 'digest_mismatch',
        path: 'reportId',
        message: 'the report id does not match its canonical content — the record was tampered with',
      });
    }
  }
  return errors;
}

/** Validation wrapper: `CrossMarketResearchReport`. */
export function validateCrossMarketResearchReportRecord(v: unknown, registry: CrossMarketMethodRegistry): CrossMarketValidation<CrossMarketResearchReport> {
  const errors = validateCrossMarketResearchReport(v, registry);
  return validationOf(errors.length === 0 ? (v as CrossMarketResearchReport) : null, errors);
}

/**
 * Creates a validated, deeply-frozen cross-market research report. The
 * `reportId` is DERIVED from the canonical form of the draft; the draft
 * (and every embedded record) must satisfy every research law. Refusal is
 * typed data.
 */
export function createCrossMarketResearchReport(
  draft: Omit<CrossMarketResearchReport, 'reportId'>,
  registry: CrossMarketMethodRegistry,
): CrossMarketResult<CrossMarketResearchReport> {
  const errors = validateCrossMarketResearchReport({ ...draft, reportId: 'cmrr-pending' }, registry).filter(
    (error) => error.path !== 'reportId',
  );
  if (errors.length > 0) return { ok: false, errors };
  const reportId = deriveCrossMarketReportId(draft);
  return { ok: true, value: deepFreeze({ ...draft, reportId }) };
}

/** Canonical serialization of a report (byte-deterministic, L9). */
export function serializeCrossMarketResearchReport(report: CrossMarketResearchReport): string {
  return canonicalJson(report as unknown as JsonValue);
}
