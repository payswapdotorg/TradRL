# Firm memory (T034)

`services/firm-memory/` is the FIRM-BRAIN service: the tenant-isolated
organizational memory over the `@tradrl/firm-memory` contracts
(spec/ARCHITECTURE.md: "Outcome -> Firm Brain -> Capability
Improvement" — this lane IS the Firm Brain stage; the "Memory/
evaluation" plane listing "...outcomes, post-mortems, Firm Brain and
Body Versions"). It turns validated learning into durable,
point-in-time-servable firm knowledge (R25): it ingests T033's query
surface (outcome records + the latest post-mortem drafts + the
attribution classes), promotes post-mortem hypotheses into firm
knowledge under the promotion policy, reconciles and dedupes against
the existing knowledge (contradictions are typed records in a
chain-verified register, never silent overwrites), enforces tenant
isolation at every read and write (R25/L12), and serves the
point-in-time knowledge surface T035's autonomous improvement and the
research bodies' lookups read.

## The pipeline

```
T033 query surface (queryOutcomeRecords + queryPostMortems — the REAL records, consumed through
                    the structural mirrors in packages/firm-memory; never imports)
        │
        ▼  ingestFirmLearning (snapshot = outcomes + post-mortem drafts, at an INJECTED instant)
1. VALIDATE through the mirrors                                (malformed record = typed invalid_field)
        │
        ▼
2. ENFORCE the coherence laws                                  ONE scope per batch (tenant_mismatch — L12);
        │                                                       subject binding vs batch ∪ the consumed-outcome
        │                                                       ledger (lineage_gap); at/after every evidence
        │                                                       instant (l4_boundary_violation — L4); evidence
        │                                                       contributes EXACTLY ONCE (duplicate_evidence)
        ▼
3. LIFT the hypotheses into typed claim candidates             decision -> decision_pattern (dimension-keyed,
        │                                                       polarity from the subject outcome class);
        │   market_move  -> market_behavior (the direction)     market_move 'flat' / an exactly-on projection /
        │   model_error  -> model_calibration (the EXACT bias)  a neutral outcome ground no claim;
        │   data_lag     -> data_latency (the derived band)
        ▼
4. APPLY the promotion policy                                  distinct outcomes >= minEvidenceCount; the
        │   (the birth gate)                                    EXACT MIN confidence fold >= the threshold;
        │                                                       DISTINCT EVIDENCE instants (the anti-cluster
        │                                                       law over lineage.shadowAsOf) >= the stability bar
        ▼
5. RECONCILE against the existing knowledge                   per family, AT MOST ONE knowledge append per
        │                                                       batch (the per-family strictly-forward law):
        │   fresh family   -> FRESH promotion                   the bar gates birth;
        │   same polarity  -> REVISION (the dedupe fold:         union outcome refs, the associative MIN-fold
        │                       union refs + MIN confidence +     confidence, the window re-opens — reinforced
        │                       the re-opened window)             knowledge stays fresh; ANY new evidence
        │                                                       accumulates, the standalone bar gates birth;
        │   opposite       -> the DOMINATION rule: the contest   is recorded FIRST (the typed contradiction
        │                       polarity           record); the challenger promotes ONLY with strictly
        │                                                       more evidence than every opposing entry —
        │                                                       never a silent overwrite; equal internal
        │                                                       counts promote NEITHER (a contest, not knowledge)
        ▼
6. APPEND atomically onto the two chain-verified logs          the knowledge chain (fkr: records, T030's fold)
        │                                                       + the contradiction register (fkc: records) —
        │                                                       rewriting or HIDING an entry is the typed
        │                                                       firm_log_rewrite / contradiction_log_rewrite
        ▼  queryFirmKnowledge / getKnowledgeAt / queryContradictions (the injected instant, the serving policy)
7. SERVE the readers                                            the chain gate first (a tampered brain never
                                                                serves — chain_mismatch); L12 scope-pure reads
                                                                (a cross-tenant point read is the typed
                                                                cross_tenant_access NAMING BOTH SCOPES);
                                                                L4 no-lookahead (future entries invisible;
                                                                a future point read is the typed
                                                                l4_boundary_violation); the deterministic
                                                                family projection (active / superseded /
                                                                decayed + supersededBy); the retention
                                                                horizon (NEVER a deletion)
```

## The records

- **`FirmKnowledgeRecord`** (`fkr:` content-addressed) — the
  promoted, deduplicated learning unit: the typed claim (the closed
  kind/polarity/lag-band vocabularies — one family per T033
  attribution class), the aggregate confidence (the EXACT MIN over
  the supporting confidences — the weakest evidence bounds the firm's
  claim), the distinct-outcome count, the L9 provenance refs back to
  the supporting post-mortems/outcomes/experiments/trials/
  trajectories/sessions, and the validity window `[from, to)` (the
  decay horizon; the window opens exactly at the promotion instant).
- **`ContradictionRecord`** (`fkc:`) — the typed record of one
  contested family: exactly two opposing sides (the incumbent side
  carries its `fkr:` ref; the challenger side snapshots the batch
  candidate's polarity/confidence/count/outcome refs), in the
  register's own hash-chained append-only log. Hiding a contradiction
  is as much a crime as hiding the knowledge.
- **`FirmIngestionReceipt`** (`fmr:`) — every ingestion's
  content-addressed record: the batch digest (idempotence detection),
  the minted fresh/revision/supersession/contradiction ids, the
  injected instant.

## The laws

- **Append-only + chain-verified** (T030/T031's fold, mirrored): both
  logs fold every record's canonical content onto the head from the
  seed `00000000`; an ordinal splice, a foreign chain head, a
  non-monotonic per-family append or a same-instant re-decision is
  the typed `firm_log_rewrite` / `contradiction_log_rewrite`; a
  polarity flip without strictly dominating evidence is the typed
  `contradiction_detected` (the chain law — otherwise the serving
  tie-breaks would flip families on non-dominating appends).
  Verification re-derives the whole fold; every serving call runs it
  first (a tampered brain never serves).
- **Exact decimals** on every confidence path (canonical unit-interval
  decimal strings; a JS number is the typed `decimal_imprecision`).
  The signed arithmetic is the contracts package's local BigInt
  fixed-point kernel — pinned byte-for-byte against
  @tradrl/execution-policy's REAL kernel by the interop parity trip
  wire over the kernel's own unsigned domain.
- **Closed vocabularies, typed errors on unknown**: the four
  knowledge kinds (`unknown_knowledge_kind`), the per-kind polarity
  pairs (`unknown_polarity`), the lag bands (`unknown_lag_band`), the
  confidences (`confidence_incoherent` outside the canonical unit
  interval).
- **R25/L12 tenant isolation**: every record carries its scope; every
  query declares its scope; foreign records never leak through ANY
  filter combination; a cross-tenant point read (or knowledgeId
  filter) is the typed `cross_tenant_access` naming both scopes —
  never a silent miss. Positive per-tenant reads + negative
  cross-tenant probes are pinned by `isolation.test.ts`.
- **L4 point-in-time truth**: the ingestion instant may not precede
  the evidence; a query at instant T never returns entries stamped
  after T; a point read of a future-stamped entry is the typed
  `l4_boundary_violation` (defense in depth). Window stability is
  evaluated over the EVIDENCE instants (`lineage.shadowAsOf` — T033
  mints every learned record at the ingestion instant, so the record
  stamp carries no spread).
- **Injected instants only** — no ambient clock anywhere
  (`Date.now()` never appears); determinism is a construction law
  (the golden test runs the whole pipeline twice against pinned
  literals; the REAL-stack ingestion is byte-deterministic).
- **Retention never deletes**: the window policies bound the
  QUERYABLE horizon and the DECAY horizon (validity expiry serves as
  history, not active knowledge); the logs keep everything, forever.

## Import discipline

- The ONLY workspace source import is this lane's own contract
  package — `packages/firm-memory` — through the single import
  surface (`src/imports.ts`), exactly as services/outcome-learning
  imports packages/outcomes (the frozen lockfile admits no workspace
  edge; the Lead may convert to `workspace:*` at the next serialized
  lockfile change).
- T033's OutcomeRecord/PostMortemRecord/attribution surface, T030's
  shadow lineage block, T011's trajectory/experiment/trial refs and
  T007's tenant/project identity arrive ONLY through the STRUCTURAL
  MIRRORS inside `packages/firm-memory` (D-003/D-004).
  `interop.test.ts` is the drift trip wire: it drives the REAL golden
  session (T030's own fixtures) through the REAL T033 ingestion +
  draft generation + query surface and feeds the results through the
  mirrors end-to-end — asserting the REAL records satisfy the mirror
  guards (type-level witnesses + runtime), a full brain ingestion
  promotes ALL FOUR knowledge kinds from the REAL pipeline, the
  REAL T011 ids flow byte-exact into the provenance, the REAL T007
  TenantId/ProjectId are the opaque scope refs, the REAL decimal
  kernel agrees byte-for-byte with the local helpers, and the whole
  real-stack ingestion is byte-deterministic across two fresh runs.

## Declared interpretations (flagged for Tech Lead ratification)

1. **The aggregate confidence is the EXACT MIN fold** over the
   supporting confidences ("the weakest evidence bounds the firm's
   claim"). Min is associative, so revisions fold exactly:
   `min(min(A), min(B)) = min(A ∪ B)`. A single weak-but-supporting
   post-mortem drags the entry's confidence down — the conservative
   reading of "the firm's degree".
2. **Window stability is the EVIDENCE spread** (distinct
   `lineage.shadowAsOf` instants), not the learning-record stamp —
   T033 mints every learned record at the ingestion instant, so the
   stamp carries no spread. The anti-cluster law therefore measures
   the underlying decisions' availability instants.
3. **The bar gates BIRTH, not accumulation**: once a family exists,
   ANY new same-polarity evidence revises it (the dedupe fold); a
   fresh family requires the full policy bar. Below-bar evidence
   stays consumed (the ledger) but does not itself accumulate.
4. **The domination rule**: a polarity flip requires a strictly
   greater distinct-outcome count than EVERY opposing entry — the
   firm changes its position only through evidence, never by fiat,
   and every contest (win or lose) is recorded in the register first.
   The declared precedence is evidence-first: the incumbent
   accumulates (revises) before the contest is judged; a challenger
   only takes the batch slot when no revision appended.
5. **Equal internal counts promote NEITHER** (a same-batch pair of
   opposing promotable candidates with equal evidence counts is a
   contest, not knowledge); the strictly-larger count promotes and
   the register retains the contest.
6. **The family projection tie-breaks**: the serving winner is the
   highest evidenceCount, then the latest asOf, then the highest
   ordinal — deterministic; the chain's flip law keeps the projection
   from ever flipping on a non-dominating append.
7. **Claims are project-scoped** (the L15 continuity root): the T033
  query surface carries no venue/instrument facts, so the claim
  families key on (tenant, project, kind, dimension, lagBand).
  Instrument-scoped claims await a context-bearing ingestion surface
  (T035's loop or the research bodies' lookups can supply it in a
  later work order) — a recorded limitation, not a silent scoping
  decision.
8. **The polarity derivations**: adverse_gap/execution_shortfall/
   no_execution ground `harmful`; favorable_gap grounds `helpful`;
   as_expected/averted/unbenchmarked_fill are neutral and ground no
   polarity; market behavior carries the payload's position-relative
   direction; the calibration bias derives exactly from
   projected-vs-realized.

## Module layout

```
services/firm-memory/
  package.json          private, zero runtime dependencies
  README.md             this document
  src/
    imports.ts          the single import surface (packages/firm-memory only)
    state.ts            the state machine: the consumed-evidence ledgers, the receipts, the state digest
    ingest.ts           the pipeline: mirror gates, coherence laws, candidate lifting, the promotion
                        policy, the reconcile (revision fold / domination rule / contradiction register),
                        the atomic appends
    serve.ts            the point-in-time serving surface: the chain gate, the isolation laws
                        (cross_tenant_access / tenant_mismatch), the L4 laws, the family projection,
                        the decay/retention windows, the contradiction query
    fixtures.ts         the deterministic scenarios (hand-minted T033-shaped records — the outcome-learning
                        fixtures' own precedent)
    golden.ts           the byte-stable determinism literals
    index.ts            the facade
    *.test.ts           the behavioral suites (ingest / isolation / serve / determinism)
                        + interop (the REAL T030 session, the REAL T033 pipeline, the REAL T011 records,
                        the REAL T007 identity, the REAL decimal kernel)
```
