/**
 * @tradrl/outcomes — THE EVALUATION HOOKS: the typed learning signals
 * T035 (continuous autonomous improvement) will consume to drive
 * improvement (Work Order T033: "the evaluation-hook shapes T035 will
 * later consume to drive autonomous improvement").
 *
 * THE BOUNDARY (R27 + L7, mirrored from the evaluation lane's
 * discipline): a hook INFORMS, never decides. It carries NO acceptance
 * verdict, NO body-version proposal, NO capability change — only the
 * typed facts (the outcome class, the gap magnitudes, the dominant
 * attribution when a post-mortem exists) and a `suggestedFocus` drawn
 * from a closed vocabulary. The improver (T035) owns every decision;
 * Body Version creation stays with the body forge; the Firm Brain that
 * reads the underlying records is T034.
 *
 * THE COMPILATION ({@link compileOutcomeLearningHook}): a PURE,
 * DETERMINISTIC function of (the outcome record, the freshest
 * post-mortem or NULL) -> {@link OutcomeLearningHook}. The hook id is
 * content-addressed over the canonical content — same inputs, same
 * bytes, same id (L9: the hook is derived data, its identity derived
 * with it).
 *
 * THE FOCUS MAPPING (deterministic, declared):
 *   - `adverse_gap`          -> the dominant attribution's focus
 *                               (decision -> strategy_revision,
 *                               model_error -> model_recalibration,
 *                               data_lag -> data_pipeline,
 *                               market_move -> none — the market is
 *                               not ours to fix; no attribution ->
 *                               strategy_revision);
 *   - `favorable_gap`        -> model_recalibration (an under-
 *                               projection is a calibration fact);
 *   - `as_expected` / `unbenchmarked_fill` / `averted` -> none;
 *   - `execution_shortfall` / `no_execution` -> execution_quality.
 */

import type { AttributionClass } from './attribution';
import { requireOutcomeClass, type OutcomeClass } from './classification';
import { fail, ok, type OutcomesResult } from './errors';
import type { EvidenceRef } from './evidence';
import { mintLearningHookId } from './ids';
import { canonicalJson, deepFreeze, fnv1a32Hex, type JsonValue, type TimestampMs } from './primitives';
import type { PostMortemRecord } from './postmortem';
import type { OutcomeRecord } from './outcome-record';

// ---------------------------------------------------------------------------
// The closed focus vocabulary
// ---------------------------------------------------------------------------

/** The closed learning-focus vocabulary (what the hook suggests the improver look at — a suggestion, never a command). */
export const LEARNING_FOCUS = [
  'strategy_revision',
  'model_recalibration',
  'data_pipeline',
  'risk_policy',
  'execution_quality',
  'none',
] as const;

/** One learning focus. */
export type LearningFocus = (typeof LEARNING_FOCUS)[number];

