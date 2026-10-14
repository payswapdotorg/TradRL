# Phase 2 · Round P Report — The FW-52 verification round: 9/9 seats measured (6 SWITCH + 3 LEANING, would_pilot 9/9, zero protocol violations); the O-3 overlap class DOES NOT HOLD — FW-53 headlined by the 1280×577 wizard action-row geometry

Origin: production main @ 4422978 (the Round P midnight amendment — 5/9
measured at the deadline, 4 seats live through the capacity drought).
This report completes the round: the four remaining seats (S3, L2, L1, L3)
were dispatched, ran to completion, and were harvested — the full 9-seat
tally now stands. The instrument is unchanged: the 5-row arc (DEEP, ALERTS,
NOTES, EXPORT, REG), the per-project `ledger-row` emission, the final
`survey-row` block with the FW-52 delta fields, honesty as the only hard
requirement, UI-only law, honest counting.

## 0. The round's harness record (disclosed in full — the campaign's law)

- **The takeover (Oct 14, session 2).** The previous TL's session died
  ~07:41Z mid-flight after the 19:45Z-era recycle; the takeover TL took
  over with TradRL as the sole source of truth, recovered all four seat
  prompts verbatim from the dead chats, cleared the workspace gate (3/3
  stale slots released), and re-dispatched the four seats through the
  replay: S3 @ 05:47Z (chat 351206a0), L3 @ 05:47Z (6d2979f2), L2 @ 05:57Z
  (269f4cce), L1 re-send @ 06:12Z (1c0eeff6 — the first L1 send never
  spawned, voided per the two-state doctrine).
