// deploy/vercel/runtime/auth-throttle.ts — THE AUTH-ROUTE BRUTE-FORCE
// GUARD (FW-40-D — the identity design's KNOWN GAP, closed).
//
// WHAT THIS IS: a bounded IN-MEMORY rate limiter in front of the
// CREDENTIAL-BEARING auth routes (POST /v1/auth/register + POST
// /v1/auth/login — the two token-minting routes). The identity design's
// own known-gap note (runtime/auth-routes.ts, FW-39-1) named it: the
// host-owned auth routes run OUTSIDE the T041 pipeline's rate limiter,
// so "a login endpoint with no host-side brute-force throttling is the
// known gap (the scrypt KDF is the cost lever; host-side throttling is
// a later wave's additive option)". THIS WAVE IS THAT OPTION. The
// register/login routes are PUBLIC once the deployment configures
// TRADRL_AUTH_TOKEN_KEY (the Lead's post-merge deployment step), so the
// host bounds the brute-force surface itself.
//
// THE LAW (two buckets, both fixed windows anchored at the first
// request's instant — the boundary's own RateLimitStage pattern,
// services/api/src/ratelimit.ts, never re-implemented there):
//
//   1. PER-CREDENTIAL-IDENTITY failures: <= maxIdentityFailures (default
//      5) FAILED credential attempts on one principal identity per
//      windowMs (default 15 min). A "failed credential attempt" is the
//      credential law's own failure classes — login's typed 401
//      (unknown name + wrong passphrase, indistinguishable at the
//      route) and register's typed 409 (the duplicate-name probe). A
//      request over the budget is refused BEFORE the route runs, with
//      the TYPED 429 (the closed ApiError vocabulary's `rate_limited`,
//      retryAfterMs set — the SDK's backoff honors it).
//   2. PER-SOURCE attempts: <= maxSourceAttempts (default 30) auth
//      attempts (register + login, success or failure) per client
//      source per windowMs. The source is the client identity the HOST
//      observes (the platform-forwarded address: `x-forwarded-for`'s
//      first value, `x-real-ip` as fallback; on Vercel the platform
//      overwrites these with the connecting address). This is the bound
//      on identity-PROBING (a fresh name per attempt never trips bucket
//      1 — bucket 2 catches the rotation).
//
// THE HONEST UNLOCK (the work order's law): a SUCCESSFUL LOGIN resets
// that identity's failure bucket — legitimate users are not locked out
// by their own success. A successful REGISTER does not clear (a name
// that just registered cannot carry register-conflict failures — it was
// free; login-probe failures under that name are cleared by the owner's
// first successful login; the window bounds the worst case).
//
// WHAT THE GUARD DOES NOT TOUCH: logout, whoami, and adopt stay
// EXACTLY as shipped (no throttle, no counting, no new parameter — the
// FW-37-B module-level lesson; the adopt law stays frozen). They carry
// a TOKEN, not a credential: the token has 128 bits of minted entropy
// plus expiry + durable revocation, and every failure class already
// answers the uniform typed 401 — there is no cheap brute-force surface
// to bound. Validation failures (the typed 400) charge NEITHER bucket
// (the body never reached a credential check; there is no honest
// identity to charge when the name itself is malformed), and a degraded
// store read (the typed 503) charges NEITHER bucket (R46: a backend
// outage never locks a user out).
//
// DOCUMENTED LIMITATIONS (honest — this is a THROTTLE, not a security
// boundary; the scrypt KDF remains the cost floor beneath it):
//   - IN-MEMORY, PER INSTANCE ONLY: a cold start (or the composition's
//     re-build) clears every bucket — acceptable for a throttle (the
//     KDF cost floor survives the reset), and each serverless instance
//     carries its own bucket set (a determined caller spraying across N
//     warm instances gets N x budget — the KDF floor again).
//   - The source identity is the platform-forwarded address. On Vercel
//     the platform sets it (trustworthy); on a host that passes
//     client-set values through, the header is SPOOFABLE — a caller can
//     rotate source buckets. The throttle is a cost lever; the KDF is
//     the floor.
//   - When the host observes NO client address (the local/test shape),
//     every request shares one 'no-client-address' bucket per tenant —
//     the conservative fallback, never a widening.
//   - Buckets are bounded: expired entries sweep lazily, and a map over
//     its cap evicts the oldest-anchored entries (a throttle may reset
//     under memory pressure — the KDF floor survives).
//
// Zero-dep law: platform APIs only (no imports beyond the env reader's
// type). Spec anchors: R46 (the typed rate_limited disclosure, never a
// silent refusal), R43 (the SDK's retryAfterMs backoff), L12 (every
// bucket is tenant-scoped — the tenant comes from the authn, never a
// request value), the IDENTITY-MODEL design §5 Wave 1 (the known-gap
// note this module closes).

