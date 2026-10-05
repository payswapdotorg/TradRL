// @tradrl/web-console — the content-addressing primitives.
//
// The program-wide canonical-JSON + FNV-1a digest, mirrored from the
// workspace's shared discipline (the SDK's idempotency derivation,
// the boundary's primitives, the observability package's stable
// digests — one law everywhere): identical inputs -> identical
// bytes -> identical digests. The console's history chain, evidence
// capsules and notice ids are all content-addressed through here.
// Pure functions only; no ambient state, no randomness, no clock.
//
// Spec anchors: L9 (reproducible lineage), L11 (search integrity —
// history is retained and verifiable), R38 (content-addressed
// evidence capsules).

/** The FNV-1a 32-bit hash of a string, as zero-padded lowercase hex (the program-wide digest). */
export function fnv1a32Hex(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Canonical JSON serialization of a JSON value: object keys recursively sorted (byte-stable). */
export function canonicalJson(value: unknown): string {
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

/** The content digest of a JSON value: FNV-1a over its canonical form. */
export function digestOf(value: unknown): string {
  return fnv1a32Hex(canonicalJson(value));
}

/** Guard: a JSON value (the console's records are JSON-shaped end to end). */
export function isJsonValue(v: unknown): boolean {
  if (v === null) return true;
  const type = typeof v;
  if (type === 'string' || type === 'number' || type === 'boolean') return Number.isFinite(v as number) || type !== 'number';
  if (Array.isArray(v)) return v.every(isJsonValue);
  if (type === 'object') return Object.values(v as Record<string, unknown>).every(isJsonValue);
  return false;
}
