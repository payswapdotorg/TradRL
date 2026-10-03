/**
 * @tradrl/firm-memory — THE KNOWLEDGE CLAIM: the typed, never-prose
 * content of one firm-knowledge unit — WHAT the firm now knows, as a
 * closed-vocabulary record over (kind, polarity, dimension, lagBand).
 *
 * THE FAMILY LAW (the dedupe/contradiction basis): two claims belong
 * to the SAME FAMILY iff they share (scope, kind, dimension, lagBand)
 * — polarity EXCLUDED. Within a family exactly two claims can exist
 * (the kind's opposing pair); a second polarity in a family is a
 * CONTRADICTION (a typed record in the contradiction register, never
 * a silent overwrite). The family key ({@link claimFamilyKey}) is the
 * canonical JSON of the discriminating fields — byte-stable, the
 * chain's and the register's addressing basis.
 *
 * THE TYPED FACTS PER KIND (never a prose blob):
 *   - `decision_pattern`  — the implicated decision dimension (T033's
 *                           decision payload, mirrored: timing / sizing
 *                           / selection / price / risk_calibration /
 *                           unresolved) + the harm polarity;
 *   - `market_behavior`   — the position-relative move polarity
 *                           (adverse / favorable);
 *   - `model_calibration` — the exact over/under-projection polarity;
 *   - `data_latency`      — the typed lag band (sub_second / seconds /
 *                           minutes / hours_plus) + the harm polarity.
 *
 * Claims are derived, never hand-authored: the SERVICE lifts T033's
 * typed post-mortem hypotheses into them (vocabulary.ts's derivation
 * laws); the MINT below re-validates every coherence law so a
 * hand-forged claim is inexpressible.
 */

import { fail, ok, type FirmMemoryResult } from './errors';
import { canonicalJson, isNonEmptyString, isRecord } from './primitives';
import { isDecisionDimensionMirror, type DecisionDimensionMirror } from './outcome-mirror';
import {
  isLagBand,
  isPolarityForKind,
  polaritiesForKind,
  requireKnowledgeKind,
  requirePolarityForKind,
  type ClaimPolarity,
  type KnowledgeKind,
  type LagBand,
} from './vocabulary';

// ---------------------------------------------------------------------------
// The claim record
// ---------------------------------------------------------------------------

/**
 * One knowledge claim — the typed content of a firm-knowledge unit
 * (see module header). JSON-serializable, deeply frozen, closed-
 * vocabulary; the mint enforces the kind↔dimension/lagBand/polarity
 * coherence laws.
 */
export interface KnowledgeClaim {
  /** The knowledge kind (closed vocabulary — the T033 attribution class it promotes). */
  readonly kind: KnowledgeKind;
  /** The claim's polarity (the kind's opposing pair — the contradiction basis). */
  readonly polarity: ClaimPolarity;
  /** The implicated decision dimension (`decision_pattern` only; null otherwise). */
  readonly dimension: DecisionDimensionMirror | null;
  /** The typed lag band (`data_latency` only; null otherwise). */
  readonly lagBand: LagBand | null;
}

