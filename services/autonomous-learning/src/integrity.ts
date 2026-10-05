/**
 * @tradrl/autonomous-learning (service) — THE T031 INTEGRITY GATES (Work
 * Order T035): the platform-layer laws the improvement loop runs under,
 * mirrored from research/evaluation-integrity + packages/search-lineage
 * (T031) — the improvement loop IS a search, and its selections must
 * distinguish in-search from holdout evidence (R20/R21, ARCHITECTURE-LOCK
 * L11).
 *
 * THE ADOPTION GATE ({@link evaluateAdoptionGate}): a skill commission is
 * RELEASED to the body forge only when the cited evaluated evidence
 * includes an ATTAINED verdict under a HOLDOUT-classified search trial —
 * the platform mirror of T031's `selected_without_holdout` discipline
 * (extracting a skill from data you searched over and certifying it on
 * the same data is the overfitting trap this gate exists to refuse).
 * In-search-only attained evidence WITHHOLDS the commission as typed
 * refusal data (`selected_without_holdout` — retained, never thrown);
 * empty evidence withholds with `evidence_missing`; present-but-never-
 * attained evidence withholds with `evidence_insufficient` (the T015
 * vocabulary). When the policy drops the holdout requirement
 * (`requiresHoldout: false`), ANY attained verdict releases the
 * commission — the switch is the policy's, never the loop's mood.
 *
 * THE HIDDEN-TRIALS LAW (fail-closed, typed): every evaluation's trial
 * must exist in the RETAINED search record — cited evidence outside the
 * retained search history is the typed `hidden_trials` (the platform
 * mirror of T031's hidden-trials law: a claimed view of the search must
 * name exactly the logged trials). The gate NEVER silently drops an
 * unknown trial: the whole cycle fails closed.
 *
 * THE TRIAL MINT ({@link mintImprovementSearchTrial}): every improvement
 * product (a curriculum revision, a released skill commission) is a
 * search step — the loop mints its append bundle (the
 * `SearchTrialInput` mirror: in-search classification, the product's
 * canonical config, the parent edges from the improvement log's own
 * prior trials) for the caller to append through the REAL
 * `appendSearchTrial`. The improvement DAG grows on the retained record;
 * nothing about the search is forgotten (L11).
 */

import { canonicalJson, deepFreeze, fnv1a32Hex, isNonEmptyString, isRecord, ok } from './primitives';
import { fail, type ImprovementResult, type JsonObject, type TimestampMs } from './primitives';
import type { DataRef, ImprovementTrialId, SplitPolicyRef, TrialId } from './ids';
import type { EvaluatedEvidenceMirror, SearchRecordMirror, SearchTrialInputMirror } from './mirrors';
import { isSearchTrialInputMirror } from './mirrors';
import type { CommissionRefusalReason } from './state';

// ---------------------------------------------------------------------------
// The adoption gate
// ---------------------------------------------------------------------------

/** One grounding evidence entry (the verdicts that released a commission). */
export interface GroundingEvidence {
  readonly verdict: string;
  readonly trial: string;
  /** The trial's search classification at release time (always 'holdout' when the gate requires it). */
  readonly classification: 'in-search' | 'holdout';
}

/** Guard: `GroundingEvidence`. */
export function isGroundingEvidence(v: unknown): v is GroundingEvidence {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.verdict) || !isNonEmptyString(v.trial)) return false;
  return v.classification === 'in-search' || v.classification === 'holdout';
}

/** The adoption gate's verdict: released or withheld, with the typed refusal and the grounding evidence. */
export interface AdoptionVerdict {
  readonly decision: 'commissioned' | 'withheld';
  readonly refusal: CommissionRefusalReason | null;
  /** The evidence that released the commission (empty when withheld). */
  readonly grounding: readonly GroundingEvidence[];
}

/** Guard: `AdoptionVerdict`. */
export function isAdoptionVerdict(v: unknown): v is AdoptionVerdict {
  if (!isRecord(v)) return false;
  if (v.decision !== 'commissioned' && v.decision !== 'withheld') return false;
  if (v.refusal !== null && v.refusal !== 'selected_without_holdout' && v.refusal !== 'evidence_missing' && v.refusal !== 'evidence_insufficient') return false;
  if (!Array.isArray(v.grounding)) return false;
  if (!(v.grounding as readonly unknown[]).every((entry) => isGroundingEvidence(entry))) return false;
  if (v.decision === 'commissioned' && (v.grounding as readonly unknown[]).length === 0) return false;
  return true;
}

