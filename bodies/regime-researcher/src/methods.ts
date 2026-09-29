// @tradrl/body-regime-researcher — the DECLARED-METHOD discipline.
//
// Owning Work Order: T022, section 3 ("Method honesty"):
//   "regime classifications are DECLARED-METHOD outputs (versioned method
//    records — e.g. declared volatility/return-state statistics over
//    market-event windows with declared boundaries); a 'regime' that is an
//    undeclared magic label fails (negative test). Regime taxonomies are
//    CLOSED discriminated unions (declared in the method record —
//    trending/ranging/volatile/quiet or whatever the method declares —
//    never free text). Confidence fields are declared-method records,
//    never naked guesses."
//
// A RegimeMethodRecord is a versioned, structured, deeply-frozen
// declaration of HOW a research output is computed: its kind, its declared
// input class, its enumerated parameters (window width, price basis,
// thresholds, taxonomy, rounding — every knob is a declared field, never
// an implicit constant). The registry is the closed set a body may run;
// every output cites (methodId, methodVersion) and validation re-resolves
// the citation against the registry — an output citing an unknown method
// id, a stale version, or a method of the wrong kind is a TYPED ERROR,
// not a warning.
//
// Laws held here: zero runtime deps; no `any`; total hand-rolled guards;
// no ambient clock (`declaredAt` is an explicit literal instant);
// deepFreeze everything public; deterministic registry digest (L9 — the
// registry identity binds into every output's lineage).

import { deepFreeze, isNonEmptyString, isNonNegativeInteger, isPositiveInteger, isRecord, isMemberOf, isArrayOf, duplicatesOf, canonicalJson, stableDigestJson, isDigest } from './primitives';
import { type RegimeMethodId, type RegimeMethodVersionRef, isRegimeMethodId, isRegimeMethodVersionRef } from './ids';
import { type RegimeError, type RegimeResult, type RegimeValidation, invalidField, invalidType, validationOf } from './errors';
import { compareDecimal, isPositiveDecimal, isUnsignedDecimal } from './decimals';

// ---------------------------------------------------------------------------
// The derivable regime labels (the decision function's closed range)
// ---------------------------------------------------------------------------

/**
 * The labels the declared v1 decision function (`trend-then-volatility`)
 * can derive. A classification method's declared taxonomy MUST cover
 * every one of them — a taxonomy the decision function can escape is a
 * method-dishonesty violation (the closed-taxonomy law), reported at
 * method-record validation time. The taxonomy may declare MORE labels
 * (the method record owns the vocabulary); it may never declare fewer
 * than the decision function's range.
 */
export const DERIVABLE_REGIME_LABELS = [
  'trending-up',
  'trending-down',
  'ranging',
  'volatile',
  'quiet',
] as const;

/** A label derivable by the declared decision function. */
export type DerivableRegimeLabel = (typeof DERIVABLE_REGIME_LABELS)[number];

// ---------------------------------------------------------------------------
// The closed method-kind vocabulary
// ---------------------------------------------------------------------------

/** What a declared method is FOR. Closed vocabulary. */
export const REGIME_METHOD_KINDS = [
  'regime-classification',
  'regime-change-detection',
  'confidence-estimation',
  'report-composition',
] as const;

/** A declared method kind. */
export type RegimeMethodKind = (typeof REGIME_METHOD_KINDS)[number];

/** Guard: a method kind. */
export const isRegimeMethodKind = (v: unknown): v is RegimeMethodKind =>
  isMemberOf(REGIME_METHOD_KINDS, v);

/** The declared input classes (closed vocabulary). */
export const REGIME_METHOD_INPUTS = [
  'market-event-observations',
  'research-records',
] as const;

/** A declared method input class. */
export type RegimeMethodInput = (typeof REGIME_METHOD_INPUTS)[number];

/** Guard: a declared input class. */
export const isRegimeMethodInput = (v: unknown): v is RegimeMethodInput =>
  isMemberOf(REGIME_METHOD_INPUTS, v);

