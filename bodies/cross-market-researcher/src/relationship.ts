// @tradrl/body-cross-market-researcher — the evidence-backed cross-market
// relationship.
//
// Owning Work Order: T023, section 5: "CrossMarketRelationship — the
// twin: venue/asset-class pair, relation kind (CLOSED taxonomy),
// direction/measure (declared method + window), confidence, evidence
// refs + lineage, as-of, versions, tenant/project."
//
// LAWS HELD (violations = typed errors, tested negatively):
// - L4 (point-in-time): every cited observation's `available_time` must
//   be <= the relationship's `asOf` — a relationship citing future data
//   is the `future_evidence` typed error.
// - L9 (lineage): evidence is NEVER empty (`evidence_missing`), citation
//   ids are unique (`duplicate_observation_ref`), EVERY citation carries
//   the observation's provenance block (the T008 mirror), and BOTH legs
//   of the pair are represented in the evidence (`leg_coverage_missing`
//   — a one-legged relationship is not a cross-market record).
// - The pair law: the left and right legs are DISTINCT market series
//   (`pair_not_distinct` — a relationship of a series with itself is not
//   a relationship).
// - Method honesty: the relation kind is a member of the CLOSED
//   taxonomy, the measure cites a declared RELATIONSHIP-ANALYSIS method
//   (id + version) whose parameters declare THIS relation kind
//   (`relationship_kind_mismatch`), the direction belongs to the
//   relation kind's subset (`relationship_direction_mismatch`), AND the
//   direction equals the method's declared decision function over the
//   carried score — a direction that disagrees with its own measure is
//   the `direction_measure_mismatch` typed error. Confidence cites the
//   declared confidence method of the right kind.
// - L12: TenantId + ProjectId are required.
// - Determinism: `relationshipId` is DERIVED (`cmr-<stableDigest>` over
//   the canonical form of everything else) — never random; validation
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
  type CrossMarketMethodId,
  type CrossMarketMethodVersionRef,
  type BodyVersionRef,
  type ProjectId,
  type CrossMarketRelationshipId,
  type TenantId,
  isBodyVersionRef,
  isCrossMarketMethodId,
  isCrossMarketMethodVersionRef,
  isProjectId,
  isTenantId,
} from './ids';
import {
  type CrossMarketMethodRegistry,
  type RelationshipKind,
  type CoMovementParameters,
  type LeadLagParameters,
  type SpreadDivergenceParameters,
  RELATIONSHIP_KINDS,
  RELATIONSHIP_DIRECTIONS,
  DIRECTIONS_BY_KIND,
  findCrossMarketMethod,
  resolveRelationshipCitation,
} from './methods';
import {
  type ObservationProvenance,
  isObservationProvenance,
  validateObservationProvenance,
} from './observations';
import { compareDecimal, isSignedDecimal } from './decimals';
import { type CrossMarketError, type CrossMarketResult, type CrossMarketValidation, invalidField, invalidType, validationOf } from './errors';

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

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
// The declared decision functions (the relationship methods' shared law)
// ---------------------------------------------------------------------------

/**
 * THE DECLARED CO-MOVEMENT DIRECTION: the direction an agreement score
 * derives under the method's thresholds. Pure and total.
 */
export function classifyCoMovementDirection(
  score: string,
  thresholds: { readonly positive: string; readonly negative: string },
): 'positive' | 'negative' | 'neutral' {
  if (compareDecimal(score, thresholds.positive) >= 0) return 'positive';
  if (compareDecimal(score, thresholds.negative) <= 0) return 'negative';
  return 'neutral';
}

/**
 * THE DECLARED LEAD-LAG DIRECTION: the direction an asymmetry score
 * derives under the method's thresholds. Pure and total.
 */
