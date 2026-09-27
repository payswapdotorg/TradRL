# @tradrl/domain-core

**Owning Work Order: T002** (frozen write surface: `packages/domain-core`, `contracts/domain`)

Canonical provider-neutral trading domain contracts: Goal, ConstraintSet,
Project, Instrument, Venue, Order, Position, Portfolio, Organization,
Decision, Outcome, Lesson and related primitives (spec/DOMAIN-MODEL.md).
Human-readable contract documents live in `contracts/domain/` — they are the
authority downstream Work Orders code against, and their JSON examples are
machine-validated against this package's guards by
`src/contract-docs.test.ts`.

## Package laws

- Zero runtime dependencies: types, guards and pure functions only. No build
  step; the package is consumed as TypeScript sources.
- No `any`; every exported record ships a hand-rolled, total type guard
  `isX(v: unknown): v is X` that never throws.
- `ConstraintSet` is executable: `evaluateConstraintSet` is a pure,
  deterministic, fail-closed evaluator (see `contracts/domain/constraint-set.md`).
- Cross-lane law: agent/body/substrate (T003) and market-event/time (T004)
  entities are referenced by opaque branded ids only — this package never
  imports those lanes.
- Canonical scalars: RFC 3339 timestamps with explicit offset, exact
  decimal strings, branded opaque ids.

## Layout

| Module | Contents |
|---|---|
| `src/primitives.ts` | Timestamp, DecimalString, AssetClass, DataCategory, guard helpers, exact decimal comparison |
| `src/ids.ts` | Branded identity types (owned + opaque cross-lane references) |
| `src/constraints.ts` | ConstraintSet, Constraint, predicates, evaluation context/report, pure evaluator |
| `src/market-scope.ts` | MarketScope, DataScope selectors |
| `src/goal.ts` | Goal, horizon, success criteria, permitted actions |
| `src/project.ts` | Project, lifecycle status, execution mode |
| `src/venue.ts`, `src/instrument.ts` | Reference data contracts |
| `src/order.ts` | Order intent contract (no execution semantics) |
| `src/position.ts`, `src/portfolio.ts` | Point-in-time snapshot data contracts |
| `src/organization.ts` | Structural team contract |
| `src/decision.ts`, `src/outcome.ts`, `src/lesson.ts` | Loop-closing records |
| `src/*.test.ts` | Guard acceptance/rejection, predicate execution, branding discipline, doc validation |
