// @tradrl/body-regime-researcher — the structured regime-change record.
//
// Owning Work Order: T022, section 5: "RegimeChange — structured
// transition records: from-regime, to-regime, detection instant, evidence
// refs, lineage."
//
// A RegimeChange is what the declared change-detection method produces
// when two CONSECUTIVE windows of the same (instrument, venue) scope
// carry DIFFERENT regime labels (the declared basis:
// 'consecutive-window-label-transition'). Every field is enumerated:
// both labels (members of the classification method's closed taxonomy),
// both window bounds, the detection instant, the full evidence lineage of
// both windows with provenance blocks, the as-of instant, the declared
// method citation, the body version, tenant and project. NO free text —
// a change record is a structured transition, not a narrative.
//
// Laws held: L4 (citations never future — `future_evidence`; the change
// is only knowable at/after the to-window closes — `timestamp_order`,
// and never after the as-of instant — `future_evidence`), L9 (evidence
// never empty — `evidence_missing`; derived id — `digest_mismatch`),
// L12 (tenant/project required), method honesty (kind
// 'regime-change-detection'; both labels inside the linked
// classification method's declared taxonomy — `regime_label_mismatch`;
// a transition between identical labels is not a change —
// `regime_label_mismatch`; windows strictly ordered — `timestamp_order`),
// immutability (deepFreeze), determinism (derived id `rx-<digest>` over
// the canonical form).

import {
  type TimestampMs,
  canonicalJson,
  deepFreeze,
  isNonEmptyString,
  isRecord,
  isTimestampMs,
  stableDigest,
  type JsonValue,
} from './primitives';
import {
  type BodyVersionRef,
  type RegimeChangeId,
  type RegimeMethodId,
  type RegimeMethodVersionRef,
  type ProjectId,
  type TenantId,
  isBodyVersionRef,
  isRegimeMethodId,
  isRegimeMethodVersionRef,
  isProjectId,
  isTenantId,
} from './ids';
import {
  type RegimeMethodRegistry,
  type RegimeChangeDetectionParameters,
  resolveRegimeMethodCitation,
  findRegimeMethod,
} from './methods';
import {
  type RegimeScope,
  type RegimeWindow,
  type MarketObservationCitation,
  isMarketObservationCitation,
  validateMarketObservationCitation,
  isRegimeScope,
  isRegimeWindow,
} from './classification';
import { type RegimeError, type RegimeResult, type RegimeValidation, invalidField, invalidType, validationOf } from './errors';

// ---------------------------------------------------------------------------
// RegimeChange
// ---------------------------------------------------------------------------

/**
 * THE structured regime transition. Enumerated fields only: scope, the
 * from/to labels (both from the classification method's declared closed
 * taxonomy), both window bounds, the detection instant (the instant the
 * transition became knowable — at or after the to-window closes, at or
 * before the as-of instant), non-empty point-in-time evidence with
 * provenance, the as-of instant, the declared change-detection method
 * citation, the body version, tenant/project.
 */
export interface RegimeChange {
  readonly changeId: RegimeChangeId;
  readonly scope: RegimeScope;
  /** The regime the scope was in (from the linked method's closed taxonomy). */
  readonly fromLabel: string;
  /** The regime the scope transitioned to (from the linked method's closed taxonomy). */
  readonly toLabel: string;
  /** The window the from-regime was classified over. */
  readonly fromWindow: RegimeWindow;
  /** The window the to-regime was classified over (strictly later). */
  readonly toWindow: RegimeWindow;
  /** The instant the transition became knowable (>= toWindow.to, <= asOf). */
  readonly detectionInstant: TimestampMs;
  /** The evidence of BOTH windows (full lineage travels with the change — L9). */
  readonly evidence: readonly MarketObservationCitation[];
  /** The L4 instant this change was computed as of. */
  readonly asOf: TimestampMs;
  readonly methodId: RegimeMethodId;
  readonly methodVersion: RegimeMethodVersionRef;
  readonly bodyVersion: BodyVersionRef;
  readonly tenantId: TenantId;
  readonly projectId: ProjectId;
  readonly seed: string;
}

/** Derives the change id: `rx-<stableDigest16>` over the canonical form. */
export function deriveRegimeChangeId(change: Omit<RegimeChange, 'changeId'>): RegimeChangeId {
  return `rx-${stableDigest(canonicalJson(change as unknown as JsonValue))}` as RegimeChangeId;
}

