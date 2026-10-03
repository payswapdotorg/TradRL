/**
 * @tradrl/sdk — the retry/backoff tests: exponential growth with the
 * cap; the server's retry signal honored when LARGER (never shorter);
 * terminal 4xx families never retried; the max-attempts law; and the
 * retry-safety of consequential calls (ONE idempotency key across
 * every attempt — the boundary dedupes, so a retry after a timeout
 * can never double-execute).
 */

import { describe, expect, it } from 'vitest';

import { createTradRLClient } from './client';
import type { SdkRequest, SdkResponse } from './transport';
import { ApiSdkError, RateLimitError, ValidationError, isRetryable } from './errors';
import { DEFAULT_RETRY_POLICY, retryDelayMs, withRetry } from './retry';

function response(status: number, body: unknown): SdkResponse {
  return { status, headers: {}, body };
}

describe('retryDelayMs (the pure computation)', () => {
  const policy = { maxAttempts: 5, initialDelayMs: 100, maxDelayMs: 1_000, backoffMultiplier: 2 };

  it('grows exponentially from the initial delay', () => {
    expect(retryDelayMs(policy, 2)).toBe(100);
    expect(retryDelayMs(policy, 3)).toBe(200);
    expect(retryDelayMs(policy, 4)).toBe(400);
    expect(retryDelayMs(policy, 5)).toBe(800);
  });

  it('caps at maxDelayMs', () => {
    expect(retryDelayMs(policy, 9)).toBe(1_000);
    expect(retryDelayMs(policy, 20)).toBe(1_000);
  });

  it('honors the server signal when LARGER (never shorter)', () => {
    expect(retryDelayMs(policy, 2, 5_000)).toBe(5_000);
    expect(retryDelayMs(policy, 4, 50)).toBe(400); // the computed backoff is larger.
  });

  it('ignores the server signal when respectRetryAfter is false', () => {
    expect(retryDelayMs({ ...policy, respectRetryAfter: false }, 2, 5_000)).toBe(100);
  });

  it('the default policy is well-formed', () => {
    expect(DEFAULT_RETRY_POLICY.maxAttempts).toBe(4);
    expect(DEFAULT_RETRY_POLICY.respectRetryAfter).toBe(true);
  });
});

describe('withRetry (the execution discipline)', () => {
  it('retries a retryable error until success, sleeping the computed delays', async () => {
    const delays: number[] = [];
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new RateLimitError(new ApiSdkError('rate_limited', 'over budget', 429, { retryAfterMs: 777 }));
        return 'done';
      },
      { maxAttempts: 4, initialDelayMs: 100, maxDelayMs: 1_000, backoffMultiplier: 2 },
      { sleep: async (delay) => { delays.push(delay); }, isRetryable: (error) => error instanceof ApiSdkError && isRetryable(error) },
    );
    expect(result).toBe('done');
    expect(attempts).toBe(3);
    // Attempt 2's delay: max(100, 777) = 777 (the server signal); attempt 3's: max(200, 777) = 777.
    expect(delays).toEqual([777, 777]);
  });

  it('NEVER retries a terminal 4xx family', async () => {
    let attempts = 0;
    await expect(withRetry(
      async () => {
        attempts += 1;
        throw new ValidationError(new ApiSdkError('validation_failed', 'bad', 400));
      },
      { maxAttempts: 5, initialDelayMs: 1, maxDelayMs: 1, backoffMultiplier: 1 },
      { sleep: async () => { throw new Error('must not sleep'); }, isRetryable: (error) => error instanceof ApiSdkError && isRetryable(error) },
    )).rejects.toMatchObject({ code: 'validation_failed' });
    expect(attempts).toBe(1);
  });

  it('gives up at maxAttempts, surfacing the last error', async () => {
    let attempts = 0;
    await expect(withRetry(
      async () => {
        attempts += 1;
        throw new ApiSdkError('unavailable', 'down', 503);
      },
      { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 1, backoffMultiplier: 1 },
      { sleep: async () => {}, isRetryable: () => true },
    )).rejects.toMatchObject({ code: 'unavailable' });
    expect(attempts).toBe(3);
  });
});

describe('the client retry integration (rate-limit awareness through the transport)', () => {
  it('a 429 with a retry signal is retried after the signaled delay, then succeeds', async () => {
    const delays: number[] = [];
    let calls = 0;
    const transport = async (request: SdkRequest): Promise<SdkResponse> => {
      void request;
      calls += 1;
      if (calls === 1) return response(429, { requestId: 'req:1', error: { code: 'rate_limited', message: 'over budget', status: 429, retryAfterMs: 555 } });
      return response(200, { requestId: 'req:2', data: { apiVersion: 'v1', supportedVersions: ['v1'], routeFamilies: [] } });
    };
    const client = createTradRLClient({
      transport,
      token: 'tok',
      skipNegotiation: true,
      sleep: async (delay) => { delays.push(delay); },
    });
    const meta = await client.meta();
    expect(meta.apiVersion).toBe('v1');
    expect(calls).toBe(2);
    expect(delays).toEqual([555]); // the server's signal, honored through the injected transport.
  });

  it('a consequential call retries with the SAME idempotency key (never double-execute)', async () => {
    const keys: string[] = [];
    let calls = 0;
    const transport = async (request: SdkRequest): Promise<SdkResponse> => {
      if (request.path === '/v1/meta') return response(200, { requestId: 'r', data: { apiVersion: 'v1', supportedVersions: ['v1'], routeFamilies: [] } });
      calls += 1;
      keys.push(request.headers['idempotency-key'] ?? '');
      if (calls < 3) {
        // A timeout-ish failure: the transport throws (unavailable family, retryable).
        throw new Error('socket hang up');
      }
      return response(200, { requestId: 'r', data: { jobId: 'job:0123abcd', kind: 'research', tenant: 't', project: 'p', status: 'submitted', submittedAt: 1 } });
    };
    const client = createTradRLClient({ transport, token: 'tok', sleep: async () => {} });
    const job = await client.jobs.submitResearch({ projectId: 'p', spec: { q: 'x' } });
    expect(job.status).toBe('submitted');
    expect(calls).toBe(3);
    // ONE key across every attempt.
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toMatch(/^idem:[0-9a-f]{8}$/);
  });

  it('a terminal error surfaces immediately (no retry, no sleep)', async () => {
    const delays: number[] = [];
    let calls = 0;
    const transport = async (request: SdkRequest): Promise<SdkResponse> => {
      if (request.path === '/v1/meta') return response(200, { requestId: 'r', data: { apiVersion: 'v1', supportedVersions: ['v1'], routeFamilies: [] } });
      calls += 1;
      return response(403, { requestId: 'r', error: { code: 'forbidden', message: 'no permission', status: 403 } });
    };
    const client = createTradRLClient({ transport, token: 'tok', sleep: async (delay) => { delays.push(delay); } });
    await expect(client.execution.submitRequest({ intentId: 'si:1' } as never)).rejects.toMatchObject({ code: 'forbidden' });
    expect(calls).toBe(1);
    expect(delays).toEqual([]);
  });
});
