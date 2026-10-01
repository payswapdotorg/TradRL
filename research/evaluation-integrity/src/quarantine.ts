/**
 * @tradrl/evaluation-integrity — the UNSEEN-DATA QUARANTINE (Work Order T031).
 *
 * Spec anchors: spec/EVALUATION-PROTOCOL.md line 21 ("Use unseen periods,
 * regimes, assets, venues or combinations NOT OPTIMIZED AGAINST"), R20/R21,
 * ARCHITECTURE-LOCK L11 (search integrity), L12 (tenant scoping), L4
 * (injected instants).
 *
 * THE QUARANTINE LAW: a {@link QuarantineRecord} DECLARES material
 * (segments of the evaluation axis) as never-to-be-optimized-on — the
 * unseen reservoir holdout and blind evaluations must draw from. Two laws
 * make the declaration honest rather than decorative:
 *
 * 1. PREDECLARATION (`quarantine_registered_late`): the quarantine's
 *    injected registration instant must NOT postdate the search record's
 *    FIRST entry instant. A quarantine declared after the search ran is a
 *    retroactive invisibility cloak — exactly the shape of overfitting
 *    concealment this service exists to close ("we never optimized on
 *    that" must be declared BEFORE the search, not after reading its
 *    results). Audit-grade unseen material is predeclared.
 *
 * 2. EMPIRICAL CLEANLINESS (`quarantine_violation`): NO in-search trial of
 *    the audited search record may consume quarantined material — by
 *    dataset ref OR by optimization-window overlap. Holdout-classified
 *    trials consuming quarantined material is exactly correct (that is
 *    what quarantine is FOR); in-search consumption burns the quarantine:
 *    the data is no longer unseen, whatever the declaration says.
 *
 * The record's segments follow the axis law (ordered, non-overlapping,
 * unique refs — the T012 axis mirror), and the id is content-addressed
 * (`qtn:<digest>`), so identical quarantines address identically (L9).
 */

import { deepFreeze, isNonEmptyString, isRecord, isTimestampMs, stableDigestJson, windowsOverlap } from './primitives';
import type { JsonObject, TimestampMs } from './primitives';
import { isProjectId, isTenantId } from './ids';
import type { ProjectId, TenantId } from './ids';
import { fail, invalidField, invalidType, missingField, ok, type IntegrityError, type IntegrityResult } from './errors';
import { isDatasetSegment, validateDatasetAxis } from './axis';
import type { DatasetSegment } from './axis';
import { verifySearchLineage } from './search-mirror';
import type { SearchRecordMirror } from './search-mirror';

/** The derivation prefix of every quarantine id. */
export const QUARANTINE_ID_PREFIX = 'qtn:' as const;

/**
 * The quarantine record: the declared unseen material, its provenance
 * (injected registration instant, L4), its scope (L12), and its reason.
 */
export interface QuarantineRecord {
  /** Derived identity: `qtn:<digest over the canonical quarantine content>`. */
  readonly quarantine_id: string;
  readonly tenant: TenantId;
  readonly project: ProjectId;
  /** The quarantined segments (ordered, non-overlapping, unique refs — the axis law). */
  readonly segments: readonly DatasetSegment[];
  /** The INJECTED declaration instant (L4 — predeclaration is checked against it). */
  readonly registered_at: TimestampMs;
  /** Why this material is quarantined (non-empty; the auditor's statement). */
  readonly reason: string;
}

/** Guard: `QuarantineRecord`. */
export function isQuarantineRecord(v: unknown): v is QuarantineRecord {
  if (!isRecord(v)) return false;
  if (typeof v.quarantine_id !== 'string' || !v.quarantine_id.startsWith(QUARANTINE_ID_PREFIX)) return false;
  if (!isTenantId(v.tenant) || !isProjectId(v.project)) return false;
  if (!Array.isArray(v.segments) || v.segments.length === 0) return false;
  if (!(v.segments as readonly unknown[]).every((s) => isDatasetSegment(s))) return false;
  if (!isTimestampMs(v.registered_at)) return false;
  if (!isNonEmptyString(v.reason)) return false;
  return v.quarantine_id === quarantineRecordId({
    tenant: v.tenant as TenantId,
    project: v.project as ProjectId,
    segments: v.segments as readonly DatasetSegment[],
    registered_at: v.registered_at as TimestampMs,
    reason: v.reason as string,
  });
}

/** The canonical quarantine JSON (the content-addressing input). */
function quarantineJson(content: Omit<QuarantineRecord, 'quarantine_id'>): JsonObject {
  return {
    tenant: content.tenant,
    project: content.project,
    segments: content.segments as unknown as JsonObject,
    registered_at: content.registered_at,
    reason: content.reason,
  };
}

/** Compute the content address of a quarantine: `qtn:<digest>`. */
export function quarantineRecordId(content: Omit<QuarantineRecord, 'quarantine_id'>): string {
  return `qtn:${stableDigestJson(quarantineJson(content))}`;
}

/**
 * Register (construct) a quarantine from untrusted input: the segments are
 * validated under the axis law, the instant is INJECTED (L4), the identity
 * is DERIVED from the content. A supplied id that disagrees with the
 * content fails `invalid_field`.
 */
