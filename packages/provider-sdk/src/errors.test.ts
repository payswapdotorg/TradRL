/**
 * @tradrl/provider-sdk — error taxonomy, guards and result shapes.
 *
 * Behavioral: constructors produce frozen records; every guard narrows
 * exactly its family; the taxonomy discriminates on `kind`.
 */

import { describe, expect, it } from 'vitest';

import {
  transportError,
  mappingError,
  entitlementError,
  protocolError,
  timeoutError,
  isAdapterError,
  isTransportError,
  isMappingError,
  isEntitlementError,
  isProtocolError,
  isTimeoutError,
  failure,
  success,
  validationFailure,
  validationSuccess,
  type AdapterError,
} from './index';

describe('error taxonomy', () => {
  it('constructs frozen errors in every family', () => {
    const errors: readonly AdapterError[] = [
      transportError('transport_send_failed', 'send failed'),
      mappingError('unmapped_raw_field', 'field x'),
      entitlementError('entitlement_undeclared', 'no envelope'),
      protocolError('double_close', 'already closed'),
      timeoutError('receive_timeout', 'wait expired'),
    ];
    for (const error of errors) {
      expect(Object.isFrozen(error)).toBe(true);
      expect(isAdapterError(error)).toBe(true);
    }
    expect(errors.map((error) => error.kind)).toEqual([
      'transport',
      'mapping',
      'entitlement',
      'protocol',
      'timeout',
    ]);
  });

  it('mutating a frozen error throws', () => {
    const error = mappingError('unmapped_raw_field', 'field x');
    expect(() => {
      (error as { message?: string }).message = 'rewritten';
    }).toThrow();
  });

  it('family guards narrow exactly their family', () => {
    const transport = transportError('transport_recv_failed', 'recv failed');
    expect(isTransportError(transport)).toBe(true);
    expect(isMappingError(transport)).toBe(false);
    expect(isEntitlementError(transport)).toBe(false);
    expect(isProtocolError(transport)).toBe(false);
    expect(isTimeoutError(transport)).toBe(false);

    const timeout = timeoutError('receive_timeout', 'wait expired');
    expect(isTimeoutError(timeout)).toBe(true);
    expect(isTransportError(timeout)).toBe(false);

    const protocol = protocolError('use_after_close', 'closed');
    expect(isProtocolError(protocol)).toBe(true);
    expect(isTransportError(protocol)).toBe(false);
  });

  it('the structural guard rejects non-errors', () => {
    expect(isAdapterError(null)).toBe(false);
    expect(isAdapterError(undefined)).toBe(false);
    expect(isAdapterError('transport')).toBe(false);
    expect(isAdapterError({ kind: 'transport' })).toBe(false); // missing code/message
    expect(isAdapterError({ kind: 'nope', code: 'x', message: 'y' })).toBe(false);
    expect(isAdapterError({ code: 'x', message: 'y' })).toBe(false);
  });
});

describe('result shapes', () => {
  it('failure/success carry their discriminants', () => {
    const failed = failure(mappingError('unmapped_raw_field', 'x'));
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error.code).toBe('unmapped_raw_field');
      expect(Object.isFrozen(failed.error)).toBe(true);
    }

    const okResult = success(42);
    expect(okResult.ok).toBe(true);
    if (okResult.ok) expect(okResult.value).toBe(42);
  });

  it('validation failure/success collect-all shapes', () => {
    const invalid = validationFailure([
      { code: 'missing_field', path: 'a', message: 'missing a' },
    ]);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.errors).toHaveLength(1);

    const valid = validationSuccess({ x: 1 });
    expect(valid.ok).toBe(true);
    if (valid.ok) expect(valid.value).toEqual({ x: 1 });
  });
});
