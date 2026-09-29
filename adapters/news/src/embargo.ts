/**
 * @tradrl/adapter-news — the declared embargo quartet policy.
 *
 * Work Order T038 (scope): "mapping (publication time -> available time
 * policy; embargo semantics as DECLARED quartet policies)". THIS module
 * is the declaration, and the guard transport (../guard-transport.ts) is
 * its enforcement:
 *
 *   - basis `embargo-field`: the embargo lift instant of a licensed wire
 *     item is the documented optional `embargoTimeMs` field (validated
 *     by the schema guard; absent or past-dated means the item is not
 *     embargoed at receipt);
 *   - release_at `embargo-instant`: a record RECEIVED before its lift
 *     instant is HELD by the guard and delivered at its lift instant —
 *     the emitter-facing receive instant of a held record IS the lift
 *     instant, so the availability quartet is HONEST (L4): event_time =
 *     the publication instant, available_time = the lift instant
 *     (clamped to >= event_time by the SDK's quartet law), never before
 *     the embargo. Pre-embargo wire distribution is the licensed wire
 *     workflow — the adapter carries the records, it does not leak them
 *     early;
 *   - undelivered `typed-error`: a scripted timeline that DRAINS while
 *     an embargoed record remains held is a typed protocol error
 *     (`embargo_not_lifted`, ../protocol.ts) — the record never became
 *     available within the observed timeline and the adapter REFUSES to
 *     drop it silently (the anti-silent-drop law applied to time).
 *
 * Determinism: the policy consumes no clock — "the present" is the
 * receive instant of the scripted timeline, and held records are
 * released when a LATER timeline instant reaches their lift instant.
 */

import { invalidField, isRecord, missingField } from './contract/fields';
import type { SdkFieldError } from './contract/errors';
import { isTimestampMs, type TimestampMs } from './contract/timestamp';
import { deepFreeze } from './contract/freeze';

/** The declared embargo quartet policy of the licensed wire channel. */
export interface EmbargoPolicy {
  /** Where the embargo lift instant comes from: the documented embargo field. */
  readonly basis: 'embargo-field';
  /** When a held record becomes deliverable: at its embargo lift instant. */
  readonly release_at: 'embargo-instant';
  /** What a drain with held records is: a typed error (never a silent drop). */
  readonly undelivered: 'typed-error';
}

const BASIS = ['embargo-field'] as const;
const RELEASE_AT = ['embargo-instant'] as const;
const UNDELIVERED = ['typed-error'] as const;

/** Validate an untrusted value as an EmbargoPolicy (collect-all; frozen). */
export function validateEmbargoPolicy(value: unknown): { readonly ok: true; readonly value: EmbargoPolicy } | { readonly ok: false; readonly errors: readonly SdkFieldError[] } {
  const errors: SdkFieldError[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidField('embargo_policy', 'must be an object')] };
  }
  if (value.basis === undefined) errors.push(missingField('basis'));
  else if (typeof value.basis !== 'string' || !(BASIS as readonly string[]).includes(value.basis))
    errors.push(invalidField('basis', `must be ${BASIS.join(' | ')}`));
  if (value.release_at === undefined) errors.push(missingField('release_at'));
  else if (typeof value.release_at !== 'string' || !(RELEASE_AT as readonly string[]).includes(value.release_at))
    errors.push(invalidField('release_at', `must be ${RELEASE_AT.join(' | ')}`));
  if (value.undelivered === undefined) errors.push(missingField('undelivered'));
  else if (typeof value.undelivered !== 'string' || !(UNDELIVERED as readonly string[]).includes(value.undelivered))
    errors.push(invalidField('undelivered', `must be ${UNDELIVERED.join(' | ')}`));
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: deepFreeze(value as unknown as EmbargoPolicy) as unknown as EmbargoPolicy };
}

const declaration = validateEmbargoPolicy({
  basis: 'embargo-field',
  release_at: 'embargo-instant',
  undelivered: 'typed-error',
});

if (!declaration.ok) {
  // Our own declaration — a validation failure is a programming error.
  throw new Error(`NEWS_EMBARGO_POLICY is invalid: ${declaration.errors.map((error) => error.message).join('; ')}`);
}

/** The declared, validated, deep-frozen embargo quartet policy of the licensed wire channel. */
export const NEWS_EMBARGO_POLICY: EmbargoPolicy = declaration.value;

/**
 * The embargo lift instant of a validated wire item, or null when the
 * item carries no embargo declaration. Pure.
 */
export function embargoLiftAt(item: { readonly embargoTimeMs?: TimestampMs }): TimestampMs | null {
  return item.embargoTimeMs === undefined ? null : item.embargoTimeMs;
}

/**
 * True iff a record received at the given instant is still embargoed:
 * the declared lift instant exists and lies strictly after the receive
 * instant (a lift at or before receipt means the embargo has lifted —
 * the record is deliverable immediately, honestly, with availability at
 * the receive instant). Pure; no clock.
 */
export function isEmbargoedAt(item: { readonly embargoTimeMs?: TimestampMs }, receivedAt: TimestampMs): boolean {
  if (!isTimestampMs(receivedAt)) return false;
  const liftAt = embargoLiftAt(item);
  return liftAt !== null && liftAt > receivedAt;
}
