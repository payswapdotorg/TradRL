/**
 * @tradrl/organization-compiler — the REFERENCE compiler strategy.
 *
 * Owning Work Order: T016 (frozen write surface:
 * services/organization-compiler).
 *
 * THE DECLARED STRATEGY (simple + declared, per the Work Order):
 * **seeded enumeration with objective aggregation and
 * retain-top-k-with-full-history**.
 *
 * 1. DEMAND: one slot per required capability contract (input order);
 *    each slot's candidate assignments are the registry records that
 *    demonstrate the capability (pure filtering).
 * 2. COVERAGE: a required capability with NO covering record makes the
 *    compile fail with `unknown_capability_record`, and
 *    {@link characterizeCoverage} emits the discovery level-3 record
 *    (`new-body-spec-required`) — the compiler NEVER forges bodies
 *    itself (T017 owns the forge).
 * 3. ENUMERATION: the full cartesian product of the slots' candidate
 *    records, walked in odometer order (first slot slowest) over the
 *    SEEDED per-slot orderings (each slot's records sorted ascending by
 *    the deterministic draw `seededDraw(seed, slot key, record index)`
 *    with canonical-JSON tie-break). Truncated at
 *    `budgets.maxEnumeratedCandidates` (declared truncation; the
 *    truncated prefix IS the search — L11 keeps every candidate it
 *    produced).
 * 4. MEASUREMENT: every enumerated assignment vector is measured by the
 *    DECLARED derivations (derivations.ts) and scored by the declared
 *    aggregation strategy (`weighted-sum-v1`).
 * 5. REJECTION: in enumeration order, each candidate is screened against
 *    the measurable BLOCKING constraints and the budgets — every
 *    violation is a STRUCTURED reason (`below-required-satisfaction`,
 *    `budget-exceeded` with axis/measured/budget, `blocking-constraint`
 *    with the constraint id).
 * 6. SELECTION: the FEASIBLE candidates are ranked by the declared
 *    tie-break rule (`attainment-then-compute-then-id-v1`); the best is
 *    `proposed`, the next `retainLimitK` are `retained`, and every other
 *    candidate — feasible-beyond-the-window AND infeasible alike — is
 *    `rejected` and RETAINED in the log with its structured reasons
 *    (L11: the search history is preserved, never pruned).
 * 7. DISCOVERY TRACE: the log's discovery steps mirror the
 *    CAPABILITY-DISCOVERY loop — deficit-detected (per input gap),
 *    capability-contract-characterized, candidates-generated,
 *    candidates-benchmarked, and one disposition per SUBJECT (members of
 *    the proposed organization retained; all other generated subjects
 *    rejected `not-selected`).
 *
 * Determinism: a pure function of the validated compile input — same
 * (goal, constraints, budgets, registry snapshot, seed, compiler
 * version, demand) -> byte-identical candidate log. No ambient
 * randomness (the seed drives every draw), no ambient clock
 * (`Date.now()` never appears), no I/O.
 */

import {
  type AggregationStrategy,
  type CandidateId,
  type CandidateRejectionReason,
  type CapabilityKey,
  type CapabilityRecordMirror,
  type CompileInput,
  type CompilerContract,
  type DiscoveryStep,
  type ObjectiveMeasurements,
  type OrgResult,
  type OrganizationBlueprint,
  type OrganizationCandidate,
  type SearchLog,
  type SearchSeed,
  aggregateOrganizationObjective,
  canonicalJson,
  compareByTieBreakRule,
  createCapabilityGap,
  evaluateCriterionPredicateMirror,
  fail,
  queryByCapabilityMirror,
  searchRunIdOf,
  seededDraw,
  validateSearchLog,
} from '../../../packages/organization/src/index';
import {
  type SlotCoverage,
  deriveAttainmentScore,
  deriveComputeUnits,
  deriveCoordinationCostWires,
  deriveDecisionCadence,
  deriveLatencyMs,
  deriveRedundancy,
  deriveRiskPenalty,
  deriveRiskPolicyRefs,
  deriveRobustness,
  deriveTopology,
  deriveTrainingAllocation,
  MEASURABLE_SUBJECTS,
} from './derivations';

