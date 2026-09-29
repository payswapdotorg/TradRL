/**
 * @tradrl/compute — the declared SeedPartitioning (the determinism law's
 * seed discipline).
 *
 * THE LAW (Work Order T014): "episode generation results are a PURE
 * FUNCTION of (job specification, seed, environment/policy script) — NEVER
 * of scheduling order, worker count, or timing. Aggregation folds results
 * in a DECLARED canonical order ... so that a 1-worker run and an N-worker
 * run over the same job set produce byte-identical aggregates."
 *
 * The seed discipline that makes the law true:
 *
 *   1. A job's seed RANGE `[start, end)` names the ABSOLUTE episode ordinals
 *      the batch generates.
 *   2. {@link partitionSeedRange} — the DECLARED partitioning function —
 *      splits a range across N worker slots deterministically: contiguous
 *      subranges, earlier slots absorbing the remainder, total coverage,
 *      zero overlap (property-tested over many job/worker-count shapes).
 *   3. Every episode's seed derives from the ABSOLUTE ordinal via
 *      {@link episodeSeedAt} — `seed-<fnv1a32(seed_base|job_id|ordinal)>` —
 *      so the seed NEVER depends on the worker count, the slot, or the
 *      arrival order. The work order states the derivability as "every
 *      episode's seed is derivable from (job id, worker slot, index)":
 *      {@link episodeSeedInSlot} is that composition — the DECLARED
 *      partition maps (slot, index) to the absolute ordinal, which maps to
 *      the seed. The absolute ordinal (not the slot) drives the seed value,
 *      which is exactly why 1-worker and N-worker runs over the same job
 *      set generate the SAME episodes, byte-identically.
 *   4. No ambient randomness anywhere: same (job, ordinal) -> same seed,
 *      twice, forever.
 */

import { deepFreeze, isNonNegativeSafeInteger, isPositiveSafeInteger, fnv1a32Hex } from './primitives';
import { fail, ok, type ComputeResult } from './errors';
import type { EpisodeJob, SeedRange } from './job';
import { isSeedRange } from './job';
import type { JobId, Seed, TrialId, TrajectoryId } from './ids';

// ---------------------------------------------------------------------------
// The declared partitioning function
// ---------------------------------------------------------------------------

/**
 * The DECLARED partitioning function: the seed subrange worker `slot`
 * generates when `workerCount` workers share `range`.
 *
 * Deterministic and total: contiguous subranges in slot order; when the
 * range does not divide evenly the FIRST `remainder` slots absorb one extra
 * ordinal; when workers outnumber ordinals the trailing slots receive
 * EMPTY ranges (the planner does not schedule empty slots — no work, no
 * submission).
 *
 * Laws (property-tested): the union of all slots' subranges is exactly
 * `range` (total coverage); distinct slots' subranges are disjoint (zero
 * overlap); the same inputs always produce the same subrange (declared,
 * not configured).
 */
export function partitionSeedRange(range: unknown, workerCount: number, slot: number): ComputeResult<SeedRange> {
  if (!isSeedRange(range)) {
    return fail('invalid_field', 'partitionSeedRange requires a well-formed seed range (0 <= start <= end, safe integers)', 'range');
  }
  if (!isPositiveSafeInteger(workerCount)) {
    return fail('invalid_field', 'workerCount must be a positive safe integer', 'worker_count');
  }
  if (!isNonNegativeSafeInteger(slot) || slot >= workerCount) {
    return fail('invalid_field', `slot must be a safe integer in [0, ${workerCount})`, 'slot');
  }
  const total = range.end - range.start;
  const base = Math.floor(total / workerCount);
  const remainder = total % workerCount;
  const size = base + (slot < remainder ? 1 : 0);
  const offset = slot * base + Math.min(slot, remainder);
  return ok(deepFreeze({ start: range.start + offset, end: range.start + offset + size }));
}

/** `true` when a partitioned subrange carries no work (a slot that is not scheduled). */
export function isEmptyPartition(range: SeedRange): boolean {
  return range.end <= range.start;
}

// ---------------------------------------------------------------------------
// The declared episode-seed derivation
// ---------------------------------------------------------------------------

