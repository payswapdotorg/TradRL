// @tradrl/body-fundamental-researcher — the structured corporate-action digest.
//
// Owning Work Order: T023, section 5 (capabilities): "corporate-action
// digestion". A CorporateActionDigest is what the corporate-action
// digestion method produces when corporate-action observations CLUSTER
// (declared window, declared minimum count, declared knowledge-time
// basis — L4-honest clustering). Every field is enumerated: the declared
// action taxonomy, the sorted affected instruments, the window bounds,
// the full evidence lineage with provenance blocks, the as-of instant,
// the declared method citation, the body version, tenant and project.
// The IMPLICATION stance comes from the method's declared action table —
// a free-form implication is unlawful (`implication_mismatch`). NO free
// text — a digest is a structured summary, not a narrative.
//
// Laws held: L4 (citations never future — `future_evidence`), L9
// (evidence never empty — `evidence_missing`; derived id —
// `digest_mismatch`), L12 (tenant/project required), method honesty
// (kind 'corporate-action-digestion'), immutability (deepFreeze),
// determinism (derived id `cad-<digest>` over the canonical form).

import {
  type TimestampMs,
  canonicalJson,
  deepFreeze,
  isNonEmptyString,
  isNonNegativeInteger,
  isRecord,
  isTimestampMs,
  stableDigest,
  type JsonValue,
} from './primitives';
import {
  type BodyVersionRef,
  type CorporateActionDigestId,
  type FundamentalMethodId,
  type FundamentalMethodVersionRef,
  type ProjectId,
  type TenantId,
  isBodyVersionRef,
  isFundamentalMethodId,
  isFundamentalMethodVersionRef,
  isProjectId,
  isTenantId,
} from './ids';
import {
  type FundamentalMethodRegistry,
  type CorporateActionKind,
  type ImplicationStance,
  CORPORATE_ACTION_KINDS,
  IMPLICATION_STANCES,
  findFundamentalMethod,
  resolveFundamentalMethodCitation,
} from './methods';
import { type ObservationCitation, isObservationCitation, validateObservationCitation } from './assessment';
import { type FundamentalError, type FundamentalResult, type FundamentalValidation, invalidField, invalidType, validationOf } from './errors';

// ---------------------------------------------------------------------------
// The digest window
// ---------------------------------------------------------------------------

/**
 * The knowledge-time window an action cluster was detected over (bounds
 * are `available_time` instants of the clustered observations — the
 * declared `windowBasis: 'available-time'`, never a wall clock).
 */
export interface ActionWindow {
  readonly from: TimestampMs;
  readonly to: TimestampMs;
}

/** Guard: `ActionWindow`. */
export function isActionWindow(v: unknown): v is ActionWindow {
  if (!isRecord(v)) return false;
  return isTimestampMs(v.from) && isTimestampMs(v.to) && (v.from as number) <= (v.to as number);
}

// ---------------------------------------------------------------------------
// CorporateActionDigest
// ---------------------------------------------------------------------------

/**
 * THE structured corporate-action summary. Enumerated fields only: the
 * action kind (closed taxonomy), instruments affected (sorted, unique,
 * non-empty), venues (sorted, unique), the detection window, the
 * observation count, the DECLARED implication stance (from the method's
 * action table), non-empty point-in-time evidence with provenance, the
 * as-of instant, the declared corporate-action-digestion method
 * citation, the body version, tenant/project.
 */
export interface CorporateActionDigest {
  readonly digestId: CorporateActionDigestId;
  readonly action: CorporateActionKind;
  /** The instruments affected (sorted, unique, non-empty). */
  readonly instruments: readonly string[];
  /** The venue scopes of the clustered observations (sorted, unique). */
  readonly venues: readonly string[];
  readonly window: ActionWindow;
  /** How many observations the cluster contains. */
  readonly observationCount: number;
  /** The DECLARED implication stance (from the method's action table). */
  readonly implication: ImplicationStance;
  readonly evidence: readonly ObservationCitation[];
  /** The L4 instant this digest was computed as of. */
  readonly asOf: TimestampMs;
  readonly methodId: FundamentalMethodId;
  readonly methodVersion: FundamentalMethodVersionRef;
  readonly bodyVersion: BodyVersionRef;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
}

/** Derives the digest id: `cad-<stableDigest16>` over the canonical form. */
export function deriveCorporateActionDigestId(digest: Omit<CorporateActionDigest, 'digestId'>): CorporateActionDigestId {
  return `cad-${stableDigest(canonicalJson(digest as unknown as JsonValue))}` as CorporateActionDigestId;
}

/** Guard: `CorporateActionDigest` (structure only — use `validateCorporateActionDigest` for the laws). */
export function isCorporateActionDigest(v: unknown): v is CorporateActionDigest {
  if (!isRecord(v)) return false;
  return (
    typeof v.digestId === 'string' &&
    v.digestId.startsWith('cad-') &&
    typeof v.action === 'string' &&
    (CORPORATE_ACTION_KINDS as readonly string[]).includes(v.action) &&
    Array.isArray(v.instruments) &&
    (v.instruments as readonly unknown[]).length > 0 &&
    (v.instruments as readonly unknown[]).every((i) => isNonEmptyString(i)) &&
    Array.isArray(v.venues) &&
    (v.venues as readonly unknown[]).every((i) => isNonEmptyString(i)) &&
    isActionWindow(v.window) &&
    isNonNegativeInteger(v.observationCount) &&
    typeof v.implication === 'string' &&
    (IMPLICATION_STANCES as readonly string[]).includes(v.implication) &&
    Array.isArray(v.evidence) &&
    (v.evidence as readonly unknown[]).every((c) => isObservationCitation(c)) &&
    isTimestampMs(v.asOf) &&
    isFundamentalMethodId(v.methodId) &&
    isFundamentalMethodVersionRef(v.methodVersion) &&
    isBodyVersionRef(v.bodyVersion) &&
    isTenantId(v.tenantId) &&
    isProjectId(v.projectId) &&
    isNonEmptyString(v.seed)
  );
}

