// Tests for the typed console-law error hierarchy.
//
// Laws pinned here (errors.ts header): every law the console enforces at the
// interface throws one of THESE classes — never a bare Error, never a silent
// wrong render. Each class carries its closed-vocabulary code and its law's
// evidence fields; the tests pin each one by name.

import { describe, expect, it } from 'vitest';
import {
  AvailabilityViolationError,
  ChainOfThoughtExposureError,
  CONSOLE_ERROR_CODES,
  ConsoleLawError,
  CrossTenantRenderError,
  InvalidLaunchDraftError,
  InvalidResearchSubmissionError,
  LoaderError,
  PolicyEnforcementError,
  WallClockReadError,
} from './errors';

describe('errors: the closed error-code vocabulary', () => {
  it('is exactly the eight console-law codes', () => {
    expect([...CONSOLE_ERROR_CODES]).toEqual([
      'chain_of_thought_exposure',
      'availability_violation',
      'cross_tenant_render',
      'wall_clock_read',
      'policy_enforcement_attempt',
      'invalid_launch_draft',
      'invalid_research_submission',
      'loader_failure',
    ]);
  });

  it('every code maps to exactly one class (below)', () => {
    expect(new ChainOfThoughtExposureError('m').code).toBe('chain_of_thought_exposure');
    expect(new AvailabilityViolationError('m', 1, 2).code).toBe('availability_violation');
    expect(new CrossTenantRenderError('m', 'a', 'b').code).toBe('cross_tenant_render');
    expect(new WallClockReadError('m').code).toBe('wall_clock_read');
    expect(new PolicyEnforcementError('m').code).toBe('policy_enforcement_attempt');
    expect(new InvalidLaunchDraftError('p', 'm').code).toBe('invalid_launch_draft');
    expect(new InvalidResearchSubmissionError('objective', 'm').code).toBe('invalid_research_submission');
    expect(new LoaderError('m').code).toBe('loader_failure');
  });
});

describe('errors: the hierarchy shape', () => {
  const instances: readonly [string, ConsoleLawError][] = [
    ['ChainOfThoughtExposureError', new ChainOfThoughtExposureError('reasoning-shaped payload blocked')],
    ['AvailabilityViolationError', new AvailabilityViolationError('m', 5_000, 1_000)],
    ['CrossTenantRenderError', new CrossTenantRenderError('m', 'tenant-a', 'tenant-b')],
    ['WallClockReadError', new WallClockReadError('m')],
    ['PolicyEnforcementError', new PolicyEnforcementError('m')],
    ['InvalidLaunchDraftError', new InvalidLaunchDraftError('capital', 'must be an exact decimal')],
    ['InvalidResearchSubmissionError', new InvalidResearchSubmissionError('objective', 'the objective statement is required')],
    ['LoaderError', new LoaderError('m')],
  ];

  it('every console-law error is a ConsoleLawError and an Error, with its own name', () => {
    for (const [className, error] of instances) {
      expect(error).toBeInstanceOf(ConsoleLawError);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe(className);
      expect(typeof error.code).toBe('string');
      expect((CONSOLE_ERROR_CODES as readonly string[]).includes(error.code)).toBe(true);
      expect(error.message.length).toBeGreaterThan(0);
    }
  });

  it('the base class itself is named for the hierarchy', () => {
    const base = new ConsoleLawError('wall_clock_read', 'direct base throw');
    expect(base.name).toBe('ConsoleLawError');
    expect(base.code).toBe('wall_clock_read');
  });
});

describe('errors: the evidence fields each law carries', () => {
  it('AvailabilityViolationError carries availableAt and viewAt (L4)', () => {
    const error = new AvailabilityViolationError('m', 5_000, 1_000);
    expect(error.availableAt).toBe(5_000);
    expect(error.viewAt).toBe(1_000);
  });

  it('CrossTenantRenderError carries expected and actual tenants (L12)', () => {
    const error = new CrossTenantRenderError('m', 'tenant-a', 'tenant-b');
    expect(error.expectedTenant).toBe('tenant-a');
    expect(error.actualTenant).toBe('tenant-b');
  });

  it('InvalidLaunchDraftError prefixes the field path (launch validation)', () => {
    const error = new InvalidLaunchDraftError('budgets.capital', 'must be a non-negative exact decimal');
    expect(error.path).toBe('budgets.capital');
    expect(error.message).toBe('budgets.capital: must be a non-negative exact decimal');
  });
});
