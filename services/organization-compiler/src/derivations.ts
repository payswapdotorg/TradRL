/**
 * @tradrl/organization-compiler — the DECLARED measurement derivations.
 *
 * THE LAW THIS MODULE OBEYS: "Optimization is DECLARED, not implicit"
 * (Work Order T016, section 3). Every number the reference compiler puts
 * into an `ObjectiveMeasurements` record is produced by ONE of the pure
 * functions below, and every function's rule is written here, citing the
 * registry evidence it reads. No hidden weights, no hidden formulas, no
 * ambient data — the derivations are pure functions of (input, snapshot,
 * assignment vector).
 *
 * Spec anchors: spec/ARCHITECTURE.md ("Organization compiler": "Optimize
 * objective attainment, risk, compute, coordination cost, latency,
 * robustness and redundancy"); spec/CAPABILITY-DISCOVERY.md
 * (Reproducibility: "Record candidate roles, bodies, models, benchmarks,
 * datasets, configuration, cost, latency, environment, outcomes and
 * rejected candidates"); spec/ARCHITECTURE-LOCK.md L16a (measured
 * evidence only), L7 (attainment is evidence-referenced, never a bare
 * PnL figure).
 */

import {
  type CapabilityKey,
  type CapabilityRecordMirror,
  type CompileInput,
  type RegistrySubjectMirror,
  type TopicName,
  measuredValueOf,
  topicName,
} from '../../../packages/organization/src/index';

// ---------------------------------------------------------------------------
// Slot coverage (the demand -> per-slot candidate subjects)
// ---------------------------------------------------------------------------

/**
 * One slot of the reference search: a required capability contract plus
 * the registry records that demonstrate it (the slot's candidate
 * assignments), in the SEEDED order the enumeration walks them.
 */
export interface SlotCoverage {
  /** The required capability contract (the slot's demand). */
  readonly capability: CapabilityKey;
  /** The covering records, seeded-ordered (see strategy.ts). */
  readonly records: readonly CapabilityRecordMirror[];
}

/**
 * The measurable constraint-subject map — the DECLARED mapping from
 * constraint subjects to search measurements. The organization search
 * screens ONLY what it can measure; every other constraint binds
 * evaluation (T012), never the search:
 *
 *   `compute.units`       -> ObjectiveMeasurements.computeUnits
 *   `latency.p95Ms`       -> ObjectiveMeasurements.latencyMs
 *   `coordination.wires`  -> ObjectiveMeasurements.coordinationCostWires
 *   `agentCount.count`    -> the blueprint's agentCount
 */
export const MEASURABLE_SUBJECTS = {
  'compute.units': 'compute',
  'latency.p95Ms': 'latency',
  'coordination.wires': 'coordinationCost',
  'agentCount.count': 'agentCount',
} as const;

/** One measurable constraint axis. */
export type MeasurableAxis = (typeof MEASURABLE_SUBJECTS)[keyof typeof MEASURABLE_SUBJECTS];

// ---------------------------------------------------------------------------
// DECLARED DERIVATION RULES (one pure function per measured component)
// ---------------------------------------------------------------------------

/**
 * DERIVATION attainmentScore — DECLARED RULE: the unweighted mean of the
 * per-slot benchmark scores; a slot's benchmark score is the
 * `benchmark-score` measurement on its assigned record's descriptor FOR
 * THE SLOT'S REQUIRED CAPABILITY; when the record carries no such
 * measurement the slot contributes the declared neutral prior 0.5 (an
 * evidence-backed assignment without a normalized score is neither good
 * nor bad). The mean is clamped to [0, 1].
 */
export function deriveAttainmentScore(slots: readonly SlotCoverage[]): number {
  if (slots.length === 0) return 0;
  let sum = 0;
  for (const slot of slots) {
    sum += slotBenchmarkScore(slot);
  }
  const mean = sum / slots.length;
  return mean < 0 ? 0 : mean > 1 ? 1 : mean;
}

