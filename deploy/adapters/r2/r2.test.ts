// deploy/adapters/r2/r2.test.ts — the R2 adapter tests (T052, W-3c).
//
// ALL OFFLINE: a fake S3-compatible responder behind an injected fetch
// — NO live calls, NO real credentials (the vectors use FIXED FAKE
// values). What is pinned:
//   1. SigV4 determinism: byte-exact canonical requests, string-to-sign
//      shape, the signing-key derivation structure, the Authorization
//      header form — under FIXED fake credentials + fixed instants;
//   2. L12: every object key is tenant-prefixed BY CONSTRUCTION; a
//      foreign tenant's digest reads not-found (indistinguishable);
//      hostile tenant strings stay in the key namespace (no path escape);
//   3. R46: unreachable / HTTP error / 404 are typed failures — never
//      a throw;
//   4. content addressing: identical bytes -> identical key.

import { describe, expect, it } from 'vitest';
import { amzDateOf, canonicalQueryStringOf, dateStampOf, r2EndpointOf, rfc3986Encode, signR2Request, type SigV4Credentials } from './sigv4';
import { R2EvidenceStore, bucketPathOf, evidenceKeyOf } from './store';
import type { FetchLike } from '../shared';

// ---------------------------------------------------------------------------
// The fixed FAKE credentials (never real)
// ---------------------------------------------------------------------------

const FAKE_CREDENTIALS: SigV4Credentials = {
  accessKeyId: 'AKIDFAKEFAKEFAKEFAKE',
  secretAccessKey: 'fake-secret-access-key-demo-not-real',
  accountId: 'demo-account-id',
};

const FIXED_AT = Date.UTC(2026, 9, 4, 12, 0, 0); // 2026-10-04T12:00:00Z

// ---------------------------------------------------------------------------
// 1. SigV4 determinism (pinned vectors)
// ---------------------------------------------------------------------------

