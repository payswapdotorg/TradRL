// deploy/adapters/upstash/stores.ts — the Redis cache + the
// idempotency-key store over the Upstash REST client (T052, W-3b).
//
// THE IDEMPOTENCY SEMANTICS (structural mirror of T041's
// IdempotencyStore, widened for the shared-infrastructure deployment):
//   - the dedupe identity is (credentialId, routePattern, key) — the
//     SAME composite T041 uses;
//   - `begin` -> fresh | replay (the ORIGINAL response replays
//     verbatim) | conflict (the same key with a DIFFERENT body — the
//     first completion stands);
//   - `complete` commits the entry with `SET ... EX <ttl> NX` — the
//     atomic set-if-absent that makes the check-and-commit race-free;
//     committing an already-committed key with the same body is a
//     no-op, with a different body the typed conflict;
//   - the body fingerprint is fnv1a32(canonicalJson(body)) — the SAME
//     canonical form as T041 (the contract test pins byte-equality
//     with the REAL canonicalJson/fnv1a32Hex, test-only import).
//
// THE L12 LAW IN SHARED INFRASTRUCTURE: every Redis key is prefixed
// with the EXPLICIT server-side tenant — `tradrl:idem:{tenant}:{sha256}`
// and `tradrl:cache:{tenant}:{name}`. The tenant is a MANDATORY
// parameter supplied by the host (from the credential registry —
// W-3d's wire), NEVER from a request body; two tenants using the same
// credential/route/key composite occupy DIFFERENT keys (no
// cross-tenant replay — probed in tests); cache names are validated
// against a fixed charset (no keyspace smuggling).
//
// R46: every provider failure is the typed StoreFailure — never a
// throw. TTL: idempotency entries expire after the idempotency window
// (default 86400 s = 24 h — an expired key is FRESH again, by design).
//
// Spec anchors: R43 (idempotency), L9 (determinism), L12, R46, D-033.

import { createHash } from 'node:crypto';
import { executeUpstashCommand, type UpstashConfig } from './client';
import {
  canonicalJson,
  fnv1a32Hex,
  isNonEmptyString,
  type AdapterProvenance,
  type FetchLike,
  type InstantSourceMirror,
  type JsonValue,
  type StoreResult,
} from '../shared';

// ---------------------------------------------------------------------------
// The shared core
// ---------------------------------------------------------------------------

/** The dependencies every Upstash store consumes (all injected, never ambient). */
export interface UpstashStoreDeps {
  readonly config: UpstashConfig;
  readonly fetchLike?: FetchLike;
  /** The injected instant source (completion instants; no ambient clock). */
  readonly instants: InstantSourceMirror;
}

function defaultFetch(): FetchLike {
  const fetchGlobal = (globalThis as { fetch?: unknown }).fetch;
  if (typeof fetchGlobal !== 'function') {
    return async () => {
      throw new Error('no fetch implementation is available in this runtime');
    };
  }
  return fetchGlobal as FetchLike;
}

/** The idempotency window: how long a committed completion dedupes (default 24 h). */
export const DEFAULT_IDEMPOTENCY_TTL_SECONDS = 86_400;

/** The canonical body fingerprint: fnv1a32(canonicalJson(body)) — `fnv('null')` for a non-JSON body (T041's form). */
export function bodyFingerprintOf(body: unknown): string {
  // A non-JSON body (undefined, functions, symbols) fingerprints as the canonical null — T041's isJsonValue guard.
  if (body === undefined || typeof body === 'function' || typeof body === 'symbol') return fnv1a32Hex('null');
  return fnv1a32Hex(canonicalJson(body as JsonValue));
}

/** The composite identity of one consequential call (T041's composite, canonicalized). */
export function idempotencyComposite(credentialId: string, routePattern: string, key: string): string {
  return canonicalJson([credentialId, routePattern, key] as JsonValue);
}

/** The Redis key of one composite under one tenant (sha256 of the composite — collision-free). */
export function idempotencyKeyOf(tenant: string, credentialId: string, routePattern: string, key: string): string {
  return `tradrl:idem:${tenant}:${createHash('sha256').update(idempotencyComposite(credentialId, routePattern, key)).digest('hex')}`;
}

// ---------------------------------------------------------------------------
// The idempotency entry + verdict (mirrors of T041's shapes)
// ---------------------------------------------------------------------------

/** One stored idempotent completion (mirror of T041's IdempotencyEntry). */
export interface IdempotencyEntryMirror {
  readonly credentialId: string;
  readonly routePattern: string;
  readonly key: string;
  readonly bodyFingerprint: string;
  readonly responseStatus: number;
  readonly responseBody: unknown;
  readonly at: number;
}

/** The verdict of a consequential request's idempotency check (mirror of T041's IdempotencyVerdict). */
export type IdempotencyVerdictMirror =
  | { readonly kind: 'fresh' }
  | { readonly kind: 'replay'; readonly entry: IdempotencyEntryMirror }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'degraded'; readonly error: { readonly code: string; readonly message: string } };

