// @tradrl/body-execution — errors tests: the closed taxonomy, the
// collect-all and single-failure disciplines, every constructor.

import { describe, expect, it } from 'vitest';
import {
  EXECUTION_BODY_ERROR_CODES,
  fail,
  failWith,
  invalidField,
  invalidType,
  missingField,
  ok,
  validationOf,
  type ExecutionBodyError,
} from './errors';

describe('the closed error vocabulary', () => {
  it('every code this package emits is in the closed union (no ad-hoc codes exist)', () => {
    const expected = [
      'invalid_type', 'missing_field', 'invalid_field', 'unknown_order_state', 'unknown_lifecycle_event', 'decimal_invalid',
      'clock_confusion', 'strategic_level_control',
      'lifecycle_violation', 'lifecycle_sequence', 'lifecycle_chain', 'timestamp_order',
      'execution_authority_granted', 'execute_prohibited', 'consequential_tool_in_procedure', 'forbidden_tool_in_procedure',
      'non_execution_capability', 'decision_not_approved', 'killswitch_thrown', 'reserved_publication_topic',
      'lineage_missing', 'digest_mismatch', 'fill_ref_mismatch', 'quantity_mismatch',
      'decimal_imprecision', 'reconciliation_gap',
      'escalation_missing', 'fill_fabricated', 'cancel_fabricated',
      'tenant_missing', 'project_missing', 'tenant_mismatch', 'project_mismatch',
      'model_identity_as_evidence',
      'undeclared_method', 'method_version_mismatch', 'method_kind_mismatch', 'duplicate_method', 'method_registry_empty',
      'unstructured_publication',
    ];
    expect([...EXECUTION_BODY_ERROR_CODES].sort()).toEqual([...expected].sort());
    expect(new Set(EXECUTION_BODY_ERROR_CODES).size).toBe(EXECUTION_BODY_ERROR_CODES.length);
  });

  it('THE NAMED CRIMES exist verbatim (the Work Order\'s typed errors)', () => {
    expect(EXECUTION_BODY_ERROR_CODES).toContain('clock_confusion'); // L16
    expect(EXECUTION_BODY_ERROR_CODES).toContain('lifecycle_violation'); // undefined transitions
    expect(EXECUTION_BODY_ERROR_CODES).toContain('decimal_imprecision'); // float mediation
    expect(EXECUTION_BODY_ERROR_CODES).toContain('reconciliation_gap'); // one grid step off
    expect(EXECUTION_BODY_ERROR_CODES).toContain('fill_fabricated'); // never fabricate
    expect(EXECUTION_BODY_ERROR_CODES).toContain('cancel_fabricated'); // never fabricate
    expect(EXECUTION_BODY_ERROR_CODES).toContain('escalation_missing'); // never a silent timeout
    expect(EXECUTION_BODY_ERROR_CODES).toContain('execution_authority_granted'); // L8
  });
});

describe('the single-failure discipline', () => {
  it('ok carries the value', () => {
    const result = ok(42);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(42);
  });

  it('fail builds one typed error; failWith copies a prepared list', () => {
    const result = fail('clock_confusion', 'the strategic instant was stamped into the order clock', 'orderClock');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.code).toBe('clock_confusion');
      expect(result.errors[0]?.path).toBe('orderClock');
    }
    const errors: ExecutionBodyError[] = [missingField('a'), invalidField('b', 'bad')];
    const withList = failWith(errors);
    expect(withList.ok).toBe(false);
    if (!withList.ok) expect(withList.errors).toHaveLength(2);
  });
});

describe('the constructors', () => {
  it('missingField / invalidField / invalidType carry code + path + message', () => {
    expect(missingField('orderClock')).toEqual({
      code: 'missing_field',
      path: 'orderClock',
      message: 'required field "orderClock" is missing',
    });
    expect(invalidField('orderClock', 'must be an instant').code).toBe('invalid_field');
    expect(invalidType('record', 'an order lifecycle record').code).toBe('invalid_type');
    expect(invalidType('record', 'an order lifecycle record').message).toContain('must be');
  });
});

describe('the collect-all discipline', () => {
  it('validationOf is ok only when the error list is empty', () => {
    const good = validationOf(7, []);
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.value).toBe(7);
    const bad = validationOf(null, [missingField('x'), invalidField('y', 'bad')]);
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.value).toBeNull();
      expect(bad.errors).toHaveLength(2);
    }
  });
});
