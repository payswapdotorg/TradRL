// @tradrl/body-fundamental-researcher — the DECLARED-METHOD discipline.
//
// Owning Work Order: T023, section 3 ("Method honesty"):
//   "fundamental assessments (valuation-style readings, corporate-action
//    implications, financial-health indicators) ... are DECLARED-METHOD
//    outputs (versioned method records over equities/alt-data observation
//    windows); an undeclared magic output fails (negative test). Taxonomies
//    (assessment kinds, relationship kinds) are CLOSED unions. Confidence
//    fields are declared-method records, never naked guesses."
//
// A FundamentalMethodRecord is a versioned, structured, deeply-frozen
// declaration of HOW a fundamental research output is computed: its kind,
// its declared input class, its enumerated parameters (series fields,
// trailing window widths, stance thresholds, scales, rounding modes —
// every knob is a declared field, never an implicit constant). The
// registry is the closed set a body may run; every output cites
// (methodId, methodVersion) and validation re-resolves the citation
// against the registry — an output citing an unknown method id, a stale
// version, a method of the wrong kind, or a method whose declared
// assessment kind disagrees with the record's own kind is a TYPED ERROR,
// not a warning.
//
// Laws held here: zero runtime deps; no `any`; total hand-rolled guards;
// no ambient clock (`declaredAt` is an explicit literal instant);
// deepFreeze everything public; deterministic registry digest (L9 — the
// registry identity binds into every output's lineage).

import { deepFreeze, isNonEmptyString, isNonNegativeInteger, isPositiveInteger, isRecord, isMemberOf, isArrayOf, canonicalJson, stableDigestJson, isDigest } from './primitives';
import { type FundamentalMethodId, type FundamentalMethodVersionRef, isFundamentalMethodId, isFundamentalMethodVersionRef } from './ids';
import { type FundamentalError, type FundamentalResult, type FundamentalValidation, invalidField, invalidType, validationOf } from './errors';
import { isSignedDecimal, isUnsignedDecimal } from './decimals';

// ---------------------------------------------------------------------------
// The closed taxonomies (assessment kinds, corporate-action kinds, stances)
// ---------------------------------------------------------------------------

/**
 * The declared assessment taxonomy (CLOSED union — the Work Order's
 * enumeration: valuation-style readings, corporate-action implications,
 * financial-health indicators; corporate-action implications flow through
 * the CorporateActionDigest's declared implication table, so the
 * assessment kinds carry the valuation/macro/health trichotomy):
 *   - 'valuation-level'   — a reported index level read against its own
 *                            trailing window (extended / depressed / in line);
 *   - 'macro-surprise'    — an economic series release read against its
 *                            consensus forecast (above / below / in line);
 *   - 'health-indicator'  — a declared health/alt series read as its own
 *                            net trend over the observation window.
 */
export const ASSESSMENT_KINDS = [
  'valuation-level',
  'macro-surprise',
  'health-indicator',
] as const;

/** A declared assessment kind. */
export type AssessmentKind = (typeof ASSESSMENT_KINDS)[number];

/** Guard: a declared assessment kind. */
export const isAssessmentKind = (v: unknown): v is AssessmentKind =>
  isMemberOf(ASSESSMENT_KINDS, v);

function isAssessmentKindDeclared(v: unknown): boolean {
  return typeof v === 'string' && (ASSESSMENT_KINDS as readonly string[]).includes(v);
}

/**
 * The corporate-action taxonomy (CLOSED union — the neutral translations
 * of the licensed feed's documented action type codes: SPLIT, CASH_DIVIDEND,
 * MERGER; the equities adapter's schema layer performs the translation,
 * and this lane consumes the neutral forms only).
 */
export const CORPORATE_ACTION_KINDS = ['split', 'cash_dividend', 'merger'] as const;

/** A declared corporate-action kind. */
export type CorporateActionKind = (typeof CORPORATE_ACTION_KINDS)[number];

/** Guard: a declared corporate-action kind. */
export const isCorporateActionKind = (v: unknown): v is CorporateActionKind =>
  isMemberOf(CORPORATE_ACTION_KINDS, v);

function isCorporateActionKindDeclared(v: unknown): boolean {
  return typeof v === 'string' && (CORPORATE_ACTION_KINDS as readonly string[]).includes(v);
}

