/**
 * @tradrl/agent-os — primitives test suite (structural mirror of agent-body's
 * primitives discipline).
 */

import { describe, expect, it } from 'vitest';

import {
  type Mutable,
  agentInstanceId,
  bodyVersionRef,
  deepCloneJson,
  deepFreeze,
  duplicatesOf,
  isAgentInstanceId,
  isArrayOf,
  isBoolean,
  isDeeplyFrozen,
  isEnum,
  isNonEmptyString,
  isNonNegativeInteger,
  isNull,
  isNumber,
  isPositiveInteger,
  isRecord,
  isString,
  kernelOpId,
  messageId,
  tenantId,
  topicName,
} from './primitives';

describe('structural type-check helpers', () => {
  it('isRecord accepts plain objects only', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord('x')).toBe(false);
    expect(isRecord(new Date())).toBe(false);
    expect(isRecord(new (class {})())).toBe(false);
  });

  it('scalar guards behave totally', () => {
    expect(isNumber(1)).toBe(true);
    expect(isNumber(Number.NaN)).toBe(false);
    expect(isNumber(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isNumber('1')).toBe(false);
    expect(isString('')).toBe(true);
    expect(isString(1)).toBe(false);
    expect(isBoolean(true)).toBe(true);
    expect(isBoolean(0)).toBe(false);
    expect(isNull(null)).toBe(true);
    expect(isNull(undefined)).toBe(false);
    expect(isNonEmptyString(' a ')).toBe(true);
    expect(isNonEmptyString('   ')).toBe(false);
    expect(isNonNegativeInteger(0)).toBe(true);
    expect(isNonNegativeInteger(-1)).toBe(false);
    expect(isNonNegativeInteger(1.5)).toBe(false);
    expect(isPositiveInteger(1)).toBe(true);
    expect(isPositiveInteger(0)).toBe(false);
  });

  it('isArrayOf applies its element guard totally', () => {
    expect(isArrayOf(['a', 'b'], isString)).toBe(true);
    expect(isArrayOf(['a', 1], isString)).toBe(false);
    expect(isArrayOf([], isString)).toBe(true);
    expect(isArrayOf('not-an-array', isString)).toBe(false);
  });

  it('isEnum builds closed-union guards', () => {
    const guard = isEnum(['a', 'b'] as const);
    expect(guard('a')).toBe(true);
    expect(guard('c')).toBe(false);
    expect(guard(1)).toBe(false);
  });

  it('duplicatesOf reports duplicated values in order', () => {
    expect(duplicatesOf(['a', 'b', 'a', 'c', 'b', 'a'])).toEqual(['a', 'b']);
    expect(duplicatesOf(['a', 'b'])).toEqual([]);
  });
});

describe('deep immutability discipline', () => {
  it('deepFreeze freezes nested objects and arrays', () => {
    const value = { a: [1, { b: 'c' }], d: { e: null } };
    const frozen = deepFreeze(value);
    expect(frozen).toBe(value);
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.a)).toBe(true);
    expect(Object.isFrozen(value.a[1])).toBe(true);
    expect(Object.isFrozen(value.d)).toBe(true);
    expect(() => {
      (value as Mutable<typeof value>).d = { e: null };
    }).toThrow();
  });

  it('deepFreeze terminates on cycles and shared structure', () => {
    const shared = { x: 1 };
    const cyclic: Record<string, unknown> = { shared };
    cyclic.self = cyclic;
    expect(() => deepFreeze(cyclic)).not.toThrow();
    expect(Object.isFrozen(shared)).toBe(true);
  });

  it('isDeeplyFrozen certifies fully frozen structures', () => {
    expect(isDeeplyFrozen(deepFreeze({ a: [1, { b: 2 }] }))).toBe(true);
    expect(isDeeplyFrozen({ a: [1, { b: 2 }] })).toBe(false);
    expect(isDeeplyFrozen({ a: deepFreeze([1]) })).toBe(false); // outer unfrozen
  });

  it('deepCloneJson produces fresh, unfrozen, equal copies', () => {
    const original = deepFreeze({ a: [1, 2], b: 'c' });
    const clone = deepCloneJson(original);
    expect(clone).toEqual(original);
    expect(clone).not.toBe(original);
    expect(Object.isFrozen(clone)).toBe(false);
    expect(() => {
      (clone as { a: number[] }).a.push(3);
    }).not.toThrow();
  });
});

describe('identifier and opaque-ref factories', () => {
  it('kernel identifiers validate the identifier pattern', () => {
    expect(kernelOpId('op-0001')).toBe('op-0001');
    expect(tenantId('tenant-alpha')).toBe('tenant-alpha');
    expect(topicName('topic.signals')).toBe('topic.signals');
    expect(agentInstanceId('agent-1')).toBe('agent-1');
    expect(() => kernelOpId('bad id')).toThrow(/KernelOpId/);
    expect(() => tenantId('')).toThrow(/TenantId/);
    expect(() => topicName(' leading')).toThrow(/TopicName/);
    expect(() => agentInstanceId('x'.repeat(257))).toThrow(/AgentInstanceId/);
  });

  it('opaque references validate the bounded non-control pattern', () => {
    expect(bodyVersionRef('body/atlas@1.0.0')).toBe('body/atlas@1.0.0');
    expect(messageId('msg:op-1:agent-1:3')).toBe('msg:op-1:agent-1:3');
    expect(() => bodyVersionRef('')).toThrow(/BodyVersionRef/);
    expect(() => bodyVersionRef(' leading')).toThrow(/BodyVersionRef/);
    expect(() => bodyVersionRef(`x${'y'.repeat(2000)}`)).toThrow(/BodyVersionRef/);
    expect(() => bodyVersionRef('no\x00control')).toThrow(/BodyVersionRef/);
    expect(() => messageId('')).toThrow(/MessageId/);
  });

  it('guards accept their own factories\' outputs and reject garbage', () => {
    expect(isAgentInstanceId(agentInstanceId('agent-9'))).toBe(true);
    expect(isAgentInstanceId(42)).toBe(false);
    expect(isRecord({}) && isAgentInstanceId({})).toBe(false);
  });
});
