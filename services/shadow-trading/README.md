# Shadow trading (T030)

`services/shadow-trading/` is the SHADOW-TRADING service: the
paper-trading stage of the learning loop (spec/LEARNING-LOOP.md
curriculum stage 8) and the producer of the outcome records T033
(outcome learning) consumes. A decision stream is paper-executed
against the reactive world (T027) with the **full control stack
enforced BEFORE any simulated fill** — and every outcome is recorded
with its physics lineage for learning.

> The existential law: **gate first, risk second, submission last.** A
> refused or blocked intent NEVER reaches the world — zero world
> submissions, zero fill records per refusal.

## The session

```
decision source (injected async iterator of StrategyIntentMirror-shaped records)
        │
        ▼  per decision (now = intent.asOf — no ambient clock)
1. DRAIN the time-machine cursor at now       (the point-in-time information delta;
        │                                      the drain's firewall audit feeds the shadow audit trail)
        ▼
2. APPLY latency-pending fills                 (a fill enters the book's knowledge exactly when
        │                                      available_time <= now — inclusive)
        ▼
3. SETTLE the world to now                     (advance until settled — the interleaving rest state)
        ▼
4. DERIVE the point-in-time marks              (the declared market events, L4-filtered)
        ▼
5a. THE GATE — runExecutionGate                (T019: intent, policy, portfolio, venue state, kill switch)
        ▼
5b. THE RISK — computeExposure + evaluateLimits (T020: the measured exposure; executionLimitRefusals
        │                                       feed the gate; blocked states fail closed)
        ▼
6. SUBMIT only when the whole stack approves   (the action envelope; collect the world's fills with
        │                                       FULL physics lineage; apply the visible ones; derive
        ▼                                       the disposition; emit the outcome record)
ShadowOutcomeRecord (T033's input) — append-only, chain-verified
```

## The records

- **`ShadowRefusal`** — a refusal is a RECORD, never an exception: the
  T019 decision + the T020 limit evaluation + the execution limit
  refusals + the full lineage. The gate's six dimensions
  (identity / authorization / limits / venue permissions / rate
  limits / credentials) plus the risk stage plus the kill switch are
  all refusal kinds, each with zero world submissions.
- **`ShadowFill`** — the WORLD fill VERBATIM (the engine fill + its
  full physics lineage: engine config hash, fee/latency/slippage/
  impact policy refs, run ref) plus the shadow binding. A fill without
  physics lineage is the typed `physics_lineage_missing`.
- **`ShadowOutcomeRecord`** — per decision: the disposition
  (`filled | refused | partial | expired`), the fills, the costs, the
  realized outcome, the full L9 lineage (session ref, config digests,
  chain heads, cursor position, seed), tenant/project, and the
  mode-honesty block (`mode: 'shadow'`, `fill_origin: 'simulated'`).
  JSON-serializable, deeply frozen, lineage-complete — T033 consumes
  it through mirrors later.
- **`ShadowOutcomeLog`** — append-only and chain-verified; a rewrite,
  reorder, splice or truncation is the typed `shadow_log_rewrite`.

## The book

Positions/cash/realized-unrealized accounting derived EXCLUSIVELY from
physics-lineage fills, over exact decimals (BigInt fixed-point via the
execution-policy contract) on every money path. The account-side
interpretation: the taker pays the aggressor's post-slippage price +
the taker fee; a maker fill accounts at the level price + the maker
fee. The one divided site (a sell's proportional cost-basis release)
rounds half-up at 8 decimals. The portfolio mirror this book derives
passes BOTH contract packages' guards (the mirrors are field-for-field
identical). The book's cash floor is non-negative (the margin-book
domain is the risk engine's exposure record, not this lane's mirror).

## The time-machine wiring (the T029 README contract, verbatim)

One cursor per shadow consumer: `openCursor({ from: 'tip' })` when
going live or `from: 'start'` to replay the retained window;
`drainCursor(cursorId, now)` per shadow tick IS the point-in-time
information delta; `asOf` warms the book up at construction; the
drain's firewall audit feeds the shadow audit trail; `forkCursor`
(`forkShadowSession`) supports a second shadow book without rewinding
the first. The inclusive L4 boundary is re-proved over every drained
record (defense in depth — a leak is the typed
`l4_boundary_violation`).

## Determinism and resume

