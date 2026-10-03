/**
 * @tradrl/firm-memory — THE KNOWLEDGE VOCABULARY: the closed kind/
 * polarity/lag-band vocabularies firm knowledge is expressed in, plus
 * the DETERMINISTIC derivations that lift T033's typed post-mortem
 * hypotheses into claims (Work Order T034: "the knowledge vocabulary
 * (closed; typed error on unknown)").
 *
 * THE CLOSED KIND VOCABULARY (four members — one per T033 attribution
 * class; a fifth is the typed `unknown_knowledge_kind`):
 *   - `decision_pattern`   ← `decision` hypotheses (the implicated
 *                             decision dimension recurs across gaps);
 *   - `market_behavior`    ← `market_move` hypotheses (the market
 *                             systematically moves with/against our
 *                             positions between decision and window);
 *   - `model_calibration`  ← `model_error` hypotheses (the projecting
 *                             model systematically over/under-projects);
 *   - `data_latency`       ← `data_lag` hypotheses (information
 *                             systematically arrives after the
 *                             decision, in a typed lag band).
 *
 * THE POLARITY LAW (each kind admits exactly two OPPOSING polarity
 * values — the contradiction register's whole basis):
 *   - `decision_pattern` / `data_latency` derive their polarity from
 *     the supporting OUTCOME class (the declared interpretation:
 *     adverse_gap, execution_shortfall and no_execution ground
 *     `harmful` — the implicated pattern hurt the decision's intent;
 *     favorable_gap grounds `helpful`; as_expected, averted and
 *     unbenchmarked_fill are NEUTRAL and ground no polarity);
 *   - `market_behavior` carries the hypothesis payload's
 *     position-relative direction (`adverse` / `favorable`);
 *   - `model_calibration` derives its bias EXACTLY from the payload's
 *     projected-vs-realized pair (`over_projection` when projected >
 *     realized, `under_projection` when projected < realized; an
 *     exact match grounds no claim).
 *
 * THE LAG-BAND LAW (closed, derived exactly from the data-lag
 * payload's lagMs): `sub_second` (< 1000ms), `seconds` (< 60s),
 * `minutes` (< 60m), `hours_plus` (>= 60m).
 */

import { fail, ok, type FirmMemoryResult } from './errors';

// ---------------------------------------------------------------------------
// The closed knowledge-kind vocabulary
// ---------------------------------------------------------------------------

/** The closed knowledge-kind vocabulary (four members — one per T033 attribution class; a fifth is an architecture change). */
export const KNOWLEDGE_KINDS = ['decision_pattern', 'market_behavior', 'model_calibration', 'data_latency'] as const;

/** One knowledge kind. */
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

/** Guard: a knowledge kind. */
export function isKnowledgeKind(v: unknown): v is KnowledgeKind {
  return typeof v === 'string' && (KNOWLEDGE_KINDS as readonly string[]).includes(v);
}

/**
 * Require a knowledge kind — the closed-vocabulary enforcement site:
 * an unknown kind string is the typed `unknown_knowledge_kind`, never
 * a silent coercion.
 */
export function requireKnowledgeKind(v: unknown): FirmMemoryResult<KnowledgeKind> {
  if (!isKnowledgeKind(v)) {
    return fail(
      'unknown_knowledge_kind',
      `${JSON.stringify(v)} is not a knowledge kind — the vocabulary is closed: ${KNOWLEDGE_KINDS.join(' | ')} (one per T033 attribution class: decision, market_move, model_error, data_lag)`,
    );
  }
  return ok(v);
}

// ---------------------------------------------------------------------------
// The polarity vocabularies (per kind, exactly two opposing values)
// ---------------------------------------------------------------------------

/** The harm polarity (decision_pattern, data_latency): derived from the supporting outcome class. */
export const HARM_POLARITIES = ['harmful', 'helpful'] as const;

/** One harm polarity. */
export type HarmPolarity = (typeof HARM_POLARITIES)[number];

/** The market-move polarity (market_behavior): the position-relative direction. */
export const MOVE_POLARITIES = ['adverse', 'favorable'] as const;

/** One market-move polarity. */
export type MovePolarity = (typeof MOVE_POLARITIES)[number];

/** The calibration polarity (model_calibration): derived exactly from projected-vs-realized. */
export const CALIBRATION_POLARITIES = ['over_projection', 'under_projection'] as const;

/** One calibration polarity. */
export type CalibrationPolarity = (typeof CALIBRATION_POLARITIES)[number];

/** The union of all polarity values (the claim record's stored field). */
export type ClaimPolarity = HarmPolarity | MovePolarity | CalibrationPolarity;

/** Every polarity value, as one closed list (guard + `unknown_polarity` basis). */
export const CLAIM_POLARITIES: readonly ClaimPolarity[] = [
  ...HARM_POLARITIES,
  ...MOVE_POLARITIES,
  ...CALIBRATION_POLARITIES,
];

/** Guard: any polarity value. */
export function isClaimPolarity(v: unknown): v is ClaimPolarity {
  return typeof v === 'string' && (CLAIM_POLARITIES as readonly string[]).includes(v);
}

/**
 * The polarity values legal for one kind (the kind↔polarity coherence
 * law's basis): a polarity legal for another kind is the typed
 * `invalid_state` at the claim mint.
 */