describe('deploy/adapters/r2 — SigV4 request determinism', () => {
  it('the amz-date + scope-date forms (pinned)', () => {
    expect(amzDateOf(FIXED_AT)).toBe('20261004T120000Z');
    expect(dateStampOf(FIXED_AT)).toBe('20261004');
  });

  it('RFC3986 encoding: the unreserved set stays, everything else percent-encodes uppercase (pinned)', () => {
    expect(rfc3986Encode('tradrl')).toBe('tradrl');
    expect(rfc3986Encode('a-b.c_d~e')).toBe('a-b.c_d~e');
    expect(rfc3986Encode('a/b')).toBe('a%2Fb');
    expect(rfc3986Encode('a b+c=d')).toBe('a%20b%2Bc%3Dd');
    expect(rfc3986Encode('é')).toBe('%C3%A9');
  });

  it('the canonical query string: RFC3986 pairs, name-sorted (pinned)', () => {
    expect(canonicalQueryStringOf({ 'list-type': '2', 'max-keys': '100' })).toBe('list-type=2&max-keys=100');
    expect(canonicalQueryStringOf({ b: '2', a: '1' })).toBe('a=1&b=2');
    expect(canonicalQueryStringOf({ a: 'x/y' })).toBe('a=x%2Fy'); // values encode RFC3986-style
    expect(canonicalQueryStringOf({})).toBe('');
  });

  it('the CANONICAL REQUEST is byte-pinned (fixed fake credentials + fixed instant)', () => {
    const signed = signR2Request(FAKE_CREDENTIALS, {
      method: 'PUT',
      uri: '/demo-bucket/tradrl/evidence/tenant-a/abc123.json',
      body: '{"evidence":"payload"}',
      at: FIXED_AT,
    });
    const expectedCanonicalRequest = [
      'PUT',
      '/demo-bucket/tradrl/evidence/tenant-a/abc123.json',
      '',
      'host:demo-account-id.r2.cloudflarestorage.com\n' + 'x-amz-content-sha256:' + signed.headers['x-amz-content-sha256'] + '\n' + 'x-amz-date:20261004T120000Z\n',
      'host;x-amz-content-sha256;x-amz-date',
      signed.headers['x-amz-content-sha256'],
    ].join('\n');
    expect(signed.canonicalRequest).toBe(expectedCanonicalRequest);
    expect(signed.signedHeaders).toBe('host;x-amz-content-sha256;x-amz-date');
    expect(signed.credentialScope).toBe('20261004/auto/s3/aws4_request');
    expect(signed.stringToSign.startsWith('AWS4-HMAC-SHA256\n20261004T120000Z\n20261004/auto/s3/aws4_request\n')).toBe(true);
  });

  it('the payload hash is the real sha256 (never UNSIGNED-PAYLOAD)', () => {
    const signed = signR2Request(FAKE_CREDENTIALS, { method: 'GET', uri: '/b/k', at: FIXED_AT });
    expect(signed.headers['x-amz-content-sha256']).toBe(
      // sha256 of the empty string — the published constant.
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('the Authorization header carries the credential scope + the signature (shape pinned, bytes stable)', () => {
    const a = signR2Request(FAKE_CREDENTIALS, { method: 'PUT', uri: '/b/k', body: 'x', at: FIXED_AT });
    const b = signR2Request(FAKE_CREDENTIALS, { method: 'PUT', uri: '/b/k', body: 'x', at: FIXED_AT });
    expect(a.headers.authorization).toBe(b.headers.authorization); // L9: identical inputs -> identical signature
    expect(a.headers.authorization.startsWith('AWS4-HMAC-SHA256 Credential=AKIDFAKEFAKEFAKEFAKE/20261004/auto/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=')).toBe(true);
    expect(a.signature).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a different secret, instant, method, or payload changes the signature (sensitivity)', () => {
    const base = signR2Request(FAKE_CREDENTIALS, { method: 'PUT', uri: '/b/k', body: 'x', at: FIXED_AT });
    expect(signR2Request({ ...FAKE_CREDENTIALS, secretAccessKey: 'other' }, { method: 'PUT', uri: '/b/k', body: 'x', at: FIXED_AT }).signature).not.toBe(base.signature);
    expect(signR2Request(FAKE_CREDENTIALS, { method: 'PUT', uri: '/b/k', body: 'x', at: FIXED_AT + 1000 }).signature).not.toBe(base.signature);
    expect(signR2Request(FAKE_CREDENTIALS, { method: 'GET', uri: '/b/k', body: 'x', at: FIXED_AT }).signature).not.toBe(base.signature);
    expect(signR2Request(FAKE_CREDENTIALS, { method: 'PUT', uri: '/b/k', body: 'y', at: FIXED_AT }).signature).not.toBe(base.signature);
  });

  it('the endpoint + bucket path (pinned)', () => {
    expect(r2EndpointOf('demo-account-id')).toBe('https://demo-account-id.r2.cloudflarestorage.com');
    expect(bucketPathOf('demo-bucket', 'tradrl/evidence/t/k.json')).toBe('/demo-bucket/tradrl/evidence/t/k.json');
  });
});

// ---------------------------------------------------------------------------
// 2. L12 tenant scoping (keys built by the store — never caller-supplied)
// ---------------------------------------------------------------------------

describe('deploy/adapters/r2 — L12 tenant scoping', () => {
  const hostileTenant = '../../tenant-b';

  it('every evidence key is tenant-prefixed BY CONSTRUCTION (content-addressed)', () => {
    const key = evidenceKeyOf('tenant-a', '{"a":1}');
    expect(key.startsWith('tradrl/evidence/tenant-a/')).toBe(true);
    expect(key.endsWith('.json')).toBe(true);
    // Content addressing: identical bytes -> identical key (dedup).
    expect(evidenceKeyOf('tenant-a', '{"a":1}')).toBe(key);
    expect(evidenceKeyOf('tenant-a', '{"a":2}')).not.toBe(key);
    // Different tenants -> different keys.
    expect(evidenceKeyOf('tenant-b', '{"a":1}')).not.toBe(key);
  });

  it('a hostile tenant string stays inside ITS OWN opaque key namespace (S3 keys are flat strings — no path resolution)', () => {
    const key = evidenceKeyOf(hostileTenant, 'x');
    // The store builds every key server-side: the hostile tenant gets ITS OWN prefix,
    // never tenant-a's (L12 by construction — callers never supply keys).
    expect(key.startsWith(`tradrl/evidence/${hostileTenant}/`)).toBe(true);
    expect(key.includes('tenant-a')).toBe(false);
    // S3 object keys are opaque flat strings: '..' has NO path semantics in S3 — the
    // dotted key addresses a distinct object, never another tenant's namespace. (Dots
    // are RFC3986-unreserved, so a correct SigV4 canonical URI keeps them — pinned.)
    const signed = signR2Request(FAKE_CREDENTIALS, { method: 'GET', uri: bucketPathOf('demo-bucket', key), at: FIXED_AT });
    const canonicalUriLine = signed.canonicalRequest.split('\n')[1] ?? '';
    expect(canonicalUriLine).toBe(`/demo-bucket/tradrl/evidence/${hostileTenant}/2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881.json`);
    // The signed URL keeps the literal (unreserved) dots — byte-pinned.
    expect(signed.url).toBe(`${r2EndpointOf('demo-account-id')}/demo-bucket/tradrl/evidence/${hostileTenant}/2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881.json`);
  });

  it('a foreign tenant reads NOT-FOUND (indistinguishable from absent — fail-closed)', async () => {
    const fake = fakeR2();
    const store = new R2EvidenceStore({ credentials: FAKE_CREDENTIALS, bucket: 'demo-bucket', fetchLike: fake.fetchLike, instants: fixedInstants() });
    const put = await store.putEvidence('tenant-a', '{"evidence":"abc"}');
    expect(put.ok).toBe(true);
    const digest = put.ok ? put.value.digest : '';
    const own = await store.getEvidence('tenant-a', digest);
    expect(own.ok).toBe(true);
    // Tenant B asks for the SAME digest: a DIFFERENT key (its namespace) -> not-found.
    const foreign = await store.getEvidence('tenant-b', digest);
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.error.code).toBe('r2_not_found');
    const has = await store.hasEvidence('tenant-a', digest);
    expect(has).toEqual({ ok: true, value: true });
    const hasForeign = await store.hasEvidence('tenant-b', digest);
    expect(hasForeign).toEqual({ ok: true, value: false });
  });
});

// ---------------------------------------------------------------------------
// 3. R46 degradation + 4. the store round-trip
// ---------------------------------------------------------------------------

describe('deploy/adapters/r2 — R46 degradation + the store', () => {
  it('an unreachable provider is the typed r2_unreachable (never a throw; the flag flips)', async () => {
    const failing: FetchLike = async () => {
      throw new Error('connection refused (simulated)');
    };
    const store = new R2EvidenceStore({ credentials: FAKE_CREDENTIALS, bucket: 'demo-bucket', fetchLike: failing, instants: fixedInstants() });
    const result = await store.putEvidence('tenant-a', '{"e":1}');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('r2_unreachable');
    expect(store.degraded).toBe(true);
  });

  it('an HTTP 500 is the typed r2_http_error; a 404 is the typed r2_not_found', async () => {
    const http500: FetchLike = async () => ({ ok: false, status: 500, text: async () => '<Error><Code>InternalError</Code></Error>' });
    const store = new R2EvidenceStore({ credentials: FAKE_CREDENTIALS, bucket: 'demo-bucket', fetchLike: http500, instants: fixedInstants() });
    const failed = await store.getEvidence('tenant-a', 'abc');
    expect(failed.ok).toBe(false);
    if (failed.ok) return;
    expect(failed.error.code).toBe('r2_http_error');
    const notFound: FetchLike = async () => ({ ok: false, status: 404, text: async () => '<Error><Code>NoSuchKey</Code></Error>' });
    const missing = new R2EvidenceStore({ credentials: FAKE_CREDENTIALS, bucket: 'demo-bucket', fetchLike: notFound, instants: fixedInstants() });
    const absent = await missing.getEvidence('tenant-a', 'abc');
    expect(absent.ok).toBe(false);
    if (absent.ok) return;
    expect(absent.error.code).toBe('r2_not_found');
  });

  it('put -> get round-trips the exact bytes; the signed request carries the right URL + method', async () => {
    const fake = fakeR2();
    const store = new R2EvidenceStore({ credentials: FAKE_CREDENTIALS, bucket: 'demo-bucket', fetchLike: fake.fetchLike, instants: fixedInstants() });
    const content = '{"evidence":"the capsule payload","refs":["ev:1"]}';
    const put = await store.putEvidence('tenant-a', content);
    expect(put.ok).toBe(true);
    expect(fake.calls.length).toBe(1);
    const call = fake.calls[0];
    if (call === undefined) throw new Error('no call recorded');
    expect(call.method).toBe('PUT');
    expect(call.url.startsWith('https://demo-account-id.r2.cloudflarestorage.com/demo-bucket/tradrl/evidence/tenant-a/')).toBe(true);
    expect(call.url.endsWith('.json')).toBe(true);
    expect(call.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDFAKEFAKEFAKEFAKE\//);
    expect(call.body).toBe(content);
    const digest = put.ok ? put.value.digest : '';
    const got = await store.getEvidence('tenant-a', digest);
    expect(got).toEqual({ ok: true, value: content });
    // The GET went to the SAME key the PUT wrote (content addressing holds).
    const getUrl = fake.calls[1]?.url;
    expect(getUrl).toBe(fake.calls[0]?.url);
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function fixedInstants(): InstantSourceMirrorLike {
  let cursor = 0;
  return { next: () => FIXED_AT + cursor++ };
}

type InstantSourceMirrorLike = { next(): number };

function fakeR2(): { fetchLike: FetchLike; calls: { method: string; url: string; headers: Record<string, string>; body: string }[] } {
  const objects = new Map<string, string>();
  const calls: { method: string; url: string; headers: Record<string, string>; body: string }[] = [];
  const fetchLike: FetchLike = async (url, init) => {
    const body = init?.body ?? '';
    calls.push({ method: init?.method ?? 'GET', url, headers: { ...(init?.headers ?? {}) }, body });
    const path = url.replace('https://demo-account-id.r2.cloudflarestorage.com', '').split('?')[0] ?? '';
    if ((init?.method ?? 'GET') === 'PUT') {
      objects.set(path, body);
      return { ok: true, status: 200, text: async () => '' };
    }
    if ((init?.method ?? 'GET') === 'GET') {
      const stored = objects.get(path);
      if (stored === undefined) return { ok: false, status: 404, text: async () => '<Error><Code>NoSuchKey</Code></Error>' };
      return { ok: true, status: 200, text: async () => stored };
    }
    if ((init?.method ?? 'GET') === 'HEAD') {
      return objects.has(path) ? { ok: true, status: 200, text: async () => '' } : { ok: false, status: 404, text: async () => '<Error><Code>NoSuchKey</Code></Error>' };
    }
    return { ok: false, status: 405, text: async () => 'method not allowed' };
  };
  return { fetchLike, calls };
}
