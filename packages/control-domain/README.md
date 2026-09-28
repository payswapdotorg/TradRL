# @tradrl/control-domain

**Owning Work Order: T007** (frozen write surface: `packages/control-domain`,
`services/control-plane`). Reference implementation: `services/control-plane`.

The Goal/constraint/project control-plane contracts: the GoalStatement and
ConstraintSetStatement structural mirrors, the `AcceptanceCriteria` compiler
(the executable definition of attainment that evaluation T012 and the
organization compiler T016 consume), the `ProjectLifecycle` state machine and
the `ProjectRecord` lineage spine.

## Package laws

- Zero runtime dependencies: types, guards and pure functions only. No build
  step; the package is consumed as TypeScript sources.
- No `any`; every exported record ships a hand-rolled, total type guard
  `isX(v: unknown): v is X` that never throws. The guards ARE the
  machine-checkable schema.
- Determinism: `compileAcceptance(goal, constraintSet)` is pure and
  content-addressed (no ambient clock, no randomness) — same inputs produce
  deeply-equal, deeply-frozen artifacts. The lifecycle reducer
  `transitionProject(state, event)` is pure.
- Cross-lane law: `@tradrl/domain-core` (T002), `@tradrl/time-engine` (T004),
  the evaluation lane (T012) and the organization compiler (T016) are never
  imported. Their types are re-declared as STRUCTURAL MIRRORS
  (`timestamp.ts`, `execution-mode.ts`, the predicate vocabulary in
  `goal.ts`) and their entities are referenced by opaque branded ids.
  `src/interop.test.ts` is the trip wire: mirror drift fails typecheck
  (assignability witnesses) and test (constant/guard parity).
- PnL-solicitude (L7, by construction): the compiled artifact carries ONLY
  definitions — criteria (metric + executable predicate), gating constraints
  and evaluation policy refs. No field anywhere can hold a realized PnL
  number or a verdict; "attained" can only be decided by evaluating the
  criteria (asserted structurally in `acceptance.test.ts`).

## Layout

| Module | Contents |
|---|---|
| `src/primitives.ts` | Brand, guard helpers, identifier paths, `deepFreeze` / `isDeeplyFrozen` |
| `src/timestamp.ts` | `TimestampMs` — STRUCTURAL MIRROR of time-engine (DO NOT DIVERGE) |
| `src/execution-mode.ts` | `ExecutionMode` — STRUCTURAL MIRROR of domain-core (DO NOT DIVERGE) |
| `src/ids.ts` | Opaque branded ids (`GoalRef`, `ConstraintSetRef`, `ProjectId`, `OrganizationRef`, `TenantId`, `AcceptanceCriteriaId`), versioned refs, content-addressed criteria id |
| `src/errors.ts` | Typed error taxonomy (`ControlErrorCode`, `ControlDomainError`, `IllegalProjectTransitionError`, `ProjectPreconditionError`) |
| `src/goal.ts` | `GoalStatement` mirror: objective, horizon, STRUCTURED success criteria, evaluation policy declaration, predicate vocabulary |
| `src/constraints.ts` | `ConstraintSetStatement` mirror: domains, subjects, predicates, severities |
| `src/acceptance.ts` | `AcceptanceCriteria`, the gating rule, `compileAcceptance` (pure compiler, typed errors) |
| `src/lifecycle.ts` | `ProjectLifecycle` state machine, preconditions, reducer + effects |
| `src/project.ts` | `ProjectRecord`, `ProjectLineage`, `createProjectRecord`, `bindOrganizationToProject`, `advanceProject` |
| `src/*.test.ts` | Guard acceptance/rejection, compiler determinism, full transition matrix, PnL-solicitude, interop trip wires |

## Structural mirror map (control-domain ↔ domain-core)

| control-domain | domain-core | Discipline |
|---|---|---|
| `GoalRef` (branded) | `GoalId` (branded) | distinct tags — opaque reference, explicit bridging |
| `ConstraintSetRef` (branded) | `ConstraintSetId` (branded) | distinct tags — opaque reference, explicit bridging |
| `ProjectId` (branded, same tag) | `ProjectId` (branded) | SHARED identity space — mutually assignable on purpose (T002 owns the record, T007 owns the lifecycle); asserted in `interop.test.ts` |
| `TenantId` (branded, same tag) | `TenantId` (branded) | one program-wide tenant identity space (L12) |
| `OrganizationRef` (branded) | `OrganizationId` (branded) | distinct tags — referent owned by T016 |
| `ConstraintSetVersionRef` | `ConstraintSetRef` (record) | the versioned-pointer discipline, pinned at compile time |
| `GoalStatement` | `Goal` | same field shapes for objective/horizon/success criteria; `TimestampMs` scalars; criteria are STRUCTURED records (not a constraint-set pointer) |
| `ConstraintSetStatement` | `ConstraintSet` | constraint core mirrored; evolution metadata (`supersedes`, `provenance`) stays in domain-core — the control plane pins versions |
| `CriterionPredicate` | `Predicate` | identical closed vocabulary + semantics |
| `ExecutionMode` | `ExecutionMode` | identical closed vocabulary |
| `TimestampMs` | — (time-engine `TimestampMs`) | identical declaration, trip-wire tested |
| lifecycle statuses | `ProjectStatus` | `abandoned`↔`terminated`; domain-core's `compiling` label = "draft with partial bindings" here; transitions are THIS machine (domain-core statuses are labels by contract) |

## The gating rule

A constraint **gates** a success criterion when their identifier paths
address the same measurement family — one is a segment-wise prefix of the
other (`gatesConstraint` in `acceptance.ts`). Examples:
`risk` gates `risk.maxDrawdown`; `returns.sharpe.netOfFees` gates
`returns.sharpe`; `risk` does NOT gate `returns.sharpe`. The compiled
`CompiledCriterion.gatingConstraintIds` carries exactly these pairings, and
every id is guard-checked to resolve inside the embedded constraint snapshot.

## Attainment semantics (for T012)

`attained` is decidable ONLY by evaluating the artifact under its policy:
- each criterion's `predicate` over its `metric` in the outcome metric space;
- each gating/embedded constraint over the evaluation context (mirroring
  domain-core's `evaluateConstraintSet` semantics — fail-closed, blocking
  violations and errors fail);
- the satisfied share compared against `policy.requiredSatisfaction`;
- the blind / walk-forward / regime / adversarial discipline pinned by the
  policy refs (owned by T012) honored throughout.

See `services/control-plane/README.md` for the consumer contract.
