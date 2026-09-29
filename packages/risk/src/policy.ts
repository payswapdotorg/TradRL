// @tradrl/risk — the RiskPolicy: the versioned risk-limit declaration
// (the L7-compliant deep refinement of T019's LIMITS dimension).
//
// THE POSITION IN THE PROGRAM (the Work Order's §4): T019's gate checks
// limits — "is this order within the declared limits?" — but nothing
// computes what the limits are checked AGAINST. THIS record is the
// versioned DECLARATION of those limits: per-instrument-class caps
// (order size, order notional, position size, position notional —
// structurally the SAME {@link ClassLimitRecord} T019's ExecutionPolicy
// declares, so one declaration serves both lanes), plus the
// portfolio-level measures' caps (concentration, drawdown, leverage).
// The engine's ExposureComputation owns the MEASUREMENT; the
// LimitEvaluation owns the STATES these caps are evaluated into; T019's
// gate consumes the states (limits.ts `executionLimitRefusals` is the
// bridge).
//
// THE L7 EXISTENTIAL LAW (spec/ARCHITECTURE-LOCK.md L7: "Constraint-
// aware evaluation: raw PnL is insufficient"; the Work Order: "the
// engine computes and records RISK MEASURES as DATA — it never converts
// a risk figure into an acceptance verdict by itself; risk-adjusted
// figures are opaque refs to evaluation, never the sole criterion"): a
// LIMIT is a declared hard bound over a MEASURED quantity (how much may
// be at risk) — it is NOT an acceptance threshold (whether the outcome
// was good). A RiskPolicy that embeds acceptance thresholds, scores,
// grades or verdicts masquerading as evaluation fails validation with
// the typed `acceptance_threshold_embedded` — the L7 trip wire
// (acceptanceViolations, below) walks the whole record and the negative
// test proves the crime does not compile. The engine informs; evaluation
// (T012) decides.
//
// L11 (search integrity — "optimization history is retained"): policy
// evolution is an append-only trail (trail.ts); every record carries
// the `supersedes` pointer to the version it replaces, and superseded
// versions are RETAINED. A change is a NEW VERSION — never a mutation.
//
// L9/L12: the policy is scoped to one tenant + project, versioned, and
// content-addressed (`rpol:` + digest of the canonical content minus
// the id): the same declaration always yields the same id. The goal and
// constraint-set version refs bind the compilation lineage (invariant
// 5: user risk constraints are executable acceptance criteria — this
// policy is their compiled mirror; see compile.ts).
//
// DOWNSTREAM: T030 (shadow trading) consumes the audit trail; T040
// (live execution) binds the limit states into the live gate.
//
// Spec anchors: spec/ARCHITECTURE.md (Execution — "limits"),
// spec/DOMAIN-MODEL.md (Goal: "...and risk policy"), spec/ARCHITECTURE-
// LOCK.md L7, L9, L11, L12.

import { deepFreeze, isMemberOf, isNonEmptyString, isPositiveSafeInteger, isRecord, isTimestampMs, type JsonValue, type TimestampMs } from './primitives';
import { canonicalJson, stableDigest } from './primitives';
import { compare, isCanonicalPositiveDecimal } from './decimals';
import type { ConstraintSetVersionRef, GoalVersionRef, ProjectId, RiskPolicyId, RiskPolicyVersionRef, TenantId } from './ids';
import { isConstraintSetVersionRef, isGoalVersionRef, isProjectId, isRiskPolicyVersionRef, isTenantId, mintRiskPolicyId } from './ids';
import {
  type RiskError,
  type RiskResult,
  invalidField,
  invalidType,
  missingField,
  ok,
} from './errors';

// ---------------------------------------------------------------------------
// The limit-kind taxonomy (the closed, machine-enumerable list)
// ---------------------------------------------------------------------------

/**
 * The seven limit kinds this engine declares — the TOTALITY list
 * (limits.ts walks it; every declared limit has an exhaustive
 * machine-enumerated check). The first four are T019's
 * `LimitKind` (per-instrument-class caps — the execution gate's limit
 * records); the last three are the portfolio-level measures this lane
 * adds. A limit kind the engine declares but cannot evaluate is the
 * typed `limit_unevaluable` — never a silent pass.
 */
