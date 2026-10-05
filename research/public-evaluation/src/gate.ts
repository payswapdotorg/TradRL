/**
 * @tradrl/research-public-evaluation — the PUBLICATION GATE (Work Order
 * T049): what gets published, and what NEVER does.
 *
 * THE NEVER-PUBLISH LAWS (the Work Order's own charter: "what gets
 * published, what never does (chain-of-thought, tenant data)"):
 *
 * 1. THE CLOSED KEY-VOCABULARY SCAN (the L16a label-scan discipline,
 *    re-declared for publication): two closed vocabularies of key names,
 *    walked recursively over EVERY JSON value the publication touches:
 *    - `CHAIN_OF_THOUGHT_KEYS` — reasoning traces, prompts, scratchpads,
 *      deliberation, model output: the REFUSAL `chain_of_thought`.
 *    - `TENANT_DATA_KEYS` — raw tenant material: trajectories, market
 *      events, order payloads, positions, books, credentials, tokens:
 *      the REFUSAL `tenant_data`.
 *    The scan is CONSERVATIVE by design (the fail-closed law): a false
 *    positive is the gate working — the operator renames to an honest
 *    summary field; a false negative is a leak. The vocabularies are
 *    closed, versioned data — never ad-hoc.
 *
 * 2. THE PROJECTION LAW (what GETS published): the public record is a
 *    PURE PROJECTION of the measurement — the claim block is DERIVED from
 *    the measurement's axes, restricted to the suite's PUBLIC axes
 *    (internal axes are measured but never published;
 *    `unpublishable_class` when a caller asks); the subject carries
 *    artifact ADDRESSES, never artifacts; the provenance carries content
 *    addresses. Nothing else exists in the format — there is no field in
 *    which tenant data could hide.
 *
 * 3. THE DEFENSE-IN-DEPTH LAW: the scans run over the OPERATOR
 *    ATTACHMENTS (the free-form context a caller may want to publish)
 *    AND over the COMPILED record itself — a compiled record that trips
 *    a scan is a bug in the projection, and the gate fails closed
 *    anyway.
 */

import { isRecord } from './primitives';
import type { JsonValue } from './primitives';
import { fail, ok, type PublicationResult } from './errors';
import type { MeasurementRecord } from './imports';
import type { PublishedClaim } from './record';

// ---------------------------------------------------------------------------
// The never-publish vocabularies (closed, versioned — the L16a pattern)
// ---------------------------------------------------------------------------

/**
 * The chain-of-thought key vocabulary — NEVER PUBLISHED, anywhere in the
 * publication (operator attachments included). Reasoning traces are the
 * model's private deliberation, not evidence.
 */
export const CHAIN_OF_THOUGHT_KEYS = [
  'reasoning',
  'reasoningTrace',
  'chainOfThought',
  'chain_of_thought',
  'thoughtProcess',
  'scratchpad',
  'prompt',
  'systemPrompt',
  'userPrompt',
  'deliberation',
  'internalNotes',
  'modelOutput',
  'completion',
  'rationale',
] as const;

/**
 * The tenant-data key vocabulary — NEVER PUBLISHED, anywhere in the
 * publication. Raw tenant material (trajectories, events, orders,
 * positions, books, credentials) stays in the tenant's private stores;
 * the public record carries measurements and content addresses only.
 */
export const TENANT_DATA_KEYS = [
  'trajectory',
  'trajectories',
  'rawEvents',
  'marketEvents',
  'events',
  'orderPayload',
  'orderPayloads',
  'orders',
  'positions',
  'book',
  'credentials',
  'credential',
  'apiKey',
  'apiKeys',
  'secret',
  'secrets',
  'token',
  'tokens',
  'password',
  'privateKey',
  'customerData',
  'payload',
] as const;

/** One never-publish vocabulary class. */
export type NeverPublishClass = 'chain_of_thought' | 'tenant_data';