/** The declared price-extraction bases (closed vocabulary). */
export const PRICE_BASES = ['trade-price-or-quote-mid-or-book-best'] as const;

/** A declared price-extraction basis. */
export type PriceBasis = (typeof PRICE_BASES)[number];

/** Guard: a declared price-extraction basis. */
export const isPriceBasis = (v: unknown): v is PriceBasis => isMemberOf(PRICE_BASES, v);

// ---------------------------------------------------------------------------
// Structured parameters per kind (enumerated — no implicit constants)
// ---------------------------------------------------------------------------

/**
 * Regime-classification parameters: how a window of market-event
 * observations becomes a regime label. Every threshold, every window
 * boundary and the CLOSED TAXONOMY itself are declared here — a regime
 * label that is not one of these declared labels, or a label inconsistent
 * with the declared decision function over the carried statistics, is a
 * typed error (the closed-taxonomy law).
 *
 * The declared decision semantics (v1, `decisionOrder:
 * 'trend-then-volatility'`), over the window's price series p_0..p_n at
 * the declared output scale/rounding:
 *   netMoveRatio          = (p_n - p_0) / p_0            (signed, |.| for the test)
 *   meanAbsChangeRatio    = mean(|p_i - p_(i-1)|) / p_0  (unsigned)
 *   1. |netMoveRatio| >= trendThreshold    -> trending-up / trending-down (by sign)
 *   2. else meanAbsChangeRatio >= volatileThreshold -> volatile
 *   3. else meanAbsChangeRatio <= quietThreshold     -> quiet
 *   4. else                                -> ranging
 */
export interface RegimeClassificationParameters {
  readonly kind: 'regime-classification';
  readonly input: 'market-event-observations';
  /** The declared clustering basis: knowledge-time (L4-honest). */
  readonly windowBasis: 'available-time';
  /** The declared analysis window width, in epoch milliseconds. */
  readonly windowMs: number;
  /** Minimum price-yielding observations inside one window to classify it. */
  readonly minObservations: number;
  /** The declared price extraction over the event kinds (closed vocabulary). */
  readonly priceBasis: PriceBasis;
  /** The declared fixed decimal scale of every output statistic. */
  readonly outputScale: number;
  /** The declared rounding mode for scaled arithmetic. */
  readonly rounding: 'half-even' | 'truncate';
  /** The CLOSED regime taxonomy — the labels this method may emit. */
  readonly regimes: readonly string[];
  /** Net-move ratio at/above which a window is trending (unsigned decimal). */
  readonly trendThreshold: string;
  /** Mean absolute successive-change ratio at/above which a window is volatile. */
  readonly volatileThreshold: string;
  /** Mean absolute successive-change ratio at/below which a window is quiet. */
  readonly quietThreshold: string;
  /** The declared decision precedence (closed vocabulary). */
  readonly decisionOrder: 'trend-then-volatility';
}

/** Regime-change-detection parameters: how consecutive classifications become transitions. */
export interface RegimeChangeDetectionParameters {
  readonly kind: 'regime-change-detection';
  readonly input: 'research-records';
  /** The declared transition basis (closed: consecutive window labels). */
  readonly basis: 'consecutive-window-label-transition';
  /**
   * The classification method whose taxonomy the transition labels belong
   * to (the declared link between the two methods — resolved against the
   * registry at validation time).
   */
  readonly classificationMethod: string;
}

/** Confidence-estimation parameters: how confidence levels are derived. */
export interface RegimeConfidenceParameters {
  readonly kind: 'confidence-estimation';
  readonly input: 'research-records';
  /** The declared basis (closed: evidence count + dispersion). */
  readonly basis: 'evidence-count-and-dispersion';
  /** The 'high' band: minimum evidence count AND maximum dispersion. */
  readonly high: { readonly minEvidence: number; readonly maxDispersion: string };
  /** The 'moderate' band: minimum evidence count AND maximum dispersion. */
  readonly moderate: { readonly minEvidence: number; readonly maxDispersion: string };
}