/** The reference compiler's version identity (lineage participant, L9). */
export const REFERENCE_COMPILER_VERSION = 'reference-enumeration/1' as const;

/** The declared objective model the reference compiler aggregates with. */
export const REFERENCE_STRATEGY: AggregationStrategy = {
  strategyVersion: 'weighted-sum-v1',
  weights: {
    attainment: 0.4,
    riskPenalty: 0.1,
    compute: 0.1,
    coordinationCost: 0.1,
    latency: 0.1,
    robustness: 0.1,
    redundancy: 0.1,
  },
  normalization: {
    maxComputeUnits: 40,
    maxCoordinationWires: 12,
    maxLatencyMs: 3000,
  },
  tieBreak: 'attainment-then-compute-then-id-v1',
} as const;

// ---------------------------------------------------------------------------
// Coverage characterization (discovery level 3 — declared, never forged)
// ---------------------------------------------------------------------------

/**
 * Characterizes the registry coverage of the demand: for every required
 * capability, whether the snapshot demonstrates it. Emits the
 * CAPABILITY-DISCOVERY steps the coverage analysis implies — including
 * `new-body-spec-required` (discovery level 3: "Create a new Body
 * specification") for uncovered capabilities. The compiler itself NEVER
 * forges bodies (T017 owns the forge); it declares the gap.
 */
export function characterizeCoverage(input: CompileInput): readonly DiscoveryStep[] {
  const steps: DiscoveryStep[] = [];
  for (const gap of input.gaps) {
    steps.push({ step: 'deficit-detected', gap });
  }
  steps.push({
    step: 'capability-contract-characterized',
    capabilityKeys: [...input.requiredCapabilities],
    benchmarkRefs: benchmarkRefsFor(input, input.requiredCapabilities),
  });
  const uncovered = input.requiredCapabilities.filter(
    (capability) => queryByCapabilityMirror(input.registrySnapshot, { requires: [capability] }).length === 0,
  );
  if (uncovered.length > 0) {
    steps.push({
      step: 'new-body-spec-required',
      capabilityKeys: [...uncovered],
      benchmarkRefs: benchmarkRefsFor(input, uncovered),
    });
  }
  return steps;
}

function benchmarkRefsFor(
  input: CompileInput,
  capabilities: readonly CapabilityKey[],
): readonly string[] {
  const refs = new Set<string>();
  for (const capability of capabilities) {
    for (const record of queryByCapabilityMirror(input.registrySnapshot, { requires: [capability] })) {
      for (const descriptor of record.descriptors) {
        for (const evidence of descriptor.evidence) {
          if (evidence.kind === 'benchmark') refs.add(evidence.benchmarkId);
        }
      }
    }
  }
  return [...refs];
}

// ---------------------------------------------------------------------------
// The seeded enumeration
// ---------------------------------------------------------------------------

/**
 * The per-slot seeded ordering — DECLARED RULE: each slot's covering
 * records are sorted ascending by the deterministic draw
 * `seededDraw(seed, "slot-order:{slotIndex}:{recordId}", 0)`, ties broken
 * by the canonical JSON of the record. The SAME seed always yields the
 * SAME orderings — this is where the seed enters the search.
 */
export function seededSlotOrder(
  seed: SearchSeed,
  slotIndex: number,
  records: readonly CapabilityRecordMirror[],
): readonly CapabilityRecordMirror[] {
  return [...records].sort((a, b) => {
    const drawA = seededDraw(seed, `slot-order:${slotIndex}:${a.recordId}`, 0);
    const drawB = seededDraw(seed, `slot-order:${slotIndex}:${b.recordId}`, 0);
    if (drawA !== drawB) return drawA < drawB ? -1 : 1;
    const canonicalA = canonicalJson(a as never);
    const canonicalB = canonicalJson(b as never);
    return canonicalA < canonicalB ? -1 : canonicalA > canonicalB ? 1 : 0;
  });
}

/** One entry of an enumerated assignment vector: the slot and the record filling it. */
export interface AssignmentEntry {
  readonly slotIndex: number;
  readonly record: CapabilityRecordMirror;
}

/** An enumerated assignment vector — one entry per slot, in slot order. */
export type AssignmentVector = readonly AssignmentEntry[];

