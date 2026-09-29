/**
 * @tradrl/execution_sim (service) — the golden determinism constants.
 *
 * Byte-stable digests over the reference scenarios' canonical
 * outcomes: the same (intent batch, policy, venue state, seed) always
 * yields the byte-identical decision sequence + fill sequence (the
 * Work Order's determinism acceptance: deep-equal, twice — the golden
 * test proves it across every run of the suite).
 *
 * GENERATION (documented, reproducible): drive the scenario through
 * `processIntentBatch`, serialize the outcome tree with the contract
 * package's `canonicalJson` (decisions by id/kind, fills by
 * id/price/quantity/fee, the audit chain head), and fold it with
 * FNV-1a (`sessionOutcomeDigest`). The reference APPROVE scenario's
 * documented shape:
 *
 *   APPROVE batch (3 decisions, 0 refusals, 4 fills):
 *     intent 1 — limit buy 0.75 BTC at 50100.00 crosses the BTC asks:
 *       fill xsf-00000001: 0.5 @ 50000 (level 1 consumed), then
 *       fill xsf-00000002: 0.25 @ 50050 (level 2 partially consumed) —
 *       the order fully fills; the book retains 0.75 at 50050;
 *     intent 2 — market sell 0.2 BTC walks the bids: fill
 *       xsf-00000003: 0.2 @ 49950 (level 1 partially consumed);
 *     intent 3 — limit buy 0.8 ETH at 3050.00 crosses the ETH asks:
 *       fill xsf-00000004: 0.8 @ 3000 (level 1 partially consumed).
 *   Final book: BTC 0.55 (basis 37512.5), ETH 0.8 (basis 2400), cash
 *   70067.5195 (exact decimals: the buys' notionals + fees debited,
 *   the sell's proceeds - fee credited).
 *
 *   REFUSING batch (6 intents, 6 refusals, ZERO fills — one per
 *   refusal path): the first five (identity, authorization, limits,
 *   venue, rate) refuse against a STANDING switch; the switch is
 *   thrown only then, and the sixth (a compliant intent) refuses with
 *   the kill-switch kind.
 *
 * Any contract change that alters the simulator's byte output changes
 * these constants — visibly.
 */

/** The golden digest of the APPROVE scenario's outcome tree (3 approvals, 4 fills). */
export const GOLDEN_APPROVE_DIGEST = '5aceb375';

/** The golden digest of the SIX-REFUSAL scenario's outcome tree (6 refusals, 0 fills). */
export const GOLDEN_REFUSAL_DIGEST = 'b94bc595';

/** The golden count of approvals in the approve scenario. */
export const GOLDEN_APPROVE_COUNT = 3;

/** The golden count of fills in the approve scenario. */
export const GOLDEN_FILL_COUNT = 4;

/** The golden count of refusals in the six-refusal-path scenario (zero fills). */
export const GOLDEN_REFUSAL_COUNT = 6;

/** The golden count of venue records a refused batch produces (ZERO — refused intents never reach the venue). */
export const GOLDEN_REFUSED_VENUE_RECORDS = 0;
