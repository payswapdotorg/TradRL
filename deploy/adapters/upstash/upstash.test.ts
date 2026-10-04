// deploy/adapters/upstash/upstash.test.ts — the Upstash adapter tests
// (T052, W-3b).
//
// ALL OFFLINE: a fake Redis behind an injected fetch speaking the REST
// wire format — NO live calls, NO real tokens (the vectors use FIXED
// FAKE values). What is pinned:
//   1. request-construction determinism (URL with URI-encoded args,
//      the Bearer header, the pipeline body bytes);
//   2. the idempotency semantics (T041's law: fresh/replay/conflict,
//      SET-NX atomicity, TTL window, the composite identity);
//   3. L12: tenant-prefixed keys — no cross-tenant replay, no cache
//      bleed, no keyspace smuggling;
//   4. R46 degradation: unreachable / HTTP / per-command error /
//      malformed body are typed failures — never a throw;
//   5. canonical-form parity with the REAL T041 primitives (test-only
//      import — the interop trip-wire precedent: the adapters'
//      hand-rolled canonicalJson/fnv produce the program-wide bytes).

import { describe, expect, it } from 'vitest';
import { canonicalJson as realCanonicalJson, fnv1a32Hex as realFnv1a32Hex } from '../../../services/api/src/primitives';
import { buildUpstashCommandRequest, buildUpstashPipelineRequest, executeUpstashCommand, executeUpstashPipeline, type UpstashConfig } from './client';
import { DEFAULT_IDEMPOTENCY_TTL_SECONDS, UpstashCache, UpstashIdempotencyStore, bodyFingerprintOf, cacheKeyOf, idempotencyComposite, idempotencyKeyOf } from './stores';
import { canonicalJson, fnv1a32Hex, type FetchLike } from '../shared';

// ---------------------------------------------------------------------------
// The fixed FAKE configuration (never a real token)
// ---------------------------------------------------------------------------

const FAKE_CONFIG: UpstashConfig = {
  url: 'https://tradrl-demo.upstash.io',
  token: 'fake-upstash-token-demo',
};

const instants = (() => {
  let cursor = 0;
  return { next: () => 1_800_300_000_000 + cursor++ };
})();

// ---------------------------------------------------------------------------
// The fake Redis (an in-memory responder over the REST wire format)
// ---------------------------------------------------------------------------

interface FakeRedisCall {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly command: readonly string[];
}

function fakeRedis(): { fetchLike: FetchLike; calls: FakeRedisCall[]; store: Map<string, string> } {
  const store = new Map<string, string>();
  const calls: FakeRedisCall[] = [];
  const responder = (text: string, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  });
  const runCommand = (command: readonly string[]): { result?: unknown; error?: string } => {
    const [name, ...args] = command;
    if (name === 'get') return { result: store.get(args[0] ?? '') ?? null };
    if (name === 'del') {
      const existed = store.delete(args[0] ?? '');
      return { result: existed ? 1 : 0 };
    }
    if (name === 'set') {
      const key = args[0] ?? '';
      const value = args[1] ?? '';
      const nxIndex = args.indexOf('NX');
      if (nxIndex !== -1) {
        if (store.has(key)) return { result: null }; // NX miss
        store.set(key, value);
        return { result: 'OK' };
      }
      store.set(key, value);
      return { result: 'OK' };
    }
    return { error: `ERR unknown command '${name ?? ''}'` };
  };
  const fetchLike: FetchLike = async (url, init) => {
    calls.push({ method: init?.method ?? 'GET', url, headers: init?.headers ?? {}, body: init?.body, command: [] });
    if ((init?.method ?? 'GET') === 'POST') {
      // The pipeline: POST {url}/pipeline with a JSON array of commands.
      expect(url.endsWith('/pipeline')).toBe(true);
      const commands = JSON.parse(typeof init?.body === 'string' ? init.body : '[]') as string[][];
      const call = calls[calls.length - 1];
      if (call === undefined) throw new Error('unreachable');
      (call as { command: readonly string[] }).command = ['pipeline', JSON.stringify(commands)];
      return responder(JSON.stringify(commands.map((command) => runCommand(command))));
    }
    // The single command: GET {url}/{command}/{args...}
    const path = url.slice(FAKE_CONFIG.url.length + 1);
    const parts = path.split('/').map((part) => decodeURIComponent(part));
    const call = calls[calls.length - 1];
    if (call === undefined) throw new Error('unreachable');
    (call as { command: readonly string[] }).command = parts;
    return responder(JSON.stringify(runCommand(parts)));
  };
  return { fetchLike, calls, store };
}

