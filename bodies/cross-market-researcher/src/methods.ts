// @tradrl/body-cross-market-researcher — the DECLARED-METHOD discipline.
//
// Owning Work Order: T023, section 3 ("Method honesty"):
//   "cross-market analyses (cross-venue/cross-asset-class relationships,
//    lead-lag observations, spread/divergence records) ... are
//    DECLARED-METHOD outputs (versioned method records over equities/
//    alt-data observation windows); an undeclared magic output fails
//    (negative test). ... Cross-market correlation-style measures carry
//    declared-method + window records — never naked statistics."
//
// A CrossMarketMethodRecord is a versioned, structured, deeply-frozen
// declaration of HOW a cross-market relationship measure is computed:
// its kind, its declared input class, its enumerated parameters (window
// width, minimum move ratio, direction thresholds, scales, rounding
// modes — every knob is a declared field, never an implicit constant).
// The registry is the closed set a body may run; every output cites
// (methodId, methodVersion) and validation re-resolves the citation
// against the registry — an output citing an unknown method id, a stale
// version, a method of the wrong kind, or a method whose declared
// relation kind disagrees with the record's own kind is a TYPED ERROR,
// not a warning.
//
// Laws held here: zero runtime deps; no `any`; total hand-rolled guards;
// no ambient clock (`declaredAt` is an explicit literal instant);
// deepFreeze everything public; deterministic registry digest (L9 — the
// registry identity binds into every output's lineage).

import { deepFreeze, isNonEmptyString, isNonNegativeInteger, isPositiveInteger, isRecord, isMemberOf, isArrayOf, canonicalJson, stableDigestJson, isDigest } from './primitives';
import { type CrossMarketMethodId, type CrossMarketMethodVersionRef, isCrossMarketMethodId, isCrossMarketMethodVersionRef } from './ids';
import { type CrossMarketError, type CrossMarketResult, type CrossMarketValidation, invalidField, invalidType, validationOf } from './errors';
import { isSignedDecimal, isUnsignedDecimal } from './decimals';

// ---------------------------------------------------------------------------
// The closed taxonomies (relation kinds, relationship directions)
// ---------------------------------------------------------------------------

/**
 * The declared relation taxonomy (CLOSED union — the Work Order's
 * enumeration: cross-venue/cross-asset-class relationships, lead-lag
 * observations, spread/divergence records):
 *   - 'co-movement'        — the directional agreement of the two legs'
 *                            window-by-window moves (a correlation-style
 *                            measure: DECLARED-METHOD + window record);
 *   - 'lead-lag'           — which leg's moves are followed by the other
 *                            leg's same-sign moves (an asymmetry measure);
 *   - 'spread-divergence'  — the change of the normalized spread between
 *                            the two legs over the window (widening /
 *                            narrowing / stable).
 */
export const RELATIONSHIP_KINDS = [
  'co-movement',
  'lead-lag',
  'spread-divergence',
] as const;

/** A declared relation kind. */
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];

/** Guard: a declared relation kind. */
export const isRelationshipKind = (v: unknown): v is RelationshipKind =>
  isMemberOf(RELATIONSHIP_KINDS, v);

function isRelationshipKindDeclared(v: unknown): boolean {
  return typeof v === 'string' && (RELATIONSHIP_KINDS as readonly string[]).includes(v);
}

/**
 * The direction a relationship record can declare (CLOSED union — the
 * per-kind subsets): co-movement reports the agreement sign
 * (positive/negative/neutral); lead-lag reports the leading leg
 * (left-leads/right-leads/no-lead); spread-divergence reports the
 * normalized spread's change (widening/narrowing/stable). A direction
 * outside its relation kind's subset is the
 * `relationship_direction_mismatch` typed error.
 */
export const RELATIONSHIP_DIRECTIONS = [
  'positive',
  'negative',
  'neutral',
  'left-leads',
  'right-leads',
  'no-lead',
  'widening',
  'narrowing',
  'stable',
] as const;

/** A declared relationship direction. */
export type RelationshipDirection = (typeof RELATIONSHIP_DIRECTIONS)[number];

/** Guard: a declared relationship direction. */
export const isRelationshipDirection = (v: unknown): v is RelationshipDirection =>
  isMemberOf(RELATIONSHIP_DIRECTIONS, v);

