// @tradrl/sdk — the retry/backoff discipline with rate-limit awareness.
//
// THE LAW (Work Order): "retry/backoff with rate-limit awareness
// (honoring server retry signals through the injected transport)".
//
// - Retries are for the RETRYABLE families ONLY: rate limits (429,
//   honoring `retryAfterMs` when present) and unavailability (503 /
//   a thrown transport). The other families — auth, permission,
//   tenant, validation, conflict, not-found — are TERMINAL: their
//   semantics do not change on retry, so the SDK surfaces them
//   immediately.
// - The DELAY COMPUTATION is pure and host-executed: the policy
//   computes the next delay (exponential, capped), the CALLER sleeps
//   (or scripts it in tests). NO ambient timers — the SDK never calls
//   setTimeout; it returns WHEN to retry and the host decides.
// - A consequential request retries with the SAME idempotency key
//   (the client generates the key ONCE per logical operation), so a
//   retry after a timeout can never double-execute — the boundary
//   dedupes to the original result.

/** The retry policy: exponential backoff, capped; rate-limit signals honored. */
export interface RetryPolicy {
  /** The maximum number of ATTEMPTS (>= 1; 1 = no retries). */
  readonly maxAttempts: number;
  /** The first retry's delay in ms. */
  readonly initialDelayMs: number;
  /** The delay ceiling in ms. */
  readonly maxDelayMs: number;
  /** The backoff multiplier (> 1 for exponential growth). */
  readonly backoffMultiplier: number;
  /**
   * Honor the server's `retryAfterMs` signal over the computed
   * backoff when it is LARGER (default true — the server's signal is
   * the budget's truth).
   */
  readonly respectRetryAfter?: boolean;
}

/** The default policy: 4 attempts, 250ms -> 2s exponential, capped at 30s, signals honored. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 4,
  initialDelayMs: 250,
  maxDelayMs: 30_000,
  backoffMultiplier: 2,
  respectRetryAfter: true,
};

/** Guard: a retry policy. */
export function isRetryPolicy(v: unknown): v is RetryPolicy {
  if (typeof v !== 'object' || v === null) return false;
  const policy = v as Record<string, unknown>;
  if (typeof policy.maxAttempts !== 'number' || !Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) return false;
  if (typeof policy.initialDelayMs !== 'number' || !(policy.initialDelayMs > 0)) return false;
  if (typeof policy.maxDelayMs !== 'number' || !(policy.maxDelayMs >= (policy.initialDelayMs as number))) return false;
  if (typeof policy.backoffMultiplier !== 'number' || !(policy.backoffMultiplier > 0)) return false;
  return true;
}

/**
 * Compute the delay before the NEXT attempt (pure — the host sleeps).
 * Exponential from `initialDelayMs`, capped at `maxDelayMs`; when the
 * error carries the server's retry signal and `respectRetryAfter` is
 * set, the LARGER of the two wins (never shorter than the server's
 * signal).
 */
export function retryDelayMs(policy: RetryPolicy, nextAttempt: number, serverRetryAfterMs?: number): number {
  // nextAttempt is 2-based (the delay before attempt N applies after attempt N-1 failed).
  const exponent = Math.max(0, nextAttempt - 2);
  const computed = Math.min(policy.initialDelayMs * Math.pow(policy.backoffMultiplier, exponent), policy.maxDelayMs);
  if (serverRetryAfterMs !== undefined && policy.respectRetryAfter !== false) {
    return Math.max(computed, serverRetryAfterMs);
  }
  return computed;
}

/** One retry-aware execution step: the operation + the verdict hook. */
export interface RetryStep<T> {
  /** The attempt operation (the transport call). */
  run(): Promise<T>;
}

/**
 * Execute one operation under the retry policy. `sleep` is the
 * host-injected delay function (tests script it; production binds it
 * to setTimeout or an abort-aware timer). The operation's failures
 * decide retries: a thrown error is an unavailability (retryable);
 * the `isRetryable` predicate classifies typed errors.
 */
export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  options: {
    readonly sleep?: (delayMs: number) => Promise<void>;
    readonly isRetryable?: (error: unknown) => boolean;
  } = {},
): Promise<T> {
  const sleep = options.sleep ?? (async () => { /* no-op default: the host that passes no sleeper gets immediate retries */ });
  const isRetryable = options.isRetryable ?? (() => false);
  let lastError: unknown;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= policy.maxAttempts) break;
      if (!isRetryable(error)) throw error;
      const serverSignal = typeof error === 'object' && error !== null && typeof (error as { retryAfterMs?: unknown }).retryAfterMs === 'number'
        ? (error as { retryAfterMs: number }).retryAfterMs
        : undefined;
      await sleep(retryDelayMs(policy, attempt + 1, serverSignal));
    }
  }
  throw lastError;
}
