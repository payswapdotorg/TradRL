// @tradrl/risk — the strategy-lane structural mirrors: the PORTFOLIO
// STATE (the exposure computation's facts).
//
// STRUCTURAL MIRROR of @tradrl/trading-strategy (T018 — re-declared via
// the same shapes @tradrl/execution-policy's strategy-mirror declares;
// D-003/D-004): field-for-field identical (same names, same brands, same
// optionality, same field-presence matrix), so a REAL
// trading-strategy `PortfolioState` IS a {@link PortfolioStateMirror}
// (mutually assignable, zero casts; proven by src/interop.test.ts
// against the REAL package on this branch). Any change in the
// strategy-lane contracts MUST be mirrored here and vice versa.
//
// WHY THIS MIRROR EXISTS (the Work Order's scope: "ExposureComputation
// — (portfolio-state mirror, market-state mirror, fills) ->
// ExposureRecord"): the risk engine MEASURES WHAT EXISTS — the
// portfolio state is the strategy lane's immutable snapshot of the
// account (positions, cash, the recorded weights and the lineage of the
// run that produced it). T018 owns portfolio CONSTRUCTION (weights,
// targets, drift); THIS lane owns the MEASUREMENT (exposure,
// concentration, leverage, drawdown over the same facts). The engine
// never mutates a portfolio — every measure is a pure function of the
// declared snapshot plus the declared market state and fills.
//
// The unsigned-quantity discipline mirrors both trading-strategy and
// execution-policy's postTradePosition note: quantities and cost bases
// are non-negative; the signed/short refinement lands with the live
// execution lane (T040). The netNotional measure in exposure.ts
// documents the same degeneracy.
//
// Spec anchors: spec/ARCHITECTURE.md (core flow: "Strategy/Portfolio/
// Risk -> Execution -> Outcome"), spec/ARCHITECTURE-LOCK.md L9 (the
// snapshot's lineage block), L12 (tenant scope).

import { isNonEmptyString, isRecord, isTimestampMs, type TimestampMs } from './primitives';
import { isNonNegativeDecimalInput, isSignedCanonicalDecimal } from './decimals';
import type { ConstraintSetVersionRef, GoalVersionRef, InstrumentId, PortfolioStateId, ProjectId, Seed, StrategyVersionRef, TenantId, VenueId } from './ids';
import {
  isConstraintSetVersionRef,
  isGoalVersionRef,
  isInstrumentId,
  isPortfolioStateId,
  isProjectId,
  isStrategyVersionRef,
  isTenantId,
  isVenueId,
} from './ids';

// ---------------------------------------------------------------------------
// The strategy lineage mirror (the snapshot's L9 block)
// ---------------------------------------------------------------------------

/**
 * The strategy lane's lineage block. Mirror of trading-strategy's
 * `StrategyLineage` (via execution-policy's `StrategyLineageMirror`):
 * the strategy version, the goal version, the constraint-set version,
 * the observation window identity, the seed, the tenant and the
 * project.
 */
export interface StrategyLineageMirror {
  readonly strategy: StrategyVersionRef;
  readonly goal: GoalVersionRef;
  readonly constraintSet: ConstraintSetVersionRef;
  /** The observation window the record was computed under. */
  readonly windowId: string;
  /** The run's deterministic seed (part of the determinism contract). */
  readonly seed: Seed;
  /** Tenant scope (L12). */
  readonly tenant: TenantId;
  /** Project continuity root (L12/L15). */
  readonly project: ProjectId;
}

