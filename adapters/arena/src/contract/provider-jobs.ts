/**
 * @tradrl/adapter-arena — the T041 job projection of the capability
 * request (the localization boundary).
 *
 * STRUCTURAL MIRROR of @tradrl/capability-provider's localize.ts job
 * surface + the SDK idempotency mirror (Work Order T045/T041, law
 * D-003/D-004: structural mirrors, NEVER imports). Provider request
 * envelopes ride the public jobs routes as OPAQUE specs; the Arena
 * adapter wraps its routed request in the operation-tagged payload and
 * derives the boundary idempotency key with the SAME function the SDK
 * ships (the interop test pins byte-parity against the REAL
 * @tradrl/sdk + drives the REAL public jobs route end-to-end).
 */

import { canonicalJson, fnv1a32Hex, isRecord, ok, fail } from './provider';
import type { ProviderResult } from './provider';
import { isCapabilityRequest } from './provider-envelopes';
import type { CapabilityRequest } from './provider-envelopes';

// Re-export the request guard for job-payload consumers.
export { isCapabilityRequest } from './provider-envelopes';

/** The operation tag a provider request carries when it rides the public jobs routes. */
export const CAPABILITY_REQUEST_JOB_OPERATION = 'capability-provider.request';

/** The operation-tagged job payload: { operation, request } — the jobs route's OPAQUE spec. */
export interface CapabilityRequestJobPayload {
  readonly operation: typeof CAPABILITY_REQUEST_JOB_OPERATION;
  readonly request: CapabilityRequest;
}

/** Wraps a capability request as the opaque job-spec payload for `POST /v1/jobs/research`. */
export function capabilityRequestJobPayload(request: CapabilityRequest): CapabilityRequestJobPayload {
  return { operation: CAPABILITY_REQUEST_JOB_OPERATION, request };
}

/**
 * The typed narrowing BACK from an opaque job spec: validates the
 * operation tag and the full request shape (the L16a scan included) —
 * an unknown spec is the typed refusal, never a blind cast (the jobs
 * machinery owns execution semantics; this lane owns the spec's
 * contract).
 */
export function narrowCapabilityRequestJobPayload(spec: unknown): ProviderResult<CapabilityRequest> {
  if (!isRecord(spec)) {
    return fail('invalid_type', 'the job spec is not an object — not a capability-provider payload', 'spec');
  }
  if (spec.operation !== CAPABILITY_REQUEST_JOB_OPERATION) {
    return fail('invalid_field', `the job spec's operation is ${JSON.stringify(spec.operation)} but this narrowing accepts only "${CAPABILITY_REQUEST_JOB_OPERATION}"`, 'spec.operation');
  }
  if (spec.request === undefined) {
    return fail('invalid_field', 'the job spec carries no request envelope', 'spec.request');
  }
  if (!isCapabilityRequest(spec.request)) {
    return fail('invalid_field', 'the job spec\'s request failed the CapabilityRequest guard (the full exchange law incl. the L16a label scan)', 'spec.request');
  }
  return ok(spec.request);
}

/** The idempotency-key grammar — mirror of the SDK's `IDEMPOTENCY_KEY_PATTERN` (`idem:` + 8-hex digest). */
export const IDEMPOTENCY_KEY_PATTERN_MIRROR = /^idem:[0-9a-f]{8}$/;

/** The wire-header law — mirror of the SDK's `isValidIdempotencyKey` (opaque non-empty, <= 256 chars). */
export function isValidIdempotencyKeyMirror(key: unknown): key is string {
  return typeof key === 'string' && key.length > 0 && key.length <= 256;
}

/**
 * The DETERMINISTIC idempotency-key derivation — STRUCTURAL MIRROR of
 * the SDK's `deriveIdempotencyKey`: 'idem:' + FNV-1a of the canonical
 * JSON of the parts. Identical parts derive identical keys (L9); the
 * caller chooses operation-unique parts.
 */
export function deriveIdempotencyKeyMirror(parts: unknown): string {
  return `idem:${fnv1a32Hex(canonicalJson(parts))}`;
}

/**
 * The idempotency key for the consequential jobs call that submits an
 * Arena-routed provider request through the T041 boundary — derived
 * with the SAME function the SDK ships, so a retry of the same
 * envelope can never double-submit.
 */
export function capabilityRequestJobIdempotencyKey(request: CapabilityRequest): string {
  return deriveIdempotencyKeyMirror([CAPABILITY_REQUEST_JOB_OPERATION, request.requestId]);
}