/** The direction subset a relation kind admits (the kind law). */
export const DIRECTIONS_BY_KIND: Readonly<Record<RelationshipKind, readonly RelationshipDirection[]>> = {
  'co-movement': ['positive', 'negative', 'neutral'],
  'lead-lag': ['left-leads', 'right-leads', 'no-lead'],
  'spread-divergence': ['widening', 'narrowing', 'stable'],
};

/** `true` when the direction belongs to the relation kind's subset. */
export function directionMatchesKind(kind: RelationshipKind, direction: RelationshipDirection): boolean {
  return (DIRECTIONS_BY_KIND[kind] as readonly string[]).includes(direction);
}

// ---------------------------------------------------------------------------
// The closed method-kind vocabulary
// ---------------------------------------------------------------------------

/** What a declared method is FOR. Closed vocabulary. */
export const METHOD_KINDS = [
  'relationship-analysis',
  'confidence-estimation',
  'report-composition',
] as const;

/** A declared method kind. */
export type CrossMarketMethodKind = (typeof METHOD_KINDS)[number];

/** Guard: a method kind. */
export const isCrossMarketMethodKind = (v: unknown): v is CrossMarketMethodKind =>
  isMemberOf(METHOD_KINDS, v);

/** The declared input classes (closed vocabulary). */
export const METHOD_INPUTS = [
  'market-observations',
  'research-records',
] as const;

/** A declared method input class. */
export type CrossMarketMethodInput = (typeof METHOD_INPUTS)[number];

/** Guard: a declared input class. */
export const isCrossMarketMethodInput = (v: unknown): v is CrossMarketMethodInput =>
  isMemberOf(METHOD_INPUTS, v);

// ---------------------------------------------------------------------------
// Structured parameters per kind (enumerated — no implicit constants)
// ---------------------------------------------------------------------------

/**
 * Co-movement parameters: the directional agreement of the two legs'
 * epoch-aligned window moves. The score is the exact ratio
 * (agree − disagree) / compared at the declared scale — a DECLARED-METHOD
 * + window record, never a naked correlation statistic.
 */
export interface CoMovementParameters {
  readonly kind: 'relationship-analysis';
  readonly input: 'market-observations';
  readonly relationKind: 'co-movement';
  /** The declared alignment window width, in epoch milliseconds. */
  readonly windowMs: number;
  /** The declared price basis (closed). */
  readonly priceBasis: 'trade-price-or-quote-mid-or-reported-value';
  /** A window counts as a move only when |move|/previous >= this ratio. */
  readonly minMove: string;
  /** Minimum compared windows to emit a relationship (else a data gap). */
  readonly minComparedWindows: number;
  /** Minimum observations per leg to analyze the pair at all. */
  readonly minObservationsPerLeg: number;
  readonly outputScale: number;
  readonly rounding: 'half-even' | 'truncate';
  /** Direction thresholds on the signed agreement score in [-1, 1]. */
  readonly directionThresholds: { readonly positive: string; readonly negative: string };
}

/**
 * Lead-lag parameters: which leg's qualifying moves are followed (within
 * one alignment window after, and not one window before) by the other
 * leg's same-sign qualifying moves. The score is the exact asymmetry
 * ratio (leftLeads − rightLeads) / decisive in [-1, 1].
 */
export interface LeadLagParameters {
  readonly kind: 'relationship-analysis';
  readonly input: 'market-observations';
  readonly relationKind: 'lead-lag';
  readonly windowMs: number;
  readonly priceBasis: 'trade-price-or-quote-mid-or-reported-value';
  readonly minMove: string;
  /** Minimum decisive left-leg windows to emit a relationship (else a gap). */
  readonly minDecisiveWindows: number;
  readonly minObservationsPerLeg: number;
  readonly outputScale: number;
  readonly rounding: 'half-even' | 'truncate';
  /** Direction thresholds on the signed asymmetry score in [-1, 1]. */
  readonly directionThresholds: { readonly leftLeads: string; readonly rightLeads: string };
}

/**
 * Spread-divergence parameters: the change of the normalized spread
 * between the legs across the window. Each leg is normalized to its own
 * first observed window price; the score is the exact difference of the
 * legs' net-change ratios (left return − right return) at the declared
 * scale — positive means widening, negative narrowing.
 */