/**
 * COLLECT-ALL validation of a corporate-action digest against every
 * research law: declared taxonomy, sorted/unique instruments + venues,
 * window bounds, observation-count consistency with evidence, evidence
 * completeness (L9), point-in-time citations (L4), method honesty
 * ('corporate-action-digestion' + the declared implication table),
 * tenant/project (L12), derived-id law.
 */
export function validateCorporateActionDigest(v: unknown, registry: FundamentalMethodRegistry): readonly FundamentalError[] {
  const errors: FundamentalError[] = [];
  if (!isRecord(v)) return [invalidType('digest', 'a corporate-action digest object')];
  if (typeof v.digestId !== 'string' || !v.digestId.startsWith('cad-')) {
    errors.push(invalidField('digestId', "must be a derived digest id ('cad-<digest>')"));
  }
  if (typeof v.action !== 'string' || !(CORPORATE_ACTION_KINDS as readonly string[]).includes(v.action)) {
    errors.push({
      code: 'unknown_action_kind',
      path: 'action',
      message: `must be one of the declared corporate-action kinds (${CORPORATE_ACTION_KINDS.join('|')}) — the taxonomy is CLOSED`,
    });
  }
  if (typeof v.implication !== 'string' || !(IMPLICATION_STANCES as readonly string[]).includes(v.implication)) {
    errors.push({
      code: 'unknown_stance_direction',
      path: 'implication',
      message: `must be one of the declared implication stances (${IMPLICATION_STANCES.join('|')})`,
    });
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
  if (!isActionWindow(v.window)) {
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
    ...resolveFundamentalMethodCitation(registry, v.methodId, v.methodVersion, 'corporate-action-digestion').map((e) => ({
      ...e,
      path: e.path.startsWith('method') ? e.path : `method.${e.path}`,
    })),
  );

  // THE DECLARED IMPLICATION TABLE law: the implication must equal the
  // declared table's stance for the digest's action kind.
  const method = isFundamentalMethodId(v.methodId) ? findFundamentalMethod(registry, v.methodId) : null;
  if (
    method !== null &&
    method.kind === 'corporate-action-digestion' &&
    typeof v.action === 'string' &&
    (CORPORATE_ACTION_KINDS as readonly string[]).includes(v.action) &&
    typeof v.implication === 'string' &&
    (IMPLICATION_STANCES as readonly string[]).includes(v.implication)
  ) {
    const table = method.parameters.kind === 'corporate-action-digestion' ? method.parameters.implications : [];
    const entry = table.find((candidate) => candidate.action === v.action);
    if (entry !== undefined && entry.implication !== v.implication) {
      errors.push({
        code: 'implication_mismatch',
        path: 'implication',
        message: `action '${v.action}' declares implication '${entry.implication}' in the method's table — the digest claims '${v.implication}'`,
      });
    }
  }

  if (!Array.isArray(v.evidence)) {
    errors.push(invalidType('evidence', 'an array of observation citations'));
  } else {
    const evidence = v.evidence as readonly unknown[];
    if (evidence.length === 0) {
      // THE evidence law: an evidence-less research output fails validation.
      errors.push({
        code: 'evidence_missing',
        path: 'evidence',
        message: 'a corporate-action digest without observation citations is an unsupported claim',
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

  // derived-id law (tamper trip-wire)
  if (typeof v.digestId === 'string' && v.digestId.startsWith('cad-') && errors.length === 0) {
    const { digestId: _ignored, ...material } = v as unknown as CorporateActionDigest;
    void _ignored;
    if (deriveCorporateActionDigestId(material as Omit<CorporateActionDigest, 'digestId'>) !== v.digestId) {
      errors.push({
        code: 'digest_mismatch',
        path: 'digestId',
        message: 'the digest id does not match its canonical content — the record was tampered with',
      });
    }
  }
  return errors;
}

/** Validation wrapper: `CorporateActionDigest`. */
export function validateCorporateActionDigestRecord(v: unknown, registry: FundamentalMethodRegistry): FundamentalValidation<CorporateActionDigest> {
  const errors = validateCorporateActionDigest(v, registry);
  return validationOf(errors.length === 0 ? (v as CorporateActionDigest) : null, errors);
}

/**
 * Creates a validated, deeply-frozen corporate-action digest. The
 * `digestId` is DERIVED from the canonical form of the draft; the draft
 * must satisfy every research law. Refusal is typed data.
 */
export function createCorporateActionDigest(
  draft: Omit<CorporateActionDigest, 'digestId'>,
  registry: FundamentalMethodRegistry,
): FundamentalResult<CorporateActionDigest> {
  const errors = validateCorporateActionDigest({ ...draft, digestId: 'cad-pending' }, registry).filter(
    (error) => error.path !== 'digestId',
  );
  if (errors.length > 0) return { ok: false, errors };
  const digestId = deriveCorporateActionDigestId(draft);
  return { ok: true, value: deepFreeze({ ...draft, digestId }) };
}

/** Canonical serialization of a digest (byte-deterministic, L9). */
export function serializeCorporateActionDigest(digest: CorporateActionDigest): string {
  return canonicalJson(digest as unknown as JsonValue);
}