export function polaritiesForKind(kind: KnowledgeKind): readonly [ClaimPolarity, ClaimPolarity] {
  switch (kind) {
    case 'decision_pattern':
    case 'data_latency':
      return ['harmful', 'helpful'];
    case 'market_behavior':
      return ['adverse', 'favorable'];
    case 'model_calibration':
      return ['over_projection', 'under_projection'];
  }
}

/** Guard: a polarity legal FOR the given kind. */
export function isPolarityForKind(kind: KnowledgeKind, v: unknown): v is ClaimPolarity {
  if (!isClaimPolarity(v)) return false;
  const legal = polaritiesForKind(kind);
  return v === legal[0] || v === legal[1];
}

/**
 * Require a polarity FOR a kind — the typed-error site: a string
 * outside the whole polarity vocabulary is the typed
 * `unknown_polarity`; a value legal for ANOTHER kind is the typed
 * `invalid_state` (kind/polarity incoherence).
 */
export function requirePolarityForKind(kind: KnowledgeKind, v: unknown): FirmMemoryResult<ClaimPolarity> {
  if (!isClaimPolarity(v)) {
    return fail(
      'unknown_polarity',
      `${JSON.stringify(v)} is not a claim polarity — the vocabulary is closed: ${CLAIM_POLARITIES.join(' | ')} (each kind admits exactly two opposing values)`,
    );
  }
  if (!isPolarityForKind(kind, v)) {
    const legal = polaritiesForKind(kind);
    return fail(
      'invalid_state',
      `polarity ${JSON.stringify(v)} is not legal for kind ${kind} — this kind admits exactly ${legal[0]} | ${legal[1]} (the kind/polarity coherence law)`,
    );
  }
  return ok(v);
}

/** The OPPOSITE polarity of a kind's pair (the contradiction predicate's basis; input must be legal for the kind). */
export function oppositePolarity(kind: KnowledgeKind, polarity: ClaimPolarity): ClaimPolarity {
  const [a, b] = polaritiesForKind(kind);
  return polarity === a ? b : a;
}

// ---------------------------------------------------------------------------
// The closed lag-band vocabulary (data_latency's typed discriminator)
// ---------------------------------------------------------------------------

/** The closed lag-band vocabulary (derived exactly from the data-lag payload's lagMs). */
export const LAG_BANDS = ['sub_second', 'seconds', 'minutes', 'hours_plus'] as const;

/** One lag band. */
export type LagBand = (typeof LAG_BANDS)[number];

/** Guard: a lag band. */
export function isLagBand(v: unknown): v is LagBand {
  return typeof v === 'string' && (LAG_BANDS as readonly string[]).includes(v);
}

/**
 * Require a lag band — the typed-error site: an unknown band string is
 * the typed `unknown_lag_band`.
 */
export function requireLagBand(v: unknown): FirmMemoryResult<LagBand> {
  if (!isLagBand(v)) {
    return fail(
      'unknown_lag_band',
      `${JSON.stringify(v)} is not a lag band — the vocabulary is closed: ${LAG_BANDS.join(' | ')} (derived exactly from the data-lag payload's lagMs)`,
    );
  }
  return ok(v);
}

/**
 * Derive the lag band EXACTLY from a data-lag payload's lagMs
 * (deterministic: sub_second < 1000ms <= seconds < 60s <= minutes <
 * 60m <= hours_plus).
 */
export function deriveLagBand(lagMs: number): LagBand {
  if (lagMs < 1_000) return 'sub_second';
  if (lagMs < 60_000) return 'seconds';
  if (lagMs < 3_600_000) return 'minutes';
  return 'hours_plus';
}

// ---------------------------------------------------------------------------
// The outcome-class → harm-polarity derivation (the declared interpretation)
// ---------------------------------------------------------------------------

/** The T033 outcome-class vocabulary, mirrored (the polarity derivation's input; guards in outcome-mirror.ts). */
export const OUTCOME_CLASS_VALUES = [
  'averted',
  'no_execution',
  'execution_shortfall',
  'as_expected',
  'adverse_gap',
  'favorable_gap',
  'unbenchmarked_fill',
] as const;

/** One T033 outcome class (mirrored). */
export type OutcomeClassMirror = (typeof OUTCOME_CLASS_VALUES)[number];

/** Guard: a T033 outcome class (mirrored). */
export function isOutcomeClassMirror(v: unknown): v is OutcomeClassMirror {
  return typeof v === 'string' && (OUTCOME_CLASS_VALUES as readonly string[]).includes(v);
}

/**
 * Derive the harm polarity from the supporting outcome's class (the
 * declared interpretation, deterministic): adverse_gap,
 * execution_shortfall and no_execution ground `harmful`; favorable_gap
 * grounds `helpful`; as_expected, averted and unbenchmarked_fill are
 * NEUTRAL (null — they ground no polarity, so they cannot support a
 * decision_pattern/data_latency claim).
 */
export function harmPolarityOfOutcome(outcomeClass: OutcomeClassMirror): HarmPolarity | null {
  switch (outcomeClass) {
    case 'adverse_gap':
    case 'execution_shortfall':
    case 'no_execution':
      return 'harmful';
    case 'favorable_gap':
      return 'helpful';
    case 'as_expected':
    case 'averted':
    case 'unbenchmarked_fill':
      return null;
  }
}
