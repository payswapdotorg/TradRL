// deploy/adapters/shared.ts — the deployment adapters' shared zero-dep core.
//
// Hand-authored primitives (platform APIs only — NO imports from
// services/api, packages/*, or npm: the invariant-9 law — these are
// STRUCTURAL MIRRORS of the program-wide canonical forms, and the
// contract test pins byte-equality against the REAL implementations
// test-only, the T041 interop precedent).
//
// Spec anchors: L9 (byte determinism), L12 (tenant isolation in shared
// infrastructure), R46 (typed degradation), D-033 (the provider set).

// ---------------------------------------------------------------------------
// Guards (structural mirrors of the program-wide guards)
// ---------------------------------------------------------------------------

/** Guard: a plain record object. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Guard: a non-empty string. */
export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

// ---------------------------------------------------------------------------
// Canonical JSON + stable digests (L9 — byte determinism)
// ---------------------------------------------------------------------------

export type JsonValue = null | boolean | number | string | JsonValue[] | { readonly [key: string]: JsonValue };

/**
 * Canonical JSON serialization: object keys recursively sorted
 * (code-unit order), arrays in order, strings via `JSON.stringify`,
 * finite numbers via `String`. Equal JSON values serialize
 * byte-identically. (Mirror of the program-wide canonical form — the
 * contract test pins equality with the REAL canonicalJson.)
 */
export function canonicalJson(value: JsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map((element) => canonicalJson(element)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

/** FNV-1a 32-bit hash of a string, as zero-padded lowercase hex (mirror of the program-wide digest). */
export function fnv1a32Hex(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// ---------------------------------------------------------------------------
// The typed store result + the L12/R46 error codes
// ---------------------------------------------------------------------------

/** One store refusal: a typed code + message (the store never throws — R46). */
export interface StoreFailure {
  readonly code: string;
  readonly message: string;
  /** The owning lane's typed problems, when any (dotted paths). */
  readonly problems?: readonly { readonly path: string; readonly message: string }[];
}

/** The widened store result (structural mirror of T041's PortResult). */
export type StoreResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: StoreFailure };

/** The L12 typed error: a scope/record that would cross a tenant boundary. */
export const CROSS_TENANT_CODE = 'cross_tenant_access';

/** Build the typed cross-tenant failure (the hardest law — always available, always typed). */
export function crossTenantFailure(message: string): StoreFailure {
  return { code: CROSS_TENANT_CODE, message };
}

/** The injected instant source (structural mirror of T041's InstantSource — no ambient clock in the adapters). */
export interface InstantSourceMirror {
  /** The next instant (epoch ms; monotonic). */
  next(): number;
}

/** One provenance record: what the adapter did, when, at whose scope (observable, never secret). */
export interface AdapterProvenance {
  readonly adapter: 'neon' | 'upstash';
  readonly store: string;
  readonly operation: string;
  readonly tenant: string;
  readonly at: number;
  readonly outcome: 'ok' | 'degraded';
  readonly detail?: string;
}

// ---------------------------------------------------------------------------
// The injected fetch (testable, never ambient)
// ---------------------------------------------------------------------------

/** The fetch surface the adapters consume (structural — globalThis.fetch satisfies it). */
export type FetchLike = (input: string, init?: { method?: string; headers?: Readonly<Record<string, string>>; body?: string }) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  readonly text: () => Promise<string>;
}>;

/** Parse a JSON text into an unknown (typed failure — never a throw). */
export function parseJsonText(text: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly code: 'malformed_response' } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, code: 'malformed_response' };
  }
}