function slotBenchmarkScore(slot: SlotCoverage): number {
  const record = slot.records[0];
  if (record === undefined) return 0.5; // declared neutral prior
  const descriptor = record.descriptors.find((d) => d.capability === slot.capability);
  if (descriptor === undefined) return 0.5;
  for (const evidence of descriptor.evidence) {
    if (evidence.kind === 'measurement-record' && evidence.metric === 'benchmark-score') {
      return evidence.value >= 0 && evidence.value <= 1 ? evidence.value : 0.5;
    }
  }
  return 0.5; // declared neutral prior (e.g. result-ref-only evidence)
}

/**
 * DERIVATION riskPolicyRefs — DECLARED RULE: the ids of the constraint
 * set's BLOCKING constraints are the opaque references to the independent
 * gates the organization must satisfy (risk/authorization/execution
 * policy remain independent gates — spec/CAPABILITY-DISCOVERY.md Safety;
 * citing them as refs is legal, embedding authority is not).
 */
export function deriveRiskPolicyRefs(input: CompileInput): readonly string[] {
  return input.constraints.constraints
    .filter((constraint) => constraint.severity === 'blocking')
    .map((constraint) => constraint.id);
}

/**
 * DERIVATION riskPenalty — DECLARED RULE: the share of BLOCKING
 * constraints whose subjects the search CANNOT measure (the residual risk
 * the organization carries forward to evaluation — the honest penalty for
 * flying with gates the search cannot screen). Fully measurable
 * constraint sets yield 0.
 */
export function deriveRiskPenalty(input: CompileInput): number {
  const blocking = input.constraints.constraints.filter(
    (constraint) => constraint.severity === 'blocking',
  );
  if (blocking.length === 0) return 0;
  const unmeasurable = blocking.filter(
    (constraint) => !(constraint.subject in MEASURABLE_SUBJECTS),
  );
  return unmeasurable.length / blocking.length;
}

/**
 * DERIVATION computeUnits — DECLARED RULE: the sum over slots of the
 * assigned record's `compute-units` measurement for the slot's required
 * capability; a record carrying no such measurement contributes the
 * declared default 1 unit.
 */
export function deriveComputeUnits(slots: readonly SlotCoverage[]): number {
  let sum = 0;
  for (const slot of slots) {
    const record = slot.records[0];
    if (record === undefined) {
      sum += 1;
      continue;
    }
    const measured = measuredValueOf(record, 'compute-units');
    sum += measured === null ? 1 : Math.max(0, measured);
  }
  return sum;
}

/**
 * DERIVATION coordinationCostWires — DECLARED RULE: the measured wire
 * count of the derived topology (see {@link deriveTopology}); the
 * reference topology wires every (publisher, subscriber) pair except
 * self-pairs, so an n-slot organization measures n*(n-1) wires.
 */
export function deriveCoordinationCostWires(topology: {
  readonly wires: readonly {
    readonly topic: TopicName;
    readonly publishers: readonly string[];
    readonly subscribers: readonly string[];
  }[];
}): number {
  let wires = 0;
  for (const wire of topology.wires) {
    for (const publisher of wire.publishers) {
      for (const subscriber of wire.subscribers) {
        if (publisher !== subscriber) wires += 1;
      }
    }
  }
  return wires;
}

/**
 * DERIVATION latencyMs — DECLARED RULE: the MAXIMUM over slots of the
 * assigned record's `p95-latency-ms` measurement (the organization thinks
 * as fast as its slowest member); a record carrying no such measurement
 * contributes the declared default 1000 ms.
 */
export function deriveLatencyMs(slots: readonly SlotCoverage[]): number {
  let max = 0;
  for (const slot of slots) {
    const record = slot.records[0];
    const measured = record === undefined ? null : measuredValueOf(record, 'p95-latency-ms');
    const latency = measured === null ? 1000 : Math.max(0, measured);
    if (latency > max) max = latency;
  }
  return max;
}

/**
 * DERIVATION robustness — DECLARED RULE: the specialization-diversity
 * score. A one-slot organization scores the declared baseline 0.5; an
 * n-slot organization scores 0.5 + 0.5 * (distinctSubjects - 1) / (n - 1)
 * — fully distinct assignments score 1.0, fully identical assignments
 * score 0.5 (clamped to [0, 1]).
 */