/**
 * The adoption gate (see module header). Fail-closed on the hidden-trials
 * law: EVERY evaluation's trial must be held by the retained search
 * record — the typed `hidden_trials` names every unknown trial, and the
 * cycle that carried them never mints a commission.
 */
export function evaluateAdoptionGate(
  search: SearchRecordMirror,
  evaluations: readonly EvaluatedEvidenceMirror[],
  requiresHoldout: boolean,
): ImprovementResult<AdoptionVerdict> {
  // --- The hidden-trials law (fail-closed — never a silent drop) ----------------
  const held = new Map<string, string>();
  for (const entry of search.entries) held.set(entry.trial, entry.classification);
  const unknown: string[] = [];
  for (const evaluation of evaluations) {
    if (!held.has(evaluation.trial)) unknown.push(evaluation.trial);
  }
  if (unknown.length > 0) {
    return fail(
      'hidden_trials',
      `the cited evaluated evidence names trials the retained search record does not hold: ${unknown.map((trial) => JSON.stringify(trial)).join(', ')} — a claimed view of the search must name exactly the logged trials (T031's hidden-trials law; the record holds ${search.entries.length})`,
      'evaluations',
    );
  }

  // --- The holdout distinction (the selection law) --------------------------------
  const holdoutAttained = evaluations.filter(
    (evaluation): evaluation is EvaluatedEvidenceMirror & { readonly trial: string } =>
      evaluation.attained && held.get(evaluation.trial) === 'holdout',
  );
  const attained = evaluations.filter((evaluation) => evaluation.attained);

  if (requiresHoldout) {
    if (holdoutAttained.length > 0) {
      return ok(deepFreeze({
        decision: 'commissioned',
        refusal: null,
        grounding: holdoutAttained.map((evaluation) => deepFreeze({
          verdict: evaluation.verdict,
          trial: evaluation.trial,
          classification: 'holdout' as const,
        })),
      } satisfies AdoptionVerdict));
    }
    if (attained.length > 0) {
      // Attained evidence exists, but every bit of it ran IN-SEARCH: the
      // best-of-N trap. The commission is withheld as retained refusal data.
      return ok(deepFreeze({ decision: 'withheld', refusal: 'selected_without_holdout', grounding: [] } satisfies AdoptionVerdict));
    }
    if (evaluations.length === 0) {
      return ok(deepFreeze({ decision: 'withheld', refusal: 'evidence_missing', grounding: [] } satisfies AdoptionVerdict));
    }
    return ok(deepFreeze({ decision: 'withheld', refusal: 'evidence_insufficient', grounding: [] } satisfies AdoptionVerdict));
  }

  // The policy dropped the holdout requirement: any attained verdict releases.
  if (attained.length > 0) {
    return ok(deepFreeze({
      decision: 'commissioned',
      refusal: null,
      grounding: attained.map((evaluation) => deepFreeze({
        verdict: evaluation.verdict,
        trial: evaluation.trial,
        classification: (held.get(evaluation.trial) ?? 'in-search') as 'in-search' | 'holdout',
      })),
    } satisfies AdoptionVerdict));
  }
  if (evaluations.length === 0) {
    return ok(deepFreeze({ decision: 'withheld', refusal: 'evidence_missing', grounding: [] } satisfies AdoptionVerdict));
  }
  return ok(deepFreeze({ decision: 'withheld', refusal: 'evidence_insufficient', grounding: [] } satisfies AdoptionVerdict));
}

// ---------------------------------------------------------------------------
// The improvement search-trial mint
// ---------------------------------------------------------------------------

/** The improvement product kinds that mint search trials. */
export type ImprovementProductKind = 'curriculum_revision' | 'skill_commission';

/** Guard: an improvement product kind. */
export function isImprovementProductKind(v: unknown): v is ImprovementProductKind {
  return v === 'curriculum_revision' || v === 'skill_commission';
}

/** The search-policy block a cycle supplies for its minted trials (the evaluation discipline the improvement ran under). */
export interface SearchPolicyBlock {
  /** The split-policy ref under which the improvement's evaluation is computed. */
  readonly evaluationPolicy: SplitPolicyRef;
  /** The data-split ids the improvement's evidence consumed (>= 1 — T031's entry law). */
  readonly splits: readonly SplitPolicyRef[];
  /** The dataset refs the improvement's evidence consumed. */
  readonly datasets: readonly DataRef[];
}

