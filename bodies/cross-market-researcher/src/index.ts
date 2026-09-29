// @tradrl/body-cross-market-researcher — the public surface.
//
// Owning Work Order: T023 (frozen write surface:
// bodies/cross-market-researcher, services/research/src/cross-market,
// services/research/src/index.ts — additive re-export lines only).
//
// Public surface, in dependency order:
//   primitives  — the zero-dep foundation (guards, deepFreeze, canonical
//                 JSON + stable digests, TimestampMs, SemVer, ISO-8601)
//   ids         — owned identity spaces + opaque cross-lane references
//   errors      — the typed error taxonomy (collect-all + single failure)
//   decimals    — exact decimal-string numerics (market-protocol mirror
//                 + scaled BigInt arithmetic)
//   methods     — the DECLARED-METHOD discipline (CrossMarketMethodRecord,
//                 CrossMarketMethodRegistry, citations, the canonical registry)
//   observations— observation intake contracts (T037/T038 emitter mirrors —
//                 quotes, trades, reported fundamentals — T008 provenance
//                 mirrors, the L4 as-of gate, the multi-source port)
//   relationship— the evidence-backed CrossMarketRelationship (the declared
//                 decision functions + the CLOSED relation taxonomy)
//   report      — the publication record CrossMarketResearchReport
//                 (enumerated summary, coverage accounting, composition law)
//   body        — CROSS_MARKET_RESEARCHER_BODY (the agent-body BodyVersion
//                 mirror + research declaration + the L8 authority scope)
//   publication — the agent-os envelope mirror + the publication port
//   fixtures    — the deterministic fixture set (golden observation set,
//                 golden relationships, golden report, violation fixtures)

export * from './primitives';
export * from './ids';
export * from './errors';
export * from './decimals';
export * from './methods';
export * from './observations';
export * from './relationship';
export * from './report';
export * from './body';
export * from './publication';
export * from './fixtures';

/** The package identity card (the repo's governance convention). */
export const packageInfo = {
  name: '@tradrl/body-cross-market-researcher',
  owner: 'T023',
  status: 'implemented',
  concepts: [
    'CROSS_MARKET_RESEARCHER_BODY',
    'CrossMarketMethodRecord',
    'CrossMarketMethodRegistry',
    'CrossMarketObservation',
    'CrossMarketRelationship',
    'CrossMarketResearchReport',
    'CrossMarketPublicationPort',
  ],
} as const;
