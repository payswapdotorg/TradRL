// @tradrl/risk — risk contracts: the risk policy engine's contract
// surface (Work Order T020).
//
// Public API:
//   - The versioned declaration — `RiskPolicy` (class limits +
//     concentration/drawdown/leverage caps, exact-decimal bounds, the
//     L7 acceptance trip wire), compiled from control-domain
//     ConstraintSet mirrors by `compileRiskPolicy` (the pure
//     constraint -> limit-record function).
//   - The measurement — `computeExposure` (portfolio + market + fills
//     -> the ExposureRecord: per-instrument and aggregate exposure,
//     gross/net, equity, the threaded high-water mark, drawdown —
//     exact decimals, lineage-carrying).
//   - The states — `evaluateLimits` (exposure + policy + kill-switch
//     mirror -> every declared limit's within | breaching | blocked
//     state with structured reasons; a thrown switch blocks
//     everything; `executionLimitRefusals` feeds T019's gate).
//   - The measures — the L7-compliant `RiskMeasureRecord` (exposure,
//     drawdown series, risk-adjusted figures as OPAQUE refs).
//   - The trails — the L11 policy-evolution trail (superseded versions
//     retained) and the append-only chain-verified `RiskAuditTrail`.
//
// Package laws (mirroring the merged contract packages):
// - Zero runtime dependencies; pure data and pure functions only.
// - No `any`; every exported shape ships a hand-rolled total guard.
// - All contract data is JSON-serializable and deeply frozen.
// - No ambient clock; no ambient randomness; byte-determinism of
//   serialization (content-addressed ids throughout).
// - Exact decimal arithmetic (BigInt fixed-point) on every money
//   path — the typed `decimal_imprecision` trip wire rejects float
//   mediation.
// - Cross-lane entities (T007 control plane, T018 strategy lane, T010
//   exchange simulation, T003 market protocol, T019 execution policy)
//   are referenced ONLY through opaque branded ids or STRUCTURAL
//   MIRRORS — never imported (D-003/D-004; src/interop.test.ts is the
//   drift trip wire).
// - The engine informs, evaluation decides (L7): no record this package
//   emits carries an acceptance verdict.

export * from './primitives';
export * from './decimals';
export * from './errors';
export * from './ids';
export * from './control-mirror';
export * from './portfolio-mirror';
export * from './market-mirror';
export * from './fill-mirror';
export * from './killswitch-mirror';
export * from './policy';
export * from './compile';
export * from './exposure';
export * from './limits';
export * from './measures';
export * from './trail';
export * from './audit';

export const packageInfo = {
  name: '@tradrl/risk',
  owner: 'T020',
  status: 'implemented',
} as const;
