// @tradrl/research (service) — the service root.
//
// The sentiment/event research lane (Work Order T021) is the first
// resident of this service; sibling research lanes (regime T022,
// fundamental/cross-market T023) will land beside it under src/, per the
// nested-service precedent (services/market-world with src/replay +
// src/reactive).
//
// ADDITIVE (T022): the market-regime research lane lives at src/regime/
// and is re-exported below. The regime lane's public surface is fully
// regime-prefixed (RegimeRunConfig, runRegimePipeline, RegimeRunState,
// ...) so the re-export is purely additive — the sentiment lane's
// surface above is UNTOUCHED.

export * from './sentiment/index';
export * from './regime/index';
