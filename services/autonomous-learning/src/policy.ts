/**
 * @tradrl/autonomous-learning (service) — the IMPROVEMENT POLICY (Work
 * Order T035): the declared, versioned decision table that turns T033's
 * focus SUGGESTIONS into improvement actions.
 *
 * THE R27 BOUNDARY (mirrored from the hook lane): a hook informs, never
 * decides. The DECISION layer is THIS policy — a caller-supplied,
 * validated record declaring, per learning focus:
 *   - the capability-gap kind a failure of that focus grounds (or NULL —
 *     an honest "no curriculum rung remediates this": data-pipeline
 *     latency is an infrastructure fact, not a curriculum capability
 *     gap; the Firm Brain still learns the data_latency knowledge);
 *   - the firm-knowledge kind the focus's evidence relates to (or NULL —
 *     the revision's knowledge annotation join key, T034's closed
 *     vocabulary);
 *   - whether the focus commissions a body-forge run (skill refinement).
 *
 * THE ADOPTION LAW (T031's selection discipline, the policy's switch):
 * `requiresHoldout` (default true) — a skill commission is RELEASED to
 * the forge only when the cited evaluated evidence includes an ATTAINED
 * verdict under a HOLDOUT-classified search trial; in-search-only
 * evidence withholds the commission as the typed refusal data
 * `selected_without_holdout` (never an exception — the refusal is
 * retained data, L11). The platform mirror of T031's
 * `selected_without_holdout` / quarantine discipline: the improvement
 * loop is itself a search, and its selections must distinguish in-search
 * from holdout evidence (R20/R21).
 *
 * Determinism: validation is pure; the validated policy is deeply frozen;
 * the same untrusted input yields the same frozen record, twice.
 */

import {
  canonicalJson,
  deepFreeze,
  fail,
  fnv1a32Hex,
  isNonEmptyString,
  isRecord,
  ok,
  type ImprovementResult,
} from './primitives';
import type { CapabilityGapKind, KnowledgeKind, LearningFocus } from './mirrors';
import { LEARNING_FOCUS, isCapabilityGapKind, isKnowledgeKind, isLearningFocus } from './mirrors';

// ---------------------------------------------------------------------------
// The per-focus action
// ---------------------------------------------------------------------------

/**
 * One focus's declared action: the gap kind it grounds (or null — the
 * honest no-gap row), the knowledge kind its evidence relates to (or
 * null), and whether it commissions a body-forge run.
 */
export interface FocusAction {
  /** The capability-gap kind a failure of this focus grounds (null = no curriculum gap). */
  readonly gapKind: CapabilityGapKind | null;
  /** The firm-knowledge kind the focus's evidence relates to (null = unannotated). */
  readonly knowledgeKind: KnowledgeKind | null;
  /** Whether the focus commissions a skill refinement (the body-forge run). */
  readonly commission: boolean;
}

/** Guard: `FocusAction` (structural). */
export function isFocusAction(v: unknown): v is FocusAction {
  if (!isRecord(v)) return false;
  if (v.gapKind !== null && !isCapabilityGapKind(v.gapKind)) return false;
  if (v.knowledgeKind !== null && !isKnowledgeKind(v.knowledgeKind)) return false;
  return typeof v.commission === 'boolean';
}

// ---------------------------------------------------------------------------
// The policy
// ---------------------------------------------------------------------------

/**
 * The improvement policy: the focus-action table (one row per learning
 * focus — TOTALITY over the six-focus closed vocabulary) plus the
 * adoption switch. Immutable once validated; every cycle cites the
 * policy's digest in its lineage (L9).
 */
export interface ImprovementPolicy {
  /** The versioned identity cycles cite (e.g. `improvement@1.0.0`). */
  readonly version: string;
  /** One action row per learning focus (all six, exactly once). */
  readonly focusTable: Readonly<Record<LearningFocus, FocusAction>>;
  /** The adoption gate: holdout-distinguished evidence required to release a skill commission (default true). */
  readonly requiresHoldout: boolean;
}

/** The canonical content of a policy (everything the digest covers). */
function policyContent(policy: Omit<ImprovementPolicy, never>): Record<string, unknown> {
  return {
    version: policy.version,
    focusTable: LEARNING_FOCUS.map((focus) => ({
      focus,
      gapKind: policy.focusTable[focus].gapKind,
      knowledgeKind: policy.focusTable[focus].knowledgeKind,
      commission: policy.focusTable[focus].commission,
    })),
    requiresHoldout: policy.requiresHoldout,
  };
}

/**
 * The policy digest — FNV-1a over the canonical JSON of the policy's
 * content (the derivation cycles cite in their lineage; equal policies
 * always digest equally).
 */
