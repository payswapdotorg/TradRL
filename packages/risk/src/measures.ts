// @tradrl/risk — the RiskMeasureRecord: the L7-compliant measure records.
//
// THE L7 EXISTENTIAL LAW (the Work Order: "the engine computes and
// records RISK MEASURES (exposure, concentration, drawdown, leverage,
// VaR-shaped opaque refs...) as DATA — it never converts a risk figure
// into an acceptance verdict by itself; risk-adjusted figures are
// opaque refs to evaluation, never the sole criterion. ... VaR-shaped
// results as OPAQUE refs with declared method + version — never naked
// numbers pretending to be acceptance"):
//
//   - The EXPOSURE measure ({@link exposureMeasureOf}) wraps one
//     measured exposure — quantities, notionals, gross/net, equity,
//     the high-water mark and the drawdown, all exact decimals.
//   - The DRAWDOWN SERIES measure ({@link drawdownSeriesMeasure})
//     carries the equity/peak/drawdown series as exact-decimal records
//     (the drawdown tracking the Work Order names).
//   - The RISK-ADJUSTED measure ({@link riskAdjustedMeasure}) carries
//     the figure as an OPAQUE `rfig:` ref content-addressed over
//     { method, methodVersion, value } — the VALUE never appears in
//     the record. A record that smuggles a naked figure value fails
//     validation with the typed `acceptance_threshold_embedded` (a
//     naked number pretending to be an acceptance IS the L7 crime),
//     and the record must declare its method, version and limitation
//     (the L6-style honesty statement: what the figure models and what
//     it does not).
//
// The engine informs; evaluation (T012) decides — a risk-adjusted
// figure enters evaluation as ONE opaque input among the constraint
// set's criteria, never as the verdict.
//
// DETERMINISM (L9): every measure id is content-addressed (`rmr:` +
// digest of the canonical content); the same measured facts always
// produce the byte-identical record.
//
// Spec anchors: spec/ARCHITECTURE-LOCK.md L6, L7, L9, L12.

import { deepFreeze, isNonEmptyString, isPositiveSafeInteger, isRecord, isTimestampMs, type JsonValue, type TimestampMs } from './primitives';
import { canonicalJson, stableDigest } from './primitives';
import { isNonNegativeDecimalInput, isSignedCanonicalDecimal } from './decimals';
import type { ExposureRecordId, RiskFigureRef, RiskMeasureId } from './ids';
import { mintRiskFigureRef, mintRiskMeasureId } from './ids';
import type { ExposureRecord } from './exposure';
import { isExposureRecord } from './exposure';
import type { LimitEvaluationRecord, RiskLineage } from './limits';
import { isLimitEvaluationRecord, isRiskLineage } from './limits';
import { acceptanceViolations } from './policy';
import {
  type RiskError,
  type RiskResult,
  invalidField,
  invalidType,
  missingField,
  ok,
} from './errors';

// ---------------------------------------------------------------------------
// The drawdown series (exact-decimal records)
// ---------------------------------------------------------------------------

/** One point of the drawdown series: the instant, the equity, the running peak, the drawdown. */
export interface DrawdownPoint {
  readonly asOf: TimestampMs;
  /** Equity at the instant (signed canonical decimal). */
  readonly equity: string;
  /** The running high-water mark at the instant (signed canonical decimal). */
  readonly peakEquity: string;
  /** peakEquity - equity (non-negative canonical decimal). */
  readonly drawdown: string;
}

/** Guard: `DrawdownPoint`. */
export function isDrawdownPoint(v: unknown): v is DrawdownPoint {
  if (!isRecord(v)) return false;
  if (!isTimestampMs(v.asOf)) return false;
  if (!isSignedCanonicalDecimal(v.equity)) return false;
  if (!isSignedCanonicalDecimal(v.peakEquity)) return false;
  if (!isNonNegativeDecimalInput(v.drawdown)) return false;
  return true;
}

/** Guard: an ordered drawdown series (points ordered by asOf, strictly increasing). */
export function isDrawdownSeries(v: unknown): v is readonly DrawdownPoint[] {
  if (!Array.isArray(v) || !v.every((point) => isDrawdownPoint(point))) return false;
  for (let index = 1; index < v.length; index++) {
    const previous = v[index - 1] as DrawdownPoint;
    const current = v[index] as DrawdownPoint;
    if (current.asOf <= previous.asOf) return false; // strictly increasing instants
  }
  return true;
}

// ---------------------------------------------------------------------------
// The measure records
// ---------------------------------------------------------------------------

