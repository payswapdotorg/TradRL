/**
 * @tradrl/strategy (service) — the golden determinism constants.
 *
 * Byte-stable digests over the reference scenarios' canonical results:
 * the same (spec, observation windows, constraint set, declared events,
 * seed) always yields the byte-identical intent sequence + refusals +
 * transition log + backtest record (the Work Order's determinism
 * acceptance: deep-equal, twice — the golden test proves it across
 * every run of the suite).
 *
 * GENERATION (documented, reproducible): drive the scenario through
 * `driveStrategyScenario`, serialize the whole result with the contract
 * package's `canonicalJson`, and fold it with FNV-1a. The reference
 * scenario's documented shape:
 *
 *   SATISFIED path (GOLDEN_INTENT_COUNT = 6 intents, 0 refusals):
 *     run 1 — initial allocation, 3 buys:
 *       BTC 0.2 @ 50000, ETH 3.33 @ 3000 (lot-floored), SOL 99.9 @ 100
 *       (target-weight 1/3 at precision 8 -> 9999.9999 value -> 99.9);
 *     run 2 — BTC 50000 -> 90000 pushes the decision-time BTC weight to
 *       0.47368421 (drift 0.14035088 > band 0.05): SELL BTC 0.059,
 *       cash-capped BUY SOL 0.1 (the whole 10 remaining cash), ETH's
 *       buy lot-floored to zero (unaffordable);
 *     run 3 — the marks settle: only BTC outside its band
 *       (0.22175343): BUY BTC 0.07 @ 52000.
 *     Final book: BTC 0.211 @ 10690 basis, ETH 3.33 @ 9990, SOL 200.2
 *     @ 10010 (after the 2:1 split), cash 1675, realized 2360
 *     (exact-decimal), unrealized 10959.
 *
 *   REFUSING path (GOLDEN_REFUSAL_COUNT = 9 refusals, 0 intents): the
 *     universe ceiling (2) vs the universe (3) refuses EVERY candidate
 *     at EVERY step — 3 refusal records per step, each naming the
 *     violated `universe-ceiling` predicate — and the portfolio never
 *     leaves its genesis shape (cash 30000, no positions).
 *
 * Any contract change that alters the reference policy's byte output
 * changes these constants — visibly.
 */

/** The golden digest of the SATISFIED-path scenario's full result (runs + log + genesis/final states + backtest). */
export const GOLDEN_SCENARIO_DIGEST = '420925c0';

/** The golden digest of the REFUSING-path scenario's full result. */
export const GOLDEN_REFUSING_DIGEST = '79de2d15';

/** The golden count of intents across the satisfied scenario's runs (the documented shape). */
export const GOLDEN_INTENT_COUNT = 6;

/** The golden count of refusals across the refusing scenario's runs (every candidate refused, every step). */
export const GOLDEN_REFUSAL_COUNT = 9;
