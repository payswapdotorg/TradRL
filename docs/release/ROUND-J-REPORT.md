# Phase 2 · Round J Report — The seam-wave re-verification (FW-41 origin, the fresh store)

Origin: production main @ 39c16b1 (FW-41-A #93 + FW-41-B #92 + FW-41-C #94),
deployed dpl_AC85s97H on the FRESH durable store (tradrl-durable-fresh —
the Neon quota incident resolved by migration; the demo world self-seeds).
9/9 personas surveyed (fifth re-evaluation), 58 ledger rows, UI-only law,
honest counting, write-early. All waves single-worker clean except none —
every persona completed in one worker this round.

## 1. The headline

| | yes | leaning | no | would_pilot |
|---|---|---|---|---|
| Round H | 0 | 8 | 1 | — |
| Round I | 0 | 8 (firmer) | 1 | 9/9 |
| **Round J** | **0** | **8 (7 firmer, 1 held)** | **1 (M3, product-scope only)** | **9/9** |

The arc: E 0/2/7 → F 0/2/7 → G 0/6/3 → H 0/8/1 → I 0/8/1 → **J 0/8/1**.
The composition of the leaning is now decisively PRODUCT-SCOPE, not defect-
scope: every persona names the same short list for the first YES.

## 2. THE ADOPT SEAM'S DEATH CERTIFICATE (I-1 — the 9/9 Round I headline)

**DEAD — 7 pass + 2 partial (the partials are one display defect, J-1).**
Every persona ran the full journey (register → launch signed-in → sign-out →
sign-in):
- The waiting-to-adopt list never un-adopts a desk again (Round I: every
  desk came back un-adopted, 9/9).
- The export chains prove the server-side persistence: `project-adopted`
  events actor-stamped at LAUNCH (0.5-1.5s after each submit, every desk),
  idempotent on the re-adopt click ("already yours — adopted before this
  visit").
- The false "Accounts are not available" wrapper appeared NOWHERE (9/9);
  the signed-in card never collapsed (9/9); the wrong-passphrase typed
  refusal verbatim (9/9).
- **The J-1 residue (9/9):** the sign-in ceremony's waiting list still
  RENDERS an "Adopt this desk" button for already-adopted desks until one
  click (which answers "already yours") — the display does not read the
  server-side adoption state; after a plain reload the card reads correctly.

## 3. THE I-9 RESOLUTION (the cross-browser desk list — the measurement story)

**The account scope is REAL — the pure test passes 6/6; the 3 fails were a
same-session measurement blind spot.** Six personas (M2, M3, L2, S1, M1,
L1) ran the PURE test (clear localStorage → reload → sign in with the same
account on the wiped context): the Settings switcher listed their desks
(every one, plus the demo), switching loaded the REAL desk (goal,
constraints, true horizon), and Oversight counted them on a zero-launch
session. M3's six desks, M2's, L2's six, L1's five — all found again. The
three FAILs (L3, S2, S3) tested from the same-session state and saw only
the demo — a methodology split the pure test resolves: the desks DO follow
the account. THE RESIDUE: the copy-lag — every surface still says "your
session's own projects/desks" while BEHAVING account-scoped (6/6 noted);
one redundant adopt click on the same-session path (J-1).

## 4. Round J register (the FW-42 work list)

**NEW/SHARPENED this round:**
- **I-4 (THE lying record — now the top defect):** the deliverable's
  launch-world composition race, RECURRED on the fresh store (2 hits / ~47
  launches): L3's draft-restored D1 (the deliverable read "no launch world
  on record" while the export CARRIED the record — the read raced) and
  M2's clean-launch F2 (the export corroborates: NO launchWorld record at
  all, job-result markets/venues [] — the WRITE raced). 7 no-observations
  (including S1's exact-Shape re-test of their Round I hit and the
  draft-restored path twice). M2's words: "a deliverable saying 'no launch
  world on record' while the record sits one drawer away is a lying
  record." The race is in the launch-world WRITE/READ seam (the PR #94
  diagnosis + this round's two shapes).
- **J-1 (the ceremony display defect — 9/9):** the waiting list re-offers
  already-adopted desks until one click (which answers "already yours");
  a plain reload renders the correct state. The list does not read the
  server-side adoption state at sign-in render time.
- **I-3b (the reload-path hydration marker — 8 partial + 1 pass):** on a
  COMPILED desk, the reload window teaches the bare "Not compiled yet"
  (the honest-empty wording, misstating a compiled desk) for ~3-8.5s
  before the late "Reading the world…" marker arrives (M2's quantification:
  7.7-8.5s bare, marker at ~9-10s, healed ~12.4s; one run: no marker in a
  9s window). The launch/switch path is prompt.
- **J-2 (the stale post-launch draft — 1 hit (M2), no recurrence (S1's
  deliberate 6s-pause probe)):** a draft snapshot saved ~6s before confirm
  survived the launch and restores on every scope open — a double-launch
  hazard.
- **J-3 (minor):** the prj-demo-console flash on the Project line during
  reload (L2).
- **The copy-lag (6/6 pure testers):** "your session's own projects/desks"
  everywhere while the behavior is account-scoped — the copy undersells
  the fix.

**Carried (unchanged):** **E-7 (pricing unpublished — now on EVERY
persona's YES-gate list; L1: "a large fund cannot procure an unbudgeted
seat")**; **M1/L1's Oversight wishlist** (drill-through, P&L/net-exposure,
cross-desk aggregate — all still absent, DOM-verified twice this round;
"a census, not yet a PM cockpit"); **E-6 (the closed research world — M3's
decisive NO, re-proved on all six seams; "a build, not a fix")**; E-3;
F-12 (zero derived statistics); the D-1 timeout raise.

**DEAD this round (verified from the seats):** I-5 (the deep compile
stall — 0/9 recurrence on the fresh store; S1's Round I stall + this
round = the Neon-quota hypothesis holds); the I-2 select residual (9/9
pass — "simulation" displayed, surviving beats AND the draft reload);
the I-3a post-launch instant (9/9 pass — "Viewing the live world" + the
research job visible immediately); I-6 (zero "one day" residue, 9/9);
I-8 (the next-launch entry inside the launched scope — the Round I
detour gone, M1/L1 confirmed); the H-series (spot-verified throughout);
the wizard laws + the draft persistence (9/9 regression-clean).

## 5. Conclusion + the next wave (FW-42)

The seam wave CLOSED the identity arc: adoption persists server-side,
survives sign-out/sign-in, and the desks are findable from any browser
(the pure test, 6/6). The measurement now stands at 0/8/1 with every
leaning persona naming the SAME short list for the first YES. FW-42
targets the register's defect half: **I-4 (the launch-world composition
race — the lying record, THE top defect)**, **J-1 (the ceremony display
reading the adoption state)**, **I-3b (the reload-path marker)**, J-2
(the stale-draft hazard), J-3 + the copy-lag (the minors). The product
half — E-7 (publish the price), M1/L1's Oversight cockpit, E-6 (the
research world) — is the operator's build decision, and the committee's
first YES vote now visibly waits on it: the defect list is one wave deep,
the product list is three items long.
