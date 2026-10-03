// @tradrl/api-service — the idempotency store (the consequential-route law).
//
// THE LAW (Work Order): "Idempotency keys REQUIRED on consequential
// routes (execution requests, job submissions) — replays dedupe to
// the original result."
//
// - The dedupe identity is `(credentialId, routePattern, key)`: the
//   SAME caller, the SAME route, the SAME key replays the ORIGINAL
//   response byte-for-byte (marked `x-idempotent-replay: true`) with
//   ZERO backing-service calls — the replay is served from this
//   store.
// - The SAME key with a DIFFERENT body is the typed 409
//   `idempotency_conflict` (the first stands; the second is refused).
// - A consequential route WITHOUT a key is the typed 400
//   `idempotency_required`.
// - DETERMINISM (L9): the stored fingerprint is the canonical digest
//   of the request body; identical inputs -> identical bytes.
//
// Spec anchors: R43, L9, L20 (the replay decision is code).

import { canonicalJson, fnv1a32Hex, isNonEmptyString, isRecord, isJsonValue } from './primitives';
import { apiError, type ApiError } from './errors';
import type { IdempotencyKey } from './ids';
import { isIdempotencyKey } from './ids';

// ---------------------------------------------------------------------------
// The stored entry
// ---------------------------------------------------------------------------

/** One stored idempotent completion: the key's route, the body fingerprint, the original response. */
export interface IdempotencyEntry {
  /** The dedupe identity: credentialId + routePattern + key (the store's composite key). */
  readonly credentialId: string;
  readonly routePattern: string;
  readonly key: IdempotencyKey;
  /** The canonical digest of the ORIGINAL request body (replay-coherence check). */
  readonly bodyFingerprint: string;
  /** The ORIGINAL response, replayed verbatim. */
  readonly responseStatus: number;
  readonly responseBody: unknown;
  /** The completion instant (injected). */
  readonly at: number;
}

/** Guard: an idempotency entry. */
export function isIdempotencyEntry(v: unknown): v is IdempotencyEntry {
  if (!isRecord(v)) return false;
  if (!isNonEmptyString(v.credentialId)) return false;
  if (!isNonEmptyString(v.routePattern)) return false;
  if (!isIdempotencyKey(v.key)) return false;
  if (typeof v.bodyFingerprint !== 'string' || !/^[0-9a-f]{8}$/.test(v.bodyFingerprint)) return false;
  if (typeof v.responseStatus !== 'number') return false;
  if (typeof v.at !== 'number' || !Number.isSafeInteger(v.at) || v.at < 0) return false;
  return true;
}

/** The canonical body fingerprint: fnv(canonical(body)) — `fnv('null')` for an absent body. */
export function bodyFingerprintOf(body: unknown): string {
  const canonical = isJsonValue(body) ? canonicalJson(body) : 'null';
  return fnv1a32Hex(canonical);
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/** The verdict of a consequential request's idempotency check. */
export type IdempotencyVerdict =
  | { readonly kind: 'fresh' }
  | { readonly kind: 'replay'; readonly entry: IdempotencyEntry }
  | { readonly kind: 'conflict'; readonly error: ApiError };

/**
 * The idempotency store: append-only (an entry is immutable once
 * written — a completed consequential request's result is history).
 * The ONLY entry point is {@link IdempotencyStore.begin} (the
 * pipeline's check) followed by {@link IdempotencyStore.complete}
 * (the pipeline's commit after the handler succeeds or refuses).
 */
export class IdempotencyStore {
  private readonly entries = new Map<string, IdempotencyEntry>();

  /** The composite key of one consequential call. */
  private compositeKey(credentialId: string, routePattern: string, key: IdempotencyKey): string {
    return canonicalJson([credentialId, routePattern, key]);
  }

  /**
   * The pre-handler check: `fresh` when the key is unseen (the
   * handler runs); `replay` when the SAME key + body completed before
   * (the original response replays verbatim); `conflict` when the
   * same key carries a DIFFERENT body (typed 409 — the first stands).
   */
  begin(credentialId: string, routePattern: string, key: IdempotencyKey, body: unknown): IdempotencyVerdict {
    const composite = this.compositeKey(credentialId, routePattern, key);
    const existing = this.entries.get(composite);
    if (existing === undefined) return { kind: 'fresh' };
    if (existing.bodyFingerprint !== bodyFingerprintOf(body)) {
      return {
        kind: 'conflict',
        error: apiError(
          'idempotency_conflict',
          'this idempotency key was already used on this route with a DIFFERENT request body — the first completion stands (replays dedupe to the original result; a key is not reusable for a different operation)',
        ),
      };
    }
    return { kind: 'replay', entry: existing };
  }

  /**
   * The post-handler commit: record the completed result under the
   * key (idempotent — committing an already-committed key with the
   * same body is a no-op; a different body is refused).
   */
  complete(credentialId: string, routePattern: string, key: IdempotencyKey, body: unknown, responseStatus: number, responseBody: unknown, at: number): { readonly ok: true } | { readonly ok: false; readonly error: ApiError } {
    const composite = this.compositeKey(credentialId, routePattern, key);
    const existing = this.entries.get(composite);
    if (existing !== undefined) {
      if (existing.bodyFingerprint !== bodyFingerprintOf(body)) {
        return { ok: false, error: apiError('idempotency_conflict', 'the idempotency key committed a different body — the first completion stands') };
      }
      return { ok: true };
    }
    const entry: IdempotencyEntry = Object.freeze({
      credentialId,
      routePattern,
      key,
      bodyFingerprint: bodyFingerprintOf(body),
      responseStatus,
      responseBody,
      at,
    });
    this.entries.set(composite, entry);
    return { ok: true };
  }

  /** `true` when a key has a committed completion (test/debug surface). */
  has(credentialId: string, routePattern: string, key: IdempotencyKey): boolean {
    return this.entries.has(this.compositeKey(credentialId, routePattern, key));
  }

  /** The number of committed entries (test/debug surface). */
  get size(): number {
    return this.entries.size;
  }
}