/** The measure-kind vocabulary: what this engine records as data. */
export type RiskMeasureKind = 'exposure' | 'drawdown_series' | 'risk_adjusted';

export const RISK_MEASURE_KINDS: readonly RiskMeasureKind[] = ['exposure', 'drawdown_series', 'risk_adjusted'] as const;

/** Guard: a measure kind. */
export function isRiskMeasureKind(v: unknown): v is RiskMeasureKind {
  return v === 'exposure' || v === 'drawdown_series' || v === 'risk_adjusted';
}

/**
 * One L7-compliant risk measure record — the discriminated union. The
 * `risk_adjusted` variant carries the figure as an OPAQUE ref only; a
 * record carrying a naked figure value under `value`/`figureValue`/
 * `result` fails validation with `acceptance_threshold_embedded`
 * (L7: a naked number pretending to be acceptance is the crime).
 */
export type RiskMeasureRecord =
  | {
      /** Content-addressed identity: `rmr:` + digest of the canonical content. */
      readonly measureId: RiskMeasureId;
      readonly kind: 'exposure';
      /** The measured exposure this record wraps. */
      readonly exposureRef: ExposureRecordId;
      readonly lineage: RiskLineage;
      readonly tenant: string;
      readonly project: string;
      readonly asOf: TimestampMs;
    }
  | {
      readonly measureId: RiskMeasureId;
      readonly kind: 'drawdown_series';
      /** The series' points, ordered by asOf (>= 1). */
      readonly entries: readonly DrawdownPoint[];
      readonly lineage: RiskLineage;
      readonly tenant: string;
      readonly project: string;
      readonly asOf: TimestampMs;
    }
  | {
      readonly measureId: RiskMeasureId;
      readonly kind: 'risk_adjusted';
      /** The figure family ('var', 'sharpe', ... — an opaque non-empty string). */
      readonly figureKind: string;
      /** The DECLARED method that computed the figure (e.g. 'historical-simulation'). */
      readonly method: string;
      /** The method's version (>= 1). */
      readonly methodVersion: number;
      /** The OPAQUE ref the figure's value travels as (L7 — the value never appears in the record). */
      readonly figureRef: RiskFigureRef;
      /** The declared limitation (what this figure does NOT model — the honesty statement). */
      readonly declaredLimitation: string;
      readonly lineage: RiskLineage;
      readonly tenant: string;
      readonly project: string;
      readonly asOf: TimestampMs;
    };

/** The naked-figure-value keys — a risk_adjusted record carrying any of these is the L7 crime. */
const NAKED_FIGURE_KEYS: readonly string[] = ['value', 'figureValue', 'result'] as const;

