# Phase 2 · Round F — Competitive-Adoption Re-measurement Report (2026-10-09)

**Origin measured:** production https://tradrl-console.vercel.app — the FW-36-fixed
origin (main @ 30c4e9b, dpl_8RmSWER2 smoke-verified; latest READY dpl_FMP2WqwjhRka
@ 3a2a2ca docs-only successor). Same instrument as Round E: 9 simulated
professionals (3 small / 3 mid / 3 large) × 51 complex projects (13 deep
full-lifecycle + 38 fast throughput), agent-browser fresh first-time sessions,
UI-only law, Bloomberg Terminal / TradingView / QuantConnect comparator
fact-sheets (disclosed asymmetry), honest counts bounded by the single-browser
harness ceiling.

**Waves:** P2F-A (S1, M1) → P2F-B (L1, S2) → P2F-C (M2, L2) → P2F-D (S3, M3) →
P2F-E (L3). Dispatch restructured from 3-parallel to ≤2-parallel after the first
attempt died to the sandbox OOM killer (0 rows lost; disclosed as harness note).

## 1. Headline results

| Metric | Round E | Round F | Δ |
|---|---|---|---|
| **Main-interface adoption** | 0 yes / 2 leaning / 7 no | **0 yes / 2 leaning / 7 no** | — |
| Decision (vs incumbent) | 0 switch / 6 undecided / 3 stay | 0 switch / 3 undecided / 6 stay | (softer comparability: fresh persona briefs per round) |
| Would-pilot | 9/9 | **9/9** | — |
| E-1 deliverable substance | 9/9 FAIL (content-free stub) | **8 pass / 1 partial** | FIXED (M3's residual: echo-not-research) |
| E-2 honest gate | 9/9 FAIL (limits never bind; false assertions) | **3 pass / 6 partial** | CORE FIXED — capital-budget class binds with exact itemized arithmetic everywhere; class-coverage gap remains |
| E-8 row-level disclosure | 9/9 FAIL (leaks) | **9/9 PASS** | FIXED |
| E-9 export integrity | empty-export + verifier race | **9/9 PASS** | FIXED (all 9 independently re-verified chains from the file alone; 4 wrote their own verifiers from the published canonicalRule) |
| Fast-project median | 92s | **51s** (mean 67s; min 38s) | −45% |
| Projects / sub-tasks | 51 | **51/51 completed, 209/209 sub-tasks** | — |
| Friction events | (Round E register) | **23** (all 9 personas) | — |

## 2. The four FW-36 fixes — verdict

All four held live on the fixed origin, independently verified by every persona:

- **E-1 (deliverable substance):** every persona's deliverable carried their
  mandate's actuals verbatim (capital/risk/drawdown/caps, markets, objective
  word-for-word); two-mandate divergence verified by M1/L1/M3 (5 mandates → 5
  observably distinct texts). Residual (M3, the only partial): honest
  composition is a **provenance receipt, not research** — no synthesis, no
  derived statistics from the project's own recorded events (fill series,
  utilization-vs-bounds, realized-vs-expected), which the records would support
  without fabrication.
- **E-2 (honest gate):** the capital-budget class (`capital.budget`,
  `book.notional`, `order.notional`) binds at the gate with exact-decimal
  itemized projected-book arithmetic (verified reconcilable by 9/9); the
  realized-cumulative class (`risk.budget`, `risk.maxDrawdown`) binds once
  realized records exist; breach statements computed; the desk sizes inside the
  tightest gate-observable bound. **The gap:** `state:position.grossExposure`,
  `state:position.concentration`, `action:costs.dailyTurnover` are
  taught-not-enforced (`not_gate_evaluable`), the teaching is **export-only
  (invisible in the UI)**, and the Risk cards **overclaim** "enforced at the
  pre-trade gate" — contradicted by the export's own verdicts. L2's live
  stress: a cap-1 desk opened 2 concurrent positions; a turnover-100 bound
  was blown through to a 240-notional standing breach. See F-1.
- **E-8 (row disclosure):** SIMULATED tags on every fill+refusal row (9/9);
  `simulated:true` on every export record (0 missing across all censuses);
  DEMO markers on fresh-session Home.
- **E-9 (export integrity):** post-switch exports non-empty + scope-matched
  (9/9); chains independently re-verified from the file alone — heads match
  exactly, cohorts 302–1194 events; no empty-but-valid payloads; the verifier
  file-input race closed.

## 3. Dimension scorecard (means, n=9)

| Dimension | TradRL | Primary competitor | Verdict |
|---|---|---|---|
| onboarding | 4.22 | 3.11 | win |
| time_to_value | 4.33 | 3.22 | win |
| agent_org_model | 4.11 | 1.11 | win (the moat) |
| auditability | 4.78 | 2.67 | win (the moat) |
| risk_tooling | **3.33** | **3.44** | **LOSS — the only functional loss (F-1)** |
| time_machine | 4.00 | 1.78 | win |
| notifications | 3.33 | 3.33 | tie |
| export | 5.00 | 3.11 | win (perfect score) |
| pricing_fit | **2.56** | **3.22** | **LOSS (E-7 unpublished)** |
| discoverability | 3.67 | 3.67 | tie |

TradRL wins 6/10, ties 2, loses 2 — yet main-interface stays 0/2/7. Every
persona's reasoning converges: **it is a verified governance/audit layer to run
BESIDE the incumbent stack, not a replacement home screen.** The adoption gap
is structural, not trust-based (trust is now earned — the fixes held).

## 4. Round F register (F-1..F-12; evidence in the 9 worklog sections)