import type { ApiDeploymentEnv } from './env';

// ---------------------------------------------------------------------------
// The policy (env-configurable bounds; sane defaults)
// ---------------------------------------------------------------------------

/** The guard's bounds. Defaults: 5 identity failures / 30 source attempts per 15-minute window. */
export interface AuthThrottlePolicy {
  /** The fixed window's length (ms). */
  readonly windowMs: number;
  /** Max FAILED credential attempts per principal identity per window. */
  readonly identityFailures: number;
  /** Max auth attempts (register + login, any outcome) per client source per window. */
  readonly sourceAttempts: number;
}

/** The defaults (the work order's bounds): 5 / 30 per 15 minutes. */
export const AUTH_THROTTLE_DEFAULTS: Readonly<AuthThrottlePolicy> = Object.freeze({
  windowMs: 15 * 60 * 1000,
  identityFailures: 5,
  sourceAttempts: 30,
});

/** The decimal, strictly-positive integer shape every bound must parse as (no signs, no whitespace). */
const POSITIVE_INTEGER = /^[1-9][0-9]*$/;

/**
 * Read the policy off the deployment env. Each key is INDEPENDENT:
 * absent = that bound's default; present-but-malformed = the typed
 * fail-closed problem NAMING THE KEY and the legal shape (never the
 * value — the deployBacking precedent; the composition seam refuses to
 * boot on it, so a typo can never silently widen the guard).
 */
export function authThrottlePolicyOf(env: ApiDeploymentEnv): { readonly ok: true; readonly policy: AuthThrottlePolicy } | { readonly ok: false; readonly problems: readonly string[] } {
  const problems: string[] = [];
  const windowMs = env.authThrottleWindowMs;
  const identityFailures = env.authThrottleIdentityFailures;
  const sourceAttempts = env.authThrottleSourceAttempts;
  if (windowMs !== null && !POSITIVE_INTEGER.test(windowMs)) {
    problems.push('TRADRL_AUTH_THROTTLE_WINDOW_MS (must be a positive integer of milliseconds; got an unrecognized value)');
  }
  if (identityFailures !== null && !POSITIVE_INTEGER.test(identityFailures)) {
    problems.push('TRADRL_AUTH_THROTTLE_IDENTITY_FAILURES (must be a positive integer of failed attempts; got an unrecognized value)');
  }
  if (sourceAttempts !== null && !POSITIVE_INTEGER.test(sourceAttempts)) {
    problems.push('TRADRL_AUTH_THROTTLE_SOURCE_ATTEMPTS (must be a positive integer of attempts; got an unrecognized value)');
  }
  if (problems.length > 0) return { ok: false, problems: Object.freeze(problems) };
  return {
    ok: true,
    policy: Object.freeze({
      windowMs: windowMs === null ? AUTH_THROTTLE_DEFAULTS.windowMs : Number(windowMs),
      identityFailures: identityFailures === null ? AUTH_THROTTLE_DEFAULTS.identityFailures : Number(identityFailures),
      sourceAttempts: sourceAttempts === null ? AUTH_THROTTLE_DEFAULTS.sourceAttempts : Number(sourceAttempts),
    }),
  };
}