/**
 * Enumerates the assignment vectors: the cartesian product of the slots'
 * seeded orderings, odometer order (first slot slowest), truncated at
 * `limit`. Each element is the vector of records — one per slot — with
 * slot metadata attached.
 */
export function enumerateAssignments(
  slots: readonly SlotCoverage[],
  seed: SearchSeed,
  limit: number,
): readonly AssignmentVector[] {
  if (slots.length === 0 || limit <= 0) return [];
  const ordered = slots.map((slot, slotIndex) => ({
    capability: slot.capability,
    records: [...seededSlotOrder(seed, slotIndex, slot.records)],
  }));
  if (ordered.some((slot) => slot.records.length === 0)) return [];
  const assignments: AssignmentVector[] = [];
  let produced = 0;
  const odometer = ordered.map(() => 0);
  while (produced < limit) {
    const vector = ordered.map((slot, slotIndex) => ({
      slotIndex,
      record: slot.records[odometer[slotIndex] as number] as CapabilityRecordMirror,
    }));
    assignments.push(vector);
    produced += 1;
    // Advance the odometer (last slot fastest).
    let carry = ordered.length - 1;
    while (carry >= 0) {
      const current = odometer[carry] as number;
      const slot = ordered[carry] as { records: readonly CapabilityRecordMirror[] };
      if (current + 1 < slot.records.length) {
        odometer[carry] = current + 1;
        break;
      }
      odometer[carry] = 0;
      carry -= 1;
    }
    if (carry < 0) break; // full product enumerated
  }
  return assignments;
}

// ---------------------------------------------------------------------------
// Blueprint + measurements for one assignment vector
// ---------------------------------------------------------------------------

function blueprintFor(
  input: CompileInput,
  slots: readonly SlotCoverage[],
  vector: readonly { readonly slotIndex: number; readonly record: CapabilityRecordMirror }[],
): OrganizationBlueprint {
  const slotIds = slots.map((_, index) => `slot-${index + 1}`);
  const specializations = slots.map((slot) => {
    const gap = input.gaps.find((candidate) => candidate.capabilityKey === slot.capability);
    return {
      capabilityKey: slot.capability,
      benchmarkRefs: benchmarkRefsFor(input, [slot.capability]),
      ...(gap === undefined ? {} : { gapId: gap.gapId }),
    };
  });
  const assignments = vector.map((entry) => ({
    slotId: `slot-${entry.slotIndex + 1}`,
    subject: entry.record.subject,
    capabilityRecordRefs: [entry.record.recordId],
    riskPolicyRefs: deriveRiskPolicyRefs(input),
  }));
  const topology = deriveTopology(slotIds);
  return {
    tenantId: input.tenantId,
    projectId: input.projectId,
    agentCount: vector.length,
    specializations,
    assignments,
    topology,
    trainingAllocation: { entries: deriveTrainingAllocation(slots, input.budgets.maxComputeUnits) },
    decisionCadence: { entries: deriveDecisionCadence(slots) },
    adversarialPopulation: {
      adversarialRequired: input.goal.evaluation.adversarialRequired,
      adversaryRefs: input.goal.evaluation.adversarialRequired
        ? ['adversary/default/crowding', 'adversary/default/quote-stuffing']
        : [],
    },
  } as unknown as OrganizationBlueprint;
}

function measurementsFor(
  input: CompileInput,
  slots: readonly SlotCoverage[],
  vector: readonly { readonly slotIndex: number; readonly record: CapabilityRecordMirror }[],
  searchRunId: string,
): ObjectiveMeasurements {
  const selected: SlotCoverage[] = vector.map((entry) => ({
    capability: slots[entry.slotIndex]?.capability as CapabilityKey,
    records: [entry.record],
  }));
  const subjects = vector.map((entry) => entry.record.subject);
  return {
    attainmentScore: deriveAttainmentScore(selected),
    attainmentEvidenceRef: `${searchRunId}:attainment` as never,
    riskPenalty: deriveRiskPenalty(input),
    riskPolicyRefs: deriveRiskPolicyRefs(input),
    computeUnits: deriveComputeUnits(selected),
    coordinationCostWires: deriveCoordinationCostWires(
      deriveTopology(vector.map((entry) => `slot-${entry.slotIndex + 1}`)),
    ),
    latencyMs: deriveLatencyMs(selected),
    robustness: deriveRobustness(subjects),
    redundancy: deriveRedundancy(
      selected,
      slots.map((slot) => slot.capability),
    ),
  } as unknown as ObjectiveMeasurements;
}

