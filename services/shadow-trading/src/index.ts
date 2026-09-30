/**
 * @tradrl/shadow_trading — the shadow-trading service (Work Order
 * T030): the paper-trading stage of the learning loop (spec/
 * LEARNING-LOOP.md curriculum stage 8) and the producer of the outcome
 * records T033 learns from.
 *
 * Public API:
 *   - `createShadowSession` / `processShadowDecision` /
 *     `runShadowSession` — the session: paper-execute an injected
 *     decision stream against the reactive world with the FULL control
 *     stack (T019's `runExecutionGate`, then T020's `evaluateLimits`
 *     with `executionLimitRefusals` feeding the gate) enforced BEFORE
 *     any submission; the time-machine cursor wired per its README
 *     contract (openCursor tip/start, drainCursor per tick, asOf
 *     warm-up, forkCursor for a second book); refusals as RECORDS.
 *   - `throwShadowKillSwitch` — the session-level kill switch (every
 *     subsequent decision refuses; the world receives nothing).
 *   - `forkShadowSession` — a second shadow book without rewinding the
 *     first (forkCursor).
 *   - `ShadowOutcomeRecord` / `ShadowRefusal` / `ShadowFill` / the
 *     append-only chain-verified `ShadowOutcomeLog` — T033's input
 *     surface (rewrite/reorder = typed `shadow_log_rewrite`).
 *   - `serializeShadowRunState` / `resumeShadowRunState` — canonical
 *     bytes, chain-verified resume (tamper = `chain_mismatch`).
 *   - The injected ports — `ReactiveWorldPort` / `TimeMachinePort`
 *     (structural mirrors of T027's and T029's public surfaces; the
 *     interop test drives the REAL services through them).
 *   - The mode-honesty law — `ShadowMode` = the literal 'shadow';
 *     'live'/'exact_replay' claims are typed `fidelity_claim_dishonest`
 *     (L5/R23: simulation evidence and live evidence are never
 *     conflated).
 *   - Fixtures — the deterministic golden scenario (7 decisions:
 *     filled x3, the risk-stage refusal, filled, partial, expired)
 *     over the scripted world + scripted machine; one fixture per
 *     refusal kind.
 *   - Golden — the byte-stable determinism constants.
 *
 * Package laws (mirroring the merged lanes):
 * - Zero runtime dependencies; types, guards and pure functions only.
 * - No `any`; every exported shape ships a hand-rolled total guard.
 * - All contract data is JSON-serializable and deeply frozen.
 * - No ambient clock (`Date.now()` never appears) and no ambient
 *   randomness; every id is content-addressed or ordinal-minted.
 * - Exact decimal arithmetic (BigInt fixed-point, via the execution-
 *   policy contract) on every money path — the typed
 *   `decimal_imprecision` trip wire rejects float mediation.
 * - The ONLY cross-lane imports are the two contract packages
 *   (@tradrl/execution-policy, @tradrl/risk) via RELATIVE SOURCE
 *   IMPORTS (the frozen lockfile admits no workspace edge — the
 *   services/strategy + services/execution-sim precedent; the Lead may
 *   convert to `workspace:*` at the next serialized lockfile change).
 *   The reactive world and the time machine are NEVER imported: they
 *   arrive through the injected ports, and `interop.test.ts` drives
 *   the REAL `createReactiveWorldService` and REAL
 *   `createRollingTimeMachine` through them (the drift trip wires).
 * - Live trading is OUT OF SCOPE and inexpressible: the mode type has
 *   one member and the guard accepts one value (venue binding beyond
 *   the reactive world is T040's lane).
 */

// Errors and results
export type { ShadowErrorCode, ShadowError, ShadowResult } from './errors';
export { fail, failures, ok, invalidField, invalidType, isShadowError } from './errors';

// Structural primitives + ids
export type { JsonValue, JsonObject, TimestampMs } from './primitives';
export {
  isRecord,
  isNonEmptyString,
  isFiniteNumber,
  isNonNegativeSafeInteger,
  isPositiveSafeInteger,
  isMemberOf,
  deepFreeze,
  isDeeplyFrozen,
  canonicalJson,
  fnv1a32Hex,
  isDigest,
  isTimestampMs,
  asTimestampMs,
} from './primitives';
export type {
  ShadowSessionId,
  ShadowOutcomeRecordId,
  ShadowFillId,
  ShadowRefusalId,
  ShadowTickId,
  TenantRef,
  ProjectRef,
} from './ids';
export {
  isShadowSessionId,
  isShadowOutcomeRecordId,
  isShadowFillId,
  isShadowRefusalId,
  isShadowTickId,
  mintShadowSessionId,
  mintShadowOutcomeRecordId,
  mintShadowRefusalId,
  mintShadowFillId,
  mintShadowTickId,
  isOpaqueRef,
} from './ids';

// The mode-honesty law (L5/R23)
export type { ShadowMode } from './mode';
export {
  SHADOW_MODES,
  isShadowMode,
  validateShadowMode,
  SHADOW_FIDELITY_DECLARATION,
  isShadowFidelityBlock,
} from './mode';

