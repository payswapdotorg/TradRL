/**
 * @tradrl/benchmarks-platform — the VERIFICATION-DISCHARGE SEAM (Work
 * Order T049): the supplier side of T045's benchmark requirements.
 *
 * THE SEAM THIS MODULE CLOSES (the Work Order's own charter): T045's
 * `verifyDeliverable` folds "the outcomes the platform's verification
 * machinery supplies" — T045 deliberately owns the CONTRACT and the
 * verdict fold, never the measurement runners. THIS lane is that
 * machinery for the benchmark requirement kind:
 * {@link dischargeBenchmarkRequirements} maps a verification contract's
 * benchmark requirements onto the platform's measurement records,
 * minting one {@link VerificationOutcomeMirror} per benchmark
 * requirement — the exact record shape the REAL
 * @tradrl/capability-provider's `verifyDeliverable` folds (the interop
 * trip-wire drives a REAL T045 exchange with this lane's outcomes
 * end-to-end).
 *
 * THE DISCHARGE LAWS (typed, fail-closed, each negative-tested):
 * - `invalid_contract` — the contract must be a valid T045 verification
 *   contract (the mirrored union; requirement refs unique).
 * - `invalid_measurement` — every supplied measurement verifies through
 *   the content-address law (L9).
 * - `requirement_unmatched` — a benchmark requirement naming a suite the
 *   supplied measurements never measured fails the WHOLE discharge
 *   (fail-closed: the platform never invents an outcome for a benchmark
 *   it did not run).
 * - Discharge semantics: a benchmark requirement PASSES when at least
 *   one ATTAINED measurement exists for the named suite (the detail
 *   cites the winning measurement id — the evidence trail); with
 *   measurements but none attained, the outcome FAILS with the honest
 *   detail (the verdict fold stays with T045 — this seam supplies
 *   outcomes, never verdicts).
 *
 * SCOPE LAW: the seam discharges BENCHMARK requirements only — the
 * measurement and local-evaluation requirement kinds belong to their own
 * machinery (T045's contract names them; this lane does not measure
 * them). The caller composes the full outcome set; T045's exact-coverage
 * law stays with T045.
 */

import { isRecord } from './primitives';
import { fail, invalidType, ok, type PlatformResult } from './errors';
import { verifyMeasurementRecord } from './measurement';
import type { MeasurementRecord } from './measurement';
import { isVerificationContractMirror, isVerificationOutcomeMirror } from './provider-mirror';
import type { BenchmarkRequirementMirror, VerificationOutcomeMirror, VerificationRequirementMirror } from './provider-mirror';

// ---------------------------------------------------------------------------
// The discharge
// ---------------------------------------------------------------------------

/** The discharge input: the verification contract + the platform's measurement records. */
export interface DischargeInput {
  readonly contract: readonly VerificationRequirementMirror[];
  readonly measurements: readonly MeasurementRecord[];
}

/**
 * Discharge a verification contract's BENCHMARK requirements: one outcome
 * per benchmark requirement, derived from the platform's measurement
 * records. Pure and deterministic: the same (contract, measurements)
 * always yield the byte-identical outcomes (T045's fold is reproducible
 * end-to-end).
 */
export function dischargeBenchmarkRequirements(input: unknown): PlatformResult<readonly VerificationOutcomeMirror[]> {
  if (!isRecord(input)) {
    return { ok: false, errors: [invalidType('discharge input must be an object')] };
  }
  if (input.contract === undefined) {
    return { ok: false, errors: [{ code: 'missing_field', path: 'contract', message: 'required field "contract" is missing' }] };
  }
  if (!isVerificationContractMirror(input.contract)) {
    return fail(
      'invalid_contract',
      'the contract must be a valid T045 verification contract (the mirrored requirement union; requirement refs unique)',
      'contract',
    );
  }
  const contract = input.contract as readonly VerificationRequirementMirror[];
  const benchmarkRequirements = contract.filter(
    (requirement): requirement is BenchmarkRequirementMirror => requirement.kind === 'benchmark',
  );

  if (input.measurements === undefined) {
    return { ok: false, errors: [{ code: 'missing_field', path: 'measurements', message: 'required field "measurements" is missing' }] };
  }
  if (!Array.isArray(input.measurements)) {
    return { ok: false, errors: [{ code: 'invalid_field', path: 'measurements', message: 'field "measurements": must be an array of measurement records' }] };
  }
  const measurements: MeasurementRecord[] = [];
  for (let index = 0; index < (input.measurements as readonly unknown[]).length; index++) {
    const verification = verifyMeasurementRecord((input.measurements as readonly unknown[])[index], `measurements[${index}]`);
    if (!verification.ok) {
      // The documented law: a malformed or content-divergent measurement is
      // the typed `invalid_measurement` (the underlying violations ride the
      // message — the caller sees exactly what failed).
      return fail(
        'invalid_measurement',
        `measurements[${index}] is not a verifiable measurement record: ${verification.errors.map((error) => error.message).join('; ')}`,
        `measurements[${index}]`,
      );
    }
    measurements.push(verification.value);
  }

  const outcomes: VerificationOutcomeMirror[] = [];
  for (const requirement of benchmarkRequirements) {
    const forSuite = measurements.filter((measurement) => measurement.suite_name === requirement.benchmarkId);
    if (forSuite.length === 0) {
      return fail(
        'requirement_unmatched',
        `benchmark requirement "${requirement.requirementRef}" names suite "${requirement.benchmarkId}" which the supplied measurements never measured — the platform never invents an outcome for a benchmark it did not run (fail-closed)`,
        `contract["${requirement.requirementRef}"]`,
      );
    }
    const attained = forSuite.filter((measurement) => measurement.attained);
    if (attained.length > 0) {
      // Deterministic choice: the FIRST attained measurement in the supplied order.
      const winner = attained[0] as MeasurementRecord;
      outcomes.push({
        requirementRef: requirement.requirementRef,
        passed: true,
        detail: `benchmark suite "${requirement.benchmarkId}" attained (measurement ${winner.measurement_id}; ${attained.length} attained measurement(s) recorded)`,
      });
    } else {
      outcomes.push({
        requirementRef: requirement.requirementRef,
        passed: false,
        detail: `benchmark suite "${requirement.benchmarkId}" measured (${forSuite.length} measurement(s): ${(forSuite.map((m) => m.measurement_id)).join(', ')}) but none attained the suite's criteria`,
      });
    }
  }

  return ok(outcomes);
}

