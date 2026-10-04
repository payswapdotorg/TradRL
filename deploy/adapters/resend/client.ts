// deploy/adapters/resend/client.ts — the hand-authored ZERO-DEP
// Resend client (email notice delivery).
//
// THE WIRE (Resend's REST — reimplemented on fetch, no npm):
//   POST https://api.resend.com/emails
//   Authorization: Bearer <RESEND_API_KEY>
//   Content-Type: application/json
//   {"from": "...", "to": ["..."], "subject": "...", "text": "...", "html": "..."}
//   200 -> {"id": "<email-id>"}
//
// DETERMINISM (L9): buildResendRequest is pure — fixed vectors in
// resend.test.ts use a FIXED FAKE API key (no live calls, no real
// secrets). DEGRADATION (R46): unreachable / HTTP / error envelope are
// the typed ResendFailure — never a throw.
//
// Spec anchors: D-033 (Resend is the notice-delivery provider), R46.

import { parseJsonText, type FetchLike } from '../shared';

// ---------------------------------------------------------------------------
// The configuration (environment-sourced — never hardcoded)
// ---------------------------------------------------------------------------

/** The Resend client configuration. */
export interface ResendConfig {
  /** The API key (a secret — never logged, never in error messages). */
  readonly apiKey: string;
  /** The verified sender ("TradRL Console <console@example.org>"). */
  readonly from: string;
}

// ---------------------------------------------------------------------------
// The typed failures (R46 — never a throw)
// ---------------------------------------------------------------------------

/** One typed Resend client failure. */
export interface ResendFailure {
  readonly code: 'resend_unreachable' | 'resend_http_error' | 'resend_malformed_response';
  readonly message: string;
}

/** The widened result. */
export type ResendResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ResendFailure };

// ---------------------------------------------------------------------------
// The request construction (pure — the determinism surface)
// ---------------------------------------------------------------------------

/** One outbound email (to/cc optional; html optional — text is the deterministic base). */
export interface OutboundEmail {
  readonly to: readonly string[];
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  readonly cc?: readonly string[];
}

/** One fully-built request (the pinned-vector surface — FAKE keys in tests only). */
export interface BuiltResendRequest {
  readonly method: 'POST';
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** The send-email request (pure, deterministic — identical email -> identical body bytes). */
export function buildResendRequest(config: ResendConfig, email: OutboundEmail): BuiltResendRequest {
  const payload: Record<string, unknown> = {
    from: config.from,
    to: [...email.to],
    subject: email.subject,
    text: email.text,
  };
  if (email.html !== undefined) payload.html = email.html;
  if (email.cc !== undefined && email.cc.length > 0) payload.cc = [...email.cc];
  return {
    method: 'POST',
    url: 'https://api.resend.com/emails',
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  };
}

// ---------------------------------------------------------------------------
// The execution (injected fetch; typed degradation on every path)
// ---------------------------------------------------------------------------

/** Send one email. NEVER throws (R46); the value is the provider's email id. */
export async function sendEmail(config: ResendConfig, email: OutboundEmail, fetchLike: FetchLike): Promise<ResendResult<string>> {
  const request = buildResendRequest(config, email);
  try {
    const response = await fetchLike(request.url, { method: request.method, headers: request.headers, body: request.body });
    let text: string;
    try {
      text = await response.text();
    } catch (cause) {
      return { ok: false, error: { code: 'resend_unreachable', message: `the Resend response body could not be read (${String(cause)})` } };
    }
    if (!response.ok) {
      return { ok: false, error: { code: 'resend_http_error', message: `Resend answered ${response.status}: ${text.slice(0, 200)}` } };
    }
    const parsed = parseJsonText(text);
    if (!parsed.ok) return { ok: false, error: { code: 'resend_malformed_response', message: 'the Resend response body is not valid JSON' } };
    const id = (parsed.value as { id?: unknown }).id;
    if (typeof id !== 'string') return { ok: false, error: { code: 'resend_malformed_response', message: 'the Resend response carries no email id' } };
    return { ok: true, value: id };
  } catch (cause) {
    return { ok: false, error: { code: 'resend_unreachable', message: `the Resend endpoint could not be reached (${String(cause)})` } };
  }
}