/** Guard: `RegimeChange` (structure only — use `validateRegimeChange` for the laws). */
export function isRegimeChange(v: unknown): v is RegimeChange {
  if (!isRecord(v)) return false;
  return (
    typeof v.changeId === 'string' &&
    v.changeId.startsWith('rx-') &&
    isRegimeScope(v.scope) &&
    isNonEmptyString(v.fromLabel) &&
    isNonEmptyString(v.toLabel) &&
    isRegimeWindow(v.fromWindow) &&
    isRegimeWindow(v.toWindow) &&
    isTimestampMs(v.detectionInstant) &&
    Array.isArray(v.evidence) &&
    (v.evidence as readonly unknown[]).every((c) => isMarketObservationCitation(c)) &&
    isTimestampMs(v.asOf) &&
    isRegimeMethodId(v.methodId) &&
    isRegimeMethodVersionRef(v.methodVersion) &&
    isBodyVersionRef(v.bodyVersion) &&
    isTenantId(v.tenantId) &&
    isProjectId(v.projectId) &&
    isNonEmptyString(v.seed)
  );
}

// ---------------------------------------------------------------------------
// Validation (collect-all — every law, every violation)
// ---------------------------------------------------------------------------

/**
 * COLLECT-ALL validation of a regime change against every research law:
 * declared method citation ('regime-change-detection'), the linked
 * classification method's closed taxonomy for both labels
 * (regime_label_mismatch), the no-identical-transition law, window
 * ordering (timestamp_order), the detection-instant window
 * (timestamp_order / future_evidence), evidence completeness (L9),
 * point-in-time citations (L4), tenant/project (L12), derived-id law.
 */
