# Domain Contracts — Index and Shared Conventions

Canonical, provider-neutral **trading domain** contracts owned by Work Order
**T002** and implemented in [`packages/domain-core`](../../packages/domain-core).
These documents are the authority downstream Work Orders code against;
`packages/domain-core/src/*.ts` is the machine-checkable twin (hand-rolled
type guards, zero runtime dependencies). The JSON examples in every document
are extracted and validated against those guards by
`packages/domain-core/src/contract-docs.test.ts` — a doc example that fails
its guard fails CI.

Concept vocabulary derives from `spec/DOMAIN-MODEL.md` and the Work Order
lane split: **T002 owns the trading domain**; agent/body/substrate/possession
contracts belong to T003; market events and the time protocol belong to T004.
This package never imports those lanes — it references their entities by
opaque ids only.

## Document map

| Document | Concepts |
|---|---|
| [goal.md](./goal.md) | Goal, GoalHorizon, GoalSuccessCriteria, MarketScope, DataScope, PermittedAction |
| [constraint-set.md](./constraint-set.md) | ConstraintSet, Constraint, Predicate, evaluation context, checks and reports |
| [project.md](./project.md) | Project, ProjectStatus, ExecutionMode |
| [market-reference.md](./market-reference.md) | Venue, VenueCapabilities, Instrument |
| [order.md](./order.md) | Order, OrderSide, OrderKind, TimeInForce |
| [portfolio.md](./portfolio.md) | Position, Portfolio, PortfolioSummaryMetrics |
| [organization.md](./organization.md) | Organization, OrganizationMembership, DecisionCadence |
| [decision.md](./decision.md) | Decision, DecisionAlternative |
| [outcome.md](./outcome.md) | Outcome, OutcomeVerdict, metrics |
| [lesson.md](./lesson.md) | Lesson, LessonProvenance, LessonStatus |

## Canonical scalars

| Scalar | Encoding | Rules |
|---|---|---|
| `Timestamp` | RFC 3339 / ISO-8601 string | **Explicit UTC offset required** (`Z` or `±HH:MM`); wall-clock or date-only values are invalid. Ordering compares instants, not text. Deeper time semantics (event/source/available/ingestion time) are owned by the time-engine lane (T004). |
| `DecimalString` | canonical decimal string | `0`, `42`, `0.5`, `1234.5678`, `-3.5`. No leading zeros (`01.2`), no bare fraction (`.5`), no trailing dot (`5.`), no exponent (`1e5`), no `-0`. Chosen so contract data is exact, JSON-portable and provider-neutral; the exact comparison helper `compareDecimal` is exported. |
| ids | opaque non-empty strings, branded | See below. |

## Id discipline (cross-lane law)

Every identity is a **branded opaque string** (`ProjectId`, `GoalId`, ...).
Brands are compile-time nominal tags: a `ProjectId` is not assignable to a
`GoalId` (enforced by type-level tests), while at runtime an id is simply a
non-empty string whose **format is owned by the creating lane/service** —
domain-core never validates id grammar.

References to entities owned by other lanes are opaque ids reserved here and
**never imported**:

| Reference type | Referent owner |
|---|---|
| `AgentInstanceId`, `BodyVersionId` | T003 agent-body lane |
| `RiskPolicyId` | T020 risk lane |
| `EvidenceCapsuleId` | evaluation/evidence lane |
| `ExperimentId` | T011 learning lane |
| `ExecutionId` | T019/T040 execution lanes |
| `PostMortemId` | T033 outcome-learning lane |
| `CapabilityGapId` | learning lanes |
| `TopologyId` | T006/T016 organization lanes |

Ids owned by domain-core: `ProjectId`, `GoalId`, `ConstraintSetId`,
`InstrumentId`, `VenueId`, `OrganizationId`, `DecisionId`, `OutcomeId`,
`LessonId`, `TenantId`.

## Vocabulary discipline

- **Closed vocabularies** (enum-style unions, e.g. `AssetClass`,
  `ProjectStatus`, `PermittedAction`, severity/verdict/status kinds): the
  guard rejects any value outside the published list. Extensions require a
  **contract version bump** recorded in these documents.
- **Open vocabularies** (`OrderKind`, `TimeInForce`): core values are
  published here; additional values may be **registered** by later Work
  Orders by appending to the registry in the owning document. Guards accept
  any non-empty string for open vocabularies; consumers MUST treat
  unregistered values as opaque extensions with no implied semantics.

## Record and guard discipline

- Every record is a frozen-shape `readonly` TypeScript interface; every
  record ships a hand-rolled total guard `isX(v: unknown): v is X` (no
  external validation libraries, no `any`, never throws).
- Guards validate the **documented fields**. Unknown extra fields are
  tolerated on read (forward compatibility), but producers MUST NOT emit
  undocumented fields; the canonical record shape is exactly the field table
  of the owning document.
- Optional fields are `undefined`-absent, never `null`, never empty-string
  stand-ins. "Required" in the field tables means: present **and**
  guard-valid.

## Versioning rules (all domain records)

1. Records are **immutable snapshots**. Any semantic change is a new record
   (new id or, for versioned aggregates like `ConstraintSet`, a new version
   with a `supersedes` lineage link).
2. `ConstraintSet` is the only record with an in-record `version` field
   (monotonic, integer, ≥ 1, unique per id). Other records version by
   identity: revision = new id, lineage via parent/self references
   (e.g. `Project.parentProjectId`, `ConstraintSet.supersedes`).
3. Guards enforce the machine-checkable subset of invariants (uniqueness,
   ordering, vocabulary, cross-field matrices). Cross-record invariants
   (e.g. "Project.marketScope satisfies Goal.marketScope") are **documented
   obligations on the compiling lane**, not guard checks, because the two
   records are validated independently.

## Tenant scoping

`Project`, `Organization` and `Lesson` carry a required `tenantId`. These are
the durable roots and the cross-project durable record; every persisted
descendant (decisions, outcomes, positions, portfolios, constraint sets)
inherits its tenant scope through the owning `Project` — storage layers
(T044) MUST propagate and enforce that scope at persistence time (L12).
