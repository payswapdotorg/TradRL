// @tradrl/web-console — the SDK mirror: the idempotency-key helpers.
//
// The mirror of packages/sdk/src/idempotency.ts (the deterministic
// derivation the console's consequential calls reuse): identical
// parts -> identical key (L9 byte-determinism; a retried launch or
// job submission can never double-execute). The console never reads
// Math.random — no ambient nondeterminism.

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
    // The cast lives OUTSIDE the template interpolation (the erasable-subset law:
    // no type syntax inside template-literal interpolations — hoist first).
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
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
 * console chooses operation-unique parts (the launch draft content,
 * the job spec) so retries reuse them for free.
 */
export function deriveIdempotencyKey(parts: unknown): string {
  return `idem:${fnv1a32Hex(canonicalJson(parts))}`;
}
