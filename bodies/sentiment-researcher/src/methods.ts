// @tradrl/body-sentiment-researcher — the DECLARED-METHOD discipline.
//
// Owning Work Order: T021, section 3 ("Method honesty"):
//   "sentiment readings are DECLARED-METHOD outputs (versioned method
//    records — e.g. declared aggregation over sentiment-score
//    observations); a 'sentiment' that is an undeclared magic number
//    fails (negative test). Confidence/uncertainty fields are
//    declared-method records, never naked guesses."
//
// A MethodRecord is a versioned, structured, deeply-frozen declaration of
// HOW a research output is computed: its kind, its declared input class,
// its enumerated parameters (thresholds, scales, rounding modes — every
// knob is a declared field, never an implicit constant). The registry is
// the closed set a body may run; every output cites (methodId,
// methodVersion) and validation re-resolves the citation against the
// registry — an output citing an unknown method id, a stale version, or a
// method of the wrong kind is a TYPED ERROR, not a warning.
//
// Laws held here: zero runtime deps; no `any`; total hand-rolled guards;
// no ambient clock (`declaredAt` is an explicit literal instant);
// deepFreeze everything public; deterministic registry digest (L9 — the
// registry identity binds into every output's lineage).

import { deepFreeze, isNonEmptyString, isNonNegativeInteger, isPositiveInteger, isRecord, isMemberOf, isArrayOf, canonicalJson, stableDigestJson, isDigest } from './primitives';
import { type MethodId, type MethodVersionRef, isMethodId, isMethodVersionRef } from './ids';
import { type ResearchError, type ResearchResult, type ResearchValidation, invalidField, invalidType, missingField, validationOf } from './errors';
import { isSignedDecimal, isUnsignedDecimal } from './decimals';

// ---------------------------------------------------------------------------
// The declared event taxonomy (shared with the digest records)
// ---------------------------------------------------------------------------

/** The declared event taxonomy (closed vocabulary). */
export const EVENT_KINDS = [
  'earnings-announcement',
  'guidance-change',
  'regulatory-action',
  'product-announcement',
  'partnership',
  'security-incident',
  'macro-release',
  'sentiment-spike',
  'supply-disruption',
  'coverage-burst',
] as const;

/** A declared event kind. */
export type EventKind = (typeof EVENT_KINDS)[number];

/** Guard: a declared event kind. */
export const isEventKind = (v: unknown): v is EventKind => isMemberOf(EVENT_KINDS, v);

