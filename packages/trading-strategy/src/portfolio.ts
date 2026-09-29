// @tradrl/trading-strategy — the portfolio state, the pure transition and
// the append-only transition log.
//
// A {@link PortfolioState} is the IMMUTABLE snapshot record of what the
// strategy account holds: positions (instrument, venue, quantity,
// cost basis, opened-at), the recorded weights, cash, the
// realized/unrealized PnL split, the as-of instant, and its FULL L9
// lineage block. Rebalancing never mutates in place: the only state
// change is the PURE transition
//
//   (state, account fills, corporate actions, mark window, asOf)
//       -> applyPortfolioEvents -> { next state, transition record }
//
// and the next state is a NEW deeply-frozen record with a
// content-addressed identity (`ps:` + digest of its canonical content —
// the same state always derives the same id, L9).
//
// EXACT DECIMALS (mirroring exchange-sim's decimals law — the Work
// Order: "realized/unrealized discipline (exact decimal arithmetic
// mirroring exchange-sim's decimals law)"): every quantity, price, cost
// basis, cash, notional and weight is a canonical UNSIGNED decimal
// string computed exactly (BigInt fixed-point; the mirror module
// decimals.ts). The PnL split is the one SIGNED surface — losing money
// is a fact, not a type error — carried as canonical decimals with an
// optional leading "-", computed by the local signed helpers below over
// the unsigned core (magnitude arithmetic + sign algebra; still exact,
// still no float mediation anywhere). The ONLY approximation is the
// DECLARED half-up rounding at the spec's `decimalPrecision` on the two
// division sites — the per-unit cost share of a sell, and the recorded
// weights — and each site names the precision explicitly.
//
// The unsigned domain is a LAW for holdings: quantities and cash are
// non-negative; a transition that would open a short or drive cash
// negative is the typed `negative_result` error, never a sign flip
// (shorts need the T019/T020 lanes, which do not exist on this base).
//
// THE TRANSITION LOG (L9 + the service's resumable run state): every
// transition is an append-only record carrying an FNV-1a digest CHAIN
// head — `fnv(prevHead + canonical(transition))` — seeded from the log's
// identity skeleton (`{ initialState, transitions: 0 }`, recoverable
// from the log itself so verification is total), exactly the
// rl-protocol run-step-chain discipline. A tampered or partial log
// fails `verifyTransitionChain` with the typed `chain_mismatch`.
//
// Spec anchors: spec/DOMAIN-MODEL.md (Project, Trajectory),
// spec/ARCHITECTURE-LOCK.md L4 (point-in-time marks), L9, L11, L12.

import { canonicalJson, deepFreeze, fnv1a32Hex, isNonEmptyString, isRecord, isTimestampMs, type JsonValue, type TimestampMs } from './primitives';
import {
  type ConstraintSetVersionRef,
  type GoalVersionRef,
  type InstrumentId,
  type PortfolioStateId,
  type ProjectId,
  type Seed,
  type StrategyVersionRef,
  type TenantId,
  type VenueId,
  isInstrumentId,
  isPortfolioStateId,
  isProjectId,
  isTenantId,
  isVenueId,
  mintPortfolioStateId,
} from './ids';
import {
  add as decAdd,
  compare as decCompare,
  divideRoundHalfUp,
  isEqual as decIsEqual,
  isZero as decIsZero,
  multiply as decMultiply,
  normalize as decNormalize,
  subtract as decSubtract,
} from './decimals';
import { type AccountFill, type CorporateAction, isAccountFill, isCorporateAction } from './exchange-mirror';
import { type MarkSource, type ObservationWindow, isObservationWindow, markPriceOf } from './market-mirror';
import { type StrategyError, type StrategyResult, fail, failures, invalidField, invalidType, missingField, ok } from './errors';

// ---------------------------------------------------------------------------
// Signed exact decimals (the PnL discipline over the unsigned core)
// ---------------------------------------------------------------------------

/** `true` for a canonical decimal with an optional single leading "-". */
export function isSignedCanonicalDecimal(v: unknown): v is string {
  if (typeof v !== 'string' || v === '') return false;
  const body = v.startsWith('-') ? v.slice(1) : v;
  return /^(0|[1-9]\d*)(\.\d+)?$/.test(body);
}

/** `true` for a non-negative decimal in either mirrored grammar. */
export function isNonNegativeDecimalInput(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v !== '' &&
    (/^\d+(\.\d+)?$/.test(v) || /^(0|[1-9]\d*)(\.\d+)?$/.test(v))
  );
}

interface Signed {
  readonly negative: boolean;
  readonly magnitude: string;
}

function parseSigned(v: string): Signed {
  return v.startsWith('-') ? { negative: true, magnitude: v.slice(1) } : { negative: false, magnitude: v };
}

function formatSigned(s: Signed): string {
  const magnitude = decNormalize(s.magnitude);
  if (decIsZero(magnitude)) return '0';
  return s.negative ? `-${magnitude}` : magnitude;
}