/**
 * The implication stances a declared action table may carry (CLOSED
 * union): what the corporate action MEANS for the affected instrument
 * under the declared digestion method — a mechanical split is 'neutral',
 * a cash dividend is 'positive' yield support, a merger is 'mixed'
 * structural change. Interpretation beyond the declared table is the
 * Trading Director's judgment, never this body's.
 */
export const IMPLICATION_STANCES = ['positive', 'negative', 'neutral', 'mixed'] as const;

/** A declared implication stance. */
export type ImplicationStance = (typeof IMPLICATION_STANCES)[number];

/** Guard: a declared implication stance. */
export const isImplicationStance = (v: unknown): v is ImplicationStance =>
  isMemberOf(IMPLICATION_STANCES, v);

// ---------------------------------------------------------------------------
// The closed method-kind vocabulary
// ---------------------------------------------------------------------------

/** What a declared method is FOR. Closed vocabulary. */
export const METHOD_KINDS = [
  'assessment',
  'corporate-action-digestion',
  'confidence-estimation',
  'report-composition',
] as const;

/** A declared method kind. */
export type FundamentalMethodKind = (typeof METHOD_KINDS)[number];

/** Guard: a method kind. */
export const isFundamentalMethodKind = (v: unknown): v is FundamentalMethodKind =>
  isMemberOf(METHOD_KINDS, v);

/** The declared input classes (closed vocabulary). */
export const METHOD_INPUTS = [
  'fundamental-observations',
  'macro-release-observations',
  'corporate-action-observations',
  'research-records',
] as const;

/** A declared method input class. */
export type FundamentalMethodInput = (typeof METHOD_INPUTS)[number];

/** Guard: a declared input class. */
export const isFundamentalMethodInput = (v: unknown): v is FundamentalMethodInput =>
  isMemberOf(METHOD_INPUTS, v);

// ---------------------------------------------------------------------------
// Structured parameters per kind (enumerated — no implicit constants)
// ---------------------------------------------------------------------------

/**
 * Valuation-assessment parameters: how reported index levels become a
 * valuation-style stance. The score is the exact ratio of the LATEST
 * level over the trailing mean of the prior `trailingPeriods` levels,
 * minus one — every threshold and width is declared here.
 */
export interface ValuationAssessmentParameters {
  readonly kind: 'assessment';
  readonly input: 'fundamental-observations';
  readonly assessmentKind: 'valuation-level';
  /** The declared fundamental payload field this method assesses (e.g. 'INDEX_LEVEL'). */
  readonly seriesField: string;
  /** How many PRIOR observations form the trailing baseline. */
  readonly trailingPeriods: number;
  /** The declared fixed decimal scale of the output score. */
  readonly outputScale: number;
  /** The declared rounding mode for scaled arithmetic. */
  readonly rounding: 'half-even' | 'truncate';
  /** Stance direction thresholds on the signed level-vs-trailing-mean ratio. */
  readonly polarityThresholds: { readonly positive: string; readonly negative: string };
}

/**
 * Macro-surprise-assessment parameters: how economic series releases
 * become a surprise stance. The score is the exact mean over the window's
 * releases of (actual - forecast) / forecast — only releases that carry a
 * forecast are assessed; a forecast-less release is an unassessed series,
 * never a fabricated zero surprise.
 */
export interface MacroSurpriseAssessmentParameters {
  readonly kind: 'assessment';
  readonly input: 'macro-release-observations';
  readonly assessmentKind: 'macro-surprise';
  readonly outputScale: number;
  readonly rounding: 'half-even' | 'truncate';
  /** Stance direction thresholds on the signed mean surprise ratio. */
  readonly polarityThresholds: { readonly positive: string; readonly negative: string };
}

/**
 * Health-assessment parameters: how declared health/alt series become a
 * trend stance. The score is the exact net-change ratio of the series
 * (last value over first value, minus one) over the observation window.
 * The direction reports the series' OWN trend — translating a rising
 * inventory level into a price view is the director's judgment, never
 * this body's (the stance semantics are declared here, not inferred).
 */
export interface HealthAssessmentParameters {
  readonly kind: 'assessment';
  readonly input: 'fundamental-observations';
  readonly assessmentKind: 'health-indicator';
  /** The declared fundamental payload fields treated as health series (unique, non-empty). */
  readonly healthFields: readonly string[];
  readonly outputScale: number;
  readonly rounding: 'half-even' | 'truncate';
  /** Stance direction thresholds on the signed net-change ratio. */
  readonly polarityThresholds: { readonly positive: string; readonly negative: string };
}