export function classifyLeadLagDirection(
  score: string,
  thresholds: { readonly leftLeads: string; readonly rightLeads: string },
): 'left-leads' | 'right-leads' | 'no-lead' {
  if (compareDecimal(score, thresholds.leftLeads) >= 0) return 'left-leads';
  if (compareDecimal(score, thresholds.rightLeads) <= 0) return 'right-leads';
  return 'no-lead';
}

/**
 * THE DECLARED SPREAD-DIVERGENCE DIRECTION: the direction a normalized
 * spread change derives under the method's thresholds. Pure and total.
 */
export function classifySpreadDirection(
  score: string,
  thresholds: { readonly widening: string; readonly narrowing: string },
): 'widening' | 'narrowing' | 'stable' {
  if (compareDecimal(score, thresholds.widening) >= 0) return 'widening';
  if (compareDecimal(score, thresholds.narrowing) <= 0) return 'narrowing';
  return 'stable';
}

// ---------------------------------------------------------------------------
// The market leg (one side of a cross-market pair)
// ---------------------------------------------------------------------------

/**
 * One leg of a relationship pair: the canonical market series the leg
 * observes — venue + instrument + asset class + the series identity
 * (the trade/quote price basis, or the reported fundamental field).
 */
export interface MarketLeg {
  readonly venue: string;
  readonly instrument: string;
  readonly assetClass: string;
  /** 'trade' | 'quote' for market-data legs; the reported field otherwise. */
  readonly series: string;
}

/** The canonical leg key: `venue|instrument|assetClass|series`. */
export function marketLegKey(leg: MarketLeg): string {
  return `${leg.venue}|${leg.instrument}|${leg.assetClass}|${leg.series}`;
}

/** Guard: `MarketLeg`. */
export function isMarketLeg(v: unknown): v is MarketLeg {
  if (!isRecord(v)) return false;
  return (
    isNonEmptyString(v.venue) &&
    isNonEmptyString(v.instrument) &&
    isNonEmptyString(v.assetClass) &&
    isNonEmptyString(v.series)
  );
}

/** The pair of legs a relationship spans. */
export interface MarketPair {
  readonly left: MarketLeg;
  readonly right: MarketLeg;
}

/** Guard: `MarketPair` (structure only — the distinctness law is validated). */
export function isMarketPair(v: unknown): v is MarketPair {
  if (!isRecord(v)) return false;
  return isMarketLeg(v.left) && isMarketLeg(v.right);
}

// ---------------------------------------------------------------------------
// Evidence lineage
// ---------------------------------------------------------------------------

/**
 * One observation citation: WHICH leg the observation evidences ('left' |
 * 'right' — the leg-coverage law is structural), the observation id, the
 * availability instant it was legitimately knowable at (restated so the
 * record itself proves point-in-time honesty — L4), and the observation's
 * provenance block (the T008 mirror — full lineage travels with the
 * output — L9).
 */
export interface ObservationCitation {
  readonly leg: 'left' | 'right';
  readonly observationId: string;
  readonly availableTime: TimestampMs;
  readonly provenance: ObservationProvenance;
}

/** Guard: `ObservationCitation`. */
export function isObservationCitation(v: unknown): v is ObservationCitation {
  if (!isRecord(v)) return false;
  return (
    (v.leg === 'left' || v.leg === 'right') &&
    isNonEmptyString(v.observationId) &&
    isTimestampMs(v.availableTime) &&
    isObservationProvenance(v.provenance)
  );
}