// The injected reactive-world port (the T027 mirror)
export type {
  FillQuartetMirror,
  EngineFillMirror,
  FillSide,
  WorldPhysicsLineageMirror,
  ReactiveFillMirror,
  ReactiveWorldViewMirror,
  WorldReceiptEngineMirror,
  WorldActionReceiptMirror,
  ReactiveWorldSubmissionMirror,
  ReactiveWorldPort,
  WorldPortResult,
} from './world-mirror';
export {
  isFillQuartetMirror,
  isEngineFillMirror,
  fillSideOf,
  isWorldPhysicsLineageMirror,
  requireReactiveFillMirror,
  isReactiveFillMirror,
  fillIsVisible,
  admitWorldFill,
  isReactiveWorldViewMirror,
  isWorldActionReceiptMirror,
  isReactiveWorldSubmissionMirror,
  isReactiveWorldPort,
} from './world-mirror';

// The injected time-machine port (the T029 mirror)
export type {
  MachinePortResult,
  MachineRecordMirror,
  FirewallDecisionMirror,
  FirewallAuditMirror,
  MachineCursorMirror,
  MachineDrainMirror,
  MachineAsOfViewMirror,
  MachineCursorOptions,
  TimeMachinePort,
} from './time-machine-mirror';
export {
  isMachineRecordMirror,
  isFirewallAuditMirror,
  isMachineCursorMirror,
  isMachineDrainMirror,
  isMachineAsOfViewMirror,
  admitDrainedRecords,
  isTimeMachinePort,
} from './time-machine-mirror';

// The shadow book (the exact-decimal paper account)
export type {
  ShadowPosition,
  ShadowBook,
  BookFillEffect,
  AccountRole,
  AccountFillView,
  BookMark,
  BookLineage,
} from './book';
export {
  SHADOW_BASIS_PRECISION,
  emptyBook,
  bookFromPortfolio,
  unrealizedPnlOf,
  grossNotionalOf,
  equityOf,
  accountFillView,
  applyWorldFill,
  portfolioMirrorOf,
  isCanonicalDecimalString,
  isShadowBook,
  isCount,
} from './book';

// The outcome records (T033's input surface)
export type {
  ShadowDisposition,
  ShadowFill,
  ShadowRefusalStage,
  ShadowRefusal,
  ShadowCosts,
  ShadowOutcomeRecord,
  ShadowLineage,
  ShadowOutcomeLog,
} from './outcomes';
export {
  isShadowDisposition,
  isShadowFill,
  isShadowRefusalStage,
  isShadowRefusal,
  mintShadowRefusal,
  isShadowCosts,
  isShadowOutcomeRecord,
  mintShadowOutcomeRecord,
  OUTCOME_CHAIN_SEED,
  startShadowOutcomeLog,
  appendShadowOutcome,
  verifyShadowOutcomeChain,
  isShadowOutcomeLog,
  shadowOutcomeDigest,
  isShadowLineage,
} from './outcomes';

// The session (the tick machine)
export type {
  ShadowSubmissionRecord,
  ShadowTickRecord,
  ShadowWarmUp,
  ShadowSession,
  CreateShadowSessionInput,
  ShadowDecisionOutcome,
  ForkShadowSessionOptions,
} from './session';
export {
  createShadowSession,
  processShadowDecision,
  throwShadowKillSwitch,
  forkShadowSession,
  runShadowSession,
  isShadowSession,
  verifyShadowAuditChain,
} from './session';

// The resumable run state
export type { ResumeShadowDependencies } from './run-state';
export {
  SHADOW_RUN_STATE_SCHEMA,
  serializeShadowRunState,
  resumeShadowRunState,
  shadowSessionDigest,
} from './run-state';

// The fixtures (the deterministic golden scenario)
export {
  T0,
  TENANT,
  PROJECT,
  SEED,
  PRINCIPAL,
  PARTICIPANT,
  VENUE,
  BTC,
  ETH,
  DATASET,
  unwrap,
  createScriptedWorld,
  createScriptedMachine,
  referenceKillSwitch,
  referenceExecutionPolicy,
  referenceRiskPolicy,
  referenceVenueState,
  referenceGenesisPortfolio,
  referenceMarketEvents,
  referenceWorldSpec,
  referenceIntentStream,
  identityFailIntent,
  authorizationFailIntent,
  limitFailIntent,
  venueFailIntent,
  rateFailIntent,
  credentialFailIntent,
  compliantIntent,
  crossTenantIntent,
  decisionSourceOf,
  createReferenceSession,
  runReferenceScenario,
} from './fixtures';

// The golden determinism constants
export {
  GOLDEN_OUTCOME_DIGEST,
  GOLDEN_DISPOSITIONS,
  GOLDEN_SUBMISSION_COUNT,
  GOLDEN_FILL_COUNT,
  GOLDEN_REFUSAL_COUNT,
  GOLDEN_FINAL_BOOK,
} from './golden';

/** Package identity and ownership (governance surface). */
export const packageInfo = {
  name: '@tradrl/shadow_trading',
  owner: 'T030',
  status: 'implemented',
  concepts: [
    'createShadowSession',
    'processShadowDecision',
    'ShadowOutcomeRecord',
    'ShadowRefusal',
    'appendShadowOutcome',
    'serializeShadowRunState',
    'throwShadowKillSwitch',
    'forkShadowSession',
    'GOLDEN_OUTCOME_DIGEST',
  ],
} as const;