/** Walk a JSON value and return the dotted paths of every banned key it carries (breadth-limited to JSON data). */
export function neverPublishPaths(value: unknown, prefix = ''): readonly { readonly path: string; readonly key: string; readonly banned: NeverPublishClass }[] {
  const found: { path: string; key: string; banned: NeverPublishClass }[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      found.push(...neverPublishPaths(item, `${prefix}[${index}]`));
    });
    return found;
  }
  if (!isRecord(value)) return found;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if ((CHAIN_OF_THOUGHT_KEYS as readonly string[]).includes(key)) {
      found.push({ path, key, banned: 'chain_of_thought' });
    } else if ((TENANT_DATA_KEYS as readonly string[]).includes(key)) {
      found.push({ path, key, banned: 'tenant_data' });
    }
    found.push(...neverPublishPaths(child, path));
  }
  return found;
}

/** The never-publish scan over one value: ok, or the typed refusal naming the first banned path. */
export function scanNeverPublish(value: unknown, what: string): PublicationResult<true> {
  const paths = neverPublishPaths(value);
  if (paths.length === 0) return ok(true);
  const first = paths[0] as { path: string; key: string; banned: NeverPublishClass };
  if (first.banned === 'chain_of_thought') {
    return fail(
      'chain_of_thought',
      `${what} carries the key "${first.key}" at "${first.path}" — chain-of-thought material (reasoning traces, prompts, scratchpads, deliberation) is NEVER published; publish the measured evidence, not the model's private deliberation`,
      first.path,
    );
  }
  return fail(
    'tenant_data',
    `${what} carries the key "${first.key}" at "${first.path}" — raw tenant data (trajectories, events, order payloads, positions, books, credentials) is NEVER published; the public record carries measurements and content addresses only`,
    first.path,
  );
}

// ---------------------------------------------------------------------------
// The projection law (what gets published)
// ---------------------------------------------------------------------------

/**
 * WHAT GETS PUBLISHED is decided by the PUBLICATION POLICY: the caller
 * declares which axis names are public. The gate refuses to publish axes
 * the policy does not name (`unpublishable_class` — an allowlist naming
 * nothing measured is a config error), and the compiled claim block
 * carries ONLY the allowed axes, DERIVED from the measurement's own
 * records (never caller-supplied — a claim that disagrees with the
 * measurement is `claim_unverified` at re-verification).
 */

/** The publication policy: which axis names are public, and the attachments (if any). */
export interface PublicationPolicy {
  /** The axis names that may appear in the public claim block (the projection allowlist). */
  readonly publicAxes: readonly string[];
  /** Free-form operator context considered for publication (scanned; banned classes refused). */
  readonly attachments?: JsonValue;
}

/** Guard: `PublicationPolicy`. */
export function isPublicationPolicy(v: unknown): v is PublicationPolicy {
  if (!isRecord(v)) return false;
  if (!Array.isArray(v.publicAxes) || (v.publicAxes as readonly unknown[]).length === 0) return false;
  if (!(v.publicAxes as readonly unknown[]).every((axis) => typeof axis === 'string' && (axis as string).length > 0)) return false;
  if (new Set(v.publicAxes as readonly string[]).size !== (v.publicAxes as readonly unknown[]).length) return false;
  return true;
}

/** Project the measurement's axes into the public claim block (the projection law). */
export function projectClaims(measurement: MeasurementRecord, policy: PublicationPolicy): readonly PublishedClaim[] {
  const allowed = new Set(policy.publicAxes);
  return measurement.axes
    .filter((axis) => allowed.has(axis.axis))
    .map((axis) => ({ axis: axis.axis, kind: axis.kind, value: axis.value, attained: axis.attained }));
}

/** Guard: every axis in the policy exists in the measurement (an allowlist naming nothing is a config error). */
export function checkPolicyAxes(measurement: MeasurementRecord, policy: PublicationPolicy): PublicationResult<true> {
  const measured = new Set(measurement.axes.map((axis) => axis.axis));
  const missing = policy.publicAxes.filter((axis) => !measured.has(axis));
  if (missing.length > 0) {
    return fail(
      'unpublishable_class',
      `the publication policy allows axes the measurement never recorded: ${missing.join(', ')} — the allowlist must name measured axes (a claim without its measurement is not publishable)`,
      'policy.publicAxes',
    );
  }
  return ok(true);
}

