// @tradrl/body-execution — methods tests: the DECLARED-METHOD
// discipline — the five order-management kinds, the registry laws, the
// citation resolution (an order-management procedure without a
// declared, versioned method is a typed error).

import { describe, expect, it } from 'vitest';
import {
  EXECUTION_METHOD_REGISTRY,
  METHOD_KINDS,
  EXECUTION_FILL_RECONCILIATION_METHOD,
  EXECUTION_ORDER_PREPARATION_METHOD,
  createMethodRecord,
  createMethodRegistry,
  findMethod,
  isMethodRecord,
  isMethodRegistry,
  resolveMethodCitation,
  validateMethodRecord,
  validateMethodRegistry,
} from './methods';
import { isDeeplyFrozen } from './primitives';

describe('the canonical registry', () => {
  it('declares exactly the five order-management methods, canonically ordered, digest-bound', () => {
    expect(EXECUTION_METHOD_REGISTRY.methods).toHaveLength(5);
    expect(EXECUTION_METHOD_REGISTRY.digest).toMatch(/^[0-9a-f]{16}$/);
    expect(isMethodRegistry(EXECUTION_METHOD_REGISTRY)).toBe(true);
    const kinds = EXECUTION_METHOD_REGISTRY.methods.map((m) => m.kind);
    expect([...kinds].sort()).toEqual([...METHOD_KINDS].sort());
    // canonical order: sorted by canonical JSON of the record
    const ids = EXECUTION_METHOD_REGISTRY.methods.map((m) => m.methodId);
    expect(ids).toEqual([...ids].sort());
  });

  it('every method is versioned, deeply frozen and fully parameterized', () => {
    for (const method of EXECUTION_METHOD_REGISTRY.methods) {
      expect(method.version).toBe('1.0.0');
      expect(method.declaredBy).toBe('tradrl-execution-declaration/1');
      expect(isMethodRecord(method)).toBe(true);
      expect(validateMethodRecord(method)).toEqual([]);
    }
    expect(isDeeplyFrozen(EXECUTION_METHOD_REGISTRY)).toBe(true);
  });

  it('the declared parameters are the Work Order\'s discipline (deadlines, grid step, responses)', () => {
    expect(EXECUTION_ORDER_PREPARATION_METHOD.parameters).toMatchObject({
      authority: 'approve-decisions-only',
      quantityCarried: 'verbatim-intent-quantity',
      floatMediation: 'rejected',
      clockBasis: 'order-level',
    });
    expect(EXECUTION_FILL_RECONCILIATION_METHOD.parameters).toMatchObject({
      equality: 'exact',
      quantityGridStep: '0.01',
      gapReporting: 'typed-record',
    });
  });
});

describe('registry construction + validation (collect-all)', () => {
  it('a valid registry constructs; the digest binds the canonical form', () => {
    const result = createMethodRegistry([
      {
        methodId: 'method/execution/order-preparation',
        kind: 'order-preparation',
        version: '1.0.0',
        parameters: {
          kind: 'order-preparation',
          input: 'execution-gate-decisions',
          authority: 'approve-decisions-only',
          orderIdentity: 'client-order-id-derived',
          quantityCarried: 'verbatim-intent-quantity',
          floatMediation: 'rejected',
          clockBasis: 'order-level',
        },
        declaredBy: 'test/1',
        declaredAt: 1,
      },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.digest).toMatch(/^[0-9a-f]{16}$/);
      expect(isMethodRegistry(result.value)).toBe(true);
    }
  });

  it('COLLECT-ALL: an empty registry, duplicate ids, and bad parameters all report', () => {
    expect(validateMethodRegistry({ methods: [] })[0]?.code).toBe('method_registry_empty');
    const duplicated = validateMethodRegistry({
      methods: [EXECUTION_ORDER_PREPARATION_METHOD, EXECUTION_ORDER_PREPARATION_METHOD],
    });
    expect(duplicated.some((e) => e.code === 'duplicate_method')).toBe(true);
    const badParams = validateMethodRecord({
      methodId: 'method/execution/order-preparation',
      kind: 'order-preparation',
      version: '1.0.0',
      parameters: { kind: 'order-preparation', input: 'order-lifecycle-logs', authority: 'wrong' },
      declaredBy: 'test/1',
      declaredAt: 1,
    });
    expect(badParams.length).toBeGreaterThan(2); // input mismatch + authority + the remaining fields
    expect(badParams.every((e) => e.code === 'invalid_field')).toBe(true);
  });

  it('createMethodRecord refuses bad drafts and freezes good ones', () => {
    const bad = createMethodRecord({ methodId: '', kind: 'nope', version: 'x' });
    expect(bad.ok).toBe(false);
    const good = createMethodRecord(EXECUTION_ORDER_PREPARATION_METHOD);
    expect(good.ok).toBe(true);
    if (good.ok) expect(isDeeplyFrozen(good.value)).toBe(true);
  });
});

describe('citation resolution (the method-honesty law)', () => {
  it('a valid citation resolves clean', () => {
    expect(
      resolveMethodCitation(EXECUTION_METHOD_REGISTRY, 'method/execution/order-preparation', '1.0.0', 'order-preparation'),
    ).toEqual([]);
  });

  it('an undeclared method is the typed undeclared_method (a magic procedure)', () => {
    const errors = resolveMethodCitation(EXECUTION_METHOD_REGISTRY, 'method/execution/magic', '1.0.0', 'order-preparation');
    expect(errors[0]?.code).toBe('undeclared_method');
    expect(errors[0]?.message).toContain('without a declared, versioned method');
  });

  it('a stale version is method_version_mismatch; a wrong kind is method_kind_mismatch', () => {
    const stale = resolveMethodCitation(EXECUTION_METHOD_REGISTRY, 'method/execution/order-preparation', '2.0.0', 'order-preparation');
    expect(stale.some((e) => e.code === 'method_version_mismatch')).toBe(true);
    const wrongKind = resolveMethodCitation(EXECUTION_METHOD_REGISTRY, 'method/execution/order-preparation', '1.0.0', 'fill-reconciliation');
    expect(wrongKind.some((e) => e.code === 'method_kind_mismatch')).toBe(true);
    const malformed = resolveMethodCitation(EXECUTION_METHOD_REGISTRY, '', '1.0', 'order-preparation');
    expect(malformed.length).toBeGreaterThan(0);
  });

  it('findMethod locates declared methods; null for undeclared', () => {
    expect(findMethod(EXECUTION_METHOD_REGISTRY, 'method/execution/cancellation-policy')?.kind).toBe('cancellation-policy');
    expect(findMethod(EXECUTION_METHOD_REGISTRY, 'method/none')).toBeNull();
  });
});