/**
 * Corporate-action-digestion parameters: how corporate-action observations
 * become structured digests. Clustering is by (epoch-aligned window of
 * available_time, instrument, action kind); the DECLARED implication
 * table fixes the stance each action kind carries — free-form
 * implication selection is unlawful.
 */
export interface CorporateActionDigestionParameters {
  readonly kind: 'corporate-action-digestion';
  readonly input: 'corporate-action-observations';
  /** The declared clustering basis: knowledge-time (L4-honest). */
  readonly windowBasis: 'available-time';
  /** The declared clustering window width, in epoch milliseconds. */
  readonly windowMs: number;
  /** Minimum observations inside one window to declare a digest. */
  readonly minObservations: number;
  /** The DECLARED action-to-implication table (unique actions). */
  readonly implications: readonly { readonly action: CorporateActionKind; readonly implication: ImplicationStance }[];
}

/**
 * Confidence-estimation parameters: how confidence levels are derived.
 * The declared basis is the evidence count plus the scale-free RANGE
 * RATIO of the assessed values (largest magnitude, smallest magnitude) —
 * a CATEGORY, never a naked score.
 */
export interface ConfidenceParameters {
  readonly kind: 'confidence-estimation';
  readonly input: 'research-records';
  /** The declared basis (closed: evidence count + range ratio). */
  readonly basis: 'evidence-count-and-range-ratio';
  /** The 'high' band: minimum evidence count AND maximum range ratio. */
  readonly high: { readonly minEvidence: number; readonly maxDispersion: string };
  /** The 'moderate' band: minimum evidence count AND maximum range ratio. */
  readonly moderate: { readonly minEvidence: number; readonly maxDispersion: string };
}

/** Report-composition parameters: how outputs become one publication. */
export interface ReportCompositionParameters {
  readonly kind: 'report-composition';
  readonly input: 'research-records';
  /** Enumerated summary fields only — free-text conclusions are unlawful. */
  readonly summary: 'enumerated-fields-only';
  /** The canonical output ordering (deterministic bytes). */
  readonly canonicalOrder: 'observation-order';
}

/** The union of declared parameter shapes. */
export type FundamentalMethodParameters =
  | ValuationAssessmentParameters
  | MacroSurpriseAssessmentParameters
  | HealthAssessmentParameters
  | CorporateActionDigestionParameters
  | ConfidenceParameters
  | ReportCompositionParameters;

// ---------------------------------------------------------------------------
// MethodRecord + registry
// ---------------------------------------------------------------------------

/**
 * A DECLARED METHOD: the versioned, structured record that every
 * fundamental research output must cite. A method that is not one of
 * these is a magic number, and a magic number fails validation (the
 * method-honesty law).
 */
export interface FundamentalMethodRecord {
  /** Method identity (e.g. `method/fundamental/valuation`). */
  readonly methodId: FundamentalMethodId;
  /** What the method is for. */
  readonly kind: FundamentalMethodKind;
  /** The method's own version (strict X.Y.Z). */
  readonly version: FundamentalMethodVersionRef;
  /** The declared, enumerated parameters. */
  readonly parameters: FundamentalMethodParameters;
  /** Identity of the declaring authority (person, service or pipeline). */
  readonly declaredBy: string;
  /** When the method was declared (explicit literal instant — no clock). */
  readonly declaredAt: number;
}

/** The frozen method registry: the closed set a body may run. */
export interface FundamentalMethodRegistry {
  /** The declared methods, canonically ordered by canonical JSON. */
  readonly methods: readonly FundamentalMethodRecord[];
  /** The registry identity: a stable digest over the canonical form (L9). */
  readonly digest: string;
}

// -- parameter guards -------------------------------------------------------

function polarityThresholdsOk(path: string, v: unknown, problems: string[]): void {
  const thresholds = v;
  if (
    !isRecord(thresholds) ||
    !isSignedDecimal(thresholds.positive) ||
    !isSignedDecimal(thresholds.negative)
  ) {
    problems.push(`${path}.polarityThresholds: must be { positive, negative } signed decimals`);
  } else if (
    (thresholds.positive as string) === '' ||
    (thresholds.negative as string) === ''
  ) {
    problems.push(`${path}.polarityThresholds: must be non-empty`);
  }
}