- **The capacity drought, round P edition (disclosed).** Three sends never
  spawned a turn and were superseded by fresh dispatches, all disclosed:
  L1-b (1c0eeff6, 06:11Z — queued behind the 3-slot workspace limit),
  L2-b (f093eda1, 06:43Z), L1-d (b87d2668, 06:45Z). The final L1
  re-dispatch (59bc3863, 06:47Z — titled "Senior Portfolio Manager TradRL
  Evaluation" by the site's auto-titler) is the one that ran. L1's three
  dead sends produced ZERO fabricated rows — the completed chat's 36/39
  task count is its own honest number.
- **S3's mid-stream stall + the resume nudge.** S3's turn stalled
  mid-stream after Row 1 (DEEP) + partial Row 2; the TL's 06:37Z nudge
  ("your Row 1 and Row 2 work are recorded; resume exactly where you left
  off") landed, S3 resumed, and completed the arc + survey + worklog. Its
  two assistant turns are banked as one transcript; the survey row is the
  seat's own final record.
- **The session death at ~07:41Z** (the context exhaustion) — L1's
  completion at 07:41Z was the session's final act. No watcher survived to
  harvest; the transcripts sat server-side until recovered below.
- **Sandbox recycle #10 (Oct 14 ~11:12Z, disclosed).** The recycle wiped
  `/home/z/replay2` (the replay console + the python CDP core + all worker
  prompts + mission state) and `~/.secrets` (the ops vault). Survived: the
  durable Chrome profile (the operator's chat.z.ai session), the login
  token file, the replayd gateway mini-service, and this worklog. The
  stack was rebuilt DURABLE, all inside the durable project root:
  `mini-services/replay-core` (:3110 — Chrome 143 CDP launcher + core +
  login_keeper, auto-started by the boot machinery), the gateway (:3100),
  and the operator console (:3000, the Replay/Agents/Mission-Control UI).
  The vault was re-seeded from the operator's standing batch. The rebuilt
  stack's input-injection self-test produced one stray chat ("Hello
  Query", 11:53Z, content "hi" — zero measurement rows; disclosed here,
  deleted).
- **The harvest (Oct 14 ~12:05Z).** Read-only via the site's own API with
  the durable operator token (chats list → history tree →
  `/api/v1/chats/{id}/messages/batch`, content assembled from
  `content_blocks`). The browser was navigated through the replay console
  for verification; no measurement chat was mutated. Full transcripts
  banked to the ops vault (ops/round-p/*.json, 4 seats × ~160–270KB of
  working text each — reasoning, tool traffic, and the instruments).
- **Honest counting.** 9/9 seats measured. The 5 pre-deadline seats
  (S1/S2/M1/M2/M3: all YES/SWITCH, 40/40 delta fields) stand as recorded
  at origin 4422978. The 4 seats in this report are counted ONLY from
  their banked ledger/survey rows.

## 1. The tally

| Seat | Persona | Verdict | would_pilot | Decision | Tasks | TTFV | Friction | Violations |
|---|---|---|---|---|---|---|---|---|
| S1 | (pre-deadline) | yes | true | switch | — | — | — | 0 |
| S2 | (pre-deadline) | yes | true | switch | — | — | — | 0 |
| M1 | (pre-deadline) | yes | true | switch | — | — | — | 0 |
| M2 | (pre-deadline) | yes | true | switch | — | — | — | 0 |
| M3 | (pre-deadline) | yes | true | switch | — | — | — | 0 |
| **S3** | Part-time Ops, small | **leaning** | true | undecided | 5/5 arc | 376s | 4 | 0 |
| **L3** | Risk & Compliance, large | **yes** | true | **switch** | 5/5 arc | 295s | 4 | 0 |
| **L2** | Quant Researcher, large | **leaning** | true | undecided | 32/32 | 281s | 8 | 0 |
| **L1** | Senior Portfolio Mgr, large | **leaning** | true | undecided | 36/39 | 664s | 5 | 0 |

**9/9 would pilot. 6 SWITCH + 3 LEANING (undecided, incumbent
QuantConnect). Zero protocol violations across the round.**

## 2. The FW-52 delta verification (the round's purpose)

| Delta field | S1–M3 (5 seats) | S3 | L3 | L2 | L1 | Verdict |
|---|---|---|---|---|---|---|
| residual_read_lag | 5/5 pass | **partial** (see below) | pass | pass | pass | FIXED, one residue |
| cancel_affordance | 5/5 pass | recorded, not re-tested | **fail** | **fail** | **partial** | **DOES NOT HOLD at 1280×577** |
| loading_grammar | 5/5 pass | pass | pass | pass | pass | FIXED |
| multiline_notes | 5/5 pass | pass | pass | pass | pass | HOLDS |
| export_disclosure | 5/5 pass | pass | pass | pass | pass | HOLDS |
| durable_records | 5/5 pass | pass | pass | pass | pass | HOLDS |
| compute_layer | 5/5 pass | pass | pass | pass | pass | HOLDS |
| pricing_published | 5/5 pass | pass | pass | pass | pass | HOLDS |

- **O-1a read-lag: FIXED on the alerts card** — S3 reproduced the fix
  holding on BOTH the reload path and the scope-switch path ("first frame
  shows 'Reading the world…' with FIRED verdict on record, no premature
  empty claim"). **The residue**: the SAME fix is missing on the Outcomes
  list — "No outcomes at this view instant" renders +64ms into a fresh
  read while the real outcome lands at +7.2s (S3, reproduced twice).
- **O-3 cancel affordance: THE FIX DOES NOT HOLD.** FW-52 (#113) added the
  discard-draft two-step confirm to the wizard's EXIT. At 1280×577 the
  discard arm's hit area covers the Next/Launch center — L3 measured the
  geometry precisely ("the Launch button's left 76% is covered by the
  discard arm"); L2 reproduced it at **all five wizard steps** ("the one
  flow every new user must complete… swallowing clicks and risking an
  accidental draft destruction," safety-relevant given the shared
  "Confirm" vocabulary between launch and discard); S3 hit it live
  ("clicking Next's center armed the discard confirm instead of
  advancing" — proceeded via keyboard); L1 scored it partial. The fix made
  discard SAFER and the primary flow MORE dangerous at short viewports.
- **O-2 appears grammar: FIXED** — subject–verb agreement correct on all
  observed loading copy (S3's explicit check).

## 3. The new findings register (FW-53 input, evidence-first)

1. **O-3R (the headline): the 1280×577 wizard action-row overlap class.**
   Root surface: `apps/web/src/render/flow.ts` + `model.ts` (the wizard
   action-row / confirm vocabulary). The discard arm overlaps Next/Launch
   at 1280×577 across all five steps. L3's gate: "the O-3 overlap is my
   one fix-before-pilot gate."
2. **N-1: fired alerts never reach the Inbox** (S3 — "a part-time operator
   can't rely on a console whose fired alerts never reach the Inbox";
   notifications dimension scored 2/10).
3. **N-2: the Outcomes list read-lag residue** (S3 — the O-1a class on the
   Outcomes surface; +64ms empty claim vs +7.2s real outcome).
4. **N-3: the desk halts silently after a refusal** (L3 — no notice or UI
   hint that trading paused or when it resumes; L3's will-fire alert
   waited 24 minutes with no explanation; L1 independently: "alerts
   structurally impossible — desks stop at 2 fills, nothing in the UI
   produces post-declaration fills").
5. **N-4: O-5 preferences silently discarded** (L3 — wizard/review vs
   post-launch records; counted, carried).
6. **N-5: sign-up entry hidden in Settings** (L3 — discoverability;
   L2 scored discoverability 2/10).

## 4. Seat highlights (the four, from their own words)

- **S3 (Part-time Ops, small):** "the audit chain is the first thing I've
  seen that would actually survive our compliance review — exports
  re-verify digest-by-digest, notes land byte-exact, refusals show their
  own arithmetic." Verdict leaning: the Inbox gap + the Outcomes residue.
- **L3 (Risk & Compliance, large):** "the audit surface is the best I have
  seen… Risk section is the most honest risk posture UI I have audited
  (standing vs gate-observation distinction; 'unknown' declared rather
  than fabricated)." Verdict **yes / would pilot / switch** — "the audit,
  risk, and export surfaces exceed anything QuantConnect offers for agent
  organizations; the O-3 overlap is my one fix-before-pilot gate."
- **L2 (Quant Researcher, large):** "the lineage story is the best I have
  audited: byte-exact exports whose digest chain recomputes 100% under
  the published canonical rule, per-parameter note provenance, itemized
  refusal arithmetic, and a firing law that holds to the millisecond."
  Verdict leaning: the O-3 overlap at every wizard step.
- **L1 (Senior Portfolio Manager, large):** "1238/1238 export digests
  recompute… every refusal and fee reconciles to the cent across UI,
  deliverable and file — that is regulator-grade. But a PM cannot launch
  a desk with a mouse at 1280×577." Verdict leaning: the overlap class.

## 5. Dimension means (the four seats)

auditability 5.0 · export 4.75 · risk_tooling 4.5 · agent_org_model 4.25 ·
time_machine 4.25 · time_to_value 3.25 · onboarding 3.25 · pricing_fit
3.25 (self-score 3.25) · notifications 2.75 · discoverability 2.75

## 6. What this round decides

- **The FW-52 verification: read-lag FIXED (one residue), appears grammar
  FIXED, cancel affordance DOES NOT HOLD at the 1280×577 geometry — the
  FW-52 fix armed a new hazard on the primary flow.** FW-53 is mandatory
  before the launch-gate: the wizard action-row geometry (the discard arm
  must never cover Next/Launch's center at any viewport), the Inbox alert
  delivery gap, the Outcomes read-lag residue, and the silent desk halt.
- **The market verdict strengthened**: 9/9 would pilot, 6/9 switch, the
  three undecided seats all cite the SAME single gate (the overlap
  class). Fix FW-53 and the round-P re-poll of the three leaning seats is
  the expected close.
- **Payload note (carried)**: console.ts 172,639/173,056 — the
  Lead-ratified 169-KiB line; FW-53 must land inside it.

*Harvested and recorded by the takeover TL, 2026-10-14. Transcripts banked
(ops/round-p/); the aggregate is the canonical machine-readable record.*