Same (decision stream, world inputs, policies, seed) → byte-identical
session (the golden test, run twice). `serializeShadowRunState` /
`resumeShadowRunState`: canonical JSON bytes (the injected ports and
the decision source are dependencies, not state — the resumer
re-supplies them); the resume gate re-verifies the kill-switch chain,
the T019 audit chain, the outcome-log chain and the tick audit chain
(tamper = typed `chain_mismatch`) before the session may continue.

## Import discipline

- The contract packages `@tradrl/execution-policy` and `@tradrl/risk`
  are consumed via RELATIVE SOURCE IMPORTS
  (`../../../packages/<pkg>/src/index`) — the frozen lockfile admits no
  workspace edge (the `services/strategy` + `services/execution-sim`
  precedent; the Lead may convert to `workspace:*` at the next
  serialized lockfile change).
- The reactive world (T027) and the rolling time machine (T029) are
  NEVER imported: they arrive through the injected
  `ReactiveWorldPort` / `TimeMachinePort` (structural mirrors of their
  public surfaces). `interop.test.ts` is the drift trip wire: it drives
  the REAL `createReactiveWorldService` (over the REAL exchange-sim
  engine) and the REAL `createRollingTimeMachine` through the ports —
  a full paper-trading session with physics-lineage fills, refusals
  that never reach the world, the inclusive L4 boundary, the fork and
  byte-identical determinism.

## Declared interpretations (flagged for Tech Lead ratification)

1. **The risk stage's refusal criteria**: the submission is refused
   when `executionLimitRefusals` is non-empty (breaching class-kind
   limits — the records that FEED the T019 gate) OR any limit state is
   `blocked` (kill-switch dominance; no-declared-limit fail-closed).
   Portfolio-kind breaches (drawdown / leverage / concentration) are
   MEASURED and recorded — they do not independently block (L7: the
   engine informs, evaluation decides). The golden scenario exercises
   this: d5 proceeds while a drawdown breach is recorded.
2. **The disposition window**: the disposition is decided at the
   decision's tick (the engine's immediate response after settling the
   world to the decision instant). A resting-but-unfilled order at
   window close is declared `expired` (the closed vocabulary's honest
   member); later fills from a still-resting order accrue to the BOOK
   and the run record, not retroactively to the outcome record.
3. **The L12 envelope**: a cross-tenant intent is the typed
   `tenant_mismatch` at the session envelope (an operational crime,
   not evidence) — the gate's identity refusal covers same-tenant
   principal mismatches.

## Live trading is OUT OF SCOPE — and inexpressible

`ShadowMode` is the literal `'shadow'` — a one-member type; a session
config (or a forged run state) claiming `'live'` or `'exact_replay'`
fails the typed `fidelity_claim_dishonest` at construction, at every
record guard and at resume. Shadow fills are `simulated`-origin and
never conflated with live evidence (R23). Venue binding beyond the
reactive world is T040's lane.

## Module layout

```
services/shadow-trading/
  package.json          private, zero runtime dependencies
  README.md             this document
  src/
    primitives.ts       zero-dep foundation (guards, deepFreeze, canonical JSON, FNV-1a)
    errors.ts           the typed error taxonomy (shadow_log_rewrite, chain_mismatch, tenant_mismatch, ...)
    ids.ts              branded ids (shs:/swo:/swf-/swr:/swt-) + mints
    mode.ts             the mode-honesty law ('shadow' literal; live/exact_replay rejected)
    world-mirror.ts     the injected ReactiveWorldPort + the physics-lineage fill mirror + the L4 fill gate
    time-machine-mirror.ts  the injected TimeMachinePort + the cursor/drain/as-of mirrors + the L4 re-proof
    book.ts             the exact-decimal paper account (taker/maker roles, basis release, PnL split)
    outcomes.ts         ShadowFill / ShadowRefusal / ShadowOutcomeRecord + the append-only chain-verified log
    session.ts          the tick machine (drain/apply/settle/derive/gate/risk/submit-or-refuse/record)
    run-state.ts        serializeShadowRunState / resumeShadowRunState (canonical bytes, chain-verified)
    fixtures.ts         the deterministic golden scenario (scripted world + machine ports; one fixture per refusal kind)
    golden.ts           the byte-stable determinism literals
    index.ts            the facade
    *.test.ts           the behavioral suites (session/book/determinism/resume) + interop (the REAL services)
```
