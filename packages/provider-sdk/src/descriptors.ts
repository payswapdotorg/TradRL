/**
 * @tradrl/provider-sdk — the source descriptor and capability declaration.
 *
 * spec/ADAPTERS.md: "External systems are substrates. Canonical domain
 * contracts remain provider-neutral." A {@link SourceDescriptor} is the
 * provider-NEUTRAL identity + capability card every external source
 * presents: who (an opaque provider id), what (the source category — the
 * four families of spec/ADAPTERS.md: market data, execution, models, human
 * expertise), and how it can deliver (channels, symbol universes, canonical
 * event types, latency class). The SDK knows NO provider (L2/L13/L14): no
 * vendor name, field or semantic appears in any SDK type; concrete adapters
 * (T037+) declare their own descriptors.
 *
 * Descriptors are DECLARED and VALIDATED (collect-all), then deep-frozen —
 * immutable capability cards. Session configuration cross-checks against
 * them: subscriptions may only use declared channels, declared instruments
 * and declared event types, so an adapter cannot silently exceed its
 * declared capability envelope.
 */

import {
  invalidField,
  isNonEmptyString,
  isRecord,
  isUniqueNonEmptyStringArray,
  missingField,
  type ChannelId,
  type InstrumentId,
  type ProviderId,
  type UniverseId,
} from './fields';
import { isAssetClass, isEventType, type AssetClass, type EventType } from './taxonomy';
import type { SdkFieldError } from './errors';
import { deepFreeze } from './freeze';

/** The four source families of spec/ADAPTERS.md. */
export type SourceCategory = 'market-data' | 'execution' | 'model' | 'human';

/** Runtime list of source categories. */
export const SOURCE_CATEGORIES: readonly SourceCategory[] = ['market-data', 'execution', 'model', 'human'];

/** Runtime guard for a source category. */
export function isSourceCategory(value: unknown): value is SourceCategory {
  return typeof value === 'string' && (SOURCE_CATEGORIES as readonly string[]).includes(value);
}

/**
 * The declared delivery latency class of a source. Coarse by design: the
 * SDK does not promise millisecond behavior — it carries the source's own
 * honest declaration (adapters that lie about latency violate their
 * contract tests, not the SDK).
 */
export type LatencyClass = 'realtime' | 'near-realtime' | 'delayed' | 'batch';

/** Runtime list of latency classes. */
export const LATENCY_CLASSES: readonly LatencyClass[] = ['realtime', 'near-realtime', 'delayed', 'batch'];

/** Runtime guard for a latency class. */
export function isLatencyClass(value: unknown): value is LatencyClass {
  return typeof value === 'string' && (LATENCY_CLASSES as readonly string[]).includes(value);
}

/** One declared symbol universe: a named, asset-scoped instrument set. */
export interface SymbolUniverse {
  /** Opaque universe identifier (e.g. "spot-major"). */
  readonly universe_id: UniverseId;
  /** The asset class the universe's instruments belong to. */
  readonly asset_class: AssetClass;
  /** The declared instruments (opaque venue-canonical ids). Non-empty, unique. */
  readonly instruments: readonly InstrumentId[];
}

/** The declared capability set of a source. */
export interface SourceCapabilities {
  /** Raw channel names in the source's own (opaque) vocabulary. Non-empty, unique. */
  readonly channels: readonly ChannelId[];
  /** Declared symbol universes. Non-empty. */
  readonly symbol_universes: readonly SymbolUniverse[];
  /** Canonical event types this source can emit into. Non-empty, unique. */
  readonly event_types: readonly EventType[];
  /** The declared latency class. */
  readonly latency_class: LatencyClass;
}

/** The provider-neutral identity + capability card of an external source. */
export interface SourceDescriptor {
  /** Opaque provider identifier — the SDK never interprets it. */
  readonly provider: ProviderId;
  /** The source family (market data / execution / model / human). */
  readonly category: SourceCategory;
  /** The declared capability set. */
  readonly capabilities: SourceCapabilities;
}