export interface SpreadDivergenceParameters {
  readonly kind: 'relationship-analysis';
  readonly input: 'market-observations';
  readonly relationKind: 'spread-divergence';
  readonly windowMs: number;
  readonly priceBasis: 'trade-price-or-quote-mid-or-reported-value';
  readonly minObservationsPerLeg: number;
  readonly outputScale: number;
  readonly rounding: 'half-even' | 'truncate';
  /** Direction thresholds on the signed normalized-spread change. */
  readonly directionThresholds: { readonly widening: string; readonly narrowing: string };
}

/**
 * Confidence-estimation parameters: how confidence levels are derived.
 * The declared basis is the evidence count plus the leg balance — the
 * absolute difference of the two legs' observation counts (both legs
 * must be well covered for a high-confidence relationship).
 */
export interface CrossMarketConfidenceParameters {
  readonly kind: 'confidence-estimation';
  readonly input: 'research-records';
  /** The declared basis (closed: evidence count + leg balance). */
  readonly basis: 'evidence-count-and-leg-balance';
  /** The 'high' band: minimum total evidence AND maximum leg imbalance. */
  readonly high: { readonly minEvidence: number; readonly maxLegImbalance: number };
  /** The 'moderate' band: minimum total evidence AND maximum leg imbalance. */
  readonly moderate: { readonly minEvidence: number; readonly maxLegImbalance: number };
}

/** Report-composition parameters: how outputs become one publication. */
export interface CrossMarketReportCompositionParameters {
  readonly kind: 'report-composition';
  readonly input: 'research-records';
  /** Enumerated summary fields only — free-text conclusions are unlawful. */
  readonly summary: 'enumerated-fields-only';
  /** The canonical output ordering (deterministic bytes). */
  readonly canonicalOrder: 'observation-order';
}

/** The union of declared parameter shapes. */
export type CrossMarketMethodParameters =
  | CoMovementParameters
  | LeadLagParameters
  | SpreadDivergenceParameters
  | CrossMarketConfidenceParameters
  | CrossMarketReportCompositionParameters;

// ---------------------------------------------------------------------------
// MethodRecord + registry
// ---------------------------------------------------------------------------

/**
 * A DECLARED METHOD: the versioned, structured record that every
 * cross-market research output must cite. A measure that is not one of
 * these is a naked statistic, and a naked statistic fails validation (the
 * method-honesty law).
 */
export interface CrossMarketMethodRecord {
  /** Method identity (e.g. `method/crossmarket/co-movement`). */
  readonly methodId: CrossMarketMethodId;
  /** What the method is for. */
  readonly kind: CrossMarketMethodKind;
  /** The method's own version (strict X.Y.Z). */
  readonly version: CrossMarketMethodVersionRef;
  /** The declared, enumerated parameters. */
  readonly parameters: CrossMarketMethodParameters;
  /** Identity of the declaring authority (person, service or pipeline). */
  readonly declaredBy: string;
  /** When the method was declared (explicit literal instant — no clock). */
  readonly declaredAt: number;
}

/** The frozen method registry: the closed set a body may run. */
export interface CrossMarketMethodRegistry {
  /** The declared methods, canonically ordered by canonical JSON. */
  readonly methods: readonly CrossMarketMethodRecord[];
  /** The registry identity: a stable digest over the canonical form (L9). */
  readonly digest: string;
}

// -- parameter guards -------------------------------------------------------

function windowScaleRoundingOk(path: string, v: Record<string, unknown>, problems: string[]): void {
  if (!isPositiveInteger(v.windowMs)) problems.push(`${path}.windowMs: must be a positive integer`);
  if (!isPositiveInteger(v.outputScale) || (v.outputScale as number) > 8) {
    problems.push(`${path}.outputScale: must be an integer in [1, 8]`);
  }
  if (v.rounding !== 'half-even' && v.rounding !== 'truncate') {
    problems.push(`${path}.rounding: must be 'half-even' or 'truncate'`);
  }
  if (!isPositiveInteger(v.minObservationsPerLeg) || (v.minObservationsPerLeg as number) < 2) {
    problems.push(`${path}.minObservationsPerLeg: must be an integer >= 2`);
  }
  if (v.priceBasis !== 'trade-price-or-quote-mid-or-reported-value') {
    problems.push(`${path}.priceBasis: must be 'trade-price-or-quote-mid-or-reported-value'`);
  }
}

function signedThresholdPairOk(path: string, v: unknown, first: string, second: string, problems: string[]): void {
  if (
    !isRecord(v) ||
    !isSignedDecimal(v[first]) ||
    !isSignedDecimal(v[second])
  ) {
    problems.push(`${path}: must be { ${first}, ${second} } signed decimals`);
  }
}

