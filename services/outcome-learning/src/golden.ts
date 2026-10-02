/**
 * @tradrl/outcome-learning — the golden determinism constants (the
 * byte-stable digests and counts of the fixture scenario, captured as
 * literals — the determinism test compares fresh runs against them,
 * TWICE).
 *
 * The constants were derived by running the golden scenario
 * (fixtures.ts: ingest the six-decision stream, generate the drafts)
 * once and recording the outputs; they are literals so any drift in
 * the reconciliation, the classification, the draft generation, the
 * record minting or the state threading fails the determinism test
 * loudly.
 */

/** The golden state digest after the full pipeline (ingest + drafts). */
export const GOLDEN_STATE_DIGEST = 'ccf9d616';

/** The golden outcome-learning log head after ingestion. */
export const GOLDEN_OUTCOME_LOG_HEAD = 'e9ab7617';

/** The golden post-mortem log head after draft generation. */
export const GOLDEN_POSTMORTEM_LOG_HEAD = 'e319a5a7';

/** The golden disposition-class sequence (the six decisions, in order). */
export const GOLDEN_CLASSES: readonly string[] = ['adverse_gap', 'as_expected', 'averted', 'execution_shortfall', 'no_execution', 'unbenchmarked_fill'];

/** The golden book reconciliation: the stream sums exactly onto the snapshot (delta zero). */
export const GOLDEN_ACCRUAL_DELTA = '0';

/** The golden draft count (adverse_gap + execution_shortfall + no_execution warrant drafts under the default policy). */
export const GOLDEN_DRAFT_COUNT = 3;

/** The golden data-lag hypothesis count (exactly one — decision 4's second fill, 150ms late). */
export const GOLDEN_DATA_LAG_HYPOTHESES = 1;

/** The golden market-move hypothesis count (three — every drafted outcome is a BTC decision; the shared marks moved 200, beyond the 100 threshold). */
export const GOLDEN_MARKET_MOVE_HYPOTHESES = 3;

/** The golden model-error hypothesis count (exactly one — decision 1's missed projection). */
export const GOLDEN_MODEL_ERROR_HYPOTHESES = 1;
