/**
 * @tradrl/firm-memory-service — the golden determinism constants (the
 * byte-stable digests and counts of the fixture pipeline, captured as
 * literals — the determinism test compares fresh runs against them,
 * TWICE, the way the outcome-learning lane pins its own).
 *
 * The constants were derived by running the golden pipeline
 * (fixtures.ts: batches 1..4 + the internal scenarios + tenant B's
 * world) once and recording the outputs; they are literals so any
 * drift in the mirror validation, the scope laws, the candidate
 * lifting, the promotion decisions, the reconcile, the record minting,
 * the chain folds or the state threading fails the determinism test
 * loudly.
 */

/** The golden state digest after batch 1 (adverse: 2 fresh families). */
export const GOLDEN_STATE_DIGEST_B1 = '5b584a1e';

/** The golden knowledge-chain head after batch 1. */
export const GOLDEN_KNOWLEDGE_HEAD_B1 = 'a9c04265';

/** The golden state digest after batch 2 (reinforce: 2 revisions + 1 fresh). */
export const GOLDEN_STATE_DIGEST_B2 = '94d246a7';

/** The golden state digest after batch 3 (the non-dominating challenger: 1 contest, no promotion). */
export const GOLDEN_STATE_DIGEST_B3 = '41cfd2a8';

/** The golden contradiction-register head after batch 3. */
export const GOLDEN_CONTRADICTION_HEAD_B3 = '47ff1bf3';

/** The golden state digest after batch 4 (the dominating challenger: the supersession flip). */
export const GOLDEN_STATE_DIGEST_B4 = 'b0b24eb7';

/** The golden state digest after the internal contest (equal counts: 1 contest, no promotion). */
export const GOLDEN_STATE_DIGEST_B5 = 'b75f1c31';

/** The golden state digest after the internal domination (3 helpful vs 2 harmful: 1 contest + 1 fresh). */
export const GOLDEN_STATE_DIGEST_B6 = '04c2fa3f';

/** The golden state digest after tenant B's batch (the two-tenant world). */
export const GOLDEN_STATE_DIGEST_B = 'd06130b4';

/** The golden ACTIVE knowledge count at the late instant (batch-1..4 world: decision + market(flip) + calibration + helpful-timing). */
export const GOLDEN_ACTIVE_COUNT = 4;

/** The golden knowledge-chain record count after the whole pipeline (including tenant B's two fresh families). */
export const GOLDEN_KNOWLEDGE_COUNT = 9;

/** The golden contradiction-register record count after the whole pipeline. */
export const GOLDEN_CONTRADICTION_COUNT = 4;
