/**
 * @tradrl/adapter-binance — the entitlement envelope.
 *
 * STRUCTURAL MIRROR of @tradrl/provider-sdk/src/entitlement.ts (law D-004:
 * never imports). spec/ADAPTERS.md (Licensing): "Commercially licensed
 * data remains access-controlled and is not copied into artifacts contrary
 * to provider terms", and "Adapters preserve provenance and entitlement
 * constraints."
 *
 * This adapter feeds on Binance PUBLIC spot market-data streams: the
 * declaration (see ../entitlement.ts) records the public-data access class
 * and the opaque constraint refs. The envelope discipline is structural,
 * not advisory:
 *
 *   - Every emitted record carries its entitlement ref (id + constraints,
 *     verbatim) so downstream consumers can enforce terms without
 *     dereferencing adapter-local state (L9 self-describing records).
 *   - Emission with NO declared envelope is a typed EntitlementError —
 *     there is no code path that emits an entitlement-less record.
 */

import { invalidField, isNonEmptyString, isRecord, isUniqueNonEmptyStringArray, missingField, type EntitlementId } from './fields';
import type { SdkFieldError } from './errors';

/** Whether the source's data is open or access-controlled. */
export type EntitlementAccessClass = 'public' | 'restricted';

/** Runtime list of access classes. */
export const ENTITLEMENT_ACCESS_CLASSES: readonly EntitlementAccessClass[] = ['public', 'restricted'];

/** Runtime guard for the access class. */
export function isEntitlementAccessClass(value: unknown): value is EntitlementAccessClass {
  return typeof value === 'string' && (ENTITLEMENT_ACCESS_CLASSES as readonly string[]).includes(value);
}

/**
 * The declared license/access envelope of a source's data.
 * Constraints and terms refs are OPAQUE strings: the adapter never
 * interprets them, it carries them (substrate neutrality).
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
 * The entitlement ref carried on every emitted record: the declaration id
 * plus the opaque constraints, verbatim — the record is self-describing
 * about its licensing without dereferencing adapter-local state.
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
