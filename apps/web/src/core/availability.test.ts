// Tests for the availability projection (L4 at the interface).
//
// Laws pinned here (availability.ts header):
//   - `projectToView` filters what was knowable at the view instant, order-preserving, pure;
//   - `assertVisible` throws the typed AvailabilityViolationError for a post-availability datum;
//   - a datum available EXACTLY at the view instant is visible (the boundary is inclusive);
//   - a finished job's record is knowable at its completion, a pending one at its submission;
//   - identical inputs -> identical projection (determinism).

import { describe, expect, it } from 'vitest';
import type { JobRecord, OutcomeRecord, ProjectRecord } from '../api/contracts';
import {
  assertVisible,
  availabilityOfJob,
  availabilityOfListing,
  availabilityOfOutcome,
  availabilityOfProject,
  projectToView,
} from './availability';
import { AvailabilityViolationError, ConsoleLawError } from './errors';

const pendingJob = {
  jobId: 'job-1',
  kind: 'research.compile',
  tenant: 'tenant-a',
  project: 'proj-a',
  status: 'queued',
  submittedAt: 1_000,
} as unknown as JobRecord;

const doneJob = { ...pendingJob, jobId: 'job-2', status: 'succeeded', completedAt: 5_000 } as unknown as JobRecord;

describe('availability: the per-record availability instants', () => {
  it('a pending job is knowable at its submission', () => {
    expect(availabilityOfJob(pendingJob)).toBe(1_000);
  });

  it('a finished job is knowable at its completion (conservative — no back-filled intermediates)', () => {
    expect(availabilityOfJob(doneJob)).toBe(5_000);
  });

  it('a project record is knowable at its updatedAt', () => {
    expect(availabilityOfProject({ updatedAt: 42 } as unknown as ProjectRecord)).toBe(42);
  });

  it('an outcome record is knowable at its asOf', () => {
    expect(availabilityOfOutcome({ asOf: 99 } as unknown as OutcomeRecord)).toBe(99);
  });

  it('the listing bound is the latest fact it carries (0 when empty)', () => {
    expect(availabilityOfListing([])).toBe(0);
    expect(
      availabilityOfListing([
        { datumRef: 'a', availableAt: 300 },
        { datumRef: 'b', availableAt: 100 },
        { datumRef: 'c', availableAt: 200 },
      ]),
    ).toBe(300);
  });
});

describe('availability: the projection (L4)', () => {
  const records = [
    { ref: 'r1', availableAt: 100 },
    { ref: 'r2', availableAt: 300 },
    { ref: 'r3', availableAt: 200 },
  ];

  it('filters to what was knowable at the view instant, preserving order', () => {
    expect(projectToView(records, 250, (r) => r.availableAt).map((r) => r.ref)).toEqual(['r1', 'r3']);
    expect(projectToView(records, 99, (r) => r.availableAt)).toEqual([]);
    expect(projectToView(records, 300, (r) => r.availableAt).map((r) => r.ref)).toEqual(['r1', 'r2', 'r3']);
  });

  it('the boundary is inclusive: a datum available exactly at the view instant IS visible', () => {
    expect(projectToView(records, 300, (r) => r.availableAt)).toHaveLength(3);
    expect(() => assertVisible({ datumRef: 'r2', availableAt: 300 }, 300)).not.toThrow();
  });

  it('is pure: identical inputs -> identical projection (determinism)', () => {
    const first = projectToView(records, 250, (r) => r.availableAt);
    const second = projectToView([...records], 250, (r) => r.availableAt);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});

describe('availability: the render gate (typed AvailabilityViolationError)', () => {
  it('renders a knowable datum without throwing', () => {
    expect(() => assertVisible({ datumRef: 'r1', availableAt: 100 }, 100)).not.toThrow();
    expect(() => assertVisible({ datumRef: 'r1', availableAt: 50 }, 100)).not.toThrow();
  });

  it('a post-availability datum is the typed AvailabilityViolationError (never a wrong render)', () => {
    let caught: unknown;
    try {
      assertVisible({ datumRef: 'outcome/42', availableAt: 5_000 }, 1_000);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AvailabilityViolationError);
    expect(caught).toBeInstanceOf(ConsoleLawError);
    const violation = caught as AvailabilityViolationError;
    expect(violation.name).toBe('AvailabilityViolationError');
    expect(violation.code).toBe('availability_violation');
    expect(violation.availableAt).toBe(5_000);
    expect(violation.viewAt).toBe(1_000);
    expect(violation.message).toContain('outcome/42');
    expect(violation.message).toContain('L4');
  });
});
