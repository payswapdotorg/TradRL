# Outcome learning (T033)

`services/outcome-learning/` is the OUTCOME-LEARNING service: the
Memory/evaluation plane's OUTCOMES + POST-MORTEMS segment over the
`@tradrl/outcomes` contracts (spec/ARCHITECTURE.md: "trajectories,
experiments, evaluation, verification, outcomes, post-mortems, Firm
Brain and Body Versions" — this lane owns OUTCOMES + POST-MORTEMS;
the Firm Brain is T034, Body Versions stay with the body forge).
It learns from T030's shadow outcome stream: every decision linked
to its realized consequences, reconciled, attributed, and served to
the readers (T034's Firm Brain by tenant/project/decision; T035's
autonomous improvement through the compiled hooks).

## The pipeline

```
T030 shadow outcome stream (the mirrored, chain-verified ShadowOutcomeLog)
        │
        ▼  ingestShadowOutcomes (batch = stream + book snapshot + binding + facts, at an INJECTED instant)
1. VERIFY the stream's chain through the mirror fold      (tamper = typed chain_mismatch — never learned from)
        │
        ▼
2. RECONCILE per decision                                  (expected-vs-realized; honest NULLs, never invented numbers)
        │   quantity: expected (order facts / '0' for refusals) vs filled (disposition semantics / fill facts)
        │   PnL:        declared expectation vs realized (exact signed decimals; the pinned tolerance band)
        │   class:      DERIVED (averted / no_execution / execution_shortfall / as_expected / adverse_gap /
        │               favorable_gap / unbenchmarked_fill) — the closed vocabulary; the mint testifies coherence
        ▼
3. RECONCILE against the shadow book                       (Σ realized vs the book's realizedPnl — the exact
        │                                                   accrual delta: genesis + T030's declared late-fill
        │                                                   accruals, QUANTIFIED never assumed away)
        ▼
4. APPEND atomically onto the chain-verified OutcomeLearningLog   (one decision, one learned outcome)
        │
        ▼  generatePostMortemDrafts (policy + mark facts, at an INJECTED instant)
5. DRAFT structured post-mortems                            (expected / happened / gap by value + the four TYPED
        │   decision:      dimension (unresolved in drafts — single-sample honesty)      attribution classes,
        │   market_move:   two marks + position-relative direction (evidence-gated)      each with a typed
        │   model_error:   projected + realized + kind (evidence-gated)                  payload, a policy-
        │   data_lag:      decisionAt + availableAt + the exact lagMs (L4 fact)          declared confidence
        ▼                                                                          and evidence refs)
6. APPEND onto the chain-verified PostMortemLog             (supersession by STRICTLY-later append — T011 precedent)
        │
        ▼  queryOutcomeRecords / queryPostMortems / queryLearningHooks (tenant/project/decision; L12-filtered,
7. SERVE the readers                                        L4-windowed over injected instants; latest-per-outcome
                                                            post-mortem projection; the hooks T035 consumes)
```

## The records

- **`OutcomeRecord`** (`out:` content-addressed) — one decision
  linked to its realized consequences: the expectation block
  (expectedQuantity `0`-for-refusals or the order facts' quantity or
  an honest NULL; the declared PnL expectation or NULL; the pinned
  tolerance; the declarer's ref), the realization block (every money
  field VERBATIM from the shadow record — the byte-preserving law),
  the deviation block (the exact signed arithmetic, NULL = the honest
  unknown), the derived class, and the full L9/L15 lineage: T030's
  lineage block VERBATIM + the shadow stream binding + the decision
  stream position + the T011 trajectory/experiment/trial bindings.
- **`PostMortemRecord`** (`pmr:`) — the structured post-mortem:
  expected / happened / gap carried by value, the attribution
  hypotheses (each a typed record — never prose-only), evidence refs,
  and the lineage. This lane produces DRAFTS; refinement appends a
  strictly-later record; ratification into capability change is
  downstream (R27 boundary).
- **`OutcomeLearningHook`** (`olh:`) — the typed signal T035
  consumes: the class, the gaps, the dominant attribution, the
  deterministic focus suggestion. The hook INFORMS, never decides —
  no acceptance verdict, no body-version proposal.

## The laws

