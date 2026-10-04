// deploy/adapters/r2/sigv4.ts — the hand-authored AWS Signature V4
// (node:crypto ONLY — no @aws-crypto, no npm dependency).
//
// The full four-step SigV4 for the R2 S3-compatible API:
//   1. the CANONICAL REQUEST: method\ncanonicalUri\ncanonicalQuery\n
//      canonicalHeaders\nsignedHeaders\nhashedPayload
//      (headers sorted by lowercase name; the query string
//      RFC3986-encoded, name-sorted; the payload x-amz-content-sha256
//      — UNSIGNED-PAYLOAD never used here: the real sha256 is signed).
//   2. the STRING TO SIGN: AWS4-HMAC-SHA256\namzDate\nscope\n
//      hex(sha256(canonicalRequest)), scope = date/region/service/aws4_request.
//   3. the SIGNING KEY: HMAC chain kSecret -> kDate -> kRegion ->
//      kService -> kSigning ("AWS4" + secret prefix — the pinned
//      derivation structure).
//   4. the AUTHORIZATION header: AWS4-HMAC-SHA256
//      Credential={akid}/{scope}, SignedHeaders={list},
//      Signature={hex}.
//
// For R2: service = "s3", region = "auto" (the documented R2 SigV4
// region), the endpoint https://{account}.r2.cloudflarestorage.com.
//
// DETERMINISM (L9): every builder here is PURE — the pinned vectors in
// r2.test.ts use FIXED FAKE credentials (never real secrets, never a
// live call) and assert byte-exact canonical requests, string-to-sign,
// signing-key structure, and the header shape. The canonical steps are
// also verifiable against the published SigV4 test suite structure
// (empty-payload shape, sorted headers, encoded query).
//
// Spec anchors: D-033 (R2 is the evidence/blob provider), L9, L12 (the
// STORE on top scopes every object key by tenant), R46.

import { createHash, createHmac } from 'node:crypto';

// ---------------------------------------------------------------------------
// The primitives (pure)
// ---------------------------------------------------------------------------

/** The x-amz-date form: YYYYMMDD'T'HHMMSS'Z' (UTC — SigV4's own shape). */
export function amzDateOf(instantMs: number): string {
  const date = new Date(instantMs);
  const pad = (value: number) => String(value).padStart(2, '0');
  const ymd = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
  const hms = `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
  return `${ymd}T${hms}Z`;
}

/** The scope's date part: YYYYMMDD (UTC). */
export function dateStampOf(instantMs: number): string {
  return amzDateOf(instantMs).slice(0, 8);
}

/** RFC 3986 percent-encoding (everything but A-Za-z0-9-._~ — stricter than encodeURIComponent). */
export function rfc3986Encode(value: string): string {
  return [...value].map((character) => {
    if (/[A-Za-z0-9-._~]/.test(character)) return character;
    const bytes = Buffer.from(character, 'utf8');
    return [...bytes].map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`).join('');
  }).join('');
}

/** The canonical query string: RFC3986 name+value pairs, name-sorted (ties by value). */
export function canonicalQueryStringOf(params: Readonly<Record<string, string>>): string {
  const pairs = Object.entries(params).map(([name, value]) => [rfc3986Encode(name), rfc3986Encode(value)] as const);
  pairs.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1));
  return pairs.map(([name, value]) => `${name}=${value}`).join('&');
}

/** hex(sha256(text)) — the payload/segment hasher. */
export function sha256Hex(text: string | Buffer): string {
  return createHash('sha256').update(text).digest('hex');
}

/** hex(HMAC-SHA256(key, data)) — the signing chain step. */
function hmacSha256Hex(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

// ---------------------------------------------------------------------------
// The signing inputs (pure — the pinned-vector surface)
// ---------------------------------------------------------------------------

/** The R2 SigV4 credentials (environment-sourced — never hardcoded). */
export interface SigV4Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** The R2 account id (the endpoint's subdomain). */
  readonly accountId: string;
}

/** One request to sign (the S3-compatible operation surface). */
export interface SigV4Request {
  readonly method: 'PUT' | 'GET' | 'HEAD' | 'DELETE';
  /** The object key path, starting with '/' (already tenant-prefixed by the store). */
  readonly uri: string;
  /** The operation's query parameters (empty for plain object ops; 'list-type=2' for listings). */
  readonly query?: Readonly<Record<string, string>>;
  /** The payload bytes (PUT: the blob; GET/HEAD: empty — still hashed, never UNSIGNED). */
  readonly body?: string;
  /** The signing instant (injected — determinism in tests). */
  readonly at: number;
}

/** The fully-built signed request (canonical pieces + the headers to send). */
export interface BuiltSigV4Request {
  /** The URL: https://{account}.r2.cloudflarestorage.com{uri}?{query}. */
  readonly url: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  // The SigV4 intermediates (observable for the pinned vectors — never secret):
  readonly canonicalRequest: string;
  readonly stringToSign: string;
  readonly credentialScope: string;
  readonly signedHeaders: string;
  readonly signature: string;
}

/** The R2 endpoint of one account. */
export function r2EndpointOf(accountId: string): string {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

/**
 * Sign one request (steps 1-4). PURE: identical credentials + request +
 * instant yield byte-identical canonical request, string-to-sign,
 * signature, and headers (the test vectors pin this).
 */
export function signR2Request(credentials: SigV4Credentials, request: SigV4Request): BuiltSigV4Request {
  const region = 'auto';
  const service = 's3';
  const amzDate = amzDateOf(request.at);
  const dateStamp = dateStampOf(request.at);
  const payload = request.body ?? '';
  const payloadHash = sha256Hex(payload);
  const host = `${credentials.accountId}.r2.cloudflarestorage.com`;

  // The signed header set: host is required, x-amz-* carry the date and
  // payload hash. Names lowercase + sorted.
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers).sort().map((name) => `${name}:${headers[name].trim()}\n`).join('');

  const canonicalUri = rfc3986EncodePath(request.uri);
  const canonicalQuery = canonicalQueryStringOf(request.query ?? {});
  const canonicalRequest = [
    request.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');

  // The signing key chain: kSecret -> kDate -> kRegion -> kService -> kSigning.
  const kDate = hmacSha256Hex(`AWS4${credentials.secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256Hex(kDate, region);
  const kService = hmacSha256Hex(kRegion, service);
  const kSigning = hmacSha256Hex(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = `${r2EndpointOf(credentials.accountId)}${canonicalUri}${canonicalQuery.length > 0 ? `?${canonicalQuery}` : ''}`;
  return {
    url,
    method: request.method,
    headers: { ...headers, authorization },
    body: payload,
    canonicalRequest,
    stringToSign,
    credentialScope,
    signedHeaders,
    signature,
  };
}

/** The canonical URI path encoder: each segment RFC3986-encoded, '/' preserved. */
function rfc3986EncodePath(path: string): string {
  return path.split('/').map((segment) => rfc3986Encode(segment)).join('/');
}