/**
 * The declared derivation of one episode's seed from the ABSOLUTE ordinal:
 * `seed-<fnv1a32(seed_base|job_id|ordinal)>`. Pure and deterministic —
 * the same (job, ordinal) yields the same seed forever (no ambient
 * randomness). Distinct jobs never collide on seeds even at equal
 * ordinals: the job id namespaces the derivation.
 */
export function episodeSeedAt(job: EpisodeJob, ordinal: number): Seed {
  return `seed-${fnv1a32Hex(`${job.seed_base}|${job.job_id}|${ordinal}`)}` as Seed;
}

/**
 * The work-order derivability witness: the seed of the episode at
 * `index` WITHIN worker `slot`'s partition — the DECLARED partition maps
 * (slot, index) to the absolute ordinal, the derivation maps the ordinal
 * to the seed. The composition is total and deterministic; the VALUE
 * depends only on the absolute ordinal, never on the slot (the
 * 1-worker/N-worker equivalence law).
 */
export function episodeSeedInSlot(job: EpisodeJob, workerCount: number, slot: number, index: number): ComputeResult<Seed> {
  const partition = partitionSeedRange(job.seed_range, workerCount, slot);
  if (!partition.ok) return partition;
  const subrange = partition.value;
  if (isEmptyPartition(subrange)) {
    return fail('invalid_field', `slot ${slot} has an empty partition for this job — no episode seed exists at any index`, 'slot');
  }
  if (!isNonNegativeSafeInteger(index) || subrange.start + index >= subrange.end) {
    return fail('invalid_field', `index must be a safe integer in [0, ${subrange.end - subrange.start}) of slot ${slot}'s partition [${subrange.start}, ${subrange.end})`, 'index');
  }
  return ok(episodeSeedAt(job, subrange.start + index));
}

// ---------------------------------------------------------------------------
// Deterministic identities derived from the seed discipline
// ---------------------------------------------------------------------------

/**
 * The declared derivation of one episode's trial id:
 * `trial-<fnv1a32(job_id|ordinal)>` — deterministic, so the aggregate's
 * trial identities are a pure function of the job set (L9). Two distinct
 * (job, ordinal) pairs claiming one trial id is a typed `duplicate_trial`
 * at aggregation — honest derivation cannot collide.
 */
export function deriveJobTrialId(job: JobId, ordinal: number): TrialId {
  return `trial-${fnv1a32Hex(`${job}|${ordinal}`)}` as TrialId;
}

/**
 * The declared derivation of one episode's trajectory ref:
 * `traj-<fnv1a32(job_id|ordinal)>` — mirrors T013's
 * `deriveTrajectoryId(run, episode)` discipline (`traj-<fnv1a32(...)>`)
 * with the distributed identity source (job + ordinal instead of run +
 * episode). The trial's trajectory ref and the assembled trajectory's
 * identity agree by construction.
 */
export function deriveJobTrajectoryId(job: JobId, ordinal: number): TrajectoryId {
  return `traj-${fnv1a32Hex(`${job}|${ordinal}`)}` as TrajectoryId;
}

// ---------------------------------------------------------------------------
// Partition law helpers (the property-test vocabulary)
// ---------------------------------------------------------------------------

/**
 * Fold every slot's subrange of `range` across `workerCount` workers —
 * the property tests' oracle (total coverage, zero overlap). Fails with
 * the partition's own typed errors when the inputs are malformed.
 */
export function allPartitions(range: SeedRange, workerCount: number): ComputeResult<readonly SeedRange[]> {
  if (!isSeedRange(range)) {
    return fail('invalid_field', 'allPartitions requires a well-formed seed range', 'range');
  }
  if (!isPositiveSafeInteger(workerCount)) {
    return fail('invalid_field', 'workerCount must be a positive safe integer', 'worker_count');
  }
  const partitions: SeedRange[] = [];
  for (let slot = 0; slot < workerCount; slot++) {
    const partition = partitionSeedRange(range, workerCount, slot);
    if (!partition.ok) return partition;
    partitions.push(partition.value);
  }
  return ok(deepFreeze(partitions));
}
