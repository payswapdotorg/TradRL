// @tradrl/research (service) — the service root.
//
// The sentiment/event research lane (Work Order T021) is the first
// resident of this service; sibling research lanes (regime T022,
// fundamental/cross-market T023) land beside it under src/, per the
// nested-service precedent (services/market-world with src/replay +
// src/reactive).
//
// ADDITIVE (T022): the market-regime research lane lives at src/regime/
// and is re-exported below. The regime lane's public surface is fully
// regime-prefixed (RegimeRunConfig, runRegimePipeline, RegimeRunState,
// ...) so the re-export is purely additive — the sentiment lane's
// surface above is UNTOUCHED.
//
// ADDITIVE (T023): the fundamental research lane lives at src/fundamental/
// and the cross-market research lane lives at src/cross-market/, both
// re-exported below. Both lanes' public surfaces are fully lane-prefixed
// (FundamentalRunConfig, runFundamentalPipeline, CrossMarketRunConfig,
// runCrossMarketPipeline, ...) so the re-exports are purely additive —
// the sentiment and regime lanes' surfaces above are UNTOUCHED.

export * from './sentiment/index';
export * from './regime/index';
export * from './fundamental/index';
export * from './cross-market/index';
