/**
 * SeedPartitioning tests — the determinism law's seed discipline.
 *
 * Property-style coverage over many (range, worker-count) shapes: TOTAL
 * COVERAGE (the union of all slots' subranges is exactly the range), ZERO
 * OVERLAP (distinct slots never share an ordinal), determinism (the same
 * inputs produce the same subranges, twice), the declared shape (sizes
 * differ by at most one; earlier slots absorb the remainder), the
 * (job, slot, index) derivability witness, and the job-namespacing of
 * episode seeds.
 */

import { describe, expect, it } from 'vitest';

import * as compute from './index';

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: unknown }): T {
  if (result.ok) return result.value;
  throw new Error(`unexpected failure: ${JSON.stringify(result.errors)}`);
}

function jobWithRange(start: number, end: number): compute.EpisodeJob {
  return unwrap(
    compute.validateEpisodeJob({
      job_id: 'job-partition-test',
      lineage: {
        experiment: 'exp-partition',
        environment_config: 'envcfg-partition',
        policy: 'policy:scripted@1',
        reward_models: [],
        tenant: 'tenant-partition',
        project: 'prj-partition',
      },
      arm: 'arm-control',
      seed_base: 'seed-base-partition',
      seed_range: { start, end },
      step_budget: 8,
      driver: {
        actor: 'agent-partition',
        step_ms: 100,
        runtime: '@tradrl/learning/compute@1',
        body_versions: ['body@1'],
        substrates: ['sub@1'],
      },
    }),
  );
}

describe('partitionSeedRange (the declared partitioning function)', () => {
  it('property: total coverage, zero overlap, over many shapes', () => {
    for (let size = 1; size <= 13; size++) {
      for (let workers = 1; workers <= 7; workers++) {
        for (let origin = 0; origin <= 2; origin++) {
          const range = { start: origin, end: origin + size };
          const partitions = unwrap(compute.allPartitions(range, workers));
          expect(partitions.length).toBe(workers);

          const covered = new Set<number>();
          for (const partition of partitions) {
            expect(partition.start).toBeGreaterThanOrEqual(range.start);
            expect(partition.end).toBeLessThanOrEqual(range.end);
            expect(partition.end).toBeGreaterThanOrEqual(partition.start);
            for (let ordinal = partition.start; ordinal < partition.end; ordinal++) {
              expect(covered.has(ordinal), `size=${size} workers=${workers} ordinal=${ordinal} covered twice`).toBe(false);
              covered.add(ordinal);
            }
          }
          expect(covered.size).toBe(size);
          for (let ordinal = range.start; ordinal < range.end; ordinal++) {
            expect(covered.has(ordinal), `size=${size} workers=${workers} ordinal=${ordinal} missing`).toBe(true);
          }
        }
      }
    }
  });

  it('property: the declared shape — contiguous, sizes differ by at most one, earlier slots take the remainder', () => {
    for (const [size, workers] of [[6, 4], [10, 3], [3, 5], [12, 12], [7, 2]] as const) {
      const range = { start: 0, end: size };
      const partitions = unwrap(compute.allPartitions(range, workers));
      const sizes = partitions.map((partition) => partition.end - partition.start);
      const nonEmptySizes = sizes.filter((value) => value > 0);
      const base = Math.floor(size / workers);
      const remainder = size % workers;
      // The first `remainder` non-empty slots carry base+1; the rest base.
      nonEmptySizes.forEach((value, index) => {
        expect(value).toBe(index < remainder ? base + 1 : base);
      });
      // Contiguity: slot i+1 starts where slot i ends.
      for (let slot = 1; slot < partitions.length; slot++) {
        expect(partitions[slot]?.start).toBe(partitions[slot - 1]?.end);
      }
      // When workers outnumber ordinals, trailing slots are empty.
      if (workers > size) {
        expect(sizes.filter((value) => value === 0).length).toBe(workers - size);
        for (let slot = 0; slot < partitions.length; slot++) {
          expect(compute.isEmptyPartition(partitions[slot] as compute.SeedRange)).toBe(slot >= size);
        }
      }
    }
  });

  it('deterministic: the same inputs produce the same subranges, twice', () => {
    for (const [size, workers] of [[10, 3], [9, 4], [1, 3]] as const) {
      const first = unwrap(compute.allPartitions({ start: 2, end: 2 + size }, workers));
      const second = unwrap(compute.allPartitions({ start: 2, end: 2 + size }, workers));
      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    }
  });

  it('typed errors: malformed range, non-positive worker count, out-of-bounds slot', () => {
    const badRange = compute.partitionSeedRange({ start: 5, end: 3 }, 2, 0);
    expect(badRange.ok).toBe(false);
    if (!badRange.ok) expect(badRange.errors[0]?.path).toBe('range');

    const badWorkers = compute.partitionSeedRange({ start: 0, end: 4 }, 0, 0);
    expect(badWorkers.ok).toBe(false);
    if (!badWorkers.ok) expect(badWorkers.errors[0]?.path).toBe('worker_count');

    const badSlot = compute.partitionSeedRange({ start: 0, end: 4 }, 2, 2);
    expect(badSlot.ok).toBe(false);
    if (!badSlot.ok) expect(badSlot.errors[0]?.path).toBe('slot');

    const negativeSlot = compute.partitionSeedRange({ start: 0, end: 4 }, 2, -1);
    expect(negativeSlot.ok).toBe(false);
  });
});

