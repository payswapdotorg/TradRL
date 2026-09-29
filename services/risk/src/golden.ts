/**
 * @tradrl/risk-engine (service) — the golden determinism constants.
 *
 * Byte-stable digests over the reference scenario's canonical outcomes:
 * the same (steps, policies, switch logs, seed) always yields the
 * byte-identical exposures + evaluations + measures + drawdown series +
 * audit chain (the Work Order's determinism acceptance: deep-equal,
 * twice — the golden test proves it across every run of the suite).
 *
 * GENERATION (documented, reproducible): drive the reference scenario
 * through `driveReferenceScenario` (create -> step 1 (genesis, all
 * within) -> step 2 (the drawdown breach) -> supersede to v2 -> step 3
 * (all within under the current head)) and fold the session with
 * `riskRunDigest`. The reference scenario's documented shape:
 *
 *   Step 1 'step-genesis' @ T0 — BTC 0.8 + ETH 2 held, cash 100000,
 *     market BTC 50000 / ETH 3000, fill buy 0.2 BTC at aggressor
 *     50010.00 fee 20.00. Exposure: BTC position 1 (notional 50000),
 *     ETH 2 (6000), gross 56000, cash 89978, equity 145978, peak
 *     145978, drawdown 0. 10 states, ALL WITHIN.
 *   Step 2 'step-drawdown-breach' @ T0+60000 — the post-step-1 book
 *     at BTC 40000 / ETH 2400, no fills. gross 44800, equity 134778,
 *     peak threads to 145978, drawdown 11200. 8 states; the drawdown
 *     limit BREACHES (bound 10000, observed 11200, excess 1200) — the
 *     only breaching kind.
 *   Supersede @ T0+119000 — policy v2 (drawdown 15000) replaces v1 on
 *     the L11 trail (v1 RETAINED).
 *   Step 3 'step-under-v2' @ T0+120000 — the same facts as step 2:
 *     drawdown 11200 <= 15000. 8 states, ALL WITHIN.
 *
 * Totals: 3 steps, 3 exposures, 3 evaluations, 6 measures (the exposure
 * measure + the opaque risk-adjusted figure per step), 3 audit records,
 * 1 breaching state overall, 2 retained policy versions, 0 blocked
 * states (the standing switch never blocks; the thrown-switch interop
 * fixtures live in the engine tests).
 *
 * Any contract change that alters the engine's byte output changes
 * these constants — visibly.
 */

/** The golden digest of the reference scenario's whole outcome tree (3 steps, 1 breach, 2 policy versions). */
export const GOLDEN_RUN_DIGEST = 'ee066390';

/** The golden count of processed steps in the reference scenario. */
export const GOLDEN_STEP_COUNT = 3;

/** The golden count of measured exposures. */
export const GOLDEN_EXPOSURE_COUNT = 3;

/** The golden count of limit evaluations (one per step). */
export const GOLDEN_EVALUATION_COUNT = 3;

/** The golden count of emitted measures (the exposure measure + the risk-adjusted figure per step). */
export const GOLDEN_MEASURE_COUNT = 6;

/** The golden count of audit records (one per evaluation). */
export const GOLDEN_AUDIT_RECORD_COUNT = 3;

/** The golden count of BREACHING limit states across the whole run (the step-2 drawdown). */
export const GOLDEN_BREACHING_TOTAL = 1;

/** The golden drawdown series (one exact-decimal point per step — the threaded high-water mark). */
export const GOLDEN_DRAWDOWN_SERIES: readonly string[] = ['0', '11200', '11200'];

/** The golden count of retained policy versions on the L11 trail (v1 + v2). */
export const GOLDEN_POLICY_VERSIONS = 2;

/** The golden count of BLOCKED states in the reference run (the standing switch never blocks). */
export const GOLDEN_BLOCKED_SWITCH_STATES = 0;
