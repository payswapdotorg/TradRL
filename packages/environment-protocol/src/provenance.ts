/**
 * @tradrl/environment-protocol — observation provenance and syntheticity.
 *
 * SUMMARY MIRROR of `@tradrl/market-protocol`'s provenance (src/provenance.ts).
 * The canonical full provenance block (origin, adapter id+version, lineage,
 * transform) belongs to the market lane; the environment protocol carries a
 * deliberately LIGHTER summary with the same origin trichotomy — the
 * anti-poisoning foundation (L5):
 *
 *   - `historical`: real-world observation delivered through some source.
 *     The `source` reference is REQUIRED — no orphan history.
 *   - `simulated`: produced inside a TradRL Market World (reactive-replay
 *     participants, synthetic order flow). Never real-world truth.
 *   - `generated`: produced by a generative/counterfactual model. A stress
 *     and exploration instrument — NEVER historical truth.
 *
 * Syntheticity rule (mirrored): an observation is synthetic iff
 * `origin !== 'historical'`. There is deliberately no separate boolean flag —
 * a redundant flag could contradict the enum; {@link isSyntheticObservation}
 * is the single derived predicate.
 *
 * Lineage: `derived_from` lists parent observation/artifact ids. Non-empty
 * lineage marks a DERIVED observation — features, aggregates, action
 * results. Derived observations obey the SAME visibility law as primitive
 * ones (L4): the boundary never consults provenance.
 */

import { deepFreeze, isNonEmptyString, isRecord } from './primitives';
import { invalidField, missingField, type EnvError, type EnvResult, fail, ok } from './errors';

/** Where an observation came from. The syntheticity discriminator (L5). */
export type ObservationOrigin = 'historical' | 'simulated' | 'generated';

/** Runtime list of origins, for guards and diagnostics. */
export const OBSERVATION_ORIGINS: readonly ObservationOrigin[] = ['historical', 'simulated', 'generated'];

/**
 * Provenance summary carried by every observation.
 *
 * - `origin`: REQUIRED — the historical/simulated/generated discriminator.
 * - `source`: REQUIRED non-null when origin is `historical` (every real
 *   observation entered through some source — adapter, provider, replay
 *   file). Optional otherwise, where it may name the producing world
 *   component (the transformer for derived observations).
 * - `derived_from`: lineage — the parent observation/artifact ids. Empty for
 *   primitive observations; non-empty for derived ones.
 */
export interface ObservationProvenance {
  readonly origin: ObservationOrigin;
  readonly source: string | null;
  readonly derived_from: readonly string[];
}

/** Runtime guard for the origin discriminator. */
export function isObservationOrigin(value: unknown): value is ObservationOrigin {
  return typeof value === 'string' && (OBSERVATION_ORIGINS as readonly string[]).includes(value);
}

/** Structural requirement: a record carrying a provenance summary. */
interface HasObservationProvenance {
  readonly provenance: ObservationProvenance;
}

/** The origin of an observation (structural: works on any provenance-carrier). */
export function observationOrigin(observation: HasObservationProvenance): ObservationOrigin {
  return observation.provenance.origin;
}

/**
 * The syntheticity predicate: an observation is synthetic iff its origin is
 * not `historical`. Simulated and generated observations are ALWAYS
 * distinguishable from historical ones (L5).
 */
export function isSyntheticObservation(observation: HasObservationProvenance): boolean {
  return observation.provenance.origin !== 'historical';
}

/**
 * The derivation predicate: an observation is derived iff it lists lineage.
 * Derived observations are policed by the SAME visibility boundary as
 * primitive ones — see `isObservationVisible` (observation.ts).
 */
export function isDerivedObservation(observation: HasObservationProvenance): boolean {
  return observation.provenance.derived_from.length > 0;
}

/** Runtime guard for a provenance summary. */
export function isObservationProvenance(value: unknown): value is ObservationProvenance {
  if (!isRecord(value)) return false;
  if (!isObservationOrigin(value.origin)) return false;
  if (value.source !== null && !isNonEmptyString(value.source)) return false;
  if (!Array.isArray(value.derived_from)) return false;
  if (!value.derived_from.every((parent) => isNonEmptyString(parent))) return false;
  if (value.origin === 'historical' && value.source === null) return false;
  return true;
}

/**
 * Collect-all validation of a provenance summary. `observationId` is the
 * enclosing observation's id, needed for the self-reference rule. Dotted
 * paths are rooted at the caller-supplied prefix (e.g. `provenance`).
 */
export function validateObservationProvenance(
  value: unknown,
  observationId: string,
  path = 'provenance',
): EnvResult<ObservationProvenance> {
  const errors: EnvError[] = [];
  if (!isRecord(value)) {
    return fail('invalid_type', `${path} must be an object`, path);
  }

  if (value.origin === undefined) {
    errors.push(missingField(`${path}.origin`));
  } else if (!isObservationOrigin(value.origin)) {
    errors.push(invalidField(`${path}.origin`, `must be one of ${OBSERVATION_ORIGINS.join(' | ')}`));
  }

  if (value.source === undefined) {
    errors.push(missingField(`${path}.source`));
  } else if (value.source !== null && !isNonEmptyString(value.source)) {
    errors.push(invalidField(`${path}.source`, 'must be a non-empty string or null'));
  } else if (value.source === null && value.origin === 'historical') {
    errors.push({
      code: 'invalid_field',
      path: `${path}.source`,
      message: 'historical observations must reference the source that delivered them (no orphan history)',
    });
  }

  if (value.derived_from === undefined) {
    errors.push(missingField(`${path}.derived_from`));
  } else if (!Array.isArray(value.derived_from)) {
    errors.push(invalidField(`${path}.derived_from`, 'must be an array of parent observation ids'));
  } else {
    const seen = new Set<string>();
    for (const parent of value.derived_from) {
      if (!isNonEmptyString(parent)) {
        errors.push(invalidField(`${path}.derived_from`, 'every parent id must be a non-empty string'));
        break;
      }
      if (parent === observationId) {
        errors.push({
          code: 'invalid_field',
          path: `${path}.derived_from`,
          message: 'an observation may not list itself in its own lineage',
        });
        break;
      }
      if (seen.has(parent)) {
        errors.push({
          code: 'invalid_field',
          path: `${path}.derived_from`,
          message: `duplicate parent id "${parent}" in lineage`,
        });
        break;
      }
      seen.add(parent);
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return ok(
    deepFreeze({
      origin: value.origin as ObservationOrigin,
      source: value.source as string | null,
      derived_from: (value.derived_from as readonly string[]).slice(),
    }),
  );
}