// ---------------------------------------------------------------------------
// Rejection screening (structured reasons, in enumeration order)
// ---------------------------------------------------------------------------

/**
 * Screens one candidate against the measurable BLOCKING constraints and
 * the budgets — DECLARED RULES (see MEASURABLE_SUBJECTS and the budget
 * axes). Returns the structured rejection reasons (empty = feasible).
 */
export function screenCandidate(
  input: CompileInput,
  blueprint: OrganizationBlueprint,
  measurements: ObjectiveMeasurements,
): readonly CandidateRejectionReason[] {
  const reasons: CandidateRejectionReason[] = [];
  if (measurements.attainmentScore < input.goal.successCriteria.requiredSatisfaction) {
    reasons.push({
      code: 'below-required-satisfaction',
      requiredSatisfaction: input.goal.successCriteria.requiredSatisfaction,
      attainmentScore: measurements.attainmentScore,
    });
  }
  if (measurements.computeUnits > input.budgets.maxComputeUnits) {
    reasons.push({
      code: 'budget-exceeded',
      axis: 'compute',
      measured: measurements.computeUnits,
      budget: input.budgets.maxComputeUnits,
    });
  }
  if (measurements.coordinationCostWires > input.budgets.maxCoordinationWires) {
    reasons.push({
      code: 'budget-exceeded',
      axis: 'coordinationCost',
      measured: measurements.coordinationCostWires,
      budget: input.budgets.maxCoordinationWires,
    });
  }
  if (measurements.latencyMs > input.budgets.maxLatencyMs) {
    reasons.push({
      code: 'budget-exceeded',
      axis: 'latency',
      measured: measurements.latencyMs,
      budget: input.budgets.maxLatencyMs,
    });
  }
  if (blueprint.agentCount > input.budgets.maxAgents) {
    reasons.push({
      code: 'budget-exceeded',
      axis: 'agentCount',
      measured: blueprint.agentCount,
      budget: input.budgets.maxAgents,
    });
  }
  const axisValue: Record<string, number> = {
    compute: measurements.computeUnits,
    latency: measurements.latencyMs,
    coordinationCost: measurements.coordinationCostWires,
    agentCount: blueprint.agentCount,
  };
  for (const constraint of input.constraints.constraints) {
    if (constraint.severity !== 'blocking') continue; // advisories bind evaluation (T012)
    const axis = (MEASURABLE_SUBJECTS as Record<string, string>)[constraint.subject];
    if (axis === undefined) continue; // unmeasurable gates bind evaluation (T012)
    const value = axisValue[axis];
    if (!evaluateCriterionPredicateMirror(constraint.predicate, value)) {
      reasons.push({ code: 'blocking-constraint', constraintId: constraint.id });
    }
  }
  return reasons;
}

// ---------------------------------------------------------------------------
// The reference compiler (CompilerContract implementation)
// ---------------------------------------------------------------------------

/**
 * The reference compiler — `seeded enumeration with objective aggregation
 * and retain-top-k-with-full-history` (see the module header for the
 * declared strategy). Pure: same input, byte-identical log.
 */
