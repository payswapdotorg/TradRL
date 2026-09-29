// @tradrl/research (service) — the regime lane's public surface.
//
// Work Order T022 (frozen write surface: bodies/regime-researcher,
// services/research/src/regime, services/research/src/index.ts — additive
// re-export line only). The implementation lives in src/regime/ (the
// nested-service precedent: services/market-world with src/replay +
// src/reactive; services/research with src/sentiment beside this lane).
// The service is a PROTOCOL implementation over its own lane's contract
// package (bodies/regime-researcher): no network, no LLM calls, no
// imports across lanes — the cognitive substrate executes the body at
// runtime, outside this package.
//
// THE SERVICE-ROOT COLLISION LAW: the sentiment lane (T021, frozen)
// already publishes the shared generic names through the service root,
// and a second `export *` of those names would be a TS2308 ambiguity.
// This lane's public surface therefore exports ONLY regime-prefixed (or
// otherwise unique) names; the contract primitives live in the body
// package (bodies/regime-researcher) and this lane's tests import them
// through the body package's own surface.

export type {
  RegimeRunConfig,
  RegimePipelineInputs,
  RegimeRunOutcome,
  RegimeIntakeSnapshot,
  RegimeClassificationStage,
  RegimeChangeDetectionStage,
} from './pipeline';
export {
  validateRegimeRunConfig,
  regimeRunId,
  runRegimeIntake,
  runRegimeClassification,
  runRegimeChangeDetection,
  computeRegimeDataGaps,
  runRegimePipeline,
  serializeRegimeRunConfig,
} from './pipeline';

export type { RegimeRunStep, RegimeRunState, RegimeRunCompletion } from './run-state';
export {
  REGIME_RUN_STATE_SCHEMA,
  createRegimeRunState,
  serializeRegimeRunState,
  validateRegimeRunState,
  parseRegimeRunState,
  intakeRegimeRunState,
  completeRegimeRunState,
  advanceRegimeRunState,
  resumeRegimeRunState,
} from './run-state';

export {
  REGIME_AT0,
  REGIME_AS_OF,
  REGIME_RUN_CONFIG,
  REGIME_STREAM,
  REGIME_OUTCOME,
  REGIME_GOLDEN_REPORT,
  REGIME_L4_VIOLATION_STREAM,
  regimeFixtureSource,
  regimeFixtureInputs,
  l4RegimeViolationSource,
  regimeAuthorityViolationSpec,
  evidenceLessClassification,
  futureCitationClassification,
  undeclaredMethodClassification,
  magicLabelClassification,
} from './fixtures';

/** The regime lane's identity card (uniquely named — the service root already carries `serviceInfo`). */
export const regimeServiceInfo = {
  name: '@tradrl/research',
  lane: 'regime',
  owner: 'T022',
  status: 'implemented',
  concepts: [
    'RegimeRunConfig',
    'runRegimePipeline',
    'runRegimeIntake',
    'runRegimeClassification',
    'runRegimeChangeDetection',
    'RegimeRunState',
    'advanceRegimeRunState',
    'resumeRegimeRunState',
  ],
} as const;
