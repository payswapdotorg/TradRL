// @tradrl/web-console — the SDK mirror: the injectable transport.
//
// THE LAW (Work Order T042): the console drives the mirrored client
// "through an injected transport adapter". This module mirrors
// packages/sdk/src/transport.ts (the fetch-adjacent wire shapes —
// same names, same shapes, never imported) and ships the ONE
// transport adapter the console owns: the BROWSER FETCH binding
// (DOM APIs only — fetch, URL; zero runtime dependencies). Tests
// inject scripted transports; the app injects this one.
//
// Spec anchors: R43, R29, L20 (the transport is the console's first
// hop into the trust zone chain — spec/SECURITY.md Browser ->
// control plane).

/** One request the console sends through the transport. */
export interface SdkRequest {
  readonly method: 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH';
  /** The boundary's route path (`/v1/...`) — version-prefixed by the client. */
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  /** The JSON body (undefined for body-less requests). */
  readonly body?: unknown;
}

/** One response the transport returns. */
export interface SdkResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  /** The parsed JSON body (null when the body is absent/unparseable). */
  readonly body: unknown;
}

/**
 * THE INJECTABLE TRANSPORT: a fetch-compatible request function.
 * The console's client mirror is constructed with one; the browser
 * binding below is the production adapter, tests script their own.
 */
export type ApiTransport = (request: SdkRequest) => Promise<SdkResponse>;

/** Guard: a well-formed transport response (structural — the transport is untrusted too). */
export function isSdkResponse(v: unknown): v is SdkResponse {
  if (typeof v !== 'object' || v === null) return false;
  const candidate = v as Record<string, unknown>;
  if (typeof candidate.status !== 'number' || !Number.isInteger(candidate.status) || candidate.status < 100 || candidate.status > 599) return false;
  if (typeof candidate.headers !== 'object' || candidate.headers === null) return false;
  return true;
}

/** The retry-relevant view of a transport failure: the client treats thrown transports as retryable unavailability. */
export class TransportUnavailableError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'TransportUnavailableError';
    if (cause !== undefined) this.cause = cause;
  }
}

/** The fetch-like function shape the browser adapter binds (the DOM fetch signature subset the adapter uses). */
export type FetchLike = (input: string, init: { readonly method: string; readonly headers: Readonly<Record<string, string>>; readonly body?: string }) => Promise<{
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly text: () => Promise<string>;
}>;

/**
 * The browser transport adapter: binds a fetch-like function and a
 * base URL to the injected-transport interface. THE console's
 * production first hop: every request goes out as JSON, every
 * response comes back as the mirrored wire triple. A network failure
 * throws (the client mirror maps it to the unavailable family —
 * graceful degradation, never a crash).
 */
export function createFetchTransport(baseUrl: string, fetchLike?: FetchLike): ApiTransport {
  const doFetch: FetchLike = fetchLike ?? (globalThis.fetch as unknown as FetchLike);
  return async (request) => {
    const url = new URL(request.path, baseUrl).toString();
    const headers: Record<string, string> = { ...request.headers };
    let body: string | undefined;
    if (request.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(request.body);
    }
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await doFetch(url, { method: request.method, headers, ...(body === undefined ? {} : { body }) });
    } catch (cause) {
      // The cast lives OUTSIDE the template interpolation (the erasable-subset law:
      // no type syntax inside template-literal interpolations — hoist first).
      const causeError = cause as Error;
      throw new TransportUnavailableError(`the console's transport failed to reach ${url}: ${causeError?.message ?? String(cause)}`, cause);
    }
    const responseHeaders: Record<string, string> = {};
    for (const name of ['x-request-id', 'retry-after-ms', 'x-idempotent-replay', 'x-api-version']) {
      const value = response.headers.get(name);
      if (value !== null) responseHeaders[name] = value;
    }
    const text = await response.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    return { status: response.status, headers: responseHeaders, body: parsed };
  };
}
