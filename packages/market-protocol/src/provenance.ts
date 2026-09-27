/**
 * @tradrl/market-protocol — provenance and syntheticity.
 *
 * Every event carries its origin, the adapter that produced it (when it came
 * from the outside world) and its lineage (when it was derived from other
 * events). The origin trichotomy is the anti-poisoning foundation:
 *
 *   - `historical`: real-world observation delivered by a provider adapter.
 *     The adapter reference (id + version) is REQUIRED — no orphan history.
 *   - `simulated`: produced inside a TradRL Market World (reactive-replay
 *     participants, synthetic order flow). Never real-world truth.
 *   - `generated`: produced by a generative/counterfactual model. A stress
 *     and exploration instrument — NEVER historical truth (L5).
 *
 * Syntheticity rule: an event is synthetic iff `origin !== 'historical'`.
 * There is deliberately no separate boolean flag — a redundant flag could
 * contradict the enum; `isSyntheticEvent()` is the single derived predicate.
 */

import { invalidField, missingField, isNonEmptyString, isRecord } from './fields';
import type { MarketProtocolError } from './errors';

/** Where an event came from. The syntheticity discriminator. */
export type EventOrigin = 'historical' | 'simulated' | 'generated';

/** Runtime list of origins, for guards and diagnostics. */
export const EVENT_ORIGINS: readonly EventOrigin[] = ['historical', 'simulated', 'generated'];

/** Reference to the producing adapter (or generator component). */
export interface AdapterRef {
  /** Adapter id (e.g. "binance-adapter", "replay-file-adapter"). */
  readonly id: string;
  /** Adapter version (e.g. "1.4.0"). */
  readonly version: string;
}

/**
 * Provenance block carried by every event.
 *
 * - `origin`: REQUIRED — the historical/simulated/generated discriminator.
 * - `adapter`: REQUIRED non-null when origin is `historical` (every real
 *   observation entered through an adapter, including file replay). Optional
 *   for simulated/generated events, where it may name the producing world
 *   component.
 * - `derived_from`: lineage — the parent event/artifact ids. Empty for
 *   primitive observations; non-empty for derived events.
 * - `transform`: REQUIRED (non-empty) iff `derived_from` is non-empty —
 *   what produced the derivation (e.g. "vwap-1m-aggregator").
 */
export interface Provenance {
  readonly origin: EventOrigin;
  readonly adapter: AdapterRef | null;
  readonly derived_from: readonly string[];
  readonly transform: string | null;
}

/** Runtime guard for the origin discriminator. */
export function isEventOrigin(value: unknown): value is EventOrigin {
  return typeof value === 'string' && (EVENT_ORIGINS as readonly string[]).includes(value);
}

function validateAdapterRef(value: unknown, errors: MarketProtocolError[]): void {
  if (!isRecord(value)) {
    errors.push(invalidField('provenance.adapter', 'must be an object with id and version'));
    return;
  }
  if (!isNonEmptyString(value.id)) errors.push(invalidField('provenance.adapter.id', 'must be a non-empty string'));
  if (!isNonEmptyString(value.version))
    errors.push(invalidField('provenance.adapter.version', 'must be a non-empty string'));
}

/**
 * Full provenance validation. `eventId` is the enclosing event's id, needed
 * for the self-reference rule.
 */
export function validateProvenance(value: unknown, eventId: string): MarketProtocolError[] {
  const errors: MarketProtocolError[] = [];
  if (!isRecord(value)) {
    return [invalidField('provenance', 'must be an object')];
  }

  if (value.origin === undefined) errors.push(missingField('provenance.origin'));
  else if (!isEventOrigin(value.origin))
    errors.push(invalidField('provenance.origin', `must be one of ${EVENT_ORIGINS.join(' | ')}`));

  const origin = value.origin;
  if (value.adapter === undefined) {
    errors.push(missingField('provenance.adapter'));
  } else if (value.adapter !== null) {
    validateAdapterRef(value.adapter, errors);
  } else if (origin === 'historical') {
    errors.push({
      code: 'provenance_adapter_required',
      path: 'provenance.adapter',
      message: 'historical events must reference the adapter that delivered them (id and version)',
    });
  }

  if (value.derived_from === undefined) {
    errors.push(missingField('provenance.derived_from'));
  } else if (!Array.isArray(value.derived_from)) {
    errors.push(invalidField('provenance.derived_from', 'must be an array of parent event ids'));
  } else {
    const seen = new Set<string>();
    for (const parent of value.derived_from) {
      if (!isNonEmptyString(parent)) {
        errors.push(invalidField('provenance.derived_from', 'every parent id must be a non-empty string'));
        break;
      }
      if (parent === eventId) {
        errors.push({
          code: 'provenance_self_reference',
          path: 'provenance.derived_from',
          message: 'an event may not list itself in its own lineage',
        });
        break;
      }
      if (seen.has(parent)) {
        errors.push({
          code: 'provenance_duplicate_parent',
          path: 'provenance.derived_from',
          message: `duplicate parent id "${parent}" in lineage`,
        });
        break;
      }
      seen.add(parent);
    }
  }

  const isDerived = Array.isArray(value.derived_from) && value.derived_from.length > 0;
  if (value.transform === undefined) {
    errors.push(missingField('provenance.transform'));
  } else if (value.transform !== null) {
    if (!isNonEmptyString(value.transform))
      errors.push(invalidField('provenance.transform', 'must be a non-empty string or null'));
    if (!isDerived)
      errors.push({
        code: 'provenance_transform_without_parents',
        path: 'provenance.transform',
        message: 'a transform is only meaningful for derived events (non-empty derived_from)',
      });
  } else if (isDerived) {
    errors.push({
      code: 'provenance_transform_required',
      path: 'provenance.transform',
      message: 'derived events must declare the transform that produced them',
    });
  }

  return errors;
}

/** Structural requirement: anything carrying a provenance block (a MarketEvent does). */
interface HasProvenance {
  readonly provenance: Provenance;
}

/** The origin of an event (structural: works on any provenance-carrier). */
export function eventOrigin(event: HasProvenance): EventOrigin {
  return event.provenance.origin;
}

/**
 * The syntheticity predicate: an event is synthetic iff its origin is not
 * `historical`. Simulated and generated events are ALWAYS distinguishable
 * from historical ones — this is the anti-poisoning foundation (L5).
 */
export function isSyntheticEvent(event: HasProvenance): boolean {
  return event.provenance.origin !== 'historical';
}

/** Structural guard without the enclosing event context (no self-reference check). */
export function isProvenance(value: unknown): value is Provenance {
  if (!isRecord(value)) return false;
  if (!isEventOrigin(value.origin)) return false;
  if (value.adapter !== null && !isRecord(value.adapter)) return false;
  if (!Array.isArray(value.derived_from)) return false;
  if (typeof value.transform !== 'string' || value.transform.length === 0) {
    if (value.transform !== null) return false;
  }
  if (value.origin === 'historical' && value.adapter === null) return false;
  const derived = value.derived_from.length > 0;
  if (derived && (typeof value.transform !== 'string' || value.transform.length === 0)) return false;
  if (!derived && value.transform !== null) return false;
  return true;
}
