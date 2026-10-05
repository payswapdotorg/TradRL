// @tradrl/web-console — the content-addressing primitives.
//
// The program-wide canonical-JSON + FNV-1a digest, mirrored from the
// workspace's shared discipline (the SDK's idempotency derivation,
// the boundary's primitives, the observability package's stable
// digests — one law everywhere): identical inputs -> identical
// bytes -> identical digests. The console's evidence-capsule and
// notice ids are content-addressed through the FNV-1a form; the
// workspace's HISTORY CHAIN (R9a — export integrity) is hashed with
// the SHA-256 implementation below: a real cryptographic digest over
// the canonical JSON of each event's payload, so anyone holding the
// exported file can recompute every digest and every link with the
// published algorithm. Pure functions only; no ambient state, no
// randomness, no clock, no platform crypto (the console's no-build
// browser bundle cannot import node:crypto, and crypto.subtle is
// async — the reducer is sync — so this is a self-contained
// FIPS 180-4 implementation, pinned against the NIST test vectors).
//
// Spec anchors: L9 (reproducible lineage), L11 (search integrity —
// history is retained and verifiable), R38 (content-addressed
// evidence capsules), R9a (a real, derivable, verifiable chain).

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

// ---------------------------------------------------------------------------
// SHA-256 (FIPS 180-4) — the history chain's hash (R9a)
// ---------------------------------------------------------------------------
//
// WHY HERE, HAND-ROLLED: the workspace reducer links the chain
// synchronously, and the console ships as a no-build browser bundle
// (the type-stripper loader). node:crypto does not exist in the
// browser and crypto.subtle is promise-based, so the chain's digest
// is this self-contained implementation. It is pinned byte-exact
// against the NIST FIPS 180-4 test vectors AND cross-checked against
// Node's own crypto in the test suite (test-only import — the
// runtime code stays platform-free). Anyone can recompute: digest =
// SHA-256 of the UTF-8 bytes of the canonical JSON, as lowercase hex.

/** The SHA-256 round constants (FIPS 180-4 §4.2.2 — first 32 bits of the fractional parts of the cube roots of the first 64 primes). */
const SHA256_K: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** The SHA-256 initial hash words (FIPS 180-4 §5.3.3 — first 32 bits of the fractional parts of the square roots of the first 8 primes). */
const SHA256_H0: readonly number[] = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

/** Rotate a 32-bit word right by n bits (the sigma/Sigma building block). */
function rotr32(word: number, bits: number): number {
  return ((word >>> bits) | (word << (32 - bits))) >>> 0;
}

/**
 * The UTF-8 bytes of a string (surrogate-pair aware, deterministic).
 * A lone surrogate (invalid in canonical JSON output, but defensive)
 * encodes its own code-unit value as a 3-byte sequence — the law is
 * DETERMINISM: the same string always hashes to the same digest, on
 * every machine, forever.
 */
export function utf8BytesOf(text: string): readonly number[] {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    let code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const low = text.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        index += 1;
      }
    }
    if (code <= 0x7f) {
      bytes.push(code);
    } else if (code <= 0x7ff) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code <= 0xffff) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return bytes;
}

/**
 * The SHA-256 digest of a string's UTF-8 bytes, as lowercase 64-hex
 * (FIPS 180-4). THE PUBLISHED CHAIN RULE (workspace.ts): every event
 * entry's digest is sha256Hex(canonicalJson(payload)); every link is
 * sha256Hex(priorChainHead + digest) — fixed-width 64-hex components,
 * so plain concatenation is unambiguous.
 */
export function sha256Hex(text: string): string {
  const message = utf8BytesOf(text);
  const bitLength = message.length * 8;
  // FIPS 180-4 §5.1.1 padding: 0x80, zeros to 56 mod 64, then the
  // 64-bit big-endian BIT length (high word first, each word as 4 bytes).
  const padded: number[] = [...message, 0x80];
  while (padded.length % 64 !== 56) padded.push(0);
  const lengthHigh = Math.floor(bitLength / 0x100000000) >>> 0;
  const lengthLow = bitLength >>> 0;
  padded.push((lengthHigh >>> 24) & 0xff, (lengthHigh >>> 16) & 0xff, (lengthHigh >>> 8) & 0xff, lengthHigh & 0xff);
  padded.push((lengthLow >>> 24) & 0xff, (lengthLow >>> 16) & 0xff, (lengthLow >>> 8) & 0xff, lengthLow & 0xff);

  const h = [...SHA256_H0];
  for (let blockStart = 0; blockStart < padded.length; blockStart += 64) {
    const w: number[] = new Array(64);
    for (let t = 0; t < 16; t += 1) {
      const base = blockStart + t * 4;
      w[t] = ((((padded[base] as number) << 24) | ((padded[base + 1] as number) << 16) | ((padded[base + 2] as number) << 8) | (padded[base + 3] as number)) >>> 0);
    }
    for (let t = 16; t < 64; t += 1) {
      const w15 = w[t - 15] as number;
      const w2 = w[t - 2] as number;
      const s0 = (rotr32(w15, 7) ^ rotr32(w15, 18) ^ (w15 >>> 3)) >>> 0;
      const s1 = (rotr32(w2, 17) ^ rotr32(w2, 19) ^ (w2 >>> 10)) >>> 0;
      w[t] = (((w[t - 16] as number) + s0 + (w[t - 7] as number) + s1) >>> 0);
    }
    let a = h[0] as number;
    let b = h[1] as number;
    let c = h[2] as number;
    let d = h[3] as number;
    let e = h[4] as number;
    let f = h[5] as number;
    let g = h[6] as number;
    let hh = h[7] as number;
    for (let t = 0; t < 64; t += 1) {
      const bigS1 = (rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (hh + bigS1 + ch + (SHA256_K[t] as number) + (w[t] as number)) >>> 0;
      const bigS0 = (rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (bigS0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h[0] = ((h[0] as number) + a) >>> 0;
    h[1] = ((h[1] as number) + b) >>> 0;
    h[2] = ((h[2] as number) + c) >>> 0;
    h[3] = ((h[3] as number) + d) >>> 0;
    h[4] = ((h[4] as number) + e) >>> 0;
    h[5] = ((h[5] as number) + f) >>> 0;
    h[6] = ((h[6] as number) + g) >>> 0;
    h[7] = ((h[7] as number) + hh) >>> 0;
  }
  let hex = '';
  for (let index = 0; index < 8; index += 1) {
    hex += (h[index] as number).toString(16).padStart(8, '0');
  }
  return hex;
}

/** The SHA-256 digest of a JSON value's canonical form, as lowercase 64-hex (the chain's content rule). */
export function sha256Of(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
