/**
 * @tradrl/adapter-arena — the provider source descriptor and capability
 * declaration (the HUMAN-expertise source family).
 *
 * STRUCTURAL MIRROR of @tradrl/provider-sdk/src/descriptors.ts (law
 * D-004: structural mirrors, never imports — the frozen workspace
 * lockfile forbids package dependencies), SPECIALIZED to the
 * capability-provider domain this adapter serves: spec/ADAPTERS.md's
 * fourth source family — "Models" are substrates and "Arena is one
 * optional capability provider" under Human expertise. A market-data
 * source declares channels + symbol universes + canonical event types;
 * a HUMAN-expertise source declares channels + the capability
 * CONTRACTS it serves + the deliverable kinds it produces + the
 * verification kinds it accepts — the T045 vocabulary, not the
 * market-protocol one (the adapter emits capability-provider envelopes,
 * never market events).
 *
 * THE INVERSE-NEUTRALITY POINT (L2/L13): the contract layer knows NO
 * provider; THIS layer is where a concrete adapter's source descriptor
 * is declared and cross-checked (the Arena declaration lives in
 * ../descriptor.ts). Descriptors are DECLARED and VALIDATED
 * (collect-all), then deep-frozen — immutable capability cards; the
 * session cross-checks every subscription and every routed request
 * against them so an adapter cannot silently exceed its declared
 * capability envelope.
 */

import {
  invalidField,
  isNonEmptyString,
  isRecord,
  isUniqueNonEmptyStringArray,
  missingField,
  type ChannelId,
  type ProviderId,
} from './fields';
import type { SdkFieldError } from './errors';
import { deepFreeze } from './freeze';
import { DELIVERABLE_KINDS, VERIFICATION_KINDS, isDeliverableKind, isVerificationKind } from './provider-envelopes';
import type { DeliverableKind, VerificationKind } from './provider-envelopes';

/**
 * The four source families of spec/ADAPTERS.md. The Arena adapter
 * declares the `human` family: "Arena is one optional capability
 * provider. Supported operations: request, expert evidence,
 * demonstration, annotation, evaluation and capability artifact."
 */
export type SourceCategory = 'market-data' | 'execution' | 'model' | 'human';

/** Runtime list of source categories. */
export const SOURCE_CATEGORIES: readonly SourceCategory[] = ['market-data', 'execution', 'model', 'human'];

/** Runtime guard for a source category. */
export function isSourceCategory(value: unknown): value is SourceCategory {
  return typeof value === 'string' && (SOURCE_CATEGORIES as readonly string[]).includes(value);
}

/**
 * The declared delivery latency class of a source. Coarse by design: the
 * contract carries the source's own honest declaration (adapters that
 * lie about latency violate their contract tests, not this layer).
 */
export type LatencyClass = 'realtime' | 'near-realtime' | 'delayed' | 'batch';

/** Runtime list of latency classes. */
export const LATENCY_CLASSES: readonly LatencyClass[] = ['realtime', 'near-realtime', 'delayed', 'batch'];

/** Runtime guard for a latency class. */
export function isLatencyClass(value: unknown): value is LatencyClass {
  return typeof value === 'string' && (LATENCY_CLASSES as readonly string[]).includes(value);
}

/**
 * The declared capability set of a HUMAN-expertise (capability-provider)
 * source: the raw channels it consumes, the capability CONTRACT keys it
 * serves (the T017/T045 language — never profession labels, L16a), the
 * deliverable kinds it produces, and the verification kinds it accepts.
 */
export interface SourceCapabilities {
  /** Raw channel names in the source's own (opaque) vocabulary. Non-empty, unique. */
  readonly channels: readonly ChannelId[];
  /** The capability contracts this source serves. Non-empty, unique. */
  readonly capability_keys: readonly string[];
  /** The deliverable kinds this source produces (the ADAPTERS operation list). Non-empty, unique. */
  readonly deliverable_kinds: readonly DeliverableKind[];
  /** The verification kinds this source accepts. Non-empty, unique. */
  readonly verification_kinds: readonly VerificationKind[];
  /** The declared latency class. */
  readonly latency_class: LatencyClass;
}

/** The provider-neutral identity + capability card of an external source. */
export interface SourceDescriptor {
  /** Opaque provider identifier — the contract layer never interprets it. */
  readonly provider: ProviderId;
  /** The source family (market data / execution / model / human). */
  readonly category: SourceCategory;
  /** The declared capability set. */
  readonly capabilities: SourceCapabilities;
}