export function deriveRobustness(subjects: readonly RegistrySubjectMirror[]): number {
  if (subjects.length <= 1) return 0.5;
  const distinct = new Set(subjects.map((subject) => JSON.stringify(subject))).size;
  const score = 0.5 + (0.5 * (distinct - 1)) / (subjects.length - 1);
  return score > 1 ? 1 : score;
}

/**
 * DERIVATION redundancy — DECLARED RULE: the share of slots whose
 * assigned subject ALSO demonstrates at least one OTHER required
 * capability (backup coverage: if the specialist falls, another member
 * holds a related contract).
 */
export function deriveRedundancy(
  slots: readonly SlotCoverage[],
  allRequired: readonly CapabilityKey[],
): number {
  if (slots.length === 0) return 0;
  let covered = 0;
  for (const slot of slots) {
    const record = slot.records[0];
    if (record === undefined) continue;
    const others = allRequired.filter((capability) => capability !== slot.capability);
    if (others.length === 0) continue;
    const offered = new Set(record.descriptors.map((descriptor) => descriptor.capability));
    if (others.some((capability) => offered.has(capability))) covered += 1;
  }
  return covered / slots.length;
}

// ---------------------------------------------------------------------------
// Topology / training / cadence derivations (blueprint axes 4-6)
// ---------------------------------------------------------------------------

/**
 * DERIVATION topology — DECLARED RULE: one topic, `org.coordination`
 * (topic names are tenant-scoped at runtime — L12 — so the fixed name is
 * collision-free within a tenant), with EVERY slot publishing and
 * subscribing (the all-to-all coordination pattern; the wire
 * MEASUREMENT excludes self-pairs).
 */
export function deriveTopology(
  slotIds: readonly string[],
): { readonly wires: readonly { readonly topic: TopicName; readonly publishers: readonly string[]; readonly subscribers: readonly string[] }[] } {
  return {
    wires: [
      {
        topic: topicName('org.coordination'),
        publishers: [...slotIds],
        subscribers: [...slotIds],
      },
    ],
  };
}

/**
 * DERIVATION trainingAllocation — DECLARED RULE: every slot is trained;
 * the method is `supervised` when the assigned record carries a
 * `benchmark-score` measurement for the slot's capability (scored
 * evidence: fit a supervised objective), else `statistical-causal` (the
 * declared default for un-scored evidence). The per-slot compute grant is
 * floor(maxComputeUnits / (2 * agentCount)) with a minimum of 1 — HALF
 * the compute budget is reserved for training, the rest for operations
 * (declared split).
 */
export function deriveTrainingAllocation(
  slots: readonly SlotCoverage[],
  maxComputeUnits: number,
): readonly { readonly slotId: string; readonly method: 'supervised' | 'statistical-causal'; readonly computeUnits: number }[] {
  const grant = Math.max(1, Math.floor(maxComputeUnits / (2 * Math.max(1, slots.length))));
  return slots.map((slot, index) => {
    const record = slot.records[0];
    const scored =
      record !== undefined &&
      record.descriptors.some(
        (descriptor) =>
          descriptor.capability === slot.capability &&
          descriptor.evidence.some(
            (evidence) => evidence.kind === 'measurement-record' && evidence.metric === 'benchmark-score',
          ),
      );
    return {
      slotId: `slot-${index + 1}`,
      method: scored ? ('supervised' as const) : ('statistical-causal' as const),
      computeUnits: grant,
    };
  });
}

/**
 * DERIVATION decisionCadence — DECLARED RULE: a slot decides at an
 * interval of 10x its assigned record's `p95-latency-ms` measurement
 * (declared: decide at least an order of magnitude slower than thinking),
 * with the declared default 10000 ms for records without a latency
 * measurement.
 */
export function deriveDecisionCadence(
  slots: readonly SlotCoverage[],
): readonly { readonly slotId: string; readonly intervalMs: number }[] {
  return slots.map((slot, index) => {
    const record = slot.records[0];
    const measured = record === undefined ? null : measuredValueOf(record, 'p95-latency-ms');
    const latency = measured === null ? 1000 : Math.max(1, measured);
    return { slotId: `slot-${index + 1}`, intervalMs: Math.max(1, Math.round(latency * 10)) };
  });
}