/** Report-composition parameters: how outputs become one publication. */
export interface RegimeReportCompositionParameters {
  readonly kind: 'report-composition';
  readonly input: 'research-records';
  /** Enumerated summary fields only — free-text conclusions are unlawful. */
  readonly summary: 'enumerated-fields-only';
  /** The canonical output ordering (deterministic bytes). */
  readonly canonicalOrder: 'window-order';
  /** The declared scale of the summary's exact aggregate statistics. */
  readonly outputScale: number;
  /** The declared rounding mode of the summary's exact statistics. */
  readonly rounding: 'half-even' | 'truncate';
}

/** The union of declared parameter shapes. */
export type RegimeMethodParameters =
  | RegimeClassificationParameters
  | RegimeChangeDetectionParameters
  | RegimeConfidenceParameters
  | RegimeReportCompositionParameters;

// ---------------------------------------------------------------------------
// RegimeMethodRecord + registry
// ---------------------------------------------------------------------------

/**
 * A DECLARED METHOD: the versioned, structured record that every research
 * output must cite. A method that is not one of these is a magic label,
 * and a magic label fails validation (the method-honesty law).
 */
export interface RegimeMethodRecord {
  /** Method identity (e.g. `method/regime/classification`). */
  readonly methodId: RegimeMethodId;
  /** What the method is for. */
  readonly kind: RegimeMethodKind;
  /** The method's own version (strict X.Y.Z). */
  readonly version: RegimeMethodVersionRef;
  /** The declared, enumerated parameters. */
  readonly parameters: RegimeMethodParameters;
  /** Identity of the declaring authority (person, service or pipeline). */
  readonly declaredBy: string;
  /** When the method was declared (explicit literal instant — no clock). */
  readonly declaredAt: number;
}

/** The frozen method registry: the closed set a body may run. */
export interface RegimeMethodRegistry {
  /** The declared methods, canonically ordered by canonical JSON form. */
  readonly methods: readonly RegimeMethodRecord[];
  /** The registry identity: a stable digest over the canonical form (L9). */
  readonly digest: string;
}

// -- parameter guards -------------------------------------------------------