// ---------------------------------------------------------------------------
// The idempotency store
// ---------------------------------------------------------------------------

/** The durable, TTL-scoped idempotency store. */
export class UpstashIdempotencyStore {
  private readonly deps: UpstashStoreDeps;
  private readonly fetchLike: FetchLike;
  private provenance: AdapterProvenance | null = null;

  constructor(deps: UpstashStoreDeps) {
    this.deps = deps;
    this.fetchLike = deps.fetchLike ?? defaultFetch();
  }

  /** The last operation's provenance record (observable, never secret). */
  lastProvenance(): AdapterProvenance | null {
    return this.provenance;
  }

  /**
   * The pre-handler check (T041's begin, widened): fresh | replay |
   * conflict — or `degraded` when the provider is unreachable (R46:
   * the CALLER decides whether a degraded idempotency check refuses
   * the consequential call — fail-closed is the default posture).
   */
  async begin(tenant: string, credentialId: string, routePattern: string, key: string, body: unknown): Promise<IdempotencyVerdictMirror> {
    if (!isNonEmptyString(tenant) || !isNonEmptyString(credentialId) || !isNonEmptyString(routePattern) || !isNonEmptyString(key)) {
      return { kind: 'conflict' };
    }
    const redisKey = idempotencyKeyOf(tenant, credentialId, routePattern, key);
    const fetched = await executeUpstashCommand(this.deps.config, 'get', [redisKey], this.fetchLike);
    this.note('begin', tenant, fetched.ok);
    if (!fetched.ok) return { kind: 'degraded', error: { code: fetched.error.code, message: fetched.error.message } };
    if (fetched.value === null || fetched.value === undefined) return { kind: 'fresh' };
    const entry = parseEntry(fetched.value);
    if (entry === null) return { kind: 'degraded', error: { code: 'upstash_malformed_response', message: 'the stored idempotency entry is malformed' } };
    if (entry.bodyFingerprint !== bodyFingerprintOf(body)) {
      return { kind: 'conflict' };
    }
    return { kind: 'replay', entry };
  }

  /**
   * The post-handler commit (T041's complete): `SET key value EX ttl NX`
   * — atomic set-if-absent. An existing entry with the same fingerprint
   * is a no-op; with a different fingerprint the typed conflict; a
   * provider failure is the typed degraded result (R46).
   */
  async complete(
    tenant: string,
    credentialId: string,
    routePattern: string,
    key: string,
    body: unknown,
    responseStatus: number,
    responseBody: unknown,
    options?: { readonly ttlSeconds?: number },
  ): Promise<StoreResult<{ readonly committed: boolean }>> {
    if (!isNonEmptyString(tenant) || !isNonEmptyString(credentialId) || !isNonEmptyString(routePattern) || !isNonEmptyString(key)) {
      return { ok: false, error: { code: 'invalid_idempotency_scope', message: 'the idempotency commit lacks tenant/credentialId/routePattern/key' } };
    }
    const redisKey = idempotencyKeyOf(tenant, credentialId, routePattern, key);
    const entry: IdempotencyEntryMirror = {
      credentialId,
      routePattern,
      key,
      bodyFingerprint: bodyFingerprintOf(body),
      responseStatus,
      responseBody,
      at: this.deps.instants.next(),
    };
    const value = canonicalJson(entry as unknown as JsonValue);
    const ttl = String(options?.ttlSeconds ?? DEFAULT_IDEMPOTENCY_TTL_SECONDS);
    const set = await executeUpstashCommand(this.deps.config, 'set', [redisKey, value, 'EX', ttl, 'NX'], this.fetchLike);
    this.note('complete', tenant, set.ok);
    if (!set.ok) return { ok: false, error: { code: set.error.code, message: set.error.message } };
    if (set.value === 'OK') return { ok: true, value: { committed: true } };
    // NX missed: the key exists — same body is a no-op, different body the conflict.
    const fetched = await executeUpstashCommand(this.deps.config, 'get', [redisKey], this.fetchLike);
    this.note('complete-verdict', tenant, fetched.ok);
    if (!fetched.ok) return { ok: false, error: { code: fetched.error.code, message: fetched.error.message } };
    const existing = parseEntry(fetched.value);
    if (existing !== null && existing.bodyFingerprint !== entry.bodyFingerprint) {
      return { ok: false, error: { code: 'idempotency_conflict', message: 'the idempotency key committed a different body — the first completion stands' } };
    }
    return { ok: true, value: { committed: false } };
  }