/** Structural guard for the capabilities block. */
export function isSourceCapabilities(value: unknown): value is SourceCapabilities {
  if (!isRecord(value)) return false;
  if (!isUniqueNonEmptyStringArray(value.channels)) return false;
  if (!isUniqueNonEmptyStringArray(value.capability_keys)) return false;
  if (!Array.isArray(value.deliverable_kinds) || value.deliverable_kinds.length === 0) return false;
  if (!value.deliverable_kinds.every(isDeliverableKind)) return false;
  if (new Set(value.deliverable_kinds).size !== value.deliverable_kinds.length) return false;
  if (!Array.isArray(value.verification_kinds) || value.verification_kinds.length === 0) return false;
  if (!value.verification_kinds.every(isVerificationKind)) return false;
  if (new Set(value.verification_kinds).size !== value.verification_kinds.length) return false;
  return isLatencyClass(value.latency_class);
}

/** Structural guard for the whole descriptor. */
export function isSourceDescriptor(value: unknown): value is SourceDescriptor {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.provider)) return false;
  if (!isSourceCategory(value.category)) return false;
  return isSourceCapabilities(value.capabilities);
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
    } else if (!Array.isArray(capabilities.channels) || capabilities.channels.length === 0) {
      errors.push(invalidField(`${base}.channels`, 'must be a non-empty array of channel names'));
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

    if (capabilities.capability_keys === undefined) {
      errors.push(missingField(`${base}.capability_keys`));
    } else if (!Array.isArray(capabilities.capability_keys) || capabilities.capability_keys.length === 0) {
      errors.push(invalidField(`${base}.capability_keys`, 'must be a non-empty array of capability-contract keys'));
    } else {
      const seen = new Set<string>();
      for (const key of capabilities.capability_keys) {
        if (!isNonEmptyString(key)) {
          errors.push(invalidField(`${base}.capability_keys`, 'every capability key must be a non-empty string'));
          break;
        }
        if (seen.has(key)) {
          errors.push(invalidField(`${base}.capability_keys`, `duplicate capability key "${key}"`));
          break;
        }
        seen.add(key);
      }
    }

    if (capabilities.deliverable_kinds === undefined) {
      errors.push(missingField(`${base}.deliverable_kinds`));
    } else if (
      !Array.isArray(capabilities.deliverable_kinds) ||
      capabilities.deliverable_kinds.length === 0 ||
      !capabilities.deliverable_kinds.every(isDeliverableKind) ||
      new Set(capabilities.deliverable_kinds).size !== capabilities.deliverable_kinds.length
    ) {
      errors.push(invalidField(`${base}.deliverable_kinds`, `must be a non-empty duplicate-free array over ${DELIVERABLE_KINDS.join(' | ')}`));
    }

    if (capabilities.verification_kinds === undefined) {
      errors.push(missingField(`${base}.verification_kinds`));
    } else if (
      !Array.isArray(capabilities.verification_kinds) ||
      capabilities.verification_kinds.length === 0 ||
      !capabilities.verification_kinds.every(isVerificationKind) ||
      new Set(capabilities.verification_kinds).size !== capabilities.verification_kinds.length
    ) {
      errors.push(invalidField(`${base}.verification_kinds`, `must be a non-empty duplicate-free array over ${VERIFICATION_KINDS.join(' | ')}`));
    }

    if (capabilities.latency_class === undefined) errors.push(missingField(`${base}.latency_class`));
    else if (!isLatencyClass(capabilities.latency_class))
      errors.push(invalidField(`${base}.latency_class`, `must be one of ${LATENCY_CLASSES.join(' | ')}`));
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: deepFreeze(value as unknown as SourceDescriptor) as unknown as SourceDescriptor };
}

/** Convenience: is a channel declared in the descriptor's capability set? */
export function isDeclaredChannel(descriptor: SourceDescriptor, channel: ChannelId): boolean {
  return descriptor.capabilities.channels.includes(channel);
}

/** Convenience: is a capability contract declared served by this source? */
export function isDeclaredCapability(descriptor: SourceDescriptor, capabilityKey: string): boolean {
  return descriptor.capabilities.capability_keys.includes(capabilityKey);
}

/** Convenience: is a deliverable kind declared produced by this source? */
export function isDeclaredDeliverableKind(descriptor: SourceDescriptor, kind: DeliverableKind): boolean {
  return descriptor.capabilities.deliverable_kinds.includes(kind);
}

/** Convenience: is a verification kind declared accepted by this source? */
export function isDeclaredVerificationKind(descriptor: SourceDescriptor, kind: VerificationKind): boolean {
  return descriptor.capabilities.verification_kinds.includes(kind);
}
