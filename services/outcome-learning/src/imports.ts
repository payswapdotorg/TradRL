// @tradrl/outcome-learning (service) — the lane's single import surface.
//
// Work Order T033. One module owning every cross-module import so the
// frozen workspace lockfile story stays legible (the research/regime
// and body-forge precedent): the service imports ITS OWN LANE's
// contract package — packages/outcomes — via a relative source path,
// exactly as services/research/src/regime imports bodies/
// regime-researcher and services/shadow-trading imports the
// execution-policy/risk contract packages. Every OTHER lane's shapes
// (T030's shadow outcome stream, T011's trajectory/experiment records)
// are already STRUCTURAL MIRRORS inside that package (law
// D-003/D-004); this lane imports NOTHING else — zero workspace
// dependencies in package.json, zero cross-lane source imports in src.
// Cross-lane trip wires against the REAL services (shadow-trading,
// trajectory, experiments) and the REAL decimal kernel
// (execution-policy) live in interop.test.ts (test-only imports).

export type {
  TenantRef,
  ProjectRef,
  DecisionRef,
  IntentRef,
  SessionRef,
  TrajectoryRef,
  ExperimentRef,
  TrialRef,
  OutcomeRecordId,
  PostMortemId,
  LearningHookId,
} from '../../../packages/outcomes/src/ids';
export { isTimestampMs, asTimestampMs } from '../../../packages/outcomes/src/primitives';
export type { JsonValue, JsonObject, TimestampMs } from '../../../packages/outcomes/src/primitives';
export type { OutcomesErrorCode, OutcomesError, OutcomesResult } from '../../../packages/outcomes/src/errors';
export { fail, failures, ok } from '../../../packages/outcomes/src/errors';
export {
  canonicalJson,
  deepFreeze,
  fnv1a32Hex,
  isDigest,
  isRecord,
  isNonEmptyString,
  isCanonicalUnsignedDecimal,
  isCanonicalSignedDecimal,
  isUnitIntervalDecimal,
  signedAdd,
  signedSubtract,
  signedCompare,
  signedAbs,
  unsignedAdd,
  isZeroDecimal,
} from '../../../packages/outcomes/src/primitives';
export type {
  ShadowDispositionMirror,
  ShadowLineageMirror,
  ShadowCostsMirror,
  ShadowOutcomeRecordMirror,
  ShadowOutcomeLogMirror,
  DecisionFactsMirror,
  FillFactsMirror,
} from '../../../packages/outcomes/src/shadow-stream-mirror';
export {
  isShadowDispositionMirror,
  isShadowLineageMirror,
  isShadowOutcomeRecordMirror,
  isShadowOutcomeLogMirror,
  verifyShadowOutcomeChainMirror,
  shadowOutcomeStreamDigestMirror,
  isDecisionFactsMirror,
  isFillFactsMirror,
} from '../../../packages/outcomes/src/shadow-stream-mirror';
export type { OutcomeClass, EvidenceKind, EvidenceRef } from '../../../packages/outcomes/src/index';
export {
  OUTCOME_CLASSES,
  isOutcomeClass,
  requireOutcomeClass,
  classifyOutcome,
  isEvidenceRef,
  requireEvidenceRef,
} from '../../../packages/outcomes/src/index';
export type {
  AttributionClass,
  AttributionHypothesis,
  DecisionDimension,
  ModelErrorKind,
  MarketMoveDirection,
  DecisionAttribution,
  MarketMoveAttribution,
  ModelErrorAttribution,
  DataLagAttribution,
} from '../../../packages/outcomes/src/attribution';
export {
  ATTRIBUTION_CLASSES,
  isAttributionClass,
  requireAttributionClass,
  hypothesisOrder,
} from '../../../packages/outcomes/src/attribution';
export type {
  OutcomeRecord,
  PostMortemRecord,
  OutcomeLearningLog,
  PostMortemLog,
  LearningFocus,
  OutcomeLearningHook,
} from '../../../packages/outcomes/src/index';
export {
  startOutcomeLearningLog,
  startPostMortemLog,
  appendOutcomeRecord,
  appendPostMortem,
  verifyOutcomeLearningChain,
  verifyPostMortemChain,
  isOutcomeLearningLog,
  isPostMortemLog,
  outcomeLearningLogDigest,
  postMortemLogDigest,
  mintOutcomeRecord,
  mintPostMortem,
  compileOutcomeLearningHook,
  OUTCOME_LEARNING_CHAIN_SEED,
  POSTMORTEM_CHAIN_SEED,
} from '../../../packages/outcomes/src/index';
