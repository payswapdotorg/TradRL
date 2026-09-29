// @tradrl/research (service) — the sentiment lane's public surface.
//
// Work Order T021 (frozen write surface: bodies/sentiment-researcher,
// services/research/src/sentiment, services/research/package.json).
// The implementation lives in src/sentiment/ (the nested-service
// precedent: services/market-world with src/replay + src/reactive).
// The service is a PROTOCOL implementation over its own lane's contract
// package (bodies/sentiment-researcher): no network, no LLM calls, no
// imports across lanes — the cognitive substrate executes the body at
// runtime, outside this package.

export * from './imports';
export * from './pipeline';
export * from './run-state';
export * from './fixtures';

/** The service identity card (the repo's governance convention). */
export const serviceInfo = {
  name: '@tradrl/research',
  owner: 'T021',
  lane: 'sentiment',
  status: 'implemented',
  concepts: [
    'ResearchRunConfig',
    'runResearchPipeline',
    'runIntake',
    'runAggregation',
    'runEventDetection',
    'SentimentRunState',
    'advanceSentimentRunState',
    'resumeSentimentRunState',
  ],
} as const;
