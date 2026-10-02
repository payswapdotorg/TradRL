/**
 * @tradrl/outcome-learning — the RETENTION/WINDOW LAWS: the visibility
 * policies the query surface applies over INJECTED instants.
 *
 * THE TWO-SIDED LAW:
 *   - the AGE side: a record older than the window
 *     (`asOf < now - windowMs`) is outside the retention horizon —
 *     still in the append-only log (history is NEVER deleted), just
 *     not returned by the default query surface;
 *   - the L4 side: a record stamped AFTER the query instant
 *     (`asOf > now`) is INVISIBLE — the future is never returned
 *     (point-in-time truth, ARCHITECTURE-LOCK L4: the query surface
 *     obeys information availability time exactly like every other
 *     lane).
 *
 * There is deliberately NO deletion API anywhere in this service: the
 * logs are append-only and chain-verified; retention is a QUERY
 * property, not a storage mutation.
 */

import type { TimestampMs } from './imports';
import type { RetentionPolicy } from './policy';
import { validateRetentionPolicy } from './policy';
import { fail, ok, type OutcomesResult } from './imports';

/** One visibility window: `[from, to]` inclusive on both sides. */
export interface RetentionWindow {
  readonly from: TimestampMs;
  readonly to: TimestampMs;
}

/** Which log's window a query asks about. */
export type RetentionKind = 'outcomes' | 'post_mortems';

/**
 * Derive the visibility window for one log kind at an injected
 * instant: `[now - windowMs, now]` (the age side and the L4 side).
 */
export function retentionWindow(policy: RetentionPolicy, kind: RetentionKind, now: TimestampMs): RetentionWindow {
  const windowMs = kind === 'outcomes' ? policy.outcomeWindowMs : policy.postMortemWindowMs;
  return { from: (now - windowMs) as TimestampMs, to: now };
}

/** `true` iff a record stamped `asOf` is visible within the window (both sides inclusive). */
export function withinRetentionWindow(asOf: TimestampMs, window: RetentionWindow): boolean {
  return (asOf as number) >= (window.from as number) && (asOf as number) <= (window.to as number);
}

/** Validate a retention policy + derive the window in one step (the query surface's gate). */
export function validatedWindow(policy: unknown, kind: RetentionKind, now: TimestampMs): OutcomesResult<RetentionWindow> {
  const validated = validateRetentionPolicy(policy);
  if (!validated.ok) return validated;
  return ok(retentionWindow(validated.value, kind, now));
}