/** Guard: a knowledge claim (structural; the mint enforces the coherence laws). */
export function isKnowledgeClaim(v: unknown): v is KnowledgeClaim {
  if (!isRecord(v)) return false;
  if (typeof v.kind !== 'string') return false;
  if (typeof v.polarity !== 'string') return false;
  if (v.dimension !== null && !(typeof v.dimension === 'string' && isDecisionDimensionMirror(v.dimension))) return false;
  if (v.lagBand !== null && !isLagBand(v.lagBand)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The family law
// ---------------------------------------------------------------------------

/** The discriminating fields of a family (everything but the polarity — plus the scope, supplied by the caller). */
export interface ClaimScope {
  readonly tenant: string;
  readonly project: string;
}

/**
 * The family key: the canonical JSON of (scope, kind, dimension,
 * lagBand) — polarity EXCLUDED (two opposing claims in one family are
 * the contradiction register's whole business). Byte-stable, the
 * dedupe/contradiction/serving-projection addressing basis.
 */
export function claimFamilyKey(claim: KnowledgeClaim, scope: ClaimScope): string {
  return canonicalJson({
    tenant: scope.tenant,
    project: scope.project,
    kind: claim.kind,
    dimension: claim.dimension,
    lagBand: claim.lagBand,
  });
}

/**
 * `true` iff the two claims are OPPOSING members of the same family
 * (same discriminating fields, opposite polarity) — the contradiction
 * predicate.
 */
export function claimsContradict(a: KnowledgeClaim, b: KnowledgeClaim): boolean {
  if (a.kind !== b.kind) return false;
  if (a.dimension !== b.dimension || a.lagBand !== b.lagBand) return false;
  if (a.polarity === b.polarity) return false;
  // Same family, different polarity: opposing iff both are legal for the kind (the mint guarantees this for valid claims).
  return isPolarityForKind(a.kind, a.polarity) && isPolarityForKind(b.kind, b.polarity);
}

/**
 * The canonical claim ordering (determinism is a construction law):
 * kind ascending, then dimension, then lagBand, then polarity — the
 * batch processing order and the tie-breaks' basis.
 */
export function claimOrder(a: KnowledgeClaim, b: KnowledgeClaim): number {
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  const dimensionA = a.dimension ?? '';
  const dimensionB = b.dimension ?? '';
  if (dimensionA !== dimensionB) return dimensionA < dimensionB ? -1 : 1;
  const bandA = a.lagBand ?? '';
  const bandB = b.lagBand ?? '';
  if (bandA !== bandB) return bandA < bandB ? -1 : 1;
  if (a.polarity !== b.polarity) return a.polarity < b.polarity ? -1 : 1;
  return 0;
}

// ---------------------------------------------------------------------------
// The mint
// ---------------------------------------------------------------------------

/**
 * Mint (validate) one knowledge claim — the typed-error site:
 * `unknown_knowledge_kind` on a foreign kind; `unknown_polarity` on a
 * foreign polarity; `invalid_state` on kind/polarity incoherence or a
 * discriminator that does not belong to the kind (a dimension on a
 * market_behavior claim, a lag band on a decision_pattern, a NULL
 * discriminator where the kind requires one).
 */
export function mintKnowledgeClaim(v: unknown, path = 'claim'): FirmMemoryResult<KnowledgeClaim> {
  if (!isRecord(v)) return fail('invalid_type', `${path} must be an object { kind, polarity, dimension, lagBand }`, path);
  const kindResult = requireKnowledgeKind(v.kind);
  if (!kindResult.ok) return fail(kindResult.errors[0].code, kindResult.errors[0].message, `${path}.kind`);
  const kind = kindResult.value;
  const polarityResult = requirePolarityForKind(kind, v.polarity);
  if (!polarityResult.ok) return fail(polarityResult.errors[0].code, polarityResult.errors[0].message, `${path}.polarity`);

  // --- The discriminator coherence laws (per kind) --------------------------------
  const needsDimension = kind === 'decision_pattern';
  const needsLagBand = kind === 'data_latency';
  if (needsDimension) {
    if (v.dimension === null || v.dimension === undefined || !isDecisionDimensionMirror(v.dimension)) {
      return fail('invalid_field', `${path}.dimension must be a decision dimension (timing, sizing, selection, price, risk_calibration, unresolved) — a decision_pattern claim is dimension-keyed`, `${path}.dimension`);
    }
    if (v.lagBand !== null && v.lagBand !== undefined) {
      return fail('invalid_state', `${path}.lagBand must be null on a decision_pattern claim — the lag band belongs to data_latency claims only`, `${path}.lagBand`);
    }
    return ok({ kind, polarity: polarityResult.value, dimension: v.dimension, lagBand: null });
  }
  if (needsLagBand) {
    if (v.lagBand === null || v.lagBand === undefined || !isLagBand(v.lagBand)) {
      return fail('invalid_field', `${path}.lagBand must be a lag band (sub_second, seconds, minutes, hours_plus) — a data_latency claim is band-keyed`, `${path}.lagBand`);
    }
    if (v.dimension !== null && v.dimension !== undefined) {
      return fail('invalid_state', `${path}.dimension must be null on a data_latency claim — the dimension belongs to decision_pattern claims only`, `${path}.dimension`);
    }
    return ok({ kind, polarity: polarityResult.value, dimension: null, lagBand: v.lagBand });
  }
  // market_behavior / model_calibration: no discriminator at all (the polarity IS the discriminator).
  if (v.dimension !== null && v.dimension !== undefined) {
    return fail('invalid_state', `${path}.dimension must be null on a ${kind} claim — no dimension discriminator exists for this kind`, `${path}.dimension`);
  }
  if (v.lagBand !== null && v.lagBand !== undefined) {
    return fail('invalid_state', `${path}.lagBand must be null on a ${kind} claim — no lag-band discriminator exists for this kind`, `${path}.lagBand`);
  }
  return ok({ kind, polarity: polarityResult.value, dimension: null, lagBand: null });
}

/** The kind's opposing polarity for a VALID claim (the contradiction predicate's helper). */
export function oppositeOf(claim: KnowledgeClaim): ClaimPolarity {
  const [a, b] = polaritiesForKind(claim.kind);
  return claim.polarity === a ? b : a;
}

/** Human-readable claim summary (logs/messages only — never a data path). */
export function describeClaim(claim: KnowledgeClaim): string {
  const discriminator = claim.dimension !== null ? `/${claim.dimension}` : claim.lagBand !== null ? `/${claim.lagBand}` : '';
  return `${claim.kind}${discriminator}:${claim.polarity}`;
}

// Re-export the scope guard helper (scope presence is checked at the record mint; kept here for symmetry).
export { isNonEmptyString as isScopeStringRef };