function parametersProblems(path: string, v: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(v)) return [`${path}: must be an object`];
  const kind = v.kind;
  if (!isCrossMarketMethodKind(kind)) return [`${path}.kind: must be one of ${METHOD_KINDS.join('|')}`];
  const input = v.input;
  if (!isCrossMarketMethodInput(input)) return [`${path}.input: must be one of ${METHOD_INPUTS.join('|')}`];
  if (kind === 'relationship-analysis') {
    const relationKind = v.relationKind;
    if (!isRelationshipKindDeclared(relationKind)) {
      problems.push(`${path}.relationKind: must be one of ${RELATIONSHIP_KINDS.join('|')}`);
      return problems;
    }
    if (input !== 'market-observations') {
      problems.push(`${path}.input: relationship analysis consumes market-observations`);
    }
    windowScaleRoundingOk(path, v, problems);
    if (relationKind === 'co-movement') {
      if (!isUnsignedDecimal(v.minMove) || isUnsignedDecimal(v.minMove) === false) {
        problems.push(`${path}.minMove: must be an unsigned decimal ratio`);
      } else if ((v.minMove as string) === '0') {
        problems.push(`${path}.minMove: must be strictly positive`);
      }
      if (!isPositiveInteger(v.minComparedWindows)) {
        problems.push(`${path}.minComparedWindows: must be a positive integer`);
      }
      signedThresholdPairOk(`${path}.directionThresholds`, v.directionThresholds, 'positive', 'negative', problems);
    } else if (relationKind === 'lead-lag') {
      if (!isUnsignedDecimal(v.minMove)) {
        problems.push(`${path}.minMove: must be an unsigned decimal ratio`);
      } else if ((v.minMove as string) === '0') {
        problems.push(`${path}.minMove: must be strictly positive`);
      }
      if (!isPositiveInteger(v.minDecisiveWindows)) {
        problems.push(`${path}.minDecisiveWindows: must be a positive integer`);
      }
      signedThresholdPairOk(`${path}.directionThresholds`, v.directionThresholds, 'leftLeads', 'rightLeads', problems);
    } else {
      signedThresholdPairOk(`${path}.directionThresholds`, v.directionThresholds, 'widening', 'narrowing', problems);
    }
  } else if (kind === 'confidence-estimation') {
    if (input !== 'research-records') {
      problems.push(`${path}.input: confidence estimation runs over research-records`);
    }
    if (v.basis !== 'evidence-count-and-leg-balance') {
      problems.push(`${path}.basis: must be 'evidence-count-and-leg-balance'`);
    }
    for (const band of ['high', 'moderate'] as const) {
      const record = v[band];
      if (
        !isRecord(record) ||
        !isPositiveInteger(record.minEvidence) ||
        !isNonNegativeInteger(record.maxLegImbalance)
      ) {
        problems.push(`${path}.${band}: must be { minEvidence, maxLegImbalance }`);
      }
    }
  } else {
    if (input !== 'research-records') {
      problems.push(`${path}.input: report composition runs over research-records`);
    }
    if (v.summary !== 'enumerated-fields-only') {
      problems.push(`${path}.summary: must be 'enumerated-fields-only' (no free-text conclusions)`);
    }
    if (v.canonicalOrder !== 'observation-order') {
      problems.push(`${path}.canonicalOrder: must be 'observation-order'`);
    }
  }
  return problems;
}

/** Guard: `CrossMarketMethodRecord` (total — untrusted input never throws). */
export function isCrossMarketMethodRecord(v: unknown): v is CrossMarketMethodRecord {
  if (!isRecord(v)) return false;
  return (
    isCrossMarketMethodId(v.methodId) &&
    isCrossMarketMethodKind(v.kind) &&
    isCrossMarketMethodVersionRef(v.version) &&
    isRecord(v.parameters) &&
    parametersProblems('parameters', v.parameters).length === 0 &&
    isNonEmptyString(v.declaredBy) &&
    isNonNegativeInteger(v.declaredAt)
  );
}

