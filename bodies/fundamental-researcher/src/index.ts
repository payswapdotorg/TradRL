// @tradrl/body-fundamental-researcher — the public surface.
//
// Owning Work Order: T023 (frozen write surface: bodies/fundamental-researcher,
// bodies/cross-market-researcher, services/research/src/fundamental,
// services/research/src/cross-market, services/research/src/index.ts —
// additive re-export lines only).
//
// Public surface, in dependency order:
//   primitives  — the zero-dep foundation (guards, deepFreeze, canonical
//                 JSON + stable digests, TimestampMs, SemVer, ISO-8601)
//   ids         — owned identity spaces + opaque cross-lane references
//   errors      — the typed error taxonomy (collect-all + single failure)
//   decimals    — exact decimal-string numerics (market-protocol mirror
//                 + scaled BigInt arithmetic)
//   methods     — the DECLARED-METHOD discipline (FundamentalMethodRecord,
//                 FundamentalMethodRegistry, citations, the canonical registry)
//   observations— observation intake contracts (T038 equities/alt-data
//                 emitter mirrors, T008 provenance mirrors, the L4 as-of gate)
//   assessment  — the evidence-backed FundamentalAssessment (the declared
//                 stance decision function + the CLOSED assessment taxonomy)
//   action-digest — the structured CorporateActionDigest (the declared
//                 implication table)
//   report      — the publication record FundamentalResearchReport
//                 (enumerated summary, coverage accounting, composition law)
//   body        — FUNDAMENTAL_RESEARCHER_BODY (the agent-body BodyVersion
//                 mirror + research declaration + the L8 authority scope)
//   publication — the agent-os envelope mirror + the publication port
//   fixtures    — the deterministic fixture set (golden observation set,
//                 golden outputs, violation fixtures)

export * from './primitives';
export * from './ids';
export * from './errors';
export * from './decimals';
export * from './methods';
export * from './observations';
export * from './assessment';
export * from './action-digest';
export * from './report';
export * from './body';
export * from './publication';
export * from './fixtures';

/** The package identity card (the repo's governance convention). */
export const packageInfo = {
  name: '@tradrl/body-fundamental-researcher',
  owner: 'T023',
  status: 'implemented',
  concepts: [
    'FUNDAMENTAL_RESEARCHER_BODY',
    'FundamentalMethodRecord',
    'FundamentalMethodRegistry',
    'FundamentalObservation',
    'FundamentalAssessment',
    'CorporateActionDigest',
    'FundamentalResearchReport',
    'FundamentalPublicationPort',
  ],
} as const;
