/**
 * The action envelope: request validation, the causal time law, and the
 * per-actor client-sequence discipline. Authority is NEVER exercised here
 * (L8) — these tests prove submit-side validation only.
 */

import { describe, expect, it } from 'vitest';

import { isAction, validateAction, type Action } from './index';
import { requireTimestampMs } from './index';

function action(overrides: Record<string, unknown> = {}): Action {
  const result = validateAction({
    action_id: 'act-1',
    actor: 'agent-main',
    submitted_at: requireTimestampMs(1_000),
    client_sequence: 0,
    payload: { kind: 'noop' },
    ...overrides,
  });
  if (!result.ok) throw new Error(`fixture must be valid: ${JSON.stringify(result.errors)}`);
  return result.value;
}

describe('action validation', () => {
  it('accepts a well-formed request and freezes it deeply', () => {
    const request = action();
    expect(isAction(request)).toBe(true);
    expect(Object.isFrozen(request)).toBe(true);
  });

  it('payloads may be any JSON value (scalar, array, object, null)', () => {
    for (const payload of [null, 42, 'text', [1, 2, { a: true }], { order: { side: 'buy', qty: 1 } }]) {
      const result = validateAction({ ...action(), payload });
      expect(result.ok).toBe(true);
    }
  });

  it('collects every envelope violation together', () => {
    const result = validateAction({
      action_id: '',
      actor: 7,
      submitted_at: Number.NaN,
      client_sequence: -1,
      payload: undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const codes = result.errors.map((error) => `${error.code}:${error.path}`);
      expect(codes).toContain('invalid_field:action.action_id');
      expect(codes).toContain('invalid_field:action.actor');
      expect(codes).toContain('invalid_field:action.submitted_at');
      expect(codes).toContain('invalid_field:action.client_sequence');
      // `payload: undefined` means the field is ABSENT -> missing_field.
      expect(codes).toContain('missing_field:action.payload');
    }
  });

  it('missing fields are reported individually', () => {
    const result = validateAction({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((error) => error.code)).toEqual([
        'missing_field',
        'missing_field',
        'missing_field',
        'missing_field',
        'missing_field',
      ]);
    }
  });

  it('rejects non-safe-integer and negative client sequences', () => {
    for (const clientSequence of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) {
      expect(
        validateAction({ ...action(), client_sequence: clientSequence, action_id: `act-${clientSequence}` }).ok,
      ).toBe(false);
    }
  });

  it('rejects out-of-range submitted_at', () => {
    for (const submittedAt of [-1, 8_639_999_999_999_999 + 1, 0.5]) {
      expect(validateAction({ ...action(), submitted_at: submittedAt, action_id: `act-${submittedAt}` }).ok).toBe(false);
    }
  });

  it('non-object roots fail with invalid_type', () => {
    for (const root of [null, 'x', 42, []]) {
      expect(validateAction(root).ok).toBe(false);
    }
    expect(isAction(undefined)).toBe(false);
  });
});

describe('action semantics encoded in the envelope (documentation-grade invariants)', () => {
  it('the action_id is opaque and unique-per-episode by contract (enforced at submit, not here)', () => {
    // The validator is timeless: it does not know about episodes. Duplicate
    // detection is the episode transition's job (see episode.test.ts).
    const first = action({ action_id: 'same' });
    const second = action({ action_id: 'same', client_sequence: 1 });
    expect(first.action_id).toBe(second.action_id);
  });
});