/** COLLECT-ALL validation of a method record. */
export function validateCrossMarketMethodRecord(v: unknown, path = ''): readonly CrossMarketError[] {
  const errors: CrossMarketError[] = [];
  if (!isRecord(v)) {
    return [invalidType(path || 'method', 'a method record object')];
  }
  if (!isCrossMarketMethodId(v.methodId)) errors.push(invalidField(`${path}methodId`, 'must be a non-empty opaque method reference'));
  if (!isCrossMarketMethodKind(v.kind)) errors.push(invalidField(`${path}kind`, `must be one of ${METHOD_KINDS.join('|')}`));
  if (!isCrossMarketMethodVersionRef(v.version)) errors.push(invalidField(`${path}version`, 'must be a strict X.Y.Z version'));
  if (!isRecord(v.parameters)) {
    errors.push(invalidType(`${path}parameters`, 'an object'));
  } else {
    for (const problem of parametersProblems(`${path}parameters`, v.parameters)) {
      errors.push(invalidField(`${path}parameters`, problem.replace(/^parameters: /, '')));
    }
  }
  if (!isNonEmptyString(v.declaredBy)) errors.push(invalidField(`${path}declaredBy`, 'must be a non-empty string'));
  if (!isNonNegativeInteger(v.declaredAt)) errors.push(invalidField(`${path}declaredAt`, 'must be a non-negative epoch-millisecond integer'));
  return errors;
}

/**
 * Creates a validated, deeply-frozen method record. Refusal is typed data.
 */
export function createCrossMarketMethodRecord(draft: unknown): CrossMarketResult<CrossMarketMethodRecord> {
  const errors = validateCrossMarketMethodRecord(draft);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: deepFreeze({ ...(draft as CrossMarketMethodRecord) }) };
}

/** COLLECT-ALL validation of a whole registry draft. */
export function validateCrossMarketMethodRegistry(v: unknown): readonly CrossMarketError[] {
  const errors: CrossMarketError[] = [];
  if (!isRecord(v) || !Array.isArray(v.methods)) {
    return [invalidType('registry', 'a method registry object with a methods array')];
  }
  const methods = v.methods as readonly unknown[];
  if (methods.length === 0) {
    errors.push({ code: 'method_registry_empty', path: 'methods', message: 'a method registry must declare at least one method' });
  }
  const seen = new Set<string>();
  methods.forEach((method: unknown, index: number) => {
    for (const error of validateCrossMarketMethodRecord(method, `methods[${index}].`)) errors.push(error);
    if (isRecord(method) && isCrossMarketMethodId(method.methodId)) {
      if (seen.has(method.methodId)) {
        errors.push({ code: 'duplicate_method', path: `methods[${index}].methodId`, message: `duplicate method id ${method.methodId}` });
      }
      seen.add(method.methodId);
    }
  });
  return errors;
}

/**
 * Creates a validated, deeply-frozen method registry. Methods are stored
 * in CANONICAL ORDER (sorted by canonical JSON of the record — order can
 * never leak into the registry digest or into output bytes).
 */
export function createCrossMarketMethodRegistry(methods: readonly unknown[]): CrossMarketResult<CrossMarketMethodRegistry> {
  const errors = validateCrossMarketMethodRegistry({ methods });
  if (errors.length > 0) return { ok: false, errors };
  const records = (methods as readonly CrossMarketMethodRecord[]).slice();
  records.sort((a, b) => (canonicalJson(a as never) < canonicalJson(b as never) ? -1 : 1));
  const digest = stableDigestJson({ methods: records } as never);
  return { ok: true, value: deepFreeze({ methods: records, digest }) };
}

/** Looks a method up by id; `null` when undeclared. */
export function findCrossMarketMethod(registry: CrossMarketMethodRegistry, methodId: string): CrossMarketMethodRecord | null {
  for (const method of registry.methods) {
    if (method.methodId === methodId) return method;
  }
  return null;
}

/** Resolves a (methodId, version) citation; typed errors on drift. */
export function resolveCrossMarketMethodCitation(
  registry: CrossMarketMethodRegistry,
  methodId: unknown,
  version: unknown,
  expectedKind: CrossMarketMethodKind,
): readonly CrossMarketError[] {
  const errors: CrossMarketError[] = [];
  if (!isCrossMarketMethodId(methodId)) {
    return [invalidField('methodId', 'must match the compact identifier pattern')];
  }
  if (!isCrossMarketMethodVersionRef(version)) {
    errors.push(invalidField('methodVersion', 'must be a strict X.Y.Z version'));
  }
  const method = findCrossMarketMethod(registry, methodId);
  if (method === null) {
    errors.push({
      code: 'undeclared_method',
      path: 'methodId',
      message: `method ${JSON.stringify(methodId)} is not declared in the method registry — a cross-market measure without a declared method is a naked statistic, not a relationship`,
    });
    return errors;
  }
  if (isCrossMarketMethodVersionRef(version) && method.version !== version) {
    errors.push({
      code: 'method_version_mismatch',
      path: 'methodVersion',
      message: `method ${methodId} is declared at version ${method.version}, cited at ${version}`,
    });
  }
  if (method.kind !== expectedKind) {
    errors.push({
      code: 'method_kind_mismatch',
      path: 'methodId',
      message: `method ${methodId} is declared as '${method.kind}', used as '${expectedKind}'`,
    });
  }
  return errors;
}

