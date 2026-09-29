// @tradrl/body-sentiment-researcher — the structured event digest.
//
// Owning Work Order: T021, section 5: "EventDigest — structured event
// summaries: event kind (declared taxonomy), instruments affected,
// evidence refs, as-of, lineage."
//
// An EventDigest is what the event-detection method produces when news
// observations CLUSTER (declared window, declared minimum count, declared
// knowledge-time basis — L4-honest clustering). Every field is
// enumerated: the declared event taxonomy, the sorted affected
// instruments, the window bounds, the full evidence lineage with
// provenance blocks, the as-of instant, the declared method citation,
// the body version, tenant and project. NO free text — a digest is a
// structured summary, not a narrative.
//
// Laws held: L4 (citations never future — `future_evidence`), L9
// (evidence never empty — `evidence_missing`; derived id —
// `digest_mismatch`), L12 (tenant/project required), method honesty
// (kind 'event-detection'), immutability (deepFreeze), determinism
// (derived id `ed-<digest>` over the canonical form).

import {
  type TimestampMs,
  canonicalJson,
  deepFreeze,
  isNonEmptyString,
  isNonNegativeInteger,
  isPositiveInteger,
  isRecord,
  isTimestampMs,
  stableDigest,
  type JsonValue,
} from './primitives';
import {
  type BodyVersionRef,
  type EventDigestId,
  type MethodId,
  type MethodVersionRef,
  type ProjectId,
  type TenantId,
  isBodyVersionRef,
  isMethodId,
  isMethodVersionRef,
  isProjectId,
  isTenantId,
} from './ids';
import { type MethodRegistry, resolveMethodCitation, type EventKind, EVENT_KINDS, isEventKind } from './methods';
import { type ObservationCitation, isObservationCitation, validateObservationCitation } from './reading';
import { type ResearchError, type ResearchResult, type ResearchValidation, invalidField, invalidType, validationOf } from './errors';

// ---------------------------------------------------------------------------
// The digest window
// ---------------------------------------------------------------------------

/**
 * The knowledge-time window an event was detected over (bounds are
 * `available_time` instants of the clustered observations — the declared
 * `windowBasis: 'available-time'`, never a wall clock).
 */
export interface EventWindow {
  readonly from: TimestampMs;
  readonly to: TimestampMs;
}

/** Guard: `EventWindow`. */
export function isEventWindow(v: unknown): v is EventWindow {
  if (!isRecord(v)) return false;
  return isTimestampMs(v.from) && isTimestampMs(v.to) && (v.from as number) <= (v.to as number);
}

// ---------------------------------------------------------------------------
// EventDigest
// ---------------------------------------------------------------------------

/**
 * THE structured event summary. Enumerated fields only: kind (taxonomy),
 * instruments affected (sorted, unique), venues (sorted, unique), the
 * detection window, the observation count, non-empty point-in-time
 * evidence with provenance, the as-of instant, the declared
 * event-detection method citation, the body version, tenant/project.
 */
export interface EventDigest {
  readonly digestId: EventDigestId;
  readonly kind: EventKind;
  /** The instruments affected (sorted, unique, non-empty). */
  readonly instruments: readonly string[];
  /** The venue scopes of the clustered observations (sorted, unique). */
  readonly venues: readonly string[];
  readonly window: EventWindow;
  /** How many observations the cluster contains. */
  readonly observationCount: number;
  readonly evidence: readonly ObservationCitation[];
  /** The L4 instant this digest was computed as of. */
  readonly asOf: TimestampMs;
  readonly methodId: MethodId;
  readonly methodVersion: MethodVersionRef;
  readonly bodyVersion: BodyVersionRef;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
}

/** Derives the digest id: `ed-<stableDigest16>` over the canonical form. */
export function deriveEventDigestId(digest: Omit<EventDigest, 'digestId'>): EventDigestId {
  return `ed-${stableDigest(canonicalJson(digest as unknown as JsonValue))}` as EventDigestId;
}