  /** `true` when a key has a committed completion (test/debug surface). */
  async has(tenant: string, credentialId: string, routePattern: string, key: string): Promise<StoreResult<boolean>> {
    const fetched = await executeUpstashCommand(this.deps.config, 'get', [idempotencyKeyOf(tenant, credentialId, routePattern, key)], this.fetchLike);
    this.note('has', tenant, fetched.ok);
    if (!fetched.ok) return { ok: false, error: { code: fetched.error.code, message: fetched.error.message } };
    return { ok: true, value: fetched.value !== null && fetched.value !== undefined };
  }

  private note(operation: string, tenant: string, ok: boolean): void {
    this.provenance = { adapter: 'upstash', store: 'idempotency', operation, tenant, at: this.deps.instants.next(), outcome: ok ? 'ok' : 'degraded' };
  }
}

function parseEntry(value: unknown): IdempotencyEntryMirror | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (typeof parsed.credentialId !== 'string' || typeof parsed.routePattern !== 'string' || typeof parsed.key !== 'string') return null;
    if (typeof parsed.bodyFingerprint !== 'string' || typeof parsed.responseStatus !== 'number' || typeof parsed.at !== 'number') return null;
    return { credentialId: parsed.credentialId, routePattern: parsed.routePattern, key: parsed.key, bodyFingerprint: parsed.bodyFingerprint, responseStatus: parsed.responseStatus, responseBody: parsed.responseBody ?? null, at: parsed.at };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The tenant-scoped cache
// ---------------------------------------------------------------------------

/** The cache-name charset: no keyspace smuggling (a name can never escape its tenant prefix). */
const CACHE_NAME_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

/** The cache key of one name under one tenant (the prefix is server-side — L12). */
export function cacheKeyOf(tenant: string, name: string): StoreResult<string> {
  if (!isNonEmptyString(tenant) || !CACHE_NAME_PATTERN.test(name)) {
    return { ok: false, error: { code: 'invalid_cache_name', message: 'the cache name must match [A-Za-z0-9_.:-]{1,128} and the tenant must be non-empty' } };
  }
  return { ok: true, value: `tradrl:cache:${tenant}:${name}` };
}

/** The TTL-scoped, tenant-scoped cache. */
export class UpstashCache {
  private readonly deps: UpstashStoreDeps;
  private readonly fetchLike: FetchLike;
  private provenance: AdapterProvenance | null = null;

  constructor(deps: UpstashStoreDeps) {
    this.deps = deps;
    this.fetchLike = deps.fetchLike ?? defaultFetch();
  }

  lastProvenance(): AdapterProvenance | null {
    return this.provenance;
  }

  /** Read one cached JSON value (null on a miss — indistinguishable from absent). */
  async get(tenant: string, name: string): Promise<StoreResult<unknown>> {
    const key = cacheKeyOf(tenant, name);
    if (!key.ok) return key;
    const fetched = await executeUpstashCommand(this.deps.config, 'get', [key.value], this.fetchLike);
    this.note('get', tenant, fetched.ok);
    if (!fetched.ok) return { ok: false, error: { code: fetched.error.code, message: fetched.error.message } };
    if (fetched.value === null || fetched.value === undefined) return { ok: true, value: null };
    try {
      return { ok: true, value: JSON.parse(String(fetched.value)) as unknown };
    } catch {
      return { ok: false, error: { code: 'upstash_malformed_response', message: 'the cached value is not valid JSON' } };
    }
  }

  /** Write one JSON value with a TTL (canonical bytes — L9). */
  async set(tenant: string, name: string, value: unknown, ttlSeconds: number): Promise<StoreResult<{ readonly stored: true }>> {
    const key = cacheKeyOf(tenant, name);
    if (!key.ok) return key;
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
      return { ok: false, error: { code: 'invalid_cache_ttl', message: 'the cache TTL must be a positive integer (seconds)' } };
    }
    const stored = await executeUpstashCommand(this.deps.config, 'set', [key.value, canonicalJson(value as JsonValue), 'EX', String(ttlSeconds)], this.fetchLike);
    this.note('set', tenant, stored.ok);
    if (!stored.ok) return { ok: false, error: { code: stored.error.code, message: stored.error.message } };
    return { ok: true, value: { stored: true } };
  }

  /** Delete one cached value. */
  async delete(tenant: string, name: string): Promise<StoreResult<{ readonly deleted: boolean }>> {
    const key = cacheKeyOf(tenant, name);
    if (!key.ok) return key;
    const deleted = await executeUpstashCommand(this.deps.config, 'del', [key.value], this.fetchLike);
    this.note('delete', tenant, deleted.ok);
    if (!deleted.ok) return { ok: false, error: { code: deleted.error.code, message: deleted.error.message } };
    return { ok: true, value: { deleted: typeof deleted.value === 'number' ? deleted.value > 0 : true } };
  }

  private note(operation: string, tenant: string, ok: boolean): void {
    this.provenance = { adapter: 'upstash', store: 'cache', operation, tenant, at: this.deps.instants.next(), outcome: ok ? 'ok' : 'degraded' };
  }
}