/** Guard: `SearchPolicyBlock`. */
export function isSearchPolicyBlock(v: unknown): v is SearchPolicyBlock {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.evaluationPolicy)) return false;
  if (!Array.isArray(v.splits) || (v.splits as readonly unknown[]).length === 0) return false;
  if (!(v.splits as readonly unknown[]).every((split) => isNonEmptyString(split))) return false;
  if (!Array.isArray(v.datasets)) return false;
  return (v.datasets as readonly unknown[]).every((dataset) => isNonEmptyString(dataset));
}

/** The trial-mint input (everything explicit — no ambient state). */
export interface TrialMintInput {
  readonly kind: ImprovementProductKind;
  /** The product's content-addressed id (`alv:`/`als:`) the trial's config cites. */
  readonly productId: string;
  /** The product's canonical config (the opaque optimization config the snapshot store addresses). */
  readonly config: JsonObject;
  /** The backward edges: the improvement log's prior trials of the SAME product kind (the improvement DAG). */
  readonly parents: readonly string[];
  readonly policy: SearchPolicyBlock;
  readonly at: TimestampMs;
  readonly tenant: string;
  readonly project: string;
}

/**
 * Mint one improvement search-trial append bundle: the trial id is
 * content-addressed over the canonical identity content (`alt:` + FNV-1a
 * — the same failure evidence always addresses the same trial), the
 * classification is ALWAYS `in-search` (an improvement proposal is an
 * optimization step; its holdout check is a LATER, separate entry the
 * evaluation lane appends), the config is the product's canonical
 * content, and the parents are the improvement DAG's backward edges.
 */
export function mintImprovementSearchTrial(input: TrialMintInput): ImprovementResult<SearchTrialInputMirror> {
  if (!isImprovementProductKind(input.kind)) {
    return fail('invalid_field', 'the trial kind must be curriculum_revision | skill_commission', 'kind');
  }
  if (!isNonEmptyString(input.productId)) {
    return fail('invalid_field', 'the trial cites its product id (the alv:/als: content address)', 'productId');
  }
  if (!isRecord(input.config)) {
    return fail('invalid_field', 'the trial config is a JSON object (the product\'s canonical content)', 'config');
  }
  if (!Array.isArray(input.parents)) {
    return fail('invalid_field', 'the trial parents are an array of prior trial ids (the improvement DAG)', 'parents');
  }
  if (!(input.parents as readonly unknown[]).every((parent) => isNonEmptyString(parent))) {
    return fail('invalid_field', 'every trial parent is a non-empty trial id', 'parents');
  }
  if (!isSearchPolicyBlock(input.policy)) {
    return fail('invalid_field', 'the trial carries its search policy block { evaluationPolicy, splits, datasets }', 'policy');
  }
  if (typeof input.at !== 'number') {
    return fail('invalid_field', 'the trial carries its injected instant (at)', 'at');
  }
  if (!isNonEmptyString(input.tenant) || !isNonEmptyString(input.project)) {
    return fail('invalid_field', 'the trial carries its scope (tenant/project — L12)', 'tenant');
  }
  const identity = fnv1a32Hex(
    canonicalJson({
      kind: input.kind,
      productId: input.productId,
      config: input.config,
      parents: [...input.parents],
      at: input.at,
      tenant: input.tenant,
      project: input.project,
    } as never),
  );
  const trial = `alt:${identity}` as ImprovementTrialId as unknown as TrialId;
  const bundle: SearchTrialInputMirror = deepFreeze({
    trial,
    arm: null, // the improvement loop runs no comparison arms — the search lane's entries do
    classification: 'in-search',
    config: input.config,
    parents: [...input.parents] as readonly TrialId[],
    splits: [...input.policy.splits],
    datasets: [...input.policy.datasets],
    window: null, // the improvement's evidence window is the caller's concern (the cycle cites the evaluations)
    evaluation_policy: input.policy.evaluationPolicy,
    recorded_at: input.at,
    tenant: input.tenant,
    project: input.project,
  });
  if (!isSearchTrialInputMirror(bundle)) {
    return fail('invalid_field', 'the minted trial bundle failed its guard (a construction bug)');
  }
  return ok(bundle);
}