// ---------------------------------------------------------------------------
// 1. Request-construction determinism (pinned vectors — FAKE token)
// ---------------------------------------------------------------------------

describe('deploy/adapters/upstash — the client request determinism', () => {
  it('the single command is GET {url}/{command}/{args} with the Bearer token (pinned vector)', () => {
    const request = buildUpstashCommandRequest(FAKE_CONFIG, 'set', ['tradrl:cache:tenant-a:watch', '{"a":1}', 'EX', '60']);
    expect(request.method).toBe('GET');
    expect(request.url).toBe('https://tradrl-demo.upstash.io/set/tradrl%3Acache%3Atenant-a%3Awatch/%7B%22a%22%3A1%7D/EX/60');
    expect(request.headers.authorization).toBe('Bearer fake-upstash-token-demo');
  });

  it('the pipeline is POST {url}/pipeline with the JSON array body (pinned vector)', () => {
    const request = buildUpstashPipelineRequest(FAKE_CONFIG, [['set', 'k', 'v', 'EX', '5'], ['get', 'k']]);
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://tradrl-demo.upstash.io/pipeline');
    expect(request.headers.authorization).toBe('Bearer fake-upstash-token-demo');
    expect(request.headers['content-type']).toBe('application/json');
    expect(request.body).toBe('[["set","k","v","EX","5"],["get","k"]]');
  });

  it('a trailing slash in the URL is normalized (identical inputs -> identical bytes)', () => {
    expect(buildUpstashCommandRequest({ ...FAKE_CONFIG, url: 'https://tradrl-demo.upstash.io/' }, 'get', ['k']).url).toBe('https://tradrl-demo.upstash.io/get/k');
  });
});

// ---------------------------------------------------------------------------
// 2. The idempotency semantics (T041's law, durable + TTL-scoped)
// ---------------------------------------------------------------------------

describe('deploy/adapters/upstash — the idempotency store', () => {
  it('fresh -> complete -> replay (the SAME body replays the ORIGINAL response) -> conflict (a DIFFERENT body)', async () => {
    const fake = fakeRedis();
    const store = new UpstashIdempotencyStore({ config: FAKE_CONFIG, fetchLike: fake.fetchLike, instants });
    const body = { intent: 'buy', quantity: 10 };
    const first = await store.begin('tenant-a', 'dev:abc123', '/v1/execution/requests', 'idem-1', body);
    expect(first.kind).toBe('fresh');
    const committed = await store.complete('tenant-a', 'dev:abc123', '/v1/execution/requests', 'idem-1', body, 200, { ok: true });
    expect(committed.ok).toBe(true);
    if (committed.ok) expect(committed.value.committed).toBe(true);
    const replay = await store.begin('tenant-a', 'dev:abc123', '/v1/execution/requests', 'idem-1', body);
    expect(replay.kind).toBe('replay');
    if (replay.kind === 'replay') {
      expect(replay.entry.responseStatus).toBe(200);
      expect(replay.entry.responseBody).toEqual({ ok: true });
      expect(replay.entry.bodyFingerprint).toBe(bodyFingerprintOf(body));
    }
    const conflict = await store.begin('tenant-a', 'dev:abc123', '/v1/execution/requests', 'idem-1', { intent: 'buy', quantity: 99 });
    expect(conflict.kind).toBe('conflict');
    const lateCommit = await store.complete('tenant-a', 'dev:abc123', '/v1/execution/requests', 'idem-1', { intent: 'buy', quantity: 99 }, 200, { ok: true });
    expect(lateCommit.ok).toBe(false);
    if (!lateCommit.ok) expect(lateCommit.error.code).toBe('idempotency_conflict');
  });

  it('the commit is SET-with-EX-and-NX (the atomic set-if-absent + the TTL window)', async () => {
    const fake = fakeRedis();
    const store = new UpstashIdempotencyStore({ config: FAKE_CONFIG, fetchLike: fake.fetchLike, instants });
    await store.complete('tenant-a', 'dev:abc', '/v1/jobs/research', 'idem-2', { q: 1 }, 201, { jobId: 'job:1' });
    const setCall = fake.calls.find((call) => call.command[0] === 'set');
    expect(setCall).toBeDefined();
    if (setCall === undefined) return;
    expect(setCall.command.slice(-3)).toEqual(['EX', String(DEFAULT_IDEMPOTENCY_TTL_SECONDS), 'NX']);
    expect(setCall.command[1]).toBe(idempotencyKeyOf('tenant-a', 'dev:abc', '/v1/jobs/research', 'idem-2'));
    // A custom TTL is honored.
    await store.complete('tenant-a', 'dev:abc', '/v1/jobs/research', 'idem-3', { q: 2 }, 201, {}, { ttlSeconds: 60 });
    const custom = fake.calls.filter((call) => call.command[0] === 'set').pop();
    expect(custom?.command.slice(-3)).toEqual(['EX', '60', 'NX']);
  });

  it('the composite identity is T041\'s composite (credential + route + key, canonicalized)', () => {
    expect(idempotencyComposite('dev:abc', '/v1/execution/requests', 'idem-1')).toBe('["dev:abc","/v1/execution/requests","idem-1"]');
    // Different route OR different key OR different credential -> different composite -> different Redis key.
    expect(idempotencyKeyOf('tenant-a', 'dev:abc', '/v1/execution/requests', 'idem-1')).not.toBe(idempotencyKeyOf('tenant-a', 'dev:abc', '/v1/jobs/research', 'idem-1'));
    expect(idempotencyKeyOf('tenant-a', 'dev:abc', '/v1/execution/requests', 'idem-1')).not.toBe(idempotencyKeyOf('tenant-a', 'dev:other', '/v1/execution/requests', 'idem-1'));
  });

  it('L12: the SAME composite under TWO tenants occupies DIFFERENT keys — no cross-tenant replay', async () => {
    const fake = fakeRedis();
    const store = new UpstashIdempotencyStore({ config: FAKE_CONFIG, fetchLike: fake.fetchLike, instants });
    const body = { a: 1 };
    expect(idempotencyKeyOf('tenant-a', 'dev:abc', '/v1/execution/requests', 'idem-1')).not.toBe(idempotencyKeyOf('tenant-b', 'dev:abc', '/v1/execution/requests', 'idem-1'));
    await store.complete('tenant-a', 'dev:abc', '/v1/execution/requests', 'idem-1', body, 200, { who: 'a' });
    // Tenant B uses the SAME credential id + route + key + body: FRESH (its own keyspace).
    const foreign = await store.begin('tenant-b', 'dev:abc', '/v1/execution/requests', 'idem-1', body);
    expect(foreign.kind).toBe('fresh');
    expect(await store.has('tenant-a', 'dev:abc', '/v1/execution/requests', 'idem-1')).toEqual({ ok: true, value: true });
    expect(await store.has('tenant-b', 'dev:abc', '/v1/execution/requests', 'idem-1')).toEqual({ ok: true, value: false });
  });
});

