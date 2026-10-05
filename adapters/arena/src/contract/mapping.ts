/**
 * @tradrl/adapter-arena — the mapping table: raw Arena wire fields ->
 * canonical capability-provider envelope fields.
 *
 * The mapping discipline of the sibling adapters (the
 * @tradrl/provider-sdk mapping contract), SPECIALIZED to the
 * capability-provider domain: a table translates ONE documented Arena
 * wire channel into ONE T045 envelope draft (declaration | quote |
 * deliverable). THE ANTI-SILENT-DROP LAW holds verbatim: every raw
 * field present in a wire message must be accounted for by exactly one
 * of {mapped fields, structured carries, computed fields, tolerated
 * fields, the instant-policy field} — a raw field accounted for by
 * NOTHING is a typed problem naming the field; dropping is possible
 * ONLY by explicit declaration. The Arena tables (with their declared
 * instant policies and wire-vocabulary enum maps) live in
 * ../mapping-tables.ts.
 *
 * Neutrality (L13): the CANONICAL side speaks ONLY the T045 envelope
 * vocabulary (the draft field names — provider-neutral); the WIRE side
 * speaks ONLY the documented Arena vocabulary. The enum maps (wire
 * deliverable/verification type codes -> the ADAPTERS vocabulary) are
 * DECLARED DATA in the tables, never code.
 */

import {
  invalidField,
  isNonEmptyString,
  isRecord,
  isUniqueNonEmptyStringArray,
  missingField,
  type MappingTableId,
} from './fields';
import type { SdkFieldError } from './errors';
import type { JsonValue, JsonObject } from './json';
import { isJsonObject, isJsonValue } from './json';
import { deepFreeze } from './freeze';
import {
  isMeasuredEvidenceMirror,
  isSkillApplicabilityMirror,
  isTimestampMs,
  stableDigestJson,
} from './provider';
import type {
  EnvironmentProfileRef,
  InstrumentClassRef,
  MeasuredEvidenceMirror,
  SkillApplicabilityMirror,
  TimestampMs,
} from './provider';
import { isProviderClaim, isVerificationRequirement } from './provider-envelopes';
import type { DeliverableKind, ProviderClaim, VerificationKind, VerificationRequirement } from './provider-envelopes';
import { isDeliverableKind, isVerificationKind } from './provider-envelopes';

// ---------------------------------------------------------------------------
// Envelope kinds + the canonical vocabulary (the T045 draft fields)
// ---------------------------------------------------------------------------

/** The three envelope kinds the Arena adapter mints from the wire. */
export type EnvelopeKind = 'declaration' | 'quote' | 'deliverable';

/** Runtime list of envelope kinds. */
export const ENVELOPE_KINDS: readonly EnvelopeKind[] = ['declaration', 'quote', 'deliverable'];

/** Guard: `EnvelopeKind`. */
export function isEnvelopeKind(value: unknown): value is EnvelopeKind {
  return typeof value === 'string' && (ENVELOPE_KINDS as readonly string[]).includes(value);
}

/** The L12 scope fields the SESSION injects (never the wire — the wire never carries tenant identity). */
export const SESSION_INJECTED_FIELDS: readonly string[] = ['tenantId', 'projectId'];

/** The canonical draft-field vocabulary of each envelope kind (dotted paths address nested members). */
const CANONICAL_VOCABULARY: Readonly<Record<EnvelopeKind, readonly string[]>> = Object.freeze({
  declaration: [
    'providerRef',
    'displayName',
    'offers',
    'version',
    'supersedes',
    'declaredAt',
    'tenantId',
    'projectId',
  ],
  quote: [
    'requestId',
    'providerRef',
    'offerRef',
    'terms.deliverableKind',
    'terms.verification',
    'terms.consideration',
    'terms.estimatedDeliveryAt',
    'quotedAt',
    'tenantId',
    'projectId',
  ],
  deliverable: [
    'engagementId',
    'kind',
    'claims',
    'payload',
    'payloadDigest',
    'submittedAt',
    'tenantId',
    'projectId',
  ],
});

/** The canonical instant field each kind's instant policy must feed. */
const INSTANT_TARGETS: Readonly<Record<EnvelopeKind, string>> = Object.freeze({
  declaration: 'declaredAt',
  quote: 'quotedAt',
  deliverable: 'submittedAt',
});

/** The canonical draft-field vocabulary of an envelope kind. */
export function canonicalEnvelopeFields(kind: EnvelopeKind): readonly string[] {
  return CANONICAL_VOCABULARY[kind];
}

// ---------------------------------------------------------------------------
// Value transforms (scalar)
// ---------------------------------------------------------------------------

/**
 * A declared scalar transform: how one raw field's value becomes the
 * canonical field's value. Transforms are PURE and TOTAL-or-problem:
 * any input the transform cannot translate produces a typed problem at
 * mapping time (never a silent drop, never a null).
 */
