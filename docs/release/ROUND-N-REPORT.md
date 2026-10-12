# Phase 2 · Round N Report — The YES-vote round re-measured: THE FIRST UNANIMOUS YES (9/9/0, would_pilot 9/9); every standing flip condition honored

Origin: production main @ b814ea1 (the rollback-#5 rebuild lane complete:
FW-47-A #103 the durable note/alert record classes + FW-47-B #104 the
read-model stability + FW-48 #105 the E-6 compute layer + FW-49 #106 the
carried register closed + E-7 #107 the pricing surface PUBLISHED — the
exact-count certification chain 8706 → 8715 → 8727 → 8751 → 8763+1skip,
payload 56 files 1,255,151/1,261,568, console.ts 171,975 byte-for-byte),
deployed tradrl-console-isuug2kmn (https://tradrl-console.vercel.app), the
deploy smoke green (console 200; the PUBLISHED PRICING CARD verified live;
the serverless function alive — the /v1/execution/submissions probe returns
the typed 401 authn boundary). 9/9 personas (ninth re-evaluation), 54 ledger
rows, UI-only law, honest counting — with the round's harness events
disclosed: FOUR continuation seats (M3 and S2, both dead ~09:35–09:40 UTC
after completing their ledgers and before their surveys; M2, dead
~11:11–11:15 after its four ledger rows, before the export verification;
L3, dead at its turn limit ~12:24 mid-export-verification — each takeover
and its inherited artifacts disclosed in that seat's worklog entry, the
ledger rows read back in full and verified first-hand, NO rows added), the
unledgered probe desks disclosed (M3's breach-probe desk prj-13b805a3 — the
'exceeded' arm's owner; L3's alert-fire probe desk prj-89a522f9), and S2's
unlaunched wizard draft — nothing double-counted.

Every figure in this report was recomputed this session with python over
the raw record (the honest-count law): `phase2-survey.jsonl` (9 round-N
rows), `phase2-ledger.jsonl` (54 `P2N-*` rows), the Round N instrument, and
the campaign worklog (the nine seat entries + the Lead's wave/harvest
records). Both task-count computations and the 34-vs-30 friction variance
are disclosed in §3 — never papered over.

## 1. The headline

| | yes | leaning | no | would_pilot | deltas |
|---|---|---|---|---|---|
| Round L | 0 | 8 (most "at the edge") | 1 (M3, E-6 + pricing) | 9/9 | 9/9 pass (fw46) |
| Round M | 0 | 9 (THE FIRST UNANIMOUS) | 0 | 9/9 | 4 fields, all partial |
| **Round N** | **9 (THE FIRST UNANIMOUS YES)** | **0** | **0** | **9/9** | **27/27 pass** |

The arc: E 0/2/7 → F 0/2/7 → G 0/6/3 → H 0/8/1 → I 0/8/1 → J 0/8/1 →
K 0/8/1 → L 0/8/1 → M 0/9/0 (the first unanimous leaning) → **N 9/9/0 (the
first unanimous YES)**. Round M named every seat's flip condition and the
instrument framed this round plainly: "every product-side condition is now
BUILT AND DEPLOYED. This round re-measures with all conditions live: the
YES vote is now entirely in the seats' hands." The seats answered with the
first unanimous YES of the campaign — every standing commitment honored
verbatim, measured as hard as each seat failed it in Round M. The seats'
own words: M3 — "Seven rounds of 'the compute layer reads nothing I ingest'
end in one verifiable job result — the analyst's research now COMPUTES";
S2 — "the verdict that evaporated across a mere page reload in Round M now
survives everything I could throw at it"; S1 — "the sharpest Round M
defect, the one that made the product undeployable past my own desk, is
gone"; M1 — "the other eleven desk heads can have accounts this quarter"
(now WITHOUT the roll-past-my-own-desk precondition); L1 — "the pilot can
start on my own desk and roll to the other desk heads this quarter"; M2 —
"the pilot starts on my own desk and rolls to my desk heads this quarter";
S3 — "that day is today"; L3 — "I would put a supervised desk-level pilot
in production and hand a regulator the export chain".

The method (the Round N instrument, the F base extended G→N): the same 9
professionals, plus three delta fields — `durable_records` (FW-47-A),
`compute_layer` (FW-48), `pricing_published` (E-7) — with the Round M
carry-overs re-verified at their surfaces. E-7 was read verbatim from
every seat against the PUBLISHED model and pricing_fit re-scored against
it. Aggregate, recomputed this session over the raw jsonl: **9 survey rows
— verdicts 9/9 yes / 0 leaning / 0 no; would_pilot 9/9 TRUE; tasks
189/189 (100%); friction 34 (the survey rows — the ledger rows sum 30; the
variance reconciled in §3); 0 protocol violations; TTFV 15–76s (median
57s)**. The ledger's raw task columns read 188/350 — a SCHEMA ARTIFACT,
not incomplete work; both computations are disclosed in §3.

## 2. The named builds verified from the nine seats

**FW-47-A/B — the durable record classes (M-1/M-2/M-4, DEAD in every form
the seats can produce).** The reload survival, the record-prefix events at
the records' OWN instants, and the FIRED verdict at the observed fill's own
filledAt to the millisecond were verified from every seat, file-side and
live at distance (34 export chains re-verified head-exact from the files
alone — every digest recomputing from the 64-zero genesis, every row
simulated:true). THE FIRED VERDICT AT THE OBSERVED FILL'S OWN filledAt, TO
THE MILLISECOND, FROM ALL NINE SEATS — never the venue instant, never the
declaredAt, never the refresh/export clock:

- S2: "crypto below 2000 — FIRED at 2026-10-12T09:27:50.845Z against the
  recorded price 1200 (declared …09:27:40.081Z)" — firing.at
  1791797270845 == the fill's own filledAt (Round M: ZERO alert-fired
  entries in six exports, one taken 11 minutes after the firing).
