// @tradrl/domain-core — canonical provider-neutral trading domain contracts.
// Goal, ConstraintSet, Project, Instrument, Venue, Order, Position, Portfolio,
// Organization, Decision, Outcome, Lesson and related primitives
// (spec/DOMAIN-MODEL.md). Owning Work Order: T002.
//
// Package laws:
// - Zero runtime dependencies; types, guards and pure functions only.
// - No `any`; guards are hand-rolled and total (never throw).
// - Cross-lane entities (agent/body, market events/time) are referenced ONLY
//   by opaque branded string ids — their packages are never imported.
// - Hand-rolled type guards (`isX(v): v is X`) are the machine-checkable
//   schema for every exported record.

export * from './primitives';
export * from './ids';
export * from './constraints';
export * from './market-scope';
export * from './goal';
export * from './project';
export * from './venue';
export * from './instrument';
export * from './order';
export * from './position';
export * from './portfolio';
export * from './organization';
export * from './decision';
export * from './outcome';
export * from './lesson';

export const packageInfo = {
  name: '@tradrl/domain-core',
  owner: 'T002',
  status: 'implemented',
} as const;
