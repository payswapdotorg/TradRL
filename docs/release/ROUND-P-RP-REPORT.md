# Phase 2 · Round P-RP Amendment — The re-poll: ALL THREE LEANING SEATS FLIP TO YES (9/9 YES, would_pilot 9/9, 7 SWITCH + 2 pilot-deferred); the FW-53 gate confirmed closed by the seats that cited it

Origin: production main @ ec34976 (FW-53 merged via PR #114 — the wizard
action-row geometry + the Inbox `alert_fired` fold + the Outcomes
read-in-flight face + the trading-halt notices; battery 572 files /
8,844+1skip, console.ts 172,639), deployed tradrl-console.vercel.app
13:29Z, FW-53 markers verified in the served sources.

The three seats that held LEANING in Round P — every one citing the SAME
single gate (the 1280×577 overlap class) — re-polled on the fixed
production origin ~1 hour after deploy. All three flipped to YES. Zero
protocol violations across the re-poll.

## 0. The re-poll harness record (disclosed in full)

- Re-poll dispatched through the replay console in Agent mode
  (general_agent sessions): S3 13:41Z (88851ae4), L2 13:56Z (c8cb77c4),
  L1 14:27Z (f0ae0157). The instrument: persona + own-Round-P-findings
  re-verification arc — the GATE walk (all 5 wizard steps, mouse-center
  clicks, per-step ledger rows), own-blocker re-tests, spot deltas, final
  survey-row.
- The capacity class, re-poll edition (disclosed): L2's send stalled at
  workspace provisioning until a stale slot was released (the concurrency
  dialog through the replay); L1's first four sends were auto-GC'd — the
  peak-hours dialog (GLM-5.2, then GLM-5.3-Flash in sequence) intercepted
  mid-flow, rendering its text only on the composited frame (empty in the
  DOM — the zombie-modal trap); the send landed on GLM-5.2 at 14:27Z when
  the peak window flipped. ZERO fabricated rows — the completed runs'
  numbers are each seat's own.
- One renderer freeze mid-L1 (the frozen-renderer class) — cured by a tab
  reload; the worker progressed server-side throughout.
- Harvest read-only via the site API with the durable operator token;
  full transcripts banked (ops/round-p/*-rp-*.json in the ops vault).

## 1. The re-poll tally

| Seat | Round P | P-RP verdict | would_pilot | decision | TTFV (P → P-RP) | Friction (P → P-RP) | Tasks |
|---|---|---|---|---|---|---|---|
| S3 | leaning | **yes** | true | undecided (real-data pilot first) | 376s → 420s* | 4 → 3 | 11/11 |
| L2 | leaning | **yes** | true | undecided (real-data pilot first) | 281s → 242s | 8 → 3 | 23/25 (harness-disclosed) |
| L1 | leaning | **yes** | true | **switch** | 664s → 170s | 5 → 1 | 11/11 |

*S3's P-RP pass re-verified more surfaces than its P arc.

**Combined Round P + P-RP: 9/9 verdict YES, would_pilot 9/9 — S1 S2 M1
M2 M3 L1 L3 SWITCH (7), S3 L2 undecided pending a real-data pilot (2).
Zero protocol violations across both rounds.**

## 2. The gate verification (the re-poll's purpose)

- **O-3R (the overlap class): CLOSED.** S3: "walked all 5 wizard steps
  via mouse-center clicks with zero interceptions." L2: "center-clicked
  through all five wizard steps and the discard arm never intercepted or
  covered a primary action — measured, worst case 17px clean separation
  below the row." L1: "every Next/Review/Launch fired at button center,
  Discard never intercepted or covered the primary action on any step
  (Launch vs Discard vertical gap 117px at the critical Step 5)."
- **N-1 (fired alerts → Inbox): VERIFIED by S3** ("observed 'Shadow
  degradation' and 'Safety intervention' as fired-alert notices in the
  Inbox after launch"). L2 honestly left the `alert_fired` fold
  uncredited as unobservable in its arc — the seats credit only what
  they re-observed.
- **N-2 (Outcomes read-lag): VERIFIED by S3** ("the false 'No outcomes'
  is replaced by the truthful 'Reading the world…' face — real outcomes
  in ~1.2s vs 7.2s").
- **N-3 (silent desk halt): VERIFIED by L1** ("honestly disclosed but
  never resolved" — the halt notices now name the pause; L1 records the
  deeper truth below).
- **All 8 delta fields PASS at all three seats (24/24).**

## 3. The carried truths (the honest residue, next-wave input)

- **L1's structural finding (recorded, not a UI bug):** market-world
  post-declaration alerts are structurally impossible without a live
  feed — "if you want alerts that fire on live market data, that's a
  deployment-mode decision (live feed integration), not a UI fix." This
  is the product's next REAL frontier: the live-data pilot both S3 and
  L2 explicitly request before committing to switch.
- L2: discoverability "better, not good" (4/10 — the honest floor);
  2/25 tasks lost to disclosed harness slips, not product friction.
- L1: "a future FW could surface the cancel affordance in-view" (the
  discard exit remains discoverable by scan, not by signpost).

## 4. What this decides

**The Phase-2 perception campaign is CLOSED: the product's verdict
profile is 9/9 YES with would_pilot unanimous — the fix-before-pilot
gate (FW-53) is confirmed closed by exactly the seats that cited it,
with measured geometry (17px worst-case separation, 117px at the
critical step) and TTFV nearly quadrupled on the seat that paid the
overlap tax (L1: 664s → 170s).**

The remaining human steps: (1) the operator's launch-gate sign-off on
this report + ROUND-P-REPORT.md; (2) the real-data pilot decision
(the live-feed integration L1 named — the declared next frontier by
two of three re-polled seats).

*Harvested and recorded by the takeover TL, 2026-10-14 ~15:40Z.
Machine record: ops/round-p/ in the ops vault (transcripts + aggregate).*