- M3: "fx below 2000 — FIRED at 2026-10-12T09:25:27.130Z against the
  recorded price 1200 (declared …09:25:04.251Z)" — firing.at
  1791797127130; the never-fire control ("fx above 2001") honestly produced
  ZERO alert-fired entries — forward-only verified in the negative.
- S1: "fx above 1 — FIRED at 2026-10-12T10:32:00.912Z against the recorded
  price 600" — both alerts fired in one frame; both verdicts survive the
  reload; the post-reload export carries 2 alert-declared + 2 alert-fired
  in the 16-entry derived prefix (Round M: the FIRED verdict itself
  evaporated).
- M1: "fx below 1800 — FIRED at 2026-10-12T10:31:51.189Z against the
  recorded price 1200 (declared …10:31:29.870Z)" — firing.at 1791801111189,
  verified in three head-exact chains (289/67/47 entries).
- L1: "fx above 1 — FIRED at 2026-10-12T11:02:46.842Z against the recorded
  price 600 (declared …11:02:23.418Z)" — firing.at 1791802966842 in the
  post-reload export (132/179 entries).
- L2: "fx above 1 — FIRED at 2026-10-12T11:36:20.111Z against the recorded
  price 1200" — firing.at 1791804980111; the post-reload export carries the
  alert-fired chain event (the record class that "never survives a reload"
  at Round M).
- M2: "rates below 1440 — FIRED at 2026-10-12T11:05:24.249Z against the
  recorded price 960 (declared …11:05:22.688Z)" — firing.at 1791803124249,
  re-read live at 48 minutes' distance across the worker's death, reloads,
  and project switches.
- S3: "crypto below 2500 — FIRED at 2026-10-12T11:59:55.927Z against the
  recorded price 900 (declared …11:59:21.863Z)" — firing.at 1791806395927;
  the waiting alert honestly stayed waiting (its D1 level was crossed by a
  fill recorded 2.45s BEFORE the declaration — the seat's own timing race,
  the law held with millisecond precision).
- L3: "fx above 1000 — FIRED at 2026-10-12T12:22:10.646Z against the
  recorded price 120000 (declared …12:21:49.309Z)" — firing.at
  1791807730646, surviving MY OWN reload ~14 minutes after the firing.