function isEventKindDeclared(v: unknown): boolean {
  return typeof v === 'string' && (EVENT_KINDS as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// The closed method-kind vocabulary
// ---------------------------------------------------------------------------

/** What a declared method is FOR. Closed vocabulary. */
export const METHOD_KINDS = [
  'aggregation',
  'event-detection',
  'confidence-estimation',
  'report-composition',
] as const;

/** A declared method kind. */
export type MethodKind = (typeof METHOD_KINDS)[number];

/** Guard: a method kind. */
export const isMethodKind = (v: unknown): v is MethodKind => isMemberOf(METHOD_KINDS, v);

/** The declared input classes (closed vocabulary). */
export const METHOD_INPUTS = [
  'sentiment-score-observations',
  'news-observations',
  'research-records',
] as const;

/** A declared method input class. */
export type MethodInput = (typeof METHOD_INPUTS)[number];

/** Guard: a declared input class. */
export const isMethodInput = (v: unknown): v is MethodInput => isMemberOf(METHOD_INPUTS, v);

// ---------------------------------------------------------------------------
// Structured parameters per kind (enumerated — no implicit constants)
// ---------------------------------------------------------------------------

/**
 * Aggregation parameters: how sentiment-score observations become a
 * polarity/intensity reading. Every threshold and scale is declared here.
 */
export interface AggregationParameters {
  readonly kind: 'aggregation';
  readonly input: 'sentiment-score-observations';
  /** Declared weighting scheme (v1 declares equal weighting only). */
  readonly weighting: 'equal';
  /** The declared fixed decimal scale of every output score. */
  readonly outputScale: number;
  /** The declared rounding mode for scaled arithmetic. */
  readonly rounding: 'half-even' | 'truncate';
  /** Polarity direction thresholds (signed decimals, scale-free). */
  readonly polarityThresholds: { readonly positive: string; readonly negative: string };
  /** Intensity level thresholds (unsigned decimals, scale-free). */
  readonly intensityThresholds: { readonly moderate: string; readonly high: string };
  /**
   * Dispersion above which a near-zero mean is declared 'mixed' rather
   * than 'neutral' (an unsigned decimal, scale-free).
   */
  readonly mixedDispersion: string;
}

/** Event-detection parameters: how news observation clusters become digests. */
export interface EventDetectionParameters {
  readonly kind: 'event-detection';
  readonly input: 'news-observations';
  /** The declared clustering basis: knowledge-time (L4-honest). */
  readonly windowBasis: 'available-time';
  /** The declared clustering window width, in epoch milliseconds. */
  readonly windowMs: number;
  /** Minimum observations inside one window to declare an event. */
  readonly minObservations: number;
  /**
   * The DECLARED tag-to-kind table: how a cluster's event kind is chosen
   * deterministically. The first keyword-matched observation (in canonical
   * observation order) fixes the cluster's kind; clusters with no keyword
   * match are 'coverage-burst'. Free-form kind selection is unlawful.
   */
  readonly kindKeywords: readonly { readonly kind: string; readonly keyword: string }[];
}

/** Confidence-estimation parameters: how confidence levels are derived. */
export interface ConfidenceParameters {
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
export interface ReportCompositionParameters {
  readonly kind: 'report-composition';
  readonly input: 'research-records';
  /** Enumerated summary fields only — free-text conclusions are unlawful. */
  readonly summary: 'enumerated-fields-only';
  /** The canonical output ordering (deterministic bytes). */
  readonly canonicalOrder: 'observation-order';
}

/** The union of declared parameter shapes. */
export type MethodParameters =
  | AggregationParameters
  | EventDetectionParameters
  | ConfidenceParameters
  | ReportCompositionParameters;

// ---------------------------------------------------------------------------
// MethodRecord + registry
// ---------------------------------------------------------------------------

/**
 * A DECLARED METHOD: the versioned, structured record that every research
 * output must cite. A method that is not one of these is a magic number,
 * and a magic number fails validation (the method-honesty law).
 */
export interface MethodRecord {
  /** Method identity (e.g. `method/sentiment/aggregation`). */
  readonly methodId: MethodId;
  /** What the method is for. */
  readonly kind: MethodKind;
  /** The method's own version (strict X.Y.Z). */
  readonly version: MethodVersionRef;
  /** The declared, enumerated parameters. */
  readonly parameters: MethodParameters;
  /** Identity of the declaring authority (person, service or pipeline). */
  readonly declaredBy: string;
  /** When the method was declared (explicit literal instant — no clock). */
  readonly declaredAt: number;
}

/** The frozen method registry: the closed set a body may run. */
export interface MethodRegistry {
  /** The declared methods, canonically ordered by method id. */
  readonly methods: readonly MethodRecord[];
  /** The registry identity: a stable digest over the canonical form (L9). */
  readonly digest: string;
}

// -- parameter guards -------------------------------------------------------

function parametersProblems(path: string, v: unknown): string[] {
  const problems: string[] = [];
  if (!isRecord(v)) return [`${path}: must be an object`];
  const kind = v.kind;
  if (!isMethodKind(kind)) return [`${path}.kind: must be one of ${METHOD_KINDS.join('|')}`];
  const input = v.input;
  if (!isMethodInput(input)) return [`${path}.input: must be one of ${METHOD_INPUTS.join('|')}`];
  if (kind === 'aggregation') {
    if (input !== 'sentiment-score-observations') {
      problems.push(`${path}.input: aggregation methods aggregate sentiment-score-observations`);
    }
    if (v.weighting !== 'equal') problems.push(`${path}.weighting: v1 declares 'equal' only`);
    if (!isPositiveInteger(v.outputScale) || (v.outputScale as number) > 8) {
      problems.push(`${path}.outputScale: must be an integer in [1, 8]`);
    }
    if (v.rounding !== 'half-even' && v.rounding !== 'truncate') {
      problems.push(`${path}.rounding: must be 'half-even' or 'truncate'`);
    }
    const thresholds = v.polarityThresholds;
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
    const intensity = v.intensityThresholds;
    if (
      !isRecord(intensity) ||
      !isUnsignedDecimal(intensity.moderate) ||
      !isUnsignedDecimal(intensity.high)
    ) {
      problems.push(`${path}.intensityThresholds: must be { moderate, high } unsigned decimals`);
    }
    if (!isUnsignedDecimal(v.mixedDispersion)) {
      problems.push(`${path}.mixedDispersion: must be an unsigned decimal`);
    }
  } else if (kind === 'event-detection') {
    if (input !== 'news-observations') {
      problems.push(`${path}.input: event detection consumes news-observations`);
    }
    if (v.windowBasis !== 'available-time') {
      problems.push(`${path}.windowBasis: must be 'available-time' (L4 — knowledge-time clustering)`);
    }
    if (!isPositiveInteger(v.windowMs)) problems.push(`${path}.windowMs: must be a positive integer`);
    if (!isPositiveInteger(v.minObservations)) {
      problems.push(`${path}.minObservations: must be a positive integer`);
    }
    if (!isArrayOf(v.kindKeywords, isRecord)) {
      problems.push(`${path}.kindKeywords: must be an array of { kind, keyword } declarations`);
    } else {
      const keywords = v.kindKeywords as readonly Record<string, unknown>[];
      const seenKeywords = new Set<string>();
      for (const entry of keywords) {
        if (!isNonEmptyString(entry.kind) || !isEventKindDeclared(entry.kind)) {
          problems.push(`${path}.kindKeywords: kind ${JSON.stringify(entry.kind)} is outside the declared event taxonomy`);
        }
        if (!isNonEmptyString(entry.keyword)) {
          problems.push(`${path}.kindKeywords: keyword must be a non-empty string`);
        }
        if (typeof entry.keyword === 'string') {
          if (seenKeywords.has(entry.keyword)) {
            problems.push(`${path}.kindKeywords: duplicate keyword ${JSON.stringify(entry.keyword)}`);
          }
          seenKeywords.add(entry.keyword);
        }
      }
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
    if (v.canonicalOrder !== 'observation-order') {
      problems.push(`${path}.canonicalOrder: must be 'observation-order'`);
    }
  }
  return problems;
}

/** Guard: `MethodRecord` (total — untrusted input never throws). */
export function isMethodRecord(v: unknown): v is MethodRecord {
  if (!isRecord(v)) return false;
  return (
    isMethodId(v.methodId) &&
    isMethodKind(v.kind) &&
    isMethodVersionRef(v.version) &&
    isRecord(v.parameters) &&
    parametersProblems('parameters', v.parameters).length === 0 &&
    isNonEmptyString(v.declaredBy) &&
    isNonNegativeInteger(v.declaredAt)
  );
}

/** COLLECT-ALL validation of a method record. */
export function validateMethodRecord(v: unknown, path = ''): readonly ResearchError[] {
  const errors: ResearchError[] = [];
  if (!isRecord(v)) {
    return [invalidType(path || 'method', 'a method record object')];
  }
  if (!isMethodId(v.methodId)) errors.push(invalidField(`${path}methodId`, 'must be a non-empty opaque method reference'));
  if (!isMethodKind(v.kind)) errors.push(invalidField(`${path}kind`, `must be one of ${METHOD_KINDS.join('|')}`));
  if (!isMethodVersionRef(v.version)) errors.push(invalidField(`${path}version`, 'must be a strict X.Y.Z version'));
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
export function createMethodRecord(draft: unknown): ResearchResult<MethodRecord> {
  const errors = validateMethodRecord(draft);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: deepFreeze({ ...(draft as MethodRecord) }) };
}

/** COLLECT-ALL validation of a whole registry draft. */
export function validateMethodRegistry(v: unknown): readonly ResearchError[] {
  const errors: ResearchError[] = [];
  if (!isRecord(v) || !Array.isArray(v.methods)) {
    return [invalidType('registry', 'a method registry object with a methods array')];
  }
  const methods = v.methods as readonly unknown[];
  if (methods.length === 0) {
    errors.push({ code: 'method_registry_empty', path: 'methods', message: 'a method registry must declare at least one method' });
  }
  const seen = new Set<string>();
  methods.forEach((method: unknown, index: number) => {
    for (const error of validateMethodRecord(method, `methods[${index}].`)) errors.push(error);
    if (isRecord(method) && isMethodId(method.methodId)) {
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
export function createMethodRegistry(methods: readonly unknown[]): ResearchResult<MethodRegistry> {
  const errors = validateMethodRegistry({ methods });
  if (errors.length > 0) return { ok: false, errors };
  const records = (methods as readonly MethodRecord[]).slice();
  records.sort((a, b) => (canonicalJson(a as never) < canonicalJson(b as never) ? -1 : 1));
  const digest = stableDigestJson({ methods: records } as never);
  return { ok: true, value: deepFreeze({ methods: records, digest }) };
}

/** Looks a method up by id; `null` when undeclared. */
export function findMethod(registry: MethodRegistry, methodId: string): MethodRecord | null {
  for (const method of registry.methods) {
    if (method.methodId === methodId) return method;
  }
  return null;
}

/** Resolves a (methodId, version) citation; typed errors on drift. */
export function resolveMethodCitation(
  registry: MethodRegistry,
  methodId: unknown,
  version: unknown,
  expectedKind: MethodKind,
): readonly ResearchError[] {
  const errors: ResearchError[] = [];
  if (!isMethodId(methodId)) {
    return [invalidField('methodId', 'must match the compact identifier pattern')];
  }
  if (!isMethodVersionRef(version)) {
    errors.push(invalidField('methodVersion', 'must be a strict X.Y.Z version'));
  }
  const method = findMethod(registry, methodId);
  if (method === null) {
    errors.push({
      code: 'undeclared_method',
      path: 'methodId',
      message: `method ${JSON.stringify(methodId)} is not declared in the method registry — a sentiment value without a declared method is a magic number, not a reading`,
    });
    return errors;
  }
  if (isMethodVersionRef(version) && method.version !== version) {
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

/** Guard: `MethodRegistry`. */
export function isMethodRegistry(v: unknown): v is MethodRegistry {
  if (!isRecord(v)) return false;
  if (!isArrayOf(v.methods, isMethodRecord)) return false;
  if (!isDigest(v.digest)) return false;
  return stableDigestJson({ methods: v.methods } as never) === v.digest;
}

/** Validation wrapper: `MethodRegistry`. */
export function validateMethodRegistryRecord(v: unknown): ResearchValidation<MethodRegistry> {
  const errors = validateMethodRegistry(v);
  if (errors.length > 0) return validationOf(null, errors) as unknown as ResearchValidation<MethodRegistry>;
  if (isRecord(v) && !isMethodRegistry(v)) {
    return validationOf(null, [
      invalidField('digest', 'the registry digest does not match its canonical form'),
    ]) as unknown as ResearchValidation<MethodRegistry>;
  }
  return validationOf(v as MethodRegistry, []);
}

// ---------------------------------------------------------------------------
// The canonical declared method set (the methods the sentiment researcher
// body runs — the closed registry this package ships)
// ---------------------------------------------------------------------------

/**
 * The canonical method registry for the sentiment/event researcher body:
 * one declared method per pipeline stage, each with fully enumerated
 * parameters. `declaredAt` instants are explicit literals (no clock).
 */
export const SENTIMENT_METHOD_REGISTRY: MethodRegistry = (() => {
  const construction = createMethodRegistry([
    {
      methodId: 'method/sentiment/aggregation',
      kind: 'aggregation',
      version: '1.0.0',
      parameters: {
        kind: 'aggregation',
        input: 'sentiment-score-observations',
        weighting: 'equal',
        outputScale: 4,
        rounding: 'half-even',
        polarityThresholds: { positive: '0.05', negative: '-0.05' },
        intensityThresholds: { moderate: '0.2', high: '0.5' },
        mixedDispersion: '0.5',
      },
      declaredBy: 'tradrl-research-declaration/1',
      declaredAt: 1_780_000_000_000,
    },
    {
      methodId: 'method/sentiment/event-detection',
      kind: 'event-detection',
      version: '1.0.0',
      parameters: {
        kind: 'event-detection',
        input: 'news-observations',
        windowBasis: 'available-time',
        windowMs: 3_600_000,
        minObservations: 3,
        kindKeywords: [
          { kind: 'earnings-announcement', keyword: 'earnings' },
          { kind: 'guidance-change', keyword: 'guidance' },
          { kind: 'regulatory-action', keyword: 'regulatory' },
          { kind: 'product-announcement', keyword: 'product' },
          { kind: 'partnership', keyword: 'partnership' },
          { kind: 'security-incident', keyword: 'security' },
          { kind: 'macro-release', keyword: 'macro' },
          { kind: 'sentiment-spike', keyword: 'sentiment' },
          { kind: 'supply-disruption', keyword: 'supply' },
        ],
      },
      declaredBy: 'tradrl-research-declaration/1',
      declaredAt: 1_780_000_000_000,
    },
    {
      methodId: 'method/sentiment/confidence',
      kind: 'confidence-estimation',
      version: '1.0.0',
      parameters: {
        kind: 'confidence-estimation',
        input: 'research-records',
        basis: 'evidence-count-and-dispersion',
        high: { minEvidence: 5, maxDispersion: '0.25' },
        moderate: { minEvidence: 3, maxDispersion: '0.5' },
      },
      declaredBy: 'tradrl-research-declaration/1',
      declaredAt: 1_780_000_000_000,
    },
    {
      methodId: 'method/sentiment/report-composition',
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
      `SENTIMENT_METHOD_REGISTRY must construct: ${construction.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
    );
  }
  return construction.value;
})();

/** The declared aggregation method of the canonical registry. */
export const SENTIMENT_AGGREGATION_METHOD: MethodRecord = SENTIMENT_METHOD_REGISTRY.methods.find(
  (m) => m.methodId === 'method/sentiment/aggregation',
) as MethodRecord;

/** The declared event-detection method of the canonical registry. */
export const SENTIMENT_EVENT_DETECTION_METHOD: MethodRecord = SENTIMENT_METHOD_REGISTRY.methods.find(
  (m) => m.methodId === 'method/sentiment/event-detection',
) as MethodRecord;

/** The declared confidence method of the canonical registry. */
export const SENTIMENT_CONFIDENCE_METHOD: MethodRecord = SENTIMENT_METHOD_REGISTRY.methods.find(
  (m) => m.methodId === 'method/sentiment/confidence',
) as MethodRecord;

/** The declared report-composition method of the canonical registry. */
export const SENTIMENT_REPORT_COMPOSITION_METHOD: MethodRecord =
  SENTIMENT_METHOD_REGISTRY.methods.find((m) => m.methodId === 'method/sentiment/report-composition') as MethodRecord;