/** Guard: `EventDigest` (structure only — use `validateEventDigest` for the laws). */
export function isEventDigest(v: unknown): v is EventDigest {
  if (!isRecord(v)) return false;
  return (
    typeof v.digestId === 'string' &&
    v.digestId.startsWith('ed-') &&
    isEventKind(v.kind) &&
    Array.isArray(v.instruments) &&
    (v.instruments as readonly unknown[]).every((i) => isNonEmptyString(i)) &&
    Array.isArray(v.venues) &&
    (v.venues as readonly unknown[]).every((i) => isNonEmptyString(i)) &&
    isEventWindow(v.window) &&
    isNonNegativeInteger(v.observationCount) &&
    Array.isArray(v.evidence) &&
    (v.evidence as readonly unknown[]).every((c) => isObservationCitation(c)) &&
    isTimestampMs(v.asOf) &&
    isMethodId(v.methodId) &&
    isMethodVersionRef(v.methodVersion) &&
    isBodyVersionRef(v.bodyVersion) &&
    isTenantId(v.tenantId) &&
    isProjectId(v.projectId) &&
    isNonEmptyString(v.seed)
  );
}

/**
 * COLLECT-ALL validation of an event digest against every research law:
 * declared taxonomy, sorted/unique instruments + venues, window bounds,
 * observation-count consistency with evidence, evidence completeness
 * (L9), point-in-time citations (L4), method honesty
 * ('event-detection'), tenant/project (L12), derived-id law.
 */
