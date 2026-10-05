/**
 * @tradrl/adapter-arena — the entitlement envelope.
 *
 * STRUCTURAL MIRROR of @tradrl/provider-sdk/src/entitlement.ts (law
 * D-004: structural mirrors, never imports — the frozen workspace
 * lockfile forbids package dependencies). spec/ADAPTERS.md (Licensing):
 * "Commercially licensed data remains access-controlled and is not
 * copied into artifacts contrary to provider terms", and "Adapters
 * preserve provenance and entitlement constraints." The contract layer's
 * job is deliberately OPAQUE: it does not interpret license terms, it
 * REQUIRES the declaration and CARRIES it — envelope emission with NO
 * declared entitlement is a typed EntitlementError, structurally, with
 * no code path that emits an entitlement-less envelope. The Arena
 * expertise entitlement declarations live in ../entitlement.ts.
 */

import { invalidField, isNonEmptyString, isRecord, isUniqueNonEmptyStringArray, missingField, type EntitlementId } from './fields';
import type { SdkFieldError } from './errors';

/** Whether the source's data is open or access-controlled. */
export type EntitlementAccessClass = 'public' | 'restricted';

/** Runtime list of access classes. */
export const ENTITLEMENT_ACCESS_CLASSES: readonly EntitlementAccessClass[] = ['public', 'restricted'];

/** Runtime guard for an access class. */
export function isEntitlementAccessClass(value: unknown): value is EntitlementAccessClass {
  return typeof value === 'string' && (ENTITLEMENT_ACCESS_CLASSES as readonly string[]).includes(value);
}

/**
 * The declared license/access envelope of a source's data.
 * Constraints and terms refs are OPAQUE strings: the contract layer
 * never interprets them, it carries them (substrate neutrality).
 */
export interface EntitlementEnvelope {
  /** Opaque entitlement declaration identifier (unique within the adapter config). */
  readonly entitlement_id: EntitlementId;
  /** Whether the data is open or access-controlled. */
  readonly access_class: EntitlementAccessClass;
  /** Opaque constraint refs (license terms, redistribution limits, embargoes...). */
  readonly constraints: readonly string[];
  /** Opaque reference to the full terms document, when one exists. */
  readonly terms_ref: string | null;
}

/**
 * The entitlement ref carried on every emitted envelope: the declaration
 * id plus the opaque constraints, verbatim — the record is
 * self-describing about its licensing without dereferencing
 * adapter-local state.
 */
export interface EntitlementRef {
  readonly entitlement_id: EntitlementId;
  readonly constraints: readonly string[];
}

/** Structural guard for an entitlement ref. */
export function isEntitlementRef(value: unknown): value is EntitlementRef {
  return (
    isRecord(value) &&
    isNonEmptyString(value.entitlement_id) &&
    isUniqueNonEmptyStringArray(value.constraints)
  );
}

/** Structural guard for an entitlement envelope. */
export function isEntitlementEnvelope(value: unknown): value is EntitlementEnvelope {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.entitlement_id)) return false;
  if (!isEntitlementAccessClass(value.access_class)) return false;
  if (!isUniqueNonEmptyStringArray(value.constraints)) return false;
  if (value.terms_ref !== null && !isNonEmptyString(value.terms_ref)) return false;
  return true;
}

/** Validate an untrusted value as an EntitlementEnvelope. Collects every violation. */
export function validateEntitlementEnvelope(value: unknown): SdkFieldError[] {
  const errors: SdkFieldError[] = [];
  if (!isRecord(value)) {
    return [invalidField('entitlement', 'must be an object')];
  }

  if (value.entitlement_id === undefined) errors.push(missingField('entitlement_id'));
  else if (!isNonEmptyString(value.entitlement_id))
    errors.push(invalidField('entitlement_id', 'must be a non-empty string'));

  if (value.access_class === undefined) errors.push(missingField('access_class'));
  else if (!isEntitlementAccessClass(value.access_class))
    errors.push(invalidField('access_class', `must be one of ${ENTITLEMENT_ACCESS_CLASSES.join(' | ')}`));

  if (value.constraints === undefined) {
    errors.push(missingField('constraints'));
  } else if (!Array.isArray(value.constraints)) {
    errors.push(invalidField('constraints', 'must be an array of opaque constraint refs'));
  } else {
    const seen = new Set<string>();
    for (const constraint of value.constraints) {
      if (!isNonEmptyString(constraint)) {
        errors.push(invalidField('constraints', 'every constraint ref must be a non-empty string'));
        break;
      }
      if (seen.has(constraint)) {
        errors.push(invalidField('constraints', `duplicate constraint ref "${constraint}"`));
        break;
      }
      seen.add(constraint);
    }
  }

  if (value.terms_ref === undefined) {
    errors.push(missingField('terms_ref'));
  } else if (value.terms_ref !== null && !isNonEmptyString(value.terms_ref)) {
    errors.push(invalidField('terms_ref', 'must be a non-empty string or null'));
  }

  return errors;
}

/** Derive the ref a record carries from a declared envelope. */
export function entitlementRefOf(envelope: EntitlementEnvelope): EntitlementRef {
  return { entitlement_id: envelope.entitlement_id, constraints: envelope.constraints };
}
