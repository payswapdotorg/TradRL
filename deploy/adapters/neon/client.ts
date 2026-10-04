// deploy/adapters/neon/client.ts — the hand-authored ZERO-DEP Neon client.
//
// THE WIRE FORMAT (Neon's SQL-over-HTTP proxy, the protocol behind
// @neondatabase/serverless's HTTP fetch mode — reimplemented here on
// platform APIs only, NO npm dependency):
//
//   POST https://<host>/sql
//   Content-Type: application/json
//   Accept: application/json
//   Neon-Connection-String: <URI-encoded postgresql://user:password@host/database?sslmode=require>
//   {"query": "<SQL with $1..$n placeholders>", "params": ["...", ...]}
//
//   200 SELECT -> {"fields":[{"name":..,"typeOID":..},..],"rows":[[v,..],..]}
//   200 DML    -> {"command":"INSERT 0 1","rowCount":1}
//   4xx/5xx    -> non-JSON or {"message":".."} error body
//
// The connection string is built from the environment (NEON_API_HOST —
// the POOLED host (`ep-...-pooler.<region>.aws.neon.tech`), NEON_DATABASE,
// NEON_API_USER, NEON_API_KEY — the DB password). SECRETS ARE NEVER
// HARDCODED and never appear in error messages or provenance records.
//
// DETERMINISM (L9): `buildNeonRequest` is pure — identical config +
// query + params yield identical request bytes (pinned vectors in
// neon.test.ts with FIXED FAKE credentials, no live calls, no real
// secrets). DEGRADATION (R46): every failure — network, HTTP, SQL,
// malformed body — is the typed NeonFailure; the client never throws.
//
// Spec anchors: D-033 (Neon is the durable-store provider), L12 (the
// STORES on top scope every query by tenant), R46.

import { parseJsonText, type FetchLike } from '../shared';

// ---------------------------------------------------------------------------
// The configuration (environment-sourced — never hardcoded)
// ---------------------------------------------------------------------------

/** The Neon client configuration. */
export interface NeonConfig {
  /** The POOLED endpoint host (`ep-...-pooler.<region>.aws.neon.tech`). */
  readonly apiHost: string;
  /** The database name (e.g. `neondb`). */
  readonly database: string;
  /** The database user (e.g. the Neon role that owns the database). */
  readonly apiUser: string;
  /** The database password (the Neon API key of that role — a secret, never logged). */
  readonly apiKey: string;
}

/** Build the connection string the `Neon-Connection-String` header carries (URL-encoded per the protocol). */
export function neonConnectionString(config: NeonConfig): string {
  return `postgresql://${config.apiUser}:${encodeURIComponent(config.apiKey)}@${config.apiHost}/${config.database}?sslmode=require`;
}

// ---------------------------------------------------------------------------
// The typed failures (R46 — never a throw)
// ---------------------------------------------------------------------------

/** One typed Neon client failure. */
export interface NeonFailure {
  readonly code: 'neon_unreachable' | 'neon_http_error' | 'neon_sql_error' | 'neon_malformed_response';
  readonly message: string;
}

/** The widened result. */
export type NeonResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: NeonFailure };

// ---------------------------------------------------------------------------
// The request construction (pure — the determinism surface)
// ---------------------------------------------------------------------------

/** One fully-built HTTP request (the pinned-vector surface — FAKE credentials in tests only). */
export interface BuiltNeonRequest {
  readonly method: 'POST';
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** The SQL-over-HTTP request for one parameterized statement (pure, deterministic). */
export function buildNeonRequest(config: NeonConfig, query: string, params: readonly string[]): BuiltNeonRequest {
  return {
    method: 'POST',
    url: `https://${config.apiHost}/sql`,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'neon-connection-string': encodeURIComponent(neonConnectionString(config)),
    },
    body: JSON.stringify({ query, params }),
  };
}

// ---------------------------------------------------------------------------
// The wire response shapes (structural — parsed defensively)
// ---------------------------------------------------------------------------

/** A SELECT wire response. */
export interface NeonSelectResponse {
  readonly fields: readonly { readonly name: string; readonly typeOID: number }[];
  readonly rows: readonly (readonly unknown[])[];
}

/** A DML wire response. */
export interface NeonDmlResponse {
  readonly command: string;
  readonly rowCount: number;
}

function isSelectResponse(v: unknown): v is NeonSelectResponse {
  if (typeof v !== 'object' || v === null) return false;
  const candidate = v as { fields?: unknown; rows?: unknown };
  return Array.isArray(candidate.fields) && Array.isArray(candidate.rows);
}

function isDmlResponse(v: unknown): v is NeonDmlResponse {
  if (typeof v !== 'object' || v === null) return false;
  const candidate = v as { command?: unknown; rowCount?: unknown };
  return typeof candidate.command === 'string' && typeof candidate.rowCount === 'number';
}

/** The parsed outcome of one statement: selected rows, or the DML tally. */
export type NeonQueryOutcome =
  | { readonly kind: 'select'; readonly rows: readonly (readonly unknown[])[] }
  | { readonly kind: 'dml'; readonly command: string; readonly rowCount: number };

// ---------------------------------------------------------------------------
// The execution (injected fetch; typed degradation on every path)
// ---------------------------------------------------------------------------

/**
 * Execute one parameterized statement. NEVER throws: network failure is
 * `neon_unreachable`, a non-2xx is `neon_http_error` (with the server's
 * message when the body carries one — SQL errors arrive this way), a
 * body that is neither shape is `neon_malformed_response` (R46).
 */
export async function executeNeonStatement(
  config: NeonConfig,
  query: string,
  params: readonly string[],
  fetchLike: FetchLike,
): Promise<NeonResult<NeonQueryOutcome>> {
  const request = buildNeonRequest(config, query, params);
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await fetchLike(request.url, { method: request.method, headers: request.headers, body: request.body });
  } catch (cause) {
    return { ok: false, error: { code: 'neon_unreachable', message: `the Neon SQL-over-HTTP endpoint could not be reached (${String(cause)})` } };
  }
  let text: string;
  try {
    text = await response.text();
  } catch (cause) {
    return { ok: false, error: { code: 'neon_unreachable', message: `the Neon response body could not be read (${String(cause)})` } };
  }
  if (!response.ok) {
    const parsed = parseJsonText(text);
    const serverMessage = parsed.ok && typeof (parsed.value as { message?: unknown })?.message === 'string'
      ? ((parsed.value as { message: string }).message)
      : text.slice(0, 200);
    return { ok: false, error: { code: 'neon_http_error', message: `Neon answered ${response.status}: ${serverMessage}` } };
  }
  const parsed = parseJsonText(text);
  if (!parsed.ok) return { ok: false, error: { code: 'neon_malformed_response', message: 'the Neon response body is not valid JSON' } };
  if (isSelectResponse(parsed.value)) {
    return { ok: true, value: { kind: 'select', rows: parsed.value.rows } };
  }
  if (isDmlResponse(parsed.value)) {
    return { ok: true, value: { kind: 'dml', command: parsed.value.command, rowCount: parsed.value.rowCount } };
  }
  return { ok: false, error: { code: 'neon_malformed_response', message: 'the Neon response body is neither a select nor a DML envelope' } };
}