function signedNegate(a: string): string {
  const s = parseSigned(a);
  return formatSigned({ negative: !s.negative, magnitude: s.magnitude });
}

/** Exact signed addition over canonical decimal strings. */
function signedAdd(a: string, b: string): string {
  const x = parseSigned(a);
  const y = parseSigned(b);
  if (x.negative === y.negative) {
    return formatSigned({ negative: x.negative, magnitude: decAdd(x.magnitude, y.magnitude) });
  }
  const order = decCompare(x.magnitude, y.magnitude);
  if (order === 0) return '0';
  if (order > 0) return formatSigned({ negative: x.negative, magnitude: decSubtract(x.magnitude, y.magnitude) });
  return formatSigned({ negative: y.negative, magnitude: decSubtract(y.magnitude, x.magnitude) });
}

/** Exact signed subtraction over canonical decimal strings. */
function signedSubtract(a: string, b: string): string {
  return signedAdd(a, signedNegate(b));
}

// ---------------------------------------------------------------------------
// Lineage (the L9 block every state and transition carries)
// ---------------------------------------------------------------------------

/**
 * The full lineage block of this lane (L9: "results bind data, code,
 * body, substrate, environment, runtime, evaluator and config" — the
 * strategy's instantiation of it): the strategy version, the goal
 * version, the constraint-set version, the observation window identity,
 * the seed, the tenant and the project. Every portfolio state, every
 * transition and every intent carries it; a record missing any field
 * fails its guard (`lineage_gap`).
 */