function parametersProblems(path: string, v: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(v)) return [`${path}: must be an object`];
  const kind = v.kind;
  if (!isRegimeMethodKind(kind)) return [`${path}.kind: must be one of ${REGIME_METHOD_KINDS.join('|')}`];
  const input = v.input;
  if (!isRegimeMethodInput(input)) return [`${path}.input: must be one of ${REGIME_METHOD_INPUTS.join('|')}`];
  if (kind === 'regime-classification') {
    if (input !== 'market-event-observations') {
      problems.push(`${path}.input: regime classification consumes market-event-observations`);
    }
    if (v.windowBasis !== 'available-time') {
      problems.push(`${path}.windowBasis: must be 'available-time' (L4 — knowledge-time windows)`);
    }
    if (!isPositiveInteger(v.windowMs)) problems.push(`${path}.windowMs: must be a positive integer`);
    if (!isPositiveInteger(v.minObservations) || (v.minObservations as number) < 2) {
      problems.push(`${path}.minObservations: must be an integer >= 2 (a change needs two prices)`);
    }
    if (!isPriceBasis(v.priceBasis)) {
      problems.push(`${path}.priceBasis: must be one of ${PRICE_BASES.join('|')}`);
    }
    if (!isPositiveInteger(v.outputScale) || (v.outputScale as number) > 8) {
      problems.push(`${path}.outputScale: must be an integer in [1, 8]`);
    }
    if (v.rounding !== 'half-even' && v.rounding !== 'truncate') {
      problems.push(`${path}.rounding: must be 'half-even' or 'truncate'`);
    }
    if (!isArrayOf(v.regimes, isNonEmptyString) || (v.regimes as readonly unknown[]).length === 0) {
      problems.push(`${path}.regimes: must be a non-empty array of declared regime labels (the closed taxonomy)`);
    } else {
      const regimes = v.regimes as readonly string[];
      if (duplicatesOf(regimes).length > 0) {
        problems.push(`${path}.regimes: labels must be unique`);
      }
      for (const label of DERIVABLE_REGIME_LABELS) {
        if (!regimes.includes(label)) {
          problems.push(
            `${path}.regimes: the declared taxonomy must cover the decision function's derivable label ${JSON.stringify(label)} (the closed-taxonomy law)`,
          );
        }
      }
    }
    if (!isPositiveDecimal(v.trendThreshold)) {
      problems.push(`${path}.trendThreshold: must be a positive decimal string`);
    }
    if (!isUnsignedDecimal(v.volatileThreshold)) {
      problems.push(`${path}.volatileThreshold: must be an unsigned decimal string`);
    }
    if (!isUnsignedDecimal(v.quietThreshold)) {
      problems.push(`${path}.quietThreshold: must be an unsigned decimal string`);
    } else if (isUnsignedDecimal(v.volatileThreshold)) {
      if (compareDecimal(v.quietThreshold as string, v.volatileThreshold as string) === 1) {
        problems.push(`${path}.quietThreshold: must not exceed volatileThreshold (quiet must be reachable)`);
      }
    }
    if (v.decisionOrder !== 'trend-then-volatility') {
      problems.push(`${path}.decisionOrder: must be 'trend-then-volatility'`);
    }
  } else if (kind === 'regime-change-detection') {
    if (input !== 'research-records') {
      problems.push(`${path}.input: change detection runs over research-records`);
    }
    if (v.basis !== 'consecutive-window-label-transition') {
      problems.push(`${path}.basis: must be 'consecutive-window-label-transition'`);
    }
    if (!isNonEmptyString(v.classificationMethod)) {
      problems.push(`${path}.classificationMethod: must cite the classification method whose taxonomy the labels belong to`);
    }
  } else if (kind === 'confidence-estimation') {
    if (input !== 'research-records') {
      problems.push(`${path}.input: confidence estimation runs over research-records`);
    }
    if (v.basis !== 'evidence-count-and-dispersion') {
      problems.push(`${path}.basis: must be 'evidence-count-and-dispersion'`);
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
    if (v.canonicalOrder !== 'window-order') {
      problems.push(`${path}.canonicalOrder: must be 'window-order'`);
    }
    if (!isPositiveInteger(v.outputScale) || (v.outputScale as number) > 8) {
      problems.push(`${path}.outputScale: must be an integer in [1, 8]`);
    }
    if (v.rounding !== 'half-even' && v.rounding !== 'truncate') {
      problems.push(`${path}.rounding: must be 'half-even' or 'truncate'`);
    }
  }
  return problems;
}

/** Guard: `RegimeMethodRecord` (total — untrusted input never throws). */
export function isRegimeMethodRecord(v: unknown): v is RegimeMethodRecord {
  if (!isRecord(v)) return false;
  return (
    isRegimeMethodId(v.methodId) &&
    isRegimeMethodKind(v.kind) &&
    isRegimeMethodVersionRef(v.version) &&
    isRecord(v.parameters) &&
    parametersProblems('parameters', v.parameters).length === 0 &&
    isNonEmptyString(v.declaredBy) &&
    isNonNegativeInteger(v.declaredAt)
  );
}

/** COLLECT-ALL validation of a method record. */
export function validateRegimeMethodRecord(v: unknown, path = ''): readonly RegimeError[] {
  const errors: RegimeError[] = [];
  if (!isRecord(v)) {
    return [invalidType(path || 'method', 'a method record object')];
  }
  if (!isRegimeMethodId(v.methodId)) errors.push(invalidField(`${path}methodId`, 'must be a non-empty opaque method reference'));
  if (!isRegimeMethodKind(v.kind)) errors.push(invalidField(`${path}kind`, `must be one of ${REGIME_METHOD_KINDS.join('|')}`));
  if (!isRegimeMethodVersionRef(v.version)) errors.push(invalidField(`${path}version`, 'must be a strict X.Y.Z version'));
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
export function createRegimeMethodRecord(draft: unknown): RegimeResult<RegimeMethodRecord> {
  const errors = validateRegimeMethodRecord(draft);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: deepFreeze({ ...(draft as RegimeMethodRecord) }) };
}

