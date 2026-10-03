/**
 * @tradrl/api-service — tiny test-only helpers shared by the suite
 * (kept out of fixtures.ts so the fixtures stay scenario-shaped).
 */

import type { ApiResponse } from './contracts';

/** Type guard: a success envelope body. */
export function isApiSuccessBody(v: unknown): v is { readonly requestId: string; readonly data: unknown } {
  return typeof v === 'object' && v !== null && 'data' in (v as Record<string, unknown>) && 'requestId' in (v as Record<string, unknown>);
}

/** Assert helper: the response is a 2xx success envelope. */
export function assertSuccess(response: ApiResponse): { readonly requestId: string; readonly data: unknown } {
  if (response.status < 200 || response.status >= 300 || response.body === null || !('data' in response.body)) {
    throw new Error(`expected a 2xx success envelope, got ${JSON.stringify({ status: response.status, body: response.body })}`);
  }
  return response.body as { requestId: string; data: unknown };
}