// ---------------------------------------------------------------------------
// 3. The tenant-scoped cache (L12)
// ---------------------------------------------------------------------------

describe('deploy/adapters/upstash — the tenant-scoped cache', () => {
  it('set -> get round-trips; a foreign tenant reads NOTHING (no cache bleed)', async () => {
    const fake = fakeRedis();
    const cache = new UpstashCache({ config: FAKE_CONFIG, fetchLike: fake.fetchLike, instants });
    expect((await cache.set('tenant-a', 'watch', { cursor: 'cur:1' }, 60)).ok).toBe(true);
    expect(await cache.get('tenant-a', 'watch')).toEqual({ ok: true, value: { cursor: 'cur:1' } });
    expect(await cache.get('tenant-b', 'watch')).toEqual({ ok: true, value: null });
    expect((await cache.delete('tenant-a', 'watch')).ok).toBe(true);
    expect(await cache.get('tenant-a', 'watch')).toEqual({ ok: true, value: null });
  });

  it('the cache key is the server-side tenant prefix (pinned); names outside the charset are refused', () => {
    expect(cacheKeyOf('tenant-a', 'watch:cursor')).toEqual({ ok: true, value: 'tradrl:cache:tenant-a:watch:cursor' });
    // Keyspace smuggling attempts: spaces, slashes, traversal — typed refusal, never a key.
    for (const hostile of ['../escape', 'name with space', 'name\nnewline', '']) {
      const result = cacheKeyOf('tenant-a', hostile);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('invalid_cache_name');
    }
    // The name can never manufacture another tenant's prefix: the prefix is fixed.
    expect(cacheKeyOf('tenant-a', 'tenant-b:secret')).toEqual({ ok: true, value: 'tradrl:cache:tenant-a:tenant-b:secret' });
  });

  it('an invalid TTL is the typed refusal', async () => {
    const fake = fakeRedis();
    const cache = new UpstashCache({ config: FAKE_CONFIG, fetchLike: fake.fetchLike, instants });
    const result = await cache.set('tenant-a', 'watch', { x: 1 }, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_cache_ttl');
  });
});

// ---------------------------------------------------------------------------
// 4. R46 degradation (typed failures — never a throw)
// ---------------------------------------------------------------------------

describe('deploy/adapters/upstash — R46 graceful degradation', () => {
  const failingFetch: FetchLike = async () => {
    throw new Error('connection refused (simulated)');
  };

  it('an unreachable provider is the typed upstash_unreachable — the idempotency check reports degraded', async () => {
    const store = new UpstashIdempotencyStore({ config: FAKE_CONFIG, fetchLike: failingFetch, instants });
    const verdict = await store.begin('tenant-a', 'dev:abc', '/v1/execution/requests', 'idem-1', { a: 1 });
    expect(verdict.kind).toBe('degraded');
    if (verdict.kind === 'degraded') expect(verdict.error.code).toBe('upstash_unreachable');
    const cache = new UpstashCache({ config: FAKE_CONFIG, fetchLike: failingFetch, instants });
    const got = await cache.get('tenant-a', 'watch');
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.error.code).toBe('upstash_unreachable');
    expect(store.lastProvenance()?.outcome).toBe('degraded');
  });

  it('an HTTP 500 is the typed upstash_http_error; a per-command error envelope is the typed upstash_error', async () => {
    const http500: FetchLike = async () => ({ ok: false, status: 500, text: async () => 'internal error' });
    const result = await executeUpstashCommand(FAKE_CONFIG, 'get', ['k'], http500);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('upstash_http_error');
    const commandError: FetchLike = async () => ({ ok: true, status: 200, text: async () => '{"error":"ERR wrong number of arguments"}' });
    const refused = await executeUpstashCommand(FAKE_CONFIG, 'get', ['k'], commandError);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.code).toBe('upstash_error');
    expect(refused.error.message).toContain('wrong number of arguments');
  });

  it('a malformed body is the typed upstash_malformed_response; a pipeline sub-error fails the whole pipeline (fail-closed)', async () => {
    const garbage: FetchLike = async () => ({ ok: true, status: 200, text: async () => '<html>not json</html>' });
    const malformed = await executeUpstashCommand(FAKE_CONFIG, 'get', ['k'], garbage);
    expect(malformed.ok).toBe(false);
    if (malformed.ok) return;
    expect(malformed.error.code).toBe('upstash_malformed_response');
    const subError: FetchLike = async () => ({ ok: true, status: 200, text: async () => '[{"result":"OK"},{"error":"ERR bad arg"}]' });
    const pipelined = await executeUpstashPipeline(FAKE_CONFIG, [['set', 'k', 'v'], ['get', 'k']], subError);
    expect(pipelined.ok).toBe(false);
    if (pipelined.ok) return;
    expect(pipelined.error.code).toBe('upstash_error');
  });

  it('a working pipeline returns every sub-result in order', async () => {
    const fake = fakeRedis();
    const result = await executeUpstashPipeline(FAKE_CONFIG, [['set', 'k1', 'v1'], ['get', 'k1'], ['get', 'missing']], fake.fetchLike);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(['OK', 'v1', null]);
  });
});

