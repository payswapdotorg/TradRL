# @tradrl/control-plane

**Owning Work Order: T007** (frozen write surface: `services/control-plane`,
`packages/control-domain`).

The reference Goal/constraint/project control plane: a `ControlPlane`
service object over the pure domain — `createProject` (compiles acceptance
criteria first, rejecting un-compilable goals), `bindOrganization`,
`transition`/`archive` (the lifecycle reducer), an in-memory tenant-scoped
`ProjectStore`, a tenant-scoped acceptance-criteria registry, and an
append-only, replayable audit log.

Zero runtime dependencies. The service consumes `@tradrl/control-domain` by
relative source import (`../../../packages/control-domain/src/index`) — the
frozen workspace lockfile forbids adding workspace dependencies between
importers; the root tsconfig covers both trees and the Tech Lead reconciles
manifests at merge.

## API surface (all accessors tenant-scoped, L12)

| Method | Behavior |
|---|---|
| `createProject(input)` | Compiles `AcceptanceCriteria` FIRST (`compileAcceptance` — typed errors on unstructured criteria, invalid constraint set, cross-tenant goal/set pair), then creates the draft record with the criteria id bound, stores it, registers the artifact and journals `acceptance.compiled` + `project.created`. |
| `bindOrganization(input)` | Binds/re-binds the organization ref (legal in `draft` and `paused` — the reorganization window); journals `organization.bound`. |
| `transition(input)` | Applies a lifecycle event through the domain reducer; returns `{ record, effects }`; journals `project.transitioned`. |
| `archive(input)` | Convenience: `transition` with the `archive` event. |
| `getProject(tenant, id)` | Tenant-scoped read; unknown ids and cross-tenant ids are INDISTINGUISHABLE (`project-not-found`, no existence leak). |
| `acceptanceCriteriaFor(tenant, id)` | The compiled artifact of a project — the T012/T016 read path below. |
| `projectsOf(tenant)` / `acceptanceCriteriaOf(tenant)` | Tenant-scoped listings (creation / compilation order). |
| `auditLog(tenant)` | The tenant-scoped journal; `replayAuditLog` rebuilds state deterministically. |

## How T012 (evaluation/verification) consumes the control plane

1. **Fetch the artifact** — `acceptanceCriteriaFor(tenantId, projectId)`
   returns the compiled `AcceptanceCriteria`: a self-contained, deeply
   frozen record pairing each success criterion with the ids of the
   constraints that gate it, embedding the full validated constraint
   snapshot, and carrying the evaluation policy.
2. **Evaluate criteria** — for each `CompiledCriterion`, execute
   `criterion.predicate` over `criterion.metric` in the outcome metric
   space (same identifier-path address space as constraint subjects).
   Predicate semantics mirror domain-core's `evaluateConstraintSet`
   exactly (fail-closed: type conflicts are errors, errors fail).
3. **Evaluate constraints** — execute the embedded constraint snapshot
   over the evaluation context (observation/state/action/outcome maps).
   `blocking` violations and errors fail; `advisory` violations are
   recorded but do not fail.
4. **Decide attainment** — attained iff the satisfied share of criteria +
   applicable constraints reaches `policy.requiredSatisfaction` AND there
   are zero blocking violations / errors. There is NO other path: the
   artifact's type surface has no field where a raw PnL number or a
   verdict could be stored (L7 asserted structurally in
   `packages/control-domain/src/acceptance.test.ts`), so raw PnL alone can
   never express attainment.
5. **Honor the policy discipline** — `policy.blindRef`,
   `policy.walkForwardRef`, `policy.regimeRef` are OPAQUE refs to T012's
   own policy records (blind/unseen splits, walk-forward windows, regime
   coverage); `policy.adversarialRequired` demands adversarial stress
   (L10). The control plane pins them at goal authoring; only T012
   resolves them.
6. **Lineage** — every verdict T012 records should carry
   `ProjectRecord.lineage` (projectId, goal version, constraint set
   version) so goal → research → decision → execution → outcome share
   lineage (L15). The artifact id is content-addressed from exactly that
   lineage, so a verdict's `acceptanceCriteriaId` resolves back to the
   goal and constraint set versions it judged.

## How T016 (organization compiler) consumes the control plane

1. **Read the brief** — `getProject(tenantId, projectId)` + the acceptance
   criteria: the goal objective (interpretation input), the constraint
   snapshot as HARD boundaries the organization must respect (domains:
   observation/state/action/outcome), and the criteria as the attainment
   target to optimize for.
2. **Compile against the criteria** — the organization the compiler
   produces must be capable of leaving the gating constraints unviolated
   while pursuing the criteria; constraint-aware evaluation (L7) means the
   compiler optimizes objective attainment under constraints, never raw
   PnL.
3. **Bind the result** — `bindOrganization({ tenantId, projectId,
   organizationRef, at })` binds the compiled organization to the project
   (opaque ref; T016 owns the referent). Binding is the precondition for
   `activate`: the lifecycle machine rejects activation without a bound
   organization ref (`missing-organization-binding`).
4. **Consume effects** — the `transition` return value carries data-only
   effects the runtime lanes act on: `organization.activate` (hand the
   organization its project + criteria), `organization.suspend` /
   `organization.resume`, `evaluation.finalize` (trigger the final
   evaluation on `complete`), `record.archive`. Every effect carries the
   projectId (L15).
5. **Reorganization** — re-binding is legal in `paused` (pause, recompile,
   rebind, resume); re-binding while `active` is rejected with
   `invalid-binding-state`.

## Audit log and replay

Every successful state change is journaled as an entry carrying the
operation intent, lineage block and instant. `replayAuditLog(entries)`
re-executes the intents through the same pure domain functions and
reproduces the exact state (deep equality — the determinism proof). The
fold skips entries at or below its watermark, so applying a log twice (or
concatenated onto itself) yields deeply-equal state; sequence gaps and
incoherent operations are rejected with `invalid-audit-log`. The journal
view is tenant-scoped (`auditLog(tenantId)`); failed operations never
enter the journal (access logging is T043's lane).

## Error taxonomy (typed, machine-checkable)

`ControlDomainError` with a closed `code` vocabulary:
`invalid-goal`, `unstructured-criteria`, `empty-success-criteria`,
`invalid-constraint-set`, `goal-set-tenant-mismatch`,
`invalid-lifecycle-state`, `illegal-transition`,
`missing-acceptance-criteria`, `missing-organization-binding`,
`invalid-binding-state`, `invalid-project-record`, `project-not-found`,
`duplicate-project`, `invalid-audit-log`.

Subclasses with structured fields: `IllegalProjectTransitionError`
(`from`, `event`) and `ProjectPreconditionError` (`requirement`).

## Storage boundary (non-scope honesty)

The store is in-memory only (Work Order non-scope: no persistence beyond
the in-memory store). Durability, concurrency control and distribution are
future lanes; the audit log is the migration seam — a durable
implementation replays the same journal.