describe('episodeSeedAt / episodeSeedInSlot (the declared derivation)', () => {
  it('every episode seed is derivable from (job id, worker slot, index) — and independent of the worker count', () => {
    const job = jobWithRange(4, 16); // 12 ordinals
    for (let workers = 1; workers <= 6; workers++) {
      for (let slot = 0; slot < workers; slot++) {
        const partitions = unwrap(compute.allPartitions(job.seed_range, workers));
        const subrange = partitions[slot] as compute.SeedRange;
        const width = subrange.end - subrange.start;
        for (let index = 0; index < width; index++) {
          const viaSlot = unwrap(compute.episodeSeedInSlot(job, workers, slot, index));
          const absolute = compute.episodeSeedAt(job, subrange.start + index);
          expect(viaSlot).toBe(absolute);
        }
      }
    }
  });

  it('the 1-vs-N seed law: the same ABSOLUTE ordinal yields the same seed at any worker count', () => {
    const job = jobWithRange(0, 9);
    const solo = unwrap(compute.allPartitions(job.seed_range, 1))[0] as compute.SeedRange;
    for (let ordinal = solo.start; ordinal < solo.end; ordinal++) {
      const soloSeed = compute.episodeSeedAt(job, ordinal);
      for (let workers = 2; workers <= 5; workers++) {
        const partitions = unwrap(compute.allPartitions(job.seed_range, workers));
        for (let slot = 0; slot < workers; slot++) {
          const subrange = partitions[slot] as compute.SeedRange;
          if (ordinal >= subrange.start && ordinal < subrange.end) {
            const seed = unwrap(compute.episodeSeedInSlot(job, workers, slot, ordinal - subrange.start));
            expect(seed, `ordinal=${ordinal} workers=${workers} slot=${slot}`).toBe(soloSeed);
          }
        }
      }
    }
  });

  it('deterministic and job-namespaced: same ordinal, different jobs -> different seeds; same twice -> equal', () => {
    const job = jobWithRange(0, 3);
    expect(compute.episodeSeedAt(job, 1)).toBe(compute.episodeSeedAt(job, 1));
    expect(compute.episodeSeedAt(job, 1)).not.toBe(compute.episodeSeedAt(job, 2));
    expect(compute.episodeSeedAt(job, 1)).toMatch(/^seed-[0-9a-f]{8}$/);

    const other = jobWithRange(0, 3);
    const mutated = { ...other, job_id: 'job-partition-other' as compute.JobId, seed_base: other.seed_base };
    expect(compute.episodeSeedAt(job, 1)).not.toBe(compute.episodeSeedAt(mutated, 1));
  });

  it('episodeSeedInSlot typed errors: empty slot, out-of-partition index', () => {
    const job = jobWithRange(0, 2);
    const empty = compute.episodeSeedInSlot(job, 4, 3, 0);
    expect(empty.ok).toBe(false);

    const outOfRange = compute.episodeSeedInSlot(job, 1, 0, 2);
    expect(outOfRange.ok).toBe(false);

    const negative = compute.episodeSeedInSlot(job, 1, 0, -1);
    expect(negative.ok).toBe(false);
  });
});

describe('deterministic identities (trial/trajectory/submission)', () => {
  it('trial and trajectory ids derive from (job, ordinal) — stable and distinct', () => {
    expect(compute.deriveJobTrialId('job-x' as compute.JobId, 0)).toBe(compute.deriveJobTrialId('job-x' as compute.JobId, 0));
    expect(compute.deriveJobTrialId('job-x' as compute.JobId, 0)).not.toBe(compute.deriveJobTrialId('job-x' as compute.JobId, 1));
    expect(compute.deriveJobTrialId('job-x' as compute.JobId, 0)).not.toBe(compute.deriveJobTrialId('job-y' as compute.JobId, 0));
    expect(compute.deriveJobTrialId('job-x' as compute.JobId, 3)).toMatch(/^trial-[0-9a-f]{8}$/);
    expect(compute.deriveJobTrajectoryId('job-x' as compute.JobId, 3)).toMatch(/^traj-[0-9a-f]{8}$/);
    expect(compute.deriveJobTrialId('job-x' as compute.JobId, 3)).not.toBe(compute.deriveJobTrajectoryId('job-x' as compute.JobId, 3));
  });

  it('submission ids derive from (job, slot, worker count) — stable and distinct', () => {
    expect(compute.deriveSubmissionId('job-x' as compute.JobId, 0, 1)).toBe(compute.deriveSubmissionId('job-x' as compute.JobId, 0, 1));
    expect(compute.deriveSubmissionId('job-x' as compute.JobId, 0, 1)).not.toBe(compute.deriveSubmissionId('job-x' as compute.JobId, 0, 2));
    expect(compute.deriveSubmissionId('job-x' as compute.JobId, 0, 2)).not.toBe(compute.deriveSubmissionId('job-x' as compute.JobId, 1, 2));
    expect(compute.deriveSubmissionId('job-x' as compute.JobId, 1, 2)).toMatch(/^sub-[0-9a-f]{8}$/);
  });
});