export type RiskLimitKind =
  | 'order_size'
  | 'order_notional'
  | 'position_size'
  | 'position_notional'
  | 'concentration'
  | 'drawdown'
  | 'leverage';

/** Runtime-checkable list of ALL limit kinds (the totality law's enumeration). */
export const RISK_LIMIT_KINDS: readonly RiskLimitKind[] = [
  'order_size',
  'order_notional',
  'position_size',
  'position_notional',
  'concentration',
  'drawdown',
  'leverage',
] as const;

/** Guard: a limit kind. */
export function isRiskLimitKind(v: unknown): v is RiskLimitKind {
  return isMemberOf(RISK_LIMIT_KINDS, v);
}

/**
 * The four per-instrument-class kinds — exactly T019's `LimitKind`
 * (execution-policy policy.ts). The class kinds' states are what the
 * execution-policy limit-check mirror consumes (see
 * limits.ts `executionLimitRefusals`).
 */
export type ClassLimitKind = 'order_size' | 'order_notional' | 'position_size' | 'position_notional';

/** The three portfolio-level kinds this lane adds to T019's four. */
export type PortfolioLimitKind = 'concentration' | 'drawdown' | 'leverage';

// ---------------------------------------------------------------------------
// The limit declarations (exact-decimal bounds, structured semantics)
// ---------------------------------------------------------------------------

/**
 * LIMITS — how much, per instrument class: the cap record. STRUCTURALLY
 * THE SAME record T019's ExecutionPolicy declares (mirror of
 * execution-policy's `LimitRecord`): the same field names, the same
 * canonical-positive-decimal laws, the same '*' catch-all semantics, so
 * one declaration serves both the execution gate and this engine (the
 * interop test proves the mutual assignability). A zero cap is
 * inexpressible — refuse by policy shape, not by magic numbers (use the
 * class allowlist to prohibit).
 */
export interface ClassLimitRecord {
  /** The instrument class this record caps ('*' = catch-all). */
  readonly instrumentClass: string;
  /** Maximum single-order size in instrument units. */
  readonly maxOrderSize: string;
  /** Maximum single-order notional in quote currency (quantity x reference price). */
  readonly maxOrderNotional: string;
  /** Maximum post-trade position in instrument units. */
  readonly maxPositionSize: string;
  /** Maximum post-trade position notional in quote currency. */
  readonly maxPositionNotional: string;
}

/** Guard: `ClassLimitRecord` (mirror of execution-policy's `isLimitRecord` law for law). */
export function isClassLimitRecord(v: unknown): v is ClassLimitRecord {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.instrumentClass)) return false;
  if (!isCanonicalPositiveDecimal(v.maxOrderSize)) return false;
  if (!isCanonicalPositiveDecimal(v.maxOrderNotional)) return false;
  if (!isCanonicalPositiveDecimal(v.maxPositionSize)) return false;
  if (!isCanonicalPositiveDecimal(v.maxPositionNotional)) return false;
  return true;
}

/**
 * CONCENTRATION — how concentrated the portfolio may be: the maximum
 * share of gross notional ONE instrument may hold. The bound is a
 * canonical positive decimal in (0, 1] (a ratio of notionals; 1 = a
 * single-instrument portfolio is tolerable). `ratioPrecision` declares
 * the precision OBSERVED ratios are reported at (the limit COMPARISON
 * itself cross-multiplies exactly and never rounds — see limits.ts).
 */
export interface ConcentrationLimit {
  readonly maxConcentrationRatio: string;
  /** The precision observed concentration ratios are reported at (>= 0). */
  readonly ratioPrecision: number;
}

/** Guard: `ConcentrationLimit`. */
export function isConcentrationLimit(v: unknown): v is ConcentrationLimit {
  if (!isRecord(v)) return false;
  if (!isCanonicalPositiveDecimal(v.maxConcentrationRatio)) return false;
  if (compare(v.maxConcentrationRatio, '1') > 0) return false; // a ratio of notionals cannot exceed 1
  if (typeof v.ratioPrecision !== 'number' || !Number.isSafeInteger(v.ratioPrecision) || v.ratioPrecision < 0) return false;
  return true;
}

/**
 * DRAWDOWN — how far equity may fall from its peak: the maximum
 * high-water-mark decline, in quote currency (an exact-decimal
 * magnitude — the drawdown series itself is recorded by
 * measures.ts). Strictly positive (a zero tolerance is inexpressible —
 * refuse by policy shape, mirroring the class-cap law).
 */
