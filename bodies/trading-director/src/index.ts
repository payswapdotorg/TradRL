// @tradrl/body-trading-director — the public surface.
//
// Owning Work Order: T024 (frozen write surface: bodies/trading-director
// only — this Work Order is bodies-only, no services/ directory).
//
// Public surface, in dependency order:
//   primitives  — the zero-dep foundation (guards, deepFreeze, canonical
//                 JSON + stable digests, TimestampMs, SemVer, ISO-8601)
//   ids         — owned identity spaces + opaque cross-lane references
//                 (including the trading-strategy GoalVersionRef /
//                 ConstraintSetVersionRef mirrors)
//   errors      — the typed error taxonomy (collect-all + single failure)
//   decimals    — exact decimal-string numerics (market-protocol mirror
//                 + scaled BigInt arithmetic: sums, products, means)
//   methods     — the DECLARED-METHOD discipline (MethodRecord,
//                 MethodRegistry, the declared quorum/stance-map/
//                 lane-weights/tilt/conflict-policy parameters, the
//                 canonical registry)
//   intake      — the research intake contracts (the four field-for-field
//                 report mirrors: sentiment, regime, fundamental,
//                 cross-market; the L4 research_from_the_future gate;
//                 the per-lane citation extraction, R45 inherited
//                 confidence)
//   decision    — the decision records (DirectorDecision, EscalationRecord,
//                 the portfolio-level directive, coverage accounting,
//                 typed conflict records; validation + creation +
//                 byte-deterministic serialization)
//   synthesis   — the composition law's declared interpreter
//                 (composeDirectorDecision: quorum, conflicts, tilts,
//                 thresholds, escalation — a record, never an exception)
//   body        — TRADING_DIRECTOR_BODY (the agent-body BodyVersion
//                 mirror + director declaration + the L8/L16 authority
//                 scope + the strategic clock)
//   publication — the agent-os envelope mirror + the
//                 DirectorPublicationPort (PUBLISH/SUBSCRIBE/REPORT only)
//   fixtures    — the deterministic fixture set (the golden four-report
//                 scenarios: quorum-met, single-lane absences, conflict,
//                 quorum-unmet and irreconcilable escalations; the
//                 violation fixtures)

export * from './primitives';
export * from './ids';
export * from './errors';
export * from './decimals';
export * from './methods';
export * from './intake';
export * from './decision';
export * from './synthesis';
export * from './body';
export * from './publication';
export * from './fixtures';

/** The package identity card (the repo's governance convention). */
export const packageInfo = {
  name: '@tradrl/body-trading-director',
  owner: 'T024',
  status: 'implemented',
  concepts: [
    'TRADING_DIRECTOR_BODY',
    'MethodRecord',
    'MethodRegistry',
    'SynthesisParameters',
    'SentimentReportMirror',
    'RegimeReportMirror',
    'FundamentalReportMirror',
    'CrossMarketReportMirror',
    'ResearchInputRef',
    'DirectorDecision',
    'EscalationRecord',
    'PortfolioDirective',
    'LaneCoverage',
    'LaneConflict',
    'DirectorPublicationPort',
  ],
} as const;
