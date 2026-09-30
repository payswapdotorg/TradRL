/**
 * @tradrl/shadow_trading — the golden determinism constants (the
 * byte-stable digests and counts of the fixture scenario, captured as
 * literals — the golden test compares fresh runs against them, TWICE).
 *
 * The constants were derived by running the golden fixture scenario
 * once and recording the outputs; they are literals so any drift in
 * the tick machine, the bookkeeping, the record minting or the
 * serialization fails the determinism test loudly.
 */

/** The golden outcome-log digest (the whole decision/disposition/fill fold). */
export const GOLDEN_OUTCOME_DIGEST = 'df42ac2a';

/** The golden disposition sequence (the seven decisions' outcomes, in order). */
export const GOLDEN_DISPOSITIONS: readonly string[] = [
  'filled',
  'filled',
  'filled',
  'refused',
  'filled',
  'partial',
  'expired',
] as const;

/** The golden submission count (six approved submissions; d4 refused at the risk stage). */
export const GOLDEN_SUBMISSION_COUNT = 6;

/** The golden fill count (six engine fills carried with physics lineage). */
export const GOLDEN_FILL_COUNT = 6;

/** The golden refusal count (one risk-stage refusal). */
export const GOLDEN_REFUSAL_COUNT = 1;

/** The golden final book: BTC 1.0 @ basis 50041.66666667, ETH 0.8 @ 2400, cash 47504.515, realized -38.32833333. */
export const GOLDEN_FINAL_BOOK = {
  positions: [
    { venue: 'SHADOWSIM', instrument: 'BTC-USD', quantity: '1', costBasis: '50041.66666667' },
    { venue: 'SHADOWSIM', instrument: 'ETH-USD', quantity: '0.8', costBasis: '2400' },
  ],
  cash: '47504.515',
  realizedPnl: '-38.32833333',
} as const;