/** Structural guard for a symbol universe. */
export function isSymbolUniverse(value: unknown): value is SymbolUniverse {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.universe_id)) return false;
  if (!isAssetClass(value.asset_class)) return false;
  return isUniqueNonEmptyStringArray(value.instruments);
}

/** Structural guard for the capabilities block. */
export function isSourceCapabilities(value: unknown): value is SourceCapabilities {
  if (!isRecord(value)) return false;
  if (!isUniqueNonEmptyStringArray(value.channels)) return false;
  if (!Array.isArray(value.symbol_universes) || value.symbol_universes.length === 0) return false;
  if (!value.symbol_universes.every((universe) => isSymbolUniverse(universe))) return false;
  if (!Array.isArray(value.event_types) || value.event_types.length === 0) return false;
  if (!value.event_types.every((eventType) => isEventType(eventType))) return false;
  return isLatencyClass(value.latency_class);
}

/** Structural guard for the whole descriptor. */
export function isSourceDescriptor(value: unknown): value is SourceDescriptor {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.provider)) return false;
  if (!isSourceCategory(value.category)) return false;
  return isSourceCapabilities(value.capabilities);
}

function validateUniverse(value: unknown, index: number, seenUniverseIds: Set<string>, errors: SdkFieldError[]): void {
  const base = `capabilities.symbol_universes[${index}]`;
  if (!isRecord(value)) {
    errors.push(invalidField(base, 'must be an object with universe_id, asset_class and instruments'));
    return;
  }
  if (value.universe_id === undefined) errors.push(missingField(`${base}.universe_id`));
  else if (!isNonEmptyString(value.universe_id))
    errors.push(invalidField(`${base}.universe_id`, 'must be a non-empty string'));
  else if (seenUniverseIds.has(value.universe_id))
    errors.push(invalidField(`${base}.universe_id`, `duplicate universe id "${value.universe_id}"`));
  else seenUniverseIds.add(value.universe_id);

  if (value.asset_class === undefined) errors.push(missingField(`${base}.asset_class`));
  else if (!isAssetClass(value.asset_class))
    errors.push(invalidField(`${base}.asset_class`, 'must be a canonical asset class'));

  if (value.instruments === undefined) {
    errors.push(missingField(`${base}.instruments`));
  } else if (!Array.isArray(value.instruments)) {
    errors.push(invalidField(`${base}.instruments`, 'must be a non-empty array of instrument ids'));
  } else if (value.instruments.length === 0) {
    errors.push(invalidField(`${base}.instruments`, 'must not be empty — a universe declares at least one instrument'));
  } else {
    const seen = new Set<string>();
    for (const instrument of value.instruments) {
      if (!isNonEmptyString(instrument)) {
        errors.push(invalidField(`${base}.instruments`, 'every instrument id must be a non-empty string'));
        break;
      }
      if (seen.has(instrument)) {
        errors.push(invalidField(`${base}.instruments`, `duplicate instrument id "${instrument}"`));
        break;
      }
      seen.add(instrument);
    }
  }
}

/**
 * Validate an untrusted value as a SourceDescriptor. Collects EVERY
 * violation (typed errors, dotted paths). Never throws. The validated
 * value is deep-frozen (immutable capability card).
 */
