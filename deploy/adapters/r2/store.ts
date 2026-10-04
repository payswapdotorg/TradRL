// deploy/adapters/r2/store.ts — the evidence/blob store over R2
// (T052, W-3c).
//
// CONTENT-ADDRESSED, TENANT-SCOPED BLOB STORAGE: every object key is
//   tradrl/evidence/{tenant}/{sha256(content)}.json
// The tenant prefix is SERVER-SIDE (the host passes it from the
// credential registry — never from a request body); a key outside the
// caller's tenant is INEXPRESSIBLE (the store builds every key from
// its own prefix — L12 by construction). Same evidence bytes -> same
// digest -> same key (idempotent PUTs; deduped storage).
//
// OPERATIONS: putEvidence (PUT), getEvidence (GET), hasEvidence (HEAD),
// each a signed SigV4 request over the S3-compatible endpoint.
// DEGRADATION (R46): unreachable / HTTP / non-2xx are typed failures —
// never a throw. Instants injected; provenance recorded (observable,
// never secret).
//
// Spec anchors: D-033, L9 (content addressing), L12, R46.

import { createHash } from 'node:crypto';
import type { FetchLike, InstantSourceMirror, StoreResult } from '../shared';
import { r2EndpointOf, signR2Request, type SigV4Credentials } from './sigv4';

/** The blob store's dependencies (all injected, never ambient). */
export interface R2StoreDeps {
  readonly credentials: SigV4Credentials;
  readonly bucket: string;
  readonly fetchLike?: FetchLike;
  readonly instants: InstantSourceMirror;
}

/** The typed R2 store failure codes. */
export type R2StoreFailure =
  | { readonly code: 'r2_unreachable'; readonly message: string }
  | { readonly code: 'r2_http_error'; readonly message: string }
  | { readonly code: 'r2_not_found'; readonly message: string }
  | { readonly code: 'r2_malformed_response'; readonly message: string };

/** The object key of one evidence blob under one tenant (content-addressed). */
export function evidenceKeyOf(tenant: string, content: string | Buffer): string {
  const digest = createHash('sha256').update(content).digest('hex');
  return `tradrl/evidence/${tenant}/${digest}.json`;
}

/** The virtual-hosted URL path of one key in the configured bucket. */
export function bucketPathOf(bucket: string, key: string): string {
  return `/${bucket}/${key}`;
}

function defaultFetch(): FetchLike {
  const fetchGlobal = (globalThis as { fetch?: unknown }).fetch;
  if (typeof fetchGlobal !== 'function') {
    return async () => {
      throw new Error('no fetch implementation is available in this runtime');
    };
  }
  return fetchGlobal as FetchLike;
}

/** The content-addressed, tenant-scoped evidence/blob store. */
export class R2EvidenceStore {
  private readonly deps: R2StoreDeps;
  private readonly fetchLike: FetchLike;
  private lastOutcome: 'ok' | 'degraded' = 'ok';

  constructor(deps: R2StoreDeps) {
    this.deps = deps;
    this.fetchLike = deps.fetchLike ?? defaultFetch();
  }

  /** The last operation's outcome (degraded = the provider failed — R46 observability). */
  get degraded(): boolean {
    return this.lastOutcome === 'degraded';
  }

  /** The endpoint URL (observable; host + bucket — never a secret). */
  endpoint(): string {
    return r2EndpointOf(this.deps.credentials.accountId);
  }

  /** Persist one evidence blob (content-addressed: identical bytes -> identical key). */
  async putEvidence(tenant: string, content: string): Promise<StoreResult<{ readonly key: string; readonly digest: string }>> {
    const key = evidenceKeyOf(tenant, content);
    const built = signR2Request(this.deps.credentials, {
      method: 'PUT',
      uri: bucketPathOf(this.deps.bucket, key),
      body: content,
      at: this.deps.instants.next(),
    });
    const executed = await this.execute(built.method, built.url, built.headers, built.body, tenant);
    if (!executed.ok) return executed;
    return { ok: true, value: { key, digest: createHash('sha256').update(content).digest('hex') } };
  }

  /** Read one evidence blob (typed not-found when absent — indistinguishable from foreign). */
  async getEvidence(tenant: string, digest: string): Promise<StoreResult<string>> {
    const key = `tradrl/evidence/${tenant}/${digest}.json`;
    const built = signR2Request(this.deps.credentials, {
      method: 'GET',
      uri: bucketPathOf(this.deps.bucket, key),
      at: this.deps.instants.next(),
    });
    const executed = await this.execute(built.method, built.url, built.headers, built.body, tenant);
    if (!executed.ok) return executed;
    return { ok: true, value: executed.value as string };
  }

  /** `true` when the blob exists (HEAD — no body fetched). */
  async hasEvidence(tenant: string, digest: string): Promise<StoreResult<boolean>> {
    const key = `tradrl/evidence/${tenant}/${digest}.json`;
    const built = signR2Request(this.deps.credentials, {
      method: 'HEAD',
      uri: bucketPathOf(this.deps.bucket, key),
      at: this.deps.instants.next(),
    });
    const executed = await this.execute(built.method, built.url, built.headers, built.body, tenant);
    if (!executed.ok) {
      if (!executed.ok && executed.error.code === 'r2_not_found') return { ok: true, value: false };
      return executed;
    }
    return { ok: true, value: true };
  }

  private async execute(method: string, url: string, headers: Readonly<Record<string, string>>, body: string, tenant: string): Promise<StoreResult<string>> {
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await this.fetchLike(url, { method, headers, body });
    } catch (cause) {
      this.lastOutcome = 'degraded';
      return { ok: false, error: { code: 'r2_unreachable', message: `the R2 endpoint could not be reached (${String(cause)})` } };
    }
    let text: string;
    try {
      text = await response.text();
    } catch (cause) {
      this.lastOutcome = 'degraded';
      return { ok: false, error: { code: 'r2_unreachable', message: `the R2 response body could not be read (${String(cause)})` } };
    }
    if (!response.ok) {
      this.lastOutcome = 'degraded';
      // 404/NoSuchKey is the typed not-found; every other failure is the typed HTTP error.
      if (response.status === 404 || text.includes('<Code>NoSuchKey</Code>')) {
        return { ok: false, error: { code: 'r2_not_found', message: `the evidence object is not visible to this tenant` } };
      }
      return { ok: false, error: { code: 'r2_http_error', message: `R2 answered ${response.status}: ${text.slice(0, 200)}` } };
    }
    this.lastOutcome = 'ok';
    return { ok: true, value: text };
  }
}
