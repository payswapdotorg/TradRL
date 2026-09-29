/**
 * @tradrl/organization — discovery-loop protocol steps.
 *
 * Spec anchor: spec/CAPABILITY-DISCOVERY.md, "Discovery loop" — VERBATIM
 * (the ten steps this protocol machine-checks):
 *
 *   1. Detect capability deficit from task/project evidence.
 *   2. Characterize the required capability contract.
 *   3. Generate candidate specialization/role descriptions.
 *   4. Search reusable Skills and Agent Bodies.
 *   5. Search candidate Cognitive Substrates from the model registry.
 *   6. Benchmark candidates on task-specific capability suites.
 *   7. Check tool, context, latency, cost and runtime compatibility.
 *   8. Instantiate candidate Possessions.
 *   9. Evaluate candidate organizations in the Market World.
 *   10. Retain candidates only when they improve objective satisfaction
 *       under constraints.
 *
 * The compiler emits these steps as TYPED RECORDS (a closed discriminated
 * union with a total guard); `validateDiscoverySequence` machine-checks
 * the loop's ordering laws. The compiler may emit "new body spec required"
 * records (discovery level 3: "Create a new Body specification") but NEVER
 * forges bodies itself — the forge is T017's.
 *
 * Safety anchor (VERBATIM): "Discovery does not grant consequential
 * execution authority. Risk, authorization and execution policy remain
 * independent gates." — no step carries authority of any kind.
 */

import {
  type CapabilityKey,
  type CapabilityRecordId,
  deepFreeze,
  isArrayOf,
  isCapabilityKey,
  isCapabilityRecordId,
  isMemberOf,
  isNonEmptyString,
  isRecord,
} from './primitives';
import { type OrgError, type OrgResult, fail, invalidField, invalidType } from './errors';
import { type CapabilityGap, isCapabilityGap } from './gap';
import { type RegistrySubjectMirror, isRegistrySubjectMirror } from './capability-mirror';

// ---------------------------------------------------------------------------
// The step union (closed, total guard)
// ---------------------------------------------------------------------------

/** The closed step vocabulary of the discovery loop. */
export const DISCOVERY_STEP_KINDS = [
  'deficit-detected',
  'capability-contract-characterized',
  'candidates-generated',
  'candidates-benchmarked',
  'candidate-retained',
  'candidate-rejected',
  'new-body-spec-required',
] as const;

/** One discovery-loop step kind. */
export type DiscoveryStepKind = (typeof DISCOVERY_STEP_KINDS)[number];

/** Guard: `DiscoveryStepKind`. */
export function isDiscoveryStepKind(v: unknown): v is DiscoveryStepKind {
  return isMemberOf(DISCOVERY_STEP_KINDS, v);
}

/** Why a discovery candidate was rejected (closed vocabulary, structured). */
export const DISCOVERY_REJECTION_CODES = [
  'no-measured-evidence',
  'not-selected',
] as const;

/** One structured discovery-candidate rejection code. */
export type DiscoveryRejectionCode = (typeof DISCOVERY_REJECTION_CODES)[number];

/** Guard: `DiscoveryRejectionCode`. */
export function isDiscoveryRejectionCode(v: unknown): v is DiscoveryRejectionCode {
  return isMemberOf(DISCOVERY_REJECTION_CODES, v);
}

/**
 * One discovery-loop step — the ten-step loop as machine-checkable shapes:
 *  - `deficit-detected` (step 1) — a typed CapabilityGap.
 *  - `capability-contract-characterized` (step 2) — the required
 *    capability keys (+ benchmark refs where they exist).
 *  - `candidates-generated` (steps 3-5) — the body/substrate subjects the
 *    search will consider, canonically ordered.
 *  - `candidates-benchmarked` (steps 6-7) — opaque benchmark and result
 *    references backing the consideration.
 *  - `candidate-retained` / `candidate-rejected` (step 10, VERBATIM:
 *    "Retain candidates only when they improve objective satisfaction
 *    under constraints") — the per-subject disposition with the capability
 *    records that evidence it.
 *  - `new-body-spec-required` (discovery level 3) — the compiler's
 *    declaration that NO existing subject covers a required capability
 *    contract and a NEW body specification must be forged (by T017, never
 *    here).
 */