/** COLLECT-ALL validation of one citation (structure + provenance laws). */
export function validateObservationCitation(v: unknown, path: string): readonly CrossMarketError[] {
  const errors: CrossMarketError[] = [];
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
// The knowledge-time window
// ---------------------------------------------------------------------------

/**
 * The knowledge-time window the relationship was computed over (bounds
 * are `available_time` instants of the cited observations — the declared
 * `windowBasis: 'available-time'`, never a wall clock).
 */
export interface RelationshipWindow {
  readonly from: TimestampMs;
  readonly to: TimestampMs;
}

/** Guard: `RelationshipWindow`. */
export function isRelationshipWindow(v: unknown): v is RelationshipWindow {
  if (!isRecord(v)) return false;
  return isTimestampMs(v.from) && isTimestampMs(v.to) && (v.from as number) <= (v.to as number);
}

// ---------------------------------------------------------------------------
// The declared-method records
// ---------------------------------------------------------------------------

/**
 * The relationship measure: direction + exact score, each citing the
 * declared relationship-analysis method that produced them. The score is
 * the method's declared measure (co-movement: agreement ratio; lead-lag:
 * asymmetry ratio; spread: the normalized spread's change).
 */
export interface RelationshipMeasure {
  readonly methodId: CrossMarketMethodId;
  readonly methodVersion: CrossMarketMethodVersionRef;
  readonly direction: string;
  /** The exact score under the declared measure (a signed decimal). */
  readonly score: string;
}

/**
 * The confidence assessment: a CATEGORY plus the two declared inputs it
 * was derived from (the total evidence count and the leg imbalance —
 * |right count − left count|). Never a naked guess.
 */
export interface CrossMarketConfidence {
  readonly methodId: CrossMarketMethodId;
  readonly methodVersion: CrossMarketMethodVersionRef;
  readonly level: ConfidenceLevel;
  /** How many observations (both legs) the relationship was computed from. */
  readonly evidenceCount: number;
  /** The absolute difference of the two legs' observation counts. */
  readonly legImbalance: number;
}

// ---------------------------------------------------------------------------
// CrossMarketRelationship
// ---------------------------------------------------------------------------

/**
 * THE evidence-backed cross-market relationship. Every field is lineage:
 * the pair of market legs, the CLOSED relation kind, a declared-method
 * measure over a knowledge-time window, a declared-method confidence,
 * non-empty point-in-time evidence covering BOTH legs with provenance,
 * the as-of instant, the producing body version, tenant and project. The
 * id is derived (`cmr-<digest>`), never random.
 */
export interface CrossMarketRelationship {
  readonly relationshipId: CrossMarketRelationshipId;
  readonly pair: MarketPair;
  readonly relationKind: RelationshipKind;
  readonly measure: RelationshipMeasure;
  readonly window: RelationshipWindow;
  readonly confidence: CrossMarketConfidence;
  readonly evidence: readonly ObservationCitation[];
  /** The L4 instant this relationship was computed as of. */
  readonly asOf: TimestampMs;
  readonly bodyVersion: BodyVersionRef;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  /** The seed the run carried (lineage material — L9). */
  readonly seed: string;
}

/** Derives the relationship id: `cmr-<stableDigest16>` over the canonical form. */
export function deriveRelationshipId(relationship: Omit<CrossMarketRelationship, 'relationshipId'>): CrossMarketRelationshipId {
  return `cmr-${stableDigest(canonicalJson(relationship as unknown as JsonValue))}` as CrossMarketRelationshipId;
}

// -- measure/confidence guards ------------------------------------------------

function citationOk(v: Record<string, unknown>): boolean {
  return isCrossMarketMethodId(v.methodId) && isCrossMarketMethodVersionRef(v.methodVersion);
}

/** Guard: `RelationshipMeasure` (structure only). */
export function isRelationshipMeasure(v: unknown): v is RelationshipMeasure {
  if (!isRecord(v)) return false;
  return (
    citationOk(v) &&
    typeof v.direction === 'string' &&
    (RELATIONSHIP_DIRECTIONS as readonly string[]).includes(v.direction) &&
    isSignedDecimal(v.score)
  );
}

/** Guard: `CrossMarketConfidence`. */
export function isCrossMarketConfidence(v: unknown): v is CrossMarketConfidence {
  if (!isRecord(v)) return false;
  return (
    citationOk(v) &&
    isConfidenceLevel(v.level) &&
    isNonNegativeInteger(v.evidenceCount) &&
    isNonNegativeInteger(v.legImbalance)
  );
}

/** Guard: `CrossMarketRelationship` (structure only — use `validateCrossMarketRelationship` for the laws). */
export function isCrossMarketRelationship(v: unknown): v is CrossMarketRelationship {
  if (!isRecord(v)) return false;
  return (
    typeof v.relationshipId === 'string' &&
    v.relationshipId.startsWith('cmr-') &&
    isMarketPair(v.pair) &&
    typeof v.relationKind === 'string' &&
    (RELATIONSHIP_KINDS as readonly string[]).includes(v.relationKind) &&
    isRelationshipMeasure(v.measure) &&
    isRelationshipWindow(v.window) &&
    isCrossMarketConfidence(v.confidence) &&
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
 * COLLECT-ALL validation of a cross-market relationship against every
 * research law: structure, the CLOSED relation taxonomy, the pair
 * distinctness law, evidence completeness + BOTH-LEGS coverage (L9),
 * point-in-time citations (L4), method honesty (the measure method must
 * declare THIS relation kind; the direction must belong to the kind's
 * subset AND equal the declared decision function over the carried
 * score; confidence must cite the confidence-estimation kind),
 * tenant/project presence (L12), and the derived-id law.
 */
export function validateCrossMarketRelationship(v: unknown, registry: CrossMarketMethodRegistry): readonly CrossMarketError[] {
  const errors: CrossMarketError[] = [];
  if (!isRecord(v)) return [invalidType('relationship', 'a cross-market relationship object')];
  if (typeof v.relationshipId !== 'string' || !v.relationshipId.startsWith('cmr-')) {
    errors.push(invalidField('relationshipId', "must be a derived relationship id ('cmr-<digest>')"));
  }
  if (!isMarketPair(v.pair)) {
    errors.push(invalidField('pair', 'must be { left, right } market legs { venue, instrument, assetClass, series }'));
  } else if (marketLegKey(v.pair.left) === marketLegKey(v.pair.right)) {
    // THE PAIR LAW: a relationship of a series with itself is not a
    // cross-market record.
    errors.push({
      code: 'pair_not_distinct',
      path: 'pair',
      message: 'the left and right legs must be distinct market series — a series related to itself is not a cross-market relationship',
    });
  }
  if (typeof v.relationKind !== 'string' || !(RELATIONSHIP_KINDS as readonly string[]).includes(v.relationKind)) {
    errors.push({
      code: 'unknown_relation_kind',
      path: 'relationKind',
      message: `must be one of the declared relation kinds (${RELATIONSHIP_KINDS.join('|')}) — the taxonomy is CLOSED`,
    });
  }
  const asOfOk = isTimestampMs(v.asOf);
  if (!asOfOk) errors.push(invalidField('asOf', 'must be a valid epoch-millisecond instant'));
  if (!isRelationshipWindow(v.window)) {
    errors.push(invalidField('window', 'must be { from, to } instants with from <= to'));
  }
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

  // the measure (method honesty: relation kind + declared decision function)
  if (!isRecord(v.measure)) {
    errors.push(invalidType('measure', 'a relationship measure object'));
  } else {
    const relationKind = v.relationKind;
    if (typeof relationKind === 'string' && (RELATIONSHIP_KINDS as readonly string[]).includes(relationKind)) {
      errors.push(
        ...resolveRelationshipCitation(registry, v.measure.methodId, v.measure.methodVersion, relationKind).map(
          (e) => ({ ...e, path: `measure.${e.path}` }),
        ),
      );
      const method = isCrossMarketMethodId(v.measure.methodId)
        ? findCrossMarketMethod(registry, v.measure.methodId)
        : null;
      if (
        method !== null &&
        method.parameters.kind === 'relationship-analysis' &&
        method.parameters.relationKind === relationKind
      ) {
        const parameters = method.parameters;
        // THE KIND-SUBSET LAW: the direction belongs to the relation kind.
        if (typeof v.measure.direction === 'string' && (RELATIONSHIP_DIRECTIONS as readonly string[]).includes(v.measure.direction)) {
          const direction = v.measure.direction;
          if (!(DIRECTIONS_BY_KIND[relationKind as RelationshipKind] as readonly string[]).includes(direction)) {
            errors.push({
              code: 'relationship_direction_mismatch',
              path: 'measure.direction',
              message: `direction '${direction}' does not belong to relation kind '${relationKind}' (allowed: ${DIRECTIONS_BY_KIND[relationKind as RelationshipKind].join('|')})`,
            });
          } else if (isSignedDecimal(v.measure.score)) {
            // THE DECLARED DECISION FUNCTION LAW: the direction must be
            // derivable from the score under the method's own thresholds.
            let expected: string | null = null;
            if (parameters.kind === 'relationship-analysis' && parameters.relationKind === 'co-movement') {
              expected = classifyCoMovementDirection(v.measure.score, parameters.directionThresholds);
            } else if (parameters.kind === 'relationship-analysis' && parameters.relationKind === 'lead-lag') {
              expected = classifyLeadLagDirection(v.measure.score, parameters.directionThresholds);
            } else if (parameters.kind === 'relationship-analysis' && parameters.relationKind === 'spread-divergence') {
              expected = classifySpreadDirection(v.measure.score, parameters.directionThresholds);
            }
            if (expected !== null && expected !== direction) {
              errors.push({
                code: 'direction_measure_mismatch',
                path: 'measure.direction',
                message: `the direction must equal the declared decision function over the score (expected '${expected}')`,
              });
            }
          }
        }
      }
    }
    if (typeof v.measure.direction !== 'string' || !(RELATIONSHIP_DIRECTIONS as readonly string[]).includes(v.measure.direction)) {
      errors.push(invalidField('measure.direction', `must be one of ${RELATIONSHIP_DIRECTIONS.join('|')}`));
    }
    if (!isSignedDecimal(v.measure.score)) {
      errors.push(invalidField('measure.score', 'must be a signed decimal string'));
    }
  }

  // the confidence
  if (!isRecord(v.confidence)) {
    errors.push(invalidType('confidence', 'a confidence assessment object'));
  } else {
    const method = isCrossMarketMethodId(v.confidence.methodId)
      ? findCrossMarketMethod(registry, v.confidence.methodId)
      : null;
    if (method !== null && method.kind !== 'confidence-estimation') {
      errors.push({
        code: 'method_kind_mismatch',
        path: 'confidence.methodId',
        message: `method ${method.methodId} is declared as '${method.kind}', used as 'confidence-estimation'`,
      });
    }
    errors.push(
      ...resolveConfidenceCitation(registry, v.confidence.methodId, v.confidence.methodVersion).map(
        (e) => ({ ...e, path: `confidence.${e.path}` }),
      ),
    );
    if (!isConfidenceLevel(v.confidence.level)) {
      errors.push(invalidField('confidence.level', `must be one of ${CONFIDENCE_LEVELS.join('|')} (a category, never a score)`));
    }
    if (!isNonNegativeInteger(v.confidence.evidenceCount)) {
      errors.push(invalidField('confidence.evidenceCount', 'must be a non-negative integer'));
    }
    if (!isNonNegativeInteger(v.confidence.legImbalance)) {
      errors.push(invalidField('confidence.legImbalance', 'must be a non-negative integer'));
    }
  }

  // evidence lineage (never empty; both legs covered; unique; point-in-time)
  if (!Array.isArray(v.evidence)) {
    errors.push(invalidType('evidence', 'an array of observation citations'));
  } else {
    if (v.evidence.length === 0) {
      // THE evidence law: an evidence-less research output fails validation.
      errors.push({
        code: 'evidence_missing',
        path: 'evidence',
        message: 'a cross-market relationship without observation citations is an unsupported claim',
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
    if (ids.length > 0 && isMarketPair(v.pair)) {
      // THE LEG-COVERAGE LAW: both legs must be represented in evidence —
      // a one-legged relationship is not a cross-market record.
      let leftSeen = false;
      let rightSeen = false;
      for (const citation of v.evidence as readonly unknown[]) {
        if (isRecord(citation)) {
          if (citation.leg === 'left') leftSeen = true;
          if (citation.leg === 'right') rightSeen = true;
        }
      }
      if (!leftSeen || !rightSeen) {
        errors.push({
          code: 'leg_coverage_missing',
          path: 'evidence',
          message: `a cross-market relationship needs observations from BOTH legs (left covered: ${leftSeen}, right covered: ${rightSeen})`,
        });
      }
    }
  }

  // derived-id law (tamper trip-wire)
  if (typeof v.relationshipId === 'string' && v.relationshipId.startsWith('cmr-') && errors.length === 0) {
    const { relationshipId: _ignored, ...material } = v as unknown as CrossMarketRelationship;
    void _ignored;
    if (deriveRelationshipId(material as Omit<CrossMarketRelationship, 'relationshipId'>) !== v.relationshipId) {
      errors.push({
        code: 'digest_mismatch',
        path: 'relationshipId',
        message: 'the relationship id does not match its canonical content — the record was tampered with',
      });
    }
  }
  return errors;
}

/** Local strict confidence-citation resolver (single typed error per drift). */
function resolveConfidenceCitation(
  registry: CrossMarketMethodRegistry,
  methodId: unknown,
  version: unknown,
): readonly CrossMarketError[] {
  if (!isCrossMarketMethodId(methodId) || !isCrossMarketMethodVersionRef(version)) {
    return [invalidField('methodId', 'must cite a declared method (id + strict X.Y.Z version)')];
  }
  const method = findCrossMarketMethod(registry, methodId);
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
  if (method.kind !== 'confidence-estimation') {
    return [{
      code: 'method_kind_mismatch',
      path: 'methodId',
      message: `method ${methodId} is declared as '${method.kind}', used as 'confidence-estimation'`,
    }];
  }
  return [];
}

/** Validation wrapper: `CrossMarketRelationship`. */
export function validateCrossMarketRelationshipRecord(v: unknown, registry: CrossMarketMethodRegistry): CrossMarketValidation<CrossMarketRelationship> {
  const errors = validateCrossMarketRelationship(v, registry);
  return validationOf(errors.length === 0 ? (v as CrossMarketRelationship) : null, errors);
}

/**
 * Creates a validated, deeply-frozen cross-market relationship. The
 * `relationshipId` is DERIVED from the canonical form of the draft (never
 * accepted); the draft must satisfy every research law. Refusal is typed
 * data.
 */
export function createCrossMarketRelationship(
  draft: Omit<CrossMarketRelationship, 'relationshipId'>,
  registry: CrossMarketMethodRegistry,
): CrossMarketResult<CrossMarketRelationship> {
  const errors = validateCrossMarketRelationship({ ...draft, relationshipId: 'cmr-pending' }, registry)
    // the placeholder id is expected to fail the prefix/digest checks only
    // when real content problems exist; strip id-specific errors here.
    .filter((error) => !(error.path === 'relationshipId'));
  if (errors.length > 0) return { ok: false, errors };
  const relationshipId = deriveRelationshipId(draft);
  return { ok: true, value: deepFreeze({ ...draft, relationshipId }) };
}

/** Canonical serialization of a relationship (byte-deterministic, L9). */
export function serializeCrossMarketRelationship(relationship: CrossMarketRelationship): string {
  return canonicalJson(relationship as unknown as JsonValue);
}

// ---------------------------------------------------------------------------
// Re-exported parameter types (pipeline convenience)
// ---------------------------------------------------------------------------

export type { CoMovementParameters, LeadLagParameters, SpreadDivergenceParameters };