export function improvementPolicyDigest(policy: ImprovementPolicy): string {
  return fnv1a32Hex(canonicalJson(policyContent(policy) as never));
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Deep validation of an untrusted improvement policy. The laws:
 *   - the version is a non-empty versioned reference (a policy without
 *     identity is not a decision table);
 *   - the focus table covers ALL SIX learning focuses, exactly once each
 *     (the totality law — a policy that cannot answer a focus is not a
 *     policy);
 *   - every row's kinds are members of their closed vocabularies;
 *   - the COHERENCE law: a commissioning row MUST ground a gap kind (the
 *     body forge runs over gap records — a commission without a gap is
 *     `policy_invalid`);
 *   - the ANNOTATION law: a row that grounds a gap kind SHOULD relate to
 *     a knowledge kind (NULL is legal only on the honest no-gap rows) —
 *     the agenda's annotation is the brain-informed half of the
 *     improvement.
 * On success returns the narrowed, deeply frozen policy.
 */
export function validateImprovementPolicy(v: unknown): ImprovementResult<ImprovementPolicy> {
  if (!isRecord(v)) return fail('invalid_type', 'the improvement policy must be an object');
  if (!isNonEmptyString(v.version)) {
    return fail('policy_invalid', 'the policy carries a versioned identity (e.g. improvement@1.0.0) — cycles cite it in their lineage (L9)', 'version');
  }
  if (!isRecord(v.focusTable)) {
    return fail('policy_invalid', 'the policy declares its focus table — one action row per learning focus (all six)', 'focusTable');
  }
  if (typeof v.requiresHoldout !== 'boolean') {
    return fail('policy_invalid', 'requiresHoldout is a boolean (the adoption gate — holdout-distinguished evidence releases commissions)', 'requiresHoldout');
  }
  const table = v.focusTable as Record<string, unknown>;
  for (const key of Object.keys(table)) {
    if (!isLearningFocus(key)) {
      return fail('policy_invalid', `the focus table carries a foreign row "${key}" — the vocabulary is closed (the six T033 learning focuses only)`, 'focusTable');
    }
  }
  for (const focus of LEARNING_FOCUS) {
    const row = table[focus];
    if (row === undefined) {
      return fail('policy_invalid', `the focus table has no row for "${focus}" — the totality law requires all ${LEARNING_FOCUS.length} learning focuses (T033's closed vocabulary)`, `focusTable.${focus}`);
    }
    if (!isFocusAction(row)) {
      return fail('policy_invalid', `the "${focus}" row must be { gapKind, knowledgeKind, commission } with closed-vocabulary kinds (null = the honest no-gap row)`, `focusTable.${focus}`);
    }
    const action = row as FocusAction;
    if (action.commission && action.gapKind === null) {
      return fail('policy_invalid', `the "${focus}" row commissions a body-forge run but grounds no gap kind — the forge runs over gap records (a commission without a gap is incoherent)`, `focusTable.${focus}.gapKind`);
    }
    if (action.gapKind !== null && action.knowledgeKind === null) {
      return fail('policy_invalid', `the "${focus}" row grounds a gap kind but relates to no knowledge kind — the revision's knowledge annotation is the brain-informed half of the improvement`, `focusTable.${focus}.knowledgeKind`);
    }
  }
  return ok(deepFreeze({
    version: v.version,
    focusTable: deepFreeze({
      strategy_revision: table.strategy_revision,
      model_recalibration: table.model_recalibration,
      data_pipeline: table.data_pipeline,
      risk_policy: table.risk_policy,
      execution_quality: table.execution_quality,
      none: table.none,
    } as Readonly<Record<LearningFocus, FocusAction>>),
    requiresHoldout: v.requiresHoldout,
  }));
}

// ---------------------------------------------------------------------------
// The default policy (the declared interpretation)
// ---------------------------------------------------------------------------

/**
 * The DEFAULT improvement policy — the DECLARED interpretation of how
 * T033's focus suggestions become improvement actions (flagged for Tech
 * Lead ratification, the firm-memory precedent):
 *
 *   - `strategy_revision` (an adverse gap attributed to the decision, or
 *     unattributed): the org's world-model capability failed — ground a
 *     REGIME gap (the regime/behavior capability the curriculum's
 *     synthetic-regimes rung retrains), relate to DECISION_PATTERN
 *     knowledge, and commission the strategy bodies' refinement.
 *   - `model_recalibration` (an adverse/projection calibration fact):
 *     ground a REGIME gap (the miscalibrated projection evidences the
 *     world-model gap), relate to MODEL_CALIBRATION knowledge, and
 *     commission (the recalibrated models ship as refined skills).
 *   - `data_pipeline` (a data-lag attribution): an infrastructure
 *     latency fact — NO curriculum gap (the honest null: no ladder rung
 *     remediates pipeline latency), relate to DATA_LATENCY knowledge
 *     (the brain still learns it; the feed carries it), no commission.
 *   - `risk_policy`: ground a RISK gap (the risk-capability failure the
 *     historical-replay rung remediates), relate to DECISION_PATTERN
 *     knowledge, and commission.
 *   - `execution_quality` (shortfall/no-execution): ground an EXECUTION
 *     gap (the microstructure rung's remediation), relate to
 *     DECISION_PATTERN knowledge, and commission.
 *   - `none` (as-expected/averted/unbenchmarked outcomes): no gap, no
 *     annotation, no commission — the loop still feeds the Firm Brain.
 */
export const DEFAULT_IMPROVEMENT_POLICY: ImprovementPolicy = deepFreeze({
  version: 'improvement@1.0.0',
  focusTable: deepFreeze({
    strategy_revision: { gapKind: 'regime', knowledgeKind: 'decision_pattern', commission: true },
    model_recalibration: { gapKind: 'regime', knowledgeKind: 'model_calibration', commission: true },
    data_pipeline: { gapKind: null, knowledgeKind: 'data_latency', commission: false },
    risk_policy: { gapKind: 'risk', knowledgeKind: 'decision_pattern', commission: true },
    execution_quality: { gapKind: 'execution', knowledgeKind: 'decision_pattern', commission: true },
    none: { gapKind: null, knowledgeKind: null, commission: false },
  } as Readonly<Record<LearningFocus, FocusAction>>),
  requiresHoldout: true,
});

/** Validate the default policy once at module load (a broken default is a construction bug). */
export const VALIDATED_DEFAULT_POLICY: ImprovementPolicy = (() => {
  const result = validateImprovementPolicy(DEFAULT_IMPROVEMENT_POLICY);
  if (!result.ok) throw new Error(`default improvement policy bug: ${result.errors.map((error) => `${error.code}: ${error.message}`).join('; ')}`);
  return result.value;
})();