export type DiscoveryStep =
  | { readonly step: 'deficit-detected'; readonly gap: CapabilityGap }
  | {
      readonly step: 'capability-contract-characterized';
      readonly capabilityKeys: readonly CapabilityKey[];
      readonly benchmarkRefs: readonly string[];
    }
  | {
      readonly step: 'candidates-generated';
      readonly subjectRefs: readonly RegistrySubjectMirror[];
    }
  | {
      readonly step: 'candidates-benchmarked';
      readonly benchmarkRefs: readonly string[];
      readonly resultRefs: readonly string[];
    }
  | {
      readonly step: 'candidate-retained';
      readonly subject: RegistrySubjectMirror;
      readonly capabilityRecordRefs: readonly CapabilityRecordId[];
    }
  | {
      readonly step: 'candidate-rejected';
      readonly subject: RegistrySubjectMirror;
      readonly reason: DiscoveryRejectionCode;
    }
  | {
      readonly step: 'new-body-spec-required';
      readonly capabilityKeys: readonly CapabilityKey[];
      readonly benchmarkRefs: readonly string[];
    };

/**
 * Guard: `DiscoveryStep` — total over the closed union. Every step's
 * arrays are non-empty where the loop's semantics demand it (a deficit
 * carries a full gap; a characterization names at least one capability;
 * generated candidates and benchmarked evidence are non-empty; retained
 * candidates cite at least one capability record).
 */
export function isDiscoveryStep(v: unknown): v is DiscoveryStep {
  if (!isRecord(v)) return false;
  switch (v.step) {
    case 'deficit-detected':
      return isCapabilityGap(v.gap);
    case 'capability-contract-characterized':
      return (
        isArrayOf(v.capabilityKeys, isCapabilityKey) &&
        (v.capabilityKeys as readonly CapabilityKey[]).length > 0 &&
        isArrayOf(v.benchmarkRefs, isNonEmptyString)
      );
    case 'candidates-generated':
      return (
        isArrayOf(v.subjectRefs, isRegistrySubjectMirror) &&
        (v.subjectRefs as readonly RegistrySubjectMirror[]).length > 0
      );
    case 'candidates-benchmarked':
      return (
        isArrayOf(v.benchmarkRefs, isNonEmptyString) &&
        (v.benchmarkRefs as readonly string[]).length > 0 &&
        isArrayOf(v.resultRefs, isNonEmptyString) &&
        (v.resultRefs as readonly string[]).length > 0
      );
    case 'candidate-retained':
      return (
        isRegistrySubjectMirror(v.subject) &&
        isArrayOf(v.capabilityRecordRefs, isCapabilityRecordId) &&
        (v.capabilityRecordRefs as readonly CapabilityRecordId[]).length > 0
      );
    case 'candidate-rejected':
      return isRegistrySubjectMirror(v.subject) && isDiscoveryRejectionCode(v.reason);
    case 'new-body-spec-required':
      return (
        isArrayOf(v.capabilityKeys, isCapabilityKey) &&
        (v.capabilityKeys as readonly CapabilityKey[]).length > 0 &&
        isArrayOf(v.benchmarkRefs, isNonEmptyString)
      );
    default:
      return false;
  }
}

/** Guard for arrays of discovery steps. */
export function isDiscoveryStepArray(v: unknown): v is readonly DiscoveryStep[] {
  return isArrayOf(v, isDiscoveryStep);
}

/**
 * Constructs a deeply frozen discovery step, throwing `TypeError` on
 * invalid input (factory discipline; the guard is the total validator for
 * untrusted values).
 */
export function createDiscoveryStep(step: DiscoveryStep): DiscoveryStep {
  if (!isDiscoveryStep(step)) {
    throw new TypeError('createDiscoveryStep: step failed the closed DiscoveryStep union');
  }
  return deepFreeze({ ...step });
}

// ---------------------------------------------------------------------------
// Sequence validation (the loop's ordering laws, machine-checked)
// ---------------------------------------------------------------------------

