/**
 * @tradrl/outcome-learning — the POST-MORTEM DRAFT GENERATOR: the
 * structured drafts over the learned outcomes (Work Order T033:
 * "generate post-mortem drafts with attribution (decision,
 * market-move, model-error, data-lag classes — each a typed record,
 * never prose-only)").
 *
 * THE GENERATION LAW ({@link generatePostMortemDrafts}): for every
 * learned outcome, in ordinal order, whose class the policy warrants
 * and which has NO post-mortem yet, emit ONE draft:
 *   - `expected` / `happened` / `gap` — the subject outcome record's
 *     own blocks, carried BY VALUE (byte-stable denormalization);
 *   - the typed hypotheses, each emitted IFF its typed evidence is
 *     present (evidence-gated emission — never a vacuous hypothesis):
 *       * `decision` — the classes that implicate the decision's own
 *         parameters (adverse_gap, execution_shortfall, no_execution);
 *         the draft's dimension is `unresolved` (the honest draft —
 *         single-sample evidence does not discriminate timing from
 *         sizing from price; downstream refinement narrows by APPEND);
 *       * `market_move` — the retained decision facts + the caller's
 *         mark facts for the (venue, instrument), with a move STRICTLY
 *         beyond the policy threshold; the direction is POSITION-
 *         RELATIVE (a buy that watched the price fall is `adverse`);
 *       * `model_error` — a declared expectation that missed beyond
 *         tolerance (adverse or favorable — an under-projection is a
 *         calibration fact); the draft's kind is `unresolved`;
 *       * `data_lag` — a retained fill whose availability instant is
 *         STRICTLY after the decision's evidence instant (the L4
 *         fact, with the exact lag in milliseconds);
 *   - the confidences come from the POLICY (the drafter's declared
 *     heuristics — fixed decimals, never ambient, never per-record
 *     inventions), and the list is emitted in the canonical order
 *     (confidence descending, class ascending — the mint enforces).
 *
 * Drafts are APPENDED (never rewritten): a refined draft for the same
 * outcome arrives as a strictly-later record (supersession by
 * append — the T011 trial-progression precedent, enforced by the
 * post-mortem log's typed `postmortem_log_rewrite`).
 */

import {
  appendPostMortem,
  deepFreeze,
  fail,
  hypothesisOrder,
  isTimestampMs,
  mintPostMortem,
  ok,
  signedAbs,
  signedCompare,
  signedSubtract,
  type AttributionHypothesis,
  type OutcomesResult,
  type OutcomeRecord,
  type PostMortemRecord,
  type TimestampMs,
} from './imports';
import { validatePostMortemDraftPolicy, type PostMortemDraftPolicy } from './policy';
import type { MarkFactsMirror } from './book-mirror';
import { isMarkFactsMirror } from './book-mirror';
import type { OutcomeLearningState } from './state';

// ---------------------------------------------------------------------------
// The draft generation inputs
// ---------------------------------------------------------------------------

/** The draft generation inputs: the mark facts (keyed (venue, instrument)) + the injected instant. */
export interface PostMortemDraftInputs {
  /** The mark facts the market_move hypotheses consume (optional — absent marks simply emit no market_move hypothesis). */
  readonly markFacts?: readonly unknown[];
  /** The injected draft instant (>= every subject outcome's instant — L4). */
  readonly at: TimestampMs;
}

/** The product of one draft generation pass. */
export interface PostMortemDraftResult {
  readonly state: OutcomeLearningState;
  /** The drafts appended this pass, in ordinal order. */
  readonly drafts: readonly PostMortemRecord[];
}

// ---------------------------------------------------------------------------
// The generator
// ---------------------------------------------------------------------------

/**
 * Generate post-mortem drafts for every warranted, not-yet-post-
 * mortemed learned outcome (in ordinal order — deterministic). The
 * post-mortem log's append laws fire per draft (`lineage_gap` /
 * `tenant_mismatch` / `l4_boundary_violation` / `postmortem_log_rewrite`
 * — all impossible by construction here, but the log testifies).
 */