export interface StrategyLineage {
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

/** Guard: `StrategyLineage` (every L9/L12 field present and well-formed). */
export function isStrategyLineage(v: unknown): v is StrategyLineage {
  if (!isRecord(v)) return false;
  const strategy = v.strategy;
  if (!isRecord(strategy) || !isNonEmptyString(strategy.specId) || !Number.isInteger(strategy.version) || (strategy.version as number) < 1) return false;
  const goal = v.goal;
  if (!isRecord(goal) || !isNonEmptyString(goal.goalId) || !Number.isInteger(goal.version) || (goal.version as number) < 1) return false;
  const constraintSet = v.constraintSet;
  if (!isRecord(constraintSet) || !isNonEmptyString(constraintSet.id) || !Number.isInteger(constraintSet.version) || (constraintSet.version as number) < 1) return false;
  if (!isNonEmptyString(v.windowId)) return false;
  if (!isNonEmptyString(v.seed)) return false;
  if (!isTenantId(v.tenant)) return false;
  if (!isProjectId(v.project)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Positions and weights
// ---------------------------------------------------------------------------

/**
 * One position record: instrument + venue (the netting key — at most one
 * position per pair, mirroring domain-core's netting discipline),
 * UNSIGNED quantity, the TOTAL cost basis of the held quantity, and the
 * instant the position was opened. Long-only by the unsigned domain law.
 */
export interface PositionRecord {
  readonly instrumentId: InstrumentId;
  readonly venueId: VenueId;
  /** Held quantity, non-negative decimal (canonical or loose-grammar input; normalized on emission). */
  readonly quantity: string;
  /** Total cost basis of the held quantity, non-negative decimal. */
  readonly costBasis: string;
  /** The instant the position was opened (epoch ms). */
  readonly openedAt: TimestampMs;
}

/** Guard: `PositionRecord`. */
export function isPositionRecord(v: unknown): v is PositionRecord {
  if (!isRecord(v)) return false;
  if (!isInstrumentId(v.instrumentId)) return false;
  if (!isVenueId(v.venueId)) return false;
  if (!isNonNegativeDecimalInput(v.quantity)) return false;
  if (!isNonNegativeDecimalInput(v.costBasis)) return false;
  if (!isTimestampMs(v.openedAt)) return false;
  return true;
}

/**
 * One recorded weight: the position's value share of the total portfolio
 * value, RECORDED as data at snapshot time (computed from the mark
 * prices of the transition's observation window — value = quantity *
 * mark; total = cash + Σ value). The rounding discipline is the spec's
 * declared precision (half-up at the division site).
 */
export interface PortfolioWeight {
  readonly instrumentId: InstrumentId;
  readonly weight: string;
  /** The mark source the snapshot was priced from. */
  readonly markSource: MarkSource;
}

/** Guard: `PortfolioWeight`. */
export function isPortfolioWeight(v: unknown): v is PortfolioWeight {
  if (!isRecord(v)) return false;
  if (!isInstrumentId(v.instrumentId)) return false;
  if (!isNonNegativeDecimalInput(v.weight)) return false;
  if (v.markSource !== 'last_trade' && v.markSource !== 'mid_quote') return false;
  return true;
}

// ---------------------------------------------------------------------------
// The portfolio state
// ---------------------------------------------------------------------------

/**
 * The immutable portfolio snapshot (see the module header). The record
 * is pure DATA: positions, weights, cash, the realized/unrealized split
 * — all exact decimals — plus asOf, the full lineage and the
 * content-addressed identity.
 */
export interface PortfolioState {
  /** Content-addressed identity (`ps:` + digest of the canonical content minus the id). */
  readonly stateId: PortfolioStateId;
  readonly positions: readonly PositionRecord[];
  readonly weights: readonly PortfolioWeight[];
  /** Cash, non-negative decimal. */
  readonly cash: string;
  /** Realized PnL accumulated over the state's history, SIGNED decimal. */
  readonly realizedPnl: string;
  /** Unrealized (mark-to-market) PnL at `asOf`, SIGNED decimal. */
  readonly unrealizedPnl: string;
  /** The snapshot instant (L4: the marks' as-of anchor). */
  readonly asOf: TimestampMs;
  readonly lineage: StrategyLineage;
}

/** Guard: `PortfolioState` (structural; the netting and lineage laws included). */
export function isPortfolioState(v: unknown): v is PortfolioState {
  if (!isRecord(v)) return false;
  if (!isPortfolioStateId(v.stateId)) return false;
  if (!Array.isArray(v.positions)) return false;
  if (!v.positions.every((x) => isPositionRecord(x))) return false;
  const seen = new Set<string>();
  for (const position of v.positions) {
    const record = position as PositionRecord;
    const key = `${record.instrumentId}|${record.venueId}`;
    if (seen.has(key)) return false; // netting discipline
    seen.add(key);
  }
  if (!Array.isArray(v.weights)) return false;
  if (!v.weights.every((x) => isPortfolioWeight(x))) return false;
  const weightSeen = new Set<string>();
  for (const weight of v.weights) {
    const record = weight as PortfolioWeight;
    if (weightSeen.has(record.instrumentId)) return false;
    weightSeen.add(record.instrumentId);
  }
  if (!isNonNegativeDecimalInput(v.cash)) return false;
  if (!isSignedCanonicalDecimal(v.realizedPnl)) return false;
  if (!isSignedCanonicalDecimal(v.unrealizedPnl)) return false;
  if (!isTimestampMs(v.asOf)) return false;
  if (!isStrategyLineage(v.lineage)) return false;
  return true;
}

/**
 * The canonical JSON tree of a state's CONTENT (everything except the
 * content-addressed `stateId`). The explicit-tree discipline of
 * rl-protocol's stepTree: JSON shape is proven by construction, never
 * cast. Equal contents always serialize byte-identically.
 */
export function portfolioStateTree(state: Omit<PortfolioState, 'stateId'>): JsonValue {
  return {
    positions: state.positions.map((position) => ({
      instrumentId: position.instrumentId,
      venueId: position.venueId,
      quantity: position.quantity,
      costBasis: position.costBasis,
      openedAt: position.openedAt,
    })),
    weights: state.weights.map((weight) => ({
      instrumentId: weight.instrumentId,
      weight: weight.weight,
      markSource: weight.markSource,
    })),
    cash: state.cash,
    realizedPnl: state.realizedPnl,
    unrealizedPnl: state.unrealizedPnl,
    asOf: state.asOf,
    lineage: {
      strategy: { specId: state.lineage.strategy.specId, version: state.lineage.strategy.version },
      goal: { goalId: state.lineage.goal.goalId, version: state.lineage.goal.version },
      constraintSet: { id: state.lineage.constraintSet.id, version: state.lineage.constraintSet.version },
      windowId: state.lineage.windowId,
      seed: state.lineage.seed,
      tenant: state.lineage.tenant,
      project: state.lineage.project,
    },
  };
}

/** The content digest of a state's payload. Pure — same content, same digest (L9). */
export function portfolioStateDigest(state: Omit<PortfolioState, 'stateId'>): string {
  return fnv1a32Hex(canonicalJson(portfolioStateTree(state)));
}

/**
 * Construct the GENESIS portfolio state: no positions, no weights, zero
 * realized/unrealized PnL, the declared opening cash, the lineage block
 * and the opening instant. The content-addressed id is derived. This is
 * the ONLY state-construction entry point (every later state comes from
 * `applyPortfolioEvents`); it makes the "same genesis inputs -> same
 * genesis id" law explicit. Pure.
 */
export function initialPortfolioState(
  lineage: StrategyLineage,
  cash: string,
  asOf: TimestampMs,
): StrategyResult<PortfolioState> {
  if (!isStrategyLineage(lineage)) {
    return fail('lineage_gap', 'the genesis state requires a complete lineage block (strategy/goal/constraintSet/windowId/seed/tenant/project) (L9)');
  }
  if (!isNonNegativeDecimalInput(cash)) {
    return fail('invalid_state', 'the genesis cash must be a non-negative decimal string');
  }
  if (!isTimestampMs(asOf)) {
    return fail('invalid_state', 'the genesis asOf must be an epoch-ms timestamp');
  }
  const payload: Omit<PortfolioState, 'stateId'> = {
    positions: [],
    weights: [],
    cash: decNormalize(cash),
    realizedPnl: '0',
    unrealizedPnl: '0',
    asOf,
    lineage,
  };
  return ok(deepFreeze({ ...payload, stateId: mintPortfolioStateId(portfolioStateDigest(payload)) }));
}

// ---------------------------------------------------------------------------
// Mark computation (the snapshot's pricing discipline)
// ---------------------------------------------------------------------------

/**
 * Compute the recorded weights of a snapshot: value_i = quantity_i *
 * mark_i (EXACT product), total = cash + Σ value_i, weight_i = value_i /
 * total at `precision` (the ONE divided site; "0" when the total is
 * zero — an empty portfolio has no value to share). Pure and
 * deterministic.
 */
export function computeWeights(
  positions: readonly PositionRecord[],
  cash: string,
  marks: ReadonlyMap<InstrumentId, { readonly price: string; readonly source: MarkSource } | null>,
  precision: number,
): readonly PortfolioWeight[] {
  let totalValue = cash;
  for (const position of positions) {
    const mark = marks.get(position.instrumentId);
    if (mark === undefined || mark === null || decIsZero(position.quantity)) continue;
    totalValue = decAdd(totalValue, decMultiply(position.quantity, mark.price));
  }
  const weights: PortfolioWeight[] = [];
  for (const position of positions) {
    const mark = marks.get(position.instrumentId);
    if (mark === undefined || mark === null) {
      // Unreachable on the transition path (held instruments are marked
      // fail-closed); kept total for direct callers — no mark, no share.
      weights.push({ instrumentId: position.instrumentId, weight: '0', markSource: 'last_trade' });
      continue;
    }
    if (decIsZero(totalValue) || decIsZero(position.quantity)) {
      weights.push({ instrumentId: position.instrumentId, weight: '0', markSource: mark.source });
      continue;
    }
    const value = decMultiply(position.quantity, mark.price);
    weights.push({
      instrumentId: position.instrumentId,
      weight: divideRoundHalfUp(value, totalValue, precision),
      markSource: mark.source,
    });
  }
  return weights;
}

// ---------------------------------------------------------------------------
// The pure transition
// ---------------------------------------------------------------------------

/** The declared events of one transition step (all inputs validated first). */
export interface PortfolioEventBatch {
  /** Account fills, ordered by `event_time` (ascending). */
  readonly fills: readonly AccountFill[];
  /** Corporate actions, ordered by `ex_time` (ascending). */
  readonly corporateActions: readonly CorporateAction[];
}

/** Guard: `PortfolioEventBatch` (ordering laws included). */
export function isPortfolioEventBatch(v: unknown): v is PortfolioEventBatch {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.fills) || !v.fills.every((x) => isAccountFill(x))) return false;
  for (let index = 1; index < v.fills.length; index += 1) {
    const prev = (v.fills[index - 1] as AccountFill).event_time;
    const curr = (v.fills[index] as AccountFill).event_time;
    if (curr < prev) return false;
  }
  if (!Array.isArray(v.corporateActions) || !v.corporateActions.every((x) => isCorporateAction(x))) return false;
  for (let index = 1; index < v.corporateActions.length; index += 1) {
    const prev = (v.corporateActions[index - 1] as CorporateAction).ex_time;
    const curr = (v.corporateActions[index] as CorporateAction).ex_time;
    if (curr < prev) return false;
  }
  return true;
}

/**
 * Apply one event batch to a portfolio state — THE PURE TRANSITION.
 *
 * Semantics (all exact-decimal, all typed on violation):
 *   - Corporate actions apply FIRST (to pre-fill holdings; the ordering
 *     is part of the declared semantics): a `cash_dividend` adds
 *     quantity * cashPerUnit to cash (exact product); a `split`
 *     multiplies the quantity by the exact decimal ratio.
 *   - BUY fill: quantity += fill.quantity; costBasis += quantity *
 *     price (exact product); cash -= (notional + fee). A buy of an
 *     unheld (instrument, venue) OPENS a position (openedAt = the
 *     fill's event_time). Cash below zero is the typed
 *     `negative_result` (the unsigned domain law).
 *   - SELL fill: quantity -= fill.quantity (below zero = the typed
 *     `negative_result` — long-only); the cost share is costBasis *
 *     (sold / held) at `precision` (the declared division site);
 *     realizedPnl += notional - share - fee (SIGNED — a loss is a
 *     fact); cash += notional - fee; a fully closed position leaves
 *     the positions list.
 *   - Marks: the `window` prices every position instrument after the
 *     events (a missing mark over a HELD instrument is the typed
 *     `observation_gap` — the snapshot's weights and unrealized PnL
 *     are recorded data, never best-effort); unrealizedPnl = Σ
 *     (quantity * mark - costBasis) (EXACT products/sums, no division).
 *   - The next state's `asOf` is the declared parameter (never an
 *     ambient clock) and must be >= the previous asOf (monotonic
 *     time, L4); the window's information anchor must EQUAL it (the
 *     marks are point-in-time).
 *
 * Returns the NEXT deeply-frozen state (new content-addressed id) plus
 * the transition record (sequence 0 — assigned by the log on append).
 * The function NEVER mutates its inputs.
 */
export function applyPortfolioEvents(
  state: PortfolioState,
  batch: PortfolioEventBatch,
  window: ObservationWindow,
  precision: number,
  asOf: TimestampMs,
): StrategyResult<{ readonly state: PortfolioState; readonly transition: PortfolioTransition }> {
  if (!isPortfolioState(state)) {
    return fail('invalid_state', 'applyPortfolioEvents requires a valid portfolio state');
  }
  if (!isPortfolioEventBatch(batch)) {
    return fail('invalid_state', 'the event batch is malformed (fills/corporate actions must be ordered arrays of valid records)');
  }
  if (!isObservationWindow(window)) {
    return fail('invalid_state', 'the mark window is not a valid observation window');
  }
  if (!isTimestampMs(asOf)) {
    return fail('invalid_state', 'asOf must be an epoch-ms timestamp');
  }
  if (asOf < state.asOf) {
    return fail('invalid_state', `the portfolio clock is monotonic: asOf ${String(asOf)} precedes the state's asOf ${String(state.asOf)} (L4)`);
  }
  if (window.asOf !== asOf) {
    return fail('invalid_state', `the mark window's information anchor (${String(window.asOf)}) must equal the transition's asOf (${String(asOf)}) — marks are point-in-time (L4)`);
  }

  // Work on mutable local copies; the emitted state is a fresh frozen tree.
  let cash = decNormalize(state.cash);
  let realizedPnl = state.realizedPnl;
  const positions = new Map<string, PositionRecord>();
  for (const position of state.positions) {
    positions.set(`${position.instrumentId}|${position.venueId}`, { ...position });
  }

  // Corporate actions first (see the doc comment).
  for (const action of batch.corporateActions) {
    for (const [key, position] of [...positions.entries()]) {
      if (position.instrumentId !== action.instrument) continue;
      if (action.kind === 'cash_dividend') {
        cash = decAdd(cash, decMultiply(position.quantity, action.cashPerUnit as string));
      } else {
        positions.set(key, { ...position, quantity: decMultiply(position.quantity, action.splitRatio as string) });
      }
    }
  }

  // Fills, in order.
  for (const fill of batch.fills) {
    const key = `${fill.instrument}|${fill.venue}`;
    const existing = positions.get(key);
    const notional = decMultiply(fill.quantity, fill.price);
    if (fill.side === 'buy') {
      const spend = decAdd(notional, fill.fee);
      if (decCompare(cash, spend) < 0) {
        return fail('negative_result', `buy fill ${fill.fill_id} would drive cash negative (cash ${cash} < spend ${spend}) — outside the unsigned decimal domain (long-only lane; shorts/margin need T019/T020)`);
      }
      cash = decSubtract(cash, spend);
      if (existing === undefined) {
        positions.set(key, {
          instrumentId: fill.instrument,
          venueId: fill.venue,
          quantity: decNormalize(fill.quantity),
          costBasis: notional,
          openedAt: fill.event_time,
        });
      } else {
        positions.set(key, {
          ...existing,
          quantity: decAdd(existing.quantity, fill.quantity),
          costBasis: decAdd(existing.costBasis, notional),
        });
      }
    } else {
      if (existing === undefined || decCompare(existing.quantity, fill.quantity) < 0) {
        const held = existing === undefined ? '0' : existing.quantity;
        return fail('negative_result', `sell fill ${fill.fill_id} for ${fill.quantity} exceeds the held quantity ${held} of (${fill.instrument}, ${fill.venue}) — this lane is long-only (shorts need T019/T020)`);
      }
      // Cost share: costBasis * (sold / held) — the declared division site.
      const share = decMultiply(existing.costBasis, divideRoundHalfUp(fill.quantity, existing.quantity, precision));
      realizedPnl = signedAdd(realizedPnl, signedSubtract(signedSubtract(notional, share), fill.fee));
      cash = decAdd(cash, notional);
      if (decCompare(cash, fill.fee) < 0) {
        return fail('negative_result', `sell fill ${fill.fill_id}'s fee (${fill.fee}) exceeds the post-proceeds cash (${cash}) — outside the unsigned decimal domain`);
      }
      cash = decSubtract(cash, fill.fee);
      const quantityAfter = decSubtract(existing.quantity, fill.quantity);
      const basisAfter = decSubtract(existing.costBasis, share);
      if (decIsZero(quantityAfter)) {
        positions.delete(key);
      } else {
        positions.set(key, { ...existing, quantity: quantityAfter, costBasis: basisAfter });
      }
    }
  }

  const nextPositions = [...positions.values()].sort((a, b) =>
    a.instrumentId === b.instrumentId
      ? a.venueId.localeCompare(b.venueId)
      : a.instrumentId.localeCompare(b.instrumentId),
  );

  // Marks over every held instrument (fail-closed on gaps).
  const marks = new Map<InstrumentId, { readonly price: string; readonly source: MarkSource }>();
  for (const position of nextPositions) {
    if (marks.has(position.instrumentId)) continue;
    const mark = markPriceOf(window, position.instrumentId, precision);
    if (mark === null) {
      return fail(
        'observation_gap',
        `the mark window carries no trade or quote for held instrument "${position.instrumentId}" — a snapshot without a mark cannot record weights or unrealized PnL (fail-closed, never best-effort)`,
      );
    }
    marks.set(position.instrumentId, mark);
  }

  // Unrealized PnL: Σ (quantity * mark - costBasis) — exact, signed, no division.
  let unrealizedPnl = '0';
  for (const position of nextPositions) {
    const mark = marks.get(position.instrumentId);
    if (mark === undefined) continue; // unreachable: marks cover every held instrument
    unrealizedPnl = signedAdd(unrealizedPnl, signedSubtract(decMultiply(position.quantity, mark.price), position.costBasis));
  }

  const weights = computeWeights(nextPositions, cash, marks, precision);

  const payload: Omit<PortfolioState, 'stateId'> = {
    positions: nextPositions.map((position) => ({
      ...position,
      quantity: decNormalize(position.quantity),
      costBasis: decNormalize(position.costBasis),
    })),
    weights,
    cash: decNormalize(cash),
    realizedPnl,
    unrealizedPnl,
    asOf,
    lineage: state.lineage,
  };
  const stateId = mintPortfolioStateId(portfolioStateDigest(payload));
  const nextState: PortfolioState = deepFreeze({ ...payload, stateId });

  const transition: PortfolioTransition = deepFreeze({
    sequence: 0, // assigned by the log on append
    before: state.stateId,
    after: nextState.stateId,
    fills: batch.fills,
    corporateActions: batch.corporateActions,
    windowId: window.window_id,
    asOf,
    lineage: state.lineage,
  });
  return ok({ state: nextState, transition });
}

// ---------------------------------------------------------------------------
// The transition record + the append-only, chain-verified log
// ---------------------------------------------------------------------------

/** One append-only transition record (see `applyPortfolioEvents`). */
export interface PortfolioTransition {
  /** 1-based position in the append-only log; 0 = not yet appended. */
  readonly sequence: number;
  /** The state this transition started from (content-addressed). */
  readonly before: PortfolioStateId;
  /** The state this transition produced (content-addressed). */
  readonly after: PortfolioStateId;
  readonly fills: readonly AccountFill[];
  readonly corporateActions: readonly CorporateAction[];
  readonly windowId: string;
  readonly asOf: TimestampMs;
  readonly lineage: StrategyLineage;
}

/** Guard: `PortfolioTransition`. */
export function isPortfolioTransition(v: unknown): v is PortfolioTransition {
  if (!isRecord(v)) return false;
  if (!Number.isSafeInteger(v.sequence) || (v.sequence as number) < 0) return false;
  if (!isPortfolioStateId(v.before) || !isPortfolioStateId(v.after)) return false;
  if (!Array.isArray(v.fills) || !v.fills.every((x) => isAccountFill(x))) return false;
  if (!Array.isArray(v.corporateActions) || !v.corporateActions.every((x) => isCorporateAction(x))) return false;
  if (!isNonEmptyString(v.windowId)) return false;
  if (!isTimestampMs(v.asOf)) return false;
  if (!isStrategyLineage(v.lineage)) return false;
  return true;
}

/**
 * The canonical JSON tree of a transition's CONTENT (the sequence is
 * excluded — the chain binds content, the log binds order).
 */
export function portfolioTransitionTree(transition: PortfolioTransition): JsonValue {
  return {
    before: transition.before,
    after: transition.after,
    fills: transition.fills.map((fill) => ({
      fill_id: fill.fill_id,
      instrument: fill.instrument,
      venue: fill.venue,
      side: fill.side,
      price: fill.price,
      quantity: fill.quantity,
      fee: fill.fee,
      event_time: fill.event_time,
    })),
    corporateActions: transition.corporateActions.map((action) => ({
      action_id: action.action_id,
      instrument: action.instrument,
      kind: action.kind,
      cashPerUnit: action.cashPerUnit ?? null,
      splitRatio: action.splitRatio ?? null,
      ex_time: action.ex_time,
    })),
    windowId: transition.windowId,
    asOf: transition.asOf,
    lineage: {
      strategy: { specId: transition.lineage.strategy.specId, version: transition.lineage.strategy.version },
      goal: { goalId: transition.lineage.goal.goalId, version: transition.lineage.goal.version },
      constraintSet: { id: transition.lineage.constraintSet.id, version: transition.lineage.constraintSet.version },
      windowId: transition.lineage.windowId,
      seed: transition.lineage.seed,
      tenant: transition.lineage.tenant,
      project: transition.lineage.project,
    },
  };
}

/**
 * The append-only transition log with its digest chain: every record's
 * chain contribution is the FNV-1a of (previous head + canonical JSON
 * of the transition's content), seeded from the log's identity skeleton
 * — the rl-protocol run-chain discipline. The log binds the WHOLE
 * history; a tampered record breaks every later head.
 */
export interface PortfolioTransitionLog {
  /** The state the log starts from (its content-addressed id). */
  readonly initialState: PortfolioStateId;
  /** The current (latest) state id — equals initialState when no transitions exist. */
  readonly currentState: PortfolioStateId;
  /** Transitions in append order; sequences 1..N. */
  readonly transitions: readonly PortfolioTransition[];
  /** The chain head after folding every transition (8-hex digest). */
  readonly chainHead: string;
}

/** Guard: `PortfolioTransitionLog` (structural; the chain law in `verifyTransitionChain`). */
export function isPortfolioTransitionLog(v: unknown): v is PortfolioTransitionLog {
  if (!isRecord(v)) return false;
  if (!isPortfolioStateId(v.initialState) || !isPortfolioStateId(v.currentState)) return false;
  if (!Array.isArray(v.transitions)) return false;
  if (!v.transitions.every((x) => isPortfolioTransition(x))) return false;
  if (typeof v.chainHead !== 'string' || !/^[0-9a-f]{8}$/.test(v.chainHead)) return false;
  for (let index = 0; index < v.transitions.length; index += 1) {
    if ((v.transitions[index] as PortfolioTransition).sequence !== index + 1) return false;
  }
  return true;
}

/** Fold one transition onto a chain head. Pure. */
function foldChain(head: string, transition: PortfolioTransition): string {
  return fnv1a32Hex(head + canonicalJson(portfolioTransitionTree(transition)));
}

/** The empty-log seed head: the digest of the log's identity skeleton (recoverable from any log). */
function seedHeadOf(initialState: PortfolioStateId): string {
  return fnv1a32Hex(canonicalJson({ initialState, transitions: 0 } as unknown as JsonValue));
}

/** Start a transition log from an initial state. Pure. */
export function startTransitionLog(initial: PortfolioState): PortfolioTransitionLog {
  if (!isPortfolioState(initial)) throw new Error('startTransitionLog: invalid initial state');
  return deepFreeze({
    initialState: initial.stateId,
    currentState: initial.stateId,
    transitions: [],
    chainHead: seedHeadOf(initial.stateId),
  });
}

/**
 * Append one transition to the log — the ONLY mutation, copy-on-write.
 * The transition arrives with sequence 0 (UNASSIGNED — the log owns the
 * ordering; `applyPortfolioEvents` mints unassigned records) or with
 * exactly the next contiguous sequence. Laws: a wrong non-zero sequence
 * is a `chain_mismatch` (a gap rewrites history, L11 discipline), the
 * transition must start from the log's current state (continuity), and
 * the first transition's lineage pins the log's lineage family (every
 * later one must agree). The stored record carries the assigned
 * sequence; the chain folds the record's CONTENT (the sequence is not
 * part of the fold — the fold ORDER binds the order).
 */
export function appendTransition(
  log: PortfolioTransitionLog,
  transition: PortfolioTransition,
): StrategyResult<PortfolioTransitionLog> {
  if (!isPortfolioTransitionLog(log)) {
    return fail('invalid_state', 'appendTransition requires a valid transition log');
  }
  if (!isPortfolioTransition(transition)) {
    return fail('invalid_state', 'the appended value is not a valid transition record');
  }
  const expectedSequence = log.transitions.length + 1;
  if (transition.sequence !== 0 && transition.sequence !== expectedSequence) {
    return fail('chain_mismatch', `appended transition sequence ${String(transition.sequence)} is not the next contiguous sequence ${String(expectedSequence)} — the transition log is append-only (L9/L11)`);
  }
  if (transition.before !== log.currentState) {
    return fail('chain_mismatch', `appended transition starts from ${transition.before} but the log's current state is ${log.currentState} — transitions chain onto the current state`);
  }
  const first = log.transitions[0] as PortfolioTransition | undefined;
  if (first !== undefined && !lineageEquals(first.lineage, transition.lineage)) {
    return fail('lineage_gap', 'the appended transition\'s lineage disagrees with the log (strategy/goal/constraintSet/seed/tenant/project) (L9)');
  }
  const assigned: PortfolioTransition = transition.sequence === 0 ? { ...transition, sequence: expectedSequence } : transition;
  return ok(
    deepFreeze({
      initialState: log.initialState,
      currentState: assigned.after,
      transitions: [...log.transitions, assigned],
      chainHead: foldChain(log.chainHead, assigned),
    } as PortfolioTransitionLog),
  );
}

/** Structural lineage equality (pure). */
export function lineageEquals(a: StrategyLineage, b: StrategyLineage): boolean {
  return (
    a.strategy.specId === b.strategy.specId &&
    a.strategy.version === b.strategy.version &&
    a.goal.goalId === b.goal.goalId &&
    a.goal.version === b.goal.version &&
    a.constraintSet.id === b.constraintSet.id &&
    a.constraintSet.version === b.constraintSet.version &&
    a.windowId === b.windowId &&
    a.seed === b.seed &&
    a.tenant === b.tenant &&
    a.project === b.project
  );
}

/**
 * Verify a transition log's chain: recompute the whole chain from the
 * seed head and compare. A tampered, reordered or partial log fails
 * with the typed `chain_mismatch`. Pure — the resume gate (the service
 * serializes -> parses -> verifies -> resumes).
 */
export function verifyTransitionChain(log: PortfolioTransitionLog): StrategyResult<PortfolioTransitionLog> {
  if (!isPortfolioTransitionLog(log)) {
    return fail('invalid_state', 'verifyTransitionChain requires a valid transition log');
  }
  let recomputed = seedHeadOf(log.initialState);
  for (const transition of log.transitions) {
    recomputed = foldChain(recomputed, transition);
  }
  if (recomputed !== log.chainHead) {
    return fail('chain_mismatch', `the transition chain does not fold onto the recorded head "${log.chainHead}" (recomputed "${recomputed}") — tampered or partial log`);
  }
  const last = log.transitions[log.transitions.length - 1] as PortfolioTransition | undefined;
  const expectedCurrent = last === undefined ? log.initialState : last.after;
  if (log.currentState !== expectedCurrent) {
    return fail('chain_mismatch', 'the recorded current state disagrees with the last transition');
  }
  return ok(log);
}

// ---------------------------------------------------------------------------
// Validation entry point (collect-all)
// ---------------------------------------------------------------------------

/**
 * Collect-all validation of an untrusted portfolio state. Enforces the
 * L9/L12 laws beyond the structural guard: the lineage block must be
 * complete (a missing tenant/project is `tenant_missing`, another
 * missing lineage field is `lineage_gap`), and the content-addressed id
 * must match the content (tamper detection). On success the value is
 * returned narrowed, deeply frozen.
 */
export function validatePortfolioState(value: unknown, path = 'state'): StrategyResult<PortfolioState> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType(`${path} must be an object`)] };
  }
  const errors: StrategyError[] = [];

  if (value.lineage === undefined) {
    errors.push({ code: 'lineage_gap', path: `${path}.lineage`, message: 'the portfolio state carries no lineage block (L9)' });
  } else if (!isStrategyLineage(value.lineage)) {
    const lineage = value.lineage as Record<string, unknown>;
    if (lineage.tenant === undefined) {
      errors.push({ code: 'tenant_missing', path: `${path}.lineage.tenant`, message: 'the portfolio state carries no tenant scope (L12)' });
    }
    if (lineage.project === undefined) {
      errors.push({ code: 'tenant_missing', path: `${path}.lineage.project`, message: 'the portfolio state carries no project scope (L12/L15)' });
    }
    if (errors.length === 0) {
      errors.push({ code: 'lineage_gap', path: `${path}.lineage`, message: 'the lineage block is malformed (strategy/goal/constraintSet/windowId/seed refs)' });
    }
  }

  if (value.stateId === undefined) errors.push(missingField(`${path}.stateId`));
  if (value.positions === undefined) errors.push(missingField(`${path}.positions`));
  if (value.weights === undefined) errors.push(missingField(`${path}.weights`));
  if (value.cash === undefined) errors.push(missingField(`${path}.cash`));
  if (value.realizedPnl === undefined) errors.push(missingField(`${path}.realizedPnl`));
  if (value.unrealizedPnl === undefined) errors.push(missingField(`${path}.unrealizedPnl`));
  if (value.asOf === undefined) errors.push(missingField(`${path}.asOf`));
  else if (!isTimestampMs(value.asOf)) errors.push(invalidField(`${path}.asOf`, 'must be an epoch-ms timestamp'));

  if (errors.length > 0) return failures(errors);
  if (!isPortfolioState(value)) {
    return fail('invalid_state', `${path} failed the structural portfolio-state guard (positions netting, weights, decimals, lineage)`);
  }
  const state = value as PortfolioState;
  const { stateId: _id, ...content } = state;
  const expectedId = mintPortfolioStateId(portfolioStateDigest(content));
  if (state.stateId !== expectedId) {
    return fail('chain_mismatch', `${path}.stateId ${state.stateId} does not match the content-addressed id ${expectedId} — tampered content`);
  }
  return ok(deepFreeze(state));
}
