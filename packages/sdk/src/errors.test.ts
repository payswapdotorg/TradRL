/**
 * @tradrl/sdk — the typed error taxonomy tests: every family is
 * programmatically distinguishable three ways (`instanceof`, the
 * `code`, the `family`); the envelope translation is total; retryable
 * classification covers exactly rate-limit + unavailable.
 */

import { describe, expect, it } from 'vitest';

import {
  ApiSdkError,
  AuthenticationError,
  ConflictError,
  NotFoundError,
  PermissionError,
  RateLimitError,
  SDK_ERROR_CODES,
  TenantIsolationError,
  UnavailableError,
  ValidationError,
  VersionMismatchError,
  errorFromEnvelope,
  isRetryable,
} from './errors';

describe('the envelope translation', () => {
  const cases: readonly { readonly code: string; readonly status: number; readonly klass: new (error: ApiSdkError) => ApiSdkError; readonly family: string }[] = [
    { code: 'unauthenticated', status: 401, klass: AuthenticationError, family: 'auth' },
    { code: 'wrong_auth_plane', status: 403, klass: PermissionError, family: 'permission' },
    { code: 'forbidden', status: 403, klass: PermissionError, family: 'permission' },
    { code: 'gate_bypass_attempt', status: 403, klass: PermissionError, family: 'permission' },
    { code: 'cross_tenant_access', status: 403, klass: TenantIsolationError, family: 'tenant' },
    { code: 'rate_limited', status: 429, klass: RateLimitError, family: 'rate-limit' },
    { code: 'validation_failed', status: 400, klass: ValidationError, family: 'validation' },
    { code: 'idempotency_required', status: 400, klass: ValidationError, family: 'validation' },
    { code: 'idempotency_conflict', status: 409, klass: ConflictError, family: 'conflict' },
    { code: 'conflict', status: 409, klass: ConflictError, family: 'conflict' },
    { code: 'unavailable', status: 503, klass: UnavailableError, family: 'unavailable' },
    { code: 'not_found', status: 404, klass: NotFoundError, family: 'not-found' },
    { code: 'method_not_allowed', status: 405, klass: NotFoundError, family: 'not-found' },
    { code: 'unsupported_version', status: 404, klass: VersionMismatchError, family: 'version' },
  ];

  it('every code of the closed vocabulary maps to its class + family (the Work Order\'s named families all present)', () => {
    for (const { code, status, klass, family } of cases) {
      const error = errorFromEnvelope({ code, message: `the ${code} message`, status });
      expect(error).toBeInstanceOf(klass);
      expect(error.code).toBe(code);
      expect(error.status).toBe(status);
      expect(error.family).toBe(family);
      expect(error instanceof ApiSdkError).toBe(true);
    }
    // The Work Order's seven named families each have at least one code.
    for (const family of ['auth', 'permission', 'tenant', 'rate-limit', 'validation', 'conflict', 'unavailable']) {
      expect(cases.some((entry) => entry.family === family)).toBe(true);
    }
  });

  it('the retry signal and the dotted problems ride through', () => {
    const error = errorFromEnvelope({ code: 'rate_limited', message: 'over budget', status: 429, retryAfterMs: 1234 }, 'req:00000042');
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.retryAfterMs).toBe(1234);
    expect(error.requestId).toBe('req:00000042');

    const validation = errorFromEnvelope({ code: 'validation_failed', message: 'bad body', status: 400, problems: [{ path: 'goal.horizon', message: 'non-empty window required' }] });
    expect(validation.problems?.[0]?.path).toBe('goal.horizon');
  });

  it('an unknown code still surfaces (never swallowed)', () => {
    const error = errorFromEnvelope({ code: 'a_code_from_the_future', message: 'x', status: 418 });
    expect(error).toBeInstanceOf(ApiSdkError);
    expect(error.code).toBe('unavailable'); // fail-closed mapping: unknown codes are unavailable-classified, still thrown.
  });

  it('the closed vocabulary mirrors the service\'s (14 codes)', () => {
    expect(SDK_ERROR_CODES.length).toBe(14);
  });
});

describe('the programmatic distinction (instanceof + code + family)', () => {
  it('a tenant error is distinguishable from a permission error at the class level', () => {
    const tenant = errorFromEnvelope({ code: 'cross_tenant_access', message: 'x', status: 403 });
    const permission = errorFromEnvelope({ code: 'forbidden', message: 'x', status: 403 });
    expect(tenant instanceof TenantIsolationError).toBe(true);
    expect(tenant instanceof PermissionError).toBe(false);
    expect(permission instanceof PermissionError).toBe(true);
    expect(permission instanceof TenantIsolationError).toBe(false);
  });
});

describe('the retryable classification', () => {
  it('exactly the rate-limit and unavailable families are retryable', () => {
    expect(isRetryable(errorFromEnvelope({ code: 'rate_limited', message: 'x', status: 429 }))).toBe(true);
    expect(isRetryable(errorFromEnvelope({ code: 'unavailable', message: 'x', status: 503 }))).toBe(true);
    for (const code of ['unauthenticated', 'wrong_auth_plane', 'forbidden', 'gate_bypass_attempt', 'cross_tenant_access', 'not_found', 'method_not_allowed', 'validation_failed', 'idempotency_required', 'idempotency_conflict', 'conflict', 'unsupported_version']) {
      expect(isRetryable(errorFromEnvelope({ code, message: 'x', status: 400 }))).toBe(false);
    }
  });
});