/**
 * Validates a discovery-step sequence against the loop's ordering laws
 * (spec/CAPABILITY-DISCOVERY.md "Discovery loop"):
 *
 * 1. A non-empty sequence STARTS with `deficit-detected` — the loop is
 *    failure/demand-driven, never opportunistic.
 * 2. `candidates-generated` precedes every `candidates-benchmarked`,
 *    `candidate-retained` and `candidate-rejected` step.
 * 3. `candidates-benchmarked` precedes every disposition step —
 *    "Benchmark candidates on task-specific capability suites" comes
 *    BEFORE retention/rejection.
 * 4. Each subject is dispositioned AT MOST ONCE (retained XOR rejected) —
 *    a double disposition is an integrity break.
 * 5. `new-body-spec-required` (discovery level 3) only follows a
 *    `capability-contract-characterized` step that names its keys.
 */
export function validateDiscoverySequence(steps: readonly unknown[]): OrgResult<readonly DiscoveryStep[]> {
  if (!Array.isArray(steps)) {
    return { ok: false, errors: [invalidType('discovery sequence must be an array of steps')] };
  }
  const errors: OrgError[] = [];
  steps.forEach((step, index) => {
    if (!isDiscoveryStep(step)) {
      errors.push(invalidField(`steps[${index}]`, 'failed the closed DiscoveryStep union'));
    }
  });
  if (errors.length > 0) return { ok: false, errors };
  const sequence = steps as readonly DiscoveryStep[];
  if (sequence.length === 0) return { ok: true, value: sequence };

  if (sequence[0]?.step !== 'deficit-detected') {
    return fail(
      'invalid_field',
      `the discovery loop is deficit-driven — the first step must be "deficit-detected", got "${sequence[0]?.step}" (spec/CAPABILITY-DISCOVERY.md step 1)`,
      'steps[0]',
    );
  }
  let generatedAt = -1;
  let benchmarkedAt = -1;
  const characterizedKeys = new Set<string>();
  const dispositioned = new Set<string>();
  sequence.forEach((step, index) => {
    switch (step.step) {
      case 'capability-contract-characterized':
        for (const key of step.capabilityKeys) characterizedKeys.add(key);
        break;
      case 'candidates-generated':
        if (generatedAt < 0) generatedAt = index;
        break;
      case 'candidates-benchmarked':
        if (benchmarkedAt < 0) benchmarkedAt = index;
        if (generatedAt < 0 || index < generatedAt) {
          errors.push(
            invalidField(
              `steps[${index}]`,
              'candidates-benchmarked must follow candidates-generated (spec/CAPABILITY-DISCOVERY.md steps 3-6)',
            ),
          );
        }
        break;
      case 'candidate-retained':
      case 'candidate-rejected': {
        if (generatedAt < 0 || index < generatedAt) {
          errors.push(
            invalidField(
              `steps[${index}]`,
              'candidate dispositions must follow candidates-generated (spec/CAPABILITY-DISCOVERY.md steps 3-10)',
            ),
          );
        }
        if (benchmarkedAt < 0 || index < benchmarkedAt) {
          errors.push(
            invalidField(
              `steps[${index}]`,
              'candidate dispositions must follow candidates-benchmarked — "Benchmark candidates ... Retain candidates only when they improve objective satisfaction under constraints" (spec/CAPABILITY-DISCOVERY.md steps 6, 10)',
            ),
          );
        }
        const subjectKey = JSON.stringify(step.subject);
        if (dispositioned.has(subjectKey)) {
          errors.push(
            invalidField(
              `steps[${index}]`,
              `subject ${subjectKey} is dispositioned more than once — a discovery candidate is retained XOR rejected`,
            ),
          );
        } else {
          dispositioned.add(subjectKey);
        }
        break;
      }
      case 'new-body-spec-required': {
        if (characterizedKeys.size === 0) {
          errors.push(
            invalidField(
              `steps[${index}]`,
              'new-body-spec-required must follow capability-contract-characterized (discovery level 3 characterizes the missing contract first)',
            ),
          );
        } else {
          for (const key of step.capabilityKeys) {
            if (!characterizedKeys.has(key)) {
              errors.push(
                invalidField(
                  `steps[${index}]`,
                  `new-body-spec-required names capability "${key}" that was never characterized`,
                ),
              );
            }
          }
        }
        break;
      }
      case 'deficit-detected':
        break;
    }
  });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: deepFreeze([...sequence]) };
}
