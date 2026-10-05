/**
 * @tradrl/benchmarks-platform — the ADOPTION GATE over measured evidence
 * (Work Order T049; the T035 discipline mirrored into the measurement
 * lane).
 *
 * WHAT THIS MODULE SERVES: the T035 improvement loop's evidence gates —
 * "the T035 improvement loop's evidence gates" per the Work Order. A
 * measured capability (a benchmark measurement) may ground an ADOPTION
 * (a skill commission release, a capability acceptance) only under the
 * T031/T035 selection discipline: IN-SEARCH-ONLY attained evidence
 * withholds the adoption (`selected_without_holdout` — the best-of-N
 * trap refused by construction), empty evidence withholds
 * (`evidence_missing`), present-but-never-attained evidence withholds
 * (`evidence_insufficient`), and evidence naming a trial the RETAINED
 * search record never logged fails closed (`hidden_trials` — the caller
 * that hides its worst attempts gets a typed rejection, never a rosier
 * gate). The vocabulary mirrors services/autonomous-learning's
 * `evaluateAdoptionGate` (T035) — the platform mirror of T031's
 * `selected_without_holdout` discipline — re-declared over THIS lane's
 * measured-evidence records; the interop trip-wires prove the vocabulary
 * agreement against the REAL autonomous-learning lane.
 *
 * WHEN THE POLICY DROPS THE HOLDOUT REQUIREMENT (`requiresHoldout:
 * false`): any attained measurement releases — the switch is the
 * policy's, never the gate's mood (the T035 law, mirrored verbatim).
 */

import { isRecord, deepFreeze } from './primitives';
import { fail, invalidType, missingField, ok, type PlatformResult } from './errors';
import { verifyMeasurementRecord } from './measurement';
import type { MeasurementRecord } from './measurement';
import { verifySearchRecordLineage } from './search-mirror';
import type { SearchRecordMirror } from './search-mirror';

// ---------------------------------------------------------------------------
// The gate's vocabulary (the T035 mirror)
// ---------------------------------------------------------------------------

/** The commission refusal reasons — MIRROR of services/autonomous-learning's `CommissionRefusalReason` (T035). */
export const COMMISSION_REFUSAL_REASONS = ['selected_without_holdout', 'evidence_missing', 'evidence_insufficient'] as const;

/** One refusal reason. */
export type CommissionRefusalReason = (typeof COMMISSION_REFUSAL_REASONS)[number];

/** Guard: a refusal reason. */
export function isCommissionRefusalReason(v: unknown): v is CommissionRefusalReason {
  return typeof v === 'string' && (COMMISSION_REFUSAL_REASONS as readonly string[]).includes(v);
}

/** The adoption policy: the caller's holdout requirement (the T035 law: the switch is the policy's). */
export interface AdoptionPolicy {
  readonly requiresHoldout: boolean;
}

/** Guard: `AdoptionPolicy`. */
export function isAdoptionPolicy(v: unknown): v is AdoptionPolicy {
  return isRecord(v) && typeof v.requiresHoldout === 'boolean';
}

/**
 * One grounding evidence entry: a measured capability + the trial it ran
 * under. The measurement must be ATTAINED to ground an adoption; the
 * trial's classification (from the retained search record) decides the
 * holdout distinction.
 */
export interface GroundingMeasurement {
  readonly measurement: MeasurementRecord;
  /** The trial the measurement ran under — must be logged by the retained search record (fail-closed). */
  readonly trial: string;
}

