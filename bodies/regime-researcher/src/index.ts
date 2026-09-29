// @tradrl/body-regime-researcher — the public surface.
//
// Owning Work Order: T022 (frozen write surface: bodies/regime-researcher,
// services/research/src/regime, services/research/src/index.ts — additive
// re-export line only).
//
// Public surface, in dependency order:
//   primitives  — the zero-dep foundation (guards, deepFreeze, canonical
//                 JSON + stable digests, TimestampMs, SemVer, ISO-8601)
//   ids         — owned identity spaces + opaque cross-lane references
//   errors      — the typed error taxonomy (collect-all + single failure)
//   decimals    — exact decimal-string numerics (market-protocol mirror
//                 + scaled BigInt arithmetic incl. sub/ratio)
//   methods     — the DECLARED-METHOD discipline (RegimeMethodRecord,
//                 RegimeMethodRegistry, citations, the closed regime
//                 taxonomy declared in the method record)
//   observations— market-event intake contracts (quote/trade/book_snapshot
//                 emitter mirrors, T008 provenance mirrors, the L4 as-of
//                 gate, the observation source port)
//   classification — the evidence-backed RegimeClassification + the
//                 declared decision function and window statistics
//   change      — the structured RegimeChange transition record
//   report      — the publication record RegimeResearchReport (enumerated
//                 summary, coverage accounting, composition law)
//   body        — REGIME_RESEARCHER_BODY (the agent-body BodyVersion
//                 mirror + research declaration + the L8 authority scope)
//   publication — the agent-os envelope mirror + the publication port
//   fixtures    — the deterministic fixture set (golden observation
//                 windows, golden outputs, violation fixtures)

export * from './primitives';
export * from './ids';
export * from './errors';
export * from './decimals';
export * from './methods';
export * from './observations';
export * from './classification';
export * from './change';
export * from './report';
export * from './body';
export * from './publication';
export * from './fixtures';

/** The package identity card (the repo's governance convention). */
export const packageInfo = {
  name: '@tradrl/body-regime-researcher',
  owner: 'T022',
  status: 'implemented',
  concepts: [
    'REGIME_RESEARCHER_BODY',
    'RegimeMethodRecord',
    'RegimeMethodRegistry',
    'MarketObservation',
    'RegimeClassification',
    'RegimeChange',
    'RegimeResearchReport',
    'RegimePublicationPort',
  ],
} as const;
