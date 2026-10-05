// @tradrl/capability-provider — the typed error taxonomy's laws.
//
// The vocabulary is CLOSED (the list equals the union, member for
// member), located by dotted paths, and the API-boundary projection
// keeps the REAL SDK family for the shared members (the interop test
// pins the parity against the REAL sdk map).

import { describe, expect, it } from 'vitest';
import {
  API_BOUNDARY_ERROR_FAMILY_OF,
  fail,
  failures,
  invalidField,
  invalidType,
  isProviderErrorCode,
  missingField,
  ok,
  PROVIDER_ERROR_CODES,
} from './index';
import type { ProviderErrorCode } from './index';

describe('the closed code vocabulary', () => {
  it('every code is a member and the list is duplicate-free', () => {
    expect(new Set(PROVIDER_ERROR_CODES).size).toBe(PROVIDER_ERROR_CODES.length);
    for (const code of PROVIDER_ERROR_CODES) {
      expect(isProviderErrorCode(code)).toBe(true);
    }
  });

  it('unknown strings are not codes (the vocabulary is closed)', () => {
    expect(isProviderErrorCode('made_up_code')).toBe(false);
    expect(isProviderErrorCode('')).toBe(false);
  });

  it('the laws this lane names are present (the worklog vocabulary)', () => {
    const expected: readonly ProviderErrorCode[] = [
      'tenant_missing',
      'cross_tenant_access',
      'label_as_evidence',
      'evidence_missing',
      'chain_mismatch',
      'provider_unknown',
      'quote_unknown',
      'engagement_exists',
      'invalid_transition',
      'deadline_exceeded',
      'verification_required',
      'verification_contract_breach',
      'verification_missing',
      'payload_digest_mismatch',
      'l4_boundary_violation',
    ];
    for (const code of expected) {
      expect(PROVIDER_ERROR_CODES).toContain(code);
    }
  });
});

describe('the result helpers', () => {
  it('ok carries the value', () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });

  it('fail carries one located error', () => {
    const result = fail('evidence_missing', 'no citation', 'request.gapRefs');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({ code: 'evidence_missing', path: 'request.gapRefs' });
    }
  });

  it('failures collects every violation and never returns an empty list', () => {
    const two = failures([missingField('a'), invalidField('b', 'bad')]);
    expect(two.ok).toBe(false);
    if (!two.ok) expect(two.errors).toHaveLength(2);
    const zero = failures([]);
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.errors).toHaveLength(1);
  });

  it('the field helpers use the documented codes and paths', () => {
    expect(missingField('x.y')).toMatchObject({ code: 'missing_field', path: 'x.y' });
    expect(invalidField('x.y', 'detail')).toMatchObject({ code: 'invalid_field', path: 'x.y', message: 'detail' });
    expect(invalidType('x', 'detail')).toMatchObject({ code: 'invalid_type', path: 'x' });
  });
});

describe('the API-boundary projection', () => {
  it('cross_tenant_access surfaces as the tenant family (the REAL SDK family)', () => {
    expect(API_BOUNDARY_ERROR_FAMILY_OF.cross_tenant_access).toBe('tenant');
  });

  it('conflict-shaped laws surface as the conflict family', () => {
    expect(API_BOUNDARY_ERROR_FAMILY_OF.engagement_exists).toBe('conflict');
    expect(API_BOUNDARY_ERROR_FAMILY_OF.deadline_exceeded).toBe('conflict');
    expect(API_BOUNDARY_ERROR_FAMILY_OF.payload_digest_mismatch).toBe('conflict');
  });

  it('verification coverage breaches surface as the validation family', () => {
    expect(API_BOUNDARY_ERROR_FAMILY_OF.verification_contract_breach).toBe('validation');
  });
});