// ---------------------------------------------------------------------------
// The client source (the identity the HOST observes on the wire)
// ---------------------------------------------------------------------------

/** The bucket label when the host observes no client address (the local/test shape — never a widening). */
export const NO_CLIENT_ADDRESS = 'no-client-address';

/** Read one header value structurally (string or first-of-array; absent -> null). */
function headerValueOf(headers: unknown, name: string): string | null {
  if (headers === null || typeof headers !== 'object') return null;
  const presented = (headers as { readonly [key: string]: unknown })[name];
  if (typeof presented === 'string' && presented.length > 0) return presented;
  if (Array.isArray(presented) && presented.length > 0 && typeof presented[0] === 'string' && (presented[0] as string).length > 0) return presented[0] as string;
  return null;
}

/**
 * The request's client source, as the host observes it: the FIRST value
 * of the platform-forwarded `x-forwarded-for` chain (the connecting
 * client), `x-real-ip` as the fallback, and the shared
 * no-client-address bucket when the host observes neither (the
 * conservative fallback — such requests still share one budget, never a
 * widening).
 */
export function clientSourceOf(headers: unknown): string {
  const forwarded = headerValueOf(headers, 'x-forwarded-for');
  if (forwarded !== null) {
    const client = forwarded.split(',')[0]?.trim() ?? '';
    if (client.length > 0) return client;
  }
  const real = headerValueOf(headers, 'x-real-ip');
  if (real !== null) {
    const client = real.split(',')[0]?.trim() ?? '';
    if (client.length > 0) return client;
  }
  return NO_CLIENT_ADDRESS;
}

// ---------------------------------------------------------------------------
// The bounded fixed-window accounting
// ---------------------------------------------------------------------------

/** One window's mutable accounting (the boundary's own RateWindow shape). */
interface ThrottleWindow {
  anchor: number;
  count: number;
}

/** The per-map bucket cap (bounded memory: lazy sweep of expired entries, then oldest-anchor eviction). */
const MAX_BUCKETS = 4096;

/**
 * One bounded family of fixed windows (all keys share the policy's
 * window length and the family's own max). Pure over the injected clock
 * (`now`) — the composition hands the SAME instant source the auth
 * routes use, so tests advance the clock and the windows roll.
 */
class BoundedWindows {
  private readonly windows = new Map<string, ThrottleWindow>();

  constructor(
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}

  /** The live count at key (0 once the window has rolled — a rolled window is read as empty, never re-anchored by a read). */
  countOf(key: string): number {
    const window = this.windows.get(key);
    if (window === undefined) return 0;
    if (this.now() >= window.anchor + this.windowMs) return 0;
    return window.count;
  }

  /** The retry signal for a full window: the ms remaining until it rolls (clamped to >= 1, the boundary's own law). */
  retryAfterMsOf(key: string): number {
    const window = this.windows.get(key);
    if (window === undefined) return 1;
    return Math.max(1, this.windowMs - (this.now() - window.anchor));
  }

  /** Increment the count at key, anchoring a fresh window when the old one rolled. Bounded: sweep, then evict oldest. */
  increment(key: string): void {
    const at = this.now();
    let window = this.windows.get(key);
    if (window === undefined || at >= window.anchor + this.windowMs) {
      window = { anchor: at, count: 0 };
      this.windows.set(key, window);
    }
    window.count += 1;
    this.bound();
  }

  /** Clear the window at key (the honest unlock). */
  clear(key: string): void {
    this.windows.delete(key);
  }

