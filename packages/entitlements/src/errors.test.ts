// @tradrl/entitlements — the typed error taxonomy tests (the closed
// vocabulary is pinned member-for-member; the result helpers are total).

import { describe, expect, it } from 'vitest';
import {
  API_BOUNDARY_ERROR_FAMILY_OF,
  ENTITLEMENT_ERROR_CODES,
  ENTITLEMENT_ID_PATTERN,
  fail,
  failures,
  isEntitlementErrorCode,
  missingField,
  ok,
} from './index';

describe('the closed error vocabulary', () => {
  it('is pinned member-for-member (a new member is an architecture change)', () => {
    expect([...ENTITLEMENT_ERROR_CODES]).toEqual([
      'invalid_type',
      'missing_field',
      'invalid_field',
      'invalid_id',
      'invalid_timestamp',
      'invalid_decimal',
      'tenant_missing',
      'cross_tenant_access',
      'entitlement_unknown',
      'grant_mismatch',
      'kind_change_forbidden',
      'entitlement_exhausted',
      'entitlement_expired',
      'entitlement_inactive',
      'entitlement_revoked',
      'invalid_transition',
      'chain_mismatch',
      'usage_denied',
      'l4_boundary_violation',
    ]);
  });

  it('the guard admits members and nothing else', () => {
    expect(isEntitlementErrorCode('entitlement_exhausted')).toBe(true);
    expect(isEntitlementErrorCode('Entitlement_Exhausted')).toBe(false);
    expect(isEntitlementErrorCode('exhausted')).toBe(false);
    expect(isEntitlementErrorCode(42)).toBe(false);
  });

  it('the API boundary projection keeps the REAL SDK family for the shared member (L20 typed projection)', () => {
    expect(API_BOUNDARY_ERROR_FAMILY_OF.cross_tenant_access).toBe('tenant');
    expect(API_BOUNDARY_ERROR_FAMILY_OF.entitlement_exhausted).toBe('permission');
    expect(API_BOUNDARY_ERROR_FAMILY_OF.usage_denied).toBe('permission');
  });
});

describe('the result helpers', () => {
  it('ok/fail/failures carry the typed shape', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    const one = fail('entitlement_unknown', 'no such grant', 'grantId');
    expect(one.ok).toBe(false);
    if (!one.ok) {
      expect(one.errors).toHaveLength(1);
      expect(one.errors[0]).toMatchObject({ code: 'entitlement_unknown', path: 'grantId' });
    }
    const many = failures([missingField('a'), missingField('b')]);
    expect(many.ok).toBe(false);
    if (!many.ok) expect(many.errors).toHaveLength(2);
    // failures() never returns an empty error list.
    const degenerate = failures([]);
    expect(degenerate.ok).toBe(false);
    if (!degenerate.ok) expect(degenerate.errors.length).toBeGreaterThan(0);
  });
});

describe('the owned id grammar', () => {
  it('eg:/cns:/rev: are the only prefixes; the digest is 16-hex', () => {
    expect(ENTITLEMENT_ID_PATTERN.test('eg:0123456789abcdef')).toBe(true);
    expect(ENTITLEMENT_ID_PATTERN.test('cns:0123456789abcdef')).toBe(true);
    expect(ENTITLEMENT_ID_PATTERN.test('rev:0123456789abcdef')).toBe(true);
    expect(ENTITLEMENT_ID_PATTERN.test('pvd:0123456789abcdef')).toBe(false);
    expect(ENTITLEMENT_ID_PATTERN.test('eg:0123456789ABCDEF')).toBe(false);
    expect(ENTITLEMENT_ID_PATTERN.test('eg:')).toBe(false);
  });
});