/**
 * Resolves a RELATIONSHIP-ANALYSIS citation all the way to the declared
 * relation kind: the method must be kind 'relationship-analysis' AND its
 * parameters must declare the record's own relationKind (a co-movement
 * record citing the lead-lag method is a typed
 * `relationship_kind_mismatch`).
 */
export function resolveRelationshipCitation(
  registry: CrossMarketMethodRegistry,
  methodId: unknown,
  version: unknown,
  relationKind: unknown,
): readonly CrossMarketError[] {
  const errors: CrossMarketError[] = [
    ...resolveCrossMarketMethodCitation(registry, methodId, version, 'relationship-analysis'),
  ];
  if (errors.length > 0) return errors;
  const method = findCrossMarketMethod(registry, methodId as string);
  if (method === null) return errors; // unreachable given the resolution above
  if (!isRelationshipKind(relationKind)) {
    errors.push(invalidField('relationKind', `must be one of ${RELATIONSHIP_KINDS.join('|')}`));
    return errors;
  }
  if (method.parameters.kind !== 'relationship-analysis' || method.parameters.relationKind !== relationKind) {
    errors.push({
      code: 'relationship_kind_mismatch',
      path: 'relationKind',
      message: `method ${JSON.stringify(methodId)} declares relation kind '${method.parameters.kind === 'relationship-analysis' ? method.parameters.relationKind : '?'}', the record claims '${relationKind}'`,
    });
  }
  return errors;
}

/** Guard: `CrossMarketMethodRegistry`. */
export function isCrossMarketMethodRegistry(v: unknown): v is CrossMarketMethodRegistry {
  if (!isRecord(v)) return false;
  if (!isArrayOf(v.methods, isCrossMarketMethodRecord)) return false;
  if (!isDigest(v.digest)) return false;
  return stableDigestJson({ methods: v.methods } as never) === v.digest;
}

/** Validation wrapper: `CrossMarketMethodRegistry`. */
export function validateCrossMarketMethodRegistryRecord(v: unknown): CrossMarketValidation<CrossMarketMethodRegistry> {
  const errors = validateCrossMarketMethodRegistry(v);
  if (errors.length > 0) return validationOf(null, errors) as unknown as CrossMarketValidation<CrossMarketMethodRegistry>;
  if (isRecord(v) && !isCrossMarketMethodRegistry(v)) {
    return validationOf(null, [
      invalidField('digest', 'the registry digest does not match its canonical form'),
    ]) as unknown as CrossMarketValidation<CrossMarketMethodRegistry>;
  }
  return validationOf(v as CrossMarketMethodRegistry, []);
}

// ---------------------------------------------------------------------------
// The canonical declared method set (the methods the cross-market
// researcher body runs — the closed registry this package ships)
// ---------------------------------------------------------------------------

/**
 * The canonical method registry for the cross-market researcher body:
 * one declared method per relation kind (co-movement, lead-lag,
 * spread-divergence — each a DECLARED-METHOD + window record, never a
 * naked statistic), plus confidence and report composition, each with
 * fully enumerated parameters. `declaredAt` instants are explicit
 * literals (no clock).
 */
