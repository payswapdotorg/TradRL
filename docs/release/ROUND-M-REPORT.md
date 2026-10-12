# Phase 2 · Round M Report — The YES-vote round measured: the FIRST UNANIMOUS LEANING (0/9/0); the YES waits on the operator's price list + one durability wave

> **POST-ROLLBACK RESTORATION NOTE (the R-0 worker, 2026-10-12):** the
> original report (written by the Lead ~18:20 UTC 2026-10-11 and committed as
> the Round M state commit 4a8cc7e) was destroyed in rollback #5 — the 04:22
> UTC 2026-10-12 re-clone reverted the repository to e9b4a33, losing
> e9b4a33..36b1b31. This file is the R-0 reconstruction: every figure traces
> to the surviving raw record — `phase2-ledger.jsonl` (67 `P2M-*` rows,
> re-counted this session), `phase2-survey.jsonl` (9 `P2M-*` rows), the
> restored Round M instrument, and the campaign worklog (the per-seat entries
> + the Lead's canonical tally in LEAD-P2M-WATCH-2). Divergences are
> disclosed, never papered over: (1) the R-0 dispatch brief said "41" ledger
> rows — the surviving ledger holds **67**, the count the canonical tally
> itself records ("67 ledger rows") and the nine seats' own row counts sum to
> (5+2+9+8+8+9+8+8+10); (2) the §3 incumbent-column means are carried exactly
> as recorded in the canonical tally — recomputed from the raw survey rows
> they differ on 8 of 10 cells (footnoted there), while the TradRL column
> reproduces exactly and the verdict (9/10 dimensions won, pricing_fit the
> only loss) holds under both.

Origin: production main @ e9b4a33 (FW-44-A #100 + FW-45 #101 + FW-46 #102 +
the two conscious payload raises 1200/1232 KiB), deployed
tradrl-console-81qb8fafu (https://tradrl-console.vercel.app). 9/9 personas
(eighth re-evaluation), 67 ledger rows, UI-only law, honest counting — with
the round's harness events disclosed: THREE continuation seats (S2, S3, L2 —
worker deaths mid-measurement, each takeover and its inherited artifacts
disclosed in that seat's worklog entry) and the mid-round workspace rollback
#4 (16:07 UTC; detected by the S2 continuation seat, recovered by the Lead —
the instrument restored verbatim, M3's 2 ledger rows + survey row and S2's 5
ledger rows restored with honest markers, nothing double-counted).

## 1. The headline

| | yes | leaning | no | would_pilot | fw46_overall |
|---|---|---|---|---|---|
| Round L | 0 | 8 (most "at the edge") | 1 (M3, E-6 + pricing) | 9/9 | 9/9 pass |
| **Round M** | **0** | **9 (THE FIRST UNANIMOUS)** | **0** | **9/9** | **9/9 partial** |

The arc: E 0/2/7 → F 0/2/7 → G 0/6/3 → H 0/8/1 → I 0/8/1 → J 0/8/1 →
K 0/8/1 → L 0/8/1 → **M 0/9/0**. M3 — NO since Round E, the lone NO since
Round H — **flipped NO → LEANING**: the first unanimous leaning of the campaign, on the
round the instrument framed as the YES-vote round ("with E-6's decisive
seams and S2's market surface now built, your verdict turns on what remains
from YOUR seat").

The method (the Round M instrument, itself restored verbatim after rollback
#4): the same 9 professionals, the F base instrument extended G→L, plus four
Round M delta fields — `read_absence_fold` (FW-44-A), `notes_ingestion`
(FW-45: the boundary teaching + the attach flow + the notes reaching the
chain), `market_surface` (FW-46: the chart + the live snapshot + the alerts),
`fw46_overall` — with the origin's KNOWN DEFECTS (the notes/alerts
durability, the alert-fired chain event, the org pill) re-verified from every
seat and scored honestly. E-7 pricing was read verbatim twice from every
seat; every seat recorded it UNPUBLISHED ("This is a pilot: access is free
while the pilot runs, no payment is collected, and commercial pricing has not
been published yet — this card will carry the real numbers the day they
exist." / "commercial pricing: not published yet"). Aggregate, reconciled
this session against the ledger rows and exact: **67 ledger rows, tasks
335/341 (98.2%), 39 friction events, 0 protocol violations.**

## 2. The named builds verified from the nine seats

**FW-45 — the notes REACH THE CHAIN (M3's decisive seams (a)+(e), ANSWERED).**
M3's marker re-test passed decisively: **17 occurrences of each fresh marker
in the export (Round L: ZERO of eleven needles in 2.19MB)**, the verbatim
text IN the note-attached events at the notes' OWN attachedAt, the
deliverable's provenance naming the notes, the manifest's record-families
disclosure naming them. The wizard's Data-sources hint now TEACHES both
vocabularies verbatim (seam (a)); the typed validation gate failed closed on
both arms from every seat ("title: the note title is required (1..120
characters — the note's own name)"; "text: the note text is required (paste
the note — this deployment stores it verbatim and fetches nothing)"). M3's
own words for the flip: "my marker strings — ZERO occurrences for seven
rounds — now appear 17 times each in the export chain, verbatim, at the
notes' own instants: the analyst's research finally REACHES the record."
**The honest remaining seam, disclosed and scored:** nothing yet COMPUTES
over the note text (the deeper E-6 world) — M3's flip carries it as a named
second condition ("the day the compute layer reads my notes' numbers AND
pricing publishes sanely for a research seat, my verdict flips to YES").

**FW-46 — the market surface LANDED (S2's decisive item).** The market view
charts EXACTLY the desk's own fill prices per instrument at their own
filledAt instants (L4-projected; a sparse series stays sparse AND SAYS SO —
"N price observations on record for <market> — the desk's own fill prices at
their own instants; the chart plots exactly what exists, never a fabricated
series"; an empty market says "No prices on record for <market> yet"); the
live-snapshot boundary is taught verbatim ("SIMULATED market data: no live
feed exists in this deployment ... 'Live' is this console's own refreshed
snapshot of the simulated records on file (Refresh re-reads)"); the
price-alert class carries the typed gate and fires ONLY on recorded prices.
**The FIRED verdict was verified at the observed fill's OWN filledAt to the
millisecond from 5 seats** — S2 ("fx below 6001 — FIRED at
2026-10-11T15:29:02.384Z against the recorded price 3000"), S1 ("fx above
1" at 16:53:25.977Z, export-verified), S3 ("fx below 700" at 17:37:51.849Z),
L3 ("fx below 200000" at 18:01:19.877Z), L2 ("fx above 1" at 18:06:37.378Z)
— never the venue instant, never the declaredAt, never the refresh clock;
waiting alerts honestly stayed waiting (forward-only is the actual law). S2's
verdict on its own Round L quote ("Market World is the persisted launch
spec, not a market view"): the quote is retired — "it IS a market view of MY
book, honestly bounded ... TradingView keeps the tape, TradRL keeps the
record."

**FW-44-A — held (no fabricated zeros).** Zero defects across the round:
every unconfirmed read folds to "unknown — no fill-derived number on file" /
"unknown — no standing read on record"; gate observations quarantined
verbatim ("the refused candidate's projection (what the gate last refused),
never the standing book"); served reads disclosed as a labeled distinct
source; the L4-withhold line captured verbatim ("withheld — observed at ...
after this view instant (L4; never rendered before its observed instant)").
Every seat re-verified the roll-up with its OWN arithmetic at an atomic view
instant — S2 69192.975; M1 67596.975 (6 cards); L1 66511.725; M2 66935.775;
S1 66419.175; S3 66375.075; L3 80266222.575 (the institutional 250M book);
L2 70126.725 — every family the exact-decimal sum of the cards, the honest
P&L basis verbatim on every card ("NOT a market P&L: no mark-to-market
exists").

**Per-seat ledger/survey reconciliation** (the ledger rows' own counts —
they sum exactly to the aggregate above; the three seats whose worklog stage
summaries phrased narrower sub-task counts (M1 33/35, L1 33/36, S1 38/40)
are counted by the ledger, the canonical counter):

| seat | persona (incumbent) | rows | tasks | friction | verdict |
|---|---|---|---|---|---|
| S2 | senior trader, 2-person boutique (TradingView) | 5 | 16/16 | 0 | leaning / undecided / pilot TRUE |
| M3 | the research seat, mid-size asset manager (QuantConnect) | 2 | 16/16 | 1 | leaning — **the NO→LEANING flip** |
| M1 | Head of Trading, ~12-desk asset manager (QuantConnect) | 9 | 38/39 | 5 | leaning / undecided / pilot TRUE |
| L1 | Senior Portfolio Manager, institution 1000+ (QuantConnect) | 8 | 36/38 | 1 | leaning / undecided / pilot TRUE |
| M2 | desk head, 100–1000-staff asset manager (QuantConnect) | 8 | 38/39 | 3 | leaning / undecided / pilot TRUE |
| S1 | Founder/Trader, 2-person prop shop (QuantConnect) | 9 | 44/45 | 5 | leaning / undecided / pilot TRUE |
| S3 | part-time Operations, <100-staff company (QuantConnect) | 8 | 47/47 | 4 | leaning / undecided / pilot TRUE |
| L3 | Risk & Compliance Officer, enterprise 1000+ (QuantConnect) | 8 | 52/52 | 7 | leaning / undecided / pilot TRUE |
| L2 | Quant Researcher, enterprise 1000+ (QuantConnect) | 10 | 48/49 | 13 | leaning / undecided / pilot TRUE |

Per-seat findings (the survey's own top_friction, condensed; every seat's #1
friction is ONE defect class — M-1, the evaporating note/alert record
classes):

- **S2:** the evaporating record class — alerts/notes reach the live chain at
  their own instants (six exports re-verified head-exact from the file alone,
  incl. a 1,696-entry chain) then vanish on the backend drop/reload; the
  32-second-old re-attach lost; the deliverable still citing lost events.
  Delight: the market view's zero-fabrication arithmetic + the honest
  alert-firing at the fill's own instant.
- **M3:** the compute layer still reads nothing I ingest — my notes reach the
  chain verbatim but no research compute runs over them (the deeper E-6
  world), and pricing remains unpublished. Delight: the markers finally
  reach the record (17× each). Friction event: the org-pill leak (M-5, its
  original finder).
- **M1:** the evaporating alert/note classes — declared and listed live with
  their own instants, gone across a single reload while the copy claims they
  "ride this project's export chain". Delight: the oversight roll-up's
  exact-decimal honesty across six desks + both chains head-exact.
- **L1:** the same evaporating record class — "an audit-integrity seam under
  an otherwise flawless chain" (13 unknown-folds in one frame; the roll-up
  reconciled bit-for-bit). Delight: the P&L basis that "refuses to print a
  number it cannot derive".
- **M2:** the evaporating classes, cited by the persisted deliverable — the
  Round L EMPTY product list repopulated by the durability defects. Delight:
  the markers ride the live export verbatim at their own attachedAt.
- **S1:** the FIRED verdict itself vanished after one refresh (the sharpest
  form). Delight: the market view + the alert fired at the observed fill's
  own filledAt, export-verified.
- **S3:** the note/alert classes evaporate on EVERY reload — "my Monday note
  and my standing alert vanishing on the first browser restart (the FIRED
  verdict included) is the resume-ability breaker". Delight: core
  resume-ability by design (scope, account, inbox read-state, fill history
  survive; Home's TODAY timeline).
- **L3:** the evaporating classes + the persisted deliverable citing
  unrecoverable text — "a books-and-records deficiency" in the compliance
  seat's language. Delight: the export chain from the file alone (four heads
  exact) + the in-UI verifier. L3 also found M-6 (the Preferences silent
  no-op).
- **L2:** the record layer above the verifiable chain is unstable — the
  deliverable's notes provenance names evaporated notes and omits live ones,
  mutating across a reload (2 → 3 refs); the direct-submit job's own
  completedAt moved between two chain-valid exports. Delight: five exports
  head-exact with its own verifier + the full lineage trace recomputed
  end-to-end.

## 3. The main-interface verdict and the dimension scores

9/9 LEANING, 9/9 UNDECIDED, 9/9 would_pilot TRUE. Incumbents: QuantConnect
dominant (8 seats), TradingView (S2). Dimension means (1–5, the canonical
tally as recorded at the 18:15 UTC count; **bold** = the round's winner):

| dimension | TradRL | incumbent |
|---|---|---|
| onboarding | **4.89** | 3.50 |
| time_to_value | **5.00** | 3.33 |
| agent_org_model | **4.67** | 1.00 |
| auditability | **4.89** | 2.17 |
| risk_tooling | **4.67** | 2.67 |
| time_machine | **4.89** | 2.33 |
| notifications | **3.89** | 2.83 |
| export | **5.00** | 3.00 |
| discoverability | **4.33** | 3.67 |
| pricing_fit | 2.67 | **4.17** |

**TradRL beats the incumbent on 9/10 dimensions; the ONLY loss is pricing_fit
(E-7 unpublished — an operator decision, not an engineering one).**

Restoration footnote (the R-0 worker): the TradRL column reproduces exactly
from the raw survey rows (44/45, 45/45, 42/45, 44/45, 42/45, 44/45, 35/45,
45/45, 24/45, 39/45). The incumbent column as recomputed from the same rows
yields onboarding 3.22, time_to_value 3.11, agent_org_model 1.00,
auditability 2.22, risk_tooling 2.78, time_machine 2.11, notifications 2.56,
export 3.00, discoverability 3.56, pricing_fit 3.89 — differing from the
recorded tally on 8 cells while preserving the same verdict on every
dimension (per-seat, TradRL wins or ties every dimension except pricing_fit:
0 wins there — 8 losses and 1 tie). Both computations are preserved here;
the canonical record's numbers stand.

Round M delta fields (the instrument's four verdict fields, from the survey
rows):

- `read_absence_fold` (FW-44-A): **6 pass / 3 partial** — the partials are
  the org-pill leak's seats (L1, L3, M3).
- `notes_ingestion` (FW-45): **1 pass (M3) / 8 partial** — the boundary
  teaching, the fail-closed typed gate, and the verbatim note-attached chain
  events pass everywhere; the record-class durability fails everywhere
  except M3's pre-rollback live session.
- `market_surface` (FW-46): **9 partial** — the chart, the sparse-honest law,
  the live-snapshot teaching, and the fired-instant law pass; the alert
  record class evaporates on reload from every seat.
- `fw46_overall`: **9 partial.**

## 4. Round M register (as measured, BEFORE any fix)

- **M-1 — the evaporating note/alert record classes (every seat's #1
  friction).** The FW-45/FW-46 record classes do not survive a backend drop
  or a page reload while the card copy claims each "is stored on this
  project's own record and rides its export chain": the S2 continuation
  seat's forensics (3 alert-declared + 1 note-attached on the live export at
  15:40 → ZERO in every post-drop export at 15:43/15:45/16:02/16:03; a
  32-second-old re-attach lost at a page reload); M1 (two alerts declared
  16:33:00.008Z/16:33:11.554Z gone after one reload — zero alert-declared
  entries and zero level strings in the post-reload export — while the
  chart of the same fills survived); M2, L1 (the derived prefix drops 8 → 7
  post-reload), S1 (the FIRED verdict itself evaporated; the derived record
  prefix never included note-attached/alert-declared even live), S3, L3, L2
  (workspace.notes [] / workspace.alerts [] post-reload). The core records
  (fills, jobs, deliverables, goal, constraints, org-snapshots) DO survive
  the same events — the loss is specific to the two record classes.
- **M-2 — the citation residue (deliverable provenance drift).** The
  persisted deliverable still cites the lost note-attached events: L3's
  sharpest form — the deliverable of job:5873e9af still names note:559573f9
  with the statement "their verbatim text lives on this project's goal-set
  record and in the workspace export's note-attached events" while the
  post-reload export carries zero note-attached events and the goal-set
  record carries no notes field ("a citation to evidence that no longer
  exists" — an examiner finds nothing); L2's drift shape — job:1f17eb50's
  notes block named the two EVAPORATED notes while omitting the live note
  attached 22s before completion, then GREW to count 3 post-reload citing a
  note whose text exists nowhere in that file (two chain-valid exports of
  the same scope attesting different content). Also carried: the
  deliverable's notes/alerts blocks stay count 0 for post-completion
  attachments (composed at completion — a point-in-time record, recorded as
  a nuance, not a defect).
- **M-3 — the direct-submit job record instability.** The same job's
  completedAt MOVED between two chain-valid exports (L2: 17:57:58.371Z →
  18:00:46.991Z; the UI's elapsed display 08s → 02m 56s) — a warm instance
  that had learned the job non-terminally re-derives it at the request
  clock. The launch deliverables are stable across the same reload; the
  instability is specific to the direct-submit job class.
- **M-4 — the alert-fired chain event (session variance; never survives a
  reload).** Zero alert-fired entries in S2's six exports (one taken 11
  minutes after the firing), S1's three (re-checked, including the F4 live
  export of the desk whose alert fired), and L3's live export (the 2 raw
  strings are the manifest's rule-text; alert-declared rode only session
  entries; workspace.alerts [] even live) — while S3's live export carries
  the derived alert-fired at seq 15 and L2's at seq 14 (stamped at the
  observed fill's own filledAt with observedPrice verbatim). Register
  amendment (S3/L3): "exists in some live sessions, never survives a
  reload" — a nondeterministic record path, itself a control finding.
- **M-5 — the Oversight org pill is not view-instant projected (the FW-44-A
  fold family's leak).** A scrub inside the ~1s window between a desk's
  project-record creation and its org-snapshot record renders the pill
  "active" / "organization status active" where the register's third literal
  "org status unknown" belongs. M3's finding (the pre-rollback origin),
  reproduced with export-verified timing from M1 (16:24:05.800Z between
  16:24:05.355 and 16:24:06.337), M2 (586ms before the snapshot), S1 (F4
  window 16:52:25.727 → 16:52:27.059), S3 (twice), L3 (18:00:20.100Z inside
  18:00:19.627 → 18:00:20.573), and L2 (F1 window 17:11:46.060 →
  17:11:47.030) — every OTHER datum honestly L4-projected at the same
  instants; the leak is isolated to the org pill. This is the defect behind
  the three read_absence_fold partials (L1, L3, M3).
- **M-6 — the wizard validation gap (inconsistent validation disclosure).**
  The world-step's "Next: review" SILENTLY NO-OPS when the Preferences field
  holds free text that is not key=value pairs — NO validation error rendered
  (unlike the Constraints field, which renders "is malformed" honestly), the
  button stays enabled, ~5 clicks produce nothing; ~4 minutes lost (L3's
  finding, isolated by bisection: constraints cleared → still stuck;
  preferences cleared → advances immediately).
- **THE MINORS (carried, none measured blocking):** duplicate alert-declared
  rows for one alertId (S1's double-submit → 2 chain rows for alert:ecf56eb1
  — 5 alert-declared events for 4 declarations; L2's dead worker's 12s-apart
  duplicate — no dedupe); the waiting-copy imprecision ("no recorded price
  has crossed it yet" renders on declarations whose pre-existing fills HAVE
  crossed the level — forward-only is the actual law; imprecise copy, not a
  fabrication; honest from the seats whose level choices made it true);
  S3's dateless notice rows ("notice rows show time-of-day only with NO
  date" — the W1-era finding still open); Market-World first-frame staleness
  after a project switch (S1: the outgoing project's launch spec rendered
  under "(launch context)" / an empty "No launch context yet" + "No prices on
  record yet" despite fills on file — recovers on re-entry, data never
  lost); the stale-empty Research jobs list on a freshly-switched scope
  until Refresh (M1/M2/L3); "Start the primary flow" absent on Home after
  the first launch (the hero "Describe your goal" is the way back);
  the one stale toast re-fire on a reload (S3); the honest 0.10 → "0.1"
  normalization (M2: Review renders the declared bound 0.10 as "0.1" — same
  value, honest decimal).

## 5. Conclusion

Eight rounds of measurement: 0/2/7 → **0/9/0**, the first unanimous leaning,
would_pilot 9/9 TRUE, every honesty law held under re-verification (no
fabricated zeros anywhere, the export chains head-exact from the file alone
from every seat, the FIRED-instant law at the observed fill's own filledAt
from five seats). **THE COMMITTEE'S MESSAGE is unanimous and precise: the
first-YES distance is no longer engineering — it is the operator's price
list (E-7, still unpublished) and ONE durability wave (FW-47).** EIGHT
standing YES-flip commitments now hold on E-7 (M3 joined: "the day the
compute layer reads my notes' numbers AND pricing publishes sanely for a
research seat, my verdict flips to YES"), every one of them now additionally
carrying the durability condition — M1: "my desk heads' alerts vanishing on
every browser refresh is not deployable past my own desk"; S3: "my Monday
note and my standing alert vanishing on the first browser restart is the
resume-ability breaker"; L1: "published commercial pricing a 1000-person
institution can budget, and note/alert record durability across the restarts
an oversight workflow actually experiences"; L3: "the note/alert record
classes must survive the restarts an enterprise oversight workflow actually
experiences, and no deliverable may cite evidence the system cannot produce
on demand". L2 holds no pricing-flip commitment — its own gates are data
lineage: durable record classes, a stable point-in-time provenance record,
and sanely published pricing. Every product-side YES-flip condition measured
in Round M is on the register: the durability classes (M-1), the citation
residue (M-2), the job-record stability (M-3), the alert-fired chain event
(M-4), the org-pill projection (M-5), the validation disclosure (M-6), and
the compute layer (the E-6 seam §2 carries — M3's second flip condition).

The next waves: **FW-47 (the durability + read-model stability waves) →
Round N (the re-measurement)** — with the operator items standing: the E-7
pricing decision, and the credentials re-export that unblocks the
push/PR/deploy lane.

> **Restoration addendum (2026-10-12):** both operator gates have since
> moved — the credentials were re-exported and verified this session (the
> push/PR/deploy lane is open again), and the operator's 2026-10-12 message
> delegates the necessary decisions to the Lead "in accordance to the
> mission of the product" (the E-7 pricing decision included). The measured
> content of this report is unchanged — it records Round M as measured on
> 2026-10-11, before any fix.