// ---------------------------------------------------------------------------
// 5. Canonical-form parity with the REAL T041 primitives (trip-wire)
// ---------------------------------------------------------------------------

describe('deploy/adapters/upstash — the canonical-form parity (the T041 interop trip-wire)', () => {
  it('the hand-rolled canonicalJson produces the REAL canonical bytes on the battery', () => {
    const battery: readonly unknown[] = [
      null,
      true,
      42,
      'plain',
      [],
      {},
      { b: 1, a: 2 },
      { z: { y: [1, 'two', false, null], x: {} }, a: 'deep' },
      { unicode: 'é☃', escape: 'quote"back\\slash' },
    ];
    for (const value of battery) {
      expect(canonicalJson(value as never)).toBe(realCanonicalJson(value as never));
    }
  });

  it('the hand-rolled fnv1a32Hex produces the REAL digests (pinned: the empty string is the offset basis)', () => {
    expect(fnv1a32Hex('')).toBe('811c9dc5');
    for (const text of ['', 'a', 'tradrl', '["dev:abc","/v1/execution/requests","idem-1"]', '{"a":1,"b":[2,3]}']) {
      expect(fnv1a32Hex(text)).toBe(realFnv1a32Hex(text));
    }
  });

  it('the body fingerprint matches T041\'s form (fnv of the canonical body; non-JSON bodies fingerprint as null)', () => {
    expect(bodyFingerprintOf({ a: 1, b: 2 })).toBe(realFnv1a32Hex(realCanonicalJson({ b: 2, a: 1 } as never)));
    expect(bodyFingerprintOf(undefined)).toBe(realFnv1a32Hex('null'));
  });
});
