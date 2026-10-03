// @tradrl/api-service — the rate-limit stage.
//
// THE LAW (SECURITY.md Execution: "Require identity, authority, hard
// risk checks, venue permissions, limits, kill switch, RATE LIMITS,
// audit and credential isolation"): every credential carries a
// request-budget policy; the pipeline counts requests per
// (credentialId, route family) in FIXED windows anchored at the first
// request's injected instant — no ambient clock, deterministic
// accounting. Over-budget is the typed 429 `rate_limited` carrying
// the server's retry signal (`retryAfterMs` — the SDK's backoff
// honors it through the injected transport).
//
// This is the BOUNDARY's request budget (the API's own protection),
// distinct from the T040 gateway's per-venue order budgets — one more
// chokepoint, one more budget, by design.
//
// Spec anchors: SECURITY.md (Execution), R43, L20.

import { apiError, type ApiError } from './errors';
import { isNonNegativeSafeInteger, isPositiveSafeInteger } from './primitives';
import type { TimestampMs } from './primitives';
import { isTimestampMs } from './primitives';

// ---------------------------------------------------------------------------
// The policy
// ---------------------------------------------------------------------------

/** One credential's request budget: `maxRequests` per `windowMs` per route family. */
export interface RateLimitPolicy {
  readonly windowMs: number;
  readonly maxRequests: number;
}

/** Guard: a rate-limit policy. */
export function isRateLimitPolicy(v: unknown): v is RateLimitPolicy {
  return (
    typeof v === 'object' &&
    v !== null &&
    isPositiveSafeInteger((v as RateLimitPolicy).windowMs) &&
    isPositiveSafeInteger((v as RateLimitPolicy).maxRequests)
  );
}

/** The default budget when a credential carries none explicit (fail-closed: a small, safe default). */
export const DEFAULT_RATE_LIMIT_POLICY: RateLimitPolicy = { windowMs: 60_000, maxRequests: 600 };

// ---------------------------------------------------------------------------
// The window accounting (fixed windows; injected instants)
// ---------------------------------------------------------------------------

/** One window's mutable accounting (internal state; the snapshot is exposed). */
interface RateWindow {
  anchor: TimestampMs;
  count: number;
}

/** The rate limiter: per-(credential, family) fixed windows. Deterministic given the injected instant sequence. */
export class RateLimiter {
  private readonly policy: RateLimitPolicy;
  private readonly windows = new Map<string, RateWindow>();

  constructor(policy: RateLimitPolicy = DEFAULT_RATE_LIMIT_POLICY) {
    if (!isRateLimitPolicy(policy)) {
      throw new Error('RateLimiter: invalid policy (windowMs and maxRequests must be positive integers)');
    }
    this.policy = policy;
  }

  /** The policy in force. */
  get limits(): RateLimitPolicy {
    return this.policy;
  }

  /**
   * Consume one request slot for (credentialId, family) at the
   * injected instant. Returns `ok` (the window state) or the typed
   * 429 carrying the deterministic retry signal: the ms remaining
   * until the window rolls (windowMs - elapsed, clamped to >= 1).
   */
  consume(credentialId: string, family: string, at: TimestampMs): { readonly ok: true; readonly remaining: number } | { readonly ok: false; readonly error: ApiError } {
    if (!isTimestampMs(at)) {
      return { ok: false, error: apiError('validation_failed', 'the rate window requires an injected epoch-ms instant') };
    }
    const key = `${credentialId}::${family}`;
    let window = this.windows.get(key);
    if (window === undefined || (at as number) >= (window.anchor as number) + this.policy.windowMs) {
      window = { anchor: at, count: 0 };
      this.windows.set(key, window);
    }
    if (window.count >= this.policy.maxRequests) {
      const elapsed = (at as number) - (window.anchor as number);
      const retryAfterMs = Math.max(1, this.policy.windowMs - elapsed);
      return {
        ok: false,
        error: apiError(
          'rate_limited',
          `the credential is over its ${this.policy.maxRequests}-request budget for "${family}" in the current ${this.policy.windowMs}ms window — retry after the signal (the SDK's backoff honors it)`,
          { retryAfterMs },
        ),
      };
    }
    window.count += 1;
    return { ok: true, remaining: this.policy.maxRequests - window.count };
  }

  /** The deterministic snapshot (test/audit surface). */
  snapshot(): readonly { readonly key: string; readonly anchor: number; readonly count: number }[] {
    return Object.freeze(
      [...this.windows.entries()]
        .map(([key, window]) => ({ key, anchor: window.anchor as number, count: window.count }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
    );
  }
}

/** `true` when the count state is coherent (every window's count <= maxRequests). */
export function rateStateCoherent(snapshot: readonly { readonly count: number }[], maxRequests: number): boolean {
  return snapshot.every((entry) => isNonNegativeSafeInteger(entry.count) && entry.count <= maxRequests);
}
