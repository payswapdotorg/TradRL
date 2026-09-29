// @tradrl/body-trading-director — errors tests (the closed typed-error
// taxonomy; collect-all validation; single typed failure).

import { describe, expect, it } from 'vitest';
import {
  DIRECTOR_ERROR_CODES,
  type DirectorErrorCode,
  type DirectorError,
  fail,
  failWith,
  invalidField,
  invalidType,
  missingField,
  ok,
  validationOf,
} from './errors';

describe('the closed error vocabulary', () => {
  it('contains the L4 gate code named by the Work Order', () => {
    expect(DIRECTOR_ERROR_CODES).toContain('research_from_the_future');
  });

  it('contains the L8/L16 authority codes named by the Work Order', () => {
    expect(DIRECTOR_ERROR_CODES).toContain('execution_authority_granted');
    expect(DIRECTOR_ERROR_CODES).toContain('execute_not_prohibited');
    expect(DIRECTOR_ERROR_CODES).toContain('consequential_tool_in_procedure');
    expect(DIRECTOR_ERROR_CODES).toContain('order_level_control');
  });

  it('contains the coverage-law codes (the four-lane accounting)', () => {
    expect(DIRECTOR_ERROR_CODES).toContain('lane_not_accounted');
    expect(DIRECTOR_ERROR_CODES).toContain('lane_absence_record_missing');
    expect(DIRECTOR_ERROR_CODES).toContain('coverage_status_mismatch');
    expect(DIRECTOR_ERROR_CODES).toContain('conflict_record_mismatch');
  });

  it('contains the method-honesty codes (quorum declared by the method)', () => {
    expect(DIRECTOR_ERROR_CODES).toContain('undeclared_method');
    expect(DIRECTOR_ERROR_CODES).toContain('method_version_mismatch');
    expect(DIRECTOR_ERROR_CODES).toContain('quorum_not_declared');
  });

  it('has no duplicate codes', () => {
    expect(new Set(DIRECTOR_ERROR_CODES).size).toBe(DIRECTOR_ERROR_CODES.length);
  });
});

describe('error constructors', () => {
  it('missingField, invalidField and invalidType build typed records', () => {
    const error: DirectorError = missingField('coverage');
    expect(error.code).toBe('missing_field');
    expect(error.path).toBe('coverage');
    expect(invalidField('asOf', 'bad').code).toBe('invalid_field');
    expect(invalidType('directive', 'a record').message).toContain('a record');
  });
});

describe('single typed failure', () => {
  it('ok builds the success outcome', () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(42);
  });

  it('fail builds one typed refusal', () => {
    const result = fail<never>('research_from_the_future', 'research from the future', 'sentiment.asOf');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.code).toBe('research_from_the_future');
      expect(result.errors[0]?.path).toBe('sentiment.asOf');
    }
  });

  it('failWith carries the prepared error list', () => {
    const errors: readonly DirectorError[] = [
      { code: 'lane_not_accounted', path: 'coverage', message: 'x' },
      { code: 'tenant_missing', path: 'tenantId', message: 'y' },
    ];
    const result = failWith<never>(errors);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveLength(2);
  });
});

describe('collect-all validation', () => {
  it('zero errors means ok with the value', () => {
    const validation = validationOf('value', []);
    expect(validation.ok).toBe(true);
    expect(validation.value).toBe('value');
    expect(validation.errors).toEqual([]);
  });

  it('errors mean refusal with value null and every violation carried', () => {
    const code: DirectorErrorCode = 'lane_absence_record_missing';
    const validation = validationOf(null, [
      { code, path: 'coverage.regime', message: 'a' },
      { code: 'tenant_mismatch', path: 'sentiment.tenantId', message: 'b' },
    ]);
    expect(validation.ok).toBe(false);
    expect(validation.value).toBeNull();
    expect(validation.errors).toHaveLength(2);
  });
});