export type FieldTransform =
  /** Pass the raw value through unchanged. */
  | { readonly kind: 'identity' }
  /** Map a raw enum string through a declared table (wire type codes -> the canonical vocabulary). */
  | { readonly kind: 'enum'; readonly map: Readonly<Record<string, string>> }
  /** An epoch-millisecond instant, or null passthrough (validated, never invented). */
  | { readonly kind: 'instant' };

/** Guard: `FieldTransform`. */
export function isFieldTransform(value: unknown): value is FieldTransform {
  if (!isRecord(value)) return false;
  if (value.kind === 'identity') return true;
  if (value.kind === 'instant') return true;
  if (value.kind === 'enum') {
    if (!isRecord(value.map)) return false;
    const entries = Object.entries(value.map);
    if (entries.length === 0) return false;
    return entries.every(([key, target]) => isNonEmptyString(key) && isNonEmptyString(target));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Structured carries (the array/object members)
// ---------------------------------------------------------------------------

/**
 * The declared structured carries: the raw members whose translation
 * needs a structural transform, implemented ONCE here as pure
 * total-or-problem functions. Each names its structure; the wire
 * shapes are the documented Arena schemas (../schemas.ts).
 */
export type StructuredKind =
  /** An array of measured evidence (the T017 union, carried verbatim). */
  | 'measured-evidence'
  /** An applicability scope: { environments, instruments } -> the T017 applicability mirror. */
  | 'applicability'
  /** The verification-contract echo (carried VERBATIM — validated through the requirement guard). */
  | 'verification'
  /** The wire offer array -> the T045 provider capability offers (with the declared enum maps). */
  | 'offers'
  /** The wire claim array -> the T045 provider claims. */
  | 'claims'
  /** The opaque provider content (a JSON value, carried verbatim). */
  | 'payload';

/** Runtime list of structured kinds. */
export const STRUCTURED_KINDS: readonly StructuredKind[] = [
  'measured-evidence',
  'applicability',
  'verification',
  'offers',
  'claims',
  'payload',
];

/** Guard: `StructuredKind`. */
export function isStructuredKind(value: unknown): value is StructuredKind {
  return typeof value === 'string' && (STRUCTURED_KINDS as readonly string[]).includes(value);
}

/** One structured carry declaration. */
export interface StructuredCarry {
  /** The raw field name in the wire payload. */
  readonly raw_field: string;
  /** The canonical (possibly dotted) field it feeds. */
  readonly canonical_field: string;
  /** The declared structure. */
  readonly structure: StructuredKind;
  /** For 'offers': the wire deliverable-type code -> canonical DeliverableKind map. */
  readonly deliverable_kind_map?: Readonly<Record<string, string>>;
  /** For 'offers': the wire verification-type code -> canonical VerificationKind map. */
  readonly verification_kind_map?: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------
// Constants + computed fields
// ---------------------------------------------------------------------------

/** One canonical field filled with a declared constant value. */
export interface ConstantField {
  readonly canonical_field: string;
  readonly value: JsonValue;
}

/**
 * One canonical field COMPUTED by the mapping engine (never present on
 * the wire): the payload digest — the opaque provider content pinned
 * by its canonical-bytes digest at the boundary (the payload law).
 */
export interface ComputedField {
  readonly canonical_field: 'payloadDigest';
  readonly kind: 'payload-digest';
}

/** Guard: `ComputedField`. */
export function isComputedField(value: unknown): value is ComputedField {
  return (
    isRecord(value) &&
    value.canonical_field === 'payloadDigest' &&
    value.kind === 'payload-digest'
  );
}

// ---------------------------------------------------------------------------
// The instant policy (the L4-declared derivation)
// ---------------------------------------------------------------------------

/** Where the envelope's principal instant comes from: a raw wire field, or the receive time. */
export interface InstantPolicy {
  readonly instant_basis: 'raw-field' | 'receive-time';
  /** Required iff instant_basis is 'raw-field'; must be null otherwise. */
  readonly instant_field: string | null;
  /** The canonical instant field this policy feeds (fixed per kind). */
  readonly canonical_field: string;
}

/** Guard: `InstantPolicy`. */
export function isInstantPolicy(value: unknown): value is InstantPolicy {
  if (!isRecord(value)) return false;
  if (value.instant_basis !== 'raw-field' && value.instant_basis !== 'receive-time') return false;
  if (value.instant_basis === 'raw-field' && !isNonEmptyString(value.instant_field)) return false;
  if (value.instant_basis === 'receive-time' && value.instant_field !== null) return false;
  return isNonEmptyString(value.canonical_field);
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/** One raw -> canonical field mapping with its declared transform. */
export interface FieldMapping {
  /** The raw field name in the wire payload. */
  readonly raw_field: string;
  /** The canonical (possibly dotted) field it feeds. */
  readonly canonical_field: string;
  /** The declared value transform. */
  readonly transform: FieldTransform;
  /** Whether the raw field MUST be present in every message (default true). */
  readonly required: boolean;
}

/**
 * The declared mapping table for one envelope kind on one channel: the
 * raw->canonical field provenance plus the instant policy.
 */
export interface MappingTable {
  /** Opaque table identifier (referenced by subscriptions). */
  readonly table_id: MappingTableId;
  /** The envelope kind this table produces. */
  readonly envelope_kind: EnvelopeKind;
  /** Raw -> canonical scalar field mappings. */
  readonly fields: readonly FieldMapping[];
  /** Structured carries. */
  readonly structured: readonly StructuredCarry[];
  /** Canonical fields filled with declared constants. */
  readonly constants: readonly ConstantField[];
  /** Canonical fields computed by the engine. */
  readonly computed: readonly ComputedField[];
  /** Raw fields explicitly declared as knowingly dropped (auditable). */
  readonly tolerated: readonly string[];
  /** The declared instant derivation (L4). */
  readonly instant_policy: InstantPolicy;
}

/** Validated result of {@link validateMappingTable}. */
export type MappingTableValidation =
  | { readonly ok: true; readonly value: MappingTable }
  | { readonly ok: false; readonly errors: readonly SdkFieldError[] };

/** All raw fields this table accounts for (mapped, structured, computed-over, tolerated, instant-policy). */
export function accountedRawFields(table: MappingTable): readonly string[] {
  return [
    ...table.fields.map((field) => field.raw_field),
    ...table.structured.map((carry) => carry.raw_field),
    ...table.tolerated,
    ...(table.instant_policy.instant_basis === 'raw-field' && table.instant_policy.instant_field !== null
      ? [table.instant_policy.instant_field]
      : []),
  ];
}

/**
 * Validate an untrusted value as a MappingTable. Collects EVERY
 * violation; never throws. The validated table is deep-frozen with
 * defaults normalized (identity transform, required fields).
 */
export function validateMappingTable(value: unknown): MappingTableValidation {
  const errors: SdkFieldError[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidField('mapping_table', 'must be an object')] };
  }

  if (value.table_id === undefined) errors.push(missingField('table_id'));
  else if (!isNonEmptyString(value.table_id)) errors.push(invalidField('table_id', 'must be a non-empty string'));

  if (value.envelope_kind === undefined) errors.push(missingField('envelope_kind'));
  else if (!isEnvelopeKind(value.envelope_kind))
    errors.push(invalidField('envelope_kind', `must be one of ${ENVELOPE_KINDS.join(' | ')}`));
  const kind: EnvelopeKind | undefined = isEnvelopeKind(value.envelope_kind) ? value.envelope_kind : undefined;

  // Scalar fields.
  const seenRaw = new Set<string>();
  const seenCanonical = new Set<string>();
  if (value.fields === undefined) {
    errors.push(missingField('fields'));
  } else if (!Array.isArray(value.fields) || value.fields.length === 0) {
    errors.push(invalidField('fields', 'must be a non-empty array of field mappings'));
  } else {
    const vocabulary = kind !== undefined ? CANONICAL_VOCABULARY[kind] : [];
    value.fields.forEach((entry: unknown, index: number) => {
      const path = `fields[${index}]`;
      if (!isRecord(entry)) {
        errors.push(invalidField(path, 'must be an object with raw_field and canonical_field'));
        return;
      }
      if (entry.raw_field === undefined) errors.push(missingField(`${path}.raw_field`));
      else if (!isNonEmptyString(entry.raw_field)) errors.push(invalidField(`${path}.raw_field`, 'must be a non-empty string'));
      else if (seenRaw.has(entry.raw_field)) errors.push(invalidField(`${path}.raw_field`, `duplicate raw field "${entry.raw_field}"`));
      else seenRaw.add(entry.raw_field);

      if (entry.canonical_field === undefined) errors.push(missingField(`${path}.canonical_field`));
      else if (!isNonEmptyString(entry.canonical_field)) errors.push(invalidField(`${path}.canonical_field`, 'must be a non-empty string'));
      else if (vocabulary.length > 0 && !vocabulary.includes(entry.canonical_field))
        errors.push(invalidField(`${path}.canonical_field`, `"${entry.canonical_field}" is not a field of the ${kind} envelope draft (${vocabulary.join(' | ')})`));
      else if (seenCanonical.has(entry.canonical_field)) errors.push(invalidField(`${path}.canonical_field`, `duplicate canonical field "${entry.canonical_field}"`));
      else seenCanonical.add(entry.canonical_field);

      if (entry.transform !== undefined && !isFieldTransform(entry.transform)) {
        errors.push(invalidField(`${path}.transform`, 'must be a declared transform (identity | enum | instant)'));
      }
      if (entry.required !== undefined && typeof entry.required !== 'boolean') {
        errors.push(invalidField(`${path}.required`, 'must be a boolean when present'));
      }
    });
  }

  // Structured carries.
  if (value.structured === undefined) {
    errors.push(missingField('structured'));
  } else if (!Array.isArray(value.structured)) {
    errors.push(invalidField('structured', 'must be an array of structured carries'));
  } else {
    const vocabulary = kind !== undefined ? CANONICAL_VOCABULARY[kind] : [];
    value.structured.forEach((entry: unknown, index: number) => {
      const path = `structured[${index}]`;
      if (!isRecord(entry)) {
        errors.push(invalidField(path, 'must be an object with raw_field, canonical_field and structure'));
        return;
      }
      if (entry.raw_field === undefined) errors.push(missingField(`${path}.raw_field`));
      else if (!isNonEmptyString(entry.raw_field)) errors.push(invalidField(`${path}.raw_field`, 'must be a non-empty string'));
      else if (seenRaw.has(entry.raw_field)) errors.push(invalidField(`${path}.raw_field`, `duplicate raw field "${entry.raw_field}"`));
      else seenRaw.add(entry.raw_field);

      if (entry.canonical_field === undefined) errors.push(missingField(`${path}.canonical_field`));
      else if (!isNonEmptyString(entry.canonical_field)) errors.push(invalidField(`${path}.canonical_field`, 'must be a non-empty string'));
      else if (vocabulary.length > 0 && !vocabulary.includes(entry.canonical_field))
        errors.push(invalidField(`${path}.canonical_field`, `"${entry.canonical_field}" is not a field of the ${kind} envelope draft`));
      else if (seenCanonical.has(entry.canonical_field)) errors.push(invalidField(`${path}.canonical_field`, `duplicate canonical field "${entry.canonical_field}"`));
      else seenCanonical.add(entry.canonical_field);

      if (entry.structure === undefined) errors.push(missingField(`${path}.structure`));
      else if (!isStructuredKind(entry.structure)) errors.push(invalidField(`${path}.structure`, `must be one of ${STRUCTURED_KINDS.join(' | ')}`));

      if (entry.structure === 'offers') {
        for (const mapKey of ['deliverable_kind_map', 'verification_kind_map'] as const) {
          const map = entry[mapKey];
          if (map === undefined) {
            errors.push(missingField(`${path}.${mapKey}`));
          } else if (!isRecord(map) || Object.keys(map).length === 0) {
            errors.push(invalidField(`${path}.${mapKey}`, 'must be a non-empty raw->canonical string map'));
          } else {
            const targetGuard = mapKey === 'deliverable_kind_map' ? isDeliverableKind : isVerificationKind;
            for (const [raw, canonical] of Object.entries(map)) {
              if (!isNonEmptyString(raw) || !targetGuard(canonical)) {
                errors.push(invalidField(`${path}.${mapKey}`, `"${raw}" -> "${String(canonical)}" is not a declared ${(mapKey === 'deliverable_kind_map' ? 'DeliverableKind' : 'VerificationKind')} target`));
                break;
              }
            }
          }
        }
      } else if (entry.deliverable_kind_map !== undefined || entry.verification_kind_map !== undefined) {
        errors.push(invalidField(path, `the "${String(entry.structure)}" structure takes no enum maps`));
      }
    });
  }

  // Constants.
  const constantCanonical = new Set<string>();
  if (value.constants === undefined) {
    errors.push(missingField('constants'));
  } else if (!Array.isArray(value.constants)) {
    errors.push(invalidField('constants', 'must be an array of constant field declarations'));
  } else {
    const vocabulary = kind !== undefined ? CANONICAL_VOCABULARY[kind] : [];
    value.constants.forEach((entry: unknown, index: number) => {
      const path = `constants[${index}]`;
      if (!isRecord(entry)) {
        errors.push(invalidField(path, 'must be an object with canonical_field and value'));
        return;
      }
      if (entry.canonical_field === undefined) errors.push(missingField(`${path}.canonical_field`));
      else if (!isNonEmptyString(entry.canonical_field)) errors.push(invalidField(`${path}.canonical_field`, 'must be a non-empty string'));
      else if (vocabulary.length > 0 && !vocabulary.includes(entry.canonical_field))
        errors.push(invalidField(`${path}.canonical_field`, `"${entry.canonical_field}" is not a field of the ${kind} envelope draft`));
      else if (seenCanonical.has(entry.canonical_field))
        errors.push(invalidField(`${path}.canonical_field`, `canonical field "${entry.canonical_field}" is already mapped`));
      else if (constantCanonical.has(entry.canonical_field))
        errors.push(invalidField(`${path}.canonical_field`, `duplicate constant field "${entry.canonical_field}"`));
      else constantCanonical.add(entry.canonical_field);
      if (entry.value === undefined) errors.push(missingField(`${path}.value`));
      else if (!isJsonValue(entry.value)) errors.push(invalidField(`${path}.value`, 'must be a JSON value'));
    });
  }

  // Computed fields.
  const computedCanonical = new Set<string>();
  if (value.computed === undefined) {
    errors.push(missingField('computed'));
  } else if (!Array.isArray(value.computed)) {
    errors.push(invalidField('computed', 'must be an array of computed field declarations'));
  } else {
    const vocabulary = kind !== undefined ? CANONICAL_VOCABULARY[kind] : [];
    value.computed.forEach((entry: unknown, index: number) => {
      const path = `computed[${index}]`;
      if (!isComputedField(entry)) {
        errors.push(invalidField(path, 'must be the payload-digest computed declaration ({canonical_field: "payloadDigest", kind: "payload-digest"})'));
        return;
      }
      if (vocabulary.length > 0 && !vocabulary.includes(entry.canonical_field)) {
        errors.push(invalidField(`${path}.canonical_field`, `"${entry.canonical_field}" is not a field of the ${kind} envelope draft`));
      } else if (seenCanonical.has(entry.canonical_field) || constantCanonical.has(entry.canonical_field) || computedCanonical.has(entry.canonical_field)) {
        errors.push(invalidField(`${path}.canonical_field`, `canonical field "${entry.canonical_field}" is already mapped`));
      } else {
        computedCanonical.add(entry.canonical_field);
      }
    });
    if (kind === 'deliverable' && !computedCanonical.has('payloadDigest')) {
      errors.push(invalidField('computed', 'a deliverable table MUST compute payloadDigest (the payload law — the opaque content is pinned at the boundary)'));
    }
    if (kind !== 'deliverable' && computedCanonical.size > 0) {
      errors.push(invalidField('computed', 'only a deliverable table computes fields'));
    }
  }

  // Tolerated.
  if (value.tolerated === undefined) {
    errors.push(missingField('tolerated'));
  } else if (!isUniqueNonEmptyStringArray(value.tolerated)) {
    errors.push(invalidField('tolerated', 'must be an array of unique non-empty raw field names'));
  } else {
    for (const toleratedField of value.tolerated) {
      if (seenRaw.has(toleratedField)) {
        errors.push(invalidField('tolerated', `"${toleratedField}" is both mapped and tolerated — a raw field has exactly one disposition`));
        break;
      }
    }
  }

  // Instant policy.
  if (value.instant_policy === undefined) {
    errors.push(missingField('instant_policy'));
  } else if (!isInstantPolicy(value.instant_policy)) {
    errors.push(invalidField('instant_policy', 'must be a declared instant policy (instant_basis, instant_field, canonical_field)'));
  } else if (kind !== undefined) {
    const policy = value.instant_policy as InstantPolicy;
    if (policy.canonical_field !== INSTANT_TARGETS[kind]) {
      errors.push(invalidField('instant_policy.canonical_field', `the ${kind} table's instant policy feeds "${INSTANT_TARGETS[kind]}" (got "${policy.canonical_field}")`));
    }
    if (seenCanonical.has(policy.canonical_field)) {
      errors.push(invalidField('instant_policy', `"${policy.canonical_field}" is both the instant-policy target and a mapped field — a canonical field has exactly one source`));
    } else {
      seenCanonical.add(policy.canonical_field);
    }
    if (policy.instant_basis === 'raw-field' && policy.instant_field !== null) {
      const mappedSomewhere =
        (Array.isArray(value.fields) && (value.fields as readonly { raw_field?: unknown }[]).some((entry) => isRecord(entry) && entry.raw_field === policy.instant_field)) ||
        (Array.isArray(value.structured) && (value.structured as readonly { raw_field?: unknown }[]).some((entry) => isRecord(entry) && entry.raw_field === policy.instant_field)) ||
        (Array.isArray(value.tolerated) && (value.tolerated as readonly unknown[]).includes(policy.instant_field));
      if (mappedSomewhere) {
        errors.push(invalidField('instant_policy', `"${policy.instant_field}" is both the instant-policy field and a mapped or tolerated field — a raw field has exactly one disposition`));
      } else {
        seenRaw.add(policy.instant_field);
      }
    }
  }

  // Coverage: fields + structured + constants + computed + instant + injected
  // must cover every canonical field of the kind's draft.
  if (kind !== undefined) {
    for (const canonicalField of CANONICAL_VOCABULARY[kind]) {
      if (SESSION_INJECTED_FIELDS.includes(canonicalField)) continue; // the session injects the L12 scope
      const covered =
        seenCanonical.has(canonicalField) ||
        constantCanonical.has(canonicalField) ||
        computedCanonical.has(canonicalField) ||
        (value.instant_policy !== undefined && isInstantPolicy(value.instant_policy) && (value.instant_policy as InstantPolicy).canonical_field === canonicalField);
      if (!covered) {
        errors.push(invalidField('fields', `the canonical field "${canonicalField}" of the ${kind} envelope draft is covered by neither a mapping, a structured carry, a constant, a computed field nor the instant policy`));
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  // Normalize defaults (identity transform, required=true) and freeze.
  const normalized: MappingTable = {
    table_id: value.table_id as string,
    envelope_kind: value.envelope_kind as EnvelopeKind,
    fields: (value.fields as readonly Record<string, unknown>[]).map((entry) => ({
      raw_field: entry.raw_field as string,
      canonical_field: entry.canonical_field as string,
      transform: entry.transform === undefined ? { kind: 'identity' } : (entry.transform as FieldTransform),
      required: entry.required === undefined ? true : (entry.required as boolean),
    })),
    structured: value.structured as readonly StructuredCarry[],
    constants: value.constants as readonly ConstantField[],
    computed: value.computed as readonly ComputedField[],
    tolerated: value.tolerated as readonly string[],
    instant_policy: value.instant_policy as InstantPolicy,
  };
  return { ok: true, value: deepFreeze(normalized as unknown) as unknown as MappingTable };
}

// ---------------------------------------------------------------------------
// Transform application (pure; typed problems, never throws)
// ---------------------------------------------------------------------------

/** The mapping context: the receive instant + the session's L12 scope. */
export interface MappingContext {
  /** The message's receive instant (the availability clock — the only injected instant). */
  readonly receiveAt: TimestampMs;
  /** The session's tenant/project scope (L12 — injected into every draft, never read from the wire). */
  readonly tenantId: string;
  readonly projectId: string;
}

/** Outcome of applying a table to one raw wire payload. */
export type MappingOutcome =
  | { readonly ok: true; readonly draft: Record<string, unknown> }
  | { readonly ok: false; readonly problems: readonly string[] };

/** Writes a value at a dotted canonical path into the draft (creating intermediate objects). */
function writeCanonical(draft: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let node: Record<string, unknown> = draft;
  for (let index = 0; index < parts.length - 1; index++) {
    const part = parts[index] as string;
    const existing = node[part];
    if (!isRecord(existing)) {
      const next: Record<string, unknown> = {};
      node[part] = next;
      node = next;
    } else {
      node = existing as Record<string, unknown>;
    }
  }
  node[parts[parts.length - 1] as string] = value;
}

/** Applies one scalar transform. Pure; problems on failure. */
function applyScalar(transform: FieldTransform, rawValue: unknown, path: string): { ok: true; value: unknown } | { ok: false; problem: string } {
  switch (transform.kind) {
    case 'identity':
      return { ok: true, value: rawValue };
    case 'enum': {
      if (typeof rawValue !== 'string') {
        return { ok: false, problem: `${path}: enum transforms require a string input, got ${typeof rawValue}` };
      }
      const mapped = transform.map[rawValue];
      if (mapped === undefined) {
        return { ok: false, problem: `${path}: raw enum value "${rawValue}" is not a declared key of the enum map` };
      }
      return { ok: true, value: mapped };
    }
    case 'instant': {
      if (rawValue === null) return { ok: true, value: null };
      if (!isTimestampMs(rawValue)) {
        return { ok: false, problem: `${path}: "${String(rawValue)}" is not a valid epoch-millisecond instant (or null)` };
      }
      return { ok: true, value: rawValue };
    }
  }
}

/** Transforms ONE wire offer into its canonical shape (pure; problems on failure). */
function transformOffer(
  offer: unknown,
  index: number,
  deliverableKindMap: Readonly<Record<string, string>>,
  verificationKindMap: Readonly<Record<string, string>>,
): { ok: true; value: Record<string, unknown> } | { ok: false; problem: string } {
  if (!isRecord(offer)) {
    return { ok: false, problem: `offers[${index}]: each wire offer must be an object` };
  }
  const offerRef = offer.offerId;
  if (!isNonEmptyString(offerRef)) return { ok: false, problem: `offers[${index}].offerId: must be a non-empty offer reference` };
  const capabilityKey = offer.capability;
  if (!isNonEmptyString(capabilityKey)) return { ok: false, problem: `offers[${index}].capability: must be a non-empty capability-contract key` };
  const summary = offer.summary;
  if (!isNonEmptyString(summary)) return { ok: false, problem: `offers[${index}].summary: must be a non-empty summary` };
  if (!Array.isArray(offer.evidence) || offer.evidence.length === 0) {
    return { ok: false, problem: `offers[${index}].evidence: must be a NON-EMPTY array of measured evidence (L16a — a bare claim is a label)` };
  }
  const measuredEvidence: MeasuredEvidenceMirror[] = [];
  for (let evidenceIndex = 0; evidenceIndex < offer.evidence.length; evidenceIndex++) {
    const evidence = offer.evidence[evidenceIndex];
    if (!isMeasuredEvidenceMirror(evidence)) {
      return { ok: false, problem: `offers[${index}].evidence[${evidenceIndex}]: failed the closed MeasuredEvidence union (benchmark | measurement-record | result-ref)` };
    }
    measuredEvidence.push(evidence);
  }
  const scope = offer.scope;
  if (!isRecord(scope) || !Array.isArray(scope.environments) || !Array.isArray(scope.instruments)) {
    return { ok: false, problem: `offers[${index}].scope: must carry environments[] and instruments[] (opaque refs)` };
  }
  const applicability = {
    environmentProfileRefs: scope.environments as readonly EnvironmentProfileRef[],
    instrumentClassRefs: scope.instruments as readonly InstrumentClassRef[],
  } as unknown as SkillApplicabilityMirror;
  if (!isSkillApplicabilityMirror(applicability)) {
    return { ok: false, problem: `offers[${index}].scope: invalid applicability refs (opaque non-space, <= 1024 chars, no control characters)` };
  }
  if (!Array.isArray(offer.deliverableTypes) || offer.deliverableTypes.length === 0) {
    return { ok: false, problem: `offers[${index}].deliverableTypes: must be a NON-EMPTY array of wire deliverable-type codes` };
  }
  const deliverableKinds: DeliverableKind[] = [];
  for (const rawKind of offer.deliverableTypes) {
    const mapped = deliverableKindMap[String(rawKind)];
    if (mapped === undefined) {
      return { ok: false, problem: `offers[${index}].deliverableTypes: wire code "${String(rawKind)}" has no declared canonical DeliverableKind` };
    }
    deliverableKinds.push(mapped as DeliverableKind);
  }
  if (!Array.isArray(offer.verificationTypes) || offer.verificationTypes.length === 0) {
    return { ok: false, problem: `offers[${index}].verificationTypes: must be a NON-EMPTY array of wire verification-type codes` };
  }
  const verificationKinds: VerificationKind[] = [];
  for (const rawKind of offer.verificationTypes) {
    const mapped = verificationKindMap[String(rawKind)];
    if (mapped === undefined) {
      return { ok: false, problem: `offers[${index}].verificationTypes: wire code "${String(rawKind)}" has no declared canonical VerificationKind` };
    }
    verificationKinds.push(mapped as VerificationKind);
  }
  return {
    ok: true,
    value: {
      offerRef,
      capabilityKey,
      summary,
      measuredEvidence,
      applicability,
      deliverableKinds,
      verificationKinds,
    },
  };
}

/** Transforms ONE wire claim into its canonical shape (pure; problems on failure). */
function transformClaim(claim: unknown, index: number): { ok: true; value: ProviderClaim } | { ok: false; problem: string } {
  if (!isRecord(claim)) {
    return { ok: false, problem: `claims[${index}]: each wire claim must be an object` };
  }
  const candidate: unknown = {
    claimRef: claim.claimId,
    capabilityKey: claim.capability,
    measuredEvidence: claim.evidence,
  };
  if (!isProviderClaim(candidate)) {
    return { ok: false, problem: `claims[${index}]: failed the ProviderClaim shape (claimId + capability + NON-EMPTY evidence — L16a)` };
  }
  return { ok: true, value: candidate };
}

/**
 * Applies a declared table to one raw wire payload: accounts for every
 * raw field (the anti-silent-drop law), applies the scalar transforms,
 * the structured carries, the constants, the computed digest and the
 * instant policy, injects the L12 scope, and assembles the canonical
 * envelope draft. Pure and deterministic: the same payload + context
 * always produce the same draft, byte-identically.
 */
export function applyMappingTable(table: MappingTable, rawPayload: JsonObject, context: MappingContext): MappingOutcome {
  const problems: string[] = [];

  // 1. THE ANTI-SILENT-DROP LAW: every present raw field is accounted for.
  const accounted = new Set(accountedRawFields(table));
  for (const key of Object.keys(rawPayload)) {
    if (!accounted.has(key)) {
      problems.push(`unmapped_raw_field: the wire field "${key}" is present but accounted for by no mapping, carry, constant, computed field, tolerated declaration or instant policy — never silently dropped`);
    }
  }

  // 2. Required mapped fields are present.
  for (const field of table.fields) {
    if (field.required && rawPayload[field.raw_field] === undefined) {
      problems.push(`mapped_field_missing: the wire field "${field.raw_field}" (-> ${field.canonical_field}) is required by the declared mapping`);
    }
  }
  if (problems.length > 0) return { ok: false, problems };

  const draft: Record<string, unknown> = {};

  // 3. Scalar transforms.
  for (const field of table.fields) {
    const rawValue = rawPayload[field.raw_field];
    if (rawValue === undefined) continue; // optional and absent
    const outcome = applyScalar(field.transform, rawValue, field.raw_field);
    if (!outcome.ok) {
      problems.push(`invalid_mapped_value: ${outcome.problem}`);
      continue;
    }
    writeCanonical(draft, field.canonical_field, outcome.value);
  }

  // 4. Structured carries.
  let carriedPayload: unknown = undefined;
  for (const carry of table.structured) {
    const rawValue = rawPayload[carry.raw_field];
    if (rawValue === undefined) {
      problems.push(`mapped_field_missing: the wire field "${carry.raw_field}" (-> ${carry.canonical_field}) is required by the declared carry`);
      continue;
    }
    switch (carry.structure) {
      case 'measured-evidence': {
        if (!Array.isArray(rawValue) || rawValue.length === 0 || !rawValue.every(isMeasuredEvidenceMirror)) {
          problems.push(`invalid_mapped_value: ${carry.raw_field}: failed the closed MeasuredEvidence union (NON-EMPTY; benchmark | measurement-record | result-ref)`);
          continue;
        }
        writeCanonical(draft, carry.canonical_field, rawValue);
        break;
      }
      case 'applicability': {
        if (!isRecord(rawValue) || !Array.isArray(rawValue.environments) || !Array.isArray(rawValue.instruments)) {
          problems.push(`invalid_mapped_value: ${carry.raw_field}: must carry environments[] and instruments[]`);
          continue;
        }
        const applicability = {
          environmentProfileRefs: rawValue.environments as readonly EnvironmentProfileRef[],
          instrumentClassRefs: rawValue.instruments as readonly InstrumentClassRef[],
        } as unknown as SkillApplicabilityMirror;
        if (!isSkillApplicabilityMirror(applicability)) {
          problems.push(`invalid_mapped_value: ${carry.raw_field}: invalid applicability refs`);
          continue;
        }
        writeCanonical(draft, carry.canonical_field, applicability);
        break;
      }
      case 'verification': {
        if (!Array.isArray(rawValue) || rawValue.length === 0 || !rawValue.every(isVerificationRequirement)) {
          problems.push(`invalid_mapped_value: ${carry.raw_field}: the verification-contract echo failed the closed VerificationRequirement union (NON-EMPTY)`);
          continue;
        }
        writeCanonical(draft, carry.canonical_field, rawValue as readonly VerificationRequirement[]);
        break;
      }
      case 'offers': {
        if (!Array.isArray(rawValue) || rawValue.length === 0) {
          problems.push(`invalid_mapped_value: ${carry.raw_field}: must be a NON-EMPTY array of wire offers`);
          continue;
        }
        const deliverableKindMap = carry.deliverable_kind_map ?? {};
        const verificationKindMap = carry.verification_kind_map ?? {};
        const offers: Record<string, unknown>[] = [];
        for (let index = 0; index < rawValue.length; index++) {
          const outcome = transformOffer(rawValue[index], index, deliverableKindMap, verificationKindMap);
          if (!outcome.ok) {
            problems.push(`invalid_mapped_value: ${carry.raw_field}.${outcome.problem}`);
            continue;
          }
          offers.push(outcome.value);
        }
        writeCanonical(draft, carry.canonical_field, offers);
        break;
      }
      case 'claims': {
        if (!Array.isArray(rawValue) || rawValue.length === 0) {
          problems.push(`invalid_mapped_value: ${carry.raw_field}: must be a NON-EMPTY array of wire claims`);
          continue;
        }
        const claims: ProviderClaim[] = [];
        for (let index = 0; index < rawValue.length; index++) {
          const outcome = transformClaim(rawValue[index], index);
          if (!outcome.ok) {
            problems.push(`invalid_mapped_value: ${carry.raw_field}.${outcome.problem}`);
            continue;
          }
          claims.push(outcome.value);
        }
        writeCanonical(draft, carry.canonical_field, claims);
        break;
      }
      case 'payload': {
        if (!isJsonValue(rawValue)) {
          problems.push(`invalid_mapped_value: ${carry.raw_field}: must be a JSON value (the opaque provider content)`);
          continue;
        }
        carriedPayload = rawValue;
        writeCanonical(draft, carry.canonical_field, rawValue);
        break;
      }
    }
  }

  // 5. Constants.
  for (const constant of table.constants) {
    writeCanonical(draft, constant.canonical_field, constant.value);
  }

  // 6. The instant policy (L4 — the declared derivation).
  if (table.instant_policy.instant_basis === 'receive-time') {
    writeCanonical(draft, table.instant_policy.canonical_field, context.receiveAt);
  } else {
    const rawValue = rawPayload[table.instant_policy.instant_field as string];
    if (!isTimestampMs(rawValue)) {
      problems.push(`invalid_time_field: the wire field "${String(table.instant_policy.instant_field)}" (-> ${table.instant_policy.canonical_field}) is not a valid epoch-millisecond instant`);
    } else {
      writeCanonical(draft, table.instant_policy.canonical_field, rawValue);
    }
  }

  // 7. The L12 scope: injected by the session, never read from the wire.
  writeCanonical(draft, 'tenantId', context.tenantId);
  writeCanonical(draft, 'projectId', context.projectId);

  // 8. Computed fields: the payload digest (the payload law).
  for (const computed of table.computed) {
    if (computed.kind === 'payload-digest') {
      if (carriedPayload === undefined) {
        problems.push('mapped_field_missing: payloadDigest cannot be computed — the payload carry is missing');
        continue;
      }
      writeCanonical(draft, computed.canonical_field, stableDigestJson(carriedPayload));
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, draft };
}