export function validateSourceDescriptor(value: unknown): { readonly ok: true; readonly value: SourceDescriptor } | { readonly ok: false; readonly errors: readonly SdkFieldError[] } {
  const errors: SdkFieldError[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidField('source', 'must be an object')] };
  }

  if (value.provider === undefined) errors.push(missingField('provider'));
  else if (!isNonEmptyString(value.provider))
    errors.push(invalidField('provider', 'must be a non-empty string'));

  if (value.category === undefined) errors.push(missingField('category'));
  else if (!isSourceCategory(value.category))
    errors.push(invalidField('category', `must be one of ${SOURCE_CATEGORIES.join(' | ')}`));

  if (value.capabilities === undefined) {
    errors.push(missingField('capabilities'));
  } else if (!isRecord(value.capabilities)) {
    errors.push(invalidField('capabilities', 'must be an object'));
  } else {
    const capabilities = value.capabilities;
    const base = 'capabilities';

    if (capabilities.channels === undefined) {
      errors.push(missingField(`${base}.channels`));
    } else if (!Array.isArray(capabilities.channels)) {
      errors.push(invalidField(`${base}.channels`, 'must be a non-empty array of channel names'));
    } else if (capabilities.channels.length === 0) {
      errors.push(invalidField(`${base}.channels`, 'must not be empty'));
    } else {
      const seen = new Set<string>();
      for (const channel of capabilities.channels) {
        if (!isNonEmptyString(channel)) {
          errors.push(invalidField(`${base}.channels`, 'every channel name must be a non-empty string'));
          break;
        }
        if (seen.has(channel)) {
          errors.push(invalidField(`${base}.channels`, `duplicate channel name "${channel}"`));
          break;
        }
        seen.add(channel);
      }
    }

    if (capabilities.symbol_universes === undefined) {
      errors.push(missingField(`${base}.symbol_universes`));
    } else if (!Array.isArray(capabilities.symbol_universes)) {
      errors.push(invalidField(`${base}.symbol_universes`, 'must be a non-empty array of universes'));
    } else if (capabilities.symbol_universes.length === 0) {
      errors.push(invalidField(`${base}.symbol_universes`, 'must not be empty'));
    } else {
      const seenUniverseIds = new Set<string>();
      capabilities.symbol_universes.forEach((universe, index) =>
        validateUniverse(universe, index, seenUniverseIds, errors),
      );
    }

    if (capabilities.event_types === undefined) {
      errors.push(missingField(`${base}.event_types`));
    } else if (!Array.isArray(capabilities.event_types)) {
      errors.push(invalidField(`${base}.event_types`, 'must be a non-empty array of canonical event types'));
    } else if (capabilities.event_types.length === 0) {
      errors.push(invalidField(`${base}.event_types`, 'must not be empty'));
    } else {
      const seen = new Set<string>();
      for (const eventType of capabilities.event_types) {
        if (!isEventType(eventType)) {
          errors.push(invalidField(`${base}.event_types`, `"${String(eventType)}" is not a canonical event type`));
          break;
        }
        if (seen.has(eventType)) {
          errors.push(invalidField(`${base}.event_types`, `duplicate event type "${eventType}"`));
          break;
        }
        seen.add(eventType);
      }
    }

    if (capabilities.latency_class === undefined) errors.push(missingField(`${base}.latency_class`));
    else if (!isLatencyClass(capabilities.latency_class))
      errors.push(invalidField(`${base}.latency_class`, `must be one of ${LATENCY_CLASSES.join(' | ')}`));
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: deepFreeze(value as unknown as SourceDescriptor) as unknown as SourceDescriptor };
}

/** Convenience: the union of instruments across every declared universe. */
export function declaredInstruments(descriptor: SourceDescriptor): readonly InstrumentId[] {
  return descriptor.capabilities.symbol_universes.flatMap((universe) => universe.instruments);
}

/** Convenience: is an instrument declared in a universe of the given asset class? */
export function isDeclaredInstrument(descriptor: SourceDescriptor, instrument: InstrumentId, assetClass: AssetClass): boolean {
  return descriptor.capabilities.symbol_universes.some(
    (universe) => universe.asset_class === assetClass && universe.instruments.includes(instrument),
  );
}

/** Convenience: is a channel declared in the descriptor's capability set? */
export function isDeclaredChannel(descriptor: SourceDescriptor, channel: ChannelId): boolean {
  return descriptor.capabilities.channels.includes(channel);
}

/** Convenience: is a canonical event type declared emittable by this source? */
export function isDeclaredEventType(descriptor: SourceDescriptor, eventType: EventType): boolean {
  return descriptor.capabilities.event_types.includes(eventType);
}
