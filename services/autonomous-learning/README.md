# Autonomous learning (T035)

`services/autonomous-learning/` is the CONTINUOUS
SELF-IMPROVEMENT loop that closes the Learning from reality section
(spec/LEARNING-LOOP.md's native loop's final arc: "outcome -> next
experiment"; spec/WORK-ITEMS.md: "Continuous autonomous improvement").
It ties outcome/post-mortem learning (T033) and the Firm Brain (T034)
into an autonomous, self-improving cycle — continuously turning
REALIZED OUTCOMES into **improved curricula** (T015-shaped capability
gaps + the revised plan input), **refined skills** (T017-shaped forge
commissions, adoption-gated), and **updated firm memory** (T034-shaped
ingestion feeds) — with the integrity guarantees of T031 (search
lineage/evaluation integrity): the improvement loop IS a search, its
history is retained, and its selections distinguish in-search from
holdout evidence.

## The cycle

```
T033 queryLearningHooks (the windowed, scope-matched hooks — the typed per-outcome
                        signals: outcomeClass, realizedGap, dominantAttribution,
T034 queryFirmKnowledge  suggestedFocus — R27: hooks INFORM, the policy decides)
(the active served knowledge + the brain-state digest)
T015 the curriculum trail (the earned rung — chain-verified)
T031 the search record (the retained search history — chain-verified)
T012 the evaluated evidence (attainment verdict essentials bound to T031 trials)
        │ runImprovementCycle (ONE scope — L12; ONE injected instant — no ambient clock;
        │                       pure + deterministic; fail-closed at every gate)
        ▼
1. VERIFY the world                                          the mirrors; ONE scope per cycle
        │                                                    (tenant_scope_mismatch — L12, naming
        │                                                    both scopes on every consumed record
        │                                                    family); the L4 instants (the loop
        │                                                    never improves on future evidence);
        │                                                    the idempotence ledger (a hook
        │                                                    contributes EXACTLY ONCE —
        │                                                    duplicate_evidence); and the THREE
        │                                                    chain-verified histories the loop
        │                                                    stands on: its own improvement log,
        │                                                    the curriculum trail (trail tamper
        │                                                    = chain_mismatch), and the search
        │                                                    record (search tamper = chain_mismatch)
        ▼
2. GATE the adoption (T031, integrity.ts)                    hidden_trials: cited evidence naming
        │                                                    trials the retained record does not
        │                                                    hold is the typed fail-closed error;
        │                                                    the holdout distinction decides the
        │                                                    skill commission
        ▼
3. DERIVE the agenda (the DECLARED decision table — the policy, never a mood)
        │
        ├─ GAPS: every failure hook whose focus grounds a gap kind (the policy's
        │  focus table) mints one typed CapabilityGap (T016-shaped, T015-consumable):
        │  the kind from the table, the capability key `improvement:<kind>:<focus>`
        │  (a capability CONTRACT, never a label — L16a), the hook as the failure
        │  evidence, content-addressed `alg:` identity. The honest no-gap rows
        │  (data_pipeline = an infrastructure latency fact; none = as-expected
        │  outcomes) mint NOTHING.
        │
        ├─ CURRICULUM REVISION (alv:): the revised plan-input bundle —
        │  field-for-field T015's CurriculumPlanInput (goal, constraints,
        │  candidate, seed, the trail's earned rung, the gaps, the scope) — the
        │  exact shape the REAL planCurriculum consumes (interop-proven), annotated
        │  with the Firm Brain's ACTIVE knowledge of each focus's declared
        │  knowledge kind (the brain-informed half of the improvement) and bound
        │  to the brain-state digest it improved upon (L9). The bundle NEVER
        │  carries the stage-9 live-permission record (the loop never grants
        │  live execution — the planner records its typed refusal).
        │
        ├─ SKILL COMMISSION (als:): the body-forge input bundle — the
        │  commissioning focuses' gaps + the ForgeEvidence block (the REAL T011
        │  trajectory refs from the outcome records, the evaluated trials, the
        │  verdicts) + the seed — T017 forgeBodyVersion-consumable
        │  (interop-proven). THE ADOPTION GATE: released only when the cited
        │  evidence includes an ATTAINED verdict under a HOLDOUT-classified
        │  search trial; in-search-only attained evidence WITHHOLDS it as the
        │  typed refusal data selected_without_holdout (the best-of-N trap
        │  refused by construction — R20/R21); empty evidence withholds with
        │  evidence_missing; never-attained with evidence_insufficient.
        │
        └─ MEMORY FEED (alm:): the T034 ingestFirmLearning bundle — the outcome
           + post-mortem records VERBATIM (envelope-validated here; T034's own
           mirrors own the full validation — "the boundary validates structure
           and forwards semantics"), at the cycle instant. The brain keeps
           learning continuously; the consumed-hooks ledger makes the feed
           idempotent (the same outcomes cannot re-feed the brain).
        ▼
4. MINT the search trials (L11)                              every revision and every RELEASED
        │                                                    commission is an in-search trial:
        │                                                    alt:-content-addressed append bundles
        │                                                    (config = the product's canonical
        │                                                    content; parents = the improvement
        │                                                    log's prior trials of the same
        │                                                    product kind — the improvement DAG).
        │                                                    A WITHHELD commission never enters
        │                                                    the search — it never ran.
        ▼
5. APPEND the cycle record (alc:) atomically                 content-addressed, chain-folded onto
        │                                                    the improvement log (the FNV-1a
        ▼                                                    discipline, seeded 00000000); the
   the next cycle consumes NEW hooks + the GROWN brain       consumed-hooks ledger extends with it
```

## The laws

- **The improvement loop IS a search** (L11, T031): every product is an
  in-search trial on the retained search record; nothing about the
  improvement search is forgotten; a tampered improvement log, trail or
  search record never drives the next cycle (`chain_mismatch`).
- **The selection law** (R20/R21, T031's platform mirror): a skill
  commission is released ONLY on holdout-distinguished attained
  evidence — `selected_without_holdout` withholds in-search-only
  commissions as retained refusal data (L11: the refusal is data, never
  an exception); `hidden_trials` fails the whole cycle closed when cited
  evidence names unretained trials.
- **Idempotence** (the T033/T034 precedent): a learning hook
  contributes EXACTLY ONCE — within a batch and across cycles (the
  consumed-hooks ledger); the ledger transitively protects every
  product (re-feeding the same outcomes through a second cycle is
  inexpressible).
- **L12/R25 tenant isolation**: ONE scope per cycle; every consumed
  record family of a foreign scope is the typed `tenant_scope_mismatch`
  naming both scopes (hooks, outcomes, post-mortems, knowledge, trail,
  search record) — never a silent drop, never a partial cycle.
- **L4 point-in-time truth**: the cycle instant may not precede any
  consumed record's instant (hooks, outcomes, post-mortems, knowledge,
  trail records, search entries) — the loop never improves on future
  evidence.
- **Safety outside prompts** (L20-adjacent): the loop never supplies
  the stage-9 live-permission record; it never writes the curriculum
  trail (advancement stays T015's evidence-gated surface); it never
  runs the body forge (T017 owns forging — the commission is a bundle,
  the caller forges); it never executes anything (T030's shadow stream
  is where the outcomes came from).
- **Determinism** (L9): pure + deterministic over explicit inputs —
  same (state, inputs) -> byte-identical products and cycle record,
  twice (golden-pinned); no ambient clock (`Date.now()` never appears),
  no ambient randomness (content-addressed ids only); every product and
  record is deeply frozen.

## The declared interpretation (the DEFAULT policy, flagged for Tech Lead ratification)

The DEFAULT improvement policy maps T033's focus suggestions to actions
(the mapping is the POLICY's, versioned and caller-suppliable — the
loop enforces totality + closed vocabularies + coherence, never the
mapping itself):

| focus | gap kind | knowledge kind | commissions |
|---|---|---|---|
| `strategy_revision` | `regime` | `decision_pattern` | yes |
| `model_recalibration` | `regime` | `model_calibration` | yes |
| `data_pipeline` | — (the honest null) | `data_latency` | no |
| `risk_policy` | `risk` | `decision_pattern` | yes |
| `execution_quality` | `execution` | `decision_pattern` | yes |
| `none` | — | — | no |

The declared readings: an adverse decision gap evidences the
world-model capability gap (the regime/behavior capability the
curriculum's synthetic-regimes rung retrains); a data-lag attribution
is an infrastructure latency fact, not a curriculum capability gap (no
ladder rung remediates pipeline latency — the brain still learns the
`data_latency` knowledge through the feed); execution shortfalls and
no-executions ground the execution gap (the microstructure rung's
remediation); risk-policy failures ground the risk gap.

## Import discipline (mirrors, never imports — D-003/D-004)

This lane owns NO contract package among the frozen siblings (the
services/api precedent), so it has ZERO workspace source imports: every
consumed lane's shapes — T033's hooks + the outcome/post-mortem
envelopes, T034's served-knowledge envelopes, T015/T016's capability
gaps + the curriculum trail (with the chain fold), T012/T031's
evaluated evidence + the search record (with the dual-lane stableDigest
chain fold) — are STRUCTURAL MIRRORS in `src/mirrors.ts`.
`src/interop.test.ts` imports the REAL lanes test-only and is the
drift trip wire + the contract-test suite in one:

- the REAL T030 golden session -> the REAL T033 ingestion + drafts +
  `queryLearningHooks` -> the REAL hooks drive a full cycle (and are
  byte-deterministic over the REAL world, twice);
- the memory feed drives the REAL T034 `ingestFirmLearning` (the brain
  grows), and the grown brain's REAL `queryFirmKnowledge` output
  annotates the SECOND cycle (the loop closes through the Firm Brain);
- the curriculum revision drives the REAL T015 `planCurriculum` over a
  REAL validated version — the REAL plan's gap-driven stages cite the
  loop's minted gap ids; the REAL `enterCurriculum`/`openCurriculumTrail`
  build the trail the cycle reads;
- every emitted search-trial bundle appends to the REAL T031
  `appendSearchTrial` green (both cycles), and the grown record still
  verifies;
- the commission's gaps satisfy the REAL packages/skills guards and the
  whole bundle drives the REAL T017 `forgeBodyVersion` — a REAL
  ForgedCandidate whose lineage carries the loop's gap ids;
- the REAL T011 trajectory metadata and experiment binding flow
  byte-exact through the T033 records into the commission's evidence.

## Module layout

```
services/autonomous-learning/
  package.json          private, zero runtime dependencies, zero workspace edges
  README.md             this document
  src/
    primitives.ts       the lane's contract discipline: guards, deep-freeze,
                        canonical JSON + FNV-1a, the dual-lane stableDigest
                        mirror (T031's chain fold), TimestampMs, the typed
                        error taxonomy
    ids.ts              the owned identity spaces (alc:/alg:/alv:/als:/alm:/alt:
                        — all content-addressed) + the cross-lane opaque refs
    mirrors.ts          the structural mirrors of T033/T034/T015/T016/T012/T031
                        (incl. the re-derived trail + search chain folds)
    policy.ts           the improvement policy: the focus-action table (the
                        DECLARED decision table), validation, the default
    state.ts            the improvement log (chain-verified, append-only) + the
                        consumed-hooks ledger + the state digest
    integrity.ts        the T031 gates: the adoption gate (holdout distinction,
                        hidden_trials, the refusal vocabulary) + the
                        search-trial mint
    cycle.ts            the loop itself: runImprovementCycle (the gates, the
                        agenda, the products, the atomic append)
    fixtures.ts         the deterministic scenario (hand-minted, in-scope)
    golden.ts           the byte-stable determinism literals
    index.ts            the facade
    *.test.ts           the behavioral suites (cycle / integrity / state /
                        policy / determinism / isolation) + interop (the REAL
                        pipelines through the mirrors)
```

## Non-scope (per the roadmap row)

- Trail TRANSITIONS stay with T015's evidence-gated surface — the loop
  PROPOSES plans (the revision bundle), the trail's own gate advances.
- Body forging + certification stay with T017 — the loop commissions
  (a bundle), the caller forges and certifies.
- The Firm Brain's own promotion/contradiction laws stay with T034 —
  the loop feeds (the snapshot), the brain promotes.
- Scheduling/execution of the commissioned experiments is the compute
  lane's (T014) — the loop's commissions are inputs to it.