/** Guard: a learning focus. */
export function isLearningFocus(v: unknown): v is LearningFocus {
  return typeof v === 'string' && (LEARNING_FOCUS as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// The hook record
// ---------------------------------------------------------------------------

/**
 * One outcome-learning hook — the typed signal per learned outcome
 * (see module header: it informs, never decides). JSON-serializable,
 * deeply frozen, content-addressed.
 */
export interface OutcomeLearningHook {
  /** Content-addressed identity: `olh:` + digest of the canonical content. */
  readonly hookId: string;
  /** The subject outcome record (`out:`). */
  readonly outcomeRecordRef: string;
  readonly decisionRef: string;
  readonly intentRef: string;
  readonly tenant: string;
  readonly project: string;
  readonly outcomeClass: OutcomeClass;
  /** The realized gap (SIGNED exact decimal; NULL when unbenchmarked). */
  readonly realizedGap: string | null;
  /** The quantity shortfall (SIGNED exact decimal; NULL when unmeasurable). */
  readonly quantityShortfall: string | null;
  /** The freshest post-mortem's dominant hypothesis (NULL when no post-mortem exists). */
  readonly dominantAttribution: { readonly class: AttributionClass; readonly confidence: string } | null;
  /** The deterministic focus suggestion (a suggestion, never a command — R27 boundary). */
  readonly suggestedFocus: LearningFocus;
  readonly evidence: readonly EvidenceRef[];
  readonly asOf: TimestampMs;
}

/** The canonical content tree of a hook (everything except the content-addressed id). */
function hookContentTree(hook: Omit<OutcomeLearningHook, 'hookId'>): JsonValue {
  return {
    outcomeRecordRef: hook.outcomeRecordRef,
    decisionRef: hook.decisionRef,
    intentRef: hook.intentRef,
    tenant: hook.tenant,
    project: hook.project,
    outcomeClass: hook.outcomeClass,
    realizedGap: hook.realizedGap,
    quantityShortfall: hook.quantityShortfall,
    dominantAttribution: hook.dominantAttribution === null ? null : { class: hook.dominantAttribution.class, confidence: hook.dominantAttribution.confidence },
    suggestedFocus: hook.suggestedFocus,
    evidence: hook.evidence as unknown as JsonValue,
    asOf: hook.asOf,
  };
}

/** The attribution-class -> focus table (the adverse-gap arm of the mapping). */
const ATTRIBUTION_FOCUS: Readonly<Record<AttributionClass, LearningFocus>> = {
  decision: 'strategy_revision',
  model_error: 'model_recalibration',
  data_lag: 'data_pipeline',
  market_move: 'none',
};

/** The dominant hypothesis of a post-mortem (max confidence; ties break by the canonical class order). */
function dominantAttributionOf(postMortem: PostMortemRecord | null): { readonly class: AttributionClass; readonly confidence: string } | null {
  if (postMortem === null || postMortem.hypotheses.length === 0) return null;
  // The mint guarantees the canonical ordering (confidence desc, class asc) — the head is the dominant one.
  const head = postMortem.hypotheses[0] as { class: AttributionClass; confidence: string };
  return { class: head.class, confidence: head.confidence };
}

/** The deterministic focus mapping (see module header). */
function focusOf(outcomeClass: OutcomeClass, dominant: { readonly class: AttributionClass } | null): LearningFocus {
  switch (outcomeClass) {
    case 'adverse_gap':
      return dominant === null ? 'strategy_revision' : ATTRIBUTION_FOCUS[dominant.class];
    case 'favorable_gap':
      return 'model_recalibration';
    case 'as_expected':
    case 'unbenchmarked_fill':
    case 'averted':
      return 'none';
    case 'execution_shortfall':
    case 'no_execution':
      return 'execution_quality';
  }
}

/**
 * Compile one outcome-learning hook — the pure, deterministic function
 * of (the outcome record, the freshest post-mortem or NULL). The
 * post-mortem's `asOf` may not precede the outcome's (the typed
 * `l4_boundary_violation` — a hook may not ground itself in a
 * post-mortem from before the outcome existed).
 */
export function compileOutcomeLearningHook(outcome: OutcomeRecord, postMortem: PostMortemRecord | null): OutcomesResult<OutcomeLearningHook> {
  const classResult = requireOutcomeClass(outcome.outcomeClass);
  if (!classResult.ok) return classResult;
  if (postMortem !== null) {
    if (postMortem.subject.outcomeRecordRef !== outcome.outcomeId) {
      return fail('lineage_gap', `the post-mortem ${postMortem.postMortemId} subjects ${postMortem.subject.outcomeRecordRef}, not ${outcome.outcomeId} — a hook grounds itself in its own outcome's post-mortem`);
    }
    if ((postMortem.asOf as number) < (outcome.asOf as number)) {
      return fail('l4_boundary_violation', `the post-mortem ${postMortem.postMortemId} predates the outcome it explains — a hook may not ground itself in future evidence (L4)`);
    }
  }
  const dominant = dominantAttributionOf(postMortem);
  const content: Omit<OutcomeLearningHook, 'hookId'> = {
    outcomeRecordRef: outcome.outcomeId,
    decisionRef: outcome.decision.decisionRef,
    intentRef: outcome.decision.intentRef,
    tenant: outcome.tenant,
    project: outcome.project,
    outcomeClass: classResult.value,
    realizedGap: outcome.deviation.realizedGap,
    quantityShortfall: outcome.deviation.quantityShortfall,
    dominantAttribution: dominant,
    suggestedFocus: focusOf(classResult.value, dominant),
    evidence: [...outcome.evidence, ...(postMortem?.evidence ?? [])],
    asOf: postMortem === null ? outcome.asOf : postMortem.asOf,
  };
  return ok(deepFreeze({ ...content, hookId: mintLearningHookId(fnv1a32Hex(canonicalJson(hookContentTree(content)))) }));
}
