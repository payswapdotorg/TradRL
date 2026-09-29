/**
 * @tradrl/execution_sim — the reference execution simulator (Work
 * Order T019).
 *
 * Public API:
 *   - Reference declarations — `referenceExecutionPolicy` (the
 *     full-featured declaration: every check dimension present),
 *     `referenceSimulationSpec` (simulated_matching over the two
 *     venue-model mirrors), `referenceKillSwitch`, the reference
 *     genesis portfolio and the reference venue states.
 *   - The scripted venue — `createVenueEngine` / `submitToVenue` (the
 *     exchange-sim engine mirror: price-time-priority book walking,
 *     per-fill fee quotes, deterministic latency draws, the slippage
 *     model's aggressor price; taker-side only — the declared L6
 *     limitation).
 *   - The simulator — `createExecutionSimSession` /
 *     `processIntent` / `processIntentBatch`: the gate decides,
 *     refusals never reach the venue (zero venue records), approvals
 *     drive the scripted venue and emit SimulatedFills with their full
 *     venue lineage; decisions + fills + the audit trail are
 *     append-only logs.
 *   - The resumable run state — `serializeExecutionRunState` /
 *     `resumeExecutionRunState` (canonical bytes; chain-verified
 *     resume — serialize -> parse -> resume is proven by the tests).
 *   - Fixtures — the intent batches (the approve batch + the six
 *     refusal-path variants) and the seed books.
 *   - Golden — the byte-stable determinism digests.
 *
 * Zero runtime dependencies. The service consumes its contract
 * package, @tradrl/execution-policy, via a relative source import
 * (the frozen write surface permits no lockfile-touching workspace
 * edge — the services/strategy precedent; the Lead may convert to
 * `workspace:*` at the next serialized lockfile change). No ambient
 * clock (`Date.now()` never appears) — every instant is an explicit
 * fixture literal. No network, no venues, no credentials: real venue
 * binding is T040; the credentials here are opaque refs.
 */

// The reference declarations
export {
  REFERENCE_TENANT,
  REFERENCE_PROJECT,
  REFERENCE_PRINCIPAL,
  REFERENCE_VENUE,
  REFERENCE_BTC,
  REFERENCE_ETH,
  REFERENCE_T0,
  referenceKillSwitch,
  referenceBtcModel,
  referenceEthModel,
  referenceExecutionPolicy,
  referenceSimulationSpec,
  referenceGenesisPortfolio,
} from './reference-policy';

// The scripted venue (the exchange-sim engine mirror)
export type { VenueRejectReason, VenueOrderRecord, VenueEngineState, VenueFill, VenueSubmitOutcome, BookSide } from './venue-engine';
export {
  VENUE_REJECT_REASONS,
  isVenueRejectReason,
  isVenueOrderRecord,
  isVenueEngineState,
  createVenueEngine,
  submitToVenue,
  feeOfMirror,
  aggressorPriceMirror,
} from './venue-engine';

// The simulator
export type { ExecutionSimSession, IntentOutcome } from './simulator';
export {
  isExecutionSimSession,
  createExecutionSimSession,
  processIntent,
  processIntentBatch,
  verifySessionOutcomeChain,
  verifySessionCoherence,
  EXECUTION_RUN_STATE_SCHEMA,
  serializeExecutionRunState,
  resumeExecutionRunState,
  sessionOutcomeDigest,
} from './simulator';

// The fixtures
export {
  referenceApproveBatch,
  referenceIdentityFailIntent,
  referenceAuthorizationFailIntent,
  referenceLimitFailIntent,
  referenceVenueFailIntent,
  referenceRateFailIntent,
  referenceKillSwitchFailIntent,
  referenceCredentialFailIntent,
  referenceVenueState,
  referenceBtcBook,
  referenceEthBook,
  referenceBtcHoldingPortfolio,
} from './fixtures';

// The golden determinism constants
export {
  GOLDEN_APPROVE_DIGEST,
  GOLDEN_REFUSAL_DIGEST,
  GOLDEN_APPROVE_COUNT,
  GOLDEN_FILL_COUNT,
  GOLDEN_REFUSAL_COUNT,
  GOLDEN_REFUSED_VENUE_RECORDS,
} from './golden';

/** Package identity and ownership (governance surface). */
export const packageInfo = {
  name: '@tradrl/execution_sim',
  owner: 'T019',
  status: 'implemented',
  concepts: [
    'referenceExecutionPolicy',
    'processIntentBatch',
    'createVenueEngine',
    'serializeExecutionRunState',
    'resumeExecutionRunState',
    'GOLDEN_APPROVE_DIGEST',
  ],
} as const;