function parametersProblems(path: string, v: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(v)) return [`${path}: must be an object`];
  const kind = v.kind;
  if (!isFundamentalMethodKind(kind)) return [`${path}.kind: must be one of ${METHOD_KINDS.join('|')}`];
  const input = v.input;
  if (!isFundamentalMethodInput(input)) return [`${path}.input: must be one of ${METHOD_INPUTS.join('|')}`];
  if (kind === 'assessment') {
    const assessmentKind = v.assessmentKind;
    if (!isAssessmentKindDeclared(assessmentKind)) {
      problems.push(`${path}.assessmentKind: must be one of ${ASSESSMENT_KINDS.join('|')}`);
      return problems;
    }
    if (!isPositiveInteger(v.outputScale) || (v.outputScale as number) > 8) {
      problems.push(`${path}.outputScale: must be an integer in [1, 8]`);
    }
    if (v.rounding !== 'half-even' && v.rounding !== 'truncate') {
      problems.push(`${path}.rounding: must be 'half-even' or 'truncate'`);
    }
    polarityThresholdsOk(path, v.polarityThresholds, problems);
    if (assessmentKind === 'valuation-level') {
      if (input !== 'fundamental-observations') {
        problems.push(`${path}.input: valuation-level methods assess fundamental-observations`);
      }
      if (!isNonEmptyString(v.seriesField)) {
        problems.push(`${path}.seriesField: must be a non-empty declared series field`);
      }
      if (!isPositiveInteger(v.trailingPeriods)) {
        problems.push(`${path}.trailingPeriods: must be a positive integer`);
      }
    } else if (assessmentKind === 'macro-surprise') {
      if (input !== 'macro-release-observations') {
        problems.push(`${path}.input: macro-surprise methods assess macro-release-observations`);
      }
    } else {
      if (input !== 'fundamental-observations') {
        problems.push(`${path}.input: health-indicator methods assess fundamental-observations`);
      }
      if (
        !isArrayOf(v.healthFields, isNonEmptyString) ||
        (v.healthFields as readonly string[]).length === 0 ||
        new Set(v.healthFields as readonly string[]).size !== (v.healthFields as readonly string[]).length
      ) {
        problems.push(`${path}.healthFields: must be a non-empty array of unique declared fields`);
      }
    }
  } else if (kind === 'corporate-action-digestion') {
    if (input !== 'corporate-action-observations') {
      problems.push(`${path}.input: corporate-action digestion consumes corporate-action-observations`);
    }
    if (v.windowBasis !== 'available-time') {
      problems.push(`${path}.windowBasis: must be 'available-time' (L4 — knowledge-time clustering)`);
    }
    if (!isPositiveInteger(v.windowMs)) problems.push(`${path}.windowMs: must be a positive integer`);
    if (!isPositiveInteger(v.minObservations)) {
      problems.push(`${path}.minObservations: must be a positive integer`);
    }
    if (!isArrayOf(v.implications, isRecord)) {
      problems.push(`${path}.implications: must be an array of { action, implication } declarations`);
    } else {
      const entries = v.implications as readonly Record<string, unknown>[];
      const seenActions = new Set<string>();
      for (const entry of entries) {
        if (!isNonEmptyString(entry.action) || !isCorporateActionKindDeclared(entry.action)) {
          problems.push(`${path}.implications: action ${JSON.stringify(entry.action)} is outside the declared corporate-action taxonomy`);
        }
        if (!isNonEmptyString(entry.implication) || !isMemberOf(IMPLICATION_STANCES, entry.implication)) {
          problems.push(`${path}.implications: implication ${JSON.stringify(entry.implication)} is outside the declared stance taxonomy`);
        }
        if (typeof entry.action === 'string') {
          if (seenActions.has(entry.action)) {
            problems.push(`${path}.implications: duplicate action ${JSON.stringify(entry.action)}`);
          }
          seenActions.add(entry.action);
        }
      }
    }
  } else if (kind === 'confidence-estimation') {
    if (input !== 'research-records') {
      problems.push(`${path}.input: confidence estimation runs over research-records`);
    }
    if (v.basis !== 'evidence-count-and-range-ratio') {
      problems.push(`${path}.basis: must be 'evidence-count-and-range-ratio'`);
    }
    for (const band of ['high', 'moderate'] as const) {
      const record = v[band];
      if (
        !isRecord(record) ||
        !isPositiveInteger(record.minEvidence) ||
        !isUnsignedDecimal(record.maxDispersion)
      ) {
        problems.push(`${path}.${band}: must be { minEvidence, maxDispersion }`);
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

/** Guard: `FundamentalMethodRecord` (total — untrusted input never throws). */
export function isFundamentalMethodRecord(v: unknown): v is FundamentalMethodRecord {
  if (!isRecord(v)) return false;
  return (
    isFundamentalMethodId(v.methodId) &&
    isFundamentalMethodKind(v.kind) &&
    isFundamentalMethodVersionRef(v.version) &&
    isRecord(v.parameters) &&
    parametersProblems('parameters', v.parameters).length === 0 &&
    isNonEmptyString(v.declaredBy) &&
    isNonNegativeInteger(v.declaredAt)
  );
}

/** COLLECT-ALL validation of a method record. */
export function validateFundamentalMethodRecord(v: unknown, path = ''): readonly FundamentalError[] {
  const errors: FundamentalError[] = [];
  if (!isRecord(v)) {
    return [invalidType(path || 'method', 'a method record object')];
  }
  if (!isFundamentalMethodId(v.methodId)) errors.push(invalidField(`${path}methodId`, 'must be a non-empty opaque method reference'));
  if (!isFundamentalMethodKind(v.kind)) errors.push(invalidField(`${path}kind`, `must be one of ${METHOD_KINDS.join('|')}`));
  if (!isFundamentalMethodVersionRef(v.version)) errors.push(invalidField(`${path}version`, 'must be a strict X.Y.Z version'));
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
export function createFundamentalMethodRecord(draft: unknown): FundamentalResult<FundamentalMethodRecord> {
  const errors = validateFundamentalMethodRecord(draft);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: deepFreeze({ ...(draft as FundamentalMethodRecord) }) };
}

/** COLLECT-ALL validation of a whole registry draft. */
export function validateFundamentalMethodRegistry(v: unknown): readonly FundamentalError[] {
  const errors: FundamentalError[] = [];
  if (!isRecord(v) || !Array.isArray(v.methods)) {
    return [invalidType('registry', 'a method registry object with a methods array')];
  }
  const methods = v.methods as readonly unknown[];
  if (methods.length === 0) {
    errors.push({ code: 'method_registry_empty', path: 'methods', message: 'a method registry must declare at least one method' });
  }
  const seen = new Set<string>();
  methods.forEach((method: unknown, index: number) => {
    for (const error of validateFundamentalMethodRecord(method, `methods[${index}].`)) errors.push(error);
    if (isRecord(method) && isFundamentalMethodId(method.methodId)) {
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
export function createFundamentalMethodRegistry(methods: readonly unknown[]): FundamentalResult<FundamentalMethodRegistry> {
  const errors = validateFundamentalMethodRegistry({ methods });
  if (errors.length > 0) return { ok: false, errors };
  const records = (methods as readonly FundamentalMethodRecord[]).slice();
  records.sort((a, b) => (canonicalJson(a as never) < canonicalJson(b as never) ? -1 : 1));
  const digest = stableDigestJson({ methods: records } as never);
  return { ok: true, value: deepFreeze({ methods: records, digest }) };
}

/** Looks a method up by id; `null` when undeclared. */
export function findFundamentalMethod(registry: FundamentalMethodRegistry, methodId: string): FundamentalMethodRecord | null {
  for (const method of registry.methods) {
    if (method.methodId === methodId) return method;
  }
  return null;
}

/** Resolves a (methodId, version) citation; typed errors on drift. */
export function resolveFundamentalMethodCitation(
  registry: FundamentalMethodRegistry,
  methodId: unknown,
  version: unknown,
  expectedKind: FundamentalMethodKind,
): readonly FundamentalError[] {
  const errors: FundamentalError[] = [];
  if (!isFundamentalMethodId(methodId)) {
    return [invalidField('methodId', 'must match the compact identifier pattern')];
  }
  if (!isFundamentalMethodVersionRef(version)) {
    errors.push(invalidField('methodVersion', 'must be a strict X.Y.Z version'));
  }
  const method = findFundamentalMethod(registry, methodId);
  if (method === null) {
    errors.push({
      code: 'undeclared_method',
      path: 'methodId',
      message: `method ${JSON.stringify(methodId)} is not declared in the method registry — a fundamental value without a declared method is a magic number, not an assessment`,
    });
    return errors;
  }
  if (isFundamentalMethodVersionRef(version) && method.version !== version) {
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
 * Resolves an ASSESSMENT citation all the way to the declared assessment
 * kind: the method must be kind 'assessment' AND its parameters must
 * declare the record's own assessmentKind (a valuation record citing the
 * macro-surprise method is a typed `assessment_kind_mismatch`).
 */
export function resolveAssessmentCitation(
  registry: FundamentalMethodRegistry,
  methodId: unknown,
  version: unknown,
  assessmentKind: unknown,
): readonly FundamentalError[] {
  const errors: FundamentalError[] = [
    ...resolveFundamentalMethodCitation(registry, methodId, version, 'assessment'),
  ];
  if (errors.length > 0) return errors;
  const method = findFundamentalMethod(registry, methodId as string);
  if (method === null) return errors; // unreachable given the resolution above
  if (!isAssessmentKind(assessmentKind)) {
    errors.push(invalidField('assessmentKind', `must be one of ${ASSESSMENT_KINDS.join('|')}`));
    return errors;
  }
  if (method.parameters.kind !== 'assessment' || method.parameters.assessmentKind !== assessmentKind) {
    errors.push({
      code: 'assessment_kind_mismatch',
      path: 'assessmentKind',
      message: `method ${JSON.stringify(methodId)} declares assessment kind '${method.parameters.kind === 'assessment' ? method.parameters.assessmentKind : '?'}', the record claims '${assessmentKind}'`,
    });
  }
  return errors;
}

/** Guard: `FundamentalMethodRegistry`. */
export function isFundamentalMethodRegistry(v: unknown): v is FundamentalMethodRegistry {
  if (!isRecord(v)) return false;
  if (!isArrayOf(v.methods, isFundamentalMethodRecord)) return false;
  if (!isDigest(v.digest)) return false;
  return stableDigestJson({ methods: v.methods } as never) === v.digest;
}

/** Validation wrapper: `FundamentalMethodRegistry`. */
export function validateFundamentalMethodRegistryRecord(v: unknown): FundamentalValidation<FundamentalMethodRegistry> {
  const errors = validateFundamentalMethodRegistry(v);
  if (errors.length > 0) return validationOf(null, errors) as unknown as FundamentalValidation<FundamentalMethodRegistry>;
  if (isRecord(v) && !isFundamentalMethodRegistry(v)) {
    return validationOf(null, [
      invalidField('digest', 'the registry digest does not match its canonical form'),
    ]) as unknown as FundamentalValidation<FundamentalMethodRegistry>;
  }
  return validationOf(v as FundamentalMethodRegistry, []);
}

// ---------------------------------------------------------------------------
// The canonical declared method set (the methods the fundamental
// researcher body runs — the closed registry this package ships)
// ---------------------------------------------------------------------------

/**
 * The canonical method registry for the fundamental researcher body: one
 * declared method per pipeline stage (three assessment methods — one per
 * assessment kind — plus corporate-action digestion, confidence and
 * report composition), each with fully enumerated parameters. `declaredAt`
 * instants are explicit literals (no clock).
 */
export const FUNDAMENTAL_METHOD_REGISTRY: FundamentalMethodRegistry = (() => {
  const construction = createFundamentalMethodRegistry([
    {
      methodId: 'method/fundamental/valuation',
      kind: 'assessment',
      version: '1.0.0',
      parameters: {
        kind: 'assessment',
        input: 'fundamental-observations',
        assessmentKind: 'valuation-level',
        seriesField: 'INDEX_LEVEL',
        trailingPeriods: 4,
        outputScale: 4,
        rounding: 'half-even',
        polarityThresholds: { positive: '0.02', negative: '-0.02' },
      },
      declaredBy: 'tradrl-research-declaration/1',
      declaredAt: 1_780_000_000_000,
    },
    {
      methodId: 'method/fundamental/macro-surprise',
      kind: 'assessment',
      version: '1.0.0',
      parameters: {
        kind: 'assessment',
        input: 'macro-release-observations',
        assessmentKind: 'macro-surprise',
        outputScale: 4,
        rounding: 'half-even',
        polarityThresholds: { positive: '0.005', negative: '-0.005' },
      },
      declaredBy: 'tradrl-research-declaration/1',
      declaredAt: 1_780_000_000_000,
    },
    {
      methodId: 'method/fundamental/health',
      kind: 'assessment',
      version: '1.0.0',
      parameters: {
        kind: 'assessment',
        input: 'fundamental-observations',
        assessmentKind: 'health-indicator',
        healthFields: ['ACTIVE_RIG_COUNT', 'RAIL_TRAFFIC_INDEX', 'POWER_DEMAND_INDEX'],
        outputScale: 4,
        rounding: 'half-even',
        polarityThresholds: { positive: '0.02', negative: '-0.02' },
      },
      declaredBy: 'tradrl-research-declaration/1',
      declaredAt: 1_780_000_000_000,
    },
    {
      methodId: 'method/fundamental/corporate-action',
      kind: 'corporate-action-digestion',
      version: '1.0.0',
      parameters: {
        kind: 'corporate-action-digestion',
        input: 'corporate-action-observations',
        windowBasis: 'available-time',
        windowMs: 3_600_000,
        minObservations: 1,
        implications: [
          { action: 'split', implication: 'neutral' },
          { action: 'cash_dividend', implication: 'positive' },
          { action: 'merger', implication: 'mixed' },
        ],
      },
      declaredBy: 'tradrl-research-declaration/1',
      declaredAt: 1_780_000_000_000,
    },
    {
      methodId: 'method/fundamental/confidence',
      kind: 'confidence-estimation',
      version: '1.0.0',
      parameters: {
        kind: 'confidence-estimation',
        input: 'research-records',
        basis: 'evidence-count-and-range-ratio',
        high: { minEvidence: 4, maxDispersion: '0.05' },
        moderate: { minEvidence: 2, maxDispersion: '0.10' },
      },
      declaredBy: 'tradrl-research-declaration/1',
      declaredAt: 1_780_000_000_000,
    },
    {
      methodId: 'method/fundamental/report-composition',
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
      `FUNDAMENTAL_METHOD_REGISTRY must construct: ${construction.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
    );
  }
  return construction.value;
})();

/** The declared valuation method of the canonical registry. */
export const FUNDAMENTAL_VALUATION_METHOD: FundamentalMethodRecord =
  FUNDAMENTAL_METHOD_REGISTRY.methods.find(
    (m) => m.methodId === 'method/fundamental/valuation',
  ) as FundamentalMethodRecord;

/** The declared macro-surprise method of the canonical registry. */
export const FUNDAMENTAL_MACRO_SURPRISE_METHOD: FundamentalMethodRecord =
  FUNDAMENTAL_METHOD_REGISTRY.methods.find(
    (m) => m.methodId === 'method/fundamental/macro-surprise',
  ) as FundamentalMethodRecord;

/** The declared health method of the canonical registry. */
export const FUNDAMENTAL_HEALTH_METHOD: FundamentalMethodRecord =
  FUNDAMENTAL_METHOD_REGISTRY.methods.find(
    (m) => m.methodId === 'method/fundamental/health',
  ) as FundamentalMethodRecord;

/** The declared corporate-action method of the canonical registry. */
export const FUNDAMENTAL_CORPORATE_ACTION_METHOD: FundamentalMethodRecord =
  FUNDAMENTAL_METHOD_REGISTRY.methods.find(
    (m) => m.methodId === 'method/fundamental/corporate-action',
  ) as FundamentalMethodRecord;

/** The declared confidence method of the canonical registry. */
export const FUNDAMENTAL_CONFIDENCE_METHOD: FundamentalMethodRecord =
  FUNDAMENTAL_METHOD_REGISTRY.methods.find(
    (m) => m.methodId === 'method/fundamental/confidence',
  ) as FundamentalMethodRecord;

/** The declared report-composition method of the canonical registry. */
export const FUNDAMENTAL_REPORT_COMPOSITION_METHOD: FundamentalMethodRecord =
  FUNDAMENTAL_METHOD_REGISTRY.methods.find(
    (m) => m.methodId === 'method/fundamental/report-composition',
  ) as FundamentalMethodRecord;