- **Append-only + chain-verified** (T030's fold, mirrored): both
  logs fold every record's canonical content onto the head; a
  splice, reorder, truncation, re-decision, foreign head or
  same-instant re-draft is the typed `outcome_log_rewrite` /
  `postmortem_log_rewrite`. Verification re-derives the whole fold.
- **Exact decimals** on every money/confidence path (canonical
  decimal strings; a JS number is the typed `decimal_imprecision`).
  The signed arithmetic is the contracts package's local BigInt
  fixed-point kernel — pinned byte-for-byte against
  @tradrl/execution-policy's REAL kernel by the interop parity trip
  wire over the kernel's own unsigned domain.
- **Closed vocabularies, typed errors on unknown**: the seven-member
  outcome-class vocabulary (`unknown_outcome_class`), the four
  attribution classes (`unknown_attribution_class`), the evidence
  kinds (`unknown_evidence_kind`), the confidences
  (`confidence_incoherent` outside the canonical unit interval).
- **L12 tenant isolation**: every record carries its scope (enforced
  against the shadow lineage at the mint); every query declares its
  scope and foreign records never leak through ANY filter
  combination.
- **L4 point-in-time**: the ingestion instant may not precede the
  evidence (`l4_boundary_violation`); a post-mortem may not predate
  its outcome; a query at instant T never returns records stamped
  after T (retention windows are two-sided: age + future).
- **Injected instants only** — no ambient clock anywhere
  (`Date.now()` never appears); determinism is a construction law
  (the golden test runs the whole pipeline twice against pinned
  literals).
- **Retention never deletes**: the window policies bound the
  QUERYABLE horizon only; the logs keep everything, forever.

## Import discipline

- The ONLY workspace source import is this lane's own contract
  package — `packages/outcomes` — through the single import surface
  (`src/imports.ts`), exactly as services/research/src/regime
  imports bodies/regime-researcher and services/shadow-trading
  imports the execution-policy/risk contract packages (the frozen
  lockfile admits no workspace edge; the Lead may convert to
  `workspace:*` at the next serialized lockfile change).
- T030's shadow outcome stream, T011's trajectory/experiment shapes
  and T019's decision/intent ids arrive ONLY through the STRUCTURAL
  MIRRORS inside `packages/outcomes` (D-003/D-004). `interop.test.ts`
  is the drift trip wire: it drives the REAL golden session
  (T030's own fixtures — the scripted world, the scripted machine,
  the reference intent stream) through the mirrors end-to-end and
  asserts: the REAL records satisfy the mirror guards; the mirror's
  chain verification agrees with the REAL `verifyShadowOutcomeChain`
  over intact AND tampered logs; the stream-digest mirror equals the
  REAL `shadowOutcomeDigest`; the lineage blocks are preserved
  BYTE-FOR-BYTE into the learned records; the REAL T011
  TrajectoryMetadata/TrialRecord ids flow byte-exact through the
  session binding; and the whole real-stack ingestion is
  byte-deterministic across two fresh runs.

## Declared interpretations (flagged for Tech Lead ratification)

1. **The honest accrual delta**: the reconciliation against the
   shadow book QUANTIFIES `book.realizedPnl − Σ realizedOutcome`
   (the genesis balance plus T030's declared late-fill accruals —
   later fills from still-resting orders accrue to the BOOK, not
   retroactively to the outcome record) instead of failing on it.
   The real golden session's delta is exactly `-38.32833333` (every
   one of its sells' fills is latency-pending at its decision tick);
   the service-scenario's delta is exactly `0` (its fills all apply
   within their ticks). The receipt records both instants.
2. **The snapshot-instant law was deliberately relaxed**: T030's
   `book.asOf` is the LAST-APPLIED instant (the last fill's
   availability time), not a knowledge cutoff — a finished session's
   final book legitimately carries an `asOf` that precedes the last
   decision ticks. The snapshot's instant is recorded on the receipt;
   no rejection.
3. **The caller-supplied facts**: the shadow outcome stream does not
   carry the orders' quantities, instruments, sides or the fills'
   quantities — the caller (who fed the decision stream to the
   shadow session) supplies them as optional mirrors. Absent facts
   produce honest NULLs and the disposition-derived classes — never
   invented numbers.
4. **The draft dimension/kind honesty**: single-sample evidence does
   not discriminate timing from sizing from price — drafts emit
   `unresolved` dimensions/kinds with the typed facts; downstream
   refinement (T035, human review through T034) narrows by APPEND.
5. **The confidence provenance**: draft confidences are the POLICY's
   declared heuristics (fixed unit-interval decimals), never ambient
   and never per-record inventions; co-occurrence is legal (the
   confidences are not forced to sum to 1 — mutual exclusivity would
   be a false constraint).
6. **Drafts for the golden default policy**: adverse_gap,
   favorable_gap, execution_shortfall and no_execution warrant
   drafts; as_expected, unbenchmarked_fill and averted do not (the
   control stack's own correctness is the risk lanes' domain).

## Module layout

```
services/outcome-learning/
  package.json          private, zero runtime dependencies
  README.md             this document
  src/
    imports.ts          the single import surface (packages/outcomes only)
    book-mirror.ts      the shadow book snapshot mirror + the mark facts mirror
    policy.ts           the three versioned policies (reconciliation / draft / retention) + validation + defaults
    reconcile.ts        the per-decision + account reconciliation engines (exact decimals, honest NULLs)
    state.ts            the state machine: ingest (chain gate, L4 gate, coherence laws, atomic append), receipts, retained facts
    postmortem.ts       the draft generator (evidence-gated typed hypotheses, policy confidences)
    retention.ts        the two-sided visibility windows (age + L4 future)
    query.ts            the tenant/project/decision query surface + the hook compilation
    fixtures.ts         the deterministic six-decision scenario (a hand-minted chain-valid T030-shaped stream)
    golden.ts           the byte-stable determinism literals
    index.ts            the facade
    *.test.ts           the behavioral suites (reconcile / postmortem / retention-query / determinism)
                        + interop (the REAL T030 session, the REAL T011 records, the REAL decimal kernel)
```