/** Guard: `StrategyLineageMirror`. */
export function isStrategyLineageMirror(v: unknown): v is StrategyLineageMirror {
  if (!isRecord(v)) return false;
  if (!isStrategyVersionRef(v.strategy)) return false;
  if (!isGoalVersionRef(v.goal)) return false;
  if (!isConstraintSetVersionRef(v.constraintSet)) return false;
  if (!isNonEmptyString(v.windowId)) return false;
  if (!isNonEmptyString(v.seed)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// The position and weight records
// ---------------------------------------------------------------------------

/** The recorded mark source of a portfolio weight. Mirror. */
export type MarkSourceMirror = 'last_trade' | 'mid_quote';

/**
 * One position record. Mirror of trading-strategy's `PositionRecord`
 * (via execution-policy's `PositionRecordMirror`): instrument + venue
 * (the netting key), UNSIGNED quantity, total cost basis, opened-at.
 */
export interface PositionRecordMirror {
  readonly instrumentId: InstrumentId;
  readonly venueId: VenueId;
  /** Held quantity, non-negative decimal. */
  readonly quantity: string;
  /** Total cost basis of the held quantity, non-negative decimal. */
  readonly costBasis: string;
  /** The instant the position was opened (epoch ms). */
  readonly openedAt: TimestampMs;
}

/** Guard: `PositionRecordMirror`. */
export function isPositionRecordMirror(v: unknown): v is PositionRecordMirror {
  if (!isRecord(v)) return false;
  if (!isInstrumentId(v.instrumentId)) return false;
  if (!isVenueId(v.venueId)) return false;
  if (!isNonNegativeDecimalInput(v.quantity)) return false;
  if (!isNonNegativeDecimalInput(v.costBasis)) return false;
  if (!isTimestampMs(v.openedAt)) return false;
  return true;
}

/** One recorded weight. Mirror of trading-strategy's `PortfolioWeight` (via execution-policy). */
export interface PortfolioWeightMirror {
  readonly instrumentId: InstrumentId;
  readonly weight: string;
  /** The mark source the snapshot was priced from. */
  readonly markSource: MarkSourceMirror;
}

/** Guard: `PortfolioWeightMirror`. */
export function isPortfolioWeightMirror(v: unknown): v is PortfolioWeightMirror {
  if (!isRecord(v)) return false;
  if (!isInstrumentId(v.instrumentId)) return false;
  if (!isNonNegativeDecimalInput(v.weight)) return false;
  if (v.markSource !== 'last_trade' && v.markSource !== 'mid_quote') return false;
  return true;
}

// ---------------------------------------------------------------------------
// The portfolio state (the exposure computation's facts)
// ---------------------------------------------------------------------------

/**
 * The immutable portfolio snapshot the exposure computation measures.
 * Field-for-field mirror of trading-strategy's `PortfolioState` (via
 * execution-policy's `PortfolioStateMirror`): content-addressed id,
 * positions, weights, cash, the signed PnL split, asOf, the full
 * lineage block. The risk engine reads this record and NEVER writes it.
 */
export interface PortfolioStateMirror {
  /** Content-addressed identity (`ps:` + digest of the canonical content minus the id). */
  readonly stateId: PortfolioStateId;
  readonly positions: readonly PositionRecordMirror[];
  readonly weights: readonly PortfolioWeightMirror[];
  /** Cash, non-negative decimal (post-realization cash — see exposure.ts's equity definition). */
  readonly cash: string;
  /** Realized PnL accumulated over the state's history, SIGNED decimal. */
  readonly realizedPnl: string;
  /** Unrealized (mark-to-market) PnL at `asOf`, SIGNED decimal. */
  readonly unrealizedPnl: string;
  /** The snapshot instant. */
  readonly asOf: TimestampMs;
  readonly lineage: StrategyLineageMirror;
}

/** `true` for a canonical decimal with an optional single leading "-" (the PnL split's grammar — decimals.ts's signed extension). */
export { isSignedCanonicalDecimal };

/** Guard: `PortfolioStateMirror` (structural; the netting and lineage laws included). */
export function isPortfolioStateMirror(v: unknown): v is PortfolioStateMirror {
  if (!isRecord(v)) return false;
  if (!isPortfolioStateId(v.stateId)) return false;
  if (!Array.isArray(v.positions)) return false;
  if (!v.positions.every((x) => isPositionRecordMirror(x))) return false;
  const seen = new Set<string>();
  for (const position of v.positions) {
    const record = position as PositionRecordMirror;
    const key = `${record.instrumentId}|${record.venueId}`;
    if (seen.has(key)) return false; // netting discipline
    seen.add(key);
  }
  if (!Array.isArray(v.weights)) return false;
  if (!v.weights.every((x) => isPortfolioWeightMirror(x))) return false;
  const weightSeen = new Set<string>();
  for (const weight of v.weights) {
    const record = weight as PortfolioWeightMirror;
    if (weightSeen.has(record.instrumentId)) return false;
    weightSeen.add(record.instrumentId);
  }
  if (!isNonNegativeDecimalInput(v.cash)) return false;
  if (!isSignedCanonicalDecimal(v.realizedPnl)) return false;
  if (!isSignedCanonicalDecimal(v.unrealizedPnl)) return false;
  if (!isTimestampMs(v.asOf)) return false;
  if (!isStrategyLineageMirror(v.lineage)) return false;
  return true;
}
