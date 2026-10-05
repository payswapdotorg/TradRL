/**
 * T048 — the reference end-to-end trading slice (the public surface).
 *
 * One deterministic market day through the WHOLE platform: the REAL
 * adapter sessions (T037/T038) over scripted transports, the REAL
 * reactive world (T027) matched by the REAL exchange-sim engine, the
 * REAL strategy compiler (T018), the REAL director synthesis (T024),
 * the REAL execution body (T025), the REAL execution gateway (T040)
 * over the REAL T019 gate + T020 risk engine + T040 authority, and
 * the REAL shadow-trading session (T030) out to the chain-verified
 * realized-outcome log.
 *
 * START HERE: `runReferenceSlice()` (./run.ts) — the whole loop in one
 * call; README.md — the architecture walkthrough, what is simulated,
 * and the honest limitations.
 */

// The whole loop
export { runReferenceSlice } from './run';
export type { SliceReport } from './run';

// The stations (each independently drivable — the tests' substrate)
export { collectMarketData } from './market-data';
export type { MarketDataStation } from './market-data';
export { scriptedTransport } from './scripted-transport';
export type { ScriptedInbound, RecordedOutbound } from './scripted-transport';
export {
  buildReactiveWorld,
  realEngineDriver,
  slicePhysics,
  slicePhysicsRefs,
  sliceWorldConfig,
  sliceWorldSpec,
  sliceTimeMachine,
  WORLD_ID,
  ENVIRONMENT_ID,
  WORLD_AS_OF,
  SHADOW_PARTICIPANT,
  ADVERSARY_PARTICIPANT,
  MACHINE_DATASET,
} from './reactive-world';
export type { ReactiveWorldStation } from './reactive-world';
export {
  compileSliceRun,
  compileSliceStep2,
  compileRefusingSliceRun,
  refusalCauses,
  sliceSpec,
  sliceGoal,
  sliceConstraintSet,
  sliceRefusingConstraintSet,
  sliceWindow,
  sliceWindow2,
  sliceGenesisPortfolio,
  sliceStep1Fills,
  sliceStep2State,
  STRATEGY_STEP2_AT,
  SPEC_ID,
  GOAL_ID,
  CONSTRAINT_SET_ID,
  WINDOW_ID,
} from './strategy';
export {
  composeSliceDecision,
  composeSliceEscalation,
  futureResearchRefusal,
  sliceDirectorInput,
  sliceQuorumUnmetInput,
  sliceFutureResearchInput,
  DIRECTOR_SCOPE,
} from './director';
export {
  buildSliceGateway,
  submitThroughGateway,
  sliceGrant,
  sliceRegistry,
  sliceRoutingTable,
  sliceGatePortfolio,
  sliceVenueState,
  sliceExposure,
} from './gateway';
export type { SliceGateway, SliceGatewayOptions, SliceGrantOverrides, GatewayLaneResult } from './gateway';
export {
  buildSliceShadowSession,
  runShadowLane,
  runCrossTenantRefusal,
  liveModeClaimRefusal,
  realizedOutcomes,
  decisionSourceOf,
  crossTenantIntent,
} from './shadow';
export type { ShadowLaneResult, RealizedOutcomeSummary, CrossTenantRefusal, SliceShadowSession, SliceShadowSessionOptions } from './shadow';
export { recordOrderLane, stateOf } from './execution-body';
export type { ExecutionBodyStation } from './execution-body';
export { sliceKillSwitch, thrownSliceKillSwitch, sliceExecutionPolicy, sliceRiskPolicy, slicePolicyInput } from './control-stack';

// The scope (the slice's single set of literals)
export * from './scope';