export interface DrawdownLimit {
  readonly maxDrawdown: string;
}

/** Guard: `DrawdownLimit`. */
export function isDrawdownLimit(v: unknown): v is DrawdownLimit {
  if (!isRecord(v)) return false;
  return isCanonicalPositiveDecimal(v.maxDrawdown);
}

/**
 * LEVERAGE — how big the book may be relative to equity: the maximum
 * gross-notional / equity ratio. Strictly positive decimal (values
 * below 1 mean deleveraged books are tolerated). `ratioPrecision`
 * declares the precision OBSERVED leverage is reported at (the limit
 * COMPARISON cross-multiplies exactly and never rounds).
 */
export interface LeverageLimit {
  readonly maxLeverageRatio: string;
  /** The precision observed leverage is reported at (>= 0). */
  readonly ratioPrecision: number;
}

/** Guard: `LeverageLimit`. */
export function isLeverageLimit(v: unknown): v is LeverageLimit {
  if (!isRecord(v)) return false;
  if (!isCanonicalPositiveDecimal(v.maxLeverageRatio)) return false;
  if (typeof v.ratioPrecision !== 'number' || !Number.isSafeInteger(v.ratioPrecision) || v.ratioPrecision < 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The L7 trip wire (the existential law's enforcement)
// ---------------------------------------------------------------------------

/**
 * The closed list of acceptance-embedding key shapes (normalized
 * lowercase, no separators). A risk record carrying ANY of these keys
 * embeds EVALUATION vocabulary — an acceptance threshold, a score, a
 * grade, a verdict — masquerading as a risk measure: the typed
 * `acceptance_threshold_embedded` crime (L7: the engine informs,
 * evaluation decides).
 */
export const ACCEPTANCE_EMBEDDING_KEYS: readonly string[] = [
  'acceptance',
  'acceptancethreshold',
  'accept',
  'accepted',
  'score',
  'scorethreshold',
  'minscore',
  'maxscore',
  'grade',
  'verdict',
  'pass',
  'passthreshold',
  'satisfies',
  'satisfaction',
] as const;

/** `true` when a record key is an acceptance-embedding key shape (case/separator-insensitive). */
export function isAcceptanceEmbeddingKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_\s]/g, '');
  return ACCEPTANCE_EMBEDDING_KEYS.includes(normalized);
}

/**
 * Scan a record's JSON tree for embedded acceptance vocabulary: the
 * dotted paths of every acceptance-shaped key found, in deterministic
 * (depth-first, key-sorted) order. Pure; never throws; an empty result
 * means the tree carries measures and limits only — no verdicts (L7).
 */