/** COLLECT-ALL validation of a whole registry draft. */
export function validateRegimeMethodRegistry(v: unknown): readonly RegimeError[] {
  const errors: RegimeError[] = [];
  if (!isRecord(v) || !Array.isArray(v.methods)) {
    return [invalidType('registry', 'a method registry object with a methods array')];
  }
  const methods = v.methods as readonly unknown[];
  if (methods.length === 0) {
    errors.push({ code: 'method_registry_empty', path: 'methods', message: 'a method registry must declare at least one method' });
  }
  const seen = new Set<string>();
  methods.forEach((method: unknown, index: number) => {
    for (const error of validateRegimeMethodRecord(method, `methods[${index}].`)) errors.push(error);
    if (isRecord(method) && isRegimeMethodId(method.methodId)) {
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
export function createRegimeMethodRegistry(methods: readonly unknown[]): RegimeResult<RegimeMethodRegistry> {
  const errors = validateRegimeMethodRegistry({ methods });
  if (errors.length > 0) return { ok: false, errors };
  const records = (methods as readonly RegimeMethodRecord[]).slice();
  records.sort((a, b) => (canonicalJson(a as never) < canonicalJson(b as never) ? -1 : 1));
  const digest = stableDigestJson({ methods: records } as never);
  return { ok: true, value: deepFreeze({ methods: records, digest }) };
}

/** Looks a method up by id; `null` when undeclared. */
export function findRegimeMethod(registry: RegimeMethodRegistry, methodId: string): RegimeMethodRecord | null {
  for (const method of registry.methods) {
    if (method.methodId === methodId) return method;
  }
  return null;
}

/** Resolves a (methodId, version) citation; typed errors on drift. */
export function resolveRegimeMethodCitation(
  registry: RegimeMethodRegistry,
  methodId: unknown,
  version: unknown,
  expectedKind: RegimeMethodKind,
): readonly RegimeError[] {
  const errors: RegimeError[] = [];
  if (!isRegimeMethodId(methodId)) {
    return [invalidField('methodId', 'must match the compact identifier pattern')];
  }
  if (!isRegimeMethodVersionRef(version)) {
    errors.push(invalidField('methodVersion', 'must be a strict X.Y.Z version'));
  }
  const method = findRegimeMethod(registry, methodId);
  if (method === null) {
    errors.push({
      code: 'undeclared_method',
      path: 'methodId',
      message: `method ${JSON.stringify(methodId)} is not declared in the method registry — a regime label without a declared method is a magic label, not a classification`,
    });
    return errors;
  }
  if (isRegimeMethodVersionRef(version) && method.version !== version) {
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

/** Guard: `RegimeMethodRegistry`. */
export function isRegimeMethodRegistry(v: unknown): v is RegimeMethodRegistry {
  if (!isRecord(v)) return false;
  if (!isArrayOf(v.methods, isRegimeMethodRecord)) return false;
  if (!isDigest(v.digest)) return false;
  return stableDigestJson({ methods: v.methods } as never) === v.digest;
}

/** Validation wrapper: `RegimeMethodRegistry`. */
export function validateRegimeMethodRegistryRecord(v: unknown): RegimeValidation<RegimeMethodRegistry> {
  const errors = validateRegimeMethodRegistry(v);
  if (errors.length > 0) return validationOf(null, errors) as unknown as RegimeValidation<RegimeMethodRegistry>;
  if (isRecord(v) && !isRegimeMethodRegistry(v)) {
    return validationOf(null, [
      invalidField('digest', 'the registry digest does not match its canonical form'),
    ]) as unknown as RegimeValidation<RegimeMethodRegistry>;
  }
  return validationOf(v as RegimeMethodRegistry, []);
}

// ---------------------------------------------------------------------------
// The canonical declared method set (the methods the regime researcher
// body runs — the closed registry this package ships)
// ---------------------------------------------------------------------------

/**
 * The canonical method registry for the market-regime researcher body:
 * one declared method per pipeline stage, each with fully enumerated
 * parameters. `declaredAt` instants are explicit literals (no clock).
 */
export const REGIME_METHOD_REGISTRY: RegimeMethodRegistry = (() => {
  const construction = createRegimeMethodRegistry([
    {
      methodId: 'method/regime/classification',
      kind: 'regime-classification',
      version: '1.0.0',
      parameters: {
        kind: 'regime-classification',
        input: 'market-event-observations',
        windowBasis: 'available-time',
        windowMs: 10_000,
        minObservations: 4,
        priceBasis: 'trade-price-or-quote-mid-or-book-best',
        outputScale: 4,
        rounding: 'half-even',
        regimes: ['trending-up', 'trending-down', 'ranging', 'volatile', 'quiet'],
        trendThreshold: '0.0300',
        volatileThreshold: '0.0100',
        quietThreshold: '0.0010',
        decisionOrder: 'trend-then-volatility',
      },
      declaredBy: 'tradrl-research-declaration/1',
      declaredAt: 1_780_000_000_000,
    },
    {
      methodId: 'method/regime/change-detection',
      kind: 'regime-change-detection',
      version: '1.0.0',
      parameters: {
        kind: 'regime-change-detection',
        input: 'research-records',
        basis: 'consecutive-window-label-transition',
        classificationMethod: 'method/regime/classification',
      },
      declaredBy: 'tradrl-research-declaration/1',
      declaredAt: 1_780_000_000_000,
    },
    {
      methodId: 'method/regime/confidence',
      kind: 'confidence-estimation',
      version: '1.0.0',
      parameters: {
        kind: 'confidence-estimation',
        input: 'research-records',
        basis: 'evidence-count-and-dispersion',
        high: { minEvidence: 5, maxDispersion: '0.2000' },
        moderate: { minEvidence: 3, maxDispersion: '0.5000' },
      },
      declaredBy: 'tradrl-research-declaration/1',
      declaredAt: 1_780_000_000_000,
    },
    {
      methodId: 'method/regime/report-composition',
      kind: 'report-composition',
      version: '1.0.0',
      parameters: {
        kind: 'report-composition',
        input: 'research-records',
        summary: 'enumerated-fields-only',
        canonicalOrder: 'window-order',
        outputScale: 4,
        rounding: 'half-even',
      },
      declaredBy: 'tradrl-research-declaration/1',
      declaredAt: 1_780_000_000_000,
    },
  ]);
  if (!construction.ok) {
    throw new TypeError(
      `REGIME_METHOD_REGISTRY must construct: ${construction.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
    );
  }
  return construction.value;
})();

/** The declared classification method of the canonical registry. */
export const REGIME_CLASSIFICATION_METHOD: RegimeMethodRecord = REGIME_METHOD_REGISTRY.methods.find(
  (m) => m.methodId === 'method/regime/classification',
) as RegimeMethodRecord;

/** The declared change-detection method of the canonical registry. */
export const REGIME_CHANGE_DETECTION_METHOD: RegimeMethodRecord = REGIME_METHOD_REGISTRY.methods.find(
  (m) => m.methodId === 'method/regime/change-detection',
) as RegimeMethodRecord;

/** The declared confidence method of the canonical registry. */
export const REGIME_CONFIDENCE_METHOD: RegimeMethodRecord = REGIME_METHOD_REGISTRY.methods.find(
  (m) => m.methodId === 'method/regime/confidence',
) as RegimeMethodRecord;

/** The declared report-composition method of the canonical registry. */
export const REGIME_REPORT_COMPOSITION_METHOD: RegimeMethodRecord =
  REGIME_METHOD_REGISTRY.methods.find((m) => m.methodId === 'method/regime/report-composition') as RegimeMethodRecord;
