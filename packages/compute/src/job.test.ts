/**
 * EpisodeJob contract tests: collect-all validation of every field (the
 * L9 lineage gaps, the L12 tenant/project gaps, the driver configuration
 * law, the seed-range law), guard/validator coherence, and the
 * deep-immutability discipline.
 */

import { describe, expect, it } from 'vitest';

import * as compute from './index';

function unwrap<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: unknown }): T {
  if (result.ok) return result.value;
  throw new Error(`unexpected failure: ${JSON.stringify(result.errors)}`);
}

function jobLiteral(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    job_id: 'job-test-alpha',
    lineage: {
      experiment: 'exp-test',
      environment_config: 'envcfg-test',
      policy: 'policy:scripted@1',
      reward_models: ['reward-model:obs-count@1'],
      tenant: 'tenant-test',
      project: 'prj-test',
    },
    arm: 'arm-control',
    seed_base: 'seed-base-alpha',
    seed_range: { start: 0, end: 6 },
    step_budget: 12,
    driver: {
      actor: 'agent-compute-test',
      step_ms: 100,
      runtime: '@tradrl/learning/compute@1',
      body_versions: ['body-compute@1'],
      substrates: ['substrate-compute@1'],
    },
    ...overrides,
  };
}

describe('validateEpisodeJob (collect-all)', () => {
  it('accepts the canonical literal; the value is narrowed, deeply frozen', () => {
    const job = unwrap(compute.validateEpisodeJob(jobLiteral()));
    expect(compute.isEpisodeJob(job)).toBe(true);
    expect(compute.isDeeplyFrozen(job)).toBe(true);
    expect(() => {
      (job as unknown as { step_budget: number }).step_budget = 99;
    }).toThrow();
    expect(() => {
      (job.lineage as unknown as { tenant: string }).tenant = 'other';
    }).toThrow();
  });

  it('rejects non-objects with job_invalid', () => {
    for (const bad of [null, 42, 'job', [], true]) {
      const result = compute.validateEpisodeJob(bad);
      expect(result.ok, JSON.stringify(bad)).toBe(false);
      if (!result.ok) expect(result.errors[0]?.code).toBe('job_invalid');
    }
  });

  it('collects every missing field in one pass', () => {
    const result = compute.validateEpisodeJob({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.errors.map((error) => error.path).sort();
      expect(paths).toEqual(
        [
          'job.arm',
          'job.driver',
          'job.job_id',
          'job.seed_base',
          'job.seed_range',
          'job.step_budget',
          'job.lineage',
        ].sort(),
      );
      expect(result.errors.filter((error) => error.code === 'job_invalid').length).toBeGreaterThanOrEqual(5);
    }
  });

  it('L9 lineage gaps: each lineage field missing fails with lineage_gap', () => {
    for (const field of ['experiment', 'environment_config', 'policy', 'reward_models']) {
      const lineage = jobLiteral().lineage as Record<string, unknown>;
      delete lineage[field];
      const result = compute.validateEpisodeJob(jobLiteral({ lineage }));
      expect(result.ok, field).toBe(false);
      if (!result.ok) {
        expect(result.errors[0]?.code).toBe('lineage_gap');
        expect(result.errors[0]?.path).toBe(`job.lineage.${field}`);
      }
    }
  });

  it('L12 tenant gaps: missing/invalid tenant and project fail with tenant_missing', () => {
    for (const field of ['tenant', 'project']) {
      const lineage = jobLiteral().lineage as Record<string, unknown>;
      delete lineage[field];
      const result = compute.validateEpisodeJob(jobLiteral({ lineage }));
      expect(result.ok, field).toBe(false);
      if (!result.ok) {
        expect(result.errors[0]?.code).toBe('tenant_missing');
        expect(result.errors[0]?.path).toBe(`job.lineage.${field}`);
      }

      const invalid = jobLiteral().lineage as Record<string, unknown>;
      invalid[field] = '';
      const invalidResult = compute.validateEpisodeJob(jobLiteral({ lineage: invalid }));
      expect(invalidResult.ok, field).toBe(false);
      if (!invalidResult.ok) expect(invalidResult.errors[0]?.code).toBe('tenant_missing');
    }
  });

  it('reward model refs must be non-empty strings and duplicate-free', () => {
    const dup = jobLiteral().lineage as Record<string, unknown>;
    dup.reward_models = ['reward-model:a@1', 'reward-model:a@1'];
    const result = compute.validateEpisodeJob(jobLiteral({ lineage: dup }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.path === 'job.lineage.reward_models')).toBe(true);
    }

    const empty = jobLiteral().lineage as Record<string, unknown>;
    empty.reward_models = [];
    expect(unwrap(compute.validateEpisodeJob(jobLiteral({ lineage: empty }))).lineage.reward_models).toEqual([]);
  });

  it('the seed range must be a NON-EMPTY [start, end) range of safe integers', () => {
    for (const bad of [{ start: 0, end: 0 }, { start: 5, end: 5 }, { start: 3, end: 1 }, { start: -1, end: 3 }, { start: 0.5, end: 3 }, { start: 0, end: Number.MAX_SAFE_INTEGER * 2 }]) {
      const result = compute.validateEpisodeJob(jobLiteral({ seed_range: bad }));
      expect(result.ok, JSON.stringify(bad)).toBe(false);
      if (!result.ok) {
        expect(result.errors[0]?.code).toBe('job_invalid');
        expect(result.errors[0]?.path).toBe('job.seed_range');
      }
    }
    // A range that does not start at zero is legitimate (a batch continuing
    // another batch's ordinals).
    expect(unwrap(compute.validateEpisodeJob(jobLiteral({ seed_range: { start: 10, end: 16 } }))).seed_range).toEqual({ start: 10, end: 16 });
  });

  it('the driver configuration law: producers and cadence are required', () => {
    for (const [overrides, path] of [
      [{ step_ms: 0 }, 'job.driver.step_ms'],
      [{ step_ms: -100 }, 'job.driver.step_ms'],
      [{ step_ms: 1.5 }, 'job.driver.step_ms'],
      [{ actor: '' }, 'job.driver.actor'],
      [{ runtime: '' }, 'job.driver.runtime'],
      [{ body_versions: [] }, 'job.driver.body_versions'],
      [{ body_versions: [''] }, 'job.driver.body_versions[0]'],
      [{ substrates: [] }, 'job.driver.substrates'],
      [{ data: [''] }, 'job.driver.data[0]'],
    ] as const) {
      const result = compute.validateEpisodeJob(jobLiteral({ driver: { ...(jobLiteral().driver as Record<string, unknown>), ...overrides } }));
      expect(result.ok, JSON.stringify(overrides)).toBe(false);
      if (!result.ok) {
        expect(result.errors[0]?.path).toBe(path);
      }
    }
    // Optional `data` may be absent entirely.
    const driver = jobLiteral().driver as Record<string, unknown>;
    expect(unwrap(compute.validateEpisodeJob(jobLiteral({ driver }))).driver.data).toBeUndefined();
  });

  it('the step budget must be a positive safe integer', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      const result = compute.validateEpisodeJob(jobLiteral({ step_budget: bad }));
      expect(result.ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it('guard coherence: isEpisodeJob accepts exactly the valid records', () => {
    expect(compute.isEpisodeJob(unwrap(compute.validateEpisodeJob(jobLiteral())))).toBe(true);
    expect(compute.isEpisodeJob(jobLiteral())).toBe(true);
    expect(compute.isEpisodeJob(jobLiteral({ step_budget: 0 }))).toBe(false);
    expect(compute.isEpisodeJob(null)).toBe(false);
  });
});

describe('validateJobLineage / validateDriverConfig (direct)', () => {
  it('lineage: collect-all over every field with the L9/L12 codes', () => {
    const result = compute.validateJobLineage({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBe(6);
      expect(result.errors.filter((error) => error.code === 'lineage_gap').length).toBe(4);
      expect(result.errors.filter((error) => error.code === 'tenant_missing').length).toBe(2);
    }
    expect(unwrap(compute.validateJobLineage(jobLiteral().lineage)).experiment).toBe('exp-test');
  });

  it('driver: collect-all over every field', () => {
    const result = compute.validateDriverConfig({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBe(5);
    expect(unwrap(compute.validateDriverConfig(jobLiteral().driver)).step_ms).toBe(100);
  });
});
