// @tradrl/control-domain — canonical control-plane contracts.
// GoalStatement (mirror), ConstraintSetStatement (mirror), AcceptanceCriteria
// (the compiled artifact), ProjectLifecycle (the state machine),
// ProjectRecord (the durable spine) and related primitives.
// Owning Work Order: T007 — Goal/constraint/project control plane.
//
// Package laws:
// - Zero runtime dependencies; types, guards and pure functions only. No
//   build step; the package is consumed as TypeScript sources.
// - No `any`; every exported record ships a hand-rolled, total type guard
//   `isX(v: unknown): v is X` that never throws.
// - Compiled artifacts and project records are deeply frozen and
//   deterministic: `compileAcceptance` is pure (content-addressed id, no
//   ambient clock), and the lifecycle reducer is a pure function.
// - Cross-lane law: domain-core (T002), time-engine (T004), evaluation
//   (T012) and organization-compiler (T016) entities are referenced ONLY
//   by opaque branded ids or STRUCTURAL MIRRORS (timestamp.ts,
//   execution-mode.ts, the predicate vocabulary in goal.ts) — those
//   packages are never imported. `interop.test.ts` is the trip wire.
// - Attainment is objective-and-constraint based BY CONSTRUCTION (L7):
//   the type surface has no field where raw PnL alone can express
//   attainment (asserted structurally in acceptance.test.ts).

export * from './primitives';
export * from './timestamp';
export * from './ids';
export * from './errors';
export * from './goal';
export * from './constraints';
export * from './execution-mode';
export * from './acceptance';
export * from './lifecycle';
export * from './project';

export const packageInfo = {
  name: '@tradrl/control-domain',
  owner: 'T007',
  status: 'implemented',
} as const;
