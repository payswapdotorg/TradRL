// @tradrl/sdk — the injectable transport.
//
// THE ZERO-DEPENDENCY LAW (Work Order): "an injectable transport (a
// fetch-compatible interface injected by the caller; NO transport
// implementation shipped — zero-dep law + deterministic tests)". This
// module ships the INTERFACE (and its guards) ONLY: the caller binds
// it to fetch, axios, a test double, an in-process router — anything
// shaped like it. The SDK never imports node:http, never opens
// sockets, never guesses a base URL's shape: the path is the
// boundary's route contract (`/v1/...`), and turning it into a URL is
// the TRANSPORT's business, not the SDK's.
//
// The shape is deliberately fetch-adjacent: one async `request`
// taking a method/path/headers/body triple and returning a
// status/headers/body triple. Adapting global `fetch`:
//
//   const transport: ApiTransport = {
//     async request(req) {
//       const response = await fetch(new URL(req.path, baseUrl), {
//         method: req.method,
//         headers: { ...req.headers, ...(req.body === undefined ? {} : { 'content-type': 'application/json' }) },
//         body: req.body === undefined ? undefined : JSON.stringify(req.body),
//       });
//       return {
//         status: response.status,
//         headers: Object.fromEntries(response.headers),
//         body: await response.json().catch(() => null),
//       };
//     },
//   };
//
// Spec anchors: R43 (developer API/SDK), R29 (provider-neutral
// shapes), L20 (the transport is the caller's security boundary).

// ---------------------------------------------------------------------------
// The wire shapes (the SDK-side mirrors of the service's envelope)
// ---------------------------------------------------------------------------

/** One request the SDK sends through the transport. */
export interface SdkRequest {
  readonly method: 'GET' | 'POST' | 'DELETE' | 'PUT' | 'PATCH';
  /** The boundary's route path (`/v1/...`) — version-prefixed by the SDK. */
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
 * Injected by the caller at client construction; the SDK ships NO
 * implementation (deterministic tests script their own).
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

/** The retry-relevant view of a transport failure: the SDK treats thrown transports as retryable unavailability. */
export class TransportUnavailableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'TransportUnavailableError';
  }
}