export function registerQuarantine(value: unknown): IntegrityResult<QuarantineRecord> {
  if (!isRecord(value)) {
    return { ok: false, errors: [invalidType('quarantine input must be an object')] };
  }
  const errors: IntegrityError[] = [];
  if (value.tenant === undefined) errors.push(missingField('tenant'));
  else if (!isTenantId(value.tenant)) errors.push(invalidField('tenant', 'must be a non-empty tenant id (L12)'));
  if (value.project === undefined) errors.push(missingField('project'));
  else if (!isProjectId(value.project)) errors.push(invalidField('project', 'must be a non-empty project id (L15)'));
  if (value.registered_at === undefined) errors.push(missingField('registered_at'));
  else if (!isTimestampMs(value.registered_at)) {
    errors.push(invalidField('registered_at', 'must be a valid TimestampMs (the injected declaration instant, L4)'));
  }
  if (value.reason === undefined) errors.push(missingField('reason'));
  else if (!isNonEmptyString(value.reason)) errors.push(invalidField('reason', 'must be a non-empty reason'));
  if (errors.length > 0) return { ok: false, errors };

  const segmentsResult = validateDatasetAxis(value.segments === undefined ? undefined : { segments: value.segments }, 'segments');
  if (!segmentsResult.ok) {
    return { ok: false, errors: segmentsResult.errors };
  }
  if (segmentsResult.value.segments.length === 0) {
    return { ok: false, errors: [invalidField('segments', 'must be non-empty — a quarantine guards at least one segment')] };
  }

  const content = {
    tenant: value.tenant as TenantId,
    project: value.project as ProjectId,
    segments: segmentsResult.value.segments,
    registered_at: value.registered_at as TimestampMs,
    reason: value.reason as string,
  };
  const derivedId = quarantineRecordId(content);
  if (value.quarantine_id !== undefined && value.quarantine_id !== derivedId) {
    return fail('invalid_field', `quarantine id "${value.quarantine_id}" does not match the content's address "${derivedId}" — content and address cannot disagree (L9)`, 'quarantine_id');
  }
  return ok(deepFreeze({ quarantine_id: derivedId, ...content } satisfies QuarantineRecord));
}

// ---------------------------------------------------------------------------
// The quarantine check (the empirical law)
// ---------------------------------------------------------------------------

/** The result of a clean quarantine check over a verified search record. */
export interface QuarantineCheck {
  readonly quarantine_id: string;
  /** In-search trials checked. */
  readonly inSearchTrials: number;
  /** Quarantined segments declared. */
  readonly quarantinedSegments: number;
  /** Always 0 on the ok path — violations are typed errors, never silent counters. */
  readonly violations: 0;
}

/**
 * Check the quarantine law over a search record:
 *
 * 1. The record verifies against its chain (`chain_mismatch` propagates —
 *    an unverified search supports no integrity claim).
 * 2. The quarantine's tenant/project scope matches the record's
 *    (`tenant_mismatch` — L12: integrity claims never cross scopes).
 * 3. PREDECLARATION: `quarantine.registered_at <= first entry instant`
 *    (`quarantine_registered_late` — unseen material is declared before
 *    the search runs, not after reading its results).
 * 4. EMPIRICAL CLEANLINESS: no in-search trial consumes quarantined
 *    material by dataset ref or window overlap (`quarantine_violation`).
 *
 * Holdout-classified trials consuming quarantined material are CORRECT and
 * unremarkable — quarantine exists to be evaluated on, never optimized on.
 */
export function checkQuarantine(search: unknown, quarantine: unknown): IntegrityResult<QuarantineCheck> {
  const verified = verifySearchLineage(search);
  if (!verified.ok) return verified;
  const record = verified.value;

  const quarantineResult = registerQuarantine(quarantine);
  if (!quarantineResult.ok) return quarantineResult;
  const q = quarantineResult.value;

  if (q.tenant !== record.tenant || q.project !== record.project) {
    return fail(
      'tenant_mismatch',
      `quarantine scope (tenant "${q.tenant}", project "${q.project}") does not match the search record's (tenant "${record.tenant}", project "${record.project}") — integrity claims never cross scopes (L12)`,
    );
  }

  const firstEntry = record.entries[0];
  if (firstEntry !== undefined && q.registered_at > firstEntry.recorded_at) {
    return fail(
      'quarantine_registered_late',
      `quarantine "${q.quarantine_id}" was declared at ${q.registered_at}, AFTER the search's first entry instant ${firstEntry.recorded_at} — unseen material is declared BEFORE the search runs, not after reading its results (R21)`,
      'registered_at',
    );
  }

  const quarantinedRefs = new Set<string>(q.segments.map((segment) => segment.ref));
  for (const entry of record.entries) {
    if (entry.classification !== 'in-search') continue; // holdout consumption is correct
    for (const dataset of entry.datasets) {
      if (quarantinedRefs.has(dataset)) {
        return fail(
          'quarantine_violation',
          `in-search trial "${entry.trial}" consumed quarantined dataset "${dataset}" — optimized-on data is not unseen, whatever the declaration says (R21)`,
          `trial "${entry.trial}".datasets`,
        );
      }
    }
    if (entry.window !== null) {
      for (const segment of q.segments) {
        if (windowsOverlap(entry.window, { start: segment.start, end: segment.end })) {
          return fail(
            'quarantine_violation',
            `in-search trial "${entry.trial}" optimized over [${entry.window.start}, ${entry.window.end}) which overlaps quarantined segment "${segment.ref}" [${segment.start}, ${segment.end}) — optimized-on data is not unseen (R21)`,
            `trial "${entry.trial}".window`,
          );
        }
      }
    }
  }

  const inSearchTrials = record.entries.filter((entry) => entry.classification === 'in-search').length;
  return ok(
    deepFreeze({
      quarantine_id: q.quarantine_id,
      inSearchTrials,
      quarantinedSegments: q.segments.length,
      violations: 0,
    } satisfies QuarantineCheck),
  );
}