export function validateEventDigest(v: unknown, registry: MethodRegistry): readonly ResearchError[] {
  const errors: ResearchError[] = [];
  if (!isRecord(v)) return [invalidType('digest', 'an event digest object')];
  if (typeof v.digestId !== 'string' || !v.digestId.startsWith('ed-')) {
    errors.push(invalidField('digestId', "must be a derived digest id ('ed-<digest>')"));
  }
  if (!isEventKind(v.kind)) {
    errors.push(invalidField('kind', `must be one of the declared event kinds (${EVENT_KINDS.slice(0, 3).join('|')}|...)`));
  }
  if (!Array.isArray(v.instruments) || (v.instruments as readonly unknown[]).length === 0) {
    errors.push(invalidField('instruments', 'must be a non-empty array of affected instruments'));
  } else {
    const instruments = v.instruments as readonly string[];
    if (!instruments.every((i) => isNonEmptyString(i))) {
      errors.push(invalidField('instruments', 'every instrument must be a non-empty string'));
    }
    const sorted = instruments.slice().sort();
    if (JSON.stringify(sorted) !== JSON.stringify(instruments)) {
      errors.push(invalidField('instruments', 'must be sorted (canonical order)'));
    }
    if (new Set(instruments).size !== instruments.length) {
      errors.push(invalidField('instruments', 'must be unique'));
    }
  }
  if (Array.isArray(v.venues)) {
    const venues = v.venues as readonly string[];
    if (!venues.every((i) => isNonEmptyString(i))) {
      errors.push(invalidField('venues', 'every venue must be a non-empty string'));
    }
    const sorted = venues.slice().sort();
    if (JSON.stringify(sorted) !== JSON.stringify(venues)) {
      errors.push(invalidField('venues', 'must be sorted (canonical order)'));
    }
    if (new Set(venues).size !== venues.length) {
      errors.push(invalidField('venues', 'must be unique'));
    }
  } else {
    errors.push(invalidField('venues', 'must be an array of venue scopes'));
  }
  if (!isEventWindow(v.window)) {
    errors.push(invalidField('window', 'must be { from, to } instants with from <= to'));
  }
  if (!isNonNegativeInteger(v.observationCount)) {
    errors.push(invalidField('observationCount', 'must be a non-negative integer'));
  }
  const asOfOk = isTimestampMs(v.asOf);
  if (!asOfOk) errors.push(invalidField('asOf', 'must be a valid epoch-millisecond instant'));
  if (!isBodyVersionRef(v.bodyVersion)) {
    errors.push(invalidField('bodyVersion', 'must be a canonical body-version reference'));
  }
  if (!isTenantId(v.tenantId)) {
    errors.push({ code: 'tenant_missing', path: 'tenantId', message: 'every research record carries a TenantId (L12)' });
  }
  if (!isProjectId(v.projectId)) {
    errors.push({ code: 'project_missing', path: 'projectId', message: 'every research record carries a ProjectId (L12)' });
  }
  if (!isNonEmptyString(v.seed)) errors.push(invalidField('seed', 'must be a non-empty seed string'));
  errors.push(
    ...resolveMethodCitation(registry, v.methodId, v.methodVersion, 'event-detection').map((e) => ({ ...e, path: e.path.startsWith('method') ? e.path : `method.${e.path}` })),
  );

  if (!Array.isArray(v.evidence)) {
    errors.push(invalidType('evidence', 'an array of observation citations'));
  } else {
    const evidence = v.evidence as readonly unknown[];
    if (evidence.length === 0) {
      // THE evidence law: an evidence-less research output fails validation.
      errors.push({
        code: 'evidence_missing',
        path: 'evidence',
        message: 'an event digest without observation citations is an unsupported claim',
      });
    }
    const ids: string[] = [];
    evidence.forEach((citation: unknown, index: number) => {
      errors.push(...validateObservationCitation(citation, `evidence[${index}]`));
      if (isRecord(citation) && isNonEmptyString(citation.observationId)) {
        ids.push(citation.observationId as string);
      }
      if (
        isRecord(citation) &&
        isTimestampMs(citation.availableTime) &&
        asOfOk &&
        (citation.availableTime as number) > (v.asOf as number)
      ) {
        // THE L4 law: citing future data is a typed error.
        errors.push({
          code: 'future_evidence',
          path: `evidence[${index}].availableTime`,
          message: `observation ${JSON.stringify(citation.observationId)} is not knowable at the declared as-of instant`,
        });
      }
    });
    if (new Set(ids).size !== ids.length) {
      errors.push({
        code: 'duplicate_observation_ref',
        path: 'evidence',
        message: 'evidence citations must be unique observation ids',
      });
    }
    if (isNonNegativeInteger(v.observationCount) && (v.observationCount as number) !== evidence.length) {
      errors.push({
        code: 'report_composition_mismatch',
        path: 'observationCount',
        message: 'the declared observation count must equal the evidence length',
      });
    }
  }

  if (isPositiveInteger(v.observationCount) === false && isNonNegativeInteger(v.observationCount)) {
    // zero-count digests are impossible here: the evidence law requires a
    // non-empty cluster and the count must equal the evidence length.
    errors.push(invalidField('observationCount', 'an event digest covers at least one observation'));
  }

  // derived-id law (tamper trip-wire)
  if (typeof v.digestId === 'string' && v.digestId.startsWith('ed-') && errors.length === 0) {
    const { digestId: _ignored, ...material } = v as unknown as EventDigest;
    void _ignored;
    if (deriveEventDigestId(material as Omit<EventDigest, 'digestId'>) !== v.digestId) {
      errors.push({
        code: 'digest_mismatch',
        path: 'digestId',
        message: 'the digest id does not match its canonical content — the record was tampered with',
      });
    }
  }
  return errors;
}

/** Validation wrapper: `EventDigest`. */
export function validateEventDigestRecord(v: unknown, registry: MethodRegistry): ResearchValidation<EventDigest> {
  const errors = validateEventDigest(v, registry);
  return validationOf(errors.length === 0 ? (v as EventDigest) : null, errors);
}

/**
 * Creates a validated, deeply-frozen event digest. The `digestId` is
 * DERIVED from the canonical form of the draft; the draft must satisfy
 * every research law. Refusal is typed data.
 */
export function createEventDigest(
  draft: Omit<EventDigest, 'digestId'>,
  registry: MethodRegistry,
): ResearchResult<EventDigest> {
  const errors = validateEventDigest({ ...draft, digestId: 'ed-pending' }, registry).filter(
    (error) => error.path !== 'digestId',
  );
  if (errors.length > 0) return { ok: false, errors };
  const digestId = deriveEventDigestId(draft);
  return { ok: true, value: deepFreeze({ ...draft, digestId }) };
}

/** Canonical serialization of a digest (byte-deterministic, L9). */
export function serializeEventDigest(digest: EventDigest): string {
  return canonicalJson(digest as unknown as JsonValue);
}
