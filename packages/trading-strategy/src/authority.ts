// @tradrl/trading-strategy — the L8 authority trip wire.
//
// THE EXISTENTIAL LAW OF THIS LANE (spec/ARCHITECTURE-LOCK.md L8:
// "External execution authority: models cannot bypass hard
// risk/authorization gates"; spec/ARCHITECTURE.md Execution: "Consequential
// actions require hard controls outside prompts: identity, authorization,
// limits, venue permissions, rate limits, kill switch, credentials and
// audit"): a strategy produces INTENTS — order-shaped requests, sizing
// decisions, rebalancing plans — NEVER authority. Execution (T019/T020/
// T034/T040) owns what happens next.
//
// This module implements the trip wire STRUCTURALLY, mirroring
// @tradrl/organization's blueprint safety scan (T016 — the same
// AUTHORITY_EMBEDDING_KEYS vocabulary, so one program-wide crime list):
// a strategy record (spec, intent, refusal, run, backtest candidate)
// whose JSON tree carries any of these keys anywhere fails validation
// with the typed `authority_in_strategy` error and fails the structural
// guards. Risk/authorization POLICY stays referable — via the OPAQUE
// `riskPolicyRefs` field (T020 owns the engine) — because a REFERENCE is
// how this lane names the independent gate that will judge its intents;
// an embedded GRANT, TOKEN, CREDENTIAL or PERMISSION is the crime.

import { isMemberOf, isRecord } from './primitives';

/**
 * The closed key vocabulary that makes a strategy record EMBED EXECUTION
 * AUTHORITY — the L8 trip wire (mirrors @tradrl/organization's
 * AUTHORITY_EMBEDDING_KEYS; the venue-permission and credential keys are
 * this lane's additions, named by its Work Order).
 */
export const AUTHORITY_EMBEDDING_KEYS = [
  'authority',
  'authorityToken',
  'executionAuthority',
  'executionGrant',
  'grant',
  'authorizedActions',
  'token',
  'credential',
  'apiKey',
  'secret',
  'permissions',
  'scopes',
  // This lane's named trip wires (Work Order T018, L8):
  'venuePermission',
  'venuePermissions',
  'credentialRef',
  'credentials',
] as const;

/** One authority-embedding key (the typed crime scene). */
export type AuthorityEmbeddingKey = (typeof AUTHORITY_EMBEDDING_KEYS)[number];

/** Guard: `AuthorityEmbeddingKey`. */
export function isAuthorityEmbeddingKey(v: unknown): v is AuthorityEmbeddingKey {
  return isMemberOf(AUTHORITY_EMBEDDING_KEYS, v);
}

/**
 * Walks a JSON value and returns the dotted paths of every object key in
 * {@link AUTHORITY_EMBEDDING_KEYS} (the authority scan — the same walk
 * discipline as the organization lane's safety scan).
 */
export function authorityKeyPaths(value: unknown, prefix = ''): readonly string[] {
  const found: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      for (const path of authorityKeyPaths(item, `${prefix}[${index}]`)) found.push(path);
    });
    return found;
  }
  if (!isRecord(value)) return found;
  for (const key of Object.keys(value)) {
    if (isAuthorityEmbeddingKey(key)) found.push(prefix === '' ? key : `${prefix}.${key}`);
    for (const path of authorityKeyPaths(value[key], prefix === '' ? key : `${prefix}.${key}`)) {
      found.push(path);
    }
  }
  return found;
}

/**
 * The authority-verb vocabulary: VALUES that assert execution authority
 * even under an innocent key. A strategy record whose `notes` or free
 * text asserts one of these verbs fails the scan — the Work Order names
 * "authority verb" explicitly as a crime.
 */
export const AUTHORITY_VERBS = [
  'authorize',
  'authorized',
  'authorizes',
  'execute-immediately',
  'grant',
  'grants',
  'granted',
  'permission-granted',
  'bypass-risk',
  'skip-risk-check',
  'force-execute',
] as const;

/** Guard: `AuthorityVerb`. */
export function isAuthorityVerb(v: unknown): v is (typeof AUTHORITY_VERBS)[number] {
  return isMemberOf(AUTHORITY_VERBS, v);
}

/**
 * Walks a JSON value and returns the dotted paths of every STRING value
 * that is exactly an authority verb (the verb scan; whole-value matches
 * only — prose that merely CONTAINS a verb is human text, not an
 * assertion of authority, and the strategy's human descriptions stay
 * free under the law).
 */
export function authorityVerbPaths(value: unknown, prefix = ''): readonly string[] {
  const found: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      for (const path of authorityVerbPaths(item, `${prefix}[${index}]`)) found.push(path);
    });
    return found;
  }
  if (typeof value === 'string') {
    return isAuthorityVerb(value) ? [prefix] : found;
  }
  if (!isRecord(value)) return found;
  for (const key of Object.keys(value)) {
    for (const path of authorityVerbPaths(value[key], prefix === '' ? key : `${prefix}.${key}`)) {
      found.push(path);
    }
  }
  return found;
}

/**
 * The full L8 scan: every authority-embedding key path and every
 * authority-verb value path of a strategy record's JSON tree. Empty
 * means the record is authority-free (it may proceed); non-empty is the
 * typed crime scene, reported as `authority_in_strategy`.
 */
export function authorityViolations(value: unknown): readonly string[] {
  return [...authorityKeyPaths(value), ...authorityVerbPaths(value)];
}