  /** Keep the map bounded: sweep expired entries first, then evict the oldest-anchored (a throttle may reset under pressure — documented). */
  private bound(): void {
    if (this.windows.size <= MAX_BUCKETS) return;
    const at = this.now();
    for (const [key, window] of this.windows) {
      if (at >= window.anchor + this.windowMs) this.windows.delete(key);
    }
    while (this.windows.size > MAX_BUCKETS) {
      let oldestKey: string | null = null;
      let oldestAnchor = Number.POSITIVE_INFINITY;
      for (const [key, window] of this.windows) {
        if (window.anchor < oldestAnchor) {
          oldestAnchor = window.anchor;
          oldestKey = key;
        }
      }
      if (oldestKey === null) break;
      this.windows.delete(oldestKey);
    }
  }
}

// ---------------------------------------------------------------------------
// The guard (the auth routes' input carries one per composition)
// ---------------------------------------------------------------------------

/** The scope one guard consult/mutation addresses: the authn's tenant (L12 — never a request value) + the observed source + the request's credential identity (null when the body carries no well-formed name). */
export interface AuthThrottleScope {
  readonly tenant: string;
  readonly source: string;
  readonly identity: string | null;
}

/** The guard's verdict: allowed, or the typed refusal naming which budget is exhausted (the route serves the typed 429 from it). */
export type AuthThrottleVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly kind: 'source' | 'identity'; readonly limit: number; readonly windowMs: number; readonly retryAfterMs: number };

/** The auth-route brute-force guard (the composition builds one per instance — in-memory only, a cold start clears it). */
export interface AuthThrottle {
  /** Consult BOTH budgets for one credential-bearing attempt, BEFORE the route runs. A refused attempt charges nothing (the boundary's own law: a refused request consumes no budget). */
  guard(scope: AuthThrottleScope): AuthThrottleVerdict;
  /** Count one ACCEPTED credential attempt on the source bucket (the guard said ok; the route runs next). */
  countAttempt(scope: AuthThrottleScope): void;
  /** Charge one FAILED credential check (login's 401 / register's 409) to the identity bucket. */
  chargeFailure(scope: AuthThrottleScope): void;
  /** A SUCCESSFUL LOGIN clears the identity's failure bucket — the honest unlock (the work order's law). */
  clearFailures(scope: AuthThrottleScope): void;
}

/** Build one guard over a policy and the injected clock (per composition — the in-memory state is the instance's own). */
export function buildAuthThrottle(policy: AuthThrottlePolicy, now: () => number): AuthThrottle {
  const sources = new BoundedWindows(policy.windowMs, now);
  const identities = new BoundedWindows(policy.windowMs, now);
  const sourceKey = (scope: AuthThrottleScope): string => `${scope.tenant}|src|${scope.source}`;
  const identityKey = (scope: AuthThrottleScope): string => `${scope.tenant}|id|${scope.identity as string}`;
  return {
    guard(scope: AuthThrottleScope): AuthThrottleVerdict {
      const source = sourceKey(scope);
      if (sources.countOf(source) >= policy.sourceAttempts) {
        return { ok: false, kind: 'source', limit: policy.sourceAttempts, windowMs: policy.windowMs, retryAfterMs: sources.retryAfterMsOf(source) };
      }
      if (scope.identity !== null) {
        const identity = identityKey(scope);
        if (identities.countOf(identity) >= policy.identityFailures) {
          return { ok: false, kind: 'identity', limit: policy.identityFailures, windowMs: policy.windowMs, retryAfterMs: identities.retryAfterMsOf(identity) };
        }
      }
      return { ok: true };
    },
    countAttempt(scope: AuthThrottleScope): void {
      sources.increment(sourceKey(scope));
    },
    chargeFailure(scope: AuthThrottleScope): void {
      if (scope.identity === null) return; // a malformed body has no honest identity to charge
      identities.increment(identityKey(scope));
    },
    clearFailures(scope: AuthThrottleScope): void {
      if (scope.identity === null) return;
      identities.clear(identityKey(scope));
    },
  };
}
