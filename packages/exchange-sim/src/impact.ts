/**
 * @tradrl/exchange-sim — the market-impact policy.
 *
 * L6 FIDELITY DECLARATION: the DEFAULT policy is an EXPLICIT
 * DECLARED-ABSENCE record ({@link NO_MARKET_IMPACT}): the simulator's
 * matching does not move prices endogenously beyond the book's own
 * consumption — an aggressor consumes resting liquidity (that slippage is
 * real and modeled by the book walk), but the exchange does NOT widen
 * spreads, fade quotes, or replenish/remove liquidity because a large
 * order arrived. Endogenous market reaction to flow is the REACTIVE-WORLD
 * lane's behavior (T027), not this engine's.
 *
 * EXTENSION CONTRACT (for T027): the policy is an OPEN, data-only record —
 * `kind` is an opaque string. The engine implements exactly one kind,
 * `'none'`; every other kind FAILS config validation with the typed error
 * `unsupported_impact_policy` (fail-closed, never silently ignored). A
 * reactive world composes this engine and interprets its own policy kinds
 * AROUND it — e.g. by feeding book deltas between submissions through its
 * own T027-side machinery — so the extension point is the record's shape
 * and the engine's refusal to guess semantics it does not own.
 */

import { deepFreeze, isNonEmptyString, isRecord } from './primitives';

// ---------------------------------------------------------------------------
// The policy record
// ---------------------------------------------------------------------------

/**
 * A market-impact policy declaration. Data-only by design: JSON-serializable,
 * carried in the {@link ExchangeConfig}, and interpreted by the layer that
 * owns the semantics (this engine: `'none'` only; T027: its own kinds).
 */
export interface MarketImpactPolicy {
  /** The policy kind. `'none'` is the engine's explicit declared-absence policy; other kinds belong to T027. */
  readonly kind: string;
  /** What this policy models (non-empty — the L6 declaration). */
  readonly declaration: string;
  /** What this policy does NOT model (non-empty — the L6 declared limitation/absence). */
  readonly limitation: string;
}

/**
 * The DEFAULT market-impact policy: the explicit declared-absence record.
 * The engine accepts this and only this kind; see the module header and
 * {@link IMPACT_FIDELITY}.
 */
export const NO_MARKET_IMPACT: MarketImpactPolicy = deepFreeze({
  kind: 'none',
  declaration:
    'no endogenous market impact: the engine matches against the visible book and does not widen spreads, fade quotes or alter liquidity in reaction to order flow',
  limitation:
    'impact of participant flow on future liquidity/prices is NOT modeled here — endogenous market reaction is the reactive-world lane (T027); consumers needing it compose this engine with T027 policies around it',
});

/**
 * The explicit L6 fidelity declaration of the impact lane. The default
 * policy's declared absence IS the declaration; tests assert both exist.
 */
export const IMPACT_FIDELITY = deepFreeze({
  modeled: ['price formation through visible-book matching only (the book walk is the only endogenous price effect)'],
  declared_limitations: [
    'no impact of aggressor flow on future book state (no spread widening, quote fading, or liquidity replenishment/removal)',
    'no temporary/permanent impact decomposition, no participation-rate models',
    'endogenous market reaction is T027 territory; the policy record is the declared extension point and the engine fail-closes on kinds it does not implement',
  ],
} as const);

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** Runtime guard for a structurally valid market-impact policy record. */
export function isMarketImpactPolicy(value: unknown): value is MarketImpactPolicy {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.kind)) return false;
  if (!isNonEmptyString(value.declaration)) return false;
  if (!isNonEmptyString(value.limitation)) return false;
  return true;
}

/** The kinds the ENGINE itself implements (exactly one: the declared absence). */
export const ENGINE_IMPACT_KINDS: readonly string[] = ['none'];
