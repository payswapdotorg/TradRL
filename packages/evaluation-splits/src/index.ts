/**
 * @tradrl/evaluation-splits — the SPLIT DRIVER (Work Order T032): the
 * executable machinery that materializes benchmark-ready split PLANS from
 * data-axis definitions.
 *
 * Public API:
 *   - `primitives.ts` — the shared contract discipline (Brand, guards,
 *     deep-freeze, canonical JSON, the dual-lane FNV-1a stable digest
 *     mirrored byte-identically from the program-wide law, the TimestampMs
 *     mirror of @tradrl/time-engine).
 *   - `decimals.ts` — EXACT decimal-string numerics (scaled-bigint
 *     arithmetic; the purged/embargoed boundary widths never float).
 *   - `ids.ts` — this lane's own identity spaces (`SplitPlanId`,
 *     `SplitPlanLedgerId`) plus the opaque cross-lane reference mirrors
 *     (SplitPolicyRef/DataRef/ExperimentId from T011, EvaluatorVersionRef
 *     from T012, TenantId/ProjectId from domain-core).
 *   - `axis.ts` — the dataset axis (T012/T031 structural mirror).
 *   - `policy.ts` — the SPLIT DRIVER POLICY: rolling and anchored
 *     walk-forward window ladders, regime segmentation (partition an axis
 *     by regime label, not just time), exact-decimal purge gap + embargo
 *     widths, unseen/holdout reservation modes.
 *   - `plan.ts` — the MATERIALIZER: `materializeSplitPlan` (axis, policy)
 *     -> content-addressed, lineage-carrying, deeply-frozen split plan;
 *     `verifySplitPlan` for untrusted plans (content/address agreement,
 *     leakage law). Same axis + same policy -> byte-identical plan.
 *   - `ledger.ts` — the append-only, chain-verified plan LEDGER (L11):
 *     `createPlanLedger`, `appendPlan`, `verifyPlanLedger`.
 *
 * Typed error laws (each negative-tested):
 * - `window_exhaustion` — a ladder with no complete window.
 * - `embargo_violation` — the exact-decimal embargo/purge laws: a starved
 *   train set, or a trailing holdout not embargo-separated from search
 *   material.
 * - `holdout_leakage` — a reserved unseen segment inside search window
 *   material (the Work Order's "holdout windows that leak into search
 *   windows").
 * - `degenerate_reservation` / `empty_regime_partition` — vacuous
 *   reservations and filters.
 * - `plan_mismatch` / `duplicate_plan` / `chain_mismatch` — the L9 content
 *   address law and the L11 append-only chain law.
 *
 * Spec anchors: spec/EVALUATION-PROTOCOL.md ("Generalization: Use unseen
 * periods, regimes, assets, venues or combinations not optimized against";
 * "Selection integrity: ... walk-forward and purged/embargoed designs"),
 * spec/LEARNING-LOOP.md (the regime ladder the regime-segmented axes and
 * regime-set reservations serve), R21, ARCHITECTURE-LOCK L4/L9/L11/L12.
 *
 * Package laws: zero runtime dependencies; no `any`; every exported shape
 * has a hand-rolled total type guard; all contract data is
 * JSON-serializable and byte-stable under canonical serialization;
 * cross-lane shapes from T011/T012/T031 are consumed through STRUCTURAL
 * MIRRORS only (D-003/D-004) — the interop trip-wire tests prove the
 * mirrors against the real packages in this tree.
 */

export type { SplitDriverErrorCode, SplitDriverError, SplitDriverResult } from './errors';
export { fail, failures, ok, missingField, invalidField, invalidType } from './errors';

export type { Brand, Mutable, JsonValue, JsonObject, TimestampMs } from './primitives';
export {
  isRecord,
  isNonEmptyString,
  isFiniteNumber,
  isNonNegativeInteger,
  isPositiveInteger,
  deepFreeze,
  isDeeplyFrozen,
  isJsonValue,
  isJsonObject,
  MIN_TIMESTAMP_MS,
  MAX_TIMESTAMP_MS,
  isTimestampMs,
  timestampMs,
  requireTimestampMs,
  canonicalJson,
  stableDigest,
  stableDigestJson,
  isDigest,
} from './primitives';

export type { DecimalString, RoundingMode } from './decimals';
export {
  ROUNDING_MODES,
  isUnsignedDecimal,
  isSignedDecimal,
  decimalScale,
  compareDecimals,
  decimalsEqual,
  maxDecimal,
  addDecimals,
  subtractDecimals,
  meanDecimals,
  isDecimalAtScale,
  normalizeDecimal,
  roundDecimalToScale,
} from './decimals';

export type {
  SplitPlanId,
  SplitPlanLedgerId,
  SplitPolicyRef,
  DataRef,
  ExperimentId,
  EvaluatorVersionRef,
  TenantId,
  ProjectId,
} from './ids';
export {
  isSplitPlanId,
  isSplitPlanLedgerId,
  isSplitPolicyRef,
  isDataRef,
  isExperimentId,
  isEvaluatorVersionRef,
  isTenantId,
  isProjectId,
} from './ids';

export { isDatasetSegment, isDatasetAxis, validateDatasetAxis, axisJson, axisDigest } from './axis';
export type { DatasetSegment, DatasetAxis } from './axis';

export {
  WINDOW_SCHEMES,
  isWindowScheme,
  isRegimeFilter,
  isHoldoutReservation,
  isSplitDriverPolicy,
  policyJson,
  policyDigest,
  validateSplitDriverPolicy,
} from './policy';
export type { WindowScheme, RegimeFilter, HoldoutReservation, SplitDriverPolicy } from './policy';

export {
  planContentJson,
  splitPlanId,
  canonicalSplitPlan,
  materializeSplitPlan,
  isSplitWindowPlan,
  isHoldoutReservationPlan,
  isSplitPlan,
  verifySplitPlan,
} from './plan';
export type { SplitWindowPlan, HoldoutReservationPlan, SplitPlanLineage, SplitPlan } from './plan';

export {
  isSplitPlanLedgerEntry,
  isSplitPlanLedger,
  splitPlanLedgerId,
  planChainGenesis,
  planChainFold,
  computePlanChainHead,
  createPlanLedger,
  appendPlan,
  verifyPlanLedger,
  canonicalPlanLedger,
} from './ledger';
export type { SplitPlanLedgerBinding, SplitPlanLedgerEntry, SplitPlanLedger } from './ledger';

/** Package identity and ownership (Work Order T032). */
export const packageInfo = {
  name: '@tradrl/evaluation-splits',
  owner: 'T032',
  status: 'implemented',
} as const;