export function generatePostMortemDrafts(state: OutcomeLearningState, policy: unknown, inputs: PostMortemDraftInputs): OutcomesResult<PostMortemDraftResult> {
  if (typeof state !== 'object' || state === null || !Array.isArray((state as { outcomeLog?: { records?: unknown } }).outcomeLog?.records)) {
    return fail('invalid_type', 'generatePostMortemDrafts requires a valid outcome-learning state');
  }
  const policyResult = validatePostMortemDraftPolicy(policy);
  if (!policyResult.ok) return policyResult;
  const draftPolicy = policyResult.value;
  if (typeof inputs !== 'object' || inputs === null || !isTimestampMs(inputs.at)) {
    return fail('invalid_field', 'the draft inputs carry their injected instant (at) — no ambient clock', 'at');
  }

  // The mark facts table (unique per (venue, instrument)).
  const marks = new Map<string, MarkFactsMirror>();
  for (let index = 0; index < (inputs.markFacts ?? []).length; index++) {
    const one = inputs.markFacts?.[index];
    if (!isMarkFactsMirror(one)) {
      return fail('invalid_field', `markFacts[${index}] fails the mirrored guard (venue, instrument, markAtDecision, markAtWindow)`, `markFacts[${index}]`);
    }
    const key = `${one.venue}|${one.instrument}`;
    if (marks.has(key)) {
      return fail('invalid_field', `markFacts[${index}] duplicates the marks for (${key}) — one mark-facts record per instrument`, `markFacts[${index}]`);
    }
    marks.set(key, one);
  }

  const factsByOutcome = new Map(state.outcomeFacts.map((entry) => [entry.outcomeRecordRef, entry]));
  const postMortemed = new Set(state.postMortemLog.records.map((record) => record.subject.outcomeRecordRef));
  const drafts: PostMortemRecord[] = [];
  let postMortemLog = state.postMortemLog;

  for (const outcome of state.outcomeLog.records) {
    if (postMortemed.has(outcome.outcomeId)) continue; // already post-mortemed — refinement supersedes by APPEND, not by this pass
    if (!draftPolicy.warrantedClasses.includes(outcome.outcomeClass)) continue;
    const draft = mintDraft(outcome, draftPolicy, factsByOutcome.get(outcome.outcomeId) ?? null, marks, inputs.at, postMortemLog.records.length + 1, postMortemLog.head);
    if (!draft.ok) return draft;
    const appended = appendPostMortem(state.outcomeLog, postMortemLog, draft.value);
    if (!appended.ok) return appended;
    postMortemLog = appended.value;
    drafts.push(draft.value);
    postMortemed.add(outcome.outcomeId);
  }

  return ok(deepFreeze({
    state: deepFreeze({ ...state, postMortemLog }),
    drafts: Object.freeze(drafts),
  }));
}

