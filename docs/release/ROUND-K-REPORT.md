# Phase 2 · Round K Report — The FW-42 re-verification (a clean sweep)

Origin: production main @ 5c6212d (FW-42-A #95 + FW-42-B #96), deployed
dpl_5SjyUeLJ on the fresh store. 9/9 personas (sixth re-evaluation), 59
ledger rows, UI-only law, honest counting — every wave single-worker clean.

## 1. The headline

| | yes | leaning | no | would_pilot | fw42_overall |
|---|---|---|---|---|---|
| Round J | 0 | 8 (7 firmer) | 1 | 9/9 | — |
| **Round K** | **0** | **8 (most "firmest of six rounds")** | **1 (M3, purely product-scope)** | **9/9** | **9/9 PASS** |

The arc: E 0/2/7 → F 0/2/7 → G 0/6/3 → H 0/8/1 → I 0/8/1 → J 0/8/1 →
**K 0/8/1**. Every FW-42 delta verified dead from the users' seats, on
their OWN Round J failure shapes, quantified at 100-150ms sampling.

## 2. THE CLEAN SWEEP (every FW-42 item, 9/9 pass each)

- **I-4 (the lying record — the top defect): DEAD.** L3's draft-restored
  shape, M2's clean-launch WRITE-race shape (F2 retested), S1's Round I
  stub shape (F2 draft-restored) — every launch carried the full world
  verbatim; "no launch world on record" appeared ZERO times in any UI or
  any export (M3: zero occurrences in a 1.9MB file); the row-based
  launchWorld record survives even a cross-browser export (S2).
- **J-1 (the ceremony display): DEAD at first render.** 100-150ms samplers
  armed before the sign-in click (102-372 frames per persona): "Adopt this
  desk" in ZERO frames; the first ceremony-carrying frame already reads
  "already yours — following this account."
- **I-3b (the reload-path marker): DEAD from the first paint.** The org
  tile's first paint (1.1-1.7s page-age) reads "Reading the world…"; the
  bare "Not compiled yet" rendered in ZERO of 1,000+ collective samples
  (the Round J window was ~3-8.5s of misstatement).
- **J-2 (the stale-draft hazard): DEAD.** 6-11s review pauses → the wizard
  reopens DOM-verified BLANK after every launch.
- **The copy + J-3: DEAD.** Signed-in: "your projects — every desk that
  follows your account, from any browser" / "your desks… whatever browser
  launched it"; signed-out honestly session-scoped; zero prj-demo-console
  flashes. THE PURE TEST now passes WITH the truthful copy — every persona
  found all their desks from a wiped context.
- **Regression-clean:** the wizard laws, the draft persistence, H-4/H-6,
  g1, E-1/E-2/E-8/E-9 (chains re-verified from the file alone: 69-723
  records each, every head exact).

## 3. Round K register — THE PRODUCT LIST (the whole remaining distance)

The defect register is EMPTY. Every persona's YES-gate list is the product
list, named precisely and consistently:
1. **E-7 — published commercial pricing** (on every list; L3: "a bank
   cannot procure an unpriced seat vs ~$28k/seat across 2,500 seats";
   S1: "I cannot budget a seat on a promise"). **An operator decision.**
2. **The Oversight cockpit** (M1 + L1's #1 gate; DOM-verified absent a
   third time): cross-desk aggregate row, per-desk P&L/net-exposure,
   drill-through from breach counts to blotters. "A census, not yet a PM
   cockpit."
3. **E-6 — the research world** (M3's #1, decisive): ingestion with
   boundary teaching, compute over ingested data, submitted text in the
   chain. "A build and a price list, not a fix."
4. **F-12 — derived statistics in deliverables** (on four lists).
5. **E-3 — the standing whole-account proposal supervision load** (M1/M2).
6. **S2: a market-facing surface** (charts/live data/alerts vs TradingView).
- **Minor:** the export chain is page-session-scoped (4 personas —
  post-reload exports omit pre-reload events; honestly disclosed by
  chainScopeNote, the chain verifies unaffected); S1's silent draft-restore
  banner on the auto-reopen path (cosmetic).

## 4. Conclusion

Six rounds of measurement have taken the product from 0/2/7 to 0/8/1 with
every honesty defect verifiably dead and would_pilot 9/9 across all nine
professionals. The first YES vote is no longer gated on any fix — it is
gated on the product list above, and the two buildable items (the Oversight
cockpit; F-12 derived statistics) plus the export-scope minor are
dispatchable now. E-7 requires the operator's price decision. The next
wave (FW-43) builds the cockpit + the statistics + the export scope;
Round L measures them.
