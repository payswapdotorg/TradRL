// @tradrl/sdk — the idempotency-key generation helpers.
//
// THE LAW (Work Order): "idempotency-key generation helpers". The
// boundary's law: the key is an opaque non-empty string (<= 256
// chars); the SAME key + route + body replays the original result.
// The SDK's helpers:
//
//   - `deriveIdempotencyKey(parts)`: the DETERMINISTIC derivation
//     ('idem:' + FNV-1a of the canonical JSON of the parts) —
//     identical logical operations derive identical keys (retries
//     reuse them for free; identical inputs -> identical bytes, L9).
//     Uniqueness is the CALLER's responsibility: derive over
//     operation-unique parts (a fresh request id, a monotonic
//     counter, the operation's own content).
//   - `idempotencyKeyFromEntropy(entropy)`: the INJECTED-entropy
//     derivation for callers that want per-operation randomness
//     without ambient sources — the entropy arrives as a string
//     (a UUID from the host's generator, a hardware token, anything);
//     the SDK never reads Math.random (no ambient nondeterminism).
//   - `isValidIdempotencyKey`: the wire-header law as a guard.
//
// Both derivations are pure and byte-deterministic: the same inputs
// always produce the same key (pinned by tests).

/** The FNV-1a 32-bit hash of a string, as zero-padded lowercase hex (the program-wide digest, mirrored). */
function fnv1a32Hex(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Canonical JSON serialization of a JSON value: object keys recursively sorted (the program-wide canonical form, mirrored). */
function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map((element) => canonicalJson(element)).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return 'null';
}

/** The key grammar: `idem:` + 8-hex digest. */
export const IDEMPOTENCY_KEY_PATTERN = /^idem:[0-9a-f]{8}$/;

/** The wire-header law: opaque non-empty, <= 256 chars. */
export function isValidIdempotencyKey(key: unknown): key is string {
  return typeof key === 'string' && key.length > 0 && key.length <= 256;
}

/**
 * The DETERMINISTIC derivation: 'idem:' + FNV-1a of the canonical
 * JSON of the parts. Identical parts -> identical key (L9); the
 * caller chooses operation-unique parts. Key-order differences in
 * equal-shaped parts derive the SAME key (canonical JSON).
 */
export function deriveIdempotencyKey(parts: unknown): string {
  return `idem:${fnv1a32Hex(canonicalJson(parts))}`;
}

/**
 * The INJECTED-entropy derivation: for callers that want
 * per-operation uniqueness without ambient randomness — the entropy
 * arrives from the host (a UUID, a counter, a hardware source); the
 * SDK never reads Math.random.
 */
export function idempotencyKeyFromEntropy(entropy: string): string {
  if (typeof entropy !== 'string' || entropy.length === 0) {
    throw new Error('idempotencyKeyFromEntropy: the host-injected entropy must be a non-empty string');
  }
  return `idem:${fnv1a32Hex(entropy)}`;
}

/**
 * The retry-safe key holder: ONE key per logical operation — every
 * retry of a consequential request reuses it (the boundary dedupes
 * to the original result; a retry after a timeout can never
 * double-execute).
 */
export class IdempotencyScope {
  private key: string | undefined;

  /** The current key, deriving it on first use (the same key for every retry). */
  reuse(parts: unknown): string {
    if (this.key === undefined) {
      this.key = typeof parts === 'string' && IDEMPOTENCY_KEY_PATTERN.test(`idem:${fnv1a32Hex(parts)}`) ? `idem:${fnv1a32Hex(parts)}` : deriveIdempotencyKey(parts);
    }
    return this.key;
  }

  /** Has a key been derived yet? */
  get derived(): boolean {
    return this.key !== undefined;
  }
}