The alert-fired derived event — Round M's M-4: "exists in some live
sessions, never survives a reload" — now exists in export chains from
every seat, stamped at the observed fill's own filledAt with
observedPrice verbatim (post-reload exports carry it from S1, M1, L1, L2,
M2, S3, L3; file-side from S2, M3). The reload survival was measured at
distance: S2's notes/alerts at 48 minutes across the worker's death and
two project switches; M2's FIRED verdict at 48 minutes across reloads and
switches; L3's notes ~23 minutes and its FIRED verdict ~14 minutes; M-2's
citation residue DEAD (L3's books-and-records condition — the deliverable
now cites "3 attached research notes … their verbatim text lives … in the
workspace export's note-attached events, which carry it in the chain" and
the files produce exactly that on demand; L2's provenance stable at count
3 naming exactly the attached notes whose verbatim text IS in the same
file — Round M: named evaporated notes, omitted live ones, drifted 2→3);
M-3's completedAt drift DEAD (L2's job:6f841f72 record byte-identical
across three exports spanning 11 minutes and two reloads — completedAt
1791804462059 fixed — Round M: it MOVED 17:57:58.371Z → 18:00:46.991Z
between two chain-valid exports); the double-submit produces exactly ONE
row (verified with deliberate double-clicks from M3, S1, M1, L1, L2, M2 —
Round M's duplicate defect); the honest forward-only waiting copy
verbatim in both directions everywhere ("an alert watches forward from its
own declaration, never the prices already on record" — no retro-fire over
pre-declaration fills from any seat); S3's resume lens in full — the
inbox READ STATE survives the reload AND the sign-out/sign-in round trip
(read notices drop the 'new' chip; export readState readNoticeIds 5 /
unread 0), Home's TODAY timeline teaching where it left off.

**FW-48 — the compute layer reads what the analyst ingests (E-6, answered
— M3's flip condition (a)).** Every seat ran a research job over its own
attached notes and read the SAME three surfaces: THE INPUT SET at the
notes' OWN attachedAt instants with what each contributed ("1 typed
parameter" vs "evidence only" — never fabricated); THE FROM-NOTE
PROVENANCE (each parsed parameter carrying `from note:<id>`); THE
NOTE-DERIVED ANALYSIS — the declared bound tested against the desk's own
booked fills in exact decimals under L20 ("analysis, never enforcement —
the pre-trade gate alone refuses candidates; these rows observe, they
never refuse"), the gate indeed refusing only on the declared constraints.
BOTH arms measured: "within" — S2 (observed 1728), S1 (observed 108), L2
(observed 2700, with the seat's own recomputation 0.15 × 18000 = 2700.00
== observed EXACT), S3 (observed 75); "exceeded" with the offending fill
ITEMIZED by execution id — M1 ("order.notional limit.max 500 … exceeded
(observed 768)", itemized xgs:d2b50f9d), M2 ("… limit.max 400: exceeded
(observed 432)", itemized xgs:3c1078c6), M3's recovered breach-probe desk
("… limit.max 20 … exceeded (observed 27)", itemized xgs:e1225cee — probe
1 at bound 40 honestly read 'within' rather than fabricating a breach, so
the worker re-ran at bound 20), L3 (observed 49999980, itemized
xgs:b879e0cb + xgs:20440343). THE HONEST BOUNDARY held everywhere: the
Round M digest shapes (half-life 6.4d, z-entry 1.8/z-exit 0.4, overlay
correlation 0.62) and every MID-STRING grammar fragment parsed ZERO
parameters (no mid-sentence extraction; M3, S1, S3, L3, and L2's collapsed
multi-line paste attempt) — the whole-line law, taught verbatim at the
paste target at ingestion.

**E-7 — the pricing PUBLISHED (the eight standing commitments' final
condition).** Read verbatim from every seat, stable across scopes and time
(signed-out and signed-in reads hours apart): "What access costs, stated
plainly: learning is free forever — the whole simulated environment
(desks, goals, mandates, the audit chain, exports, oversight). Automation
is $29 per desk per month — live API surfaces, org-level oversight,
priority support — and orgs (the multi-desk seats) get volume pricing on
request." The seats' arithmetic, from their own shapes: M1 (12-desk shop)
— "12 × $29 = $348/mo = $4,176/yr vs the incumbent's firm tiers ($60-100/
mo class per seat → a 12-seat QuantConnect shop runs $720-1,200/mo =
$8,640-14,400/yr) — TradRL automation is roughly one-third to one-half of
the incumbent's team cost, and the learning tier … is FREE FOREVER —
onboarding the other eleven desk heads and every training cohort costs
$0"; L1/L2/L3 (institutional) — "$174/mo for my 6-desk pattern, ~$17.4k/yr
at 50 desks — roughly one-third of QuantConnect firm-tier spend"; M2 —
"$116/mo, every analyst in the shop trains free forever"; S1/S2/S3
(2-person shops) — "$58/mo for both desks" ("comparable to our TradingView
seat spend"; "roughly one QuantConnect firm seat for BOTH desks"). Every
seat re-scored pricing_fit to 4 — held from 5 for the one named
reservation: the org-volume tier is unquantified ("on request").

**FW-49 — S3's minor fixed first-class (the dateless notice rows).**
Verified from its finder's seat on both surfaces: the demo project's
earlier-day notices carry the DATE in their row meta verbatim ("Shadow
degradation … Jul 3 09:46", "Safety intervention … Jul 3 09:48",
"Organization compiled … Jul 3 09:49" — never a bare time-of-day reading
as today's) while today-notices keep the compact same-day form and the
details keep the FULL canonical instant — one law, two surfaces.
Corroborated live from M1, M3, L1, L2, M2, L3.

**The Round M register closed.** M-1 (the evaporating record classes),
M-2 (the citation residue), M-3 (the job-record instability), M-4 (the
alert-fired chain event) — dead above, from every seat; M-5 (the org-pill
leak) — CLOSED with export-verified window timing from seven seats (M3
09:12:20.049→09:12:21.482; S1 10:31:00.662→10:31:01.409; M1
10:25:36.737→10:25:37.433, the 696ms window; L1 11:01:46.592→11:01:47.922;
L2 11:35:19.861→11:35:21.252; M2 11:03:42.493−93ms; L3
12:21:11.814→12:21:11.815): at a pre-snapshot view instant the pill reads
"org status unknown" + "withheld — a status snapshot is on record but
observed at <its own instant>, after this view instant (L4; never rendered
before its observed instant)" — never a leaked "active", while every other
datum L4-projects exactly at the same instant (S3 honestly reported its
own desks' project-record and org-snapshot instants coinciding at the same
millisecond — the window did not materialize from its seat; the fix was
verified first-hand by the others); M-6 (the wizard validation gap) — the
Preferences refusal now fails CLOSED naming the offender and pre-teaching
the grammar verbatim ("Preferences ("<typed text>") are malformed — each
entry is key=value, e.g. rebalance=daily, report=weekly (optional; leave
empty for none)") — verified from M1, L1, L2, L3; the honest residual (the
no-equals free-text shape still silently discards from the goal record —
L3's file-side finding) is carried in §4. The two FW-47-B minors closed:
the duplicate alert-declared rows (one row per alertId everywhere) and
the waiting-copy imprecision (the honest forward-only law, above).

**Per-seat reconciliation** (the SURVEY rows' counts — the instrument's
canonical per-seat counter, one row per persona; the ledger's own columns
are schema-varied, disclosed in §3; continuations marked):

| seat | persona (incumbent) | ledger rows | tasks (survey) | friction (survey) | verdict |
|---|---|---|---|---|---|
| S2 | senior trader, 2-person boutique (TradingView) | 4 | 14/14 | 1 | YES — the two-gate commitment honored |
| M3 | the research seat, 350-person fund (QuantConnect) | 4 | 21/21 | 6 | YES — the two-part condition honored |
| S1 | Founder/Trader, 2-person prop shop (QuantConnect) | 8 | 8/8 | 2 | YES |
| M1 | Head of Trading, ~12-desk asset manager (QuantConnect) | 5 | 34/34 | 6 | YES |
| L1 | Senior Portfolio Manager, institution 1000+ (QuantConnect) | 9 | 59/59 | 3 | YES |
| L2 | Quant Researcher, enterprise 1000+ (QuantConnect) | 10 | 10/10 | 2 | YES — its own data-lineage gates honored |
| M2 | desk head, 100–1000-staff asset manager (QuantConnect) | 4 | 29/29 | 5 | YES |
| S3 | part-time Operations, <100-staff company (QuantConnect) | 6 | 6/6 | 4 | YES — decision: SWITCH |
| L3 | Risk & Compliance Officer, enterprise 1000+ (QuantConnect) | 4 | 8/8 | 5 | YES — decision: SWITCH |

Per-seat findings (the survey rows' own top_friction, condensed; every
seat's #1 friction is ONE of two defect classes — the read-lag class or
the single-line note input — both carried in §4):

- **S2 (continuation):** the settling flash — "for a few seconds after a
  reload or a project switch the read model renders its empty-state copy
  … the flash of the empty-state copy is indistinguishable-at-a-glance
  from Round M's evaporation, and a trader who measured that failure holds
  his breath at it". Delight: "durability I can hand an auditor as a file
  that re-verifies itself".
- **M3 (continuation):** the single-line note input — "the browser strips
  newlines, so a real research note (a grammar line plus free-text digest
  lines in ONE note) cannot be entered by any user, violating the card's
  own 'stored verbatim' promise and forcing me to split one note into two
  to exercise the compute layer end-to-end". Delight: "the compute layer
  finally reads what I ingest … zero fabricated parameters".
- **S1:** the single-line note input (its paste collapsed onto one line;
  "the compute layer then honestly treated the whole thing as
  evidence-only, forcing a split into two notes to get the typed parameter
  at all"). Delight: the FIRED verdict surviving the reload.
- **M1:** the read-lag class — "stale empty states phrased as durable
  claims … a desk head who trusts the text would conclude their records
  are gone; every case settles to exactly what stood, but the words
  promise durability the render does not" (the job list ~10s, the Inbox
  ~6s, a Risk standing read ~15min-until-reload). Delight: both arms of
  the compute analysis + the never-exercisable FIRED path end-to-end
  file-verified.
- **L1:** the settling flash — "during the flash a desk head reads their
  records as gone" (~5-6s after reload/switch/declare). Delight: the
  never-exercisable FIRED path end-to-end on a dedicated probe desk, both
  post-reload exports carrying the record-prefix events.
- **L2:** the single-line note input (its marker note and digest could not
  ride as one note; a dedicated single-line note got the typed parameter).
  Delight: its own full lineage trace recomputed end-to-end — "deliverable
  3375 → fills 2700+675 → digested submission rows at their own filledAt →
  head exact, fee rate 5e-7 consistent".
- **M2 (continuation):** the read-lag class + the degraded-export
  composition seam (its top friction, §4's N-3). Delight: the FIRED
  verdict at the observed fill's own filledAt — "the exact record class
  whose evaporation made the product undeployable past my own desk at
  Round M, measured dead end-to-end from my seat".
- **S3:** the read-lag class — "for exactly those seconds a 2h/week
  operator fears their Monday note has vanished again". Delight: the
  resume lens in full — "the inbox, the resume, and now the durability all
  hold, at $0 to learn and $58/mo to automate my pattern".
- **L3 (continuation):** the read-lag class — "from a compliance seat
  those seconds read as missing books" (hit four times across its reload
  and scope switches). Delight: "the audit spine reconstructs end-to-end
  from the UI and the files alone, and now it survives the restarts".

## 3. The verdict and the dimension scores

**9/9 YES (the first unanimous YES), 0 leaning, 0 no, 0 undecided;
would_pilot 9/9 TRUE.** The recorded decisions: SWITCH (S3, L3 — "I would
put a supervised desk-level pilot in production and hand a regulator the
export chain"); TradRL (M2); "the pilot seat converts" (S2, M3, S1); the
roll-outs named from M1 and L1 ("this quarter", desk-head by desk-head);
would_pilot true (L2). Incumbents: QuantConnect ×8, TradingView (S2).
Dimension means (1–5, recomputed this session from the raw survey rows —
this report's table is the canonical Round N record; **bold** = the
round's winner):

| dimension | TradRL | incumbent |
|---|---|---|
| onboarding | **5.00** | 3.33 |
| time_to_value | **5.00** | 3.22 |
| agent_org | **4.89** | 1.00 |
| auditability | **5.00** | 2.22 |
| risk_tooling | **4.78** | 2.67 |
| time_machine | **5.00** | 2.11 |
| notifications | **4.56** | 2.56 |
| export | **5.00** | 3.00 |
| discoverability | **4.44** | 3.56 |
| pricing_fit | **4.00** | 3.67 |

**TradRL now wins ALL TEN dimensions on means — including pricing_fit
4.00 vs 3.67, the Round M loss (2.67 vs 4.17) now a WIN on the published
model.** The Round M → Round N movers: pricing_fit 2.67 → 4.00;
notifications 3.89 → 4.56; agent_org 4.67 → 4.89; onboarding 4.89 → 5.00;
auditability 4.89 → 5.00; time_machine 4.89 → 5.00; risk_tooling 4.67 →
4.78; discoverability 4.33 → 4.44; time_to_value and export held at 5.00.
Per-seat (vs each seat's own incumbent column): seven seats recorded NO
losing dimension — S1, L1, S3, L3 with 10 outright wins; M1 and M2 with 9
wins + the pricing tie 4-4 ("cheaper in absolute terms for the 12-desk
shape: $348/mo vs $720-1,200/mo"); L2 with 9 wins + a discoverability tie
5-5 — and the two price-leader incumbencies each hold exactly one loss,
pricing_fit 4-vs-5 (S2 vs TradingView: "still the price leader for
charting"; M3 vs QuantConnect: "a 350-person fund's research org runs many
desks at list price until that conversation happens").

Round N delta fields (the instrument's three verdict fields, from the
survey rows): `durable_records` **9/9 pass**; `compute_layer` **9/9
pass**; `pricing_published` **9/9 pass** — **27/27**, with the Round M
carry-overs re-verified at their surfaces (read_absence_fold: the
org-pill fix verified; notes_ingestion: the boundary teaching + the
fail-closed gate + the verbatim chain events; market_surface: the chart +
the sparse-honest law + the live-snapshot teaching + the fired-instant
law). **pricing_fit is 4.0 UNIFORM — every seat moved 2-or-3 → 4 on the
published model.**

**THE TASK-COUNT DISCLOSURE (both computations, the R-0 precedent — never
papered over):**

- **The SURVEY rows** (the instrument's canonical per-seat counter, one
  row per persona per the schema law, `tasks_total`/`tasks_completed`
  carried in the survey row itself): **189/189 tasks (100%), 0 protocol
  violations, friction 34, TTFV 15–76s (median 57s)** — per seat: S2 14/14,
  M3 21/21, S1 8/8, M1 34/34, L1 59/59, L2 10/10, M2 29/29, S3 6/6, L3
  8/8.
- **The LEDGER rows** (54, write-early per project): the raw column sums
  read **188/350 (53.7%)** — a SCHEMA ARTIFACT, not incomplete work. The
  L1 rows (9) and L2 rows (10) OMIT `tasks_completed` entirely (the field
  missing — 19 of 54 rows; their work is complete, every row
  attempted:true/completed:true, and their survey rows carry 59/59 and
  10/10; L1's `tasks_total` column happens to sum to 59, matching its
  survey row, while L2's sums to 66 against its survey row's 10/10 — the
  per-project subtask vocabulary, not a completion count). The S3 rows
  (6) and L3 rows (4) carry `tasks_completed` as a SEQUENTIAL ROW INDEX
  (S3 1/6, 2/6 … 6/6; L3 1/8, 2/8, 3/8, 4/8) — each row's number is its
  position in the seat's ledger sequence, not a completion count; the
  seats' honest counts come from their survey rows (6/6 and 8/8). The
  remaining 31 rows (S2, M3, S1, M1, M2) carry per-project subtask counts,
  all complete (n/n every row: 14/14, 21/21, 59/59, 34/34, 29/29). Both
  computations are preserved here; the survey rows are the counter the
  instrument's schema designates.

**THE FRICTION RECONCILIATION (34 vs 30):** the survey rows sum 34, the
ledger rows sum 30. The variance is +5 at L3 and −1 at S3, both
reconciled honestly: L3's five friction events were all recorded by the
continuation (the read-lag class hit four times + one click-overlay
nuisance, honestly counted "from this continuation … the dead worker's
four rows recorded 0") and live ONLY in its survey row — the inheritance
contract forbade new ledger rows, so they never entered the ledger; S3's
survey row records 4 while its ledger rows sum 5 — the seat's own two
counting surfaces differ by one event (its worklog stage summary says "4
honest friction events"; its ledger rows carry 2+1+0+1+1+0). Both counts
are disclosed; nothing normalized.

## 4. Round N register (the new honest seams, as measured, BEFORE any fix)

- **N-1 — the read-lag class (the stale-empty first frame; the round's top
  recurring friction).** For ~3–10s (worst observed ~3min on one surface)
  after a reload, a project switch, an alert declaration, or a sign-in,
  the read model renders its EMPTY-STATE copy — phrased as a durable claim
  ("No research notes attached to this project on record yet", "No project
  history is on record yet", "No notices at this view instant", even a
  waiting verdict where FIRED stands, "No execution submissions at this
  view instant" ~3 minutes while the fills HAD booked) — before the fetch
  completes and everything settles to exactly what stood. Measured by M1
  (its top friction: the job list ~10s, the Inbox ~6s, a Risk standing
  read ~15min-until-reload), S2 (the settling flash, observed three
  times), S3 (~6s, twice), L1 (~5–6s, reproduced 3×), L3 (hit four
  times), M2 (the Execution-blotter and pre-firing shapes), M3 (~3–8s).
  No datum ever lost; the defect is that the words promise durability the
  render does not — "a trader who measured Round M's evaporation still
  holds his breath at that flash"; "from a compliance seat those seconds
  read as missing books".
- **N-2 — the single-line note input (the round's deepest product defect,
  the top new-register candidate).** The note attach field is a
  single-line `<input type=text>`: the browser's value sanitization strips
  newlines, so a real multi-line research note (a grammar line plus
  free-text digest lines in ONE note) cannot be entered by any user —
  violating the card's own "stored verbatim" promise, while the boundary
  teaching promises whole-line parsing the field cannot receive.
  Corroborated at 6+ seats (M3's top friction; S1's, M1's, and L2's top
  friction; L1 corroborated; L3 corroborated; S3 "not hit from my seat" —
  its notes were single-line by design). The two-note workaround verified
  end-to-end everywhere (the machinery is correct; the surface cannot
  receive a multi-line note); the compute layer then honestly treats the
  collapsed text as evidence-only.
- **N-3 — M2's degraded-export composition seam (file-verified, the export
  path's honesty gap).** An export taken while the console's connection
  read DEGRADED (the same transient-404 class that latches the CONNECTION
  panel) silently omitted whole derived-record families: M2's first F3
  export carried SEVEN derived events (project-loaded, goal-loaded,
  launch-submitted, job-updated, launch-completed, risk-utilization-loaded,
  alert-declared) — MISSING outcomes-loaded, post-mortems-loaded,
  submission-recorded ×3, org-snapshot AND the alert-fired entry the
  manifest's own derivedEventRule promises ("the compliance officer's FULL
  RECORD … carries them regardless of what the current page session
  observed") — while the file still verified head-exact and still
  presented that promise. The settled re-export minutes later carried all
  FOURTEEN families including alert-fired at the observed fill's own
  filledAt — no data lost, the derivation correct when composed healthy —
  but nothing ties the honest traces together (the manifest counts field
  says recordDerivedEvents: 7 and workspace.connection: "degraded" rides
  the file; nothing names the missing families). Not reproduced from L3's
  seat (all seven of its compositions healthy with full prefixes); the
  class is real on M2's file evidence.
- **N-4 — the org-volume pricing tier unquantified ("on request").** Every
  seat's one named reservation on an otherwise published-and-sane model;
  the reason pricing_fit held at 4 everywhere. The list price is what a
  2-person shop actually pays ($58/mo); a 350-person fund's research org
  runs many desks at list until that conversation happens; the
  enterprise-relevant tier for L1/L3 stays a budget-line gap.
- **N-5 — the $29 automation tier's live-API surfaces are a forward
  delivery.** The tier buys "live API surfaces, org-level oversight,
  priority support" — surfaces this SIMULATED deployment does not yet
  serve (M1's honest forward-looking note: "pilot-era free access covers
  the gap"; L1: "a future delivery this SIMULATED deployment does not yet
  serve"). The tier's value proposition is partly a promise.
- **N-6 — the engine's short fill window (~90s–3min post-launch).** A desk
  books fills only in the first minutes after launch, after which
  later-declared alerts wait honestly forever — a workflow shape to know
  for oversight (not a defect): L3's F3 window closed before its alerts
  were ready ("the third alert declared 12:23:10.113 AFTER the fill window
  closed — honestly waiting forever"), forcing its dedicated fifth
  project; M2's alert-form collapse cost the between-fills window on F1
  ("the FIRED path moved to F3"); L1 — "a desk books fills for only ~3
  minutes post-launch, after which later-declared alerts wait honestly
  forever"; S3's D1 declaration raced fill 2 by 2.45s (the seat's own
  timing, the law held with millisecond precision).
- **THE MINORS (carried, none measured blocking):** the alert declare form
  collapses after each declaration (a real annoyance under time pressure —
  M1 three re-opens mid-sequence; M2's FIRED path moved desks for it); the
  two identically-labeled "Create account" buttons (S2 — mode switcher vs
  submit); the constraints list separator untaught at the field (S2's one
  recorded friction event — newline reads as one malformed entry, comma
  discovered by trial; S3 corroborated); the horizon AM/PM + Seconds
  spinner trap (L3's dead-worker mis-fill, honestly logged as harness
  error — the product carried the declared stamps faithfully and labeled
  the true span "23h 59m 59s" honestly); no inbox notice for a fired alert
  (L3: "it lives on the card + the chain"); "Start the primary flow"
  absent on Home after the first launch (S1, L1, M2 — "Describe your goal"
  is the way back); the transient-404 race latching the CONNECTION panel
  DEGRADED ~4 min before clearing to LIVE (M2); the submitted-job row lag
  ~10s (M1, M3); the no-equals preferences shape still silently discarding
  from the goal record (L3's file-side finding — the softer M-6 residual;
  the pair-shape is refused honestly at entry); the deliverable's
  "goal-set record" wording (L2: goal.notes is null in every goal record —
  "the substance holds but the first half names a resting place the file
  does not carry"; S3 corroborated); the standing risk read's moving
  instant between exports (L2 — a live view among the record-derived
  families, disclosed by the manifest; the immutable families
  byte-stable); the export's session-event tail being view-scoped (M3's
  observation for compliance hand-off, disclosed verbatim by the
  manifest's chainScopeNote); the honest 0.10 → "0.1" normalization (S1,
  recurring).

## 5. Conclusion

Nine rounds of measurement: E 0/2/7 → **N 9/9/0** — the first unanimous
YES, would_pilot 9/9 TRUE, every honesty law held under re-verification
from every seat (no fabricated zeros anywhere; 34 export chains head-exact
from the files alone; the FIRED-instant law at the observed fill's own
filledAt from all nine seats; the compute layer's honest boundary with
zero fabricated parameters; L20 held everywhere — the gate alone refuses).
**Every standing flip commitment was honored verbatim, measured as hard as
it was named**: the eight E-7 commitments (S1, S2, S3, M1, M2, L1, L3 +
M3's two-part condition "the day the compute layer reads my notes' numbers
AND pricing publishes sanely for a research seat" — both halves measured
PASS; S2's two-gate commitment "the day pricing publishes sanely AND the
note/alert records survive a restart" — both gates verified at every
layer), and L2's own data-lineage gates (durable record classes, a stable
point-in-time provenance record, sanely published pricing — all three
measured PASS from its own seat). The mission was the competitive
validation: the product set out to win the traders' seats, and Round N is
the answer — the unanimous YES, would_pilot 9/9, and the switch decisions
(S3 and L3 recorded SWITCH; the conversions named from every other seat).
The remaining seams are the polish register, not blockers: N-1 (the
read-lag class) and N-2 (the single-line note input) above all, then the
export-path honesty gap (N-3), the volume tier (N-4), the live-API
surfaces (N-5), and the fill-window shape (N-6).

The next steps: **the Round N register (the read-lag class + the
single-line note input above all) → the pilot roll-outs** — M1's eleven
desk heads and L1's desk heads "this quarter", S3's Monday checklist at
"$0 to learn and $58/mo to automate", L3's "supervised desk-level pilot in
production … hand a regulator the export chain" — with the operator items
standing: quantifying the org-volume tier, and delivering the $29 tier's
live-API surfaces the day they exist.