export function acceptanceViolations(value: unknown, prefix = ''): readonly string[] {
  const found: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      for (const path of acceptanceViolations(item, `${prefix}[${index}]`)) found.push(path);
    });
    return found;
  }
  if (!isRecord(value)) return found;
  for (const key of Object.keys(value).sort()) {
    if (isAcceptanceEmbeddingKey(key)) found.push(prefix === '' ? key : `${prefix}.${key}`);
    for (const path of acceptanceViolations(value[key], prefix === '' ? key : `${prefix}.${key}`)) {
      found.push(path);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// The policy record
// ---------------------------------------------------------------------------

/**
 * The versioned risk-limit declaration (see the module header for the
 * L7 law). Identity is `(policyId, version)`; the id is
 * content-addressed from the canonical declaration content; the record
 * is deeply frozen and JSON-serializable (L9). A revision is a NEW
 * VERSION under the L11 trail (trail.ts) — the `supersedes` pointer
 * names the version this one replaces (null iff version 1).
 */
export interface RiskPolicy {
  /** Content-addressed identity: `rpol:` + digest of the canonical content. */
  readonly policyId: RiskPolicyId;
  /** Integer >= 1; monotonically increasing per policy family (revisions are new versions — L11). */
  readonly version: number;
  /** The version this policy supersedes (null iff version 1 — the trail enforces the chain). */
  readonly supersedes: RiskPolicyVersionRef | null;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  /** The goal this policy's limits serve (control-plane mirror — L9/L15). */
  readonly goal: GoalVersionRef;
  /** The constraint set this policy compiled FROM (the user's executable risk constraints). */
  readonly constraintSet: ConstraintSetVersionRef;
  /** Per-instrument-class caps (T019's limit-record shape — one record per class, '*' the catch-all). */
  readonly classLimits: readonly ClassLimitRecord[];
  /** The concentration cap, or null when the constraint set declares none. */
  readonly concentration: ConcentrationLimit | null;
  /** The drawdown threshold, or null when the constraint set declares none. */
  readonly drawdown: DrawdownLimit | null;
  /** The leverage cap, or null when the constraint set declares none. */
  readonly leverage: LeverageLimit | null;
  /** The constraint ids that compiled into this policy's limits (the compilation lineage). */
  readonly compiledFrom: readonly string[];
  /** The declaration instant (epoch ms; no ambient clock). */
  readonly asOf: TimestampMs;
}

/** Guard: `RiskPolicy` (structural; the L7/L9/L11/L12 laws live in `validateRiskPolicy`). */
export function isRiskPolicy(v: unknown): v is RiskPolicy {
  if (!isRecord(v)) return false;
  if (typeof v.policyId !== 'string' || !v.policyId.startsWith('rpol:')) return false;
  if (!isPositiveSafeInteger(v.version)) return false;
  if (v.supersedes !== null && !isRiskPolicyVersionRef(v.supersedes)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  if (!isGoalVersionRef(v.goal)) return false;
  if (!isConstraintSetVersionRef(v.constraintSet)) return false;
  if (!Array.isArray(v.classLimits) || !v.classLimits.every((x) => isClassLimitRecord(x))) return false;
  if (v.concentration !== null && !isConcentrationLimit(v.concentration)) return false;
  if (v.drawdown !== null && !isDrawdownLimit(v.drawdown)) return false;
  if (v.leverage !== null && !isLeverageLimit(v.leverage)) return false;
  if (!Array.isArray(v.compiledFrom) || !v.compiledFrom.every((x) => isNonEmptyString(x))) return false;
  if (!isTimestampMs(v.asOf)) return false;
  // The L7 trip wire (the guard half).
  if (acceptanceViolations(v).length > 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Content addressing (L9)
// ---------------------------------------------------------------------------

/**
 * The canonical JSON tree of a policy's CONTENT (everything except the
 * content-addressed `policyId`). The explicit-tree discipline: JSON
 * shape is proven by construction, never cast. Equal contents always
 * serialize byte-identically.
 */
export function policyContentTree(policy: Omit<RiskPolicy, 'policyId'>): JsonValue {
  return {
    version: policy.version,
    supersedes:
      policy.supersedes === null
        ? null
        : { policyId: policy.supersedes.policyId, version: policy.supersedes.version },
    tenant: policy.tenant,
    project: policy.project,
    goal: { goalId: policy.goal.goalId, version: policy.goal.version },
    constraintSet: { id: policy.constraintSet.id, version: policy.constraintSet.version },
    classLimits: policy.classLimits.map((limit) => ({
      instrumentClass: limit.instrumentClass,
      maxOrderSize: limit.maxOrderSize,
      maxOrderNotional: limit.maxOrderNotional,
      maxPositionSize: limit.maxPositionSize,
      maxPositionNotional: limit.maxPositionNotional,
    })),
    concentration:
      policy.concentration === null
        ? null
        : { maxConcentrationRatio: policy.concentration.maxConcentrationRatio, ratioPrecision: policy.concentration.ratioPrecision },
    drawdown: policy.drawdown === null ? null : { maxDrawdown: policy.drawdown.maxDrawdown },
    leverage:
      policy.leverage === null
        ? null
        : { maxLeverageRatio: policy.leverage.maxLeverageRatio, ratioPrecision: policy.leverage.ratioPrecision },
    compiledFrom: [...policy.compiledFrom],
    asOf: policy.asOf,
  };
}

/** The content digest of a policy's payload. Pure — same content, same digest (L9). */
export function policyContentDigest(policy: Omit<RiskPolicy, 'policyId'>): string {
  return stableDigest(policyContentTree(policy));
}

// ---------------------------------------------------------------------------
// Validation (collect-all)
// ---------------------------------------------------------------------------

/**
 * Collect-all validation of an untrusted risk policy. Enforces, beyond
 * the structural guard:
 *   - L12 scope: tenant and project present;
 *   - the L11 version law: version 1 carries no `supersedes`; version
 *     N > 1 carries one pointing at version N-1 (the trail verifies the
 *     actual chain — trail.ts);
 *   - unique instrument classes ('*' the catch-all, one record per
 *     class — mirroring T019's coherence law);
 *   - exact-decimal bounds: every cap is a canonical POSITIVE decimal,
 *     and the concentration ratio additionally cannot exceed 1;
 *   - the EXACT-DECIMAL trip wire: a JS NUMBER in any bound field is
 *     float mediation — the typed `decimal_imprecision` crime;
 *   - the L7 trip wire: no acceptance vocabulary anywhere in the
 *     record — `acceptance_threshold_embedded`;
 *   - L9 lineage: goal and constraint-set version refs present;
 *   - unique `compiledFrom` constraint ids.
 * On success the value is returned narrowed, deeply frozen, with the
 * content-addressed `policyId` derived (a supplied id that disagrees
 * with the content fails — content is the identity).
 */
export function validateRiskPolicy(value: unknown, path = 'policy'): RiskResult<RiskPolicy> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: RiskError[] = [];

  // --- L12 scope -------------------------------------------------------------
  if (value.tenant === undefined) {
    errors.push({ code: 'tenant_missing', path: `${path}.tenant`, message: 'the policy carries no tenant scope (L12)' });
  } else if (!isTenantId(value.tenant)) {
    errors.push({ code: 'tenant_missing', path: `${path}.tenant`, message: 'the tenant scope must be a non-empty id (L12)' });
  }
  if (value.project === undefined) {
    errors.push({ code: 'tenant_missing', path: `${path}.project`, message: 'the policy carries no project scope (L12/L15)' });
  } else if (!isProjectId(value.project)) {
    errors.push({ code: 'tenant_missing', path: `${path}.project`, message: 'the project scope must be a non-empty id (L12/L15)' });
  }

  if (value.version === undefined) {
    errors.push(missingField(`${path}.version`));
  } else if (!isPositiveSafeInteger(value.version)) {
    errors.push(invalidField(`${path}.version`, 'must be a positive safe integer (revisions are new versions — L11)'));
  }

  if (value.asOf === undefined) {
    errors.push(missingField(`${path}.asOf`));
  } else if (!isTimestampMs(value.asOf)) {
    errors.push(invalidField(`${path}.asOf`, 'must be an epoch-ms timestamp (no ambient clock)'));
  }

  // --- L9 lineage: goal + constraint-set -------------------------------------
  if (value.goal === undefined) {
    errors.push({ code: 'lineage_gap', path: `${path}.goal`, message: 'the policy carries no goal version ref (L9/L15)' });
  } else if (!isGoalVersionRef(value.goal)) {
    errors.push(invalidField(`${path}.goal`, 'must be { goalId, version } (the goal this policy serves)'));
  }

  if (value.constraintSet === undefined) {
    errors.push({ code: 'lineage_gap', path: `${path}.constraintSet`, message: 'the policy carries no constraint-set version ref (L9 — the compilation source)' });
  } else if (!isConstraintSetVersionRef(value.constraintSet)) {
    errors.push(invalidField(`${path}.constraintSet`, 'must be { id, version } (the constraint set this policy compiled FROM)'));
  }

  // --- The L11 version law ------------------------------------------------------
  if (value.supersedes !== undefined && value.supersedes !== null && !isRiskPolicyVersionRef(value.supersedes)) {
    errors.push(invalidField(`${path}.supersedes`, 'must be { policyId, version } or null (the version this one replaces — L11)'));
  } else if (value.supersedes !== undefined && value.supersedes !== null && isPositiveSafeInteger(value.version)) {
    const supersedes = value.supersedes as RiskPolicyVersionRef;
    if (supersedes.version !== (value.version as number) - 1) {
      errors.push(invalidField(`${path}.supersedes`, `version ${value.version} must supersede version ${value.version - 1} (carries ${supersedes.version}) — versions chain contiguously (L11)`));
    }
  } else if (value.supersedes === null && isPositiveSafeInteger(value.version) && value.version > 1) {
    errors.push(invalidField(`${path}.supersedes`, `version ${value.version} must supersede the previous version — only version 1 carries no supersedes pointer (L11)`));
  }

  // --- Class limits (T019's record shape) ----------------------------------------
  let classLimits: readonly ClassLimitRecord[] | undefined;
  if (value.classLimits === undefined) {
    errors.push(missingField(`${path}.classLimits`));
  } else if (!Array.isArray(value.classLimits)) {
    errors.push(invalidField(`${path}.classLimits`, 'must be an array of class limit records'));
  } else {
    const candidates = value.classLimits;
    const validated: ClassLimitRecord[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index];
      if (!isRecord(candidate)) {
        errors.push(invalidField(`${path}.classLimits[${index}]`, 'must be a class limit record { instrumentClass, maxOrderSize, maxOrderNotional, maxPositionSize, maxPositionNotional }'));
        continue;
      }
      // The exact-decimal trip wire: a NUMBER in a bound field is float mediation.
      for (const boundField of ['maxOrderSize', 'maxOrderNotional', 'maxPositionSize', 'maxPositionNotional']) {
        const bound = candidate[boundField];
        if (typeof bound === 'number') {
          errors.push({
            code: 'decimal_imprecision',
            path: `${path}.classLimits[${index}].${boundField}`,
            message: `a JS number in a money path is float mediation — bounds are canonical decimal STRINGS ("${String(bound)}" never enters a limit)`,
          });
        }
      }
      if (!isClassLimitRecord(candidate)) {
        errors.push(invalidField(`${path}.classLimits[${index}]`, 'must be a class limit record (canonical POSITIVE decimals; a zero cap is inexpressible — refuse by policy shape)'));
        continue;
      }
      const key = candidate.instrumentClass;
      if (seen.has(key)) {
        errors.push(invalidField(`${path}.classLimits[${index}].instrumentClass`, `duplicate class "${key}" — one record per class ('*' is the catch-all)`));
        continue;
      }
      seen.add(key);
      validated.push(deepFreeze({ ...candidate }));
    }
    if (errors.length === 0) classLimits = validated;
  }

  // --- The portfolio-level limits -------------------------------------------------
  let concentration: ConcentrationLimit | null = null;
  if (value.concentration !== undefined && value.concentration !== null) {
    if (!isRecord(value.concentration)) {
      errors.push(invalidField(`${path}.concentration`, 'must be { maxConcentrationRatio, ratioPrecision } or null'));
    } else {
      if (typeof value.concentration.maxConcentrationRatio === 'number') {
        errors.push({
          code: 'decimal_imprecision',
          path: `${path}.concentration.maxConcentrationRatio`,
          message: 'a JS number in a money path is float mediation — bounds are canonical decimal STRINGS',
        });
      }
      if (!isConcentrationLimit(value.concentration)) {
        errors.push(invalidField(`${path}.concentration`, 'must be { maxConcentrationRatio: canonical positive decimal <= 1, ratioPrecision: non-negative safe integer }'));
      } else {
        concentration = deepFreeze({ ...value.concentration });
      }
    }
  }

  let drawdown: DrawdownLimit | null = null;
  if (value.drawdown !== undefined && value.drawdown !== null) {
    if (!isRecord(value.drawdown)) {
      errors.push(invalidField(`${path}.drawdown`, 'must be { maxDrawdown } or null'));
    } else {
      if (typeof value.drawdown.maxDrawdown === 'number') {
        errors.push({
          code: 'decimal_imprecision',
          path: `${path}.drawdown.maxDrawdown`,
          message: 'a JS number in a money path is float mediation — bounds are canonical decimal STRINGS',
        });
      }
      if (!isDrawdownLimit(value.drawdown)) {
        errors.push(invalidField(`${path}.drawdown`, 'must be { maxDrawdown: canonical positive decimal } — a zero tolerance is inexpressible (refuse by policy shape)'));
      } else {
        drawdown = deepFreeze({ ...value.drawdown });
      }
    }
  }

  let leverage: LeverageLimit | null = null;
  if (value.leverage !== undefined && value.leverage !== null) {
    if (!isRecord(value.leverage)) {
      errors.push(invalidField(`${path}.leverage`, 'must be { maxLeverageRatio, ratioPrecision } or null'));
    } else {
      if (typeof value.leverage.maxLeverageRatio === 'number') {
        errors.push({
          code: 'decimal_imprecision',
          path: `${path}.leverage.maxLeverageRatio`,
          message: 'a JS number in a money path is float mediation — bounds are canonical decimal STRINGS',
        });
      }
      if (!isLeverageLimit(value.leverage)) {
        errors.push(invalidField(`${path}.leverage`, 'must be { maxLeverageRatio: canonical positive decimal, ratioPrecision: non-negative safe integer }'));
      } else {
        leverage = deepFreeze({ ...value.leverage });
      }
    }
  }

  // --- The compilation lineage ----------------------------------------------------
  let compiledFrom: readonly string[] | undefined;
  if (value.compiledFrom === undefined) {
    errors.push(missingField(`${path}.compiledFrom`));
  } else if (!Array.isArray(value.compiledFrom) || !value.compiledFrom.every((x) => isNonEmptyString(x))) {
    errors.push(invalidField(`${path}.compiledFrom`, 'must be an array of constraint ids (the compilation lineage)'));
  } else {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const id of value.compiledFrom) {
      const constraintId = id as string;
      if (seen.has(constraintId)) {
        errors.push(invalidField(`${path}.compiledFrom`, `duplicate constraint id "${constraintId}"`));
        continue;
      }
      seen.add(constraintId);
      ids.push(constraintId);
    }
    if (errors.length === 0) compiledFrom = ids;
  }

  // --- The L7 trip wire (the existential law's enforcement) --------------------------
  for (const crimePath of acceptanceViolations(value)) {
    errors.push({
      code: 'acceptance_threshold_embedded',
      path: `${path}.${crimePath}`,
      message: `a risk policy carries MEASURES and LIMITS, never acceptance vocabulary ("${crimePath}") — the engine informs, evaluation (T012) decides (L7)`,
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  const payload: Omit<RiskPolicy, 'policyId'> = {
    version: value.version as number,
    supersedes: (value.supersedes === null || value.supersedes === undefined ? null : value.supersedes) as RiskPolicyVersionRef | null,
    tenant: value.tenant as TenantId,
    project: value.project as ProjectId,
    goal: value.goal as GoalVersionRef,
    constraintSet: value.constraintSet as ConstraintSetVersionRef,
    classLimits: classLimits as readonly ClassLimitRecord[],
    concentration,
    drawdown,
    leverage,
    compiledFrom: compiledFrom as readonly string[],
    asOf: value.asOf as TimestampMs,
  };
  const derivedId = mintRiskPolicyId(policyContentDigest(payload));
  if (value.policyId !== undefined && value.policyId !== derivedId) {
    return {
      ok: false,
      errors: [
        {
          code: 'invalid_state',
          path: `${path}.policyId`,
          message: `the supplied policy id does not match the declared content (expected "${derivedId}") — identity is content-addressed (L9)`,
        },
      ],
    };
  }
  return ok(deepFreeze({ ...payload, policyId: derivedId }));
}

// ---------------------------------------------------------------------------
// Convenience (audit-side, deterministic)
// ---------------------------------------------------------------------------

/** The versioned ref of a validated policy (the lineage carrier). */
export function riskPolicyVersionRef(policy: RiskPolicy): RiskPolicyVersionRef {
  return deepFreeze({ policyId: policy.policyId, version: policy.version });
}

/** The L9 anchor: the canonical JSON of a validated policy. */
export function canonicalPolicyJson(policy: RiskPolicy): string {
  return canonicalJson(policyContentTree(policy));
}

/** The human-audit summary of a policy's limit coverage (every declared limit named — totality made visible). */
export function describePolicyCoverage(policy: RiskPolicy): string {
  const declared: string[] = [`class_limits:${policy.classLimits.map((limit) => limit.instrumentClass).join('|') || '(none)'}`];
  declared.push(`concentration:${policy.concentration === null ? '(none)' : policy.concentration.maxConcentrationRatio}`);
  declared.push(`drawdown:${policy.drawdown === null ? '(none)' : policy.drawdown.maxDrawdown}`);
  declared.push(`leverage:${policy.leverage === null ? '(none)' : policy.leverage.maxLeverageRatio}`);
  declared.push(`compiled_from:${policy.compiledFrom.length} constraint(s)`);
  return declared.join(' ');
}
