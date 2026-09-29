// @tradrl/research (service) — the cross-market lane's public surface.
//
// Work Order T023 (frozen write surface: bodies/fundamental-researcher,
// bodies/cross-market-researcher, services/research/src/fundamental,
// services/research/src/cross-market, services/research/src/index.ts —
// additive re-export lines only). The implementation lives in
// src/cross-market/ (the nested-service precedent: services/market-world
// with src/replay + src/reactive; services/research with src/sentiment,
// src/regime and src/fundamental beside this lane). The service is a
// PROTOCOL implementation over its own lane's contract package
// (bodies/cross-market-researcher): no network, no LLM calls, no imports
// across lanes — the cognitive substrate executes the body at runtime,
// outside this package.
//
// THE SERVICE-ROOT COLLISION LAW: the sentiment lane (T021, frozen)
// already publishes the shared generic names through the service root,
// and a second `export *` of those names would be a TS2308 ambiguity.
// This lane's public surface therefore exports ONLY cross-market
// prefixed (or otherwise unique) names; the contract primitives live in
// the body package (bodies/cross-market-researcher) and this lane's
// tests import them through the body package's own surface.

export type {
  CrossMarketRunConfig,
  CrossMarketPipelineInputs,
  CrossMarketRunOutcome,
  CrossMarketIntakeSnapshot,
} from './pipeline';
export {
  validateCrossMarketRunConfig,
  crossMarketRunId,
  runCrossMarketIntake,
  runRelationshipAnalysis,
  runCrossMarketPipeline,
  serializeCrossMarketRunConfig,
} from './pipeline';

export type { CrossMarketRunStep, CrossMarketRunState, CrossMarketRunCompletion } from './run-state';
export {
  CROSS_MARKET_RUN_STATE_SCHEMA,
  createCrossMarketRunState,
  serializeCrossMarketRunState,
  validateCrossMarketRunState,
  parseCrossMarketRunState,
  intakeCrossMarketRunState,
  completeCrossMarketRunState,
  advanceCrossMarketRunState,
  resumeCrossMarketRunState,
} from './run-state';

export {
  CROSS_MARKET_AT0,
  CROSS_MARKET_AS_OF,
  CROSS_MARKET_RUN_CONFIG,
  CROSS_MARKET_STREAM,
  CROSS_MARKET_OUTCOME,
  CROSS_MARKET_GOLDEN_REPORT,
  CROSS_MARKET_L4_VIOLATION_STREAM,
  crossMarketFixtureSource,
  crossMarketFixtureInputs,
  crossMarketL4ViolationSource,
  crossMarketAuthorityViolationBodySpec,
  crossMarketEvidenceLessRelationship,
  crossMarketFutureCitationRelationship,
  crossMarketUndeclaredMethodRelationship,
} from './fixtures';

/** The cross-market lane's identity card (uniquely named — the service root already carries `serviceInfo`). */
export const crossMarketServiceInfo = {
  name: '@tradrl/research',
  lane: 'cross-market',
  owner: 'T023',
  status: 'implemented',
  concepts: [
    'CrossMarketRunConfig',
    'runCrossMarketPipeline',
    'runCrossMarketIntake',
    'runRelationshipAnalysis',
    'CrossMarketRunState',
    'advanceCrossMarketRunState',
    'resumeCrossMarketRunState',
  ],
} as const;
