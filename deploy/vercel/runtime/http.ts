// deploy/vercel/runtime/http.ts — THE HTTP ADAPTATION LAYER (T052).
//
// Translates between the Vercel Node serverless function's
// (req, res) surface and services/api's plain ApiRequest/ApiResponse
// contracts (the T041 route table is WRAPPED here — never edited).
//
// THE SAME-ORIGIN LAW (the Work Order): the console reaches the API
// through the /v1 and /internal rewrites in deploy/vercel/vercel.json
// — one origin, therefore NO cross-origin response headers are ever
// emitted (verified by deploy/vercel/vercel.test.ts: neither the
// config nor this file may carry the forbidden header family).
//
// THE PATH LAW: the rewrites pass the public path through verbatim
// after the function mount (`/v1/meta` ->
// `/deploy/vercel/api/router/v1/meta`), so this layer strips exactly
// the mount prefix and hands the ORIGINAL path to the route table.
//
// Zero-dep law: platform APIs only (structural types for the req/res
// surface — no @vercel/node import, no npm dependency).

import type { ApiRequest, ApiResponse } from '../../../services/api/src/contracts';

/** The function's mount path (the vercel.json rewrites' destination base — the test pins the pair). */
export const FUNCTION_MOUNT_PATH = '/deploy/vercel/api/router';

// ---------------------------------------------------------------------------
// The structural req/res types (the Vercel Node function surface, minimal)
// ---------------------------------------------------------------------------

/** The inbound request (Node IncomingMessage shape, structurally). */
export interface FunctionRequest {
  readonly method: string | undefined;
  /** The rewritten URL — `<mount><public path>?<query>` (per the rewrites) or already the public path. */
  readonly url: string | undefined;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  /** @vercel/node pre-parses JSON bodies into `body`; absent when the raw stream must be read. */
  readonly body?: unknown;
  readonly [Symbol.asyncIterator]?: () => AsyncIterator<Buffer | string>;
}

/** The outbound response (Node ServerResponse shape, minimal + capturable in tests). */
export interface FunctionResponse {
  statusCode: number;
  setHeader(key: string, value: string | number): unknown;
  end(chunk?: string): unknown;
}

// ---------------------------------------------------------------------------
// The request adaptation
// ---------------------------------------------------------------------------

/** Recover the public API path from the rewritten URL (strip the function mount, pass the rest verbatim). */
export function publicPathOf(rawUrl: string | undefined): string {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) return '/';
  // Work with a synthetic absolute URL so the query string is parsed safely.
  const url = new URL(rawUrl, 'https://function.local');
  let path = url.pathname;
  if (path === FUNCTION_MOUNT_PATH || path === `${FUNCTION_MOUNT_PATH}/`) return '/';
  if (path.startsWith(`${FUNCTION_MOUNT_PATH}/`)) path = path.slice(FUNCTION_MOUNT_PATH.length);
  if (path.length === 0) path = '/';
  return path;
}

/** Parse the query parameters into the flat record the ApiRequest contract carries (last value wins on dupes). */
export function queryOf(rawUrl: string | undefined): Record<string, string> {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) return {};
  const query: Record<string, string> = {};
  for (const [key, value] of new URL(rawUrl, 'https://function.local').searchParams) {
    query[key] = value;
  }
  return query;
}

function firstHeader(request: FunctionRequest, name: string): string | undefined {
  const value = request.headers[name];
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.length > 0) return value[0];
  return undefined;
}

/** The JSON body: pre-parsed (@vercel/node), a string, or read from the stream. Typed failure — never a throw. */
export async function readJsonBody(
  request: FunctionRequest,
): Promise<{ readonly ok: true; readonly body: unknown } | { readonly ok: false; readonly code: 'invalid_json' }> {
  const parse = (text: string): { readonly ok: true; readonly body: unknown } | { readonly ok: false; readonly code: 'invalid_json' } => {
    if (text.trim().length === 0) return { ok: true, body: undefined };
    try {
      return { ok: true, body: JSON.parse(text) as unknown };
    } catch {
      return { ok: false, code: 'invalid_json' };
    }
  };
  if (request.body !== undefined && request.body !== null) {
    if (typeof request.body === 'string') return parse(request.body);
    if (Buffer.isBuffer(request.body)) return parse(request.body.toString('utf8'));
    return { ok: true, body: request.body };
  }
  if (typeof request[Symbol.asyncIterator] !== 'function') return { ok: true, body: undefined };
  const iterator = (request[Symbol.asyncIterator] as () => AsyncIterator<Buffer | string>).call(request);
  const chunks: string[] = [];
  let step = await iterator.next();
  while (step.done !== true) {
    const chunk = step.value;
    chunks.push(typeof chunk === 'string' ? chunk : chunk === undefined ? '' : Buffer.from(chunk).toString('utf8'));
    step = await iterator.next();
  }
  return parse(chunks.join(''));
}

/** The wrapped adaptation result: the ApiRequest, or the typed malformed-body failure. */
export type WrappedApiRequest =
  | { readonly ok: true; readonly request: ApiRequest }
  | { readonly ok: false; readonly code: 'invalid_json' };

/** Build the ApiRequest the T041 pipeline consumes (the path recovered, the headers forwarded — everything untrusted). */
export async function toApiRequest(request: FunctionRequest): Promise<WrappedApiRequest> {
  const method = (request.method ?? 'GET').toUpperCase();
  const headers: { authorization?: string; 'idempotency-key'?: string } = {};
  const authorization = firstHeader(request, 'authorization');
  if (authorization !== undefined) headers.authorization = authorization;
  const idempotencyKey = firstHeader(request, 'idempotency-key');
  if (idempotencyKey !== undefined) headers['idempotency-key'] = idempotencyKey;
  let body: unknown = undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed;
    body = parsed.body;
  }
  return {
    ok: true,
    request: {
      method,
      path: publicPathOf(request.url),
      headers,
      query: queryOf(request.url),
      body,
    },
  };
}

// ---------------------------------------------------------------------------
// The response adaptation (NO CORS — the same-origin law)
// ---------------------------------------------------------------------------

/** The headers the boundary emits (the envelope's own set — nothing added, nothing CORS). */
const RESPONSE_HEADERS = ['x-request-id', 'retry-after-ms', 'x-idempotent-replay', 'x-api-version'] as const;

/** Write the pipeline's ApiResponse out through the function's res. */
export function writeApiResponse(response: FunctionResponse, apiResponse: ApiResponse): void {
  response.statusCode = apiResponse.status;
  const headers = apiResponse.headers as Readonly<Record<string, string | undefined>>;
  for (const name of RESPONSE_HEADERS) {
    const value = headers[name];
    if (typeof value === 'string' && value.length > 0) response.setHeader(name, value);
  }
  if (apiResponse.body === null) {
    response.end();
    return;
  }
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.end(JSON.stringify(apiResponse.body));
}

/** The host-level degraded responses (the composition itself is not wired — R46, never a crash). */
export function writeDegraded(response: FunctionResponse, status: 400 | 503, code: string, message: string): void {
  response.statusCode = status;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  response.end(JSON.stringify({ error: { code, message } }));
}