/** The adoption gate's verdict: released or withheld, with the typed refusal and the grounding evidence. */
export interface AdoptionVerdict {
  readonly decision: 'commissioned' | 'withheld';
  readonly refusal: CommissionRefusalReason | null;
  /** The evidence that released the adoption (empty when withheld). */
  readonly grounding: readonly { readonly measurement_id: string; readonly trial: string; readonly classification: 'in-search' | 'holdout' }[];
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/**
 * Evaluate the adoption gate over measured evidence: a commission is
 * RELEASED only when the cited measured evidence includes an ATTAINED
 * measurement under a HOLDOUT-classified trial (when the policy requires
 * holdout). In-search-only attained evidence WITHHOLDS the commission as
 * the typed refusal `selected_without_holdout`; no evidence withholds
 * with `evidence_missing`; present-but-never-attained evidence withholds
 * with `evidence_insufficient`. Every cited trial must exist in the
 * RETAINED search record — evidence outside the retained search history
 * is the fail-closed `hidden_trials` (nothing about the search is
 * forgotten; nothing hidden gets judged).
 */
export function evaluateAdoptionGate(input: unknown): PlatformResult<AdoptionVerdict> {
  if (!isRecord(input)) {
    return { ok: false, errors: [invalidType('adoption input must be an object')] };
  }
  if (input.policy === undefined) {
    return { ok: false, errors: [missingField('policy')] };
  }
  if (!isAdoptionPolicy(input.policy)) {
    return { ok: false, errors: [{ code: 'invalid_field', path: 'policy', message: 'field "policy": must be { requiresHoldout: boolean }' }] };
  }
  const policy = input.policy as AdoptionPolicy;

  if (input.search === undefined) {
    return { ok: false, errors: [missingField('search')] };
  }
  const searchVerification = verifySearchRecordLineage(input.search);
  if (!searchVerification.ok) return searchVerification;
  const searchRecord = searchVerification.value;

  if (input.evidence === undefined) {
    return { ok: false, errors: [missingField('evidence')] };
  }
  if (!Array.isArray(input.evidence)) {
    return { ok: false, errors: [{ code: 'invalid_field', path: 'evidence', message: 'field "evidence": must be an array of { measurement, trial } grounding entries' }] };
  }

  const grounding: { measurement_id: string; trial: string; classification: 'in-search' | 'holdout' }[] = [];
  let anyAttained = false;
  let anyHoldoutAttained = false;
  let anyInSearchAttained = false;

  for (let index = 0; index < (input.evidence as readonly unknown[]).length; index++) {
    const entry = (input.evidence as readonly unknown[])[index];
    if (!isRecord(entry)) {
      return { ok: false, errors: [{ code: 'invalid_field', path: `evidence[${index}]`, message: `field "evidence[${index}]": must be { measurement, trial }` }] };
    }
    if (entry.measurement === undefined) {
      return { ok: false, errors: [missingField(`evidence[${index}].measurement`)] };
    }
    const measurementVerification = verifyMeasurementRecord(entry.measurement, `evidence[${index}].measurement`);
    if (!measurementVerification.ok) return measurementVerification;
    const measurement = measurementVerification.value;

    if (measurement.tenant !== searchRecord.tenant || measurement.project !== searchRecord.project) {
      return fail(
        'tenant_mismatch',
        `measurement "${measurement.measurement_id}" is scoped to tenant "${measurement.tenant}"/project "${measurement.project}" but the retained search record is scoped to "${searchRecord.tenant}"/"${searchRecord.project}" — adoption evidence never crosses tenants or projects (L12)`,
        `evidence[${index}].measurement.tenant`,
      );
    }
    if (measurement.search === null || measurement.search.record_id !== searchRecord.search_id) {
      return fail(
        'hidden_trials',
        `measurement "${measurement.measurement_id}" does not bind the retained search record "${searchRecord.search_id}" — adoption evidence must run under the retained search history (L11); a claimed view of the search must name exactly the logged record`,
        `evidence[${index}].measurement.search`,
      );
    }
    if (entry.trial === undefined || typeof entry.trial !== 'string' || (entry.trial as string).length === 0) {
      return { ok: false, errors: [missingField(`evidence[${index}].trial`)] };
    }
    const trial = entry.trial as string;
    const logged = searchRecord.entries.find((candidate) => candidate.trial === trial);
    if (logged === undefined) {
      return fail(
        'hidden_trials',
        `evidence cites trial "${trial}" which the retained search record "${searchRecord.search_id}" never logged — the gate NEVER silently drops an unknown trial: the whole adoption fails closed (the T035 hidden-trials law)`,
        `evidence[${index}].trial`,
      );
    }
    if (measurement.search.trial !== trial) {
      return fail(
        'invalid_field',
        `evidence cites trial "${trial}" but measurement "${measurement.measurement_id}" ran under trial "${measurement.search.trial}" — the citation and the measurement must agree`,
        `evidence[${index}].trial`,
      );
    }

    grounding.push({ measurement_id: measurement.measurement_id, trial, classification: logged.classification });
    if (measurement.attained) {
      anyAttained = true;
      if (logged.classification === 'holdout') anyHoldoutAttained = true;
      else anyInSearchAttained = true;
    }
  }

  if (grounding.length === 0) {
    return ok(deepFreeze({ decision: 'withheld', refusal: 'evidence_missing', grounding: [] } satisfies AdoptionVerdict));
  }
  if (!anyAttained) {
    return ok(deepFreeze({ decision: 'withheld', refusal: 'evidence_insufficient', grounding } satisfies AdoptionVerdict));
  }
  if (policy.requiresHoldout && !anyHoldoutAttained) {
    return ok(deepFreeze({ decision: 'withheld', refusal: 'selected_without_holdout', grounding } satisfies AdoptionVerdict));
  }
  return ok(deepFreeze({ decision: 'commissioned', refusal: null, grounding } satisfies AdoptionVerdict));
}