/** Guard: `RiskMeasureRecord` (total over the closed union; the L7 opacity laws included). */
export function isRiskMeasureRecord(v: unknown): v is RiskMeasureRecord {
  if (!isRecord(v)) return false;
  if (typeof v.measureId !== 'string' || !v.measureId.startsWith('rmr:')) return false;
  if (!isRiskMeasureKind(v.kind)) return false;
  if (!isRiskLineage(v.lineage)) return false;
  if (typeof v.tenant !== 'string' || v.tenant === '') return false;
  if (typeof v.project !== 'string' || v.project === '') return false;
  if (!isTimestampMs(v.asOf)) return false;
  switch (v.kind) {
    case 'exposure':
      if (typeof v.exposureRef !== 'string' || !v.exposureRef.startsWith('exp:')) return false;
      return true;
    case 'drawdown_series':
      return isDrawdownSeries(v.entries) && v.entries.length > 0;
    case 'risk_adjusted':
      if (!isNonEmptyString(v.figureKind)) return false;
      if (!isNonEmptyString(v.method)) return false;
      if (!isPositiveSafeInteger(v.methodVersion)) return false;
      if (typeof v.figureRef !== 'string' || !v.figureRef.startsWith('rfig:')) return false;
      if (!isNonEmptyString(v.declaredLimitation)) return false;
      // The L7 opacity trip wire (the guard half): no naked figure values.
      for (const key of NAKED_FIGURE_KEYS) {
        if (key in v) return false;
      }
      return true;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Content addressing (L9)
// ---------------------------------------------------------------------------

/** Distributive `Omit` (TS's built-in does not distribute over unions). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** The content of a measure record: each variant without its content-addressed `measureId` (distributive). */
export type RiskMeasureContent = DistributiveOmit<RiskMeasureRecord, 'measureId'>;

/** The canonical JSON tree of a measure record's CONTENT (everything except the content-addressed `measureId`). */
export function measureContentTree(record: RiskMeasureContent): JsonValue {
  const common = {
    lineage: {
      policy: { policyId: record.lineage.policy.policyId, version: record.lineage.policy.version },
      constraintSet: { id: record.lineage.constraintSet.id, version: record.lineage.constraintSet.version },
      goal: { goalId: record.lineage.goal.goalId, version: record.lineage.goal.version },
      portfolioState: record.lineage.portfolioState,
      marketState: record.lineage.marketState,
      seed: record.lineage.seed,
      tenant: record.lineage.tenant,
      project: record.lineage.project,
    },
    tenant: record.tenant,
    project: record.project,
    asOf: record.asOf,
  };
  switch (record.kind) {
    case 'exposure':
      return { kind: 'exposure', exposureRef: record.exposureRef, ...common };
    case 'drawdown_series':
      return {
        kind: 'drawdown_series',
        entries: record.entries.map((point) => ({ asOf: point.asOf, equity: point.equity, peakEquity: point.peakEquity, drawdown: point.drawdown })),
        ...common,
      };
    case 'risk_adjusted':
      return {
        kind: 'risk_adjusted',
        figureKind: record.figureKind,
        method: record.method,
        methodVersion: record.methodVersion,
        figureRef: record.figureRef,
        declaredLimitation: record.declaredLimitation,
        ...common,
      };
  }
}

/** The L9 anchor: the canonical JSON of a validated measure record. */
export function canonicalMeasureJson(record: RiskMeasureRecord): string {
  return canonicalJson(measureContentTree(record));
}

// ---------------------------------------------------------------------------
// The figure ref minting (the L7 bridge — the value stays behind the ref)
// ---------------------------------------------------------------------------

/**
 * Mint the OPAQUE figure ref: `rfig:` + digest of
 * `{ method, methodVersion, value }`. Pure and deterministic — the same
 * figure always mints the same ref (L9), and the ref's CONTENT is the
 * minting inputs (resolvable only by re-running the declared method;
 * never a naked number in a record). THIS is the only door a figure's
 * value takes out of the computing context.
 */
export function mintRiskFigure(method: string, methodVersion: number, value: string): RiskFigureRef {
  if (!isNonEmptyString(method)) throw new Error(`mintRiskFigure: invalid method ${JSON.stringify(method)}`);
  if (!isPositiveSafeInteger(methodVersion)) throw new Error(`mintRiskFigure: invalid method version ${String(methodVersion)}`);
  if (!isNonNegativeDecimalInput(value) && !isSignedCanonicalDecimal(value)) throw new Error(`mintRiskFigure: invalid figure value ${JSON.stringify(value)}`);
  return mintRiskFigureRef(stableDigest({ method, methodVersion, value }));
}

// ---------------------------------------------------------------------------
// The constructors (deterministic; content-addressed)
// ---------------------------------------------------------------------------

/**
 * Wrap one measured exposure as the exposure measure record. The
 * lineage comes from the evaluation that measured it (the full risk
 * lineage — policy version, constraint set, goal, states, seed,
 * tenant, project — L9/L12). Pure: the id is content-addressed.
 */
export function exposureMeasureOf(evaluation: LimitEvaluationRecord, exposure: ExposureRecord): RiskResult<RiskMeasureRecord> {
  if (!isLimitEvaluationRecord(evaluation)) {
    return { ok: false, errors: [invalidField('evaluation', 'exposureMeasureOf requires a validated limit evaluation')] };
  }
  if (!isExposureRecord(exposure)) {
    return { ok: false, errors: [invalidField('exposure', 'exposureMeasureOf requires a validated exposure record')] };
  }
  if (evaluation.exposureRef !== exposure.exposureId) {
    return { ok: false, errors: [{ code: 'lineage_gap', path: 'exposure', message: `the evaluation reasons over ${evaluation.exposureRef} but the exposure carries ${exposure.exposureId} — incoherent lineage is a lineage gap (L9)` }] };
  }
  if (evaluation.lineage.tenant !== exposure.lineage.tenant || evaluation.lineage.project !== exposure.lineage.project) {
    return { ok: false, errors: [{ code: 'tenant_missing', path: 'exposure', message: "the evaluation's scope and the exposure's lineage scope disagree (L12)" }] };
  }
  const payload: RiskMeasureContent = {
    kind: 'exposure',
    exposureRef: exposure.exposureId,
    lineage: evaluation.lineage,
    tenant: evaluation.lineage.tenant,
    project: evaluation.lineage.project,
    asOf: exposure.asOf,
  };
  return ok(deepFreeze({ ...payload, measureId: mintRiskMeasureId(stableDigest(measureContentTree(payload))) }) as RiskMeasureRecord);
}

/** The drawdown-series measure's input. */
export interface DrawdownSeriesInput {
  /** The series' points, ordered by asOf (>= 1). */
  readonly entries: readonly DrawdownPoint[];
  /** The full risk lineage (the evaluation's — L9/L12). */
  readonly lineage: RiskLineage;
  readonly asOf: TimestampMs;
}

/**
 * Build the drawdown-series measure record — the exact-decimal equity/
 * peak/drawdown series (the drawdown tracking). Validated: ordered
 * points, coherent lineage, L12 scope. Pure: the id is content-addressed.
 */
export function drawdownSeriesMeasure(input: DrawdownSeriesInput): RiskResult<RiskMeasureRecord> {
  if (!isRecord(input)) {
    return { ok: false, errors: [invalidType('drawdownSeriesMeasure requires an input object { entries, lineage, asOf }')] };
  }
  if (input.entries === undefined) {
    return { ok: false, errors: [missingField('entries')] };
  }
  if (!isDrawdownSeries(input.entries) || input.entries.length === 0) {
    return { ok: false, errors: [invalidField('entries', 'must be a non-empty drawdown series ordered by strictly increasing asOf')] };
  }
  if (input.lineage === undefined) {
    return { ok: false, errors: [{ code: 'lineage_gap', path: 'lineage', message: 'the measure carries its risk lineage (L9)' }] };
  }
  if (!isRiskLineage(input.lineage)) {
    return { ok: false, errors: [invalidField('lineage', 'must be the full risk lineage block (the evaluation\'s)')] };
  }
  if (!isTimestampMs(input.asOf)) {
    return { ok: false, errors: [invalidField('asOf', 'must be an epoch-ms record instant')] };
  }
  const payload: RiskMeasureContent = {
    kind: 'drawdown_series',
    entries: [...input.entries],
    lineage: input.lineage,
    tenant: input.lineage.tenant,
    project: input.lineage.project,
    asOf: input.asOf,
  };
  return ok(deepFreeze({ ...payload, measureId: mintRiskMeasureId(stableDigest(measureContentTree(payload))) }) as RiskMeasureRecord);
}

/** The risk-adjusted measure's input (the value crosses into the ref HERE — the only door). */
export interface RiskAdjustedInput {
  readonly figureKind: string;
  readonly method: string;
  readonly methodVersion: number;
  /** The computed figure value — minted into the OPAQUE ref; NEVER stored in the record (L7). */
  readonly value: string;
  /** What this figure does NOT model (non-empty — the honesty statement). */
  readonly declaredLimitation: string;
  readonly lineage: RiskLineage;
  readonly asOf: TimestampMs;
}

/**
 * Build the risk-adjusted measure record — the L7 law made structural:
 * the value is minted into the opaque `rfig:` ref
 * ({@link mintRiskFigure}) and appears NOWHERE in the record; the
 * method, its version and the declared limitation ride the record so
 * evaluation (T012) can decide whether — and how — to resolve the ref
 * as ONE criterion among the constraint set's criteria, never the
 * verdict. Pure: the id is content-addressed.
 */
export function riskAdjustedMeasure(input: RiskAdjustedInput): RiskResult<RiskMeasureRecord> {
  if (!isRecord(input)) {
    return { ok: false, errors: [invalidType('riskAdjustedMeasure requires an input object { figureKind, method, methodVersion, value, declaredLimitation, lineage, asOf }')] };
  }
  if (!isNonEmptyString(input.figureKind)) {
    return { ok: false, errors: [invalidField('figureKind', 'must be a non-empty figure family name (e.g. "var")')] };
  }
  if (!isNonEmptyString(input.method)) {
    return { ok: false, errors: [invalidField('method', 'must be a non-empty declared method name')] };
  }
  if (!isPositiveSafeInteger(input.methodVersion)) {
    return { ok: false, errors: [invalidField('methodVersion', 'must be a positive safe integer (the declared method version)')] };
  }
  if (typeof input.value !== 'string' || (!isNonNegativeDecimalInput(input.value) && !isSignedCanonicalDecimal(input.value))) {
    return { ok: false, errors: [{ code: 'invalid_decimal', path: 'value', message: 'the computed figure value must be a canonical decimal string (minted into the opaque ref — never stored)'}] };
  }
  if (!isNonEmptyString(input.declaredLimitation)) {
    return { ok: false, errors: [invalidField('declaredLimitation', 'must declare what this figure does NOT model (the honesty statement — L6 discipline)')] };
  }
  if (input.lineage === undefined || !isRiskLineage(input.lineage)) {
    return { ok: false, errors: [{ code: 'lineage_gap', path: 'lineage', message: 'the measure carries its full risk lineage (L9)' }] };
  }
  if (!isTimestampMs(input.asOf)) {
    return { ok: false, errors: [invalidField('asOf', 'must be an epoch-ms record instant')] };
  }
  const figureRef = mintRiskFigure(input.method, input.methodVersion, input.value);
  const payload: RiskMeasureContent = {
    kind: 'risk_adjusted',
    figureKind: input.figureKind,
    method: input.method,
    methodVersion: input.methodVersion,
    figureRef,
    declaredLimitation: input.declaredLimitation,
    lineage: input.lineage,
    tenant: input.lineage.tenant,
    project: input.lineage.project,
    asOf: input.asOf,
  };
  return ok(deepFreeze({ ...payload, measureId: mintRiskMeasureId(stableDigest(measureContentTree(payload))) }) as RiskMeasureRecord);
}

// ---------------------------------------------------------------------------
// Validation (collect-all — untrusted measure records)
// ---------------------------------------------------------------------------

/**
 * Collect-all validation of an untrusted risk measure record. Enforces,
 * beyond the structural guard:
 *   - the L7 trip wire (twice): the acceptance-vocabulary scan over the
 *     whole record (`acceptance_threshold_embedded`) AND the naked-
 *     figure-value scan on risk_adjusted records (`value`, `figureValue`,
 *     `result` keys) — a naked number pretending to be acceptance is
 *     the crime;
 *   - L9 lineage and L12 scope.
 * On success the value is returned narrowed, deeply frozen, with the
 * content-addressed `measureId` re-derived (a supplied id that
 * disagrees fails — content is the identity).
 */
export function validateRiskMeasureRecord(value: unknown, path = 'measure'): RiskResult<RiskMeasureRecord> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: RiskError[] = [];
  if (!isRiskMeasureRecord(value)) {
    if (value.kind !== undefined && !isRiskMeasureKind(value.kind)) {
      errors.push(invalidField(`${path}.kind`, `must be one of ${RISK_MEASURE_KINDS.join(' | ')}`));
    } else {
      errors.push(invalidField(`${path}`, 'failed the measure-record guard (see isRiskMeasureRecord)'));
    }
  }
  if (value.tenant === undefined) {
    errors.push({ code: 'tenant_missing', path: `${path}.tenant`, message: 'the measure carries no tenant scope (L12)' });
  }
  if (value.project === undefined) {
    errors.push({ code: 'tenant_missing', path: `${path}.project`, message: 'the measure carries no project scope (L12/L15)' });
  }
  if (value.lineage === undefined) {
    errors.push({ code: 'lineage_gap', path: `${path}.lineage`, message: 'the measure carries its full risk lineage (L9)' });
  }
  // The L7 trip wires.
  for (const crimePath of acceptanceViolations(value)) {
    errors.push({
      code: 'acceptance_threshold_embedded',
      path: `${path}.${crimePath}`,
      message: `a risk measure carries MEASURES, never acceptance vocabulary ("${crimePath}") — the engine informs, evaluation (T012) decides (L7)`,
    });
  }
  if (value.kind === 'risk_adjusted') {
    for (const key of NAKED_FIGURE_KEYS) {
      if (isRecord(value) && key in value) {
        errors.push({
          code: 'acceptance_threshold_embedded',
          path: `${path}.${key}`,
          message: `a risk-adjusted figure travels as an OPAQUE rfig: ref with declared method + version, never a naked "${key}" — a naked number pretending to be acceptance is the L7 crime`,
        });
      }
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  const record = value as RiskMeasureRecord;
  const derivedId = mintRiskMeasureId(stableDigest(measureContentTree(record)));
  if (record.measureId !== derivedId) {
    return {
      ok: false,
      errors: [{ code: 'invalid_state', path: `${path}.measureId`, message: `the supplied measure id does not match the declared content (expected "${derivedId}") — identity is content-addressed (L9)` }],
    };
  }
  return ok(deepFreeze(record));
}