/** Mint ONE draft (the module header's emission laws; the canonical hypothesis ordering is enforced by the mint). */
function mintDraft(
  outcome: OutcomeRecord,
  policy: PostMortemDraftPolicy,
  facts: { readonly venue: string; readonly instrument: string; readonly side: 'buy' | 'sell'; readonly decisionAt: TimestampMs; readonly fills: readonly string[]; readonly latestAvailableAt: TimestampMs | null } | null,
  marks: Map<string, MarkFactsMirror>,
  at: TimestampMs,
  ordinal: number,
  priorChainHead: string,
): OutcomesResult<PostMortemRecord> {
  const hypotheses: AttributionHypothesis[] = [];
  const evidence = [...outcome.evidence];

  // --- decision (the classes that implicate the decision's own parameters) -------------
  if (outcome.outcomeClass === 'adverse_gap' || outcome.outcomeClass === 'execution_shortfall' || outcome.outcomeClass === 'no_execution') {
    hypotheses.push({
      class: 'decision',
      confidence: policy.confidences.decision,
      detail: { dimension: 'unresolved' }, // the honest draft: single-sample evidence does not discriminate
      evidence: [{ kind: 'shadow_outcome', ref: outcome.lineage.shadowOutcomeRef }, { kind: 'decision', ref: outcome.decision.decisionRef }],
      note: null,
    });
  }

  // --- market_move (retained decision facts + mark facts + a move beyond the threshold) ----
  if (facts !== null) {
    const markFacts = marks.get(`${facts.venue}|${facts.instrument}`);
    if (markFacts !== undefined) {
      const move = signedSubtract(markFacts.markAtWindow, markFacts.markAtDecision);
      const beyondThreshold = signedCompare(signedAbs(move), policy.marketMoveThreshold) > 0;
      if (beyondThreshold) {
        // The direction is POSITION-RELATIVE: the decision BUILT a position in its side's direction.
        const favorable = facts.side === 'buy' ? signedCompare(move, '0') > 0 : signedCompare(move, '0') < 0;
        hypotheses.push({
          class: 'market_move',
          confidence: policy.confidences.marketMove,
          detail: { markAtDecision: markFacts.markAtDecision, markAtWindow: markFacts.markAtWindow, direction: favorable ? 'favorable' : 'adverse' },
          evidence: [{ kind: 'mark_fact', ref: `${facts.venue}|${facts.instrument}` }, { kind: 'shadow_outcome', ref: outcome.lineage.shadowOutcomeRef }],
          note: null,
        });
        evidence.push({ kind: 'mark_fact', ref: `${facts.venue}|${facts.instrument}` });
      }
    }
  }

  // --- model_error (a declared expectation that missed beyond tolerance) -------------------
  if ((outcome.outcomeClass === 'adverse_gap' || outcome.outcomeClass === 'favorable_gap') && outcome.expectation.expectedRealized !== null) {
    hypotheses.push({
      class: 'model_error',
      confidence: policy.confidences.modelError,
      detail: { projected: outcome.expectation.expectedRealized, realized: outcome.realization.realizedOutcome, kind: 'unresolved' }, // the honest draft kind
      evidence: [{ kind: 'shadow_outcome', ref: outcome.lineage.shadowOutcomeRef }, { kind: 'intent', ref: outcome.decision.intentRef }],
      note: null,
    });
  }

  // --- data_lag (a retained fill whose availability is strictly after the decision's evidence) ------
  if (facts !== null && facts.latestAvailableAt !== null && (facts.latestAvailableAt as number) > (facts.decisionAt as number)) {
    const lagMs = (facts.latestAvailableAt as number) - (facts.decisionAt as number);
    hypotheses.push({
      class: 'data_lag',
      confidence: policy.confidences.dataLag,
      detail: { decisionAt: facts.decisionAt, availableAt: facts.latestAvailableAt, lagMs },
      evidence: facts.fills.map((fill) => ({ kind: 'shadow_fill' as const, ref: fill })),
      note: null,
    });
  }

  // The canonical order (confidence desc, class asc) — the contracts'
  // hypothesisOrder IS the law; the mint re-enforces it.
  hypotheses.sort(hypothesisOrder);

  return mintPostMortem({
    ordinal,
    subject: {
      outcomeRecordRef: outcome.outcomeId,
      decisionRef: outcome.decision.decisionRef,
      intentRef: outcome.decision.intentRef,
      outcomeClass: outcome.outcomeClass,
    },
    expected: {
      expectedQuantity: outcome.expectation.expectedQuantity,
      expectedRealized: outcome.expectation.expectedRealized,
      tolerance: outcome.expectation.tolerance,
    },
    happened: {
      disposition: outcome.decision.disposition,
      filledQuantity: outcome.realization.filledQuantity,
      realizedOutcome: outcome.realization.realizedOutcome,
      feeTotal: outcome.realization.feeTotal,
      notionalTotal: outcome.realization.notionalTotal,
    },
    gap: {
      quantityShortfall: outcome.deviation.quantityShortfall,
      realizedGap: outcome.deviation.realizedGap,
      withinTolerance: outcome.deviation.withinTolerance,
    },
    hypotheses,
    evidence,
    lineage: {
      tenant: outcome.tenant,
      project: outcome.project,
      shadowSessionRef: outcome.lineage.shadow.sessionId,
      shadowOutcomeRef: outcome.lineage.shadowOutcomeRef,
      trajectoryRef: outcome.lineage.trajectoryRef,
      experiment: outcome.lineage.experiment === null ? null : { experimentRef: outcome.lineage.experiment.experimentRef, trialRef: outcome.lineage.experiment.trialRef },
    },
    asOf: at,
    priorChainHead,
  });
}