export const CROSS_MARKET_METHOD_REGISTRY: CrossMarketMethodRegistry = (() => {
  const construction = createCrossMarketMethodRegistry([
    {
      methodId: 'method/crossmarket/co-movement',
      kind: 'relationship-analysis',
      version: '1.0.0',
      parameters: {
        kind: 'relationship-analysis',
        input: 'market-observations',
        relationKind: 'co-movement',
        windowMs: 60_000,
        priceBasis: 'trade-price-or-quote-mid-or-reported-value',
        minMove: '0.005',
        minComparedWindows: 2,
        minObservationsPerLeg: 2,
        outputScale: 4,
        rounding: 'half-even',
        directionThresholds: { positive: '0.2', negative: '-0.2' },
      },
      declaredBy: 'tradrl-research-declaration/1',
      declaredAt: 1_780_000_000_000,
    },
    {
      methodId: 'method/crossmarket/lead-lag',
      kind: 'relationship-analysis',
      version: '1.0.0',
      parameters: {
        kind: 'relationship-analysis',
        input: 'market-observations',
        relationKind: 'lead-lag',
        windowMs: 60_000,
        priceBasis: 'trade-price-or-quote-mid-or-reported-value',
        minMove: '0.005',
        minDecisiveWindows: 1,
        minObservationsPerLeg: 2,
        outputScale: 4,
        rounding: 'half-even',
        directionThresholds: { leftLeads: '0.5', rightLeads: '-0.5' },
      },
      declaredBy: 'tradrl-research-declaration/1',
      declaredAt: 1_780_000_000_000,
    },
    {
      methodId: 'method/crossmarket/spread-divergence',
      kind: 'relationship-analysis',
      version: '1.0.0',
      parameters: {
        kind: 'relationship-analysis',
        input: 'market-observations',
        relationKind: 'spread-divergence',
        windowMs: 60_000,
        priceBasis: 'trade-price-or-quote-mid-or-reported-value',
        minObservationsPerLeg: 2,
        outputScale: 4,
        rounding: 'half-even',
        directionThresholds: { widening: '0.02', narrowing: '-0.02' },
      },
      declaredBy: 'tradrl-research-declaration/1',
      declaredAt: 1_780_000_000_000,
    },
    {
      methodId: 'method/crossmarket/confidence',
      kind: 'confidence-estimation',
      version: '1.0.0',
      parameters: {
        kind: 'confidence-estimation',
        input: 'research-records',
        basis: 'evidence-count-and-leg-balance',
        high: { minEvidence: 8, maxLegImbalance: 2 },
        moderate: { minEvidence: 4, maxLegImbalance: 4 },
      },
      declaredBy: 'tradrl-research-declaration/1',
      declaredAt: 1_780_000_000_000,
    },
    {
      methodId: 'method/crossmarket/report-composition',
      kind: 'report-composition',
      version: '1.0.0',
      parameters: {
        kind: 'report-composition',
        input: 'research-records',
        summary: 'enumerated-fields-only',
        canonicalOrder: 'observation-order',
      },
      declaredBy: 'tradrl-research-declaration/1',
      declaredAt: 1_780_000_000_000,
    },
  ]);
  if (!construction.ok) {
    throw new TypeError(
      `CROSS_MARKET_METHOD_REGISTRY must construct: ${construction.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
    );
  }
  return construction.value;
})();

/** The declared co-movement method of the canonical registry. */
export const CROSS_MARKET_CO_MOVEMENT_METHOD: CrossMarketMethodRecord =
  CROSS_MARKET_METHOD_REGISTRY.methods.find(
    (m) => m.methodId === 'method/crossmarket/co-movement',
  ) as CrossMarketMethodRecord;

/** The declared lead-lag method of the canonical registry. */
export const CROSS_MARKET_LEAD_LAG_METHOD: CrossMarketMethodRecord =
  CROSS_MARKET_METHOD_REGISTRY.methods.find(
    (m) => m.methodId === 'method/crossmarket/lead-lag',
  ) as CrossMarketMethodRecord;

/** The declared spread-divergence method of the canonical registry. */
export const CROSS_MARKET_SPREAD_DIVERGENCE_METHOD: CrossMarketMethodRecord =
  CROSS_MARKET_METHOD_REGISTRY.methods.find(
    (m) => m.methodId === 'method/crossmarket/spread-divergence',
  ) as CrossMarketMethodRecord;

/** The declared confidence method of the canonical registry. */
export const CROSS_MARKET_CONFIDENCE_METHOD: CrossMarketMethodRecord =
  CROSS_MARKET_METHOD_REGISTRY.methods.find(
    (m) => m.methodId === 'method/crossmarket/confidence',
  ) as CrossMarketMethodRecord;

/** The declared report-composition method of the canonical registry. */
export const CROSS_MARKET_REPORT_COMPOSITION_METHOD: CrossMarketMethodRecord =
  CROSS_MARKET_METHOD_REGISTRY.methods.find(
    (m) => m.methodId === 'method/crossmarket/report-composition',
  ) as CrossMarketMethodRecord;
