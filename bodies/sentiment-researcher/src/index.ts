// @tradrl/body-sentiment-researcher — the public surface.
//
// Owning Work Order: T021 (frozen write surface: bodies/sentiment-researcher,
// services/research/src/sentiment, services/research/package.json).
//
// Public surface, in dependency order:
//   primitives  — the zero-dep foundation (guards, deepFreeze, canonical
//                 JSON + stable digests, TimestampMs, SemVer, ISO-8601)
//   ids         — owned identity spaces + opaque cross-lane references
//   errors      — the typed error taxonomy (collect-all + single failure)
//   decimals    — exact decimal-string numerics (market-protocol mirror
//                 + scaled BigInt arithmetic)
//   methods     — the DECLARED-METHOD discipline (MethodRecord,
//                 MethodRegistry, citations, the canonical registry)
//   observations— observation intake contracts (T038 emitter mirrors,
//                 T008 provenance mirrors, the L4 as-of gate, source port)
//   reading     — the evidence-backed SentimentReading
//   digest      — the structured EventDigest
//   report      — the publication record ResearchReport (enumerated
//                 summary, coverage accounting, composition law)
//   body        — SENTIMENT_RESEARCHER_BODY (the agent-body BodyVersion
//                 mirror + research declaration + the L8 authority scope)
//   publication — the agent-os envelope mirror + the publication port
//   fixtures    — the deterministic fixture set (golden observation
//                 streams, golden outputs, violation fixtures)

export * from './primitives';
export * from './ids';
export * from './errors';
export * from './decimals';
export * from './methods';
export * from './observations';
export * from './reading';
export * from './digest';
export * from './report';
export * from './body';
export * from './publication';
export * from './fixtures';

/** The package identity card (the repo's governance convention). */
export const packageInfo = {
  name: '@tradrl/body-sentiment-researcher',
  owner: 'T021',
  status: 'implemented',
  concepts: [
    'SENTIMENT_RESEARCHER_BODY',
    'MethodRecord',
    'MethodRegistry',
    'ResearchObservation',
    'SentimentReading',
    'EventDigest',
    'ResearchReport',
    'ResearchPublicationPort',
  ],
} as const;