export function validateRegimeChange(v: unknown, registry: RegimeMethodRegistry): readonly RegimeError[] {
  const errors: RegimeError[] = [];
  if (!isRecord(v)) return [invalidType('change', 'a regime change object')];
  if (typeof v.changeId !== 'string' || !v.changeId.startsWith('rx-')) {
    errors.push(invalidField('changeId', "must be a derived change id ('rx-<digest>')"));
  }
  if (!isRegimeScope(v.scope)) {
    errors.push(invalidField('scope', 'must be { instrument, venue } non-empty strings'));
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

  // the declared change-detection method + its linked classification method
  errors.push(
    ...resolveRegimeMethodCitation(registry, v.methodId, v.methodVersion, 'regime-change-detection').map((e) => ({
      ...e,
      path: e.path.startsWith('method') ? e.path : `method.${e.path}`,
    })),
  );
  const detectionMethod = isRegimeMethodId(v.methodId) ? findRegimeMethod(registry, v.methodId) : null;
  const detectionParameters =
    detectionMethod !== null && detectionMethod.kind === 'regime-change-detection'
      ? (detectionMethod.parameters as RegimeChangeDetectionParameters)
      : null;
  let taxonomy: readonly string[] | null = null;
  if (detectionParameters !== null) {
    const linked = findRegimeMethod(registry, detectionParameters.classificationMethod);
    if (linked === null) {
      errors.push({
        code: 'undeclared_method',
        path: 'method.parameters.classificationMethod',
        message: `the change-detection method links to classification method ${JSON.stringify(detectionParameters.classificationMethod)} which is not declared in the registry`,
      });
    } else if (linked.kind !== 'regime-classification') {
      errors.push({
        code: 'method_kind_mismatch',
        path: 'method.parameters.classificationMethod',
        message: 'the change-detection method must link to a regime-classification method',
      });
    } else {
      taxonomy = (linked.parameters as { readonly regimes: readonly string[] }).regimes;
    }
  }

  // the label laws (both labels in the closed taxonomy; a change must change)
  for (const field of ['fromLabel', 'toLabel'] as const) {
    if (!isNonEmptyString(v[field])) {
      errors.push(invalidField(field, 'must be a regime label from the linked method\'s declared taxonomy'));
    } else if (taxonomy !== null && !taxonomy.includes(v[field] as string)) {
      errors.push({
        code: 'regime_label_mismatch',
        path: field,
        message: `label ${JSON.stringify(v[field])} is not declared in the linked classification method's closed taxonomy`,
      });
    }
  }
  if (isNonEmptyString(v.fromLabel) && isNonEmptyString(v.toLabel) && v.fromLabel === v.toLabel) {
    errors.push({
      code: 'regime_label_mismatch',
      path: 'toLabel',
      message: 'a transition between identical labels is not a change — the declared basis is consecutive-window label transition',
    });
  }

  // the window laws
  const fromWindowOk = isRegimeWindow(v.fromWindow);
  const toWindowOk = isRegimeWindow(v.toWindow);
  if (!fromWindowOk) errors.push(invalidField('fromWindow', 'must be { from, to } instants with from <= to'));
  if (!toWindowOk) errors.push(invalidField('toWindow', 'must be { from, to } instants with from <= to'));
  if (fromWindowOk && toWindowOk && (v.fromWindow as RegimeWindow).to >= (v.toWindow as RegimeWindow).from) {
    // consecutive windows are strictly ordered in knowledge time
    errors.push({
      code: 'timestamp_order',
      path: 'toWindow.from',
      message: 'the to-window must begin strictly after the from-window ends (consecutive knowledge-time windows)',
    });
  }
  const detectionOk = isTimestampMs(v.detectionInstant);
  if (!detectionOk) {
    errors.push(invalidField('detectionInstant', 'must be a valid epoch-millisecond instant'));
  } else {
    if (toWindowOk && (v.detectionInstant as number) < (v.toWindow as RegimeWindow).to) {
      errors.push({
        code: 'timestamp_order',
        path: 'detectionInstant',
        message: 'the transition is only knowable once the to-window closes (detectionInstant >= toWindow.to)',
      });
    }
    if (asOfOk && (v.detectionInstant as number) > (v.asOf as number)) {
      // THE L4 law: a change detected after the as-of instant is future data.
      errors.push({
        code: 'future_evidence',
        path: 'detectionInstant',
        message: 'the detection instant exceeds the declared as-of instant — the change was not knowable yet',
      });
    }
  }

  // evidence lineage (both windows' citations; non-empty; unique; not future)
  if (!Array.isArray(v.evidence)) {
    errors.push(invalidType('evidence', 'an array of observation citations'));
  } else {
    const evidence = v.evidence as readonly unknown[];
    if (evidence.length === 0) {
      // THE evidence law: an evidence-less research output fails validation.
      errors.push({
        code: 'evidence_missing',
        path: 'evidence',
        message: 'a regime change without observation citations is an unsupported claim',
      });
    }
    const ids: string[] = [];
    evidence.forEach((citation: unknown, index: number) => {
      errors.push(...validateMarketObservationCitation(citation, `evidence[${index}]`));
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
  }

  // derived-id law (tamper trip-wire)
  if (typeof v.changeId === 'string' && v.changeId.startsWith('rx-') && errors.length === 0) {
    const { changeId: _ignored, ...material } = v as unknown as RegimeChange;
    void _ignored;
    if (deriveRegimeChangeId(material as Omit<RegimeChange, 'changeId'>) !== v.changeId) {
      errors.push({
        code: 'digest_mismatch',
        path: 'changeId',
        message: 'the change id does not match its canonical content — the record was tampered with',
      });
    }
  }
  return errors;
}

/** Validation wrapper: `RegimeChange`. */
export function validateRegimeChangeRecord(
  v: unknown,
  registry: RegimeMethodRegistry,
): RegimeValidation<RegimeChange> {
  const errors = validateRegimeChange(v, registry);
  return validationOf(errors.length === 0 ? (v as RegimeChange) : null, errors);
}

/**
 * Creates a validated, deeply-frozen regime change. The `changeId` is
 * DERIVED from the canonical form of the draft; the draft must satisfy
 * every research law. Refusal is typed data.
 */
export function createRegimeChange(
  draft: Omit<RegimeChange, 'changeId'>,
  registry: RegimeMethodRegistry,
): RegimeResult<RegimeChange> {
  const errors = validateRegimeChange({ ...draft, changeId: 'rx-pending' }, registry).filter(
    (error) => error.path !== 'changeId',
  );
  if (errors.length > 0) return { ok: false, errors };
  const changeId = deriveRegimeChangeId(draft);
  return { ok: true, value: deepFreeze({ ...draft, changeId }) };
}

/** Canonical serialization of a change (byte-deterministic, L9). */
export function serializeRegimeChange(change: RegimeChange): string {
  return canonicalJson(change as unknown as JsonValue);
}
