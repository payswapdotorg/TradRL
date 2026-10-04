// deploy/adapters/upstash/client.ts — the hand-authored ZERO-DEP
// Upstash Redis REST client.
//
// THE AUTH MODEL (what is REAL, pinned): Upstash's REST API is
// TOKEN-BEARER, not HMAC — every request carries
//   Authorization: Bearer <UPSTASH_REDIS_REST_TOKEN>
// against the database's own endpoint URL (UPSTASH_REDIS_REST_URL,
// e.g. https://example.upstash.io):
//
//   GET  {url}/<command>/<arg1>/<arg2>/...      (each arg URI-encoded)
//        -> 200 {"result": <value>} | {"error": "<message>"}
//   POST {url}/pipeline
//        body: [["set","k","v","EX","60"], ...]
//        -> 200 [ {"result":"OK"} | {"error":".."} , ... ]
//
// Reimplemented here on platform APIs only (fetch — NO
// @upstash/redis, no npm dependency). DETERMINISM (L9): the request
// builders are pure — fixed vectors in upstash.test.ts use FIXED FAKE
// tokens (no live calls, no real secrets). DEGRADATION (R46): network
// / HTTP / per-command errors are the typed UpstashFailure; never a
// throw.
//
// Spec anchors: D-033 (Upstash is the cache + idempotency provider),
// R46.

import { parseJsonText, type FetchLike } from '../shared';

// ---------------------------------------------------------------------------
// The configuration (environment-sourced — never hardcoded)
// ---------------------------------------------------------------------------

/** The Upstash REST client configuration. */
export interface UpstashConfig {
  /** The database's REST endpoint (`https://<slug>.upstash.io`). */
  readonly url: string;
  /** The REST token (a secret — never logged, never in error messages). */
  readonly token: string;
}

// ---------------------------------------------------------------------------
// The typed failures (R46 — never a throw)
// ---------------------------------------------------------------------------

/** One typed Upstash client failure. */
export interface UpstashFailure {
  readonly code: 'upstash_unreachable' | 'upstash_http_error' | 'upstash_error' | 'upstash_malformed_response';
  readonly message: string;
}

/** The widened result. */
export type UpstashResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: UpstashFailure };

// ---------------------------------------------------------------------------
// The request construction (pure — the determinism surface)
// ---------------------------------------------------------------------------

/** One fully-built REST request (the pinned-vector surface — FAKE tokens in tests only). */
export interface BuiltUpstashRequest {
  readonly method: 'GET' | 'POST';
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

/** The single-command request (GET {url}/{command}/{args...} — Bearer token). */
export function buildUpstashCommandRequest(config: UpstashConfig, command: string, args: readonly string[]): BuiltUpstashRequest {
  const path = [command, ...args].map((part) => encodeURIComponent(part)).join('/');
  return {
    method: 'GET',
    url: `${config.url.replace(/\/$/, '')}/${path}`,
    headers: { authorization: `Bearer ${config.token}` },
  };
}

/** The pipeline request (POST {url}/pipeline — Bearer token, JSON body). */
export function buildUpstashPipelineRequest(config: UpstashConfig, commands: readonly (readonly string[])[]): BuiltUpstashRequest {
  return {
    method: 'POST',
    url: `${config.url.replace(/\/$/, '')}/pipeline`,
    headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(commands.map((command) => [...command])),
  };
}

// ---------------------------------------------------------------------------
// The execution (injected fetch; typed degradation on every path)
// ---------------------------------------------------------------------------

async function fetchText(fetchLike: FetchLike, request: BuiltUpstashRequest): Promise<UpstashResult<string>> {
  try {
    const response = await fetchLike(request.url, { method: request.method, headers: request.headers, body: request.body });
    let text: string;
    try {
      text = await response.text();
    } catch (cause) {
      return { ok: false, error: { code: 'upstash_unreachable', message: `the Upstash REST response body could not be read (${String(cause)})` } };
    }
    if (!response.ok) {
      return { ok: false, error: { code: 'upstash_http_error', message: `Upstash answered ${response.status}: ${text.slice(0, 200)}` } };
    }
    return { ok: true, value: text };
  } catch (cause) {
    return { ok: false, error: { code: 'upstash_unreachable', message: `the Upstash REST endpoint could not be reached (${String(cause)})` } };
  }
}

/**
 * Execute one command. `result` is returned verbatim (a GET miss is
 * `null`); a per-command `{"error": ...}` envelope is the typed
 * `upstash_error` (R46 — never a throw).
 */
export async function executeUpstashCommand(
  config: UpstashConfig,
  command: string,
  args: readonly string[],
  fetchLike: FetchLike,
): Promise<UpstashResult<unknown>> {
  const fetched = await fetchText(fetchLike, buildUpstashCommandRequest(config, command, args));
  if (!fetched.ok) return fetched;
  const parsed = parseJsonText(fetched.value);
  if (!parsed.ok) return { ok: false, error: { code: 'upstash_malformed_response', message: 'the Upstash response body is not valid JSON' } };
  const body = parsed.value as { result?: unknown; error?: unknown };
  if (typeof body.error === 'string') return { ok: false, error: { code: 'upstash_error', message: `Upstash refused the command: ${body.error}` } };
  return { ok: true, value: body.result };
}

/**
 * Execute a pipeline. Every sub-result is widened: a sub-error is the
 * typed `upstash_error` for the WHOLE pipeline (fail-closed — partial
 * application of a pipeline is not observable).
 */
export async function executeUpstashPipeline(
  config: UpstashConfig,
  commands: readonly (readonly string[])[],
  fetchLike: FetchLike,
): Promise<UpstashResult<readonly unknown[]>> {
  const fetched = await fetchText(fetchLike, buildUpstashPipelineRequest(config, commands));
  if (!fetched.ok) return fetched;
  const parsed = parseJsonText(fetched.value);
  if (!parsed.ok) return { ok: false, error: { code: 'upstash_malformed_response', message: 'the Upstash pipeline response body is not valid JSON' } };
  if (!Array.isArray(parsed.value)) return { ok: false, error: { code: 'upstash_malformed_response', message: 'the Upstash pipeline response body is not an array' } };
  const results: unknown[] = [];
  for (const entry of parsed.value as { result?: unknown; error?: unknown }[]) {
    if (typeof entry?.error === 'string') {
      return { ok: false, error: { code: 'upstash_error', message: `Upstash refused a pipeline command: ${entry.error}` } };
    }
    results.push(entry?.result);
  }
  return { ok: true, value: results };
}