- **F-1 (HIGH — the risk_tooling loss; 6/9 e2-partials):** constraint-class
  enforcement gap — position/concentration/turnover taught-not-enforced;
  teaching export-only; Risk cards overclaim "enforced at the pre-trade gate";
  custom turnover constraints stamped "blocking" while non-binding. Evidence:
  L2's taxonomy (bound-at-gate / taught-not-enforced / silent), M1+M2 turnover
  non-enforcement, S3+M3 Risk-card overclaim reproductions, L3's 600-turnover
  blown to a 19,200 standing breach.
- **F-2 (HIGH — every multi-desk persona's #1; the E-5 carry):** no
  consolidated multi-desk oversight surface anywhere (Home/Risk/Evidence/palette
  are strictly one-desk-at-a-time). M1: "my morning review means four project
  switches instead of one Launchpad monitor." L2: "my morning risk meeting
  cannot run desk-by-desk."
- **F-3 (HIGH — institutional disqualifier; the E-4 carry, sharpened):** shared
  demo tenant lists other sessions' desks by name (M1: 157; L3: 199); L1 and L3
  each switched into another session's desk and read its full blotter
  (L3: a 49,999,992-notional fill); L2 reported a cross-session export bleed
  (372 foreign events in a demo-scope export) — **challenged by S3, M3, L3
  (clean censuses ×3)**: verdict = not reproduced; needs a targeted
  reproduction attempt before it enters a fix wave as fact (kept as an open
  question).
- **F-4 (frequency champion — 8/9 personas):** horizon duration label bug —
  deliverable + export say "(one day)" for 30/45/60/90-day horizons (wizard
  review itself correctly shows hours; dates correct; label wrong).
- **F-5 (5/9):** "Start the primary flow" / launch button silently no-ops
  after a completed launch + project switch (8 attempts in M1's case); full
  page reload is the workaround. S2's variant: button absent from Home after a
  launch.
- **F-6 (L4 law violation; found by M2, reproduced by M3):** Time Machine
  scrub to a past instant — the Risk "Active breaches" panel renders a refusal
  observed in the FUTURE of that instant (Research/Decisions/Execution project
  correctly).
- **F-7 (CIO-confusing):** the standing K-CAPITAL-BUDGET breach card displays
  the REFUSED candidate's projected book (184,859.99) while the actual book is
  4,860 — honest per the published precedence, but reads as a false breach.
- **F-8:** refusals cite only capital.budget even when the (unenforced)
  position cap was also breached — single-constraint citation (moot if F-1
  lands enforcement).
- **F-9 (restart posture half-true):** close/re-open resets theme (despite
  "remembered for future visits" copy), re-shows onboarding, resets scope to
  demo, drops launched desks from the switcher's default list. Durable DATA /
  ephemeral SESSION (L3's documentation). FW-34-B's claim is half-true.
- **F-10 (the E-3 carry):** mandate-blind desk behavior — the desk attempts
  orders sized to the whole account within minutes (S1: $249,999.99 vs cap 2;
  S3: the entire 180k in one order; M3: the 8.333333 sizing family), relying
  on the gate to refuse.
- **F-11 (the E-6 carry, sharpest cut):** the closed research world — 0
  file/URL inputs DOM-wide, no palette ingestion commands, read-only Evidence,
  and even the Submit-research free-text Notes **never reach the event chain**
  (absent from the export). Experiments section is a dead-end stub.
- **F-12 (e1 residual):** the deliverable composes no derived statistics from
  the project's own records (utilization-vs-bounds, fill-series facts) — an
  honest-composition opportunity left on the table.
- Polish cluster: covered launch button (L1), cross-desk "Safety intervention"
  toast on per-desk screens (L1), export toast fired 3× without a file (L2,
  concurrent-worker sandbox collision not ruled out), wizard data-sources
  validation surfacing only at review (M1), generic instrument fills without
  symbols (S2).

## 5. Conclusion + next wave

Round F confirms the FW-36 fixes are REAL (e8/e9 9/9, e1 8/9, e2 core honest
9/9 with a precisely-mapped class gap) and the speed work landed (fast median
92s → 51s) — but main-interface adoption did not move because the remaining
blockers are structural: **the oversight surface (F-2), the tenancy walls
(F-3), full constraint-class enforcement with honest UI (F-1), and published
pricing (E-7)**. The product now wins the trust dimensions outright
(auditability 4.78, export 5.00, agent_org_model 4.11) — the personas
unanimously would pilot (9/9) as the governance layer beside their stack.

**Next (FW-37, dispatched per the resident loop):**
- **FW-37-A — the honesty wave (bounded, high-frequency):** F-1 (enforce the
  position/concentration/turnover classes at the gate — or align the UI to the
  true verdicts and surface the accepted-domains teaching in-UI; kill the
  "enforced at the pre-trade gate" overclaim), F-4 (horizon label), F-5
  (post-switch launch no-op), F-6 (Risk-panel L4 leak), F-7 (standing breach
  card vs actual book).
- **FW-37-B — the oversight wave (the adoption structural):** F-2 (a
  consolidated multi-desk oversight surface — the #1 ask of every multi-desk
  persona) + F-3's first half (stop listing other sessions' desks by name;
  wall the cross-session switcher entries; targeted F-3 export-bleed
  reproduction attempt).
- Carried for later waves: F-9 (restart posture), F-10 (mandate fidelity),
  F-11 (ingestion), F-12 (deliverable analysis), E-7 (pricing publication —
  a business decision, not code).

Round G re-measures on the FW-37 origin when it deploys.
