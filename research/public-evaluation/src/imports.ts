// @tradrl/research-public-evaluation — the lane's single OWN-LANE import
// surface (Work Order T049).
//
// One module owning every cross-directory import so the discipline stays
// legible (the services/marketplace precedent: "the service imports ITS
// OWN LANE's contract package — packages/entitlements — via a relative
// source path"; here the publication layer imports ITS OWN WORK ORDER's
// benchmark machinery — benchmarks/platform — the same T049 lane, the
// same dispatch, the same PR). The machinery carries NO package.json (the
// examples/ precedent: zero workspace edges — this is a relative source
// import, never a workspace-package import; D-003/D-004 govern CROSS-lane
// shapes, and every cross-lane shape the machinery consumes remains a
// STRUCTURAL MIRROR inside it).
//
// WHY the publication layer needs the REAL machinery (not a mirror of
// it): the deterministic RE-VERIFICATION law — "a published benchmark
// result must be re-runnable to the same bytes." reverifyPublishedRecord
// RE-RUNS runSuiteMeasurement over the retained sources and compares
// bytes; a mirrored runner would re-derive the scoring logic by copy (the
// exact drift the mirror discipline exists to avoid) while verifying the
// very thing the drift would corrupt. The own-lane import makes
// re-verification REAL.
//
// The shared CONTRACT PRIMITIVES (canonical JSON, the program-wide
// digest, guards) are NOT re-exported here: this package carries the
// identical module natively (primitives.ts — the program-wide discipline
// re-declared verbatim; the interop trip-wires prove the two agree). Only
// the machinery-OWNED surface flows through this module.

export type {
  SubjectKind,
  SubjectRefKind,
  SubjectBinding,
  AxisAttainment,
  SuiteAxis,
  SuiteDefinition,
  MeasurementPhase,
  AxisMeasurement,
  MeasurementMaterial,
  MeasurementSearchBinding,
  MeasurementRecord,
  MeasurementLog,
  MeasurementLogBinding,
  SearchContext,
  MeasurementRunInput,
  SliceReportMirror,
  SplitPlanMirror,
  SearchRecordMirror,
  EvidenceClass,
  MaterialSource,
  AxisKind,
} from '../../../benchmarks/platform/src/index';

export {
  isSubjectBinding,
  validateSubjectBinding,
  isAxisKind,
  suiteId,
  suiteDigest,
  validateSuiteDefinition,
  runSuiteMeasurement,
  verifyMeasurementRecord,
  canonicalMeasurement,
  measurementId,
  measurementContentJson,
  splitPlanDigest,
  verifySplitPlanMirror,
  verifySearchRecordLineage,
  isSliceReportMirror,
  slicePipelineViolations,
  // The machinery's MEASUREMENT LOG (the append-only, chain-verified history —
  // the same lane's log API; the publication layer's own log is its `pevl:`
  // twin over published records).
  isMeasurementLog,
  createMeasurementLog,
  appendMeasurement,
  verifyMeasurementLog,
  measurementLogId,
  measurementChainGenesis,
  measurementChainFold,
  computeMeasurementChainHead,
} from '../../../benchmarks/platform/src/index';
