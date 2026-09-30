/**
 * @tradrl/shadow_trading — the shadow-lane identity spaces (branded
 * ids, minted content-addressed or ordinally; every id is a non-empty
 * string with a lane-specific prefix so cross-lane identity confusion
 * is visible in evidence).
 *
 * Cross-lane entities (tenant, project, venue, instrument, seeds,
 * policy refs) stay OPAQUE — they are the owning lanes' branded
 * strings, consumed through structural mirrors only (D-003/D-004).
 */

import { isNonEmptyString, isRecord } from './primitives';

// ---------------------------------------------------------------------------
// The branded identity spaces
// ---------------------------------------------------------------------------

/** A shadow session id (`shs:` + digest of the session's genesis content). */
export type ShadowSessionId = string & { readonly __shadowSessionId: unique symbol };

/** A shadow outcome record id (`swo:` + digest of the record's canonical content). */
export type ShadowOutcomeRecordId = string & { readonly __shadowOutcomeRecordId: unique symbol };

/** A shadow fill id (`swf-` + zero-padded 8-digit ordinal — the exchange-sim minting law, mirrored). */
export type ShadowFillId = string & { readonly __shadowFillId: unique symbol };

/** A shadow refusal id (`swr:` + digest of the refusal's canonical content). */
export type ShadowRefusalId = string & { readonly __shadowRefusalId: unique symbol };

/** A shadow tick id (`swt-` + zero-padded 8-digit ordinal). */
export type ShadowTickId = string & { readonly __shadowTickId: unique symbol };

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** Guard: a shadow session id. */
export function isShadowSessionId(v: unknown): v is ShadowSessionId {
  return isNonEmptyString(v) && (v as string).startsWith('shs:');
}

/** Guard: a shadow outcome record id. */
export function isShadowOutcomeRecordId(v: unknown): v is ShadowOutcomeRecordId {
  return isNonEmptyString(v) && (v as string).startsWith('swo:');
}

/** Guard: a shadow fill id. */
export function isShadowFillId(v: unknown): v is ShadowFillId {
  return isNonEmptyString(v) && (v as string).startsWith('swf-');
}

/** Guard: a shadow refusal id. */
export function isShadowRefusalId(v: unknown): v is ShadowRefusalId {
  return isNonEmptyString(v) && (v as string).startsWith('swr:');
}

/** Guard: a shadow tick id. */
export function isShadowTickId(v: unknown): v is ShadowTickId {
  return isNonEmptyString(v) && /^swt-\d{8}$/.test(v as string);
}

// ---------------------------------------------------------------------------
// Mints
// ---------------------------------------------------------------------------

/** Mint a session id from its genesis digest (content-addressed, L9). */
export function mintShadowSessionId(digest: string): ShadowSessionId {
  return `shs:${digest}` as ShadowSessionId;
}

/** Mint an outcome-record id from its content digest (content-addressed, L9). */
export function mintShadowOutcomeRecordId(digest: string): ShadowOutcomeRecordId {
  return `swo:${digest}` as ShadowOutcomeRecordId;
}

/** Mint a refusal id from its content digest (content-addressed, L9). */
export function mintShadowRefusalId(digest: string): ShadowRefusalId {
  return `swr:${digest}` as ShadowRefusalId;
}

/** Mint a shadow fill id from its emission ordinal (the exchange-sim minting law, mirrored). */
export function mintShadowFillId(sequence: number): ShadowFillId {
  return `swf-${String(sequence).padStart(8, '0')}` as ShadowFillId;
}

/** Mint a shadow tick id from its tick ordinal. */
export function mintShadowTickId(sequence: number): ShadowTickId {
  return `swt-${String(sequence).padStart(8, '0')}` as ShadowTickId;
}

// ---------------------------------------------------------------------------
// Opaque cross-lane references (structural mirrors — never imports)
// ---------------------------------------------------------------------------

/** The opaque tenant scope (L12 — every record carries it). */
export type TenantRef = string;

/** The opaque project scope (L12/L15). */
export type ProjectRef = string;

/** Guard helper: an opaque non-empty reference. */
export function isOpaqueRef(v: unknown): v is string {
  return isNonEmptyString(v);
}

/** Read an opaque ref off an untrusted record (null when absent). */
export function opaqueRefOf(record: unknown, field: string): string | null {
  if (!isRecord(record)) return null;
  const value = (record as Record<string, unknown>)[field];
  return isNonEmptyString(value) ? value : null;
}
