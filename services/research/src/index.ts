// @tradrl/research (service) — the service root.
//
// The sentiment/event research lane (Work Order T021) is the first
// resident of this service; sibling research lanes (regime T022,
// fundamental/cross-market T023) will land beside it under src/, per the
// nested-service precedent (services/market-world with src/replay +
// src/reactive).

export * from './sentiment/index';
