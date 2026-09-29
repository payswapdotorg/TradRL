/**
 * @tradrl/organization-compiler — public API.
 *
 * Owning Work Order: T016 (frozen write surface:
 * services/organization-compiler).
 *
 * The reference compiler implementing @tradrl/organization's
 * CompilerContract: seeded deterministic enumeration over the substrate
 * capability registry snapshot, declared measurement derivations,
 * weighted-sum-v1 objective aggregation, retain-top-k-with-full-history.
 * Zero runtime dependencies; the service consumes the organization
 * contract package via a relative source import — the frozen workspace
 * lockfile admits no new package dependency edges on this branch (the
 * same discipline every service on this base uses); linking the
 * workspace packages is a merge-time concern for the Tech Lead.
 *
 * Spec anchors: spec/ARCHITECTURE.md ("Organization compiler" — the
 * seven-axis discovery and the seven-component optimization, both
 * DECLARED); spec/LEARNING-LOOP.md ("Organization learning"); spec/
 * CAPABILITY-DISCOVERY.md (the discovery loop, measured evidence,
 * safety); spec/ARCHITECTURE-LOCK.md L9/L10/L11/L12/L16a.
 */

// The declared measurement derivations (one pure function per component)
export type { SlotCoverage, MeasurableAxis } from './derivations';
export {
  MEASURABLE_SUBJECTS,
  deriveAttainmentScore,
  deriveRiskPolicyRefs,
  deriveRiskPenalty,
  deriveComputeUnits,
  deriveCoordinationCostWires,
  deriveLatencyMs,
  deriveRobustness,
  deriveRedundancy,
  deriveTopology,
  deriveTrainingAllocation,
  deriveDecisionCadence,
} from './derivations';

// The reference compiler strategy (CompilerContract implementation)
export type { AssignmentEntry, AssignmentVector } from './strategy';
export {
  REFERENCE_COMPILER_VERSION,
  REFERENCE_STRATEGY,
  referenceCompiler,
  characterizeCoverage,
  seededSlotOrder,
  enumerateAssignments,
  screenCandidate,
} from './strategy';

// The reproducibility serializer (canonical bytes <-> validated log)
export {
  serializeCandidateLog,
  digestOfSerializedLog,
  parseCandidateLog,
  registryDigestBinds,
} from './serializer';

// The deterministic fixtures (fake registry snapshot, goal/constraint pair)
export {
  fixtureGoal,
  fixtureConstraints,
  fixtureSnapshot,
  fixtureBudgets,
  fixtureRequiredCapabilities,
  fixtureGaps,
  fixtureCompileInput,
} from './fixtures';

// The golden determinism constants (byte-stable across runs)
export { GOLDEN_LOG_DIGEST, GOLDEN_CANDIDATE_SEQUENCE } from './golden';

/** Package identity and ownership (governance surface). */
export const packageInfo = {
  name: '@tradrl/organization-compiler',
  owner: 'T016',
  status: 'implemented',
  concepts: [
    'referenceCompiler',
    'REFERENCE_STRATEGY',
    'characterizeCoverage',
    'enumerateAssignments',
    'serializeCandidateLog',
    'GOLDEN_LOG_DIGEST',
  ],
} as const;
