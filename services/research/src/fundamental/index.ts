// @tradrl/research (service) — the fundamental lane's public surface.
//
// Work Order T023 (frozen write surface: bodies/fundamental-researcher,
// bodies/cross-market-researcher, services/research/src/fundamental,
// services/research/src/cross-market, services/research/src/index.ts —
// additive re-export lines only). The implementation lives in
// src/fundamental/ (the nested-service precedent: services/market-world
// with src/replay + src/reactive; services/research with src/sentiment
// and src/regime beside this lane). The service is a PROTOCOL
// implementation over its own lane's contract package
// (bodies/fundamental-researcher): no network, no LLM calls, no imports
// across lanes — the cognitive substrate executes the body at runtime,
// outside this package.
//
// THE SERVICE-ROOT COLLISION LAW: the sentiment lane (T021, frozen)
// already publishes the shared generic names through the service root,
// and a second `export *` of those names would be a TS2308 ambiguity.
// This lane's public surface therefore exports ONLY fundamental-prefixed
// (or otherwise unique) names; the contract primitives live in the body
// package (bodies/fundamental-researcher) and this lane's tests import
// them through the body package's own surface.

export type {
  FundamentalRunConfig,
  FundamentalPipelineInputs,
  FundamentalRunOutcome,
  FundamentalIntakeSnapshot,
} from './pipeline';
export {
  validateFundamentalRunConfig,
  fundamentalRunId,
  runFundamentalIntake,
  runFundamentalAssessment,
  runCorporateActionDigestion,
  runFundamentalPipeline,
  serializeFundamentalRunConfig,
} from './pipeline';

export type { FundamentalRunStep, FundamentalRunState, FundamentalRunCompletion } from './run-state';
export {
  FUNDAMENTAL_RUN_STATE_SCHEMA,
  createFundamentalRunState,
  serializeFundamentalRunState,
  validateFundamentalRunState,
  parseFundamentalRunState,
  intakeFundamentalRunState,
  completeFundamentalRunState,
  advanceFundamentalRunState,
  resumeFundamentalRunState,
} from './run-state';

export {
  FUNDAMENTAL_AT0,
  FUNDAMENTAL_AS_OF,
  FUNDAMENTAL_RUN_CONFIG,
  FUNDAMENTAL_STREAM,
  FUNDAMENTAL_OUTCOME,
  FUNDAMENTAL_GOLDEN_REPORT,
  FUNDAMENTAL_L4_VIOLATION_STREAM,
  fundamentalFixtureSource,
  fundamentalFixtureInputs,
  fundamentalL4ViolationSource,
  fundamentalAuthorityViolationBodySpec,
  fundamentalEvidenceLessAssessment,
  fundamentalFutureCitationAssessment,
  fundamentalUndeclaredMethodAssessment,
} from './fixtures';

/** The fundamental lane's identity card (uniquely named — the service root already carries `serviceInfo`). */
export const fundamentalServiceInfo = {
  name: '@tradrl/research',
  lane: 'fundamental',
  owner: 'T023',
  status: 'implemented',
  concepts: [
    'FundamentalRunConfig',
    'runFundamentalPipeline',
    'runFundamentalIntake',
    'runFundamentalAssessment',
    'runCorporateActionDigestion',
    'FundamentalRunState',
    'advanceFundamentalRunState',
    'resumeFundamentalRunState',
  ],
} as const;
