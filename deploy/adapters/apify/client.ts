// deploy/adapters/apify/client.ts — the hand-authored ZERO-DEP Apify
// client (data-ingestion job runs).
//
// THE WIRE (Apify's REST v2 — reimplemented on fetch, no npm):
//   POST https://api.apify.com/v2/acts/{actorId}/runs
//        Authorization: Bearer <APIFY_API_TOKEN>
//        {"input": {...}, "contentType": "application/json"}
//        -> 201 {"data": {"id": "<runId>", "status": "CREATED", ...}}
//   GET  https://api.apify.com/v2/actor-runs/{runId}
//        -> 200 {"data": {"id": ..., "status": "SUCCEEDED", ...}}
//   GET  https://api.apify.com/v2/datasets/{datasetId}/items
//        -> 200 [ {...}, ... ]
//
// DETERMINISM (L9): buildApify* functions are pure — fixed vectors in
// apify.test.ts use a FIXED FAKE token (no live calls, no real
// secrets). DEGRADATION (R46): unreachable / HTTP / malformed are the
// typed ApifyFailure — never a throw.
//
// Spec anchors: D-033 (Apify is the ingestion-job provider), R46.

import { parseJsonText, type FetchLike } from '../shared';

// ---------------------------------------------------------------------------
// The configuration (environment-sourced — never hardcoded)
// ---------------------------------------------------------------------------

/** The Apify client configuration. */
export interface ApifyConfig {
  /** The API token (a secret — never logged, never in error messages). */
  readonly apiToken: string;
  /** The REST base (default https://api.apify.com — overridable for tests). */
  readonly baseUrl?: string;
}

// ---------------------------------------------------------------------------
// The typed failures (R46 — never a throw)
// ---------------------------------------------------------------------------

/** One typed Apify client failure. */
export interface ApifyFailure {
  readonly code: 'apify_unreachable' | 'apify_http_error' | 'apify_malformed_response';
  readonly message: string;
}

/** The widened result. */
export type ApifyResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ApifyFailure };

/** An actor run's status (the subset the job machinery consumes). */
export type ApifyRunStatus = 'CREATED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'ABORTED' | 'TIMED_OUT';

/** One actor run (the wire's data envelope, subset). */
export interface ApifyRun {
  readonly id: string;
  readonly status: ApifyRunStatus;
  readonly datasetId?: string;
}

// ---------------------------------------------------------------------------
// The request construction (pure — the determinism surface)
// ---------------------------------------------------------------------------

/** One fully-built request (the pinned-vector surface — FAKE tokens in tests only). */
export interface BuiltApifyRequest {
  readonly method: 'GET' | 'POST';
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

function baseOf(config: ApifyConfig): string {
  return (config.baseUrl ?? 'https://api.apify.com').replace(/\/$/, '');
}

/** The start-actor-run request (pure). */
export function buildStartRunRequest(config: ApifyConfig, actorId: string, input: Readonly<Record<string, unknown>>): BuiltApifyRequest {
  return {
    method: 'POST',
    url: `${baseOf(config)}/v2/acts/${encodeURIComponent(actorId)}/runs`,
    headers: {
      authorization: `Bearer ${config.apiToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ input, contentType: 'application/json' }),
  };
}

/** The run-status request (pure). */
export function buildRunStatusRequest(config: ApifyConfig, runId: string): BuiltApifyRequest {
  return {
    method: 'GET',
    url: `${baseOf(config)}/v2/actor-runs/${encodeURIComponent(runId)}`,
    headers: { authorization: `Bearer ${config.apiToken}` },
  };
}

/** The dataset-items request (pure). */
export function buildDatasetItemsRequest(config: ApifyConfig, datasetId: string): BuiltApifyRequest {
  return {
    method: 'GET',
    url: `${baseOf(config)}/v2/datasets/${encodeURIComponent(datasetId)}/items`,
    headers: { authorization: `Bearer ${config.apiToken}` },
  };
}

// ---------------------------------------------------------------------------
// The execution (injected fetch; typed degradation on every path)
// ---------------------------------------------------------------------------

async function fetchApify(fetchLike: FetchLike, request: BuiltApifyRequest): Promise<ApifyResult<unknown>> {
  try {
    const response = await fetchLike(request.url, { method: request.method, headers: request.headers, body: request.body });
    let text: string;
    try {
      text = await response.text();
    } catch (cause) {
      return { ok: false, error: { code: 'apify_unreachable', message: `the Apify response body could not be read (${String(cause)})` } };
    }
    if (!response.ok) {
      return { ok: false, error: { code: 'apify_http_error', message: `Apify answered ${response.status}: ${text.slice(0, 200)}` } };
    }
    const parsed = parseJsonText(text);
    if (!parsed.ok) return { ok: false, error: { code: 'apify_malformed_response', message: 'the Apify response body is not valid JSON' } };
    return { ok: true, value: parsed.value };
  } catch (cause) {
    return { ok: false, error: { code: 'apify_unreachable', message: `the Apify endpoint could not be reached (${String(cause)})` } };
  }
}

/** Start one actor run (the value: the run's id + status). */
export async function startActorRun(config: ApifyConfig, actorId: string, input: Readonly<Record<string, unknown>>, fetchLike: FetchLike): Promise<ApifyResult<ApifyRun>> {
  const fetched = await fetchApify(fetchLike, buildStartRunRequest(config, actorId, input));
  if (!fetched.ok) return fetched;
  const data = (fetched.value as { data?: unknown }).data;
  const id = (data as { id?: unknown } | undefined)?.id;
  const status = (data as { status?: unknown } | undefined)?.status;
  if (typeof id !== 'string' || typeof status !== 'string') {
    return { ok: false, error: { code: 'apify_malformed_response', message: 'the run envelope lacks id/status' } };
  }
  return { ok: true, value: { id, status: status as ApifyRunStatus, datasetId: typeof (data as { defaultDatasetId?: unknown }).defaultDatasetId === 'string' ? (data as { defaultDatasetId: string }).defaultDatasetId : undefined } };
}

/** Read one run's status. */
export async function getActorRunStatus(config: ApifyConfig, runId: string, fetchLike: FetchLike): Promise<ApifyResult<ApifyRun>> {
  const fetched = await fetchApify(fetchLike, buildRunStatusRequest(config, runId));
  if (!fetched.ok) return fetched;
  const data = (fetched.value as { data?: unknown }).data;
  const id = (data as { id?: unknown } | undefined)?.id;
  const status = (data as { status?: unknown } | undefined)?.status;
  if (typeof id !== 'string' || typeof status !== 'string') {
    return { ok: false, error: { code: 'apify_malformed_response', message: 'the run envelope lacks id/status' } };
  }
  return { ok: true, value: { id, status: status as ApifyRunStatus, datasetId: typeof (data as { defaultDatasetId?: unknown }).defaultDatasetId === 'string' ? (data as { defaultDatasetId: string }).defaultDatasetId : undefined } };
}

/** Read one dataset's items (the value: the raw items array). */
export async function getDatasetItems(config: ApifyConfig, datasetId: string, fetchLike: FetchLike): Promise<ApifyResult<readonly unknown[]>> {
  const fetched = await fetchApify(fetchLike, buildDatasetItemsRequest(config, datasetId));
  if (!fetched.ok) return fetched;
  if (!Array.isArray(fetched.value)) {
    return { ok: false, error: { code: 'apify_malformed_response', message: 'the dataset items body is not an array' } };
  }
  return { ok: true, value: fetched.value as readonly unknown[] };
}