export const referenceCompiler: CompilerContract = {
  compilerVersion: REFERENCE_COMPILER_VERSION as never,
  strategy: REFERENCE_STRATEGY,
  compile: (input: CompileInput): OrgResult<SearchLog> => {
    // 1-2. Demand and coverage.
    const slots: SlotCoverage[] = input.requiredCapabilities.map((capability) => ({
      capability,
      records: queryByCapabilityMirror(input.registrySnapshot, { requires: [capability] }),
    }));
    const uncovered = slots.filter((slot) => slot.records.length === 0);
    if (uncovered.length > 0) {
      return fail(
        'unknown_capability_record',
        `the registry snapshot demonstrates no subject for required capabilit${uncovered.length === 1 ? 'y' : 'ies'} ${uncovered
          .map((slot) => `"${slot.capability}"`)
          .join(', ')} — characterizeCoverage emits the discovery level-3 record (new-body-spec-required); the forge is T017's, never the compiler's`,
        'requiredCapabilities',
      );
    }

    // The deterministic derived run id over the FULL compile context.
    const searchRunId = searchRunIdOf({
      goal: input.goal,
      constraints: input.constraints,
      budgets: input.budgets,
      registrySnapshot: input.registrySnapshot,
      seed: input.seed,
      compilerVersion: input.compilerVersion,
      requiredCapabilities: input.requiredCapabilities,
      gaps: input.gaps,
    });

    // 3. Seeded enumeration (declared truncation at the search bound).
    const vectors = enumerateAssignments(slots, input.seed, input.budgets.maxEnumeratedCandidates);
    if (vectors.length === 0) {
      return fail('unknown_capability_record', 'the search space is empty', 'registrySnapshot');
    }

    // 4-5. Measure, score and screen every enumerated candidate (in order).
    const lineageBase = {
      goalRef: input.goal.id,
      goalVersion: input.goal.version,
      constraintSetRef: input.constraints.id,
      constraintSetVersion: input.constraints.version,
      registrySnapshotDigest: input.registrySnapshot.digest,
      seed: input.seed,
      compilerVersion: input.compilerVersion,
      tenantId: input.tenantId,
      projectId: input.projectId,
    };
    const ranked: {
      readonly candidateId: string;
      readonly sequence: number;
      readonly blueprint: OrganizationBlueprint;
      readonly measurements: ObjectiveMeasurements;
      readonly objective: NonNullable<ReturnType<typeof aggregateScore>>;
      readonly reasons: readonly CandidateRejectionReason[];
    }[] = [];
    vectors.forEach((vector, index) => {
      const sequence = index + 1;
      const candidateId = `candidate-${sequence}`;
      const blueprint = blueprintFor(input, slots, vector);
      const measurements = measurementsFor(input, slots, vector, searchRunId);
      const objective = aggregateScore(measurements);
      if (objective === null) throw new Error('reference aggregation failed (contract violation)');
      const reasons = screenCandidate(input, blueprint, measurements);
      ranked.push({ candidateId, sequence, blueprint, measurements, objective, reasons });
    });

    // 6. Selection: rank the FEASIBLE candidates by the declared rule;
    //    propose the best, retain the next retainLimitK, reject the rest
    //    — with FULL history (L11).
    const feasible = ranked.filter((candidate) => candidate.reasons.length === 0);
    if (feasible.length === 0) {
      return fail(
        'unknown_capability_record',
        'no enumerated candidate satisfies the measurable blocking constraints and budgets under the given inputs — every candidate is retained as a rejected record only within a completed search, and this search cannot complete',
        'budgets',
      );
    }
    const ordered = [...feasible].sort((a, b) =>
      compareByTieBreakRule(
        { score: a.objective.score, measurements: a.measurements, candidateId: a.candidateId },
        { score: b.objective.score, measurements: b.measurements, candidateId: b.candidateId },
      ),
    );
    const proposedId = ordered[0]?.candidateId as string;
    const retainedIds = new Set(
      ordered.slice(1, 1 + input.budgets.retainLimitK).map((candidate) => candidate.candidateId),
    );

    const candidates: OrganizationCandidate[] = ranked.map((candidate) => {
      let disposition: 'proposed' | 'retained' | 'rejected';
      let reasons: readonly CandidateRejectionReason[];
      if (candidate.reasons.length > 0) {
        disposition = 'rejected';
        reasons = candidate.reasons;
      } else if (candidate.candidateId === proposedId) {
        disposition = 'proposed';
        reasons = [];
      } else if (retainedIds.has(candidate.candidateId)) {
        disposition = 'retained';
        reasons = [];
      } else {
        disposition = 'rejected';
        reasons = [{ code: 'retain-limit', retainedCount: input.budgets.retainLimitK }];
      }
      return {
        candidateId: candidate.candidateId as CandidateId,
        sequence: candidate.sequence,
        blueprint: candidate.blueprint,
        measurements: candidate.measurements,
        objective: candidate.objective,
        lineage: {
          ...lineageBase,
          parentCandidateId:
            candidate.sequence === 1 ? null : (`candidate-${candidate.sequence - 1}` as CandidateId),
        },
        disposition,
        reasons,
      } as unknown as OrganizationCandidate;
    });

    // 7. Discovery trace: the loop steps, plus per-SUBJECT dispositions
    //    (proposed-organization members retained; others rejected).
    const discovery: DiscoveryStep[] = [...characterizeCoverage(input)];
    const generatedSubjects = new Map<string, { readonly subject: unknown; readonly record: CapabilityRecordMirror }>();
    for (const candidate of candidates) {
      for (const assignment of candidate.blueprint.assignments) {
        generatedSubjects.set(JSON.stringify(assignment.subject), {
          subject: assignment.subject,
          record: {
            recordId: assignment.capabilityRecordRefs[0] as never,
            subject: assignment.subject as never,
            descriptors: [] as never,
            compatibilityRefs: [] as never,
          },
        });
      }
    }
    const proposed = candidates.find((candidate) => candidate.disposition === 'proposed') as OrganizationCandidate;
    const memberSubjects = new Set(proposed.blueprint.assignments.map((assignment) => JSON.stringify(assignment.subject)));
    discovery.push({
      step: 'candidates-generated',
      subjectRefs: [...generatedSubjects.keys()].map((key) => JSON.parse(key) as never),
    });
    const benchmarkRefs = benchmarkRefsFor(input, input.requiredCapabilities);
    const resultRefs = collectResultRefs(input);
    discovery.push({
      step: 'candidates-benchmarked',
      benchmarkRefs: benchmarkRefs.length > 0 ? benchmarkRefs : ['bench/none-declared'],
      resultRefs: resultRefs.length > 0 ? resultRefs : ['result/none-declared'],
    });
    const recordById = new Map<string, CapabilityRecordMirror>();
    for (const slot of slots) {
      for (const record of slot.records) recordById.set(record.recordId, record);
    }
    for (const [key, entry] of generatedSubjects) {
      if (memberSubjects.has(key)) {
        const record = recordById.get(entry.record.recordId as string);
        discovery.push({
          step: 'candidate-retained',
          subject: JSON.parse(key) as never,
          capabilityRecordRefs: record === undefined ? [] : [record.recordId],
        });
      } else {
        discovery.push({
          step: 'candidate-rejected',
          subject: JSON.parse(key) as never,
          reason: 'not-selected',
        });
      }
    }

    const log: SearchLog = {
      searchRunId,
      tenantId: input.tenantId,
      projectId: input.projectId,
      goal: input.goal,
      constraints: input.constraints,
      budgets: input.budgets,
      registrySnapshot: input.registrySnapshot,
      seed: input.seed,
      compilerVersion: input.compilerVersion,
      strategy: REFERENCE_STRATEGY,
      requiredCapabilities: [...input.requiredCapabilities],
      candidates,
      discovery,
      selection: { selectedCandidateId: proposed.candidateId },
    } as unknown as SearchLog;

    // The package-level enforcement point re-validates; a strategy bug is
    // a typed failure here, never a broken log downstream.
    const validated = validateSearchLog(log);
    if (!validated.ok) return validated;
    return { ok: true, value: validated.value };
  },
};

function aggregateScore(
  measurements: ObjectiveMeasurements,
): { readonly score: number; readonly components: Record<string, number>; readonly inputDigest: string } | null {
  const result = aggregateOrganizationObjective(measurements, REFERENCE_STRATEGY);
  if (!result.ok) return null;
  return result.value as unknown as {
    readonly score: number;
    readonly components: Record<string, number>;
    readonly inputDigest: string;
  };
}

function collectResultRefs(input: CompileInput): readonly string[] {
  const refs = new Set<string>();
  for (const capability of input.requiredCapabilities) {
    for (const record of queryByCapabilityMirror(input.registrySnapshot, { requires: [capability] })) {
      for (const descriptor of record.descriptors) {
        for (const evidence of descriptor.evidence) {
          if (evidence.kind === 'measurement-record') refs.add(evidence.recordRef);
          else if (evidence.kind === 'result-ref') refs.add(evidence.resultRef);
        }
      }
    }
  }
  return [...refs];
}

// Re-exported for the service's public API (fixture-driven discovery gaps).
export { createCapabilityGap };
